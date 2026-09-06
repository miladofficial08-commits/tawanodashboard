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
const { callbackFields } = require('./callback-fields');

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
// ACHTUNG: ElevenLabs liefert `phone_call: null` fuer Web-/Text-Gespraeche, und
// `typeof null === 'object'` - ohne die explizite null-Pruefung wird `pc` null und
// jeder Feldzugriff wirft. Das hat den Detail-Aufruf fuer solche Gespraeche gekillt.
function phoneInfoFromMeta(meta) {
  const raw = meta && meta.phone_call;
  const pc = (raw && typeof raw === 'object') ? raw : {};
  const direction = String(pc.direction || '').toLowerCase() || null;
  const external = String(pc.external_number || '').trim() || null; // Nummer des Anrufers/Angerufenen
  const agentNumber = String(pc.agent_number || '').trim() || null;  // eigene Business-Nummer
  return { direction, external, agentNumber };
}

// ElevenLabs-Beendigungsgrund ist englischer Freitext ("Call was transferred to
// number"). Das Dashboard uebersetzt aber Retell-Keys (mapDisconnectionReason in
// Dashboardkunde.html) - bekannte Faelle deshalb auf genau diese Keys ziehen,
// damit der Kunde "Weiterleitung" statt englischem Rohtext liest.
function mapTerminationReason(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const s = raw.toLowerCase();
  if (s.includes('transfer')) return 'call_transfer';
  if (s.includes('voicemail')) return 'voicemail_reached';
  if (s.includes('inactiv') || s.includes('timeout') || s.includes('silence')) return 'inactivity';
  if (s.includes('max duration') || s.includes('max_duration')) return 'max_duration_reached';
  if (s.includes('busy')) return 'dial_busy';
  if (s.includes('no answer') || s.includes('unanswered')) return 'dial_no_answer';
  if (s.includes('agent') && (s.includes('hung') || s.includes('ended') || s.includes('end call'))) return 'agent_hangup';
  if (s.includes('remote party')) return 'user_hangup';
  if ((s.includes('user') || s.includes('caller') || s.includes('client')) && (s.includes('hung') || s.includes('ended') || s.includes('disconnect'))) return 'user_hangup';
  return raw;
}

// sentiment_analysis.overall_label -> deutsches Anzeigewort (das Dashboard gibt
// den Wert unveraendert aus).
function mapSentiment(analysis) {
  const label = String((analysis && analysis.sentiment_analysis && analysis.sentiment_analysis.overall_label) || '').toLowerCase();
  if (label === 'positive') return 'Positiv';
  if (label === 'negative') return 'Negativ';
  if (label === 'neutral') return 'Neutral';
  return null;
}

// Strukturierte Rueckrufzeit: ElevenLabs legt die im Agent definierten Datenfelder
// unter analysis.data_collection_results ab (Map oder Liste).
function callbackFromAnalysis(analysis) {
  const a = analysis && typeof analysis === 'object' ? analysis : {};
  return callbackFields(a.data_collection_results, a.data_collection_results_list);
}

// Ein Listen-Eintrag -> Dashboard-Call (gleiche Felder wie debug-calls.js mapCall).
//
// Die Listen-Antwort von ElevenLabs enthaelt KEINEN metadata-Block (anders als die
// Detail-Antwort): `direction` steht flach im Item, Rufnummern gibt es hier gar nicht.
// `transcript_summary` ist in der Liste haeufig null, waehrend `call_summary_title`
// ("Mitarbeiter weiterleiten") gesetzt ist - ohne diesen Fallback bleibt die
// Anrufliste im Dashboard leer beschriftet.
function mapListItem(item) {
  const conversationId = String(item.conversation_id || '');
  const durationMs = Math.max(0, Number(item.call_duration_secs || 0) * 1000);
  const createdAt = unixSecsToIso(item.start_time_unix_secs);
  const summary = String(item.transcript_summary || item.call_summary_title || '').trim();
  const successful = callSuccessfulToBool(item.call_successful);
  const phone = phoneInfoFromMeta(item.metadata);
  const direction = phone.direction || (String(item.direction || '').toLowerCase() || null);
  const reason = mapTerminationReason(item.termination_reason);
  const sentiment = mapSentiment(item);
  const callback = callbackFromAnalysis(item.analysis);
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
    direction,
    phoneNumber: phone.external,
    customerName: '',
    name: '',
    disconnectionReason: reason,
    disconnection_reason: reason,
    callAnalysis: { call_summary: summary, call_successful: successful, user_sentiment: sentiment },
    call_analysis: { call_summary: summary, call_successful: successful, user_sentiment: sentiment },
    summary,
    sentiment,
    callback,
    createdAt,
    updatedAt: unixSecsToIso(Number(item.start_time_unix_secs || 0) + Number(item.call_duration_secs || 0)),
    provider: 'elevenlabs',
  };
}

// Eine Seite Gespraeche eines Agents, neueste zuerst.
// `beforeMs` springt direkt zu aelteren Gespraechen - damit kann die Nacharbeit einer
// Luecke die bereits gespeicherten Seiten ueberspringen, statt sie erneut zu lesen.
async function listConversationsPage(agentId, options) {
  const key = apiKey();
  if (!key || !agentId) return { calls: [], cursor: '', supportsBefore: true };
  const opts = options || {};
  const params = new URLSearchParams();
  params.set('agent_id', agentId);
  params.set('page_size', String(Math.min(100, Math.max(1, Number(opts.pageSize) || 100))));
  if (opts.cursor) params.set('cursor', String(opts.cursor));
  if (Number(opts.beforeMs) > 0) params.set('call_start_before_unix', String(Math.floor(Number(opts.beforeMs) / 1000)));

  const response = await fetchWithTimeout(API_BASE + '/conversations?' + params.toString(), {
    method: 'GET',
    headers: { 'xi-api-key': key },
  }, 10000);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = new Error('ElevenLabs list-conversations fehlgeschlagen (' + response.status + '): ' + text.slice(0, 300));
    error.status = response.status;
    throw error;
  }

  const data = await response.json().catch(() => ({}));
  const items = Array.isArray(data.conversations) ? data.conversations : [];
  return {
    calls: items.filter((item) => String(item.agent_id || '') === agentId).map(mapListItem),
    cursor: data.has_more && data.next_cursor ? String(data.next_cursor) : '',
    supportsBefore: true,
  };
}

// Bis zu `limit` Gespraeche eines Agents (fuer Statistiken; das Dashboard blaettert
// ueber _lib/call-history.js selbst).
async function listConversations(agentId, options) {
  const opts = options || {};
  const limit = Number(opts.limit || 120);
  const collected = [];
  let cursor = '';
  for (let page = 0; page < 5 && collected.length < limit; page += 1) {
    let result;
    try {
      result = await listConversationsPage(agentId, { cursor });
    } catch (error) {
      if (collected.length) break; // Teilergebnis lieber als Absturz.
      throw error;
    }
    collected.push(...result.calls);
    if (!result.cursor) break;
    cursor = result.cursor;
  }
  return collected.slice(0, limit);
}

// Ein Gespraech im Detail (Transkript + Zusammenfassung) -> gleiche Felder wie
// get-call-detail.js sie fuer Retell liefert.
async function getConversation(conversationId, timeoutMs = 10000) {
  const key = apiKey();
  if (!key || !conversationId) return null;

  const response = await fetchWithTimeout(
    API_BASE + '/conversations/' + encodeURIComponent(conversationId),
    { method: 'GET', headers: { 'xi-api-key': key } },
    timeoutMs,
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
      recording_url: null, // ElevenLabs-Audio laeuft ueber einen separaten, key-geschuetzten Endpoint.
      has_audio: Boolean(c.has_audio),
      from_number: phone.external,
      to_number: phone.agentNumber,
      direction: phone.direction,
      start_timestamp: Number(meta.start_time_unix_secs || 0) * 1000 || null,
      duration_ms: Math.max(0, Number(meta.call_duration_secs || 0) * 1000),
      disconnection_reason: mapTerminationReason(meta.termination_reason) || null,
      summary: String(analysis.transcript_summary || analysis.call_summary_title || '').trim(),
      user_sentiment: mapSentiment(analysis),
      call_successful: callSuccessfulToBool(analysis.call_successful),
      callback: callbackFromAnalysis(analysis),
      in_voicemail: false,
    },
  };
}

// Leichte Statistik fuer die Admin-Kundenliste (Anzahl + letzter Anruf).
const STATS_LIMIT = 120; // Admin-Kundenliste: nur eine schnelle Uebersicht, kein Journal.
async function agentStats(agentId) {
  try {
    const calls = await listConversations(agentId, { limit: STATS_LIMIT });
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
      capped: calls.length >= STATS_LIMIT,
    };
  } catch (_) {
    return { calls: 0, connectedCalls: 0, lastAt: null, minutes: 0, billedMinutes: 0, retellCost: 0, capped: false };
  }
}

const detailCache = new Map();
async function enrichConversations(agentId, calls) {
  const enriched = calls.slice();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, calls.length) }, async () => {
    while (next < Math.min(12, calls.length)) {
      const index = next++;
      const call = calls[index];
      const key = agentId + ':' + call.call_id;
      try {
        const cached = detailCache.get(key);
        const detail = cached && cached.expires > Date.now() ? cached.detail : await getConversation(call.call_id, 2500);
        if (!detail || detail.agent_id !== agentId) { enriched[index] = null; continue; }
        if (detailCache.size > 1000) detailCache.clear();
        detailCache.set(key, { detail, expires: Date.now() + 60000 });
        const c = detail.call;
        enriched[index] = Object.assign({}, call, { phoneNumber:c.from_number, from_number:c.from_number, to_number:c.to_number, direction:c.direction, summary:c.summary || call.summary, callback:c.callback || call.callback || null, call_analysis:{call_summary:c.summary || call.summary,call_successful:c.call_successful,user_sentiment:c.user_sentiment} });
      } catch (_) { enriched[index] = Object.assign({}, call, { detail_unavailable:true }); }
    }
  }));
  return enriched.filter(Boolean);
}

module.exports = {
  enrichConversations,
  listConversations,
  listConversationsPage,
  getConversation,
  agentStats,
};
