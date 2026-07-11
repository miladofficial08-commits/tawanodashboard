// seven.io Delivery-Report-Webhook (DLR).
// Empfaengt Zustell-Status pro SMS und schreibt ihn in sms_logs.
//
// seven.io schickt (moderner Webhook, POST JSON):
//   { "webhook_event": "dlr", "data": { "msg_id": "...", "status": "DELIVERED", "timestamp": "..." } }
// Aeltere/alternative Callbacks schicken die Felder flach (GET-Query oder urlencoded):
//   ?msg_id=...&status=...&err=...
// Beide Formen werden hier robust ausgewertet.
//
// WICHTIG:
//  - Aktualisiert NUR sms_logs (Status/Fehlercode/delivered_at). Kosten & Feedback bleiben unberuehrt.
//  - Antwortet IMMER mit HTTP 200, damit seven.io die Zustellung nicht wiederholt.
//  - Optionaler Schutz: env SEVEN_DLR_SECRET setzen -> Callback-URL braucht ?secret=... (oder Header x-dlr-secret).

const { envValue, json, patchRows } = require('./_lib/tenant');

// Endzustaende laut seven.io. Alles andere (ACCEPTED/TRANSMITTED/BUFFERED) ist "unterwegs".
const FAILURE_STATUSES = ['NOTDELIVERED', 'REJECTED', 'EXPIRED', 'FAILED'];

function parseIncoming(event) {
  const qs = event.queryStringParameters || {};
  let body = {};
  const rawBody = event.body || '';
  const ctype = String((event.headers && (event.headers['content-type'] || event.headers['Content-Type'])) || '').toLowerCase();
  if (rawBody) {
    if (ctype.includes('application/json')) {
      try { body = JSON.parse(rawBody); } catch (_) { body = {}; }
    } else if (ctype.includes('application/x-www-form-urlencoded')) {
      body = Object.fromEntries(new URLSearchParams(rawBody));
    } else {
      try { body = JSON.parse(rawBody); } catch (_) {
        try { body = Object.fromEntries(new URLSearchParams(rawBody)); } catch (__) { body = {}; }
      }
    }
  }
  // seven.io kapselt die DLR-Felder in "data" - flach zusammenfuehren, ohne Query/Top-Level zu verlieren.
  const inner = (body && typeof body.data === 'object' && body.data) ? body.data : {};
  return Object.assign({}, qs, body, inner);
}

function pick(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function isAuthorized(event, data) {
  const expected = envValue('SEVEN_DLR_SECRET').trim();
  if (!expected) return true; // kein Secret gesetzt -> offen (wie sms-inbound)
  const headers = event.headers || {};
  const incoming = String(
    headers['x-dlr-secret'] || headers['X-Dlr-Secret'] || data.secret || ''
  ).trim();
  return incoming && incoming === expected;
}

exports.handler = async (event) => {
  const data = parseIncoming(event);

  if (!isAuthorized(event, data)) {
    // Trotzdem 200, damit seven nicht endlos retryt; aber nichts speichern.
    return json(200, { ok: false, ignored: true, reason: 'unauthorized' });
  }

  const msgId = pick(data, ['msg_id', 'id', 'message_id', 'msgid']);
  const status = pick(data, ['status']).toUpperCase();
  const errorCode = pick(data, ['err', 'error', 'error_code', 'errorcode', 'code']);
  const recipientFromPayload = pick(data, ['to', 'recipient', 'number', 'msisdn']);
  const tsRaw = pick(data, ['timestamp', 'status_time', 'time']);

  if (!msgId || !status) {
    return json(200, { ok: true, ignored: true, reason: 'msg_id oder status fehlt' });
  }

  const isDelivered = status === 'DELIVERED';
  const isFailure = FAILURE_STATUSES.includes(status);

  // Zeitstempel normalisieren (seven schickt z. B. "2021-08-24 08:08:00.000000").
  let statusTime = null;
  if (tsRaw) {
    const d = new Date(tsRaw.includes('T') ? tsRaw : tsRaw.replace(' ', 'T'));
    if (!Number.isNaN(d.getTime())) statusTime = d.toISOString();
  }
  const nowIso = new Date().toISOString();

  const patch = {
    status,                 // Haupt-Status = echter seven.io-Zustand
    dlr_status: status,     // roher letzter DLR-Wert
    dlr_updated_at: nowIso,
  };
  if (isDelivered) patch.delivered_at = statusTime || nowIso;
  if (isFailure && errorCode) patch.error_code = errorCode;

  let updated = [];
  try {
    updated = await patchRows('sms_logs', { provider_message_id: 'eq.' + msgId }, patch, { serviceRole: true });
  } catch (error) {
    // DB-Fehler nicht an seven zurueckspiegeln (sonst Retry-Sturm) - nur loggen.
    console.log('[sms-dlr] Update fehlgeschlagen:', String(error && error.message ? error.message : error),
      '| msg_id=', msgId, '| status=', status);
    return json(200, { ok: false, error: 'db_update_failed', msg_id: msgId, status });
  }

  const matched = Array.isArray(updated) && updated.length > 0;
  const recipient = (matched && updated[0].phone_number) || recipientFromPayload || 'unbekannt';

  // Anforderung: bei NOTDELIVERED Fehlercode UND Empfaengernummer protokollieren.
  if (isFailure) {
    console.log('[sms-dlr] NICHT ZUGESTELLT | status=', status,
      '| empfaenger=', recipient,
      '| error_code=', errorCode || 'n/a',
      '| msg_id=', msgId,
      matched ? '' : '| WARN: keine sms_logs-Zeile gefunden');
  }

  return json(200, {
    ok: true,
    matched,
    msg_id: msgId,
    status,
    delivered: isDelivered,
    failed: isFailure,
    error_code: errorCode || null,
  });
};

exports.__test = { parseIncoming, FAILURE_STATUSES };
