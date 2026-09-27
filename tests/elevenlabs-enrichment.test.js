const assert = require('node:assert/strict');
process.env.ELEVENLABS_API_KEY = 'test';
const el = require('../netlify/functions/_lib/elevenlabs');
const {dashboardSummary} = require('../netlify/functions/_lib/dashboard-summary');
assert.equal(dashboardSummary(null),'');
assert.equal(dashboardSummary({dashboard_next:{value:'Zurückrufen'}}),'','incomplete extraction must not replace the full provider summary');
assert.equal(dashboardSummary({dashboard_issue:{value:'Heizung bleibt kalt'},dashboard_price:{value:'Nicht genannt'}}),'Name: Nicht genannt\nEinsatzort: Nicht genannt\nAnliegen: Heizung bleibt kalt','show missing essentials but omit empty optional fields');
assert.match(dashboardSummary({dashboard_issue:'Sicherungskasten erneuern',dashboard_time:'Wunsch: morgen 15–18 Uhr; noch nicht bestätigt',dashboard_next:'Dringend zurückrufen und Verfügbarkeit sowie Anfahrt klären.'}),/Nächster Schritt: Zurückrufen und Terminwunsch abstimmen\./,'unconfirmed appointment requires appointment coordination');
assert.match(dashboardSummary({dashboard_issue:'Stromausfall',dashboard_urgency:'Sofortige Hilfe gewünscht; mögliche elektrische Gefahr',dashboard_time:'30–60 Minuten; noch nicht bestätigt',dashboard_next:'Techniker ist unterwegs.'}),/Nächster Schritt: Dringend zurückrufen und Verfügbarkeit sowie Anfahrt klären\./,'unconfirmed emergency must not inherit an unsupported dispatch claim');
global.fetch = async url => ({ok:true,json:async()=>({agent_id:url.endsWith('foreign')?'other':'own',conversation_id:'c',metadata:{phone_call:{external_number:'+49301234567',agent_number:'+49309999999',direction:'inbound'}},analysis:{transcript_summary:'Heizungswartung angefragt'}})});
(async () => {
  const calls = await el.enrichConversations('own',[{call_id:'mine',callAnalysis:{call_summary:'Brief Interaction'}}, {call_id:'foreign'}]);
  assert.equal(calls[0].phoneNumber,'+49301234567');
  assert.equal(calls[0].summary,'Heizungswartung angefragt');
  assert.equal(calls[0].callAnalysis.call_summary,'Heizungswartung angefragt','full analysis replaces the stale list title in both provider aliases');
  assert.equal(calls.length,1,'foreign detail must be discarded');
  const structured = 'Name: Frau Weber\nEinsatzort: Gartenstraße 12\nAnliegen: Sicherungskasten erneuern\nZeitangabe: Morgen 15–18 Uhr; noch nicht bestätigt.\nPreis: 450 € genannt.';
  global.fetch = async () => ({ok:true,json:async()=>({agent_id:'own',conversation_id:'structured',metadata:{},analysis:{
    transcript_summary:'The user requested a fuse box replacement.',
    data_collection_results:{dashboard_name:{value:'Frau Weber'},dashboard_address:{value:'Gartenstraße 12'},dashboard_issue:{value:'Sicherungskasten erneuern'},dashboard_time:{value:'Morgen 15–18 Uhr; noch nicht bestätigt.'},dashboard_price:{value:'450 € genannt.'},dashboard_additional:{value:null}},
  }})});
  const detailed = await el.getConversation('structured');
  assert.equal(detailed.call.summary,structured,'use full structured German analysis instead of English provider prose');
  const enriched = await el.enrichConversations('own',[{call_id:'structured'}]);
  assert.equal(enriched[0].summary,structured,'same structured facts in list and details');
  console.log('ElevenLabs enrichment passed');
})().catch(e => {console.error(e);process.exitCode=1;});
