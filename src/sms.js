const { sendTextSMS } = require('../textsms');

const SMS_LIMIT = 160; // one standard SMS segment

/**
 * Normalise a phone number to international format (+2547XXXXXXXX).
 * Accepts "+254 712 345 678", "00254712345678", "254712345678",
 * or a local "0712345678" when DEFAULT_COUNTRY_CODE is set (e.g. 254).
 * Returns null if it does not look like a phone number.
 */
function normalizePhone(input) {
  let p = String(input || '').replace(/[\s\-().]/g, '');
  if (!p) return null;

  const cc = String(process.env.DEFAULT_COUNTRY_CODE || '').replace(/\D/g, '');

  if (p.startsWith('00')) p = `+${p.slice(2)}`;
  else if (p.startsWith('0') && cc) p = `+${cc}${p.slice(1)}`;
  else if (!p.startsWith('+') && cc && p.startsWith(cc)) p = `+${p}`;

  return /^\+\d{8,15}$/.test(p) ? p : null;
}

const clip = (s, n) => {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 3)}...` : t;
};

// Very brief, single-SMS report of the search result.
function buildReport(query, best) {
  const q = clip(query, 40);
  const msg = best
    ? `OCR search "${q}": ${best.percent}% match. Found "${clip(best.matchedText, 50)}" on line ${best.lineNumber}.`
    : `OCR search "${q}": no match found in the image.`;
  return clip(msg, SMS_LIMIT);
}

/**
 * Send the report. Never throws: returns { sent, to, message, status, cost, error }.
 */
async function sendReport(phone, query, best) {
  const message = buildReport(query, best);
  const result = { sent: false, to: phone, message };

  try {
    if (!process.env.TEXTSMS_API_KEY || !process.env.TEXTSMS_PARTNER_ID) {
      throw new Error('SMS is not configured: set TEXTSMS_API_KEY and TEXTSMS_PARTNER_ID in .env');
    }

    const res = await sendTextSMS(phone, message);
    const recipient = res && Array.isArray(res.responses) && res.responses[0];

    if (!recipient) {
      result.error = (res && (res['response-description'] || res.message)) || 'No recipient in response';
      return result;
    }

    // TextSMS spells the field "respose-code"; accept both spellings.
    const code = Number(recipient['respose-code'] ?? recipient['response-code']);
    result.status = recipient['response-description'];
    result.messageId = recipient.messageid;
    result.sent = code === 200;
    if (!result.sent) result.error = result.status || `TextSMS error ${code}`;
  } catch (e) {
    result.error = (e && e.message) || String(e);
  }

  return result;
}

module.exports = { sendReport, normalizePhone, buildReport };
