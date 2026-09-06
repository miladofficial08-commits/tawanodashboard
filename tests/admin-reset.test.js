const assert = require('node:assert/strict');
const tenant = require('../netlify/functions/_lib/tenant');
let write;
tenant.envValue = ()=>'admin-test';
tenant.getTenantById = async id=>id==='own'?{id}:null;
tenant.patchRows = async (table,query,patch)=>{write={query,patch};return [patch];};
const deleted=[];
tenant.deleteRows = async (table,query)=>{deleted.push({table,query});return [{},{}];};
const api = require('../netlify/functions/admin-reset-usage');
const event = body=>({httpMethod:'POST',headers:{},body:JSON.stringify(body)});
(async()=>{
 assert.equal((await api.handler(event({tenant_id:'own',mode:'minutes'}))).statusCode,401);
 assert.equal((await api.handler(event({admin_secret:'admin-test',tenant_id:'absent',mode:'minutes'}))).statusCode,404);
 assert.equal((await api.handler(event({admin_secret:'admin-test',tenant_id:'own',mode:'bad'}))).statusCode,400);
 assert.equal((await api.handler(event({admin_secret:'admin-test',tenant_id:'own',mode:'minutes'}))).statusCode,200);
 assert.ok(write.patch.minutes_reset_at); assert.equal(write.patch.go_live_at,undefined);
 assert.equal((await api.handler(event({admin_secret:'admin-test',tenant_id:'own',mode:'conversations'}))).statusCode,200);
 assert.ok(write.patch.go_live_at); assert.equal(write.patch.minutes_reset_at,undefined);
 assert.equal(write.query.id,'eq.own');

 // Vollstaendiger Reset: nur mit ausdruecklicher Bestaetigung, loescht nur diesen Kunden.
 assert.equal((await api.handler(event({admin_secret:'admin-test',tenant_id:'own',mode:'all'}))).statusCode,400,'ohne Bestaetigung kein Loeschen');
 assert.equal(deleted.length,0,'ohne Bestaetigung darf nichts geloescht werden');
 const wipe = await api.handler(event({admin_secret:'admin-test',tenant_id:'own',mode:'all',confirm:true}));
 assert.equal(wipe.statusCode,200);
 assert.deepEqual(deleted.map(d=>d.table),['call_workspace','call_sync_state','callback_requests','sms_feedback']);
 assert.ok(deleted.every(d=>d.query.tenant_id==='eq.own'),'Loeschen immer nur fuer diesen Mandanten');
 assert.ok(write.patch.minutes_reset_at && write.patch.go_live_at,'beide Startzeitpunkte neu');
 assert.equal((await api.handler(event({admin_secret:'wrong',tenant_id:'own',mode:'all',confirm:true}))).statusCode,401);
 console.log('Independent, admin-only resets passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
