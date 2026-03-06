// core/intelligence.js
const axios = require('axios');
const { saveFact, getFactByKey, getRecentMessages } = require('./memory');

// ── Helper: call Groq mini — FIX: rotasi key, tidak selalu key 1 ──
const groqKeys = [
  process.env.GROQ_API_KEY,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4,
].filter(Boolean);
let miniKeyIndex = 0;

async function callGroqMini(prompt) {
  const key = groqKeys[miniKeyIndex % groqKeys.length];
  miniKeyIndex++;
  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 200,
    },
    {
      headers: { Authorization: `Bearer ${key}` },
      timeout: 10000,
    }
  );
  return response.data.choices[0].message.content.trim();
}

// ═══════════════════════════════════════════
// 1. CONVERSATION SUMMARIZER
// Dipanggil otomatis setiap 20 pesan
// ═══════════════════════════════════════════
async function maybeSummarizeConversation() {
  try {
    const messages = await getRecentMessages(20);
    if (messages.length < 20) return;

    const msgCount = parseInt(await getFactByKey('msg_count') || '0');
    const newCount = msgCount + 1;
    await saveFact('msg_count', String(newCount));

    if (newCount % 20 !== 0) return;

    console.log('📝 Merangkum percakapan...');

    const convo = messages.map(m =>
      `${m.role === 'assistant' ? 'Jihan' : 'User'}: ${m.content}`
    ).join('\n');

    const raw = await callGroqMini(`
Rangkum percakapan berikut dalam 3-5 kalimat singkat.
Fokus pada: topik yang dibahas, mood user, hal penting yang diceritakan.
Tulis dalam bahasa Indonesia, singkat dan padat.

Percakapan:
${convo}

Ringkasan:`);

    await saveFact('conversation_summary', raw);
    await saveFact('last_summary_at', new Date().toISOString());
    console.log('✅ Ringkasan tersimpan');
  } catch (err) {
    // silent fail
  }
}

// ═══════════════════════════════════════════
// 2. MOOD TRACKER
// Deteksi mood pakai keyword — tidak pakai API call
// ═══════════════════════════════════════════
const MOOD_KEYWORDS = {
  happy:    ['haha', 'wkwk', 'senang', 'seru', 'asik', 'gembira', 'bahagia', 'semangat', '😄', '😊'],
  sad:      ['sedih', 'nangis', 'galau', 'hancur', 'kecewa', 'down', 'mellow', '😢', '😭'],
  tired:    ['capek', 'lelah', 'ngantuk', 'exhausted', 'males', 'gabut', 'bosen'],
  stressed: ['stress', 'panik', 'pusing', 'overwhelmed', 'deadline', 'tugas', 'ujian', 'banyak banget'],
  angry:    ['kesel', 'marah', 'bete', 'nyebelin', 'annoying', 'sebel'],
};

async function detectAndSaveMood(userMessage) {
  try {
    const msg = userMessage.toLowerCase();
    let detectedMood = 'neutral';

    for (const [mood, keywords] of Object.entries(MOOD_KEYWORDS)) {
      if (keywords.some(kw => msg.includes(kw))) {
        detectedMood = mood;
        break;
      }
    }

    await saveFact('current_mood', detectedMood);

    const moodCount = parseInt(await getFactByKey(`mood_${detectedMood}`) || '0');
    await saveFact(`mood_${detectedMood}`, String(moodCount + 1));

    const counts = await Promise.all(
      Object.keys(MOOD_KEYWORDS).map(async m => ({
        mood: m,
        count: parseInt(await getFactByKey(`mood_${m}`) || '0')
      }))
    );
    const dominant = counts.sort((a, b) => b.count - a.count)[0];
    await saveFact('dominant_mood', dominant.mood);

    if (detectedMood !== 'neutral') {
      console.log(`😶 Mood terdeteksi: ${detectedMood}`);
    }

    return detectedMood;
  } catch (err) {
    return 'neutral';
  }
}

// ═══════════════════════════════════════════
// 3. TOPIC MEMORY
// FIX: Pakai keyword matching — tidak pakai API call sama sekali
// Sebelumnya ini manggil callGroqMini tiap pesan = 1 request ekstra
// per chat yang langsung menghabiskan Groq quota
// ═══════════════════════════════════════════
const TOPIC_KEYWORDS = {
  kuliah:   ['kuliah', 'kampus', 'tugas', 'ujian', 'skripsi', 'dosen', 'semester', 'ipk', 'kelas'],
  kerjaan:  ['kerja', 'kantor', 'bos', 'gaji', 'lembur', 'meeting', 'deadline', 'project', 'resign'],
  keluarga: ['mama', 'papa', 'kakak', 'adik', 'ortu', 'keluarga', 'rumah', 'bokap', 'nyokap'],
  game:     ['game', 'main', 'push rank', 'ml', 'ff', 'valorant', 'minecraft', 'steam', 'gaming'],
  makanan:  ['makan', 'lapar', 'masak', 'resto', 'bakso', 'mie', 'nasi', 'jajan', 'boba', 'kopi'],
  kesehatan:['sakit', 'demam', 'pusing', 'dokter', 'obat', 'istirahat', 'tidur', 'cape'],
  perasaan: ['kangen', 'rindu', 'sayang', 'cinta', 'galau', 'suka', 'baper', 'sedih', 'senang'],
  hiburan:  ['nonton', 'film', 'series', 'drakor', 'netflix', 'youtube', 'musik', 'lagu', 'konser'],
};

async function trackTopic(userMessage) {
  try {
    const msg = userMessage.toLowerCase();
    let detectedTopic = null;

    for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
      if (keywords.some(kw => msg.includes(kw))) {
        detectedTopic = topic;
        break;
      }
    }

    if (!detectedTopic) return;

    await saveFact('last_topic', detectedTopic);

    const topicKey = `topic_${detectedTopic}`;
    const count = parseInt(await getFactByKey(topicKey) || '0');
    await saveFact(topicKey, String(count + 1));

    console.log(`📌 Topik: ${detectedTopic}`);
  } catch (err) {
    // silent fail
  }
}

// ── Build context string untuk diinject ke prompt ──
async function buildIntelligenceContext() {
  try {
    const parts = [];

    const summary = await getFactByKey('conversation_summary');
    if (summary) parts.push(`Ringkasan percakapan sebelumnya: ${summary}`);

    const currentMood = await getFactByKey('current_mood');
    if (currentMood && currentMood !== 'neutral') {
      parts.push(`Mood user sekarang: ${currentMood}`);
    }

    const dominantMood = await getFactByKey('dominant_mood');
    if (dominantMood && dominantMood !== 'neutral') {
      parts.push(`Mood dominan: ${dominantMood}`);
    }

    const lastTopic = await getFactByKey('last_topic');
    if (lastTopic) parts.push(`Topik terakhir: ${lastTopic}`);

    return parts.length > 0 ? parts.join('\n') : '';
  } catch (err) {
    return '';
  }
}

module.exports = {
  maybeSummarizeConversation,
  detectAndSaveMood,
  trackTopic,
  buildIntelligenceContext,
};