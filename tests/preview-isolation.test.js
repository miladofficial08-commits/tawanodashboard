const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('public/preview.js','utf8');
// Beispieldaten nur mit ausdruecklichem Schalter: preview=1 nur lokal,
// demo=1 ueberall (Vorfuehr-Dashboard, ebenfalls ohne Schreibzugriff).
for (const [hostname, search, expected] of [['localhost','?preview=1',true],['localhost','',false],['dashboard.example.de','?preview=1',false],['dashboard.example.de','?demo=1',true],['dashboard.example.de','?demo=0',false],['tawano-production.up.railway.app','',false]]) {
  const context = {URLSearchParams,location:{hostname,search},document:{querySelectorAll:()=>[]}};
  vm.createContext(context); vm.runInContext(source,context);
  assert.equal(vm.runInContext('previewMode',context),expected,hostname+search);
}
// Der Vorfuehrmodus darf ausserdem nie in den Admin-Vorschaupfad rutschen.
const demoContext = {URLSearchParams,location:{hostname:'dashboard.example.de',search:'?demo=1'},document:{querySelectorAll:()=>[]}};
vm.createContext(demoContext); vm.runInContext(source,demoContext);
assert.equal(vm.runInContext('adminPreview',demoContext),false,'demo darf keine Admin-Vorschau aktivieren');
assert.ok(vm.runInContext('previewCalls().length > 20',demoContext),'Vorfuehr-Dashboard braucht genug Beispielanrufe');
assert.ok(vm.runInContext('previewFeedback().length > 5',demoContext),'Vorfuehr-Dashboard braucht Beispielbewertungen');
console.log('Preview isolation passed: samples only with an explicit preview or demo flag');
