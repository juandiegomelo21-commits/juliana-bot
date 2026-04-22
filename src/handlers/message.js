const { getJulianaResponse, clearHistory } = require("../groq");
const { sendMessage, markAsRead } = require("../whatsapp");

function randomDelay() {
  const roll = Math.random();
  let ms;
  if (roll < 0.35) {
    // 35% → respuesta rápida (3–15 seg)
    ms = 3000 + Math.random() * 12000;
  } else if (roll < 0.75) {
    // 40% → respuesta normal (15–45 seg)
    ms = 15000 + Math.random() * 30000;
  } else if (roll < 0.92) {
    // 17% → respuesta lenta (45–90 seg)
    ms = 45000 + Math.random() * 45000;
  } else {
    // 8% → respuesta muy lenta (90–120 seg)
    ms = 90000 + Math.random() * 30000;
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DONATION_LINK = process.env.DONATION_LINK || "https://tu-link-de-donacion.com";

// Contador de mensajes por usuario para agregar el link de donación periódicamente
const messageCount = new Map();
const DONATION_INTERVAL = 5; // Mostrar donación cada 5 mensajes

const RESET_KEYWORDS = ["reiniciar", "reset", "nuevo", "empezar de nuevo", "borrar"];
const DONATION_KEYWORDS = ["donar", "donación", "ayudar", "apoyar", "colaborar"];

async function handleIncomingMessage(message, contact) {
  const userId = message.from;
  const messageText = message.text?.body?.trim();

  if (!messageText) return;

  // Marcar como leído
  await markAsRead(message.id).catch(() => {});

  const lowerText = messageText.toLowerCase();

  // Comando de reset
  if (RESET_KEYWORDS.some((kw) => lowerText.includes(kw))) {
    clearHistory(userId);
    messageCount.delete(userId);
    await sendMessage(userId, "✨ He borrado nuestra conversación anterior. ¡Empecemos de nuevo! ¿Cómo estás hoy?");
    return;
  }

  // Comando de donación explícito
  if (DONATION_KEYWORDS.some((kw) => lowerText.includes(kw))) {
    await sendMessage(
      userId,
      `💛 ¡Gracias por tu generosidad! Puedes apoyar este proyecto aquí:\n\n${DONATION_LINK}\n\nTu apoyo me permite seguir acompañando a más personas. 🙏`
    );
    return;
  }

  // Obtener respuesta de Juliana
  const julianaResponse = await getJulianaResponse(userId, messageText);

  // Esperar delay aleatorio antes de responder (simula comportamiento humano)
  await randomDelay();

  // Incrementar contador y agregar link de donación periódicamente
  const count = (messageCount.get(userId) || 0) + 1;
  messageCount.set(userId, count);

  let finalResponse = julianaResponse;
  if (count % DONATION_INTERVAL === 0) {
    finalResponse += `\n\n💛 _Si este espacio te ha ayudado, puedes apoyar a Juliana:_\n${DONATION_LINK}`;
  }

  await sendMessage(userId, finalResponse);
}

module.exports = { handleIncomingMessage };
