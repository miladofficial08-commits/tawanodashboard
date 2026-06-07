const { envValue, json, readBody, resolveTenantContextFromAccessToken } = require('./_lib/tenant');

exports.handler = async (event) => {
  if ((event.httpMethod || 'GET').toUpperCase() !== 'POST') {
    return json(405, { ok: false, message: 'Method Not Allowed' });
  }

  const body = readBody(event);
  if (!body) return json(400, { ok: false, message: 'Invalid JSON body' });

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) {
    return json(400, { ok: false, message: 'E-Mail und Passwort sind erforderlich.' });
  }

  const supabaseUrl = envValue('SUPABASE_URL').replace(/\/$/, '');
  const anonKey = envValue('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) {
    return json(500, { ok: false, message: 'SUPABASE_URL oder SUPABASE_ANON_KEY fehlt in .env.' });
  }

  try {
    const resp = await fetch(supabaseUrl + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: {
        apikey: anonKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    const raw = await resp.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = {}; }

    if (!resp.ok || !data.access_token) {
      const message = data.error_description || data.msg || data.message || 'Login fehlgeschlagen';
      return json(resp.status || 401, { ok: false, message });
    }

    let tenantContext = null;
    try {
      tenantContext = await resolveTenantContextFromAccessToken(data.access_token);
    } catch (_) {
      tenantContext = null;
    }

    const tenant = tenantContext && tenantContext.tenant ? tenantContext.tenant : null;
    const roles = tenantContext && Array.isArray(tenantContext.roles) ? tenantContext.roles : [];

    return json(200, {
      ok: true,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      user: {
        id: (data.user && data.user.id) || null,
        email: (data.user && data.user.email) || email,
        tenantId: tenant ? tenant.id || null : null,
        tenantSlug: tenant ? tenant.slug || null : null,
        tenantName: tenant ? tenant.name || null : null,
        roles,
      },
    });
  } catch (error) {
    return json(502, { ok: false, message: 'Auth-Service nicht erreichbar.', detail: String(error && error.message ? error.message : error) });
  }
};
