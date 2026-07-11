# Tawano Voice Platform Design

## Goal and Delivery Order

Tawano must first work as a reliable production voice agent. The Admin Control Center then becomes the single source of truth for agent behavior, prompts, integrations, calendar booking, SMS, phone routing, and testing. The same foundation must support the first 50 isolated customer tenants and later allow another voice provider such as ElevenLabs without rebuilding shared services.

Delivery is split into three bounded releases:

1. Stabilize the existing Tawano Retell agent, Cal.com booking, and outcome-based SMS flow.
2. Make the Admin Control Center authoritative for prompts, tools, integrations, and synchronization.
3. Introduce a provider adapter boundary and reusable integration framework; Retell remains the active provider until a separate ElevenLabs evaluation is approved.

Only the Tawano tenant and agent are changed during the first release.

## Source of Truth

Supabase stores tenant-owned configuration. The Admin Control Center reads and writes this configuration. Server-side synchronization applies relevant changes to Retell and other providers; the browser never receives provider API keys or service-role credentials.

Each configuration update creates an immutable version containing the editor, timestamp, changed fields, synchronization result, and previous version. Failed external synchronization leaves the last successfully published configuration active and shows an actionable error in the Admin Control Center. A user can retry or roll back.

The active configuration covers:

- agent identity, language, voice, prompt, and opening message;
- phone-number and voice-provider assignment;
- enabled tools and their safe schemas;
- Cal.com credentials, event type, timezone, and booking switch;
- SMS provider, sender, standard template, appointment template, and feedback link;
- inbound webhook state and dynamic call variables;
- integration connections, mappings, activation state, and test status.

## Stable Tawano Call Flow

The Tawano phone number invokes the inbound webhook before the conversation begins. The webhook resolves the tenant from the called business number or agent ID and supplies the current date, caller number, call ID when available, tenant ID, and tenant name.

The conversation follows this outcome model:

1. The agent speaks naturally and asks one question at a time.
2. For appointment interest, it requests real Cal.com availability and offers only returned slots.
3. German and English time-preference values are normalized server-side.
4. The caller chooses a slot; the backend derives trusted call and phone data from Retell context and creates the Cal.com booking.
5. A successful booking sends exactly one appointment SMS with date, time, and meeting link.
6. If no booking was created, the conversation-ending path sends exactly one standard thank-you and feedback SMS.
7. Failed booking or SMS operations are never described as successful. The agent receives a short recoverable status and either offers another slot or records a callback.

Idempotency is keyed by tenant, call ID, outcome, and recipient so Retell retries cannot create duplicate bookings or SMS messages.

## Voice Tool Contracts

Tool schemas request only information the model can legitimately collect. Caller number, called business number, agent ID, tenant ID, and call ID are taken from trusted Retell call context or fetched server-side. They are not required model arguments and are never invented.

Availability and booking use the same resolved tenant configuration. A non-Tawano tenant cannot inherit Tawano calendar credentials, templates, sender, or agent mapping. Callback and SMS tool descriptions match their actual backend fields.

## Integration Framework

Integrations use adapters with a small common lifecycle:

- `configure`: validate and securely store credentials and settings;
- `testConnection`: verify authentication without changing business data;
- `capabilities`: declare supported actions and required fields;
- `execute`: perform a typed action such as checking availability, creating a booking, sending a message, or creating a record;
- `health`: expose last success, last failure, and actionable diagnostics;
- `disconnect`: deactivate safely without deleting historical records.

Provider-specific code lives behind an adapter. Agent orchestration depends on capabilities rather than vendor-specific APIs. Initial adapters are Retell, Cal.com, and seven.io. ElevenLabs and customer-owned systems can be added later without changing the shared booking or SMS outcome model.

Each integration has tenant-scoped credentials, explicit permissions, timeouts, normalized error responses, retry rules, idempotency support, and redacted logs. No integration may silently fall back to another tenant's credentials.

## Admin Integration Wizard

The Admin Control Center includes an Integrations area designed for a non-developer operator:

1. Choose an integration type or `Custom API`.
2. Read the short preparation checklist and obtain required credentials.
3. Enter credentials and configuration in server-backed secret fields.
4. Map supported actions and required customer data.
5. Run `Test connection` and see a plain-language result.
6. Run a safe sandbox/test action when supported.
7. Activate the integration for one selected tenant.
8. See synchronization and health status, retry failures, or disable the integration.

The same area contains concise instructions for setting up a voice agent: assign provider and phone number, edit the prompt, enable tools, connect calendar and SMS, run validation, place a test call, verify booking and SMS logs, then publish.

For custom APIs, the first supported contract is authenticated HTTP with configurable URL, method, headers, request-field mappings, response-field mappings, timeout, and a test payload. Arbitrary executable code is excluded from the first release for security and operational stability.

## Security and Tenant Isolation

All provider keys and administrative secrets are marked secret in Netlify or stored encrypted server-side. Existing exposed credentials must be rotated after functional repair. Admin endpoints require authenticated server-side authorization. Tool requests use verified Retell context or a configured shared secret/signature without disabling live calls during migration.

Logs redact credentials and personal data where possible. Every write is tenant-scoped. Cross-tenant fallback is prohibited for agents, phone numbers, calendars, prompts, SMS senders, and integration credentials.

## Testing and Release Gates

Automated tests cover tenant resolution, inbound variables, German time preferences, tool payload normalization, calendar isolation, booking idempotency, SMS outcome isolation, synchronization failure behavior, and integration adapter contracts.

The Tawano release gate requires:

- live availability returns real Cal.com slots;
- a selected slot creates one booking;
- the booking path sends one appointment SMS;
- a non-booking call sends one feedback SMS;
- retries produce no duplicate booking or SMS;
- prompt and settings changed in Admin are reflected in the active Retell agent;
- another tenant remains unchanged;
- the user-supplied test number receives the expected test message.

Production changes are published only after local tests, Netlify build verification, endpoint probes, and a targeted Tawano agent test pass.

## Deferred Scope

ElevenLabs production migration, arbitrary user-written integration code, a public integration marketplace, billing automation, and broad dashboard redesign are deferred. The adapter and configuration boundaries are included now so these additions do not require a rewrite.
