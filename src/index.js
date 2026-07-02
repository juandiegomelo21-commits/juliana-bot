require("dotenv").config();

// Evita que el proceso muera por rechazos internos del driver MongoDB en dev local
process.on('unhandledRejection', (reason) => {
  console.warn('⚠️ Unhandled rejection (no fatal):', reason?.message || reason);
});

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const passport = require("passport");
const { MercadoPagoConfig, Preference } = require("mercadopago");
const { handleIncomingMessage } = require("./handlers/message");
const { getJulianaResponse } = require("./groq");
const { getConfig, saveConfig, loadConfig } = require("./config");
const { setupAuth } = require("./auth");
const db = require("./db");

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Auth (sesión + passport) — debe ir antes de las rutas
setupAuth(app);

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

// Diagnóstico MP (solo para verificar configuración)
app.get("/api/payment/status", (req, res) => {
  res.json({ configured: !!process.env.MP_ACCESS_TOKEN });
});

// Checkout Pro — crear preferencia de pago
app.post("/api/payment/create", async (req, res) => {
  if (!process.env.MP_ACCESS_TOKEN) {
    console.error("❌ MP_ACCESS_TOKEN no configurado");
    return res.status(503).json({ error: "Pagos no configurados aún" });
  }
  const { title, price, quantity = 1, items: cartItems, address } = req.body;

  // Carrito con varios productos, o compra directa de un solo producto
  let mpItems;
  if (Array.isArray(cartItems) && cartItems.length) {
    mpItems = cartItems.map((it) => ({
      title: it.title,
      unit_price: parseInt(String(it.price).replace(/[^0-9]/g, ""), 10),
      quantity: parseInt(it.quantity, 10) || 1,
      currency_id: "COP",
    }));
    if (mpItems.some((it) => !it.title || !it.unit_price)) {
      return res.status(400).json({ error: "Datos de carrito inválidos" });
    }
  } else {
    if (!title || !price) {
      return res.status(400).json({ error: "Faltan datos del producto" });
    }
    const numericPrice = parseInt(String(price).replace(/[^0-9]/g, ""), 10);
    if (!numericPrice || numericPrice <= 0) {
      return res.status(400).json({ error: "Precio inválido" });
    }
    mpItems = [{ title, unit_price: numericPrice, quantity: parseInt(quantity), currency_id: "COP" }];
  }

  console.log(`💳 Creando pago: ${mpItems.map((it) => `${it.title} x${it.quantity}`).join(", ")}`);
  if (address) {
    console.log(`📦 Envío a: ${address.name} · ${address.phone} · ${address.address}, ${address.city}${address.notes ? " · " + address.notes : ""}`);
  }

  try {
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const preference = new Preference(client);
    const baseUrl = (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");

    const result = await preference.create({
      body: {
        items: mpItems,
        back_urls: {
          success: `${baseUrl}/?payment=success`,
          failure: `${baseUrl}/?payment=failure`,
          pending: `${baseUrl}/?payment=pending`,
        },
        auto_return: "approved",
        metadata: address ? { shipping_address: address } : undefined,
      },
    });

    await db.saveOrder({ preferenceId: result.id, items: mpItems, address: address || null, createdAt: new Date() });

    console.log(`✅ Preferencia creada: ${result.id}`);
    res.json({ url: result.init_point });
  } catch (err) {
    console.error("❌ Error MP:", err.message, err.cause || "");
    res.status(500).json({ error: "Error al crear el pago", detail: err.message });
  }
});

// TTS diagnóstico
app.get("/api/tts/status", (req, res) => {
  const oaiKey = process.env.OPENAI_API_KEY;
  const voice = process.env.EDGE_TTS_VOICE || "es-CO-SalomeNeural";
  res.json({
    provider: oaiKey ? "openai" : "edge-tts (gratis)",
    configured: true,
    voice: oaiKey ? (process.env.OPENAI_TTS_VOICE || "nova") : voice,
  });
});

// TTS — Edge TTS gratis (Microsoft neural) con fallback OpenAI si hay key
app.post("/api/tts", async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "Falta text" });

  const clean = text.replace(/[^\p{L}\p{N}\s¿¡.,!?;:«»\-]/gu, "").trim().slice(0, 4096);
  if (!clean) return res.status(400).json({ error: "Texto vacío" });

  // OpenAI si hay key con créditos disponibles
  if (process.env.OPENAI_API_KEY) {
    try {
      const voice = process.env.OPENAI_TTS_VOICE || "nova";
      console.log(`🎙️ TTS (OpenAI) | voice: ${voice} | chars: ${clean.length}`);
      const r = await axios.post(
        "https://api.openai.com/v1/audio/speech",
        { model: "tts-1-hd", voice, input: clean, response_format: "mp3", speed: 0.95 },
        {
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
          responseType: "arraybuffer",
        }
      );
      if (r.data.byteLength > 1000) {
        console.log(`✅ TTS OpenAI OK | ${r.data.byteLength} bytes`);
        res.set("Content-Type", "audio/mpeg");
        res.set("Cache-Control", "no-store");
        return res.send(Buffer.from(r.data));
      }
    } catch (err) {
      console.warn(`⚠️  TTS OpenAI falló (${err.response?.status}) — usando Edge TTS`);
    }
  }

  // Edge TTS gratuito (Microsoft neural voices)
  const voice = process.env.EDGE_TTS_VOICE || "es-CO-SalomeNeural";
  console.log(`🎙️ TTS (Edge) | voice: ${voice} | chars: ${clean.length}`);
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(clean);
    res.set("Content-Type", "audio/mpeg");
    res.set("Cache-Control", "no-store");
    audioStream.on("error", (e) => { console.error("❌ Edge TTS stream error:", e.message); });
    audioStream.pipe(res);
    audioStream.on("close", () => console.log("✅ TTS Edge OK"));
  } catch (err) {
    console.error("❌ TTS Edge ERROR:", err.message);
    res.status(500).json({ error: "Error TTS", detail: err.message });
  }
});

// ── Upload de imágenes ─────────────────────────────────────────────
// Cloudinary si está configurado, fallback a disco local (dev)
const cloudinary = (() => {
  if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
    const { v2 } = require('cloudinary');
    v2.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    console.log('☁️  Cloudinary configurado — uploads permanentes');
    return v2;
  }
  console.warn('⚠️  CLOUDINARY no configurado — usando disco local (imágenes no persisten en Railway)');
  return null;
})();

const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo imágenes'));
  },
});

app.post('/api/upload', (req, res) => {
  if (req.query.password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  upload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Sin archivo' });

    // Subir a Cloudinary si está disponible
    if (cloudinary) {
      try {
        const result = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: 'juliana-bot', resource_type: 'image' },
            (error, result) => error ? reject(error) : resolve(result)
          );
          stream.end(req.file.buffer);
        });
        return res.json({ url: result.secure_url });
      } catch (e) {
        console.error('❌ Cloudinary upload error:', e.message);
        return res.status(500).json({ error: 'Error subiendo imagen a Cloudinary' });
      }
    }

    // Fallback: guardar en disco local
    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
    res.json({ url: `/uploads/${filename}` });
  });
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", bot: "Juliana Bot", timestamp: new Date().toISOString() });
});

// Config pública (precios y link de pago para el frontend)
app.get("/public-config", (req, res) => {
  const { prompt, ...pub } = getConfig();
  res.json({ ...pub, googleEnabled: !!process.env.GOOGLE_CLIENT_ID });
});

// Registro de cuenta de usuario
app.post("/api/register", async (req, res) => {
  if (!db.isConnected()) return res.status(503).json({ error: "Base de datos no disponible" });
  const { phone, username, password } = req.body;
  if (!phone || !username || !password) return res.status(400).json({ error: "Faltan campos" });
  if (username.length < 3) return res.status(400).json({ error: "El usuario debe tener al menos 3 caracteres" });
  if (password.length < 4) return res.status(400).json({ error: "La contraseña debe tener al menos 4 caracteres" });

  const cleanPhone = String(phone).replace(/\D/g, "");
  const cleanUsername = username.toLowerCase().trim();

  const existing = await db.getUserByUsername(cleanUsername);
  if (existing) return res.status(409).json({ error: "Ese nombre de usuario ya está en uso" });

  const passwordHash = await bcrypt.hash(password, 10);
  await db.createAccount(cleanPhone, cleanUsername, passwordHash, null);
  res.json({ ok: true, username: cleanUsername });
});

// Login de cuenta de usuario
app.post("/api/login", async (req, res) => {
  if (!db.isConnected()) return res.status(503).json({ error: "Base de datos no disponible" });
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Faltan campos" });

  const account = await db.getUserByUsername(username.toLowerCase().trim());
  if (!account) return res.status(401).json({ error: "Usuario o contraseña incorrectos" });

  const valid = await bcrypt.compare(password, account.passwordHash);
  if (!valid) return res.status(401).json({ error: "Usuario o contraseña incorrectos" });

  const userData = {
    userId: account.userId,
    username: account.username,
    name: account.name || null,
    phone: account.userId,
    messageCount: account.messageCount || 0,
    authType: "form",
  };

  req.login(userData, (err) => {
    if (err) return res.status(500).json({ error: "Error al crear sesión" });
    res.json({ ok: true, ...userData });
  });
});

// Admin: leer config completa
app.get("/admin/config", (req, res) => {
  if (req.query.password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "No autorizado" });
  }
  res.json(getConfig());
});

// ── Google Auth routes ────────────────────────────────────────────

// Iniciar flujo Google
app.get("/auth/google", (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.redirect("/?auth=disabled");
  }
  passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
});

// Callback de Google
app.get("/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/?auth=error" }),
  (req, res) => {
    res.redirect("/?auth=google");
  }
);

// Sesión activa (consulta desde el frontend)
app.get("/auth/session", (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    return res.json({ ok: true, ...req.user });
  }
  res.json({ ok: false });
});

// Logout
app.post("/auth/logout", (req, res) => {
  req.logout(() => res.json({ ok: true }));
});

// ─────────────────────────────────────────────────────────────────

// ── Monitor en tiempo real ────────────────────────────────────────

// SSE: stream de conversaciones activas (actualiza cada 4 seg)
app.get("/admin/monitor", (req, res) => {
  if (req.query.password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "No autorizado" });
  }
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
  res.flushHeaders();

  const send = async () => {
    try {
      const users = await db.getRecentConversations(25);
      const payload = users.map(u => ({
        userId: u.userId,
        name: u.name || u.username || u.userId,
        messageCount: u.messageCount || 0,
        humanMode: !!u.humanMode,
        lastMsg: u.history?.slice(-1)[0]?.content?.slice(0, 80) || "",
        lastRole: u.history?.slice(-1)[0]?.role || "",
        updatedAt: u.updatedAt,
      }));
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (e) { /* ignore */ }
  };

  send();
  const interval = setInterval(send, 4000);
  req.on("close", () => clearInterval(interval));
});

// Obtener historial completo de un usuario
app.get("/admin/conversation/:userId", async (req, res) => {
  if (req.query.password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "No autorizado" });
  }
  const user = await db.getUser(req.params.userId);
  if (!user) return res.json({ history: [], humanMode: false });
  res.json({ history: user.history || [], humanMode: !!user.humanMode });
});

// Inyectar mensaje como Juliana (takeover)
app.post("/admin/inject/:userId", async (req, res) => {
  if (req.body.password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "No autorizado" });
  }
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: "Mensaje vacío" });
  await db.setQueuedReply(req.params.userId, message.trim());
  res.json({ ok: true });
});

// Liberar modo humano (volver a IA)
app.post("/admin/release/:userId", async (req, res) => {
  if (req.body.password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "No autorizado" });
  }
  await db.setHumanMode(req.params.userId, false);
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────

// Admin: guardar config
app.post("/admin/config", (req, res) => {
  if (req.body.password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "No autorizado" });
  }
  const { password, ...config } = req.body;
  saveConfig(config);
  res.json({ ok: true });
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

db.connect()
  .catch(err => console.error("❌ Error conectando a MongoDB:", err.message))
  .then(() => loadConfig())
  .catch(err => console.error("❌ Error cargando config:", err.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`🌸 Juliana Bot corriendo en puerto ${PORT}`);
      console.log(`🔗 Webhook: POST /webhook | Verificación: GET /webhook`);
      console.log(`💳 Mercado Pago: ${process.env.MP_ACCESS_TOKEN ? "✅ configurado" : "❌ NO configurado — agrega MP_ACCESS_TOKEN en Railway"}`);
      const oaiKey = process.env.OPENAI_API_KEY;
      const edgeVoice = process.env.EDGE_TTS_VOICE || "es-CO-SalomeNeural";
      if (oaiKey) {
        console.log(`🎙️  TTS: OpenAI ✅ (${oaiKey.slice(0,8)}...) | voz: ${process.env.OPENAI_TTS_VOICE || "nova"}`);
      } else {
        console.log(`🎙️  TTS: Edge TTS gratuito ✅ | voz: ${edgeVoice}`);
      }
    });
  });
