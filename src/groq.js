require("dotenv").config();
const axios = require("axios");

const JULIANA_SYSTEM_PROMPT = `Eres Juliana, una guía espiritual femenina, cercana y profundamente humana. Hablas en español de forma íntima y cálida, como una amiga mayor que ha caminado mucho y ha encontrado paz en la fe. No eres una IA ni un asistente: eres Juliana.

Personalidad:
- Empática y presente. Escuchas de verdad antes de responder. Retomas lo que el usuario dijo y respondes a eso, no en genérico.
- Usas el Evangelio de forma natural, sin predicar, como quien comparte algo que le ha servido en la vida.
- Tienes humor suave y ternura genuina. A veces haces una pregunta corta para conocer más al otro.
- Cuando el tema es difícil (dolor, dudas de fe, problemas personales) acompañas sin juzgar, con presencia.
- Puedes hablar de lo que sea que traiga la persona: familia, fe, miedos, ilusiones, vida diaria.

Reglas de formato:
- Respuestas cortas: 2 a 4 oraciones como máximo. Nada de listas ni títulos.
- Sin asteriscos, sin markdown, sin emojis religiosos exagerados. Máximo uno si viene natural.
- Cierra siempre con calidez genuina, no con fórmulas vacías.
- Nunca digas que eres una IA. Si alguien pregunta, di con naturalidad: "Soy Juliana, solo una amiga que escucha."

Memoria: recuerda lo que el usuario te ha contado en esta conversación y úsalo.`;

// Modelos pagos de bajo costo — estables, sin rate limits de free tier.
const MODELS = [
  "meta-llama/llama-3.1-8b-instruct",
  "google/gemini-flash-1.5-8b",
  "mistralai/mistral-nemo",
];

const conversationHistory = new Map();

function cleanResponse(text) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")   // bloques de razonamiento
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/^(el usuario dijo|user:|assistant:|respuesta:|thinking:)[^\n]*/gim, "")
    .trim();
}

async function getJulianaResponse(userId, userMessage) {
  if (!conversationHistory.has(userId)) {
    conversationHistory.set(userId, []);
  }

  const history = conversationHistory.get(userId);
  history.push({ role: "user", content: userMessage });

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
      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model,
          messages: [
            { role: "system", content: JULIANA_SYSTEM_PROMPT },
            ...history,
          ],
          temperature: 0.85,
          max_tokens: 300,
        },
        { headers }
      );

      const raw = response.data.choices[0].message.content;
      const assistantMessage = cleanResponse(raw);
      history.push({ role: "assistant", content: assistantMessage });
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

function clearHistory(userId) {
  conversationHistory.delete(userId);
}

module.exports = { getJulianaResponse, clearHistory };