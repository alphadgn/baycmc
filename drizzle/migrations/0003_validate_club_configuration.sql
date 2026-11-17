CREATE OR REPLACE FUNCTION public.save_club_configuration(_value jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c jsonb; l jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'super_admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF jsonb_typeof(_value) IS DISTINCT FROM 'object' OR jsonb_typeof(_value->'collections') IS DISTINCT FROM 'array' OR jsonb_typeof(_value->'rules') IS DISTINCT FROM 'string' OR jsonb_typeof(_value->'socialLinks') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid configuration'; END IF;
 IF jsonb_array_length(_value->'collections')>100 OR length(_value->>'rules')>12000 OR jsonb_array_length(_value->'socialLinks')>20 THEN RAISE EXCEPTION 'Configuration limit exceeded'; END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(_value->'collections') LOOP
  IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR coalesce(c->>'label','') !~ '^[A-Z0-9_]{2,40}$' OR length(trim(coalesce(c->>'name','')))=0 OR length(c->>'name')>120 OR coalesce(c->>'contract','') !~ '^0x[0-9a-fA-F]{40}$' OR coalesce(c->>'chainId','') NOT IN ('1','33139','4663') OR coalesce(c->>'access','') NOT IN ('full','partner') OR jsonb_typeof(c->'active') IS DISTINCT FROM 'boolean' OR jsonb_typeof(c->'tips') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid collection'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(_value->'collections') c GROUP BY c->>'label' HAVING count(*)>1) OR EXISTS(SELECT 1 FROM jsonb_array_elements(_value->'collections') c GROUP BY c->>'chainId',lower(c->>'contract') HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate collection'; END IF;
 FOR l IN SELECT value FROM jsonb_array_elements(_value->'socialLinks') LOOP
  IF jsonb_typeof(l) IS DISTINCT FROM 'object' OR length(trim(coalesce(l->>'label','')))=0 OR length(l->>'label')>80 OR coalesce(l->>'url','') !~ '^https://[^[:space:]/]+' THEN RAISE EXCEPTION 'Invalid social link'; END IF;
 END LOOP;
 INSERT INTO public.app_settings(key,value,updated_at,updated_by) VALUES('club_configuration',_value,now(),auth.uid()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at,updated_by=EXCLUDED.updated_by;
 INSERT INTO public.audit_logs(event_type,actor_id,metadata) VALUES('club.configuration.update',auth.uid(),jsonb_build_object('collections',jsonb_array_length(_value->'collections')));
END; $$;
REVOKE ALL ON FUNCTION public.save_club_configuration(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_club_configuration(jsonb) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.is_verified_holder(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_verifications v WHERE v.user_id=_user_id AND v.bayc_verified AND EXISTS(SELECT 1 FROM unnest(v.verified_collections) l WHERE public.collection_enabled(l) AND CASE WHEN public.club_configuration() ? 'collections' THEN EXISTS(SELECT 1 FROM jsonb_array_elements(public.club_configuration()->'collections') c WHERE c->>'label'=l AND c->>'active'='true' AND c->>'access'='full') ELSE l IN ('BAYC','MAYC','PUNKS') END)) OR public.has_role(_user_id,'verified_user') OR public.has_role(_user_id,'admin') OR public.has_role(_user_id,'super_admin');
$$;