/* Zerno Burr Guide
 * A four-question burr recommender. Runs two ways:
 *   1. As its own block (Burr Guide) on any page, with Add to cart on the results.
 *   2. As a "Help me choose" dialog inside a grinder builder, where the result installs the burr.
 * Grinders, burr sizes, burrs, fit scores and copy come from the catalog (catalog.js: the saved $app:catalog
 * metaobject, else the built-in default). One guide per burr size; a new size or burr is a catalog entry.
 * Prices, stock and variants always come from Shopify.
 */
(() => {
  if (window.ZernoBurrGuide) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  const merge = (a, b) => {
    if (!isObj(b)) return b === undefined ? a : b;
    const o = isObj(a) ? { ...a } : {};
    Object.keys(b).forEach((k) => { o[k] = merge(o[k], b[k]); });
    return o;
  };

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
  class BurrGuide {
    /**
     * opts: { mode: 'page'|'modal', fixed: grinder key or null, size: burr size key or 'all', catalog: saved catalog or null,
     *         shop: { sizeKey: [ live burr variants ] }, assetBase, money: (cents) => string, cartAddUrl, cartUrl, afterAdd,
     *         onPick: (ids) => void, heading }
     * live burr variants: { id, title, price (cents), available, img, url }
     */
    constructor(root, opts) {
      this.o = opts;
      const Cat = window.ZernoCatalog;
      const cat = Cat.get(opts.catalog);
      const D = cat.guide;
      this.METHODS = D.METHODS; this.PROFILES = D.PROFILES; this.ROASTS = D.ROASTS; this.TOGS = D.TOGS;
      const fmt = opts.money || ((c) => '$' + Math.round(c / 100).toLocaleString('en-US'));
      this.money = (c) => (c == null || isNaN(c) ? '' : fmt(c));   // no price when Shopify has none for the burr
      // one entry per grinder; grinders that share a burr size share its burrs. Only burrs Shopify sells are shown.
      this.G = Cat.guideGrinders(cat, { only: opts.fixed || null, size: opts.size || 'all', shop: opts.shop || null, base: Cat.assetBase(opts.assetBase) });
      Object.keys(this.G).forEach((k) => { if (!this.G[k].burrs.length) delete this.G[k]; });
      this.keys = Object.keys(this.G);
      const sizes = [...new Set(this.keys.map((k) => this.G[k].mm))];
      const list = (a) => (a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : a[0] || '');
      this.sizeLine = list(sizes);
      this.grLede = this.keys.length > 1 ? `Burr sets fit one burr size. ${list(this.keys.map((k, i) => `${i ? 'the' : 'The'} ${this.short(k)} takes ${this.G[k].mm} sets`))}.` : '';
      this.STEPS = opts.fixed ? ['Brew method', 'Your cup', 'Results'] : ['Grinder', 'Brew method', 'Your cup', 'Results'];
      this.S = { step: 0, seen: 0, g: opts.fixed || null, m: null, t: null, r: null, processed: false, forgiving: false };
      this.base = opts.fixed ? 1 : 0;           // the first question shown
      if (opts.mode === 'modal') this.openModal(); else { this.root = root; this.mount(); }
    }

    /* ---------- scoring (unchanged from the tuned Burr Finder) ---------- */
    score(b) {
      const S = this.S, f = b.fit; let s = 0;
      if (S.m) { s += f.m[S.m] * 3; if (f.m[S.m] <= 0.5) s -= 6; }
      if (S.t) {
        s += (S.t === 'balanced' ? (f.t.clarity + f.t.sweet + f.t.body) / 3 + f.m.both * 0.5 : f.t[S.t]) * 2.5;
        if (S.t !== 'balanced' && f.t[S.t] === 3 && !(S.r && S.r !== 'mix' && f.r[S.r] < 1) && !(S.forgiving && f.forgiving <= -1)) s += 2;
      }
      if (S.r) { s += (S.r === 'mix' ? (f.r.light + f.r.medium + f.r.dark) / 3 : f.r[S.r]) * 1.5; if (S.r !== 'mix' && f.r[S.r] === 0) s -= 5; }
      if (S.processed) s += f.processed * 2.5;
      if (S.forgiving) s += f.forgiving;
      return s;
    }
    ranked() {
      const S = this.S;
      if (!S.g || !S.m) return [];
      return this.G[S.g].burrs.map((b) => ({ b, s: this.score(b) })).sort((a, c) => c.s - a.s || c.b.fit.m[S.m] - a.b.fit.m[S.m]).slice(0, 3);
    }

    /* ---------- layout ---------- */
    q(n) { return this.el.querySelector(`[data-g="${n}"]`); }
    openModal() {
      this.ov = document.createElement('div');
      this.ov.className = 'zbg-ov';
      this.ov.innerHTML = '<div class="zbg zbg-modal" role="dialog" aria-modal="true" aria-label="Burr guide"><button type="button" class="zbg-x" aria-label="Close">&times;</button><div class="zbg-in"></div></div>';
      document.body.appendChild(this.ov);
      this.root = this.ov.querySelector('.zbg-in');
      this.ov.querySelector('.zbg-x').onclick = () => this.close();
      this.ov.addEventListener('click', (e) => { if (e.target === this.ov) this.close(); });
      this.onKey = (e) => { if (e.key === 'Escape') this.close(); };
      document.addEventListener('keydown', this.onKey);
      document.documentElement.classList.add('zbg-lock');
      this.mount();
      requestAnimationFrame(() => this.ov.classList.add('on'));
    }
    close() {
      if (!this.ov) return;
      document.removeEventListener('keydown', this.onKey);
      document.documentElement.classList.remove('zbg-lock');
      this.ov.classList.remove('on');
      setTimeout(() => this.ov.remove(), 250);
      if (this.o.onClose) this.o.onClose();
    }
    mount() {
      const o = this.o, modal = o.mode === 'modal';
      const step = (n, eyebrow, title, lede, body) => `<section data-step="${n}"><p class="zbg-eyebrow">${eyebrow}</p><h2>${title}</h2>${lede ? `<p class="zbg-lede">${lede}</p>` : ''}${body}</section>`;
      const total = this.STEPS.length, num = (i) => `Step ${i - this.base + 1} of ${total}`;
      this.root.innerHTML = `<div class="zbg-wrap">
        <header class="zbg-top"><span class="zbg-k">${esc(o.heading || 'Burr guide')}</span><ol class="zbg-steps" data-g="steps"></ol></header>
        <div class="zbg-grid">
          <div class="zbg-stage"><div class="zbg-sh"><div><div class="zbg-k" data-g="stageK"></div><h1 data-g="stageH"></h1></div>
            <p>Different burrs produce different grind shapes and particle size distributions, resulting in distinct flavor profiles and textures.</p></div>
            <div class="zbg-rows" data-g="rows"></div><div class="zbg-lead" data-g="lead"></div>
            <p class="zbg-fine">Recommendations are based on user testing on the Zerno platform and subjective feedback from the Zerno community. Most burrs can be used for any brew style.</p></div>
          <div class="zbg-rail">
            ${o.fixed ? '' : step(0, num(0), 'Choose your grinder', esc(this.grLede), '<div class="zbg-gr" data-g="grOpts"></div>')}
            ${step(1, num(1), 'How do you brew most?', 'Pick the method you reach for on most mornings. If you split your time, choose both.', '<div data-g="methodOpts"></div>')}
            ${step(2, num(2), 'Describe your cup', "Tell us what you like to drink and we'll match it to a geometry.",
              '<div class="zbg-group"><h3>Taste you chase <span>Pick one</span></h3><div data-g="profileOpts"></div></div><div class="zbg-group"><h3>Roast you buy most <span>Pick one</span></h3><div class="zbg-chips" data-g="roastOpts"></div></div><div class="zbg-group"><h3>Anything else? <span>Optional</span></h3><div data-g="togOpts"></div></div>')}
            ${step(3, num(3), '<span data-g="resH">Your burrs</span>', '', '<div class="zbg-answers" data-g="answers"></div><div data-g="results"></div><div class="zbg-pair" data-g="pair"></div>')}
            <p class="zbg-hint" data-g="hint"></p>
          </div>
        </div>
        <div class="zbg-bar"><div class="zbg-tot"><span class="l" data-g="totL"></span><span class="v" data-g="totV"></span></div>
          <div class="zbg-btns"><button type="button" class="zbg-btn" data-g="back">Back</button><button type="button" class="zbg-btn primary" data-g="next">Continue</button></div></div>
      </div>`;
      this.el = this.root.querySelector('.zbg-wrap');
      if (!modal) this.root.classList.add('zbg');
      this.S.step = this.base; this.S.seen = this.base;
      this.q('next').onclick = () => {
        const S = this.S;
        if (S.step === 3) { Object.assign(S, { step: this.base, seen: this.base, m: null, t: null, r: null, processed: false, forgiving: false }); if (!o.fixed) S.g = null; this.renderOpts(); this.renderStage(); this.update(); this.el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
        if (this.ready(S.step)) this.go(S.step + 1);
      };
      this.q('back').onclick = () => { if (this.S.step > this.base) this.go(this.S.step - 1); };
      this.renderOpts(); this.renderStage(); this.update();
    }
    lbl(arr, k) { return (arr.find((x) => x.k === k) || {}).t; }
    short(k) { const g = this.G[k]; return g ? String(g.name).replace(/^Zerno\s+/i, '') : k; }
    renderStage() {
      const S = this.S, keys = S.g ? [S.g] : this.keys;
      this.q('rows').innerHTML = keys.map((gk) => {
        const g = this.G[gk];
        return `<div class="zbg-row${S.g ? ' big' : ''}"><div class="zbg-rl"><b>${esc(g.name)} · ${esc(g.mm)}</b><span>${g.burrs.length} burr sets</span></div>
          <div class="zbg-burrs" style="--n:${g.burrs.length}">${g.burrs.map((b) => `<div class="zbg-bz" data-k="${b.k}"><div class="ph">${b.img ? `<img src="${esc(b.img)}" alt="${esc(b.t)} burr set">` : ''}<span class="rk"></span></div><span class="nm">${esc(b.s)}</span><span class="pr">${this.money(b.p)}</span></div>`).join('')}</div>
          <div class="zbg-band"><span>More clarity</span><i></i><span>More texture</span></div></div>`;
      }).join('');
      this.updateStage();
    }
    updateStage() {
      const S = this.S, g = S.g ? this.G[S.g] : null, R = this.ranked();
      this.q('stageK').textContent = g ? `${g.name} · ${g.mm} flat burrs` : `${this.sizeLine} flat burrs`;
      this.q('stageH').textContent = g && S.m ? 'Your burr recommendations' : 'Which burrs are right for you?';
      this.el.querySelectorAll('.zbg-bz').forEach((e) => e.removeAttribute('data-rank'));
      this.q('rows').classList.toggle('ranked', R.length > 0);
      R.forEach((x, i) => { const e = this.el.querySelector(`.zbg-bz[data-k="${x.b.k}"]`); if (e) { e.dataset.rank = i + 1; e.querySelector('.rk').textContent = i + 1; } });
      const L = this.q('lead');
      if (!g) L.innerHTML = 'Start with your grinder. Burr sets fit one platform only.';
      else if (!R.length) L.innerHTML = 'Laid out from most clarity to most texture. Pick a brew method to see your matches.';
      else L.innerHTML = `<span>Leading match <b>${esc(R[0].b.t)}</b></span>` + R.slice(1).map((x, i) => `<span class="pill">${i + 2} · ${esc(x.b.s)}</span>`).join('');
    }
    renderOpts() {
      const S = this.S, gr = this.q('grOpts');
      if (gr) {
        gr.innerHTML = this.keys.map((k) => { const g = this.G[k]; return `<button type="button" class="zbg-gcard" aria-pressed="${S.g === k}" data-k="${k}">
          <span class="gm">${esc(this.short(k))}</span><span class="gs">${esc(g.mm)} flat burrs</span><span class="gd">${esc(g.desc)}</span>
          <span class="stack">${g.burrs.filter((b) => b.img).map((b) => `<img src="${esc(b.img)}" alt="">`).join('')}</span></button>`; }).join('');
        gr.querySelectorAll('button').forEach((b) => { b.onclick = () => { if (S.g !== b.dataset.k) { S.g = b.dataset.k; this.renderStage(); } this.renderOpts(); this.update(); }; });
      }
      const opt = (arr, key, el) => {
        this.q(el).innerHTML = arr.map((o) => `<button type="button" class="zbg-opt" aria-pressed="${S[key] === o.k}" data-k="${o.k}"><span class="ic">${o.ic}</span><span><span class="t">${esc(o.t)}</span><span class="d">${esc(o.d)}</span></span></button>`).join('');
        this.q(el).querySelectorAll('button').forEach((b) => { b.onclick = () => { S[key] = b.dataset.k; this.renderOpts(); this.update(); }; });
      };
      opt(this.METHODS, 'm', 'methodOpts'); opt(this.PROFILES, 't', 'profileOpts');
      this.q('roastOpts').innerHTML = this.ROASTS.map((o) => `<button type="button" class="zbg-chip" aria-pressed="${S.r === o.k}" data-k="${o.k}">${esc(o.t)}</button>`).join('');
      this.q('roastOpts').querySelectorAll('button').forEach((b) => { b.onclick = () => { S.r = b.dataset.k; this.renderOpts(); this.update(); }; });
      this.q('togOpts').innerHTML = this.TOGS.map((o) => `<button type="button" class="zbg-tog" aria-pressed="${S[o.k]}" data-k="${o.k}"><span class="bx"></span><span><span class="t">${esc(o.t)}</span><span class="d">${esc(o.d)}</span></span></button>`).join('');
      this.q('togOpts').querySelectorAll('button').forEach((b) => { b.onclick = () => { S[b.dataset.k] = !S[b.dataset.k]; this.renderOpts(); this.update(); }; });
    }
    why(b) { const S = this.S, out = [b.m[S.m]]; if (S.t && S.t !== 'balanced') out.push(b.tp[S.t]); if (S.r && S.r !== 'mix') out.push(b.r[S.r]); return out.filter(Boolean); }
    warns(b) { const S = this.S, w = []; if (S.processed && b.warn && b.warn.processed) w.push(b.warn.processed); if (S.forgiving && b.warn && b.warn.forgiving) w.push(b.warn.forgiving); return w; }
    renderResults() {
      const S = this.S, g = this.G[S.g], R = this.ranked(), modal = this.o.mode === 'modal';
      if (!R.length) return;
      this.q('resH').textContent = `Your ${g.name} burrs`;
      this.q('answers').innerHTML = [g.name, this.lbl(this.METHODS, S.m), this.lbl(this.PROFILES, S.t), this.lbl(this.ROASTS, S.r) + ' roasts', S.processed ? 'Processed coffees' : '', S.forgiving ? 'Forgiving dial-in' : ''].filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join('');
      const act = (b, top) => {
        if (!b.v) return '';
        if (modal) return `<button type="button" class="zbg-link${top ? ' solid' : ''}" data-pick="${b.v}">${top ? 'Install this set' : `Choose ${esc(b.s)}`}</button>`;
        return `<button type="button" class="zbg-link${top ? ' solid' : ''}" data-add="${b.v}" ${b.available ? '' : 'disabled'}>${b.available ? `Add ${esc(b.s)} to cart` : 'Sold out'}</button>${b.url ? `<a class="zbg-link" href="${esc(b.url)}">Details</a>` : ''}`;
      };
      this.q('results').innerHTML = R.map((x, i) => {
        const b = x.b, top = i === 0, w = this.warns(b);
        const body = top
          ? `<h4>Why we recommend it</h4>${this.why(b).map((s) => `<p>${esc(s)}</p>`).join('')}${w.map((s) => `<p class="warn">${esc(s)}</p>`).join('')}${b.note ? `<p class="note">${esc(b.note)}</p>` : ''}${b.taste ? `<blockquote>${esc(b.taste)}</blockquote>` : ''}`
          : `<h4>Why it made your list</h4><p>${esc(b.m[S.m])} Choose it if ${esc(b.pick)}</p>${w.map((s) => `<p class="warn">${esc(s)}</p>`).join('')}`;
        return `<article class="zbg-res${top ? ' top' : ''}"><div class="hd">${b.img ? `<img src="${esc(b.img)}" alt="">` : '<span></span>'}<div><span class="rl">${top ? 'Top choice' : i === 1 ? 'Second choice' : 'Third choice'}</span><span class="nm">${esc(b.t)}</span>
          <span class="meta"><span>${esc(b.style)}</span><span>${esc(b.roast)} roasts</span><span>${esc(b.coat)}</span></span></div><span class="pr">${this.money(b.p)}</span></div>
          ${top ? `<p class="sum">${esc(b.sum)}</p>` : ''}${body}<div class="act">${act(b, top)}</div></article>`;
      }).join('');
      const p = g.pair, bk = (k) => g.burrs.find((b) => b.k === k), A = p && bk(p.a), B = p && bk(p.b);
      this.q('pair').innerHTML = A && B ? `<h3>Prefer two dedicated sets?</h3><p>${esc(p.t)} Burr swaps take minutes, so switching daily is easy.</p>
        <div class="duo"><div>${A.img ? `<img src="${esc(A.img)}" alt="">` : ''}${esc(A.t)}</div><span class="plus">+</span><div>${B.img ? `<img src="${esc(B.img)}" alt="">` : ''}${esc(B.t)}</div></div>
        ${A.v && B.v ? `<div class="act">${modal ? `<button type="button" class="zbg-link" data-pick="${A.v},${B.v}">Install ${esc(A.s)}, add ${esc(B.s)} as a spare</button>` : `<button type="button" class="zbg-link" data-add="${A.v},${B.v}">Add both to cart</button>`}</div>` : ''}` : '';
      this.el.querySelectorAll('[data-pick]').forEach((b) => { b.onclick = () => { const ids = b.dataset.pick.split(',').map(Number); this.close(); if (this.o.onPick) this.o.onPick(ids); }; });
      this.el.querySelectorAll('[data-add]').forEach((b) => { b.onclick = () => this.add(b.dataset.add.split(',').map(Number), b); });
    }
    // a message right under the button, so the result shows where the customer clicked
    note(btn, html, err) {
      const act = btn.closest('.act') || btn.parentNode;
      let n = act.querySelector('.zbg-note');
      if (!n) { n = document.createElement('p'); n.className = 'zbg-note'; n.setAttribute('role', 'status'); act.appendChild(n); }
      n.classList.toggle('err', !!err); n.innerHTML = html;
    }
    async add(ids, btn) {
      const o = this.o, txt = btn.textContent;
      btn.disabled = true; btn.textContent = 'Adding…';
      try {
        const r = await fetch(o.cartAddUrl || '/cart/add.js', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ items: ids.map((id) => ({ id, quantity: 1, properties: { _source: 'Burr Guide' } })) }) });
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.description || d.message || 'The cart could not be updated.'); }
        await refreshThemeCart('zerno-burr-guide');
        if (o.afterAdd === 'cart') { location.href = o.cartUrl || '/cart'; return; }
        btn.textContent = 'Added to cart';
        this.note(btn, `Added to your cart. <a href="${esc(o.cartUrl || '/cart')}">View cart</a>`);
        this.q('hint').innerHTML = `Added. <a href="${esc(o.cartUrl || '/cart')}">View cart</a>`;
      } catch (e) {
        btn.disabled = false; btn.textContent = txt;
        this.note(btn, `${esc(e.message)} Nothing was added.`, true);
        this.q('hint').textContent = e.message;
        if (window.console) console.warn('[Zerno Burr Guide] add to cart failed:', e);
      }
    }
    ready(i) { const S = this.S; return i === 0 ? !!S.g : i === 1 ? !!S.m : i === 2 ? !!(S.t && S.r) : true; }
    go(i) {
      for (let j = this.base; j < i; j++) if (!this.ready(j)) { i = j; break; }
      const S = this.S; S.step = i; S.seen = Math.max(S.seen, i);
      if (i === 3) this.renderResults();
      this.update();
      const rail = this.el.querySelector('.zbg-rail');
      if (i === 3 && (this.o.mode === 'modal' || matchMedia('(max-width:960px)').matches)) rail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    update() {
      const S = this.S;
      this.el.querySelectorAll('.zbg-rail section').forEach((s) => s.classList.toggle('active', +s.dataset.step === S.step));
      const steps = this.STEPS.map((t, j) => ({ t, i: j + this.base }));
      this.q('steps').innerHTML = steps.map(({ t, i }) => `<li><button type="button" ${i > S.seen && !(i === S.seen + 1 && this.ready(S.seen)) ? 'disabled' : ''} class="${i < S.step || (i <= S.seen && this.ready(i) && i !== S.step && i < 3) ? 'done' : ''}" ${i === S.step ? 'aria-current="step"' : ''} data-i="${i}"><span class="n">${i - this.base + 1}</span><span class="lbl">${esc(t)}</span></button></li>`).join('');
      this.q('steps').querySelectorAll('button').forEach((b) => { b.onclick = () => this.go(+b.dataset.i); });
      this.updateStage();
      const g = S.g ? this.G[S.g] : null, R = this.ranked();
      this.q('totL').textContent = g ? [g.name, this.lbl(this.METHODS, S.m), this.lbl(this.PROFILES, S.t), S.r ? this.lbl(this.ROASTS, S.r) + ' roasts' : ''].filter(Boolean).join(' · ') : 'Start with your grinder';
      this.q('totV').textContent = R.length ? (S.step === 3 ? 'Top choice · ' + R[0].b.t : 'Leading · ' + R[0].b.t) : (g ? g.name + ' · ' + g.mm : 'Burr guide');
      const nb = this.q('next');
      if (S.step === 3) { nb.textContent = 'Start over'; nb.disabled = false; } else { nb.textContent = S.step === 2 ? 'See my burrs' : 'Continue'; nb.disabled = !this.ready(S.step); }
      this.q('back').disabled = S.step === this.base;
      if (!/View cart/.test(this.q('hint').innerHTML)) this.q('hint').textContent = this.ready(S.step) ? '' : S.step === 0 ? 'Choose a grinder to continue.' : S.step === 1 ? 'Choose a brew method to continue.' : 'Pick a taste and a roast to see your burrs.';
    }
  }
  window.ZernoBurrGuide = BurrGuide;

  // Standalone blocks: <div data-zbg-root> with a JSON config inside
  const boot = () => document.querySelectorAll('[data-zbg-root]:not([data-zbg-on])').forEach((root) => {
    root.dataset.zbgOn = '1';
    const C = JSON.parse(root.querySelector('script[data-zbg-config]').textContent);
    const fmt = new Intl.NumberFormat(C.locale || 'en-US', { style: 'currency', currency: C.currency || 'USD', maximumFractionDigits: 0 });
    const h = (location.hash || '').slice(1).toLowerCase();
    if (!window.ZernoCatalog) { root.textContent = 'The burr guide could not load.'; return; }
    const g = new BurrGuide(root, { mode: 'page', fixed: C.fixed || null, size: C.size || 'all', catalog: C.catalog, shop: C.shop, assetBase: C.assetBase,
      heading: C.heading, money: (c) => fmt.format(c / 100), cartAddUrl: C.cartAddUrl, cartUrl: C.cartUrl, afterAdd: C.afterAdd });
    if (!C.fixed && g.G[h]) { g.S.g = h; g.renderStage(); g.renderOpts(); g.go(1); }
    else if (!C.fixed && g.keys.length === 1) { g.S.g = g.keys[0]; g.renderStage(); g.renderOpts(); g.go(1); }
  });
  // "Edge to edge": stretch the block to the window's width, whatever the width of the theme section around it
  const bleed = () => document.querySelectorAll('[data-zbg-root][data-zbg-width="full"]').forEach((root) => {
    Object.assign(root.style, { width: '', marginLeft: '', marginRight: '', flex: '', maxWidth: '' });
    const vw = document.documentElement.clientWidth, left = root.getBoundingClientRect().left + window.scrollX;
    if (!vw || root.offsetWidth >= vw - 1) return;
    Object.assign(root.style, { width: vw + 'px', maxWidth: 'none', flex: '0 0 auto', marginLeft: -left + 'px', marginRight: '0' });
  });
  let raf = 0;
  const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(bleed); };
  const start = () => { boot(); bleed(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.addEventListener('resize', onResize);
  window.addEventListener('load', bleed);
  document.addEventListener('shopify:section:load', start);
})();
