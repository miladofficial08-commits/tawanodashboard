-- ElevenLabs als zweiter Voice-Provider neben Retell.
--
-- Additiv & rueckwaertskompatibel: bestehende Kunden bekommen automatisch
-- provider = 'retell' und bleiben damit exakt wie bisher. Nur neu angelegte
-- Kunden (z. B. Beauty World, neue Agentur-Kunden) koennen 'elevenlabs' sein.
--
-- Ausfuehren im Supabase SQL-Editor.

alter table public.tenants
  add column if not exists provider text not null default 'retell',
  add column if not exists elevenlabs_agent_id text;

-- Nur 'retell' oder 'elevenlabs' zulassen (Tippfehler abfangen).
alter table public.tenants
  drop constraint if exists tenants_provider_check;
alter table public.tenants
  add constraint tenants_provider_check
  check (provider in ('retell', 'elevenlabs'));

-- Schnelle Tenant-Aufloesung ueber die ElevenLabs-Agent-ID (analog retell_agent_id).
create index if not exists tenants_elevenlabs_agent_id_idx
  on public.tenants (elevenlabs_agent_id)
  where elevenlabs_agent_id is not null;
