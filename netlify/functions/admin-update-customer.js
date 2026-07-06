const { envValue, patchRows, json, readBody, saveTenantSettings } = require('./_lib/tenant');

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

  // 1) Echte Tenant-Spalten (Name, Agent, Nummer, Buchungslink) direkt aktualisieren.
  const patch = {};
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.retell_agent_id !== undefined) patch.retell_agent_id = String(body.retell_agent_id).trim() || null;
  if (body.retell_from_number !== undefined) patch.retell_from_number = String(body.retell_from_number).trim() || null;
  if (body.booking_link_url !== undefined) patch.booking_link_url = String(body.booking_link_url).trim() || null;
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);

  // 2) Einstellungen (Minuten, SMS) als Snapshot speichern - kein DB-Umbau noetig.
  const settings = {};
  if (body.minutes_budget !== undefined) settings.minutes_budget = Number(body.minutes_budget) || 0;
  if (body.sms_enabled !== undefined) settings.sms_enabled = Boolean(body.sms_enabled);
  if (body.sms_template !== undefined) settings.sms_template = String(body.sms_template);

  try {
    if (Object.keys(patch).length) {
      const rows = await patchRows('tenants', { id: 'eq.' + tenantId }, patch, { serviceRole: true });
      if (!rows.length) return json(404, { ok: false, message: 'Kunde nicht gefunden.' });
    }
    if (Object.keys(settings).length) {
      await saveTenantSettings(tenantId, settings, { serviceRole: true });
    }
    return json(200, { ok: true, message: 'Gespeichert.' });
  } catch (e) {
    return json(500, { ok: false, message: 'Speichern fehlgeschlagen: ' + String(e && e.message ? e.message : e) });
  }
};
