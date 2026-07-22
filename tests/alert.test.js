const assert = require('node:assert/strict');

function loadAlert(env) {
  const tenantPath = require.resolve('../netlify/functions/_lib/tenant');
  const alertPath = require.resolve('../netlify/functions/_lib/alert');
  const actualTenant = require(tenantPath);
  const original = require.cache[tenantPath].exports;
  require.cache[tenantPath].exports = Object.assign({}, actualTenant, {
    envValue(name) { return env[name] || ''; },
  });
  delete require.cache[alertPath];
  try {
    return require(alertPath);
  } finally {
    require.cache[tenantPath].exports = original;
  }
}

// Ohne Empfaenger darf nichts passieren - und vor allem nichts werfen.
async function testNoRecipientIsSilent() {
  const alert = loadAlert({});
  const r = await alert.sendAlert({ scope: 'SMS', message: 'Test' });
  assert.equal(r.sent, false);
  assert.equal(r.reason, 'no_recipient');
}

// Der Platzhalter aus dem Beispiel-.env darf nicht als echte Konfiguration durchgehen,
// sonst laufen Alarme stillschweigend gegen example.com.
async function testPlaceholderConfigIsRejected() {
  const alert = loadAlert({
    ALERT_EMAIL_TO: 'info@example.com',
    SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u', SMTP_PASS: 'p',
  });
  const r = await alert.sendAlert({ scope: 'SMS', message: 'Test' });
  assert.equal(r.sent, false);
  assert.equal(r.reason, 'no_recipient');

  const alert2 = loadAlert({
    ALERT_EMAIL_TO: 'echt@tawano.de',
    SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u', SMTP_PASS: 'p',
  });
  const r2 = await alert2.sendAlert({ scope: 'SMS', message: 'Test' });
  assert.equal(r2.reason, 'smtp_not_configured');
}

// Dauerstoerung darf keinen Mail-Sturm ausloesen: pro Fehlerart 1 Mail je Zeitfenster.
async function testThrottling() {
  const alert = loadAlert({ ALERT_EMAIL_TO: 'echt@tawano.de' });
  const first = alert.__test.shouldSend('sms:provider-rejected');
  const second = alert.__test.shouldSend('sms:provider-rejected');
  const otherKind = alert.__test.shouldSend('booking:calcom-error');
  assert.equal(first, true, 'erster Alarm muss durchgehen');
  assert.equal(second, false, 'Wiederholung derselben Stoerung muss gedrosselt werden');
  assert.equal(otherKind, true, 'andere Stoerungsart muss eigenstaendig alarmieren');
}

// Die Mail muss die Angaben enthalten, mit denen man das Problem tatsaechlich findet.
function testBodyIsActionable() {
  const alert = loadAlert({ ALERT_EMAIL_TO: 'echt@tawano.de' });
  const body = alert.__test.buildBody({
    scope: 'SMS-Versand',
    message: 'seven.io hat die SMS abgelehnt',
    detail: 'Code 305',
    context: { kunde: 'tenant_beautyworld', anrufer: '+491631283971' },
  });
  assert.ok(body.includes('SMS-Versand'));
  assert.ok(body.includes('seven.io hat die SMS abgelehnt'));
  assert.ok(body.includes('Code 305'));
  assert.ok(body.includes('tenant_beautyworld'));
  assert.ok(body.includes('+491631283971'));
  assert.ok(body.includes('Berlin'), 'Zeitpunkt in lokaler Zeit muss drinstehen');
}

// Ein kaputter Mailversand darf den SMS-/Buchungspfad NIEMALS sprengen.
async function testSendFailureNeverThrows() {
  const alert = loadAlert({
    ALERT_EMAIL_TO: 'echt@tawano.de',
    SMTP_HOST: 'localhost', SMTP_PORT: '1', SMTP_USER: 'u', SMTP_PASS: 'p',
  });
  const r = await alert.sendAlert({ scope: 'SMS', key: 'k-' + Date.now(), message: 'Test' });
  assert.equal(r.sent, false, 'darf nicht als gesendet gelten');
  assert.ok(['send_failed', 'smtp_not_configured'].includes(r.reason));
}

async function run() {
  await testNoRecipientIsSilent();
  await testPlaceholderConfigIsRejected();
  await testThrottling();
  testBodyIsActionable();
  await testSendFailureNeverThrows();
  console.log('alert.test.js: all assertions passed');
}

run().catch((e) => { console.error(e); process.exit(1); });
