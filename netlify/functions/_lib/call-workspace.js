const {listRows,supabaseRequest,tenantProvider,tenantAgentId} = require('./tenant');

const IMPORT_CHUNK = 200; // Grosse Nachlaeufe nicht in einem einzigen Riesen-Request schicken.

function scopeValues(tenant) {
  return {tenant_id:tenant.id,provider:tenantProvider(tenant),agent_id:tenantAgentId(tenant)};
}
function scope(tenant) {
  const value = scopeValues(tenant);
  return {tenant_id:'eq.'+value.tenant_id,provider:'eq.'+value.provider,agent_id:'eq.'+value.agent_id};
}
async function importChunk(tenant, calls) {
  const value = scopeValues(tenant);
  const result = await supabaseRequest('/rest/v1/rpc/import_dashboard_calls', {
    serviceRole:true,method:'POST',body:{p_tenant:value.tenant_id,p_provider:value.provider,p_agent:value.agent_id,p_calls:calls},
  });
  if (!result.response.ok) throw new Error('Gesprächsablage nicht verfügbar. Bitte erneut aktualisieren.');
}
async function syncCalls(tenant, calls) {
  const list = Array.isArray(calls) ? calls : [];
  for (let index = 0; index < Math.max(1, list.length); index += IMPORT_CHUNK) {
    await importChunk(tenant, list.slice(index, index + IMPORT_CHUNK));
  }
  const all = [];
  let page;
  do {
    page = await listRows('call_workspace',{...scope(tenant),select:'*',order:'call_id.asc',limit:1000,offset:all.length},{serviceRole:true});
    all.push(...page);
  } while (page.length === 1000 && all.length < 10000);
  return {
    calls:all.filter(row=>row.state !== 'deleted').map(row=>({...row.snapshot,work:{state:row.state,state_manual:row.state_manual,scheduled_at:row.scheduled_at,schedule_manual:row.schedule_manual,notes:row.notes,updated_at:row.updated_at}})),
    minutesUsed:all.filter(row=>row.connected && (!tenant.minutes_reset_at || Date.parse(row.started_at)>=Date.parse(tenant.minutes_reset_at))).reduce((sum,row)=>sum+Number(row.duration_ms || 0)/60000,0),
    historyLimited:all.length >= 10000,
  };
}
module.exports = {scope,scopeValues,syncCalls};
