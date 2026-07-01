require("dotenv").config();
const axios = require("axios");
const { getConfig } = require("./config");
const db = require("./db");

// Modelos de propósito general — ordenados por preferencia.
const MODELS = [
  "meta-llama/llama-3.3-70b-instruct",
  "openai/gpt-4o-mini",
  "mistralai/mistral-small-3.2-24b-instruct",
];

// Cache en memoria para velocidad — MongoDB persiste entre reinicios
const conversationHistory = new Map();

const GARBAGE_PATTERNS = [
  /stripe/i,
  /credit card/i,
  /bank transfer/i,
  /método de pago/i,
  /selecciona un/i,
  /subscription/i,
  /billing/i,
  /payment/i,
  /grilled chicken/i,
  /honolulu/i,
  /shisha/i,
  /buen provecho/i,
  /enjoy tonight/i,
  /aucun paiement/i,
  /résumé/i,
  /mi cuenta virtual/i,
  /donativos/i,
  /seleccionar cuentas/i,
];

function cleanResponse(text) {
  let cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/^(el usuario dijo|user:|assistant:|respuesta:|thinking:)[^\n]*/gim, "")
    .replace(/^(publicado|posted|permalink|cita:|quote:|#\d+|join date|mensajes|posts|location|fecha)[^\n]*/gim, "")
    .replace(/\d{1,2} de \w+ de \d{4},?\s*\d{1,2}:\d{2}\s*(AM|PM)?/gi, "")
    .replace(/(\b\w+\b)(\s*́?\s*\1){4,}/gi, "$1")
    .replace(/^\s*[\r\n]/gm, "")
    .trim();

  // Cortar en la primera línea/oración que contenga basura
  const sentences = cleaned.split(/(?<=[.!?💋😏🔥💦])\s+/);
  const goodSentences = [];
  for (const s of sentences) {
    if (GARBAGE_PATTERNS.some(p => p.test(s))) break;
    goodSentences.push(s);
    if (goodSentences.length >= 3) break;
  }

  const result = goodSentences.join(" ").trim();
  return result || cleaned.slice(0, 200).trim();
}

async function getJulianaResponse(userId, userMessage, userName) {
  if (!conversationHistory.has(userId)) {
    const user = await db.getUser(userId);
    conversationHistory.set(userId, user?.history || []);
  }

  const history = conversationHistory.get(userId);
  history.push({ role: "user", content: userMessage });

  // Modo humano: admin inyectó respuesta manual
  const queued = await db.popQueuedReply(userId);
  if (queued) {
    history.push({ role: "assistant", content: queued });
    db.saveHistory(userId, history).catch(() => {});
    return queued;
  }

  if (history.length > 10) {
    history.splice(0, history.length - 10);
  }

  const headers = {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
  };

  let lastError;
  for (const model of MODELS) {
    try {
      console.log(`🤖 Probando modelo: ${model}`);
      const basePrompt = getConfig().prompt;
      const systemPrompt = userName
        ? `${basePrompt}\n\nEl nombre de la persona con quien hablas es ${userName}. Úsalo de vez en cuando de forma natural.`
        : basePrompt;
      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model,
          messages: [
            { role: "system", content: systemPrompt },
            ...history,
          ],
          temperature: 0.95,
          max_tokens: 200,
          frequency_penalty: 1.2,
          repetition_penalty: 1.2,
        },
        { headers }
      );

      const raw = response.data.choices[0].message.content;
      const assistantMessage = cleanResponse(raw);
      history.push({ role: "assistant", content: assistantMessage });

      // Persistir en MongoDB sin bloquear la respuesta
      db.saveHistory(userId, history).catch(err => console.error("⚠️ Error guardando historial:", err.message));

      if (model !== MODELS[0]) {
        console.log(`✅ Respondió con modelo de respaldo: ${model}`);
      }
      return assistantMessage;
    } catch (err) {
      const status = err.response?.status;
      lastError = err;
      if (status === 429 || status === 404 || status === 400) {
        console.warn(`⚠️ Modelo ${model} no disponible (${status}), probando siguiente...`);
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

async function clearHistory(userId) {
  conversationHistory.delete(userId);
  await db.clearUser(userId);
}

function evictCache(userId) {
  conversationHistory.delete(userId);
}

module.exports = { getJulianaResponse, clearHistory, evictCache };