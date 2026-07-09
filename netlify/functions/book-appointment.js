// Retell Custom Tool: Termin über Cal.com buchen (aktuell nur Tawano).
// Input robust auslesen, Slot validieren, SMS nach Buchung senden.

const {
  envValue, insertRow, json, readBody, resolveTenantFromToolBody, getTenantSettings,
} = require('./_lib/tenant');
const { deliverSms } = require('./_lib/sms');
const calcom = require('./_lib/calcom');

const DEFAULT_TIMEZONE = 'Europe/Berlin';
const DEFAULT_SMS_FROM = 'Tawano';
const DEFAULT_APPOINTMENT_SMS_TEMPLATE =
  'Danke für Ihren Testanruf. Ihr kurzes Gespräch mit dem Tawano Team ist für {appointment_date} um {appointment_time} vorgemerkt. Wir zeigen Ihnen, wie ein digitaler Telefonmitarbeiter für Ihren Betrieb aussehen könnte. Weitere Infos: https://tawano.de/voice-agents/';

function isRealPhone(value) {
  const s = String(value || '').trim();
  if (!s || /[<>{}]/.test(s)) return false;
  return s.replace(/\D/g, '').length >= 7;
}

function isAuthorized(event) {
  const expected = envValue('RETELL_TOOL_SECRET').trim();
  if (!expected) return true;
  const headers = event.headers || {};
  const incoming = String(headers['x-retell-tool-secret'] || headers['X-Retell-Tool-Secret'] || '').trim();
  return incoming && incoming === expected;
}

// Robust Input-Parsing: args, arguments, oder direktes body
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

function parseTime(timeStr) {
  if (!timeStr) return null;
  const m = String(timeStr).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { hour: h, minute: min };
}

function isTavanoContext(tenant) {
  if (!tenant) return false;
  const haystack = [tenant.id, tenant.slug, tenant.name, tenant.sms_sender]
    .map((v) => String(v || '').toLowerCase()).join(' ');
  return /tavano|tawano/.test(haystack);
}

exports.handler = async (event) => {
  if ((event.httpMethod || 'GET').toUpperCase() !== 'POST') {
    return json(405, { success: false, message: 'Method Not Allowed' });
  }
  if (!isAuthorized(event)) {
    return json(401, { success: false, message: 'Unauthorized tool call' });
  }

  const raw = readBody(event);
  if (!raw) return json(400, { success: false, message: 'Invalid JSON body' });

  const input = parseInput(raw);

  // Erforderliche Felder ermitteln
  const dateVal = String(input.date || input.appointment_date || '').trim();
  const timeVal = String(input.time || input.appointment_time || '').trim();
  let phone = String(input.phone_number || input.phoneNumber || input.phone || input.confirmed_mobile_number || '').trim();

  // Phone aus Retell call fallback
  const callInfo = (raw.call && typeof raw.call === 'object') ? raw.call : {};
  if (!isRealPhone(phone) && callInfo.from_number) phone = callInfo.from_number;
  if (!isRealPhone(phone) && callInfo.to_number) phone = callInfo.to_number;

  // Validation: Pflichtfelder
  const missing = [];
  if (!dateVal) missing.push('date');
  if (!timeVal) missing.push('time');
  if (!isRealPhone(phone)) missing.push('phone_number');
  if (missing.length) {
    return json(400, { success: false, status: 'missing_required_fields', missing });
  }

  // Datum + Zeit parsen
  const dateStr = dateVal.match(/^\d{4}-\d{2}-\d{2}$/);
  const timeStr = timeVal.match(/^(\d{1,2}):(\d{2})$/);
  if (!dateStr || !timeStr) {
    return json(400, { success: false, status: 'invalid_time_format', message: 'Datum (YYYY-MM-DD) und Uhrzeit (HH:mm) erforderlich.' });
  }
  const y = Number(dateStr[0].slice(0, 4));
  const mo = Number(dateStr[0].slice(5, 7));
  const d = Number(dateStr[0].slice(8, 10));
  const h = Number(timeStr[1]);
  const mi = Number(timeStr[2]);
  if (h > 23 || mi > 59) {
    return json(400, { success: false, status: 'invalid_time_format', message: 'Ungueltige Uhrzeit.' });
  }

  // Berliner Ortszeit → UTC
  const startDate = calcom.berlinWallClockToUtc(y, mo, d, h, mi);

  // Slot validieren (07–20 Uhr, nicht Vergangenheit)
  const slotCheck = calcom.validateSlot(startDate, new Date());
  if (!slotCheck.ok) {
    return json(200, { success: false, status: 'slot_rejected', message: slotCheck.reason });
  }

  // Tenant + Cal.com Config
  const tenantContext = await resolveTenantFromToolBody(input);
  const tenant = tenantContext.tenant;
  if (!isTavanoContext(tenant)) {
    return json(403, { success: false, message: 'Terminbuchung ist fuer diesen Kunden nicht aktiviert.' });
  }

  let tSettings = {};
  try { tSettings = await getTenantSettings(tenant && tenant.id, { serviceRole: true }); } catch (_) { }

  const apiKey = String(tSettings.calcom_api_key || envValue('CALCOM_API_KEY') || '').trim();
  const eventTypeId = String(tSettings.calcom_event_type_id || envValue('CALCOM_EVENT_TYPE_ID') || '').trim();
  if (!apiKey || !eventTypeId) {
    return json(500, { success: false, message: 'Cal.com nicht konfiguriert.' });
  }

  const startISO = startDate.toISOString();

  // Cal.com buchen
  const customerName = String(input.customer_name || input.name || '').trim() || 'Interessent';
  const emailInput = String(input.email || '').trim();
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput)
    ? emailInput
    : (phone ? phone.replace(/\D/g, '') + '@tawano.de' : 'termin@tawano.de');

  let bookingResult;
  try {
    bookingResult = await calcom.createBooking({
      apiKey,
      eventTypeId,
      startISO,
      attendee: {
        name: customerName,
        email,
        phoneNumber: isRealPhone(phone) ? phone : undefined,
        timeZone: DEFAULT_TIMEZONE,
        language: 'de',
      },
      metadata: {
        source: 'tawano_voice_agent',
        call_id: String(input.retell_call_id || input.call_id || '').trim() || undefined,
        tenant_id: String((tenant && tenant.id) || '').trim() || undefined,
      },
    });
  } catch (error) {
    return json(502, {
      success: false,
      status: 'calcom_error',
      message: 'Terminbuchung fehlgeschlagen.',
      detail: String(error && error.message ? error.message : error),
    });
  }

  if (!bookingResult.ok) {
    return json(200, { success: false, status: 'slot_unavailable', message: 'Dieser Zeitpunkt ist leider nicht mehr frei.' });
  }

  const booking = bookingResult.booking;

  // Buchung merken (tavano_bookings) → unterbindet Standard-SMS
  try {
    await insertRow('tavano_bookings', {
      tenant_id: (tenant && tenant.id) || null,
      call_id: String(input.retell_call_id || input.call_id || '').trim() || null,
      phone_number: isRealPhone(phone) ? phone : null,
      customer_name: customerName || null,
      email: emailInput || null,
      calcom_booking_uid: booking.uid || null,
      calcom_event_type_id: eventTypeId || null,
      start_time: startDate.toISOString(),
      end_time: booking.end || null,
      meeting_url: booking.meetingUrl || null,
      status: 'booked',
      source: 'voice_agent',
    }, { serviceRole: true });
  } catch (_) { /* optional */ }

  // SMS mit Call-Details
  const appointmentDate = calcom.formatBerlinDate(startDate);
  const appointmentTime = calcom.formatBerlinTime(startDate);
  const template = String(tSettings.sms_appointment_template || '').trim() || DEFAULT_APPOINTMENT_SMS_TEMPLATE;
  const message = String(template)
    .replaceAll('{appointment_date}', appointmentDate)
    .replaceAll('{appointment_time}', appointmentTime);

  const smsSender = String(tSettings.sms_sender || (tenant && tenant.sms_sender) || '').trim() || DEFAULT_SMS_FROM;

  let smsResult = { sent: false, message: 'SMS deaktiviert.' };
  if (tSettings.sms_enabled !== false && isRealPhone(phone)) {
    try {
      smsResult = await deliverSms({
        to: phone,
        message,
        sms_sender: smsSender,
        tenant_id: (tenant && tenant.id) || null,
        customer_name: customerName,
        retell_agent_id: String(input.agent_id || input.retell_agent_id || (tenant && tenant.retell_agent_id) || '').trim() || null,
        call_id: String(input.retell_call_id || input.call_id || '').trim() || null,
      });
    } catch (error) {
      smsResult = { sent: false, message: 'SMS fehler: ' + String(error && error.message ? error.message : error) };
    }
  }

  return json(200, {
    success: true,
    status: 'booked',
    date: appointmentDate,
    time: appointmentTime,
    timezone: DEFAULT_TIMEZONE,
    meeting_link: booking.meetingUrl || null,
    booking_details: {
      uid: booking.uid,
      customer_name: customerName,
      email,
      phone,
    },
    sms: { sent: Boolean(smsResult.sent), detail: smsResult.message },
  });
};

exports.__test = {
  DEFAULT_APPOINTMENT_SMS_TEMPLATE,
  isTavanoContext,
};
