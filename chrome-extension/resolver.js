/*
 * Injected (via chrome.scripting.executeScript) into the page's isolated
 * world. Defines globalThis.__RQIS with the logic used to find the
 * highest-quality version of every image on the page.
 *
 * Re-injecting this file is safe/idempotent — it just redefines the object.
 */
(function () {
  const RESIZE_QUERY_KEYS = [
    'w', 'h', 'width', 'height', 'resize', 'size', 'quality', 'q',
    'fit', 'crop', 'dpr', 'sharp', 'scale', 'zoom', 'imwidth', 'imheight'
  ];

  // Site-specific URL upgrade rules. Each returns zero or more candidate
  // URLs (strings) that are worth trying, without knowing yet whether the
  // upgrade will actually resolve to something valid.
  const SITE_RULES = [
    // Twitter / X media — name=small|medium|large -> name=orig
    {
      test: (u) => /(^|\.)twimg\.com$/.test(u.hostname),
      transform: (u) => {
        const c = new URL(u.toString());
        c.searchParams.set('name', 'orig');
        return [c.toString()];
      }
    },
    // Google user content (avatars, drive thumbnails, blogger, etc.)
    {
      test: (u) => /googleusercontent\.com$/.test(u.hostname),
      transform: (u) => {
        const s = u.toString();
        if (/=[\w-]+$/.test(s)) {
          return [s.replace(/=[\w-]+$/, '=s0'), s.replace(/=[\w-]+$/, '')];
        }
        return [s + '=s0'];
      }
    },
    // Pinterest — /236x/, /474x/, /736x/ -> /originals/
    {
      test: (u) => /pinimg\.com$/.test(u.hostname),
      transform: (u) => [u.toString().replace(/\/\d+x(?:\d+)?\//, '/originals/')]
    },
    // Shopify CDN — strip _NNNxNNN / _NNNx size suffix before the extension
    {
      test: (u) => /cdn\.shopify\.com$/.test(u.hostname),
      transform: (u) => [u.toString().replace(/_(\d+x\d*|\d*x\d+)(?=\.[a-zA-Z]+(?:\?|$))/, '')]
    },
    // Amazon product images — strip ._SX300_, ._SL1500_, ._AC_UL200_ etc.
    {
      test: (u) => /(ssl-images-amazon\.com|media-amazon\.com)$/.test(u.hostname),
      transform: (u) => [u.toString().replace(/\._(?:[A-Z]{2}\d*_?)+_/, '')]
    },
    // Wikimedia — thumbnail path -> original
    {
      test: (u) => /upload\.wikimedia\.org$/.test(u.hostname) && u.pathname.includes('/thumb/'),
      transform: (u) => {
        const parts = u.pathname.split('/');
        const thumbIdx = parts.indexOf('thumb');
        if (thumbIdx === -1) return [];
        const rebuilt = parts.slice(0, thumbIdx).concat(parts.slice(thumbIdx + 1, parts.length - 1));
        const c = new URL(u.toString());
        c.pathname = rebuilt.join('/');
        return [c.toString()];
      }
    },
    // Imgur — strip the size-letter suffix (s/b/t/m/l/h) before the extension
    {
      test: (u) => /(^|\.)imgur\.com$/.test(u.hostname),
      transform: (u) => [u.toString().replace(/([a-zA-Z0-9]{5,})[bsthlm](\.[a-zA-Z]+)(\?.*)?$/, '$1$2$3')]
    },
    // Squarespace CDN — bump/strip the format=NNNw size param
    {
      test: (u) => /squarespace-cdn\.com$/.test(u.hostname) || /static\d*\.squarespace\.com$/.test(u.hostname),
      transform: (u) => {
        const c = new URL(u.toString());
        c.searchParams.set('format', '2500w');
        const stripped = new URL(u.toString());
        stripped.searchParams.delete('format');
        return [c.toString(), stripped.toString()];
      }
    },
    // Wix — remove the /v1/fill/w_NNN,h_NNN,.../ transform segment
    {
      test: (u) => /wixstatic\.com$/.test(u.hostname) && u.pathname.includes('/v1/fill/'),
      transform: (u) => {
        const c = new URL(u.toString());
        c.pathname = c.pathname.replace(/\/v1\/fill\/[^/]+\//, '/');
        return [c.toString()];
      }
    }
  ];

  function stripResizeQuery(u) {
    if ([...u.searchParams.keys()].length === 0) return null;
    const c = new URL(u.toString());
    let changed = false;
    for (const key of RESIZE_QUERY_KEYS) {
      if (c.searchParams.has(key)) {
        c.searchParams.delete(key);
        changed = true;
      }
    }
    return changed ? c.toString() : null;
  }

  function stripWordpressSuffix(u) {
    const m = u.pathname.match(/^(.*)-\d+x\d+(\.[a-zA-Z]+)$/);
    if (!m) return null;
    const c = new URL(u.toString());
    c.pathname = m[1] + m[2];
    return c.toString();
  }

  function generateCandidates(rawUrl) {
    let u;
    try {
      u = new URL(rawUrl, document.baseURI);
    } catch (e) {
      return [rawUrl];
    }
    const candidates = new Set([u.toString()]);

    const stripped = stripResizeQuery(u);
    if (stripped) candidates.add(stripped);

    const wp = stripWordpressSuffix(u);
    if (wp) candidates.add(wp);

    for (const rule of SITE_RULES) {
      try {
        if (rule.test(u)) {
          for (const cand of rule.transform(u) || []) {
            if (cand) candidates.add(cand);
          }
        }
      } catch (e) {
        // ignore a misbehaving rule, keep going
      }
    }

    return [...candidates];
  }

  function loadImageInfo(url, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const img = new Image();
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve(null);
      }, timeoutMs);
      img.onload = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ url, width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(null);
      };
      img.referrerPolicy = 'no-referrer-when-downgrade';
      img.src = url;
    });
  }

  function parseSrcset(srcset, baseUrl) {
    if (!srcset) return [];
    return srcset.split(',').map((entry) => {
      const parts = entry.trim().split(/\s+/);
      const url = parts[0];
      let width = 0;
      if (parts[1]) {
        if (parts[1].endsWith('w')) width = parseInt(parts[1], 10) || 0;
        else if (parts[1].endsWith('x')) width = (parseFloat(parts[1]) || 1) * 1000; // density hint, rough ordering
      }
      let abs = url;
      try { abs = new URL(url, baseUrl).toString(); } catch (e) {}
      return { url: abs, width };
    }).filter((e) => e.url);
  }

  async function pickBestForUrl(originalUrl, extraCandidates = [], timeoutMs = 4500) {
    const candidateUrls = new Set(generateCandidates(originalUrl));
    for (const c of extraCandidates) if (c) candidateUrls.add(c);

    const results = await Promise.all(
      [...candidateUrls].map((u) => loadImageInfo(u, timeoutMs))
    );
    const valid = results.filter(Boolean);
    if (valid.length === 0) return { url: originalUrl, width: 0, height: 0, improved: false };

    valid.sort((a, b) => (b.width * b.height) - (a.width * a.height));
    const best = valid[0];
    const originalInfo = valid.find((v) => v.url === originalUrl);
    const improved = !originalInfo || (best.url !== originalUrl && best.width * best.height > originalInfo.width * originalInfo.height);
    return { url: best.url, width: best.width, height: best.height, improved };
  }

  function bestSrcsetCandidate(imgEl) {
    const fromImg = parseSrcset(imgEl.getAttribute('srcset'), document.baseURI);
    let fromSource = [];
    const picture = imgEl.closest('picture');
    if (picture) {
      picture.querySelectorAll('source').forEach((s) => {
        fromSource = fromSource.concat(parseSrcset(s.getAttribute('srcset'), document.baseURI));
      });
    }
    const all = fromImg.concat(fromSource);
    if (all.length === 0) return null;
    all.sort((a, b) => b.width - a.width);
    return all[0].url;
  }

  function lazyLoadCandidate(el) {
    const attrs = ['data-src', 'data-original', 'data-full', 'data-large', 'data-lazy-src', 'data-hi-res-src'];
    for (const a of attrs) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v) {
        try { return new URL(v, document.baseURI).toString(); } catch (e) {}
      }
    }
    return null;
  }

  function collectImageElements() {
    const items = [];
    const seenUrls = new Set();

    document.querySelectorAll('img').forEach((img) => {
      const src = img.currentSrc || img.src;
      if (!src || src.startsWith('data:')) return;
      let abs;
      try { abs = new URL(src, document.baseURI).toString(); } catch (e) { return; }
      if (seenUrls.has(abs)) return;
      seenUrls.add(abs);
      items.push({
        originalUrl: abs,
        thumb: abs,
        extra: [bestSrcsetCandidate(img), lazyLoadCandidate(img)].filter(Boolean),
        w: img.naturalWidth || img.width || 0,
        h: img.naturalHeight || img.height || 0,
        alt: img.alt || ''
      });
    });

    // CSS background-images on reasonably large elements
    const all = document.querySelectorAll('body *');
    for (const el of all) {
      if (items.length > 400) break; // sanity cap for very heavy pages
      const rect = el.getBoundingClientRect();
      if (rect.width < 60 || rect.height < 60) continue;
      const bg = getComputedStyle(el).backgroundImage;
      const m = bg && bg.match(/url\(["']?([^"')]+)["']?\)/);
      if (!m) continue;
      let abs;
      try { abs = new URL(m[1], document.baseURI).toString(); } catch (e) { continue; }
      if (abs.startsWith('data:') || seenUrls.has(abs)) continue;
      seenUrls.add(abs);
      items.push({
        originalUrl: abs,
        thumb: abs,
        extra: [],
        w: 0,
        h: 0,
        alt: el.getAttribute('aria-label') || ''
      });
    }

    return items;
  }

  async function scanPage(onItem) {
    const rawItems = collectImageElements();
    const results = [];
    const CONCURRENCY = 5;
    let idx = 0;

    async function worker() {
      while (idx < rawItems.length) {
        const i = idx++;
        const item = rawItems[i];
        const best = await pickBestForUrl(item.originalUrl, item.extra);
        const resolved = {
          id: i,
          thumb: item.thumb,
          originalUrl: item.originalUrl,
          bestUrl: best.url,
          width: best.width || item.w,
          height: best.height || item.h,
          improved: best.improved,
          alt: item.alt
        };
        results.push(resolved);
        if (typeof onItem === 'function') {
          try { onItem(resolved); } catch (e) {}
        }
      }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, rawItems.length) }, worker);
    await Promise.all(workers);
    return results;
  }

  globalThis.__RQIS = { generateCandidates, pickBestForUrl, scanPage, collectImageElements };
})();
