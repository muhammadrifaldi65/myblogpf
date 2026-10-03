(async function () {
  const list = document.querySelector('[data-posts]');
  const tagbar = document.querySelector('[data-tags]');
  const search = document.getElementById('q');
  const postsRequest = api.get('/api/posts');

  let posts = [];
  let activeTag = new URLSearchParams(location.search).get('tag') || '';
  let query = '';

  try {
    const site = await api.get('/api/site');
    paintSite(site);
    const socials = document.querySelector('[data-socials]');
    if (socials) {
      socials.innerHTML = (site.socials || [])
        .filter((s) => s.label && s.url)
        .map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a></li>`)
        .join('');
    }
  } catch { /* profil gagal dimuat, daftar tulisan tetap jalan */ }

  function render() {
    const needle = query.trim().toLowerCase();
    const shown = posts.filter((p) => {
      const byTag = !activeTag || (p.tags || []).some((t) => t.toLowerCase() === activeTag.toLowerCase());
      const byText =
        !needle || [p.title, p.excerpt, (p.tags || []).join(' ')].join(' ').toLowerCase().includes(needle);
      return byTag && byText;
    });

    if (!posts.length) {
      list.innerHTML = `<div class="empty"><h3>Belum ada tulisan</h3><p>Tulisan pertama akan muncul di sini setelah kamu terbitkan dari panel admin.</p></div>`;
      return;
    }

    list.innerHTML = shown.length
      ? shown
          .map(
            (p) => `<article class="entry">
              <time class="entry__date" datetime="${esc(p.date)}">${shortDate(p.date)}</time>
              <div class="entry__body">
                ${p.cover ? `<a class="entry__thumb" href="/blog/${esc(p.slug)}" tabindex="-1" aria-hidden="true"><img src="${esc(thumb(p.cover, 400))}" alt="" loading="lazy" decoding="async"></a>` : ''}
                <div>
                  <h2 class="entry__title"><a href="/blog/${esc(p.slug)}">${esc(p.title)}</a></h2>
                  ${p.excerpt ? `<p class="entry__excerpt">${esc(p.excerpt)}</p>` : ''}
                </div>
              </div>
              <span class="entry__meta">${p.readingTime} menit baca</span>
            </article>`
          )
          .join('')
      : `<div class="empty"><h3>Tidak ada yang cocok</h3><p>Coba kata kunci lain atau hapus filter topik.</p></div>`;
  }

  function renderTags() {
    const tags = [...new Set(posts.flatMap((p) => p.tags || []))].sort((a, b) => a.localeCompare(b));
    if (!tags.length) return;
    tagbar.innerHTML =
      `<li><button data-tag="" aria-pressed="${activeTag === ''}">Semua</button></li>` +
      tags
        .map(
          (t) =>
            `<li><button data-tag="${esc(t)}" aria-pressed="${t.toLowerCase() === activeTag.toLowerCase()}">${esc(t)}</button></li>`
        )
        .join('');
  }

  tagbar.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    activeTag = btn.dataset.tag;
    const url = new URL(location.href);
    activeTag ? url.searchParams.set('tag', activeTag) : url.searchParams.delete('tag');
    history.replaceState({}, '', url);
    renderTags();
    render();
  });

  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      query = search.value;
      render();
    }, 150);
  });

  try {
    posts = await postsRequest;
    renderTags();
    render();
  } catch {
    list.innerHTML = `<div class="empty"><h3>Tulisan gagal dimuat</h3><p>Periksa koneksi lalu muat ulang halaman.</p></div>`;
  }
})();
