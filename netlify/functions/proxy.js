const LIVE_SERVER_URL = 'https://tawanoai.netlify.app';

function toTargetPath(eventPath) {
  const prefix = '/.netlify/functions/proxy/';
  if (!eventPath || !eventPath.startsWith(prefix)) return '/';
  const rest = eventPath.slice(prefix.length);
  return rest ? '/api/' + rest : '/api';
}

exports.handler = async (event) => {
  try {
    const method = (event.httpMethod || 'GET').toUpperCase();
    const targetPath = toTargetPath(event.path || '');
    const query = event.rawQuery ? ('?' + event.rawQuery) : '';
    const targetUrl = LIVE_SERVER_URL + targetPath + query;

    const incomingHeaders = event.headers || {};
    const headers = {
      'content-type': incomingHeaders['content-type'] || incomingHeaders['Content-Type'] || 'application/json',
    };

    const authHeader = incomingHeaders.authorization || incomingHeaders.Authorization;
    if (authHeader) headers.authorization = authHeader;

    const init = { method, headers };
    if (method !== 'GET' && method !== 'HEAD' && event.body != null) {
      init.body = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;
    }

    const response = await fetch(targetUrl, init);
    const responseBody = await response.text();

    return {
      statusCode: response.status,
      headers: {
        'content-type': response.headers.get('content-type') || 'application/json',
        'cache-control': 'no-store',
      },
      body: responseBody,
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok: false, message: 'Proxy error', detail: String(error && error.message ? error.message : error) }),
    };
  }
};
