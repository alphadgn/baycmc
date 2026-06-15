## Account Merge / Keep-Separate Flow

### Trigger

On every successful sign-in (wallet SIWE or email), the app calls a server function that looks for OTHER accounts sharing either:

- the same wallet address (any verified wallet on profile / user_verifications)
- the same verified email (auth.users.email)

If a collision is found, the user is taken to a blocking full-screen modal before they can reach the lobby/karaoke/etc.

### One-time decision (per pair of accounts)

A new table `account_merge_decisions` records `(user_a_id, user_b_id, decision, decided_by, decided_at)` with `decision ∈ ('merged','separate')`. The pair is stored canonically (lower uuid first) so order doesn't matter. Decisions are permanent for the user; only super_admin can delete a row to re-open the prompt.

Before showing the modal the server fn checks this table and skips the prompt if a decision already exists for that pair.

### Modal UX

Step 1 — Choose:

- "Keep accounts separate" (permanent) — writes `separate`, dismisses, never asks again. Warns: "This is a one-time decision. You won't be asked again."
- "Merge accounts" — proceeds to step 2.

Step 2 — Pick the surviving account: side-by-side cards showing each account's username, avatar, wallet count, verifications, and created date. User picks SURVIVOR; the other is the REMOVED account.

Step 3 — Pick the carry-over profile fields (defaults to survivor's values):

- Display name / username
- Avatar (pfp)
- Bio
- Notification preferences
- Room preferences (mic/cam defaults)

All wallet addresses on the removed account are reassigned to the survivor regardless of pick.

Step 4 — Confirm: "This permanently deletes the other account. This cannot be undone."

### Server function: `mergeAccounts`

Auth-required. Validates the caller owns ONE of the two accounts. Runs as `supabaseAdmin` inside the handler:

1. Re-check no prior decision exists.
2. Update survivor profile with the user-chosen field set.
3. Move all wallets from removed → survivor (update `user_verifications`, any wallet rows).
4. Reassign content owned by removed → survivor across: posts, post_likes, post_comments, lobby_messages, lobby_message_reactions, messages, lifer_messages, karaoke_recordings, ape_rides, ape_ride_requests, room_bookings, notifications.
5. Insert `account_merge_decisions` row with `decision='merged'`.
6. Log to `audit_logs`.
7. Hard delete the removed account from `auth.users` (cascades profile, user_roles, etc.).
8. If the caller WAS the removed account, sign them out and return a redirect; otherwise return success.

### Server function: `recordMergeDecisionSeparate`

Auth-required. Inserts `decision='separate'` for the canonical pair, returns success. If a decision already exists, returns the existing one (idempotent).

### Server function: `findAccountCollision`

Auth-required, called once after each sign-in by the AuthRedirectWatcher. Returns either `null` or `{ otherUserId, otherProfile, collisionReason: 'wallet'|'email', priorDecision: 'merged'|'separate'|null }`. When `priorDecision === 'separate'` returns null (already decided).

### Super-admin reset

New row action in `admin.users.tsx` (or a new `admin.merges.tsx` panel): list all `account_merge_decisions` rows with a Delete button. Deleting re-opens the prompt on next sign-in for that pair. Calls a `resetMergeDecision` server fn gated by `has_role(_, 'super_admin')`.

### Database migration

```text
account_merge_decisions
  user_a_id  uuid  (canonical: lower of the two)
  user_b_id  uuid  (canonical: higher)
  decision   text  ('merged'|'separate')
  decided_by uuid  (auth.users.id)
  decided_at timestamptz
  PRIMARY KEY (user_a_id, user_b_id)
```

RLS: select where caller is `user_a_id` or `user_b_id` OR has admin/super_admin. Insert via server fn (service role) only. Delete only by super_admin.

### Client wiring

- New `<AccountMergeWatcher />` mounted in `__root.tsx` after `AuthRedirectWatcher`. On auth state change → SIGNED_IN, calls `findAccountCollision`; if non-null, navigates to a blocking `/_authenticated/account-merge` route.
- New route `src/routes/_authenticated/account-merge.tsx` renders the multi-step modal. Cannot be dismissed without a decision.
- After resolution, navigates back to `/lobby` (or wherever they were headed).

### Out of scope (kept for clarity)

- No automatic re-merge — every collision is per-pair.
- No partial / reversible merge.
- Wallet/email change AFTER decision does NOT re-trigger for that same pair.
