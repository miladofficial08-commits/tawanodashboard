#!/usr/bin/env node
const path = require('node:path');

// Run from project root
process.chdir(path.resolve(__dirname, '..'));

const { envValue } = require('../netlify/functions/_lib/tenant');

const RETELL_API_KEY = envValue('RETELL_API_KEY') || process.env.RETELL_API_KEY || '';
if (!RETELL_API_KEY) {
  console.error('No RETELL_API_KEY found in .env or environment.');
  process.exit(2);
}

(async () => {
  try {
    const body = { sort_order: 'descending', limit: 5 };
    const res = await fetch('https://api.retellai.com/v3/list-calls', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + RETELL_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch (_) { console.error('Response not JSON'); console.log(raw); process.exit(3); }
    if (!res.ok) {
      console.error('Retell API error', res.status, data.error_message || data.message || data);
      process.exit(4);
    }
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) { console.log('No calls returned'); return; }
    const first = items[0];
    console.log('Call id:', first.call_id || first.id || '(no id)');
    console.log('Agent id:', first.agent_id);
    console.log('Metadata:', first.metadata || {});
    console.log('\n--- call_analysis ---');
    console.log(JSON.stringify(first.call_analysis || first.callAnalysis || {}, null, 2));
    console.log('\n--- raw response (first item) ---');
    console.log(JSON.stringify(first, null, 2).slice(0, 8000));
  } catch (err) {
    console.error('Error calling Retell API', String(err && err.message ? err.message : err));
    process.exit(1);
  }
})();
