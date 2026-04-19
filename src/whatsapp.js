require("dotenv").config();
const axios = require("axios");

const WHATSAPP_API_URL = `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID?.trim()}/messages`;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN?.replace(/[^\x20-\x7E]/g, "").trim();

async function sendMessage(to, text) {
  await axios.post(
    WHATSAPP_API_URL,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

async function markAsRead(messageId) {
  await axios.post(
    WHATSAPP_API_URL.replace("/messages", "/messages"),
    {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    },
    {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

module.exports = { sendMessage, markAsRead };
