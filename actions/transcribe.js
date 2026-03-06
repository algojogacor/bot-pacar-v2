// actions/transcribe.js
// Fitur: baca voice note masuk dari user → transkripsi pakai Groq Whisper
//
// Flow: voice note (ogg) → download → Groq Whisper API → text

const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const FormData = require('form-data');

const TMP_DIR = path.join(__dirname, '../data/tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ── Cek apakah pesan adalah voice note / audio ──
function isVoiceNote(msg) {
  const m = msg.message;
  if (!m) return false;
  return !!(
    m.audioMessage?.ptt === true ||   // voice note
    m.audioMessage                     // audio biasa
  );
}

// ── Download & transkripsi voice note ──
async function transcribeVoiceNote(sock, msg) {
  const groqKeys = [
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
    process.env.GROQ_API_KEY_4,
  ].filter(Boolean);

  if (groqKeys.length === 0) {
    console.log('⚠️  Tidak ada GROQ_API_KEY — transkripsi skip');
    return null;
  }

  const tmpPath = path.join(TMP_DIR, `voice_in_${Date.now()}.ogg`);

  try {
    console.log('🎧 Download voice note...');

    // Download audio dari WA
    const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
      logger: { info: () => {}, error: () => {}, warn: () => {} },
      reuploadRequest: sock.updateMediaMessage,
    });

    fs.writeFileSync(tmpPath, buffer);
    console.log(`📥 Voice note tersimpan (${buffer.length} bytes)`);

    // Kirim ke Groq Whisper
    const formData = new FormData();
    formData.append('file', fs.createReadStream(tmpPath), {
      filename: 'voice.ogg',
      contentType: 'audio/ogg',
    });
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('language', 'id'); // Bahasa Indonesia
    formData.append('response_format', 'text');

    // Rotasi key
    const key = groqKeys[Math.floor(Math.random() * groqKeys.length)];

    const response = await axios.post(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      formData,
      {
        headers: {
          Authorization: `Bearer ${key}`,
          ...formData.getHeaders(),
        },
        timeout: 30000,
      }
    );

    const transcript = typeof response.data === 'string'
      ? response.data.trim()
      : response.data?.text?.trim();

    console.log(`📝 Transkripsi: "${transcript}"`);
    return transcript || null;

  } catch (err) {
    console.error('❌ Gagal transkripsi:', err.message);
    return null;
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

module.exports = { isVoiceNote, transcribeVoiceNote };
