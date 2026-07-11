const { envValue, listRows, json, readBody, getTenantSettings } = require('./_lib/tenant');
// Gleicher Fallback wie beim echten Termin-SMS-Versand -> Admin zeigt IMMER den Text, der wirklich gesendet wird.
const DEFAULT_APPOINTMENT_SMS_TEMPLATE = require('./book-appointment').__test.DEFAULT_APPOINTMENT_SMS_TEMPLATE;

function checkAdmin(event, body) {
  const adminSecret = envValue('ADMIN_SECRET').trim();
  const provided = String((event.headers && (event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'])) || (body && body.admin_secret) || '').trim();
  return Boolean(adminSecret) && provided === adminSecret;
}

// ===== HIER Twilio-Minutenpreis eintragen =====
// Twilio rechnet je ANGEFANGENE Minute ab. Trag deinen echten Minutenpreis ein (z. B. 0.07 = 7 Cent).
const TWILIO_RATE_PER_MIN = 0.07;
const RETELL_LIMIT = 500;          // wie viele letzte Anrufe fuer die Kostenrechnung
// ==============================================

// Live-Zahlen + echte Retell-Kosten pro Agent.
async function retellStats(agentId, apiKey) {
  if (!agentId || !apiKey) return { calls: 0, lastAt: null, minutes: 0, retellCost: 0, capped: false };
  try {
    const res = await fetch('https://api.retellai.com/v2/list-calls', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter_criteria: { agent_id: [agentId] }, limit: RETELL_LIMIT, sort_order: 'descending' }),
    });
    const data = await res.json().catch(() => []);
    const calls = Array.isArray(data) ? data : (data.calls || []);
    let minutes = 0;
    let billedMinutes = 0;   // je angefangene Minute aufgerundet (echte Telefonie-Abrechnung)
    let connectedCalls = 0;
    let costCents = 0;
    calls.forEach((c) => {
      const dur = Number(c.duration_ms || 0) / 60000;
      const connected = dur > 0 && ['ended', 'ongoing'].includes(String(c.call_status || ''));
      if (connected) { minutes += dur; billedMinutes += Math.ceil(dur); connectedCalls += 1; }
      const cc = c.call_cost && Number(c.call_cost.combined_cost);
      if (Number.isFinite(cc)) costCents += cc;
    });
    const lastTs = calls.length ? calls[0].start_timestamp : null;
    return {
      calls: calls.length,
      connectedCalls: connectedCalls,
      lastAt: lastTs ? new Date(lastTs).toISOString() : null,
      minutes: minutes,
      billedMinutes: billedMinutes,
      retellCost: costCents / 100, // Retell liefert echte Kosten in Cent
      capped: calls.length >= RETELL_LIMIT,
    };
  } catch (_) {
    return { calls: 0, lastAt: null, minutes: 0, retellCost: 0, capped: false };
  }
}

exports.handler = async (event) => {
  if ((event.httpMethod || 'GET').toUpperCase() !== 'POST') return json(405, { ok: false, message: 'Method Not Allowed' });
  const body = readBody(event) || {};
  if (!checkAdmin(event, body)) return json(401, { ok: false, message: 'Nicht autorisiert.' });

  let tenants;
  try {
    tenants = await listRows('tenants', { select: '*', order: 'created_at.asc' }, { serviceRole: true });
  } catch (e) {
    return json(500, { ok: false, message: 'Kunden konnten nicht geladen werden: ' + String(e && e.message ? e.message : e) });
  }

  const apiKey = envValue('RETELL_API_KEY').trim();
  const withStats = await Promise.all((tenants || []).map(async (t) => {
    const [stats, settings] = await Promise.all([
      retellStats(t.retell_agent_id, apiKey),
      getTenantSettings(t.id, { serviceRole: true }),
    ]);
    // Tatsaechlich aktive SMS-Nachricht = ausschliesslich die in Supabase gespeicherte Vorlage.
    // Kein hartcodierter Standard mehr: leer bedeutet "nicht gesetzt" (dann wird auch nicht gesendet).
    const effectiveSms = String(settings.sms_template || '').trim();

    // Echte Nutzung: Retell = echter Preis pro Anruf, Twilio = abgerechnete Minuten (aufgerundet) x Preis, SMS = echter seven.io-Preis.
    const retellCost = Number(stats.retellCost) || 0;
    const billedMin = Number(stats.billedMinutes) || 0;
    const twilioCost = billedMin * TWILIO_RATE_PER_MIN;
    const smsCount = Number(settings.sms_sent_count) || 0;
    const smsCost = Number(settings.sms_cost_total) || 0;
    const totalCost = retellCost + twilioCost + smsCost;

    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      is_active: t.is_active,
      retell_agent_id: t.retell_agent_id || '',
      retell_from_number: t.retell_from_number || '',
      booking_link_url: t.booking_link_url || '',
      sms_sender: t.sms_sender || '',
      minutes_budget: Number(settings.minutes_budget) || 0,
      sms_enabled: settings.sms_enabled !== false,
      detailed_analysis: Boolean(settings.detailed_analysis),
      append_lead_params: Boolean(settings.append_lead_params),
      sms_template: effectiveSms,
      // Terminbuchung (Cal.com) - im Admin-Terminal bearbeitbar.
      booking_enabled: settings.booking_enabled === true,
      sms_appointment_template: String(settings.sms_appointment_template || '').trim() || DEFAULT_APPOINTMENT_SMS_TEMPLATE,
      calcom_api_key: String(settings.calcom_api_key || ''),
      calcom_event_type_id: String(settings.calcom_event_type_id || ''),
      stats: stats,
      cost: {
        minutes: Number(stats.minutes) || 0,
        billed_minutes: billedMin,
        connected_calls: Number(stats.connectedCalls) || 0,
        twilio_rate: TWILIO_RATE_PER_MIN,
        retell: retellCost,
        twilio: twilioCost,
        sms_count: smsCount,
        sms: smsCost,
        total: totalCost,
        capped: Boolean(stats.capped),
      },
    };
  }));

  return json(200, { ok: true, customers: withStats });
};
