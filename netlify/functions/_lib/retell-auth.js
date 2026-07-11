const { envValue } = require('./tenant');

function configuredToolSecret() {
  return String(envValue('RETELL_TOOL_SECRET') || envValue('RETELL_WEBHOOK_SECRET') || '').trim();
}

function incomingSecret(event) {
  const headers = (event && event.headers) || {};
  const direct = String(headers['x-retell-tool-secret'] || headers['X-Retell-Tool-Secret'] || '').trim();
  if (direct) return direct;
  const authorization = String(headers.authorization || headers.Authorization || '').trim();
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

function isToolAuthenticationConfigured() {
  return configuredToolSecret() !== '';
}

function isAuthorizedToolRequest(event) {
  const expected = configuredToolSecret();
  // Kein Secret konfiguriert -> OFFEN (wie im urspruenglichen Design). Sonst wuerden
  // ALLE Retell-Tool-Calls (SMS, Terminbuchung) waehrend des Anrufs mit 401 brechen
  // ("technisches Problem"). Zum Absichern: RETELL_TOOL_SECRET setzen UND in Retell
  // als Header x-retell-tool-secret (oder Bearer-Token) mitschicken.
  if (!expected) return true;
  const incoming = incomingSecret(event);
  return Boolean(incoming && incoming === expected);
}

module.exports = { configuredToolSecret, isAuthorizedToolRequest, isToolAuthenticationConfigured };
