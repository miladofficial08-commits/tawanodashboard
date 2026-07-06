-- Erweiterung fuer eindeutiges SMS-Audit pro Tenant/Nummer/Agent.
-- Einmal im Supabase SQL Editor ausfuehren.

alter table public.sms_logs
  add column if not exists called_number text,
  add column if not exists retell_agent_id text,
  add column if not exists call_id text;

create index if not exists idx_sms_logs_tenant_called_number
  on public.sms_logs(tenant_id, called_number);

create index if not exists idx_sms_logs_tenant_retell_agent
  on public.sms_logs(tenant_id, retell_agent_id);
