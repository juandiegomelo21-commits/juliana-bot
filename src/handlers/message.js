const bcrypt = require("bcryptjs");
const { getJulianaResponse, clearHistory, evictCache } = require("../groq");
const { sendMessage, markAsRead } = require("../whatsapp");
const db = require("../db");

const DONATION_LINK = process.env.DONATION_LINK || "https://www.instagram.com/jd.gms/";

const messageCount = new Map();
const DONATION_INTERVAL = 15;

const RESET_KEYWORDS    = ["reiniciar", "reset", "nuevo", "empezar de nuevo", "borrar"];
const DONATION_KEYWORDS = ["donar", "donación", "ayudar", "apoyar", "colaborar"];

async function handleIncomingMessage(message, contact) {
  const userId = message.from;
  const messageText = message.text?.body?.trim();

  if (!messageText) return;

  await markAsRead(message.id).catch(() => {});

  const lowerText = messageText.toLowerCase();

  // Reset
  if (RESET_KEYWORDS.some(kw => lowerText.includes(kw))) {
    clearHistory(userId);
    messageCount.delete(userId);
    await sendMessage(userId, "✨ He borrado nuestra conversación. ¡Empecemos de nuevo! ¿Cómo estás hoy?");
    return;
  }

  // Donación
  if (DONATION_KEYWORDS.some(kw => lowerText.includes(kw))) {
    await sendMessage(
      userId,
      `Dar es uno de los actos más hermosos que existen. Puedes apoyar esta misión aquí:\n\n${DONATION_LINK}\n\nDios te lo paga con creces. 🙏`
    );
    return;
  }

  // Login desde WhatsApp (para cambio de número): "login usuario contraseña"
  if (lowerText.startsWith("login ") && db.isConnected()) {
    const parts = messageText.trim().split(/\s+/);
    if (parts.length >= 3) {
      const [, username, ...passParts] = parts;
      const password = passParts.join(" ");
      const account = await db.getUserByUsername(username.toLowerCase());
      if (!account) {
        await sendMessage(userId, `No encontré una cuenta con el usuario "${username}" 😕`);
        return;
      }
      const valid = await bcrypt.compare(password, account.passwordHash);
      if (!valid) {
        await sendMessage(userId, "Contraseña incorrecta 😕");
        return;
      }
      if (account.userId !== userId) {
        await db.mergeAccount(userId, account);
        evictCache(userId);
      }
      await sendMessage(
        userId,
        `¡Bienvenid@ de nuevo, ${account.name || account.username}! 🌸 Continúo donde lo dejamos 💕`
      );
      return;
    }
  }

  // Conversación normal — cargar nombre si tiene cuenta
  let userName = null;
  if (db.isConnected()) {
    const user = await db.getUser(userId);
    userName = user?.name || null;
  }

  const julianaResponse = await getJulianaResponse(userId, messageText, userName);

  // Contador para sugerencia de donación
  let count;
  const dbCount = await db.getAndIncrementCount(userId);
  if (dbCount !== null) {
    count = dbCount;
    messageCount.set(userId, count);
  } else {
    count = (messageCount.get(userId) || 0) + 1;
    messageCount.set(userId, count);
  }

  let finalResponse = julianaResponse;
  if (count % DONATION_INTERVAL === 0) {
    finalResponse += `\n\nSi estas conversaciones te han dado algo, considera apoyar esta misión:\n${DONATION_LINK} 🙏`;
  }

  await sendMessage(userId, finalResponse);
}

module.exports = { handleIncomingMessage };
