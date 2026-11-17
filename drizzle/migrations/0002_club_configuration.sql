CREATE OR REPLACE FUNCTION public.club_configuration() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT COALESCE((SELECT value FROM public.app_settings WHERE key = 'club_configuration'), '{}'::jsonb); $$;
GRANT EXECUTE ON FUNCTION public.club_configuration() TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.save_club_configuration(_value jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF jsonb_typeof(_value) <> 'object' OR jsonb_typeof(_value->'collections') <> 'array' THEN RAISE EXCEPTION 'Invalid configuration'; END IF;
 INSERT INTO public.app_settings(key,value,updated_at,updated_by) VALUES ('club_configuration',_value,now(),auth.uid()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at,updated_by=EXCLUDED.updated_by;
 INSERT INTO public.audit_logs(event_type,actor_id,metadata) VALUES ('club.configuration.update',auth.uid(),jsonb_build_object('collections',jsonb_array_length(_value->'collections')));
END; $$;
REVOKE ALL ON FUNCTION public.save_club_configuration(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_club_configuration(jsonb) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.collection_enabled(_label text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT CASE WHEN public.club_configuration() ? 'collections' THEN EXISTS (SELECT 1 FROM jsonb_array_elements(public.club_configuration()->'collections') c WHERE c->>'label'=_label AND c->>'active'='true') ELSE _label NOT IN ('PUDGY_PENGUINS','LIL_PUDGYS') END;
$$;
GRANT EXECUTE ON FUNCTION public.collection_enabled(text) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.can_access_area(_uid uuid, _item text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT coalesce(public.has_role(_uid,'admin') OR public.has_role(_uid,'super_admin') OR (_item='event_stream' AND public.stream_can_host(_uid)) OR EXISTS(SELECT 1 FROM public.user_verifications v JOIN public.collection_menu_items m ON m.collection_label=ANY(v.verified_collections) WHERE v.user_id=_uid AND m.item_key=_item AND m.enabled AND public.collection_enabled(m.collection_label)) OR (public.has_role(_uid,'verified_user') AND EXISTS(SELECT 1 FROM public.collection_menu_items m WHERE m.collection_label IN ('BAYC','MAYC') AND m.item_key=_item AND m.enabled AND public.collection_enabled(m.collection_label))),false);
$$;
CREATE OR REPLACE FUNCTION public.holds_collection(_uid uuid, _label text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT coalesce((public.collection_enabled(_label) AND EXISTS(SELECT 1 FROM public.user_verifications v WHERE v.user_id=_uid AND _label=ANY(v.verified_collections))) OR public.has_role(_uid,'admin') OR public.has_role(_uid,'super_admin'),false);
$$;
CREATE OR REPLACE FUNCTION public.holds_any_collection(_uid uuid, _labels text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_verifications v, unnest(v.verified_collections) l WHERE v.user_id=_uid AND l=ANY(string_to_array(replace(_labels,' ',''),',')) AND public.collection_enabled(l)) OR (public.has_role(_uid,'verified_user') AND EXISTS(SELECT 1 FROM unnest(ARRAY['BAYC','MAYC']) l WHERE l=ANY(string_to_array(replace(_labels,' ',''),',')) AND public.collection_enabled(l)));
$$;
CREATE OR REPLACE FUNCTION public.is_verified_holder(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_verifications v WHERE v.user_id=_user_id AND v.bayc_verified AND EXISTS(SELECT 1 FROM unnest(v.verified_collections) l WHERE public.collection_enabled(l))) OR public.has_role(_user_id,'verified_user') OR public.has_role(_user_id,'admin') OR public.has_role(_user_id,'super_admin');
$$;