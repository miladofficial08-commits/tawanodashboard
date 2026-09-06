const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('public/preview.js','utf8');
for (const [hostname, search, expected] of [['localhost','?preview=1',true],['localhost','',false],['dashboard.example.de','?preview=1',false]]) {
  const context = {URLSearchParams,location:{hostname,search},document:{querySelectorAll:()=>[]}};
  vm.createContext(context); vm.runInContext(source,context);
  assert.equal(vm.runInContext('previewMode',context),expected,hostname+search);
}
console.log('Preview isolation passed: samples only on explicit localhost preview');
