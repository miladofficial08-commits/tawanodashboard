# Tawano Voice Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Tawano Retell agent reliably find and book real Cal.com slots and send exactly one outcome-appropriate SMS.

**Architecture:** Retell supplies trusted call context through the Tawano phone-number webhook and full custom-tool payload. Netlify resolves tenant configuration once, normalizes model-owned arguments, performs calendar/SMS actions idempotently, and returns explicit results the agent can speak accurately.

**Tech Stack:** Node.js CommonJS, Netlify Functions, Supabase REST, Retell API v2, Cal.com API v2, seven.io, `node:assert`.

## Global Constraints

- Change only Tawano tenant `tenant_tawano`, agent `agent_ff22892da02f1277fd6640169e`, and phone `+4921186943411` in live systems.
- Never expose or log credentials; rotate currently exposed credentials after functional verification.
- Caller phone numbers are recipients, never tenant identity.
- No tenant may inherit another tenant's agent, calendar, prompt, SMS template, sender, or credential.
- Preserve existing production route URLs and add no runtime dependency.
- Retell/Cal.com retries must not create duplicate bookings or SMS messages.

---

### Task 1: Repair and Prove Shared Tool Authentication

**Files:**
- Modify: `netlify/functions/_lib/retell-auth.js`
- Modify: `tests/retell-tool-auth.test.js`
- Verify: `netlify/functions/book-appointment.js`
- Verify: `netlify/functions/get-available-slots.js`
- Verify: `netlify/functions/send-booking-link.js`
- Verify: `netlify/functions/create-callback-request.js`

**Interfaces:**
- Produces: `configuredToolSecret(): string`, `isAuthorizedToolRequest(event): boolean`, `isToolAuthenticationConfigured(): boolean`.

- [ ] **Step 1: Align the failing test with migration-safe behavior**

```js
function testMissingConfigurationKeepsExistingCallsWorking() {
  const auth = loadAuth({});
  assert.equal(auth.isAuthorizedToolRequest(eventWith('anything')), true);
  assert.equal(auth.isToolAuthenticationConfigured(), false);
}
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node tests/retell-tool-auth.test.js`
Expected: FAIL until the stale fail-closed assertion is replaced consistently and all endpoint imports resolve.

- [ ] **Step 3: Keep the deployed migration rule explicit**

```js
function isAuthorizedToolRequest(event) {
  const expected = configuredToolSecret();
  if (!expected) return true;
  const incoming = incomingSecret(event);
  return Boolean(incoming && incoming === expected);
}
```

- [ ] **Step 4: Run focused and full tests**

Run: `node tests/retell-tool-auth.test.js && npm test`
Expected: all assertions pass.

### Task 2: Normalize German Availability Preferences

**Files:**
- Modify: `netlify/functions/get-available-slots.js`
- Modify: `tests/tavano-booking.test.js`

**Interfaces:**
- Produces: `normalizeTimePreference(value): 'any'|'morning'|'afternoon'|'evening'` and `filterByTimePreference(slots, preference): Slot[]`.

- [ ] **Step 1: Add failing German-value tests**

```js
assert.equal(__slots.normalizeTimePreference('vormittags'), 'morning');
assert.equal(__slots.normalizeTimePreference('nachmittags'), 'afternoon');
assert.equal(__slots.normalizeTimePreference('abends'), 'evening');
assert.equal(__slots.normalizeTimePreference('egal'), 'any');
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/tavano-booking.test.js`
Expected: FAIL because `normalizeTimePreference` is not exported.

- [ ] **Step 3: Implement the minimal mapping**

```js
const aliases = {
  morning: 'morning', morgens: 'morning', vormittag: 'morning', vormittags: 'morning',
  afternoon: 'afternoon', nachmittag: 'afternoon', nachmittags: 'afternoon',
  evening: 'evening', abend: 'evening', abends: 'evening',
  any: 'any', egal: 'any', beliebig: 'any',
};
```

- [ ] **Step 4: Apply normalization before filtering and run tests**

Run: `node tests/tavano-booking.test.js && npm test`
Expected: all assertions pass.

### Task 3: Derive Booking Identity From Trusted Call Context

**Files:**
- Modify: `netlify/functions/book-appointment.js`
- Modify: `tests/tavano-booking.test.js`

**Interfaces:**
- Consumes: `resolveTenantFromToolBody(body)` returning `{ tenant, call, agentId }`.
- Produces: `normalizeToolInput(raw)` and `bookingPhoneFromInput(input, callPayload, fetchedCall)`.

- [ ] **Step 1: Add failing tests for full Retell payloads without model-supplied phone or call ID**

```js
const input = normalizeToolInput({
  call: { call_id: 'call_1', direction: 'inbound', from_number: '+491631283971', to_number: '+4921186943411' },
  args: { date: '2026-07-15', time: '14:00', customer_name: 'Test' },
});
assert.equal(input.call_id, 'call_1');
assert.equal(input.phone_number, '+491631283971');
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node tests/tavano-booking.test.js`
Expected: FAIL if full-payload derivation is incomplete.

- [ ] **Step 3: Make only date, time, and customer name model-owned**

The handler derives call ID and recipient from `call` or fetched Retell call data and rejects placeholders. Tool failure responses list only genuinely missing caller-collected fields.

- [ ] **Step 4: Run focused and regression tests**

Run: `node tests/tavano-booking.test.js && npm test`
Expected: all assertions pass.

### Task 4: Guarantee One SMS Per Call Outcome

**Files:**
- Modify: `netlify/functions/book-appointment.js`
- Modify: `netlify/functions/send-booking-link.js`
- Modify: `netlify/functions/_lib/sms.js`
- Modify: `tests/tavano-sms-flow.test.js`

**Interfaces:**
- Produces: tenant-scoped booking lookup and SMS idempotency key `${tenantId}:${callId}:${type}:${recipient}`.

- [ ] **Step 1: Add failing duplicate-outcome tests**

```js
assert.equal(await shouldSendStandardSms({ callId: 'call_1', recentBooking: true }), false);
assert.equal(buildSmsIdempotencyKey('tenant_tawano', 'call_1', 'appointment', '+491631283971'),
  'tenant_tawano:call_1:appointment:491631283971');
```

- [ ] **Step 2: Run the SMS test and verify RED**

Run: `node tests/tavano-sms-flow.test.js`
Expected: FAIL because the shared idempotency helper does not exist.

- [ ] **Step 3: Add the minimal shared helper and existing-log check**

Before provider delivery, query `sms_logs` by tenant, call, type, and recipient. Return the recorded result on a retry. Booking SMS writes type `appointment`; the end-of-call path skips when a successful booking exists and otherwise writes type `feedback`.

- [ ] **Step 4: Run focused and full tests**

Run: `node tests/tavano-sms-flow.test.js && npm test`
Expected: all assertions pass.

### Task 5: Publish Correct Tawano Retell Configuration

**Files:**
- Modify: `README.md`
- Live target: Retell agent `agent_ff22892da02f1277fd6640169e`, version 14
- Live target: Retell phone `+4921186943411`

**Interfaces:**
- Custom tools keep `args_at_root=false` so Retell sends `{ name, call, args }`.
- Inbound webhook: `https://tawanodashboard.netlify.app/api/retell-inbound`.

- [ ] **Step 1: Validate the current Retell prompt and tool JSON against backend fields**

Required booking arguments become `date`, `time`, and `customer_name`; `confirmed_mobile_number` and `retell_call_id` are removed from `required`.

- [ ] **Step 2: Update only the Tawano LLM tools and prompt**

The prompt states: availability first, offer only returned slots, confirm only `success=true`, never call the standard SMS tool after a booking, and send the feedback SMS once when no booking occurred.

- [ ] **Step 3: Attach and verify the inbound webhook on the Tawano phone**

Probe with the Tavano number and verify response variables contain `tenant_tawano`, current Berlin date, and caller number.

- [ ] **Step 4: Re-read live Retell agent, LLM, and phone configuration**

Expected: only the specified Tawano targets changed and all URLs/schemas match production endpoints.

### Task 6: Build, Deploy, and Run Live Acceptance Tests

**Files:**
- Verify: `netlify.toml`
- Verify: all modified files above

**Interfaces:**
- Netlify site: `tawanodashboard`.

- [ ] **Step 1: Run verification locally**

Run: `npm test`
Expected: all test files pass.

Run: `npm run build`
Expected: Netlify build completes successfully.

- [ ] **Step 2: Deploy the verified commit to the existing Netlify site**

Expected: production deploy state `ready`.

- [ ] **Step 3: Probe production without creating a booking**

Verify inbound context, availability, disabled/invalid input errors, and tenant isolation.

- [ ] **Step 4: Run one controlled booking-path acceptance test**

Use a currently returned slot only after confirmation that it is a test-safe booking. Verify one Cal.com booking and one appointment SMS log.

- [ ] **Step 5: Send the authorized test SMS**

Send the saved Tawano template to `+491631283971` through `/api/admin/test-sms` and verify provider acceptance plus `sms_logs` status.

- [ ] **Step 6: Re-read production state and document operator controls**

Document exactly where SMS sender, standard SMS, appointment SMS, booking switch, Cal.com settings, prompt, tools, and synchronization status are controlled.

---

The Admin Control Center synchronization and generic integration wizard are implemented in a subsequent plan after this release passes its live acceptance gate. This keeps the first deploy independently useful and prevents platform work from delaying the broken Tavano call flow.
