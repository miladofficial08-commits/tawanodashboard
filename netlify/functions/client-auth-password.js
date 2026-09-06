// Passwort selbst aendern (eingeloggter Kunde).
//
// Ablauf: aktuelles Passwort wird gegen Supabase geprueft, und NUR mit dem dabei
// frisch ausgestellten Token wird das neue gesetzt. Damit kann ein gestohlener
// oder alter Token allein kein Passwort aendern - das aktuelle muss bekannt sein.
// Passwoerter werden nirgends geloggt oder gespeichert.
const { envValue, json, readBody, bearerTokenFromEvent, fetchSupabaseUser } = require('./_lib/tenant');

const MIN_LENGTH = 8;
const MAX_LENGTH = 72; // Grenze des Passwort-Hashes bei Supabase

exports.handler = async (event) => {
  if ((event.httpMethod || 'GET').toUpperCase() !== 'POST') {
    return json(405, { ok: false, message: 'Method Not Allowed' });
  }
  const accessToken = bearerTokenFromEvent(event);
  if (!accessToken) return json(401, { ok: false, message: 'Bitte neu anmelden.' });

  const body = readBody(event);
  if (!body) return json(400, { ok: false, message: 'Ungültige Anfrage.' });

  const currentPassword = String(body.current_password || '');
  const newPassword = String(body.new_password || '');
  if (!currentPassword || !newPassword) {
    return json(400, { ok: false, message: 'Bitte aktuelles und neues Passwort eingeben.' });
  }
  if (newPassword.length < MIN_LENGTH) {
    return json(400, { ok: false, message: 'Das neue Passwort braucht mindestens ' + MIN_LENGTH + ' Zeichen.' });
  }
  if (newPassword.length > MAX_LENGTH) {
    return json(400, { ok: false, message: 'Das neue Passwort darf höchstens ' + MAX_LENGTH + ' Zeichen haben.' });
  }
  if (newPassword === currentPassword) {
    return json(400, { ok: false, message: 'Das neue Passwort muss sich vom bisherigen unterscheiden.' });
  }

  const supabaseUrl = envValue('SUPABASE_URL').replace(/\/$/, '');
  const anonKey = envValue('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) {
    return json(500, { ok: false, message: 'SUPABASE_URL oder SUPABASE_ANON_KEY fehlt.' });
  }

  let user;
  try {
    user = await fetchSupabaseUser(accessToken);
  } catch (error) {
    return json(error.status || 401, { ok: false, message: 'Anmeldung abgelaufen. Bitte neu anmelden.' });
  }
  const email = String(user.email || '').trim().toLowerCase();
  if (!email) return json(400, { ok: false, message: 'Zu diesem Zugang ist keine E-Mail hinterlegt.' });

  try {
    const check = await fetch(supabaseUrl + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: currentPassword }),
    });
    const checkData = await check.json().catch(() => ({}));
    if (!check.ok || !checkData.access_token) {
      return json(401, { ok: false, message: 'Das aktuelle Passwort stimmt nicht.' });
    }

    const update = await fetch(supabaseUrl + '/auth/v1/user', {
      method: 'PUT',
      headers: {
        apikey: anonKey,
        Authorization: 'Bearer ' + checkData.access_token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ password: newPassword }),
    });
    const updateData = await update.json().catch(() => ({}));
    if (!update.ok) {
      const detail = updateData.msg || updateData.message || updateData.error_description || '';
      return json(update.status || 400, { ok: false, message: detail || 'Passwort konnte nicht geändert werden.' });
    }

    // Der Anrufer bleibt angemeldet: er bekommt die frische Sitzung zurueck.
    return json(200, {
      ok: true,
      message: 'Passwort geändert.',
      accessToken: checkData.access_token,
      refreshToken: checkData.refresh_token || null,
    });
  } catch (error) {
    return json(502, { ok: false, message: 'Auth-Service nicht erreichbar.', detail: String(error && error.message ? error.message : error) });
  }
};
