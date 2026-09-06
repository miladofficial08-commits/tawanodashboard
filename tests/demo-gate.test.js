// Das Beispiel-Dashboard darf nur mit Zugangswort erreichbar sein - weder ueber
// /demo noch ueber ?demo=1. Der echte Kunden-Login bleibt frei zugaenglich.
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.DEMO_PASSWORD = 'test-zugang-123';
const { app } = require('../server');

function request(path, options) {
  const opts = options || {};
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, path,
      method: opts.method || 'GET',
      headers: Object.assign({}, opts.cookie ? { cookie: opts.cookie } : {},
        opts.body ? { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(opts.body) } : {}),
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

const server = app.listen(0);
(async () => {
  const gate = await request('/demo');
  assert.match(gate.body, /Zugangswort/, 'ohne Cookie kommt die Passwortseite');
  assert.doesNotMatch(gate.body, /dashboard-screen/, 'kein Dashboard ohne Zugangswort');

  const direct = await request('/?demo=1');
  assert.match(direct.body, /Zugangswort/, 'auch der direkte Parameter ist gesperrt');
  assert.doesNotMatch(direct.body, /dashboard-screen/);

  const login = await request('/', { method: 'GET' });
  assert.match(login.body, /dashboard-screen/, 'der echte Kunden-Login bleibt frei erreichbar');

  const wrong = await request('/demo/login', { method: 'POST', body: 'password=falsch' });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers['set-cookie'], undefined, 'falsches Passwort setzt keinen Cookie');

  const ok = await request('/demo/login', { method: 'POST', body: 'password=test-zugang-123' });
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.location, '/?demo=1');
  const cookie = String((ok.headers['set-cookie'] || [''])[0]);
  assert.match(cookie, /HttpOnly/i, 'Cookie ist nicht per JavaScript lesbar');
  const value = cookie.split(';')[0];

  const allowed = await request('/?demo=1', { cookie: value });
  assert.match(allowed.body, /dashboard-screen/, 'mit Zugangswort ist das Beispiel-Dashboard da');

  for (const forged of ['tawano_demo=99999999999999.deadbeef', 'tawano_demo=1000.' + value.split('.')[1], 'tawano_demo=x']) {
    const bad = await request('/?demo=1', { cookie: forged });
    assert.doesNotMatch(bad.body, /dashboard-screen/, 'gefälschter oder abgelaufener Cookie: ' + forged);
  }

  console.log('Demo gate passed');
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
