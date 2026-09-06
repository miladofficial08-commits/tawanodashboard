const assert = require('node:assert/strict');
process.env.SUPABASE_URL = 'https://test.invalid';
process.env.SUPABASE_ANON_KEY = 'test';
const { resolveTenantContextFromAccessToken } = require('../netlify/functions/_lib/tenant');
let memberships = [], active = true;
global.fetch = async url => {
  const data = url.includes('/auth/') ? {id:'u1',email:'unknown@example.de'} : url.includes('tenant_memberships') ? memberships : [{id:'t1',is_active:active,retell_agent_id:'own'}];
  return {ok:true,status:200,text:async()=>JSON.stringify(data)};
};
(async () => {
  await assert.rejects(() => resolveTenantContextFromAccessToken('token'), /Kein Kundenkonto/);
  memberships = [{tenant_id:'t1',role:'owner'}];
  assert.equal((await resolveTenantContextFromAccessToken('token')).tenant.id,'t1');
  active=false;
  await assert.rejects(() => resolveTenantContextFromAccessToken('token'), /deaktiviert/);
  console.log('Tenant membership passed');
})().catch(e => { console.error(e); process.exitCode=1; });
