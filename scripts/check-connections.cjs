// Read-only readiness check. Never print credentials or customer call content.
const { envValue, listRows } = require('../netlify/functions/_lib/tenant');
(async () => {
  for (const key of ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','ADMIN_SECRET','ELEVENLABS_API_KEY']) console.log(key + ': ' + (envValue(key) ? 'vorhanden' : 'fehlt'));
  const tenants = await listRows('tenants', {select:'id,provider,retell_agent_id,elevenlabs_agent_id,is_active'}, {serviceRole:true});
  const memberships = await listRows('tenant_memberships', {select:'tenant_id,user_id'}, {serviceRole:true});
  const assigned = new Set(); let duplicates=0, missing=0;
  for (const t of tenants) {
    const agent = t.provider==='elevenlabs' ? t.elevenlabs_agent_id : t.retell_agent_id;
    const key = (t.provider || 'retell') + ':' + agent;
    if (agent && assigned.has(key)) duplicates++;
    if (agent) assigned.add(key);
    if (t.is_active && (!agent || !memberships.some(m=>m.tenant_id===t.id))) missing++;
  }
  console.log('Datenbank erreichbar: ' + tenants.length + ' Kunden; doppelte Agent-Zuordnungen: ' + duplicates + '; aktive Kunden ohne Agent oder Login: ' + missing);
  const key = envValue('ELEVENLABS_API_KEY');
  if (key) {
    const response = await fetch('https://api.elevenlabs.io/v1/convai/agents?page_size=1',{headers:{'xi-api-key':key},signal:AbortSignal.timeout(10000)});
    console.log('ElevenLabs-Agentzugriff: HTTP ' + response.status);
  }
})().catch(error=>{console.error('Verbindungsprüfung fehlgeschlagen: ' + error.message);process.exitCode=1;});
