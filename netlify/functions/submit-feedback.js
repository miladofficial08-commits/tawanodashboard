const { envValue, insertRow, json, readBody } = require('./_lib/tenant');

exports.handler = async (event) => {
  if ((event.httpMethod || 'GET').toUpperCase() !== 'POST') {
    return json(405, { ok: false, message: 'Method Not Allowed' });
  }
  const body = readBody(event) || {};
  const rating = Number(body.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return json(400, { ok: false, message: 'rating muss 1 bis 5 sein' });
  }
  const phone = String(body.phone || '').trim();
  const callId = String(body.call_id || '').trim();

  // Feedback in Supabase speichern (Tabelle sms_feedback, siehe supabase/sms-feedback.sql).
  try {
    await insertRow('sms_feedback', {
      tenant_id: envValue('FALLBACK_TENANT_ID') || 'tenant_beautyworld',
      phone_number: phone || null,
      rating: rating,
      message: 'via feedback-link',
      call_id: callId || null,
    });
    return json(200, { ok: true, stored: true });
  } catch (error) {
    // Tabelle fehlt noch oder RLS blockt: ins Function-Log schreiben, Kunde sieht trotzdem "Danke".
    console.log('[submit-feedback] konnte nicht speichern:', String(error && error.message ? error.message : error),
      '| phone=', phone, '| rating=', rating, '| call_id=', callId);
    return json(200, { ok: true, stored: false });
  }
};
