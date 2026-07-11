const { envValue, json, readBody } = require('./_lib/tenant');
const sendBookingLink = require('./send-booking-link');

const TAWANO_AGENT_ID = 'agent_ff22892da02f1277fd6640169e';

function shouldHandle(payload) {
  const call = payload && payload.call;
  return Boolean(payload && payload.event === 'call_ended' && call
    && call.agent_id === TAWANO_AGENT_ID && call.call_id);
}

async function fetchVerifiedCall(callId) {
  const apiKey = envValue('RETELL_API_KEY').trim();
  if (!apiKey) return null;
  const response = await fetch('https://api.retellai.com/v2/get-call/' + encodeURIComponent(callId), {
    headers: { Authorization: 'Bearer ' + apiKey },
  });
  if (!response.ok) return null;
  const call = await response.json();
  return call && call.agent_id === TAWANO_AGENT_ID ? call : null;
}

exports.handler = async (event) => {
  if ((event.httpMethod || '').toUpperCase() !== 'POST') return json(405, { ok: false });
  const payload = readBody(event) || {};
  if (!shouldHandle(payload)) return json(200, { ok: true, status: 'ignored' });

  const verifiedCall = await fetchVerifiedCall(payload.call.call_id);
  if (!verifiedCall) return json(401, { ok: false, status: 'unverified_call' });

  const toolSecret = envValue('RETELL_TOOL_SECRET') || envValue('RETELL_WEBHOOK_SECRET');
  const result = await sendBookingLink.handler({
    httpMethod: 'POST',
    headers: toolSecret ? { 'x-retell-tool-secret': toolSecret } : {},
    body: JSON.stringify({
      call_id: verifiedCall.call_id,
      agent_id: verifiedCall.agent_id,
      call: verifiedCall,
    }),
  });
  const body = JSON.parse(result.body || '{}');
  return json(200, { ok: true, status: body.status || (body.ok ? 'sms_sent' : 'sms_not_sent') });
};

exports.__test = { shouldHandle };
