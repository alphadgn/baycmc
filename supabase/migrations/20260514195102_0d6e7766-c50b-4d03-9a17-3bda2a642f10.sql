-- 1) Prevent ape-ride viewers from approving their own requests
DROP POLICY IF EXISTS "Viewer or host can update requests" ON public.ape_ride_requests;

CREATE POLICY "Host can update requests"
ON public.ape_ride_requests
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.ape_rides r
    WHERE r.id = ape_ride_requests.ride_id AND r.host_id = auth.uid()
  )
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.ape_rides r
    WHERE r.id = ape_ride_requests.ride_id AND r.host_id = auth.uid()
  )
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE POLICY "Viewer can edit own pending request"
ON public.ape_ride_requests
FOR UPDATE TO authenticated
USING (auth.uid() = viewer_id AND status = 'pending'::ape_ride_request_status)
WITH CHECK (auth.uid() = viewer_id AND status = 'pending'::ape_ride_request_status);

-- 2) Gate profile writes by token-proof verification
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;

CREATE POLICY "Verified users can insert their own profile"
ON public.profiles FOR INSERT TO authenticated
WITH CHECK (auth.uid() = id AND public.is_token_proof_verified(auth.uid()));

CREATE POLICY "Verified users can update their own profile"
ON public.profiles FOR UPDATE TO authenticated
USING (auth.uid() = id AND public.is_token_proof_verified(auth.uid()))
WITH CHECK (auth.uid() = id AND public.is_token_proof_verified(auth.uid()));

-- 3) Gate notification inserts by token-proof verification
DROP POLICY IF EXISTS "Users can insert notifications for themselves" ON public.notifications;

CREATE POLICY "Verified users insert own notifications"
ON public.notifications FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND public.is_token_proof_verified(auth.uid()));