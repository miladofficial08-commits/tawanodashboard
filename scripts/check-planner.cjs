// Reads an existing linked customer's calls; imports provider data into its workspace.
// Does not change schedules, notes, completion state, budgets or reset dates.
const assert=require('node:assert/strict');
const tenant=require('../netlify/functions/_lib/tenant');
(async()=>{
 const tenants=await tenant.listRows('tenants',{select:'id,name,is_active'},{serviceRole:true});
 const selected=tenants.find(t=>t.is_active && /tawano|tavano/i.test(t.name));
 if(!selected)throw new Error('Kein Tawano-Testzugang gefunden.');
 const login=await require('../netlify/functions/admin-impersonate').handler({httpMethod:'POST',headers:{},body:JSON.stringify({admin_secret:tenant.envValue('ADMIN_SECRET'),tenant_id:selected.id})});
 const auth=JSON.parse(login.body); assert.equal(login.statusCode,200,auth.message);
 const event={httpMethod:'GET',headers:{authorization:'Bearer '+auth.accessToken}};
 const response=await require('../netlify/functions/debug-calls').handler(event);
 const data=JSON.parse(response.body);assert.equal(response.statusCode,200,data.message);
 assert.equal(data.tenant.id,selected.id);assert.ok(data.calls.every(c=>c.work && !String(c.call_id).startsWith('preview-')));
 console.log(JSON.stringify({status:response.statusCode,realCalls:data.calls.length,persistentWorkspace:true,minutesUsed:data.tenant.minutes_used,historyLimited:data.historyLimited,historyPending:data.historyPending}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
