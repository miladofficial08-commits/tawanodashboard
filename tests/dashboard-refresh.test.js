const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require.resolve('../public/dashboard-views.js'),'utf8').split('function renderCurrentList')[0];
let release;
const ctx={previewMode:false,authToken:'own',workSaving:false,workRevision:0,currentTenant:null,calls:[],setStatus:()=>{},authHeaders:()=>({}),render:()=>{},document:{getElementById:()=>({})},console,logout:()=>{},getResetAt:()=>{throw new Error('Must not use local reset');},fetchApi:()=>new Promise(resolve=>{release=resolve;})};
vm.createContext(ctx);vm.runInContext(source,ctx);
const result={res:{status:200,ok:true},data:{ok:true,tenant:{id:'own'},calls:[{id:'one'}]}};
(async()=>{
 let refreshing=ctx.refreshCalls();release(result);await refreshing;assert.equal(ctx.calls[0].id,'one');
 refreshing=ctx.refreshCalls();ctx.workRevision++;release({...result,data:{...result.data,calls:[{id:'stale'}]}});await refreshing;assert.equal(ctx.calls[0].id,'one','refresh must not overwrite newer edits');
 console.log('Dashboard refresh and save race passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
