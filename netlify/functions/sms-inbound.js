const { envValue, insertRow, json, getTenantByPhoneNumber } = require('./_lib/tenant');

// Liest die eingehende SMS aus, egal ob seven.io sie als JSON, urlencoded oder
// als GET-Query schickt. Gibt ein flaches Objekt mit allen Feldern zurueck.
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
  return Object.assign({}, qs, body);
}

// Erkennt eine Bewertung 1-5 in der Antwort (auch wenn noch Text drumherum steht).
function parseRating(text) {
  const s = String(text || '').trim();
  let m = s.match(/^([1-5])\b/);
  if (m) return Number(m[1]);
  m = s.match(/(?:^|\s)([1-5])(?=\s|$|[.,!?])/);
  if (m) return Number(m[1]);
  return null;
}

async function resolveTenantIdForInbound(systemNumber) {
  const fallback = envValue('FALLBACK_TENANT_ID') || 'tenant_beautyworld';
  const candidate = String(systemNumber || '').trim();
  if (!candidate) return fallback;
  try {
    const tenant = await getTenantByPhoneNumber(candidate, { serviceRole: true });
    return String((tenant && tenant.id) || fallback);
  } catch (_) {
    return fallback;
  }
}

exports.handler = async (event) => {
  const data = parseIncoming(event);
  const sender = String(data.sender || data.from || data.msisdn || data.originator || '').trim();
  const text = String(data.text || data.message || data.msg || data.content || '').trim();
  const system = String(data.system || data.to || data.receiver || '').trim();
  const providerId = String(data.id || data.msg_id || data.message_id || '').trim();
  const rating = parseRating(text);
  const tenantId = await resolveTenantIdForInbound(system);

  // Immer 200 zurueckgeben, damit seven.io die Zustellung nicht wiederholt.
  if (!sender && !text) {
    return json(200, { ok: true, ignored: true, reason: 'keine Absender/Text-Daten' });
  }

  // Feedback in Supabase speichern (Tabelle sms_feedback muss angelegt sein - siehe supabase/sms-feedback.sql).
  let stored = false;
  try {
    await insertRow('sms_feedback', {
      tenant_id: tenantId,
      phone_number: sender || null,
      rating: rating,
      message: text || null,
      provider_message_id: providerId || null,
    }, { serviceRole: true });
    stored = true;
  } catch (error) {
    // Tabelle fehlt noch oder RLS blockt: Feedback wenigstens ins Function-Log schreiben, damit es nicht verloren geht.
    console.log('[sms-inbound] konnte nicht speichern:', String(error && error.message ? error.message : error),
      '| sender=', sender, '| rating=', rating, '| text=', text, '| system=', system);
  }

  return json(200, { ok: true, received: { sender, rating, system }, stored });
};
