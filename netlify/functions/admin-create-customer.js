const { envValue, insertRow, json, readBody } = require('./_lib/tenant');

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
  const fromNumber = String(body.from_number || body.phone_number || '').trim();
  const bookingLink = String(body.booking_link || '').trim();
  if (!email || !password || !name || !agentId) {
    return json(400, { ok: false, message: 'email, password, name und agent_id sind erforderlich.' });
  }
  if (password.length < 8) {
    return json(400, { ok: false, message: 'Passwort muss mindestens 8 Zeichen haben.' });
  }

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
  const tenantId = 'tenant_' + (slugify(name) || String(Date.now()));
  const slug = slugify(name) || tenantId;
  try {
    await insertRow('tenants', {
      id: tenantId,
      slug: slug,
      name: name,
      is_active: true,
      retell_agent_id: agentId,
      retell_agent_alias: 'beautyworlds-demo',
      retell_from_number: fromNumber || null,
      booking_link_url: bookingLink || null,
    }, { serviceRole: true });
  } catch (e) {
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
    return json(500, { ok: false, message: 'Verknuepfung fehlgeschlagen: ' + String(e && e.message ? e.message : e), tenant_id: tenantId, user_id: userId });
  }

  return json(200, {
    ok: true,
    message: 'Kunde angelegt. Er kann sich jetzt mit E-Mail und Passwort einloggen.',
    email: email,
    tenant_id: tenantId,
    agent_id: agentId,
  });
};
