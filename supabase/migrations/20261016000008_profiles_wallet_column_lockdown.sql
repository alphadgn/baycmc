-- Members can read only the display columns of other members' profiles.
-- Full wallet addresses: owner via get_my_wallet(), staff via service role.
revoke select on public.profiles from anon, authenticated;
grant select (id, username, bio, avatar_url, created_at, updated_at, wallet_display)
  on public.profiles to authenticated;
