const assert=require('node:assert/strict');
process.env.SUPABASE_URL='https://test.invalid';process.env.SUPABASE_ANON_KEY='test';process.env.SUPABASE_SERVICE_ROLE_KEY='test';
let posts=0;
global.fetch=async (url,opts)=>{if(opts.method==='POST')posts++;return {ok:false,status:503,text:async()=>JSON.stringify({message:'Temporary outage'})};};
const {getTenantSettings,saveTenantSettings}=require('../netlify/functions/_lib/tenant');
(async()=>{
 await assert.rejects(()=>getTenantSettings('own',{serviceRole:true,strict:true}),/Temporary outage/);
 await assert.rejects(()=>saveTenantSettings('own',{minutes_budget:200},{serviceRole:true}),/Temporary outage/);
 assert.equal(posts,0,'failed settings read must never overwrite existing budget and templates');
 console.log('Settings failure preserves existing configuration');
})().catch(e=>{console.error(e);process.exitCode=1;});
