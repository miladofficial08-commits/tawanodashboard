const { bearerTokenFromEvent, envValue, json, listRows, resolveTenantContextFromAccessToken, getTenantSettings, tenantProvider, tenantAgentId } = require('./_lib/tenant');
const elevenlabs = require('./_lib/elevenlabs');
const {syncCalls} = require('./_lib/call-workspace');
const {loadHistoryState, saveHistoryState, collectHistory} = require('./_lib/call-history');
const {callbackFields} = require('./_lib/callback-fields');

const RETELL_PAGE_SIZE = 500;

function toIsoFromMs(ms) {
  const num = Number(ms || 0);
  if (!Number.isFinite(num) || num <= 0) return new Date().toISOString();
  return new Date(num).toISOString();
}

function cutoffMsFromTenant(tenant) {
  const ms = Date.parse(tenant && tenant.go_live_at);
  return Number.isFinite(ms) ? ms : 0;
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

// Nummer des KUNDEN (nie die eigene Business-Nummer).
// Primaer ueber die Anrufrichtung (zuverlaessig von Retell geliefert):
//   inbound  -> Kunde ruft an  -> from_number
//   outbound -> wir rufen an   -> to_number
// Fallback (falls direction fehlt): Vergleich mit der eigenen Outbound-Nummer.
function customerPhoneFromRetell(item, tenantFromNumber) {
  const fromNumber = String(item.from_number || '').trim();
  const toNumber = String(item.to_number || '').trim();
  const direction = String(item.direction || '').toLowerCase();
  if (direction === 'inbound') return fromNumber || toNumber || null;
  if (direction === 'outbound') return toNumber || fromNumber || null;
  const tenantDigits = normalizePhone(tenantFromNumber);
  if (fromNumber && tenantDigits && normalizePhone(fromNumber) === tenantDigits) return toNumber || fromNumber;
  return fromNumber || toNumber || null;
}

function mapCall(item, tenantFromNumber) {
  const createdAt = toIsoFromMs(item.start_timestamp);
  const updatedAt = toIsoFromMs(item.end_timestamp || item.transfer_end_timestamp || item.start_timestamp);
  const callId = String(item.call_id || '');
  const startMs = Number(item.start_timestamp || 0);
  const endMs = Number(item.end_timestamp || item.transfer_end_timestamp || 0);
  let durationMs = Number(item.duration_ms || 0);
  if ((!durationMs || durationMs < 0) && endMs > startMs) durationMs = endMs - startMs;
  if (!Number.isFinite(durationMs) || durationMs < 0) durationMs = 0;
  return {
    id: callId,
    call_id: callId,
    durationMs,
    agent_id: item.agent_id || null,
    requestedAgentId: (item.metadata && item.metadata.requested_agent) || null,
    resolvedAgentId: item.agent_id || null,
    status: item.call_status || 'registered',
    retellStatus: item.call_status || 'registered',
    from_number: item.from_number || null,
    fromNumber: item.from_number || null,
    to_number: item.to_number || null,
    toNumber: item.to_number || null,
    direction: item.direction || null,
    phoneNumber: customerPhoneFromRetell(item, tenantFromNumber),
    customerName: (item.metadata && item.metadata.customer_name) || '',
    name: (item.metadata && item.metadata.customer_name) || '',
    disconnectionReason: item.disconnection_reason || '',
    disconnection_reason: item.disconnection_reason || '',
    callAnalysis: item.call_analysis || {},
    call_analysis: item.call_analysis || {},
    // Strukturierte Rueckrufzeit aus der Post Call Analysis bzw. den gesammelten
    // Variablen des Agents - zuverlaessiger als das Auslesen des Freitexts.
    callback: callbackFields(
      item.call_analysis && item.call_analysis.custom_analysis_data,
      item.collected_dynamic_variables,
      item.retell_llm_dynamic_variables,
    ),
    summary: (item.call_analysis && item.call_analysis.call_summary) || '',
    createdAt,
    updatedAt,
  };
}

async function fetchRetellListCalls(retellApiKey, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    return await fetch('https://api.retellai.com/v3/list-calls', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + retellApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// Eine Seite Retell-Gespraeche. Retell blaettert ueber einen pagination_key; die
// Abfrage bleibt sonst genau so aufgebaut wie bisher (nur groesser und mit Cursor).
async function fetchRetellPage(retellApiKey, agentId, tenantFromNumber, options) {
  const request = {
    sort_order: 'descending',
    limit: RETELL_PAGE_SIZE,
    filter_criteria: { agent_id: [agentId] },
  };
  // Cursor fuer die normale Kette; `skip` nur beim Wiedereinstieg in eine Luecke
  // (Retell erlaubt nicht beides zugleich).
  if (options && options.cursor) request.pagination_key = options.cursor;
  else if (options && Number(options.skip) > 0) request.skip = Number(options.skip);

  const response = await fetchRetellListCalls(retellApiKey, request);
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = {}; }
  if (!response.ok) {
    const error = new Error(data.error_message || data.message || 'Retell Calls konnten nicht geladen werden');
    error.status = response.status || 502;
    throw error;
  }

  const items = Array.isArray(data.items) ? data.items : [];
  // STRIKTE DATENTRENNUNG: nur Gespraeche des eigenen Agents, auch wenn der
  // Anbieter den Filter einmal ignorieren sollte.
  const own = items.filter((item) => String(item.agent_id || '') === agentId);
  const more = data.has_more === undefined ? items.length >= RETELL_PAGE_SIZE : Boolean(data.has_more);
  return {
    calls: own.map((item) => mapCall(item, tenantFromNumber)),
    cursor: more && data.pagination_key ? String(data.pagination_key) : '',
    more,
    supportsBefore: false,
  };
}

// Gespraeche des Mandanten holen, ablegen und die gespeicherte Historie zurueckgeben.
// Geblaettert wird bis zur bereits gespeicherten Historie; ein offener Rueckstand
// wird ueber die naechsten Abrufe nachgearbeitet (siehe _lib/call-history.js).
async function loadWorkspace(tenant, fetchPage) {
  const state = await loadHistoryState(tenant);
  state.cutoffMs = cutoffMsFromTenant(tenant);
  const history = await collectHistory(fetchPage, state);
  const workspace = await syncCalls(tenant, history.calls);
  await saveHistoryState(tenant, state, history);
  return { workspace, historyPending: !history.complete };
}

async function listCallbackRequests(tenantId, accessToken) {
  try {
    return await listRows('callback_requests', {
      select: '*',
      tenant_id: 'eq.' + tenantId,
      order: 'created_at.desc',
      limit: 50,
    }, { accessToken });
  } catch (_) {
    return [];
  }
}

exports.handler = async (event) => {
  const method = (event.httpMethod || 'GET').toUpperCase();
  if (method !== 'GET') return json(405, { ok: false, message: 'Method Not Allowed' });

  const accessToken = bearerTokenFromEvent(event);
  if (!accessToken) {
    return json(401, { ok: false, message: 'Unauthorized' });
  }

  let tenantContext;
  try {
    tenantContext = await resolveTenantContextFromAccessToken(accessToken);
  } catch (error) {
    return json(error.status || 401, { ok: false, message: 'Tenant-Kontext konnte nicht geladen werden', detail: String(error.message || error), calls: [], callbacks: [] });
  }

  const provider = tenantProvider(tenantContext.tenant);

  // ── ElevenLabs-Kunden: Gespraeche direkt aus ElevenLabs lesen ──────────────
  // Nur Lesen. Telefonie/Buchung/SMS steuert der Kunde in ElevenLabs selbst.
  if (provider === 'elevenlabs') {
    const elAgentId = tenantAgentId(tenantContext.tenant);
    if (!elAgentId) {
      return json(200, { ok: true, tenant: tenantContext.tenant, calls: [], callbacks: [], message: 'Kein ElevenLabs-Agent fuer diesen Mandanten hinterlegt.' });
    }
    if (!envValue('ELEVENLABS_API_KEY').trim()) {
      return json(500, { ok: false, message: 'ELEVENLABS_API_KEY fehlt (bitte in Railway/Netlify eintragen).', calls: [], callbacks: [] });
    }
    // Kunden-Einstellungen (Minuten-Budget, Detail-Analyse) gelten providerunabhaengig -
    // ohne das hier bliebe die Minuten-Anzeige eines ElevenLabs-Kunden ohne Budget.
    // serviceRole, weil der Admin die Settings mit serviceRole speichert (RLS).
    if (tenantContext.tenant && tenantContext.tenant.id) {
      try {
        const settings = await getTenantSettings(tenantContext.tenant.id, { serviceRole: true, strict:true });
        if (settings && settings.minutes_budget !== undefined) tenantContext.tenant.minutes_budget = Number(settings.minutes_budget) || 0;
        tenantContext.tenant.detailed_analysis = Boolean(settings && settings.detailed_analysis);
      } catch (_) { return json(503,{ok:false,message:'Kundeneinstellungen konnten nicht geladen werden. Bitte erneut aktualisieren.'}); }
    }

    try {
      // Rufnummern und Zusammenfassungen liefert erst die Detailabfrage. Angereichert
      // wird nur die erste (neueste) Seite - beim Nacharbeiten alter Gespraeche waeren
      // hunderte Detailabrufe zu langsam; eine geoeffnete Altkonversation holt ihre
      // Nummer weiterhin ueber get-call-detail nach.
      const { workspace, historyPending } = await loadWorkspace(tenantContext.tenant, async (page) => {
        const result = await elevenlabs.listConversationsPage(elAgentId, page);
        if (page.cursor || page.beforeMs) return result;
        return Object.assign({}, result, { calls: await elevenlabs.enrichConversations(elAgentId, result.calls) });
      });
      tenantContext.tenant.minutes_used = workspace.minutesUsed;
      const allCalls = workspace.calls;
      const cutoffMs = cutoffMsFromTenant(tenantContext.tenant);
      const calls = cutoffMs
        ? allCalls.filter((c) => { const t = Date.parse(c.createdAt); return Number.isFinite(t) && t >= cutoffMs; })
        : allCalls;

      const callbacks = await listCallbackRequests(tenantContext.tenant.id, accessToken);

      return json(200, { ok: true, tenant: tenantContext.tenant, calls, callbacks, historyLimited:workspace.historyLimited, historyPending });
    } catch (error) {
      return json(502, { ok: false, message: 'ElevenLabs nicht erreichbar.', detail: String(error && error.message ? error.message : error), calls: [] });
    }
  }

  const retellApiKey = envValue('RETELL_API_KEY').trim();
  if (!retellApiKey) return json(500, { ok: false, message: 'RETELL_API_KEY fehlt in .env.' });

  // Kunden-Einstellungen (Admin) an den Tenant haengen: Minuten-Budget + Detail-Analyse-Schalter + Terminbuchung + Cal.com.
  // WICHTIG: serviceRole, weil Admin die Settings mit serviceRole speichert und RLS sie blockiert, wenn nur accessToken.
  if (tenantContext.tenant && tenantContext.tenant.id) {
    try {
      const settings = await getTenantSettings(tenantContext.tenant.id, { serviceRole: true, strict:true });
      if (settings && settings.minutes_budget !== undefined) tenantContext.tenant.minutes_budget = Number(settings.minutes_budget) || 0;
      tenantContext.tenant.detailed_analysis = Boolean(settings && settings.detailed_analysis);
      tenantContext.tenant.booking_enabled = settings.booking_enabled === true;
      tenantContext.tenant.sms_appointment_template = String(settings.sms_appointment_template || '');
      tenantContext.tenant.calcom_event_type_id = String(settings.calcom_event_type_id || '');
    } catch (_) { return json(503,{ok:false,message:'Kundeneinstellungen konnten nicht geladen werden. Bitte erneut aktualisieren.'}); }
  }

  // STRIKTE DATENTRENNUNG: ausschliesslich der eigene Retell-Agent des Mandanten.
  // Kein globaler ENV-Fallback und niemals eine ungefilterte Abfrage - sonst wuerden
  // Anrufe fremder Mandanten (z. B. Tawano im BeautyWorld-Dashboard) auftauchen.
  // Der Env-Fallback-Tenant traegt seinen Agent bereits in retell_agent_id (siehe fallbackTenantFromEnv).
  const agentId = String((tenantContext.tenant && tenantContext.tenant.retell_agent_id) || '').trim();
  if (!agentId) {
    return json(200, {
      ok: true,
      tenant: tenantContext.tenant,
      calls: [],
      callbacks: [],
      message: 'Kein Retell-Agent fuer diesen Mandanten hinterlegt.',
    });
  }

  try {
    const { workspace, historyPending } = await loadWorkspace(tenantContext.tenant, (page) =>
      fetchRetellPage(retellApiKey, agentId, tenantContext.tenant.retell_from_number, page));
    tenantContext.tenant.minutes_used = workspace.minutesUsed;
    const cutoffMs = cutoffMsFromTenant(tenantContext.tenant);
    const calls = workspace.calls.filter(call=>!cutoffMs || Date.parse(call.createdAt)>=cutoffMs);

    const callbacks = await listCallbackRequests(tenantContext.tenant.id, accessToken);

    return json(200, { ok: true, tenant: tenantContext.tenant, calls, callbacks, historyLimited:workspace.historyLimited, historyPending });
  } catch (error) {
    const status = error && error.status && error.status < 500 ? error.status : 502;
    const message = error && error.status ? (error.message || 'Retell Calls konnten nicht geladen werden') : 'Retell nicht erreichbar.';
    return json(status, { ok: false, message, detail: String(error && error.message ? error.message : error), calls: [] });
  }
};
