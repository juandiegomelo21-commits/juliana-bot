require("dotenv").config();
const axios = require("axios");

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_WHATSAPP_FROM; // ej: whatsapp:+14155238886

async function sendMessage(to, text) {
  await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
    new URLSearchParams({ From: TWILIO_FROM, To: `whatsapp:+${to}`, Body: text }),
    { auth: { username: TWILIO_SID, password: TWILIO_AUTH } }
  );
}

// ponytail: Twilio no requiere marcar como leído en sandbox, no-op para mantener la firma del handler
async function markAsRead() {}

module.exports = { sendMessage, markAsRead };
