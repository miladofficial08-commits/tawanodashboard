const { envValue, listRows, json, readBody, getTenantSettings } = require('./_lib/tenant');

// Muss zum Wert in admin-list-customers.js passen.
const TWILIO_RATE_PER_MIN = 0.07;

function checkAdmin(event, body) {
  const adminSecret = envValue('ADMIN_SECRET').trim();
  const provided = String((event.headers && (event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'])) || (body && body.admin_secret) || '').trim();
  return Boolean(adminSecret) && provided === adminSecret;
}

exports.handler = async (event) => {
  if ((event.httpMethod || 'GET').toUpperCase() !== 'POST') return json(405, { ok: false, message: 'Method Not Allowed' });
  const body = readBody(event) || {};
  if (!checkAdmin(event, body)) return json(401, { ok: false, message: 'Nicht autorisiert.' });

  const apiKey = envValue('RETELL_API_KEY').trim();
  if (!apiKey) return json(500, { ok: false, message: 'RETELL_API_KEY fehlt.' });

  // 1) Alle letzten Anrufe holen und NACH TELEFONNUMMER (from_number) gruppieren.
  let calls = [];
  try {
    const res = await fetch('https://api.retellai.com/v2/list-calls', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 1000, sort_order: 'descending' }),
    });
    const data = await res.json().catch(() => []);
    calls = Array.isArray(data) ? data : (data.calls || []);
  } catch (e) {
    return json(502, { ok: false, message: 'Anrufe konnten nicht geladen werden: ' + String(e && e.message ? e.message : e) });
  }

  const byNum = {};
  calls.forEach((c) => {
    const num = String(c.from_number || 'unbekannt');
    if (!byNum[num]) byNum[num] = { number: num, connected: 0, billedMin: 0, retellCents: 0, lastAt: null };
    const dur = Number(c.duration_ms || 0) / 60000;
    const connected = dur > 0 && ['ended', 'ongoing'].includes(String(c.call_status || ''));
    if (connected) { byNum[num].connected += 1; byNum[num].billedMin += Math.ceil(dur); }
    const cc = c.call_cost && Number(c.call_cost.combined_cost);
    if (Number.isFinite(cc)) byNum[num].retellCents += cc;
    if (!byNum[num].lastAt && c.start_timestamp) byNum[num].lastAt = c.start_timestamp;
  });

  // 2) Kunden-Namen + SMS-Kosten je Nummer ergaenzen.
  const smsByNum = {};
  const namesByNum = {};
  try {
    const tenants = await listRows('tenants', { select: '*' }, { serviceRole: true });
    for (const t of tenants) {
      const num = String(t.retell_from_number || '').trim();
      if (!num) continue;
      const s = await getTenantSettings(t.id, { serviceRole: true });
      smsByNum[num] = (smsByNum[num] || 0) + (Number(s.sms_cost_total) || 0);
      (namesByNum[num] = namesByNum[num] || []).push(t.name);
    }
  } catch (_) { /* optional */ }

  let numbers = Object.keys(byNum).map((num) => {
    const n = byNum[num];
    const twilio = n.billedMin * TWILIO_RATE_PER_MIN;
    const retell = n.retellCents / 100;
    const sms = smsByNum[num] || 0;
    return {
      number: num,
      customers: namesByNum[num] || [],
      connected_calls: n.connected,
      billed_minutes: n.billedMin,
      twilio_rate: TWILIO_RATE_PER_MIN,
      twilio: twilio,
      retell: retell,
      sms: sms,
      total: twilio + retell + sms,
      last_at: n.lastAt ? new Date(n.lastAt).toISOString() : null,
    };
  });

  // Nur echte Kunden-Nummern zeigen ("unbekannt" und nicht zugeordnete Nummern raus).
  numbers = numbers.filter((n) => (n.customers || []).length > 0).sort((a, b) => b.total - a.total);

  // Gesamtsumme ueber alle Kunden-Nummern.
  const totals = numbers.reduce((a, n) => ({
    total: a.total + n.total, twilio: a.twilio + n.twilio, retell: a.retell + n.retell,
    sms: a.sms + n.sms, calls: a.calls + n.connected_calls, minutes: a.minutes + n.billed_minutes,
  }), { total: 0, twilio: 0, retell: 0, sms: 0, calls: 0, minutes: 0 });

  return json(200, { ok: true, numbers, totals, based_on_calls: calls.length });
};
