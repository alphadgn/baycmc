-- Geez on Ape (ApeChain), Gobs on Ape (ApeChain) and StonkBrokers (Robinhood
-- Chain) join the whitelist with exactly Temp Agency's access: the same Super
-- Admin menu-matrix settings and the same collection rooms (Garden, Library,
-- Marina, Studio A, Studio B).

insert into public.collection_menu_items (collection_label, item_key, enabled)
select l.label, m.item_key, m.enabled
  from public.collection_menu_items m
 cross join (values ('GEEZ_ON_APE'), ('GOBS_ON_APE'), ('STONKBROKERS')) as l(label)
 where m.collection_label = 'TEMP_AGENCY'
on conflict (collection_label, item_key) do update set enabled = excluded.enabled;

update public.rooms
   set required_collection = required_collection || ',GEEZ_ON_APE,GOBS_ON_APE,STONKBROKERS'
 where required_collection ilike '%TEMP_AGENCY%'
   and required_collection not ilike '%STONKBROKERS%';
