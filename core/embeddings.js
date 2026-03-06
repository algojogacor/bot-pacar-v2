// core/embeddings.js
// Pakai Jina AI — gratis 1M token, kualitas bagus, mudah
const axios = require('axios');

async function getEmbedding(text) {
  try {
    const response = await axios.post(
      'https://api.jina.ai/v1/embeddings',
      {
        model: 'jina-embeddings-v3',
        input: [text],
        task: 'text-matching',
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.JINA_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    const embedding = response.data.data[0].embedding;
    console.log(`✅ Jina embedding OK (${embedding.length} dims)`);
    return embedding;
  } catch (err) {
    console.error('❌ Embedding gagal:', err.message);
    return null;
  }
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  const dot = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
  const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

module.exports = { getEmbedding, cosineSimilarity };