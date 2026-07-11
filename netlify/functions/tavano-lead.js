const { insertRow, json, readBody } = require('./_lib/tenant');

function cleanText(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!maxLength || text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim();
}

function cleanEmail(value) {
  return cleanText(value, 254).toLowerCase();
}

function hasUsablePhone(value) {
  return String(value || '').replace(/\D/g, '').length >= 7;
}

function hasUsableEmail(value) {
  const email = cleanEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateLeadPayload(body) {
  const payload = body && typeof body === 'object' ? body : {};
  const email = cleanEmail(payload.email);
  const phone = cleanText(payload.phone_number || payload.phoneNumber || payload.phone || '', 40);

  if (email && !hasUsableEmail(email)) {
    return { ok: false, message: 'Bitte eine gueltige E-Mail-Adresse eintragen.' };
  }
  if (!hasUsablePhone(phone) && !email) {
    return { ok: false, message: 'Bitte Telefonnummer oder E-Mail eintragen.' };
  }

  return {
    ok: true,
    lead: {
      tenant_id: cleanText(payload.tenant_id || payload.tenantId || '', 120) || null,
      call_id: cleanText(payload.call_id || payload.callId || '', 160) || null,
      phone_number: phone || null,
      name: cleanText(payload.name, 160) || null,
      company: cleanText(payload.company, 180) || null,
      email: email || null,
      business_type: cleanText(payload.business_type || payload.businessType, 180) || null,
      desired_use_case: cleanText(payload.desired_use_case || payload.desiredUseCase, 240) || null,
      urgency: cleanText(payload.urgency, 80) || null,
      notes: cleanText(payload.notes, 1200) || null,
      source: cleanText(payload.source, 80) || 'sms_lead_capture',
    },
  };
}

exports.handler = async (event) => {
  if ((event.httpMethod || 'GET').toUpperCase() !== 'POST') {
    return json(405, { ok: false, message: 'Method Not Allowed' });
  }

  const body = readBody(event);
  if (!body) return json(400, { ok: false, message: 'Invalid JSON body' });

  const result = validateLeadPayload(body);
  if (!result.ok) return json(400, { ok: false, message: result.message });

  try {
    const storedLead = await insertRow('tavano_leads', result.lead, { serviceRole: true });
    return json(200, { ok: true, stored: true, lead_id: storedLead && storedLead.id });
  } catch (error) {
    console.log('[tavano-lead] konnte nicht speichern:', String(error && error.message ? error.message : error));
    return json(500, {
      ok: false,
      stored: false,
      message: 'Ihre Anfrage konnte gerade nicht gespeichert werden. Bitte versuchen Sie es erneut.',
    });
  }
};

exports.validateLeadPayload = validateLeadPayload;
