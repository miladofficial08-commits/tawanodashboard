const assert = require('node:assert/strict');

// Der Test-Call darf AUSSCHLIESSLICH ueber den eigenen Retell-Agent des
// eingeloggten Kunden laufen. Zwei Wege haben das frueher gebrochen:
//  - ENV-Fallback auf RETELL_AGENT_BEAUTY, wenn der Tenant keinen Agent hat
//    (das trifft jeden ElevenLabs-Kunden) -> er haette mit dem Agent eines
//    ANDEREN Kunden telefoniert und dessen Minuten verbraucht.
//  - eine vom Browser mitgeschickte agentId wurde ungeprueft uebernommen.
// Beides ist hier festgenagelt.

function loadStartCall(env, tenant) {
  const tenantPath = require.resolve('../netlify/functions/_lib/tenant');
  const startPath = require.resolve('../netlify/functions/start-call');
  const actualTenant = require(tenantPath);
  const original = require.cache[tenantPath].exports;
  require.cache[tenantPath].exports = Object.assign({}, actualTenant, {
    envValue(name) { return env[name] || ''; },
    async resolveTenantContextFromAccessToken() {
      return { accessToken: 'token', user: { id: 'u1' }, tenant, membership: null, roles: [], source: 'test' };
    },
  });
  delete require.cache[startPath];
  try {
    return require(startPath);
  } finally {
    require.cache[tenantPath].exports = original;
  }
}

const ENV = { RETELL_API_KEY: 'key_test', RETELL_FROM_NUMBER: '+4921100000', RETELL_AGENT_BEAUTY: 'agent_fremder_kunde' };

function callEvent(body) {
  return {
    httpMethod: 'POST',
    headers: { authorization: 'Bearer token' },
    body: JSON.stringify(body),
  };
}

// Jeder ausgehende Retell-Aufruf wird abgefangen, damit im Test garantiert
// nicht wirklich telefoniert wird - und damit sichtbar ist, WELCHE Agent-ID
// rausgegangen waere.
function captureRetell() {
  const sent = [];
  globalThis.fetch = async (url, init) => {
    let payload = {};
    try { payload = JSON.parse((init && init.body) || '{}'); } catch (_) { payload = {}; }
    sent.push({ url: String(url), payload });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ call_id: 'call_1', agent_id: payload.override_agent_id || null }),
      json: async () => ({ call_id: 'call_1' }),
    };
  };
  return sent;
}

// ElevenLabs-Kunde: Telefonie laeuft dort, nicht bei uns. Es darf gar kein
// Retell-Call rausgehen.
async function testElevenLabsTenantIsRefused() {
  const handler = loadStartCall(ENV, {
    id: 'tenant_el', provider: 'elevenlabs', elevenlabs_agent_id: 'agent_el', retell_agent_id: null,
  }).handler;
  const sent = captureRetell();
  // AGENT_ALIAS aus Dashboardkunde.html - das Frontend schickt diesen Wert fuer
  // JEDEN Kunden mit. Genau ueber diesen Zweig lief frueher der ENV-Fallback.
  const res = await handler(callEvent({ phoneNumber: '+4915112345678', agentId: 'beautyworlds-demo' }));
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, false);
  assert.match(body.message, /ElevenLabs/);
  assert.equal(sent.length, 0, 'fuer einen ElevenLabs-Kunden darf KEIN Retell-Call rausgehen');
}

// Tenant ganz ohne Agent: sauber ablehnen statt auf den ENV-Agent auszuweichen.
async function testTenantWithoutAgentIsRefused() {
  const handler = loadStartCall(ENV, { id: 'tenant_leer', provider: 'retell', retell_agent_id: null }).handler;
  const sent = captureRetell();
  const res = await handler(callEvent({ phoneNumber: '+4915112345678', agentId: 'beautyworlds-demo' }));
  assert.equal(res.statusCode, 400);
  assert.equal(sent.length, 0, 'ohne eigenen Agent darf kein Call rausgehen');
  const body = JSON.parse(res.body);
  assert.doesNotMatch(String(body.message), /agent_fremder_kunde/, 'der fremde ENV-Agent darf nirgends auftauchen');
}

// Der Browser darf die Agent-ID NICHT bestimmen - egal was er mitschickt.
async function testClientSuppliedAgentIdIsIgnored() {
  const handler = loadStartCall(ENV, { id: 'tenant_a', provider: 'retell', retell_agent_id: 'agent_eigener' }).handler;
  const sent = captureRetell();
  const res = await handler(callEvent({ phoneNumber: '+4915112345678', agentId: 'agent_fremder_kunde' }));
  assert.equal(res.statusCode, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.override_agent_id, 'agent_eigener', 'es muss der eigene Agent des Tenants sein');
}

// Der Normalfall bleibt unveraendert: eigener Agent geht raus.
async function testOwnAgentIsUsed() {
  const handler = loadStartCall(ENV, { id: 'tenant_a', provider: 'retell', retell_agent_id: 'agent_eigener' }).handler;
  const sent = captureRetell();
  const res = await handler(callEvent({ phoneNumber: '+4915112345678', agentId: 'beautyworlds-demo' }));
  assert.equal(res.statusCode, 200);
  assert.equal(sent[0].payload.override_agent_id, 'agent_eigener');
  assert.equal(sent[0].payload.to_number, '+4915112345678');
}

// Kunden ohne provider-Spalte (Altbestand vor der Migration) bleiben Retell.
async function testLegacyTenantWithoutProviderStillWorks() {
  const handler = loadStartCall(ENV, { id: 'tenant_alt', retell_agent_id: 'agent_alt' }).handler;
  const sent = captureRetell();
  const res = await handler(callEvent({ phoneNumber: '+4915112345678', agentId: 'beautyworlds-demo' }));
  assert.equal(res.statusCode, 200);
  assert.equal(sent[0].payload.override_agent_id, 'agent_alt');
}

async function run() {
  await testElevenLabsTenantIsRefused();
  await testTenantWithoutAgentIsRefused();
  await testClientSuppliedAgentIdIsIgnored();
  await testOwnAgentIsUsed();
  await testLegacyTenantWithoutProviderStillWorks();
  console.log('start-call-isolation.test.js: all assertions passed');
}

run().catch((e) => { console.error(e); process.exit(1); });
