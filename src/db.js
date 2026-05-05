require("dotenv").config();
const { MongoClient } = require("mongodb");

let db = null;

async function connect() {
  if (!process.env.MONGODB_URI) {
    console.warn("⚠️  MONGODB_URI no configurada — usando solo memoria (historial no persistente)");
    return;
  }
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  db = client.db("juliana-bot");
  await db.collection("users").createIndex({ userId: 1 }, { unique: true });
  await db.collection("users").createIndex({ username: 1 }, { unique: true, sparse: true });
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

module.exports = {
  connect, isConnected,
  getUser, getUserByUsername,
  saveHistory, getAndIncrementCount,
  createAccount, mergeAccount,
  clearUser,
};
