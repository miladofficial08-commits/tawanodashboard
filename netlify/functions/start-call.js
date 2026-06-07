const { bearerTokenFromEvent, envValue, json, readBody, resolveTenantContextFromAccessToken } = require('./_lib/tenant');

function toIsoFromMs(ms) {
  const num = Number(ms || 0);
  if (!Number.isFinite(num) || num <= 0) return new Date().toISOString();
  return new Date(num).toISOString();
}

exports.handler = async (event) => {
  if ((event.httpMethod || 'GET').toUpperCase() !== 'POST') {
    return json(405, { ok: false, message: 'Method Not Allowed' });
  }

  const accessToken = bearerTokenFromEvent(event);
  if (!accessToken) {
    return json(401, { ok: false, message: 'Unauthorized' });
  }

  let tenantContext;
  try {
    tenantContext = await resolveTenantContextFromAccessToken(accessToken);
  } catch (error) {
    return json(error.status || 401, { ok: false, message: 'Tenant-Kontext konnte nicht geladen werden', detail: String(error.message || error) });
  }

  const body = readBody(event);
  if (!body) return json(400, { ok: false, message: 'Invalid JSON body' });

  const toNumber = String(body.phoneNumber || body.to_number || '').trim();
  if (!toNumber) return json(400, { ok: false, message: 'phoneNumber fehlt.' });

  const retellApiKey = envValue('RETELL_API_KEY').trim();
  const fromNumber = String((tenantContext.tenant && tenantContext.tenant.retell_from_number) || envValue('RETELL_FROM_NUMBER') || '').trim();
  if (!retellApiKey || !fromNumber) {
    return json(500, { ok: false, message: 'RETELL_API_KEY oder RETELL_FROM_NUMBER fehlt in .env.' });
  }

  const requestedAgentId = String(body.agentId || '').trim();
  let overrideAgentId = '';
  if (requestedAgentId === 'beautyworlds-demo') {
    overrideAgentId = String((tenantContext.tenant && tenantContext.tenant.retell_agent_id) || envValue('RETELL_AGENT_BEAUTY') || envValue('RETELL_AGENT_DEFAULT') || '').trim();
  } else if (requestedAgentId) {
    overrideAgentId = requestedAgentId;
  }

  const payload = {
    from_number: fromNumber,
    to_number: toNumber,
    metadata: {
      source: 'dashboardkunde',
      tenant_id: tenantContext.tenant && tenantContext.tenant.id || null,
      tenant_slug: tenantContext.tenant && tenantContext.tenant.slug || null,
      tenant_name: tenantContext.tenant && tenantContext.tenant.name || null,
      requested_agent: requestedAgentId || null,
      requested_at: new Date().toISOString(),
    },
  };
  if (overrideAgentId) payload.override_agent_id = overrideAgentId;

  try {
    const response = await fetch('https://api.retellai.com/v2/create-phone-call', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + retellApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = {}; }

    if (!response.ok || !data.call_id) {
      const msg = data.error_message || data.message || 'Test-Call konnte nicht gestartet werden';
      return json(response.status || 502, { ok: false, message: msg });
    }

    const createdAt = toIsoFromMs(data.start_timestamp);
    return json(200, {
      ok: true,
      call: {
        call_id: data.call_id,
        agent_id: data.agent_id || overrideAgentId || null,
        requestedAgentId: requestedAgentId || null,
        status: data.call_status || 'registered',
        retellStatus: data.call_status || 'registered',
        to_number: data.to_number || toNumber,
        phoneNumber: data.to_number || toNumber,
        createdAt,
        updatedAt: createdAt,
        tenantId: tenantContext.tenant && tenantContext.tenant.id || null,
      },
    });
  } catch (error) {
    return json(502, { ok: false, message: 'Retell nicht erreichbar.', detail: String(error && error.message ? error.message : error) });
  }
};
