const { envValue, listRows, json, readBody } = require('./_lib/tenant');

function checkAdmin(event, body) {
  const adminSecret = envValue('ADMIN_SECRET').trim();
  const provided = String((event.headers && (event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'])) || (body && body.admin_secret) || '').trim();
  return Boolean(adminSecret) && provided === adminSecret;
}

// Erzeugt fuer den Admin eine gueltige Kunden-Session, um dessen Dashboard live anzusehen.
exports.handler = async (event) => {
  if ((event.httpMethod || 'GET').toUpperCase() !== 'POST') return json(405, { ok: false, message: 'Method Not Allowed' });
  const body = readBody(event) || {};
  if (!checkAdmin(event, body)) return json(401, { ok: false, message: 'Nicht autorisiert.' });

  const tenantId = String(body.tenant_id || '').trim();
  if (!tenantId) return json(400, { ok: false, message: 'tenant_id fehlt.' });

  const url = envValue('SUPABASE_URL').replace(/\/$/, '');
  const serviceKey = envValue('SUPABASE_SERVICE_ROLE_KEY').trim();
  if (!url || !serviceKey) return json(500, { ok: false, message: 'SUPABASE_SERVICE_ROLE_KEY fehlt.' });
  const adminHeaders = { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: 'Bearer ' + serviceKey };

  // E-Mail des Kunden-Logins ermitteln - ueber die Mitgliedschaft ODER die alte env-Anbindung (z. B. Beauty World).
  let email = null;
  try {
    const rows = await listRows('tenant_memberships', { select: 'user_id', tenant_id: 'eq.' + tenantId, order: 'is_default.desc', limit: 1 }, { serviceRole: true });
    const userId = rows[0] && rows[0].user_id;
    if (userId) {
      const uRes = await fetch(url + '/auth/v1/admin/users/' + userId, { headers: adminHeaders });
      const uData = await uRes.json().catch(() => ({}));
      email = uData.email || (uData.user && uData.user.email) || null;
    }
  } catch (_) { email = null; }
  if (!email) {
    try {
      const bindings = JSON.parse(envValue('AUTH_EMAIL_BINDINGS') || '{}');
      Object.keys(bindings).forEach((mail) => {
        if (!email && bindings[mail] && bindings[mail].tenantId === tenantId) email = mail;
      });
    } catch (_) { /* ignore */ }
  }
  if (!email) return json(404, { ok: false, message: 'Fuer diesen Kunden ist kein Login hinterlegt.' });

  // 3) Einmal-Token generieren und in eine Session einloesen.
  try {
    const genRes = await fetch(url + '/auth/v1/admin/generate_link', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ type: 'magiclink', email }),
    });
    const gen = await genRes.json().catch(() => ({}));
    const hashed = gen.hashed_token || (gen.properties && gen.properties.hashed_token);
    if (!hashed) return json(502, { ok: false, message: 'Session konnte nicht erzeugt werden.', detail: JSON.stringify(gen).slice(0, 200) });

    const verRes = await fetch(url + '/auth/v1/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: serviceKey },
      body: JSON.stringify({ type: 'magiclink', token_hash: hashed }),
    });
    const ver = await verRes.json().catch(() => ({}));
    const accessToken = ver.access_token;
    if (!accessToken) return json(502, { ok: false, message: 'Login-Token konnte nicht erzeugt werden.', detail: JSON.stringify(ver).slice(0, 200) });

    return json(200, { ok: true, accessToken, user: { email, id: (ver.user && ver.user.id) || null } });
  } catch (e) {
    return json(502, { ok: false, message: 'Impersonation fehlgeschlagen: ' + String(e && e.message ? e.message : e) });
  }
};
