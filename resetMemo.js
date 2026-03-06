// reset-memories.js
// Jalankan SEKALI untuk hapus memori lama yang gagal di-index
// Command: node reset-memories.js
// Setelah selesai, hapus file ini.

require('dotenv').config();
const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_TOKEN,
});

async function reset() {
  console.log('🗑️  Menghapus memories lama...');
  await db.execute('DELETE FROM memories');
  
  const result = await db.execute('SELECT COUNT(*) as count FROM memories');
  console.log(`✅ Memories sekarang: ${result.rows[0].count} (harusnya 0)`);
  console.log('');
  console.log('Sekarang jalankan: node index.js');
  console.log('Jihan.md akan di-index ulang dengan Jina AI.');
  process.exit(0);
}

reset().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});