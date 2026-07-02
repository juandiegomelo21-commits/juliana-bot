require("dotenv").config();
const { MongoClient } = require("mongodb");

let db = null;

async function connect() {
  if (!process.env.MONGODB_URI) {
    console.warn("⚠️  MONGODB_URI no configurada — usando solo memoria (historial no persistente)");
    return;
  }
  const client = new MongoClient(process.env.MONGODB_URI, {
    tls: true,
    tlsAllowInvalidCertificates: true,
    serverSelectionTimeoutMS: 8000,
  });
  try {
    await client.connect();
  } catch (err) {
    await client.close().catch(() => {});
    throw err;
  }
  db = client.db("juliana-bot");
  await db.collection("users").createIndex({ userId: 1 }, { unique: true });
  await db.collection("users").createIndex({ username: 1 }, { unique: true, sparse: true });
  await db.collection("users").createIndex({ googleId: 1 }, { unique: true, sparse: true });
  console.log("✅ MongoDB conectado");
}

function isConnected() {
  return db !== null;
}

async function getUser(userId) {
  if (!isConnected()) return null;
  return db.collection("users").findOne({ userId });
}

async function getUserByUsername(username) {
  if (!isConnected()) return null;
  return db.collection("users").findOne({ username: username.toLowerCase() });
}

async function saveHistory(userId, history) {
  if (!isConnected()) return;
  await db.collection("users").updateOne(
    { userId },
    { $set: { history, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date(), messageCount: 0 } },
    { upsert: true }
  );
}

async function getAndIncrementCount(userId) {
  if (!isConnected()) return null;
  const result = await db.collection("users").findOneAndUpdate(
    { userId },
    {
      $inc: { messageCount: 1 },
      $set: { updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date(), history: [] },
    },
    { upsert: true, returnDocument: "after" }
  );
  return result.messageCount;
}

// Crear cuenta con usuario y contraseña (ya hasheada) vinculada al userId actual
async function createAccount(userId, username, passwordHash, name) {
  if (!isConnected()) return;
  await db.collection("users").updateOne(
    { userId },
    {
      $set: {
        username: username.toLowerCase(),
        passwordHash,
        name: name || null,
        hasAccount: true,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date(), history: [], messageCount: 0 },
    },
    { upsert: true }
  );
}

// Copiar datos de la cuenta origen al userId actual (para login desde otro número)
async function mergeAccount(currentUserId, sourceUser) {
  if (!isConnected()) return;
  await db.collection("users").updateOne(
    { userId: currentUserId },
    {
      $set: {
        username: sourceUser.username,
        passwordHash: sourceUser.passwordHash,
        name: sourceUser.name || null,
        hasAccount: true,
        history: sourceUser.history || [],
        messageCount: sourceUser.messageCount || 0,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );
}

async function clearUser(userId) {
  if (!isConnected()) return;
  await db.collection("users").updateOne(
    { userId },
    { $set: { history: [], messageCount: 0, updatedAt: new Date() } }
  );
}

// ── Google Auth ───────────────────────────────────────────────────

async function getUserByGoogleId(googleId) {
  if (!isConnected()) return null;
  return db.collection("users").findOne({ googleId });
}

async function createGoogleAccount({ googleId, email, name, avatar }) {
  if (!isConnected()) {
    return { userId: `google-${googleId}`, googleId, googleEmail: email, name, avatar, messageCount: 0 };
  }
  const userId = `google-${googleId}`;
  await db.collection("users").updateOne(
    { googleId },
    {
      $set: {
        googleId,
        googleEmail: email,
        name,
        googleAvatar: avatar,
        hasAccount: true,
        authType: "google",
        updatedAt: new Date(),
      },
      $setOnInsert: { userId, createdAt: new Date(), history: [], messageCount: 0 },
    },
    { upsert: true }
  );
  return db.collection("users").findOne({ googleId });
}

async function updateGoogleProfile(googleId, { name, avatar, email }) {
  if (!isConnected()) return;
  await db.collection("users").updateOne(
    { googleId },
    { $set: { name, googleAvatar: avatar, googleEmail: email, updatedAt: new Date() } }
  );
}

// ── Monitor & Takeover ────────────────────────────────────────────

async function getRecentConversations(limit = 20) {
  if (!isConnected()) return [];
  return db.collection("users")
    .find({ history: { $exists: true, $not: { $size: 0 } } })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .project({ userId: 1, username: 1, name: 1, history: 1, messageCount: 1, updatedAt: 1, queuedReply: 1, humanMode: 1 })
    .toArray();
}

async function setQueuedReply(userId, message) {
  if (!isConnected()) return;
  await db.collection("users").updateOne(
    { userId },
    { $set: { queuedReply: message, humanMode: true, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function popQueuedReply(userId) {
  if (!isConnected()) return null;
  const result = await db.collection("users").findOneAndUpdate(
    { userId, queuedReply: { $exists: true, $ne: null } },
    { $unset: { queuedReply: "" } },
    { returnDocument: "before" }
  );
  return result?.queuedReply || null;
}

async function setHumanMode(userId, enabled) {
  if (!isConnected()) return;
  await db.collection("users").updateOne(
    { userId },
    { $set: { humanMode: enabled, updatedAt: new Date() } },
    { upsert: true }
  );
}

// ── Bot Config ────────────────────────────────────────────────────

async function loadBotConfig(defaults) {
  if (!isConnected()) return defaults;
  try {
    const doc = await db.collection('config').findOne({ _id: 'main' });
    if (doc) {
      const { _id, ...config } = doc;
      return config;
    }
    // Primera vez: persistir defaults en Mongo
    await saveBotConfig(defaults);
    return defaults;
  } catch (e) {
    console.warn('⚠️ No se pudo leer config de MongoDB:', e.message);
    return defaults;
  }
}

// ── Pedidos ───────────────────────────────────────────────────────

async function saveOrder(order) {
  if (!isConnected()) return;
  await db.collection("orders").insertOne(order);
}

async function saveBotConfig(config) {
  if (!isConnected()) return;
  const { _id, ...clean } = config;
  await db.collection('config').replaceOne(
    { _id: 'main' },
    { _id: 'main', ...clean },
    { upsert: true }
  );
}

module.exports = {
  connect, isConnected,
  getUser, getUserByUsername,
  saveHistory, getAndIncrementCount,
  createAccount, mergeAccount,
  clearUser,
  getUserByGoogleId, createGoogleAccount, updateGoogleProfile,
  getRecentConversations, setQueuedReply, popQueuedReply, setHumanMode,
  loadBotConfig, saveBotConfig,
  saveOrder,
};
