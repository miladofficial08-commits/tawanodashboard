const fs = require('node:fs');
const path = require('node:path');
const { bearerTokenFromEvent, envValue, json, listRows, resolveTenantContextFromAccessToken, getTenantSettings } = require('./_lib/tenant');

function toIsoFromMs(ms) {
  const num = Number(ms || 0);
  if (!Number.isFinite(num) || num <= 0) return new Date().toISOString();
  return new Date(num).toISOString();
}

function cutoffMsFromTenant(tenant) {
  let chosen = String((tenant && tenant.go_live_at) || '').trim();
  if (!chosen) {
    try {
      const statePath = path.join(process.cwd(), '.dashboard-reset.json');
      if (fs.existsSync(statePath)) {
        const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) || {};
        const scoped = tenant && tenant.id ? parsed[tenant.id] : parsed.default;
        chosen = String(scoped && scoped.goLiveAt || '').trim();
      }
    } catch (_) {
      chosen = '';
    }
  }
  if (!chosen) chosen = envValue('DASHBOARD_GO_LIVE_AT').trim();
  if (!chosen) return 0;
  const ms = Date.parse(chosen);
  return Number.isFinite(ms) ? ms : 0;
}

function mapCall(item) {
  const createdAt = toIsoFromMs(item.start_timestamp);
  const updatedAt = toIsoFromMs(item.end_timestamp || item.transfer_end_timestamp || item.start_timestamp);
  const callId = String(item.call_id || '');
  const startMs = Number(item.start_timestamp || 0);
  const endMs = Number(item.end_timestamp || item.transfer_end_timestamp || 0);
  let durationMs = Number(item.duration_ms || 0);
  if ((!durationMs || durationMs < 0) && endMs > startMs) durationMs = endMs - startMs;
  if (!Number.isFinite(durationMs) || durationMs < 0) durationMs = 0;
  return {
    id: callId,
    call_id: callId,
    durationMs,
    agent_id: item.agent_id || null,
    requestedAgentId: (item.metadata && item.metadata.requested_agent) || null,
    resolvedAgentId: item.agent_id || null,
    status: item.call_status || 'registered',
    retellStatus: item.call_status || 'registered',
    to_number: item.to_number || null,
    toNumber: item.to_number || null,
    phoneNumber: item.to_number || null,
    customerName: (item.metadata && item.metadata.customer_name) || '',
    name: (item.metadata && item.metadata.customer_name) || '',
    disconnectionReason: item.disconnection_reason || '',
    disconnection_reason: item.disconnection_reason || '',
    callAnalysis: item.call_analysis || {},
    call_analysis: item.call_analysis || {},
    summary: (item.call_analysis && item.call_analysis.call_summary) || '',
    createdAt,
    updatedAt,
  };
}

async function fetchRetellListCalls(retellApiKey, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    return await fetch('https://api.retellai.com/v3/list-calls', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + retellApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

exports.handler = async (event) => {
  const method = (event.httpMethod || 'GET').toUpperCase();
  if (method !== 'GET') return json(405, { ok: false, message: 'Method Not Allowed' });

  const accessToken = bearerTokenFromEvent(event);
  if (!accessToken) {
    return json(401, { ok: false, message: 'Unauthorized' });
  }

  let tenantContext;
  try {
    tenantContext = await resolveTenantContextFromAccessToken(accessToken);
  } catch (error) {
    return json(error.status || 401, { ok: false, message: 'Tenant-Kontext konnte nicht geladen werden', detail: String(error.message || error), calls: [], callbacks: [] });
  }

  const retellApiKey = envValue('RETELL_API_KEY').trim();
  if (!retellApiKey) return json(500, { ok: false, message: 'RETELL_API_KEY fehlt in .env.' });

  // Minuten-Budget aus den Kunden-Einstellungen (Admin) an den Tenant haengen -> steuert den Live-Minuten-Kreis.
  if (tenantContext.tenant && tenantContext.tenant.id) {
    try {
      const settings = await getTenantSettings(tenantContext.tenant.id, { accessToken });
      if (settings && settings.minutes_budget !== undefined) tenantContext.tenant.minutes_budget = Number(settings.minutes_budget) || 0;
    } catch (_) { /* Einstellungen optional */ }
  }

  const agentId = String((tenantContext.tenant && tenantContext.tenant.retell_agent_id) || envValue('RETELL_AGENT_BEAUTY') || envValue('RETELL_AGENT_DEFAULT') || '').trim();
  const body = {
    sort_order: 'descending',
    limit: 120,
  };
  if (agentId) {
    body.filter_criteria = { agent_id: [agentId] };
  }

  try {
    const response = await fetchRetellListCalls(retellApiKey, body);
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = {}; }

    if (!response.ok) {
      const msg = data.error_message || data.message || 'Retell Calls konnten nicht geladen werden';
      return json(response.status || 502, { ok: false, message: msg, calls: [] });
    }

    const items = Array.isArray(data.items) ? data.items : [];
    const cutoffMs = cutoffMsFromTenant(tenantContext.tenant);
    const filteredItems = cutoffMs
      ? items.filter((item) => {
          const start = Number(item.start_timestamp || 0);
          return Number.isFinite(start) && start >= cutoffMs;
        })
      : items;
    const calls = filteredItems.map(mapCall);

    let callbacks = [];
    try {
      callbacks = await listRows('callback_requests', {
        select: '*',
        tenant_id: 'eq.' + tenantContext.tenant.id,
        order: 'created_at.desc',
        limit: 50,
      }, { accessToken });
    } catch (_) {
      callbacks = [];
    }

    return json(200, { ok: true, tenant: tenantContext.tenant, calls, callbacks });
  } catch (error) {
    return json(502, { ok: false, message: 'Retell nicht erreichbar.', detail: String(error && error.message ? error.message : error), calls: [] });
  }
};
