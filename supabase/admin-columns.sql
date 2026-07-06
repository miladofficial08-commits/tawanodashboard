-- Zusatz-Felder pro Kunde fuer das Admin-Control-Center.
-- Einmal im Supabase SQL Editor ausfuehren.
alter table public.tenants add column if not exists minutes_budget int;
alter table public.tenants add column if not exists sms_enabled boolean not null default true;
alter table public.tenants add column if not exists sms_template text;
