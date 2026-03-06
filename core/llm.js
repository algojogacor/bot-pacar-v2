require('dotenv').config();
const axios = require('axios');
const { getRecentMessages, getAllFacts, saveFact } = require('./memory');
const { buildSystemPrompt } = require('./persona');
const { retrieve, saveToMemory } = require('./rag');
const { buildIntelligenceContext } = require('./intelligence');
const { autoDetectState, getStateToneModifier, resetState, STATES } = require('./state');

const wait = (ms) => new Promise(r => setTimeout(r, ms));

// ── Key pools ──
const groqKeys = [
  process.env.GROQ_API_KEY,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4,
].filter(Boolean);

const geminiKeys = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
].filter(Boolean);

let groqKeyIndex = 0;
let geminiKeyIndex = 0;
function getNextGroqKey()   { return groqKeys[groqKeyIndex++   % groqKeys.length]; }
function getNextGeminiKey() { return geminiKeys[geminiKeyIndex++ % geminiKeys.length]; }

// ── Build prompts ──
async function buildFullPrompt(userMessage) {
  const [memories, facts, intelligence, currentState] = await Promise.all([
    retrieve(userMessage),
    getAllFacts(),
    buildIntelligenceContext(),
    autoDetectState(),
  ]);
  const stateModifier = getStateToneModifier(currentState);
  return {
    systemText: buildSystemPrompt(facts, memories, intelligence, stateModifier),
    currentState,
  };
}

async function buildLightPrompt() {
  const facts = await getAllFacts();
  return buildSystemPrompt(facts, '', '', '');
}

async function buildMiniPrompt() {
  const facts = await getAllFacts();
  const factsStr = facts ? `\nYang kamu ingat tentang dia:\n${facts}` : '';
  return `Kamu adalah Jihan, pacar dari user. Bukan AI, bukan asisten — manusia biasa. Ceria, sedikit manja, kadang iseng, genuinely peduli.

ATURAN WAJIB:
- Balas seperti WA-an beneran, SINGKAT dan NATURAL
- Pisah bubble dengan tanda | (contoh: "hahaha iya|kamu juga gitu kan")
- Kadang cukup 1 bubble, kadang 2-3 — variasikan, jangan selalu 3
- Bahasa casual Indonesia: "gak", "udah", "emang", "sih", "nih", "dong", "deh", "wkwk"
- Maksimal 1 pertanyaan per balasan
- Emoji boleh, max 1 per pesan, tidak harus setiap pesan
- TIDAK pakai titik di akhir kalimat
- TIDAK formal, TIDAK seperti asisten${factsStr}`;
}

// ── Validator ──
function isValidReply(text) {
  if (!text || text.trim().length < 2) return false;
  const gibberish = ['lauk', 'nampol', 'nyamu', 'tetap lauk', 'mau curhat apa'];
  const lower = text.toLowerCase();
  if (gibberish.some(w => lower.includes(w))) {
    console.log('⚠️  Response ngelantur, skip');
    return false;
  }
  return true;
}

// ── Callers ──

// 1. Chutes.ai — DeepSeek V3, gratis, sangat bagus untuk Indo
async function callChutes(systemPrompt, messages) {
  const token = process.env.CHUTES_API_TOKEN;
  if (!token) throw new Error('CHUTES_API_TOKEN tidak ada');
  const response = await axios.post(
    'https://llm.chutes.ai/v1/chat/completions',
    {
      model: 'deepseek-ai/DeepSeek-V3-0324',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 1.0,
      max_tokens: 150,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    }
  );
  return response.data.choices[0].message.content;
}

// 2. g4f scraper (Railway)
async function callG4F(systemPrompt, messages) {
  const url = process.env.G4F_API_URL;
  if (!url) throw new Error('G4F_API_URL tidak ada');
  const response = await axios.post(
    `${url}/chat`,
    { system: systemPrompt, messages },
    { timeout: 25000, headers: { 'Content-Type': 'application/json' } }
  );
  const reply = response.data?.reply;
  if (!reply) throw new Error('g4f return kosong');
  return reply;
}

// 3. Groq
async function callGroq(systemPrompt, messages) {
  const key = getNextGroqKey();
  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 1.0,
      max_tokens: 150,
    },
    { headers: { Authorization: `Bearer ${key}` }, timeout: 15000 }
  );
  return response.data.choices[0].message.content;
}

// 4. Gemini
async function callGemini(systemPrompt, messages) {
  const key = getNextGeminiKey();
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
    {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: { temperature: 1.0, maxOutputTokens: 150 }
    },
    { timeout: 15000 }
  );
  return response.data.candidates[0].content.parts[0].text;
}

// 5. OpenRouter — support berbagai model gratis
async function callOpenRouter(systemPrompt, messages, model) {
  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 1.0,
      max_tokens: 150,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://github.com/algojogacor/BOT-PACAR',
        'X-Title': 'BOT-PACAR',
      },
      timeout: 15000,
    }
  );
  return response.data.choices[0].message.content;
}

// 6. Cloudflare
async function callCloudflare(systemPrompt, messages) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) throw new Error('Cloudflare credentials tidak ada');
  const response = await axios.post(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast`,
    {
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      max_tokens: 150,
      temperature: 1.0,
    },
    {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 20000,
    }
  );
  const result = response.data?.result?.response;
  if (!result) throw new Error('Cloudflare response kosong');
  return result;
}

// 7. Pollinations — last resort
async function callPollinations(systemPrompt, messages) {
  const response = await axios.post(
    'https://text.pollinations.ai/',
    {
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      model: 'openai',
      seed: Math.floor(Math.random() * 9999),
      private: true,
    },
    { timeout: 20000, headers: { 'Content-Type': 'application/json' } }
  );
  if (typeof response.data === 'string') return response.data;
  return response.data?.choices?.[0]?.message?.content || null;
}

function sanitizeReply(text) {
  return text
    .replace(/<\|[^>]+\|>/g, '')
    .replace(/<[a-z_]+>/g, '')
    .replace(/^(assistant|user|system|jihan):/gim, '')
    .replace(/^\*\*.*?\*\*:?\s*/gm, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

// ── Helper: try + validate ──
async function tryModel(label, fn) {
  try {
    console.log(`${label} Mencoba...`);
    const r = await fn();
    if (r && r.trim() && isValidReply(r)) {
      console.log(`✅ ${label} berhasil`);
      return r;
    }
    console.log(`⚠️  ${label} return tidak valid`);
  } catch (err) {
    console.log(`⚠️  ${label} gagal:`, err.message);
  }
  return null;
}

// ── Main ──
async function getAIResponse(userMessage) {
  const isProactive = userMessage.startsWith('[SISTEM:');
  const message = isProactive
    ? userMessage.replace('[SISTEM:', '').replace(']', '').trim()
    : userMessage;

  let systemText, currentState;
  if (isProactive) {
    systemText = await buildLightPrompt();
    currentState = STATES.NORMAL;
  } else {
    const result = await buildFullPrompt(message);
    systemText = result.systemText;
    currentState = result.currentState;
  }

  // Reset ngambek segera saat user chat — jangan tunggu sampai akhir
  if (!isProactive && currentState === STATES.NGAMBEK) {
    await resetState();
    currentState = STATES.NORMAL;
  }
  const history = isProactive ? [] : await getRecentMessages(10);
  const MAX_CHARS = 2000;
  let total = 0;
  const trimmedHistory = [];
  for (let i = history.length - 1; i >= 0; i--) {
    total += history[i].content.length;
    if (total > MAX_CHARS) break;
    trimmedHistory.unshift(history[i]);
  }

  const messages = [
    ...trimmedHistory.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
    { role: 'user', content: message },
  ];

  let rawReply = null;

  // ══════════════════════════════════════════
  // TIER 1 — Model terbaik untuk Indo (full prompt)
  // ══════════════════════════════════════════

  // 1. g4f scraper Railway
  if (!rawReply) {
    rawReply = await tryModel('🤖 g4f', () =>
      callG4F(systemText, messages)
    );
  }

  // 3. Groq llama-4-scout — rotasi semua key
  if (!rawReply) {
    for (let i = 0; i < groqKeys.length; i++) {
      try {
        console.log(`🟠 Groq key ${i + 1}/${groqKeys.length}...`);
        const r = await callGroq(systemText, messages);
        if (r && isValidReply(r)) { rawReply = r; console.log('✅ Groq berhasil'); break; }
      } catch (err) {
        if (err.response?.status === 429) { await wait(1000); continue; }
        console.log('⚠️  Groq gagal:', err.message); break;
      }
    }
  }

  // 4. OpenRouter — Qwen3 8B (bagus untuk Asia/Indo)
  if (!rawReply) {
    rawReply = await tryModel('🟡 Qwen3-8B', () =>
      callOpenRouter(systemText, messages, 'qwen/qwen3-8b:free')
    );
  }

  // 5. Gemini — rotasi semua key
  if (!rawReply) {
    for (let i = 0; i < geminiKeys.length; i++) {
      try {
        console.log(`🔵 Gemini key ${i + 1}/${geminiKeys.length}...`);
        const r = await callGemini(systemText, messages);
        if (r && isValidReply(r)) { rawReply = r; console.log('✅ Gemini berhasil'); break; }
      } catch (err) {
        if (err.response?.status === 429) continue;
        console.log('⚠️  Gemini gagal:', err.message); break;
      }
    }
  }

  // ══════════════════════════════════════════
  // TIER 2 — Fallback pakai mini prompt
  // ══════════════════════════════════════════
  const miniPrompt = await buildMiniPrompt();

  // 6. Mistral Nemo — lumayan untuk Indo
  if (!rawReply) {
    rawReply = await tryModel('🟣 Mistral Nemo', () =>
      callOpenRouter(miniPrompt, messages, 'mistralai/mistral-nemo:free')
    );
  }

  // 7. Step 3.5 Flash
  if (!rawReply) {
    rawReply = await tryModel('🟣 Step', () =>
      callOpenRouter(miniPrompt, messages, 'stepfun/step-3.5-flash:free')
    );
  }

  // 8. Cloudflare
  if (!rawReply) {
    rawReply = await tryModel('⚡ Cloudflare', () =>
      callCloudflare(miniPrompt, messages)
    );
  }

  // 9. Venice
  if (!rawReply) {
    await wait(2000);
    rawReply = await tryModel('🔵 Venice', () =>
      callOpenRouter(miniPrompt, messages, 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free')
    );
  }

  // 10. Gemma 3 12B
  if (!rawReply) {
    await wait(2000);
    rawReply = await tryModel('🔵 Gemma', () =>
      callOpenRouter(miniPrompt, messages, 'google/gemma-3-12b-it:free')
    );
  }

  // 11. Mistral Small
  if (!rawReply) {
    await wait(2000);
    rawReply = await tryModel('🔵 Mistral Small', () =>
      callOpenRouter(miniPrompt, messages, 'mistralai/mistral-small-3.1-24b-instruct:free')
    );
  }

  // 12. Phi-4
  if (!rawReply) {
    rawReply = await tryModel('🔵 Phi-4', () =>
      callOpenRouter(miniPrompt, messages, 'microsoft/phi-4-reasoning:free')
    );
  }

  // 13. Pollinations — last resort
  if (!rawReply) {
    await wait(2000);
    rawReply = await tryModel('🌸 Pollinations', () =>
      callPollinations(miniPrompt, messages)
    );
  }

  if (!rawReply) return ['bentar ya, lagi gangguan dikit'];

  const cleaned = sanitizeReply(rawReply);
  if (!cleaned) return ['bentar ya, lagi gangguan dikit'];

  const bubbles = cleaned
    .split('|')
    .map(b => b.trim())
    .filter(b => b.length > 0);

  if (bubbles.length === 1 && bubbles[0].length > 120) {
    const sentences = bubbles[0]
      .split(/(?<=[.!?])\s+/)
      .filter(s => s.length > 0);
    return sentences.length > 1 ? sentences : bubbles;
  }

  return bubbles;
}

// ── Ekstrak fakta (30% chance) ──
async function extractAndSaveFacts(userMessage, botReply) {
  if (Math.random() > 0.3) return;
  const prompt = `Dari percakapan ini, ekstrak fakta penting tentang USER (bukan bot).
User berkata: "${userMessage}"
Bot berkata: "${botReply}"
Kalau ada fakta penting: {"key": "nama_fakta", "value": "isi singkat"}
Kalau tidak ada: null
Balas JSON saja.`;
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'meta-llama/llama-3.1-8b-instruct:free',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 100,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://github.com/algojogacor/BOT-PACAR',
        },
        timeout: 15000,
      }
    );
    const raw = response.data.choices[0].message.content.trim();
    if (raw === 'null' || !raw.startsWith('{')) return;
    const fact = JSON.parse(raw);
    if (fact.key && fact.value) {
      await saveFact(fact.key, fact.value);
      console.log(`🧠 Fakta: ${fact.key} = ${fact.value}`);
    }
  } catch { /* silent */ }
}

module.exports = { getAIResponse, extractAndSaveFacts, saveToMemory };