const assert=require('node:assert/strict');
const tenant=require('../netlify/functions/_lib/tenant');
let imported;
tenant.supabaseRequest=async (path,opts)=>{imported=opts.body;return {response:{ok:true}};};
tenant.listRows=async (table,query)=>{
 assert.equal(query.tenant_id,'eq.own');assert.equal(query.agent_id,'eq.agent');
 return [
  {snapshot:{call_id:'old'},state:'open',duration_ms:60000,connected:true,started_at:'2026-09-05T10:00:00Z'},
  {snapshot:{call_id:'mine'},state:'done',notes:'Saved',duration_ms:120000,connected:true,started_at:'2026-09-06T10:00:00Z'},
  {snapshot:{},state:'deleted',duration_ms:180000,connected:true,started_at:'2026-09-06T11:00:00Z'},
 ];
};
const {syncCalls}=require('../netlify/functions/_lib/call-workspace');
(async()=>{
 const result=await syncCalls({id:'own',provider:'retell',retell_agent_id:'agent',minutes_reset_at:'2026-09-06T00:00:00Z'},[{call_id:'mine'}]);
 assert.equal(imported.p_tenant,'own');assert.equal(imported.p_agent,'agent');
 assert.equal(result.minutesUsed,5,'deleted calls still consume actual minutes; reset excludes earlier usage');
 assert.equal(result.calls.length,2);assert.equal(result.calls[1].work.notes,'Saved');
 console.log('Workspace persistence mapping and independent usage passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
