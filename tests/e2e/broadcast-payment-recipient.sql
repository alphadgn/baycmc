-- Read-only deployment check. Returns 1; missing/wrong recipient raises division by zero.
-- Update the expected address only when the club owner changes the recipient.
SELECT 1 / CASE WHEN EXISTS (
  SELECT 1 FROM public.stream_settings
  WHERE id = 1
    AND lower(payee_wallet) = '0x2c05d52cd675cc423fbb5a598371bb52348aa223'
) THEN 1 ELSE 0 END AS broadcast_payment_recipient_verified;