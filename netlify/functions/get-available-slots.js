// Retell Custom Tool: echte freie Cal.com-Zeiten liefern (aktuell nur Tawano).
//
// Liefert bis zu MAX_SLOTS_DEFAULT wirklich freie Slots (07–20 Uhr, Mo–So,
// Europe/Berlin) im Format { success, slots: [{ date, time, label }] }.
// Keine Zufallszeiten – ausschliesslich das, was Cal.com als frei meldet.
//
// WICHTIG: Bei einer Zeit-Praeferenz (z. B. "nachmittags") werden MEHRERE Slots
// AM SELBEN Tag geliefert (z. B. 14:00, 15:00, 16:00), nicht nur der frueheste
// pro Tag. Sonst kann der Agent Nachmittags-Termine nicht korrekt aufzaehlen.

const { envValue, json, readBody, resolveTenantFromToolBody, getTenantSettings } = require('./_lib/tenant');
const calcom = require('./_lib/calcom');
const { isAuthorizedToolRequest } = require('./_lib/retell-auth');
const { selectCalendarConfig } = require('./_lib/calendar-config');

const LOOKAHEAD_DAYS = 14;
const MAX_SLOTS_DEFAULT = 3;
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

// Flach ueber ALLE Tage: nimmt mehrere Slots (auch am selben Tag) in
// chronologischer Reihenfolge. So kann der Agent z. B. drei Nachmittags-
// Termine desselben Tages nennen, statt nur den fruehesten pro Tag.
function pickSlotsFlat(byDate, limit, now, matchFn) {
  const reference = now instanceof Date ? now : new Date();
  const all = [];
  Object.keys(byDate || {}).sort().forEach((day) => {
    (byDate[day] || []).forEach((d) => {
      if (!(d instanceof Date) || Number.isNaN(d.getTime())) return;
      if (d.getTime() < reference.getTime()) return;
      if (!calcom.validateSlot(d, reference).ok) return;
      if (typeof matchFn === 'function' && !matchFn(d)) return;
      all.push(d);
    });
  });
  all.sort((a, b) => a.getTime() - b.getTime());
  const max = Math.max(1, Number(limit) || 3);
  // Slots SPREIZEN statt aufeinanderfolgend: mind. ~1 Stunde Abstand, damit der Agent
  // natuerliche Optionen nennt (z. B. 14, 15, 16 Uhr) statt 12:00/12:15/12:30.
  const MIN_GAP_MS = 60 * 60 * 1000;
  const chosen = [];
  for (const d of all) {
    if (chosen.length >= max) break;
    if (!chosen.length || (d.getTime() - chosen[chosen.length - 1].getTime()) >= MIN_GAP_MS) chosen.push(d);
  }
  // Falls das Zeitfenster zu schmal fuer den Abstand war, mit den naechstbesten auffuellen.
  if (chosen.length < max) {
    for (const d of all) {
      if (chosen.length >= max) break;
      if (!chosen.includes(d)) chosen.push(d);
    }
    chosen.sort((a, b) => a.getTime() - b.getTime());
  }
  return chosen.map((slot) => ({
    date: calcom.berlinDateKey(slot),
    time: calcom.formatBerlinTime(slot),
    label: calcom.formatBerlinWeekday(slot) + ' um ' + calcom.formatBerlinSpokenTime(slot),
    start: slot.toISOString(),
  }));
}

// Robuste Uhrzeit-Erkennung: akzeptiert "15", "15:00", "15.30", "15 Uhr", "1500".
function parseTimeToMinutes(value) {
  const s = String(value || '').trim().toLowerCase().replace(/\s*uhr\s*/g, '').trim();
  let m = s.match(/^(\d{1,2})[:.](\d{2})$/);
  if (m && Number(m[1]) <= 23 && Number(m[2]) <= 59) return Number(m[1]) * 60 + Number(m[2]);
  m = s.match(/^(\d{1,2})$/);
  if (m && Number(m[1]) <= 23) return Number(m[1]) * 60;
  m = s.match(/^(\d{1,2})(\d{2})$/);
  if (m && Number(m[1]) <= 23 && Number(m[2]) <= 59) return Number(m[1]) * 60 + Number(m[2]);
  return null;
}

function pickSlotsByPreference(byDate, limit, now, preference) {
  const pref = normalizeTimePreference(preference);
  // Ohne Praeferenz: pro Tag der frueheste Slot ueber mehrere Tage (Abwechslung).
  if (pref === 'any') return calcom.pickSlots(byDate, limit, now);
  // Mit Praeferenz: mehrere passende Slots (auch am selben Tag) chronologisch.
  return pickSlotsFlat(byDate, limit, now, (date) => (
    filterByTimePreference([{ time: calcom.formatBerlinTime(date) }], pref).length > 0
  ));
}

function pickSlotsForRequestedTime(byDate, limit, now, requestedTime) {
  const targetMinutes = parseTimeToMinutes(requestedTime);
  if (targetMinutes == null) return [];
  const exact = {};
  const nearest = {};
  Object.entries(byDate || {}).forEach(([day, dates]) => {
    const sorted = (dates || []).slice().sort((a, b) => {
      const minutes = (date) => {
        const [h, m] = calcom.formatBerlinTime(date).split(':').map(Number);
        return h * 60 + m;
      };
      return Math.abs(minutes(a) - targetMinutes) - Math.abs(minutes(b) - targetMinutes);
    });
    const matching = sorted.filter((date) => {
      const [hh, mm] = calcom.formatBerlinTime(date).split(':').map(Number);
      return hh * 60 + mm === targetMinutes;
    });
    if (matching.length) exact[day] = matching;
    if (sorted.length) nearest[day] = sorted;
  });
  return calcom.pickSlots(Object.keys(exact).length ? exact : nearest, limit, now);
}

function pickSlotsInTimeRange(byDate, limit, now, timeFrom, timeTo) {
  const from = parseTimeToMinutes(timeFrom);
  const to = parseTimeToMinutes(timeTo);
  if (from == null || to == null || to < from) return [];
  return pickSlotsFlat(byDate, limit, now, (date) => {
    const [hour, minute] = calcom.formatBerlinTime(date).split(':').map(Number);
    const value = hour * 60 + minute;
    return value >= from && value <= to;
  });
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
  const requestedTime = String(input.preferred_time || input.requested_time || '').trim();
  const timeFrom = String(input.time_from || '').trim();
  const timeTo = String(input.time_to || '').trim();
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

  const selected = timeFrom && timeTo
    ? pickSlotsInTimeRange(slotsResult.byDate, limit, now, timeFrom, timeTo)
    : (requestedTime
      ? pickSlotsForRequestedTime(slotsResult.byDate, limit, now, requestedTime)
      : pickSlotsByPreference(slotsResult.byDate, limit, now, timePreference));
  const slots = selected
    .map(({ date, time, label }) => ({ date, time, timezone: DEFAULT_TIMEZONE, label }));

  // Nach Zeit-Präferenz filtern
  if (!slots.length) {
    return json(200, { success: false, status: 'no_slots_available', message: 'Keine passenden freien Zeiten gefunden.' });
  }

  return json(200, { success: true, slots });
};

exports.__test = { filterByTimePreference, normalizeTimePreference, pickSlotsByPreference, pickSlotsForRequestedTime, pickSlotsInTimeRange, pickSlotsFlat, parseTimeToMinutes };
