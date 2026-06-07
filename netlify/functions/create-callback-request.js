const fs = require('node:fs');
const path = require('node:path');
const { insertRow, isMissingSchemaError, json, readBody, resolveTenantFromToolBody, envValue } = require('./_lib/tenant');

function isAuthorized(event) {
  const expected = envValue('RETELL_TOOL_SECRET').trim();
  if (!expected) return true;
  const headers = event.headers || {};
  const incoming = String(headers['x-retell-tool-secret'] || headers['X-Retell-Tool-Secret'] || '').trim();
  return incoming && incoming === expected;
}

function appendLocalCallback(item) {
  const filePath = path.join(process.cwd(), '.callbacks.json');
  let rows = [];
  if (fs.existsSync(filePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      rows = Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      rows = [];
    }
  }
  rows.unshift(item);
  fs.writeFileSync(filePath, JSON.stringify(rows.slice(0, 1000), null, 2), 'utf8');
}

async function sendToWebhook(item) {
  const webhookUrl = envValue('CALLBACK_WEBHOOK_URL').trim();
  if (!webhookUrl) {
    return { sent: false, provider: 'none', message: 'CALLBACK_WEBHOOK_URL nicht gesetzt' };
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });

  if (!response.ok) {
    const txt = await response.text();
    throw new Error('Callback webhook failed: HTTP ' + response.status + ' ' + txt);
  }

  return { sent: true, provider: 'webhook', message: 'Callback angelegt' };
}

exports.handler = async (event) => {
  if ((event.httpMethod || 'GET').toUpperCase() !== 'POST') {
    return json(405, { ok: false, message: 'Method Not Allowed' });
  }
  if (!isAuthorized(event)) {
    return json(401, { ok: false, message: 'Unauthorized tool call' });
  }

  const body = readBody(event);
  if (!body) return json(400, { ok: false, message: 'Invalid JSON body' });

  const phone = String(body.phone_number || body.phoneNumber || body.phone || '').trim();
  if (!phone) return json(400, { ok: false, message: 'phone_number fehlt' });

  const tenantContext = await resolveTenantFromToolBody(body);
  const tenant = tenantContext.tenant;

  const callbackItem = {
    type: 'callback_request',
    id: 'cb_' + Math.random().toString(36).slice(2, 12),
    tenant_id: tenant.id,
    phone_number: phone,
    customer_name: String(body.customer_name || body.customerName || '').trim() || null,
    reason: String(body.reason || 'transfer_timeout').trim(),
    source: String(body.source || 'retell_tool').trim(),
    priority: String(body.priority || 'normal').trim(),
    call_id: String(body.call_id || body.callId || '').trim() || null,
    requested_at: new Date().toISOString(),
    notes: String(body.notes || '').trim() || null,
    status: 'open',
  };

  // If notes are empty, try to enrich from webhook body fields (call_summary, call_analysis, transcript)
  try {
    let sourceText = '';
    if ((!callbackItem.notes || callbackItem.notes === null || callbackItem.notes === '') && body) {
      const bodySummary = String(body.call_summary || body.summary || (body.call_analysis && (body.call_analysis.call_summary || body.call_analysis.summary)) || body.transcript || '').trim();
      if (bodySummary) sourceText = bodySummary;
    }

    // If still empty, try to use fetched Retell call data (tenantContext.call)
    if ((!callbackItem.notes || callbackItem.notes === null || callbackItem.notes === '') && !sourceText && tenantContext && tenantContext.call) {
      const call = tenantContext.call || {};
      const analysis = call.call_analysis || call.callAnalysis || {};
      const summary = String(analysis.call_summary || analysis.summary || call.summary || '').trim();
      const custom = String((analysis.custom_analysis_data && (analysis.custom_analysis_data.summary || analysis.custom_analysis_data.notes)) || '').trim();
      const rawNotes = String(call.notes || call.transcript || call.public_log || '').trim();
      sourceText = [summary, custom, rawNotes].filter(Boolean).join('\n\n');
    }

    if ((!callbackItem.notes || callbackItem.notes === null || callbackItem.notes === '') && sourceText) {
      const combined = sourceText;
      if (combined) {
        // detailed extraction of key points (colors, design, nails, fingers, time, booking issues)
        function extractKeyPoints(text) {
          const t = String(text || '');
          const lower = t.toLowerCase();
          const pts = [];

          // Booking / appointment
          if (/booking tool|booking failed|error with the booking|booking tool failed|buchung|booking failed/.test(lower)) pts.push('Problem mit Buchung/Terminvereinbarung.');
          if (/attempted to schedule a callback for the user at\s*([0-9]{1,2}(?::[0-5][0-9])?\s*(?:am|pm)?)/i.test(lower)) {
            const m = lower.match(/attempted to schedule a callback for the user at\s*([0-9]{1,2}(?::[0-5][0-9])?\s*(?:am|pm)?)/i);
            if (m && m[1]) pts.push('Rückrufwunsch: ' + m[1]);
          }

          // Callback / Rückruf
          if (/callback|call back|rückruf|zurückrufen/.test(lower) && !/no callback required/.test(lower)) pts.push('Der Kunde möchte einen Rückruf.');

          // Colors
          const colors = ['pink','rosa','rot','blau','white','weiß','gold','silber','black','schwarz','lila','violett','grün','green','orange'];
          const foundColors = [];
          colors.forEach((c) => { if (lower.includes(c) && !foundColors.includes(c)) foundColors.push(c); });
          if (foundColors.length) pts.push('Farbwunsch: ' + foundColors.join(', '));

          // Design keywords
          const designKeywords = ['unicorn','einhorn','glitter','glitzer','flower','flowers','floral','star','stars','design'];
          const foundDesign = [];
          designKeywords.forEach((k) => { if (lower.includes(k) && !foundDesign.includes(k)) foundDesign.push(k); });
          if (foundDesign.length) pts.push('Design‑Hinweise: ' + foundDesign.join(', '));

          // Nail length
          if (/(long nails|lange nägel|lange nägel|lange fingernägel)/.test(lower)) pts.push('Wunsch: Lange Nägel.');
          else if (/(short nails|kurze nägel|kurz)/.test(lower)) pts.push('Wunsch: Kurze Nägel.');

          // All fingers / both hands
          if (/(all fingers|alle finger|both hands|beide hände)/.test(lower)) pts.push('An allen Fingern / beide Hände.');

          // Time extraction (HH:MM, 2pm, um 14 Uhr)
          let m = lower.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
          if (m) pts.push('Rückrufzeit: Heute um ' + String(m[1]).padStart(2, '0') + ':' + String(m[2]).padStart(2, '0'));
          else {
            m = lower.match(/\b(?:at\s*)?([1-9]|1[0-2])(?::([0-5]\d))?\s*(am|pm)\b/);
            if (m) {
              let hour = parseInt(m[1], 10);
              const min = m[2] ? m[2] : '00';
              const ampm = m[3];
              if (ampm === 'pm' && hour < 12) hour += 12;
              if (ampm === 'am' && hour === 12) hour = 0;
              pts.push('Rückrufzeit: Heute um ' + String(hour).padStart(2, '0') + ':' + String(min).padStart(2, '0'));
            } else {
              m = lower.match(/\b(?:um|at)\s*([01]?\d|2[0-3])\b/);
              if (m) pts.push('Rückrufzeit: Heute um ' + String(m[1]).padStart(2, '0') + ':00');
            }
          }

          // Technical errors
          if (/(error|technical|technische|failed|fehler)/.test(lower)) pts.push('Technisches Problem im Gespräch.');

          // If nothing extracted, but text is long, include first sentence as summary
          if (!pts.length && t.length) {
            const first = t.split(/[\.\n]/)[0];
            if (first && first.length > 20) pts.push(first.trim());
          }

          return pts.filter(Boolean);
        }

        const bullets = extractKeyPoints(combined);
        let finalNotes = combined;
        if (bullets && bullets.length) {
          finalNotes = 'Stichpunkte:\n- ' + bullets.join('\n- ') + '\n\n(Original)\n' + combined;
        }
        callbackItem.notes = finalNotes;
      }
    }
  } catch (e) {
    // ignore enrichment errors — proceed with whatever notes we have
  }

  try {
    try {
      await insertRow('callback_requests', {
        tenant_id: tenant.id,
        call_id: callbackItem.call_id,
        phone_number: callbackItem.phone_number,
        customer_name: callbackItem.customer_name,
        reason: callbackItem.reason,
        source: callbackItem.source,
        priority: callbackItem.priority,
        notes: callbackItem.notes,
        status: callbackItem.status,
      }, { serviceRole: true });
    } catch (error) {
      if (!isMissingSchemaError(error)) throw error;
      appendLocalCallback(callbackItem);
    }
    const result = await sendToWebhook(callbackItem);
    return json(200, {
      ok: true,
      status: 'created',
      tenant,
      callback: callbackItem,
      dispatch: result,
    });
  } catch (error) {
    return json(502, {
      ok: false,
      message: 'Callback konnte nicht weitergeleitet werden',
      detail: String(error && error.message ? error.message : error),
      callback: callbackItem,
    });
  }
};
