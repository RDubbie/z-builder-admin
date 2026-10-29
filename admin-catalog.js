/* Zerno Builder admin: Catalog (grinders, burr sizes, burrs, accessories, textures), the Art studio page and Burr guides.
 * Everything here edits one working copy of the catalog (ZBA.cat). Save writes it to the $app:catalog metaobject "main".
 */
(() => {
  const Z = window.ZBAdmin, A = Z.A, { $, $$, esc, num, clone, toast, inp, chk, spin, errBox, head, body } = Z;
  const Cat = window.ZernoCatalog;
  const SUBS = [['grinders', 'Grinders'], ['sizes', 'Burr sizes'], ['burrs', 'Burrs'], ['accessories', 'Accessories'], ['textures', 'Textures']];
  const SLOTS = [['', 'Listed only'], ['on-grinder', 'On the grinder'], ['tools', 'Tools'], ['brush', 'Brush'], ['spray', 'Spray bottle']];
  const keyOk = (k) => /^[a-z0-9][a-z0-9-]{0,30}$/.test(k);

  /* ---------- path helpers and a small form binder ---------- */
  const getP = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
  const setP = (o, p, v) => { const ks = p.split('.'); let x = o; ks.slice(0, -1).forEach((k) => { if (x[k] == null || typeof x[k] !== 'object') x[k] = {}; x = x[k]; }); x[ks[ks.length - 1]] = v; };
  const lines = (obj) => Object.entries(obj || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
  const unlines = (s) => Object.fromEntries(String(s || '').split('\n').map((l) => l.split(':')).filter((p) => p.length > 1 && p[0].trim()).map(([k, ...v]) => [Cat.slug(k.trim()), v.join(':').trim()]));
  const f = (path, label, obj, o = {}) => {
    const v = getP(obj, path), id = 'c-' + path.replace(/\./g, '-');
    const help = o.help ? `<span class="help">${o.help}</span>` : '';
    if (o.type === 'textarea') return `<div class="field"><label for="${id}">${label}</label><textarea id="${id}" data-k="${path}" rows="${o.rows || 3}">${esc(v || '')}</textarea>${help}</div>`;
    if (o.type === 'lines') return `<div class="field"><label for="${id}">${label}</label><textarea id="${id}" data-k="${path}" data-type="lines" rows="${o.rows || 2}" placeholder="${esc(o.ph || '')}">${esc(lines(v))}</textarea>${help}</div>`;
    if (o.type === 'select') return `<div class="field"><label for="${id}">${label}</label><select id="${id}" data-k="${path}">${o.options.map(([k, n]) => `<option value="${esc(k)}" ${String(v == null ? '' : v) === String(k) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>${help}</div>`;
    if (o.type === 'checkbox') return `<label class="check"><input type="checkbox" id="${id}" data-k="${path}" ${o.invert ? (v ? '' : 'checked') : (v ? 'checked' : '')} ${o.invert ? 'data-invert' : ''}><span>${label}${o.help ? `<small>${o.help}</small>` : ''}</span></label>`;
    if (o.type === 'list') return `<div class="field"><label for="${id}">${label}</label><div class="inrow"><input type="text" id="${id}" data-k="${path}" data-type="list" value="${esc((v || []).join(', '))}" placeholder="${esc(o.ph || 'product-handle, another-handle')}">${o.pick ? `<button class="btn sm" data-pick="${path}" data-pt="${o.pick}">Choose</button>` : ''}</div>${help}</div>`;
    if (o.type === 'number') return `<div class="field"><label for="${id}">${label}</label><input type="number" id="${id}" data-k="${path}" data-type="number" step="${o.step || 'any'}" value="${v == null ? '' : esc(v)}">${help}</div>`;
    return `<div class="field"><label for="${id}">${label}</label><div class="inrow"><input type="text" id="${id}" data-k="${path}" value="${esc(v == null ? '' : v)}" ${o.ro ? 'readonly' : ''} placeholder="${esc(o.ph || '')}">${o.pick ? `<button class="btn sm" data-pick="${path}" data-pt="${o.pick}">Choose</button>` : ''}</div>${help}</div>`;
  };
  function bind(box, obj, after) {
    $$('[data-k]', box).forEach((el) => {
      const path = el.dataset.k, t = el.dataset.type;
      el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
        let v = el.type === 'checkbox' ? (el.hasAttribute('data-invert') ? !el.checked : el.checked) : el.value;
        if (t === 'number') v = el.value === '' ? null : parseFloat(el.value);
        if (t === 'list') v = el.value.split(',').map((x) => x.trim()).filter(Boolean);
        if (t === 'lines') v = unlines(el.value);
        setP(obj, path, v); Z.markDirty(); if (after) after(path, v);
      });
    });
    $$('[data-pick]', box).forEach((b) => {
      b.onclick = async () => {
        if (!window.shopify || !shopify.resourcePicker) return toast('Open this page inside Shopify admin to pick products.', true);
        const multi = b.dataset.pt === 'products', path = b.dataset.pick;
        const sel = await shopify.resourcePicker({ type: b.dataset.pt === 'variant' ? 'variant' : 'product', multiple: multi });
        if (!sel || !sel.length) return;
        if (b.dataset.pt === 'variant') setP(obj, path, sel[0].id);
        else {
          const handles = sel.map((p) => p.handle).filter(Boolean);
          const hs = handles.length === sel.length ? handles : await gqlHandles(sel.map((p) => p.id));
          setP(obj, path, multi ? [...new Set([...(getP(obj, path) || []), ...hs])] : hs[0]);
        }
        Z.markDirty(); render();
      };
    });
  }
  async function gqlHandles(ids) { const d = await Z.gql(`query H($ids:[ID!]!){ nodes(ids:$ids){ ... on Product { handle } } }`, { ids }); return d.nodes.filter(Boolean).map((n) => n.handle); }
  function uploadBtn(path, label = 'Upload') { return `<span class="upbtns"><label class="btn sm upl">${label}<input type="file" accept="image/png,image/jpeg,image/webp" data-up="${path}" hidden></label><button type="button" class="btn sm" data-pickf="${path}">Shopify Files</button><button type="button" class="btn sm" data-cutp="${path}">Cut out</button></span>`; }
  function bindUploads(box, obj) {
    $$('[data-up]', box).forEach((el) => {
      el.onchange = async () => {
        const file = el.files[0]; if (!file) return;
        const lab = el.parentElement; lab.classList.add('busy'); lab.firstChild.textContent = 'Uploading…';
        try { setP(obj, el.dataset.up, await Z.uploadImage(file, file.name)); Z.markDirty(); toast('Image uploaded'); render(); }
        catch (e) { toast(e.message, true); lab.classList.remove('busy'); lab.firstChild.textContent = 'Upload'; }
      };
    });
    $$('[data-pickf]', box).forEach((b) => { b.onclick = async () => { const url = await Z.pickFile(); if (!url) return; setP(obj, b.dataset.pickf, url); Z.markDirty(); render(); }; });
    $$('[data-cutp]', box).forEach((b) => { b.onclick = () => { const cur = getP(obj, b.dataset.cutp), here = SUB;
      cutoutPage({ title: obj.name || obj.product || 'Photo', image: cur ? Cat.asset('preview/', cur) : null, back: () => { SUB = here; render(); }, done: (url) => setP(obj, b.dataset.cutp, url) }); }; });
  }
  const img = (u) => (u ? `<img class="th" src="${esc(Cat.asset('preview/', u))}" alt="">` : '<span class="th none"></span>');

  /* ---------- catalog page frame ---------- */
  let SUB = 'grinders';
  function nav(sub) { SUB = sub; Z.setUrl('catalog', sub); render(); }
  async function saveCat() {
    const btns = $$('#sb-save, #csave'); btns.forEach((b) => { b.disabled = true; });
    try { await Z.saveCatalog(A.cat); A.catSaved = clone(A.cat); A.catIsSaved = true; Z.clean(); toast('Catalog saved. The store updates within a minute.'); if (typeof afterSave === 'function') afterSave(); }
    catch (e) { toast('Not saved: ' + e.message, true); } finally { btns.forEach((b) => { b.disabled = false; }); }
  }
  function discardCat() { A.cat = clone(A.catSaved); Z.clean(); render(); }
  function showCatalog(sub) {
    SUB = sub || 'grinders';
    afterSave = () => { if (A.view === 'catalog' && !/\/art$|^textures\/./.test(SUB)) render(); };
    A.onSave = saveCat; A.onDiscard = discardCat;
    render();
  }
  function render() {
    if (A.view !== 'catalog') return;
    const top = SUB.split('/')[0];
    if (top === 'grinders' && SUB.endsWith('/art')) return artPage(SUB.split('/')[1]);
    if (top === 'textures' && SUB.split('/')[1]) return texturePage(SUB.split('/')[1]);
    body().innerHTML = head('Catalog', 'Everything the builders and the Burr Guide know about your grinders, burrs and accessories. Add a grinder, burr size or burr here and the store picks it up. No code.',
      `${A.catIsSaved ? '' : '<span class="badge warn">Using the built-in catalog</span>'}<button class="btn" id="creset">Reset to built-in</button><button class="btn primary" id="csave">Save catalog</button>`) +
      `<div class="tabs" role="tablist">${SUBS.map(([k, n]) => `<button role="tab" data-s="${k}" aria-selected="${top === k}">${n}</button>`).join('')}</div><div id="cbody"></div>`;
    $$('[data-s]').forEach((b) => { b.onclick = () => nav(b.dataset.s); });
    $('#csave').onclick = saveCat;
    $('#creset').onclick = () => { if (!confirm('Replace the working catalog with the built-in one? Your saved catalog stays until you save.')) return; A.cat = clone(Cat.get(null)); Z.markDirty(); render(); };
    const [, id, extra] = SUB.split('/');
    ({ grinders: id ? grinderForm : grinderList, sizes: id ? sizeForm : sizeList, burrs: extra ? burrForm : burrList, accessories: id ? accForm : accList, textures: textureList })[top](id, extra);
  }
  const cbody = () => $('#cbody');
  const backTo = (sub, label) => `<button class="btn plain" data-back="${sub}">&larr; ${label}</button>`;
  const bindBack = () => $$('[data-back]').forEach((b) => { b.onclick = () => nav(b.dataset.back); });

  /* ---------- grinders ---------- */
  function artStatus(g) {
    if (!g.art) return '<span class="badge">Photo mode</span>';
    if (g.art.source === 'builtin') return '<span class="badge on">Layered art (built in)</span>';
    return `<span class="badge on">Layered art · ${Object.keys(g.art.finishes || {}).length} colors</span>`;
  }
  function grinderList() {
    const C = A.cat;
    cbody().innerHTML = `<div class="card flush"><table class="list"><thead><tr><th>Grinder</th><th>Product</th><th>Burr size</th><th>Art</th><th>Burr Guide</th></tr></thead><tbody>
      ${C.grinders.map((g) => `<tr class="clk" data-g="${esc(g.key)}"><td><b>${esc(g.name)}</b><div class="muted">${esc(g.key)}</div></td><td>${esc(g.product || '')}</td><td>${esc(g.size)}</td><td>${artStatus(g)}</td><td>${g.guide && g.guide.show === false ? 'Hidden' : 'Shown'}</td></tr>`).join('')}
      </tbody></table></div><button class="btn primary" id="addg">Add grinder</button>`;
    $$('tr[data-g]').forEach((tr) => { tr.onclick = () => nav('grinders/' + tr.dataset.g); });
    $('#addg').onclick = () => {
      const key = (prompt('Short key for the new grinder, such as z3. Lowercase letters, numbers and dashes.') || '').trim().toLowerCase();
      if (!key) return; if (!keyOk(key) || C.grinders.some((g) => g.key === key)) return toast('Use a new key with lowercase letters, numbers and dashes.', true);
      const size = C.sizes[0];
      C.grinders.push({ key, name: `Zerno ${key.toUpperCase()}`, product: `zerno-${key}`, size: size ? size.key : '', buildPrefix: key.toUpperCase(), heading: '', handles: { burrs: size ? [...(size.products || [])] : [], accents: [], caps: [], accessories: [] }, accessoryMatch: '', finishText: {}, finishSwatch: {}, included: [], installed: null, art: null, geom: null, guide: { show: true, desc: '' } });
      Z.markDirty(); nav('grinders/' + key);
    };
  }
  function grinderForm(key) {
    const C = A.cat, g = C.grinders.find((x) => x.key === key);
    if (!g) return nav('grinders');
    g.handles = g.handles || { burrs: [], accents: [], caps: [], accessories: [] };
    g.included = g.included || [];
    cbody().innerHTML = `${backTo('grinders', 'Grinders')}<div class="grid"><div>
      <div class="card"><h2>${esc(g.name)}</h2>
        <div class="row2">${f('key', 'Key', g, { ro: true, help: 'Used in links (#' + esc(g.key) + ') and option sets.' })}${f('name', 'Name', g)}</div>
        <div class="row2">${f('product', 'Product handle', g, { pick: 'product', help: 'The grinder\'s product in Shopify.' })}${f('size', 'Burr size', g, { type: 'select', options: C.sizes.map((s) => [s.key, s.name]) })}</div>
        <div class="row2">${f('buildPrefix', 'Build number prefix', g, { help: 'Build numbers look like ' + esc(g.buildPrefix || 'Z') + '-K3P9QX.' })}${f('heading', 'Builder heading', g, { ph: 'Build your ' + esc(Z.shortName(g)) })}</div></div>
      <div class="card"><h2>Products the builder offers</h2><p class="sub">Used until an option set takes over, and as the starting point for new option sets.</p>
        ${f('handles.burrs', 'Burr products', g, { type: 'list', pick: 'products' })}${f('handles.accents', 'Accent piece products', g, { type: 'list', pick: 'products' })}
        ${f('handles.caps', 'Funnel cap products', g, { type: 'list', pick: 'products' })}${f('handles.accessories', 'Accessory products', g, { type: 'list', pick: 'products' })}
        ${f('accessoryMatch', 'Accessory variant to use', g, { help: 'For accessories with a variant per grinder, the variant whose name contains this text.' })}</div>
      <div class="card"><h2>Colors</h2>${f('finishText', 'Line under each color', g, { type: 'lines', ph: 'soft-white: Soft white Cerakote' })}${f('finishSwatch', 'Swatch colors', g, { type: 'lines', ph: 'jet-black: #141517' })}</div>
    </div><div>
      <div class="card"><h2>Art</h2><p>${artStatus(g)}</p><p class="sub">${g.art ? 'Layered art: the builder recolors the grinder and puts the chosen wood and cap on it, and the front opens to show the burrs.' : 'Photo mode: the builder shows the product\'s own photo for each color. Colors still switch, but woods and caps do not show on the grinder and nothing opens. Open the Art studio to make layered art.'}</p>
        <div class="btnrow"><button class="btn primary" id="openstudio">Open Art studio</button>${g.art ? '<button class="btn" id="noart">Switch to photo mode</button>' : g.artOff ? '<button class="btn" id="artback">Turn layered art back on</button>' : ''}</div>
        ${g.art ? '<p class="help muted">Photo mode is a safe fallback while new art is being made, or if the art looks wrong on the store. You can turn the art back on here.</p>' : ''}</div>
      <div class="card"><h2>In the box</h2><p class="sub">Shown on the accessories step. Items with a spot are drawn next to the grinder.</p>
        <table class="vals"><thead><tr><th>Photo</th><th>Name</th><th>Spot</th><th></th></tr></thead><tbody>
        ${g.included.map((x, i) => `<tr><td>${img(x.image)} ${uploadBtn(`included.${i}.image`)}</td><td><input type="text" data-k="included.${i}.name" value="${esc(x.name)}"></td>
          <td><select data-k="included.${i}.slot">${SLOTS.map(([k, n]) => `<option value="${k}" ${k === (x.slot || '') ? 'selected' : ''}>${n}</option>`).join('')}</select></td><td><button class="ic" data-rmi="${i}" aria-label="Remove">&#128465;</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nothing listed.</td></tr>'}
        </tbody></table><button class="btn sm" id="addi">+ Add item</button>
        <h3 class="h3">Pre-installed part</h3><div class="row2">${f('installed.name', 'Name', g, { ph: 'Stainless steel medium feed auger' })}${f('installed.handle', 'Product handle', g, { pick: 'product' })}</div>
        <div class="field"><label>Cut-out photo</label><div class="inrow">${img(g.installed && g.installed.image)} ${uploadBtn('installed.image')} <span class="help">A transparent PNG, like the items above. Without one the store shows the product's own photo.</span></div></div></div>
      <div class="card"><h2>Burr Guide</h2>${f('guide.show', 'Show this grinder in the Burr Guide', g, { type: 'checkbox' })}${f('guide.desc', 'Line under the grinder card', g, { type: 'textarea', rows: 2 })}</div>
      <div class="card"><button class="btn danger" id="delg">Delete grinder</button> <span class="muted">Option sets that use it stop working until you pick another grinder.</span></div>
    </div></div>`;
    bindBack(); bind(cbody(), g, (p) => { if (p === 'name') $('.card h2').textContent = g.name; }); bindUploads(cbody(), g);
    $$('[data-rmi]').forEach((b) => { b.onclick = () => { g.included.splice(+b.dataset.rmi, 1); Z.markDirty(); render(); }; });
    $('#addi').onclick = () => { g.included.push({ name: '', image: null, slot: '' }); Z.markDirty(); render(); };
    $('#openstudio').onclick = () => nav(`grinders/${g.key}/art`);
    if ($('#noart')) $('#noart').onclick = () => { g.artOff = { art: g.art, geom: g.geom }; g.art = null; g.geom = null; Z.markDirty(); render(); };
    if ($('#artback')) $('#artback').onclick = () => { g.art = g.artOff.art; g.geom = g.artOff.geom; delete g.artOff; Z.markDirty(); render(); };
    $('#delg').onclick = () => { if (!confirm(`Delete ${g.name} from the catalog?`)) return; C.grinders = C.grinders.filter((x) => x !== g); Z.markDirty(); nav('grinders'); };
  }

  /* ---------- the Art studio page ---------- */
  let studio = null;
  async function artPage(key, back) {
    const g = A.cat.grinders.find((x) => x.key === key);
    if (!g) return nav('grinders');
    back = back || (() => nav('grinders/' + key));
    afterSave = null;
    body().innerHTML = `<div class="ph" style="margin-bottom:8px"><button class="btn plain" id="back">&larr; Back to ${esc(g.name)}</button></div><div id="studio">${spin('Loading photos…').replace('class="card"', 'class="card" style="margin:0"')}</div>`;
    $('#back').onclick = () => { if (studio && studio.destroy) studio.destroy(); studio = null; back(); };
    if (!window.ZBStudio) { $('#studio').innerHTML = errBox('The Art studio did not load. Refresh the page.'); return; }
    let prods = [];
    try { prods = await Z.productsByHandles([g.product, ...(g.handles.accents || []), ...(g.handles.caps || [])]); } catch (e) { $('#studio').innerHTML = errBox(e); return; }
    const gp = prods.find((p) => p.handle === g.product);
    const finishes = [];
    if (gp) {
      const ci = Math.max(0, gp.options.findIndex((o) => /colou?r|finish/i.test(o.name)));
      const vs = gp.variants.nodes.map(Z.toVariant);
      (gp.options[ci] ? gp.options[ci].values : []).forEach((name) => {
        const v = vs.find((x) => x.options[ci] === name);
        finishes.push({ slug: Cat.slug(name), name, image: (v && v.image) || Z.pimg(gp), swatch: (g.finishSwatch || {})[Cat.slug(name)] || null });
      });
    }
    if (!finishes.length) finishes.push({ slug: 'standard', name: 'Standard', image: gp ? Z.pimg(gp) : null });
    const vlist = (hs) => prods.filter((p) => hs.includes(p.handle)).flatMap((p) => p.variants.nodes.map(Z.toVariant)).map((v) => ({ id: v.id, title: v.title === 'Default Title' ? v.product.title : v.title, image: v.image }));
    $('#studio').innerHTML = '';
    studio = window.ZBStudio.open($('#studio'), {
      catalog: A.cat, grinder: g, finishes, accents: vlist(g.handles.accents || []), caps: vlist(g.handles.caps || []), assetBase: 'preview/',
      upload: Z.uploadImage, pickFile: Z.pickFile,
      onChange: async () => { delete g.artOff; Z.markDirty(); await saveCat(); }
    });
  }

  /* ---------- burr sizes ---------- */
  function sizeList() {
    const C = A.cat;
    cbody().innerHTML = `<div class="card flush"><table class="list"><thead><tr><th>Burr size</th><th>Products</th><th>Burrs</th><th>Grinders</th></tr></thead><tbody>
      ${C.sizes.map((s) => `<tr class="clk" data-s2="${esc(s.key)}"><td><b>${esc(s.name)}</b></td><td>${esc((s.products || []).join(', '))}</td><td>${C.burrs.filter((b) => b.size === s.key && !b.hidden).length}</td><td>${esc(C.grinders.filter((g) => g.size === s.key).map((g) => g.name).join(', ') || 'None yet')}</td></tr>`).join('')}
      </tbody></table></div><button class="btn primary" id="adds">Add burr size</button>`;
    $$('tr[data-s2]').forEach((tr) => { tr.onclick = () => nav('sizes/' + tr.dataset.s2); });
    $('#adds').onclick = () => {
      const name = (prompt('Burr size, such as 98mm') || '').trim(); if (!name) return;
      const key = Cat.slug(name); if (!keyOk(key) || C.sizes.some((s) => s.key === key)) return toast('That size already exists.', true);
      C.sizes.push({ key, name, products: [], desc: '', pair: null }); Z.markDirty(); nav('sizes/' + key);
    };
  }
  function sizeForm(key) {
    const C = A.cat, s = C.sizes.find((x) => x.key === key);
    if (!s) return nav('sizes');
    const bs = C.burrs.filter((b) => b.size === key), opts = [['', 'None'], ...bs.map((b) => [b.key, b.name])];
    s.pair = s.pair || { a: '', b: '', alt: '', t: '' };
    cbody().innerHTML = `${backTo('sizes', 'Burr sizes')}<div class="grid"><div><div class="card"><h2>${esc(s.name)} burrs</h2>
        <div class="row2">${f('key', 'Key', s, { ro: true })}${f('name', 'Name', s)}</div>
        ${f('products', 'Burr products', s, { type: 'list', pick: 'products', help: 'The Burr Guide reads prices and stock from these products. Each burr in the catalog matches one variant.' })}
        ${f('desc', 'Line under the grinder card (fallback)', s, { type: 'textarea', rows: 2 })}</div></div>
      <div><div class="card"><h2>Two-set pairing</h2><p class="sub">The Burr Guide suggests this pair to customers who want dedicated espresso and pour over sets.</p>
        <div class="row3">${f('pair.a', 'Espresso set', s, { type: 'select', options: opts })}${f('pair.b', 'Pour over set', s, { type: 'select', options: opts })}${f('pair.alt', 'Alternative', s, { type: 'select', options: opts })}</div>
        ${f('pair.t', 'Why this pair', s, { type: 'textarea', rows: 2 })}</div>
        <div class="card"><h2>Burrs</h2><p class="sub">${bs.length} burrs in this size.</p><button class="btn" id="tob">Edit ${esc(s.name)} burrs</button> ${C.grinders.some((g) => g.size === key) ? '' : '<span class="muted">No grinder uses this size yet.</span>'}</div>
        <div class="card"><button class="btn danger" id="dels">Delete burr size</button></div></div></div>`;
    bindBack(); bind(cbody(), s);
    $('#tob').onclick = () => nav('burrs/' + key);
    $('#dels').onclick = () => {
      if (C.grinders.some((g) => g.size === key)) return toast('A grinder uses this size. Change the grinder first.', true);
      if (!confirm(`Delete ${s.name} and its ${bs.length} burrs from the catalog?`)) return;
      C.sizes = C.sizes.filter((x) => x !== s); C.burrs = C.burrs.filter((b) => b.size !== key); Z.markDirty(); nav('sizes');
    };
  }

  /* ---------- burrs ---------- */
  function burrList(size) {
    const C = A.cat, sz = size || (C.sizes[0] && C.sizes[0].key);
    const bs = C.burrs.filter((b) => b.size === sz);
    cbody().innerHTML = `<div class="tabs sm">${C.sizes.map((s) => `<button data-sz="${esc(s.key)}" aria-selected="${s.key === sz}">${esc(s.name)}</button>`).join('')}<button class="addtab" data-newsize>+ Burr size</button></div>
      <div class="card flush"><table class="list"><thead><tr><th></th><th>Burr</th><th>Matches</th><th>Style</th><th>Espresso</th><th>Pour over</th><th>Show</th></tr></thead><tbody>
      ${bs.map((b) => `<tr class="clk" data-b="${esc(b.key)}"><td>${img(b.image)}</td><td><b>${esc(b.name)}</b> <span class="badge">${esc(b.short || '')}</span></td><td class="muted">${b.variant ? 'Variant ' + num(b.variant) : esc(b.code ? 'Name has ' + b.code.replace(/\\/g, '') : 'Name')}</td>
        <td>${esc((b.builder || {}).style || b.style || '')}</td><td>${getP(b, 'fit.m.espresso') ?? ''}</td><td>${getP(b, 'fit.m.filter') ?? ''}</td><td>${b.hidden ? 'Hidden' : 'Shown'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No burrs in this size yet.</td></tr>'}
      </tbody></table></div><button class="btn primary" id="addb">Add burr</button>`;
    $$('[data-sz]').forEach((b) => { b.onclick = () => nav('burrs/' + b.dataset.sz); });
    $('[data-newsize]').onclick = () => { const name = (prompt('New burr size, such as 98mm') || '').trim(); if (!name) return; const key = Cat.slug(name); if (!keyOk(key) || C.sizes.some((x) => x.key === key)) return toast('That size already exists.', true); C.sizes.push({ key, name, products: [], desc: '', pair: null }); Z.markDirty(); nav('sizes/' + key); };
    $$('tr[data-b]').forEach((tr) => { tr.onclick = () => nav(`burrs/${sz}/${tr.dataset.b}`); });
    $('#addb').onclick = () => {
      const name = (prompt('Burr name, as in the variant title, such as SSP Brew') || '').trim(); if (!name) return;
      const nb = newBurr(C, sz, name, null);
      Z.markDirty(); nav(`burrs/${sz}/${nb.key}`);
    };
  }
  function burrForm(size, key) {
    const C = A.cat, b = C.burrs.find((x) => x.size === size && x.key === key);
    if (!b) return nav('burrs/' + size);
    const sc = (p, l) => f(p, l, b, { type: 'number', step: '0.5' });
    cbody().innerHTML = `${backTo('burrs/' + size, size + ' burrs')}<div class="grid"><div>
      <div class="card"><h2>${esc(b.name)}</h2>${f('hidden', 'Show this burr', b, { type: 'checkbox', invert: true })}
        <div class="row2">${f('name', 'Name', b)}${f('short', 'Short name', b, { help: 'On the burr arc and chips.' })}</div>
        <div class="row2">${f('size', 'Burr size', b, { type: 'select', options: C.sizes.map((s) => [s.key, s.name]) })}${f('key', 'Key', b, { ro: true })}</div>
        <div class="row2">${f('variant', 'Shopify variant', b, { pick: 'variant', help: 'Best match. Leave empty to match by name.' })}${f('code', 'Or match variant names containing', b, { help: 'A pattern, such as \\(UMV1\\).' })}</div>
        <div class="field"><label>Cut-out photo</label><div class="inrow">${img(b.image)} ${uploadBtn('image')} <span class="help">A transparent PNG, burr seen from above. Without one the store shows a stand-in ring.</span></div></div></div>
      <div class="card"><h2>In the builder</h2><div class="row2">${f('builder.style', 'Best for', b)}${f('builder.taste', 'Taste', b)}</div><div class="row2">${f('builder.roast', 'Roasts', b)}${f('builder.coating', 'Coating', b)}</div></div>
    </div><div>
      <div class="card"><h2>Burr Guide fit</h2><p class="sub">Scores run 0 to 3. Brew method counts most, then taste, then roast. Processed and easy dial-in are bonuses or penalties, usually -3 to 2.</p>
        <h4 class="h4">Brew method</h4><div class="fitg">${sc('fit.m.espresso', 'espresso')}${sc('fit.m.filter', 'pour over')}${sc('fit.m.both', 'both')}${sc('fit.m.turbo', 'turbo')}</div>
        <h4 class="h4">Taste</h4><div class="fitg">${sc('fit.t.clarity', 'clarity')}${sc('fit.t.sweet', 'sweetness')}${sc('fit.t.body', 'body')}</div>
        <h4 class="h4">Roast and extras</h4><div class="fitg">${sc('fit.r.light', 'light')}${sc('fit.r.medium', 'medium')}${sc('fit.r.dark', 'dark')}<span></span>${sc('fit.processed', 'processed coffees')}${sc('fit.forgiving', 'easy dial-in')}</div></div>
      <div class="card"><h2>Burr Guide copy</h2>${f('sum', 'Summary', b, { type: 'textarea' })}${f('pick', '"Choose it if you…"', b)}${f('warn', 'Heads up (optional)', b)}
        <div class="row3">${f('style', 'Style tag', b)}${f('roast', 'Roast tag', b)}${f('coat', 'Coating tag', b)}</div>
        <details><summary>Why it fits each answer</summary>${['espresso', 'filter', 'both', 'turbo'].map((k) => f('m.' + k, 'Method: ' + (k === 'filter' ? 'pour over' : k), b, { type: 'textarea', rows: 2 })).join('')}
          ${['clarity', 'sweet', 'body'].map((k) => f('tp.' + k, 'Taste: ' + k, b, { type: 'textarea', rows: 2 })).join('')}${['light', 'medium', 'dark'].map((k) => f('r.' + k, 'Roast: ' + k, b, { type: 'textarea', rows: 2 })).join('')}</details></div>
      <div class="card"><button class="btn danger" id="delb">Delete burr</button></div>
    </div></div>`;
    bindBack(); bind(cbody(), b); bindUploads(cbody(), b);
    $('#delb').onclick = () => { if (!confirm(`Delete ${b.name}?`)) return; C.burrs = C.burrs.filter((x) => x !== b); Z.markDirty(); nav('burrs/' + size); };
  }

  /* ---------- accessories ---------- */
  function accList() {
    const C = A.cat;
    cbody().innerHTML = `<div class="card flush"><table class="list"><thead><tr><th></th><th>Product</th><th>Fits</th><th>Pick one group</th><th>Line in the builder</th></tr></thead><tbody>
      ${C.accessories.map((a, i) => `<tr class="clk" data-a="${i}"><td>${img(a.stage)}</td><td><b>${esc(a.product)}</b></td><td>${(a.fits && a.fits.length ? a.fits : ['Every grinder']).map(esc).join(', ')}</td><td>${esc(a.group || '')}</td><td class="muted">${esc(a.blurb || '')}</td></tr>`).join('')}
      </tbody></table></div><button class="btn primary" id="adda">Add accessory</button>`;
    $$('tr[data-a]').forEach((tr) => { tr.onclick = () => nav('accessories/' + tr.dataset.a); });
    $('#adda').onclick = () => { C.accessories.push({ product: '', fits: [], group: '', blurb: '', stage: null }); Z.markDirty(); nav('accessories/' + (C.accessories.length - 1)); };
  }
  function accForm(i) {
    const C = A.cat, a = C.accessories[+i];
    if (!a) return nav('accessories');
    a.fits = a.fits || [];
    cbody().innerHTML = `${backTo('accessories', 'Accessories')}<div class="card" style="max-width:760px"><h2>${esc(a.product || 'New accessory')}</h2>
      ${f('product', 'Product handle', a, { pick: 'product' })}
      <div class="field"><label>Fits</label><div class="chips">${C.grinders.map((g) => `<label class="check" style="margin:0 12px 0 0"><input type="checkbox" data-fit="${esc(g.key)}" ${a.fits.includes(g.key) ? 'checked' : ''}><span>${esc(g.name)}</span></label>`).join('')}</div><span class="help">None checked means it fits every grinder.</span></div>
      <div class="row2">${f('group', 'Pick one group', a, { help: 'Accessories with the same group replace each other, like the two slow feed augers.' })}${f('blurb', 'Line in the builder', a, { help: 'The product\'s builder_blurb metafield wins over this.' })}</div>
      <div class="field"><label>Photo next to the grinder</label><div class="inrow">${img(a.stage)} ${uploadBtn('stage')} <span class="help">A transparent PNG of the accessory.</span></div></div>
      <button class="btn danger" id="dela">Delete accessory</button></div>`;
    bindBack(); bind(cbody(), a); bindUploads(cbody(), a);
    $$('[data-fit]').forEach((c) => { c.onchange = () => { a.fits = $$('[data-fit]').filter((x) => x.checked).map((x) => x.dataset.fit); Z.markDirty(); }; });
    $('#dela').onclick = () => { if (!confirm('Delete this accessory from the catalog?')) return; C.accessories.splice(+i, 1); Z.markDirty(); nav('accessories'); };
  }

  /* ---------- textures: which part of an accent or cap photo becomes the wood or metal ---------- */
  let texItems = null;
  async function loadTexItems() {
    const C = A.cat, acc = [...new Set(C.grinders.flatMap((g) => (g.handles && g.handles.accents) || []))], caps = [...new Set(C.grinders.flatMap((g) => (g.handles && g.handles.caps) || []))];
    const prods = await Z.productsByHandles([...acc, ...caps]);
    texItems = prods.flatMap((p) => p.variants.nodes.map(Z.toVariant).map((v) => ({ id: v.id, title: v.title === 'Default Title' ? p.title : v.title, product: p.title, image: v.image, kind: caps.includes(p.handle) && !acc.includes(p.handle) ? 'cap' : 'accent' })));
    return texItems;
  }
  async function textureList() {
    cbody().innerHTML = spin('Loading accent pieces and funnel caps…');
    let items; try { items = await loadTexItems(); } catch (e) { cbody().innerHTML = errBox(e); return; }
    const T = A.cat.textures || {};
    const row = (x) => `<tr class="clk" data-t="${x.id}"><td>${x.image ? `<img class="th" src="${esc(x.image)}" alt="">` : '<span class="th none"></span>'}</td><td><b>${esc(x.title)}</b><div class="muted">${esc(x.product)}</div></td><td>${T[x.id] ? `<span class="badge on">Custom${T[x.id].src ? ' cut-out' : ' crop'}</span>` : '<span class="badge">Center of the photo</span>'}</td></tr>`;
    cbody().innerHTML = `<p class="lede">Pick the part of each product photo that becomes the wood or metal on the grinder. Upload a cleaner photo or cut one out if the product photo has props in it.</p>
      ${['accent', 'cap'].map((k) => `<div class="card flush"><h2 style="padding:12px 16px 0">${k === 'accent' ? 'Accent pieces' : 'Funnel caps'}</h2><table class="list"><tbody>${items.filter((x) => x.kind === k).map(row).join('') || '<tr><td class="empty">None in the catalog.</td></tr>'}</tbody></table></div>`).join('')}`;
    $$('tr[data-t]').forEach((tr) => { tr.onclick = () => nav('textures/' + tr.dataset.t); });
  }
  async function texturePage(id, back) {
    back = back || (() => nav('textures'));
    afterSave = null;
    body().innerHTML = `<div class="ph"><button class="back" id="back" aria-label="Back to textures">&larr;</button><h1>Texture</h1></div><div id="studio">${spin()}</div>`;
    $('#back').onclick = () => { if (studio && studio.destroy) studio.destroy(); studio = null; back(); };
    try { if (!texItems) await loadTexItems(); } catch (e) { $('#studio').innerHTML = errBox(e); return; }
    const item = texItems.find((x) => String(x.id) === String(id));
    if (!item || !window.ZBStudio) { $('#studio').innerHTML = errBox(item ? 'The Art studio did not load. Refresh the page.' : 'That product is no longer in the catalog.'); return; }
    $('h1').textContent = 'Texture · ' + item.title;
    A.cat.textures = A.cat.textures || {};
    $('#studio').innerHTML = '';
    studio = window.ZBStudio.openTexture($('#studio'), { catalog: A.cat, item, upload: Z.uploadImage, pickFile: Z.pickFile, onChange: () => Z.markDirty() });
  }

  /* ---------- Burr guides: one per burr size ---------- */
  const COLS = [['fit.m.espresso', 'Espresso'], ['fit.m.filter', 'Pour over'], ['fit.m.both', 'Both'], ['fit.m.turbo', 'Turbo'], ['fit.t.clarity', 'Clarity'], ['fit.t.sweet', 'Sweet'], ['fit.t.body', 'Body'], ['fit.r.light', 'Light'], ['fit.r.medium', 'Medium'], ['fit.r.dark', 'Dark'], ['fit.processed', 'Processed'], ['fit.forgiving', 'Easy dial-in']];
  function newBurr(C, size, name, variant) {
    let key = Cat.slug(name.replace(/\s+Blind$/i, '')).slice(0, 24) || 'burr'; while (C.burrs.some((x) => x.key === key && x.size === size)) key += '-2';
    const tpl = C.burrs.find((x) => x.size === size) || C.burrs[0] || {};
    const b = { key, size, name: name.replace(/\s+Blind$/i, ''), short: (name.match(/\(([^)]+)\)/) || [])[1] || name.replace(/^SSP\s+/i, '').replace(/\s+Blind$/i, ''), variant: variant || null, code: '', image: null,
      builder: { style: '', taste: '', roast: '', coating: '' },
      fit: tpl.fit ? clone(tpl.fit) : { m: { espresso: 1, filter: 1, both: 1, turbo: 1 }, r: { light: 1, medium: 1, dark: 1 }, t: { clarity: 1, sweet: 1, body: 1 }, processed: 0, forgiving: 0 },
      sum: '', m: {}, tp: {}, r: {}, pick: '', warn: '', style: '', roast: '', coat: '' };
    C.burrs.push(b); return b;
  }
  async function showGuides(sub) {
    const C = A.cat, size = C.sizes.find((s) => s.key === sub) || C.sizes[0] || {}, sz = size.key;
    A.onSave = async () => { await saveCat(); showGuides(sz); }; A.onDiscard = () => { A.cat = clone(A.catSaved); Z.clean(); showGuides(sz); };
    const bs = C.burrs.filter((b) => b.size === sz), gs = C.grinders.filter((g) => g.size === sz);
    body().innerHTML = head('Burr guides', 'One guide per burr size. Fit scores decide how the Burr Guide ranks burrs on the Burr Guide page and in "Help me choose" in every builder on that size.', '<button class="btn primary" id="gsave">Save</button>') + `
      <div class="tabs" role="tablist">${C.sizes.map((s) => `<button role="tab" data-gs="${esc(s.key)}" aria-selected="${s.key === sz}">${esc(s.name)} <span class="cnt">${C.burrs.filter((b) => b.size === s.key && !b.hidden).length}</span></button>`).join('')}<button class="addtab" id="addsize">+ Burr size</button></div>
      ${sz ? `<div class="grid2">
        <div class="card"><h2>Grinders on ${esc(size.name)} burrs</h2>${gs.length ? gs.map((g) => `<div class="field"><label for="gd-${esc(g.key)}">${esc(g.name)}: line under its card</label><input type="text" id="gd-${esc(g.key)}" data-gd="${esc(g.key)}" value="${esc((g.guide || {}).desc || '')}"></div>`).join('') : '<p class="muted">No grinder uses this size yet, so its guide does not show on the store. Set a grinder\'s burr size in Catalog > Grinders.</p>'}</div>
        <div class="card"><h2>Burr products</h2><p class="sub">Prices and stock come from ${(size.products || []).length ? esc(size.products.join(', ')) : 'no product yet'}. A new variant on ${(size.products || []).length > 1 ? 'these products' : 'this product'} shows up below, ready to add.</p><button class="btn sm" id="sizeedit">Edit ${esc(size.name)} burr size</button><div id="newvars"><span class="spin"></span></div></div>
      </div>
      <div class="card flush"><div class="cardhead"><div><h2>Burrs and fit scores</h2><p class="sub" style="margin:0">Scores run 0 to 3. Drag the handle to set the order from more clarity to more texture. Click a burr to edit its photo and copy.</p></div><button class="btn primary sm" id="addburr">Add burr</button></div><div class="scroll"><table class="list mat"><thead><tr><th class="drag" aria-label="Order"></th><th>Burr</th>${COLS.map(([, n]) => `<th>${n}</th>`).join('')}<th>Show</th></tr></thead><tbody>
      ${bs.map((b) => `<tr data-b="${esc(b.key)}" class="${b.hidden ? 'hid' : ''}"><td class="drag"><button type="button" class="handle" data-drag aria-label="Drag ${esc(b.name)} to reorder" title="Drag to reorder">&#8942;&#8942;</button></td><td><a class="bname" href="#" data-ed="${esc(b.key)}">${img(b.image)}<span>${esc(b.name)}</span></a></td>${COLS.map(([p]) => `<td><input type="number" step="0.5" min="-4" max="3" data-sc="${p}" value="${getP(b, p) ?? ''}" aria-label="${esc(b.name)} ${p}"></td>`).join('')}
        <td><label class="switch"><input type="checkbox" data-hid ${b.hidden ? '' : 'checked'} aria-label="Show ${esc(b.name)}"></label></td></tr>`).join('') || `<tr><td colspan="${COLS.length + 3}" class="empty">No burrs in this size yet. Add one, or add a variant to the burr product in Shopify.</td></tr>`}
      </tbody></table></div></div>
      <div class="pv"><div class="pvh"><b>Live preview</b><span><button class="btn sm" id="gpv">Refresh preview</button></span></div><div class="pvb guidepv" id="gprev"></div></div>` : '<div class="card empty">No burr sizes yet. Add one with + Burr size.</div>'}`;
    $('#gsave').onclick = async () => { await saveCat(); showGuides(sz); };
    $$('[data-gs]').forEach((b) => { b.onclick = () => { Z.setUrl('guides', b.dataset.gs); showGuides(b.dataset.gs); }; });
    $('#addsize').onclick = () => {
      const name = (prompt('New burr size, such as 98mm') || '').trim(); if (!name) return;
      const key = Cat.slug(name); if (!keyOk(key) || C.sizes.some((s) => s.key === key)) return toast('That size already exists.', true);
      C.sizes.push({ key, name, products: [], desc: '', pair: null }); Z.markDirty(); Z.setUrl('guides', key); showGuides(key);
      toast(`${name} added. Link its burr product next.`);
    };
    if (!sz) return;
    $('#sizeedit').onclick = () => Z.go('catalog', 'sizes/' + sz);
    $('#addburr').onclick = () => {
      const name = (prompt(`Name of the new ${size.name} burr, as in its Shopify variant`) || '').trim(); if (!name) return;
      const b = newBurr(C, sz, name, null); Z.markDirty(); Z.go('catalog', `burrs/${sz}/${b.key}`);
    };
    $$('[data-gd]').forEach((el) => { el.oninput = () => { const g = C.grinders.find((x) => x.key === el.dataset.gd); g.guide = { ...(g.guide || {}), desc: el.value }; Z.markDirty(); }; });
    // drag a row's handle to move the burr along the clarity to texture strip (the order of this size's burrs in the catalog)
    const tbody = $('table.mat tbody');
    $$('[data-drag]', tbody).forEach((h) => {
      h.onpointerdown = (e) => {
        e.preventDefault();
        const row = h.closest('tr'), others = $$('tr[data-b]', tbody).filter((r) => r !== row);
        row.classList.add('dragging');
        let at = others.length;
        // a line shows where the burr will land; the rows move only on release, so the drag never loses the pointer
        const mark = () => others.forEach((r, i) => { r.classList.toggle('drop-before', i === at); r.classList.toggle('drop-after', at === others.length && i === others.length - 1); });
        const move = (m) => { at = others.filter((r) => { const rc = r.getBoundingClientRect(); return rc.top + rc.height / 2 < m.clientY; }).length; mark(); };
        const up = () => {
          window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
          row.classList.remove('dragging'); others.forEach((r) => r.classList.remove('drop-before', 'drop-after'));
          const keys = others.map((r) => r.dataset.b); keys.splice(at, 0, row.dataset.b);
          const order = keys.map((k) => bs.find((x) => x.key === k));
          if (order.every((x, i) => x === bs[i])) return;
          let i = 0; C.burrs = C.burrs.map((x) => (x.size === sz ? order[i++] : x));
          Z.markDirty(); showGuides(sz);
        };
        move(e);
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
      };
      // keyboard: arrow keys move the focused burr up or down
      h.onkeydown = (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const k = h.closest('tr').dataset.b, idx = bs.findIndex((b) => b.key === k), to = idx + (e.key === 'ArrowUp' ? -1 : 1);
        if (to < 0 || to >= bs.length) return;
        const order = bs.slice(); [order[idx], order[to]] = [order[to], order[idx]];
        let i = 0; C.burrs = C.burrs.map((b) => (b.size === sz ? order[i++] : b));
        Z.markDirty(); showGuides(sz); const nh = $(`tr[data-b="${k}"] [data-drag]`); if (nh) nh.focus();
      };
    });
    $$('tr[data-b]').forEach((tr) => {
      const b = bs.find((x) => x.key === tr.dataset.b);
      $$('[data-sc]', tr).forEach((el) => { el.oninput = () => { setP(b, el.dataset.sc, parseFloat(el.value) || 0); Z.markDirty(); }; });
      $('[data-hid]', tr).onchange = (e) => { b.hidden = !e.target.checked; tr.classList.toggle('hid', b.hidden); Z.markDirty(); };
    });
    $$('[data-ed]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); Z.go('catalog', `burrs/${sz}/${a.dataset.ed}`); }; });
    $('#gpv').onclick = () => guidePreview(sz);
    guidePreview(sz);
    newVariants(size);
  }
  /* variants on the size's burr products that no burr in the catalog matches yet */
  async function newVariants(size) {
    const box = $('#newvars'); if (!box) return;
    let vs = [];
    try { const prods = await Z.productsByHandles(size.products || []); vs = prods.flatMap((p) => p.variants.nodes.map(Z.toVariant)); } catch (e) { box.innerHTML = errBox(e); return; }
    const C = A.cat, open = vs.filter((v) => !Cat.burrFor(C, size.key, v));
    if (!$('#newvars')) return;
    box.innerHTML = !(size.products || []).length ? '<p class="muted">Link a burr product to see its variants here.</p>'
      : open.length ? `<h4 class="h4">In Shopify, not in the guide yet</h4><table class="vals"><tbody>${open.map((v) => `<tr><td>${v.image ? `<img src="${esc(v.image)}" alt="">` : ''}</td><td><b>${esc(v.title)}</b><div class="muted">${Z.money(v.price)}</div></td><td style="text-align:right"><button class="btn sm primary" data-addv="${v.id}">Add to guide</button></td></tr>`).join('')}</tbody></table>`
      : `<p class="ok">All ${vs.length} variants are in the guide.</p>`;
    $$('[data-addv]', box).forEach((b) => { b.onclick = () => {
      const v = open.find((x) => String(x.id) === b.dataset.addv);
      const nb = newBurr(C, size.key, v.title, v.gid); if (v.image) nb.image = v.image;
      Z.markDirty(); toast(`${nb.name} added. Set its scores and copy, then save.`); Z.go('catalog', `burrs/${size.key}/${nb.key}`);
    }; });
  }
  async function guidePreview(sz) {
    const box = $('#gprev'); if (!box) return;
    if (!window.ZernoBurrGuide) { box.innerHTML = errBox('The Burr Guide preview did not load.'); return; }
    const s = A.cat.sizes.find((x) => x.key === sz) || {};
    let shop = null;
    try {
      const prods = await Z.productsByHandles(s.products || []);
      if (prods.length) shop = { [sz]: prods.flatMap((p) => p.variants.nodes.map(Z.toVariant)).map((v) => ({ id: v.id, title: v.title, price: v.price, available: v.available, img: null, url: '#' })) };   // no product yet: preview the catalog burrs without prices
    } catch (e) { /* the guide shows catalog burrs without prices */ }
    box.innerHTML = '<div data-zbg-root data-zbg-width="section" style="--zb-ink:#0a0b0d;--zb-stage:#17191d;--zb-fg:#eceae6;--zb-accent:#c08a4e;--zb-sticky:0px"></div>';
    try { new window.ZernoBurrGuide(box.firstChild, { mode: 'page', size: sz, catalog: A.cat, shop, assetBase: 'preview/catalog.js', heading: 'Burr guide', cartAddUrl: '#', money: Z.money }); }
    catch (e) { box.innerHTML = errBox(e); }
  }

    /* ---------- Products: every product in the store, and what each one does in the builders ---------- */
  const ROLE_NAME = { grinder: 'Grinder', burrs: 'Burrs', accents: 'Accent pieces', caps: 'Funnel caps', accessory: 'Accessory' };
  function rolesOf(h) {
    const C = A.cat, r = [];
    C.grinders.filter((g) => g.product === h).forEach((g) => r.push({ k: 'grinder', label: g.name, g }));
    C.sizes.filter((s) => (s.products || []).includes(h)).forEach((s) => r.push({ k: 'burrs', label: s.name, size: s }));
    const by = (k) => C.grinders.filter((g) => ((g.handles || {})[k] || []).includes(h));
    if (by('accents').length) r.push({ k: 'accents', label: by('accents').map(Z.shortName).join(', '), gs: by('accents') });
    if (by('caps').length) r.push({ k: 'caps', label: by('caps').map(Z.shortName).join(', '), gs: by('caps') });
    const acc = C.accessories.find((a) => a.product === h);
    if (acc || by('accessories').length) r.push({ k: 'accessory', label: (acc && acc.fits && acc.fits.length ? acc.fits : by('accessories').map((g) => g.key)).map((k) => Z.shortName(C.grinders.find((g) => g.key === k) || { name: k })).join(', ') || 'Every grinder', acc });
    return r;
  }
  let PL = { q: '', filter: '', cursor: null, dir: 'next', page: null };
  let afterSave = null;
  async function showProducts(sub) {
    A.onSave = async () => { await saveCat(); }; A.onDiscard = () => { A.cat = clone(A.catSaved); Z.clean(); showProducts(sub); };
    afterSave = null;
    const [id, mode, extra] = (sub || '').split('/');
    if (id && mode === 'art') return productArt(id);
    if (id && mode === 'texture') return productTexture(id, extra);
    if (id && mode === 'cutout') return productCutout(id, extra);
    if (id) return productPage(id);
    Z.titleBar('Products');
    body().innerHTML = head('Products', 'Every product in your store and its part in the builders. Open one to set its role, cut out its photos and tune its art.') + `
      <div class="card flush"><div class="toolbar"><select id="pf" aria-label="Show"><option value="">All products</option><option value="in">In the builders</option><option value="out">Not in the builders</option></select>
        <input type="search" id="pq" placeholder="Search by title or handle" aria-label="Search products" value="${esc(PL.q)}"></div>
      <div class="scroll"><table class="list prods"><thead><tr><th>Product</th><th>Status</th><th>Builder role</th><th>Option set</th><th>Photos and art</th><th>Type</th><th class="right">Actions</th></tr></thead><tbody id="prows"><tr><td colspan="7"><span class="spin"></span></td></tr></tbody></table></div>
      <div class="pager"><button class="btn sm" id="pprev" aria-label="Previous page" disabled>&lsaquo;</button><button class="btn sm" id="pnext" aria-label="Next page" disabled>&rsaquo;</button></div></div>`;
    $('#pf').value = PL.filter;
    let t = null;
    $('#pq').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { PL = { ...PL, q: e.target.value.trim(), cursor: null }; loadPage(); }, 300); };
    $('#pf').onchange = (e) => { PL.filter = e.target.value; loadPage(); };
    $('#pprev').onclick = () => { PL = { ...PL, cursor: PL.page.startCursor, dir: 'prev' }; loadPage(); };
    $('#pnext').onclick = () => { PL = { ...PL, cursor: PL.page.endCursor, dir: 'next' }; loadPage(); };
    loadPage();
  }
  async function loadPage() {
    const tb = $('#prows'); if (!tb) return;
    const C = A.cat;
    const builderHandles = [...new Set([...C.grinders.map((g) => g.product), ...C.sizes.flatMap((s) => s.products || []), ...C.grinders.flatMap((g) => Object.values(g.handles || {}).flat()), ...C.accessories.map((a) => a.product)].filter(Boolean))];
    const q = [PL.q ? `${PL.q.replace(/[^\w\s-]/g, '')}*` : '', PL.filter === 'in' ? `(${builderHandles.map((h) => `handle:${h}`).join(' OR ')})` : ''].filter(Boolean).join(' ');
    const page = PL.dir === 'prev' && PL.cursor ? `last:25, before:"${PL.cursor}"` : PL.cursor ? `first:25, after:"${PL.cursor}"` : 'first:25';
    let d, sets = [];
    try {
      [d, sets] = await Promise.all([Z.gql(`query P($q:String){ products(${page}, sortKey:TITLE, query:$q){ pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
        nodes { id title handle status productType featuredMedia { preview { image { url } } } variants(first:100){ nodes { id image { url } } } } } }`, { q: q || null }), Z.loadSets().catch(() => [])]);
    } catch (e) { tb.innerHTML = `<tr><td colspan="7">${errBox(e)}</td></tr>`; return; }
    PL.page = d.products.pageInfo;
    let nodes = d.products.nodes;
    if (PL.filter === 'out') nodes = nodes.filter((p) => !builderHandles.includes(p.handle));
    const T = C.textures || {};
    const artCell = (p, roles) => roles.map((r) => {
      const vs = p.variants.nodes;
      if (r.k === 'grinder') return r.g.art ? '<span class="badge on">Layered art</span>' : '<span class="badge">Photo mode</span>';
      if (r.k === 'accents' || r.k === 'caps') { const n = vs.filter((v) => T[num(v.id)]).length; return `<span class="badge ${n ? 'on' : ''}">${n} of ${vs.length} textures</span>`; }
      if (r.k === 'burrs') { const n = C.burrs.filter((b) => b.size === r.size.key && b.image && !b.hidden).length; return `<span class="badge ${n ? 'on' : ''}">${n} burr photos</span>`; }
      if (r.k === 'accessory') return r.acc && r.acc.stage ? '<span class="badge on">Cut-out</span>' : '<span class="badge">No cut-out</span>';
      return '';
    }).join(' ') || '<span class="muted">-</span>';
    const setCell = (p, roles) => {
      const g = roles.find((r) => r.k === 'grinder');
      if (g) { const w = Z.winner(g.g, sets, p); return w.os ? esc(w.os.title) : '<span class="muted">No active set</span>'; }
      const ids = p.variants.nodes.map((v) => v.id), inSets = sets.filter((s) => Object.values(s.lists).flat().some((x) => ids.includes(x)));
      return inSets.length ? esc(inSets.map((s) => s.title).join(', ')) : '<span class="muted">-</span>';
    };
    tb.innerHTML = nodes.map((p) => { const roles = rolesOf(p.handle); return `<tr class="clk" data-p="${num(p.id)}">
      <td><span class="pcell">${Z.pimg(p) ? `<img src="${esc(Z.pimg(p))}" alt="">` : '<span class="th none"></span>'}<span><b>${esc(p.title)}</b><br><span class="muted">${esc(p.handle)}</span></span></span></td>
      <td><span class="badge ${p.status === 'ACTIVE' ? 'on' : p.status === 'DRAFT' ? 'info' : ''}">${esc((p.status || 'active').toLowerCase().replace(/^./, (c) => c.toUpperCase()))}</span></td>
      <td>${roles.length ? roles.map((r) => `<span class="role">${ROLE_NAME[r.k]}<small>${esc(r.label)}</small></span>`).join(' ') : '<span class="muted">Not used</span>'}</td>
      <td>${setCell(p, roles)}</td><td>${artCell(p, roles)}</td><td class="muted">${esc(p.productType || '')}</td><td class="right"><button class="btn sm">Edit</button></td></tr>`; }).join('')
      || `<tr><td colspan="7" class="empty">${PL.q ? 'No products match.' : 'No products on this page.'}</td></tr>`;
    $$('tr[data-p]', tb).forEach((tr) => { tr.onclick = () => openProduct(tr.dataset.p); });
    $('#pprev').disabled = !PL.page.hasPreviousPage; $('#pnext').disabled = !PL.page.hasNextPage;
  }
  const openProduct = (id, more = '') => { Z.setUrl('products', id + (more ? '/' + more : '')); showProducts(id + (more ? '/' + more : '')); };
  async function productById(id) { const r = await Z.gql(`query N($id:ID!){ node(id:$id){ ... on Product { id title handle status productType vendor featuredMedia { preview { image { url } } } options { name values }
      variants(first:100){ nodes { id title price availableForSale image { url } selectedOptions { name value } product { id title handle featuredMedia { preview { image { url } } } } } } } } }`, { id: `gid://shopify/Product/${id}` }); return r.node; }

  async function productPage(id) {
    body().innerHTML = spin('Loading product…');
    let p; try { p = await productById(id); } catch (e) { body().innerHTML = errBox(e); return; }
    if (!p) { body().innerHTML = errBox('That product no longer exists.'); return; }
    afterSave = () => productPage(id);
    const C = A.cat, roles = rolesOf(p.handle), has = (k) => roles.find((r) => r.k === k);
    const vs = p.variants.nodes.map(Z.toVariant);
    Z.titleBar(p.title, [{ label: 'Save', primary: true, onClick: () => saveCat() }]);
    const gcheck = (k) => C.grinders.map((g) => `<label class="check inl"><input type="checkbox" data-role="${k}" value="${esc(g.key)}" ${((g.handles || {})[k] || []).includes(p.handle) ? 'checked' : ''}><span>${esc(Z.shortName(g))}</span></label>`).join('');
    body().innerHTML = `<div class="ph"><button class="back" id="back" aria-label="Back to products">&larr;</button><h1 class="show">${Z.pimg(p) ? `<img class="th" src="${esc(Z.pimg(p))}" alt="">` : ''}${esc(p.title)}</h1>
        <span class="badge ${p.status === 'ACTIVE' ? 'on' : ''}">${esc((p.status || '').toLowerCase())}</span><a class="btn" href="shopify://admin/products/${id}" target="_top">View in Shopify</a><button class="btn primary" id="psave">Save</button></div>
      <div class="pgrid"><div>
        <div class="card"><h2>Role in the builders</h2><p class="sub">Choose what this product does. Changes publish when you save.</p>
          <div class="rolegrid">
            <div><b>Grinder</b>${has('grinder') ? `<p class="sub">${esc(has('grinder').g.name)} builder</p><button class="btn sm" id="editg">Edit grinder details</button>` : '<p class="sub">Customers build this grinder.</p><button class="btn sm" id="addg">Make it a grinder</button>'}</div>
            <div><b>Burrs</b><p class="sub">Each variant is a burr set.</p><select id="rsize" aria-label="Burr size"><option value="">Not a burr product</option>${C.sizes.map((s) => `<option value="${esc(s.key)}" ${(s.products || []).includes(p.handle) ? 'selected' : ''}>${esc(s.name)} burrs</option>`).join('')}</select></div>
            <div><b>Accent pieces for</b><div class="chips">${gcheck('accents')}</div></div>
            <div><b>Funnel caps for</b><div class="chips">${gcheck('caps')}</div></div>
            <div><b>Accessory for</b><div class="chips">${gcheck('accessories')}</div></div>
          </div></div>
        <div id="roleparts"></div>
      </div><div id="side"></div></div>`;
    $('#back').onclick = () => { Z.setUrl('products'); showProducts(''); };
    $('#psave').onclick = () => saveCat();
    if ($('#editg')) $('#editg').onclick = () => Z.go('catalog', 'grinders/' + has('grinder').g.key);
    if ($('#addg')) $('#addg').onclick = () => {
      const key = (prompt('Short key for this grinder, such as z3. Lowercase letters, numbers and dashes.') || '').trim().toLowerCase();
      if (!key) return; if (!keyOk(key) || C.grinders.some((g) => g.key === key)) return toast('Use a new key with lowercase letters, numbers and dashes.', true);
      const size = C.sizes[0];
      C.grinders.push({ key, name: p.title.replace(/\s+-\s+.*$/, ''), product: p.handle, size: size ? size.key : '', buildPrefix: key.toUpperCase(), heading: '', handles: { burrs: size ? [...(size.products || [])] : [], accents: [], caps: [], accessories: [] }, accessoryMatch: '', finishText: {}, finishSwatch: {}, included: [], installed: null, art: null, geom: null, guide: { show: true, desc: '' } });
      Z.markDirty(); productPage(id);
    };
    $('#rsize').onchange = (e) => { C.sizes.forEach((s) => { s.products = (s.products || []).filter((h) => h !== p.handle); if (s.key === e.target.value) s.products.push(p.handle); }); Z.markDirty(); productPage(id); };
    $$('[data-role]').forEach((c) => { c.onchange = () => {
      const g = C.grinders.find((x) => x.key === c.value), k = c.dataset.role; g.handles = g.handles || {}; g.handles[k] = (g.handles[k] || []).filter((h) => h !== p.handle); if (c.checked) g.handles[k].push(p.handle);
      if (k === 'accessories') { let a = C.accessories.find((x) => x.product === p.handle); const fits = C.grinders.filter((x) => (x.handles.accessories || []).includes(p.handle)).map((x) => x.key); if (!a && fits.length) { a = { product: p.handle, fits: [], group: '', blurb: '', stage: null }; C.accessories.push(a); } if (a) a.fits = fits; if (a && !fits.length) C.accessories = C.accessories.filter((x) => x !== a); }
      Z.markDirty(); productPage(id);
    }; });
    const parts = $('#roleparts'), side = $('#side');
    if (!roles.length) parts.innerHTML = '<div class="card empty">Not used by the builders. Pick a role above.</div>';
    // grinder: art and how it opens
    if (has('grinder')) {
      const g = has('grinder').g;
      parts.insertAdjacentHTML('beforeend', `<div class="card"><h2>Art</h2><p>${artStatus(g)}</p><p class="sub">${g.art ? 'Colors, woods and caps show on the grinder, and the front opens to show the burrs.' : 'Photo mode: the builder shows this product\'s photo for each color. Make layered art to show woods and caps on the grinder.'}</p>
        <div class="btnrow"><button class="btn primary" id="toart">Open Art studio</button>${g.art ? '<button class="btn" id="noart">Switch to photo mode</button>' : g.artOff ? '<button class="btn" id="artback">Turn layered art back on</button>' : ''}</div></div>`);
      $('#toart').onclick = () => openProduct(id, 'art');
      if ($('#noart')) $('#noart').onclick = () => { g.artOff = { art: g.art, geom: g.geom }; g.art = null; g.geom = null; Z.markDirty(); productPage(id); };
      if ($('#artback')) $('#artback').onclick = () => { g.art = g.artOff.art; g.geom = g.artOff.geom; delete g.artOff; Z.markDirty(); productPage(id); };
      hingeCard(side, g, p, vs);
      Z.loadSets().then((sets) => {
        const w = Z.winner(g, sets, p);
        parts.insertAdjacentHTML('afterbegin', `<div class="card"><div class="cardrow"><h2>Option set</h2><button class="btn sm" id="newset">Create option set</button></div>
          ${w.os ? `<p><a href="#" data-set="${num(w.os.id)}">${esc(w.os.title)}</a> runs this builder.</p>` : '<p class="sub">No active option set lists this product. The builder uses its block settings and the catalog.</p>'}
          ${w.skipped.length ? `<p class="sub" style="margin:0">Skipped: ${w.skipped.map((x) => `<a href="#" data-set="${num(x.s.id)}">${esc(x.s.title)}</a> (${esc(x.why)})`).join(', ')}</p>` : ''}</div>`);
        $$('[data-set]', parts).forEach((a) => { a.onclick = (e) => { e.preventDefault(); Z.go('sets', a.dataset.set); }; });
        $('#newset').onclick = () => Z.go('sets', 'new');
      }).catch(() => {});
    }
    // burr product: every variant, its place in the guide and its cut-out photo
    const br = has('burrs');
    if (br) {
      const sz = br.size.key;
      parts.insertAdjacentHTML('beforeend', `<div class="card"><h2>${esc(br.size.name)} burrs</h2><p class="sub">The photo is the cut-out customers see in the builder and the Burr Guide.</p><div class="scroll"><table class="vals"><tbody>
        ${vs.map((v) => { const b = Cat.burrFor(C, sz, v); return `<tr><td>${img(b && b.image ? b.image : v.image)}</td><td><b>${esc(v.title)}</b><div class="muted">${Z.money(v.price)}</div></td>
          <td>${b ? `<a href="#" data-burr="${esc(b.key)}">${b.hidden ? 'Hidden in the guide' : 'In the guide'}</a>` : `<button class="btn sm" data-addv="${v.id}">Add to guide</button>`}</td>
          <td class="right"><button class="btn sm" data-cut="${v.id}">Cut out photo</button></td></tr>`; }).join('')}</tbody></table></div></div>`);
      $$('[data-burr]', parts).forEach((a) => { a.onclick = (e) => { e.preventDefault(); Z.go('catalog', `burrs/${sz}/${a.dataset.burr}`); }; });
      $$('[data-addv]', parts).forEach((b) => { b.onclick = () => { const v = vs.find((x) => String(x.id) === b.dataset.addv); const nb = newBurr(C, sz, v.title, v.gid); if (v.image) nb.image = v.image; Z.markDirty(); toast(`${nb.name} added to the ${br.size.name} guide. Save to publish.`); productPage(id); }; });
      $$('[data-cut]', parts).forEach((b) => { b.onclick = () => openProduct(id, 'cutout/' + b.dataset.cut); });
    }
    // accent pieces and funnel caps: the texture of each variant
    ['accents', 'caps'].filter(has).forEach((k) => {
      const T = C.textures || {};
      parts.insertAdjacentHTML('beforeend', `<div class="card"><h2>${k === 'accents' ? 'Wood textures' : 'Cap textures'}</h2><p class="sub">The part of each photo that becomes the ${k === 'accents' ? 'wood on the accent piece' : 'cap on the funnel'}.</p>
        <div class="texgrid">${vs.map((v) => `<button class="texcard" data-tex="${v.id}">${v.image ? `<img src="${esc((T[v.id] && T[v.id].src) || v.image)}" alt="">` : '<span class="th none"></span>'}<b>${esc(v.title === 'Default Title' ? p.title : v.title)}</b><span class="badge ${T[v.id] ? 'on' : ''}">${T[v.id] ? (T[v.id].src ? 'Custom photo' : 'Custom crop') : 'Center of the photo'}</span></button>`).join('')}</div></div>`);
    });
    $$('[data-tex]', parts).forEach((b) => { b.onclick = () => openProduct(id, 'texture/' + b.dataset.tex); });
    // accessory: the cut-out next to the grinder
    if (has('accessory') && has('accessory').acc) {
      const a = has('accessory').acc;
      parts.insertAdjacentHTML('beforeend', `<div class="card"><h2>Accessory</h2><div class="inrow">${img(a.stage)}<span class="sub" style="flex:1">${a.stage ? 'This cut-out shows next to the grinder when a customer adds it.' : 'Cut out the product photo to show it next to the grinder.'}</span><button class="btn sm" id="cutacc">Cut out photo</button></div>
        <div class="row2" style="margin-top:12px">${f('group', 'Pick one group', a, { help: 'Accessories in the same group replace each other.' })}${f('blurb', 'Line in the builder', a)}</div></div>`);
      bind(parts.lastElementChild, a);
      $('#cutacc').onclick = () => openProduct(id, 'cutout/stage');
    }
  }

  /* How the grinder opens: angle and pivot, or slide distance and direction, with the real builder playing it.
     Also the accent piece's edge: how far it stands proud of the dial, and how dark its side is. */
  function hingeCard(side, g, p, vs) {
    if (!g.art || !g.geom) { side.innerHTML = '<div class="card"><h2>How it opens</h2><p class="sub">Make layered art first. Then set how the front opens here.</p></div>'; return; }
    const H = g.geom.hinge = g.geom.hinge || { mode: 'swing' };
    const fins = Object.keys(g.geom).filter((k) => g.geom[k] && g.geom[k].knob);
    const slug0 = Object.keys(g.geom).find((k) => g.geom[k] && g.geom[k].face) || '';
    const fc = slug0 ? g.geom[slug0].face : null, rim0 = (fins[0] && g.geom[fins[0]].knob.rim) || {};
    const def = { angle: -25, dist: (slug0 && g.geom[slug0].open) || 8, dir: 177, ms: 1800, grow: 0, pivot: fc ? (H.mode === 'slide' ? [fc.c[0], fc.c[1]] : [fc.c[0], fc.c[1] + fc.h]) : [50, 50] };
    const val = (k) => (H[k] != null ? H[k] : def[k]);
    const slider = (k, label, min, max, step, shown, attr = 'data-h', v = val(k)) => `<label class="field"><span class="lbl">${label} <b data-v="${k}">${shown}</b></span><input type="range" min="${min}" max="${max}" step="${step}" value="${v}" ${attr}="${k}"></label>`;
    const secs = (ms) => (ms / 1000).toFixed(1) + ' s';
    const capFront = H.funnel ? H.funnel === 'front' : H.mode !== 'slide';
    side.innerHTML = `<div class="card sticky"><div class="cardrow"><h2>How it opens</h2><button class="btn sm primary" id="play">Play</button></div>
      <div class="seg sm">${[['swing', 'Swings open'], ['slide', 'Slides out'], ['none', 'Stays shut']].map(([m, n]) => `<button data-mode="${m}" aria-pressed="${(H.mode || 'swing') === m}">${n}</button>`).join('')}</div>
      ${H.mode === 'none' ? '<p class="sub">The burr drops into the accent piece instead.</p>' : H.mode === 'slide'
        ? slider('dist', 'Distance', 2, 45, 0.5, val('dist') + '%') + slider('dir', 'Direction', 0, 360, 1, val('dir') + '&deg;') + slider('grow', 'Comes toward you', 0, 0.08, 0.005, Math.round(val('grow') * 100) + '%')
        : slider('angle', 'Angle', -60, 60, 1, val('angle') + '&deg;') + `<div class="row2">${[0, 1].map((i) => `<label class="field"><span class="lbl">Hinge ${i ? 'height' : 'across'} <b data-v="pivot${i}">${val('pivot')[i].toFixed(1)}%</b></span><input type="range" min="0" max="100" step="0.5" value="${val('pivot')[i]}" data-pv="${i}"></label>`).join('')}</div>`}
      ${H.mode === 'none' ? '' : slider('speed', 'Speed <span class="muted">(slow to fast)</span>', 600, 4000, 100, secs(val('ms')), 'data-speed', 4600 - val('ms'))}
      ${H.mode === 'none' ? '' : `<div class="field"><span class="lbl">Funnel and cap</span><div class="seg sm">${[['front', 'Come off with the front'], ['body', 'Stay on the body']].map(([k, n]) => `<button data-funnel="${k}" aria-pressed="${capFront === (k === 'front')}">${n}</button>`).join('')}</div></div>`}
      <div class="btnrow"><button class="btn sm" id="hreset">Reset</button><span class="muted" style="font-size:12px">Drag the hinge point in the Art studio for exact placement.</span></div>
      <h3 class="h3">Accent piece edge</h3>
      ${slider('rt', 'How far it stands out', 0, 15, 0.5, (rim0.t != null ? rim0.t * 100 : 7).toFixed(1) + '%', 'data-rim', rim0.t != null ? rim0.t * 100 : 7)}
      ${slider('rs', 'Edge shade <span class="muted">(light to dark)</span>', 0, 70, 1, Math.round(rim0.shade != null ? rim0.shade * 100 : 30) + '%', 'data-rim', rim0.shade != null ? rim0.shade * 100 : 30)}
      ${slider('rl', 'Lip it seats into', 0, 8, 0.5, (rim0.lip != null ? rim0.lip * 100 : 3).toFixed(1) + '%', 'data-rim', rim0.lip != null ? rim0.lip * 100 : 3)}
      <div class="field"><span class="lbl">Lip color <span class="muted">(match the dial in each photo)</span></span><div class="row2">${fins.map((f) => `<label class="field"><span class="lbl">${esc(f.replace(/-/g, ' '))}</span><input type="color" data-lipc="${esc(f)}" value="${esc((g.geom[f].knob.rim || {}).color || (/white|cream|ivory/.test(f) ? '#d0d1cc' : '#3c3a3d'))}"></label>`).join('')}</div></div>
      <div class="pv hpv"><div class="pvb" id="hprev"></div></div></div>`;
    // preview: the real builder on this grinder, with a burr and an accent piece, so Play shows exactly what customers see
    const C = { blockId: 'hinge', preview: true, grinderKey: g.key, catalog: A.cat, assetBase: 'preview/catalog.js', installedImage: null, included: [],
      settings: { heading: '', intro: '', includedNote: '', afterAdd: 'stay', accentCrop: 0.7, capCrop: 0.66, capOptional: true, finishText: '', finishSwatches: '', hideFinishes: '', hideBurrs: '', hideAccents: '', hideCaps: '', allowExtras: false, allowSpareBurrs: false, showIncluded: false, burrGuide: false },
      shop: { currency: 'USD', locale: 'en-US', cartAddUrl: '#', cartUrl: '#', rootUrl: '/' },
      grinder: { id: num(p.id), handle: p.handle, title: p.title, image: Z.pimg(p), options: p.options.map((o) => ({ name: o.name, values: o.values })), variants: vs.map((v) => ({ id: v.id, title: v.title, options: v.options, price: v.price, available: true, image: v.image })) },
      burrs: A.cat.burrs.filter((b) => b.size === g.size && !b.hidden).slice(0, 1).map((b, i) => ({ id: 900000 + i, title: b.name, short: b.short, price: 0, available: true, flat: null, flatAsset: b.image ? Cat.asset('preview/', b.image) : null, image: null })),
      accents: [], caps: [], accessories: [] };
    let root = null;
    const build = () => {
      const box = $('#hprev'); if (!box) return;
      C.catalog = A.cat;
      box.innerHTML = `<div class="zb" data-zb-root style="--zb-sticky:0px"><script type="application/json" data-zb-config>${JSON.stringify(C).replace(/</g, '\\u003c')}</script></div>`;
      if (window.ZernoBuilderBoot) window.ZernoBuilderBoot(box);
      root = box.firstChild;
    };
    build();
    Z.productsByHandles(((g.handles || {}).accents || []).slice(0, 1)).then((ps) => {
      const v = ps[0] && ps[0].variants.nodes.map(Z.toVariant)[0]; if (!v) return;
      C.accents = [{ id: v.id, title: v.title, price: v.price, available: true, image: v.image }]; build();
    }).catch(() => {});
    const play = () => { const zb = root && root._zb; if (!zb) return; zb.AG.hinge = clone(H); zb.demoOpen(); };
    let t = null; const later = () => { clearTimeout(t); t = setTimeout(play, 350); };
    let rt = null; const rebuild = () => { clearTimeout(rt); rt = setTimeout(build, 250); };
    $('#play').onclick = play;
    $$('[data-mode]', side).forEach((b) => { b.onclick = () => { H.mode = b.dataset.mode; Z.markDirty(); hingeCard(side, g, p, vs); later(); }; });
    $$('[data-funnel]', side).forEach((b) => { b.onclick = () => { H.funnel = b.dataset.funnel; Z.markDirty(); hingeCard(side, g, p, vs); later(); }; });
    $$('[data-h]', side).forEach((el) => { el.oninput = () => { const k = el.dataset.h; H[k] = +el.value; $(`[data-v="${k}"]`, side).innerHTML = k === 'grow' ? Math.round(+el.value * 100) + '%' : el.value + (k === 'dist' ? '%' : '&deg;'); Z.markDirty(); later(); }; });
    $$('[data-speed]', side).forEach((el) => { el.oninput = () => { H.ms = 4600 - +el.value; $('[data-v="speed"]', side).textContent = secs(H.ms); Z.markDirty(); later(); }; });
    $$('[data-pv]', side).forEach((el) => { el.oninput = () => { const pv = (H.pivot || def.pivot).slice(); pv[+el.dataset.pv] = +el.value; H.pivot = pv; $(`[data-v="pivot${el.dataset.pv}"]`, side).textContent = (+el.value).toFixed(1) + '%'; Z.markDirty(); later(); }; });
    $$('[data-rim]', side).forEach((el) => { el.oninput = () => {
      const k = el.dataset.rim, v = +el.value / 100;
      fins.forEach((f) => { const kn = g.geom[f].knob; kn.rim = { ...(kn.rim || {}), [{ rt: 't', rs: 'shade', rl: 'lip' }[k]]: v }; });
      $(`[data-v="${k}"]`, side).textContent = k === 'rs' ? Math.round(+el.value) + '%' : (+el.value).toFixed(1) + '%';
      Z.markDirty(); rebuild();
    }; });
    $$('[data-lipc]', side).forEach((el) => { el.oninput = () => { const kn = g.geom[el.dataset.lipc].knob; kn.rim = { ...(kn.rim || {}), color: el.value }; Z.markDirty(); rebuild(); }; });
    $('#hreset').onclick = () => { ['angle', 'dist', 'dir', 'ms', 'pivot', 'grow'].forEach((k) => delete H[k]); Z.markDirty(); hingeCard(side, g, p, vs); later(); };
  }
  async function productArt(id) {
    const p = await productById(id).catch(() => null), r = p && rolesOf(p.handle).find((x) => x.k === 'grinder');
    if (!r) return openProduct(id);
    return artPage(r.g.key, () => openProduct(id));
  }
  async function productTexture(id, vid) { return texturePage(vid, () => openProduct(id)); }
  async function productCutout(id, what) {
    const p = await productById(id).catch(() => null); if (!p) return openProduct(id);
    const C = A.cat, vs = p.variants.nodes.map(Z.toVariant), roles = rolesOf(p.handle);
    if (what === 'stage') {
      const a = (roles.find((r) => r.k === 'accessory') || {}).acc;
      return cutoutPage({ title: p.title, image: Z.pimg(p), back: () => openProduct(id), done: (url) => { a.stage = url; } });
    }
    const v = vs.find((x) => String(x.id) === what), br = roles.find((r) => r.k === 'burrs');
    if (!v || !br) return openProduct(id);
    let b = Cat.burrFor(C, br.size.key, v);
    return cutoutPage({ title: v.title, image: (b && b.image && /^(https?:)?\/\//.test(b.image) ? b.image : null) || v.image, hint: 'Cut out the burr seen from above. Keep the ring, remove everything else.', back: () => openProduct(id),
      done: (url) => { if (!b) b = newBurr(C, br.size.key, v.title, v.gid); b.image = url; } });
  }
  /* full-width cut-out editor; done(url) stores the result, then the catalog saves */
  function cutoutPage({ title, image, hint, back, done }) {
    afterSave = null;
    body().innerHTML = `<div class="ph" style="margin-bottom:8px"><button class="btn plain" id="back">&larr; Back</button></div><div id="studio"></div>`;
    const leave = () => { if (studio && studio.destroy) studio.destroy(); studio = null; back(); };
    $('#back').onclick = leave;
    if (!window.ZBStudio || !window.ZBStudio.openCutout) { $('#studio').innerHTML = errBox('The cut-out tool did not load. Refresh the page.'); return; }
    studio = window.ZBStudio.openCutout($('#studio'), { image, title, hint, upload: Z.uploadImage, pickFile: Z.pickFile,
      onDone: async (url) => { done(url); Z.markDirty(); await saveCat(); leave(); } });
  }

  window.ZBAdminCatalog = { showCatalog, showGuides, showProducts };
})();
