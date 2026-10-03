(async function () {
  const box = document.querySelector('[data-article]');
  const slug = decodeURIComponent(
    location.pathname.split('/').filter(Boolean).pop() || ''
  );

  api.get('/api/site')
    .then((site) => {
      paintSite(site);

      const socials = document.querySelector('[data-socials]');

      if (socials) {
        socials.innerHTML = (site.socials || [])
          .filter((s) => s.label && s.url)
          .map(
            (s) =>
              `<li>
                <a href="${esc(s.url)}"
                   target="_blank"
                   rel="noopener">
                  ${esc(s.label)}
                </a>
              </li>`
          )
          .join('');
      }
    })
    .catch(() => {});

  function toHTML(markdown) {
    const raw = window.marked
      ? marked.parse(markdown || '')
      : `<p>${esc(markdown)}</p>`;

    return window.DOMPurify
      ? DOMPurify.sanitize(raw)
      : raw;
  }

  try {
    const post = await api.get(
      `/api/posts/${encodeURIComponent(slug)}`
    );

    document.title = `${post.title} — Tulisan`;

    const desc = document.createElement('meta');
    desc.name = 'description';
    desc.content = post.excerpt || post.title;
    document.head.appendChild(desc);

    box.innerHTML = `
      <div class="article__head">

        <a class="entry__date" href="/blog">
          Kembali ke daftar tulisan
        </a>

        <h1 class="article__title">
          ${esc(post.title)}
        </h1>

      </div>

      <div class="article__meta">

        <time datetime="${esc(post.date)}">
          ${formatDate(post.date)}
        </time>

        <span>
          ${post.readingTime} menit baca
        </span>

        ${
          (post.tags || []).length
            ? `<span>${post.tags.map(esc).join(', ')}</span>`
            : ''
        }

        ${
          post.status !== 'published'
            ? '<span>Draf — hanya terlihat olehmu</span>'
            : ''
        }

      </div>

      <div class="prose">
        ${toHTML(post.content)}
      </div>

      <nav class="pager">

        ${
          post.prev
            ? `
              <a href="/blog/${esc(post.prev.slug)}">
                <small>Tulisan sebelumnya</small>
                <strong>${esc(post.prev.title)}</strong>
              </a>
            `
            : `
              <span>
                <small>Tulisan sebelumnya</small>
                <strong>Ini yang paling baru</strong>
              </span>
            `
        }

        ${
          post.next
            ? `
              <a href="/blog/${esc(post.next.slug)}">
                <small>Tulisan berikutnya</small>
                <strong>${esc(post.next.title)}</strong>
              </a>
            `
            : `
              <span>
                <small>Tulisan berikutnya</small>
                <strong>Ini yang paling lama</strong>
              </span>
            `
        }

      </nav>
    `;

    /*
     * Optimasi gambar yang memang ada
     * di dalam isi artikel.
     */
    box.querySelectorAll('.prose img').forEach((img) => {
      img.loading = 'lazy';

      const src = img.getAttribute('src');

      if (src) {
        img.src = thumb(src, 1400);
      }
      img.decoding = 'async';
    });

  } catch (err) {
    console.error(err);

    box.innerHTML = `
      <div class="empty">

        <h3>Tulisan tidak ditemukan</h3>

        <p>
          Alamatnya mungkin salah atau tulisannya
          sudah dihapus.
        </p>

        <p style="margin-top:1rem">

          <a class="btn btn--ghost" href="/blog">
            Lihat semua tulisan
          </a>

        </p>

      </div>
    `;
  }
})();
