const { envValue, listRows, json, readBody } = require('./_lib/tenant');

function checkAdmin(event, body) {
  const adminSecret = envValue('ADMIN_SECRET').trim();
  const provided = String((event.headers && (event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'])) || (body && body.admin_secret) || '').trim();
  return Boolean(adminSecret) && provided === adminSecret;
}

exports.handler = async (event) => {
  if ((event.httpMethod || 'GET').toUpperCase() !== 'POST') return json(405, { ok: false, message: 'Method Not Allowed' });
  const body = readBody(event) || {};
  if (!checkAdmin(event, body)) return json(401, { ok: false, message: 'Nicht autorisiert.' });

  const tenantId = String(body.tenant_id || '').trim();
  if (!tenantId) return json(400, { ok: false, message: 'tenant_id fehlt.' });

  const url = envValue('SUPABASE_URL').replace(/\/$/, '');
  const serviceKey = envValue('SUPABASE_SERVICE_ROLE_KEY').trim();
  if (!url || !serviceKey) return json(500, { ok: false, message: 'SUPABASE_SERVICE_ROLE_KEY fehlt.' });
  const h = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey };

  try {
    // 1) Login-Nutzer merken (zum Loeschen aus der Authentifizierung).
    let userIds = [];
    try {
      const members = await listRows('tenant_memberships', { select: 'user_id', tenant_id: 'eq.' + tenantId }, { serviceRole: true });
      userIds = members.map((m) => m.user_id).filter(Boolean);
    } catch (_) { userIds = []; }

    // 2) Tenant loeschen -> per ON DELETE CASCADE fallen Mitgliedschaften, sms_logs,
    //    callback_requests und Einstellungen automatisch weg.
    const delRes = await fetch(url + '/rest/v1/tenants?id=eq.' + encodeURIComponent(tenantId), { method: 'DELETE', headers: Object.assign({ Prefer: 'return=minimal' }, h) });
    if (!delRes.ok && delRes.status !== 404) {
      const t = await delRes.text();
      return json(delRes.status, { ok: false, message: 'Loeschen fehlgeschlagen: ' + t.slice(0, 200) });
    }

    // 3) Zugehoerige Login-Nutzer aus der Authentifizierung entfernen.
    for (const uid of userIds) {
      try { await fetch(url + '/auth/v1/admin/users/' + uid, { method: 'DELETE', headers: h }); } catch (_) { /* best effort */ }
    }

    return json(200, { ok: true, message: 'Kunde geloescht.', tenant_id: tenantId, deleted_users: userIds.length });
  } catch (e) {
    return json(500, { ok: false, message: 'Loeschen fehlgeschlagen: ' + String(e && e.message ? e.message : e) });
  }
};
