const assert = require('node:assert/strict');
const { __test } = require('../netlify/functions/retell-call-events');

assert.equal(__test.shouldHandle({ event: 'call_ended', call: { agent_id: 'agent_ff22892da02f1277fd6640169e', call_id: 'call_1' } }), true);
assert.equal(__test.shouldHandle({ event: 'call_started', call: { agent_id: 'agent_ff22892da02f1277fd6640169e', call_id: 'call_1' } }), false);
assert.equal(__test.shouldHandle({ event: 'call_ended', call: { agent_id: 'agent_other', call_id: 'call_1' } }), false);
console.log('retell-call-ended.test.js: all assertions passed');
