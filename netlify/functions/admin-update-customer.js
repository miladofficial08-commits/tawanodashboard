const { envValue, patchRows, json, readBody, saveTenantSettings } = require('./_lib/tenant');
const { getTenantById, tenantProvider, tenantAgentId } = require('./_lib/tenant');
const { validateAssignment } = require('./_lib/agent-assignment');

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
  try {
    const current = await getTenantById(tenantId, { serviceRole: true });
    if (!current) return json(404, { ok: false, message: 'Kunde nicht gefunden.' });
    const next = Object.assign({}, current, body);
    const provider = String(next.provider || 'retell').trim().toLowerCase();
    const agentId = String(provider === 'elevenlabs' ? next.elevenlabs_agent_id || '' : next.retell_agent_id || '').trim();
    if (provider !== tenantProvider(current) || agentId !== tenantAgentId(current)) await validateAssignment(provider, agentId, tenantId);
  } catch (error) { return json(error.status || 502, { ok: false, message: error.message }); }

  // 1) Echte Tenant-Spalten (Name, Agent, Nummer, Buchungslink, SMS-Absender) direkt aktualisieren.
  const patch = {};
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.provider !== undefined) {
    patch.provider = String(body.provider).trim().toLowerCase() === 'elevenlabs' ? 'elevenlabs' : 'retell';
  }
  if (body.retell_agent_id !== undefined) patch.retell_agent_id = String(body.retell_agent_id).trim() || null;
  if (body.elevenlabs_agent_id !== undefined) patch.elevenlabs_agent_id = String(body.elevenlabs_agent_id).trim() || null;
  if (body.retell_from_number !== undefined) patch.retell_from_number = String(body.retell_from_number).trim() || null;
  if (body.booking_link_url !== undefined) patch.booking_link_url = String(body.booking_link_url).trim() || null;
  if (body.sms_sender !== undefined) patch.sms_sender = String(body.sms_sender).trim() || null;
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);

  // 2) Einstellungen (Minuten, SMS) als Snapshot speichern - kein DB-Umbau noetig.
  const settings = {};
  if (body.minutes_budget !== undefined) {
    if (!Number.isFinite(Number(body.minutes_budget)) || Number(body.minutes_budget)<0 || Number(body.minutes_budget)>1000000) return json(400,{ok:false,message:'Bitte ein Minutenbudget zwischen 0 und 1.000.000 eingeben.'});
    settings.minutes_budget = Number(body.minutes_budget);
  }
  if (body.sms_enabled !== undefined) settings.sms_enabled = Boolean(body.sms_enabled);
  if (body.sms_template !== undefined) settings.sms_template = String(body.sms_template);
  if (body.detailed_analysis !== undefined) settings.detailed_analysis = Boolean(body.detailed_analysis);
  if (body.append_lead_params !== undefined) settings.append_lead_params = Boolean(body.append_lead_params);
  // Terminbuchung (Cal.com) - komplett ueber das Admin-Terminal steuerbar.
  if (body.booking_enabled !== undefined) settings.booking_enabled = Boolean(body.booking_enabled);
  if (body.sms_appointment_template !== undefined) settings.sms_appointment_template = String(body.sms_appointment_template);
  if (body.calcom_api_key !== undefined) settings.calcom_api_key = String(body.calcom_api_key).trim();
  if (body.calcom_event_type_id !== undefined) settings.calcom_event_type_id = String(body.calcom_event_type_id).trim();

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
