-- Integration test: everything is rolled back, including the isolated test tenant.
begin;
insert into public.tenants(id,slug,name) values('__planner_transaction_test__','__planner_transaction_test__','Temporary planner test');
select public.import_dashboard_calls('__planner_transaction_test__','retell','test-agent',
  '[{"call_id":"test-call","createdAt":"2026-09-06T10:00:00Z","durationMs":120000,"status":"ended","summary":"Rückruf heute um 16 Uhr"}]');
update public.call_workspace set notes='Notiz bleibt',state='done',state_manual=true,scheduled_at='2026-09-07T14:00:00Z',schedule_manual=true
where tenant_id='__planner_transaction_test__';
select public.import_dashboard_calls('__planner_transaction_test__','retell','test-agent',
  '[{"call_id":"test-call","createdAt":"2026-09-06T10:00:00Z","durationMs":125000,"status":"ended","summary":"Aktualisierte Zusammenfassung"}]');
do $$begin
  if not exists(select 1 from public.call_workspace where tenant_id='__planner_transaction_test__'
    and state='done' and notes='Notiz bleibt' and scheduled_at='2026-09-07T14:00:00Z'
    and duration_ms=125000 and snapshot->>'summary'='Aktualisierte Zusammenfassung')
  then raise exception 'Reimport overwrote customer work or failed to refresh call'; end if;
end $$;
update public.call_workspace set state='deleted',snapshot='{}',notes='',scheduled_at=null where tenant_id='__planner_transaction_test__';
select public.import_dashboard_calls('__planner_transaction_test__','retell','test-agent',
  '[{"call_id":"test-call","createdAt":"2026-09-06T10:00:00Z","durationMs":125000,"status":"ended","summary":"Must not reappear"}]');
do $$begin
  if not exists(select 1 from public.call_workspace where tenant_id='__planner_transaction_test__'
    and state='deleted' and snapshot='{}' and notes='' and duration_ms=125000)
  then raise exception 'Deleted call reappeared or usage was lost'; end if;
end $$;
rollback;
