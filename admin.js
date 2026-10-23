/* Zerno Builder admin (Apps > Zerno Builder in Shopify admin).
 * A static page: it reads and writes Shopify directly through App Bridge's Direct API access
 * (fetch('shopify:admin/api/graphql.json')), so there is no server.
 *
 * Saved in Shopify as app metaobjects, read by the storefront blocks with Liquid:
 *   $app:catalog "main"  grinders, burr sizes, burrs, accessories, textures, art and Burr Guide copy
 *   $app:option_set      one per builder setup, assigned to grinder products
 *   $app:template        option set layouts saved for reuse
 * Pages: Home, Option sets, Products, Orders, Templates, Catalog, Burr guides, Settings, Help.
 * Catalog, Burr guides and the Art studio live in admin-catalog.js and studio.js.
 */
(() => {
  const API = 'shopify:admin/api/2026-04/graphql.json';
  const Cat = window.ZernoCatalog;
  const GROUPS = [
    { k: 'finish', name: 'Grinder color', kind: 'finish' },
    { k: 'burrs', name: 'Burr set', kind: 'list', list: 'burrs' },
    { k: 'accents', name: 'Accent piece', kind: 'list', list: 'accents' },
    { k: 'caps', name: 'Funnel cap', kind: 'list', list: 'caps' },
    { k: 'accessories', name: 'Accessories', kind: 'list', list: 'accessories' }
  ];
  const FIELD = { burrs: 'burr_variants', accents: 'accent_variants', caps: 'cap_variants', accessories: 'accessory_variants' };
  const NAV = [['home', 'Home'], ['sets', 'Option sets'], ['products', 'Products'], ['orders', 'Orders'], ['templates', 'Templates'], ['catalog', 'Catalog'], ['guides', 'Burr guides'], ['settings', 'Settings'], ['help', 'Help']];
  // inside Shopify admin the sidebar and the title bar carry the navigation, so the page skips its own nav row
  const EMBEDDED = (() => { try { return window.top !== window.self; } catch (e) { return true; } })();

  /* ---------- helpers ---------- */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (gid) => +String(gid).split('/').pop();
  const cents = (p) => Math.round(parseFloat(p || 0) * 100);
  const money = (c) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0 });
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const toast = (msg, err) => {
    if (window.shopify && shopify.toast) { shopify.toast.show(msg, { isError: !!err }); return; }
    const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), 2600);
  };
  async function gql(query, variables = {}) {
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
    const j = await r.json();
    if (j.errors && j.errors.length) throw new Error(j.errors.map((e) => e.message).join('; '));
    return j.data;
  }
  const userErr = (res) => { const e = (res && (res.userErrors || [])).filter(Boolean); if (e.length) throw new Error(e.map((x) => x.message).join('; ')); return res; };
  const field = (mo, k) => { const f = (mo.fields || []).find((x) => x.key === k); return f ? f.value : null; };
  const parse = (v, d) => { try { return v == null || v === '' ? d : JSON.parse(v); } catch (e) { return d; } };
  const inp = (id, label, value, help = '', type = 'text', attrs = '') => `<div class="field"><label for="${id}">${label}</label><input type="${type}" id="${id}" value="${esc(value == null ? '' : value)}" ${attrs}>${help ? `<span class="help">${help}</span>` : ''}</div>`;
  const chk = (id, label, on, help = '') => `<label class="check"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span>${label}${help ? `<small>${help}</small>` : ''}</span></label>`;
  const spin = (t = 'Loading…') => `<div class="card"><span class="spin"></span> ${esc(t)}</div>`;
  const errBox = (e) => `<div class="err">${esc(e && e.message ? e.message : e)}</div>`;

  /* ---------- Shopify data ---------- */
  const VARIANT = `id title price availableForSale image { url } selectedOptions { name value }
    product { id title handle featuredMedia { preview { image { url } } } group: metafield(namespace: "zerno", key: "builder_group") { value } }`;
  const pimg = (p) => (p && p.featuredMedia && p.featuredMedia.preview && p.featuredMedia.preview.image && p.featuredMedia.preview.image.url) || null;
  const toVariant = (v) => ({
    id: num(v.id), gid: v.id, title: v.title, price: cents(v.price), available: v.availableForSale !== false,
    image: (v.image && v.image.url) || pimg(v.product), options: (v.selectedOptions || []).map((o) => o.value),
    group: (v.product && v.product.group && v.product.group.value) || '',
    product: v.product ? { id: num(v.product.id), gid: v.product.id, title: v.product.title, handle: v.product.handle, image: pimg(v.product) } : null
  });
  async function variantsByIds(gids) {
    const out = [];
    for (let i = 0; i < gids.length; i += 100) {
      const d = await gql(`query V($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant { ${VARIANT} } } }`, { ids: gids.slice(i, i + 100) });
      out.push(...d.nodes.filter(Boolean).map(toVariant));
    }
    return out;
  }
  const PRODUCT = `id title handle status productType vendor templateSuffix featuredMedia { preview { image { url } } } options { name values } variants(first:50){ nodes { ${VARIANT} } }`;
  async function productsByHandles(handles) {
    const hs = [...new Set(handles.filter(Boolean))];
    const out = [];
    for (let i = 0; i < hs.length; i += 25) {
      const d = await gql(`query P($q:String!){ products(first:50, query:$q){ nodes { ${PRODUCT} } } }`, { q: hs.slice(i, i + 25).map((h) => `handle:${h}`).join(' OR ') });
      out.push(...d.products.nodes);
    }
    return out;
  }
  async function productsByIds(gids) {
    if (!gids.length) return [];
    const d = await gql(`query P($ids:[ID!]!){ nodes(ids:$ids){ ... on Product { ${PRODUCT} } } }`, { ids: gids });
    return d.nodes.filter(Boolean);
  }
  async function loadSets() {
    const d = await gql(`{ metaobjects(type:"$app:option_set", first:100){ nodes { id handle updatedAt fields { key value } } } }`);
    return d.metaobjects.nodes.map((mo) => ({
      id: mo.id, handle: mo.handle, updatedAt: mo.updatedAt, title: field(mo, 'title') || 'Option set', builder: field(mo, 'builder') || '',
      active: field(mo, 'active') === 'true', priority: parseInt(field(mo, 'priority'), 10) || 0, products: parse(field(mo, 'products'), []),
      lists: Object.fromEntries(Object.entries(FIELD).map(([k, f]) => [k, parse(field(mo, f), [])])),
      config: parse(field(mo, 'config'), {})
    }));
  }

  /* The catalog: the saved $app:catalog, else the built-in default plus any old $app:burr_guide tuning. */
  async function loadCatalog() {
    const d = await gql(`{ c: metaobjectByHandle(handle:{type:"$app:catalog", handle:"main"}){ id fields { key value } }
      g: metaobjectByHandle(handle:{type:"$app:burr_guide", handle:"main"}){ id fields { key value } } }`);
    const saved = d.c ? parse(field(d.c, 'data'), null) : null;
    if (saved && Array.isArray(saved.grinders)) return { cat: Cat.get(saved), saved: true };
    const cat = clone(Cat.get(null));
    const old = d.g ? parse(field(d.g, 'data'), {}) : {};
    Object.entries((old && old.G) || {}).forEach(([gk, o]) => {
      const g = cat.grinders.find((x) => x.key === gk); if (!g || !o) return;
      Object.entries(o.burrs || {}).forEach(([bk, ov]) => {
        const b = cat.burrs.find((x) => x.key === bk && x.size === g.size); if (b && ov) deepMerge(b, ov);
      });
      if (o.desc) g.guide = { ...(g.guide || {}), desc: o.desc };
    });
    return { cat, saved: false };
  }
  function deepMerge(a, b) { Object.entries(b).forEach(([k, v]) => { if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object') deepMerge(a[k], v); else a[k] = v; }); return a; }
  async function saveCatalog(cat) {
    userErr((await gql(`mutation C($h:MetaobjectHandleInput!,$m:MetaobjectUpsertInput!){ metaobjectUpsert(handle:$h, metaobject:$m){ metaobject { id } userErrors { message } } }`,
      { h: { type: '$app:catalog', handle: 'main' }, m: { fields: [{ key: 'data', value: JSON.stringify(cat) }] } })).metaobjectUpsert);
  }

  /* Upload an image to Shopify Files and return its CDN url (for the Art studio, burr photos and included items). */
  async function uploadImage(blob, filename) {
    if (window.ZBA_UPLOAD) return window.ZBA_UPLOAD(blob, filename);
    const mimeType = blob.type || (/\.png$/i.test(filename) ? 'image/png' : 'image/jpeg');
    const st = userErr((await gql(`mutation S($i:[StagedUploadInput!]!){ stagedUploadsCreate(input:$i){ stagedTargets { url resourceUrl parameters { name value } } userErrors { message } } }`,
      { i: [{ filename, mimeType, resource: 'IMAGE', httpMethod: 'POST', fileSize: String(blob.size) }] })).stagedUploadsCreate);
    const t = st.stagedTargets[0], form = new FormData();
    t.parameters.forEach((p) => form.append(p.name, p.value));
    form.append('file', blob, filename);
    const up = await fetch(t.url, { method: 'POST', body: form });
    if (!up.ok) throw new Error(`Upload failed (${up.status})`);
    const fc = userErr((await gql(`mutation F($f:[FileCreateInput!]!){ fileCreate(files:$f){ files { id fileStatus ... on MediaImage { image { url } } } userErrors { message } } }`,
      { f: [{ originalSource: t.resourceUrl, contentType: 'IMAGE', alt: filename }] })).fileCreate);
    const id = fc.files[0].id;
    for (let i = 0; i < 40; i++) {
      const d = await gql(`query N($id:ID!){ node(id:$id){ ... on MediaImage { fileStatus image { url } } } }`, { id });
      const n = d.node || {};
      if (n.fileStatus === 'FAILED') throw new Error(`Shopify could not process ${filename}`);
      if (n.image && n.image.url) return n.image.url;
      await new Promise((r) => setTimeout(r, 1000 + i * 250));
    }
    throw new Error(`${filename} is still processing. Try again in a minute.`);
  }

  /* Pick an image already in Shopify Files (Content > Files). Resolves to its CDN url, or null. */
  function pickFile({ title = 'Choose from Shopify Files' } = {}) {
    return new Promise((resolve) => {
      const ov = document.createElement('div'); ov.className = 'modal-ov';
      ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="mh"><b>${esc(title)}</b><button class="ic" data-x aria-label="Close">&times;</button></div>
        <div class="mb"><input type="search" placeholder="Search by file name" data-q aria-label="Search files"><div class="fgrid" data-g></div><div class="fmore"><button class="btn sm" data-more hidden>Load more</button></div></div>
        <div class="mf"><span class="muted" data-n></span><span style="display:flex;gap:8px"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok disabled>Use this image</button></span></div></div>`;
      document.body.appendChild(ov);
      const grid = $('[data-g]', ov), more = $('[data-more]', ov), ok = $('[data-ok]', ov), qIn = $('[data-q]', ov);
      let sel = null, after = null, term = '', t = null, seq = 0;
      const done = (v) => { ov.remove(); document.removeEventListener('keydown', key); resolve(v); };
      const key = (e) => { if (e.key === 'Escape') done(null); };
      document.addEventListener('keydown', key);
      $$('[data-x]', ov).forEach((b) => { b.onclick = () => done(null); });
      ov.onclick = (e) => { if (e.target === ov) done(null); };
      ok.onclick = () => sel && done(sel.url);
      const thumb = (u) => u + (u.includes('?') ? '&' : '?') + 'width=240';
      async function load(reset) {
        const my = ++seq;
        if (reset) { after = null; sel = null; ok.disabled = true; grid.innerHTML = '<span class="spin"></span>'; }
        try {
          const d = await gql(`query F($q:String,$a:String){ files(first:40, after:$a, sortKey:CREATED_AT, reverse:true, query:$q){ pageInfo { hasNextPage endCursor }
            nodes { id alt ... on MediaImage { image { url width height } } } } }`, { q: 'media_type:IMAGE' + (term ? ' ' + term : ''), a: after });
          if (my !== seq) return;
          if (reset) grid.innerHTML = '';
          d.files.nodes.filter((n) => n.image && n.image.url).forEach((n) => {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'ftile';
            const name = decodeURIComponent(n.image.url.split('?')[0].split('/').pop());
            b.innerHTML = `<img src="${esc(thumb(n.image.url))}" alt="" loading="lazy"><span>${esc(name)}</span>`;
            b.title = `${name} · ${n.image.width} x ${n.image.height}`;
            b.onclick = () => { $$('.ftile', grid).forEach((x) => x.classList.remove('on')); b.classList.add('on'); sel = n.image; ok.disabled = false; $('[data-n]', ov).textContent = `${name}, ${n.image.width} x ${n.image.height} px`; };
            b.ondblclick = () => done(n.image.url);
            grid.appendChild(b);
          });
          if (!grid.children.length) grid.innerHTML = `<p class="empty">${term ? 'No images match.' : 'No images in Shopify Files yet.'}</p>`;
          after = d.files.pageInfo.endCursor; more.hidden = !d.files.pageInfo.hasNextPage;
        } catch (e) {
          grid.innerHTML = /access|scope|permission|denied/i.test(e.message) ? '<div class="note">Zerno Builder needs permission to read Shopify Files. Run the deploy again and approve the new access.</div>' : errBox(e);
        }
      }
      more.onclick = () => load(false);
      qIn.oninput = () => { clearTimeout(t); t = setTimeout(() => { term = qIn.value.trim().replace(/[^\w .-]/g, ''); load(true); }, 300); };
      load(true); qIn.focus();
    });
  }

  /* ---------- state, save bar and navigation ---------- */
  const A = { view: 'home', sub: '', sets: [], set: null, saved: null, variants: {}, grinders: [], prices: {}, cat: null, catSaved: null, catIsSaved: false, dirty: false, open: { finish: true }, onSave: null, onDiscard: null };
  const app = () => $('#app');
  const body = () => $('#body');
  function markDirty() { A.dirty = true; $('#savebar').classList.add('on'); if (A.view === 'sets' && A.set) schedulePreview(); }
  function clean() { A.dirty = false; $('#savebar').classList.remove('on'); }
  async function ensureCatalog() {
    if (A.cat) return A.cat;
    const r = await loadCatalog(); A.cat = r.cat; A.catSaved = clone(r.cat); A.catIsSaved = r.saved;
    return A.cat;
  }
  const grinderName = (key) => { const g = A.cat && A.cat.grinders.find((x) => x.key === key); return g ? g.name : (key ? key.toUpperCase() : 'No grinder'); };
  const shortName = (g) => String(g.name).replace(/^Zerno\s+/i, '');

  /* ---------- routing ----------
     Each page has its own folder (z-builder-admin/catalog/ and so on, made by tools/sync-shared.mjs) so the Shopify
     admin sidebar highlights the right item. A detail rides in the hash: catalog/#/catalog/grinders/z1.
     App Bridge changes the iframe's URL without reloading it, so every way the URL can change is watched. */
  const ROOT = new URL('./', document.baseURI).pathname;        // the app's folder; index.html pins <base> to it
  const isView = (v) => NAV.some(([k]) => k === v);
  const SHARED = ['catalog', 'guides'];                          // pages that edit the same working catalog
  function viewOf(u) {
    // the page folder: the path segment after the app's folder (any app folder, so absolute sidebar links work in tests too)
    const p = u.pathname.startsWith(ROOT) ? u.pathname.slice(ROOT.length).split('/')[0] : u.pathname.split('/').filter(Boolean).reverse().find(isView) || '';
    const [hv, ...rest] = u.hash.replace(/^#\/?/, '').split('/');
    const q = u.searchParams.get('view');
    const view = isView(p) ? p : isView(hv) ? hv : isView(q) ? q : 'home';
    return { view, sub: hv === view ? rest.join('/') : '' };
  }
  const readRoute = () => viewOf(new URL(location.href));
  function urlFor(view, sub = '') {
    const q = new URLSearchParams(location.search); q.delete('view');
    const s = q.toString();
    return ROOT + (view === 'home' ? '' : view + '/') + (s ? '?' + s : '') + (sub ? '#/' + view + '/' + sub : '');
  }
  let lastUrl = location.href;
  function setUrl(view, sub = '') { history.replaceState(null, '', urlFor(view, sub)); lastUrl = location.href; A.view = view; A.sub = sub; }
  function leaveOk(target) {
    if (!A.dirty) return true;
    if (SHARED.includes(A.view) && SHARED.includes(target)) return true;      // keep catalog edits between Catalog and Burr guides
    if (!confirm('Leave without saving your changes?')) return false;
    if (A.catSaved) A.cat = clone(A.catSaved);            // drop unsaved catalog edits too
    clean();
    return true;
  }
  function go(view, sub = '') {
    if (!leaveOk(view)) return false;
    A.onSave = null; A.onDiscard = null;
    setUrl(view, sub);
    route();
    return true;
  }
  function onUrlChange() {
    if (location.href === lastUrl) return;
    const r = readRoute();
    if (r.view === A.view && r.sub === A.sub) { lastUrl = location.href; return; }
    if (!leaveOk(r.view)) { history.replaceState(null, '', urlFor(A.view, A.sub)); lastUrl = location.href; return; }
    lastUrl = location.href; A.onSave = null; A.onDiscard = null;
    route();
  }
  function watchUrl() {
    const later = () => setTimeout(onUrlChange, 0);
    ['pushState', 'replaceState'].forEach((k) => { const orig = history[k].bind(history); history[k] = (...a) => { const r = orig(...a); later(); return r; }; });
    window.addEventListener('popstate', later);
    window.addEventListener('hashchange', later);
    if (window.navigation && window.navigation.addEventListener) window.navigation.addEventListener('navigatesuccess', later);
    // App Bridge fires shopify:navigate on the nav link; follow its href ourselves in case it only announces it
    document.addEventListener('shopify:navigate', (e) => {
      const href = e.target && e.target.getAttribute && e.target.getAttribute('href'); if (!href) return;
      const v = viewOf(new URL(href, document.baseURI)).view;
      if (v !== A.view) go(v);
    });
  }
  async function route() {
    const r = readRoute(); A.view = r.view; A.sub = r.sub; A.set = null;
    $$('#nav button').forEach((b) => b.setAttribute('aria-current', b.dataset.v === A.view ? 'page' : 'false'));
    body().innerHTML = spin();
    try { await ensureCatalog(); } catch (e) { body().innerHTML = errBox(e); return; }
    const ext = window.ZBAdminCatalog || {};
    const V = { home: showHome, sets: showSets, templates: showTemplates, orders: showOrders, settings: showSettings, help: showHelp, products: () => (ext.showProducts ? ext.showProducts(A.sub) : (body().innerHTML = errBox('The products page did not load.'))) };
    if (A.view !== 'home') titleBar((NAV.find(([k]) => k === A.view) || [, 'Zerno Builder'])[1]);
    if (A.view === 'catalog') return ext.showCatalog ? ext.showCatalog(A.sub) : (body().innerHTML = errBox('The catalog page did not load.'));
    if (A.view === 'guides') return ext.showGuides ? ext.showGuides(A.sub) : (body().innerHTML = errBox('The burr guides page did not load.'));
    return V[A.view]();
  }
  function shell() {
    document.body.classList.toggle('embedded', EMBEDDED);
    app().innerHTML = `<div class="top"><div class="brand">Zerno Builder</div><nav id="nav" aria-label="Zerno Builder">${NAV.map(([k, n]) => `<button data-v="${k}">${n}</button>`).join('')}</nav></div><div id="body"></div>`;
    $$('#nav button').forEach((b) => { b.onclick = () => go(b.dataset.v); });
  }
  const head = (title, sub = '', actions = '') => `<div class="ph"><h1>${title}</h1>${actions}</div>${sub ? `<p class="lede">${sub}</p>` : ''}`;

  /* ---------- Home ---------- */
  const API_KEY = (document.querySelector('meta[name="shopify-api-key"]') || {}).content || '';
  const editorLink = (template, block, target) => `shopify://admin/themes/current/editor?template=${template}${block ? `&addAppBlockId=${API_KEY}/${block}&target=${target}` : ''}`;
  /* Which of the app's blocks the live theme uses (needs read_themes). */
  async function themeStatus() {
    const d = await gql(`{ themes(first:1, roles:[MAIN]){ nodes { id name files(first:100, filenames:["templates/*.json"]){ nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } } } } } }`);
    const t = d.themes.nodes[0]; if (!t) return null;
    const files = (t.files && t.files.nodes) || [];
    const uses = (re) => files.filter((f) => f.body && f.body.content && re.test(f.body.content)).map((f) => f.filename.replace(/^templates\//, '').replace(/\.json$/, ''));
    return { name: t.name, builder: uses(/zerno-builder\/blocks\/(grinder|z1|z2)-builder/), guide: uses(/zerno-builder\/blocks\/burr-guide/) };
  }
  function hidden(k) { try { return localStorage.getItem('zba-hide-' + k) === '1'; } catch (e) { return false; } }
  function hide(k) { try { localStorage.setItem('zba-hide-' + k, '1'); } catch (e) { /* private window */ } }
  async function showHome() {
    titleBar('Zerno Builder');
    const cat = A.cat;
    let sets = [], prods = [], err = '';
    try { [sets, prods] = await Promise.all([loadSets(), productsByHandles([...cat.grinders.map((g) => g.product), ...cat.sizes.flatMap((s) => s.products || [])])]); } catch (e) { err = e.message; }
    A.sets = sets;
    const ph = (h) => prods.find((p) => p.handle === h);
    const steps = [
      { done: A.catIsSaved, t: 'Save your catalog', d: A.catIsSaved ? 'Your grinders, burr sizes, burrs and accessories are saved in Shopify.' : 'The store uses the built-in catalog. Open Catalog and save it once to make it yours.', go: 'catalog', b: 'Open Catalog' },
      { done: cat.grinders.every((g) => ph(g.product)), t: 'Link each grinder to its product', d: 'Every grinder in the catalog needs its Shopify product.', go: 'products', b: 'Open Products' },
      { done: cat.grinders.every((g) => winner(g, sets, ph(g.product)).os), t: 'Give each grinder an active option set', d: 'Option sets control what each builder offers. Templates give you a head start.', go: 'sets', b: 'Create option set' },
      { done: cat.sizes.every((s) => (s.products || []).some((h) => ph(h))), t: 'Link each burr size to its burr product', d: 'The Burr Guide reads prices and stock from these products.', go: 'guides', b: 'Open Burr guides' },
      { done: cat.grinders.every((g) => g.art), t: 'Make art for each grinder', d: 'New grinders show their product photo. The Art studio cuts out the grinder, accent piece and funnel cap so colors and woods show on the grinder.', go: 'products', b: 'Open Products' }
    ];
    const n = steps.filter((s) => s.done).length, first = steps.findIndex((s) => !s.done);
    body().innerHTML = head('Home') + (err ? errBox(err) : '') + `<div class="narrow">
      <div class="banner" id="tstat"><span class="spin"></span> Checking your live theme…</div>
      ${hidden('guide') && n === steps.length ? '' : `<div class="card"><div class="cardrow"><div><h2>Setup guide</h2><p class="sub" style="margin:0">Get the builders ready by following these steps.</p></div><button class="ic" id="hideguide" aria-label="Hide the setup guide">&times;</button></div>
        <div class="progress"><b>${n} / ${steps.length} completed</b><div class="meter"><i style="width:${(n / steps.length) * 100}%"></i></div></div>
        <ol class="checklist">${steps.map((s, i) => `<li class="${s.done ? 'done' : ''}${i === first ? ' open' : ''}"><span class="tick" aria-hidden="true">${s.done ? '&#10003;' : ''}</span><div><b>${esc(s.t)}</b><p>${esc(s.d)}</p>${i === first ? `<button class="btn sm" data-go="${s.go}">${esc(s.b)}</button>` : ''}</div>${i === first ? '' : `<button class="btn plain sm" data-go="${s.go}">${s.done ? 'View' : 'Start'}</button>`}</li>`).join('')}</ol></div>`}
      <div class="card"><h2>Sales from the builders</h2><p class="sub">Orders with a builder build or a Burr Guide pick.</p>
        <select id="hdays" class="pill" aria-label="Date range">${[7, 30, 60].map((d) => `<option value="${d}">Last ${d} days</option>`).join('')}</select>
        <div class="kpis" id="kpis"><span class="spin"></span></div></div>
      <div class="card"><h2>Quick actions</h2><div class="qa">
        ${[['sets/new', 'Create an option set', 'Pick a grinder and a template.'], ['products', 'Make grinder art', 'Cut out the grinder, accent and cap.'], ['guides', 'Add a burr', 'New variants show up, ready to add.'], ['products', 'Cut out a product photo', 'Burrs, accessories and in-the-box items.']]
          .map(([to, t, d]) => `<button class="qcard" data-go="${to}"><b>${t}</b><span>${d}</span></button>`).join('')}</div></div>
      <div class="card"><h2>Need help?</h2><p class="sub" style="margin:0">See how the catalog, option sets, templates and burr guides fit together in <a href="#" data-go="help">Help</a>.</p></div></div>`;
    $$('[data-go]').forEach((b) => { b.onclick = (e) => { e.preventDefault(); const [v, ...s] = b.dataset.go.split('/'); go(v, s.join('/')); }; });
    if ($('#hideguide')) $('#hideguide').onclick = () => { hide('guide'); $('#hideguide').closest('.card').remove(); };
    const kpis = async () => {
      const days = +$('#hdays').value, box = $('#kpis');
      try {
        const o = await loadOrders(days);
        if (!$('#kpis')) return;
        box.innerHTML = [['Sales from the app', money(o.reduce((t, x) => t + x.fromApp, 0))], ['Orders', o.length], ['Builds', o.reduce((t, x) => t + x.builds.length, 0)], ['Burr Guide orders', o.filter((x) => x.guide.length).length]]
          .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
      } catch (e) { box.innerHTML = `<p class="muted">${/access|scope|permission|denied/i.test(e.message) ? 'Approve order access in the next deploy to see sales here.' : esc(e.message)}</p>`; }
    };
    $('#hdays').onchange = kpis; kpis();
    themeStatus().then((t) => {
      const el = $('#tstat'); if (!el) return;
      if (!t) { el.remove(); return; }
      const on = t.builder.length > 0;
      el.className = 'banner ' + (on ? 'ok' : 'warn');
      el.innerHTML = `<span class="dot"></span><span><b>${on ? 'Builder is live' : 'Builder is not on your live theme'}</b> ${on ? `on ${esc(t.builder.join(', '))}${t.guide.length ? `, Burr Guide on ${esc(t.guide.join(', '))}` : ''} in ${esc(t.name)}.` : `Add the Grinder Builder block to your grinder product template in ${esc(t.name)}.`}</span>
        <a class="btn sm" href="${on ? editorLink('product') : editorLink('product', 'grinder-builder', 'mainSection')}" target="_top">${on ? 'Manage in theme editor' : 'Add it now'}</a>`;
    }).catch(() => { const el = $('#tstat'); if (el) el.remove(); });
  }
  /* Which option set a grinder product uses: the highest priority active set that lists it (same rule as the storefront). */
  function winner(g, sets, product) {
    const pid = product && product.id;
    const listing = sets.filter((s) => pid && s.products.includes(pid));
    const active = listing.filter((s) => s.active).sort((a, b) => b.priority - a.priority);
    const os = active[0] || null;
    const skipped = listing.filter((s) => s !== os).map((s) => ({ s, why: !s.active ? 'Draft' : s.priority === os.priority ? 'Same priority, saved later' : `Lower priority (${s.priority})` }));
    return { os, skipped };
  }

  /* ---------- Option sets ---------- */
  async function showSets() {
    if (A.sub.startsWith('new')) return newSetDialog(new URLSearchParams(A.sub.split('?')[1] || '').get('template'));
    try { A.sets = await loadSets(); } catch (e) { body().innerHTML = errBox(e); return; }
    if (A.sub) { const s = A.sets.find((x) => num(x.id) === +A.sub); if (s) return editSet(s); }
    const prods = await productsByIds([...new Set(A.sets.flatMap((s) => s.products))]).catch(() => []);
    const pname = (gid) => (prods.find((p) => p.id === gid) || {}).title || 'Product';
    const acts = [['export', 'Export'], ['import', 'Import'], ['usetpl', 'Use a template'], ['new', 'Create option set', true]];
    titleBar('Option sets', acts.map(([id, label, primary]) => ({ label, primary, onClick: () => $('#' + id).click() })));
    body().innerHTML = head('Option sets', 'Each option set runs one grinder builder: the burrs, woods, caps and accessories it offers, their labels and rules. When two active sets list the same grinder, the higher priority wins.',
      `<span class="acts">${acts.map(([id, label, primary]) => `<button class="btn${primary ? ' primary' : ''}" id="${id}">${label}</button>`).join('')}</span><input type="file" id="importf" accept="application/json,.json" hidden>`) + `
      <div class="card flush"><div class="toolbar"><select id="sf" aria-label="Status"><option value="">All</option><option value="on">Active</option><option value="off">Draft</option></select>
        <input type="search" id="sq" placeholder="Filter option sets" aria-label="Filter option sets"></div>
      <div class="scroll"><table class="list"><thead><tr><th class="num">#</th><th>Option set</th><th>Status</th><th>Grinder</th><th>Products</th><th>Priority</th><th>Updated</th><th class="right">Actions</th></tr></thead><tbody id="srows"></tbody></table></div></div>`;
    const rows = () => {
      const q = $('#sq').value.trim().toLowerCase(), f = $('#sf').value;
      const list = A.sets.filter((s) => (!f || (f === 'on') === s.active) && (!q || `${s.title} ${grinderName(s.builder)}`.toLowerCase().includes(q)));
      $('#srows').innerHTML = list.length ? list.map((s, i) => `<tr class="clk" data-id="${esc(s.id)}"><td class="num muted">${i + 1}</td><td><b>${esc(s.title)}</b></td>
        <td><label class="switch" data-stop><input type="checkbox" data-act="${esc(s.id)}" ${s.active ? 'checked' : ''} aria-label="Active"><span class="badge ${s.active ? 'on' : ''}">${s.active ? 'Active' : 'Draft'}</span></label></td>
        <td>${esc(grinderName(s.builder))}</td><td>${s.products.length ? s.products.map((g) => esc(pname(g))).join(', ') : '<span class="muted">None yet</span>'}</td><td>${s.priority}</td>
        <td>${s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : ''}</td><td class="right" data-stop><button class="btn sm" data-dup="${esc(s.id)}">Duplicate</button> <button class="btn sm danger" data-del="${esc(s.id)}" aria-label="Delete ${esc(s.title)}">Delete</button></td></tr>`).join('')
        : `<tr><td colspan="8" class="empty">${A.sets.length ? 'No option sets match.' : 'No option sets yet. Create one for each grinder. Until then each builder uses its block settings and the catalog.'}</td></tr>`;
      $$('tr.clk').forEach((tr) => { tr.onclick = (e) => { if (e.target.closest('[data-stop]')) return; go('sets', String(num(tr.dataset.id))); }; });
      $$('[data-dup]').forEach((b) => { b.onclick = async () => { const s = clone(A.sets.find((x) => x.id === b.dataset.dup)); Object.assign(s, { id: null, title: s.title + ' copy', active: false, handle: slug(s.title) }); await editSet(s); markDirty(); }; });
      $$('[data-del]').forEach((b) => { b.onclick = async () => { const s = A.sets.find((x) => x.id === b.dataset.del); if (!confirm(`Delete ${s.title}? The builder falls back to the next active set, then its block settings.`)) return; try { userErr((await gql(`mutation D($id:ID!){ metaobjectDelete(id:$id){ userErrors { message } } }`, { id: s.id })).metaobjectDelete); toast('Option set deleted'); showSets(); } catch (e) { toast(e.message, true); } }; });
      $$('[data-act]').forEach((c) => {
        c.onchange = async () => {
          try {
            userErr((await gql(`mutation U($id:ID!,$f:[MetaobjectFieldInput!]!){ metaobjectUpdate(id:$id, metaobject:{fields:$f}){ userErrors { message } } }`, { id: c.dataset.act, f: [{ key: 'active', value: String(c.checked) }] })).metaobjectUpdate);
            toast(c.checked ? 'Option set is live' : 'Option set is now a draft'); showSets();
          } catch (e) { toast(e.message, true); c.checked = !c.checked; }
        };
      });
    };
    $('#sq').oninput = rows; $('#sf').onchange = rows; rows();
    $('#new').onclick = () => go('sets', 'new');
    $('#usetpl').onclick = () => go('templates');
    $('#export').onclick = () => download(`zerno-option-sets-${new Date().toISOString().slice(0, 10)}.json`, { kind: 'zerno-option-sets', version: 1, sets: A.sets.map(({ id, updatedAt, ...s }) => s) });
    $('#import').onclick = () => $('#importf').click();
    $('#importf').onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const j = JSON.parse(await file.text()), list = j.sets || (j.kind === 'zerno-backup' ? j.sets : null);
        if (!Array.isArray(list)) throw new Error('This file is not an option set export.');
        for (const s of list) await createSetRecord({ ...s, active: false });
        toast(`${list.length} option set${list.length === 1 ? '' : 's'} imported as drafts`); showSets();
      } catch (err) { toast('Not imported: ' + err.message, true); }
    };
  }
  async function createSetRecord(s) {
    return userErr((await gql(`mutation C($m:MetaobjectCreateInput!){ metaobjectCreate(metaobject:$m){ metaobject { id handle } userErrors { message } } }`,
      { m: { type: '$app:option_set', handle: `${slug(s.handle || s.title)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, fields: fieldsOf(s) } })).metaobjectCreate);
  }
  function download(name, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }
  const BUILTIN_TEMPLATES = [
    { id: 'full', title: 'Full grinder builder', desc: 'Color, burrs, accent piece, funnel cap and accessories. The Z1 and Z2 layout.', roles: ['burrs', 'accents', 'caps', 'accessories'], config: {} },
    { id: 'no-accents', title: 'Grinder without accent pieces', desc: 'Color, burrs and accessories. For a new grinder before its woods and caps exist.', roles: ['burrs', 'accessories'], config: {} },
    { id: 'burrs-only', title: 'Grinder and burrs', desc: 'Color and burr sets only. The shortest path to a working builder.', roles: ['burrs'], config: {} }
  ];
  async function loadTemplates() {
    const d = await gql(`{ metaobjects(type:"$app:template", first:50){ nodes { id handle updatedAt fields { key value } } } }`);
    return d.metaobjects.nodes.map((mo) => ({ id: mo.id, saved: true, title: field(mo, 'title') || 'Template', ...parse(field(mo, 'data'), {}) }));
  }
  async function allTemplates() { let saved = []; try { saved = await loadTemplates(); } catch (e) { /* none */ } return [...BUILTIN_TEMPLATES, ...saved]; }
  async function newSetDialog(tplId) {
    const tpls = await allTemplates();
    const pick = tpls.find((t) => t.id === tplId || String(num(t.id)) === tplId) || tpls[0];
    body().innerHTML = head('Create option set', 'Choose the grinder and a starting layout. The values come from the grinder\'s products in the catalog, and you can change everything after.') + `
      <div class="card" style="max-width:720px"><div class="field"><label for="ng">Grinder</label><select id="ng">${A.cat.grinders.map((g) => `<option value="${esc(g.key)}">${esc(g.name)} (${esc(g.size)})</option>`).join('')}</select>
        <span class="help">Missing a grinder? Add it in Catalog first.</span></div>
        <div class="field"><label>Template</label><div class="tplpick">${tpls.map((t) => `<label class="tpl"><input type="radio" name="tpl" value="${esc(t.id)}" ${t === pick ? 'checked' : ''}><span><b>${esc(t.title)}</b><small>${esc(t.desc || '')}</small></span></label>`).join('')}</div></div>
        <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" id="cancel">Cancel</button><button class="btn primary" id="create">Create</button></div></div>`;
    $('#cancel').onclick = () => go('sets');
    $('#create').onclick = () => { const t = tpls.find((x) => x.id === $('input[name="tpl"]:checked').value); createSet($('#ng').value, t); };
  }
  function defaultConfig(gkey) {
    const g = A.cat.grinders.find((x) => x.key === gkey) || { name: 'grinder' }, n = shortName(g);
    return {
      heading: g.heading || `Build your ${n}`,
      groups: {
        finish: { label: 'Finish', title: 'Choose your finish', help: 'Hand assembled in our Chicago facility.', values: Object.fromEntries(Object.entries(g.finishText || {}).filter(([, v]) => v).map(([k, v]) => [k, { text: v }])) },
        burrs: { label: 'Burrs', title: 'Pick your burrs', help: '', required: true, multiple: true, max: 0 },
        accents: { step: 'Accents', title: 'Finish the details', label: 'Accent piece', help: '', required: true, multiple: true, max: 0, default: '' },
        caps: { label: 'Funnel cap', help: '', allowNone: true, noneLabel: 'No cap', multiple: true, max: 0, default: 'none' },
        accessories: { label: 'Accessories', title: 'Add accessories', help: `Every ${n} already comes with these, plus maintenance tools.`, max: 0 }
      },
      items: {}
    };
  }
  async function createSet(gkey, tpl) {
    const g = A.cat.grinders.find((x) => x.key === gkey);
    body().innerHTML = spin('Setting up the option set from your products…');
    try {
      const roles = (tpl && tpl.roles) || ['burrs', 'accents', 'caps', 'accessories'];
      const H = g.handles || {};
      const prods = await productsByHandles([...Object.values(H).flat(), g.product]);
      const byH = (h) => prods.find((p) => p.handle === h);
      const lists = { burrs: [], accents: [], caps: [], accessories: [] };
      roles.forEach((k) => {
        lists[k] = (H[k] || []).map(byH).filter(Boolean).flatMap((p) => {
          if (k !== 'accessories') return p.variants.nodes.map((v) => v.id);
          const pick = (g.accessoryMatch && p.variants.nodes.find((v) => v.title.includes(g.accessoryMatch))) || p.variants.nodes[0];
          return pick ? [pick.id] : [];
        });
      });
      const gp = byH(g.product);
      const base = defaultConfig(gkey), tc = (tpl && tpl.config) || {};
      const config = { ...base, ...tc, groups: { ...base.groups, ...(tc.groups || {}) }, items: {} };
      const set = { id: null, handle: `${gkey}-builder`, title: `${shortName(g)} Options Set`, builder: gkey, active: false, priority: 0, products: gp ? [gp.id] : [], lists, config };
      await editSet(set);
      markDirty();
    } catch (e) { body().innerHTML = errBox(e); }
  }

  /* ---------- option set editor ---------- */
  async function editSet(set) {
    A.view = 'sets'; A.set = clone(set); A.saved = clone(set); A.prices = {};
    const def = defaultConfig(set.builder);
    A.set.config = Object.assign(def, A.set.config || {});
    A.set.config.groups = Object.assign(defaultConfig(set.builder).groups, (set.config && set.config.groups) || {});
    A.set.config.items = A.set.config.items || {};
    body().innerHTML = spin('Loading option set…');
    try {
      const ids = [...new Set(Object.values(A.set.lists).flat())];
      (await variantsByIds(ids)).forEach((v) => { A.variants[v.gid] = v; });
      A.grinders = await productsByIds(A.set.products);
    } catch (e) { body().innerHTML = errBox(e); return; }
    A.onSave = save; A.onDiscard = () => { A.set = clone(A.saved); A.prices = {}; clean(); renderEditor(); };
    clean(); renderEditor();
  }
  function groupSummary(g) {
    const s = A.set, G = s.config.groups[g.k] || {};
    if (g.kind === 'finish') {
      const vals = finishValues(); const hid = vals.filter((v) => (G.values || {})[slug(v)] && G.values[slug(v)].hidden).length;
      return `${vals.length} colors${hid ? ` · ${hid} hidden` : ''}`;
    }
    const list = s.lists[g.list] || [], hid = list.filter((gid) => (s.config.items[num(gid)] || {}).hidden).length;
    const bits = [];
    if (!list.length) return 'Not offered. The builder skips this step.';
    if (g.k === 'burrs' || g.k === 'accents') bits.push('Required');
    if (g.k === 'caps') bits.push(G.allowNone ? 'Optional' : 'Required');
    bits.push(`${list.length} values`);
    if (hid) bits.push(`${hid} hidden`);
    if (G.multiple && g.k !== 'accessories') bits.push(g.k === 'burrs' ? 'spares allowed' : 'extras allowed');
    const pr = list.map((gid) => A.variants[gid]).filter(Boolean).map((v) => (A.prices[v.gid] != null ? A.prices[v.gid] : v.price));
    if (pr.length) bits.push(`${money(Math.min(...pr))} to ${money(Math.max(...pr))}`);
    return bits.join(' · ');
  }
  function finishValues() {
    const g = A.grinders[0]; if (!g) return ['Jet Black', 'Soft White'];
    const o = g.options.find((x) => /colou?r|finish/i.test(x.name)) || g.options[0];
    return o ? o.values : [];
  }
  function renderEditor() {
    const s = A.set;
    body().innerHTML = `<div class="ph"><button class="back" id="back" aria-label="Back to option sets">&larr;</button>
      <h1><input type="text" id="title" value="${esc(s.title)}" aria-label="Option set name" style="max-width:340px;font-size:16px;font-weight:650"></h1>
      <label class="switch"><input type="checkbox" id="active" ${s.active ? 'checked' : ''}><span class="badge ${s.active ? 'on' : ''}" id="actlbl">${s.active ? 'Active' : 'Draft'}</span></label>
      <button class="btn" id="astpl">Save as template</button>${s.id ? '<button class="btn danger" id="del">Delete</button>' : ''}<button class="btn primary" id="save">Save</button></div>
      <div class="grid"><div>
        <div class="card"><h2>Grinder</h2><div class="row2"><div class="field"><label for="gk">Builder for</label><select id="gk">${A.cat.grinders.map((g) => `<option value="${esc(g.key)}" ${g.key === s.builder ? 'selected' : ''}>${esc(g.name)} (${esc(g.size)})</option>`).join('')}</select><span class="help">Sets the art, burr size and Burr Guide the builder uses.</span></div>
          ${inp('prio', 'Priority', s.priority, 'When two active sets list the same product, the higher number wins.', 'number', 'step="1"')}</div>
          <p class="sub">This option set controls the builder on these product pages while it is active.</p>
          <div class="chips" id="gchips"></div><button class="btn sm" id="pickg">Choose products</button></div>
        <div class="card"><h2>Setup flow</h2><p class="sub">Open a step to change its name, rules and values. Drag values to reorder. Prices are the Shopify variant prices. A step with no values is skipped on the store.</p>
          <div class="field"><label for="heading">Builder heading</label><input type="text" id="heading" value="${esc(s.config.heading || '')}"></div>
          <div class="flow" id="flow"></div></div>
      </div><div class="sticky"><div class="pv"><div class="pvh"><b>Live preview</b><span class="muted" style="font-size:12px">The real builder with these settings. Saving publishes them.</span></div><div class="pvb" id="preview"></div></div></div></div>`;
    titleBar(s.title || 'Option set', [{ label: 'Save', primary: true, onClick: save }]);
    $('#back').onclick = () => go('sets');
    $('#title').oninput = (e) => { s.title = e.target.value; markDirty(); };
    $('#heading').oninput = (e) => { s.config.heading = e.target.value; markDirty(); };
    $('#gk').onchange = (e) => { s.builder = e.target.value; markDirty(); };
    $('#prio').oninput = (e) => { s.priority = parseInt(e.target.value, 10) || 0; markDirty(); };
    $('#active').onchange = (e) => { s.active = e.target.checked; $('#actlbl').textContent = s.active ? 'Active' : 'Draft'; $('#actlbl').classList.toggle('on', s.active); markDirty(); };
    $('#save').onclick = save;
    $('#astpl').onclick = saveAsTemplate;
    if ($('#del')) $('#del').onclick = del;
    $('#pickg').onclick = pickGrinders;
    renderGrinders(); renderFlow(); renderPreview();
  }
  function renderGrinders() {
    $('#gchips').innerHTML = A.grinders.length ? A.grinders.map((p) => `<span class="chip">${pimg(p) ? `<img src="${esc(pimg(p))}" alt="">` : ''}${esc(p.title)}<button data-rmg="${esc(p.id)}" aria-label="Remove ${esc(p.title)}">&times;</button></span>`).join('')
      : '<span class="muted">No product yet. The option set does nothing until a product is chosen.</span>';
    $$('[data-rmg]').forEach((b) => { b.onclick = () => { A.set.products = A.set.products.filter((x) => x !== b.dataset.rmg); A.grinders = A.grinders.filter((x) => x.id !== b.dataset.rmg); renderGrinders(); markDirty(); }; });
  }
  async function pickGrinders() {
    if (!window.shopify || !shopify.resourcePicker) return toast('Open this page inside Shopify admin to pick products.', true);
    const sel = await shopify.resourcePicker({ type: 'product', multiple: true, selectionIds: A.set.products.map((id) => ({ id })) });
    if (!sel) return;
    A.set.products = sel.map((p) => p.id);
    A.grinders = await productsByIds(A.set.products);
    renderGrinders(); renderFlow(); markDirty();
  }
  function renderFlow() {
    $('#flow').innerHTML = GROUPS.map((g) => `<div class="grp${A.open[g.k] ? ' open' : ''}" data-g="${g.k}"><div class="gh"><span class="chev">&#9656;</span><span><span class="gn">${esc((A.set.config.groups[g.k] || {}).label || g.name)}</span><br><span class="gs">${esc(groupSummary(g))}</span></span>
      ${g.k !== 'finish' && g.k !== 'accessories' ? `<span class="badge req">${g.k === 'caps' && A.set.config.groups.caps.allowNone ? 'Optional' : 'Required'}</span>` : '<span></span>'}<span class="btn sm">Edit</span></div><div class="gb"></div></div>`).join('');
    $$('#flow .grp').forEach((el) => {
      const g = GROUPS.find((x) => x.k === el.dataset.g);
      el.querySelector('.gh').onclick = () => { A.open[g.k] = !A.open[g.k]; el.classList.toggle('open', A.open[g.k]); if (A.open[g.k]) renderGroup(g, el.querySelector('.gb')); };
      if (A.open[g.k]) renderGroup(g, el.querySelector('.gb'));
    });
  }
  const refreshHead = (g) => { const el = $(`#flow .grp[data-g="${g.k}"] .gs`); if (el) el.textContent = groupSummary(g); };
  function renderGroup(g, box) {
    const s = A.set, G = s.config.groups[g.k] = s.config.groups[g.k] || {};
    const bind = (id, key, conv = (v) => v) => { const el = box.querySelector('#' + id); if (!el) return; el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => { G[key] = conv(el.type === 'checkbox' ? el.checked : el.value); refreshHead(g); markDirty(); if (key === 'label') { const n = $(`#flow .grp[data-g="${g.k}"] .gn`); if (n) n.textContent = el.value || g.name; } if (key === 'allowNone') renderGroup(g, box); }); };
    if (g.kind === 'finish') {
      const vals = finishValues(); G.values = G.values || {};
      box.innerHTML = `<div class="row2">${inp('f-label', 'Step name', G.label)}${inp('f-title', 'Heading', G.title)}</div>${inp('f-help', 'Note under the heading', G.help)}
        <table class="vals"><thead><tr><th>Color</th><th>Swatch</th><th>Line under the color</th><th>Show</th></tr></thead><tbody>
        ${vals.map((v) => { const k = slug(v), o = G.values[k] || {}; return `<tr class="${o.hidden ? 'hid' : ''}"><td><b>${esc(v)}</b></td><td><input type="color" class="swatch" data-sw="${k}" value="${esc(o.swatch || (/white/.test(k) ? '#e9e9e6' : /black/.test(k) ? '#141517' : '#888888'))}" aria-label="${esc(v)} swatch"></td>
          <td><input type="text" data-tx="${k}" value="${esc(o.text || '')}" placeholder="Optional"></td><td><label class="switch"><input type="checkbox" data-sh="${k}" ${o.hidden ? '' : 'checked'} aria-label="Show ${esc(v)}"></label></td></tr>`; }).join('')}
        </tbody></table><p class="help muted" style="font-size:12px">Colors come from the grinder's variants in Shopify. To add one, add a variant to the grinder, then make its art in Catalog > Grinders > Art studio. Until then it shows its own photo.</p>`;
      bind('f-label', 'label'); bind('f-title', 'title'); bind('f-help', 'help');
      const val = (k) => (G.values[k] = G.values[k] || {});
      $$('[data-sw]', box).forEach((e) => { e.oninput = () => { val(e.dataset.sw).swatch = e.value; markDirty(); }; });
      $$('[data-tx]', box).forEach((e) => { e.oninput = () => { val(e.dataset.tx).text = e.value; markDirty(); }; });
      $$('[data-sh]', box).forEach((e) => { e.onchange = () => { val(e.dataset.sh).hidden = !e.checked; e.closest('tr').classList.toggle('hid', !e.checked); refreshHead(g); markDirty(); }; });
      return;
    }
    const list = s.lists[g.list] = s.lists[g.list] || [];
    const opts = (sel) => list.map((gid) => { const v = A.variants[gid]; return v ? `<option value="${v.id}" ${String(sel) === String(v.id) ? 'selected' : ''}>${esc(itemLabel(v))}</option>` : ''; }).join('');
    let top = '';
    if (g.k === 'burrs') top = `<div class="row2">${inp('g-label', 'Step name', G.label)}${inp('g-title', 'Heading', G.title)}</div>${inp('g-help', 'Help text', G.help, 'Shown under the heading. Leave empty for the standard text.')}
      <div class="row2"><div>${chk('g-multiple', 'Allow spare burr sets', G.multiple, 'The first pick ships installed, more picks ship in the box.')}</div>${inp('g-max', 'Max selections', G.max || '', 'Empty for no limit.', 'number')}</div>`;
    if (g.k === 'accents') top = `<div class="row2">${inp('g-step', 'Step name', G.step)}${inp('g-title', 'Heading', G.title)}</div><div class="row2">${inp('g-label', 'Name on product page', G.label)}${inp('g-help', 'Help text', G.help)}</div>
      <div class="row3"><div>${chk('g-multiple', 'Allow extra pieces', G.multiple, 'Extras ship in the box.')}</div>${inp('g-max', 'Max selections', G.max || '', 'Empty for no limit.', 'number')}<div class="field"><label for="g-default">Default value</label><select id="g-default"><option value="">First available</option>${opts(G.default)}</select></div></div>`;
    if (g.k === 'caps') top = `<div class="row2">${inp('g-label', 'Name on product page', G.label)}${inp('g-help', 'Help text', G.help)}</div>
      <div class="row2"><div>${chk('g-allowNone', 'Customers can choose no cap', G.allowNone, 'Adds a "No cap" option. A cap and No cap are never both selected.')}</div>${G.allowNone ? inp('g-noneLabel', 'Label for no cap', G.noneLabel) : '<span></span>'}</div>
      <div class="row3"><div>${chk('g-multiple', 'Allow extra caps', G.multiple)}</div>${inp('g-max', 'Max selections', G.max || '', 'Empty for no limit.', 'number')}<div class="field"><label for="g-default">Default value</label><select id="g-default">${G.allowNone ? `<option value="none" ${G.default === 'none' ? 'selected' : ''}>${esc(G.noneLabel || 'No cap')}</option>` : ''}<option value="" ${!G.default ? 'selected' : ''}>First available</option>${opts(G.default)}</select></div></div>`;
    if (g.k === 'accessories') top = `<div class="row2">${inp('g-label', 'Step name', G.label)}${inp('g-title', 'Heading', G.title)}</div>${inp('g-help', 'Note under the heading', G.help)}${inp('g-max', 'Max selections', G.max || '', 'Empty for no limit.', 'number')}`;
    box.innerHTML = top + `<table class="vals"><thead><tr><th></th><th></th><th>Value</th><th>Help text</th><th>Badge</th>${g.k === 'accessories' ? '<th title="Accessories with the same pick-one name replace each other in the builder">Pick one</th>' : ''}<th>Price</th><th>Show</th><th></th></tr></thead><tbody>
      ${list.map((gid, i) => { const v = A.variants[gid]; if (!v) return `<tr data-i="${i}"><td class="h">&#8942;&#8942;</td><td></td><td colspan="5" class="vn">Variant ${num(gid)} no longer exists</td><td><button class="ic" data-rm="${i}" aria-label="Remove">&#128465;</button></td></tr>`;
        const o = s.config.items[v.id] || {}; const pr = A.prices[v.gid] != null ? A.prices[v.gid] : v.price;
        return `<tr data-i="${i}" draggable="true" class="${o.hidden ? 'hid' : ''}"><td class="h" title="Drag to reorder">&#8942;&#8942;</td><td>${v.image ? `<img src="${esc(v.image)}" alt="">` : ''}</td>
          <td><input type="text" data-lb="${v.id}" value="${esc(o.label || '')}" placeholder="${esc(v.title === 'Default Title' ? v.product.title : v.title)}"><div class="vn" title="${esc(v.product ? v.product.title + ' · ' + v.title : v.title)}">${esc(v.product ? v.product.title : '')}${v.available ? '' : ' · sold out'}</div></td>
          <td><input type="text" data-hp="${v.id}" value="${esc(o.help || '')}" placeholder="Help text"></td><td><input type="text" data-bd="${v.id}" value="${esc(o.badge || '')}" placeholder="e.g. Presale Exclusive" style="width:130px"></td>${g.k === 'accessories' ? `<td><input type="text" data-gp="${v.id}" value="${esc(o.group != null ? o.group : (v.group || ''))}" placeholder="e.g. auger" style="width:100px"></td>` : ''}
          <td><input type="number" class="price" step="0.01" min="0" data-pr="${esc(v.gid)}" value="${(pr / 100).toFixed(2)}" aria-label="Price"></td>
          <td><label class="switch"><input type="checkbox" data-sh="${v.id}" ${o.hidden ? '' : 'checked'} aria-label="Show"></label></td>
          <td><button class="ic" data-up="${i}" aria-label="Move up">&#9650;</button><button class="ic" data-rm="${i}" aria-label="Remove">&#128465;</button></td></tr>`; }).join('')}
      ${list.length ? '' : '<tr><td colspan="8" class="empty">No values. The builder skips this step.</td></tr>'}</tbody></table>
      <button class="btn sm" data-add>+ Add values</button> <span class="help muted" style="font-size:12px">Pick product variants. New variants of these products are not added automatically; add them with this button.</span>`;
    ['label', 'title', 'help', 'step', 'noneLabel'].forEach((k) => bind('g-' + k, k));
    bind('g-multiple', 'multiple'); bind('g-allowNone', 'allowNone'); bind('g-max', 'max', (v) => Math.max(0, parseInt(v, 10) || 0)); bind('g-default', 'default');
    const item = (id) => (s.config.items[id] = s.config.items[id] || {});
    $$('[data-lb]', box).forEach((e) => { e.oninput = () => { item(e.dataset.lb).label = e.value; markDirty(); }; });
    $$('[data-hp]', box).forEach((e) => { e.oninput = () => { item(e.dataset.hp).help = e.value; markDirty(); }; });
    $$('[data-bd]', box).forEach((e) => { e.oninput = () => { item(e.dataset.bd).badge = e.value; markDirty(); }; });
    $$('[data-gp]', box).forEach((e) => { e.oninput = () => { item(e.dataset.gp).group = e.value; markDirty(); }; });
    $$('[data-sh]', box).forEach((e) => { e.onchange = () => { item(e.dataset.sh).hidden = !e.checked; e.closest('tr').classList.toggle('hid', !e.checked); refreshHead(g); markDirty(); }; });
    $$('[data-pr]', box).forEach((e) => { e.oninput = () => { const v = A.variants[e.dataset.pr], c = cents(e.value); if (c === v.price) delete A.prices[v.gid]; else A.prices[v.gid] = c; refreshHead(g); markDirty(); }; });
    $$('[data-rm]', box).forEach((e) => { e.onclick = () => { list.splice(+e.dataset.rm, 1); renderGroup(g, box); refreshHead(g); markDirty(); }; });
    $$('[data-up]', box).forEach((e) => { e.onclick = () => { const i = +e.dataset.up; if (i < 1) return; [list[i - 1], list[i]] = [list[i], list[i - 1]]; renderGroup(g, box); markDirty(); }; });
    box.querySelector('[data-add]').onclick = () => addValues(g, box);
    let from = null;
    $$('tr[draggable]', box).forEach((tr) => {
      tr.ondragstart = (e) => { from = +tr.dataset.i; tr.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; };
      tr.ondragend = () => tr.classList.remove('drag');
      tr.ondragover = (e) => { e.preventDefault(); tr.classList.add('over'); };
      tr.ondragleave = () => tr.classList.remove('over');
      tr.ondrop = (e) => { e.preventDefault(); tr.classList.remove('over'); const to = +tr.dataset.i; if (from == null || from === to) return; const [x] = list.splice(from, 1); list.splice(to, 0, x); renderGroup(g, box); markDirty(); };
    });
  }
  function itemLabel(v) { const o = A.set.config.items[v.id] || {}; return o.label || (v.title === 'Default Title' ? v.product.title : v.title); }
  async function addValues(g, box) {
    if (!window.shopify || !shopify.resourcePicker) return toast('Open this page inside Shopify admin to pick variants.', true);
    const sel = await shopify.resourcePicker({ type: 'variant', multiple: true });
    if (!sel || !sel.length) return;
    const gids = sel.map((x) => x.id).filter((id) => !A.set.lists[g.list].includes(id));
    (await variantsByIds(gids)).forEach((v) => { A.variants[v.gid] = v; });
    A.set.lists[g.list].push(...gids.filter((id) => A.variants[id]));
    renderGroup(g, box); refreshHead(g); markDirty();
  }

  /* ---------- preview: the real builder with the unsaved settings and the working catalog ---------- */
  let pvT = null;
  function schedulePreview() { clearTimeout(pvT); pvT = setTimeout(renderPreview, 450); }
  function previewConfig() {
    const s = A.set, g = A.grinders[0], gc = A.cat.grinders.find((x) => x.key === s.builder);
    const priceOf = (v) => (A.prices[v.gid] != null ? A.prices[v.gid] : v.price);
    const vs = (k) => (s.lists[k] || []).map((gid) => A.variants[gid]).filter(Boolean);
    const gv = g ? g.variants.nodes.map(toVariant) : [];
    return {
      blockId: 'preview', preview: true, os: s.config, grinderKey: s.builder, catalog: A.cat, assetBase: 'preview/catalog.js', installedImage: null, included: [],
      settings: { heading: s.config.heading, intro: '', includedNote: '', afterAdd: 'stay', accentCrop: 0.7, capCrop: 0.66, capOptional: true, finishText: '', finishSwatches: '', hideFinishes: '', hideBurrs: '', hideAccents: '', hideCaps: '', allowExtras: true, allowSpareBurrs: true, showIncluded: true, burrGuide: true },
      shop: { currency: 'USD', locale: 'en-US', cartAddUrl: '#', cartUrl: '#', rootUrl: '/' },
      guideJs: 'preview/burr-guide.js', guideCss: 'preview/burr-guide.css',
      grinder: g ? { id: num(g.id), handle: g.handle, title: g.title, image: pimg(g), options: g.options.map((o) => ({ name: o.name, values: o.values })), variants: gv.map((v) => ({ id: v.id, title: v.title, options: v.options, price: v.price, available: v.available, blurb: null, image: v.image })) }
        : { id: 1, handle: gc && gc.product, title: gc ? gc.name : 'Grinder', options: [{ name: 'Color', values: ['Jet Black', 'Soft White'] }], variants: [{ id: 1, title: 'Jet Black', options: ['Jet Black'], price: 0, available: true }, { id: 2, title: 'Soft White', options: ['Soft White'], price: 0, available: true }] },
      burrs: vs('burrs').map((v) => ({ id: v.id, title: v.title, short: null, price: priceOf(v), available: v.available, flat: null, flatAsset: null, image: v.image })),
      accents: vs('accents').map((v) => ({ id: v.id, title: v.title, price: priceOf(v), available: v.available, image: v.image })),
      caps: vs('caps').map((v) => ({ id: v.id, title: v.title, price: priceOf(v), available: v.available, image: v.image })),
      accessories: vs('accessories').map((v) => ({ productId: v.product ? v.product.id : v.id, handle: v.product && v.product.handle, title: v.product ? v.product.title : v.title, blurb: '', variantId: v.id, variantTitle: v.title, price: priceOf(v), available: v.available, image: (v.product && v.product.image) || v.image, stage: null, group: v.group || '' }))
    };
  }
  function renderPreview() {
    const box = $('#preview'); if (!box || !A.set) return;
    document.querySelectorAll('.zb-bar').forEach((b) => { if (!box.contains(b)) b.remove(); });
    box.innerHTML = `<div class="zb" data-zb-root style="--zb-sticky:0px"><script type="application/json" data-zb-config>${JSON.stringify(previewConfig()).replace(/</g, '\\u003c')}</script></div>`;
    if (window.ZernoBuilderBoot) window.ZernoBuilderBoot(box);
  }

  /* ---------- save an option set ---------- */
  function fieldsOf(s) {
    return [
      { key: 'title', value: s.title || 'Option set' }, { key: 'builder', value: s.builder }, { key: 'active', value: String(!!s.active) },
      { key: 'priority', value: String(s.priority || 0) }, { key: 'products', value: JSON.stringify(s.products) },
      ...Object.entries(FIELD).map(([k, f]) => ({ key: f, value: JSON.stringify(s.lists[k] || []) })),
      { key: 'config', value: JSON.stringify(s.config) }
    ];
  }
  async function save() {
    const s = A.set, btns = $$('#save, #sb-save'); btns.forEach((b) => { b.disabled = true; });
    try {
      const byProduct = {};
      Object.entries(A.prices).forEach(([gid, c]) => { const v = A.variants[gid]; (byProduct[v.product.gid] = byProduct[v.product.gid] || []).push({ id: gid, price: (c / 100).toFixed(2) }); });
      for (const [pid, variants] of Object.entries(byProduct)) {
        userErr((await gql(`mutation B($p:ID!,$v:[ProductVariantsBulkInput!]!){ productVariantsBulkUpdate(productId:$p, variants:$v){ userErrors { message } } }`, { p: pid, v: variants })).productVariantsBulkUpdate);
        variants.forEach((x) => { A.variants[x.id].price = cents(x.price); });
      }
      A.prices = {};
      if (s.id) {
        userErr((await gql(`mutation U($id:ID!,$f:[MetaobjectFieldInput!]!){ metaobjectUpdate(id:$id, metaobject:{fields:$f}){ metaobject { id } userErrors { message } } }`, { id: s.id, f: fieldsOf(s) })).metaobjectUpdate);
      } else {
        const r = userErr((await gql(`mutation C($m:MetaobjectCreateInput!){ metaobjectCreate(metaobject:$m){ metaobject { id handle } userErrors { message } } }`,
          { m: { type: '$app:option_set', handle: `${slug(s.handle || s.title)}-${Date.now().toString(36)}`, fields: fieldsOf(s) } })).metaobjectCreate);
        s.id = r.metaobject.id; s.handle = r.metaobject.handle;
        setUrl('sets', String(num(s.id)));
        if (!$('#del')) { const b = document.createElement('button'); b.className = 'btn danger'; b.id = 'del'; b.textContent = 'Delete'; b.onclick = del; $('#save').before(b); }
      }
      A.saved = clone(s); clean(); toast('Saved. The store updates within a minute.');
    } catch (e) { toast('Not saved: ' + e.message, true); } finally { btns.forEach((b) => { b.disabled = false; }); }
  }
  async function del() {
    if (!A.set.id || !confirm('Delete this option set? The builder goes back to its block settings and the catalog.')) return;
    try { userErr((await gql(`mutation D($id:ID!){ metaobjectDelete(id:$id){ userErrors { message } } }`, { id: A.set.id })).metaobjectDelete); toast('Option set deleted'); clean(); go('sets'); } catch (e) { toast(e.message, true); }
  }
  async function saveAsTemplate() {
    const title = prompt('Template name', A.set.title.replace(/\s*options? set$/i, '') + ' layout');
    if (title) await saveTemplate(title, A.set);
  }

  /* ---------- Templates ---------- */
  async function showTemplates() {
    const tpls = await allTemplates();
    const mine = tpls.filter((t) => t.saved), tab = A.sub === 'yours' ? 'yours' : 'built';
    const roleName = { burrs: 'Burrs', accents: 'Accent pieces', caps: 'Funnel caps', accessories: 'Accessories' };
    const art = { full: 'preview/z2-jet-black.jpg', 'no-accents': 'preview/z1-jet-black.jpg', 'burrs-only': 'preview/burr-core-blind.png' };
    titleBar('Templates', [{ label: 'Create template', primary: true, onClick: () => $('#newtpl').click() }]);
    body().innerHTML = head('Templates', 'Start an option set from a ready-made layout, or save your own from any option set.', '<button class="btn primary" id="newtpl">Create template</button>') + `
      <div class="seg" role="tablist"><button role="tab" data-tt="built" aria-selected="${tab === 'built'}">Built in <span class="cnt">${tpls.length - mine.length}</span></button><button role="tab" data-tt="yours" aria-selected="${tab === 'yours'}">Yours <span class="cnt">${mine.length}</span></button></div>
      <div class="tpls">${(tab === 'yours' ? mine : tpls.filter((t) => !t.saved)).map((t) => `<div class="card tplc"><div class="tplimg">${art[t.id] ? `<img src="${art[t.id]}" alt="">` : `<span>${esc((t.title || 'T')[0])}</span>`}</div>
        <div class="tplbody"><b>${esc(t.title)}</b><p class="sub">${esc(t.desc || '')}</p><p class="steps">Color${(t.roles || []).map((r) => ' · ' + roleName[r]).join('')}</p>
        <div class="btnrow"><button class="btn sm primary" data-use="${esc(t.saved ? num(t.id) : t.id)}">+ Use template</button>${t.saved ? `<button class="btn sm danger" data-rmt="${esc(t.id)}">Delete</button>` : ''}</div></div></div>`).join('')
        || '<div class="card empty">No templates of your own yet. Use Create template, or Save as template on any option set.</div>'}</div>`;
    $$('[data-tt]').forEach((b) => { b.onclick = () => { setUrl('templates', b.dataset.tt === 'yours' ? 'yours' : ''); showTemplates(); }; });
    $$('[data-use]').forEach((b) => { b.onclick = () => go('sets', 'new?template=' + b.dataset.use); });
    $$('[data-rmt]').forEach((b) => { b.onclick = async () => { if (!confirm('Delete this template? Option sets made from it stay as they are.')) return; try { userErr((await gql(`mutation D($id:ID!){ metaobjectDelete(id:$id){ userErrors { message } } }`, { id: b.dataset.rmt })).metaobjectDelete); toast('Template deleted'); showTemplates(); } catch (e) { toast(e.message, true); } }; });
    $('#newtpl').onclick = async () => {
      let sets = []; try { sets = await loadSets(); } catch (e) { /* none */ }
      if (!sets.length) return toast('Create an option set first, then save it as a template.', true);
      const pickId = await choose('Create a template from an option set', sets.map((s) => [s.id, s.title, grinderName(s.builder)]));
      if (!pickId) return;
      const s = sets.find((x) => x.id === pickId), title = prompt('Template name', s.title.replace(/\s*options? set$/i, '') + ' layout');
      if (!title) return;
      await saveTemplate(title, s); setUrl('templates', 'yours'); showTemplates();
    };
  }
  /* a small list dialog: resolves to the chosen key, or null */
  function choose(title, items) {
    return new Promise((resolve) => {
      const ov = document.createElement('div'); ov.className = 'modal-ov';
      ov.innerHTML = `<div class="modal sm" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="mh"><b>${esc(title)}</b><button class="ic" data-x aria-label="Close">&times;</button></div>
        <div class="mb"><div class="choices">${items.map(([k, t, d]) => `<button class="choice" data-k="${esc(k)}"><b>${esc(t)}</b>${d ? `<span>${esc(d)}</span>` : ''}</button>`).join('')}</div></div></div>`;
      document.body.appendChild(ov);
      const done = (v) => { ov.remove(); resolve(v); };
      $$('[data-x]', ov).forEach((b) => { b.onclick = () => done(null); });
      ov.onclick = (e) => { if (e.target === ov) done(null); };
      $$('[data-k]', ov).forEach((b) => { b.onclick = () => done(b.dataset.k); });
    });
  }
  async function saveTemplate(title, set) {
    const roles = Object.keys(FIELD).filter((k) => (set.lists[k] || []).length);
    const { items, ...config } = set.config;
    try {
      userErr((await gql(`mutation C($m:MetaobjectCreateInput!){ metaobjectCreate(metaobject:$m){ metaobject { id } userErrors { message } } }`,
        { m: { type: '$app:template', handle: `${slug(title)}-${Date.now().toString(36)}`, fields: [{ key: 'title', value: title }, { key: 'data', value: JSON.stringify({ desc: `Saved from ${set.title}`, roles, config }) }] } })).metaobjectCreate);
      toast('Template saved');
    } catch (e) { toast('Not saved: ' + e.message, true); }
  }

  /* ---------- Settings: theme setup and backups ---------- */
  async function showSettings() {
    const tab = A.sub || 'theme';
    titleBar('Settings');
    body().innerHTML = head('Settings') + `<div class="narrow"><div class="seg" role="tablist">${[['theme', 'Theme setup'], ['backup', 'Backup']].map(([k, n]) => `<button role="tab" data-st="${k}" aria-selected="${tab === k}">${n}</button>`).join('')}</div><div id="stbody"></div></div>`;
    $$('[data-st]').forEach((b) => { b.onclick = () => { setUrl('settings', b.dataset.st === 'theme' ? '' : b.dataset.st); showSettings(); }; });
    const box = $('#stbody');
    if (tab === 'backup') {
      box.innerHTML = `<div class="card"><h2>Export everything</h2><p class="sub">One file with the catalog (grinders, burrs, art links, textures), every option set and your templates. Keep it as a backup, or load it into another store.</p><button class="btn primary" id="bexp">Download backup</button></div>
        <div class="card"><h2>Restore from a backup</h2><p class="sub">Replaces the catalog and adds the option sets as drafts and the templates. Nothing is deleted.</p><button class="btn" id="bimp">Choose backup file</button><input type="file" id="bfile" accept="application/json,.json" hidden></div>`;
      $('#bexp').onclick = async () => {
        let sets = [], tpls = []; try { [sets, tpls] = await Promise.all([loadSets(), loadTemplates()]); } catch (e) { /* partial backup */ }
        download(`zerno-builder-backup-${new Date().toISOString().slice(0, 10)}.json`, { kind: 'zerno-backup', version: 1, catalog: A.catSaved || A.cat, sets: sets.map(({ id, updatedAt, ...s }) => s), templates: tpls.map(({ id, saved, ...t }) => t) });
      };
      $('#bimp').onclick = () => $('#bfile').click();
      $('#bfile').onchange = async (e) => {
        const file = e.target.files[0]; if (!file) return;
        try {
          const j = JSON.parse(await file.text());
          if (j.kind !== 'zerno-backup') throw new Error('This file is not a Zerno Builder backup.');
          if (!confirm(`Restore this backup? It replaces the catalog and adds ${(j.sets || []).length} option sets as drafts.`)) return;
          if (j.catalog) { await saveCatalog(j.catalog); A.cat = Cat.get(j.catalog); A.catSaved = clone(A.cat); A.catIsSaved = true; }
          for (const s of j.sets || []) await createSetRecord({ ...s, active: false });
          for (const t of j.templates || []) userErr((await gql(`mutation C($m:MetaobjectCreateInput!){ metaobjectCreate(metaobject:$m){ metaobject { id } userErrors { message } } }`, { m: { type: '$app:template', handle: `${slug(t.title)}-${Date.now().toString(36)}`, fields: [{ key: 'title', value: t.title }, { key: 'data', value: JSON.stringify({ desc: t.desc, roles: t.roles, config: t.config }) }] } })).metaobjectCreate);
          toast('Backup restored');
        } catch (err) { toast('Not restored: ' + err.message, true); }
      };
      return;
    }
    box.innerHTML = `<div class="card"><h2>Blocks on your live theme</h2><div id="tblocks"><span class="spin"></span></div></div>
      <div class="card"><h2>Add the blocks</h2><p class="sub">Each button opens the theme editor with the block ready to place. Click Save in the theme editor when it looks right.</p>
        <div class="setuprow"><div><b>Grinder Builder</b><p class="sub">Add it to the product template your grinders use. It finds the grinder from the product page.</p></div><a class="btn" href="${editorLink('product', 'grinder-builder', 'mainSection')}" target="_top">Add to product template</a></div>
        <div class="setuprow"><div><b>Burr Guide</b><p class="sub">Add it to a page, such as your burr guide page.</p></div><a class="btn" href="${editorLink('page', 'burr-guide', 'newAppsSection')}" target="_top">Add to a page</a></div>
        <div class="setuprow"><div><b>Theme editor</b><p class="sub">Change colors, width and the text on each block.</p></div><a class="btn" href="${editorLink('product')}" target="_top">Open theme editor</a></div></div>`;
    themeStatus().then((t) => {
      const el = $('#tblocks'); if (!el) return;
      el.innerHTML = !t ? '<p class="muted">No published theme found.</p>' : `<p class="sub">${esc(t.name)}</p><table class="vals"><tbody>
        <tr><td><b>Grinder Builder</b></td><td>${t.builder.length ? `<span class="badge on">On ${esc(t.builder.join(', '))}</span>` : '<span class="badge warn">Not added</span>'}</td></tr>
        <tr><td><b>Burr Guide</b></td><td>${t.guide.length ? `<span class="badge on">On ${esc(t.guide.join(', '))}</span>` : '<span class="badge">Not added</span>'}</td></tr></tbody></table>`;
    }).catch((e) => { const el = $('#tblocks'); if (el) el.innerHTML = /access|scope|permission|denied/i.test(e.message) ? '<p class="muted">Approve theme access in the next deploy to see this.</p>' : errBox(e); });
  }

  /* App Bridge title bar: the page title and its buttons in the Shopify admin header, like other apps. */
  function titleBar(title, buttons = []) {
    const tb = document.querySelector('ui-title-bar'); if (!tb) return;
    tb.setAttribute('title', title);
    tb.innerHTML = '';
    buttons.forEach((b) => { const el = document.createElement('button'); if (b.primary) el.setAttribute('variant', 'primary'); el.textContent = b.label; el.addEventListener('click', b.onClick); tb.appendChild(el); });
  }

  /* ---------- Orders ---------- */
  async function loadOrders(days) {
    const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    const out = []; let after = null;
    for (let page = 0; page < 5; page++) {
      const d = await gql(`query O($q:String!,$a:String){ orders(first:50, after:$a, sortKey:CREATED_AT, reverse:true, query:$q){ pageInfo { hasNextPage endCursor }
        nodes { id name createdAt displayFinancialStatus displayFulfillmentStatus currentTotalPriceSet { shopMoney { amount currencyCode } }
          lineItems(first:60){ nodes { title variantTitle quantity customAttributes { key value } originalTotalSet { shopMoney { amount } } } } } } }`, { q: `created_at:>=${since}`, a: after });
      out.push(...d.orders.nodes);
      if (!d.orders.pageInfo.hasNextPage) break; after = d.orders.pageInfo.endCursor;
    }
    return out.map((o) => {
      const lines = o.lineItems.nodes.map((l) => ({ ...l, attrs: Object.fromEntries((l.customAttributes || []).map((a) => [a.key, a.value])), total: cents(l.originalTotalSet.shopMoney.amount) }));
      const bid = (l) => l.attrs._build || l.attrs.Build;   // _build: hidden from shoppers; Build: orders before October 23
      const builds = [...new Set(lines.map(bid).filter(Boolean))];
      const guide = lines.filter((l) => l.attrs._source === 'Burr Guide');
      return { ...o, lines, builds, guide, total: cents(o.currentTotalPriceSet.shopMoney.amount), fromApp: lines.filter((l) => bid(l) || l.attrs._source).reduce((t, l) => t + l.total, 0) };
    }).filter((o) => o.builds.length || o.guide.length);
  }
  async function showOrders() {
    const days = +(A.sub || 30);
    body().innerHTML = head('Orders', 'Orders placed with a grinder builder or the Burr Guide, with each build\'s parts and fitting notes.', `<select id="days" aria-label="Date range">${[7, 30, 60].map((d) => `<option value="${d}" ${d === days ? 'selected' : ''}>Last ${d} days</option>`).join('')}</select><button class="btn" id="csv" disabled>Export CSV</button>`) + spin('Loading orders…');
    $('#days').onchange = (e) => go('orders', e.target.value);
    let orders;
    try { orders = await loadOrders(days); } catch (e) {
      const scope = /access|scope|permission|denied/i.test(e.message);
      body().lastElementChild.outerHTML = scope ? '<div class="note">Zerno Builder needs permission to read orders. Run the deploy again and approve the new order access when Shopify asks.</div>' : errBox(e); return;
    }
    const builds = orders.reduce((n, o) => n + o.builds.length, 0), guideN = orders.filter((o) => o.guide.length).length, rev = orders.reduce((t, o) => t + o.fromApp, 0);
    body().lastElementChild.outerHTML = `<div class="stats">${[['Orders', orders.length], ['Builds', builds], ['Burr Guide orders', guideN], ['Sales from the app', money(rev)]].map(([k, v]) => `<div class="card stat"><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      <div class="card flush"><table class="list"><thead><tr><th>Order</th><th>Date</th><th>From</th><th>Builds</th><th>App items</th><th>Order total</th><th>Status</th></tr></thead><tbody>
      ${orders.length ? orders.map((o, i) => `<tr class="clk" data-o="${i}"><td><b>${esc(o.name)}</b></td><td>${new Date(o.createdAt).toLocaleDateString()}</td><td>${[o.builds.length ? 'Builder' : '', o.guide.length ? 'Burr Guide' : ''].filter(Boolean).join(', ')}</td>
        <td>${o.builds.map(esc).join(', ') || '<span class="muted">None</span>'}</td><td>${money(o.fromApp)}</td><td>${money(o.total)}</td><td>${esc((o.displayFulfillmentStatus || '').toLowerCase().replace(/_/g, ' '))}</td></tr>
        <tr class="det" data-d="${i}" hidden><td colspan="7">${orderDetail(o)}</td></tr>`).join('') : '<tr><td colspan="7" class="empty">No builder or Burr Guide orders in this period.</td></tr>'}
      </tbody></table></div>`;
    $$('tr[data-o]').forEach((tr) => { tr.onclick = () => { const d = $(`tr[data-d="${tr.dataset.o}"]`); d.hidden = !d.hidden; }; });
    const csv = $('#csv'); csv.disabled = !orders.length;
    csv.onclick = () => {
      const rows = [['Order', 'Date', 'Build', 'Source', 'Item', 'Variant', 'Quantity', 'Fitting', 'Line total']];
      orders.forEach((o) => o.lines.filter((l) => l.attrs._build || l.attrs.Build || l.attrs._source).forEach((l) => { const id = l.attrs._build || l.attrs.Build || ''; rows.push([o.name, o.createdAt.slice(0, 10), id, id ? 'Builder' : l.attrs._source, l.title, l.variantTitle || '', l.quantity, l.attrs.Fitting || '', (l.total / 100).toFixed(2)]); }));
      const blob = new Blob([rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `zerno-builder-orders-${days}d.csv`; a.click();
    };
  }
  function orderDetail(o) {
    const groups = {};
    o.lines.forEach((l) => { const k = l.attrs._build || l.attrs.Build || (l.attrs._source ? 'Burr Guide' : ''); if (!k) return; (groups[k] = groups[k] || []).push(l); });
    return `<div class="odet">${Object.entries(groups).map(([k, ls]) => `<div><h4>${esc(k === 'Burr Guide' ? 'Added from the Burr Guide' : 'Build ' + k)}</h4><table class="vals"><tbody>${ls.map((l) => `<tr><td>${esc(l.title)}${l.variantTitle ? ` <span class="muted">${esc(l.variantTitle)}</span>` : ''}</td><td>${esc(l.attrs.Fitting || '')}</td><td>&times;${l.quantity}</td><td>${money(l.total)}</td></tr>`).join('')}</tbody></table></div>`).join('')}
      <a class="btn sm" href="shopify://admin/orders/${num(o.id)}" target="_top">Open in Shopify</a></div>`;
  }

  /* ---------- Help ---------- */
  function showHelp() {
    body().innerHTML = head('Help') + `<div class="card help-doc">
      <h2>How it fits together</h2>
      <p><b>Catalog</b> lists every grinder, burr size, burr and accessory. A new grinder, burr size or burr is a catalog entry, not code. A new grinder works right away in photo mode, using its product photo. Open its <b>Art studio</b> to cut out the grinder, accent piece and funnel cap from your photos, and the builder recolors and changes woods on it.</p>
      <p><b>Option sets</b> decide what each builder offers. Each builder uses the highest priority active option set that lists its product: the values it offers, their order, labels, help text and badges, the rules and the text on each step. Without one, a builder uses its block settings and the catalog.</p>
      <p><b>Templates</b> are starting layouts for option sets. Save any option set as a template to reuse it for the next grinder.</p>
      <p><b>Burr guides</b> are one per burr size. Fit scores and copy decide how the Burr Guide ranks burrs on the Burr Guide page and in "Help me choose" in every builder.</p>
      <p><b>Prices</b> are the Shopify variant prices. Changing a price in an option set changes the variant everywhere it is sold.</p>
      <p><b>Orders</b> show what came through the builders and the Burr Guide. Every cart line carries a build number (hidden from shoppers, shown here and on the order) and a Fitting note.</p>
      <p>Changes reach the store within about a minute of saving. If you do not see one, refresh. Nothing here changes the theme code.</p></div>`;
  }

  /* ---------- boot ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    $('#sb-save').onclick = () => A.onSave && A.onSave();
    $('#sb-discard').onclick = () => A.onDiscard && A.onDiscard();
    window.addEventListener('beforeunload', (e) => { if (A.dirty) { e.preventDefault(); e.returnValue = ''; } });
    watchUrl();
    shell(); route();
  });
  window.ZBA = A;
  window.ZBAdmin = { A, $, $$, esc, num, cents, money, slug, clone, same, toast, gql, userErr, field, parse, inp, chk, spin, errBox, head, go, setUrl, titleBar, choose, winner, loadSets, markDirty, clean, body, pimg, toVariant, productsByHandles, variantsByIds, loadCatalog, saveCatalog, uploadImage, pickFile, deepMerge, shortName };
})();
