# Tawano Customer Dashboard

## Files

- `Dashboardkunde.html`, `admin.html`: customer and admin pages
- `public/`: styles and browser scripts, served by Express and Netlify
- `netlify/functions/client-auth-login.js`: backend login endpoint

## Security model

- No Supabase keys in frontend HTML/JS.
- Frontend sends email/password to backend endpoint `/api/client-auth/login`.
- Backend talks to Supabase Auth using env vars.
- Frontend only stores session access token (returned by backend) for API calls.

## Run local

1. Keep backend credentials in the root `.env` file. Existing local values are loaded by the backend.
2. Start the same Express server used on Railway:

```powershell
npm run dev
```

3. Open:

- `http://localhost:8080/Dashboardkunde.html?preview=1` — dashboard with clearly labeled example data
- `http://localhost:8080/admin?preview=1` — admin preview; saves and external actions are blocked
- `http://localhost:8080/admin` — real admin login
- `http://localhost:8080/` — real customer login

HTML/CSS/browser-script edits appear after refreshing the browser. Restart `npm run dev` after backend changes. No deployment is needed. `npm run dev:netlify` is available for Netlify-specific checks.

## ElevenLabs onboarding and deployment prerequisites

Create a separate ElevenLabs agent for each business, configure its telephone number in ElevenLabs, then enter business name, email, password and agent ID in `/admin`. The backend verifies the agent using the server's `ELEVENLABS_API_KEY` before creating the login and membership. The key must be able to read that agent and its conversations. A phone number in the form is informational; this dashboard does not provision telephony.

For a fresh environment, apply `supabase/elevenlabs-provider.sql` if missing, followed by `supabase/agent-assignment-hardening.sql` before deployment. The latter enforces unique agents, blocks customer edits to agent assignments, and prevents customer access to snapshots containing calendar credentials. Applied to production on 2026-09-05; verified both unique indexes and revoked customer UPDATE privileges. Resolve duplicate agents before running it in another environment.

Every active customer must have a `tenant_memberships` row. The old global demo fallback is intentionally removed. Read-only audit on 2026-09-05 found three customers, no duplicate agents, and a missing login membership for **Beautyworld**. Link its intended existing Supabase Auth user before using that legacy customer. Do not guess the user or reuse another customer's login.

Run `npm test` for regression tests and `npm run check:connections` for a read-only connection audit. The latter prints no credentials or conversation content.

The callback planner has day/week views, current-time markers, editable callback times, notes, completion/reopening and dashboard deletion. Work is stored in Supabase per tenant, provider, agent and call. Ambiguous time requests stay unscheduled; automatic dates are based on the original conversation in Europe/Berlin. Explicit customer edits take precedence. Concurrent edits are rejected with a refresh message rather than silently overwriting each other.

Apply `supabase/call-workspace.sql` before deploying the planner. Applied to the connected Supabase project on 2026-09-06. This is additive; no existing customer was reset. `tests/workspace-database.sql` verifies reimport, note/schedule persistence and deletion in a rolled-back transaction. `node scripts/check-planner.cjs` checks the linked Tawano customer and imports existing provider calls without changing work or resets.

Each refresh pages back through the provider until it reaches the conversations already stored, so a long gap between refreshes no longer drops calls. A larger backlog (first sync of an existing agent, or a very long pause) is worked off across several refreshes: one refresh fetches at most 1,500 conversations within a ~4.5 s budget, stores what it got, and remembers where to continue. While a backlog is open the dashboard says so ("Ältere Gespräche werden noch nachgeladen"); otherwise it states that the stored history is complete. Apply `supabase/call-history.sql` for the resume marker (`call_sync_state`); without it the refresh still pages correctly but only back to the last stored call, so an interrupted backlog is not resumed. The UI still loads up to 10,000 stored entries and explicitly flags that limit. This is not an unlimited billing ledger. ElevenLabs phone details are prefetched for the latest 12 calls of the newest page; opening an older conversation retrieves its missing number.

## Structured callback times

Free text ("Rückruf morgen um 16 Uhr") is still read, but only unambiguous phrasing is accepted. The reliable path is a data field the assistant fills itself; it takes precedence over the free text, and an explicit edit in the dashboard takes precedence over both. Accepted field names (any one of them, per call):

- `callback_at` / `rueckruf_zeitpunkt`: full timestamp, e.g. `2026-09-08T16:00:00+02:00` (without a zone it is read as Europe/Berlin)
- `callback_date` + `callback_time` / `rueckruf_datum` + `rueckruf_uhrzeit`: e.g. `2026-09-08` and `16:00` (`08.09.2026`, `16 Uhr`, `heute`, `morgen` are accepted too)
- `callback_end` / `rueckruf_bis`: optional end of a time window
- `callback_wanted` / `rueckruf_gewuenscht`: `nein` suppresses a scheduled callback

Where to configure: Retell in the agent's post-call analysis (`call_analysis.custom_analysis_data`) or as a collected dynamic variable; ElevenLabs under the agent's data collection (`analysis.data_collection_results`). Retell tools can also send `callback_at` (or `callback_date` + `callback_time`) to `POST /api/callback` during the call; that value is stored in `callback_requests.callback_at` and used by the planner. Impossible values (25:00, 30 February), a date without a valid time, and the ambiguous hour of the autumn clock change stay unscheduled instead of being guessed; a call whose structured callback time is set is listed as "Rückruf" regardless of how the summary is worded.

Overview and analytics share Today, Last 3 Days, This Week, custom and all-available date filters. The callback planner always retains all open work regardless of that filter. The minutes package uses its own reset timestamp: `/api/admin/reset-usage` accepts `minutes` to restart usage at the server's current time or `conversations` to hide earlier conversations. Both require admin authentication. Conversation reset also hides earlier open work. Neither deletes provider recordings or changes the minutes budget. Dashboard deletion removes the snapshot/notes and keeps a minimal tombstone plus duration metadata so reimports do not resurrect the entry or reduce consumed minutes.

No outbound call, SMS, new customer or database migration is performed by preview mode. Sample data is enabled only on localhost with `?preview=1`; production and newly created customer accounts never use it. Preview work changes are held in memory and reset on reload. Beautyworld is hidden by default in the admin list, with an option to show hidden customers. The planner code is locally reviewable; the previous Railway release stays active until separately deployed.

Agent verification follows the provider APIs: [ElevenLabs Get agent](https://elevenlabs.io/docs/eleven-agents/api-reference/agents/get), [Retell Get Voice Agent](https://docs.retellai.com/api-references/get-agent).

## Retell tool endpoints

These two backend endpoints are ready to be used by Retell tools:

- `send_booking_link` -> `POST /api/send-link`
- `create_callback_request` -> `POST /api/callback`

Local URLs:

- `http://localhost:8888/api/send-link`
- `http://localhost:8888/api/callback`

Production URLs (after Netlify deploy):

- `https://<your-site>.netlify.app/api/send-link`
- `https://<your-site>.netlify.app/api/callback`

Expected JSON body for `send_booking_link`:

```json
{
	"phone_number": "+4917612345678",
	"customer_name": "Max Mustermann",
	"booking_link": "https://...",
	"message": "Optional custom text"
}
```

Expected JSON body for `create_callback_request`:

```json
{
	"phone_number": "+4917612345678",
	"customer_name": "Max Mustermann",
	"reason": "transfer_timeout",
	"call_id": "call_xxx",
	"notes": "Optional"
}
```

Environment variables used by these endpoints:

- `RETELL_TOOL_SECRET` (required; `RETELL_WEBHOOK_SECRET` is accepted as a migration alias)
- `BOOKING_LINK_URL` (default booking link)
- `SEVEN_API_KEY` + `SMS_FROM` (direct SMS via seven.io, preferred)
- `SMS_WEBHOOK_URL` (optional fallback where SMS automation runs)
- `CALLBACK_WEBHOOK_URL` (where callback task automation runs)

### Required Retell custom-function configuration

Configure every write/read tool below as a Retell Custom Function and add the same static request header:

```text
x-retell-tool-secret: <the value stored as RETELL_TOOL_SECRET in Netlify>
```

Use these production URLs and methods:

- `get_available_slots`: `POST https://tawanodashboard.netlify.app/api/get-available-slots`
- `book_appointment`: `POST https://tawanodashboard.netlify.app/api/book-appointment`
- `send_confirmation_sms`: `POST https://tawanodashboard.netlify.app/api/send-confirmation-sms`
- `create_callback_request`: `POST https://tawanodashboard.netlify.app/api/callback`

Keep Retell's `Payload: args only` disabled so the backend receives `name`, `call`, and `args`. The handlers accept both forms during migration, but the full payload provides the trusted call ID, agent ID, caller number, and called business number needed for tenant resolution. Retell documents both custom request headers and the full custom-function payload in its Custom Function guide.

The inbound-call webhook is separate and remains:

```text
POST https://tawanodashboard.netlify.app/api/retell-inbound
```

It must be configured on the Tawano phone number as the Inbound Call Webhook URL so `current_date`, `caller_number`, and tenant metadata are available before the agent starts.

### Cal.com tenant rules

- Set `booking_enabled`, `calcom_event_type_id`, and `calcom_api_key` per tenant in `/admin`.
- Global `CALCOM_API_KEY` and `CALCOM_EVENT_TYPE_ID` are migration fallbacks for Tawano only.
- Other tenants never inherit the global Tawano calendar.
- Availability and booking now resolve the same tenant settings.

## Multi-tenant production model

This app is set up to run as one shared dashboard for many customers.

Production approach:

- one shared frontend/domain
- Supabase Auth for login
- tenant separation in database via `tenant_id`
- Row Level Security to prevent cross-customer access
- tenant-specific Retell agent mapping stored in database, not in frontend

Required before production:

1. Run the SQL in `supabase/multi-tenant-schema.sql`
2. Add `SUPABASE_SERVICE_ROLE_KEY` to Netlify environment variables
3. Create one row per customer in `tenants`
4. Create memberships in `tenant_memberships`
5. Stop relying on `.env` email bindings except as temporary fallback

Core tables:

- `tenants`
- `tenant_memberships`
- `callback_requests`
- `sms_logs`
- `analytics_snapshots`

Function behavior after schema is applied:

- login resolves tenant from Supabase membership
- call list only shows the logged-in tenant's calls
- reset only affects the logged-in tenant
- callback requests are stored per tenant
- SMS logs are stored per tenant
