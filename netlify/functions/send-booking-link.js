const fs = require('node:fs');
const path = require('node:path');
const { envValue, insertRow, isMissingSchemaError, json, readBody, resolveTenantFromToolBody } = require('./_lib/tenant');

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

  const smsFrom = envValue('SMS_FROM').trim();
  const body = {
    to: payload.to,
    text: payload.message,
  };
  if (smsFrom) body.from = smsFrom;

  const response = await fetch('https://gateway.seven.io/api/sms', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error('seven.io failed: HTTP ' + response.status + ' ' + raw);
  }

  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = {}; }

  // seven.io: 100 = success, anything else = error
  const code = typeof data === 'number' ? data : (data && typeof data.success !== 'undefined' ? Number(data.success) : -999);
  const isSuccess = code === 100;

  return {
    sent: isSuccess,
    provider: 'seven',
    message: isSuccess ? 'SMS ausgeloest' : 'SMS fehlgeschlagen: Code ' + code,
    response: data,
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

  const body = readBody(event);
  if (!body) return json(400, { ok: false, message: 'Invalid JSON body' });

  const phone = String(body.phone_number || body.phoneNumber || body.phone || '').trim();
  if (!phone) return json(400, { ok: false, message: 'phone_number fehlt' });

  const tenantContext = await resolveTenantFromToolBody(body);
  const tenant = tenantContext.tenant;

  const bookingLink = String(body.booking_link || body.bookingLink || tenant.booking_link_url || envValue('BOOKING_LINK_URL') || '').trim();
  const name = String(body.customer_name || body.customerName || '').trim();

  const template = envValue('SMS_AFTER_CALL_TEMPLATE').trim() || 'Vielen Dank fuer Ihr Gespraech mit Beautyworld! Ihren Termin koennen Sie hier buchen: {booking_link} – Ihr Team von Beautyworld';
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
      await insertRow('sms_logs', {
        tenant_id: tenant.id,
        phone_number: phone,
        customer_name: name || null,
        booking_link_url: bookingLink || null,
        message,
        provider: result.provider || 'unknown',
        provider_message_id: result.response && (result.response.id || result.response.message_id) || null,
        status: result.sent ? 'sent' : 'queued',
      }, { serviceRole: true });
    } catch (error) {
      if (!isMissingSchemaError(error)) throw error;
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
