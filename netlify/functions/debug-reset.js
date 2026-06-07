const fs = require('node:fs');
const path = require('node:path');
const { bearerTokenFromEvent, isMissingSchemaError, json, patchRows, readBody, resolveTenantContextFromAccessToken } = require('./_lib/tenant');

function writeStateFallback(goLiveAt, reason, tenantId) {
  const statePath = path.join(process.cwd(), '.dashboard-reset.json');
  let current = {};
  if (fs.existsSync(statePath)) {
    try { current = JSON.parse(fs.readFileSync(statePath, 'utf8')) || {}; } catch (_) { current = {}; }
  }
  const key = tenantId || 'default';
  current[key] = {
    goLiveAt,
    reason: reason || 'manual_reset',
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(statePath, JSON.stringify(current, null, 2), 'utf8');
  return current[key];
}

exports.handler = async (event) => {
  if ((event.httpMethod || 'GET').toUpperCase() !== 'POST') {
    return json(405, { ok: false, message: 'Method Not Allowed' });
  }
  try {
    const accessToken = bearerTokenFromEvent(event);
    if (!accessToken) return json(401, { ok: false, message: 'Unauthorized' });
    const tenantContext = await resolveTenantContextFromAccessToken(accessToken);
    const body = readBody(event);
    const goLiveAt = new Date().toISOString();
    try {
      await patchRows('tenants', { id: 'eq.' + tenantContext.tenant.id }, { go_live_at: goLiveAt, updated_at: goLiveAt }, { accessToken });
      return json(200, { ok: true, message: 'Reset abgeschlossen. Alte Daten ausgeblendet.', goLiveAt, tenantId: tenantContext.tenant.id });
    } catch (error) {
      if (!isMissingSchemaError(error)) throw error;
      const state = writeStateFallback(goLiveAt, body.reason || 'manual_reset', tenantContext.tenant.id);
      return json(200, { ok: true, message: 'Reset abgeschlossen. Alte Daten ausgeblendet.', goLiveAt: state.goLiveAt, tenantId: tenantContext.tenant.id });
    }
  } catch (error) {
    return json(500, { ok: false, message: 'Reset konnte nicht gespeichert werden.', detail: String(error && error.message ? error.message : error) });
  }
};
