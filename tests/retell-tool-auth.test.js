const assert = require('node:assert/strict');

function loadAuth(env) {
  const tenantPath = require.resolve('../netlify/functions/_lib/tenant');
  const authPath = require.resolve('../netlify/functions/_lib/retell-auth');
  const actualTenant = require(tenantPath);
  const original = require.cache[tenantPath].exports;
  require.cache[tenantPath].exports = Object.assign({}, actualTenant, {
    envValue(name) { return env[name] || ''; },
  });
  delete require.cache[authPath];
  try {
    return require(authPath);
  } finally {
    require.cache[tenantPath].exports = original;
  }
}

function eventWith(secret) {
  return { headers: { 'x-retell-tool-secret': secret } };
}

function testCanonicalSecret() {
  const auth = loadAuth({ RETELL_TOOL_SECRET: 'canonical' });
  assert.equal(auth.isAuthorizedToolRequest(eventWith('canonical')), true);
  assert.equal(auth.isAuthorizedToolRequest(eventWith('wrong')), false);
}

function testDeployedLegacySecret() {
  const auth = loadAuth({ RETELL_WEBHOOK_SECRET: 'legacy' });
  assert.equal(auth.isAuthorizedToolRequest(eventWith('legacy')), true);
  assert.equal(auth.isAuthorizedToolRequest(eventWith('wrong')), false);
}

function testMissingConfigurationKeepsExistingCallsWorking() {
  const auth = loadAuth({});
  assert.equal(auth.isAuthorizedToolRequest(eventWith('anything')), true);
  assert.equal(auth.isToolAuthenticationConfigured(), false);
}

function testAuthorizationHeaderBearerFallback() {
  const auth = loadAuth({ RETELL_TOOL_SECRET: 'canonical' });
  assert.equal(auth.isAuthorizedToolRequest({ headers: { authorization: 'Bearer canonical' } }), true);
}

function run() {
  testCanonicalSecret();
  testDeployedLegacySecret();
  testMissingConfigurationKeepsExistingCallsWorking();
  testAuthorizationHeaderBearerFallback();
  console.log('retell-tool-auth.test.js: all assertions passed');
}

run();
