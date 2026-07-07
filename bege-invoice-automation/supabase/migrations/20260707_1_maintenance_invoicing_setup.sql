-- Bege Apartments: Automatisierte Instandhaltungs-Abrechnung (Google Form -> Easybill)
-- Migration 1/2 - ANGEWENDET am 07.07.2026 auf Projekt "Jonas rechnungsworkflow" (hzeephtezapvgouguigz)
-- Inhalt: Log-Tabelle, sichere Owner-View, Objekt->Eigentuemer-Mapping (Seed aus booking_invoices)

-- 1) Protokoll-/Statustabelle (Muster: booking_invoices)
create table public.maintenance_invoices (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  tenant_id             uuid references public.tenants(id),
  form_submission_id    text not null,
  sheet_row_number      integer,
  submitted_at          timestamptz,
  raw_payload           jsonb not null default '{}'::jsonb,
  hausmeister           text,
  object_reference      text,
  owner_id              text references public.owner_mapping(owner_id),
  easybill_customer_id  text,
  stunden               numeric(6,2),
  kilometer             numeric(7,2),
  material_cost_cents   integer,
  belege_urls           jsonb,
  computed_amount_cents integer,
  vat_percent           numeric(4,2),
  easybill_document_id  text,
  invoice_number        text,
  pdf_drive_file_id     text,
  status                text not null default 'processing'
    check (status in ('processing','invoice_created','sending','sent','completed','completed_no_drive','hold','error')),
  is_processing         boolean not null default false,
  retry_count           integer not null default 0,
  error_message         text,
  hold_reason           text,
  processed_at          timestamptz,
  constraint maintenance_invoices_submission_uq unique (form_submission_id)
);
comment on table public.maintenance_invoices is
  'Protokoll der automatisierten Instandhaltungs-Abrechnung (Google Form -> Easybill). Idempotenz ueber form_submission_id (unique). Status-Kette: processing -> invoice_created -> sending -> sent -> completed[_no_drive]; hold = unplausibel (keine Rechnung), error = technischer Fehler.';

alter table public.maintenance_invoices enable row level security;
revoke all on public.maintenance_invoices from anon, authenticated;

-- 2) Sichere Lese-View fuer den Workflow: NUR abrechnungsrelevante Spalten,
--    OrgaMax-Zugangsdaten aus owner_mapping bleiben unsichtbar.
create view public.owner_mapping_billing
  with (security_invoker = true) as
  select owner_id,
         "Owner_Name"          as owner_name,
         easybill_customer_id,
         easybill_email,
         gdrive_folder_id
  from public.owner_mapping;
revoke all on public.owner_mapping_billing from anon, authenticated;

-- 3) Objekt -> Eigentuemer (Formular-Referenz -> owner_id), Seed aus booking_invoices
create table public.object_owner_map (
  object_key   text primary key,
  owner_id     text not null references public.owner_mapping(owner_id),
  listing_id   text,
  listing_name text,
  source       text not null default 'booking_invoices_seed',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.object_owner_map is
  'Lookup fuer den Instandhaltungs-Workflow: normalisierte Objekt-Referenz (lower/trim) -> owner_id. Seed aus booking_invoices (listing_id + eindeutige listing_names); neue Objekte manuell ergaenzen.';

alter table public.object_owner_map enable row level security;
revoke all on public.object_owner_map from anon, authenticated;

-- Seed A: Schluessel = listing_id (immer eindeutig, 0 Konflikte verifiziert)
insert into public.object_owner_map (object_key, owner_id, listing_id, listing_name)
select distinct on (listing_id)
       lower(trim(listing_id)), owner_id, listing_id, listing_name
from public.booking_invoices
where listing_id is not null and owner_id is not null
order by listing_id, created_at desc
on conflict (object_key) do nothing;

-- Seed B: Schluessel = normalisierter listing_name (nur Namen mit eindeutigem Owner)
insert into public.object_owner_map (object_key, owner_id, listing_id, listing_name)
select lower(trim(listing_name)), min(owner_id), min(listing_id), min(listing_name)
from public.booking_invoices
where listing_name is not null and owner_id is not null
group by lower(trim(listing_name))
having count(distinct owner_id) = 1
on conflict (object_key) do nothing;

-- Ergebnis des Seeds am 07.07.2026: 399 Schluessel, 45 von 47 Eigentuemern abgedeckt.
