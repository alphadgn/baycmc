-- Support DM threads. Each user has exactly one thread keyed by their own
-- user id; the messages table stores both the user's posts and any admin
-- replies. RLS scopes reads/writes so a user only ever sees their own
-- thread, while admins can see and reply on every thread.

-- Helper: convenient "is admin or super_admin" check. Mirrors the
-- public.is_lifer helper added in the lifer-messages migration.
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin', 'super_admin')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;

CREATE TABLE public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Whose thread is this. The user the conversation belongs to.
  thread_user_id uuid NOT NULL,
  -- Who wrote this message (the customer themselves, or an admin replying).
  sender_id uuid NOT NULL,
  -- True when an admin sent it; lets the UI render an "Admin" badge without
  -- a separate role lookup per message.
  is_admin boolean NOT NULL DEFAULT false,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

-- Read: the thread owner sees their own messages; admins see every thread.
CREATE POLICY "Support: read own or admin"
  ON public.support_messages FOR SELECT TO authenticated
  USING (auth.uid() = thread_user_id OR public.is_admin(auth.uid()));

-- Insert: customers post into their own thread (is_admin must be false);
-- admins post into any thread (is_admin must be true).
CREATE POLICY "Support: insert own thread or admin reply"
  ON public.support_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND (
      (thread_user_id = auth.uid() AND is_admin = false)
      OR (public.is_admin(auth.uid()) AND is_admin = true)
    )
  );

-- Update: an author can edit their own message; admins can edit any.
CREATE POLICY "Support: update own or admin"
  ON public.support_messages FOR UPDATE TO authenticated
  USING (sender_id = auth.uid() OR public.is_admin(auth.uid()))
  WITH CHECK (sender_id = auth.uid() OR public.is_admin(auth.uid()));

-- Delete: an author can delete their own message; admins can delete any.
CREATE POLICY "Support: delete own or admin"
  ON public.support_messages FOR DELETE TO authenticated
  USING (sender_id = auth.uid() OR public.is_admin(auth.uid()));

CREATE INDEX support_messages_thread_created_idx
  ON public.support_messages (thread_user_id, created_at DESC);

CREATE TRIGGER support_messages_set_updated_at
  BEFORE UPDATE ON public.support_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Realtime so both sides of the conversation see new messages live, and
-- REPLICA IDENTITY FULL so DELETE payloads include enough for client
-- reconciliation.
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_messages;
ALTER TABLE public.support_messages REPLICA IDENTITY FULL;
