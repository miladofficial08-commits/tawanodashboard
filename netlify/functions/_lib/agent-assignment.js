const { envValue, listRows } = require('./tenant');

/** Validate an exclusive provider/agent assignment before provisioning or updating a tenant. */
async function validateAssignment(provider, agentId, tenantId) {
  if (!['retell', 'elevenlabs'].includes(provider)) throw Object.assign(new Error('Bitte ElevenLabs oder Retell auswählen.'), { status: 400 });
  if (!/^[a-zA-Z0-9_-]{3,200}$/.test(agentId)) throw Object.assign(new Error('Eine gültige Agent-ID ist erforderlich.'), { status: 400 });
  const column = provider === 'elevenlabs' ? 'elevenlabs_agent_id' : 'retell_agent_id';
  const matches = await listRows('tenants', { select: 'id', [column]: 'eq.' + agentId }, { serviceRole: true });
  if (matches.some(row => row.id !== tenantId)) throw Object.assign(new Error('Dieser Agent ist bereits einem anderen Kunden zugeordnet. Jeder Kunde braucht einen eigenen Agent.'), { status: 409 });
  const key = envValue(provider === 'elevenlabs' ? 'ELEVENLABS_API_KEY' : 'RETELL_API_KEY').trim();
  if (!key) throw Object.assign(new Error('Der API-Schlüssel für ' + provider + ' fehlt auf dem Server.'), { status: 503 });
  const url = provider === 'elevenlabs'
    ? 'https://api.elevenlabs.io/v1/convai/agents/' + encodeURIComponent(agentId)
    : 'https://api.retellai.com/get-agent/' + encodeURIComponent(agentId);
  const headers = provider === 'elevenlabs' ? { 'xi-api-key': key } : { Authorization: 'Bearer ' + key };
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Object.assign(new Error('Agent nicht erreichbar. Prüfe Agent-ID und Zugriffsrechte des API-Schlüssels (' + response.status + ').'), { status: 422 });
  const data = await response.json();
  if (String(data.agent_id || '') !== agentId) throw Object.assign(new Error('Agent-Zuordnung konnte nicht bestätigt werden.'), { status: 422 });
  return data;
}

module.exports = { validateAssignment };
