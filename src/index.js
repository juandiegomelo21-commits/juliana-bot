require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const { handleIncomingMessage } = require("./handlers/message");
const { getJulianaResponse } = require("./groq");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

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

// Endpoint para la interfaz web
app.post("/chat", async (req, res) => {
  const { message, userId } = req.body;
  if (!message || !userId) {
    return res.status(400).json({ error: "message y userId son requeridos" });
  }
  try {
    const reply = await getJulianaResponse(userId, message);
    res.json({ reply });
  } catch (err) {
    console.error("❌ Error en /chat:", err.message);
    res.status(500).json({ error: "Error al obtener respuesta" });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", bot: "Juliana Bot", timestamp: new Date().toISOString() });
});

// Actualizar foto de perfil (llamar una sola vez desde el navegador)
app.get("/set-profile-pic", async (req, res) => {
  const secret = req.query.secret;
  if (secret !== VERIFY_TOKEN) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const imagePath = path.join(__dirname, "..", "foto.png");
  if (!fs.existsSync(imagePath)) {
    return res.status(404).json({ error: "No se encontró foto.png en la raíz del proyecto" });
  }

  try {
    const ACCESS_TOKEN = process.env.ACCESS_TOKEN?.replace(/[^\x20-\x7E]/g, "").trim();
    const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID?.trim();

    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", "image/png");
    form.append("file", fs.createReadStream(imagePath), {
      filename: "foto.png",
      contentType: "image/png",
    });

    const uploadRes = await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/media`,
      form,
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, ...form.getHeaders() } }
    );

    const mediaId = uploadRes.data.id;

    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/whatsapp_business_profile`,
      { messaging_product: "whatsapp", profile_picture_handle: mediaId },
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" } }
    );

    res.json({ ok: true, message: "Foto de perfil actualizada 🎉", mediaId });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🌸 Juliana Bot corriendo en puerto ${PORT}`);
  console.log(`🔗 Webhook: POST /webhook | Verificación: GET /webhook`);
});
