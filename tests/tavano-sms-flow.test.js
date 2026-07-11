const assert = require('node:assert/strict');

const { __test } = require('../netlify/functions/send-booking-link');
const sendBookingLink = require('../netlify/functions/send-booking-link');

// Hinweis: SMS-Vorlagen/Absender/Links kommen jetzt AUSSCHLIESSLICH aus Supabase
// (tenants + tenant_settings). Es gibt keine hartcodierten Vorlagen mehr, daher
// keine DEFAULT_SMS_TEMPLATE- / SMS_CONFIG_BY_CALLED_NUMBER-Tests mehr.

function testNoHardcodedTemplatesExposed() {
  assert.equal(__test.DEFAULT_SMS_TEMPLATE, undefined, 'Keine hartcodierte Default-Vorlage mehr');
  assert.equal(__test.configOverrideForCalledNumber, undefined, 'Keine hartcodierte Nummern-Config mehr');
}

function testTavanoLinkReceivesKnownCallParams() {
  const link = __test.appendQueryParams('https://tawanodashboard.netlify.app/tavano-demo', {
    p: '+49 170 1234567',
    t: 'tenant_tavano',
    c: 'call_123',
    name: 'Max Mustermann',
  });
  const parsed = new URL(link);
  assert.equal(parsed.origin + parsed.pathname, 'https://tawanodashboard.netlify.app/tavano-demo');
  assert.equal(parsed.searchParams.get('p'), '+49 170 1234567');
  assert.equal(parsed.searchParams.get('t'), 'tenant_tavano');
  assert.equal(parsed.searchParams.get('c'), 'call_123');
  assert.equal(parsed.searchParams.get('name'), 'Max Mustermann');
}

function testConfirmationSmsAliasUsesBookingLinkHandler() {
  const confirmationSms = require('../netlify/functions/send-confirmation-sms');
  assert.equal(confirmationSms.handler, sendBookingLink.handler);
}

function run() {
  testNoHardcodedTemplatesExposed();
  testTavanoLinkReceivesKnownCallParams();
  testConfirmationSmsAliasUsesBookingLinkHandler();
}

run();
