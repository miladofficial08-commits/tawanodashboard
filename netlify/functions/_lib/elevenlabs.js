// ElevenLabs Conversational AI - Lesepfad fuer das Dashboard.
//
// Zweck: Anruf-/Gespraechsdaten eines ElevenLabs-Agents abrufen und in EXAKT
// das gleiche Format mappen, das das Dashboard schon von Retell kennt
// (siehe debug-calls.js -> mapCall und get-call-detail.js). Dadurch braucht das
// Frontend keine Aenderung - ein ElevenLabs-Kunde sieht dieselbe Oberflaeche.
//
// Es wird NUR gelesen. Telefonie, Buchung, SMS steuert der Kunde in ElevenLabs
// selbst. Ein zentraler Platform-Key (ELEVENLABS_API_KEY) deckt alle Agents ab.

const { envValue } = require('./tenant');

const API_BASE = 'https://api.elevenlabs.io/v1/convai';

function apiKey() {
  return envValue('ELEVENLABS_API_KEY').trim();
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 10000);
  try {
    return await fetch(url, Object.assign({}, init || {}, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

function unixSecsToIso(secs) {
  const num = Number(secs || 0);
  if (!Number.isFinite(num) || num <= 0) return new Date().toISOString();
  return new Date(num * 1000).toISOString();
}

// ElevenLabs-Status/Erfolg -> die vom Dashboard erwarteten Retell-artigen Werte.
function mapStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'done' || s === 'processed') return 'ended';
  if (s === 'in-progress' || s === 'processing' || s === 'initiated') return 'ongoing';
  if (s === 'failed') return 'error';
  return s || 'registered';
}

function callSuccessfulToBool(value) {
  const s = String(value || '').toLowerCase();
  if (s === 'success') return true;
  if (s === 'failure') return false;
  return null;
}

// Telefon-Infos liegen (falls Telefonanruf) im metadata.phone_call-Block.
function phoneInfoFromMeta(meta) {
  const pc = (meta && typeof meta.phone_call === 'object') ? meta.phone_call : {};
  const direction = String(pc.direction || '').toLowerCase() || null;
  const external = String(pc.external_number || '').trim() || null; // Nummer des Anrufers/Angerufenen
  const agentNumber = String(pc.agent_number || '').trim() || null;  // eigene Business-Nummer
  return { direction, external, agentNumber };
}

// Ein Listen-Eintrag -> Dashboard-Call (gleiche Felder wie debug-calls.js mapCall).
function mapListItem(item) {
  const conversationId = String(item.conversation_id || '');
  const durationMs = Math.max(0, Number(item.call_duration_secs || 0) * 1000);
  const createdAt = unixSecsToIso(item.start_time_unix_secs);
  const summary = String(item.transcript_summary || '').trim();
  const successful = callSuccessfulToBool(item.call_successful);
  const phone = phoneInfoFromMeta(item.metadata || {});
  return {
    id: conversationId,
    call_id: conversationId,
    durationMs,
    agent_id: item.agent_id || null,
    requestedAgentId: null,
    resolvedAgentId: item.agent_id || null,
    status: mapStatus(item.status),
    retellStatus: mapStatus(item.status),
    from_number: phone.external,
    fromNumber: phone.external,
    to_number: phone.agentNumber,
    toNumber: phone.agentNumber,
    direction: phone.direction,
    phoneNumber: phone.external,
    customerName: '',
    name: '',
    disconnectionReason: '',
    disconnection_reason: '',
    callAnalysis: { call_summary: summary, call_successful: successful },
    call_analysis: { call_summary: summary, call_successful: successful },
    summary,
    createdAt,
    updatedAt: unixSecsToIso(Number(item.start_time_unix_secs || 0) + Number(item.call_duration_secs || 0)),
    provider: 'elevenlabs',
  };
}

// Alle (bis Limit) Gespraeche eines Agents holen, neueste zuerst.
async function listConversations(agentId, options) {
  const key = apiKey();
  if (!key || !agentId) return [];
  const opts = options || {};
  const limit = Number(opts.limit || 120);
  const pageSize = 100;
  const collected = [];
  let cursor = '';

  for (let page = 0; page < 5 && collected.length < limit; page += 1) {
    const params = new URLSearchParams();
    params.set('agent_id', agentId);
    params.set('page_size', String(pageSize));
    if (cursor) params.set('cursor', cursor);

    const response = await fetchWithTimeout(API_BASE + '/conversations?' + params.toString(), {
      method: 'GET',
      headers: { 'xi-api-key': key },
    }, 10000);

    if (!response.ok) {
      if (collected.length) break; // Teilergebnis lieber als Absturz.
      const text = await response.text().catch(() => '');
      const error = new Error('ElevenLabs list-conversations fehlgeschlagen (' + response.status + '): ' + text.slice(0, 300));
      error.status = response.status;
      throw error;
    }

    const data = await response.json().catch(() => ({}));
    const items = Array.isArray(data.conversations) ? data.conversations : [];
    for (const item of items) collected.push(item);

    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }

  return collected.slice(0, limit).map(mapListItem);
}

// Ein Gespraech im Detail (Transkript + Zusammenfassung) -> gleiche Felder wie
// get-call-detail.js sie fuer Retell liefert.
async function getConversation(conversationId) {
  const key = apiKey();
  if (!key || !conversationId) return null;

  const response = await fetchWithTimeout(
    API_BASE + '/conversations/' + encodeURIComponent(conversationId),
    { method: 'GET', headers: { 'xi-api-key': key } },
    10000,
  );
  if (!response.ok) {
    const error = new Error('ElevenLabs get-conversation fehlgeschlagen (' + response.status + ')');
    error.status = response.status;
    throw error;
  }

  const c = await response.json().catch(() => ({}));
  const meta = c.metadata || {};
  const analysis = c.analysis || {};
  const phone = phoneInfoFromMeta(meta);

  const turns = Array.isArray(c.transcript) ? c.transcript : [];
  const transcriptObject = turns
    .filter((t) => String(t && t.message || '').trim() !== '')
    .map((t) => ({
      role: String(t.role || '').toLowerCase() === 'agent' ? 'agent' : 'user',
      content: String(t.message || ''),
    }));
  const transcriptText = transcriptObject
    .map((t) => (t.role === 'agent' ? 'Agent: ' : 'Anrufer: ') + t.content)
    .join('\n');

  return {
    agent_id: c.agent_id || null,
    call: {
      call_id: c.conversation_id || conversationId,
      transcript: transcriptText,
      transcript_object: transcriptObject,
      recording_url: null, // ElevenLabs-Audio laeuft ueber einen separaten Endpoint (spaeter nachruestbar).
      from_number: phone.external,
      to_number: phone.agentNumber,
      direction: phone.direction,
      start_timestamp: Number(meta.start_time_unix_secs || 0) * 1000 || null,
      duration_ms: Math.max(0, Number(meta.call_duration_secs || 0) * 1000),
      disconnection_reason: String(meta.termination_reason || '') || null,
      summary: String(analysis.transcript_summary || '').trim(),
      user_sentiment: null,
      call_successful: callSuccessfulToBool(analysis.call_successful),
      in_voicemail: false,
    },
  };
}

// Leichte Statistik fuer die Admin-Kundenliste (Anzahl + letzter Anruf).
async function agentStats(agentId) {
  try {
    const calls = await listConversations(agentId, { limit: 120 });
    let connected = 0;
    let minutes = 0;
    calls.forEach((c) => {
      const min = Number(c.durationMs || 0) / 60000;
      if (min > 0) { connected += 1; minutes += min; }
    });
    return {
      calls: calls.length,
      connectedCalls: connected,
      lastAt: calls.length ? calls[0].createdAt : null,
      minutes,
      billedMinutes: Math.ceil(minutes),
      retellCost: 0,
      capped: false,
    };
  } catch (_) {
    return { calls: 0, connectedCalls: 0, lastAt: null, minutes: 0, billedMinutes: 0, retellCost: 0, capped: false };
  }
}

module.exports = {
  listConversations,
  getConversation,
  agentStats,
};
