require('dotenv').config({ quiet: true });
// Native Node.js 18+ fetch integration for TextSMS.co.ke
const TEXTSMS_API_URL = 'https://sms.textsms.co.ke/api/services/sendsms/';

async function sendTextSMS(mobileNumber, messageContent) {
  const params = new URLSearchParams({
    apikey: process.env.TEXTSMS_API_KEY,      // Your TextSMS API Key
    partnerID: process.env.TEXTSMS_PARTNER_ID, // Your TextSMS Partner ID
    shortcode: process.env.TEXTSMS_SENDER_ID || 'TextSMS', // Your Approved Sender ID / Shortcode
    mobile: String(mobileNumber).replace(/^\+/, ''), // e.g., "07XXXXXXXX" or "2547XXXXXXXX"
    message: messageContent
  });

  const response = await fetch(`${TEXTSMS_API_URL}?${params.toString()}`, {
    method: 'GET'
  });

  const data = await response.json();
  console.log('TextSMS Response:', data);
  return data;
}

// Usage Example
// sendTextSMS('254712345678', 'Hello from my Node.js application!');
module.exports = { sendTextSMS };
