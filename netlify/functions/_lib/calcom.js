// Cal.com v2 Integration + Zeit-Helfer fuer die Terminbuchung durch den Voice Agent.
// Terminfenster: 07:00–20:00 Uhr, Montag bis Sonntag, Zeitzone Europe/Berlin.

const CAL_TIMEZONE = 'Europe/Berlin';
const CAL_API_VERSION = '2024-08-13';
const BOOKING_WINDOW_START_MIN = 7 * 60; // 07:00
const BOOKING_WINDOW_END_MIN = 20 * 60; // 20:00 (letzter erlaubter Start)

// Wie viele Minuten liegt Berlin zu diesem Zeitpunkt vor UTC (DST-sicher, via ICU).
function berlinOffsetMinutes(date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: CAL_TIMEZONE,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(date).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  return Math.round((asUTC - date.getTime()) / 60000);
}

// Wandelt eine Berliner Wanduhrzeit (Y,M,D,h,m) in den echten UTC-Zeitpunkt um.
function berlinWallClockToUtc(year, month, day, hour, minute) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const off1 = berlinOffsetMinutes(new Date(guess));
  let utc = guess - off1 * 60000;
  const off2 = berlinOffsetMinutes(new Date(utc));
  if (off2 !== off1) utc = guess - off2 * 60000;
  return new Date(utc);
}

// Nimmt die vom Agent gelieferten Zeitangaben und ermittelt den UTC-Startzeitpunkt.
// Akzeptiert:
//   - start:  vollstaendiges ISO mit Zeitzone (z. B. 2026-07-15T14:00:00+02:00)
//   - date + time: als Berliner Ortszeit interpretiert (YYYY-MM-DD, HH:mm)
function resolveStart(input) {
  const raw = input || {};
  const startText = String(raw.start || raw.start_time || raw.startTime || raw.datetime || '').trim();

  // Vollstaendiges ISO mit Offset/Z -> direkt als Instant nehmen.
  if (startText && /[zZ]|[+\-]\d{2}:?\d{2}$/.test(startText)) {
    const d = new Date(startText);
    if (!Number.isNaN(d.getTime())) return { ok: true, date: d };
  }

  // date + time getrennt (Berliner Ortszeit).
  let dateStr = String(raw.date || '').trim();
  let timeStr = String(raw.time || '').trim();

  // Falls nur "start" ohne Offset kam (z. B. 2026-07-15T14:00 oder "2026-07-15 14:00").
  if ((!dateStr || !timeStr) && startText) {
    const m = startText.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})/);
    if (m) {
      dateStr = m[1] + '-' + m[2] + '-' + m[3];
      timeStr = m[4].padStart(2, '0') + ':' + m[5];
    }
  }

  const dm = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const tm = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!dm || !tm) {
    return { ok: false, reason: 'Kein gueltiges Datum/Uhrzeit. Erwartet: date=YYYY-MM-DD und time=HH:mm (Berliner Zeit) oder start als ISO-Zeit.' };
  }

  const year = Number(dm[1]);
  const month = Number(dm[2]);
  const day = Number(dm[3]);
  const hour = Number(tm[1]);
  const minute = Number(tm[2]);
  if (hour > 23 || minute > 59) {
    return { ok: false, reason: 'Ungueltige Uhrzeit.' };
  }
  return { ok: true, date: berlinWallClockToUtc(year, month, day, hour, minute) };
}

// Prueft, ob der Startzeitpunkt im erlaubten Fenster liegt (07–20 Uhr, jeden Tag, nicht in der Vergangenheit).
function validateSlot(startDate, now) {
  if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) {
    return { ok: false, reason: 'Ungueltiger Zeitpunkt.' };
  }
  const reference = now instanceof Date ? now : new Date();
  if (startDate.getTime() < reference.getTime() - 60000) {
    return { ok: false, reason: 'Der Zeitpunkt liegt in der Vergangenheit. Bitte einen zukuenftigen Termin waehlen.' };
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CAL_TIMEZONE, hour12: false, hour: '2-digit', minute: '2-digit',
  }).formatToParts(startDate).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  let localHour = Number(parts.hour);
  if (localHour === 24) localHour = 0;
  const minutesOfDay = localHour * 60 + Number(parts.minute);

  if (minutesOfDay < BOOKING_WINDOW_START_MIN || minutesOfDay > BOOKING_WINDOW_END_MIN) {
    return { ok: false, reason: 'Termine sind nur zwischen 07:00 und 20:00 Uhr moeglich. Bitte eine Uhrzeit in diesem Fenster waehlen.' };
  }
  return { ok: true };
}

// Menschliche Datums-/Zeitangaben in Berliner Zeit fuer die SMS.
function formatBerlinDate(date) {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: CAL_TIMEZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(date);
}
function formatBerlinTime(date) {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: CAL_TIMEZONE, hour: '2-digit', minute: '2-digit',
  }).format(date);
}
function germanNumber(value) {
  const ones = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
  const n = Number(value);
  if (n < 20) return ones[n];
  const tens = { 2: 'zwanzig', 3: 'dreißig', 4: 'vierzig', 5: 'fünfzig' };
  if (n % 10 === 0) return tens[Math.floor(n / 10)];
  const unit = n % 10 === 1 ? 'ein' : ones[n % 10];
  return unit + 'und' + tens[Math.floor(n / 10)];
}
function formatBerlinSpokenTime(date) {
  const parts = new Intl.DateTimeFormat('de-DE', {
    timeZone: CAL_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour').value) % 24;
  const minute = Number(parts.find((p) => p.type === 'minute').value);
  return germanNumber(hour) + ' Uhr' + (minute ? ' ' + germanNumber(minute) : '');
}
function formatBerlinWeekday(date) {
  return new Intl.DateTimeFormat('de-DE', { timeZone: CAL_TIMEZONE, weekday: 'long' }).format(date);
}
// Berliner Kalendertag als YYYY-MM-DD.
function berlinDateKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAL_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
  return parts; // en-CA liefert bereits YYYY-MM-DD
}

// Holt echte freie Slots von Cal.com (v2). Gibt nach Berliner Datum gruppierte
// Start-Zeitpunkte (Date-Objekte) zurueck.
async function getSlots({ apiKey, eventTypeId, startDate, endDate }) {
  const start = berlinDateKey(startDate);
  const end = berlinDateKey(endDate);
  const url = 'https://api.cal.com/v2/slots?eventTypeId=' + encodeURIComponent(eventTypeId)
    + '&start=' + start + '&end=' + end + '&timeZone=' + encodeURIComponent(CAL_TIMEZONE);
  const response = await fetch(url, {
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'cal-api-version': '2024-09-04',
    },
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = null; }
  if (!response.ok || (data && data.status && data.status !== 'success')) {
    const detail = (data && (data.error && (data.error.message || data.error) || data.message)) || raw || ('HTTP ' + response.status);
    return { ok: false, reason: String(detail).slice(0, 300) };
  }
  const byDateRaw = (data && data.data) || {};
  const byDate = {};
  Object.keys(byDateRaw).forEach((day) => {
    const arr = Array.isArray(byDateRaw[day]) ? byDateRaw[day] : [];
    const dates = arr
      .map((item) => new Date(item && item.start ? item.start : item))
      .filter((d) => !Number.isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());
    if (dates.length) byDate[day] = dates;
  });
  return { ok: true, byDate };
}

// Waehlt bis zu `max` echte Slots: der frueheste gueltige Slot je Tag, ueber
// aufeinanderfolgende Tage. Nur 07–20 Uhr, nur in der Zukunft. Keine Zufallszeiten.
function pickSlots(byDate, max, now) {
  const reference = now instanceof Date ? now : new Date();
  const limit = Math.max(1, Number(max) || 2);
  const out = [];
  const days = Object.keys(byDate).sort();
  for (const day of days) {
    if (out.length >= limit) break;
    const slot = (byDate[day] || []).find((d) => {
      if (d.getTime() < reference.getTime()) return false;
      return validateSlot(d, reference).ok;
    });
    if (!slot) continue;
    out.push({
      date: berlinDateKey(slot),
      time: formatBerlinTime(slot),
      label: formatBerlinWeekday(slot) + ' um ' + formatBerlinSpokenTime(slot),
      start: slot.toISOString(),
    });
  }
  return out;
}

// Baut den Request-Body fuer die Cal.com v2 Buchung.
function buildBookingBody({ eventTypeId, startISO, attendee, metadata }) {
  const body = {
    start: startISO,
    eventTypeId: Number(eventTypeId),
    attendee: {
      name: attendee.name,
      email: attendee.email,
      timeZone: attendee.timeZone || CAL_TIMEZONE,
      language: attendee.language || 'de',
    },
  };
  if (attendee.phoneNumber) body.attendee.phoneNumber = attendee.phoneNumber;
  if (metadata && Object.keys(metadata).length) body.metadata = metadata;
  return body;
}

// Fuehrt die Buchung gegen die Cal.com v2 API aus.
async function createBooking({ apiKey, eventTypeId, startISO, attendee, metadata }) {
  const requestBody = buildBookingBody({ eventTypeId, startISO, attendee, metadata });
  const response = await fetch('https://api.cal.com/v2/bookings', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      'cal-api-version': CAL_API_VERSION,
    },
    body: JSON.stringify(requestBody),
  });

  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = null; }

  if (!response.ok || (data && data.status && data.status !== 'success')) {
    const detail = (data && (data.error && (data.error.message || data.error)) || data && data.message) || raw || ('HTTP ' + response.status);
    return { ok: false, status: response.status, reason: String(detail).slice(0, 300), response: data || raw };
  }

  const booking = (data && data.data) || data || {};
  return {
    ok: true,
    booking: {
      uid: booking.uid || booking.id || null,
      start: booking.start || startISO,
      end: booking.end || null,
      meetingUrl: booking.meetingUrl || booking.videoCallUrl
        || (booking.location && String(booking.location).startsWith('http') ? booking.location : null)
        || null,
    },
    response: data || raw,
  };
}

module.exports = {
  CAL_TIMEZONE,
  BOOKING_WINDOW_START_MIN,
  BOOKING_WINDOW_END_MIN,
  berlinWallClockToUtc,
  resolveStart,
  validateSlot,
  formatBerlinDate,
  formatBerlinTime,
  formatBerlinSpokenTime,
  formatBerlinWeekday,
  berlinDateKey,
  buildBookingBody,
  createBooking,
  getSlots,
  pickSlots,
};
