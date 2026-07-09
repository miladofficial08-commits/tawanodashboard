const assert = require('node:assert/strict');

const calcom = require('../netlify/functions/_lib/calcom');
const { __test } = require('../netlify/functions/book-appointment');

// --- Zeit-/Slot-Logik ----------------------------------------------------

function testBerlinWallClockToUtcSummer() {
  // 15. Juli 2026, 14:00 Berliner Zeit = 12:00 UTC (Sommerzeit, +02:00).
  const d = calcom.berlinWallClockToUtc(2026, 7, 15, 14, 0);
  assert.equal(d.toISOString(), '2026-07-15T12:00:00.000Z');
}

function testBerlinWallClockToUtcWinter() {
  // 15. Januar 2026, 09:00 Berliner Zeit = 08:00 UTC (Winterzeit, +01:00).
  const d = calcom.berlinWallClockToUtc(2026, 1, 15, 9, 0);
  assert.equal(d.toISOString(), '2026-01-15T08:00:00.000Z');
}

function testResolveStartFromDateAndTime() {
  const r = calcom.resolveStart({ date: '2026-07-15', time: '14:00' });
  assert.equal(r.ok, true);
  assert.equal(r.date.toISOString(), '2026-07-15T12:00:00.000Z');
}

function testResolveStartFromIsoWithOffset() {
  const r = calcom.resolveStart({ start: '2026-07-15T14:00:00+02:00' });
  assert.equal(r.ok, true);
  assert.equal(r.date.toISOString(), '2026-07-15T12:00:00.000Z');
}

function testResolveStartRejectsGarbage() {
  const r = calcom.resolveStart({ date: 'morgen', time: 'vormittags' });
  assert.equal(r.ok, false);
}

function testSlotWithinWindowAccepted() {
  const start = calcom.berlinWallClockToUtc(2026, 7, 15, 7, 0); // genau 07:00 Berlin
  const now = calcom.berlinWallClockToUtc(2026, 7, 1, 10, 0);
  assert.equal(calcom.validateSlot(start, now).ok, true);
}

function testSlotTooEarlyRejected() {
  const start = calcom.berlinWallClockToUtc(2026, 7, 15, 6, 30); // 06:30 Berlin
  const now = calcom.berlinWallClockToUtc(2026, 7, 1, 10, 0);
  const res = calcom.validateSlot(start, now);
  assert.equal(res.ok, false);
  assert.match(res.reason, /07:00 und 20:00/);
}

function testSlotTooLateRejected() {
  const start = calcom.berlinWallClockToUtc(2026, 7, 15, 20, 30); // 20:30 Berlin
  const now = calcom.berlinWallClockToUtc(2026, 7, 1, 10, 0);
  assert.equal(calcom.validateSlot(start, now).ok, false);
}

function testSlotInPastRejected() {
  const start = calcom.berlinWallClockToUtc(2026, 7, 15, 10, 0);
  const now = calcom.berlinWallClockToUtc(2026, 7, 16, 10, 0); // Tag danach
  const res = calcom.validateSlot(start, now);
  assert.equal(res.ok, false);
  assert.match(res.reason, /Vergangenheit/);
}

function testSundayIsAllowed() {
  // 19. Juli 2026 ist ein Sonntag -> muss erlaubt sein (Mo–So).
  const start = calcom.berlinWallClockToUtc(2026, 7, 19, 11, 0);
  const now = calcom.berlinWallClockToUtc(2026, 7, 1, 10, 0);
  assert.equal(calcom.validateSlot(start, now).ok, true);
}

// --- Cal.com Request-Body -------------------------------------------------

function testBuildBookingBody() {
  const body = calcom.buildBookingBody({
    eventTypeId: '548976',
    startISO: '2026-07-15T12:00:00.000Z',
    attendee: { name: 'Max', email: 'max@example.com', phoneNumber: '+49170123', timeZone: 'Europe/Berlin' },
    metadata: { call_id: 'call_1' },
  });
  assert.equal(body.eventTypeId, 548976);
  assert.equal(body.start, '2026-07-15T12:00:00.000Z');
  assert.equal(body.attendee.name, 'Max');
  assert.equal(body.attendee.email, 'max@example.com');
  assert.equal(body.attendee.phoneNumber, '+49170123');
  assert.equal(body.attendee.timeZone, 'Europe/Berlin');
  assert.equal(body.attendee.language, 'de');
  assert.deepEqual(body.metadata, { call_id: 'call_1' });
}

// --- SMS-Template + Tavano-Gate ------------------------------------------

function testAppointmentTemplateHasPlaceholders() {
  const t = __test.DEFAULT_APPOINTMENT_SMS_TEMPLATE;
  assert.match(t, /\{appointment_date\}/);
  assert.match(t, /\{appointment_time\}/);
  assert.match(t, /\{meeting_link\}/);
  assert.match(t, /Tawano/);
}

// --- Slot-Auswahl (get-available-slots) ----------------------------------

function testPickSlotsReturnsMaxTwoAcrossDays() {
  const now = calcom.berlinWallClockToUtc(2026, 7, 13, 6, 0); // Mo 06:00
  const byDate = {
    '2026-07-13': [
      calcom.berlinWallClockToUtc(2026, 7, 13, 10, 30),
      calcom.berlinWallClockToUtc(2026, 7, 13, 11, 0),
    ],
    '2026-07-14': [
      calcom.berlinWallClockToUtc(2026, 7, 14, 15, 0),
    ],
    '2026-07-15': [
      calcom.berlinWallClockToUtc(2026, 7, 15, 9, 0),
    ],
  };
  const slots = calcom.pickSlots(byDate, 2, now);
  assert.equal(slots.length, 2);
  // Frühester Slot je Tag, über aufeinanderfolgende Tage.
  assert.equal(slots[0].date, '2026-07-13');
  assert.equal(slots[0].time, '10:30');
  assert.match(slots[0].label, /Montag um 10:30 Uhr/);
  assert.equal(slots[1].date, '2026-07-14');
  assert.equal(slots[1].time, '15:00');
  assert.match(slots[1].label, /Dienstag um 15:00 Uhr/);
}

function testPickSlotsSkipsPastAndOutOfWindow() {
  const now = calcom.berlinWallClockToUtc(2026, 7, 13, 12, 0); // Mo 12:00
  const byDate = {
    '2026-07-13': [
      calcom.berlinWallClockToUtc(2026, 7, 13, 8, 0), // vergangen
      calcom.berlinWallClockToUtc(2026, 7, 13, 20, 30), // ausserhalb Fenster
      calcom.berlinWallClockToUtc(2026, 7, 13, 14, 0), // gueltig
    ],
  };
  const slots = calcom.pickSlots(byDate, 2, now);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].time, '14:00');
}

function testTavanoGate() {
  assert.equal(__test.isTavanoContext({ id: 'tenant_tavano', name: 'Tavano' }, ''), true);
  assert.equal(__test.isTavanoContext({ name: 'Tawano GmbH' }, ''), true);
  assert.equal(__test.isTavanoContext({ id: 'tenant_x' }, '+4921186943411'), true);
  assert.equal(__test.isTavanoContext({ id: 'tenant_beautyworld', name: 'Beautyworld' }, '+49123456'), false);
}

function run() {
  testBerlinWallClockToUtcSummer();
  testBerlinWallClockToUtcWinter();
  testResolveStartFromDateAndTime();
  testResolveStartFromIsoWithOffset();
  testResolveStartRejectsGarbage();
  testSlotWithinWindowAccepted();
  testSlotTooEarlyRejected();
  testSlotTooLateRejected();
  testSlotInPastRejected();
  testSundayIsAllowed();
  testBuildBookingBody();
  testPickSlotsReturnsMaxTwoAcrossDays();
  testPickSlotsSkipsPastAndOutOfWindow();
  testAppointmentTemplateHasPlaceholders();
  testTavanoGate();
  console.log('tavano-booking.test.js: all assertions passed');
}

run();
