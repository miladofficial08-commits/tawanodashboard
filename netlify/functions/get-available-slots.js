// Retell Custom Tool: echte freie Cal.com-Zeiten liefern (aktuell nur Tawano).
//
// Liefert maximal 2 wirklich freie Slots (07–20 Uhr, Mo–So, Europe/Berlin) im
// einfachen Format { success, slots: [{ date, time, label }] }.
// Keine Zufallszeiten – ausschliesslich das, was Cal.com als frei meldet.

const { envValue, json, readBody, resolveTenantFromToolBody, getTenantSettings } = require('./_lib/tenant');
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

// Filtert rohe Cal.com-Zeitpunkte vor der Tagesauswahl. So wird pro Tag der
// frueheste Slot innerhalb der gewuenschten Tageszeit gewaehlt.
function filterRawSlotsByTimePreference(byDate, preference) {
  if (!preference || preference === 'any') return byDate;
  const pref = String(preference).toLowerCase();
  const result = {};
  Object.keys(byDate || {}).forEach((day) => {
    const matches = (byDate[day] || []).filter((date) => {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: DEFAULT_TIMEZONE, hour12: false, hour: '2-digit', minute: '2-digit',
      }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
      const mins = Number(parts.hour) * 60 + Number(parts.minute);
      if (pref === 'morning') return mins >= 7 * 60 && mins < 12 * 60;
      if (pref === 'afternoon') return mins >= 12 * 60 && mins < 17 * 60;
      if (pref === 'evening') return mins >= 17 * 60 && mins <= 20 * 60;
      return false;
    });
    if (matches.length) result[day] = matches;
  });
  return result;
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

  // Dieselbe tenant-spezifische Cal.com-Konfiguration wie book-appointment verwenden.
  // So koennen Suche und Buchung niemals versehentlich verschiedene Kalender nutzen.
  const tenantContext = await resolveTenantFromToolBody(input);
  const tenant = tenantContext.tenant;
  let tSettings = {};
  try { tSettings = await getTenantSettings(tenant && tenant.id, { serviceRole: true }); } catch (_) { }

  const apiKey = String(tSettings.calcom_api_key || envValue('CALCOM_API_KEY') || '').trim();
  const eventTypeId = String(tSettings.calcom_event_type_id || envValue('CALCOM_EVENT_TYPE_ID') || '').trim();
  if (!apiKey || !eventTypeId) {
    return json(500, { success: false, message: 'Cal.com ist fuer diesen Kunden nicht vollstaendig konfiguriert.' });
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

  // Mehr Kandidaten holen und erst nach der Zeitpraeferenz auf das gewuenschte
  // Limit kuerzen. Sonst koennen z. B. zwei Vormittagsslots die vorhandenen
  // Nachmittagsslots verdraengen und faelschlich "keine Termine" erzeugen.
  const preferredByDate = filterRawSlotsByTimePreference(slotsResult.byDate, timePreference);
  let slots = calcom.pickSlots(preferredByDate, limit, now)
    .map(({ date, time, label }) => ({ date, time, timezone: DEFAULT_TIMEZONE, label }));

  if (!slots.length) {
    return json(200, { success: false, status: 'no_slots_available', message: 'Keine passenden freien Zeiten gefunden.' });
  }

  return json(200, { success: true, slots });
};
