/**
 * Admin: Test-SMS fuer einen Tenant senden.
 * POST /api/admin/test-sms
 * Body: { admin_secret, tenant_id, to_number }
 *
 * Sendet die aktuell im Admin gespeicherte SMS-Vorlage des Tenants
 * an eine Testnummer – ohne Retell, ohne echten Anruf.
 */
const { envValue, json, readBody, getTenantById, getTenantSettings } = require('./_lib/tenant');

function checkAdmin(event, body) {
  const adminSecret = envValue('ADMIN_SECRET').trim();
  const provided = String(
    (event.headers && (event.headers['x-admin-secret'] || event.headers['X-Admin-Secret']))
    || (body && body.admin_secret)
    || ''
  ).trim();
  return Boolean(adminSecret) && provided === adminSecret;
}

const FEEDBACK_BASE_URL = 'https://tawanodashboard.netlify.app/feedback';

async function sendViaSeven(to, messageText, smsSender) {
  const apiKey = envValue('SEVEN_API_KEY').trim();
  if (!apiKey) return { sent: false, reason: 'SEVEN_API_KEY fehlt' };

  // Absender kommt AUSSCHLIESSLICH aus dem Admin (tenants.sms_sender) - wie im echten Versand.
  const smsFrom = String(smsSender || '').trim();
  const body = { to, text: messageText, json: 1 };
  if (smsFrom) body.from = smsFrom;

  const response = await fetch('https://gateway.seven.io/api/sms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify(body),
  });
  const raw = String(await response.text() || '').trim();
  if (!response.ok) return { sent: false, reason: 'seven.io HTTP ' + response.status };
  let data = null;
  try { data = JSON.parse(raw); } catch (_) { data = null; }
  const code = data ? Number(data.success !== undefined ? data.success : data.code) : Number(raw.split(/\s/)[0]);
  return { sent: code === 100, code, raw: data || raw };
}

exports.handler = async (event) => {
  if ((event.httpMethod || 'GET').toUpperCase() !== 'POST')
    return json(405, { ok: false, message: 'Method Not Allowed' });

  const body = (function () {
    try { return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) || {}; } catch (_) { return {}; }
  })();

  if (!checkAdmin(event, body))
    return json(401, { ok: false, message: 'Nicht autorisiert.' });

  const tenantId = String(body.tenant_id || '').trim();
  const toNumber = String(body.to_number || '').trim();
  if (!tenantId) return json(400, { ok: false, message: 'tenant_id fehlt.' });
  if (!toNumber) return json(400, { ok: false, message: 'to_number fehlt.' });

  const tenant = await getTenantById(tenantId, { serviceRole: true });
  if (!tenant) return json(404, { ok: false, message: 'Tenant nicht gefunden: ' + tenantId });

  const settings = await getTenantSettings(tenantId, { serviceRole: true });
  if (settings.sms_enabled === false)
    return json(200, { ok: false, message: 'SMS ist fuer diesen Kunden deaktiviert.' });

  // EXAKT wie der echte Versand (send-booking-link): ohne Vorlage oder Absender wird
  // NICHT gesendet - damit der Test niemals etwas anderes zeigt als die Realitaet.
  const template = String(settings.sms_template || '').trim();
  if (!template) {
    return json(400, { ok: false, message: 'Keine SMS-Vorlage gespeichert. Bitte im Admin die SMS-Nachricht eintragen und speichern.' });
  }
  const smsSender = String(tenant.sms_sender || '').trim();
  if (!smsSender) {
    return json(400, { ok: false, message: 'Kein SMS-Absender gespeichert. Bitte im Admin den SMS-Absender eintragen und speichern.' });
  }
  const bookingLink = String(tenant.booking_link_url || '').trim();
  const feedbackLink = FEEDBACK_BASE_URL ? FEEDBACK_BASE_URL + '?p=' + encodeURIComponent(toNumber) + '&t=' + encodeURIComponent(tenantId) : '';
  const message = String(template)
    .replaceAll('{booking_link}', bookingLink)
    .replaceAll('{feedback_link}', feedbackLink)
    .replaceAll('{customer_name}', 'Testperson');

  const result = await sendViaSeven(toNumber, message, smsSender);
  return json(result.sent ? 200 : 502, {
    ok: result.sent,
    tenant: { id: tenant.id, name: tenant.name },
    to: toNumber,
    message_preview: message,
    sms: result,
  });
};
