#!/usr/bin/env node
const path = require('node:path');
process.chdir(path.resolve(__dirname, '..'));
const mod = require('../netlify/functions/translate');
(async () => {
  const event = {
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'The agent began introducing herself and explaining the services offered by the digital phone assistant, but the call was disconnected by the user before the conversation could proceed.', target: 'de' }),
    isBase64Encoded: false,
  };
  try {
    const res = await mod.handler(event);
    console.log('statusCode:', res.statusCode);
    console.log('body:', res.body);
    try { console.log('parsed:', JSON.parse(res.body)); } catch(_) {}
  } catch (err) { console.error(err); process.exit(1); }
})();
