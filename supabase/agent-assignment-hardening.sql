-- Run after elevenlabs-provider.sql. Duplicate assignments must be resolved first;
-- a failed index creation deliberately leaves existing customer data untouched.
begin;
create or replace function public.current_tenant_ids()
returns setof text language sql stable security definer set search_path = public
as $$
  select m.tenant_id from public.tenant_memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = auth.uid() and t.is_active = true;
$$;
drop policy if exists "tenant admins can update tenants" on public.tenants;
revoke update on public.tenants from authenticated, anon;
drop policy if exists "tenant members can read analytics snapshots" on public.analytics_snapshots;
create policy "tenant members can read analytics snapshots"
  on public.analytics_snapshots for select
  using (tenant_id in (select public.current_tenant_ids()) and snapshot_type <> 'tenant_settings');
drop policy if exists "tenant members can insert analytics snapshots" on public.analytics_snapshots;
create policy "tenant members can insert analytics snapshots"
  on public.analytics_snapshots for insert
  with check (tenant_id in (select public.current_tenant_ids()) and snapshot_type <> 'tenant_settings');
create unique index if not exists tenants_retell_agent_unique
  on public.tenants (retell_agent_id) where retell_agent_id is not null and retell_agent_id <> '';
create unique index if not exists tenants_elevenlabs_agent_unique
  on public.tenants (elevenlabs_agent_id) where elevenlabs_agent_id is not null and elevenlabs_agent_id <> '';
commit;
