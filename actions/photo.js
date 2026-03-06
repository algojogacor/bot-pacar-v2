// actions/photo.js
// Fitur: generate & kirim "selfie" Jihan pakai Pollinations AI (gratis, no API key)
//
// Flow: prompt → Pollinations API → image buffer → WA image message

const axios = require('axios');

// ── Daftar skenario foto yang Jihan bisa kirim ──
// Setiap kategori punya prompt visual yang konsisten dengan persona Jihan
const PHOTO_SCENARIOS = {
  selfie: [
    'selfie cute indonesian girl hijab casual outfit bedroom aesthetic, natural lighting, mirror selfie, candid, soft smile',
    'selfie cute indonesian girl hijab lying on bed phone camera angle, cozy room, warm lighting, candid natural',
    'selfie cute indonesian girl hijab cafe background, aesthetic coffee shop, natural pose, genuine smile',
    'cute indonesian girl hijab selfie at home, relaxed casual, soft lighting, genuine expression',
  ],
  aktivitas: [
    'cute indonesian girl hijab eating food with chopsticks, restaurant, happy expression, candid photo',
    'cute indonesian girl hijab reading book, cozy bedroom, soft aesthetic lighting, warm tones',
    'cute indonesian girl hijab watching laptop screen, dim room, cozy setup, candid',
    'cute indonesian girl hijab cooking in kitchen, apron, happy candid moment',
  ],
  malam: [
    'cute indonesian girl hijab nighttime bedroom selfie, lamp lighting, cozy pajamas, soft warm glow',
    'cute indonesian girl hijab lying on pillow night, sleepy expression, dim warm lighting, candid',
    'cute indonesian girl hijab late night phone selfie, tired but smiling, cozy blanket',
  ],
  lucu: [
    'cute indonesian girl hijab making funny face selfie, bedroom, playful expression',
    'cute indonesian girl hijab pouting selfie, cute expression, natural lighting',
    'cute indonesian girl hijab peace sign selfie, cheerful candid, natural look',
  ],
};

// ── Pilih skenario berdasarkan jam ──
function getScenarioByTime() {
  const jam = (new Date().getUTCHours() + 7) % 24;
  if (jam >= 21 || jam < 6) return 'malam';
  if (jam >= 6 && jam < 12)  return Math.random() < 0.5 ? 'selfie' : 'lucu';
  if (jam >= 12 && jam < 17) return Math.random() < 0.5 ? 'aktivitas' : 'selfie';
  return Math.random() < 0.4 ? 'lucu' : 'selfie';
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Generate gambar via Pollinations AI ──
async function generatePhoto(category = null) {
  const scenario = category || getScenarioByTime();
  const scenarios = PHOTO_SCENARIOS[scenario] || PHOTO_SCENARIOS.selfie;
  const basePrompt = pick(scenarios);

  // Tambahkan style modifier untuk konsistensi
  const fullPrompt = `${basePrompt}, realistic, high quality, instagram style photo, not AI generated looking, 4k`;
  const negativePrompt = 'ugly, deformed, cartoon, anime, painting, drawing, blurry';

  const encodedPrompt = encodeURIComponent(fullPrompt);
  const encodedNeg    = encodeURIComponent(negativePrompt);
  const seed          = Math.floor(Math.random() * 99999);

  // Pollinations — gratis, no API key
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?negative=${encodedNeg}&seed=${seed}&width=512&height=768&nologo=true&enhance=true`;

  console.log(`📸 Generate foto (${scenario})...`);

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 45000,
  });

  return {
    buffer: Buffer.from(response.data),
    scenario,
  };
}

// ── Caption natural sesuai skenario ──
const CAPTIONS = {
  selfie: [
    null,                           // kadang tanpa caption
    'hehe',
    'bosen nih',
    'iseng foto',
    null,
  ],
  aktivitas: [
    null,
    'lagi makan nih',
    'baca bentar',
    null,
    'seru juga',
  ],
  malam: [
    'mau tidur nih',
    null,
    'ngantuk',
    'udah malem',
    null,
  ],
  lucu: [
    'hahaha',
    'jangan ketawa',
    null,
    'iseng',
  ],
};

// ── Kirim foto ke WA ──
async function sendPhoto(sock, jid, category = null) {
  try {
    const { buffer, scenario } = await generatePhoto(category);

    const captions = CAPTIONS[scenario] || CAPTIONS.selfie;
    const caption  = pick(captions);

    const msgPayload = { image: buffer };
    if (caption) msgPayload.caption = caption;

    await sock.sendMessage(jid, msgPayload);
    console.log(`📸 Foto terkirim → ${jid} (${scenario}, caption: "${caption || '-'}")`);
    return true;
  } catch (err) {
    console.error('❌ Gagal kirim foto:', err.message);
    return false;
  }
}

// ── Kirim foto proaktif (kadang-kadang saja) ──
// Dipanggil dari proactive.js dengan 15% chance
async function maybeSendPhoto(sock, jid) {
  if (Math.random() > 0.15) return false;
  return await sendPhoto(sock, jid);
}

module.exports = { sendPhoto, maybeSendPhoto, generatePhoto };
