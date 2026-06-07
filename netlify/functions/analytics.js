const { bearerTokenFromEvent, insertRow, isMissingSchemaError, json, readBody, resolveTenantContextFromAccessToken } = require('./_lib/tenant');

exports.handler = async (event) => {
  if ((event.httpMethod || 'GET').toUpperCase() !== 'POST') {
    return json(405, { ok: false, message: 'Method Not Allowed' });
  }
  const accessToken = bearerTokenFromEvent(event);
  if (!accessToken) return json(401, { ok: false, message: 'Unauthorized' });

  const body = readBody(event);
  if (!body) return json(400, { ok: false, message: 'Invalid JSON body' });

  try {
    const tenantContext = await resolveTenantContextFromAccessToken(accessToken);
    try {
      await insertRow('analytics_snapshots', {
        tenant_id: tenantContext.tenant.id,
        snapshot_type: String(body.type || 'topic_snapshot'),
        payload: body,
      }, { accessToken });
      return json(200, { ok: true, message: 'Themen gespeichert.', tenantId: tenantContext.tenant.id });
    } catch (error) {
      if (!isMissingSchemaError(error)) throw error;
      return json(200, { ok: true, message: 'Themen lokal bestaetigt, Tabelle noch nicht angelegt.', tenantId: tenantContext.tenant.id });
    }
  } catch (error) {
    return json(error.status || 500, { ok: false, message: 'Analytics konnten nicht gespeichert werden.', detail: String(error.message || error) });
  }
};
