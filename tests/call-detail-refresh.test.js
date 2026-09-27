const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const elements = new Map();
const node = id => {
  if (!elements.has(id)) elements.set(id,{textContent:'',innerHTML:'',classList:{remove(){}}});
  return elements.get(id);
};
const call = {call_id:'own',provider:'elevenlabs',phoneNumber:'+49301234567',summary:'Brief Interaction',callAnalysis:{call_summary:'Brief Interaction'}};
const ctx = {
  German:require('../public/german'),escHtml:s=>String(s),serverUrl:()=>'',
  calls:[call],previewMode:false,currentTenant:{detailed_analysis:false},authToken:'own-token',
  callKey:c=>c.call_id,customerPhone:c=>c.phoneNumber,authHeaders:()=>({}),render(){},
  classifyCall:()=>({label:'Bitte prüfen'}),fmtTime:()=>'',
  detailSummarySource:c=>c.callAnalysis.call_summary,
  extractFieldByLabels:()=>'',
  buildDetailModel:(c,text)=>({text}),detailHtml:(c,i,m)=>m.text,workEditorHtml:()=>'',
  document:{getElementById:node},
  fetchApi:async()=>({res:{ok:true},data:{ok:true,call:{summary:'Die Heizung bleibt kalt. Rückruf um 16 Uhr.',duration_ms:75000,disconnection_reason:'user_hangup',from_number:'+49301234567'}}}),
};
vm.createContext(ctx);
const source = fs.readFileSync('public/dashboard-actions.js','utf8');
vm.runInContext(source.slice(source.indexOf('async function openDetail('),source.indexOf('async function loadCallTranscript(')),ctx);
vm.runInContext(source.slice(source.indexOf('async function loadCallTranscript('),source.indexOf('function closeDetail(')),ctx);
(async()=>{
  await ctx.openDetail(0);
  assert.match(node('detail-body').innerHTML,/Heizung bleibt kalt/,'fetch full details even when caller phone is already known');
  assert.equal(call.durationMs,75000);
  assert.equal(call.disconnectionReason,'user_hangup');
  ctx.fetchApi=async()=>{throw new Error('offline');};
  await ctx.openDetail(0);
  assert.match(node('detail-body').innerHTML,/Heizung bleibt kalt/,'retain known details when refresh fails');
  assert.match(node('detail-body').innerHTML,/nicht.*geladen/i,'show failure explicitly');
  ctx.fetch=async()=>({ok:true,json:async()=>({ok:true,call:{transcript_object:[{role:'agent',content:'The customer requested a callback.'},{role:'user',content:'Bitte um 16 Uhr zurückrufen.'}]}})});
  await ctx.loadCallTranscript('own');
  assert.ok(!node('transcript-body').innerHTML.includes('The customer'),'optional transcript must not leak English');
  assert.match(node('transcript-body').innerHTML,/16 Uhr/,'keep German transcript details');
  console.log('Call detail refresh passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
