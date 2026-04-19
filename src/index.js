require("dotenv").config();
const express = require("express");
const { handleIncomingMessage } = require("./handlers/message");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// Verificación del webhook (GET)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado correctamente");
    return res.status(200).send(challenge);
  }

  console.warn("❌ Fallo en verificación del webhook");
  res.sendStatus(403);
});

// Recepción de mensajes (POST)
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Responder rápido a Meta

  const body = req.body;

  if (body.object !== "whatsapp_business_account") return;

  const entry = body.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;

  if (!value?.messages) return;

  const message = value.messages[0];
  const contact = value.contacts?.[0];

  if (message.type !== "text") return; // Solo procesamos texto por ahora

  console.log(`📩 Mensaje de ${contact?.profile?.name || message.from}: ${message.text.body}`);

  await handleIncomingMessage(message, contact).catch((err) => {
    console.error("❌ Error procesando mensaje:", err.message);
  });
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", bot: "Juliana Bot", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🌸 Juliana Bot corriendo en puerto ${PORT}`);
  console.log(`🔗 Webhook: POST /webhook | Verificación: GET /webhook`);
});
