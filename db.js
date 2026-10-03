const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn(
    '\n  Peringatan: DATABASE_URL belum diisi di .env — server tidak akan bisa membaca atau menulis data.\n'
  );
}

// Neon mewajibkan koneksi lewat SSL. rejectUnauthorized:false dipakai
// karena banyak lingkungan (termasuk fungsi serverless Vercel) tidak
// membawa root certificate Neon secara bawaan.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
  max: process.env.VERCEL ? 1 : 10 // di lingkungan serverless, satu koneksi per proses sudah cukup
});

pool.on('error', (err) => {
  console.error('Koneksi database bermasalah tanpa terduga:', err.message);
});

async function query(text, params) {
  return pool.query(text, params);
}

const DEFAULT_SITE = {
  name: 'Nama Kamu',
  role: 'Desainer & Pengembang Web',
  tagline: 'Saya merancang dan membangun produk digital yang rapi, cepat, dan enak dipakai.',
  about:
    'Tulis cerita singkat tentang dirimu di sini. Apa yang kamu kerjakan, bagaimana cara kamu bekerja, dan hal apa yang sedang kamu pelajari sekarang.',
  location: 'Jakarta, Indonesia',
  available: 'Terbuka untuk proyek freelance',
  email: 'halo@contoh.com',
  avatar: '',
  heroCover: '',
  socials: [
    { label: 'Instagram', url: 'https://instagram.com/' },
    { label: 'LinkedIn', url: 'https://linkedin.com/' },
    { label: 'GitHub', url: 'https://github.com/' }
  ],
  skills: ['Desain antarmuka', 'HTML & CSS', 'JavaScript', 'Branding', 'Fotografi'],
  projects: [
    {
      title: 'Nama proyek pertama',
      year: '2025',
      summary: 'Ringkasan singkat proyek: masalahnya apa, dan apa yang kamu kerjakan.',
      tags: ['Web', 'Desain'],
      url: '',
      image: ''
    }
  ],
  experience: [
    { period: '2023 — sekarang', title: 'Peran kamu', org: 'Nama perusahaan', note: 'Satu kalimat soal tanggung jawabmu.' }
  ]
};

// Dijalankan sekali saat server menyala. CREATE TABLE IF NOT EXISTS aman
// dipanggil berkali-kali, jadi tidak masalah kalau proses ini terpicu
// lebih dari sekali (misalnya banyak fungsi serverless dingin sekaligus).
let ensured = null;
function ensureSchema() {
  if (!ensured) {
    ensured = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS posts (
          id           UUID PRIMARY KEY,
          slug         TEXT UNIQUE NOT NULL,
          title        TEXT NOT NULL,
          excerpt      TEXT NOT NULL DEFAULT '',
          content      TEXT NOT NULL DEFAULT '',
          cover        TEXT NOT NULL DEFAULT '',
          tags         JSONB NOT NULL DEFAULT '[]',
          status       TEXT NOT NULL DEFAULT 'draft',
          date         TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
          reading_time INT NOT NULL DEFAULT 0
        );
      `);
      // Kolom ini membuat halaman daftar tulisan tidak perlu mengunduh
      // seluruh Markdown hanya untuk menghitung estimasi waktu baca.
      await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS reading_time INT NOT NULL DEFAULT 0;`);
      await query(`
        UPDATE posts
        SET reading_time = GREATEST(
          1,
          CEIL(COALESCE(array_length(regexp_split_to_array(BTRIM(content), E'\\s+'), 1), 0) / 200.0)::INT
        )
        WHERE reading_time = 0;
      `);
      await query(`ALTER TABLE posts ALTER COLUMN reading_time SET DEFAULT 1;`);
      await query(`CREATE INDEX IF NOT EXISTS posts_status_date_idx ON posts (status, date DESC);`);

      // Profil disimpan sebagai satu baris JSON tunggal — cukup untuk
      // situs pribadi, dan gampang diperluas tanpa migrasi kolom.
      await query(`
        CREATE TABLE IF NOT EXISTS site (
          id    INT PRIMARY KEY DEFAULT 1,
          data  JSONB NOT NULL,
          CONSTRAINT site_single_row CHECK (id = 1)
        );
      `);
      const existing = await query('SELECT 1 FROM site WHERE id = 1');
      if (existing.rowCount === 0) {
        await query('INSERT INTO site (id, data) VALUES (1, $1)', [JSON.stringify(DEFAULT_SITE)]);
      }
    })();
  }
  return ensured;
}

/* ---------------- pemetaan baris <-> objek yang dipakai server.js ---------------- */

function rowToPost(row) {
  const post = {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    cover: row.cover,
    tags: row.tags,
    status: row.status,
    date: row.date.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    readingTime: row.reading_time || 1
  };
  if (typeof row.content === 'string') post.content = row.content;
  return post;
}

async function getAllPosts() {
  await ensureSchema();
  const { rows } = await query('SELECT * FROM posts ORDER BY date DESC');
  return rows.map(rowToPost);
}

// Dipakai halaman daftar dan panel admin. Isi artikel sengaja tidak diambil:
// kontennya baru diminta saat sebuah artikel dibuka atau diedit.
async function getPostSummaries() {
  await ensureSchema();
  const { rows } = await query(`
    SELECT id, slug, title, excerpt, cover, tags, status, date, updated_at, reading_time
    FROM posts
    ORDER BY date DESC
  `);
  return rows.map(rowToPost);
}

async function getPostBySlug(slug) {
  await ensureSchema();
  const { rows } = await query('SELECT * FROM posts WHERE slug = $1', [slug]);
  return rows[0] ? rowToPost(rows[0]) : null;
}

async function getPostNavigation(slug) {
  await ensureSchema();
  const { rows } = await query(
    `WITH ordered AS (
       SELECT
         slug,
         LAG(slug) OVER (ORDER BY date DESC, id ASC) AS prev_slug,
         LAG(title) OVER (ORDER BY date DESC, id ASC) AS prev_title,
         LEAD(slug) OVER (ORDER BY date DESC, id ASC) AS next_slug,
         LEAD(title) OVER (ORDER BY date DESC, id ASC) AS next_title
       FROM posts
       WHERE status = 'published'
     )
     SELECT prev_slug, prev_title, next_slug, next_title
     FROM ordered
     WHERE slug = $1`,
    [slug]
  );
  const row = rows[0];
  if (!row) return { prev: null, next: null };
  return {
    prev: row.prev_slug ? { slug: row.prev_slug, title: row.prev_title } : null,
    next: row.next_slug ? { slug: row.next_slug, title: row.next_title } : null
  };
}

async function slugExists(slug, excludeId) {
  await ensureSchema();
  const { rows } = excludeId
    ? await query('SELECT 1 FROM posts WHERE slug = $1 AND id <> $2', [slug, excludeId])
    : await query('SELECT 1 FROM posts WHERE slug = $1', [slug]);
  return rows.length > 0;
}

async function insertPost(post) {
  await ensureSchema();
  const { rows } = await query(
    `INSERT INTO posts (id, slug, title, excerpt, content, cover, tags, status, date, updated_at, reading_time)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10)
     RETURNING *`,
    [post.id, post.slug, post.title, post.excerpt, post.content, post.cover, JSON.stringify(post.tags), post.status, post.date, post.readingTime]
  );
  return rowToPost(rows[0]);
}

async function updatePost(id, patch) {
  await ensureSchema();
  const { rows } = await query(
    `UPDATE posts SET
       slug = $2, title = $3, excerpt = $4, content = $5, cover = $6,
       tags = $7, status = $8, date = $9, updated_at = now(), reading_time = $10
     WHERE id = $1
     RETURNING *`,
    [id, patch.slug, patch.title, patch.excerpt, patch.content, patch.cover, JSON.stringify(patch.tags), patch.status, patch.date, patch.readingTime]
  );
  return rows[0] ? rowToPost(rows[0]) : null;
}

async function deletePost(id) {
  await ensureSchema();
  const { rowCount } = await query('DELETE FROM posts WHERE id = $1', [id]);
  return rowCount > 0;
}

async function getSite() {
  await ensureSchema();
  const { rows } = await query('SELECT data FROM site WHERE id = 1');
  return { ...DEFAULT_SITE, ...(rows[0]?.data || {}) };
}

async function saveSite(next) {
  await ensureSchema();
  await query('UPDATE site SET data = $1 WHERE id = 1', [JSON.stringify(next)]);
  return next;
}

module.exports = {
  query,
  ensureSchema,
  DEFAULT_SITE,
  getAllPosts,
  getPostSummaries,
  getPostBySlug,
  getPostNavigation,
  slugExists,
  insertPost,
  updatePost,
  deletePost,
  getSite,
  saveSite
};
