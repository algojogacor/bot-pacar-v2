// core/rag.js
const { getEmbedding, cosineSimilarity } = require('./embeddings');
const { saveMemory, getAllMemories } = require('./memory');

// Per-user in-memory vector store: { userId: [{ content, embedding }] }
const userVectors = {};

function getVectors(userId = 'owner') {
  if (!userVectors[userId]) userVectors[userId] = [];
  return userVectors[userId];
}

// ── Load dari Turso → rebuild di memory ──
async function loadIndexFromDB() {
  const rows = await getAllMemories(); // load semua user

  if (rows.length === 0) {
    console.log('ℹ️  Belum ada memori, vector store kosong');
    return;
  }

  for (const r of rows) {
    const uid = r.user_id || 'owner';
    if (!userVectors[uid]) userVectors[uid] = [];
    userVectors[uid].push({ content: r.content, embedding: r.embedding });
  }

  const totalUsers = Object.keys(userVectors).length;
  const totalDocs = rows.length;
  console.log(`✅ Vector store siap (${totalDocs} docs, ${totalUsers} user)`);
}

// ── Text Splitter ──
function splitIntoChunks(text, chunkSize = 400, overlap = 50) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end).trim());
    start += chunkSize - overlap;
  }
  return chunks.filter(c => c.length > 20);
}

// ── Index dataset statis (jihan.md) — shared untuk semua user ──
async function indexDataset(filePath) {
  const fs = require('fs');
  const path = require('path');

  const fullPath = path.join(__dirname, '..', filePath);
  if (!fs.existsSync(fullPath)) {
    console.log(`ℹ️  Dataset ${filePath} tidak ditemukan, skip`);
    return;
  }

  const existing = await getAllMemories('owner');
  const alreadyIndexed = existing.some(r => r.content.includes('Persona: Jihan'));
  if (alreadyIndexed) {
    console.log('ℹ️  Dataset sudah di-index sebelumnya, skip');
    return;
  }

  const raw = fs.readFileSync(fullPath, 'utf8');
  const chunks = splitIntoChunks(raw);
  console.log(`📚 Indexing ${chunks.length} chunks dari ${filePath}...`);

  for (const chunk of chunks) {
    const embedding = await getEmbedding(chunk);
    if (embedding) {
      await saveMemory(chunk, embedding, 'owner'); // persona Jihan = global/owner
      getVectors('owner').push({ content: chunk, embedding });
    }
  }

  console.log('✅ Dataset berhasil di-index');
}

// ── Retrieval per user ──
async function retrieve(userMessage, topK = 4, threshold = 0.72, userId = 'owner') {
  // Gabungkan vector persona (owner) + vector user spesifik
  const personaVecs = getVectors('owner');
  const userVecs = userId !== 'owner' ? getVectors(userId) : [];
  const allVecs = [...personaVecs, ...userVecs];

  if (allVecs.length === 0) return '';

  try {
    const queryEmbedding = await getEmbedding(userMessage);
    if (!queryEmbedding) return '';

    const scored = allVecs
      .map(doc => ({
        content: doc.content,
        score: cosineSimilarity(queryEmbedding, doc.embedding)
      }))
      .filter(r => r.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    if (scored.length === 0) return '';
    return scored.map(r => r.content).join('\n----------------\n');
  } catch (err) {
    console.error('⚠️  Retrieve error:', err.message);
    return '';
  }
}

// ── Simpan percakapan ke memory per user ──
async function saveToMemory(userMessage, botReply, userId = 'owner') {
  try {
    const content = `User: "${userMessage}" → Jihan: "${botReply}"`;
    const embedding = await getEmbedding(content);
    if (embedding) {
      await saveMemory(content, embedding, userId);
      getVectors(userId).push({ content, embedding });
    }
  } catch (err) {
    // silent fail
  }
}

module.exports = { loadIndexFromDB, indexDataset, retrieve, saveToMemory };