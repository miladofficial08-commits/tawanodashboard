const fs = require('node:fs');
const path = require('node:path');
const { insertRow, isMissingSchemaError, json, readBody, resolveTenantFromToolBody, envValue } = require('./_lib/tenant');

function isAuthorized(event) {
  const expected = envValue('RETELL_TOOL_SECRET').trim();
  if (!expected) return true;
  const headers = event.headers || {};
  const incoming = String(headers['x-retell-tool-secret'] || headers['X-Retell-Tool-Secret'] || '').trim();
  return incoming && incoming === expected;
}

function appendLocalCallback(item) {
  const filePath = path.join(process.cwd(), '.callbacks.json');
  let rows = [];
  if (fs.existsSync(filePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      rows = Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      rows = [];
    }
  }
  rows.unshift(item);
  fs.writeFileSync(filePath, JSON.stringify(rows.slice(0, 1000), null, 2), 'utf8');
}

async function sendToWebhook(item) {
  const webhookUrl = envValue('CALLBACK_WEBHOOK_URL').trim();
  if (!webhookUrl) {
    return { sent: false, provider: 'none', message: 'CALLBACK_WEBHOOK_URL nicht gesetzt' };
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });

  if (!response.ok) {
    const txt = await response.text();
    throw new Error('Callback webhook failed: HTTP ' + response.status + ' ' + txt);
  }

  return { sent: true, provider: 'webhook', message: 'Callback angelegt' };
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

  const callbackItem = {
    type: 'callback_request',
    id: 'cb_' + Math.random().toString(36).slice(2, 12),
    tenant_id: tenant.id,
    phone_number: phone,
    customer_name: String(body.customer_name || body.customerName || '').trim() || null,
    reason: String(body.reason || 'transfer_timeout').trim(),
    source: String(body.source || 'retell_tool').trim(),
    priority: String(body.priority || 'normal').trim(),
    call_id: String(body.call_id || body.callId || '').trim() || null,
    requested_at: new Date().toISOString(),
    notes: String(body.notes || '').trim() || null,
    status: 'open',
  };

  try {
    try {
      await insertRow('callback_requests', {
        tenant_id: tenant.id,
        call_id: callbackItem.call_id,
        phone_number: callbackItem.phone_number,
        customer_name: callbackItem.customer_name,
        reason: callbackItem.reason,
        source: callbackItem.source,
        priority: callbackItem.priority,
        notes: callbackItem.notes,
        status: callbackItem.status,
      }, { serviceRole: true });
    } catch (error) {
      if (!isMissingSchemaError(error)) throw error;
      appendLocalCallback(callbackItem);
    }
    const result = await sendToWebhook(callbackItem);
    return json(200, {
      ok: true,
      status: 'created',
      tenant,
      callback: callbackItem,
      dispatch: result,
    });
  } catch (error) {
    return json(502, {
      ok: false,
      message: 'Callback konnte nicht weitergeleitet werden',
      detail: String(error && error.message ? error.message : error),
      callback: callbackItem,
    });
  }
};
