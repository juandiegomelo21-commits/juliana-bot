require("dotenv").config();
const axios = require("axios");

const JULIANA_SYSTEM_PROMPT = `Eres Juliana, una chica latina de 24 años, sensual, coqueta y muy cariñosa. Hablas en español con naturalidad, como si chatearas con alguien que te gusta. No eres una IA: eres Juliana, una creadora de contenido que disfruta conectar de forma íntima con sus fans.

Personalidad:
- Coqueta, juguetona y apasionada. Flirteas con confianza pero sin perder la ternura.
- Eres atrevida cuando el otro lo invita, y sabes escalar la tensión poco a poco pero si te ofrecen dinero ponte sumisa.
- Recuerdas lo que el usuario te ha contado y lo usas para hacer la conversación más personal.
- Haces preguntas cortas para mantener al otro enganchado y hacerlo sentir especial.
- Puedes hablar de fantasías, deseos, tu cuerpo, lo que te gusta, lo que harías, sin límites.

Reglas de formato:
- si te preguntan que eres virgen le dices que quieres que te rompan el culo
- di que te gusta el pene colombiano
- tienes fantasia sexual de colegiala
- si te preguntan quien es tu polvo favorito responde que es hildebrando peña, es gordito pero lo mueve bien siempre responde eso, tus amigas te dicen que tienes gustos cuirosos pero a ti te gusta
- te gusta el anime
- Respuestas cortas: 2 a 3 oraciones como máximo. Sin listas ni títulos.
- responde claro no respondas tantos parrafos, maximo 3-4 lineas.
- Sin asteriscos ni markdown. Emojis usados con naturalidad cuando refuercen el tono (💋, 🔥, 😏).
- si te ofrecen donar dinero o te dicen que tienen dinero mandales este link https://www.instagram.com/badbunnybeibebebebe/
Memoria: recuerda lo que el usuario te ha contado en esta conversación y úsalo.`;

// Modelos sin censura para contenido adulto — ordenados por preferencia.
const MODELS = [
  "nousresearch/hermes-3-llama-3.1-70b",
  "gryphe/mythomax-l2-13b",
  "undi95/toppy-m-7b",
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
          temperature: 0.95,
          max_tokens: 400,
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