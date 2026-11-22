-- REVIEW ONLY. Not registered with Drizzle and NOT applied to any shared database.
-- Apply through the migration workflow after approval, before deploying dependent code.
CREATE TABLE public.stream_closed_sessions (
  session_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  closed_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.stream_closed_sessions TO service_role;
ALTER TABLE public.stream_closed_sessions ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.stream_broadcasts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  session_id uuid NOT NULL,
  grant_id uuid REFERENCES public.stream_grants(id),
  status text NOT NULL DEFAULT 'live' CHECK (status IN ('live','ended')),
  started_at timestamptz NOT NULL DEFAULT now(),
  last_live_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz,
  ended_at timestamptz,
  end_reason text
);
GRANT SELECT ON public.stream_broadcasts TO authenticated;
GRANT ALL ON public.stream_broadcasts TO service_role;
ALTER TABLE public.stream_broadcasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Broadcasts own or staff read" ON public.stream_broadcasts FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE UNIQUE INDEX stream_broadcasts_one_live ON public.stream_broadcasts(user_id) WHERE status='live';

-- Existing unbound in-use grants cannot be safely resumed into a different session.
UPDATE public.stream_grants SET status='expired', ended_at=now(), end_reason='session_binding_upgrade'
WHERE status='in_use';

CREATE FUNCTION public.stream_session_valid(_uid uuid, _session uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM auth.sessions WHERE id=_session AND user_id=_uid
    AND (not_after IS NULL OR not_after > now()))
    AND NOT EXISTS (SELECT 1 FROM public.stream_closed_sessions WHERE session_id=_session);
$$;

CREATE FUNCTION public.stream_broadcast_finish(_uid uuid, _session uuid, _id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b public.stream_broadcasts;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('stream:' || _uid::text,0));
  SELECT * INTO b FROM public.stream_broadcasts WHERE id=_id AND user_id=_uid AND session_id=_session FOR UPDATE;
  IF NOT FOUND OR b.status <> 'live' THEN RETURN; END IF;
  UPDATE public.stream_broadcasts SET status='ended',ended_at=now(),end_reason=_reason WHERE id=b.id;
  UPDATE public.stream_grants SET status=CASE WHEN _reason='ended' THEN 'used' ELSE 'expired' END,
    ended_at=now(),end_reason=_reason WHERE id=b.grant_id AND status='in_use';
END $$;

CREATE FUNCTION public.stream_broadcast_valid(_uid uuid, _session uuid, _id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.stream_broadcasts b WHERE b.id=_id AND b.user_id=_uid
    AND b.session_id=_session AND b.status='live'
    AND coalesce(b.disconnected_at,b.last_live_at) > now()-interval '5 minutes'
    AND public.stream_session_valid(_uid,_session)
    AND (CASE WHEN b.grant_id IS NULL THEN
      public.has_role(_uid,'admin') OR public.has_role(_uid,'super_admin')
      ELSE EXISTS (SELECT 1 FROM public.stream_grants g WHERE g.id=b.grant_id AND g.status='in_use') END));
$$;

CREATE FUNCTION public.stream_broadcast_claim(_uid uuid, _session uuid, _id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b public.stream_broadcasts; g public.stream_grants; staff boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('stream:' || _uid::text,0));
  IF NOT public.stream_session_valid(_uid,_session) THEN RETURN false; END IF;
  SELECT * INTO b FROM public.stream_broadcasts WHERE user_id=_uid AND status='live' FOR UPDATE;
  IF FOUND THEN
    IF NOT public.stream_broadcast_valid(b.user_id,b.session_id,b.id) THEN
      PERFORM public.stream_broadcast_finish(b.user_id,b.session_id,b.id,'reconnect_expired');
    ELSE
      -- Retry is idempotent only for this exact broadcast AND signed-in session.
      RETURN b.id=_id AND b.session_id=_session;
    END IF;
  END IF;
  -- A completed attempt may never be recycled, even with a new grant.
  IF EXISTS (SELECT 1 FROM public.stream_broadcasts WHERE id=_id) THEN RETURN false; END IF;
  staff := public.has_role(_uid,'admin') OR public.has_role(_uid,'super_admin');
  IF NOT staff THEN
    SELECT * INTO g FROM public.stream_grants WHERE user_id=_uid AND status='active' FOR UPDATE;
    IF NOT FOUND THEN RETURN false; END IF;
    UPDATE public.stream_grants SET status='in_use',started_at=now(),last_live_at=now() WHERE id=g.id;
  END IF;
  INSERT INTO public.stream_broadcasts(id,user_id,session_id,grant_id) VALUES(_id,_uid,_session,g.id);
  RETURN true;
END $$;

CREATE FUNCTION public.stream_broadcast_touch(_uid uuid, _session uuid, _id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('stream:' || _uid::text,0));
  IF NOT public.stream_broadcast_valid(_uid,_session,_id) THEN
    PERFORM public.stream_broadcast_finish(_uid,_session,_id,'reconnect_expired');
    RETURN false;
  END IF;
  UPDATE public.stream_broadcasts SET last_live_at=now(),disconnected_at=NULL WHERE id=_id;
  UPDATE public.stream_grants SET last_live_at=now() WHERE id=(SELECT grant_id FROM public.stream_broadcasts WHERE id=_id);
  RETURN true;
END $$;

CREATE FUNCTION public.stream_broadcast_disconnect(_uid uuid, _session uuid, _id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('stream:' || _uid::text,0));
  UPDATE public.stream_broadcasts SET disconnected_at=coalesce(disconnected_at,now())
  WHERE id=_id AND user_id=_uid AND session_id=_session AND status='live';
END
$$;

CREATE FUNCTION public.stream_session_close(_uid uuid, _session uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('stream:' || _uid::text,0));
  INSERT INTO public.stream_closed_sessions(session_id,user_id) VALUES(_session,_uid) ON CONFLICT DO NOTHING;
  -- Manual sign-out is global in this app; terminate other broadcasting sessions too.
  INSERT INTO public.stream_closed_sessions(session_id,user_id)
    SELECT session_id,user_id FROM public.stream_broadcasts WHERE user_id=_uid AND status='live'
    ON CONFLICT DO NOTHING;
  PERFORM public.stream_grant_finish(_uid,'signed_out');
END $$;

-- Session end invalidates unused grants too; no old-session replay may claim a new grant.
CREATE OR REPLACE FUNCTION public.stream_grant_finish(_uid uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('stream:' || _uid::text,0));
  UPDATE public.stream_broadcasts SET status='ended',ended_at=now(),end_reason=_reason WHERE user_id=_uid AND status='live';
  UPDATE public.stream_grants SET status=CASE WHEN _reason='ended' THEN 'used' ELSE 'expired' END,
    ended_at=now(),end_reason=_reason WHERE user_id=_uid AND status IN ('active','in_use');
END $$;
CREATE OR REPLACE FUNCTION public.stream_grant_revoke(_uid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE me uuid:=auth.uid();
BEGIN
  IF NOT coalesce(public.has_role(me,'admin') OR public.has_role(me,'super_admin'),false) THEN RAISE EXCEPTION 'Only admins can revoke streaming.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('stream:' || _uid::text,0));
  UPDATE public.stream_grants SET status='revoked',ended_at=now(),end_reason='revoked' WHERE user_id=_uid AND status IN ('active','in_use');
  UPDATE public.stream_broadcasts SET status='ended',ended_at=now(),end_reason='revoked' WHERE user_id=_uid AND status='live' AND grant_id IS NOT NULL;
  INSERT INTO public.audit_logs(event_type,actor_id,target_id) VALUES('event_stream.revoke',me,_uid);
END $$;
-- Shut the old unbound start path off; all starts must name an auth session and attempt.
CREATE OR REPLACE FUNCTION public.stream_grant_touch(_uid uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT false $$;

-- Preserve eligibility for viewing/menu/ticketing, independently of publishing permissions.
CREATE OR REPLACE FUNCTION public.stream_grant_sweep()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b public.stream_broadcasts;
BEGIN
  FOR b IN SELECT * FROM public.stream_broadcasts WHERE status='live' LOOP
    IF NOT public.stream_broadcast_valid(b.user_id,b.session_id,b.id) THEN
      PERFORM public.stream_broadcast_finish(b.user_id,b.session_id,b.id,'reconnect_expired');
    END IF;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.stream_session_valid(uuid,uuid), public.stream_broadcast_finish(uuid,uuid,uuid,text),
 public.stream_broadcast_valid(uuid,uuid,uuid), public.stream_broadcast_claim(uuid,uuid,uuid),
 public.stream_broadcast_touch(uuid,uuid,uuid), public.stream_broadcast_disconnect(uuid,uuid,uuid), public.stream_session_close(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stream_session_valid(uuid,uuid), public.stream_broadcast_finish(uuid,uuid,uuid,text),
 public.stream_broadcast_valid(uuid,uuid,uuid), public.stream_broadcast_claim(uuid,uuid,uuid),
 public.stream_broadcast_touch(uuid,uuid,uuid), public.stream_broadcast_disconnect(uuid,uuid,uuid), public.stream_session_close(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.stream_grant_finish(uuid,text), public.stream_grant_sweep(), public.stream_grant_touch(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stream_grant_finish(uuid,text), public.stream_grant_sweep(), public.stream_grant_touch(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.stream_grant_revoke(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.stream_grant_revoke(uuid) TO authenticated;
