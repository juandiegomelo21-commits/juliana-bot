const fs = require('fs');
const path = require('path');
const db = require('./db');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
let _cache = null;

function _readFile() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function getConfig() {
  if (!_cache) _cache = _readFile();
  return _cache;
}

async function loadConfig() {
  const defaults = _readFile();
  _cache = await db.loadBotConfig(defaults);
  console.log(`⚙️  Config cargada desde ${db.isConnected() ? 'MongoDB ✅' : 'archivo local ⚠️'}`);
}

async function saveConfig(config) {
  _cache = config;
  await db.saveBotConfig(config);
  // Backup en archivo local (útil en dev)
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8'); } catch {}
}

module.exports = { getConfig, loadConfig, saveConfig };
