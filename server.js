require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const ImageKit = require('imagekit');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ubah-password-ini';
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const IS_PROD = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

/* ---------------------------------------------------------------
   Utilitas
---------------------------------------------------------------- */

function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function readingTime(markdown = '') {
  const words = markdown.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

function publicPost(post) {
  const { content, ...rest } = post;
  return { ...rest, readingTime: post.readingTime || readingTime(content) };
}

// Browser selalu meminta ulang agar perubahan dari admin langsung tampak.
// CDN tetap boleh menyajikan respons publik yang masih baru selama satu menit.
function setPublicCache(res) {
  res.set('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function requireAdmin(req, res, next) {
  const payload = verifyToken(req.cookies.session);
  if (!payload) return res.status(401).json({ error: 'Kamu perlu masuk dulu.' });
  req.admin = payload;
  next();
}

/* ---------------------------------------------------------------
   Autentikasi admin
---------------------------------------------------------------- */

const attempts = new Map(); // pembatas percobaan login sederhana per IP

app.post('/api/auth/login', (req, res) => {
  const ip = req.ip;
  const record = attempts.get(ip) || { count: 0, until: 0 };
  if (record.until > Date.now()) {
    const wait = Math.ceil((record.until - Date.now()) / 1000);
    return res.status(429).json({ error: `Terlalu banyak percobaan. Coba lagi ${wait} detik.` });
  }

  const { username = '', password = '' } = req.body || {};
  const ok = safeEqual(username, ADMIN_USERNAME) && safeEqual(password, ADMIN_PASSWORD);

  if (!ok) {
    record.count += 1;
    if (record.count >= 5) {
      record.count = 0;
      record.until = Date.now() + 60_000;
    }
    attempts.set(ip, record);
    return res.status(401).json({ error: 'Username atau password salah.' });
  }

  attempts.delete(ip);
  const token = jwt.sign({ username: ADMIN_USERNAME, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
  res.json({ username: ADMIN_USERNAME });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('session');
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAdmin, (req, res) => {
  res.json({ username: req.admin.username });
});

/* ---------------------------------------------------------------
   Konten situs (profil, proyek, pengalaman)
---------------------------------------------------------------- */

app.get('/api/site', async (req, res, next) => {
  try {
    setPublicCache(res);
    res.json(await db.getSite());
  } catch (err) {
    next(err);
  }
});

app.put('/api/site', requireAdmin, async (req, res, next) => {
  try {
    const current = await db.getSite();
    const merged = { ...current, ...req.body };
    await db.saveSite(merged);
    res.json(merged);
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------
   Tulisan blog
---------------------------------------------------------------- */

app.get('/api/posts', async (req, res, next) => {
  try {
    const isAdmin = Boolean(verifyToken(req.cookies.session));
    // Pencarian server perlu isi artikel; halaman normal dan admin cukup
    // menerima metadata kecil dari getPostSummaries().
    const all = req.query.q ? await db.getAllPosts() : await db.getPostSummaries();

    let list = isAdmin && req.query.all === '1' ? all : all.filter((p) => p.status === 'published');

    if (req.query.tag) {
      const tag = String(req.query.tag).toLowerCase();
      list = list.filter((p) => (p.tags || []).some((t) => t.toLowerCase() === tag));
    }
    if (req.query.q) {
      const q = String(req.query.q).toLowerCase();
      list = list.filter((p) =>
        [p.title, p.excerpt, p.content, (p.tags || []).join(' ')].join(' ').toLowerCase().includes(q)
      );
    }

    const limit = Number(req.query.limit) || 0;
    if (req.query.all !== '1') setPublicCache(res);
    res.json((limit ? list.slice(0, limit) : list).map(publicPost));
  } catch (err) {
    next(err);
  }
});

app.get('/api/posts/:slug', async (req, res, next) => {
  try {
    const post = await db.getPostBySlug(req.params.slug);
    if (!post) return res.status(404).json({ error: 'Tulisan tidak ditemukan.' });

    const isAdmin = Boolean(verifyToken(req.cookies.session));
    if (post.status !== 'published' && !isAdmin) return res.status(404).json({ error: 'Tulisan tidak ditemukan.' });

    const navigation = await db.getPostNavigation(post.slug);

    res.json({
      ...post,
      readingTime: readingTime(post.content),
      ...navigation
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/posts', requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.title) return res.status(400).json({ error: 'Judul belum diisi.' });

    let slug = slugify(body.slug || body.title) || `tulisan-${Date.now()}`;
    while (await db.slugExists(slug)) slug = `${slug}-${Math.floor(Math.random() * 900 + 100)}`;

    const post = await db.insertPost({
      id: crypto.randomUUID(),
      slug,
      title: body.title,
      excerpt: body.excerpt || '',
      content: body.content || '',
      cover: body.cover || '',
      tags: Array.isArray(body.tags) ? body.tags : [],
      status: body.status === 'published' ? 'published' : 'draft',
      date: body.date || new Date().toISOString(),
      readingTime: readingTime(body.content || '')
    });

    res.status(201).json(post);
  } catch (err) {
    next(err);
  }
});

app.put('/api/posts/:id', requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const all = await db.getAllPosts();
    const current = all.find((p) => p.id === req.params.id);
    if (!current) return res.status(404).json({ error: 'Tulisan tidak ditemukan.' });

    let slug = current.slug;
    if (body.slug && slugify(body.slug) !== slug) {
      slug = slugify(body.slug);
      while (await db.slugExists(slug, current.id)) slug = `${slug}-${Math.floor(Math.random() * 900 + 100)}`;
    }

    const updated = await db.updatePost(current.id, {
      slug,
      title: body.title ?? current.title,
      excerpt: body.excerpt ?? current.excerpt,
      content: body.content ?? current.content,
      cover: body.cover ?? current.cover,
      tags: Array.isArray(body.tags) ? body.tags : current.tags,
      status: body.status === 'published' ? 'published' : 'draft',
      date: body.date || current.date,
      readingTime: readingTime(body.content ?? current.content)
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/posts/:id', requireAdmin, async (req, res, next) => {
  try {
    const ok = await db.deletePost(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Tulisan tidak ditemukan.' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------
   ImageKit: kunci privat tetap di server, browser hanya dapat token
---------------------------------------------------------------- */

const imagekitReady =
  Boolean(process.env.IMAGEKIT_PUBLIC_KEY && process.env.IMAGEKIT_PRIVATE_KEY && process.env.IMAGEKIT_URL_ENDPOINT);

const imagekit = imagekitReady
  ? new ImageKit({
      publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
      privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
      urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
    })
  : null;

app.get('/api/imagekit/config', (req, res) => {
  res.json({
    ready: imagekitReady,
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY || '',
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || '',
    folder: process.env.IMAGEKIT_FOLDER || '/blog'
  });
});

app.get('/api/imagekit/auth', requireAdmin, (req, res) => {
  if (!imagekit) {
    return res.status(503).json({ error: 'Kunci ImageKit belum diisi di file .env.' });
  }
  res.json(imagekit.getAuthenticationParameters());
});

app.delete('/api/imagekit/files/:fileId', requireAdmin, async (req, res) => {
  if (!imagekit) return res.status(503).json({ error: 'Kunci ImageKit belum diisi di file .env.' });
  try {
    await imagekit.deleteFile(req.params.fileId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Gambar gagal dihapus.' });
  }
});

/* ---------------------------------------------------------------
   Halaman
---------------------------------------------------------------- */

app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  // Nama aset belum memakai hash, jadi cache dibuat cukup panjang untuk
  // kunjungan berulang tanpa membuat rilis baru terlalu lama tertahan.
  maxAge: IS_PROD ? '1d' : 0
}));

app.get('/blog/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public', 'post.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Endpoint tidak ada.' });
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// Penangan galat terakhir: masalah koneksi database jangan sampai
// membuat proses mati atau membocorkan jejak internal ke pengguna.
app.use((err, req, res, next) => {
  console.error(err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: 'Terjadi masalah di server. Coba lagi sebentar lagi.' });
  }
  res.status(500).send('Terjadi masalah di server.');
});

if (require.main === module) {
  db.ensureSchema()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`\n  Situs jalan di http://localhost:${PORT}`);
        console.log(`  Panel admin  di http://localhost:${PORT}/admin`);
        if (!imagekitReady) console.log('  Catatan: kunci ImageKit belum diisi, upload gambar belum aktif.');
        if (!process.env.DATABASE_URL) console.log('  Catatan: DATABASE_URL belum diisi, situs tidak bisa membaca data.\n');
        else console.log('');
      });
    })
    .catch((err) => {
      console.error('Gagal menyiapkan database:', err.message);
      process.exit(1);
    });
}

module.exports = app;
