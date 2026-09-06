const assert = require('node:assert/strict');
const tenant = require('../netlify/functions/_lib/tenant');
let matches = [];
tenant.listRows = async () => matches;
tenant.envValue = () => 'test';
const { validateAssignment } = require('../netlify/functions/_lib/agent-assignment');
async function main() {
  await assert.rejects(() => validateAssignment('unknown', 'agent_own'), /auswählen/);
  await assert.rejects(() => validateAssignment('elevenlabs', 'a,b'), /gültige/);
  matches = [{id:'other'}];
  await assert.rejects(() => validateAssignment('elevenlabs', 'agent_own'), /anderen Kunden/);
  matches = [{id:'mine'}];
  global.fetch = async () => ({ ok: true, json: async () => ({agent_id:'agent_own'}) });
  await validateAssignment('elevenlabs', 'agent_own', 'mine');
  global.fetch = async () => ({ ok: false, status:403 });
  await assert.rejects(() => validateAssignment('elevenlabs', 'agent_own', 'mine'), /Zugriffsrechte/);
  console.log('Agent assignment passed');
}
main().catch(e => { console.error(e); process.exitCode=1; });
