// Stoerungs-Alarm per E-Mail (Gmail SMTP).
//
// WICHTIG - Grenze dieses Moduls:
// Das hier laeuft IM Server-Prozess. Es meldet Anwendungsfehler (seven.io lehnt ab,
// Supabase weg, Cal.com kaputt, unerwartete Exception). Es kann NICHT melden, dass der
// Host komplett tot ist - dann laeuft dieser Code naemlich gar nicht erst. Fuer
// "Host down" braucht es einen externen Uptime-Monitor, der von aussen pingt.

const { envValue } = require('./tenant');

// Mehrfach dieselbe Stoerung -> nicht hundert Mails. Pro Fehlerart max. 1 Mail / Fenster.
const THROTTLE_MS = Number(envValue('ALERT_THROTTLE_MS') || 15 * 60 * 1000);
const lastSentByKey = new Map();

let transporterPromise = null;

function getTransporter() {
  if (transporterPromise) return transporterPromise;
  transporterPromise = (async () => {
    const host = envValue('SMTP_HOST').trim();
    const user = envValue('SMTP_USER').trim();
    const pass = envValue('SMTP_PASS').trim();
    if (!host || !user || !pass) return null;
    // Platzhalter aus dem Beispiel-.env nicht als echte Konfiguration akzeptieren.
    if (/example\.com$/i.test(host)) return null;

    const nodemailer = require('nodemailer');
    const port = Number(envValue('SMTP_PORT') || 587);
    return nodemailer.createTransport({
      host,
      port,
      secure: String(envValue('SMTP_SECURE') || '').toLowerCase() === 'true' || port === 465,
      requireTLS: String(envValue('SMTP_REQUIRE_TLS') || 'true').toLowerCase() === 'true',
      auth: { user, pass },
    });
  })();
  return transporterPromise;
}

function shouldSend(key) {
  const now = Date.now();
  const last = lastSentByKey.get(key) || 0;
  if (now - last < THROTTLE_MS) return false;
  lastSentByKey.set(key, now);
  return true;
}

function buildBody({ scope, message, detail, context }) {
  const lines = [
    'Tawano hat eine Stoerung gemeldet.',
    '',
    'Bereich:    ' + scope,
    'Problem:    ' + message,
    'Zeitpunkt:  ' + new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }) + ' (Berlin)',
    'Host:       ' + (envValue('PUBLIC_BASE_URL') || envValue('RAILWAY_PUBLIC_DOMAIN') || 'unbekannt'),
  ];
  if (detail) lines.push('', 'Technisches Detail:', String(detail));
  if (context && Object.keys(context).length) {
    lines.push('', 'Kontext:');
    for (const [k, v] of Object.entries(context)) {
      if (v === undefined || v === null || v === '') continue;
      lines.push('  ' + k + ': ' + (typeof v === 'object' ? JSON.stringify(v) : String(v)));
    }
  }
  lines.push(
    '',
    '---',
    'Diese Mail kommt vom Tawano-Server selbst. Bleibt sie bei einem Ausfall aus,',
    'ist der Server als Ganzes nicht erreichbar - dann meldet sich der externe Uptime-Monitor.',
  );
  return lines.join('\n');
}

// Feuert eine Alarm-Mail. Wirft NIE - Alarmierung darf den Anruf nie sprengen.
// key: gruppiert gleichartige Stoerungen fuer das Throttling (z. B. 'sms:seven-rejected').
async function sendAlert({ scope, key, message, detail, context }) {
  try {
    const to = (envValue('ALERT_EMAIL_TO') || envValue('CONTACT_RECEIVER')).trim();
    if (!to || /example\.com$/i.test(to)) return { sent: false, reason: 'no_recipient' };

    const throttleKey = String(key || scope || 'generic');
    if (!shouldSend(throttleKey)) return { sent: false, reason: 'throttled' };

    const transporter = await getTransporter();
    if (!transporter) return { sent: false, reason: 'smtp_not_configured' };

    await transporter.sendMail({
      from: envValue('SMTP_FROM').trim() || envValue('SMTP_USER').trim(),
      to,
      subject: '[Tawano Stoerung] ' + scope + ' - ' + message,
      text: buildBody({ scope, message, detail, context }),
    });
    return { sent: true };
  } catch (error) {
    // Bewusst nur loggen: ein kaputter Mailversand darf niemals den SMS-/Buchungspfad brechen.
    console.error('[alert] Alarm-Mail fehlgeschlagen:', String(error && error.message ? error.message : error));
    return { sent: false, reason: 'send_failed' };
  }
}

module.exports = { sendAlert, __test: { buildBody, shouldSend, lastSentByKey, THROTTLE_MS } };
