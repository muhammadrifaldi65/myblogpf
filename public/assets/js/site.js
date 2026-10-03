/* Helper yang dipakai semua halaman */

const api = {
  async get(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Gagal memuat data.');
    return res.json();
  },
  async send(method, url, body) {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Permintaan gagal.');
    return data;
  }
};

const esc = (value = '') =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const formatDate = (value) =>
  new Date(value).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

const shortDate = (value) =>
  new Date(value).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });

/* Gambar ImageKit bisa diminta dalam ukuran tertentu lewat parameter tr */
function thumb(url, width = 900) {
  if (!url) return '';
  if (!url.includes('imagekit.io')) return url;
  /* Lewat domain sendiri (/img/...) supaya tidak kena DNS ISP yang salah arah.
     vercel.json meneruskan /img/* ke ImageKit. */
  url = url.replace(/^https?:\/\/ik\.imagekit\.io\/[^/]+\//, '/img/');
  return url + (url.includes('?') ? '&' : '?') + `tr=w-${width},q-80,f-auto`;
}

/* Menu mobile */
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.nav__toggle');
  const nav = document.getElementById('nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.dataset.open === 'true';
      nav.dataset.open = String(!open);
      toggle.setAttribute('aria-expanded', String(!open));
      toggle.textContent = open ? 'Menu' : 'Tutup';
    });
    nav.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') {
        nav.dataset.open = 'false';
        toggle.setAttribute('aria-expanded', 'false');
        toggle.textContent = 'Menu';
      }
    });
  }

  const year = document.querySelector('[data-year]');
  if (year) year.textContent = new Date().getFullYear();
});

/* Isi elemen bertanda data-site="field" dengan data profil */
function paintSite(site) {
  document.querySelectorAll('[data-site]').forEach((el) => {
    const value = site[el.dataset.site];
    if (value) el.textContent = value;
  });
  document.querySelectorAll('[data-site-email]').forEach((el) => {
    el.textContent = site.email || '';
    el.href = `mailto:${site.email || ''}`;
  });
  if (site.name) document.title = document.title.replace(/^Portofolio/, site.name);
}