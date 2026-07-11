const fs = require('node:fs');
const path = require('node:path');

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
    body: JSON.stringify(payload),
  };
}

function readBody(event) {
  try {
    if (!event.body) return {};
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function parseLocalEnv() {
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return {};
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    const out = {};
    for (const line of lines) {
      const trimmed = String(line || '').trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
    return out;
  } catch (_) {
    return {};
  }
}

const LOCAL_ENV = parseLocalEnv();

function envValue(name) {
  const fromProc = process.env[name];
  if (fromProc != null && String(fromProc).trim() !== '') return String(fromProc);
  const fromFile = LOCAL_ENV[name];
  return fromFile == null ? '' : String(fromFile);
}

function parseBindings() {
  try {
    return JSON.parse(envValue('AUTH_EMAIL_BINDINGS') || '{}');
  } catch (_) {
    return {};
  }
}

function getSupabaseConfig() {
  return {
    url: envValue('SUPABASE_URL').replace(/\/$/, ''),
    anonKey: envValue('SUPABASE_ANON_KEY').trim(),
    serviceRoleKey: envValue('SUPABASE_SERVICE_ROLE_KEY').trim(),
  };
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 10000);
  try {
    return await fetch(url, Object.assign({}, init || {}, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

async function parseApiResponse(response) {
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = { raw }; }
  return { raw, data };
}

async function supabaseRequest(resourcePath, options) {
  const opts = options || {};
  const config = getSupabaseConfig();
  if (!config.url || !config.anonKey) {
    throw new Error('SUPABASE_URL oder SUPABASE_ANON_KEY fehlt.');
  }

  const useServiceRole = Boolean(opts.serviceRole && config.serviceRoleKey);
  const headers = Object.assign({}, opts.headers || {});
  headers.apikey = useServiceRole ? config.serviceRoleKey : config.anonKey;
  if (useServiceRole) {
    headers.Authorization = 'Bearer ' + config.serviceRoleKey;
  } else if (opts.accessToken) {
    headers.Authorization = 'Bearer ' + opts.accessToken;
  }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.prefer) headers.Prefer = opts.prefer;

  const response = await fetchWithTimeout(config.url + resourcePath, {
    method: opts.method || 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  }, opts.timeoutMs || 10000);
  const parsed = await parseApiResponse(response);
  return { response, data: parsed.data, raw: parsed.raw };
}

async function fetchSupabaseUser(accessToken) {
  const config = getSupabaseConfig();
  if (!config.url || !config.anonKey) {
    throw new Error('SUPABASE_URL oder SUPABASE_ANON_KEY fehlt.');
  }
  const response = await fetchWithTimeout(config.url + '/auth/v1/user', {
    method: 'GET',
    headers: {
      apikey: config.anonKey,
      Authorization: 'Bearer ' + accessToken,
    },
  }, 10000);
  const parsed = await parseApiResponse(response);
  if (!response.ok || !parsed.data || !parsed.data.id) {
    const message = parsed.data && (parsed.data.message || parsed.data.error_description || parsed.data.error) || 'Benutzer konnte nicht geladen werden';
    const error = new Error(message);
    error.status = response.status;
    error.data = parsed.data;
    throw error;
  }
  return parsed.data;
}

function buildQuery(params) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value == null || value === '') return;
    search.set(key, String(value));
  });
  const query = search.toString();
  return query ? '?' + query : '';
}

async function listRows(table, params, options) {
  const result = await supabaseRequest('/rest/v1/' + table + buildQuery(params), options || {});
  if (!result.response.ok) {
    const error = new Error((result.data && (result.data.message || result.data.error)) || ('Supabase query failed for ' + table));
    error.status = result.response.status;
    error.data = result.data;
    throw error;
  }
  return Array.isArray(result.data) ? result.data : [];
}

async function insertRow(table, row, options) {
  const result = await supabaseRequest('/rest/v1/' + table, Object.assign({}, options || {}, {
    method: 'POST',
    body: row,
    prefer: 'return=representation',
  }));
  if (!result.response.ok) {
    const error = new Error((result.data && (result.data.message || result.data.error)) || ('Supabase insert failed for ' + table));
    error.status = result.response.status;
    error.data = result.data;
    throw error;
  }
  return Array.isArray(result.data) ? result.data[0] : result.data;
}

async function patchRows(table, params, patch, options) {
  const result = await supabaseRequest('/rest/v1/' + table + buildQuery(params), Object.assign({}, options || {}, {
    method: 'PATCH',
    body: patch,
    prefer: 'return=representation',
  }));
  if (!result.response.ok) {
    const error = new Error((result.data && (result.data.message || result.data.error)) || ('Supabase update failed for ' + table));
    error.status = result.response.status;
    error.data = result.data;
    throw error;
  }
  return Array.isArray(result.data) ? result.data : [];
}

function isMissingSchemaError(error) {
  return Boolean(error && error.data && (error.data.code === 'PGRST205' || error.data.code === '42P01'));
}

function fallbackTenantFromEnv(options) {
  const opts = options || {};
  const email = String(opts.email || '').trim().toLowerCase();
  const bindings = parseBindings();
  const binding = email ? bindings[email] || null : null;
  const fallbackTenantId = binding && binding.tenantId ? binding.tenantId : (envValue('FALLBACK_TENANT_ID') || 'tenant_beautyworld');
  const agentId = opts.agentId || envValue('RETELL_AGENT_BEAUTY') || envValue('RETELL_AGENT_DEFAULT');
  return {
    id: fallbackTenantId,
    slug: envValue('FALLBACK_TENANT_SLUG') || fallbackTenantId,
    name: envValue('FALLBACK_TENANT_NAME') || 'Beautyworld',
    retell_agent_id: agentId || null,
    retell_agent_alias: envValue('RETELL_AGENT_ALIAS') || 'beautyworlds-demo',
    retell_from_number: envValue('RETELL_FROM_NUMBER') || null,
    booking_link_url: envValue('BOOKING_LINK_URL') || null,
    sms_sender: envValue('SMS_FROM') || null,
    go_live_at: envValue('DASHBOARD_GO_LIVE_AT') || null,
    minutes_budget: Number(envValue('DASHBOARD_MINUTES_BUDGET')) || null,
    is_active: true,
  };
}

async function getTenantById(tenantId, options) {
  const rows = await listRows('tenants', { select: '*', id: 'eq.' + tenantId, limit: 1 }, options || {});
  return rows[0] || null;
}

async function getTenantByAgentId(agentId, options) {
  const rows = await listRows('tenants', { select: '*', retell_agent_id: 'eq.' + agentId, limit: 1 }, options || {});
  return rows[0] || null;
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

async function getTenantByPhoneNumber(phoneNumber, options) {
  const normalizedTarget = normalizePhone(phoneNumber);
  if (!normalizedTarget) return null;

  const rows = await listRows('tenants', {
    select: '*',
    retell_from_number: 'not.is.null',
    limit: 500,
  }, options || {});

  for (const row of rows) {
    if (normalizePhone(row && row.retell_from_number) === normalizedTarget) {
      return row;
    }
  }
  return null;
}

// Pro-Kunde-Einstellungen (minutes_budget, sms_enabled, sms_template) liegen als
// jsonb-Snapshot in analytics_snapshots -> keine neuen DB-Spalten noetig.
async function getTenantSettings(tenantId, options) {
  if (!tenantId) return {};
  try {
    const rows = await listRows('analytics_snapshots', {
      select: 'payload,created_at',
      tenant_id: 'eq.' + tenantId,
      snapshot_type: 'eq.tenant_settings',
      order: 'created_at.desc',
      limit: 1,
    }, options || {});
    return (rows[0] && rows[0].payload) || {};
  } catch (_) {
    return {};
  }
}
async function saveTenantSettings(tenantId, patch, options) {
  const current = await getTenantSettings(tenantId, options);
  const merged = Object.assign({}, current, patch);
  await insertRow('analytics_snapshots', {
    tenant_id: tenantId,
    snapshot_type: 'tenant_settings',
    payload: merged,
  }, options || {});
  return merged;
}

async function resolveTenantContextFromAccessToken(accessToken) {
  const user = await fetchSupabaseUser(accessToken);
  try {
    const memberships = await listRows('tenant_memberships', {
      select: 'tenant_id,role,is_default',
      user_id: 'eq.' + user.id,
      order: 'is_default.desc,created_at.asc',
    }, { accessToken });

    if (!memberships.length) {
      return {
        accessToken,
        user,
        tenant: fallbackTenantFromEnv({ email: user.email }),
        membership: null,
        roles: [],
        source: 'env-fallback',
      };
    }

    const membership = memberships[0];
    const tenant = await getTenantById(membership.tenant_id, { accessToken });
    return {
      accessToken,
      user,
      tenant: tenant || fallbackTenantFromEnv({ email: user.email }),
      membership,
      roles: memberships.map((item) => item.role).filter(Boolean),
      source: tenant ? 'supabase' : 'env-fallback',
    };
  } catch (error) {
    if (isMissingSchemaError(error)) {
      return {
        accessToken,
        user,
        tenant: fallbackTenantFromEnv({ email: user.email }),
        membership: null,
        roles: [],
        source: 'env-fallback',
      };
    }
    throw error;
  }
}

async function fetchRetellCall(callId) {
  const apiKey = envValue('RETELL_API_KEY').trim();
  if (!apiKey || !callId) return null;
  const response = await fetchWithTimeout('https://api.retellai.com/v2/get-call/' + encodeURIComponent(callId), {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + apiKey },
  }, 10000);
  const parsed = await parseApiResponse(response);
  if (!response.ok) return null;
  return parsed.data || null;
}

async function resolveTenantFromToolBody(body) {
  const payload = body || {};
  let tenant = null;
  let call = null;
  const tenantId = String(payload.tenant_id || payload.tenantId || '').trim();
  const bodyAgentId = String(payload.agent_id || payload.agentId || '').trim();
  const callPayload = (payload.call && typeof payload.call === 'object') ? payload.call : null;

  if (tenantId) {
    try {
      tenant = await getTenantById(tenantId, { serviceRole: true });
    } catch (_) {
      tenant = null;
    }
  }

  if (!tenant && payload.call_id) {
    call = await fetchRetellCall(String(payload.call_id || payload.callId || '').trim());
    if (call && call.metadata && call.metadata.tenant_id) {
      try {
        tenant = await getTenantById(String(call.metadata.tenant_id), { serviceRole: true });
      } catch (_) {
        tenant = null;
      }
    }
  }

  if (!tenant) {
    const numberCandidates = [];
    const pushCandidate = (v) => {
      const s = String(v || '').trim();
      if (!s) return;
      numberCandidates.push(s);
    };

    // Direkte Felder aus Tool-Body.
    pushCandidate(payload.system_number);
    pushCandidate(payload.systemNumber);
    pushCandidate(payload.retell_from_number);
    pushCandidate(payload.from_number);
    pushCandidate(payload.to_number);
    pushCandidate(payload.phone_number);

    // Nummern aus live Call-Payload von Retell.
    if (callPayload) {
      const dir = String(callPayload.direction || '').toLowerCase();
      if (dir === 'outbound') {
        pushCandidate(callPayload.from_number);
      } else {
        pushCandidate(callPayload.to_number);
      }
      pushCandidate(callPayload.from_number);
      pushCandidate(callPayload.to_number);
    }

    // Nummern aus nachgeladenem Call via call_id.
    if (call) {
      const dir = String(call.direction || '').toLowerCase();
      if (dir === 'outbound') {
        pushCandidate(call.from_number);
      } else {
        pushCandidate(call.to_number);
      }
      pushCandidate(call.from_number);
      pushCandidate(call.to_number);
    }

    const seen = new Set();
    for (const candidate of numberCandidates) {
      const key = normalizePhone(candidate);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      try {
        tenant = await getTenantByPhoneNumber(candidate, { serviceRole: true });
      } catch (_) {
        tenant = null;
      }
      if (tenant) break;
    }
  }

  const agentId = bodyAgentId || (call && call.agent_id) || '';
  if (!tenant && agentId) {
    try {
      tenant = await getTenantByAgentId(agentId, { serviceRole: true });
    } catch (_) {
      tenant = null;
    }
  }

  return {
    tenant: tenant || fallbackTenantFromEnv({ agentId }),
    call,
    agentId: agentId || null,
  };
}

function bearerTokenFromEvent(event) {
  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

module.exports = {
  bearerTokenFromEvent,
  envValue,
  fallbackTenantFromEnv,
  fetchSupabaseUser,
  insertRow,
  isMissingSchemaError,
  json,
  listRows,
  patchRows,
  readBody,
  resolveTenantContextFromAccessToken,
  resolveTenantFromToolBody,
  getTenantById,
  getTenantByAgentId,
  getTenantByPhoneNumber,
  getTenantSettings,
  saveTenantSettings,
};