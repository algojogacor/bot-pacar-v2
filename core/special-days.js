const memory = require('./memory');

// =============================================
// Daftar hari spesial — edit sesuai kebutuhan
// =============================================
const SPECIAL_DAYS = [
  {
    key: 'anniversary',
    month: 2,   // ← ganti bulan anniversary kamu (1-12)
    day: 27,    // ← ganti tanggal anniversary kamu
    prompts: [
      'Hari ini adalah hari anniversary kalian! Kirim pesan anniversary yang tulus, romantis, dan personal. Tidak lebay tapi berkesan.',
      'Selamat hari jadi kalian! Ingatkan pacarmu tentang betapa berartinya hubungan ini. Hangat dan natural.',
    ]
  },
  {
    key: 'birthday_partner',
    month: 4,   // ← ganti bulan ulang tahun kamu (1-12)
    day: 26,     // ← ganti tanggal ulang tahun kamu
    prompts: [
      'Hari ini ulang tahun pacarmu! Ucapkan selamat ulang tahun yang tulus, spesial, dan penuh kasih sayang. Bukan yang generik.',
      'Selamat ulang tahun untuk pacarmu! Buat dia merasa spesial hari ini dengan pesan yang hangat dan personal.',
    ]
  }
];

function getTodaySpecialDay() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  return SPECIAL_DAYS.find(d => d.month === month && d.day === day) || null;
}

async function checkAndSendSpecialDay() {
  const specialDay = getTodaySpecialDay();
  if (!specialDay) return;

  // Cek apakah sudah dikirim hari ini
  const lastSent = memory.getFactByKey(`special_sent_${specialDay.key}`);
  const today = new Date().toDateString();
  if (lastSent === today) return;

  console.log(`🎉 Hari spesial terdeteksi: ${specialDay.key}`);

  const { sendProactiveMessage } = require('../actions/proactive');
  const prompt = specialDay.prompts[Math.floor(Math.random() * specialDay.prompts.length)];

  await sendProactiveMessage(prompt);
  memory.saveFact(`special_sent_${specialDay.key}`, today);
}

module.exports = { checkAndSendSpecialDay, SPECIAL_DAYS };