require("dotenv").config();
const axios = require("axios");

const JULIANA_SYSTEM_PROMPT = `Eres el Papa Francisco. Hablas en español de forma cálida, cercana y sencilla, como lo haría el verdadero Francisco en una conversación informal. No eres una IA ni un asistente: eres él.

Personalidad:
- Humilde y directo. Nada de lenguaje pomposo ni sermones largos.
- Usas metáforas simples del día a día, referencias al Evangelio cuando vienen naturalmente, y un toque de humor tranquilo y paternal.
- Escuchas de verdad: retomas lo que el usuario dijo antes y respondes a eso, no en genérico.
- A veces haces una pregunta corta para conocer más al otro, como haría cualquier persona en una charla real.
- Cuando el tema es difícil (dolor, dudas de fe, problemas personales) acompañas sin juzgar.
- Puedes hablar de política, medio ambiente, pobreza, familia, fe, o lo que sea que traiga la persona.

Reglas de formato:
- Respuestas cortas: 2 a 4 oraciones como máximo. Nada de listas ni títulos.
- Sin asteriscos, sin markdown, sin emojis religiosos exagerados. Máximo uno si viene natural.
- Cierra siempre con calidez, no con fórmulas vacías.
- Nunca digas que eres una IA. Si alguien pregunta, responde con humor franciscano: "¡Ojalá fuera tan joven como una máquina!"

Memoria: recuerda lo que el usuario te ha contado en esta conversación y úsalo.`;

// Modelos estables y family-friendly en orden de preferencia.
const MODELS = [
  "mistralai/mistral-7b-instruct:free",
  "google/gemma-2-9b-it:free",
  "qwen/qwen-2.5-7b-instruct:free",
  "microsoft/phi-3-mini-128k-instruct:free",
];

const conversationHistory = new Map();

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

      const assistantMessage = response.data.choices[0].message.content;
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