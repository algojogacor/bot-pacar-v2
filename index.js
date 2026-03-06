require('dotenv').config();
const http = require('http');
const { connectToWhatsApp } = require('./core/baileys');
const { startScheduler } = require('./scheduler/cron');
const { checkAndSendSpecialDay } = require('./core/special-days');
const { initDB } = require('./core/memory');
const { loadIndexFromDB, indexDataset } = require('./core/rag');

const PORT = process.env.PORT || 8000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('OK');
}).listen(PORT, () => {
  console.log(`🌐 Health check server running on port ${PORT}`);
});

console.log('🚀 Starting WA Pacar Bot...');
console.log('================================');

// FIX: Catat waktu startup biar bisa cegah scheduler double-fire
global.botStartTime = Date.now();

initDB().then(async () => {
  console.log('✅ Database Turso siap!');

  // 1. Index dataset statis Jihan (skip kalau sudah ada)
  await indexDataset('data/persona/jihan.md');

  // 2. Load semua vector dari Turso → rebuild HNSWLib index di memory
  await loadIndexFromDB();

  connectToWhatsApp().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });

  const waitForReady = setInterval(async () => {
    if (!global.ownerJid) return;
    clearInterval(waitForReady);
    console.log('✅ Owner siap, menjalankan scheduler...');
    startScheduler();

    // FIX: Hapus checkAndSendSpecialDay dari sini — biar scheduler saja yang
    // handle. Kalau dipanggil di sini juga, tiap bot restart (misal di Koyeb)
    // langsung ngirim pesan anniversary/ultah lagi padahal baru saja dikirim.
    // checkAndSendSpecialDay() sudah ada di cron.js, tidak perlu dobel.

  }, 1000);

}).catch(err => {
  console.error('❌ Gagal start:', err);
  process.exit(1);
});