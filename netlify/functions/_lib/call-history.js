// Lueckenlose Anrufhistorie.
//
// Frueher wurden pro Abruf nur die letzten 120 Gespraeche geholt. Lag zwischen zwei
// Dashboard-Aufrufen mehr Zeit (Urlaub, Wochenende, viele Anrufe), fielen aeltere
// Gespraeche still aus Liste, Rueckrufplan und Auswertung heraus.
//
// Jetzt wird beim Anbieter so lange zurueckgeblaettert, bis die bereits gespeicherte
// Historie erreicht ist. Ist noch ein Rueckstand offen (Erstsynchronisierung oder ein
// abgebrochener Lauf), wird er ueber mehrere Abrufe hinweg abgearbeitet - begrenzt
// durch ein Zeit- und Seitenbudget, damit ein Abruf nicht in den Funktions-Timeout
// laeuft. Was noch fehlt, meldet das Dashboard offen als "Nacharbeit laeuft".

const {listRows, supabaseRequest, isMissingSchemaError} = require('./tenant');
const {scope, scopeValues} = require('./call-workspace');

const PAGE_BUDGET = 15;    // Seiten je Abruf
const CALL_BUDGET = 1500;  // Gespraeche je Abruf
const TIME_BUDGET_MS = 4500;

function msFrom(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}
function startedMs(call) {
  return msFrom(call && (call.createdAt || call.updatedAt));
}

// Gespeicherten Stand lesen: neuester abgelegter Anruf + wie weit die Historie
// zusammenhaengend zurueckreicht. Fehlt die Migration, verhaelt sich der Abruf wie
// bisher (nur Neues seit dem letzten Abruf) statt zu scheitern.
async function loadHistoryState(tenant) {
  const query = {...scope(tenant), select: 'started_at', order: 'started_at.desc', limit: 1};
  const newest = await listRows('call_workspace', query, {serviceRole: true});
  const state = {lastCallAtMs: newest.length ? msFrom(newest[0].started_at) : 0, syncedFromMs: 0, coveredCount: 0, complete: false, tracked: true};
  try {
    const rows = await listRows('call_sync_state', {...scope(tenant), select: 'synced_from,history_complete', limit: 1}, {serviceRole: true});
    if (rows.length) {
      state.syncedFromMs = msFrom(rows[0].synced_from);
      state.complete = Boolean(rows[0].history_complete);
    }
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    state.tracked = false;
    state.complete = true;
  }
  if (!state.complete && state.syncedFromMs) state.coveredCount = await countSince(tenant, state.syncedFromMs);
  return state;
}

// Wie viele Gespraeche liegen bereits zusammenhaengend vor? Damit kann eine
// Nacharbeit den bekannten Block bei Anbietern ueberspringen, die keinen
// Zeitfilter kennen (Retell: `skip`), statt ihn jedes Mal erneut zu lesen.
async function countSince(tenant, fromMs) {
  try {
    const params = new URLSearchParams({...scope(tenant), select: 'call_id', limit: '1', started_at: 'gte.' + new Date(fromMs).toISOString()});
    const result = await supabaseRequest('/rest/v1/call_workspace?' + params.toString(), {serviceRole: true, prefer: 'count=exact'});
    const headers = result.response && result.response.headers;
    const range = headers && typeof headers.get === 'function' ? headers.get('content-range') : '';
    const total = Number(String(range || '').split('/')[1]);
    return Number.isFinite(total) ? total : 0;
  } catch (_) { return 0; }
}

async function saveHistoryState(tenant, state, result) {
  if (!state.tracked) return;
  try {
    await supabaseRequest('/rest/v1/call_sync_state', {
      serviceRole: true,
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: {
        ...scopeValues(tenant),
        synced_from: result.syncedFromMs ? new Date(result.syncedFromMs).toISOString() : null,
        history_complete: result.complete,
        updated_at: new Date().toISOString(),
      },
    });
  } catch (_) { /* Der Abruf selbst bleibt gueltig, auch wenn der Merker nicht schreibbar ist. */ }
}

// fetchPage({cursor, beforeMs, skip}) -> {calls, cursor, supportsBefore, more}
// calls:  bereits auf das Dashboard-Format gemappte Gespraeche DIESES Agents,
// cursor: leer, wenn der Anbieter keine weitere Seite liefert,
// more:   true, wenn es zwar weitergeht, aber kein Cursor kam (dann gilt die
//         Historie NICHT als vollstaendig),
// skip:   Versatz ab dem neuesten Gespraech - nur fuer Anbieter ohne Zeitfilter.
const JUMP_OVERLAP = 100; // lieber ein Stueck doppelt lesen als eine Luecke lassen
async function collectHistory(fetchPage, state) {
  const lastCallAtMs = Number(state.lastCallAtMs || 0);
  const syncedFromMs = Number(state.syncedFromMs || 0);
  const cutoffMs = Number(state.cutoffMs || 0);
  const coveredCount = Number(state.coveredCount || 0);
  const wasComplete = Boolean(state.complete);
  // Vollstaendige Historie -> es fehlt nur das Neue seit dem letzten Abruf.
  // Offener Rueckstand -> zurueck bis zum Go-Live bzw. bis zum Anfang.
  const stopMs = wasComplete ? lastCallAtMs : cutoffMs;
  const deadline = Date.now() + TIME_BUDGET_MS;

  const calls = [];
  let cursor = '';
  let beforeMs = 0;
  let baseSkip = 0;
  let chain = 0;    // in der aktuellen Cursor-/Skip-Kette geholte Gespraeche
  let canJump = !wasComplete && syncedFromMs > 0; // bekannten Block einmal ueberspringen
  let oldest = Infinity;
  let pages = 0;
  let exhausted = false;
  let reached = false;

  while (pages < PAGE_BUDGET && calls.length < CALL_BUDGET) {
    const page = await fetchPage({cursor, beforeMs, skip: baseSkip + chain});
    pages += 1;
    const items = Array.isArray(page && page.calls) ? page.calls : [];
    calls.push(...items);
    chain += items.length;
    items.forEach((call) => { const ms = startedMs(call); if (ms) oldest = Math.min(oldest, ms); });

    const next = String((page && page.cursor) || '');
    if (!next) { exhausted = !(page && page.more); break; }
    if (oldest <= stopMs) { reached = true; break; }
    if (Date.now() >= deadline) break;
    // Am unteren Rand des bekannten Blocks angekommen: direkt dahinter weitermachen.
    if (canJump && oldest <= lastCallAtMs && oldest > syncedFromMs) {
      canJump = false;
      cursor = '';
      chain = 0;
      if (page.supportsBefore) { beforeMs = syncedFromMs; baseSkip = 0; }
      else if (coveredCount > JUMP_OVERLAP) { baseSkip = coveredCount - JUMP_OVERLAP; }
      else { cursor = next; chain = calls.length; }
    } else {
      cursor = next;
    }
  }

  const oldestMs = Number.isFinite(oldest) ? oldest : 0;
  const complete = exhausted || (reached && (wasComplete || (cutoffMs > 0 && oldestMs <= cutoffMs)));
  const known = [oldestMs, wasComplete ? syncedFromMs : 0].filter(Boolean);
  return {
    calls,
    pages,
    complete,
    syncedFromMs: known.length ? Math.min(...known) : 0,
  };
}

module.exports = {loadHistoryState, saveHistoryState, collectHistory, PAGE_BUDGET, CALL_BUDGET};
