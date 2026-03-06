// core/memory.js
const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_TOKEN,
});

async function initDB() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT 'owner',
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT 'owner',
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, key)
    );

    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT 'owner',
      content TEXT NOT NULL,
      embedding TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// ── SHORT-TERM: Pesan biasa ──
async function saveMessage(role, content, userId = 'owner') {
  await db.execute({
    sql: 'INSERT INTO messages (user_id, role, content) VALUES (?, ?, ?)',
    args: [userId, role, content],
  });
}

async function getRecentMessages(limit = 20, userId = 'owner') {
  const result = await db.execute({
    sql: 'SELECT role, content FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT ?',
    args: [userId, limit],
  });
  return result.rows.reverse();
}

// ── LONG-TERM KEY-VALUE: Fakta ──
async function saveFact(key, value, userId = 'owner') {
  await db.execute({
    sql: `INSERT INTO facts (user_id, key, value)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id, key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP`,
    args: [userId, key, value, value],
  });
}

async function getAllFacts(userId = 'owner') {
  const result = await db.execute({
    sql: 'SELECT key, value FROM facts WHERE user_id = ?',
    args: [userId],
  });
  if (result.rows.length === 0) return '';
  return result.rows.map(r => `- ${r.key}: ${r.value}`).join('\n');
}

async function getFactByKey(key, userId = 'owner') {
  const result = await db.execute({
    sql: 'SELECT value FROM facts WHERE user_id = ? AND key = ?',
    args: [userId, key],
  });
  return result.rows.length > 0 ? result.rows[0].value : null;
}

// ── LONG-TERM SEMANTIC: Vector Memory ──
async function saveMemory(content, embedding, userId = 'owner') {
  if (!embedding) return;
  await db.execute({
    sql: 'INSERT INTO memories (user_id, content, embedding) VALUES (?, ?, ?)',
    args: [userId, content, JSON.stringify(embedding)],
  });
}

async function getRelevantMemories(queryEmbedding, topK = 3, threshold = 0.75, userId = 'owner') {
  if (!queryEmbedding) return [];
  const { cosineSimilarity } = require('./embeddings');
  const result = await db.execute({
    sql: 'SELECT content, embedding FROM memories WHERE user_id = ?',
    args: [userId],
  });
  return result.rows
    .map(row => ({
      content: row.content,
      score: cosineSimilarity(queryEmbedding, JSON.parse(row.embedding))
    }))
    .filter(r => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(r => r.content);
}

async function getAllMemories(userId = null) {
  const result = userId
    ? await db.execute({ sql: 'SELECT user_id, content, embedding FROM memories WHERE user_id = ?', args: [userId] })
    : await db.execute('SELECT user_id, content, embedding FROM memories');
  return result.rows.map(r => ({
    user_id: r.user_id,
    content: r.content,
    embedding: JSON.parse(r.embedding)
  }));
}

// ── Ambil semua user yang pernah chat ──
async function getAllUsers() {
  const result = await db.execute(
    `SELECT DISTINCT user_id FROM messages WHERE role = 'user' AND user_id != 'owner'`
  );
  return result.rows.map(r => r.user_id);
}

// ── INTERAKSI ──
async function updateLastInteraction(userId = 'owner') {
  await saveFact('last_interaction', new Date().toISOString(), userId);
}

async function getLastInteraction(userId = 'owner') {
  const result = await db.execute({
    sql: "SELECT value FROM facts WHERE user_id = ? AND key = 'last_interaction'",
    args: [userId],
  });
  return result.rows.length > 0 ? new Date(result.rows[0].value) : null;
}

module.exports = {
  initDB,
  saveMessage, getRecentMessages,
  saveFact, getAllFacts, getFactByKey,
  saveMemory, getRelevantMemories, getAllMemories,
  getAllUsers,
  updateLastInteraction, getLastInteraction,
};