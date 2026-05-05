const bcrypt = require("bcryptjs");
const { getJulianaResponse, clearHistory, evictCache } = require("../groq");
const { sendMessage, markAsRead } = require("../whatsapp");
const db = require("../db");

const DONATION_LINK = process.env.DONATION_LINK || "https://www.instagram.com/jd.gms/";

const messageCount = new Map();
const DONATION_INTERVAL = 15;

// Estado de flujos multi-paso por usuario
// { step: 'reg_username' | 'reg_password', data: {} }
const pendingFlow = new Map();

const RESET_KEYWORDS    = ["reiniciar", "reset", "nuevo", "empezar de nuevo", "borrar"];
const DONATION_KEYWORDS = ["donar", "donación", "ayudar", "apoyar", "colaborar"];
const REGISTER_KEYWORDS = ["registrarme", "registro", "crear cuenta", "crear mi cuenta"];
const HELP_KEYWORDS     = ["ayuda", "comandos", "/help"];

async function handleIncomingMessage(message, contact) {
  const userId = message.from;
  const messageText = message.text?.body?.trim();

  if (!messageText) return;

  await markAsRead(message.id).catch(() => {});

  const lowerText = messageText.toLowerCase();

  // ── Flujos multi-paso activos (registro) ─────────────────────────
  if (pendingFlow.has(userId) && db.isConnected()) {
    const flow = pendingFlow.get(userId);

    if (flow.step === "reg_username") {
      const username = messageText.trim().toLowerCase().replace(/\s+/g, "");
      if (username.length < 3) {
        await sendMessage(userId, "El usuario debe tener al menos 3 caracteres. ¿Cuál quieres?");
        return;
      }
      // Verificar que no exista
      const existing = await db.getUserByUsername(username);
      if (existing) {
        await sendMessage(userId, `El usuario "${username}" ya está tomado 😕 Prueba con otro.`);
        return;
      }
      pendingFlow.set(userId, { step: "reg_password", data: { username } });
      await sendMessage(userId, `Perfecto, *${username}*. Ahora elige una contraseña (mínimo 4 caracteres):`);
      return;
    }

    if (flow.step === "reg_password") {
      const password = messageText.trim();
      if (password.length < 4) {
        await sendMessage(userId, "La contraseña debe tener al menos 4 caracteres. Intenta de nuevo:");
        return;
      }
      const { username } = flow.data;
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await db.getUser(userId);
      await db.createAccount(userId, username, passwordHash, user?.name || null);
      pendingFlow.delete(userId);
      await sendMessage(
        userId,
        `✅ ¡Cuenta creada! 🌸\n\n*Usuario:* ${username}\n*Contraseña:* la que acabas de escribir\n\nDesde cualquier número puedes escribir:\n👉 *login ${username} tucontraseña*\npara recuperar esta conversación.`
      );
      return;
    }
  }

  // ── Comandos especiales ───────────────────────────────────────────

  // Ayuda
  if (HELP_KEYWORDS.some(kw => lowerText.includes(kw))) {
    await sendMessage(
      userId,
      `Comandos disponibles:\n\n• *registrarme* — crea una cuenta para guardar tu conversación\n• *login usuario contraseña* — accede a tu cuenta desde otro número\n• *reiniciar* — borra tu historial de chat\n• *donar* — apoya esta misión 🙏`
    );
    return;
  }

  // Reset
  if (RESET_KEYWORDS.some(kw => lowerText.includes(kw))) {
    pendingFlow.delete(userId);
    clearHistory(userId);
    messageCount.delete(userId);
    await sendMessage(userId, "✨ He borrado nuestra conversación anterior. ¡Empecemos de nuevo! ¿Cómo estás hoy?");
    return;
  }

  // Donación
  if (DONATION_KEYWORDS.some(kw => lowerText.includes(kw))) {
    await sendMessage(
      userId,
      `Dar es uno de los actos más hermosos que existen. Si quieres apoyar esta misión, puedes hacerlo aquí:\n\n${DONATION_LINK}\n\nDios te lo paga con creces. 🙏`
    );
    return;
  }

  // Registro — iniciar flujo
  if (REGISTER_KEYWORDS.some(kw => lowerText.includes(kw)) && db.isConnected()) {
    const user = await db.getUser(userId);
    if (user?.hasAccount) {
      await sendMessage(userId, `Ya tienes una cuenta registrada con el usuario *${user.username}* 🌸`);
      return;
    }
    pendingFlow.set(userId, { step: "reg_username", data: {} });
    await sendMessage(userId, "¡Vamos a crear tu cuenta! 🌸\n\n¿Qué nombre de usuario quieres? (sin espacios)");
    return;
  }

  // Login — comando en una sola línea: "login usuario contraseña"
  if (lowerText.startsWith("login ") && db.isConnected()) {
    const parts = messageText.trim().split(/\s+/);
    if (parts.length < 3) {
      await sendMessage(userId, "Formato: *login usuario contraseña*");
      return;
    }
    const [, username, ...passParts] = parts;
    const password = passParts.join(" ");

    const account = await db.getUserByUsername(username.toLowerCase());
    if (!account) {
      await sendMessage(userId, `No encontré ninguna cuenta con el usuario "${username}" 😕`);
      return;
    }
    const valid = await bcrypt.compare(password, account.passwordHash);
    if (!valid) {
      await sendMessage(userId, "Contraseña incorrecta 😕 Inténtalo de nuevo.");
      return;
    }

    // Si ya es el mismo userId, solo confirmar
    if (account.userId === userId) {
      await sendMessage(userId, `¡Ya estás en tu cuenta, ${account.name || account.username}! 🌸`);
      return;
    }

    // Copiar datos de la cuenta al número actual y limpiar cache
    await db.mergeAccount(userId, account);
    evictCache(userId); // fuerza recarga del historial desde DB en el próximo mensaje

    await sendMessage(
      userId,
      `¡Bienvenid@ de nuevo, ${account.name || account.username}! 🌸\nHe cargado tu conversación y todos tus datos. Continuamos donde lo dejamos 💕`
    );
    return;
  }

  // ── Conversación normal ───────────────────────────────────────────

  let userName = null;
  if (db.isConnected()) {
    const user = await db.getUser(userId);
    userName = user?.name || null;
  }

  const julianaResponse = await getJulianaResponse(userId, messageText, userName);

  // Incrementar contador
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
