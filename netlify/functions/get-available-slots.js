// Retell Custom Tool: echte freie Cal.com-Zeiten liefern (aktuell nur Tawano).
//
// Liefert maximal 2 wirklich freie Slots (07–20 Uhr, Mo–So, Europe/Berlin) im
// einfachen Format { success, slots: [{ date, time, label }] }.
// Keine Zufallszeiten – ausschliesslich das, was Cal.com als frei meldet.

const { envValue, json, readBody, resolveTenantFromToolBody, getTenantSettings } = require('./_lib/tenant');
const calcom = require('./_lib/calcom');
const { isAuthorizedToolRequest } = require('./_lib/retell-auth');
const { selectCalendarConfig } = require('./_lib/calendar-config');

const LOOKAHEAD_DAYS = 14;
const MAX_SLOTS_DEFAULT = 2;
const DEFAULT_TIMEZONE = 'Europe/Berlin';

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
function normalizeTimePreference(value) {
  const key = String(value || '').trim().toLowerCase();
  const aliases = {
    morning: 'morning', morgens: 'morning', vormittag: 'morning', vormittags: 'morning',
    afternoon: 'afternoon', nachmittag: 'afternoon', nachmittags: 'afternoon',
    evening: 'evening', abend: 'evening', abends: 'evening',
    any: 'any', egal: 'any', beliebig: 'any',
  };
  return aliases[key] || 'any';
}

function filterByTimePreference(slots, preference) {
  const pref = normalizeTimePreference(preference);
  if (pref === 'any') return slots;
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

function pickSlotsByPreference(byDate, limit, now, preference) {
  const pref = normalizeTimePreference(preference);
  if (pref === 'any') return calcom.pickSlots(byDate, limit, now);
  const filtered = {};
  Object.entries(byDate || {}).forEach(([day, dates]) => {
    const matching = (dates || []).filter((date) => {
      return filterByTimePreference([{ time: calcom.formatBerlinTime(date) }], pref).length > 0;
    });
    if (matching.length) filtered[day] = matching;
  });
  return calcom.pickSlots(filtered, limit, now);
}

exports.handler = async (event) => {
  const method = (event.httpMethod || 'GET').toUpperCase();
  if (method !== 'POST' && method !== 'GET') {
    return json(405, { success: false, message: 'Method Not Allowed' });
  }
  if (!isAuthorizedToolRequest(event)) {
    return json(401, { success: false, message: 'Unauthorized tool call' });
  }

  const raw = readBody(event) || {};
  const input = parseInput(raw);

  const tenantContext = await resolveTenantFromToolBody(input);
  const tenant = tenantContext.tenant;
  const settings = await getTenantSettings(tenant && tenant.id, { serviceRole: true });
  const calendar = selectCalendarConfig({
    tenant,
    settings,
    globalApiKey: envValue('CALCOM_API_KEY'),
    globalEventTypeId: envValue('CALCOM_EVENT_TYPE_ID'),
  });
  if (!calendar.bookingEnabled) {
    return json(403, { success: false, status: 'booking_disabled', message: 'Terminbuchung ist fuer diesen Kunden nicht aktiviert.' });
  }
  const apiKey = calendar.apiKey;
  const eventTypeId = calendar.eventTypeId;
  if (!apiKey || !eventTypeId) {
    return json(500, { success: false, message: 'Cal.com ist nicht vollstaendig konfiguriert.' });
  }

  // Input auslesen mit Defaults
  const now = new Date();
  const todayMidnightUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let dateFrom = parseDate(input.date_from) || now;
  // Schutz vor halluziniertem/veraltetem Datum (z. B. wenn dem Agent current_date fehlt und er
  // "2024-06-12" erfindet): niemals in der Vergangenheit suchen -> auf heute anheben.
  if (dateFrom < todayMidnightUtc) dateFrom = now;
  let dateTo = parseDate(input.date_to) || new Date(dateFrom.getTime() + LOOKAHEAD_DAYS * 86400000);
  // date_to darf nicht vor date_from liegen (sonst liefert Cal.com nichts).
  if (dateTo <= dateFrom) dateTo = new Date(dateFrom.getTime() + LOOKAHEAD_DAYS * 86400000);
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

  const slots = pickSlotsByPreference(slotsResult.byDate, limit, now, timePreference)
    .map(({ date, time, label }) => ({ date, time, timezone: DEFAULT_TIMEZONE, label }));

  // Nach Zeit-Präferenz filtern
  if (!slots.length) {
    return json(200, { success: false, status: 'no_slots_available', message: 'Keine passenden freien Zeiten gefunden.' });
  }

  return json(200, { success: true, slots });
};

exports.__test = { filterByTimePreference, normalizeTimePreference, pickSlotsByPreference };
