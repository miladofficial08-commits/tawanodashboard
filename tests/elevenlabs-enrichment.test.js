const assert = require('node:assert/strict');
process.env.ELEVENLABS_API_KEY = 'test';
const el = require('../netlify/functions/_lib/elevenlabs');
global.fetch = async url => ({ok:true,json:async()=>({agent_id:url.endsWith('foreign')?'other':'own',conversation_id:'c',metadata:{phone_call:{external_number:'+49301234567',agent_number:'+49309999999',direction:'inbound'}},analysis:{transcript_summary:'Heizungswartung angefragt'}})});
(async () => {
  const calls = await el.enrichConversations('own',[{call_id:'mine'}, {call_id:'foreign'}]);
  assert.equal(calls[0].phoneNumber,'+49301234567');
  assert.equal(calls[0].summary,'Heizungswartung angefragt');
  assert.equal(calls.length,1,'foreign detail must be discarded');
  console.log('ElevenLabs enrichment passed');
})().catch(e => {console.error(e);process.exitCode=1;});
