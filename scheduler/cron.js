// scheduler/cron.js
const memory = require('../core/memory');
const {
  sendGoodMorning,
  sendLunchCheck,
  sendAfternoonMessage,
  sendGoodNight,
  sendRandomMessage,
  startSearching,
  sendRomanticRandom,
  sendPhotoProactive,
} = require('../actions/proactive');

function getWIBHour() {
  return (new Date().getUTCHours() + 7) % 24;
}

async function isSleeping() {
  try {
    const sleepUntil = await memory.getFactByKey('sleep_until');
    if (!sleepUntil) return false;
    return Date.now() < new Date(sleepUntil).getTime();
  } catch {
    return false;
  }
}

async function isIdleTooLong(menitMinimum = 90) {
  const last = await memory.getLastInteraction();
  if (!last) return true;
  const menit = (Date.now() - last.getTime()) / (1000 * 60);
  console.log(`⏱️  Idle ${Math.round(menit)} menit`);
  return menit >= menitMinimum;
}

// FIX: Simpan status "sudah kirim hari ini" ke DB supaya tahan bot restart
function getTodayKey() {
  // Gunakan tanggal WIB
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return `${wib.getUTCFullYear()}-${String(wib.getUTCMonth() + 1).padStart(2,'0')}-${String(wib.getUTCDate()).padStart(2,'0')}`;
}

async function alreadySent(key) {
  const dbKey = `sched_sent_${getTodayKey()}_${key}`;
  const val = await memory.getFactByKey(dbKey);
  if (val === 'true') return true;
  await memory.saveFact(dbKey, 'true');
  return false;
}

function randomChance(persen) {
  return Math.random() < (persen / 100);
}

function randomDelayMs(menitMin, menitMax) {
  const menit = menitMin + Math.floor(Math.random() * (menitMax - menitMin));
  return menit * 60 * 1000;
}

async function runSchedulerTick() {
  if (await isSleeping()) return;

  const jam = getWIBHour();

  // Jam tidur: skip semua
  if (jam >= 23 || jam < 6) return;

  // ── PAGI: jam 6-8 (window lebih lebar, tahan restart) ──
  if (jam >= 6 && jam < 9 && !await alreadySent('pagi')) {
    setTimeout(sendGoodMorning, randomDelayMs(0, 10));
    return;
  }

  // ── SIANG: jam 11-13 ──
  if (jam >= 11 && jam < 13 && !await alreadySent('siang')) {
    setTimeout(sendLunchCheck, randomDelayMs(0, 10));
    return;
  }

  // ── SORE: jam 15-17 ──
  if (jam >= 15 && jam < 17 && !await alreadySent('sore')) {
    setTimeout(sendAfternoonMessage, randomDelayMs(0, 10));
    return;
  }

  // ── MALAM: jam 20-22 ──
  if (jam >= 20 && jam < 22 && !await alreadySent('malam')) {
    setTimeout(sendGoodNight, randomDelayMs(0, 10));
    return;
  }

  // ── ROMANTIC/MANJA: jam 13 dan 21 ──
  if (jam === 13 && !await alreadySent('romantic_siang') && randomChance(50)) {
    setTimeout(sendRomanticRandom, randomDelayMs(0, 30));
    return;
  }

  if (jam === 21 && !await alreadySent('romantic_malam') && randomChance(60)) {
    setTimeout(sendRomanticRandom, randomDelayMs(0, 30));
    return;
  }

  // ── RANDOM: beberapa kali sehari ──
  if ([9, 12, 16, 19].includes(jam) && !await alreadySent(`random_${jam}`) && randomChance(40)) {
    setTimeout(sendRandomMessage, randomDelayMs(0, 20));
    return;
  }

  // ── FOTO: 1-2x sehari, jam 10 atau 14 (30% chance) ──
  if ([10, 14].includes(jam) && !await alreadySent(`foto_${jam}`) && randomChance(30)) {
    setTimeout(sendPhotoProactive, randomDelayMs(0, 30));
    return;
  }

  // ── CEK IDLE ──
  const isNgambek = await memory.getFactByKey('is_ngambek');
  if (isNgambek === 'true') {
    console.log('😤 Masih ngambek, skip');
    return;
  }

  if (await isIdleTooLong(90)) {
    console.log('🔍 Idle 90 menit, nyariin...');
    startSearching();
  }
}

function startScheduler() {
  console.log('⏰ Scheduler aktif (interval 5 menit, WIB)');
  setInterval(async () => {
    try {
      await runSchedulerTick();
    } catch (err) {
      console.error('⚠️ Scheduler error:', err.message);
    }
  }, 5 * 60 * 1000);
}

module.exports = { startScheduler, isSleeping };