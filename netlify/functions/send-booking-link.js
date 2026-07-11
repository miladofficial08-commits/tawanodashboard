const { envValue, insertRow, json, readBody, resolveTenantFromToolBody, getTenantSettings, saveTenantSettings, listRows } = require('./_lib/tenant');
const { isAuthorizedToolRequest } = require('./_lib/retell-auth');

// Sicherheitsnetz: wurde fuer diesen Anruf bereits ein Termin gebucht (book-appointment),
// dann ging schon die Call-Details-SMS raus -> die Standard-SMS NICHT zusaetzlich senden.
// Best-effort: schlaegt die Abfrage fehl (z. B. Tabelle fehlt), laeuft der Versand normal weiter.
async function recentBookingExists({ tenantId, callId, phone }) {
  const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const digits = String(phone || '').replace(/\D/g, '');
  try {
    if (callId) {
      const byCall = await listRows('tavano_bookings', {
        select: 'id', tenant_id: 'eq.' + tenantId, call_id: 'eq.' + callId, status: 'eq.booked', limit: 1,
      }, { serviceRole: true });
      if (byCall.length) return true;
    }
    if (digits) {
      const rows = await listRows('tavano_bookings', {
        select: 'phone_number', tenant_id: 'eq.' + tenantId, status: 'eq.booked', created_at: 'gte.' + sinceIso, limit: 50,
      }, { serviceRole: true });
      return rows.some((r) => String(r.phone_number || '').replace(/\D/g, '') === digits);
    }
  } catch (_) { /* Tabelle/Abfrage optional */ }
  return false;
}

// ============================================================
//  SMS-INHALTE KOMMEN AUSSCHLIESSLICH AUS SUPABASE (pro Tenant) — NICHT mehr hier im Code:
//    - Nachricht/Vorlage:            analytics_snapshots(tenant_settings) -> payload.sms_template
//    - Absender:                     tenants.sms_sender
//    - Buchungslink:                 tenants.booking_link_url
//    - Lead-Parameter an Link haengen: tenant_settings -> payload.append_lead_params (true/false)
//  Neue Nummer/Nachricht = neuer Tenant + Settings in Supabase. KEINE hartcodierten Vorlagen.
//  Ohne Vorlage ODER Absender in Supabase wird bewusst NICHT gesendet (klare Fehlermeldung).
// ============================================================
// Feedback-Seite = System-URL (kein Nachrichteninhalt), optional per Env ueberschreibbar.
const FEEDBACK_BASE_URL = String(process.env.FEEDBACK_BASE_URL || 'https://tawanodashboard.netlify.app/feedback').trim();

// Prueft, ob ein Wert eine echte Telefonnummer ist – verwirft KI-Platzhalter wie "<EINGEHENDE_NUMMER>".
function isRealPhone(value) {
  const s = String(value || '').trim();
  if (!s || /[<>{}]/.test(s)) return false;
  return s.replace(/\D/g, '').length >= 7;
}

function appendQueryParams(url, params) {
  const base = String(url || '').trim();
  if (!base) return '';
  try {
    const parsed = new URL(base);
    Object.entries(params || {}).forEach(([key, value]) => {
      const text = String(value || '').trim();
      if (text) parsed.searchParams.set(key, text);
    });
    return parsed.toString();
  } catch (_) {
    const search = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      const text = String(value || '').trim();
      if (text) search.set(key, text);
    });
    const query = search.toString();
    if (!query) return base;
    return base + (base.includes('?') ? '&' : '?') + query;
  }
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

  // Absender kommt aus Supabase (tenant.sms_sender) und wird als payload.sms_sender uebergeben.
  // Der Handler stellt sicher, dass er gesetzt ist (sonst wird gar nicht erst gesendet).
  const smsFrom = String(payload.sms_sender || '').trim();
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
  if (!isAuthorizedToolRequest(event)) {
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

  // Fuer die Tenant-Zuordnung/Logs: welche Geschaeftsnummer wurde angerufen?
  const calledBusinessNumberFrom = (c) => {
    if (!c) return '';
    const dir = String(c.direction || '').toLowerCase();
    return String((dir === 'outbound' ? c.from_number : c.to_number) || c.to_number || c.from_number || '').trim();
  };

  // Telefonnummer ermitteln.
  // WICHTIG: Die echte Anrufernummer aus dem laufenden Retell-Call hat IMMER Vorrang.
  // Die vom LLM gelieferte phone_number kann halluziniert/veraltet sein (z. B. eine alte
  // Nummer aus dem Kontext) und wird nur benutzt, wenn KEIN echter Call-Kontext vorliegt.
  const llmPhone = String(body.phone_number || body.phoneNumber || body.phone || '').trim();
  let phone = callerFrom(callInfo);
  if (!isRealPhone(phone)) phone = isRealPhone(llmPhone) ? llmPhone : '';

  const tenantContext = await resolveTenantFromToolBody(body);
  const tenant = tenantContext.tenant;

  // Sobald der (ggf. nachgeladene) echte Call vorliegt: dessen Anrufernummer ERZWINGEN.
  const realCaller = callerFrom(callInfo) || callerFrom(tenantContext.call);
  if (isRealPhone(realCaller)) phone = realCaller;

  if (!isRealPhone(phone)) {
    return json(400, { ok: false, message: 'Keine gueltige Anrufernummer gefunden. In Retell bei dieser Funktion "Payload: args only" AUS stellen, damit der Call-Kontext (from_number) mitkommt.' });
  }

  // Kunden-Einstellungen (SMS-Schalter + eigene Nachricht) aus dem Admin-Control-Center.
  let tSettings = {};
  try { tSettings = await getTenantSettings(tenant && tenant.id, { serviceRole: true }); } catch (_) { tSettings = {}; }
  if (tSettings.sms_enabled === false) {
    return json(200, { ok: false, status: 'disabled', message: 'SMS ist fuer diesen Kunden deaktiviert.', to: phone });
  }

  // Wurde fuer diesen Anruf bereits ein Termin gebucht? Dann ging die Call-Details-SMS
  // schon raus -> die Standard-SMS wird unterdrueckt.
  if (await recentBookingExists({ tenantId: String(tenant && tenant.id || '').trim(), callId: String(body.call_id || '').trim(), phone })) {
    return json(200, { ok: true, status: 'skipped_booking_sms_sent', message: 'Termin gebucht – Standard-SMS unterdrueckt.', to: phone });
  }

  const callId = String(body.call_id || '').trim();
  if (callId) {
    try {
      const existingSms = await listRows('sms_logs', {
        select: 'id,status,provider_message_id', tenant_id: 'eq.' + tenant.id,
        call_id: 'eq.' + callId, phone_number: 'eq.' + phone,
        status: 'in.(ACCEPTED,DELIVERED)', limit: 1,
      }, { serviceRole: true });
      if (existingSms.length) {
        return json(200, { ok: true, status: 'duplicate_suppressed', message: 'SMS fuer diesen Anruf bereits versendet.', to: phone });
      }
    } catch (_) { /* Altschema ohne call_id: Versandpfad beibehalten. */ }
  }

  const calledNumber = String(
    body.called_number
    || body.system_number
    || body.systemNumber
    || calledBusinessNumberFrom(callInfo)
    || calledBusinessNumberFrom(tenantContext.call)
    || tenant.retell_from_number
    || ''
  ).trim();
  // ── SMS-Inhalte AUSSCHLIESSLICH aus Supabase (pro Tenant) ──────────────────
  const template = String(tSettings.sms_template || '').trim();         // analytics_snapshots -> payload.sms_template
  const smsSender = String(tenant.sms_sender || '').trim();             // tenants.sms_sender
  const baseBookingLink = String(tenant.booking_link_url || '').trim(); // tenants.booking_link_url
  const appendLeadParams = Boolean(tSettings.append_lead_params);       // tenant_settings -> payload.append_lead_params

  // Kein hartcodierter Fallback mehr: ohne Vorlage oder Absender wird NICHT gesendet.
  if (!template) {
    return json(400, {
      ok: false, status: 'no_template', tenant: tenant.id, to: phone,
      message: 'Keine SMS-Vorlage in Supabase fuer Tenant "' + tenant.id + '". Bitte sms_template (tenant_settings) im Admin/Supabase setzen.',
    });
  }
  if (!smsSender) {
    return json(400, {
      ok: false, status: 'no_sender', tenant: tenant.id, to: phone,
      message: 'Kein Absender in Supabase fuer Tenant "' + tenant.id + '". Bitte tenants.sms_sender setzen.',
    });
  }

  const name = String(body.customer_name || body.customerName || '').trim();
  const resolvedAgentId = String(body.agent_id || (tenantContext.call && tenantContext.call.agent_id) || tenant.retell_agent_id || '').trim();
  const bookingLink = appendLeadParams
    ? appendQueryParams(baseBookingLink, { p: phone, t: tenant.id, c: body.call_id, name })
    : baseBookingLink;

  // Eigener Feedback-Link mit der Kundennummer (und Call-ID, falls vorhanden) - klar getrennt vom Buchungslink.
  const feedbackLink = FEEDBACK_BASE_URL
    ? (FEEDBACK_BASE_URL
      + '?p=' + encodeURIComponent(phone)
      + '&t=' + encodeURIComponent(tenant.id)
      + (body.call_id ? '&c=' + encodeURIComponent(body.call_id) : ''))
    : '';

  // SMS-Text ausschliesslich aus dem Supabase-Template bauen.
  let message = String(template)
    .replaceAll('{booking_link}', bookingLink || '')
    .replaceAll('{feedback_link}', feedbackLink || '')
    .replaceAll('{customer_name}', name || '');
  // Falls Link vorhanden, Platzhalter aber fehlt: anhaengen.
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
    sms_sender: smsSender,
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
      const baseLog = {
        tenant_id: tenant.id,
        phone_number: phone,
        customer_name: name || null,
        booking_link_url: bookingLink || null,
        message,
        provider: result.provider || 'unknown',
        provider_message_id: (firstMsg && firstMsg.id) || (result.response && (result.response.id || result.response.message_id)) || null,
        // Code 100 / HTTP 200 = nur ANGENOMMEN. Zustellung (DELIVERED) kommt spaeter per DLR-Webhook.
        status: result.sent ? 'ACCEPTED' : 'FAILED',
      };
      try {
        await insertRow('sms_logs', Object.assign({}, baseLog, {
          called_number: calledNumber || null,
          retell_agent_id: resolvedAgentId || null,
          call_id: String(body.call_id || '').trim() || null,
        }), { serviceRole: true });
      } catch (_) {
        // Rueckfall fuer Altdatenbank ohne neue Spalten.
        await insertRow('sms_logs', baseLog, { serviceRole: true });
      }
    } catch (error) {
      // Protokollierung in sms_logs ist optional (z. B. RLS-Policy oder fehlende Tabelle).
      // Ein Fehler hier darf den eigentlichen SMS-Versand NIEMALS fehlschlagen lassen.
    }
    // Fuer die Kostenrechnung im Admin: gesendete SMS + echten seven.io-Preis pro Kunde mitzaehlen.
    if (result.sent && tenant && tenant.id) {
      try {
        const cur = await getTenantSettings(tenant.id, { serviceRole: true });
        const firstMsg2 = result.response && Array.isArray(result.response.messages) ? result.response.messages[0] : null;
        const price = (firstMsg2 && Number(firstMsg2.price)) || 0;
        await saveTenantSettings(tenant.id, {
          sms_sent_count: (Number(cur.sms_sent_count) || 0) + 1,
          sms_cost_total: (Number(cur.sms_cost_total) || 0) + price,
        }, { serviceRole: true });
      } catch (_) { /* Zaehler optional */ }
    }
    // seven.io Code 100 / HTTP 200 heisst nur ANGENOMMEN, nicht zugestellt.
    // Die echte Zustellung (DELIVERED) trifft spaeter per DLR-Webhook (/api/sms-dlr) ein.
    const providerMessageId = (result.response && Array.isArray(result.response.messages)
      && result.response.messages[0] && result.response.messages[0].id) || null;
    return json(result.sent ? 200 : 502, {
      ok: result.sent,
      status: result.sent ? 'accepted' : 'failed',
      delivered: false,
      delivery_status: result.sent ? 'ACCEPTED' : 'FAILED',
      provider_message_id: providerMessageId,
      note: result.sent
        ? 'SMS von seven.io angenommen (noch NICHT zugestellt). Endgueltiger Status folgt per Delivery-Report.'
        : 'SMS wurde von seven.io nicht angenommen.',
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

exports.__test = {
  appendQueryParams,
  recentBookingExists,
};
