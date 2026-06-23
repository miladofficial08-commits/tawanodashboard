-- Feedback aus eingehenden SMS-Antworten (Bewertung 1 bis 5).
-- Einmal im Supabase SQL Editor ausfuehren.
create extension if not exists pgcrypto;

create table if not exists public.sms_feedback (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  phone_number text,
  rating int check (rating between 1 and 5),
  message text,
  call_id text,
  provider_message_id text,
  created_at timestamptz not null default now()
);

alter table public.sms_feedback enable row level security;

-- Der eingehende SMS-Webhook ist nicht eingeloggt -> Insert fuer alle erlauben (oeffentlicher Webhook).
drop policy if exists "anyone can submit sms feedback" on public.sms_feedback;
create policy "anyone can submit sms feedback"
on public.sms_feedback for insert
with check (true);

-- Lesen nur fuer eingeloggte Nutzer (Dashboard).
drop policy if exists "authenticated can read sms feedback" on public.sms_feedback;
create policy "authenticated can read sms feedback"
on public.sms_feedback for select
to authenticated
using (true);

create index if not exists idx_sms_feedback_created_at on public.sms_feedback(created_at desc);
