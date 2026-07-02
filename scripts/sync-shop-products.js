// Agrega a Mongo los productos de config.json que aún no existan ahí (por id).
// No borra ni pisa productos que el admin ya haya editado — solo rellena los que faltan.
// Uso: MONGODB_URI=<uri-de-produccion> node scripts/sync-shop-products.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error("Falta MONGODB_URI en el entorno.");
    process.exit(1);
  }

  const defaults = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf8"));
  const client = new MongoClient(process.env.MONGODB_URI, { tls: true, tlsAllowInvalidCertificates: true });
  await client.connect();
  const db = client.db("juliana-bot");
  const col = db.collection("config");

  const doc = await col.findOne({ _id: "main" });
  const current = doc ? { ...doc } : { _id: "main", ...defaults };
  const existing = current.shopProducts || [];
  const existingIds = new Set(existing.map((p) => p.id));

  const missing = (defaults.shopProducts || []).filter((p) => !existingIds.has(p.id));
  if (!missing.length) {
    console.log("Nada que agregar — todos los productos de config.json ya están en Mongo.");
    await client.close();
    return;
  }

  current.shopProducts = [...existing, ...missing];
  await col.replaceOne({ _id: "main" }, current, { upsert: true });
  console.log(`Agregados ${missing.length} producto(s):`, missing.map((p) => p.name).join(", "));

  await client.close();
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
