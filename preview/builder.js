/*!
 * Zerno Grinder Builder
 * Visual grinder configurator for the Zerno storefront (theme app extension). Works for any grinder in the
 * catalog: with layered overlay art it recolors the photo and animates parts; without it, it runs in photo mode.
 * Reads its data from the JSON the Liquid block renders, draws the selected
 * wood onto the grinder photo with canvas blend modes, and adds every selected
 * variant to the cart in a single /cart/add.js request.
 */
(() => {
  'use strict';

  /* Overlay geometry and art come from the grinder's catalog entry (shared/catalog). Without them the builder runs in photo mode. */
  const NO_ART = { box: [1000, 1000], shadeMax: 1.4 };
  const FINISH_DOTS = { black: '#141517', white: '#e9e9e6', grey: '#7c7f84', gray: '#7c7f84', silver: '#c9ccd1' };
  const STEP_NAMES = ['Finish', 'Burrs', 'Accents', 'Accessories'];
  const STAGE_NOTES = ['Your grinder', 'Burr choices', 'Accent piece & funnel cap', 'Accessories'];
  // stage % placement of the grinder for each step
  const RIG = [{ h: 80, cx: 50, top: 10 }, { h: 52, cx: 50, top: 44 }, { h: 150, left: 7, top: 4 }, { h: 60, cx: 52, top: 27 }];
  const PROP_SLOTS = [{ left: '-1%', width: '50%', bottom: '15%' }, { left: '5%', width: '20%', bottom: '6%', zIndex: 2 }];
  // included items laid out on the right side of the grinder on the accessories step
  const INCLUDED_SLOTS = { spray: { left: '76%', width: '5.6%', bottom: '21%' }, tools: { left: '82%', width: '15%', bottom: '19%' }, brush: { left: '61%', width: '30%', bottom: '13%', zIndex: 2 } };

  // Tell the theme the cart changed so its cart icon and drawer update (Horizon listens for cart:update;
  // other themes for cart:refresh or a [data-cart-count] element).
  const refreshThemeCart = async (source) => {
    let cart = null;
    try { cart = await (await fetch((window.Shopify && window.Shopify.routes && window.Shopify.routes.root || '/') + 'cart.js', { headers: { Accept: 'application/json' } })).json(); } catch (e) { /* the add worked; the count just will not refresh */ }
    const n = cart ? cart.item_count : null;
    const ev = (name, detail) => { try { document.dispatchEvent(new CustomEvent(name, { bubbles: true, detail })); } catch (e) { /* ignore */ } };
    ev('cart:update', { resource: cart, sourceId: source, data: { source, itemCount: n } });
    ev('cart:refresh', { cart });
    if (n != null) document.querySelectorAll('[data-cart-count], .cart-count-bubble span[aria-hidden="true"], .cart-bubble__text-count').forEach((el) => { el.textContent = n; });
    return cart;
  };
  const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const imgCache = new Map();
  function loadImg(url) {
    if (!url) return Promise.reject(new Error('no url'));
    if (!imgCache.has(url)) {
      imgCache.set(url, new Promise((res, rej) => {
        const i = new Image();
        i.decoding = 'async';
        i.onload = () => res(i);
        i.onerror = () => { imgCache.delete(url); rej(new Error('load failed: ' + url)); };
        i.src = url;
      }));
    }
    return imgCache.get(url);
  }

  /* mix two #rrggbb colors: t = 0 gives a, 1 gives b */
  function mix(a, b, t) {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)), A = p(a), B = p(b);
    return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
  }
  /* Texture square for an accent piece or funnel cap. tex (catalog.textures, set in the Art studio):
     { src, crop: [x, y, w, h] fractions of the photo, rot: degrees }. Without it: the center square times crop. */
  function texSquare(img, tex, crop) {
    const nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height;
    let sx, sy, sw, sh;
    if (tex && Array.isArray(tex.crop) && tex.crop.length === 4) { sx = tex.crop[0] * nw; sy = tex.crop[1] * nh; sw = tex.crop[2] * nw; sh = tex.crop[3] * nh; }
    else { const side = Math.min(nw, nh) * (crop || 1); sx = (nw - side) / 2; sy = (nh - side) / 2; sw = sh = side; }
    const T = Math.max(64, Math.min(1024, Math.round(Math.max(sw, sh))));
    const c = document.createElement('canvas'); c.width = c.height = T;
    const x = c.getContext('2d'), r = ((tex && +tex.rot) || 0) * Math.PI / 180;
    x.translate(T / 2, T / 2);
    if (r) { x.rotate(r); const k = Math.abs(Math.cos(r)) + Math.abs(Math.sin(r)); x.scale(k, k); }  // no empty corners after turning
    x.drawImage(img, sx, sy, sw, sh, -T / 2, -T / 2, T, T);
    return c;
  }
  /* Stretch and mold: draw src through a mesh. mesh = { n, pts }, (n+1)^2 points row by row, as fractions of W x H.
     Point (i, j) is where the source grid point (i/n, j/n) lands. Two affine triangles per cell. */
  function drawMesh(ctx, src, mesh, W, H, sx = 0, sy = 0, sw = src.width, sh = src.height) {
    const n = mesh.n, P = mesh.pts, at = (i, j) => P[j * (n + 1) + i];
    const S = (i, j) => [sx + (i / n) * sw, sy + (j / n) * sh], D = (i, j) => [at(i, j)[0] * W, at(i, j)[1] * H];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      meshTri(ctx, src, S(i, j), S(i + 1, j), S(i + 1, j + 1), D(i, j), D(i + 1, j), D(i + 1, j + 1));
      meshTri(ctx, src, S(i, j), S(i + 1, j + 1), S(i, j + 1), D(i, j), D(i + 1, j + 1), D(i, j + 1));
    }
  }
  function meshTri(ctx, img, s0, s1, s2, d0, d1, d2) {
    const [x0, y0] = s0, [x1, y1] = s1, [x2, y2] = s2, [u0, v0] = d0, [u1, v1] = d1, [u2, v2] = d2;
    const den = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1);
    if (!den) return;
    const cx = (u0 + u1 + u2) / 3, cy = (v0 + v1 + v2) / 3;
    const grow = (u, v) => { const dx = u - cx, dy = v - cy, l = Math.hypot(dx, dy) || 1; return [u + dx / l * 0.75, v + dy / l * 0.75]; };  // hides seams
    ctx.save(); ctx.beginPath(); ctx.moveTo(...grow(u0, v0)); ctx.lineTo(...grow(u1, v1)); ctx.lineTo(...grow(u2, v2)); ctx.closePath(); ctx.clip();
    ctx.transform(
      (u0 * (y1 - y2) + u1 * (y2 - y0) + u2 * (y0 - y1)) / den, (v0 * (y1 - y2) + v1 * (y2 - y0) + v2 * (y0 - y1)) / den,
      (u0 * (x2 - x1) + u1 * (x0 - x2) + u2 * (x1 - x0)) / den, (v0 * (x2 - x1) + v1 * (x0 - x2) + v2 * (x1 - x0)) / den,
      (u0 * (x1 * y2 - x2 * y1) + u1 * (x2 * y0 - x0 * y2) + u2 * (x0 * y1 - x1 * y0)) / den,
      (v0 * (x1 * y2 - x2 * y1) + v1 * (x2 * y0 - x0 * y2) + v2 * (x0 * y1 - x1 * y0)) / den);
    ctx.drawImage(img, 0, 0); ctx.restore();
  }

  class Builder {
    constructor(root) {
      this.root = root;
      this.C = JSON.parse(root.querySelector('script[data-zb-config]').textContent);
      const C = this.C;
      if (window.ZernoCatalog) window.ZernoCatalog.applyToBuilder(C);   // grinder, art, burr details and included items
      this.money = this.makeMoney();
      this.osReduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.storeKey = 'zb:' + C.grinder.id;
      this.AG = C.geom || NO_ART;                           // overlay geometry for this grinder's photos
      root.dataset.zbBlock = C.blockId;

      // ---------- normalise data ----------
      const st0 = C.settings;
      const list = (txt) => new Set(String(txt || '').split(',').map((x) => slug(x)).filter(Boolean));
      const pairs = (txt) => Object.fromEntries(String(txt || '').split(/\r?\n/).map((l) => l.split(':')).filter((p) => p.length >= 2 && p[0].trim())
        .map(([k, ...rest]) => [slug(k), rest.join(':').trim()]));
      this.finishText = pairs(st0.finishText);
      this.finishSwatch = pairs(st0.finishSwatches);
      const hideFin = list(st0.hideFinishes), hideBurr = list(st0.hideBurrs), hideAcc = list(st0.hideAccents), hideCap = list(st0.hideCaps);
      // ---------- option set from the Zerno Builder admin: it wins over the block settings ----------
      const OS = C.os && typeof C.os === 'object' ? C.os : null;
      const G = (k) => (OS && OS.groups && OS.groups[k]) || {};
      this.G = G;
      if (OS) {
        Object.entries(G('finish').values || {}).forEach(([k, v]) => {
          k = slug(k); if (!v) return;
          if (typeof v.text === 'string') this.finishText[k] = v.text;
          if (v.swatch) this.finishSwatch[k] = v.swatch;
          if (v.hidden) hideFin.add(k);
        });
        if ('multiple' in G('burrs')) st0.allowSpareBurrs = !!G('burrs').multiple;
        const ex = [G('accents').multiple, G('caps').multiple].filter((x) => typeof x === 'boolean');
        if (ex.length) st0.allowExtras = ex.some(Boolean);
        if ('allowNone' in G('caps')) st0.capOptional = !!G('caps').allowNone;
        if (typeof G('finish').help === 'string') st0.intro = G('finish').help;
        if (typeof G('accessories').help === 'string') st0.includedNote = G('accessories').help;
        if (OS.heading) st0.heading = OS.heading;
        const IT = OS.items || {};
        const over = (arr, key) => (arr || []).filter((x) => !(IT[x[key]] && IT[x[key]].hidden)).map((x) => {
          const o = IT[x[key]]; if (!o) return x;
          const y = { ...x, raw: x.title, help: o.help || '', badge: o.badge || '' };
          if (o.label) { y.title = o.label; if ('short' in y && !y.short) y.short = o.label; }
          if (o.help && 'blurb' in y) y.blurb = o.help;
          if (typeof o.group === 'string' && 'group' in x) y.group = o.group.trim();
          return y;
        });
        C.burrs = over(C.burrs, 'id'); C.accents = over(C.accents, 'id'); C.caps = over(C.caps, 'id'); C.accessories = over(C.accessories, 'variantId');
      }
      const T = (k, f, d) => { const v = G(k)[f]; return typeof v === 'string' && v.trim() ? v.trim() : d; };
      this.T = {
        steps: [T('finish', 'label', 'Finish'), T('burrs', 'label', 'Burrs'), T('accents', 'step', 'Accents'), T('accessories', 'label', 'Accessories')],
        titles: [T('finish', 'title', 'Choose your finish'), T('burrs', 'title', 'Pick your burrs'), T('accents', 'title', 'Finish the details'), T('accessories', 'title', 'Add accessories')],
        burrHelp: T('burrs', 'help', ''), accName: T('accents', 'label', 'Accent piece'), accHelp: T('accents', 'help', ''),
        capName: T('caps', 'label', 'Funnel cap'), capHelp: T('caps', 'help', ''), noCap: T('caps', 'noneLabel', 'No cap'),
        max: { burrs: +G('burrs').max || 0, accents: +G('accents').max || 0, caps: +G('caps').max || 0, accessories: +G('accessories').max || 0 }
      };
      const ci0 = Math.max(0, C.grinder.options.findIndex((o) => /colou?r|finish/i.test(o.name)));
      const keepV = C.grinder.variants.filter((v) => !hideFin.has(slug(v.options[ci0])));
      if (keepV.length) {                                   // never hide every color
        C.grinder.variants = keepV;
        C.grinder.options[ci0].values = C.grinder.options[ci0].values.filter((x) => !hideFin.has(slug(x)));
      }
      C.grinder.variants.forEach((v) => {
        const k = slug(v.options[ci0]);
        if (k in this.finishText) v.blurb = this.finishText[k] || null;      // block setting or catalog text; an empty value hides the line
      });
      C.burrs = C.burrs.filter((b) => !hideBurr.has(slug(b.title)) && !hideBurr.has(slug(b.title.replace(/\s+Blind$/i, ''))));
      C.accents = C.accents.filter((a) => !hideAcc.has(slug(a.title)));
      C.caps = C.caps.filter((c) => !hideCap.has(slug(c.title)));
      this.burrs = C.burrs.map((b) => ({
        ...b,
        name: b.title.replace(/\s+Blind$/i, ''),
        short: b.short || b.title.replace(/^SSP\s+/i, '').replace(/\s*\([^)]*\)/g, '').replace(/\s+Blind$/i, '').trim(),
        srcs: [b.flat, b.flatAsset, b.image, window.ZernoCatalog && window.ZernoCatalog.placeholderBurr()].filter(Boolean)
      }));
      this.accents = C.accents.filter((a) => a.image);
      this.caps = C.caps.filter((c) => c.image);
      this.accs = C.accessories.map((a) => ({ ...a, blurb: a.blurb || a.desc || '' }));
      // a grinder with nothing to pick on a step (a new grinder with no accent pieces yet) skips it
      this.skip = new Set([...(this.burrs.length ? [] : [1]), ...(this.accents.length || this.caps.length ? [] : [2])]);
      this.shown = [0, 1, 2, 3].filter((i) => !this.skip.has(i));
      const g = C.grinder;
      const ci = g.options.findIndex((o) => /colou?r|finish/i.test(o.name));
      this.ci = ci < 0 ? 0 : ci;

      // ---------- state ----------
      const firstVariant = g.variants.find((v) => v.available) || g.variants[0];
      const pick = (arr, id) => arr.find((x) => String(x.id) === String(id) && x.available);
      const firstAccent = pick(this.accents, G('accents').default) || this.accents.find((a) => a.available) || this.accents[0];
      this.S = {
        step: 0, seen: 0,
        opts: firstVariant.options.slice(),
        burrs: [],
        accent: firstAccent ? firstAccent.id : null,
        cap: G('caps').default === 'none' && C.settings.capOptional ? 'none' : (pick(this.caps, G('caps').default) || {}).id || (C.settings.capOptional ? 'none' : ((this.caps.find((c) => c.available) || this.caps[0] || {}).id || 'none')),
        accSpare: [], capSpare: [], acc: []
      };
      this.restore();
      this.reduce = false; // animations always play

      this.applyColors();
      this.render();
      this.bind();
      this.go(0, true);
    }

    /* "Match my theme": read the real background and text colors around the block */
    applyColors() {
      if (this.root.dataset.zbColors !== 'theme') return;
      const parse = (v) => { const m = String(v).match(/[\d.]+/g); return m && m.length >= 3 ? { r: +m[0], g: +m[1], b: +m[2], a: m.length > 3 ? +m[3] : 1 } : null; };
      let el = this.root.parentElement, bg = null;
      while (el) { const c = parse(getComputedStyle(el).backgroundColor); if (c && c.a > 0.5) { bg = c; break; } el = el.parentElement; }
      bg = bg || { r: 255, g: 255, b: 255 };
      const fg = parse(getComputedStyle(this.root.parentElement || document.body).color) || { r: 20, g: 20, b: 20 };
      const lum = (c) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
      const dark = lum(bg) < 0.5, rgb = (c) => `rgb(${c.r}, ${c.g}, ${c.b})`;
      const mix = (a, b, t) => ({ r: Math.round(a.r + (b.r - a.r) * t), g: Math.round(a.g + (b.g - a.g) * t), b: Math.round(a.b + (b.b - a.b) * t) });
      const st = this.root.style;
      st.setProperty('--zb-ink', rgb(bg));
      st.setProperty('--zb-fg', rgb(fg));
      // the grinder stage sits a step darker than the page on light themes, a step lighter on dark ones
      st.setProperty('--zb-stage', rgb(mix(bg, dark ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 }, dark ? 0.06 : 0.05)));
      st.setProperty('--zb-scheme', dark ? 'dark' : 'light');
    }

    /* ---------- helpers ---------- */
    makeMoney() {
      const { currency, locale } = this.C.shop;
      const whole = new Intl.NumberFormat(locale || 'en-US', { style: 'currency', currency: currency || 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
      const exact = new Intl.NumberFormat(locale || 'en-US', { style: 'currency', currency: currency || 'USD' });
      return (cents) => (cents % 100 === 0 ? whole : exact).format(cents / 100);
    }
    q(name) { return this.root.querySelector(`[data-r="${name}"]`); }
    variant() {
      const vs = this.C.grinder.variants;
      return vs.find((v) => v.options.every((o, i) => o === this.S.opts[i])) || vs[0];
    }
    finishSlug(v = this.variant()) { return slug(v.options[this.ci]); }
    art(v = this.variant()) {
      const s = this.finishSlug(v);
      return this.C.art[s] && this.AG[s] ? { slug: s, urls: this.C.art[s], geom: this.AG[s] } : null;
    }
    burr(id) { return this.burrs.find((b) => b.id === id); }
    accent(id) { return this.accents.find((a) => a.id === id); }
    cap(id) { return this.caps.find((c) => c.id === id); }
    save() {
      if (this.C.preview) return;
      try {
        const { step, seen, ...rest } = this.S;
        localStorage.setItem(this.storeKey, JSON.stringify(rest));
      } catch (e) { /* storage blocked */ }
    }
    restore() {
      if (this.C.preview) return;
      let s; try { s = JSON.parse(localStorage.getItem(this.storeKey) || 'null'); } catch (e) { s = null; }
      if (!s) return;
      const S = this.S, g = this.C.grinder;
      if (Array.isArray(s.opts) && g.variants.some((v) => v.options.every((o, i) => o === s.opts[i]))) S.opts = s.opts;
      if (Array.isArray(s.burrs)) S.burrs = s.burrs.filter((id) => this.burr(id));
      if (this.accent(s.accent)) S.accent = s.accent;
      if (s.cap === 'none' ? this.C.settings.capOptional : this.cap(s.cap)) S.cap = s.cap;
      if (Array.isArray(s.accSpare)) S.accSpare = s.accSpare.filter((id) => this.accent(id) && id !== S.accent);
      if (Array.isArray(s.capSpare) && S.cap !== 'none') S.capSpare = s.capSpare.filter((id) => this.cap(id) && id !== S.cap);
      if (Array.isArray(s.acc)) S.acc = s.acc.filter((id) => this.accs.some((a) => a.productId === id))
        .filter((id, i, arr) => { const g = this.accGroup(id); return !g || !arr.slice(0, i).some((o) => this.accGroup(o) === g); });
      if (!this.C.settings.allowSpareBurrs) S.burrs = S.burrs.slice(0, 1);
      if (!this.C.settings.allowExtras) { S.accSpare = []; S.capSpare = []; }
    }
    texStyle(url, crop) { return `background-image:url('${String(url).replace(/'/g, '%27')}');background-size:${(100 / crop).toFixed(2)}%`; }

    /* one finish photo, cut to the body or the front assembly (masks are lossless PNGs, the photo is a JPG) */
    finLayer(s, part) {
      const u = this.C.art[s], src = u[part] || (part === 'body' ? u.mask : null);
      if (!src) return '';                                   // no front assembly: the whole grinder is the body
      const m = `url('${String(src).replace(/'/g, '%27')}')`;
      return `<div class="zb-fin zb-fin-${part}" data-base="${s}" style="opacity:0;-webkit-mask-image:${m};mask-image:${m}"><img class="zb-photo" alt="" src="${esc(u.photo)}"></div>`;
    }
    showFinish(slug) { this.root.querySelectorAll('.zb-fin').forEach((el) => { el.style.opacity = el.dataset.base === slug ? '1' : '0'; }); }

    /* ---------- DOM ---------- */
    render() {
      const C = this.C, st = C.settings;
      const finishes = [...new Set(C.grinder.variants.map((v) => v.options[this.ci]))];
      const artSlugs = [...new Set(C.grinder.variants.map((v) => this.finishSlug(v)))].filter((s) => C.art[s] && this.AG[s]);
      this.root.innerHTML = `
        <header class="zb-head">
          <h2>${esc(st.heading || 'Build your grinder')}</h2>
          <div class="zb-hr">
            <ol class="zb-steps" data-r="steps"></ol>
          </div>
        </header>
        <div class="zb-grid">
          <div class="zb-stage" data-r="stage" aria-label="Grinder preview">
            <div class="zb-floor"></div>
            <div class="zb-note" data-r="note"></div>
            <div class="zb-props" data-r="props"></div>
            <div class="zb-rig" data-r="rig"><div class="zb-frame" data-r="frame" style="aspect-ratio:${this.AG.box[0]}/${this.AG.box[1]}">
              ${artSlugs.map((s) => this.finLayer(s, 'body')).join('')}
              <img class="zb-fallback" data-r="fallback" alt="" hidden>
              <div class="zb-spray" data-r="spray"></div><div class="zb-haze" data-r="haze"></div>
              <div class="zb-chamber" data-r="chamber"><i></i></div>
              <div class="zb-front" data-r="front">
              ${artSlugs.map((s) => this.finLayer(s, 'front')).join('')}
              <canvas class="zb-ov" data-r="knobA"></canvas><canvas class="zb-ov" data-r="knobB" style="opacity:0"></canvas>
              <canvas class="zb-ov" data-r="capA"></canvas><canvas class="zb-ov" data-r="capB" style="opacity:0"></canvas>
              <img class="zb-ov" data-r="capNone" alt="" style="opacity:0">
              <div class="zb-ring" data-r="ring"></div>
              </div>
            </div></div>
            <div class="zb-arc" data-r="arc" data-on="0"></div>
            <div class="zb-tray" data-r="tray" hidden><span class="tl">Spare sets</span><div class="ts" data-r="traySlots"></div></div>
            <div class="zb-tray right" data-r="tray2" hidden><span class="tl">Extra pieces in the box</span><div class="ts" data-r="tray2Slots"></div></div>
            <div class="zb-chip" data-r="chip" role="status" aria-live="polite"></div>
          </div>
          <div class="zb-rail">
            <section data-step="0">
              <p class="zb-eyebrow">Step 1 of 4</p>
              <h3>${esc(this.T.titles[0])}</h3>
              ${st.intro ? `<p class="zb-lede">${esc(st.intro)}</p>` : ''}
              <div data-r="finishOpts"></div>
              <div data-r="otherOpts"></div>
            </section>
            <section data-step="1">
              <p class="zb-eyebrow">Step 2 of 4</p>
              <h3>${esc(this.T.titles[1])}</h3>
              <p class="zb-lede">${this.T.burrHelp ? esc(this.T.burrHelp) : st.allowSpareBurrs ? 'Your first pick ships installed. Tap more to add spare sets for switching between espresso and pour over. Tap a burr again to remove it.' : 'Tap a burr to install it.'}</p>
              ${st.burrGuide !== false && C.guideJs && C.grinderCfg && this.burrs.length ? '<button type="button" class="zb-help" data-r="help"><span>?</span>Not sure? Help me choose</button>' : ''}
              <div data-r="burrOpts"></div>
            </section>
            <section data-step="2">
              <p class="zb-eyebrow">Step 3 of 4</p>
              <h3>${esc(this.T.titles[2])}</h3>
              <p class="zb-lede">Tap a wood to see it on your grinder.${st.allowExtras ? ' Want more than one? Add extras below each row; they ship in the box so you can swap them anytime.' : ''}</p>
              <div class="zb-group"><h4>${esc(this.T.accName)} <span>On the grinder · required</span></h4>${this.T.accHelp ? `<p class="zb-gh">${esc(this.T.accHelp)}</p>` : ''}<div class="zb-sw" data-r="accentOpts"></div>
                ${st.allowExtras ? '<div class="zb-spr"><span class="sl">Add extra accent pieces to swap in later</span><div class="row" data-r="accSpare"></div></div>' : ''}</div>
              ${this.caps.length ? `<div class="zb-group"><h4>${esc(this.T.capName)} <span>On the grinder · ${st.capOptional ? 'optional' : 'required'}</span></h4>${this.T.capHelp ? `<p class="zb-gh">${esc(this.T.capHelp)}</p>` : ''}<div class="zb-sw" data-r="capOpts"></div>
                ${st.allowExtras ? '<div class="zb-spr"><span class="sl" data-r="capSpareLbl">Add extra funnel caps</span><div class="row" data-r="capSpare"></div></div>' : ''}</div>` : ''}
            </section>
            <section data-step="3">
              <p class="zb-eyebrow">Step 4 of 4</p>
              <h3>${esc(this.T.titles[3])}</h3>
              ${st.includedNote ? `<p class="zb-lede">${esc(st.includedNote)}</p>` : ''}
              ${st.showIncluded && C.included && C.included.length ? `<div class="zb-incl">${C.included.filter((x) => x.name).map((x) => `<div${x.wide ? ' class="w"' : ''}>${x.image ? `<img src="${esc(x.image)}" alt="">` : '<i></i>'}<span>${esc(x.name)}</span><small>${esc(x.note || 'Included')}</small></div>`).join('')}</div>` : ''}
              <div data-r="accOpts"></div>
              <div class="zb-sum"><table data-r="sum"></table></div>
              <div class="zb-msg" data-r="msg" hidden></div>
            </section>
            <p class="zb-hint" data-r="hint" aria-live="polite"></p>
          </div>
        </div>`;
      // total bar sits inside the builder and sticks to the bottom of the screen while the builder is in view
      this.bar = document.createElement('div');
      this.bar.className = 'zb-bar';
      this.bar.innerHTML = `<div class="in"><div class="zb-tot"><span class="l" data-b="l"></span><span class="v num" data-b="v"></span></div>
        <div class="zb-btns"><button type="button" class="zb-btn" data-b="back">Back</button><button type="button" class="zb-btn primary" data-b="next">Continue</button></div></div>`;
      this.root.appendChild(this.bar);
      this.b = (n) => this.bar.querySelector(`[data-b="${n}"]`);

      this.buildArc();
      this.buildProps();
      this.renderFinish(); this.renderBurrOpts(); this.renderSwatches(); this.renderAcc();
      this.applyMotion();
      const v = this.variant(), a = this.art(v);
      this.showFinish(a ? a.slug : null);
      this.renderRig();
    }

    bind() {
      const C = this.C;
      this.b('back').onclick = () => this.go(this.stepAfter(this.S.step, -1));
      const help = this.q('help');
      if (help) help.onclick = () => this.openGuide();
      this.b('next').onclick = () => (this.S.step < 3 ? this.go(this.stepAfter(this.S.step, 1)) : this.addToCart());
      const mt = this.q('motion');
      if (mt) mt.onclick = () => {
        this.reduce = !this.reduce;
        try { localStorage.setItem('zb:motion', this.reduce ? 'off' : 'on'); } catch (e) { /* storage blocked */ }
        this.applyMotion(); this.chip(this.reduce ? 'Animations off' : 'Animations on');
      };
      window.addEventListener('resize', () => this.renderRig(true));
    }

    applyMotion() {
      this.root.classList.toggle('still', this.reduce);
      const mt = this.q('motion');
      if (mt) { mt.setAttribute('aria-pressed', String(!this.reduce)); mt.title = this.reduce ? 'Animations are off' : 'Animations are on'; }
    }

    /* ---------- steps ---------- */
    stepReady(i) {
      if (i === 0) return !!this.variant().available;
      if (i === 1) return !this.burrs.length || this.S.burrs.length > 0;
      if (i === 2) return !this.accents.length || !!this.S.accent;
      return true;
    }
    stepAfter(i, d) { let j = i + d; while (this.skip.has(j)) j += d; return Math.max(0, Math.min(3, j)); }
    go(i, first = false) {
      if (this.skip.has(i)) i = this.stepAfter(i, 1);
      for (let k = 0; k < i; k++) if (!this.skip.has(k) && !this.stepReady(k)) { i = k; break; }
      const S = this.S;
      S.step = i; S.seen = Math.max(S.seen, i);
      this.root.querySelectorAll('.zb-rail section').forEach((s) => s.classList.toggle('active', +s.dataset.step === i));
      this.q('arc').dataset.on = i === 1 ? '1' : '0';
      this.q('note').textContent = STAGE_NOTES[i];
      this.q('msg').hidden = true;
      this.placeRig();
      this.renderSteps();
      this.update();
      if (!first && innerWidth <= 920) this.q('stage').scrollIntoView({ behavior: this.reduce ? 'auto' : 'smooth', block: 'start' });
    }
    renderSteps() {
      const S = this.S;
      this.q('steps').innerHTML = this.shown.map((i, n) => `<li><button type="button" data-i="${i}" ${i > S.seen ? 'disabled' : ''} class="${i !== S.step && i <= S.seen && this.stepReady(i) ? 'done' : ''}" ${i === S.step ? 'aria-current="step"' : ''}><span class="n">${n + 1}</span><span class="lbl">${this.T.steps[i]}</span></button></li>`).join('');
      this.root.querySelectorAll('.zb-rail section').forEach((sec) => { const e = sec.querySelector('.zb-eyebrow'), k = this.shown.indexOf(+sec.dataset.step); if (e && k >= 0) e.textContent = `Step ${k + 1} of ${this.shown.length}`; });
      this.q('steps').querySelectorAll('button').forEach((b) => { b.onclick = () => this.go(+b.dataset.i); });
    }
    placeRig() {
      const r = RIG[this.S.step], [bw, bh] = this.AG.box, w = r.h * bw / bh, rig = this.q('rig');
      rig.style.width = w + '%';
      rig.style.left = (r.cx == null ? r.left : r.cx - w / 2) + '%';
      rig.style.top = r.top + '%';
    }

    /* ---------- grinder rendering ---------- */
    pos(el, p) { Object.assign(el.style, { left: p[0] + '%', top: p[1] + '%', width: p[2] + '%', height: p[3] + '%' }); }
    renderRig(resizeOnly = false) {
      const a = this.art(), fb = this.q('fallback');
      const showArt = !!a;
      fb.hidden = showArt;
      if (!showArt) { const src = this.variant().image || this.C.grinder.image; if (src) fb.src = src; else fb.hidden = true; }
      ['knobA', 'knobB', 'capA', 'capB', 'capNone', 'ring', 'chamber'].forEach((n) => { this.q(n).style.display = showArt ? '' : 'none'; });
      if (!showArt) return;
      const g = a.geom, kp = g.knobPos;
      // the cap stays on its funnel: Z1's funnel stays on the body when the front slides out, Z2's comes off with the front
      const Hg = this.AG.hinge || {}, capOnFront = Hg.funnel ? Hg.funnel === 'front' : Hg.mode !== 'slide';
      const capHost = capOnFront ? this.q('front') : this.q('frame');
      ['capA', 'capB', 'capNone'].forEach((n) => { const el = this.q(n); if (el.parentNode !== capHost) capHost.appendChild(el); });
      if (kp) this.pos(this.q('ring'), [kp[0] + kp[2] * 0.13, kp[1] + kp[3] * 0.03, kp[2] * 0.74, kp[3] * 0.94]);
      const fc = g.face, ch = this.q('chamber');
      if (fc) { this.pos(ch, [fc.c[0] - fc.w, fc.c[1] - fc.h, fc.w * 2, fc.h * 2]); ch.style.transform = `rotate(${fc.rot || 0}deg)`; } else ch.style.display = 'none';
      if (!kp) this.q('ring').style.display = 'none';
      const isFace = (this.AG.hinge || {}).mode === 'slide';
      ch.classList.toggle('face', isFace);
      if (isFace) ch.style.setProperty('--zb-face', /white|silver|cream/.test(a.slug) ? '#e7e7e4' : '#141518');
      if (resizeOnly) return;
      const acc = this.accent(this.S.accent);
      if (acc && kp && g.knob && a.urls.knobD) this.swapCanvas('knob', g.knobPos, [a.slug, acc.id].join(':'), (cv) => this.drawKnob(cv, a, acc));
      const capNone = this.q('capNone');
      if (!g.capPos || !g.cap || !a.urls.capD) {             // no funnel cap region in this grinder's art
        ['capA', 'capB', 'capNone'].forEach((n) => { this.q(n).style.opacity = '0'; });
      } else if (this.S.cap === 'none') {
        if (a.urls.capNone && g.capNonePos) { capNone.src = a.urls.capNone; this.pos(capNone, g.capNonePos); capNone.style.opacity = '1'; } else capNone.style.opacity = '0';
        ['capA', 'capB'].forEach((n) => { this.q(n).style.opacity = '0'; this.q(n).dataset.key = ''; });
      } else {
        const c = this.cap(this.S.cap);
        capNone.style.opacity = '0';
        if (c) this.swapCanvas('cap', g.capPos, [a.slug, c.id].join(':'), (cv) => this.drawCap(cv, a, c));
      }
    }
    async swapCanvas(kind, p, key, draw) {
      const A = this.q(kind + 'A'), B = this.q(kind + 'B');
      const front = A.style.opacity === '0' ? B : A, back = front === A ? B : A;
      if (front.dataset.key === key && front.style.opacity !== '0') { this.pos(front, p); return; }
      this.pos(back, p); back.dataset.key = key;
      try { await draw(back); } catch (e) { console.warn('[Zerno builder]', e); return; }
      if (back.dataset.key !== key) return; // a newer choice won the race
      back.style.opacity = '1'; front.style.opacity = '0';
    }
    // Shade = multiply by the -d map, then add texture x -l map for highlights. Blend modes only, so no pixel reads.
    shade(ctx, W, H, D, L) {
      const off = document.createElement('canvas'); off.width = W; off.height = H;
      const o = off.getContext('2d');
      o.drawImage(ctx.canvas, 0, 0);
      o.globalCompositeOperation = 'multiply'; o.drawImage(L, 0, 0, W, H);
      o.globalCompositeOperation = 'destination-in'; o.drawImage(L, 0, 0, W, H);
      ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(D, 0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = this.AG.shadeMax - 1; ctx.drawImage(off, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(D, 0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    }
    async drawKnob(cv, a, acc) {
      const tex = await loadImg((acc.tex && acc.tex.src) || acc.hi || acc.image);
      const g = a.geom.knob, s = 2, W = Math.round(g.size * s);
      cv.width = W; cv.height = W;
      const ctx = cv.getContext('2d'), crop = this.C.settings.accentCrop;
      const layer = () => { const c = document.createElement('canvas'); c.width = c.height = W; return c; };
      // the wood, placed in the face ellipse (or molded in the Art studio). Product photos are soft, so a touch of snap
      const wood = layer(), w = wood.getContext('2d');
      w.imageSmoothingQuality = 'high'; w.filter = 'contrast(1.07) saturate(1.06)';
      if (g.mesh && g.mesh.pts) drawMesh(w, texSquare(tex, acc.tex, crop), g.mesh, W, W);
      else {
        let src = tex, tw = tex.naturalWidth, th = tex.naturalHeight, side = Math.min(tw, th) * crop, sx = (tw - side) / 2, sy = (th - side) / 2;
        if (acc.tex) { src = texSquare(tex, acc.tex, crop); sx = sy = 0; side = src.width; }
        // a little larger than the face, so the side wall always has wood under it
        w.save(); w.translate(g.cx * s, g.cy * s); w.rotate(-g.rot * Math.PI / 180);
        w.drawImage(src, sx, sy, side, side, -g.w * s * 0.56, -g.h * s * 0.56, g.w * s * 1.12, g.h * s * 1.12); w.restore();
      }
      w.filter = 'none';
      const cx = g.cx * s, cy = g.cy * s, rx = g.w * s / 2, ry = g.h * s / 2, rot = -g.rot * Math.PI / 180;
      const ell = (c, ox = 0, oy = 0, grow = 0) => { c.beginPath(); c.ellipse(cx + ox, cy + oy, rx + grow, ry + grow, rot, 0, Math.PI * 2); };
      const H = this.AG.hinge || {}, R = g.rim || {};
      // depth runs from the face back toward the body: opposite the way the front slides off, else to the right
      const dir = (R.dir != null ? +R.dir : H.dir != null ? +H.dir + 180 : 0) * Math.PI / 180, ux = Math.cos(dir), uy = Math.sin(dir);
      const depth = (R.t != null ? +R.t : 0.07) * g.h * s;          // how far the wood stands out
      const seat = depth * 0.6;                                        // the part above the lip (the rest sits in the recess)
      const lipW = (R.lip != null ? +R.lip : 0.035) * rx;             // the lip showing around the wood on the near side
      const lipH = depth * 0.22, grow = seat + lipW;                   // lip height, and its radius beyond the wood
      const fin = this.finishHex(a.slug);
      // light comes from the upper left in every Zerno photo
      const lightGrad = (c, r0, stops) => { const gr = c.createLinearGradient(cx - r0 * 0.75, cy - r0 * 0.75, cx + r0 * 0.75, cy + r0 * 0.75); stops.forEach(([t, col]) => gr.addColorStop(t, col)); return gr; };
      const extrude = (c, from, to, fill) => {                        // a cylinder wall, drawn from the back forward
        const n = Math.max(2, Math.ceil(Math.abs(to - from)));
        for (let i = n; i >= 0; i--) { const d = from + (to - from) * i / n; fill(d * ux, d * uy); }
      };
      if (depth > 0.5) {
        // ---- the lip: a ring of the grinder's own finish that the accent seats into ----
        const lip = layer(), l = lip.getContext('2d');
        extrude(l, seat + lipH, seat, (ox, oy) => { ell(l, ox, oy, grow); l.fillStyle = mix(fin, '#000000', 0.38); l.fill(); });
        ell(l, seat * ux, seat * uy, grow);
        l.fillStyle = lightGrad(l, rx + grow, [[0, mix(fin, '#ffffff', 0.2)], [0.5, fin], [1, mix(fin, '#000000', 0.22)]]); l.fill();
        l.save(); ell(l, seat * ux, seat * uy, grow); l.clip();
        ell(l, seat * ux, seat * uy, grow); l.lineWidth = 2.4;          // the lip's machined edge catches the light
        l.strokeStyle = lightGrad(l, rx + grow, [[0, 'rgba(255,255,255,.55)'], [0.45, 'rgba(255,255,255,.08)'], [1, 'rgba(255,255,255,0)']]); l.stroke();
        ell(l, seat * ux, seat * uy, 1.5); l.lineWidth = 3; l.strokeStyle = 'rgba(0,0,0,.55)'; l.stroke();   // the recess the wood sits in
        l.restore();
        ctx.drawImage(lip, 0, 0);
        // ---- the wood's side wall above the lip: its own grain, in shade ----
        const sh = R.shade != null ? +R.shade : 0.3, side = layer(), sd = side.getContext('2d');
        sd.drawImage(wood, 0, 0); sd.globalAlpha = Math.min(1, sh * 2.2); sd.globalCompositeOperation = 'multiply';
        sd.fillStyle = 'rgb(128,96,70)'; sd.fillRect(0, 0, W, W);
        sd.globalAlpha = 1; sd.globalCompositeOperation = 'destination-in'; sd.drawImage(wood, 0, 0);
        const rim = layer(), r = rim.getContext('2d');
        extrude(r, seat, 0, (ox, oy) => { r.save(); ell(r, ox, oy); r.clip(); r.drawImage(side, ox, oy); r.restore(); });
        r.globalCompositeOperation = 'source-atop';
        const top = r.createLinearGradient(0, cy - ry, 0, cy + ry);      // light from above catches the top of the wall
        top.addColorStop(0, 'rgba(255,240,220,.22)'); top.addColorStop(0.45, 'rgba(255,240,220,0)'); top.addColorStop(1, 'rgba(0,0,0,.18)');
        r.fillStyle = top; r.fillRect(0, 0, W, W);
        r.globalCompositeOperation = 'source-over';
        ctx.drawImage(rim, 0, 0);
      }
      // ---- the face: flat, crisp wood with the studio's soft light ----
      ctx.save(); ell(ctx); ctx.clip();
      ctx.drawImage(wood, 0, 0);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = lightGrad(ctx, rx, [[0, '#fff'], [0.55, '#f6f2ec'], [1, '#d9d0c6']]); ctx.fillRect(0, 0, W, W);
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = lightGrad(ctx, rx, [[0, 'rgba(255,250,240,.16)'], [0.4, 'rgba(255,250,240,0)']]); ctx.fillRect(0, 0, W, W);
      ctx.globalCompositeOperation = 'source-over';
      // the rounded edge: bright where it faces the light, a shadow line where it turns away
      ell(ctx); ctx.lineWidth = Math.max(2, rx * 0.022);
      ctx.strokeStyle = lightGrad(ctx, rx, [[0, 'rgba(255,248,232,.7)'], [0.42, 'rgba(255,248,232,.12)'], [0.6, 'rgba(0,0,0,0)'], [1, 'rgba(40,25,10,.35)']]); ctx.stroke();
      ctx.restore();
    }
    finishHex(s) {
      const c = this.finishSwatch[s];
      return /^#[0-9a-f]{6}$/i.test(c || '') ? c : /white|silver|cream|ivory/.test(s || '') ? '#e7e6e2' : '#18191b';
    }
    async drawCap(cv, a, c) {
      if (/steel|stainless|metal|alumin|titan|chrome/i.test(c.title) && a.urls.capMetal) {
        // metal caps continue the funnel's own steel instead of stretching a product photo
        const im = await loadImg(a.urls.capMetal), g = a.geom.cap, scale = 3;
        cv.width = g.w * scale; cv.height = g.h * scale;
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        return;
      }
      const [tex, D, L] = await Promise.all([loadImg((c.tex && c.tex.src) || c.hi || c.image), loadImg(a.urls.capD), loadImg(a.urls.capL)]);
      const g = a.geom.cap, scale = 3, W = g.w * scale, H = g.h * scale;
      cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d'), crop = this.C.settings.capCrop;
      if (c.tex || g.band || g.mesh) {
        // the band (Art studio, default the middle strip) of the texture square becomes the cap's visible edge
        const sq = texSquare(tex, c.tex, crop), T = sq.width, b = Array.isArray(g.band) && g.band.length === 4 ? g.band : [0.08, 0.40, 0.84, 0.20];
        if (g.mesh && g.mesh.pts) drawMesh(ctx, sq, g.mesh, W, H, b[0] * T, b[1] * T, b[2] * T, b[3] * T);
        else ctx.drawImage(sq, b[0] * T, b[1] * T, b[2] * T, b[3] * T, 0, 0, W, H);
      } else {
        const tw = tex.naturalWidth, th = tex.naturalHeight, side = Math.min(tw, th) * crop, sx = (tw - side) / 2, sy = (th - side) / 2;
        // a horizontal band through the middle of the cap photo becomes the cap's visible edge
        ctx.drawImage(tex, sx + side * 0.08, sy + side * 0.40, side * 0.84, side * 0.20, 0, 0, W, H);
      }
      this.shade(ctx, W, H, D, L);
    }

    /* powder-coat wipe from the front (accent piece) to the back */
    coat(toSlug) {
      const inc = [...this.root.querySelectorAll(`.zb-fin[data-base="${toSlug}"]`)];
      if (!inc.length) return;
      const others = [...this.root.querySelectorAll('.zb-fin')].filter((e) => !inc.includes(e));
      const photos = inc.map((e) => e.querySelector('.zb-photo'));
      clearTimeout(this.coatT);
      [...inc, ...others].forEach((e) => { e.classList.remove('top'); e.querySelector('.zb-photo').classList.remove('coat'); });
      if (this.reduce) { this.showFinish(toSlug); return; }
      inc.forEach((e) => { e.style.opacity = '1'; e.classList.add('top'); });
      photos.forEach((p) => { void p.offsetWidth; p.classList.add('coat'); });
      const sp = this.q('spray'), hz = this.q('haze'), white = /white|cream|ivory|light/.test(toSlug);
      sp.style.webkitMaskImage = sp.style.maskImage = `url('${this.C.art[toSlug].mask}')`;
      sp.style.mixBlendMode = white ? 'multiply' : 'screen';
      sp.style.backgroundImage = white ? 'linear-gradient(90deg,transparent 0 44%,rgba(120,124,130,.12) 47%,rgba(110,114,120,.45) 50%,rgba(120,124,130,.12) 53%,transparent 56% 100%)' : '';
      [sp, hz].forEach((e) => { e.classList.remove('go'); void e.offsetWidth; e.classList.add('go'); });
      this.coatT = setTimeout(() => { inc.forEach((e) => e.classList.remove('top')); photos.forEach((p) => p.classList.remove('coat')); others.forEach((e) => { e.style.opacity = '0'; }); }, 1700);
    }

    /* ---------- motion helpers ---------- */
    chip(html) {
      const c = this.q('chip'); c.innerHTML = html; c.classList.add('show');
      clearTimeout(this.chipT); this.chipT = setTimeout(() => c.classList.remove('show'), 2600);
    }
    pulse() { const r = this.q('ring'); r.classList.remove('go'); void r.offsetWidth; r.classList.add('go'); }
    visibleKnob() { return [this.q('knobA'), this.q('knobB')].find((e) => e.style.opacity !== '0'); }
    knobRect() {
      const k = this.art() && this.visibleKnob();
      if (!k) { const s = this.q('stage').getBoundingClientRect(); return { left: s.left + s.width * 0.42, top: s.top + s.height * 0.55, width: s.width * 0.16, height: s.width * 0.16 }; }
      const r = k.getBoundingClientRect();
      return { left: r.left + r.width * 0.12, top: r.top + r.height * 0.04, width: r.width * 0.76, height: r.height * 0.92 };
    }
    async showStage() {
      const r = this.q('stage').getBoundingClientRect();
      if (r.top < -r.height * 0.25 || r.bottom > innerHeight + r.height * 0.25) {
        this.q('stage').scrollIntoView({ behavior: this.reduce ? 'auto' : 'smooth', block: 'start' });
        await sleep(this.reduce ? 0 : 550);
      }
    }
    flyEl(spec, rect) {
      let f;
      if (spec.tex) { f = document.createElement('div'); f.style.cssText = this.texStyle(spec.tex, spec.crop) + ';background-repeat:no-repeat;background-position:center'; }
      else { f = document.createElement('img'); f.src = spec.src; f.alt = ''; }
      f.className = 'zb-fly';
      Object.assign(f.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px', borderRadius: '50%' });
      document.body.appendChild(f);
      const r = f.getBoundingClientRect(); // correct for transformed ancestors
      if (Math.abs(r.left - rect.left) > 1 || Math.abs(r.top - rect.top) > 1) { f.style.left = (2 * rect.left - r.left) + 'px'; f.style.top = (2 * rect.top - r.top) + 'px'; }
      return f;
    }
    fly(spec, fr, tr, { spin = 0, tilt = 0, end = 0.25, dur = 1050 } = {}) {
      if (this.reduce || !fr || !tr) return Promise.resolve();
      return new Promise((res) => {
        const f = this.flyEl(spec, fr);
        const dx = (tr.left + tr.width / 2) - (fr.left + fr.width / 2), dy = (tr.top + tr.height / 2) - (fr.top + fr.height / 2), sc = tr.height / fr.height;
        const a = f.animate([
          { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1, filter: 'drop-shadow(0 18px 18px rgba(0,0,0,.6))' },
          { transform: `translate(${dx * 0.55}px,${dy * 0.55 - 40}px) scale(${(1 + sc) / 2 * 1.08}) rotate(${spin * 0.6}deg)`, opacity: 1, offset: 0.5 },
          { transform: `translate(${dx}px,${dy}px) perspective(600px) rotateY(${tilt}deg) scale(${sc}) rotate(${spin}deg)`, opacity: 1, offset: 0.82 },
          { transform: `translate(${dx}px,${dy}px) perspective(600px) rotateY(${tilt}deg) scale(${sc * end}) rotate(${spin + 90}deg)`, opacity: end >= 1 ? 1 : 0, filter: 'drop-shadow(0 0 0 rgba(0,0,0,0))' }
        ], { duration: dur, easing: 'cubic-bezier(.6,.05,.3,1)', fill: 'forwards' });
        a.onfinish = () => { f.remove(); res(); };
      });
    }
    // the front assembly opens (Z2: dial and accent piece hinge about 25 degrees; Z1: housing and chute slide out along the crease),
    // the burr drops into the grind chamber through the gap, and the front swings shut
    /** Admin preview: play the opening with the first burr, as if a customer picked it. */
    async demoOpen() {
      const b = this.burrs[0], img = this.root.querySelector('.zb-stage') || this.root;
      const r = img.getBoundingClientRect(), fr = new DOMRect(r.right - 90, r.top + 20, 70, 70);
      const src = b ? (this.burrImg(b.id) || b.srcs[0]) : '';
      await this.installBurr(src, fr);
    }
    installBurr(src, fr) {
      if (this.reduce || !fr) return Promise.resolve();
      const a = this.art();
      if (!a || !a.geom.face || (this.AG.hinge || {}).mode === 'none' || !a.urls.front) return this.fly({ src }, fr, this.knobRect(), { spin: 540, end: 0.2, dur: 1400 });
      return new Promise((res) => {
        const front = this.q('front'), ch = this.q('chamber'), fc = a.geom.face;
        // Z2: hinge on the bottom of the seam so the top drops forward; the chute stays put.
        // Z1 (hinge.mode 'slide'): the dial housing and chute pull straight out along the crease; the funnel stays.
        // hinge settings (Catalog > the grinder > How it opens): swing angle and pivot, or slide distance and direction, and speed
        const H = this.AG.hinge || {}, slide = H.mode === 'slide', out = H.dist != null ? +H.dist : a.geom.open || 8;
        const D = H.ms ? Math.max(600, Math.min(4000, +H.ms)) : 1800;
        front.style.transformOrigin = H.pivot ? `${H.pivot[0]}% ${H.pivot[1]}%` : slide ? `${fc.c[0]}% ${fc.c[1]}%` : `${fc.c[0]}% ${fc.c[1] + fc.h}%`;
        const rect = ch.getBoundingClientRect();
        const aspect = fc.w * this.AG.box[0] / (fc.h * this.AG.box[1]);
        const seat = rect.height * 0.5;
        // aim for the upper part of the chamber, which the open gap exposes
        const tx = rect.left + rect.width * (slide ? 0.5 : 0.62), ty = rect.top + rect.height * (slide ? 0.5 : 0.32);
        // Z1: the burr lands in the exposed burr carrier and stays visible there until the front slides back
        if (slide) ch.querySelector('i').style.backgroundImage = src ? `url("${src}")` : '';
        const f = this.flyEl({ src }, fr);
        const fx = fr.left + fr.width / 2, fy = fr.top + fr.height / 2, sc = seat / fr.height;
        const t = (x, y, s, sx, r) => `translate(${x - fx}px,${y - fy}px) scale(${s}) scaleX(${sx}) rotate(${r}deg)`;
        const anim = f.animate([
          { transform: t(fx, fy, 1, 1, 0), opacity: 1, filter: 'brightness(1)' },
          { transform: t((fx + tx) / 2, Math.min(fy, ty) - 60, (1 + sc) / 2, 1, 240), offset: 0.3 },
          { transform: t(tx - rect.width * 0.25, ty - rect.height * 0.1, sc * 1.05, 0.75, 400), offset: 0.48 },
          { transform: t(tx, ty, sc, aspect, 500), offset: 0.62, opacity: 1, filter: 'brightness(.85)' },
          { transform: t(tx, ty, sc * 0.9, aspect, 540), offset: 0.7, opacity: 0, filter: 'brightness(.6)' },
          { transform: t(tx, ty, sc * 0.9, aspect, 540), opacity: 0 }
        ], { duration: D, easing: 'cubic-bezier(.5,.05,.35,1)', fill: 'forwards' });
        // slide along the cylinder's axis (it tilts slightly down toward the dial), not straight sideways
        const ang = H.angle != null ? +H.angle : -25;
        // dir is a true angle in the photo (0 = right, 90 = down); translate % are of the frame's width (x) and height (y)
        const dir = H.dir != null ? +H.dir * Math.PI / 180 : null, ar = this.AG.box[0] / this.AG.box[1];
        const dx = dir == null ? -out : out * Math.cos(dir), dy = dir == null ? out * 0.06 : out * Math.sin(dir) * ar;
        const grow = slide && H.grow ? 1 + +H.grow : 1;           // coming toward the camera reads a little larger
        const pose = slide ? ['translate(0%,0%) scale(1)', `translate(${dx}%,${dy}%) scale(${grow})`, `translate(${-dx * 0.025}%,${-dy * 0.025}%) scale(1)`] : ['rotate(0deg)', `rotate(${ang}deg)`, `rotate(${-ang * 0.032}deg)`];
        front.animate([
          { transform: pose[0], offset: 0 }, { transform: pose[0], offset: 0.14 },
          { transform: pose[1], offset: 0.34, easing: 'cubic-bezier(.3,0,.2,1)' }, { transform: pose[1], offset: 0.7 },
          { transform: pose[2], offset: 0.86, easing: 'cubic-bezier(.5,0,.3,1)' }, { transform: pose[0] }
        ], { duration: D });
        ch.animate([{ opacity: 0, offset: 0 }, { opacity: 0, offset: 0.16 }, { opacity: 1, offset: 0.3 }, { opacity: 1, offset: 0.76 }, { opacity: 0, offset: 0.86 }, { opacity: 0 }], { duration: D });
        anim.onfinish = () => { f.remove(); res(); };
      });
    }

    /* ---------- step 1: finish ---------- */
    renderFinish() {
      const C = this.C, g = C.grinder, S = this.S;
      const values = g.options[this.ci] ? g.options[this.ci].values : [];
      const forValue = (val) => {
        const want = S.opts.slice(); want[this.ci] = val;
        return g.variants.find((v) => v.options.every((o, i) => o === want[i])) || g.variants.find((v) => v.options[this.ci] === val);
      };
      this.q('finishOpts').innerHTML = values.map((val) => {
        const v = forValue(val); if (!v) return '';
        const s = slug(val), dotKey = Object.keys(FINISH_DOTS).find((k) => s.includes(k));
        const custom = /^#[0-9a-f]{3,8}$/i.test(this.finishSwatch[s] || '') ? this.finishSwatch[s] : null;
        const dot = custom ? `background:${custom}` : dotKey ? `background:${FINISH_DOTS[dotKey]}` : v.image ? `background-image:url('${v.image}')` : '';
        return `<button type="button" class="zb-opt" aria-pressed="${S.opts[this.ci] === val}" data-v="${esc(val)}" ${v.available ? '' : 'disabled'}>
          <span class="zb-dot" style="${dot}"></span><span><span class="t">${esc(val)}</span>${v.blurb ? `<br><span class="d">${esc(v.blurb)}</span>` : ''}${v.available ? '' : '<br><span class="d">Sold out</span>'}</span>
          <span class="p num">${this.money(v.price)}</span></button>`;
      }).join('');
      this.q('finishOpts').querySelectorAll('.zb-opt').forEach((b) => {
        b.onclick = () => {
          const val = b.dataset.v; if (S.opts[this.ci] === val) return;
          const before = this.art();
          const v = forValue(val); S.opts = v.options.slice(); this.save();
          this.renderFinish(); this.update();
          const after = this.art();
          if (after && before) this.coat(after.slug);
          else this.showFinish(after ? after.slug : null);
          this.chip(`Coating in <b>${esc(val)}</b>`);
        };
      });
      // other options (for example voltage) as simple pills
      this.q('otherOpts').innerHTML = g.options.map((o, i) => (i === this.ci || o.values.length < 2) ? '' :
        `<div class="zb-optrow"><span class="lbl">${esc(o.name)}</span><div class="zb-seg">${o.values.map((val) =>
          `<button type="button" data-i="${i}" data-v="${esc(val)}" aria-pressed="${S.opts[i] === val}">${esc(val)}</button>`).join('')}</div></div>`).join('');
      this.q('otherOpts').querySelectorAll('button').forEach((b) => {
        b.onclick = () => {
          const want = S.opts.slice(); want[+b.dataset.i] = b.dataset.v;
          const v = g.variants.find((x) => x.options.every((o, i) => o === want[i])) || g.variants.find((x) => x.options[+b.dataset.i] === b.dataset.v);
          if (v) { S.opts = v.options.slice(); this.save(); this.renderFinish(); this.update(); }
        };
      });
    }

    /* ---------- step 2: burrs ---------- */
    buildArc() {
      const arc = this.q('arc'), n = this.burrs.length, cx = 50, cy = 64, R = 37;
      arc.innerHTML = '';
      this.burrs.forEach((b, i) => {
        const ang = n > 1 ? Math.PI - Math.PI * i / (n - 1) : Math.PI / 2;
        const el = document.createElement('button');
        el.type = 'button'; el.className = 'zb-burr'; el.dataset.id = b.id;
        el.style.left = (cx + R * Math.cos(ang)) + '%'; el.style.top = (cy - R * Math.sin(ang)) + '%';
        el.disabled = !b.available;
        el.innerHTML = `<img alt=""><span class="lab">${esc(b.short)}<small></small></span>`;
        const img = el.querySelector('img'); let k = 0;
        img.onerror = () => { k += 1; if (b.srcs[k]) img.src = b.srcs[k]; else img.onerror = null; };
        img.src = b.srcs[0] || '';
        el.onclick = () => this.toggleBurr(b.id);
        arc.appendChild(el);
      });
      this.renderBurrState();
    }
    burrImg(id) { const i = this.root.querySelector(`.zb-burr[data-id="${id}"] img`); return i ? i.currentSrc || i.src : ''; }
    burrRect(id) { const i = this.root.querySelector(`.zb-burr[data-id="${id}"] img`); return i ? i.getBoundingClientRect() : null; }
    slotRect(i) {
      const sl = this.q('traySlots').children[i]; if (sl) return sl.getBoundingClientRect();
      const st = this.q('stage').getBoundingClientRect(), w = st.width * 0.08;
      return { left: st.left + st.width * 0.035 + i * (w + st.width * 0.012), top: st.bottom - st.height * 0.04 - w, width: w, height: w };
    }
    renderBurrState() {
      const S = this.S;
      this.root.querySelectorAll('.zb-burr').forEach((e) => {
        const id = +e.dataset.id, i = S.burrs.indexOf(id), b = this.burr(id);
        e.classList.toggle('installed', i === 0); e.classList.toggle('spare', i > 0);
        e.querySelector('small').textContent = !b.available ? 'Sold out' : i === 0 ? 'Installed' : i > 0 ? 'Spare set' : this.money(b.price);
        e.setAttribute('aria-pressed', String(i >= 0));
        e.setAttribute('aria-label', `${b.name}, ${this.money(b.price)}${i === 0 ? ', installed' : i > 0 ? ', spare set' : ''}`);
      });
      const sp = S.burrs.slice(1);
      this.q('traySlots').innerHTML = sp.map((id) => `<span><img src="${esc(this.burrImg(id))}" alt="${esc(this.burr(id).name)} spare set"></span>`).join('');
      this.q('tray').hidden = !(S.step === 1 && sp.length);
    }
    renderBurrOpts() {
      const S = this.S;
      this.q('burrOpts').innerHTML = this.burrs.map((b) => {
        const i = S.burrs.indexOf(b.id);
        const tag = i === 0 ? '<span class="zb-tag in">Installed</span>' : i > 0 ? '<span class="zb-tag sp">Spare set</span>' : '';
        const meta = [b.style && `<span><i>${esc(b.style)}</i></span>`, b.roast && `<span>${esc(b.roast)} roasts</span>`, b.coating && `<span>${esc(b.coating)}</span>`].filter(Boolean).join('');
        return `<div class="zb-ow"><button type="button" class="zb-opt" aria-pressed="${i >= 0}" data-id="${b.id}" ${b.available ? '' : 'disabled'}>
          <img class="zb-thumb" src="${esc(this.burrImg(b.id) || b.srcs[0] || '')}" alt=""><span><span class="t">${esc(b.name)}</span>${tag}${b.badge ? `<span class="zb-tag bd">${esc(b.badge)}</span>` : ''}
          ${b.help ? `<br><span class="d">${esc(b.help)}</span>` : b.taste ? `<br><span class="d">${esc(b.taste)}</span>` : ''}${meta ? `<span class="zb-meta">${meta}</span>` : ''}${b.available ? '' : '<br><span class="d">Sold out</span>'}</span>
          <span class="p num">${this.money(b.price)}</span></button>${i > 0 ? `<button type="button" class="zb-mk" data-id="${b.id}">Ship this set installed instead</button>` : ''}</div>`;
      }).join('');
      this.q('burrOpts').querySelectorAll('.zb-opt').forEach((o) => { o.onclick = () => this.toggleBurr(+o.dataset.id); });
      this.q('burrOpts').querySelectorAll('.zb-mk').forEach((o) => { o.onclick = () => this.makeInstalled(+o.dataset.id); });
    }
    async toggleBurr(id) {
      if (this.busy) return; this.busy = true;
      const S = this.S, b = this.burr(id), i = S.burrs.indexOf(id);
      try {
        if (i < 0) {
          if (!b.available) return;
          const toKnob = !S.burrs.length || !this.C.settings.allowSpareBurrs;
          if (!toKnob && this.T.max.burrs && S.burrs.length >= this.T.max.burrs) { this.chip(`Up to ${this.T.max.burrs} burr sets per build`); return; }
          await this.showStage();
          const fr = this.burrRect(id), src = this.burrImg(id);
          if (toKnob && S.burrs.length) S.burrs = []; // single-burr mode replaces
          S.burrs.push(id); this.save();
          const el = this.root.querySelector(`.zb-burr[data-id="${id}"]`); if (el) el.classList.add(toKnob ? 'installed' : 'spare');
          this.renderBurrOpts(); this.update(false);
          if (toKnob) await this.installBurr(src, fr);
          else { this.q('tray').hidden = false; await this.fly({ src }, fr, this.slotRect(S.burrs.length - 2), { spin: 220, end: 1, dur: 850 }); }
          this.renderBurrState();
          if (toKnob) { this.pulse(); this.chip(`<b>${esc(b.name)}</b> installed · ${this.money(b.price)}`); }
          else this.chip(`<b>${esc(b.name)}</b> added as a spare set · ${this.money(b.price)}`);
        } else {
          S.burrs.splice(i, 1); this.save();
          if (i === 0 && S.burrs.length) {
            await this.showStage();
            const nk = S.burrs[0], fr = this.slotRect(0);
            this.renderBurrOpts(); this.update(false);
            await this.installBurr(this.burrImg(nk), fr);
            this.pulse(); this.chip(`<b>${esc(b.name)}</b> removed · <b>${esc(this.burr(nk).name)}</b> now installed`);
          } else this.chip(`<b>${esc(b.name)}</b> removed`);
          this.renderBurrState(); this.renderBurrOpts(); this.update(false);
        }
      } finally { this.busy = false; }
    }
    /* "Help me choose": the Burr Guide in a dialog, limited to this grinder's burrs. The pick installs the burr. */
    async openGuide() {
      const C = this.C, help = this.q('help');
      try {
        if (!window.ZernoBurrGuide) {
          if (help) help.disabled = true;
          await new Promise((res, rej) => {
            const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = C.guideCss; document.head.appendChild(l);
            const s = document.createElement('script'); s.src = C.guideJs; s.onload = res; s.onerror = rej; document.head.appendChild(s);
          });
        }
      } catch (e) { this.chip('The burr guide could not load. Please try again.'); return; } finally { if (help) help.disabled = false; }
      const g = C.grinderCfg, S = this.S;
      const guide = new window.ZernoBurrGuide(null, {
        mode: 'modal', fixed: g.key, catalog: C.cat, assetBase: C.assetBase, heading: 'Burr guide', money: this.money,
        shop: { [g.size]: this.burrs.map((b) => ({ id: b.id, title: b.raw || b.title, price: b.price, available: b.available, img: this.burrImg(b.id) || b.srcs[0] })) },
        onPick: async (ids) => {
          await new Promise((r) => setTimeout(r, 280));
          const [first, ...rest] = ids.filter((id) => this.burr(id));
          if (first && S.burrs[0] !== first) {
            if (S.burrs.includes(first)) await this.makeInstalled(first);
            else { await this.toggleBurr(first); if (S.burrs[0] !== first && S.burrs.includes(first)) await this.makeInstalled(first); }
          }
          for (const id of rest) if (!S.burrs.includes(id) && C.settings.allowSpareBurrs) await this.toggleBurr(id);
        }
      });
      const cs = getComputedStyle(this.root);
      ['--zb-ink', '--zb-stage', '--zb-fg', '--zb-accent'].forEach((v) => { const x = cs.getPropertyValue(v); if (x && guide.ov) guide.ov.style.setProperty(v, x.trim()); });
    }
    async makeInstalled(id) {
      const S = this.S, i = S.burrs.indexOf(id);
      if (this.busy || i <= 0) return; this.busy = true;
      try {
        await this.showStage();
        const fr = this.slotRect(i - 1);
        S.burrs.splice(i, 1); S.burrs.unshift(id); this.save(); this.renderBurrOpts(); this.update(false);
        await this.installBurr(this.burrImg(id), fr);
        this.renderBurrState(); this.pulse();
        this.chip(`<b>${esc(this.burr(id).name)}</b> installed · ${esc(this.burr(S.burrs[1]).name)} moved to spares`);
      } finally { this.busy = false; }
    }

    /* ---------- step 3: accents and caps ---------- */
    renderSwatches() {
      const S = this.S, st = this.C.settings;
      this.q('accentOpts').innerHTML = this.accents.map((a) => `<button type="button" class="zb-swb" aria-pressed="${S.accent === a.id}" data-id="${a.id}" ${a.available ? '' : 'disabled'} aria-label="${esc(a.title)} accent piece, ${this.money(a.price)}">
        <span class="zb-disc" style="${this.texStyle(a.image, st.accentCrop)}"></span><span class="nm">${esc(a.title)}</span>${a.badge ? `<span class="bd">${esc(a.badge)}</span>` : ''}<span class="pr num">${a.available ? '+' + this.money(a.price) : 'Sold out'}</span></button>`).join('');
      this.q('accentOpts').querySelectorAll('.zb-swb').forEach((b) => { b.onclick = () => this.chooseAccent(+b.dataset.id, b.querySelector('.zb-disc')); });
      const capOpts = this.q('capOpts');
      if (capOpts) {
        const none = st.capOptional ? `<button type="button" class="zb-swb" aria-pressed="${S.cap === 'none'}" data-id="none" aria-label="No funnel cap"><span class="zb-disc none"></span><span class="nm">${esc(this.T.noCap)}</span><span class="pr">Included</span></button>` : '';
        capOpts.innerHTML = none + this.caps.map((c) => `<button type="button" class="zb-swb" aria-pressed="${S.cap === c.id}" data-id="${c.id}" ${c.available ? '' : 'disabled'} aria-label="${esc(c.title)} funnel cap, ${this.money(c.price)}">
          <span class="zb-disc" style="${this.texStyle(c.image, st.capCrop)}"></span><span class="nm">${esc(c.title)}</span>${c.badge ? `<span class="bd">${esc(c.badge)}</span>` : ''}<span class="pr num">${c.available ? '+' + this.money(c.price) : 'Sold out'}</span></button>`).join('');
        capOpts.querySelectorAll('.zb-swb').forEach((b) => { b.onclick = () => this.chooseCap(b.dataset.id === 'none' ? 'none' : +b.dataset.id, b.querySelector('.zb-disc')); });
      }
      this.renderSpares();
    }
    async chooseAccent(id, disc) {
      const S = this.S; if (S.accent === id) return;
      const a = this.accent(id), fr = disc.getBoundingClientRect(), dup = S.accSpare.includes(id);
      S.accent = id; S.accSpare = S.accSpare.filter((z) => z !== id); this.save();
      this.renderSwatches(); this.update(false);
      await this.fly({ tex: a.image, crop: this.C.settings.accentCrop }, fr, this.knobRect(), { tilt: -34, end: 1, dur: 800 });
      this.renderRig(); this.pulse();
      this.chip(`<b>${esc(a.title)}</b> accent piece${dup ? ' moved from extras to the grinder' : ''}`);
    }
    async chooseCap(id, disc) {
      const S = this.S; if (S.cap === id) return;
      const hadExtras = id === 'none' && S.capSpare.length, dup = id !== 'none' && S.capSpare.includes(id);
      S.cap = id; S.capSpare = id === 'none' ? [] : S.capSpare.filter((z) => z !== id); this.save();
      this.renderSwatches(); this.update(false);
      if (id !== 'none') {
        const c = this.cap(id), capEl = [this.q('capA'), this.q('capB'), this.q('capNone')].find((e) => e.style.opacity !== '0');
        if (capEl && this.art()) {
          const r = capEl.getBoundingClientRect();
          await this.fly({ tex: c.image, crop: this.C.settings.capCrop }, disc.getBoundingClientRect(), { left: r.left + r.width * 0.1, top: r.top - r.width * 0.4, width: r.width * 0.8, height: r.width * 0.8 }, { end: 0.3, dur: 750 });
        }
        this.renderRig(); this.chip(`<b>${esc(c.title)}</b> funnel cap${dup ? ' moved from extras to the grinder' : ''}`);
      } else { this.renderRig(); this.chip(hadExtras ? 'Funnel cap and extra caps removed' : 'Funnel cap removed'); }
    }
    renderSpares() {
      if (!this.C.settings.allowExtras) return;
      const S = this.S, st = this.C.settings;
      const chips = (list, kind, arr, cur, crop) => list.filter((x) => x.available).map((x) => {
        const on = arr.includes(x.id), isCur = cur === x.id, noun = kind === 'acc' ? 'accent piece' : 'funnel cap';
        return `<button type="button" class="zb-spc${isCur ? ' cur' : ''}" aria-pressed="${on}" data-id="${x.id}" ${isCur ? 'disabled' : ''}
          aria-label="${isCur ? `${esc(x.title)} is already on your grinder` : `${on ? 'Remove' : 'Add'} extra ${esc(x.title)} ${noun}, ${this.money(x.price)}`}">
          <i style="${this.texStyle(x.image, crop)}"></i><span>${esc(x.title)}</span><span class="pr num">${isCur ? 'On grinder' : this.money(x.price)}</span><span class="pl">${isCur ? '' : on ? '✓' : '+'}</span></button>`;
      }).join('');
      const accBox = this.q('accSpare');
      if (accBox) {
        accBox.innerHTML = chips(this.accents, 'acc', S.accSpare, S.accent, st.accentCrop);
        accBox.querySelectorAll('.zb-spc').forEach((b) => { b.onclick = () => this.toggleSpare('acc', +b.dataset.id, b.querySelector('i')); });
      }
      const capBox = this.q('capSpare');
      if (capBox) {
        const noCap = S.cap === 'none';
        capBox.innerHTML = chips(this.caps, 'cap', S.capSpare, S.cap, st.capCrop);
        this.q('capSpareLbl').textContent = noCap ? 'Choose a funnel cap above to add extras' : 'Add extra funnel caps';
        capBox.querySelectorAll('.zb-spc').forEach((b) => { if (noCap) b.disabled = true; b.onclick = () => this.toggleSpare('cap', +b.dataset.id, b.querySelector('i')); });
      }
      this.renderTray2();
    }
    spareItems() { return [...this.S.accSpare.map((id) => ['acc', id]), ...this.S.capSpare.map((id) => ['cap', id])]; }
    renderTray2() {
      const st = this.C.settings, it = this.spareItems();
      this.q('tray2Slots').innerHTML = it.map(([kind, id]) => {
        const x = kind === 'acc' ? this.accent(id) : this.cap(id);
        return `<span class="sm${kind === 'cap' ? ' cap' : ''}"><i style="${this.texStyle(x.image, kind === 'acc' ? st.accentCrop : st.capCrop)}"></i></span>`;
      }).join('');
      this.q('tray2').hidden = !(this.S.step === 2 && it.length);
    }
    async toggleSpare(kind, id, from) {
      const S = this.S, key = kind === 'acc' ? 'accSpare' : 'capSpare', cur = kind === 'acc' ? S.accent : S.cap;
      if (kind === 'cap' && S.cap === 'none') return;
      if (cur === id) return;
      const x = kind === 'acc' ? this.accent(id) : this.cap(id), noun = kind === 'acc' ? 'accent piece' : 'funnel cap';
      const arr = S[key], i = arr.indexOf(id);
      if (i >= 0) { arr.splice(i, 1); this.save(); this.renderSpares(); this.update(false); this.chip(`Extra <b>${esc(x.title)}</b> ${noun} removed`); return; }
      const lim = this.T.max[kind === 'acc' ? 'accents' : 'caps'];
      if (lim && arr.length + 1 >= lim) { this.chip(`Up to ${lim} ${noun}s per build`); return; }
      const fr = from.getBoundingClientRect();
      arr.push(id); this.save(); this.renderSpares(); this.update(false);
      const idx = this.spareItems().findIndex(([k, v]) => k === kind && v === id), slot = this.q('tray2Slots').children[idx];
      if (slot) {
        slot.style.opacity = '0';
        await this.fly({ tex: x.image, crop: kind === 'acc' ? this.C.settings.accentCrop : this.C.settings.capCrop }, fr, slot.getBoundingClientRect(), { spin: 180, end: 1, dur: 800 });
        slot.style.opacity = '1';
      }
      this.chip(`Extra <b>${esc(x.title)}</b> ${noun} added · ${this.money(x.price)}`);
    }

    /* ---------- step 4: accessories ---------- */
    buildProps() {
      const props = this.q('props'); let slotN = 0;
      this.accs.forEach((a) => {
        const srcs = [a.stage, a.stageAsset].filter(Boolean);
        if (!srcs.length || slotN >= PROP_SLOTS.length) return;
        const d = document.createElement('div');
        d.className = 'zb-prop'; d.dataset.pid = a.productId;
        Object.assign(d.style, PROP_SLOTS[slotN++]);
        const img = document.createElement('img'); img.alt = ''; let k = 0;
        img.onerror = () => { k += 1; if (srcs[k]) img.src = srcs[k]; else d.remove(); };
        img.src = srcs[0]; d.appendChild(img); props.appendChild(d);
      });
      if (this.C.settings.showIncluded) (this.C.included || []).forEach((x) => {
        if (!x.name || !x.image || !INCLUDED_SLOTS[x.slot]) return;
        const d = document.createElement('div');
        d.className = 'zb-prop incl'; Object.assign(d.style, INCLUDED_SLOTS[x.slot]);
        const img = document.createElement('img'); img.alt = ''; img.src = x.image; img.onerror = () => d.remove();
        d.appendChild(img); props.appendChild(d);
      });
    }
    accGroup(id) { const a = this.accs.find((x) => x.productId === id); return a && a.group ? String(a.group).toLowerCase() : ''; }
    renderAcc() {
      const S = this.S;
      this.q('accOpts').innerHTML = this.accs.map((a) => {
        const on = S.acc.includes(a.productId);
        return `<button type="button" class="zb-acc" aria-pressed="${on}" data-id="${a.productId}" ${a.available ? '' : 'disabled'}>
          ${a.image ? `<img src="${esc(a.image)}" alt="">` : '<span></span>'}<span><span class="row"><span class="t">${esc(a.title)}</span><span class="num">${this.money(a.price)}</span></span>
          ${a.blurb ? `<span class="d">${esc(a.blurb)}</span>` : ''}<span class="tog">${!a.available ? 'Sold out' : on ? 'Added · tap to remove' : 'Add to build'}</span></span></button>`;
      }).join('');
      this.q('accOpts').querySelectorAll('.zb-acc').forEach((b) => {
        b.onclick = () => {
          const id = +b.dataset.id, i = S.acc.indexOf(id);
          if (i >= 0) S.acc.splice(i, 1);
          else {
            // accessories that share a pick-one group replace each other (for example the two slow feed augers)
            const g = this.accGroup(id), swap = g ? S.acc.filter((o) => this.accGroup(o) === g) : [];
            if (!swap.length && this.T.max.accessories && S.acc.length >= this.T.max.accessories) { this.chip(`Up to ${this.T.max.accessories} accessories per build`); return; }
            S.acc = S.acc.filter((o) => !swap.includes(o)); S.acc.push(id);
            if (swap.length) { const was = this.accs.find((a) => a.productId === swap[0]); if (was) this.chip(`Swapped out <b>${esc(was.title)}</b>`); }
          }
          this.save(); this.renderAcc(); this.update();
        };
      });
    }

    /* ---------- totals and cart ---------- */
    lines(build) {
      const S = this.S, v = this.variant(), L = [];
      const P = (fit) => (fit ? { Build: build, Fitting: fit } : { Build: build });
      L.push({ id: v.id, t: this.C.grinder.title.replace(/\s+-\s+.*$/, ''), s: v.title, p: v.price, props: P() });
      S.burrs.forEach((id, i) => { const b = this.burr(id); L.push({ id, t: b.name + ' burrs', s: i === 0 ? 'Installed at the factory' : 'Spare set, ships in the box', p: b.price, props: P(i === 0 ? 'Install in grinder' : 'Spare set, in the box') }); });
      const a = this.accent(S.accent);
      if (a) L.push({ id: a.id, t: a.title + ' accent piece', s: 'On the grinder', p: a.price, props: P('On the grinder') });
      S.accSpare.forEach((id) => { const x = this.accent(id); L.push({ id, t: x.title + ' accent piece', s: 'Extra, ships in the box', p: x.price, props: P('Extra piece, in the box') }); });
      const c = S.cap !== 'none' && this.cap(S.cap);
      if (c) L.push({ id: c.id, t: c.title + ' funnel cap', s: 'On the grinder', p: c.price, props: P('On the grinder') });
      S.capSpare.forEach((id) => { const x = this.cap(id); L.push({ id, t: x.title + ' funnel cap', s: 'Extra, ships in the box', p: x.price, props: P('Extra piece, in the box') }); });
      this.accs.filter((x) => S.acc.includes(x.productId)).forEach((x) => L.push({ id: x.variantId, t: x.title, s: x.variantTitle && x.variantTitle !== 'Default Title' ? x.variantTitle : '', p: x.price, props: P() }));
      return L;
    }
    update(rig = true) {
      const S = this.S, L = this.lines(''), tot = L.reduce((s, l) => s + l.p, 0), v = this.variant();
      this.b('v').textContent = this.money(tot);
      const inst = S.burrs[0] && this.burr(S.burrs[0]), ex = S.accSpare.length + S.capSpare.length, a = this.accent(S.accent);
      this.b('l').textContent = [v.options[this.ci], inst ? inst.short + (S.burrs.length > 1 ? ` +${S.burrs.length - 1} spare` : '') : (this.burrs.length ? 'No burrs yet' : ''), a ? a.title + (ex ? ` +${ex} extra` : '') : ''].filter(Boolean).join(' · ');
      this.q('sum').innerHTML = L.map((l) => `<tr><td>${esc(l.t)}${l.s ? `<small>${esc(l.s)}</small>` : ''}</td><td class="num">${this.money(l.p)}</td></tr>`).join('') +
        `<tr class="total"><td>Total</td><td class="num">${this.money(tot)}</td></tr>`;
      if (rig) this.renderRig();
      this.root.querySelectorAll('.zb-prop').forEach((d) => d.classList.toggle('on', S.step === 3 && (d.classList.contains('incl') || S.acc.includes(+d.dataset.pid))));
      this.q('tray').hidden = !(S.step === 1 && S.burrs.length > 1);
      this.q('tray2').hidden = !(S.step === 2 && this.spareItems().length);
      const nb = this.b('next');
      nb.textContent = S.step === 3 ? 'Add to cart' : 'Continue';
      nb.disabled = !this.stepReady(S.step) || this.adding;
      this.b('back').disabled = S.step === 0;
      this.q('hint').textContent = this.stepReady(S.step) ? '' : ['This finish is sold out. Choose another.', 'Choose at least one burr set to continue.', 'Choose an accent piece to continue.', ''][S.step];
      this.renderSteps();
    }
    async addToCart() {
      if (this.C.preview) { this.chip('Preview only. Add to cart works on the store.'); return; }
      if (this.adding) return;
      const build = String(this.C.buildPrefix || this.C.model || 'ZB').toUpperCase() + '-' + Date.now().toString(36).toUpperCase().slice(-6);
      const items = this.lines(build).map((l) => ({ id: l.id, quantity: 1, properties: l.props }));
      const msg = this.q('msg');
      this.adding = true; this.b('next').textContent = 'Adding…'; this.b('next').disabled = true;
      try {
        const res = await fetch(this.C.shop.cartAddUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ items }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.description || data.message || 'The cart could not be updated.');
        document.dispatchEvent(new CustomEvent('zerno:builder:added', { detail: { build, items } }));
        await refreshThemeCart('zerno-builder');
        const after = this.C.settings.afterAdd;
        if (after === 'checkout') { location.href = this.C.shop.rootUrl.replace(/\/$/, '') + '/checkout'; return; }
        if (after === 'cart') { location.href = this.C.shop.cartUrl; return; }
        msg.className = 'zb-msg'; msg.hidden = false;
        msg.innerHTML = `Added ${items.length} items to your cart as build ${esc(build)}. <a href="${esc(this.C.shop.cartUrl)}" style="color:inherit;text-decoration:underline">View cart</a>`;
      } catch (e) {
        msg.className = 'zb-msg err'; msg.hidden = false;
        msg.textContent = `${e.message} Nothing was added. Try again, or contact us if it keeps happening.`;
      } finally {
        this.adding = false; this.update(false);
      }
    }
  }

  function boot(scope = document) {
    scope.querySelectorAll('[data-zb-root]').forEach((root) => {
      if (root.dataset.zbReady) return;
      root.dataset.zbReady = '1';
      try { root._zb = new Builder(root); } catch (e) { console.error('[Zerno builder]', e); }
    });
  }
  window.ZernoBuilderBoot = boot;
  window.ZernoBuilderDraw = { texSquare, drawMesh };   // shared with the Art studio
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot());
  else boot();
  // theme editor: re-run when sections are re-rendered, clean up bars when removed
  document.addEventListener('shopify:section:load', (e) => boot(e.target));
  document.addEventListener('shopify:block:select', (e) => boot(e.target));
  document.addEventListener('shopify:section:unload', (e) => e.target.querySelectorAll('[data-zb-root]').forEach((r) => {
    document.querySelectorAll(`[data-zb-bar="${r.dataset.zbBlock}"]`).forEach((b) => b.remove());
  }));
})();
