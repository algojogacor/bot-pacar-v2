// actions/voice.js
// Fitur: generate voice note pakai ElevenLabs → kirim sebagai PTT di WA
//
// Flow: text → ElevenLabs API (mp3) → ffmpeg convert (ogg opus) → WA PTT
// Butuh: ELEVENLABS_API_KEY di .env, ffmpeg terinstall (NIXPACKS_PKGS=ffmpeg)

const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// ── Konfigurasi suara Jihan ──
// Ganti VOICE_ID sesuai voice ElevenLabs yang kamu pilih
// List voice: https://api.elevenlabs.io/v1/voices
const VOICE_ID       = process.env.ELEVENLABS_VOICE_ID || 'Xb7hH8MSUJpSbSDYk0k2'; // Alice (default)
const ELEVENLABS_URL = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`;

const TMP_DIR = path.join(__dirname, '../data/tmp');

// Pastikan folder tmp ada
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ── Generate audio dari text ──
async function generateVoice(text) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY tidak ada di .env');

  // Bersihkan tanda | (bubble separator) dari teks
  const cleanText = text.replace(/\|/g, '. ').replace(/\s+/g, ' ').trim();

  const response = await axios.post(
    ELEVENLABS_URL,
    {
      text: cleanText,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.4,         // lebih natural, sedikit variasi
        similarity_boost: 0.75,
        style: 0.3,             // ekspresif
        use_speaker_boost: true,
      },
    },
    {
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      responseType: 'arraybuffer',
      timeout: 30000,
    }
  );

  return Buffer.from(response.data);
}

// ── Convert mp3 → ogg opus (format WA PTT) ──
async function convertToOgg(mp3Buffer) {
  const timestamp = Date.now();
  const mp3Path = path.join(TMP_DIR, `voice_${timestamp}.mp3`);
  const oggPath = path.join(TMP_DIR, `voice_${timestamp}.ogg`);

  try {
    fs.writeFileSync(mp3Path, mp3Buffer);

    // ffmpeg convert ke ogg opus — format yang WA minta untuk PTT
    await execAsync(
      `ffmpeg -i "${mp3Path}" -c:a libopus -b:a 64k -ar 48000 "${oggPath}" -y`
    );

    const oggBuffer = fs.readFileSync(oggPath);
    return oggBuffer;
  } finally {
    // Cleanup tmp files
    if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
    if (fs.existsSync(oggPath)) fs.unlinkSync(oggPath);
  }
}

// ── Kirim voice note ke WA ──
async function sendVoiceNote(sock, jid, text) {
  try {
    console.log('🎤 Generate voice note...');

    // Tampilkan indikator recording
    await sock.sendPresenceUpdate('recording', jid);

    const mp3Buffer = await generateVoice(text);
    const oggBuffer = await convertToOgg(mp3Buffer);

    // Delay natural sesuai panjang teks (simulasi recording)
    const recordingDelay = Math.min(1000 + text.length * 40, 5000);
    await new Promise(r => setTimeout(r, recordingDelay));

    await sock.sendMessage(jid, {
      audio: oggBuffer,
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true, // Push To Talk = voice note
    });

    console.log(`✅ Voice note terkirim → ${jid}`);
    return true;
  } catch (err) {
    console.error('❌ Gagal kirim voice note:', err.message);
    return false;
  }
}

// ── Cek apakah voice note tersedia (ada API key + ffmpeg) ──
async function isVoiceAvailable() {
  if (!process.env.ELEVENLABS_API_KEY) return false;
  try {
    await execAsync('ffmpeg -version');
    return true;
  } catch {
    console.warn('⚠️  ffmpeg tidak ditemukan — voice note dinonaktifkan');
    return false;
  }
}

// ── Kadang balas dengan voice note (20% chance) ──
async function maybeSendVoice(sock, jid, text) {
  if (Math.random() > 0.20) return false; // 20% chance
  const available = await isVoiceAvailable();
  if (!available) return false;
  return await sendVoiceNote(sock, jid, text);
}

module.exports = { sendVoiceNote, maybeSendVoice, isVoiceAvailable };
