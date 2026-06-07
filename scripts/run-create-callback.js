#!/usr/bin/env node
const path = require('node:path');
process.chdir(path.resolve(__dirname, '..'));
const mod = require('../netlify/functions/create-callback-request');
(async () => {
  const sampleSummary = 'The user inquired about nail designs with pink unicorns at Beauty World Düsseldorf. The agent provided detailed information about available services and discussed design preferences, then attempted to schedule a callback for the user at 2 PM, but encountered a technical error with the booking tool. Despite the error, the agent assured the user that their callback request was noted and ended the call politely.';
  const event = {
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify({ phone_number: '+491631283971', call_summary: sampleSummary }),
    isBase64Encoded: false,
  };
  try {
    const res = await mod.handler(event);
    console.log('statusCode:', res.statusCode);
    console.log('body:', res.body);
    try { console.log('parsed:', JSON.parse(res.body)); } catch(_) {}
  } catch (err) { console.error(err); process.exit(1); }
})();
