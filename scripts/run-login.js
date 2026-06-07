#!/usr/bin/env node
// Simple runner to invoke the Netlify function handler locally.
// Usage: node scripts/run-login.js <email> <password>

const path = require('node:path');
(async () => {
  try {
    const args = process.argv.slice(2);
    const email = args[0] || '';
    const password = args[1] || '';
    if (!email || !password) {
      console.error('Usage: node scripts/run-login.js <email> <password>');
      process.exit(2);
    }

    // Ensure we run from repo root so _lib/tenant reads .env
    process.chdir(path.resolve(__dirname, '..'));

    const mod = require('../netlify/functions/client-auth-login');
    if (!mod || typeof mod.handler !== 'function') {
      console.error('Unable to load handler from netlify/functions/client-auth-login');
      process.exit(3);
    }

    const event = {
      httpMethod: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
      isBase64Encoded: false,
    };

    console.log('Invoking handler... (this will contact Supabase/External APIs)');
    const res = await mod.handler(event);
    console.log('=== Handler response ===');
    console.log('statusCode:', res && res.statusCode);
    console.log('headers:', res && res.headers);
    console.log('body:', res && res.body);
    try {
      console.log('body (parsed):', JSON.parse(res && res.body ? res.body : '{}'));
    } catch (e) {
      console.error('Failed to parse body as JSON');
    }
  } catch (err) {
    console.error('Error running handler:', err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();
