const assert = require('node:assert/strict');

// Der Lesepfad muss mit den ECHTEN ElevenLabs-Payloads klarkommen. Die hier
// verwendeten Fixtures sind 1:1 die Struktur der Live-API (v1/convai):
// - Listen-Eintraege haben KEIN metadata-Objekt, dafuer flaches `direction`.
// - `transcript_summary` ist in der Liste oft null, `call_summary_title` gesetzt.
// - `metadata.phone_call` ist bei Web-Gespraechen null (nicht undefined!).
process.env.ELEVENLABS_API_KEY = 'test-key';
const elevenlabs = require('../netlify/functions/_lib/elevenlabs');

const LIST_ITEM_PHONE = {
  agent_id: 'agent_lisa',
  conversation_id: 'conv_1',
  start_time_unix_secs: 1786358433,
  call_duration_secs: 15,
  status: 'done',
  termination_reason: 'Call was transferred to number',
  call_successful: 'success',
  transcript_summary: null,
  call_summary_title: 'Mitarbeiter weiterleiten',
  direction: 'inbound',
  sentiment_analysis: { overall_label: 'neutral' },
};

const DETAIL_WEB_CALL = {
  agent_id: 'agent_lisa',
  conversation_id: 'conv_web',
  has_audio: true,
  status: 'done',
  transcript: [
    { role: 'agent', message: 'Guten Tag, hier ist Lisa.' },
    { role: 'user', message: 'Ich haette gern einen Termin.' },
    { role: 'agent', message: '' },
  ],
  metadata: {
    start_time_unix_secs: 1786358433,
    call_duration_secs: 42,
    termination_reason: 'Call was transferred to number',
    phone_call: null, // <- genau das hat den Detail-Aufruf frueher geworfen
  },
  analysis: {
    transcript_summary: null,
    call_summary_title: 'Terminwunsch',
    call_successful: 'success',
    sentiment_analysis: { overall_label: 'positive' },
  },
};

function stubFetch(routes) {
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    for (const [needle, payload] of routes) {
      if (String(url).includes(needle)) {
        return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
      }
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  return seen;
}

// Web-Gespraeche liefern phone_call: null. `typeof null === 'object'` - ohne
// explizite Pruefung wirft jeder Feldzugriff und der Kunde sieht statt des
// Transkripts einen 502er.
async function testNullPhoneCallDoesNotThrow() {
  stubFetch([['/conversations/conv_web', DETAIL_WEB_CALL]]);
  const detail = await elevenlabs.getConversation('conv_web');
  assert.ok(detail, 'Detail muss geliefert werden');
  assert.equal(detail.call.from_number, null);
  assert.equal(detail.call.to_number, null);
  assert.equal(detail.call.direction, null);
}

// Auch die Liste darf an einem null-phone_call nicht sterben.
async function testNullPhoneCallInListDoesNotThrow() {
  const item = Object.assign({}, LIST_ITEM_PHONE, { metadata: { phone_call: null } });
  stubFetch([['/conversations?', { conversations: [item], has_more: false }]]);
  const calls = await elevenlabs.listConversations('agent_lisa', { limit: 10 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].from_number, null);
}

// Transkript: leere Turns raus, Rollen auf agent/user normiert, Klartext lesbar.
async function testTranscriptMapping() {
  stubFetch([['/conversations/conv_web', DETAIL_WEB_CALL]]);
  const detail = await elevenlabs.getConversation('conv_web');
  assert.equal(detail.call.transcript_object.length, 2, 'leere Nachrichten muessen rausfliegen');
  assert.equal(detail.call.transcript_object[0].role, 'agent');
  assert.ok(detail.call.transcript.includes('Agent: Guten Tag'));
  assert.ok(detail.call.transcript.includes('Anrufer: Ich haette gern'));
}

// Ohne transcript_summary muss call_summary_title einspringen, sonst bleibt die
// Anrufliste im Dashboard unbeschriftet.
async function testSummaryFallsBackToTitle() {
  stubFetch([['/conversations?', { conversations: [LIST_ITEM_PHONE], has_more: false }]]);
  const calls = await elevenlabs.listConversations('agent_lisa', { limit: 10 });
  assert.equal(calls[0].summary, 'Mitarbeiter weiterleiten');
  assert.equal(calls[0].call_analysis.call_summary, 'Mitarbeiter weiterleiten');

  stubFetch([['/conversations/conv_web', DETAIL_WEB_CALL]]);
  const detail = await elevenlabs.getConversation('conv_web');
  assert.equal(detail.call.summary, 'Terminwunsch');
}

// Listen-Eintraege haben kein metadata - die Richtung steht flach im Item.
async function testDirectionFromFlatField() {
  stubFetch([['/conversations?', { conversations: [LIST_ITEM_PHONE], has_more: false }]]);
  const calls = await elevenlabs.listConversations('agent_lisa', { limit: 10 });
  assert.equal(calls[0].direction, 'inbound');
}

// Rufnummern kommen nur im Detail (metadata.phone_call) und muessen dort ankommen.
async function testPhoneNumbersFromDetail() {
  const withPhone = JSON.parse(JSON.stringify(DETAIL_WEB_CALL));
  withPhone.metadata.phone_call = { direction: 'inbound', external_number: '+4915112345678', agent_number: '+4921186943717' };
  stubFetch([['/conversations/conv_web', withPhone]]);
  const detail = await elevenlabs.getConversation('conv_web');
  assert.equal(detail.call.from_number, '+4915112345678');
  assert.equal(detail.call.to_number, '+4921186943717');
  assert.equal(detail.call.direction, 'inbound');
}

// ElevenLabs liefert englischen Freitext; das Dashboard uebersetzt Retell-Keys.
// Bekannte Faelle muessen deshalb auf genau diese Keys gemappt werden.
async function testTerminationReasonMapping() {
  stubFetch([['/conversations?', { conversations: [LIST_ITEM_PHONE], has_more: false }]]);
  const calls = await elevenlabs.listConversations('agent_lisa', { limit: 10 });
  assert.equal(calls[0].disconnection_reason, 'call_transfer', 'muss der Dashboard-Key sein, nicht der Rohtext');
  assert.equal(calls[0].disconnectionReason, 'call_transfer');

  // Unbekannte Gruende bleiben unveraendert, damit nichts still verschluckt wird.
  const odd = Object.assign({}, LIST_ITEM_PHONE, { termination_reason: 'Something new from ElevenLabs' });
  stubFetch([['/conversations?', { conversations: [odd], has_more: false }]]);
  const oddCalls = await elevenlabs.listConversations('agent_lisa', { limit: 10 });
  assert.equal(oddCalls[0].disconnection_reason, 'Something new from ElevenLabs');
}

async function testSentimentMapping() {
  stubFetch([['/conversations?', { conversations: [LIST_ITEM_PHONE], has_more: false }]]);
  const calls = await elevenlabs.listConversations('agent_lisa', { limit: 10 });
  assert.equal(calls[0].call_analysis.user_sentiment, 'Neutral');

  stubFetch([['/conversations/conv_web', DETAIL_WEB_CALL]]);
  const detail = await elevenlabs.getConversation('conv_web');
  assert.equal(detail.call.user_sentiment, 'Positiv');
}

// Status- und Dauer-Mapping muss die Retell-Werte treffen, die das Frontend kennt.
async function testStatusAndDuration() {
  stubFetch([['/conversations?', { conversations: [LIST_ITEM_PHONE], has_more: false }]]);
  const calls = await elevenlabs.listConversations('agent_lisa', { limit: 10 });
  assert.equal(calls[0].status, 'ended');
  assert.equal(calls[0].durationMs, 15000);
  assert.equal(calls[0].provider, 'elevenlabs');
  assert.equal(calls[0].call_analysis.call_successful, true);
}

// Die Admin-Kundenliste zieht Anzahl/Minuten aus agentStats - und darf bei einem
// API-Fehler NIE werfen, sonst kippt die ganze Liste.
async function testAgentStats() {
  const items = [
    Object.assign({}, LIST_ITEM_PHONE, { conversation_id: 'c1', call_duration_secs: 60 }),
    Object.assign({}, LIST_ITEM_PHONE, { conversation_id: 'c2', call_duration_secs: 30 }),
    Object.assign({}, LIST_ITEM_PHONE, { conversation_id: 'c3', call_duration_secs: 0 }),
  ];
  stubFetch([['/conversations?', { conversations: items, has_more: false }]]);
  const stats = await elevenlabs.agentStats('agent_lisa');
  assert.equal(stats.calls, 3);
  assert.equal(stats.connectedCalls, 2, 'Anrufe mit 0 Sekunden zaehlen nicht als verbunden');
  assert.equal(stats.billedMinutes, 2);

  globalThis.fetch = async () => { throw new Error('ElevenLabs down'); };
  const safe = await elevenlabs.agentStats('agent_lisa');
  assert.equal(safe.calls, 0, 'Fehler darf die Admin-Liste nicht sprengen');
}

// Ohne Agent-ID darf kein ungefilterter Abruf rausgehen - sonst saehe ein Kunde
// fremde Gespraeche.
async function testNoAgentIdMeansNoRequest() {
  const seen = stubFetch([['/conversations?', { conversations: [LIST_ITEM_PHONE], has_more: false }]]);
  const calls = await elevenlabs.listConversations('', { limit: 10 });
  assert.deepEqual(calls, []);
  assert.equal(seen.length, 0, 'ohne Agent-ID darf gar nicht erst angefragt werden');
}

// Der Agent-Filter muss wirklich in der Query landen (Datentrennung).
async function testAgentIdIsSentAsFilter() {
  const seen = stubFetch([['/conversations?', { conversations: [], has_more: false }]]);
  await elevenlabs.listConversations('agent_lisa', { limit: 10 });
  assert.ok(seen.length === 1 && seen[0].includes('agent_id=agent_lisa'), 'agent_id muss als Filter mitgehen');
}

async function run() {
  await testNullPhoneCallDoesNotThrow();
  await testNullPhoneCallInListDoesNotThrow();
  await testTranscriptMapping();
  await testSummaryFallsBackToTitle();
  await testDirectionFromFlatField();
  await testPhoneNumbersFromDetail();
  await testTerminationReasonMapping();
  await testSentimentMapping();
  await testStatusAndDuration();
  await testAgentStats();
  await testNoAgentIdMeansNoRequest();
  await testAgentIdIsSentAsFilter();
  console.log('elevenlabs-provider.test.js: all assertions passed');
}

run().catch((e) => { console.error(e); process.exit(1); });
