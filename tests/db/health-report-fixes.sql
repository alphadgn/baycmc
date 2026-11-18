-- Isolated-database checks for migrations 20261118000001..08 (health-report fixes).
-- Run ONLY against a throwaway database after replaying supabase/migrations
-- (CI-free: executed locally with PGlite + Supabase role/auth stubs). Never run on a shared DB.
-- Behavioural checks for migrations 20261118000001..08 (run after replay).
create or replace function pg_temp.expect_error(_sql text, _like text) returns void language plpgsql as $$
begin
  begin
    execute _sql;
  exception when others then
    if sqlerrm not ilike _like then raise exception 'unexpected error for [%]: %', _sql, sqlerrm; end if;
    return;
  end;
  raise exception 'expected failure but succeeded: %', _sql;
end $$;
grant execute on function pg_temp.expect_error(text, text) to authenticated;

insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-0000000000a1','member@x.test'),
 ('00000000-0000-0000-0000-0000000000a2','admin@x.test'),
 ('00000000-0000-0000-0000-0000000000a3','other@x.test'),
 ('00000000-0000-0000-0000-0000000000a4','dup@x.test');
insert into public.user_roles(user_id, role) values ('00000000-0000-0000-0000-0000000000a2','admin');
insert into public.rooms(id, name, livekit_room, tier, kind) values
 ('00000000-0000-0000-0000-0000000000f1', 'Test', 'test-room', 'token_proof', 'karaoke');

-- ── 01 rate limit ──
do $$ declare r record; begin
  for i in 1..3 loop select * into r from public.consume_rate_limit('t','s',2,600); end loop;
  if r.allowed then raise exception 'rate limit: third hit should be refused'; end if;
end $$;
set role authenticated;
select pg_temp.expect_error($q$select public.consume_rate_limit('t','s',2,600)$q$, '%permission denied%');
reset role;

-- ── 02 bookings ──
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
insert into public.room_bookings(room_id,user_id,title,starts_at,ends_at)
  values ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000a1','mine','2030-01-01 10:00Z','2030-01-01 11:00Z');
-- member can't write override_by (column privilege)
select pg_temp.expect_error($q$insert into public.room_bookings(room_id,user_id,title,starts_at,ends_at,override_by)
  values ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000a1','x','2030-01-01 10:30Z','2030-01-01 11:30Z','00000000-0000-0000-0000-0000000000a1')$q$, '%permission denied%');
-- overlap still refused for members
select pg_temp.expect_error($q$insert into public.room_bookings(room_id,user_id,title,starts_at,ends_at)
  values ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000a1','x','2030-01-01 10:30Z','2030-01-01 11:30Z')$q$, '%conflicts%');
select pg_temp.expect_error($q$update public.room_bookings set override_by = auth.uid()$q$, '%permission denied%');
reset role;
-- trigger guard (even with full table privileges) for a signed-in non-admin
select pg_temp.expect_error($q$insert into public.room_bookings(room_id,user_id,title,starts_at,ends_at,override_by)
  values ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000a1','x','2030-01-01 10:30Z','2030-01-01 11:30Z','00000000-0000-0000-0000-0000000000a1')$q$, '%Only admins%');
-- admin override (server path) works
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
insert into public.room_bookings(room_id,user_id,title,starts_at,ends_at,override_by)
  values ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000a2','admin','2030-01-01 10:30Z','2030-01-01 11:30Z','00000000-0000-0000-0000-0000000000a2');
-- service role (no uid) works
select set_config('request.jwt.claim.sub','',false);
insert into public.room_bookings(room_id,user_id,title,starts_at,ends_at)
  values ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000a3','svc','2030-01-02 10:00Z','2030-01-02 11:00Z');

-- ── 03 ape rides ──
insert into public.ape_rides(id, host_id, title, livekit_room, status, capacity, price_ape)
  values ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a1','ride','ride-1','scheduled',1,5);
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
select pg_temp.expect_error($q$insert into public.ape_rides(host_id,title,livekit_room,admin_override) values (auth.uid(),'x','x',true)$q$, '%permission denied%');
select pg_temp.expect_error($q$update public.ape_rides set admin_override = true$q$, '%permission denied%');
reset role;
select pg_temp.expect_error($q$update public.ape_rides set price_ape = 0$q$, '%super admin%');
select set_config('request.jwt.claim.sub','',false);
select public.ape_ride_reserve('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a3');
select pg_temp.expect_error($q$select public.ape_ride_reserve('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a4')$q$, '%fully booked%');
select pg_temp.expect_error($q$select public.ape_ride_reserve('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a1')$q$, '%hosting%');

-- ── 07 recordings ──
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
select pg_temp.expect_error($q$insert into public.karaoke_recordings(room_id,performer_id,song_title,public_url,storage_path)
  values ('00000000-0000-0000-0000-0000000000f1',auth.uid(),'s','u','00000000-0000-0000-0000-0000000000a1/00000000-0000-0000-0000-0000000000f1/a.webm')$q$, '%row-level security%');
reset role;
insert into public.karaoke_waivers(user_id, version) values ('00000000-0000-0000-0000-0000000000a1','v1');
set role authenticated;
select pg_temp.expect_error($q$insert into public.karaoke_recordings(room_id,performer_id,song_title,public_url,storage_path)
  values ('00000000-0000-0000-0000-0000000000f1',auth.uid(),'s','u','00000000-0000-0000-0000-0000000000a3/x/a.webm')$q$, '%row-level security%');
insert into public.karaoke_recordings(room_id,performer_id,song_title,public_url,storage_path)
  values ('00000000-0000-0000-0000-0000000000f1',auth.uid(),'s','u','00000000-0000-0000-0000-0000000000a1/00000000-0000-0000-0000-0000000000f1/a.webm');
update public.karaoke_recordings set visibility = 'private';
select pg_temp.expect_error($q$update public.karaoke_recordings set storage_path = 'x'$q$, '%permission denied%');
reset role;

-- ── 06 merge ──
select set_config('request.jwt.claim.sub','',false);
insert into public.lifer_grants(user_id) values ('00000000-0000-0000-0000-0000000000a4');
insert into public.support_messages(sender_id, thread_user_id, body) values ('00000000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-0000000000a4','help');
insert into public.user_roles(user_id, role) values ('00000000-0000-0000-0000-0000000000a4','admin'),('00000000-0000-0000-0000-0000000000a3','admin');
insert into public.stream_events(id,title,starts_at,ends_at) values ('00000000-0000-0000-0000-0000000000c1','ev',now(),now()+interval '1 hour');
insert into public.stream_tickets(event_id,user_id,chain_id,tx_hash,from_address,to_address,amount_wei)
  values ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a4',33139,'0x01','0xa','0xb',1);
select public.merge_accounts('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a4',
  '00000000-0000-0000-0000-0000000000a3','surv',null,null,null,null);
do $$ begin
  if (select count(*) from public.lifer_grants where user_id='00000000-0000-0000-0000-0000000000a3') <> 1 then raise exception 'merge: lifer grant not moved'; end if;
  if (select count(*) from public.stream_tickets where user_id='00000000-0000-0000-0000-0000000000a3') <> 1 then raise exception 'merge: ticket not moved'; end if;
  if (select count(*) from public.support_messages where thread_user_id='00000000-0000-0000-0000-0000000000a3') <> 1 then raise exception 'merge: support not moved'; end if;
  if (select count(*) from public.user_roles where user_id='00000000-0000-0000-0000-0000000000a3' and role='admin') <> 1 then raise exception 'merge: roles'; end if;
  if (select count(*) from public.ape_ride_reservations where viewer_id='00000000-0000-0000-0000-0000000000a4') <> 0 then raise exception 'merge: leftovers'; end if;
  if (select username from public.profiles where id='00000000-0000-0000-0000-0000000000a3') <> 'surv' then raise exception 'merge: profile'; end if;
end $$;
-- deleting the removed user now loses nothing
delete from auth.users where id='00000000-0000-0000-0000-0000000000a4';
do $$ begin
  if (select count(*) from public.stream_tickets) <> 1 then raise exception 'merge: ticket lost on delete'; end if;
end $$;
-- conflicting paid tickets abort atomically
insert into public.stream_tickets(event_id,user_id,chain_id,tx_hash,from_address,to_address,amount_wei)
  values ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1',33139,'0x02','0xa','0xb',1);
select pg_temp.expect_error($q$select public.merge_accounts('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a3','s',null,null,null,null)$q$, '%same Event Stream event%');
set role authenticated;
select pg_temp.expect_error($q$select public.merge_accounts('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a3','s',null,null,null,null)$q$, '%permission denied%');
reset role;

-- ── 08 mudwater batch ──
select * from public.mudwater_can_play_rooms('00000000-0000-0000-0000-0000000000a1', array[]::uuid[]);
select 'ALL FIX TESTS PASSED';
