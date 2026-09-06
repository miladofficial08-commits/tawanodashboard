const assert = require('node:assert/strict');
const tenant = require('../netlify/functions/_lib/tenant');
tenant.envValue = name => ({ADMIN_SECRET:'admin',SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'test'})[name] || '';
let failAt = '', inserted = [], removed = [];
tenant.insertRow = async (table, row) => { if (table === failAt) throw new Error('injected failure'); inserted.push([table,row]); return [row]; };
require('../netlify/functions/_lib/agent-assignment').validateAssignment = async () => ({});
global.fetch = async (url, options) => {
  if (options.method === 'DELETE') removed.push(url);
  return {ok:true,json:async()=>({id:'new-user'})};
};
const { handler } = require('../netlify/functions/admin-create-customer');
const event = {httpMethod:'POST',headers:{'x-admin-secret':'admin'},body:JSON.stringify({name:'Testbetrieb',email:'test@example.de',password:'long-password',agent_id:'agent_own',provider:'elevenlabs'})};
(async()=>{
  failAt='tenants';
  assert.equal((await handler(event)).statusCode,500);
  assert.ok(removed.some(url=>url.endsWith('/users/new-user')),'orphan auth user must be deleted');
  removed=[]; failAt='tenant_memberships';
  assert.equal((await handler(event)).statusCode,500);
  assert.equal(removed.length,2,'tenant and auth user must be removed');
  failAt=''; inserted=[];
  assert.equal((await handler(event)).statusCode,200);
  const row=inserted.find(([table])=>table==='tenants')[1];
  assert.equal(row.elevenlabs_agent_id,'agent_own');
  assert.equal(row.retell_agent_id,null);
  assert.equal(inserted[1][1].tenant_id,row.id);
  console.log('Customer provisioning passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
