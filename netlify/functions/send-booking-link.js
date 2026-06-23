const fs = require('node:fs');
const path = require('node:path');
const { envValue, insertRow, isMissingSchemaError, json, readBody, resolveTenantFromToolBody } = require('./_lib/tenant');

// ============================================================
//  HIER ANPASSEN — Buchungslink & SMS-Text
//  Danach speichern und pushen:
//    git add . && git commit -m "sms anpassen" && git push
// ============================================================
// 1) Dein Standard-Buchungslink (wird in die SMS eingesetzt, ersetzt {booking_link}):
const DEFAULT_BOOKING_LINK = 'https://www.treatwell.de/ort/beauty-world-1-og-duesseldorf-arcaden/';

// 2) Der SMS-Text. Platzhalter: {booking_link} = Link, {customer_name} = Name des Kunden.
const DEFAULT_SMS_TEMPLATE = 'Vielen Dank fuer Ihren Anruf bei Beauty World Duesseldorf Arcaden.\n\nTermin online buchen:\n{booking_link}\n\nWie fanden Sie das Gespraech mit Lisa? Antworten Sie einfach mit 1 bis 5. 5 bedeutet sehr gut.\n\nIhr Beauty World Team';

// 3) Absender. ENTWEDER ein Name (max. 11 Zeichen, z. B. "Beautyworld" oder "Lisa")
//    ODER eine echte seven.io-Nummer (z. B. "+49...").
//    WICHTIG: Ein Name sieht schoen aus, kann aber KEINE Antworten empfangen.
//    Fuer Feedback per 1-5 Antwort MUSS hier eine echte Nummer stehen.
const DEFAULT_SMS_FROM = 'Beautyworld';
// ============================================================

// Prueft, ob ein Wert eine echte Telefonnummer ist – verwirft KI-Platzhalter wie "<EINGEHENDE_NUMMER>".
function isRealPhone(value) {
  const s = String(value || '').trim();
  if (!s || /[<>{}]/.test(s)) return false;
  return s.replace(/\D/g, '').length >= 7;
}

function isAuthorized(event) {
  const expected = envValue('RETELL_TOOL_SECRET').trim();
  if (!expected) return true;
  const headers = event.headers || {};
  const incoming = String(headers['x-retell-tool-secret'] || headers['X-Retell-Tool-Secret'] || '').trim();
  return incoming && incoming === expected;
}

async function sendViaWebhook(payload) {
  const webhookUrl = envValue('SMS_WEBHOOK_URL').trim();
  if (!webhookUrl) {
    return { sent: false, provider: 'none', message: 'SMS_WEBHOOK_URL nicht gesetzt' };
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const txt = await response.text();
    throw new Error('SMS webhook failed: HTTP ' + response.status + ' ' + txt);
  }

  return { sent: true, provider: 'webhook', message: 'SMS ausgeloest' };
}

async function sendViaSeven(payload) {
  const apiKey = envValue('SEVEN_API_KEY').trim();
  if (!apiKey) {
    return { sent: false, provider: 'seven', message: 'SEVEN_API_KEY nicht gesetzt' };
  }

  const smsFrom = envValue('SMS_FROM').trim() || DEFAULT_SMS_FROM;
  const body = {
    to: payload.to,
    text: payload.message,
    json: 1,
  };
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

  // seven.io antwortet mit json=1 als Objekt {"success":"100","messages":[{"success":true,...}]}
  // ODER (ohne json) als reiner Text "100". Beides robust auswerten.
  // Wichtig: success:100 heisst nur "Anfrage ok" – ob die EINZELNE SMS rausging, steht in messages[].success.
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

exports.handler = async (event) => {
  if ((event.httpMethod || 'GET').toUpperCase() !== 'POST') {
    return json(405, { ok: false, message: 'Method Not Allowed' });
  }
  if (!isAuthorized(event)) {
    return json(401, { ok: false, message: 'Unauthorized tool call' });
  }

  const raw = readBody(event);
  if (!raw) return json(400, { ok: false, message: 'Invalid JSON body' });

  // Retell schickt je nach Einstellung entweder { call, args: {...} } ODER die Felder direkt.
  // Beides unterstuetzen: Argumente aus "args" mit der obersten Ebene zusammenfuehren.
  const args = (raw.args && typeof raw.args === 'object') ? raw.args
    : ((raw.arguments && typeof raw.arguments === 'object') ? raw.arguments : {});
  const callInfo = (raw.call && typeof raw.call === 'object') ? raw.call : {};
  const body = Object.assign({}, raw, args);
  if (!body.call_id && callInfo.call_id) body.call_id = callInfo.call_id;
  if (!body.agent_id && callInfo.agent_id) body.agent_id = callInfo.agent_id;

  // Nummer aus dem Call (eingehend = Anrufer, ausgehend = angerufene Nummer)
  const callerFrom = (c) => {
    if (!c) return '';
    const dir = String(c.direction || '').toLowerCase();
    return String((dir === 'outbound' ? c.to_number : c.from_number) || c.from_number || c.to_number || '').trim();
  };

  // Telefonnummer ermitteln. Die KI schickt manchmal einen Platzhalter wie
  // "<EINGEHENDE_NUMMER>" – solche Werte verwerfen und die echte Anrufer-Nummer nehmen.
  let phone = String(body.phone_number || body.phoneNumber || body.phone || '').trim();
  if (!isRealPhone(phone)) phone = callerFrom(callInfo);

  const tenantContext = await resolveTenantFromToolBody(body);
  const tenant = tenantContext.tenant;

  // Letzter Versuch: Anrufer-Nummer aus dem von Retell nachgeladenen Call holen.
  if (!isRealPhone(phone)) phone = callerFrom(tenantContext.call);
  if (!isRealPhone(phone)) {
    return json(400, { ok: false, message: 'Keine gueltige Telefonnummer gefunden. In Retell muss bei dieser Funktion "Payload: args only" AUS sein, damit die Anrufer-Nummer mitgesendet wird.' });
  }

  const bookingLink = String(body.booking_link || body.bookingLink || tenant.booking_link_url || envValue('BOOKING_LINK_URL') || DEFAULT_BOOKING_LINK || '').trim();
  const name = String(body.customer_name || body.customerName || '').trim();

  const template = envValue('SMS_AFTER_CALL_TEMPLATE').trim() || DEFAULT_SMS_TEMPLATE;
  let message = String(body.message || template)
    .replace('{booking_link}', bookingLink || '')
    .replace('{customer_name}', name || '');
  // If booking link exists but template didn't contain the placeholder, append it
  if (bookingLink && !message.includes(bookingLink)) {
    message = message.trimEnd() + ' Hier buchen: ' + bookingLink;
  }

  const payload = {
    type: 'send_booking_link',
    tenant_id: tenant.id,
    to: phone,
    customer_name: name,
    booking_link: bookingLink,
    message,
    source: 'retell_tool',
    created_at: new Date().toISOString(),
  };

  try {
    let result;
    const hasSeven = envValue('SEVEN_API_KEY').trim() !== '';
    if (hasSeven) {
      result = await sendViaSeven(payload);
    } else {
      result = await sendViaWebhook(payload);
    }
    try {
      const firstMsg = result.response && Array.isArray(result.response.messages) ? result.response.messages[0] : null;
      await insertRow('sms_logs', {
        tenant_id: tenant.id,
        phone_number: phone,
        customer_name: name || null,
        booking_link_url: bookingLink || null,
        message,
        provider: result.provider || 'unknown',
        provider_message_id: (firstMsg && firstMsg.id) || (result.response && (result.response.id || result.response.message_id)) || null,
        status: result.sent ? 'sent' : 'queued',
      }, { serviceRole: true });
    } catch (error) {
      // Protokollierung in sms_logs ist optional (z. B. RLS-Policy oder fehlende Tabelle).
      // Ein Fehler hier darf den eigentlichen SMS-Versand NIEMALS fehlschlagen lassen.
    }
    return json(result.sent ? 200 : 502, {
      ok: result.sent,
      status: result.sent ? 'queued' : 'failed',
      tenant,
      sms: result,
      to: phone,
      booking_link: bookingLink || null,
      message,
    });
  } catch (error) {
    return json(502, {
      ok: false,
      message: 'SMS konnte nicht ausgeloest werden',
      detail: String(error && error.message ? error.message : error),
      to: phone,
      booking_link: bookingLink || null,
    });
  }
};
