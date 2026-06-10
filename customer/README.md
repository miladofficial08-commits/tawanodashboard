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
npx netlify dev
```

3. Open:

- `http://localhost:8888/dashboardkunde`
- or `http://localhost:8888/customer/Dashboardkunde.html`
