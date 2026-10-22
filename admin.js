/* Zerno Builder admin (Apps > Zerno Builder in Shopify admin).
 * A static page: it reads and writes Shopify directly through App Bridge's Direct API access
 * (fetch('shopify:admin/api/graphql.json')), so there is no server.
 *
 * Saved in Shopify as app metaobjects, read by the storefront blocks with Liquid:
 *   $app:catalog "main"  grinders, burr sizes, burrs, accessories, textures, art and Burr Guide copy
 *   $app:option_set      one per builder setup, assigned to grinder products (like Globo's option sets)
 *   $app:template        option set layouts saved for reuse
 * Pages: Home, Option sets, Templates, Products, Orders, Catalog, Burr guides, Help.
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
  const NAV = [['home', 'Home'], ['sets', 'Option sets'], ['templates', 'Templates'], ['products', 'Products'], ['orders', 'Orders'], ['catalog', 'Catalog'], ['guides', 'Burr guides'], ['help', 'Help']];

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
  const PRODUCT = `id title handle templateSuffix featuredMedia { preview { image { url } } } options { name values } variants(first:50){ nodes { ${VARIANT} } }`;
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
     The page is ?view=<page>, plus #/<page>/<detail> for a detail. The Shopify admin sidebar (ui-nav-menu) links to
     ?view=<page>; App Bridge changes the iframe's URL without reloading it, so every way the URL can change is watched. */
  function readRoute() {
    const h = location.hash.replace(/^#\/?/, '');
    const q = new URLSearchParams(location.search).get('view');
    const [view, ...rest] = (h || q || 'home').split('/');
    return { view: NAV.some(([k]) => k === view) ? view : 'home', sub: rest.join('/') };
  }
  function urlFor(view, sub = '') {
    const q = new URLSearchParams(location.search);
    if (view === 'home') q.delete('view'); else q.set('view', view);
    const s = q.toString();
    return location.pathname + (s ? '?' + s : '') + (sub ? '#/' + view + '/' + sub : '');
  }
  let lastUrl = location.href;
  function setUrl(view, sub = '') { history.replaceState(null, '', urlFor(view, sub)); lastUrl = location.href; A.view = view; A.sub = sub; }
  function leaveOk() {
    if (!A.dirty) return true;
    if (!confirm('Leave without saving your changes?')) return false;
    if (A.catSaved) A.cat = clone(A.catSaved);            // drop unsaved catalog edits too
    return true;
  }
  function go(view, sub = '') {
    if (!leaveOk()) return false;
    clean(); A.onSave = null; A.onDiscard = null;
    setUrl(view, sub);
    route();
    return true;
  }
  function onUrlChange() {
    if (location.href === lastUrl) return;
    const r = readRoute();
    if (r.view === A.view && r.sub === A.sub) { lastUrl = location.href; return; }
    if (!leaveOk()) { history.replaceState(null, '', urlFor(A.view, A.sub)); lastUrl = location.href; return; }
    lastUrl = location.href; clean(); A.onSave = null; A.onDiscard = null;
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
      const u = new URL(href, location.href), v = u.searchParams.get('view') || u.hash.replace(/^#\/?/, '').split('/')[0] || 'home';
      if (v !== A.view) go(NAV.some(([k]) => k === v) ? v : 'home');
    });
  }
  async function route() {
    const r = readRoute(); A.view = r.view; A.sub = r.sub; A.set = null;
    $$('#nav button').forEach((b) => b.setAttribute('aria-current', b.dataset.v === A.view ? 'page' : 'false'));
    body().innerHTML = spin();
    try { await ensureCatalog(); } catch (e) { body().innerHTML = errBox(e); return; }
    const V = { home: showHome, sets: showSets, templates: showTemplates, products: showProducts, orders: showOrders, help: showHelp };
    const ext = window.ZBAdminCatalog || {};
    if (A.view === 'catalog') return ext.showCatalog ? ext.showCatalog(A.sub) : (body().innerHTML = errBox('The catalog page did not load.'));
    if (A.view === 'guides') return ext.showGuides ? ext.showGuides(A.sub) : (body().innerHTML = errBox('The burr guides page did not load.'));
    return V[A.view]();
  }
  function shell() {
    app().innerHTML = `<div class="top"><div class="brand">Zerno Builder</div><nav id="nav" aria-label="Zerno Builder">${NAV.map(([k, n]) => `<button data-v="${k}">${n}</button>`).join('')}</nav></div><div id="body"></div>`;
    $$('#nav button').forEach((b) => { b.onclick = () => go(b.dataset.v); });
  }
  const head = (title, sub = '', actions = '') => `<div class="ph"><h1>${title}</h1>${actions}</div>${sub ? `<p class="lede">${sub}</p>` : ''}`;

  /* ---------- Home ---------- */
  async function showHome() {
    const cat = A.cat;
    let sets = [], prods = [], err = '';
    try { [sets, prods] = await Promise.all([loadSets(), productsByHandles([...cat.grinders.map((g) => g.product), ...cat.sizes.flatMap((s) => s.products || [])])]); } catch (e) { err = e.message; }
    A.sets = sets;
    const ph = (h) => prods.find((p) => p.handle === h);
    const steps = [
      { done: A.catIsSaved, t: 'Save your catalog', d: A.catIsSaved ? 'Your grinders, burr sizes, burrs and accessories are saved in Shopify.' : 'The store uses the built-in catalog. Open Catalog and save it once to make it yours.', go: 'catalog' },
      { done: cat.grinders.every((g) => ph(g.product)), t: 'Link each grinder to its product', d: 'Every grinder in the catalog needs its Shopify product.', go: 'products' },
      { done: cat.grinders.every((g) => winner(g, sets, ph(g.product)).os), t: 'Give each grinder an active option set', d: 'Option sets control what each builder offers. Templates give you a head start.', go: 'sets' },
      { done: cat.sizes.every((s) => (s.products || []).some((h) => ph(h))), t: 'Link each burr size to its burr product', d: 'The Burr Guide reads prices and stock from these products.', go: 'catalog/sizes' },
      { done: cat.grinders.every((g) => g.art), t: 'Add layered art to each grinder', d: 'New grinders run in photo mode. The Art studio cuts out the grinder, accent piece and funnel cap so colors and woods show on the grinder.', go: 'catalog/grinders' }
    ];
    const n = steps.filter((s) => s.done).length;
    body().innerHTML = head('Home', 'Set up and run the grinder builders and the Burr Guide.') + (err ? errBox(err) : '') + `
      <div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h2>Setup guide</h2><span class="badge ${n === steps.length ? 'on' : ''}">${n} of ${steps.length} done</span></div>
        <div class="meter"><i style="width:${(n / steps.length) * 100}%"></i></div>
        <ol class="checklist">${steps.map((s) => `<li class="${s.done ? 'done' : ''}"><span class="tick" aria-hidden="true">${s.done ? '&#10003;' : ''}</span><div><b>${esc(s.t)}</b><p>${esc(s.d)}</p></div><button class="btn sm" data-go="${s.go}">${s.done ? 'View' : 'Start'}</button></li>`).join('')}</ol></div>
      <div class="stats">${[['Grinders', cat.grinders.length], ['Burr sizes', cat.sizes.length], ['Burrs', cat.burrs.filter((b) => !b.hidden).length], ['Accessories', cat.accessories.length], ['Active option sets', sets.filter((s) => s.active).length]].map(([k, v]) => `<div class="card stat"><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      <div class="card"><h2>Add to your theme</h2><p class="sub" style="margin:0">In the theme editor, open a grinder's product template and add the <b>Grinder Builder</b> app block. It finds the grinder from the product page. Add the <b>Burr Guide</b> block to any page. Changes you save here reach the store within about a minute.</p></div>`;
    $$('[data-go]').forEach((b) => { b.onclick = () => { const [v, ...s] = b.dataset.go.split('/'); go(v, s.join('/')); }; });
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
    body().innerHTML = head('Option sets', 'Each option set controls one grinder builder: the burrs, woods, caps and accessories it offers, their labels and rules. When two active sets list the same grinder, the higher priority wins.', '<button class="btn primary" id="new">Create option set</button>') + `
      <div class="card flush"><table class="list"><thead><tr><th>Option set</th><th>Grinder</th><th>Products</th><th>Priority</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>
      ${A.sets.length ? A.sets.map((s) => `<tr class="clk" data-id="${esc(s.id)}"><td><b>${esc(s.title)}</b></td><td>${esc(grinderName(s.builder))}</td>
        <td>${s.products.length ? s.products.map((g) => esc(pname(g))).join(', ') : '<span class="muted">None yet</span>'}</td><td>${s.priority}</td>
        <td><label class="switch" data-stop><input type="checkbox" data-act="${esc(s.id)}" ${s.active ? 'checked' : ''}><span class="badge ${s.active ? 'on' : ''}">${s.active ? 'Active' : 'Draft'}</span></label></td>
        <td>${s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : ''}</td><td data-stop><button class="btn sm" data-dup="${esc(s.id)}">Duplicate</button></td></tr>`).join('')
        : '<tr><td colspan="7" class="empty">No option sets yet. Create one for each grinder. Until then each builder uses its block settings and the catalog.</td></tr>'}
      </tbody></table></div>`;
    $('#new').onclick = () => go('sets', 'new');
    $$('tr.clk').forEach((tr) => { tr.onclick = (e) => { if (e.target.closest('[data-stop]')) return; go('sets', String(num(tr.dataset.id))); }; });
    $$('[data-dup]').forEach((b) => { b.onclick = async () => { const s = clone(A.sets.find((x) => x.id === b.dataset.dup)); Object.assign(s, { id: null, title: s.title + ' copy', active: false, handle: slug(s.title) }); await editSet(s); markDirty(); }; });
    $$('[data-act]').forEach((c) => {
      c.onchange = async () => {
        try {
          userErr((await gql(`mutation U($id:ID!,$f:[MetaobjectFieldInput!]!){ metaobjectUpdate(id:$id, metaobject:{fields:$f}){ userErrors { message } } }`, { id: c.dataset.act, f: [{ key: 'active', value: String(c.checked) }] })).metaobjectUpdate);
          toast(c.checked ? 'Option set is live' : 'Option set is now a draft'); showSets();
        } catch (e) { toast(e.message, true); c.checked = !c.checked; }
      };
    });
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
    if (!title) return;
    const roles = Object.keys(FIELD).filter((k) => (A.set.lists[k] || []).length);
    const { items, ...config } = A.set.config;
    try {
      userErr((await gql(`mutation C($m:MetaobjectCreateInput!){ metaobjectCreate(metaobject:$m){ metaobject { id } userErrors { message } } }`,
        { m: { type: '$app:template', handle: `${slug(title)}-${Date.now().toString(36)}`, fields: [{ key: 'title', value: title }, { key: 'data', value: JSON.stringify({ desc: `Saved from ${A.set.title}`, roles, config }) }] } })).metaobjectCreate);
      toast('Template saved');
    } catch (e) { toast('Not saved: ' + e.message, true); }
  }

  /* ---------- Templates ---------- */
  async function showTemplates() {
    const tpls = await allTemplates();
    const roleName = { burrs: 'Burrs', accents: 'Accent pieces', caps: 'Funnel caps', accessories: 'Accessories' };
    body().innerHTML = head('Templates', 'Start an option set from a ready-made layout, or save your own from any option set with "Save as template".') + `
      <div class="tpls">${tpls.map((t) => `<div class="card tplc"><div><span class="badge ${t.saved ? '' : 'req'}">${t.saved ? 'Yours' : 'Built in'}</span><h2>${esc(t.title)}</h2><p class="sub">${esc(t.desc || '')}</p>
        <p class="steps">Color${(t.roles || []).map((r) => ' · ' + roleName[r]).join('')}</p></div>
        <div style="display:flex;gap:8px"><button class="btn primary sm" data-use="${esc(t.saved ? num(t.id) : t.id)}">Use template</button>${t.saved ? `<button class="btn sm danger" data-rmt="${esc(t.id)}">Delete</button>` : ''}</div></div>`).join('')}</div>`;
    $$('[data-use]').forEach((b) => { b.onclick = () => go('sets', 'new?template=' + b.dataset.use); });
    $$('[data-rmt]').forEach((b) => { b.onclick = async () => { if (!confirm('Delete this template? Option sets made from it stay as they are.')) return; try { userErr((await gql(`mutation D($id:ID!){ metaobjectDelete(id:$id){ userErrors { message } } }`, { id: b.dataset.rmt })).metaobjectDelete); toast('Template deleted'); showTemplates(); } catch (e) { toast(e.message, true); } }; });
  }

  /* ---------- Products ---------- */
  async function showProducts() {
    const cat = A.cat;
    let sets, prods;
    try { [sets, prods] = await Promise.all([loadSets(), productsByHandles([...cat.grinders.map((g) => g.product), ...cat.sizes.flatMap((s) => s.products || []), ...cat.accessories.map((a) => a.product)])]); } catch (e) { body().innerHTML = errBox(e); return; }
    const ph = (h) => prods.find((p) => p.handle === h);
    const artOf = (g) => (!g.art ? '<span class="badge">Photo mode</span>' : `<span class="badge on">Layered art</span>`);
    body().innerHTML = head('Products', 'Every product the builders and the Burr Guide use, and which option set each grinder gets. Like Globo, it shows why the other option sets were skipped.') + `
      <div class="card flush"><table class="list"><thead><tr><th>Grinder</th><th>Product</th><th>Burr size</th><th>Art</th><th>Option set in use</th><th>Skipped</th></tr></thead><tbody>
      ${cat.grinders.map((g) => { const p = ph(g.product), w = winner(g, sets, p); return `<tr><td><b>${esc(g.name)}</b><div class="muted">${esc(g.key)}</div></td>
        <td>${p ? `<span class="pcell">${pimg(p) ? `<img src="${esc(pimg(p))}" alt="">` : ''}<span>${esc(p.title)}<br><span class="muted">${esc(p.handle)}${p.templateSuffix ? ' · template ' + esc(p.templateSuffix) : ''}</span></span></span>` : `<span class="badge warn">Not found: ${esc(g.product)}</span>`}</td>
        <td>${esc(g.size)}</td><td>${artOf(g)}</td>
        <td>${w.os ? `<a href="#/sets/${num(w.os.id)}">${esc(w.os.title)}</a>` : `<span class="muted">${p ? 'No active option set lists this product. The builder uses its block settings and the catalog.' : 'Link the product first.'}</span>`}</td>
        <td>${w.skipped.length ? w.skipped.map((x) => `<div><a href="#/sets/${num(x.s.id)}">${esc(x.s.title)}</a> <span class="muted">${esc(x.why)}</span></div>`).join('') : '<span class="muted">None</span>'}</td></tr>`; }).join('')}
      </tbody></table></div>
      <div class="card flush"><table class="list"><thead><tr><th>Burr size</th><th>Burr products</th><th>Burrs in the catalog</th><th>Matched to a variant</th></tr></thead><tbody>
      ${cat.sizes.map((s) => { const ps = (s.products || []).map(ph).filter(Boolean), vs = ps.flatMap((p) => p.variants.nodes.map(toVariant)); const bs = cat.burrs.filter((b) => b.size === s.key && !b.hidden); const matched = bs.filter((b) => vs.some((v) => Cat.burrFor({ burrs: [b] }, s.key, v))); return `<tr><td><b>${esc(s.name)}</b></td>
        <td>${(s.products || []).map((h) => (ph(h) ? esc(ph(h).title) : `<span class="badge warn">Not found: ${esc(h)}</span>`)).join('<br>') || '<span class="muted">None</span>'}</td><td>${bs.length}</td>
        <td>${matched.length === bs.length ? `<span class="badge on">All ${bs.length}</span>` : `<span class="badge warn">${matched.length} of ${bs.length}</span> <span class="muted">${esc(bs.filter((b) => !matched.includes(b)).map((b) => b.name).join(', '))}</span>`}</td></tr>`; }).join('')}
      </tbody></table></div>`;
    $$('a[href^="#/"]', body()).forEach((a) => { a.onclick = (e) => { e.preventDefault(); const [v, ...s] = a.getAttribute('href').slice(2).split('/'); go(v, s.join('/')); }; });
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
      const builds = [...new Set(lines.map((l) => l.attrs.Build).filter(Boolean))];
      const guide = lines.filter((l) => l.attrs._source === 'Burr Guide');
      return { ...o, lines, builds, guide, total: cents(o.currentTotalPriceSet.shopMoney.amount), fromApp: lines.filter((l) => l.attrs.Build || l.attrs._source).reduce((t, l) => t + l.total, 0) };
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
      orders.forEach((o) => o.lines.filter((l) => l.attrs.Build || l.attrs._source).forEach((l) => rows.push([o.name, o.createdAt.slice(0, 10), l.attrs.Build || '', l.attrs.Build ? 'Builder' : l.attrs._source, l.title, l.variantTitle || '', l.quantity, l.attrs.Fitting || '', (l.total / 100).toFixed(2)])));
      const blob = new Blob([rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `zerno-builder-orders-${days}d.csv`; a.click();
    };
  }
  function orderDetail(o) {
    const groups = {};
    o.lines.forEach((l) => { const k = l.attrs.Build || (l.attrs._source ? 'Burr Guide' : ''); if (!k) return; (groups[k] = groups[k] || []).push(l); });
    return `<div class="odet">${Object.entries(groups).map(([k, ls]) => `<div><h4>${esc(k === 'Burr Guide' ? 'Added from the Burr Guide' : 'Build ' + k)}</h4><table class="vals"><tbody>${ls.map((l) => `<tr><td>${esc(l.title)}${l.variantTitle ? ` <span class="muted">${esc(l.variantTitle)}</span>` : ''}</td><td>${esc(l.attrs.Fitting || '')}</td><td>&times;${l.quantity}</td><td>${money(l.total)}</td></tr>`).join('')}</tbody></table></div>`).join('')}
      <a class="btn sm" href="shopify://admin/orders/${num(o.id)}" target="_top">Open in Shopify</a></div>`;
  }

  /* ---------- Help ---------- */
  function showHelp() {
    body().innerHTML = head('Help') + `<div class="card help-doc">
      <h2>How it fits together</h2>
      <p><b>Catalog</b> lists every grinder, burr size, burr and accessory. A new grinder, burr size or burr is a catalog entry, not code. A new grinder works right away in photo mode, using its product photo. Open its <b>Art studio</b> to cut out the grinder, accent piece and funnel cap from your photos, and the builder recolors and changes woods on it.</p>
      <p><b>Option sets</b> work like Globo. Each builder uses the highest priority active option set that lists its product: the values it offers, their order, labels, help text and badges, the rules and the text on each step. Without one, a builder uses its block settings and the catalog.</p>
      <p><b>Templates</b> are starting layouts for option sets. Save any option set as a template to reuse it for the next grinder.</p>
      <p><b>Burr guides</b> are one per burr size. Fit scores and copy decide how the Burr Guide ranks burrs on the Burr Guide page and in "Help me choose" in every builder.</p>
      <p><b>Prices</b> are the Shopify variant prices. Changing a price in an option set changes the variant everywhere it is sold.</p>
      <p><b>Orders</b> show what came through the builders and the Burr Guide. Every cart line carries a Build number and a Fitting note, which also print on the order and packing slip.</p>
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
  window.ZBAdmin = { A, $, $$, esc, num, cents, money, slug, clone, same, toast, gql, userErr, field, parse, inp, chk, spin, errBox, head, go, setUrl, markDirty, clean, body, pimg, toVariant, productsByHandles, variantsByIds, loadCatalog, saveCatalog, uploadImage, deepMerge, shortName };
})();
