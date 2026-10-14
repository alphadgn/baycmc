DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'public.user_verifications'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%bayc_collection%'
  LOOP EXECUTE format('ALTER TABLE public.user_verifications DROP CONSTRAINT %I', c); END LOOP;
END $$;
ALTER TABLE public.user_verifications ADD CONSTRAINT user_verifications_bayc_collection_check
  CHECK (bayc_collection IS NULL OR bayc_collection IN ('BAYC','MAYC','PUNKS','TEMP_AGENCY','UGLY_DUCK_LABS','ORCA_BUSINESS','PUDGY_PENGUINS','LIL_PUDGYS'));