# Tawano Customer Dashboard

## Files

- `customer/Dashboardkunde.html`: customer-facing dashboard UI
- `customer/.env.example`: environment template for backend-only secrets
- `netlify/functions/client-auth.js`: backend login endpoint (email/password)

## Security model

- No Supabase keys in frontend HTML/JS.
- Frontend sends email/password to backend endpoint `/api/client-auth/login`.
- Backend talks to Supabase Auth using env vars.
- Frontend only stores session access token (returned by backend) for API calls.

## Run local

1. Copy `customer/.env.example` values into your real `.env` file (root project) and set real credentials.
2. Start Netlify dev:

```powershell
npx netlify dev -d . -f netlify/functions
```

3. Open:

- `http://localhost:8888/`
- or `http://localhost:8888/Dashboardkunde.html`

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

- `RETELL_TOOL_SECRET` (optional security header `x-retell-tool-secret`)
- `BOOKING_LINK_URL` (default booking link)
- `SEVEN_API_KEY` + `SMS_FROM` (direct SMS via seven.io, preferred)
- `SMS_WEBHOOK_URL` (optional fallback where SMS automation runs)
- `CALLBACK_WEBHOOK_URL` (where callback task automation runs)

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
