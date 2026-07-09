// Retell Custom Tool: echte freie Cal.com-Zeiten liefern (aktuell nur Tawano).
//
// Liefert maximal 2 wirklich freie Slots (07–20 Uhr, Mo–So, Europe/Berlin) im
// einfachen Format { success, slots: [{ date, time, label }] }.
// Keine Zufallszeiten – ausschliesslich das, was Cal.com als frei meldet.

const { envValue, json, readBody } = require('./_lib/tenant');
const calcom = require('./_lib/calcom');

const LOOKAHEAD_DAYS = 14;
const MAX_SLOTS = 2;

function isAuthorized(event) {
  const expected = envValue('RETELL_TOOL_SECRET').trim();
  if (!expected) return true;
  const headers = event.headers || {};
  const incoming = String(headers['x-retell-tool-secret'] || headers['X-Retell-Tool-Secret'] || '').trim();
  return incoming && incoming === expected;
}

exports.handler = async (event) => {
  const method = (event.httpMethod || 'GET').toUpperCase();
  if (method !== 'POST' && method !== 'GET') {
    return json(405, { success: false, message: 'Method Not Allowed' });
  }
  if (!isAuthorized(event)) {
    return json(401, { success: false, message: 'Unauthorized tool call' });
  }

  const apiKey = String(envValue('CALCOM_API_KEY') || '').trim();
  const eventTypeId = String(envValue('CALCOM_EVENT_TYPE_ID') || '').trim();
  if (!apiKey || !eventTypeId) {
    return json(500, { success: false, message: 'Cal.com ist nicht vollstaendig konfiguriert.' });
  }

  const now = new Date();
  const endDate = new Date(now.getTime() + LOOKAHEAD_DAYS * 86400000);

  let slotsResult;
  try {
    slotsResult = await calcom.getSlots({ apiKey, eventTypeId, startDate: now, endDate });
  } catch (error) {
    return json(502, { success: false, message: 'Cal.com nicht erreichbar.', detail: String(error && error.message ? error.message : error) });
  }
  if (!slotsResult.ok) {
    return json(502, { success: false, message: 'Freie Zeiten konnten nicht geladen werden.', detail: slotsResult.reason });
  }

  const slots = calcom.pickSlots(slotsResult.byDate, MAX_SLOTS, now)
    .map(({ date, time, label }) => ({ date, time, label }));

  return json(200, { success: true, slots });
};
