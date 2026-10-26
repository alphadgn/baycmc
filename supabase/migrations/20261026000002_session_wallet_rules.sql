-- Verification rules (Phase 1 agreement).
--
-- 1. The verified role follows exactly the same parameters as a BAYC/MAYC
--    holder: it opens whatever the super admin's menu matrix opens for
--    BAYC or MAYC, collection rooms that accept BAYC or MAYC, and Lifer
--    areas only together with a verified Otherpage token. (Previously it
--    opened every area.) Admins are unchanged. Mudwater playing seats never
--    use the role (mudwater_can_play reads real session verification).
-- 2. Transition: members signed in right now keep their current session —
--    their primary wallet and signature-verified linked wallets are recorded
--    as this session's proven wallets. From their next sign-in, only wallets
--    proven in that session count.

create or replace function public.can_access_area(_uid uuid, _item text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    public.has_role(_uid, 'admin'::app_role)
    or public.has_role(_uid, 'super_admin'::app_role)
    or (_item = 'event_stream' and exists (select 1 from public.event_stream_hosts h where h.user_id = _uid))
    or exists (
      select 1 from public.user_verifications v
        join public.collection_menu_items m on m.collection_label = any (v.verified_collections)
       where v.user_id = _uid and m.item_key = _item and m.enabled)
    or (public.has_role(_uid, 'verified_user'::app_role) and exists (
      select 1 from public.collection_menu_items m
       where m.collection_label in ('BAYC', 'MAYC') and m.item_key = _item and m.enabled)),
    false);
$function$;

create or replace function public.holds_any_collection(_uid uuid, _labels text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.user_verifications v
     where v.user_id = _uid
       and coalesce(v.verified_collections, '{}'::text[])
           && string_to_array(replace(_labels, ' ', ''), ',')
  ) or (
    public.has_role(_uid, 'verified_user'::app_role)
    and array['BAYC', 'MAYC'] && string_to_array(replace(_labels, ' ', ''), ',')
  );
$function$;

create or replace function public.is_lifer(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    exists (
      select 1 from public.user_verifications
       where user_id = _user_id
         and otherpage_verified = true
         and (bayc_verified = true or public.has_role(_user_id, 'verified_user'::app_role))
    )
    or public.has_role(_user_id, 'admin'::app_role)
    or public.has_role(_user_id, 'super_admin'::app_role);
$function$;

-- Addresses are stored lowercase.
-- Transition backfill (idempotent): only members with a live verified
-- session (verification is wiped at every sign-out).
insert into public.session_wallets (user_id, address)
select p.id, lower(p.wallet_address)
  from public.profiles p
  join public.user_verifications v on v.user_id = p.id
 where p.wallet_address is not null
   and coalesce(array_length(v.verified_collections, 1), 0) > 0
on conflict do nothing;
insert into public.session_wallets (user_id, address)
select l.user_id, lower(l.address)
  from public.linked_wallets l
  join public.user_verifications v on v.user_id = l.user_id
 where l.verified_at is not null
   and coalesce(array_length(v.verified_collections, 1), 0) > 0
on conflict do nothing;
