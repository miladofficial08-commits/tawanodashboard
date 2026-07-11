const { bearerTokenFromEvent, envValue, json, readBody, resolveTenantContextFromAccessToken } = require('./_lib/tenant');

// Liefert Transkript + Detail-Analyse EINES Anrufs. Streng getrennt: der Anruf
// muss zum Voice Agent des eingeloggten Kunden gehoeren.
exports.handler = async (event) => {
  const accessToken = bearerTokenFromEvent(event);
  if (!accessToken) return json(401, { ok: false, message: 'Unauthorized' });

  const body = readBody(event) || {};
  const callId = String(body.call_id || (event.queryStringParameters && event.queryStringParameters.call_id) || '').trim();
  if (!callId) return json(400, { ok: false, message: 'call_id fehlt' });

  let tenantContext;
  try {
    tenantContext = await resolveTenantContextFromAccessToken(accessToken);
  } catch (e) {
    return json(401, { ok: false, message: 'Auth fehlgeschlagen' });
  }
  const tenantAgent = String((tenantContext.tenant && tenantContext.tenant.retell_agent_id) || '').trim();

  const apiKey = envValue('RETELL_API_KEY').trim();
  if (!apiKey) return json(500, { ok: false, message: 'RETELL_API_KEY fehlt' });

  let c;
  try {
    const res = await fetch('https://api.retellai.com/v2/get-call/' + encodeURIComponent(callId), {
      headers: { Authorization: 'Bearer ' + apiKey },
    });
    if (!res.ok) return json(res.status === 404 ? 404 : 502, { ok: false, message: 'Anruf nicht gefunden' });
    c = await res.json();
  } catch (e) {
    return json(502, { ok: false, message: 'Retell nicht erreichbar' });
  }

  // Datentrennung: nur eigene Anrufe.
  if (tenantAgent && String(c.agent_id || '') !== tenantAgent) {
    return json(403, { ok: false, message: 'Kein Zugriff auf diesen Anruf.' });
  }

  const ca = c.call_analysis || {};
  return json(200, {
    ok: true,
    call: {
      call_id: c.call_id || callId,
      transcript: c.transcript || '',
      transcript_object: Array.isArray(c.transcript_object) ? c.transcript_object : [],
      recording_url: c.recording_url || null,
      from_number: c.from_number || null,
      to_number: c.to_number || null,
      direction: c.direction || null,
      start_timestamp: c.start_timestamp || null,
      duration_ms: Number(c.duration_ms || 0),
      disconnection_reason: c.disconnection_reason || null,
      summary: ca.call_summary || '',
      user_sentiment: ca.user_sentiment || null,
      call_successful: (typeof ca.call_successful === 'boolean') ? ca.call_successful : null,
      in_voicemail: Boolean(ca.in_voicemail),
    },
  });
};
