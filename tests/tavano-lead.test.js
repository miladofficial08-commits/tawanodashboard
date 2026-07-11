const assert = require('node:assert/strict');

function loadLeadModuleWithInsertMock(insertRow) {
  const tenantPath = require.resolve('../netlify/functions/_lib/tenant');
  const leadPath = require.resolve('../netlify/functions/tavano-lead');
  const actualTenant = require(tenantPath);
  const originalTenantExports = require.cache[tenantPath].exports;
  require.cache[tenantPath].exports = Object.assign({}, actualTenant, { insertRow });
  delete require.cache[leadPath];
  const mod = require(leadPath);
  require.cache[tenantPath].exports = originalTenantExports;
  return mod;
}

async function testValidationRequiresContactPath() {
  const { validateLeadPayload } = require('../netlify/functions/tavano-lead');
  const result = validateLeadPayload({ name: 'Max Mustermann' });
  assert.equal(result.ok, false);
  assert.match(result.message, /Telefonnummer oder E-Mail/);
}

async function testValidationNormalizesKnownFields() {
  const { validateLeadPayload } = require('../netlify/functions/tavano-lead');
  const result = validateLeadPayload({
    tenant_id: ' tenant_tavano ',
    call_id: ' call-123 ',
    phone_number: ' +49 211 123456 ',
    name: ' Max Mustermann ',
    company: ' Tavano Test GmbH ',
    email: ' MAX@EXAMPLE.COM ',
    business_type: ' Praxis ',
    desired_use_case: ' Anrufe annehmen ',
    urgency: ' Diese Woche sprechen ',
    notes: ' Bitte vormittags melden. ',
    source: ' sms_lead_capture ',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.lead, {
    tenant_id: 'tenant_tavano',
    call_id: 'call-123',
    phone_number: '+49 211 123456',
    name: 'Max Mustermann',
    company: 'Tavano Test GmbH',
    email: 'max@example.com',
    business_type: 'Praxis',
    desired_use_case: 'Anrufe annehmen',
    urgency: 'Diese Woche sprechen',
    notes: 'Bitte vormittags melden.',
    source: 'sms_lead_capture',
  });
}

async function testHandlerRejectsInvalidJson() {
  const { handler } = require('../netlify/functions/tavano-lead');
  const response = await handler({
    httpMethod: 'POST',
    body: '{',
  });
  assert.equal(response.statusCode, 400);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
}

async function testHandlerStoresValidLead() {
  let insertedTable = '';
  let insertedLead = null;
  const { handler } = loadLeadModuleWithInsertMock(async (table, lead) => {
    insertedTable = table;
    insertedLead = lead;
    return { id: 'lead_123' };
  });

  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      tenant_id: 'tenant_tavano',
      call_id: 'call_123',
      phone_number: '+49 170 1234567',
      name: 'Max',
      company: 'Tavano Test GmbH',
      email: 'max@example.com',
      business_type: 'Praxis',
      desired_use_case: 'Termine buchen',
      urgency: 'Diese Woche sprechen',
      notes: 'Bitte melden.',
    }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).lead_id, 'lead_123');
  assert.equal(insertedTable, 'tavano_leads');
  assert.equal(insertedLead.tenant_id, 'tenant_tavano');
  assert.equal(insertedLead.call_id, 'call_123');
  assert.equal(insertedLead.phone_number, '+49 170 1234567');
  assert.equal(insertedLead.source, 'sms_lead_capture');
}

async function run() {
  await testValidationRequiresContactPath();
  await testValidationNormalizesKnownFields();
  await testHandlerRejectsInvalidJson();
  await testHandlerStoresValidLead();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
