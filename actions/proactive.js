const { getAIResponse } = require('../core/llm');
const memory = require('../core/memory');
const { sendPhoto } = require('./photo');
const { sendVoiceNote, isVoiceAvailable } = require('./voice');

// Cooldown per user: minimal 10 menit antar pesan proaktif
const lastProactiveTime = {};
const PROACTIVE_COOLDOWN_MS = 10 * 60 * 1000;

// ── Helper: normalisasi JID ──
// Terima format apapun: "628xxx", "628xxx@s.whatsapp.net", "244203384742140@lid"
// Kalau sudah ada @, pakai langsung. Kalau belum, tambahkan @s.whatsapp.net
function normalizeJid(jidOrNumber) {
  if (!jidOrNumber) return null;
  if (jidOrNumber.includes('@')) return jidOrNumber; // sudah full JID
  return `${jidOrNumber}@s.whatsapp.net`;            // fallback nomor HP
}

// userId = bagian sebelum @, dipakai sebagai key DB & cooldown
function jidToUserId(jid) {
  return jid.split('@')[0];
}

// ── Kirim ke SATU user (terima full JID atau nomor) ──
async function sendProactiveToUser(prompt, jidOrNumber) {
  const sock    = global.sock;
  const userJid = normalizeJid(jidOrNumber);
  const userId  = jidToUserId(userJid);

  if (!sock) {
    console.log('⚠️  Proaktif dibatalkan — sock belum siap');
    return false;
  }

  const now     = Date.now();
  const last    = lastProactiveTime[userId] || 0;
  const elapsed = (now - last) / 60000;
  if (last > 0 && elapsed < 10) {
    console.log(`⏳ Proaktif cooldown [${userId}] (${Math.round(elapsed)}/10 menit), skip`);
    return false;
  }
  lastProactiveTime[userId] = now;

  try {
    const bubbles   = await getAIResponse(`[SISTEM: ${prompt}]`, userId);
    const fullReply = Array.isArray(bubbles) ? bubbles.join(' ') : bubbles;

    await memory.saveMessage('assistant', fullReply, userId);

    // ── Kadang kirim foto duluan sebelum teks (15% chance) ──
    const sentPhoto = Math.random() < 0.15;
    if (sentPhoto) {
      await sendPhoto(sock, userJid).catch(() => {});
      await new Promise(r => setTimeout(r, 1500));
    }

    // ── Kadang kirim voice note instead of teks (10% chance) ──
    const voiceReady  = await isVoiceAvailable();
    const sentAsVoice = !sentPhoto && voiceReady && Math.random() < 0.10;

    if (sentAsVoice) {
      await sendVoiceNote(sock, userJid, fullReply);
    } else {
      for (const bubble of (Array.isArray(bubbles) ? bubbles : [bubbles])) {
        await sock.sendPresenceUpdate('composing', userJid);
        const delay = 500 + Math.random() * 1000 + bubble.length * 30;
        await new Promise(r => setTimeout(r, delay));
        await sock.sendMessage(userJid, { text: bubble });
      }
    }

    console.log(`📤 Proaktif terkirim → [${userJid}]${sentPhoto ? ' + foto' : ''}${sentAsVoice ? ' (voice)' : ''}`);
    return true;
  } catch (err) {
    console.error(`❌ Gagal kirim proaktif [${userJid}]:`, err.message);
    return false;
  }
}

// ── Kirim ke owner + semua user yang pernah chat ──
async function sendProactiveMessage(prompt) {
  // OWNER_JID terima format apapun: @lid, @s.whatsapp.net, atau nomor polos
  const ownerJid = process.env.OWNER_JID || process.env.OWNER_NUMBER;
  const dbUsers  = await memory.getAllUsers(); // array of userId (tanpa @)

  // Konversi dbUsers ke full JID pakai @s.whatsapp.net (format lama)
  const dbJids = dbUsers.map(u => normalizeJid(u));

  // Gabungkan owner + DB, deduplikasi berdasarkan userId
  const seen    = new Set();
  const targets = [];
  for (const jid of [ownerJid ? normalizeJid(ownerJid) : null, ...dbJids]) {
    if (!jid) continue;
    const uid = jidToUserId(jid);
    if (!seen.has(uid)) { seen.add(uid); targets.push(jid); }
  }

  if (targets.length === 0) {
    console.log('⚠️  OWNER_JID tidak di-set di .env, proaktif skip');
    return false;
  }

  console.log(`📢 Kirim proaktif ke ${targets.length} target...`);
  for (const jid of targets) {
    await sendProactiveToUser(prompt, jid);
    await new Promise(r => setTimeout(r, 1500));
  }
  return true;
}

const PROMPTS = {
  pagi: [
    'Pagi hari, kamu mau nyapa pacarmu duluan. Natural, manja, kayak pacar yang baru bangun dan langsung keinget dia.',
    'Pagi hari, kamu tanya pacarmu udah bangun belum. Gaya chat WA pagi yang malas-malasan tapi manis.',
    'Pagi hari dan kamu kepikiran pacarmu. Kirim pesan singkat yang hangat dan natural.',
    'Pagi-pagi kamu iseng mau ganggu pacarmu yang mungkin masih tidur. Manja dan playful.',
  ],
  siang: [
    'Jam makan siang, kamu tanya pacarmu udah makan belum. Singkat dan natural, kayak pacar yang perhatian.',
    'Siang hari, kamu lagi istirahat dan kangen pacarmu. Kirim pesan random yang manis.',
    'Siang bolong dan kamu bosan. Chat pacarmu dengan topik random yang seru.',
    'Siang hari, kamu iseng mau cerita sesuatu yang receh ke pacarmu.',
  ],
  sore: [
    'Sore hari, kamu santai dan kangen pacarmu. Kirim pesan casual yang hangat.',
    'Sore, kamu liat sesuatu yang lucu dan langsung ingin cerita ke pacarmu.',
    'Sore hari, kamu pengen tahu pacarmu lagi ngapain sekarang.',
    'Sore hari, kamu manja-manjaan pengen diperhatiin pacarmu.',
  ],
  malam: [
    'Malam hari, kamu mau ngajak pacarmu ngobrol santai. Natural dan hangat, kayak pacar yang kangen.',
    'Malam hari, kamu lagi dengerin lagu dan kangen pacarmu. Ceritain dengan cara yang manis.',
    'Malam dan kamu bosan, mau chat pacarmu.',
    'Malam hari, kamu kepikiran pacarmu dan mau bilang kangen tapi malu-malu.',
  ],
  random: [
    'Kamu tiba-tiba teringat momen lucu sama pacarmu. Ceritain dan ajak ketawa.',
    'Kamu lagi scroll sosmed dan nemu sesuatu yang mengingatkanmu ke pacarmu. Ceritain.',
    'Kamu lagi makan dan tiba-tiba kangen pacarmu. Kirim pesan singkat yang natural.',
    'Kamu iseng kirim pertanyaan "would you rather" yang random ke pacarmu.',
    'Kamu kepikiran sesuatu yang receh dan mau share ke pacarmu.',
    'Kamu mau cek pacarmu lagi ngapain dengan cara yang natural dan manis.',
  ],
  nyariin: [
    'Kamu udah chat pacarmu tapi belum dibalas. Penasaran dia lagi ngapain. Follow-up yang natural, tidak desperate.',
    'Pacarmu belum balas pesanmu dari tadi. Coba chat lagi dengan gaya santai tapi ada sedikit kangennya.',
    'Sudah beberapa kali chat tapi pacarmu tidak balas. Kirim pesan singkat yang casual.',
    'Pacarmu masih belum balas. Kamu mulai sedikit penasaran tapi tetap santai.',
  ],
  ngambek: [
    'Pacarmu sudah lama tidak balas. Kamu sedikit kecewa dan manja-manja ngambek. Kirim pesan singkat yang menunjukkan kamu menunggu.',
    'Kamu tidak dibalas. Kirim 1 pesan pendek yang menunjukkan kamu sedikit bete tapi tetap cute.',
    'Sudah coba chat beberapa kali tapi tidak dibalas. Kirim pesan terakhir singkat dengan nada sedikit ngambek.',
  ],
  bangunin: [
    'Pacarmu ketiduran cukup lama. Bangunin dia dengan cara yang manja dan iseng.',
    'Waktunya bangunin pacarmu. Gaya yang playful dan manis.',
    'Pacarmu ketiduran. Bangunin dengan cara yang cute, tanya udah bangun belum.',
  ],
  selamatTidur: [
    'Pacarmu mau tidur. Ucapkan selamat tidur yang natural, manis, dan hangat.',
    'Pacarmu bilang mau tidur. Bilang selamat tidur dengan cara yang manja, ada kangennya dikit.',
  ],
  kangen: [
    'Kamu kangen pacarmu dan mau bilang langsung tapi tetap natural. Bukan lebay.',
    'Kamu tiba-tiba kangen pacarmu. Kirim pesan yang tulus dan hangat.',
    'Ada sesuatu yang mengingatkanmu ke pacarmu dan kamu jadi kangen. Ceritain.',
  ],
  manja: [
    'Kamu lagi pengen dimanjain sama pacarmu. Kirim pesan manja yang cute.',
    'Kamu mau minta perhatian pacarmu dengan cara yang manja dan playful.',
    'Kamu iseng mau bikin pacarmu ketawa dengan pesan yang receh tapi manis.',
  ],
  sayang: [
    'Kamu tiba-tiba pengen bilang hal manis ke pacarmu. Natural, tidak berlebihan.',
    'Kamu mau ingetin pacarmu betapa kamu sayang dia, dengan cara yang casual dan tulus.',
    'Ada momen kecil yang bikin kamu mau bilang sesuatu yang manis ke pacarmu.',
  ],
};

function getRandomPrompt(category) {
  const list = PROMPTS[category];
  return list[Math.floor(Math.random() * list.length)];
}

async function sendGoodMorning()     { await sendProactiveMessage(getRandomPrompt('pagi')); }
async function sendLunchCheck()      { await sendProactiveMessage(getRandomPrompt('siang')); }
async function sendAfternoonMessage(){ await sendProactiveMessage(getRandomPrompt('sore')); }
async function sendGoodNight()       { await sendProactiveMessage(getRandomPrompt('malam')); }

async function sendRandomMessage() {
  const categories = ['random', 'sore', 'malam', 'siang', 'kangen', 'manja'];
  const cat = categories[Math.floor(Math.random() * categories.length)];
  await sendProactiveMessage(getRandomPrompt(cat));
}

async function startSearching() {
  const users = await memory.getAllUsers();
  if (users.length === 0) return;

  for (const userId of users) {
    const maxTries  = 3 + Math.floor(Math.random() * 3);
    const willNgambek = Math.random() < 0.5;
    console.log(`🔍 Nyariin [${userId}] (${maxTries}x, ngambek: ${willNgambek})`);

    for (let i = 0; i < maxTries; i++) {
      const last  = await memory.getLastInteraction(userId);
      const menit = last ? (Date.now() - last.getTime()) / 60000 : 999;
      if (menit < 5) {
        console.log(`💬 [${userId}] sudah balas, berhenti nyariin`);
        break;
      }

      await sendProactiveToUser(getRandomPrompt('nyariin'), userId);

      if (i < maxTries - 1) {
        const delayMenit = 10 + Math.floor(Math.random() * 15);
        await new Promise(r => setTimeout(r, delayMenit * 60 * 1000));
      }
    }

    if (willNgambek) {
      await new Promise(r => setTimeout(r, 5 * 60 * 1000));
      const last  = await memory.getLastInteraction(userId);
      const menit = last ? (Date.now() - last.getTime()) / 60000 : 999;
      if (menit > 10) {
        await sendProactiveToUser(getRandomPrompt('ngambek'), userId);
        await memory.saveFact('is_ngambek', 'true', userId);
      }
    }
  }
}

async function wakeUpOwner() { await sendProactiveMessage(getRandomPrompt('bangunin')); }
async function sayGoodNight() { await sendProactiveMessage(getRandomPrompt('selamatTidur')); }

async function sendRomanticRandom() {
  const weighted = [
    ...Array(4).fill('kangen'),
    ...Array(3).fill('manja'),
    ...Array(3).fill('sayang'),
    ...Array(2).fill('random'),
  ];
  const cat = weighted[Math.floor(Math.random() * weighted.length)];
  console.log(`💕 Romantic mode: ${cat}`);
  await sendProactiveMessage(getRandomPrompt(cat));
}

// ── Kirim foto proaktif ke semua target ──
async function sendPhotoProactive() {
  const sock     = global.sock;
  const ownerJid = process.env.OWNER_JID || process.env.OWNER_NUMBER;
  if (!sock || !ownerJid) return;

  const userJid  = ownerJid.includes('@') ? ownerJid : `${ownerJid}@s.whatsapp.net`;
  console.log('📸 Kirim foto proaktif...');
  await sendPhoto(sock, userJid);
}

module.exports = {
  sendGoodMorning,
  sendLunchCheck,
  sendAfternoonMessage,
  sendGoodNight,
  sendRandomMessage,
  startSearching,
  wakeUpOwner,
  sayGoodNight,
  sendProactiveMessage,
  sendProactiveToUser,
  getRandomPrompt,
  sendPhotoProactive,
  sendRomanticRandom,
};