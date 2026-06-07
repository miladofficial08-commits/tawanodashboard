create extension if not exists pgcrypto;

create table if not exists public.tenants (
  id text primary key,
  slug text unique not null,
  name text not null,
  is_active boolean not null default true,
  retell_agent_id text,
  retell_agent_alias text,
  retell_from_number text,
  booking_link_url text,
  sms_sender text,
  go_live_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create table if not exists public.callback_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants(id) on delete cascade,
  call_id text,
  phone_number text not null,
  customer_name text,
  reason text not null default 'transfer_timeout',
  source text not null default 'retell_tool',
  priority text not null default 'normal',
  notes text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'done', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sms_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants(id) on delete cascade,
  phone_number text not null,
  customer_name text,
  booking_link_url text,
  message text not null,
  provider text not null,
  provider_message_id text,
  status text not null default 'queued',
  created_at timestamptz not null default now()
);

create table if not exists public.analytics_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants(id) on delete cascade,
  snapshot_type text not null default 'topic_snapshot',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.current_tenant_ids()
returns setof text
language sql
stable
as $$
  select tenant_id
  from public.tenant_memberships
  where user_id = auth.uid();
$$;

alter table public.tenants enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.callback_requests enable row level security;
alter table public.sms_logs enable row level security;
alter table public.analytics_snapshots enable row level security;

drop policy if exists "tenant members can read tenants" on public.tenants;
create policy "tenant members can read tenants"
on public.tenants for select
using (id in (select public.current_tenant_ids()));

drop policy if exists "tenant admins can update tenants" on public.tenants;
create policy "tenant admins can update tenants"
on public.tenants for update
using (
  exists (
    select 1 from public.tenant_memberships m
    where m.tenant_id = tenants.id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  )
)
with check (
  exists (
    select 1 from public.tenant_memberships m
    where m.tenant_id = tenants.id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  )
);

drop policy if exists "users can read own memberships" on public.tenant_memberships;
create policy "users can read own memberships"
on public.tenant_memberships for select
using (user_id = auth.uid());

drop policy if exists "tenant members can read callbacks" on public.callback_requests;
create policy "tenant members can read callbacks"
on public.callback_requests for select
using (tenant_id in (select public.current_tenant_ids()));

drop policy if exists "tenant members can insert callbacks" on public.callback_requests;
create policy "tenant members can insert callbacks"
on public.callback_requests for insert
with check (tenant_id in (select public.current_tenant_ids()));

drop policy if exists "tenant members can update callbacks" on public.callback_requests;
create policy "tenant members can update callbacks"
on public.callback_requests for update
using (tenant_id in (select public.current_tenant_ids()))
with check (tenant_id in (select public.current_tenant_ids()));

drop policy if exists "tenant members can read sms logs" on public.sms_logs;
create policy "tenant members can read sms logs"
on public.sms_logs for select
using (tenant_id in (select public.current_tenant_ids()));

drop policy if exists "tenant members can insert sms logs" on public.sms_logs;
create policy "tenant members can insert sms logs"
on public.sms_logs for insert
with check (tenant_id in (select public.current_tenant_ids()));

drop policy if exists "tenant members can update sms logs" on public.sms_logs;
create policy "tenant members can update sms logs"
on public.sms_logs for update
using (tenant_id in (select public.current_tenant_ids()))
with check (tenant_id in (select public.current_tenant_ids()));

drop policy if exists "tenant members can read analytics snapshots" on public.analytics_snapshots;
create policy "tenant members can read analytics snapshots"
on public.analytics_snapshots for select
using (tenant_id in (select public.current_tenant_ids()));

drop policy if exists "tenant members can insert analytics snapshots" on public.analytics_snapshots;
create policy "tenant members can insert analytics snapshots"
on public.analytics_snapshots for insert
with check (tenant_id in (select public.current_tenant_ids()));

create index if not exists idx_tenant_memberships_user_id on public.tenant_memberships(user_id);
create index if not exists idx_callback_requests_tenant_id_created_at on public.callback_requests(tenant_id, created_at desc);
create index if not exists idx_sms_logs_tenant_id_created_at on public.sms_logs(tenant_id, created_at desc);
create index if not exists idx_analytics_snapshots_tenant_id_created_at on public.analytics_snapshots(tenant_id, created_at desc);