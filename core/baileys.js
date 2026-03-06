const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const path = require('path');
const { getAIResponse, extractAndSaveFacts } = require('./llm');
const { detectAndSaveMood, trackTopic, maybeSummarizeConversation } = require('./intelligence');
const { setState, STATES } = require('./state');
const memory = require('./memory');
const { sendVoiceNote, maybeSendVoice, isVoiceAvailable } = require('../actions/voice');
const { isVoiceNote, transcribeVoiceNote } = require('../actions/transcribe');
const { sendPhoto, maybeSendPhoto } = require('../actions/photo');

require('dotenv').config();

function typingDelay(text) {
  const base = text.length * 20;
  const random = Math.random() * 500;
  return Math.min(base + random, 2000);
}

async function sendBubbles(sock, from, reply) {
  const bubbles = Array.isArray(reply) ? reply : [reply];
  for (const bubble of bubbles) {
    await sock.sendPresenceUpdate('composing', from);
    const delay = bubble.length * 15 + Math.random() * 300;
    await new Promise(r => setTimeout(r, delay));
    await sock.sendMessage(from, { text: bubble });
  }
}

async function reactToMessage(sock, msg, emoji) {
  try {
    await sock.sendMessage(msg.key.remoteJid, {
      react: { text: emoji, key: msg.key }
    });
  } catch (err) {
    // silent fail
  }
}

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(
    path.join(__dirname, '../data/auth')
  );

  const { version } = await fetchLatestBaileysVersion();
  console.log(`📦 Menggunakan WA versi: ${version.join('.')}`);

  const sock = makeWASocket({
    version,
    auth: state,
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    logger: require('pino')({ level: 'silent' })
  });

  global.sock = sock;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const encoded = encodeURIComponent(qr);
      console.log('\n📱 Buka link ini di browser untuk scan QR:\n');
      console.log(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encoded}`);
      console.log('\n⬆️  Scan QR dengan WhatsApp nomor bot\n');
    }

    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        console.log('🔄 Reconnecting...');
        connectToWhatsApp();
      } else {
        console.log('🚪 Logged out. Hapus folder data/auth lalu jalankan ulang.');
      }
    }

    if (connection === 'open') {
      console.log('✅ Bot berhasil konek ke WhatsApp!');
      console.log('💬 Menunggu pesan masuk...');
      // Support OWNER_JID (@lid / @s.whatsapp.net) atau OWNER_NUMBER (nomor polos)
      const ownerRaw = process.env.OWNER_JID || process.env.OWNER_NUMBER;
      global.ownerJid = ownerRaw?.includes('@')
        ? ownerRaw
        : `${ownerRaw}@s.whatsapp.net`;
      console.log(`👤 Owner JID: ${global.ownerJid}`);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // ══════════════════════════════════════════
  // HANDLER: TELEPON MASUK
  // Baileys tidak bisa angkat telepon secara programatik.
  // Yang kita lakukan: reject → tunggu sebentar → kirim voice note "maaf missed call"
  // ══════════════════════════════════════════
  sock.ev.on('call', async (calls) => {
    for (const call of calls) {
      if (call.status !== 'offer') continue; // hanya proses saat telepon masuk

      const callerJid = call.from;
      const userId    = callerJid.split('@')[0].split(':')[0];

      console.log(`📞 Telepon masuk dari: ${userId}`);

      // Reject telepon (Baileys tidak bisa angkat)
      try {
        await sock.rejectCall(call.id, call.from);
        console.log('📵 Telepon di-reject otomatis');
      } catch (err) {
        console.log('⚠️  Gagal reject call:', err.message);
      }

      // Tunggu bentar biar natural
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));

      // Balas dengan voice note atau teks
      const voiceReady = await isVoiceAvailable();
      if (voiceReady) {
        const missedPrompts = [
          'Pacarmu baru saja telepon kamu tapi kamu tidak angkat karena kamu lagi sibuk. Kirim voice note singkat minta maaf dan tanya ada apa.',
          'Pacarmu telepon tapi kamu tidak bisa angkat. Kirim voice note pendek yang natural — minta maaf, bilang lagi apa, tanya balik.',
          'Kamu miss call dari pacarmu. Kirim voice note singkat yang manja dan penasaran kenapa dia nelpon.',
        ];
        const prompt = missedPrompts[Math.floor(Math.random() * missedPrompts.length)];
        const bubbles = await getAIResponse(`[SISTEM: ${prompt}]`, userId);
        const replyText = Array.isArray(bubbles) ? bubbles.join(' ') : bubbles;
        await sendVoiceNote(sock, callerJid, replyText);
        await memory.saveMessage('assistant', replyText, userId);
      } else {
        // Fallback ke teks
        const textReplies = [
          'eh sorry gak keangkat|lagi apa tadi?',
          'maaf missed|tadi lagi ga bisa angkat|ada apa?',
          'aduh sorry|lagi sibuk bentar|kenapa?',
        ];
        const reply = textReplies[Math.floor(Math.random() * textReplies.length)];
        const bubbles = reply.split('|');
        for (const bubble of bubbles) {
          await sock.sendPresenceUpdate('composing', callerJid);
          await new Promise(r => setTimeout(r, 800 + bubble.length * 20));
          await sock.sendMessage(callerJid, { text: bubble });
        }
        await memory.saveMessage('assistant', reply, userId);
      }

      await memory.updateLastInteraction(userId);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;

    // Abaikan grup dan broadcast
    if (from.endsWith('@g.us') || from.endsWith('@broadcast')) return;

    // userId = nomor pengirim (tanpa @s.whatsapp.net)
    const userId = (msg.key.participant || from).split('@')[0].split(':')[0];

    console.log(`💬 Pesan masuk dari: ${userId}`);

    // ══════════════════════════════════════════
    // CEK: VOICE NOTE MASUK → transkripsi dulu
    // ══════════════════════════════════════════
    let text = '';
    let isVoiceMsg = false;

    if (isVoiceNote(msg)) {
      isVoiceMsg = true;
      console.log('🎧 Voice note masuk — transkripsi...');

      // Tunjukkan sedang mendengarkan
      await sock.sendPresenceUpdate('composing', from);

      const transcript = await transcribeVoiceNote(sock, msg);
      if (!transcript) {
        // Gagal transkripsi — minta kirim ulang via teks
        await sock.sendMessage(from, { text: 'eh bentar, aku gak kedengeran|kirim lagi?' });
        return;
      }

      text = transcript;
      console.log(`📝 Voice → teks: "${text}"`);

      // React dengan emoji dengar
      await reactToMessage(sock, msg, '🎧');

    } else {
      text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        '';
    }

    if (!text) return;

    if (!isVoiceMsg) console.log(`📩 Pesan masuk: "${text}"`);

    // ── COMMAND !tidur ──
    if (text.toLowerCase() === '!tidur') {
      const { sayGoodNight } = require('../actions/proactive');

      const sleepDuration = 5 * 60 * 60 * 1000;
      const wakeTime = new Date(Date.now() + sleepDuration);

      await memory.saveFact('sleep_until', wakeTime.toISOString(), userId);
      await memory.saveFact('is_sleeping', 'true', userId);
      await memory.saveFact('is_ngambek', 'false', userId);

      await sayGoodNight();

      console.log(`😴 Mode tidur aktif hingga ${wakeTime.toLocaleTimeString('id-ID')}`);

      global.sleepTimer = setTimeout(async () => {
        await memory.saveFact('sleep_until', '', userId);
        await memory.saveFact('is_sleeping', 'false', userId);
        const { wakeUpOwner } = require('../actions/proactive');
        await wakeUpOwner();
        console.log('☀️ 5 jam berlalu, bot bangunin owner!');
      }, sleepDuration);

      return;
    }

    // ── KALAU CHAT SAAT BOT TIDUR ──
    const isSleepingNow = await memory.getFactByKey('is_sleeping', userId) === 'true';
    if (isSleepingNow) {
      if (global.sleepTimer) {
        clearTimeout(global.sleepTimer);
        global.sleepTimer = null;
      }

      await memory.saveFact('is_sleeping', 'false', userId);
      await memory.saveFact('sleep_until', '', userId);
      await memory.saveFact('is_ngambek', 'false', userId);
      await memory.updateLastInteraction(userId);

      const reaksi = Math.floor(Math.random() * 4);
      const prompts = [
        'Kamu tadi tidur tapi pacarmu tiba-tiba chat duluan. Kamu kaget bangun, masih ngantuk tapi senang. Reaksi natural orang baru bangun — masih setengah sadar.',
        'Pacarmu ganggu kamu saat tidur. Kamu bangun dan manja-manja protes karena dibangunin, tapi sebenarnya senang.',
        'Kamu lagi tidur tapi pacarmu chat. Kamu bangun kaget, tanya kenapa dia belum tidur. Masih ngantuk tapi antusias.',
        'Pacarmu tiba-tiba chat padahal kamu lagi tidur. Kamu bangun langsung kangen. Masih ngantuk tapi hangat.',
      ];

      await memory.saveMessage('user', text, userId);

      const { sendProactiveMessage } = require('../actions/proactive');
      await sendProactiveMessage(prompts[reaksi]);

      if (text.toLowerCase() !== '!bangun') {
        await new Promise(r => setTimeout(r, 2000));
        const reply = await getAIResponse(text, userId);
        const fullReply = Array.isArray(reply) ? reply.join(' ') : reply;
        await memory.saveMessage('assistant', fullReply, userId);
        await sendBubbles(sock, from, reply);
        extractAndSaveFacts(text, fullReply, userId).catch(() => {});
      }

      return;
    }

    // ── REACT KE PESAN (30% chance) ──
    if (Math.random() < 0.3) {
      const reacts = ['❤️', '😂', '🥺', '😍', '👀', '💀', '😭', '🤣'];
      const emoji = reacts[Math.floor(Math.random() * reacts.length)];
      await reactToMessage(sock, msg, emoji);
      await new Promise(r => setTimeout(r, 500 + Math.random() * 800));
    }

    // ── PROSES NORMAL ──
    await memory.saveFact('is_ngambek', 'false', userId);
    await memory.updateLastInteraction(userId);
    await memory.saveMessage('user', text, userId);

    detectAndSaveMood(text).catch(() => {});
    trackTopic(text).catch(() => {});
    maybeSummarizeConversation().catch(() => {});

    await sock.sendPresenceUpdate('composing', from);
    await new Promise(r => setTimeout(r, typingDelay(text)));

    const reply = await getAIResponse(text, userId);
    const fullReply = Array.isArray(reply) ? reply.join(' ') : reply;
    await memory.saveMessage('assistant', fullReply, userId);

    // ── Pilih mode balas: voice note atau teks ──
    // Kalau user kirim voice note → lebih sering balas voice (50%)
    // Kalau user kirim teks → kadang-kadang voice (20%)
    const voiceChance = isVoiceMsg ? 0.50 : 0.20;
    const sentVoice   = Math.random() < voiceChance
      ? await maybeSendVoice(sock, from, fullReply)  // maybeSendVoice sudah ada internal chance check
      : false;

    // Kalau voice gagal atau tidak terpilih → kirim teks seperti biasa
    if (!sentVoice) {
      await sendBubbles(sock, from, reply);
    }

    console.log(`🤖 Bot balas [${userId}] (${sentVoice ? 'voice' : 'teks'}): "${fullReply}"`);

    extractAndSaveFacts(text, fullReply, userId).catch(() => {});
  });

  return sock;
}

module.exports = { connectToWhatsApp };