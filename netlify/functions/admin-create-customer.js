const { envValue, insertRow, json, readBody } = require('./_lib/tenant');
const { randomUUID } = require('node:crypto');
const { validateAssignment } = require('./_lib/agent-assignment');

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

exports.handler = async (event) => {
  if ((event.httpMethod || 'GET').toUpperCase() !== 'POST') {
    return json(405, { ok: false, message: 'Method Not Allowed' });
  }

  const body = readBody(event) || {};
  const adminSecret = envValue('ADMIN_SECRET').trim();
  const provided = String((event.headers && (event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'])) || body.admin_secret || '').trim();
  if (!adminSecret || provided !== adminSecret) {
    return json(401, { ok: false, message: 'Nicht autorisiert. ADMIN_SECRET fehlt oder ist falsch.' });
  }

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const name = String(body.name || '').trim();
  const agentId = String(body.agent_id || body.agentId || '').trim();
  const providerRaw = String(body.provider || 'retell').trim().toLowerCase();
  const provider = providerRaw;
  const fromNumber = String(body.from_number || body.phone_number || '').trim();
  const bookingLink = String(body.booking_link || '').trim();
  if (!email || !password || !name || !agentId) {
    return json(400, { ok: false, message: 'email, password, name und agent_id sind erforderlich.' });
  }
  if (password.length < 8) {
    return json(400, { ok: false, message: 'Passwort muss mindestens 8 Zeichen haben.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { ok: false, message: 'Bitte eine gültige E-Mail eingeben.' });
  if (fromNumber && !/^\+[1-9]\d{6,14}$/.test(fromNumber)) return json(400, { ok: false, message: 'Telefonnummer im internationalen Format eingeben, z. B. +49301234567.' });
  try { await validateAssignment(provider, agentId); }
  catch (error) { return json(error.status || 502, { ok: false, message: error.message }); }

  const url = envValue('SUPABASE_URL').replace(/\/$/, '');
  const serviceKey = envValue('SUPABASE_SERVICE_ROLE_KEY').trim();
  if (!url || !serviceKey) {
    return json(500, { ok: false, message: 'SUPABASE_URL oder SUPABASE_SERVICE_ROLE_KEY fehlt (bitte in Netlify eintragen).' });
  }

  // 1) Supabase-Auth-Nutzer anlegen (Login fuer den Kunden).
  let userId;
  try {
    const res = await fetch(url + '/auth/v1/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: 'Bearer ' + serviceKey },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return json(res.status, { ok: false, message: 'Nutzer konnte nicht angelegt werden: ' + (data.msg || data.message || JSON.stringify(data)) });
    }
    userId = data.id || (data.user && data.user.id);
    if (!userId) return json(500, { ok: false, message: 'Nutzer angelegt, aber keine User-ID erhalten.' });
  } catch (e) {
    return json(502, { ok: false, message: 'Supabase Auth nicht erreichbar: ' + String(e && e.message ? e.message : e) });
  }

  // 2) Tenant (Kunde) mit seinem Voice Agent anlegen.
  const suffix = randomUUID();
  const tenantId = 'tenant_' + suffix;
  const slug = (slugify(name) || 'betrieb') + '-' + suffix;
  async function rollback(includeTenant) {
    const headers = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey };
    const paths = includeTenant ? ['/rest/v1/tenants?id=eq.' + tenantId, '/auth/v1/admin/users/' + userId] : ['/auth/v1/admin/users/' + userId];
    for (const resource of paths) {
      const response = await fetch(url + resource, { method: 'DELETE', headers, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Bereinigung fehlgeschlagen. Administrator muss Konto ' + userId + ' / ' + tenantId + ' prüfen.');
    }
  }
  try {
    await insertRow('tenants', {
      id: tenantId,
      slug: slug,
      name: name,
      is_active: true,
      provider: provider,
      // Agent-ID landet je nach Provider in der passenden Spalte, die andere bleibt leer.
      retell_agent_id: provider === 'retell' ? agentId : null,
      elevenlabs_agent_id: provider === 'elevenlabs' ? agentId : null,
      retell_agent_alias: null,
      retell_from_number: fromNumber || null,
      booking_link_url: bookingLink || null,
    }, { serviceRole: true });
  } catch (e) {
    try { await rollback(false); } catch (cleanup) { return json(500, { ok: false, message: cleanup.message }); }
    return json(500, { ok: false, message: 'Tenant konnte nicht angelegt werden (evtl. Name schon vergeben?): ' + String(e && e.message ? e.message : e), user_id: userId });
  }

  // 3) Login mit dem Tenant verknuepfen (damit der Kunde genau seine Daten sieht).
  try {
    await insertRow('tenant_memberships', {
      tenant_id: tenantId,
      user_id: userId,
      role: 'owner',
      is_default: true,
    }, { serviceRole: true });
  } catch (e) {
    try { await rollback(true); } catch (cleanup) { return json(500, { ok: false, message: cleanup.message }); }
    return json(500, { ok: false, message: 'Verknuepfung fehlgeschlagen: ' + String(e && e.message ? e.message : e), tenant_id: tenantId, user_id: userId });
  }

  return json(200, {
    ok: true,
    message: 'Kunde angelegt. Er kann sich jetzt mit E-Mail und Passwort einloggen.',
    email: email,
    tenant_id: tenantId,
    provider: provider,
    agent_id: agentId,
  });
};
