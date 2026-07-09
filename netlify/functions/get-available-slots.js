// Retell Custom Tool: echte freie Cal.com-Zeiten liefern (aktuell nur Tawano).
//
// Liefert maximal 2 wirklich freie Slots (07–20 Uhr, Mo–So, Europe/Berlin) im
// einfachen Format { success, slots: [{ date, time, label }] }.
// Keine Zufallszeiten – ausschliesslich das, was Cal.com als frei meldet.

const { envValue, json, readBody } = require('./_lib/tenant');
const calcom = require('./_lib/calcom');

const LOOKAHEAD_DAYS = 14;
const MAX_SLOTS_DEFAULT = 2;
const DEFAULT_TIMEZONE = 'Europe/Berlin';

function isAuthorized(event) {
  const expected = envValue('RETELL_TOOL_SECRET').trim();
  if (!expected) return true;
  const headers = event.headers || {};
  const incoming = String(headers['x-retell-tool-secret'] || headers['X-Retell-Tool-Secret'] || '').trim();
  return incoming && incoming === expected;
}

// Robust Input auslesen: args, arguments, oder direktes body, plus Retell full payload
function parseInput(raw) {
  const payload = raw || {};
  const args = (payload.args && typeof payload.args === 'object') ? payload.args
    : ((payload.arguments && typeof payload.arguments === 'object') ? payload.arguments : {});
  return Object.assign({}, payload, args);
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/^\d{4}-\d{2}-\d{2}$/);
  if (!m) return null;
  const d = new Date(dateStr + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) ? d : null;
}

// Filtert slots nach time_preference (any|morning|afternoon|evening)
function filterByTimePreference(slots, preference) {
  if (!preference || preference === 'any') return slots;
  const pref = String(preference).toLowerCase();
  return slots.filter((slot) => {
    const [h, m] = String(slot.time || '').split(':').map(Number);
    if (!(Number.isFinite(h) && Number.isFinite(m))) return false;
    const mins = h * 60 + m;
    if (pref === 'morning') return mins >= 7 * 60 && mins < 12 * 60;
    if (pref === 'afternoon') return mins >= 12 * 60 && mins < 17 * 60;
    if (pref === 'evening') return mins >= 17 * 60 && mins <= 20 * 60;
    return false;
  });
}

exports.handler = async (event) => {
  const method = (event.httpMethod || 'GET').toUpperCase();
  if (method !== 'POST' && method !== 'GET') {
    return json(405, { success: false, message: 'Method Not Allowed' });
  }
  if (!isAuthorized(event)) {
    return json(401, { success: false, message: 'Unauthorized tool call' });
  }

  const raw = readBody(event) || {};
  const input = parseInput(raw);

  const apiKey = String(envValue('CALCOM_API_KEY') || '').trim();
  const eventTypeId = String(envValue('CALCOM_EVENT_TYPE_ID') || '').trim();
  if (!apiKey || !eventTypeId) {
    return json(500, { success: false, message: 'Cal.com ist nicht vollstaendig konfiguriert.' });
  }

  // Input auslesen mit Defaults
  const now = new Date();
  const dateFrom = parseDate(input.date_from) || now;
  const dateTo = parseDate(input.date_to) || new Date(now.getTime() + LOOKAHEAD_DAYS * 86400000);
  const limit = Math.max(1, Math.min(5, Number(input.limit) || MAX_SLOTS_DEFAULT));
  const timePreference = String(input.time_preference || '').trim() || 'any';
  const timezone = String(input.timezone || '').trim() || DEFAULT_TIMEZONE;

  // Nur Europe/Berlin unterstützt
  if (timezone !== DEFAULT_TIMEZONE) {
    return json(400, { success: false, message: 'Nur Zeitzone ' + DEFAULT_TIMEZONE + ' wird unterstützt.' });
  }

  let slotsResult;
  try {
    slotsResult = await calcom.getSlots({ apiKey, eventTypeId, startDate: dateFrom, endDate: dateTo });
  } catch (error) {
    return json(502, { success: false, message: 'Cal.com nicht erreichbar.', detail: String(error && error.message ? error.message : error) });
  }
  if (!slotsResult.ok) {
    return json(502, { success: false, message: 'Freie Zeiten konnten nicht geladen werden.', detail: slotsResult.reason });
  }

  let slots = calcom.pickSlots(slotsResult.byDate, limit, now)
    .map(({ date, time, label }) => ({ date, time, timezone: DEFAULT_TIMEZONE, label }));

  // Nach Zeit-Präferenz filtern
  slots = filterByTimePreference(slots, timePreference);

  if (!slots.length) {
    return json(200, { success: false, status: 'no_slots_available', message: 'Keine passenden freien Zeiten gefunden.' });
  }

  return json(200, { success: true, slots });
};
