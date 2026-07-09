// Retell Custom Tool: Termin ueber Cal.com buchen (aktuell nur Tawano).
//
// Ablauf, wenn der Voice Agent Interesse erkennt und einen Termin vereinbart:
//   1) Zeitpunkt pruefen (07–20 Uhr, Mo–So, Europe/Berlin)
//   2) Termin in Cal.com buchen
//   3) Buchung merken (tavano_bookings) -> unterdrueckt die Standard-SMS
//   4) EIGENE Call-Details-SMS senden (statt "Danke fuers Gespraech")
//
// Wurde KEIN Termin gebucht, ruft der Agent dieses Tool nicht auf und die
// bestehende send-booking-link.js verschickt wie gehabt die normale SMS.

const {
  envValue, insertRow, json, readBody, resolveTenantFromToolBody, getTenantSettings,
} = require('./_lib/tenant');
const { deliverSms } = require('./_lib/sms');
const calcom = require('./_lib/calcom');

// ============================================================
//  HIER ANPASSEN — Text der Call-Details-SMS (Termin bestaetigt).
//  Platzhalter: {customer_name}, {appointment_date}, {appointment_time}, {meeting_link}
// ============================================================
const DEFAULT_APPOINTMENT_SMS_TEMPLATE =
  'Ihr Termin bei Tawano ist bestätigt.\n\n'
  + 'Termin: {appointment_date} um {appointment_time} Uhr\n\n'
  + '{meeting_link}Wir melden uns zum vereinbarten Zeitpunkt und zeigen Ihnen konkret, wie Ihr digitaler Mitarbeiter aufgebaut wird und welche Anrufe er künftig für Sie übernimmt.\n\n'
  + 'Bis dahin!\nIhr Tawano Team';

const DEFAULT_SMS_FROM = 'Tawano';
// ============================================================

function isRealPhone(value) {
  const s = String(value || '').trim();
  if (!s || /[<>{}]/.test(s)) return false;
  return s.replace(/\D/g, '').length >= 7;
}

function callerFrom(c) {
  if (!c) return '';
  const dir = String(c.direction || '').toLowerCase();
  return String((dir === 'outbound' ? c.to_number : c.from_number) || c.from_number || c.to_number || '').trim();
}

function calledBusinessNumberFrom(c) {
  if (!c) return '';
  const dir = String(c.direction || '').toLowerCase();
  return String((dir === 'outbound' ? c.from_number : c.to_number) || c.to_number || c.from_number || '').trim();
}

// Nur fuer Tawano freigeschaltet.
function isTavanoContext(tenant, calledNumber) {
  const haystack = [tenant && tenant.id, tenant && tenant.slug, tenant && tenant.name, tenant && tenant.sms_sender]
    .map((v) => String(v || '').toLowerCase()).join(' ');
  if (/tavano|tawano/.test(haystack)) return true;
  const digits = String(calledNumber || '').replace(/\D/g, '');
  return digits.endsWith('4921186943411');
}

function isAuthorized(event) {
  const expected = envValue('RETELL_TOOL_SECRET').trim();
  if (!expected) return true;
  const headers = event.headers || {};
  const incoming = String(headers['x-retell-tool-secret'] || headers['X-Retell-Tool-Secret'] || '').trim();
  return incoming && incoming === expected;
}

exports.handler = async (event) => {
  if ((event.httpMethod || 'GET').toUpperCase() !== 'POST') {
    return json(405, { ok: false, message: 'Method Not Allowed' });
  }
  if (!isAuthorized(event)) {
    return json(401, { ok: false, message: 'Unauthorized tool call' });
  }

  const raw = readBody(event);
  if (!raw) return json(400, { ok: false, message: 'Invalid JSON body' });

  // Retell schickt je nach Einstellung { call, args:{...} } ODER die Felder direkt.
  const args = (raw.args && typeof raw.args === 'object') ? raw.args
    : ((raw.arguments && typeof raw.arguments === 'object') ? raw.arguments : {});
  const callInfo = (raw.call && typeof raw.call === 'object') ? raw.call : {};
  const body = Object.assign({}, raw, args);
  if (!body.call_id && callInfo.call_id) body.call_id = callInfo.call_id;
  if (!body.agent_id && callInfo.agent_id) body.agent_id = callInfo.agent_id;

  // Telefonnummer des Anrufers ermitteln (KI-Platzhalter verwerfen).
  let phone = String(body.phone_number || body.phoneNumber || body.phone || '').trim();
  if (!isRealPhone(phone)) phone = callerFrom(callInfo);

  const tenantContext = await resolveTenantFromToolBody(body);
  const tenant = tenantContext.tenant;
  if (!isRealPhone(phone)) phone = callerFrom(tenantContext.call);

  const calledNumber = String(
    body.called_number || body.system_number || body.systemNumber
    || calledBusinessNumberFrom(callInfo)
    || calledBusinessNumberFrom(tenantContext.call)
    || (tenant && tenant.retell_from_number) || ''
  ).trim();

  if (!isTavanoContext(tenant, calledNumber)) {
    return json(403, { ok: false, message: 'Terminbuchung ist fuer diesen Kunden nicht aktiviert.' });
  }

  // Konfiguration: Tenant-Einstellungen koennen env-Werte ueberschreiben.
  let tSettings = {};
  try { tSettings = await getTenantSettings(tenant && tenant.id, { serviceRole: true }); } catch (_) { tSettings = {}; }

  const apiKey = String(tSettings.calcom_api_key || envValue('CALCOM_API_KEY') || '').trim();
  const eventTypeId = String(tSettings.calcom_event_type_id || envValue('CALCOM_EVENT_TYPE_ID') || '').trim();
  if (!apiKey || !eventTypeId) {
    return json(500, { ok: false, message: 'Cal.com ist nicht vollstaendig konfiguriert (API-Key/Event-Type fehlt).' });
  }

  // Zeitpunkt aufloesen + validieren.
  const resolved = calcom.resolveStart(body);
  if (!resolved.ok) {
    return json(400, { success: false, ok: false, status: 'invalid_time', message: resolved.reason });
  }
  const slot = calcom.validateSlot(resolved.date, new Date());
  if (!slot.ok) {
    return json(200, { success: false, ok: false, status: 'slot_rejected', message: slot.reason });
  }

  const name = String(body.customer_name || body.customerName || body.name || '').trim();
  const emailInput = String(body.email || '').trim();
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput)
    ? emailInput
    : (phone ? phone.replace(/\D/g, '') + '@voice.tawano.de' : 'termin@voice.tawano.de');
  const startISO = resolved.date.toISOString();

  // Cal.com buchen.
  let bookingResult;
  try {
    bookingResult = await calcom.createBooking({
      apiKey,
      eventTypeId,
      startISO,
      attendee: {
        name: name || 'Interessent',
        email,
        phoneNumber: isRealPhone(phone) ? phone : undefined,
        timeZone: calcom.CAL_TIMEZONE,
        language: 'de',
      },
      metadata: {
        source: 'tawano_voice_agent',
        call_id: String(body.call_id || '').trim() || undefined,
        tenant_id: String((tenant && tenant.id) || '').trim() || undefined,
      },
    });
  } catch (error) {
    return json(502, {
      success: false,
      ok: false,
      status: 'calcom_error',
      message: 'Terminbuchung fehlgeschlagen. Bitte einen anderen Zeitpunkt vorschlagen.',
      detail: String(error && error.message ? error.message : error),
    });
  }

  if (!bookingResult.ok) {
    // Slot belegt / abgelehnt -> Agent soll neuen Zeitpunkt anbieten. KEINE SMS.
    return json(200, {
      success: false,
      ok: false,
      status: 'slot_unavailable',
      message: 'Dieser Zeitpunkt ist leider nicht verfuegbar. Bitte einen anderen Termin vorschlagen.',
      detail: bookingResult.reason,
    });
  }

  const booking = bookingResult.booking;
  const startDate = booking.start ? new Date(booking.start) : resolved.date;
  const appointmentDate = calcom.formatBerlinDate(startDate);
  const appointmentTime = calcom.formatBerlinTime(startDate);

  // Buchung merken -> Standard-SMS wird dadurch unterdrueckt.
  try {
    await insertRow('tavano_bookings', {
      tenant_id: (tenant && tenant.id) || null,
      call_id: String(body.call_id || '').trim() || null,
      phone_number: isRealPhone(phone) ? phone : null,
      customer_name: name || null,
      email: emailInput || null,
      calcom_booking_uid: booking.uid || null,
      calcom_event_type_id: eventTypeId || null,
      start_time: startDate.toISOString(),
      end_time: booking.end || null,
      meeting_url: booking.meetingUrl || null,
      status: 'booked',
      source: 'voice_agent',
    }, { serviceRole: true });
  } catch (_) { /* Merken ist Absicherung; darf SMS nicht blockieren. */ }

  // Call-Details-SMS bauen.
  const template = String(tSettings.sms_appointment_template || '').trim()
    || String(envValue('SMS_APPOINTMENT_TEMPLATE') || '').trim()
    || DEFAULT_APPOINTMENT_SMS_TEMPLATE;
  const meetingLink = booking.meetingUrl ? ('Zugangslink: ' + booking.meetingUrl + '\n\n') : '';
  const message = String(template)
    .replaceAll('{customer_name}', name || '')
    .replaceAll('{appointment_date}', appointmentDate)
    .replaceAll('{appointment_time}', appointmentTime)
    .replaceAll('{meeting_link}', meetingLink);

  const smsSender = String(tSettings.sms_sender || (tenant && tenant.sms_sender) || '').trim()
    || envValue('SMS_FROM').trim() || DEFAULT_SMS_FROM;

  let smsResult = { sent: false, message: 'SMS uebersprungen (SMS deaktiviert).' };
  if (tSettings.sms_enabled !== false && isRealPhone(phone)) {
    try {
      smsResult = await deliverSms({
        to: phone,
        message,
        sms_sender: smsSender,
        tenant_id: (tenant && tenant.id) || null,
        customer_name: name || null,
        called_number: calledNumber || null,
        retell_agent_id: String(body.agent_id || (tenantContext.call && tenantContext.call.agent_id) || (tenant && tenant.retell_agent_id) || '').trim() || null,
        call_id: String(body.call_id || '').trim() || null,
      });
    } catch (error) {
      smsResult = { sent: false, message: 'SMS fehlgeschlagen: ' + String(error && error.message ? error.message : error) };
    }
  }

  return json(200, {
    success: true,
    ok: true,
    status: 'booked',
    date: appointmentDate,
    time: appointmentTime,
    meeting_link: booking.meetingUrl || null,
    message: 'Termin gebucht fuer ' + appointmentDate + ' um ' + appointmentTime + ' Uhr.',
    appointment: {
      date: appointmentDate,
      time: appointmentTime,
      start: startDate.toISOString(),
      booking_uid: booking.uid,
      meeting_url: booking.meetingUrl || null,
    },
    sms: { sent: Boolean(smsResult.sent), detail: smsResult.message },
    to: phone,
  });
};

exports.__test = {
  DEFAULT_APPOINTMENT_SMS_TEMPLATE,
  isTavanoContext,
};
