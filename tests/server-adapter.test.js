const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Der Adapter startet beim Require einen Listener - fuer den Test auf einen freien Port lenken.
process.env.PORT = '0';
const { toNetlifyEvent, loadHandler, API_ROUTES, STATIC_PAGES, app } = require('../server');

// Jede in netlify.toml gemappte Route muss auch im Adapter existieren, sonst faellt
// beim Umzug still eine Retell-Tool-URL weg (genau das bricht Anrufe).
function testAllNetlifyRoutesAreMapped() {
  const toml = fs.readFileSync(path.join(__dirname, '..', 'netlify.toml'), 'utf8');
  const pairs = [];
  const re = /from\s*=\s*"([^"]+)"\s*\n\s*to\s*=\s*"\/\.netlify\/functions\/([^"]+)"/g;
  let m;
  while ((m = re.exec(toml)) !== null) pairs.push([m[1], m[2]]);
  assert.ok(pairs.length >= 20, 'netlify.toml sollte >=20 API-Routen enthalten, gefunden: ' + pairs.length);
  for (const [route, fn] of pairs) {
    assert.equal(API_ROUTES[route], fn, 'Route fehlt oder zeigt falsch im Adapter: ' + route);
  }
}

// Jede gemappte Funktion muss ladbar sein und einen handler exportieren.
function testEveryMappedFunctionLoads() {
  for (const fnName of new Set(Object.values(API_ROUTES))) {
    assert.equal(typeof loadHandler(fnName), 'function', 'Handler nicht ladbar: ' + fnName);
  }
}

// Path-Traversal ueber den /.netlify/functions/:name Fallback muss ins Leere laufen.
function testHandlerLoaderRejectsTraversal() {
  for (const evil of ['../../.env', '../_lib/tenant', 'a/b', '..', 'x.js']) {
    assert.equal(loadHandler(evil), null, 'Traversal nicht blockiert: ' + evil);
  }
}

// .env darf NICHT ueber die statischen Routen erreichbar sein.
function testNoSecretsExposedStatically() {
  for (const file of Object.values(STATIC_PAGES)) {
    assert.ok(/\.html$/.test(file), 'Nur HTML-Seiten ausliefern, gefunden: ' + file);
  }
  const served = new Set(Object.values(STATIC_PAGES));
  assert.ok(!served.has('.env'), '.env darf nie statisch ausgeliefert werden');
}

// Express-Request -> Netlify-Event: die sechs Felder, die die Functions tatsaechlich lesen.
function testEventShape() {
  const req = {
    method: 'post',
    path: '/api/send-link',
    originalUrl: '/api/send-link?a=1&b=2',
    headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
    query: { a: '1', b: '2' },
    body: Buffer.from('{"tenant_id":"t1"}', 'utf8'),
  };
  const ev = toNetlifyEvent(req);
  assert.equal(ev.httpMethod, 'POST', 'Methode muss gross geschrieben sein (Functions vergleichen mit POST)');
  assert.equal(ev.path, '/api/send-link');
  assert.equal(ev.body, '{"tenant_id":"t1"}');
  assert.equal(ev.isBase64Encoded, false);
  assert.equal(ev.rawQuery, 'a=1&b=2');
  assert.deepEqual(ev.queryStringParameters, { a: '1', b: '2' });
  assert.equal(ev.headers.authorization, 'Bearer x');

  // GET ohne Body -> body muss null sein, nicht "" (readBody wertet das aus).
  const getEv = toNetlifyEvent({
    method: 'GET', path: '/api/analytics', originalUrl: '/api/analytics',
    headers: {}, query: {}, body: Buffer.alloc(0),
  });
  assert.equal(getEv.body, null);
  assert.equal(getEv.rawQuery, '');
}

// readBody der echten tenant.js muss den vom Adapter erzeugten Body verstehen.
function testAdapterBodyIsReadableByFunctions() {
  const { readBody } = require('../netlify/functions/_lib/tenant');
  const ev = toNetlifyEvent({
    method: 'POST', path: '/api/send-link', originalUrl: '/api/send-link',
    headers: {}, query: {}, body: Buffer.from('{"phone_number":"+4915112345678"}', 'utf8'),
  });
  assert.deepEqual(readBody(ev), { phone_number: '+4915112345678' });
}

function run() {
  testAllNetlifyRoutesAreMapped();
  testEveryMappedFunctionLoads();
  testHandlerLoaderRejectsTraversal();
  testNoSecretsExposedStatically();
  testEventShape();
  testAdapterBodyIsReadableByFunctions();
  console.log('server-adapter.test.js: all assertions passed');
  // Listener aus dem Require beenden, damit der Testlauf sauber endet.
  if (app && app.listening) app.close();
  process.exit(0);
}

run();
