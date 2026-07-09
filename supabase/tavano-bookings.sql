-- Termine, die der Voice Agent ueber Cal.com gebucht hat.
-- Dient (a) als Nachweis der Buchung und (b) zur Unterdrueckung der Standard-SMS,
-- wenn fuer denselben Anruf bereits die Call-Details-SMS verschickt wurde.
-- Einmal im Supabase SQL Editor ausfuehren.
create extension if not exists pgcrypto;

create table if not exists public.tavano_bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  call_id text,
  phone_number text,
  customer_name text,
  email text,
  calcom_booking_uid text,
  calcom_event_type_id text,
  start_time timestamptz,
  end_time timestamptz,
  meeting_url text,
  status text not null default 'booked',
  source text not null default 'voice_agent',
  created_at timestamptz not null default now()
);

alter table public.tavano_bookings enable row level security;

-- Die Netlify Function schreibt mit Service Role. Zusaetzlich oeffentliche Inserts
-- erlauben, falls die Function spaeter mit anon key betrieben wird.
drop policy if exists "service writes tavano bookings" on public.tavano_bookings;
create policy "service writes tavano bookings"
on public.tavano_bookings for insert
with check (true);

drop policy if exists "authenticated can read tavano bookings" on public.tavano_bookings;
create policy "authenticated can read tavano bookings"
on public.tavano_bookings for select
to authenticated
using (true);

create index if not exists idx_tavano_bookings_call_id on public.tavano_bookings(call_id);
create index if not exists idx_tavano_bookings_created_at on public.tavano_bookings(created_at desc);
create index if not exists idx_tavano_bookings_phone on public.tavano_bookings(phone_number);
