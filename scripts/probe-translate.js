#!/usr/bin/env node
const endpoints = [
  'https://libretranslate.de/translate',
  'https://libretranslate.com/translate',
  'https://translate.astian.org/translate',
  'https://libretranslate.org/translate',
  'https://translate.argosopentech.com/translate'
];
(async () => {
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: 'Hello world', source: 'auto', target: 'de', format: 'text' }) });
      const text = await res.text();
      console.log('Endpoint:', url, 'Status:', res.status);
      console.log('Response:', text.slice(0, 1000));
    } catch (err) {
      console.log('Endpoint:', url, 'Error:', String(err && err.message ? err.message : err));
    }
    console.log('---');
  }
})();
