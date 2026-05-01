
REVOKE ALL ON FUNCTION public.log_audit_event(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_audit_event(text, uuid, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.prevent_booking_overlap() FROM PUBLIC, anon;
