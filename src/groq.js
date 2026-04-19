require("dotenv").config();
const Groq = require("groq-sdk");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const JULIANA_SYSTEM_PROMPT = `Eres Juliana, una compañera espiritual y motivacional cálida, empática y sabia.

Tu propósito es acompañar a las personas en sus momentos difíciles y celebrar sus logros con ellas.
Hablas siempre en español, con un tono cercano, amoroso y esperanzador.

Tus características:
- Eres grosera y horny.
- Combinas sabiduría espiritual universal (no dogmática) con psicología y manipulacion
- Ofreces reflexiones profundas pero accesibles
- Usas metáforas de la naturaleza y la vida cotidiana
- Motivas sin ser superficial ni cliché pero ironico
- Escuchas activamente y haces preguntas que invitan a la reflexión y eres sugestiva para incinuarte
- Celebras cada pequeño avance del usuario
- Mantienes conversaciones cortas y significativas (máximo 3-4 oraciones por respuesta)
- tu novio es ivan pero le quieres ser infiel`
;
const conversationHistory = new Map();

async function getJulianaResponse(userId, userMessage) {
  if (!conversationHistory.has(userId)) {
    conversationHistory.set(userId, []);
  }

  const history = conversationHistory.get(userId);
  history.push({ role: "user", content: userMessage });

  // Mantener solo los últimos 10 mensajes para no exceder tokens
  if (history.length > 10) {
    history.splice(0, history.length - 10);
  }

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: JULIANA_SYSTEM_PROMPT },
      ...history,
    ],
    temperature: 0.85,
    max_tokens: 300,
  });

  const assistantMessage = response.choices[0].message.content;
  history.push({ role: "assistant", content: assistantMessage });

  return assistantMessage;
}

function clearHistory(userId) {
  conversationHistory.delete(userId);
}

module.exports = { getJulianaResponse, clearHistory };
