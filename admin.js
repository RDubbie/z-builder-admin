/* Zerno Builder admin (Apps > Zerno Builder in Shopify admin).
 * A static page: it reads and writes Shopify directly through App Bridge's Direct API access
 * (fetch('shopify:admin/api/graphql.json')), so there is no server.
 *
 * Option sets are saved as $app:option_set metaobjects and burr guide tuning as the $app:burr_guide
 * metaobject with the handle "main". The storefront blocks read them with Liquid.
 */
(() => {
  const API = 'shopify:admin/api/2026-04/graphql.json';
  const BUILDERS = {
    z2: { name: 'Z2', handles: { burrs: ['80mm-burrs'], accents: ['z2-accent-pieces'], caps: ['funnel-caps'], accessories: ['pelican-style-zerno-hard-case', 'magnetic-portafilter-holder'] }, grinder: 'zerno-z2', match: 'Z2' },
    z1: { name: 'Z1', handles: { burrs: ['64mm-burrs'], accents: ['z1-accent-piece'], caps: ['funnel-caps'], accessories: ['pelican-style-zerno-hard-case', 'magnetic-portafilter-holder'] }, grinder: 'zerno-z1', match: 'Z1' }
  };
  const GROUPS = [
    { k: 'finish', name: 'Grinder color', kind: 'finish' },
    { k: 'burrs', name: 'Burr set', kind: 'list', list: 'burrs' },
    { k: 'accents', name: 'Accent piece', kind: 'list', list: 'accents' },
    { k: 'caps', name: 'Funnel cap', kind: 'list', list: 'caps' },
    { k: 'accessories', name: 'Accessories', kind: 'list', list: 'accessories' }
  ];
  const FIELD = { burrs: 'burr_variants', accents: 'accent_variants', caps: 'cap_variants', accessories: 'accessory_variants' };

  /* ---------- helpers ---------- */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (gid) => +String(gid).split('/').pop();
  const vgid = (n) => `gid://shopify/ProductVariant/${n}`;
  const cents = (p) => Math.round(parseFloat(p || 0) * 100);
  const money = (c) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0 });
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const clone = (x) => JSON.parse(JSON.stringify(x));
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

  /* ---------- data ---------- */
  const VARIANT = `id title price availableForSale image { url } selectedOptions { name value }
    product { id title handle featuredMedia { preview { image { url } } } }`;
  const toVariant = (v) => ({
    id: num(v.id), gid: v.id, title: v.title, price: cents(v.price), available: v.availableForSale !== false,
    image: (v.image && v.image.url) || (v.product && v.product.featuredMedia && v.product.featuredMedia.preview && v.product.featuredMedia.preview.image && v.product.featuredMedia.preview.image.url) || null,
    product: v.product ? { id: num(v.product.id), gid: v.product.id, title: v.product.title, handle: v.product.handle, image: v.product.featuredMedia && v.product.featuredMedia.preview && v.product.featuredMedia.preview.image && v.product.featuredMedia.preview.image.url } : null
  });
  async function variantsByIds(gids) {
    if (!gids.length) return [];
    const out = [];
    for (let i = 0; i < gids.length; i += 100) {
      const d = await gql(`query V($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant { ${VARIANT} } } }`, { ids: gids.slice(i, i + 100) });
      out.push(...d.nodes.filter(Boolean).map(toVariant));
    }
    return out;
  }
  async function productsByHandles(handles) {
    const d = await gql(`query P($q:String!){ products(first:20, query:$q){ nodes { id title handle featuredMedia { preview { image { url } } }
      options { name values } variants(first:50){ nodes { ${VARIANT} } } } } }`, { q: handles.map((h) => `handle:${h}`).join(' OR ') });
    return d.products.nodes;
  }
  async function productsByIds(gids) {
    if (!gids.length) return [];
    const d = await gql(`query P($ids:[ID!]!){ nodes(ids:$ids){ ... on Product { id title handle featuredMedia { preview { image { url } } }
      options { name values } variants(first:50){ nodes { ${VARIANT} } } } } }`, { ids: gids });
    return d.nodes.filter(Boolean);
  }
  const field = (mo, k) => { const f = (mo.fields || []).find((x) => x.key === k); return f ? f.value : null; };
  const parse = (v, d) => { try { return v == null || v === '' ? d : JSON.parse(v); } catch (e) { return d; } };
  async function loadSets() {
    const d = await gql(`{ metaobjects(type:"$app:option_set", first:50){ nodes { id handle updatedAt fields { key value } } } }`);
    return d.metaobjects.nodes.map((mo) => ({
      id: mo.id, handle: mo.handle, updatedAt: mo.updatedAt, title: field(mo, 'title') || 'Option set', builder: field(mo, 'builder') || 'z2',
      active: field(mo, 'active') === 'true', products: parse(field(mo, 'products'), []),
      lists: Object.fromEntries(Object.entries(FIELD).map(([k, f]) => [k, parse(field(mo, f), [])])),
      config: parse(field(mo, 'config'), {})
    }));
  }

  /* ---------- state ---------- */
  const A = { view: 'list', tab: 'sets', sets: [], set: null, saved: null, variants: {}, grinders: [], dirty: false, prices: {}, guide: null, guideSaved: null, open: { finish: true } };
  const app = () => $('#app');
  function markDirty() { A.dirty = true; $('#savebar').classList.add('on'); schedulePreview(); }
  function clean() { A.dirty = false; $('#savebar').classList.remove('on'); }

  /* ---------- list view ---------- */
  async function showList() {
    A.view = 'list'; A.set = null; clean();
    app().innerHTML = `<div class="ph"><h1>Zerno Builder</h1></div>
      <div class="tabs" role="tablist"><button role="tab" data-t="sets" aria-selected="${A.tab === 'sets'}">Option sets</button><button role="tab" data-t="guide" aria-selected="${A.tab === 'guide'}">Burr guide</button><button role="tab" data-t="help" aria-selected="${A.tab === 'help'}">How it works</button></div>
      <div id="tabbody"><div class="card"><span class="spin"></span> Loading…</div></div>`;
    $$('.tabs button').forEach((b) => { b.onclick = () => { A.tab = b.dataset.t; showList(); }; });
    if (A.tab === 'guide') return showGuide();
    if (A.tab === 'help') return showHelp();
    try { A.sets = await loadSets(); } catch (e) { $('#tabbody').innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
    const prodIds = [...new Set(A.sets.flatMap((s) => s.products))];
    let prods = [];
    try { prods = await productsByIds(prodIds); } catch (e) { /* titles only */ }
    const pname = (gid) => (prods.find((p) => p.id === gid) || {}).title || 'Product';
    $('#tabbody').innerHTML = `<div class="card" style="padding:0;overflow:hidden">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px"><div><h2>Option sets</h2><p class="sub" style="margin:0">One per builder. The active option set assigned to a grinder controls its builder on the store.</p></div>
      <span style="display:flex;gap:8px"><button class="btn" data-new="z1">Create Z1 option set</button><button class="btn primary" data-new="z2">Create Z2 option set</button></span></div>
      <table class="list"><thead><tr><th>Option set</th><th>Builder</th><th>Grinders</th><th>Status</th><th>Updated</th></tr></thead><tbody>
      ${A.sets.length ? A.sets.map((s) => `<tr class="clk" data-id="${esc(s.id)}"><td><b>${esc(s.title)}</b></td><td>${s.builder.toUpperCase()} Builder</td>
        <td>${s.products.length ? s.products.map((g) => esc(pname(g))).join(', ') : '<span style="color:#8a8a8a">None yet</span>'}</td>
        <td><label class="switch" data-stop><input type="checkbox" data-act="${esc(s.id)}" ${s.active ? 'checked' : ''}><span class="badge ${s.active ? 'on' : ''}">${s.active ? 'Active' : 'Draft'}</span></label></td>
        <td>${s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : ''}</td></tr>`).join('')
        : '<tr><td colspan="5" class="empty">No option sets yet. Create one for each builder. Until then the builders use their block settings.</td></tr>'}
      </tbody></table></div>`;
    $$('[data-new]').forEach((b) => { b.onclick = () => createSet(b.dataset.new); });
    $$('tr.clk').forEach((tr) => { tr.onclick = (e) => { if (e.target.closest('[data-stop]')) return; editSet(A.sets.find((s) => s.id === tr.dataset.id)); }; });
    $$('[data-act]').forEach((c) => {
      c.onchange = async () => {
        try {
          userErr((await gql(`mutation U($id:ID!,$f:[MetaobjectFieldInput!]!){ metaobjectUpdate(id:$id, metaobject:{fields:$f}){ userErrors { message } } }`, { id: c.dataset.act, f: [{ key: 'active', value: String(c.checked) }] })).metaobjectUpdate);
          toast(c.checked ? 'Option set is live' : 'Option set is now a draft'); showList();
        } catch (e) { toast(e.message, true); c.checked = !c.checked; }
      };
    });
  }

  function defaultConfig(b) {
    return {
      heading: `Build your ${BUILDERS[b].name}`,
      groups: {
        finish: { label: 'Finish', title: 'Choose your finish', help: 'Hand assembled in our Chicago facility.', values: { 'soft-white': { text: 'Soft white Cerakote' } } },
        burrs: { label: 'Burrs', title: 'Pick your burrs', help: '', required: true, multiple: true, max: 0 },
        accents: { step: 'Accents', title: 'Finish the details', label: 'Accent piece', help: '', required: true, multiple: true, max: 0, default: '' },
        caps: { label: 'Funnel cap', help: '', allowNone: true, noneLabel: 'No cap', multiple: true, max: 0, default: 'none' },
        accessories: { label: 'Accessories', title: 'Add accessories', help: `Every ${BUILDERS[b].name} already comes with these, plus maintenance tools.`, max: 0 }
      },
      items: {}
    };
  }
  async function createSet(b) {
    const B = BUILDERS[b];
    app().innerHTML = '<div class="card"><span class="spin"></span> Setting up the option set from your products…</div>';
    try {
      const all = Object.values(B.handles).flat();
      const prods = await productsByHandles([...new Set([...all, B.grinder])]);
      const byH = (h) => prods.find((p) => p.handle === h);
      const lists = {};
      for (const [k, hs] of Object.entries(B.handles)) {
        lists[k] = hs.map(byH).filter(Boolean).flatMap((p) => {
          if (k !== 'accessories') return p.variants.nodes.map((v) => v.id);
          const pick = p.variants.nodes.find((v) => v.title.includes(B.match)) || p.variants.nodes[0];
          return pick ? [pick.id] : [];
        });
      }
      const g = byH(B.grinder);
      const set = { id: null, handle: `${b}-builder`, title: `${B.name} Options Set`, builder: b, active: false, products: g ? [g.id] : [], lists, config: defaultConfig(b) };
      await editSet(set);
      markDirty();
    } catch (e) { app().innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  }

  /* ---------- editor ---------- */
  async function editSet(set) {
    A.view = 'edit'; A.set = clone(set); A.saved = clone(set); A.prices = {};
    A.set.config = Object.assign(defaultConfig(set.builder), A.set.config || {});
    A.set.config.groups = Object.assign(defaultConfig(set.builder).groups, (set.config && set.config.groups) || {});
    A.set.config.items = A.set.config.items || {};
    app().innerHTML = '<div class="card"><span class="spin"></span> Loading option set…</div>';
    try {
      const ids = [...new Set(Object.values(A.set.lists).flat())];
      (await variantsByIds(ids)).forEach((v) => { A.variants[v.gid] = v; });
      A.grinders = await productsByIds(A.set.products);
    } catch (e) { app().innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
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
    if (g.k === 'burrs') bits.push('Required');
    if (g.k === 'accents') bits.push('Required');
    if (g.k === 'caps') bits.push(G.allowNone ? 'Optional' : 'Required');
    bits.push(`${list.length} values`);
    if (hid) bits.push(`${hid} hidden`);
    if (G.multiple && g.k !== 'accessories') bits.push(g.k === 'burrs' ? 'spares allowed' : 'extras allowed');
    const pr = list.map((gid) => A.variants[gid]).filter(Boolean).map((v) => A.prices[v.gid] != null ? A.prices[v.gid] : v.price);
    if (pr.length) bits.push(`${money(Math.min(...pr))} to ${money(Math.max(...pr))}`);
    return bits.join(' · ');
  }
  function finishValues() {
    const g = A.grinders[0]; if (!g) return ['Jet Black', 'Soft White'];
    const o = g.options.find((x) => /colou?r|finish/i.test(x.name)) || g.options[0];
    return o ? o.values : [];
  }
  function renderEditor() {
    const s = A.set, B = BUILDERS[s.builder];
    app().innerHTML = `<div class="ph"><button class="back" id="back" aria-label="Back">&larr;</button>
      <h1><input type="text" id="title" value="${esc(s.title)}" style="max-width:340px;font-size:16px;font-weight:650"> <span class="badge">${B.name} Builder</span></h1>
      <label class="switch"><input type="checkbox" id="active" ${s.active ? 'checked' : ''}><span class="badge ${s.active ? 'on' : ''}" id="actlbl">${s.active ? 'Active' : 'Draft'}</span></label>
      ${s.id ? '<button class="btn danger" id="del">Delete</button>' : ''}<button class="btn primary" id="save">Save</button></div>
      <div class="grid"><div>
        <div class="card"><h2>Grinders</h2><p class="sub">The ${B.name} Builder on these product pages uses this option set while it is active.</p>
          <div class="chips" id="gchips"></div><button class="btn sm" id="pickg">Choose grinders</button></div>
        <div class="card"><h2>Setup flow</h2><p class="sub">Like Globo: open a group to change its name, rules and values. Drag values to reorder. Prices are the Shopify variant prices.</p>
          <div class="field"><label for="heading">Builder heading</label><input type="text" id="heading" value="${esc(s.config.heading || '')}"></div>
          <div class="flow" id="flow"></div></div>
      </div><div class="sticky"><div class="pv"><div class="pvh"><b>Live preview</b><span style="color:#616161;font-size:12px">The real builder with these settings. Saving publishes them.</span></div><div class="pvb" id="preview"></div></div></div></div>`;
    $('#back').onclick = () => { if (A.dirty && !confirm('Leave without saving your changes?')) return; showList(); };
    $('#title').oninput = (e) => { s.title = e.target.value; markDirty(); };
    $('#heading').oninput = (e) => { s.config.heading = e.target.value; markDirty(); };
    $('#active').onchange = (e) => { s.active = e.target.checked; $('#actlbl').textContent = s.active ? 'Active' : 'Draft'; $('#actlbl').classList.toggle('on', s.active); markDirty(); };
    $('#save').onclick = save;
    if ($('#del')) $('#del').onclick = del;
    $('#pickg').onclick = pickGrinders;
    renderGrinders(); renderFlow(); renderPreview();
  }
  function renderGrinders() {
    $('#gchips').innerHTML = A.grinders.length ? A.grinders.map((p) => `<span class="chip">${p.featuredMedia && p.featuredMedia.preview ? `<img src="${esc(p.featuredMedia.preview.image.url)}" alt="">` : ''}${esc(p.title)}<button data-rmg="${esc(p.id)}" aria-label="Remove">&times;</button></span>`).join('')
      : '<span style="color:#8a8a8a">No grinder yet. The option set does nothing until a grinder is chosen.</span>';
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
  function inp(id, label, value, help = '', type = 'text') { return `<div class="field"><label for="${id}">${label}</label><input type="${type}" id="${id}" value="${esc(value == null ? '' : value)}">${help ? `<span class="help">${help}</span>` : ''}</div>`; }
  function chk(id, label, on, help = '') { return `<label class="check"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span>${label}${help ? `<small>${help}</small>` : ''}</span></label>`; }
  function renderGroup(g, box) {
    const s = A.set, G = s.config.groups[g.k] = s.config.groups[g.k] || {};
    const bind = (id, key, conv = (v) => v) => { const el = box.querySelector('#' + id); if (!el) return; el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => { G[key] = conv(el.type === 'checkbox' ? el.checked : el.value); refreshHead(g); markDirty(); if (key === 'label') { const n = $(`#flow .grp[data-g="${g.k}"] .gn`); if (n) n.textContent = el.value || g.name; } if (key === 'allowNone') renderGroup(g, box); }); };
    if (g.kind === 'finish') {
      const vals = finishValues(); G.values = G.values || {};
      box.innerHTML = `<div class="row2">${inp('f-label', 'Step name', G.label)}${inp('f-title', 'Heading', G.title)}</div>${inp('f-help', 'Note under the heading', G.help)}
        <table class="vals"><thead><tr><th>Color</th><th>Swatch</th><th>Line under the color</th><th>Show</th></tr></thead><tbody>
        ${vals.map((v) => { const k = slug(v), o = G.values[k] || {}; return `<tr class="${o.hidden ? 'hid' : ''}"><td><b>${esc(v)}</b></td><td><input type="color" class="swatch" data-sw="${k}" value="${esc(o.swatch || (/white/.test(k) ? '#e9e9e6' : /black/.test(k) ? '#141517' : '#888888'))}"></td>
          <td><input type="text" data-tx="${k}" value="${esc(o.text || '')}" placeholder="Optional"></td><td><label class="switch"><input type="checkbox" data-sh="${k}" ${o.hidden ? '' : 'checked'}></label></td></tr>`; }).join('')}
        </tbody></table><p class="help" style="color:#616161;font-size:12px">Colors come from the grinder's variants in Shopify. To add one, add a variant to the grinder. It shows its own photo until a developer prepares its builder photo.</p>`;
      bind('f-label', 'label'); bind('f-title', 'title'); bind('f-help', 'help');
      const val = (k) => (G.values[k] = G.values[k] || {});
      $$('[data-sw]', box).forEach((e) => { e.oninput = () => { val(e.dataset.sw).swatch = e.value; markDirty(); }; });
      $$('[data-tx]', box).forEach((e) => { e.oninput = () => { val(e.dataset.tx).text = e.value; markDirty(); }; });
      $$('[data-sh]', box).forEach((e) => { e.onchange = () => { val(e.dataset.sh).hidden = !e.checked; e.closest('tr').classList.toggle('hid', !e.checked); refreshHead(g); markDirty(); }; });
      return;
    }
    const list = s.lists[g.list] = s.lists[g.list] || [];
    let top = '';
    if (g.k === 'burrs') top = `<div class="row2">${inp('g-label', 'Step name', G.label)}${inp('g-title', 'Heading', G.title)}</div>${inp('g-help', 'Help text', G.help, 'Shown under the heading. Leave empty for the standard text.')}
      <div class="row2"><div>${chk('g-multiple', 'Allow spare burr sets', G.multiple, 'The first pick ships installed, more picks ship in the box.')}</div>${inp('g-max', 'Max selections', G.max || '', 'Empty for no limit.', 'number')}</div>`;
    if (g.k === 'accents') top = `<div class="row2">${inp('g-step', 'Step name', G.step)}${inp('g-title', 'Heading', G.title)}</div><div class="row2">${inp('g-label', 'Name on product page', G.label)}${inp('g-help', 'Help text', G.help)}</div>
      <div class="row3"><div>${chk('g-multiple', 'Allow extra pieces', G.multiple, 'Extras ship in the box.')}</div>${inp('g-max', 'Max selections', G.max || '', 'Empty for no limit.', 'number')}<div class="field"><label for="g-default">Default value</label><select id="g-default"><option value="">First available</option>${list.map((gid) => { const v = A.variants[gid]; return v ? `<option value="${v.id}" ${String(G.default) === String(v.id) ? 'selected' : ''}>${esc(itemLabel(v))}</option>` : ''; }).join('')}</select></div></div>`;
    if (g.k === 'caps') top = `<div class="row2">${inp('g-label', 'Name on product page', G.label)}${inp('g-help', 'Help text', G.help)}</div>
      <div class="row2"><div>${chk('g-allowNone', 'Customers can choose no cap', G.allowNone, 'Adds a "No cap" option. A cap and No cap are never both selected.')}</div>${G.allowNone ? inp('g-noneLabel', 'Label for no cap', G.noneLabel) : '<span></span>'}</div>
      <div class="row3"><div>${chk('g-multiple', 'Allow extra caps', G.multiple)}</div>${inp('g-max', 'Max selections', G.max || '', 'Empty for no limit.', 'number')}<div class="field"><label for="g-default">Default value</label><select id="g-default">${G.allowNone ? `<option value="none" ${G.default === 'none' ? 'selected' : ''}>${esc(G.noneLabel || 'No cap')}</option>` : ''}<option value="" ${!G.default ? 'selected' : ''}>First available</option>${list.map((gid) => { const v = A.variants[gid]; return v ? `<option value="${v.id}" ${String(G.default) === String(v.id) ? 'selected' : ''}>${esc(itemLabel(v))}</option>` : ''; }).join('')}</select></div></div>`;
    if (g.k === 'accessories') top = `<div class="row2">${inp('g-label', 'Step name', G.label)}${inp('g-title', 'Heading', G.title)}</div>${inp('g-help', 'Note under the heading', G.help)}${inp('g-max', 'Max selections', G.max || '', 'Empty for no limit.', 'number')}`;
    box.innerHTML = top + `<table class="vals"><thead><tr><th></th><th></th><th>Value</th><th>Help text</th><th>Badge</th><th>Price</th><th>Show</th><th></th></tr></thead><tbody>
      ${list.map((gid, i) => { const v = A.variants[gid]; if (!v) return `<tr data-i="${i}"><td class="h">&#8942;&#8942;</td><td></td><td colspan="5" class="vn">Variant ${num(gid)} no longer exists</td><td><button class="ic" data-rm="${i}" aria-label="Remove">&#128465;</button></td></tr>`;
        const o = s.config.items[v.id] || {}; const pr = A.prices[v.gid] != null ? A.prices[v.gid] : v.price;
        return `<tr data-i="${i}" draggable="true" class="${o.hidden ? 'hid' : ''}"><td class="h" title="Drag to reorder">&#8942;&#8942;</td><td>${v.image ? `<img src="${esc(v.image)}" alt="">` : ''}</td>
          <td><input type="text" data-lb="${v.id}" value="${esc(o.label || '')}" placeholder="${esc(v.title === 'Default Title' ? v.product.title : v.title)}"><div class="vn" title="${esc(v.product ? v.product.title + ' · ' + v.title : v.title)}">${esc(v.product ? v.product.title : '')}${v.available ? '' : ' · sold out'}</div></td>
          <td><input type="text" data-hp="${v.id}" value="${esc(o.help || '')}" placeholder="Help text"></td><td><input type="text" data-bd="${v.id}" value="${esc(o.badge || '')}" placeholder="e.g. Presale Exclusive" style="width:130px"></td>
          <td><input type="number" class="price" step="0.01" min="0" data-pr="${esc(v.gid)}" value="${(pr / 100).toFixed(2)}"></td>
          <td><label class="switch"><input type="checkbox" data-sh="${v.id}" ${o.hidden ? '' : 'checked'}></label></td>
          <td><button class="ic" data-up="${i}" aria-label="Move up">&#9650;</button><button class="ic" data-rm="${i}" aria-label="Remove">&#128465;</button></td></tr>`; }).join('')}
      ${list.length ? '' : '<tr><td colspan="8" class="empty">No values yet.</td></tr>'}</tbody></table>
      <button class="btn sm" data-add>+ Add values</button> <span class="help" style="color:#616161;font-size:12px">Pick product variants. New variants of these products are not added automatically here; add them with this button.</span>`;
    ['label', 'title', 'help', 'step', 'noneLabel'].forEach((k) => bind('g-' + k, k));
    bind('g-multiple', 'multiple'); bind('g-allowNone', 'allowNone'); bind('g-max', 'max', (v) => Math.max(0, parseInt(v, 10) || 0)); bind('g-default', 'default');
    const item = (id) => (s.config.items[id] = s.config.items[id] || {});
    $$('[data-lb]', box).forEach((e) => { e.oninput = () => { item(e.dataset.lb).label = e.value; markDirty(); }; });
    $$('[data-hp]', box).forEach((e) => { e.oninput = () => { item(e.dataset.hp).help = e.value; markDirty(); }; });
    $$('[data-bd]', box).forEach((e) => { e.oninput = () => { item(e.dataset.bd).badge = e.value; markDirty(); }; });
    $$('[data-sh]', box).forEach((e) => { e.onchange = () => { item(e.dataset.sh).hidden = !e.checked; e.closest('tr').classList.toggle('hid', !e.checked); refreshHead(g); markDirty(); }; });
    $$('[data-pr]', box).forEach((e) => { e.oninput = () => { const v = A.variants[e.dataset.pr], c = cents(e.value); if (c === v.price) delete A.prices[v.gid]; else A.prices[v.gid] = c; refreshHead(g); markDirty(); }; });
    $$('[data-rm]', box).forEach((e) => { e.onclick = () => { list.splice(+e.dataset.rm, 1); renderGroup(g, box); refreshHead(g); markDirty(); }; });
    $$('[data-up]', box).forEach((e) => { e.onclick = () => { const i = +e.dataset.up; if (i < 1) return; [list[i - 1], list[i]] = [list[i], list[i - 1]]; renderGroup(g, box); markDirty(); }; });
    box.querySelector('[data-add]').onclick = () => addValues(g, box);
    // drag to reorder
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

  /* ---------- preview: the real builder with the unsaved settings ---------- */
  let pvT = null;
  function schedulePreview() { clearTimeout(pvT); pvT = setTimeout(renderPreview, 450); }
  function previewConfig() {
    const s = A.set, g = A.grinders[0], b = s.builder, P = window.ZBA_PREVIEW || {};
    const priceOf = (v) => (A.prices[v.gid] != null ? A.prices[v.gid] : v.price);
    const vs = (k) => (s.lists[k] || []).map((gid) => A.variants[gid]).filter(Boolean);
    const burrAsset = (v) => `${P.base || 'preview'}/${b}/burr-${slug(v.title)}.png`;
    return {
      blockId: 'preview', model: b, preview: true, os: s.config,
      settings: { heading: s.config.heading, intro: '', includedNote: '', afterAdd: 'stay', accentCrop: 0.7, capCrop: 0.66, capOptional: true, finishText: '', finishSwatches: '', hideFinishes: '', hideBurrs: '', hideAccents: '', hideCaps: '', allowExtras: true, allowSpareBurrs: true, showIncluded: true, burrGuide: true },
      shop: { currency: 'USD', locale: 'en-US', cartAddUrl: '#', cartUrl: '#', rootUrl: '/' },
      guideJs: `${P.base || 'preview'}/burr-guide.js`, guideCss: `${P.base || 'preview'}/burr-guide.css`, guideData: A.guideSaved,
      geom: (P.geom || {})[b] || null, art: (P.art || {})[b] || {},
      grinder: g ? { id: num(g.id), title: g.title, options: g.options.map((o) => ({ name: o.name, values: o.values })),
        variants: g.variants.nodes.map(toVariant).map((v) => ({ id: v.id, title: v.title, options: (g.variants.nodes.find((x) => x.id === v.gid).selectedOptions || []).map((o) => o.value), price: v.price, available: v.available, blurb: null, image: v.image })) }
        : { id: 1, title: `Zerno ${BUILDERS[b].name}`, options: [{ name: 'Color', values: ['Jet Black', 'Soft White'] }], variants: [{ id: 1, title: 'Jet Black', options: ['Jet Black'], price: 0, available: true }, { id: 2, title: 'Soft White', options: ['Soft White'], price: 0, available: true }] },
      burrs: vs('burrs').map((v) => ({ id: v.id, title: v.title, short: null, price: priceOf(v), available: v.available, flat: null, flatAsset: burrAsset(v), image: v.image })),
      accents: vs('accents').map((v) => ({ id: v.id, title: v.title, price: priceOf(v), available: v.available, image: v.image })),
      caps: vs('caps').map((v) => ({ id: v.id, title: v.title, price: priceOf(v), available: v.available, image: v.image })),
      included: [{ name: 'Magnetic dosing cup', image: `${P.base || 'preview'}/incl-cup.png`, slot: 'on-grinder' }, { name: 'Magnetic burr removal tools', image: `${P.base || 'preview'}/incl-tools.png`, slot: 'tools' }, { name: 'Cleaning brush', image: `${P.base || 'preview'}/incl-brush.png`, slot: 'brush' }, { name: 'RDT spray bottle', image: `${P.base || 'preview'}/incl-spray.png`, slot: 'spray' }],
      accessories: vs('accessories').map((v) => ({ productId: v.product ? v.product.id : v.id, handle: v.product && v.product.handle, title: v.product ? v.product.title : v.title, blurb: '', variantId: v.id, variantTitle: v.title, price: priceOf(v), available: v.available, image: (v.product && v.product.image) || v.image, stage: null, stageAsset: `${P.base || 'preview'}/acc-${v.product && v.product.handle}.png` }))
    };
  }
  function renderPreview() {
    const box = $('#preview'); if (!box || !A.set) return;
    document.querySelectorAll('.zb-bar').forEach((b) => { if (!box.contains(b)) b.remove(); });
    const C = previewConfig();
    box.innerHTML = `<div class="zb" data-zb-root style="--zb-sticky:0px"><script type="application/json" data-zb-config>${JSON.stringify(C).replace(/</g, '\\u003c')}</script></div>`;
    if (window.ZernoBuilderBoot) window.ZernoBuilderBoot(box);
  }

  /* ---------- save ---------- */
  function fieldsOf(s) {
    return [
      { key: 'title', value: s.title || 'Option set' }, { key: 'builder', value: s.builder }, { key: 'active', value: String(!!s.active) },
      { key: 'products', value: JSON.stringify(s.products) },
      ...Object.entries(FIELD).map(([k, f]) => ({ key: f, value: JSON.stringify(s.lists[k] || []) })),
      { key: 'config', value: JSON.stringify(s.config) }
    ];
  }
  async function save() {
    const s = A.set, btns = $$('#save, #sb-save'); btns.forEach((b) => { b.disabled = true; });
    try {
      // prices first: they change the real Shopify variants
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
          { m: { type: '$app:option_set', handle: `${s.handle}-${Date.now().toString(36)}`, fields: fieldsOf(s) } })).metaobjectCreate);
        s.id = r.metaobject.id; s.handle = r.metaobject.handle;
        const d = $('#del'); if (!d) { const b = document.createElement('button'); b.className = 'btn danger'; b.id = 'del'; b.textContent = 'Delete'; b.onclick = del; $('#save').before(b); }
      }
      A.saved = clone(s); clean(); toast('Saved. The store updates within a minute.');
    } catch (e) { toast('Not saved: ' + e.message, true); } finally { btns.forEach((b) => { b.disabled = false; }); }
  }
  async function del() {
    if (!A.set.id || !confirm('Delete this option set? The builder goes back to its block settings.')) return;
    try { userErr((await gql(`mutation D($id:ID!){ metaobjectDelete(id:$id){ userErrors { message } } }`, { id: A.set.id })).metaobjectDelete); toast('Option set deleted'); showList(); } catch (e) { toast(e.message, true); }
  }
  function discard() { if (A.view === 'edit') { A.set = clone(A.saved); A.prices = {}; clean(); renderEditor(); } else if (A.view === 'guide') { A.guide = clone(A.guideSaved || {}); clean(); showGuide(); } }

  /* ---------- burr guide tuning ---------- */
  async function showGuide() {
    A.view = 'guide'; A.tab = 'guide';
    const body = $('#tabbody'); body.innerHTML = '<div class="card"><span class="spin"></span> Loading…</div>';
    try {
      const d = await gql(`{ metaobjectByHandle(handle:{type:"$app:burr_guide", handle:"main"}){ id fields { key value } } }`);
      A.guideSaved = d.metaobjectByHandle ? parse(field(d.metaobjectByHandle, 'data'), {}) : {};
    } catch (e) { body.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
    A.guide = clone(A.guideSaved || {}); A.gk = A.gk || 'z2';
    const D = window.ZBG_DEFAULTS;
    if (!D) { body.innerHTML = '<div class="err">The burr guide data did not load.</div>'; return; }
    const draw = () => {
      const gk = A.gk, base = D.G[gk], o = ((A.guide.G || {})[gk] || {}).burrs || {};
      const val = (b, path) => { let x = o[b.k]; for (const p of path) x = x && x[p]; if (x !== undefined) return x; x = b; for (const p of path) x = x && x[p]; return x; };
      body.innerHTML = `<div class="card"><h2>Burr guide</h2><p class="sub">Tune how the Burr Guide ranks burrs. Fit scores run 0 to 3 (method counts most, then taste, then roast). Processed and forgiving are bonuses or penalties, usually -3 to 2. Changes apply to the Burr Guide page and to "Help me choose" in both builders.</p>
        <div class="tabs" style="margin-bottom:12px">${['z2', 'z1'].map((k) => `<button data-gk="${k}" aria-selected="${gk === k}">${D.G[k].name} · ${D.G[k].mm}</button>`).join('')}</div>
        ${base.burrs.map((b) => `<div class="bcard" data-b="${b.k}"><h3><span>${esc(b.t)} <span class="badge">${esc(b.s)}</span></span><label class="switch">Show <input type="checkbox" data-hide ${val(b, ['hidden']) ? '' : 'checked'}></label></h3>
          <h4>Brew method fit</h4><div class="fitg">${['espresso', 'filter', 'both', 'turbo'].map((m) => `<label>${m === 'filter' ? 'pour over' : m}<input type="number" step="0.5" min="0" max="3" data-p="fit.m.${m}" value="${val(b, ['fit', 'm', m])}"></label>`).join('')}</div>
          <h4>Taste and roast fit</h4><div class="fitg">${['clarity', 'sweet', 'body'].map((m) => `<label>${m === 'sweet' ? 'sweetness' : m}<input type="number" step="0.5" min="0" max="3" data-p="fit.t.${m}" value="${val(b, ['fit', 't', m])}"></label>`).join('')}<span></span>${['light', 'medium', 'dark'].map((m) => `<label>${m} roast<input type="number" step="0.5" min="0" max="3" data-p="fit.r.${m}" value="${val(b, ['fit', 'r', m])}"></label>`).join('')}<span></span>
            <label>processed coffees<input type="number" step="0.5" min="-4" max="3" data-p="fit.processed" value="${val(b, ['fit', 'processed'])}"></label><label>easy dial-in<input type="number" step="0.5" min="-4" max="3" data-p="fit.forgiving" value="${val(b, ['fit', 'forgiving'])}"></label></div>
          <h4>Copy</h4><div class="field"><label>Summary</label><textarea data-p="sum">${esc(val(b, ['sum']))}</textarea></div>
          <div class="field"><label>"Choose it if…"</label><input type="text" data-p="pick" value="${esc(val(b, ['pick']))}"></div></div>`).join('')}
        <button class="btn" id="greset">Reset ${D.G[gk].name} to the original tuning</button></div>`;
      $$('[data-gk]', body).forEach((b) => { b.onclick = () => { A.gk = b.dataset.gk; draw(); }; });
      const setP = (bk, path, v) => {
        A.guide.G = A.guide.G || {}; A.guide.G[gk] = A.guide.G[gk] || {}; A.guide.G[gk].burrs = A.guide.G[gk].burrs || {};
        let x = A.guide.G[gk].burrs[bk] = A.guide.G[gk].burrs[bk] || {};
        path.slice(0, -1).forEach((p) => { x = x[p] = x[p] || {}; }); x[path[path.length - 1]] = v; markDirty();
      };
      $$('.bcard', body).forEach((c) => {
        const bk = c.dataset.b;
        $$('[data-p]', c).forEach((e) => { e.oninput = () => setP(bk, e.dataset.p.split('.'), e.type === 'number' ? parseFloat(e.value) || 0 : e.value); });
        c.querySelector('[data-hide]').onchange = (e) => setP(bk, ['hidden'], !e.target.checked);
      });
      $('#greset', body).onclick = () => { if (A.guide.G) delete A.guide.G[gk]; markDirty(); draw(); };
    };
    draw();
  }
  async function saveGuide() {
    try {
      userErr((await gql(`mutation G($h:MetaobjectHandleInput!,$m:MetaobjectUpsertInput!){ metaobjectUpsert(handle:$h, metaobject:$m){ metaobject { id } userErrors { message } } }`,
        { h: { type: '$app:burr_guide', handle: 'main' }, m: { fields: [{ key: 'data', value: JSON.stringify(A.guide || {}) }] } })).metaobjectUpsert);
      A.guideSaved = clone(A.guide); clean(); toast('Burr guide saved');
    } catch (e) { toast('Not saved: ' + e.message, true); }
  }
  function showHelp() {
    $('#tabbody').innerHTML = `<div class="card"><h2>How it works</h2>
      <p>The store has three Zerno Builder blocks: <b>Z2 Builder</b>, <b>Z1 Builder</b> and <b>Burr Guide</b>. Add them in the theme editor under Apps.</p>
      <p><b>Option sets</b> work like Globo. Each builder uses the active option set assigned to its grinder: the burrs, woods, caps and accessories it offers, their order, labels, help text and badges, the rules (required, spares and extras, max selections, defaults) and the text on each step. Without one, a builder uses its block settings.</p>
      <p><b>Prices</b> are the Shopify variant prices. Changing a price here changes the variant in Shopify, everywhere it is sold.</p>
      <p><b>Burr guide</b> tuning changes how burrs are ranked on the Burr Guide page and in "Help me choose" inside both builders.</p>
      <p>Changes show on the store within about a minute of saving. Nothing here changes the theme code.</p></div>`;
  }

  /* ---------- boot ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    $('#sb-save').onclick = () => (A.view === 'guide' ? saveGuide() : save());
    $('#sb-discard').onclick = discard;
    window.addEventListener('beforeunload', (e) => { if (A.dirty) { e.preventDefault(); e.returnValue = ''; } });
    showList();
  });
  window.ZBA = A;
})();
