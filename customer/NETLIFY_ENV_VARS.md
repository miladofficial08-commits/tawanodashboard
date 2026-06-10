# Netlify Environment Variables Setup

## ⚠️ WICHTIG ZUERST:
Vor dem Hochpushen zu Netlify:
1. Öffne `customer/Dashboardkunde.html`
2. **Lösche diese Zeile**: `<script src="mock-auth.js"></script>`
3. Speichere die Datei
4. Dann zu Netlify hochpushen

---

## 📋 So fügst du die Env-Vars ein:

1. Gehe zu: **Netlify → Dein Projekt → Site settings → Environment variables**
2. Klicke auf **"Add a variable"**
3. Kopiere jeden Key und Value einzeln rein
4. Klicke "Save"
5. Wiederhole für alle Variablen
6. Danach: **Trigger Deploy** (New site deploy)

---

## 🔑 Environment Variables (Copy-Paste):

### 1. SUPABASE_URL
**Key:** `SUPABASE_URL`
**Value:**
```
https://dkqytdmstazrfqivmjkz.supabase.co
```

---

### 2. SUPABASE_ANON_KEY
**Key:** `SUPABASE_ANON_KEY`
**Value:**
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrcXl0ZG1zdGF6cmZxaXZtamt6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MDI4NDksImV4cCI6MjA5NjA3ODg0OX0.4rq4iDLORnSKcBD_fu9SwuF6_pxj7nGYBqPdtYMmlZ0
```

---

### 3. RETELL_API_KEY
**Key:** `RETELL_API_KEY`
**Value:**
```
key_87378872b42b15357a3d9462cf69
```

---

### 4. RETELL_FROM_NUMBER
**Key:** `RETELL_FROM_NUMBER`
**Value:**
```
+4921186943717
```

---

### 5. RETELL_AGENT_BEAUTY
**Key:** `RETELL_AGENT_BEAUTY`
**Value:**
```
agent_6cada34aac5785c950da3d919b
```

---

### 6. RETELL_TENANT_AGENT_MAP
**Key:** `RETELL_TENANT_AGENT_MAP`
**Value:**
```
{"tenant_beautyworld":"agent_6cada34aac5785c950da3d919b"}
```

---

### 7. RETELL_TENANT_HISTORY_AGENT_MAP
**Key:** `RETELL_TENANT_HISTORY_AGENT_MAP`
**Value:**
```
{"tenant_beautyworld":["agent_6cada34aac5785c950da3d919b"]}
```

---

### 8. AUTH_EMAIL_BINDINGS
**Key:** `AUTH_EMAIL_BINDINGS`
**Value:**
```
{"beautyworld@gmail.com":{"tenantId":"tenant_beautyworld","roles":["client_admin"]}}
```

---

### 9. ALLOWED_ORIGIN
**Key:** `ALLOWED_ORIGIN`
**Value:**
```
*
```

---

## ✅ Fertig!

Nach dem Hinzufügen aller 9 Variablen:
1. Klicke **"Publish site"** oder gehe zu **Deploys → Trigger deploy**
2. Warte bis der Deploy fertig ist (grüner Haken)
3. Teste das Dashboard: `https://dein-netlify-domain.netlify.app/dashboardkunde`

---

## 🔍 Troubleshooting:

**Login funktioniert nicht?**
- ✓ Alle 9 Env-Vars gesetzt?
- ✓ Benutzer `beautyworld@gmail.com` existiert in Supabase?
- ✓ Netlify Deploy ist fertig?
- ✓ Seite gecacht? → Hard Refresh (Ctrl+Shift+R)

**Anrufe werden nicht angezeigt?**
- ✓ Agent ID korrekt? (`agent_6cada34aac5785c950da3d919b`)
- ✓ Retell API-Key gültig?

