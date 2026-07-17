-- Migration 20260717_2 (angewendet am 17.07.2026 als "maintenance_invoices_status_skipped_internal")
-- Status 'skipped_internal' (Eigenbestand Bege Apartments GmbH, keine Weiterberechnung) erlauben.
-- Gefunden im Testlauf: der ursprüngliche CHECK-Constraint kannte den neuen Status nicht.
alter table public.maintenance_invoices drop constraint maintenance_invoices_status_check;
alter table public.maintenance_invoices add constraint maintenance_invoices_status_check
  check (status = any (array['processing'::text, 'invoice_created'::text, 'sending'::text, 'sent'::text, 'completed'::text, 'completed_no_drive'::text, 'hold'::text, 'skipped_internal'::text, 'error'::text]));
