begin;
alter table public.tenants add column if not exists minutes_reset_at timestamptz;
create table if not exists public.call_workspace (
  tenant_id text not null references public.tenants(id) on delete cascade,
  provider text not null,
  agent_id text not null,
  call_id text not null,
  snapshot jsonb not null default '{}',
  started_at timestamptz,
  duration_ms numeric not null default 0,
  connected boolean not null default false,
  state text not null default 'open' check (state in ('open','done','deleted')),
  state_manual boolean not null default false,
  scheduled_at timestamptz,
  schedule_manual boolean not null default false,
  notes text not null default '' check (length(notes) <= 5000),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, provider, agent_id, call_id)
);
alter table public.call_workspace enable row level security;
revoke all on public.call_workspace from anon, authenticated;
grant all on public.call_workspace to service_role;

-- Only trusted server imports. Never overwrite work, notes or deletion markers.
create or replace function public.import_dashboard_calls(p_tenant text, p_provider text, p_agent text, p_calls jsonb)
returns void language plpgsql set search_path = public as $$
declare item jsonb;
begin
  for item in select value from jsonb_array_elements(p_calls) loop
    if coalesce(item->>'call_id','') <> '' then
      insert into public.call_workspace(tenant_id,provider,agent_id,call_id,snapshot,started_at,duration_ms,connected)
      values(p_tenant,p_provider,p_agent,item->>'call_id',item,(item->>'createdAt')::timestamptz,
        coalesce((item->>'durationMs')::numeric,0),coalesce(item->>'status','') in ('ended','ongoing','in-progress'))
      on conflict (tenant_id,provider,agent_id,call_id) do update
      set started_at=excluded.started_at,duration_ms=excluded.duration_ms,connected=excluded.connected,
      snapshot = call_workspace.snapshot || (
        select coalesce(jsonb_object_agg(key,value),'{}'::jsonb)
        from jsonb_each(excluded.snapshot) where value <> 'null'::jsonb and value <> '""'::jsonb
      ) where call_workspace.state <> 'deleted';
    end if;
  end loop;
end $$;
revoke all on function public.import_dashboard_calls(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.import_dashboard_calls(text,text,text,jsonb) to service_role;
commit;
