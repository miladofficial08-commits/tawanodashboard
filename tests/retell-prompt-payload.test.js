const assert = require('node:assert/strict');

const startCall = require('../netlify/functions/start-call');
const { __test: bookingTest } = require('../netlify/functions/book-appointment');

function testCurrentDateUsesBerlinTimezone() {
  const date = startCall.__test.currentDateInTimeZone(new Date('2026-07-09T22:30:00.000Z'), 'Europe/Berlin');
  assert.equal(date, '2026-07-10');
}

function testRetellDynamicVariablesContainBerlinDate() {
  const vars = startCall.__test.buildRetellDynamicVariables(new Date('2026-07-09T22:30:00.000Z'));
  assert.deepEqual(vars, { current_date: '2026-07-10' });
}

function testBookAppointmentNormalizesCallIdAndCallerPhoneFromRetellPayload() {
  const input = bookingTest.normalizeToolInput({
    call: {
      call_id: 'call_real_123',
      direction: 'inbound',
      from_number: '+491701234567',
      to_number: '+4921186943411',
    },
    args: {
      date: '2026-07-15',
      time: '14:00',
    },
  });

  assert.equal(input.call_id, 'call_real_123');
  assert.equal(input.phone_number, '+491701234567');
}

function testBookAppointmentCanUseFetchedRetellCallForCallerPhone() {
  const phone = bookingTest.bookingPhoneFromInput({
    call_id: 'call_real_123',
  }, {}, {
    call_id: 'call_real_123',
    direction: 'inbound',
    from_number: '+491709998887',
    to_number: '+4921186943411',
  });

  assert.equal(phone, '+491709998887');
}

function run() {
  testCurrentDateUsesBerlinTimezone();
  testRetellDynamicVariablesContainBerlinDate();
  testBookAppointmentNormalizesCallIdAndCallerPhoneFromRetellPayload();
  testBookAppointmentCanUseFetchedRetellCallForCallerPhone();
  console.log('retell-prompt-payload.test.js: all assertions passed');
}

run();
