-- Sicherheitsfix aus Konzeptdokument 6.7: RLS auf public.tenants aktivieren.
-- Migration 2/2 - ANGEWENDET am 07.07.2026 auf Projekt "Jonas rechnungsworkflow" (hzeephtezapvgouguigz)
--
-- Gefahrlos fuer bestehende n8n-Workflows: diese nutzen den service_role-Key (bypasst RLS) --
-- belegt dadurch, dass owner_mapping/booking_invoices bereits RLS aktiviert haben und alle
-- aktiven Workflows laufen. Kein anon-Konsument vorhanden (keine anon-Policies, keine Edge Functions).
-- Rollback falls doch etwas bricht: alter table public.tenants disable row level security;
alter table public.tenants enable row level security;
revoke all on public.tenants from anon, authenticated;

-- Verifiziert am 07.07.2026: Security-Advisor meldet das kritische Finding
-- "RLS disabled on public.tenants" nicht mehr.
