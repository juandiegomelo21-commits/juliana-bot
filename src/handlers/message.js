const { getJulianaResponse, clearHistory } = require("../groq");
const { sendMessage, markAsRead } = require("../whatsapp");


const DONATION_LINK = process.env.DONATION_LINK || "https://www.instagram.com/jd.gms/";

const messageCount = new Map();
const DONATION_INTERVAL = 15; // Sugerir donación cada 15 mensajes

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
      `Dar es uno de los actos más hermosos que existen. Si quieres apoyar esta misión de acompañar a las personas, puedes hacerlo aquí:\n\n${DONATION_LINK}\n\nDios te lo paga con creces. 🙏`
    );
    return;
  }

  // Obtener respuesta de Juliana
  const julianaResponse = await getJulianaResponse(userId, messageText);

  // Incrementar contador y agregar link de donación periódicamente
  const count = (messageCount.get(userId) || 0) + 1;
  messageCount.set(userId, count);

  let finalResponse = julianaResponse;
  if (count % DONATION_INTERVAL === 0) {
    finalResponse += `\n\nSi estas conversaciones te han dado algo, considera apoyar esta misión:\n${DONATION_LINK} 🙏`;
  }

  await sendMessage(userId, finalResponse);
}

module.exports = { handleIncomingMessage };
