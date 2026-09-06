const assert = require('node:assert/strict');
const tenant = require('../netlify/functions/_lib/tenant');
const original = tenant.resolveTenantContextFromAccessToken;
let current = { id: 'tenant_a', provider: 'elevenlabs', elevenlabs_agent_id: null };
tenant.resolveTenantContextFromAccessToken = async () => ({ tenant: current });
process.env.ELEVENLABS_API_KEY = 'test';
process.env.RETELL_API_KEY = 'test';
const detail = require('../netlify/functions/get-call-detail');
const elevenlabs = require('../netlify/functions/_lib/elevenlabs');
const event = { httpMethod: 'GET', headers: { authorization: 'Bearer test' }, queryStringParameters: { call_id: 'foreign' } };
async function main() {
  global.fetch = async () => ({ ok: true, json: async () => ({ agent_id: 'other', conversation_id: 'foreign', call_id: 'foreign' }) });
  assert.equal((await detail.handler(event)).statusCode, 403, 'missing ElevenLabs mapping must deny details');
  current = { id: 'tenant_a', provider: 'retell', retell_agent_id: null };
  assert.equal((await detail.handler(event)).statusCode, 403, 'missing Retell mapping must deny details');
  current.retell_agent_id = 'own';
  assert.equal((await detail.handler(event)).statusCode, 403, 'foreign call must be denied');
  global.fetch = async () => ({ ok: true, json: async () => ({ conversations: [{ agent_id: 'other', conversation_id: 'foreign' }, { agent_id: 'own', conversation_id: 'mine' }], has_more: false }) });
  assert.deepEqual((await elevenlabs.listConversations('own')).map(c => c.id), ['mine']);
  tenant.resolveTenantContextFromAccessToken = original;
  console.log('Customer boundaries passed');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
