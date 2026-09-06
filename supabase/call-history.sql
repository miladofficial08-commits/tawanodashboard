-- Lueckenlose Anrufhistorie + strukturierte Rueckrufzeit.
-- Additiv: keine bestehende Zeile wird veraendert oder geloescht.
begin;

-- Merkt sich je Mandant/Provider/Agent, ab wann die Historie zusammenhaengend
-- vorliegt. Ohne diese Tabelle laeuft das Dashboard weiter, holt dann aber nur
-- die Gespraeche seit dem letzten Abruf statt einen Rueckstand nachzuarbeiten.
create table if not exists public.call_sync_state (
  tenant_id text not null references public.tenants(id) on delete cascade,
  provider text not null,
  agent_id text not null,
  synced_from timestamptz,
  history_complete boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, provider, agent_id)
);
alter table public.call_sync_state enable row level security;
revoke all on public.call_sync_state from anon, authenticated;
grant all on public.call_sync_state to service_role;

-- Vom Telefonassistenten strukturiert gelieferter Rueckrufzeitpunkt (UTC).
-- Freitext bleibt in notes; diese Spalte ist die eindeutige, geprueft gesetzte Zeit.
alter table public.callback_requests add column if not exists callback_at timestamptz;
alter table public.callback_requests add column if not exists callback_end timestamptz;

commit;
