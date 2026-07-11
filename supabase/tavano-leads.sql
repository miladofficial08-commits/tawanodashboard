-- Tavano Lead-Capture nach SMS-Demo.
-- Einmal im Supabase SQL Editor ausfuehren.
create extension if not exists pgcrypto;

create table if not exists public.tavano_leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  call_id text,
  phone_number text,
  name text,
  company text,
  email text,
  business_type text,
  desired_use_case text,
  urgency text,
  notes text,
  source text not null default 'sms_lead_capture',
  created_at timestamptz not null default now()
);

alter table public.tavano_leads enable row level security;

-- Die Netlify Function schreibt mit Service Role. Diese Policy erlaubt zusaetzlich
-- oeffentliche Inserts, falls die Function spaeter mit anon key betrieben wird.
drop policy if exists "anyone can submit tavano leads" on public.tavano_leads;
create policy "anyone can submit tavano leads"
on public.tavano_leads for insert
with check (true);

drop policy if exists "authenticated can read tavano leads" on public.tavano_leads;
create policy "authenticated can read tavano leads"
on public.tavano_leads for select
to authenticated
using (true);

create index if not exists idx_tavano_leads_created_at on public.tavano_leads(created_at desc);
create index if not exists idx_tavano_leads_tenant_created_at on public.tavano_leads(tenant_id, created_at desc);
