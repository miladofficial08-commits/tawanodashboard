const { envValue, json } = require('./_lib/tenant');

async function callLibreTranslate(text, target, apiKey, url) {
  const translateUrl = url || envValue('TRANSLATE_URL') || 'https://libretranslate.de/translate';
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
  const res = await fetch(translateUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ q: text, source: 'auto', target: target, format: 'text' }),
  });
  const raw = await res.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = { raw }; }
  // common keys
  return { ok: res.ok, data };
}

exports.handler = async (event) => {
  if ((event.httpMethod || 'GET').toUpperCase() !== 'POST') return json(405, { ok: false, message: 'Method Not Allowed' });

  let body = {};
  try { body = event.isBase64Encoded ? JSON.parse(Buffer.from(event.body, 'base64').toString('utf8')) : JSON.parse(event.body); } catch (_) { body = {}; }
  const text = String(body.text || '').trim();
  const target = String(body.target || 'de').trim();
  if (!text) return json(400, { ok: false, message: 'Missing text to translate' });

  const provider = String(envValue('TRANSLATE_PROVIDER') || 'libre').toLowerCase();
  const apiKey = envValue('TRANSLATE_API_KEY') || '';

  try {
    if (provider === 'deepl' && apiKey) {
      const params = new URLSearchParams();
      params.set('text', text);
      params.set('target_lang', target.toUpperCase());
      const response = await fetch('https://api-free.deepl.com/v2/translate', {
        method: 'POST',
        headers: { 'Authorization': 'DeepL-Auth-Key ' + apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      const raw = await response.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = {}; }
      if (!response.ok) return json(response.status || 502, { ok: false, message: 'DeepL error', detail: data });
      const translated = (data.translations && data.translations[0] && data.translations[0].text) ? data.translations[0].text : '';
      return json(200, { ok: true, translated });
    }

    // default: LibreTranslate
    const res = await callLibreTranslate(text, target, apiKey, envValue('TRANSLATE_URL'));
    if (!res.ok) return json(502, { ok: false, message: 'Translate API error', detail: res.data });
    const d = res.data;
    const translated = d.translatedText || d.translated || d.translation || d.translated_text || (d.result ? d.result : '') || '';
    return json(200, { ok: true, translated });
  } catch (error) {
    return json(502, { ok: false, message: 'Translation failed', detail: String(error && error.message ? error.message : error) });
  }
};
