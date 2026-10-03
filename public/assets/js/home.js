(async function () {
  // Mulai dua request bersamaan; sebelumnya daftar tulisan baru diminta
  // setelah profil selesai dimuat.
  const latestPostsRequest = api.get('/api/posts?limit=3');

  try {
    const site = await api.get('/api/site');
    paintSite(site);

    // Judul hero: nama dimiringkan supaya jadi pusat perhatian halaman
    const title = document.querySelector('[data-hero-title]');
    if (title) {
      title.innerHTML = `${esc(site.role || '')} <em>${esc(site.name || '')}</em>`;
    }

    if (site.heroCover) {
      const bg = document.querySelector('[data-hero-bg]');
      bg.style.backgroundImage = `url("${thumb(site.heroCover, 2000)}")`;
      bg.hidden = false;
    }

    if (site.avatar) {
      const fig = document.querySelector('[data-portrait]');
      const img = document.querySelector('[data-site-avatar]');
      // Bingkai potret maksimal sekitar 256px; 600px tetap tajam di layar
      // retina tanpa mengunduh file 1600px yang tidak pernah terlihat.
      img.src = thumb(site.avatar, 600);
      img.alt = `Potret ${site.name || ''}`;
      img.decoding = 'async';
      img.fetchPriority = 'high';
      fig.hidden = false;
    }

    const about = document.querySelector('[data-about]');
    if (about) {
      about.innerHTML = String(site.about || '')
        .split(/\n{2,}/)
        .map((p) => `<p>${esc(p)}</p>`)
        .join('');
    }

    const skills = document.querySelector('[data-skills]');
    if (skills) skills.innerHTML = (site.skills || []).map((s) => `<li>${esc(s)}</li>`).join('');

    const exp = document.querySelector('[data-experience]');
    if (exp) {
      exp.innerHTML = (site.experience || [])
        .map(
          (e) => `<li>
            <span>${esc(e.period || '')}</span>
            <div>
              <h3>${esc(e.title || '')}${e.org ? ` · ${esc(e.org)}` : ''}</h3>
              <p>${esc(e.note || '')}</p>
            </div>
          </li>`
        )
        .join('');
    }

    const works = document.querySelector('[data-projects]');
    if (works) {
      works.innerHTML = (site.projects || []).length
        ? site.projects
            .map((p) => {
              const inner = `
                ${p.image ? `<div class="work__media"><img src="${esc(thumb(p.image, 800))}" alt="${esc(p.title)}" loading="lazy" decoding="async"></div>` : ''}
                <div class="work__body">
                  <span class="work__year">${esc(p.year || '')}</span>
                  <h3 class="work__title">${esc(p.title || '')}</h3>
                  <p class="work__summary">${esc(p.summary || '')}</p>
                  <ul class="work__tags">${(p.tags || []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
                </div>`;
              return p.url
                ? `<a class="work" href="${esc(p.url)}" target="_blank" rel="noopener">${inner}</a>`
                : `<article class="work">${inner}</article>`;
            })
            .join('')
        : `<div class="empty"><h3>Belum ada proyek</h3><p>Tambahkan proyek pertamamu lewat panel admin di menu Profil.</p></div>`;
    }

    const socials = document.querySelector('[data-socials]');
    if (socials) {
      socials.innerHTML = (site.socials || [])
        .filter((s) => s.label && s.url)
        .map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a></li>`)
        .join('');
    }
  } catch (err) {
    console.error(err);
  }

  // Tiga tulisan terbaru
  const box = document.querySelector('[data-latest-posts]');
  try {
    const posts = await latestPostsRequest;
    box.innerHTML = posts.length
      ? posts
          .map(
            (p) => `<article class="entry">
              <time class="entry__date" datetime="${esc(p.date)}">${shortDate(p.date)}</time>
              <div class="entry__body">
                ${p.cover ? `<a class="entry__thumb" href="/blog/${esc(p.slug)}" tabindex="-1" aria-hidden="true"><img src="${esc(thumb(p.cover, 400))}" alt="" loading="lazy" decoding="async"></a>` : ''}
                <div>
                  <h3 class="entry__title"><a href="/blog/${esc(p.slug)}">${esc(p.title)}</a></h3>
                  ${p.excerpt ? `<p class="entry__excerpt">${esc(p.excerpt)}</p>` : ''}
                </div>
              </div>
              <span class="entry__meta">${p.readingTime} menit baca</span>
            </article>`
          )
          .join('')
      : `<div class="empty"><h3>Belum ada tulisan</h3><p>Tulisan yang kamu terbitkan dari panel admin akan muncul di sini.</p></div>`;
  } catch {
    box.innerHTML = `<div class="empty"><h3>Tulisan gagal dimuat</h3><p>Coba muat ulang halaman ini.</p></div>`;
  }
})();
