const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'tavano-demo.html'), 'utf8');

assert.match(html, /Demo-Auswertung anfordern/);
assert.match(html, /name="name"/);
assert.match(html, /name="company"/);
assert.match(html, /name="phone"/);
assert.match(html, /name="email"/);
assert.match(html, /name="business_type"/);
assert.match(html, /name="desired_use_case"/);
assert.match(html, /name="urgency"/);
assert.match(html, /name="notes"/);
assert.match(html, /params\.get\('p'\)/);
assert.match(html, /params\.get\('t'\)/);
assert.match(html, /params\.get\('c'\)/);
assert.match(html, /fetch\('\/api\/tavano-lead'/);
