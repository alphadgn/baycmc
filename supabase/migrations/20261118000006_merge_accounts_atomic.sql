-- Health report N-8: account merge was ~20 separate REST calls (not atomic) and only moved
-- some tables; everything else (paid stream tickets, tips, Lifer grants, support history,
-- waivers, booking guests, chapter attendance, ...) was cascade-deleted with the old account.
-- merge_accounts() moves every user-owned row to the survivor inside ONE transaction,
-- resolving unique-constraint conflicts explicitly. The server deletes the removed auth user
-- only after this function commits.

create or replace function public.merge_accounts(
  _survivor uuid,
  _removed uuid,
  _actor uuid,
  _username text,
  _avatar_url text,
  _bio text,
  _inherit_wallet text,   -- set when the survivor has no primary wallet: becomes its primary
  _link_wallet text       -- set when both have wallets: removed wallet kept as verified linked wallet
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a uuid := least(_survivor::text, _removed::text)::uuid;
  b uuid := greatest(_survivor::text, _removed::text)::uuid;
  moved jsonb := '{}'::jsonb;
  n integer;
  spec text;
  t text;
  c text;
  plain text[] := array[
    -- (table.column) pairs with no unique constraint on the user column
    'ape_ride_locations.host_id', 'ape_ride_payments.host_id', 'ape_ride_payments.payer_id',
    'ape_ride_reservations.cancelled_by', 'ape_rides.host_id', 'ape_rides.granted_by',
    'ape_rides.cancelled_by', 'app_settings.updated_by', 'chapter_meeting_attendees.added_by',
    'chapter_meetings.requester_id', 'chapter_meetings.reviewed_by', 'chapter_submissions.user_id',
    'chapter_submissions.reviewer_id', 'collection_menu_items.updated_by',
    'event_stream_hosts.assigned_by', 'karaoke_backing_tracks.owner_id',
    'karaoke_recordings.performer_id', 'karaoke_reservations.booked_by',
    'karaoke_reservations.singer_user_id', 'karaoke_room_sanctions.user_id',
    'karaoke_room_sanctions.created_by', 'karaoke_room_sanctions.lifted_by',
    'karaoke_room_settings.updated_by', 'karaoke_sessions.performer_user_id',
    'karaoke_tips.tipper_id', 'karaoke_tips.recipient_id', 'karaoke_waivers.user_id',
    'lifer_grants.granted_by', 'lifer_messages.user_id', 'lobby_messages.user_id',
    'local_chapters.created_by', 'mudwater_matches.created_by', 'mudwater_seat_private.user_id',
    'notifications.user_id', 'otherpage_settings.updated_by', 'post_comments.user_id',
    'posts.user_id', 'room_booking_guests.decided_by', 'room_bookings.user_id',
    'room_bookings.override_by', 'stream_events.created_by', 'stream_grants.granted_by',
    'stream_settings.updated_by', 'stream_tickets.refunded_by', 'support_messages.sender_id',
    'support_messages.thread_user_id', 'messages.user_id', 'contract_audit_messages.user_id'
  ];
begin
  if _survivor is null or _removed is null or _survivor = _removed then
    raise exception 'MERGE: invalid account pair';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('merge:' || a::text || ':' || b::text, 0));
  if not exists (select 1 from public.profiles where id = _survivor)
     or not exists (select 1 from public.profiles where id = _removed) then
    raise exception 'MERGE: profile missing';
  end if;
  if exists (select 1 from public.account_merge_decisions where user_a_id = a and user_b_id = b) then
    raise exception 'MERGE: a merge decision already exists for this pair';
  end if;

  -- Paid items that can't coexist: stop (nothing is changed) rather than lose a payment.
  if exists (select 1 from public.stream_tickets r join public.stream_tickets s
               on s.event_id = r.event_id and s.user_id = _survivor
              where r.user_id = _removed) then
    raise exception 'MERGE: both accounts hold a ticket for the same Event Stream event. Contact support to merge.';
  end if;
  if exists (select 1 from public.ape_ride_reservations r join public.ape_ride_reservations s
               on s.ride_id = r.ride_id and s.viewer_id = _survivor and s.status <> 'cancelled'
              where r.viewer_id = _removed and r.status = 'paid') then
    raise exception 'MERGE: both accounts reserved the same Ape Ride and one is paid. Contact support to merge.';
  end if;

  -- ── Rows keyed by user with unique constraints: drop the removed account's duplicate,
  --    keep the survivor's, then move the rest. ─────────────────────────────────────
  update public.stream_tickets set user_id = _survivor where user_id = _removed;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('stream_tickets', n);

  -- One open grant per user: expire the removed account's open grant if the survivor has one.
  update public.stream_grants r set status = 'expired', ended_at = now(), end_reason = 'account_merge'
   where r.user_id = _removed and r.status in ('active', 'in_use')
     and exists (select 1 from public.stream_grants s where s.user_id = _survivor and s.status in ('active', 'in_use'));
  update public.stream_grants set user_id = _survivor where user_id = _removed;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('stream_grants', n);
  if to_regclass('public.stream_broadcasts') is not null then
    execute 'update public.stream_broadcasts set status = ''ended'', ended_at = now(), end_reason = ''account_merge''
              where user_id = $1 and status = ''live''' using _removed;
    execute 'update public.stream_broadcasts set user_id = $1 where user_id = $2' using _survivor, _removed;
  end if;

  -- Lifer grant, verification, member holdings, event-stream host: unique per user.
  delete from public.lifer_grants where user_id = _removed
     and exists (select 1 from public.lifer_grants where user_id = _survivor);
  update public.lifer_grants set user_id = _survivor where user_id = _removed;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('lifer_grants', n);

  delete from public.user_verifications where user_id = _removed
     and exists (select 1 from public.user_verifications where user_id = _survivor);
  update public.user_verifications set user_id = _survivor where user_id = _removed;

  delete from public.member_holdings where user_id = _removed
     and exists (select 1 from public.member_holdings where user_id = _survivor);
  update public.member_holdings set user_id = _survivor where user_id = _removed;

  delete from public.event_stream_hosts where user_id = _removed
     and exists (select 1 from public.event_stream_hosts where user_id = _survivor);
  update public.event_stream_hosts set user_id = _survivor where user_id = _removed;

  -- Roles: union.
  insert into public.user_roles (user_id, role)
  select _survivor, role from public.user_roles where user_id = _removed
  on conflict (user_id, role) do nothing;
  delete from public.user_roles where user_id = _removed;

  -- Linked / session wallets: union by address.
  delete from public.linked_wallets r where r.user_id = _removed
     and exists (select 1 from public.linked_wallets s where s.user_id = _survivor and lower(s.address) = lower(r.address));
  update public.linked_wallets set user_id = _survivor where user_id = _removed;
  delete from public.session_wallets r where r.user_id = _removed
     and exists (select 1 from public.session_wallets s where s.user_id = _survivor and s.address = r.address);
  update public.session_wallets set user_id = _survivor where user_id = _removed;

  -- Pair-unique membership rows.
  delete from public.chapter_meeting_attendance r where r.user_id = _removed
     and exists (select 1 from public.chapter_meeting_attendance s where s.user_id = _survivor and s.meeting_id = r.meeting_id);
  update public.chapter_meeting_attendance set user_id = _survivor where user_id = _removed;
  delete from public.chapter_meeting_attendees r where r.user_id = _removed
     and exists (select 1 from public.chapter_meeting_attendees s where s.user_id = _survivor and s.meeting_id = r.meeting_id);
  update public.chapter_meeting_attendees set user_id = _survivor where user_id = _removed;
  delete from public.room_booking_guests r where r.user_id = _removed
     and exists (select 1 from public.room_booking_guests s where s.user_id = _survivor and s.booking_id = r.booking_id);
  update public.room_booking_guests set user_id = _survivor where user_id = _removed;
  delete from public.post_likes r where r.user_id = _removed
     and exists (select 1 from public.post_likes s where s.user_id = _survivor and s.post_id = r.post_id);
  update public.post_likes set user_id = _survivor where user_id = _removed;
  delete from public.lobby_message_reactions r where r.user_id = _removed
     and exists (select 1 from public.lobby_message_reactions s where s.user_id = _survivor
                  and s.message_id = r.message_id and s.emoji = r.emoji);
  update public.lobby_message_reactions set user_id = _survivor where user_id = _removed;
  delete from public.ape_ride_requests r where r.viewer_id = _removed
     and exists (select 1 from public.ape_ride_requests s where s.viewer_id = _survivor and s.ride_id = r.ride_id);
  update public.ape_ride_requests set viewer_id = _survivor where viewer_id = _removed;
  update public.ape_ride_reservations r set status = 'cancelled', cancelled_by = _actor
   where r.viewer_id = _removed and r.status <> 'cancelled'
     and exists (select 1 from public.ape_ride_reservations s where s.viewer_id = _survivor
                  and s.ride_id = r.ride_id and s.status <> 'cancelled');
  update public.ape_ride_reservations set viewer_id = _survivor where viewer_id = _removed;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('ape_ride_reservations', n);

  -- Ephemeral presence/queue rows: the survivor's entry wins.
  delete from public.karaoke_presence r where r.user_id = _removed
     and exists (select 1 from public.karaoke_presence s where s.user_id = _survivor and s.room_id = r.room_id);
  update public.karaoke_presence set user_id = _survivor where user_id = _removed;
  delete from public.karaoke_queue r where r.user_id = _removed
     and exists (select 1 from public.karaoke_queue s where s.user_id = _survivor and s.room_id = r.room_id);
  update public.karaoke_queue set user_id = _survivor where user_id = _removed;

  -- Mudwater seats: one ACTIVE seat per user; history seats always move.
  update public.mudwater_seats r set user_id = _survivor
   where r.user_id = _removed
     and not (r.active and exists (select 1 from public.mudwater_seats s where s.user_id = _survivor and s.active));

  -- ── Plain ownership columns (skips tables/columns that don't exist in this database). ──
  foreach spec in array plain loop
    t := split_part(spec, '.', 1);
    c := split_part(spec, '.', 2);
    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = t and column_name = c) then
      execute format('update public.%I set %I = $1 where %I = $2', t, c, c) using _survivor, _removed;
      get diagnostics n = row_count;
      if n > 0 then moved := moved || jsonb_build_object(spec, n); end if;
    end if;
  end loop;

  -- ── Profile ──────────────────────────────────────────────────────────────────
  update public.profiles set wallet_address = null where id = _removed and wallet_address is not null;
  update public.profiles
     set username = _username, avatar_url = _avatar_url, bio = _bio,
         wallet_address = coalesce(_inherit_wallet, wallet_address),
         updated_at = now()
   where id = _survivor;
  if _link_wallet is not null and _link_wallet ~ '^0x[a-fA-F0-9]{40}$' then
    insert into public.linked_wallets (user_id, address, label, verified_at, last_checked_at)
    values (_survivor, _link_wallet, 'Merged account', now(), now())
    on conflict (user_id, address) do nothing;
  end if;

  insert into public.account_merge_decisions (user_a_id, user_b_id, decision, decided_by)
  values (a, b, 'merged', coalesce(_actor, _survivor));

  insert into public.audit_logs (event_type, actor_id, target_id, metadata)
  values ('account.merge', _actor, _removed,
          jsonb_build_object('survivor', _survivor, 'removed', _removed, 'moved', moved, 'reason', 'user-initiated'));

  return jsonb_build_object('ok', true, 'moved', moved);
end $$;

revoke all on function public.merge_accounts(uuid, uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.merge_accounts(uuid, uuid, uuid, text, text, text, text, text) to service_role;
