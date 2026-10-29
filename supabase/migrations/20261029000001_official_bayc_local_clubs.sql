-- Local Chapters = the official BAYC local clubs
-- (boredapeyachtclub.com/activations/bayc-community, 2026-10-29), each its
-- own chapter, alphabetical. Replaces the 7 placeholder chapters (no meetings
-- had been booked on them). Each chapter keeps its region and X link.

alter table public.local_chapters add column if not exists region text check (length(region) <= 80);
alter table public.local_chapters add column if not exists x_url text
  check (x_url is null or x_url ~ '^https://(x|twitter)\.com/[A-Za-z0-9_/]+$');

delete from public.local_chapters c
 where c.name in ('Southeast Apes', 'Northeast Apes', 'Southwest Apes', 'Northwest Apes',
                  'UK Apes', 'French Apes', 'Asia Apes')
   and not exists (select 1 from public.chapter_meetings m where m.chapter_id = c.id);

insert into public.local_chapters (name, region, x_url, display_order)
values
  ('808 Hawaii Apes', 'Hawaiian Islands', 'https://x.com/808HawaiiApes', 1),
  ('Ape 101 TW Club', 'Taiwan', 'https://x.com/BaycTaiwan', 2),
  ('Ape Smokers Social Club', 'Europe-wide', 'https://x.com/ApeSmokersClub', 3),
  ('Apes of Los Angeles', 'Los Angeles', 'https://x.com/ApeLosAngeles', 4),
  ('Apes of Orange', 'Netherlands', 'https://x.com/ApesOfOrange', 5),
  ('Apes+', null, 'https://x.com/ApesPlus', 6),
  ('Aussie Apes', 'Australia', 'https://x.com/AussieApes', 7),
  ('BAAP India', 'India', 'https://x.com/baap_xyz', 8),
  ('baykada', 'Philippines', 'https://x.com/baykada', 9),
  ('BAY•C', 'Bay Area', 'https://x.com/bayareaapes', 10),
  ('Big Apple Apes', 'New York City and surrounding area', 'https://x.com/BigAppleApes', 11),
  ('Bored Ape Switzerland', 'Switzerland', 'https://x.com/SwissApes', 12),
  ('Bored Art Not Club', null, 'https://x.com/BoredArtNotClub', 13),
  ('Bored Chili', 'International', 'https://x.com/boredchili', 14),
  ('Bored Club Canada', 'Canada', 'https://x.com/BoredClubCanada', 15),
  ('BORED MINDS ≡_≡', null, 'https://x.com/BoredMindsClub', 16),
  ('Bored Network', null, 'https://x.com/BoredNetworkCo', 17),
  ('Bored San Diego', 'San Diego', 'https://x.com/BoredSanDiego', 18),
  ('Bored Veterans', null, null, 19),
  ('BoredIn', null, 'https://x.com/BoredInApe', 20),
  ('Boring Security DAO', null, 'https://x.com/BoringSecDAO', 21),
  ('Chinese Ape Club', 'Chinese-speaking community, worldwide', 'https://x.com/Chinese_ApeClub', 22),
  ('Cigar City Apes', 'Tampa', 'https://x.com/CigarCityApes', 23),
  ('Czech & Slovak Ape Yacht Club', 'Czech Republic and Slovakia', 'https://x.com/CZSKAYC', 24),
  ('Degenerados Club', 'Brazil / Latin America', 'https://x.com/degeneradosclub', 25),
  ('Denver Apes', 'Denver, Colorado', 'https://x.com/DenverBAYCApes', 26),
  ('Dubai Ape Yacht Club', 'Dubai', 'https://x.com/DubaiApeYC', 27),
  ('Elite Apes', null, 'https://x.com/EliteApesHK', 28),
  ('Florida Apes', 'Florida (Tampa and Miami)', 'https://x.com/FloridaApes', 29),
  ('French Apes', 'French-speaking', 'https://x.com/FrenchApeYC', 30),
  ('German Ape Club', 'Germany, Austria, Switzerland', 'https://x.com/ApeClubDach', 31),
  ('Iberian Apes Yacht Club', 'Spain, Andorra, Gibraltar', 'https://x.com/IberianApesYC', 32),
  ('Japan Ape Club', 'Japan', null, 33),
  ('Ladies Clubhouse & Co.', null, 'https://x.com/clubhouseandco', 34),
  ('Ladies of the Yacht Club', null, 'https://x.com/LadiesofBAYC', 35),
  ('Magic City Apes', 'Miami', 'https://x.com/MagicCityApes', 36),
  ('Malaysia Ape Club', 'Malaysia', 'https://x.com/MalaysiaApeYC', 37),
  ('Mutant Cartel', null, 'https://x.com/mutant_cartel', 38),
  ('OnBored New York', 'New York', 'https://x.com/i/communities/2012786913048993953', 39),
  ('Other Italy', 'Italy', 'https://x.com/other_italy', 40),
  ('Otherside Developer Community', null, 'https://x.com/othersidedevs', 41),
  ('OTHERspace', null, 'https://x.com/OtherSpaceFM', 42),
  ('Pink DAO', null, 'https://x.com/pinkboredapes', 43),
  ('Portugal Ape Club', 'Portugal', 'https://x.com/portugalapeclub', 44),
  ('Singapore Ape Club', 'Singapore', 'https://x.com/baycsg', 45),
  ('Southwest Apes', 'Southwestern US', 'https://x.com/southwest_apes', 46),
  ('THE 288', null, 'https://x.com/288gang', 47),
  ('Turkish Ape Yacht Club', 'Türkiye', 'https://x.com/TurkishApeYC', 48),
  ('UK Ape Club', 'United Kingdom', 'https://x.com/UKApeClub', 49),
  ('United Georgia Apes', 'Atlanta', 'https://x.com/UGeorgiaApes', 50),
  ('Welcome Apes', null, 'https://x.com/WelcomeApes', 51)
on conflict (name) do update
  set region = excluded.region, x_url = excluded.x_url, display_order = excluded.display_order;

-- Super admin edits now include region and X link.
drop function if exists public.chapter_save(uuid, text, integer, boolean);
create or replace function public.chapter_save(
  _id uuid, _name text, _order integer, _active boolean,
  _region text default null, _x_url text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if not public.has_role(auth.uid(), 'super_admin'::app_role) then
    raise exception 'Only the super admin can edit the chapter list.';
  end if;
  if _x_url is not null and trim(_x_url) <> '' and trim(_x_url) !~ '^https://(x|twitter)\.com/[A-Za-z0-9_/]+$' then
    raise exception 'The X link must look like https://x.com/name';
  end if;
  if _id is null then
    insert into public.local_chapters (name, display_order, active, created_by, region, x_url)
    values (trim(_name), coalesce(_order, 100), coalesce(_active, true), auth.uid(),
            nullif(trim(_region), ''), nullif(trim(_x_url), ''))
    returning id into cid;
  else
    update public.local_chapters
       set name = trim(_name), display_order = coalesce(_order, display_order),
           active = coalesce(_active, active),
           region = nullif(trim(_region), ''), x_url = nullif(trim(_x_url), '')
     where id = _id returning id into cid;
  end if;
  return cid;
end $$;
revoke all on function public.chapter_save(uuid, text, integer, boolean, text, text) from public, anon;
grant execute on function public.chapter_save(uuid, text, integer, boolean, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
