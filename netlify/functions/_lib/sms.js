// Geteilter SMS-Versand (seven.io) inkl. Protokollierung in sms_logs und Kostenzaehler.
// Wird von neuen Functions genutzt (z. B. book-appointment). Die bestehende
// send-booking-link.js behaelt ihren eigenen, bereits erprobten Versandpfad.

const { envValue, insertRow, getTenantSettings, saveTenantSettings } = require('./tenant');

const DEFAULT_SMS_FROM = 'Tawano';

// Sendet eine SMS ueber seven.io. Gibt strukturiertes Ergebnis zurueck.
async function sendViaSeven({ to, message, smsSender }) {
  const apiKey = envValue('SEVEN_API_KEY').trim();
  if (!apiKey) {
    return { sent: false, provider: 'seven', message: 'SEVEN_API_KEY nicht gesetzt' };
  }

  const smsFrom = String(smsSender || '').trim() || envValue('SMS_FROM').trim() || DEFAULT_SMS_FROM;
  const body = { to, text: message, json: 1 };
  if (smsFrom) body.from = smsFrom;

  const response = await fetch('https://gateway.seven.io/api/sms', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify(body),
  });

  const raw = String(await response.text() || '').trim();
  if (!response.ok) {
    throw new Error('seven.io failed: HTTP ' + response.status + ' ' + raw);
  }

  let data = null;
  try { data = JSON.parse(raw); } catch (_) { data = null; }

  let code;
  let isSuccess = false;
  let detail = '';
  if (data && typeof data === 'object') {
    code = Number(data.success !== undefined ? data.success : data.code);
    const msgs = Array.isArray(data.messages) ? data.messages : [];
    if (msgs.length) {
      const okMsg = msgs.find((m) => m && (m.success === true || Number(m.error) === 100));
      isSuccess = code === 100 && Boolean(okMsg);
      if (!isSuccess) {
        const bad = msgs.find((m) => m && (m.error_text || m.error)) || {};
        detail = bad.error_text ? (' (' + bad.error_text + ', Code ' + bad.error + ')') : '';
      }
    } else {
      isSuccess = code === 100;
    }
  } else {
    code = Number(raw.split(/[\s\n]/)[0]);
    isSuccess = code === 100;
  }

  return {
    sent: isSuccess,
    provider: 'seven',
    message: isSuccess ? 'SMS ausgeloest' : ('SMS fehlgeschlagen: seven.io Code ' + (Number.isFinite(code) ? code : raw) + detail),
    response: data || raw,
    responseCode: code,
  };
}

// Sendet + protokolliert + zaehlt Kosten. Logging/Zaehler duerfen den Versand nie sprengen.
async function deliverSms(payload) {
  const result = await sendViaSeven({
    to: payload.to,
    message: payload.message,
    smsSender: payload.sms_sender,
  });

  try {
    const firstMsg = result.response && Array.isArray(result.response.messages) ? result.response.messages[0] : null;
    const baseLog = {
      tenant_id: payload.tenant_id || null,
      phone_number: payload.to,
      customer_name: payload.customer_name || null,
      booking_link_url: payload.booking_link_url || null,
      message: payload.message,
      provider: result.provider || 'unknown',
      provider_message_id: (firstMsg && firstMsg.id) || null,
      // Code 100 / HTTP 200 = nur ANGENOMMEN. Zustellung (DELIVERED) kommt spaeter per DLR-Webhook.
      status: result.sent ? 'ACCEPTED' : 'FAILED',
    };
    try {
      await insertRow('sms_logs', Object.assign({}, baseLog, {
        called_number: payload.called_number || null,
        retell_agent_id: payload.retell_agent_id || null,
        call_id: payload.call_id || null,
      }), { serviceRole: true });
    } catch (_) {
      await insertRow('sms_logs', baseLog, { serviceRole: true });
    }
  } catch (_) { /* Logging optional */ }

  if (result.sent && payload.tenant_id) {
    try {
      const cur = await getTenantSettings(payload.tenant_id, { serviceRole: true });
      const firstMsg2 = result.response && Array.isArray(result.response.messages) ? result.response.messages[0] : null;
      const price = (firstMsg2 && Number(firstMsg2.price)) || 0;
      await saveTenantSettings(payload.tenant_id, {
        sms_sent_count: (Number(cur.sms_sent_count) || 0) + 1,
        sms_cost_total: (Number(cur.sms_cost_total) || 0) + price,
      }, { serviceRole: true });
    } catch (_) { /* Zaehler optional */ }
  }

  return result;
}

module.exports = {
  DEFAULT_SMS_FROM,
  sendViaSeven,
  deliverSms,
};
