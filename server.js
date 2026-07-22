// Express-Adapter fuer Railway.
//
// Die Netlify-Functions bleiben UNVERAENDERT: sie exportieren alle
// `exports.handler = async (event) => ({ statusCode, headers, body })` und nutzen
// keine Netlify-eigenen APIs. Dieser Adapter uebersetzt nur Express <-> Netlify-Event.
//
// Netlify bleibt dadurch als Rueckweg funktionsfaehig - nichts hier drin ist Railway-spezifisch.

const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { sendAlert } = require('./netlify/functions/_lib/alert');

const app = express();
const PORT = Number(process.env.PORT || 8080);
const FUNCTIONS_DIR = path.join(__dirname, 'netlify', 'functions');

// ── Statische Seiten: bewusst als ALLOWLIST ────────────────────────────────
// Kein express.static(__dirname)! Das Projekt-Root enthaelt .env (Supabase-Service-Role-Key,
// Retell-, seven.io- und SMTP-Zugangsdaten) sowie den Function-Quellcode. Ein Verzeichnis-
// Mount wuerde all das oeffentlich ausliefern.
const STATIC_PAGES = {
  '/': 'index.html',
  '/Dashboardkunde.html': 'Dashboardkunde.html',
  '/admin': 'admin.html',
  '/admin.html': 'admin.html',
  '/feedback': 'feedback.html',
  '/feedback.html': 'feedback.html',
  '/tavano-demo': 'tavano-demo.html',
  '/tavano-demo.html': 'tavano-demo.html',
};

// ── Routen aus netlify.toml, 1:1 uebernommen ───────────────────────────────
const API_ROUTES = {
  '/api/client-auth/login': 'client-auth-login',
  '/api/debug/calls': 'debug-calls',
  '/api/debug/reset': 'debug-reset',
  '/api/call': 'start-call',
  '/api/analytics': 'analytics',
  '/api/send-link': 'send-booking-link',
  '/api/send-confirmation-sms': 'send-confirmation-sms',
  '/api/send_confirmation_sms': 'send_confirmation_sms',
  '/api/callback': 'create-callback-request',
  '/api/sms-inbound': 'sms-inbound',
  '/api/sms-dlr': 'sms-dlr',
  '/api/retell-inbound': 'retell-inbound',
  '/api/retell-call-events': 'retell-call-events',
  '/api/call-detail': 'get-call-detail',
  '/api/feedback': 'submit-feedback',
  '/api/feedback-list': 'feedback-list',
  '/api/tavano-lead': 'tavano-lead',
  '/api/book-appointment': 'book-appointment',
  '/api/get-available-slots': 'get-available-slots',
  '/api/admin/create-customer': 'admin-create-customer',
  '/api/admin/list-customers': 'admin-list-customers',
  '/api/admin/update-customer': 'admin-update-customer',
  '/api/admin/impersonate': 'admin-impersonate',
  '/api/admin/delete-customer': 'admin-delete-customer',
  '/api/admin/cost-numbers': 'admin-cost-numbers',
  '/api/admin/test-sms': 'admin-test-sms',
};

// Rohen Body als String einsammeln (Retell/seven.io schicken JSON; readBody parst selbst).
app.use(express.raw({ type: '*/*', limit: '5mb' }));

function toNetlifyEvent(req) {
  const query = {};
  for (const [k, v] of Object.entries(req.query || {})) {
    query[k] = Array.isArray(v) ? v[v.length - 1] : String(v);
  }
  const rawQuery = req.originalUrl.includes('?') ? req.originalUrl.split('?').slice(1).join('?') : '';
  const hasBody = Buffer.isBuffer(req.body) && req.body.length > 0;
  return {
    httpMethod: (req.method || 'GET').toUpperCase(),
    path: req.path,
    headers: req.headers || {},          // Express liefert Header bereits klein geschrieben (wie Netlify)
    queryStringParameters: query,
    rawQuery,
    body: hasBody ? req.body.toString('utf8') : null,
    isBase64Encoded: false,
  };
}

function loadHandler(name) {
  // Nur Dateinamen ohne Pfadanteile zulassen - schuetzt den /.netlify/functions/:name Fallback
  // vor Path-Traversal (z. B. ../../.env).
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return null;
  const file = path.join(FUNCTIONS_DIR, name + '.js');
  if (!fs.existsSync(file)) return null;
  const mod = require(file);
  return typeof mod.handler === 'function' ? mod.handler : null;
}

async function runFunction(name, req, res) {
  const handler = loadHandler(name);
  if (!handler) return res.status(404).json({ ok: false, message: 'Unbekannte Funktion: ' + name });

  try {
    const result = await handler(toNetlifyEvent(req), {});
    const status = Number(result && result.statusCode) || 200;
    const headers = (result && result.headers) || {};
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);

    // Server-Fehler (5xx) sind echte Stoerungen -> Alarm. 4xx ist Aufrufer-Fehler, kein Alarm.
    if (status >= 500) {
      sendAlert({
        scope: 'API ' + name,
        key: 'api:' + name + ':' + status,
        message: 'Funktion antwortete mit HTTP ' + status,
        detail: typeof result.body === 'string' ? result.body.slice(0, 1000) : '',
        context: { pfad: req.originalUrl, methode: req.method },
      });
    }

    if (result && result.body != null) {
      const buf = result.isBase64Encoded ? Buffer.from(result.body, 'base64') : result.body;
      return res.status(status).send(buf);
    }
    return res.status(status).end();
  } catch (error) {
    const detail = String((error && error.stack) || error);
    console.error('[api] ' + name + ' abgestuerzt:', detail);
    sendAlert({
      scope: 'API ' + name,
      key: 'api:' + name + ':crash',
      message: 'Funktion ist abgestuerzt (unbehandelte Exception)',
      detail,
      context: { pfad: req.originalUrl, methode: req.method },
    });
    return res.status(500).json({ ok: false, message: 'Interner Serverfehler' });
  }
}

// Health-Check: Ziel fuer den externen Uptime-Monitor. Bewusst ohne Abhaengigkeiten,
// damit er genau eine Frage beantwortet: "Laeuft der Prozess und nimmt er Requests an?"
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'tawano', time: new Date().toISOString() });
});

for (const [route, fnName] of Object.entries(API_ROUTES)) {
  app.all(route, (req, res) => runFunction(fnName, req, res));
}

// Kompatibilitaet: das Dashboard faellt bei Fehlern auf /.netlify/functions/<name> zurueck.
app.all('/.netlify/functions/:name', (req, res) => runFunction(req.params.name, req, res));

for (const [route, file] of Object.entries(STATIC_PAGES)) {
  app.get(route, (_req, res) => res.sendFile(path.join(__dirname, file)));
}

app.use((_req, res) => res.status(404).send('Nicht gefunden'));

app.listen(PORT, '0.0.0.0', () => {
  console.log('Tawano laeuft auf Port ' + PORT);
});

module.exports = { app, toNetlifyEvent, loadHandler, STATIC_PAGES, API_ROUTES };
