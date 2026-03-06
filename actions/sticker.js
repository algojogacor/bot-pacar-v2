const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const axios = require('axios');

// Folder stiker
const STICKER_DIR = path.join(__dirname, '../data/stickers');
if (!fs.existsSync(STICKER_DIR)) fs.mkdirSync(STICKER_DIR, { recursive: true });

// Download stiker dari URL dan simpan lokal
async function downloadSticker(url, filename) {
  const dest = path.join(STICKER_DIR, filename);
  if (fs.existsSync(dest)) return dest; // sudah ada

  const response = await axios.get(url, { responseType: 'arraybuffer' });
  fs.writeFileSync(dest, response.data);
  return dest;
}

// Konversi gambar ke format webp (format stiker WA)
async function toWebp(inputPath) {
  const outputPath = inputPath.replace(/\.[^.]+$/, '.webp');
  if (fs.existsSync(outputPath)) return outputPath;

  await sharp(inputPath)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp()
    .toFile(outputPath);

  return outputPath;
}

// Kirim stiker dari file lokal
async function sendStickerFromFile(sock, jid, filePath) {
  const webpPath = await toWebp(filePath);
  const buffer = fs.readFileSync(webpPath);

  await sock.sendMessage(jid, {
    sticker: buffer
  });
}

// Koleksi stiker berdasarkan mood
const STICKER_PACKS = {
  kangen: [
    'https://i.imgur.com/kangen1.webp',
  ],
  ketawa: [
    'https://i.imgur.com/ketawa1.webp',
  ],
  manja: [
    'https://i.imgur.com/manja1.webp',
  ],
};

// Kirim stiker random berdasarkan mood — 
// kalau tidak ada stiker pack, skip saja
async function sendMoodSticker(sock, jid, mood = 'ketawa') {
  const pack = STICKER_PACKS[mood];
  if (!pack || pack.length === 0) return false;

  try {
    const url = pack[Math.floor(Math.random() * pack.length)];
    const filename = url.split('/').pop();
    const localPath = await downloadSticker(url, filename);
    await sendStickerFromFile(sock, jid, localPath);
    return true;
  } catch (err) {
    console.log('⚠️ Gagal kirim stiker:', err.message);
    return false;
  }
}

module.exports = { sendStickerFromFile, sendMoodSticker };