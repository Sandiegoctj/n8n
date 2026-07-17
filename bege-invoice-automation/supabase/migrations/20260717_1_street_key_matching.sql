-- Migration 20260717_1 (angewendet am 17.07.2026 als "street_key_matching_setup")
-- Straßen-Schlüssel-Matching für HW-01: Das echte Hausmeister-Formular liefert Freitext-Adressen
-- ("Alemannenstr 19 1 OG Mitte"), keine Listing-Namen. Diese Migration normalisiert Adressen auf
-- "straßenname hausnr" und baut daraus eine Lookup-Struktur.
-- WICHTIG: public.street_key() muss identisch zur JS-Funktion streetKey() im Workflow bleiben!

create or replace function public.street_key(input text)
returns text
language plpgsql
immutable
as $$
declare
  t text;
  tk text;
  name_part text := '';
  num_part text := '';
  m text[];
begin
  if input is null then return ''; end if;
  t := lower(input);
  t := replace(replace(replace(replace(t, 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss');
  t := regexp_replace(t, '\s+', ' ', 'g');
  t := split_part(t, ',', 1);
  t := regexp_replace(t, '\(.*?\)', ' ', 'g');
  t := regexp_replace(t, '[/+]', ' ', 'g');
  t := regexp_replace(t, '[^a-z0-9 .-]', ' ', 'g');
  t := replace(t, '.', ' ');
  t := replace(t, '-', ' ');
  t := btrim(regexp_replace(t, '\s+', ' ', 'g'));
  if t = '' then return ''; end if;
  foreach tk in array string_to_array(t, ' ') loop
    if tk ~ '^\d' then
      if name_part <> '' then
        m := regexp_match(tk, '^(\d+)([a-z]?)');
        num_part := m[1] || coalesce(m[2], '');
        exit;
      end if;
      -- führende Zahl ohne Straßennamen (z. B. PLZ am Anfang) ignorieren
    else
      tk := regexp_replace(tk, '(strasse|str|atr|srt)$', '');
      if tk <> '' then
        name_part := case when name_part = '' then tk else name_part || ' ' || tk end;
      end if;
    end if;
  end loop;
  if name_part = '' or num_part = '' then return ''; end if;
  return name_part || ' ' || num_part;
end
$$;

create table if not exists public.object_street_map (
  id uuid primary key default gen_random_uuid(),
  street_key text not null,
  owner_id text not null,
  sample_address text,
  source text not null default 'manuell',
  created_at timestamptz not null default now(),
  unique (street_key, owner_id)
);

alter table public.object_street_map enable row level security;
revoke all on public.object_street_map from anon, authenticated;

-- Seed 1: Adress-Schlüssel aus object_owner_map (booking_invoices-Seed vom 07.07.)
insert into public.object_street_map (street_key, owner_id, sample_address, source)
select public.street_key(object_key), owner_id, min(object_key), 'object_owner_map_seed'
from public.object_owner_map
where object_key !~ '^[0-9a-f]{24}$'
  and object_key not like 'bege apartments%'
  and owner_id is not null and owner_id <> ''
group by public.street_key(object_key), owner_id
having public.street_key(object_key) <> ''
on conflict (street_key, owner_id) do nothing;

-- Seed 2: Listing-Adressen aus booking_invoices (deckt deutlich mehr Objekte ab)
insert into public.object_street_map (street_key, owner_id, sample_address, source)
select public.street_key(listing_address), owner_id, min(listing_address), 'booking_invoices_seed'
from public.booking_invoices
where listing_address is not null and listing_address <> ''
  and owner_id is not null and owner_id <> ''
group by public.street_key(listing_address), owner_id
having public.street_key(listing_address) <> ''
on conflict (street_key, owner_id) do nothing;

-- View für den Workflow-Lookup: genau 1 Zeile pro street_key, owner_count > 1 = mehrdeutig -> HOLD
create or replace view public.object_street_owner
with (security_invoker = on) as
select
  street_key,
  min(owner_id) as owner_id,
  count(distinct owner_id)::int as owner_count,
  min(sample_address) as sample_address
from public.object_street_map
group by street_key;

revoke all on public.object_street_owner from anon, authenticated;

-- Manuelle Tippfehler-Aliasse (Hausmeister-Schreibweisen aus dem echten Sheet, eindeutig zuordenbar)
insert into public.object_street_map (street_key, owner_id, sample_address, source) values
('heinrich bonger 39', '698cae5ad4b3a26bd8501a83', 'Tippfehler-Alias fuer heinrich bongers 39 (Heinrich-Bongers-Straße 39, Duisburg)', 'alias_manuell'),
('guenningfelder 3', '67eee251b42cfc66882e9dd4', 'Tippfehler-Alias fuer guennigfelder 3 (Günnigfelder Str. 3, Gelsenkirchen)', 'alias_manuell'),
('alte linnen 42', '69c182aea070cb016d389443', 'Tippfehler-Alias fuer alte linner 42 (Alte Linner Straße 42, Krefeld)', 'alias_manuell')
on conflict (street_key, owner_id) do nothing;

-- Pflege: Neues Objekt/Alias zuordnen (Beispiel):
--   insert into object_street_map (street_key, owner_id, sample_address, source)
--   values (public.street_key('Musterstraße 1, 12345 Musterstadt'), '<owner_id>', 'Musterstraße 1', 'manuell');
-- Mehrdeutigkeit auflösen: überzählige Zeilen für den street_key löschen, bis owner_count = 1.
