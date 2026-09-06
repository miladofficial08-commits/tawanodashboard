const assert = require('node:assert/strict');
process.env.SUPABASE_URL = 'https://project.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-key';
const tenant = require('../netlify/functions/_lib/tenant');
tenant.fetchSupabaseUser = async (token) => {
  if (token !== 'kunden-token') { const error = new Error('bad token'); error.status = 401; throw error; }
  return { id: 'user-1', email: 'kunde@example.de' };
};
const handler = require('../netlify/functions/client-auth-password').handler;

const calls = [];
let currentPassword = 'altesPasswort1';
global.fetch = async (url, init) => {
  const body = init && init.body ? JSON.parse(init.body) : {};
  calls.push({ url, method: init.method, auth: (init.headers || {}).Authorization, body });
  if (url.indexOf('grant_type=password') !== -1) {
    if (body.password !== currentPassword) return { ok: false, status: 400, json: async () => ({ error_description: 'Invalid login credentials' }) };
    return { ok: true, status: 200, json: async () => ({ access_token: 'frischer-token', refresh_token: 'refresh' }) };
  }
  return { ok: true, status: 200, json: async () => ({ id: 'user-1' }) };
};

const post = (body, token) => handler({
  httpMethod: 'POST',
  headers: token ? { authorization: 'Bearer ' + token } : {},
  body: JSON.stringify(body),
});

(async () => {
  assert.equal((await post({ current_password: 'a', new_password: 'b' })).statusCode, 401, 'ohne Anmeldung kein Passwortwechsel');
  assert.equal((await handler({ httpMethod: 'GET', headers: { authorization: 'Bearer kunden-token' } })).statusCode, 405);
  assert.equal((await post({ current_password: 'altesPasswort1', new_password: 'kurz' }, 'kunden-token')).statusCode, 400, 'zu kurz');
  assert.equal((await post({ current_password: 'altesPasswort1', new_password: 'altesPasswort1' }, 'kunden-token')).statusCode, 400, 'unverändert');
  assert.equal((await post({ current_password: '', new_password: 'neuesPasswort1' }, 'kunden-token')).statusCode, 400, 'aktuelles Passwort fehlt');
  assert.equal((await post({ current_password: 'altesPasswort1', new_password: 'neuesPasswort1' }, 'fremdes-token')).statusCode, 401, 'fremder Token');

  const wrong = await post({ current_password: 'falsch123', new_password: 'neuesPasswort1' }, 'kunden-token');
  assert.equal(wrong.statusCode, 401);
  assert.match(JSON.parse(wrong.body).message, /aktuelle Passwort stimmt nicht/);

  calls.length = 0;
  const ok = await post({ current_password: 'altesPasswort1', new_password: 'neuesPasswort1' }, 'kunden-token');
  assert.equal(ok.statusCode, 200);
  const data = JSON.parse(ok.body);
  assert.equal(data.ok, true);
  assert.equal(data.accessToken, 'frischer-token', 'Sitzung bleibt gültig');
  assert.equal(calls.length, 2, 'erst prüfen, dann setzen');
  assert.equal(calls[1].method, 'PUT');
  assert.equal(calls[1].auth, 'Bearer frischer-token', 'das neue Passwort wird nur mit dem frisch geprüften Token gesetzt');
  assert.equal(calls[1].body.password, 'neuesPasswort1');

  console.log('Password change passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
