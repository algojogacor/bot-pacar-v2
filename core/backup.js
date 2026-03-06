const fs = require('fs');
const path = require('path');

function backupDatabase() {
  const dbPath = path.join(__dirname, '../data/chat.db');
  const backupDir = path.join(__dirname, '../data/backups');

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const backupPath = path.join(backupDir, `chat-backup-${timestamp}.db`);

  if (fs.existsSync(backupPath)) return;

  try {
    fs.copyFileSync(dbPath, backupPath);
    console.log(`💾 Backup berhasil: chat-backup-${timestamp}.db`);
    cleanOldBackups(backupDir);
  } catch (err) {
    console.error('❌ Backup gagal:', err.message);
  }
}

function cleanOldBackups(backupDir) {
  const files = fs.readdirSync(backupDir)
    .filter(f => f.endsWith('.db'))
    .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtime }))
    .sort((a, b) => b.time - a.time);

  files.slice(7).forEach(f => {
    fs.unlinkSync(path.join(backupDir, f.name));
    console.log(`🗑️ Hapus backup lama: ${f.name}`);
  });
}

module.exports = { backupDatabase };