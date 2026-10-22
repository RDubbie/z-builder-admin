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
  function uploadBtn(path, label = 'Upload') { return `<label class="btn sm upl">${label}<input type="file" accept="image/png,image/jpeg,image/webp" data-up="${path}" hidden></label>`; }
  function bindUploads(box, obj) {
    $$('[data-up]', box).forEach((el) => {
      el.onchange = async () => {
        const file = el.files[0]; if (!file) return;
        const lab = el.parentElement; lab.classList.add('busy'); lab.firstChild.textContent = 'Uploading…';
        try { setP(obj, el.dataset.up, await Z.uploadImage(file, file.name)); Z.markDirty(); toast('Image uploaded'); render(); }
        catch (e) { toast(e.message, true); lab.classList.remove('busy'); lab.firstChild.textContent = 'Upload'; }
      };
    });
  }
  const img = (u) => (u ? `<img class="th" src="${esc(Cat.asset('preview/', u))}" alt="">` : '<span class="th none"></span>');

  /* ---------- catalog page frame ---------- */
  let SUB = 'grinders';
  function nav(sub) { SUB = sub; history.replaceState(null, '', '#/catalog/' + sub); render(); }
  async function saveCat() {
    const btns = $$('#sb-save, #csave'); btns.forEach((b) => { b.disabled = true; });
    try { await Z.saveCatalog(A.cat); A.catSaved = clone(A.cat); A.catIsSaved = true; Z.clean(); toast('Catalog saved. The store updates within a minute.'); if (A.view === 'catalog' && !/\/art$|^textures\/./.test(SUB)) render(); }
    catch (e) { toast('Not saved: ' + e.message, true); } finally { btns.forEach((b) => { b.disabled = false; }); }
  }
  function discardCat() { A.cat = clone(A.catSaved); Z.clean(); render(); }
  function showCatalog(sub) {
    SUB = sub || 'grinders';
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
      <div class="card"><h2>Art</h2><p>${artStatus(g)}</p><p class="sub">${g.art ? 'The builder recolors the grinder and changes woods and caps on the photo.' : 'The builder shows the product photo. Open the Art studio to cut out the grinder, accent piece and funnel cap from your photos.'}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" id="studio">Open Art studio</button>${g.art ? '<button class="btn danger" id="noart">Use photo mode</button>' : ''}</div></div>
      <div class="card"><h2>In the box</h2><p class="sub">Shown on the accessories step. Items with a spot are drawn next to the grinder.</p>
        <table class="vals"><thead><tr><th>Photo</th><th>Name</th><th>Spot</th><th></th></tr></thead><tbody>
        ${g.included.map((x, i) => `<tr><td>${img(x.image)} ${uploadBtn(`included.${i}.image`)}</td><td><input type="text" data-k="included.${i}.name" value="${esc(x.name)}"></td>
          <td><select data-k="included.${i}.slot">${SLOTS.map(([k, n]) => `<option value="${k}" ${k === (x.slot || '') ? 'selected' : ''}>${n}</option>`).join('')}</select></td><td><button class="ic" data-rmi="${i}" aria-label="Remove">&#128465;</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nothing listed.</td></tr>'}
        </tbody></table><button class="btn sm" id="addi">+ Add item</button>
        <h3 class="h3">Pre-installed part</h3><div class="row2">${f('installed.name', 'Name', g, { ph: 'Stainless steel medium feed auger' })}${f('installed.handle', 'Product handle', g, { pick: 'product' })}</div></div>
      <div class="card"><h2>Burr Guide</h2>${f('guide.show', 'Show this grinder in the Burr Guide', g, { type: 'checkbox' })}${f('guide.desc', 'Line under the grinder card', g, { type: 'textarea', rows: 2 })}</div>
      <div class="card"><button class="btn danger" id="delg">Delete grinder</button> <span class="muted">Option sets that use it stop working until you pick another grinder.</span></div>
    </div></div>`;
    bindBack(); bind(cbody(), g, (p) => { if (p === 'name') $('.card h2').textContent = g.name; }); bindUploads(cbody(), g);
    $$('[data-rmi]').forEach((b) => { b.onclick = () => { g.included.splice(+b.dataset.rmi, 1); Z.markDirty(); render(); }; });
    $('#addi').onclick = () => { g.included.push({ name: '', image: null, slot: '' }); Z.markDirty(); render(); };
    $('#studio').onclick = () => nav(`grinders/${g.key}/art`);
    if ($('#noart')) $('#noart').onclick = () => { if (!confirm('Switch this grinder to photo mode? Its art stays in Shopify Files.')) return; g.art = null; g.geom = null; Z.markDirty(); render(); };
    $('#delg').onclick = () => { if (!confirm(`Delete ${g.name} from the catalog?`)) return; C.grinders = C.grinders.filter((x) => x !== g); Z.markDirty(); nav('grinders'); };
  }

  /* ---------- the Art studio page ---------- */
  let studio = null;
  async function artPage(key) {
    const g = A.cat.grinders.find((x) => x.key === key);
    if (!g) return nav('grinders');
    body().innerHTML = `<div class="ph" style="margin-bottom:8px"><button class="btn plain" id="back">&larr; Back to ${esc(g.name)}</button></div><div id="studio">${spin('Loading photos…').replace('class="card"', 'class="card" style="margin:0"')}</div>`;
    $('#back').onclick = () => { if (studio && studio.destroy) studio.destroy(); studio = null; nav('grinders/' + key); };
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
      upload: Z.uploadImage,
      onChange: async () => { Z.markDirty(); await saveCat(); }
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
    cbody().innerHTML = `<div class="tabs sm">${C.sizes.map((s) => `<button data-sz="${esc(s.key)}" aria-selected="${s.key === sz}">${esc(s.name)}</button>`).join('')}</div>
      <div class="card flush"><table class="list"><thead><tr><th></th><th>Burr</th><th>Matches</th><th>Style</th><th>Espresso</th><th>Pour over</th><th>Show</th></tr></thead><tbody>
      ${bs.map((b) => `<tr class="clk" data-b="${esc(b.key)}"><td>${img(b.image)}</td><td><b>${esc(b.name)}</b> <span class="badge">${esc(b.short || '')}</span></td><td class="muted">${b.variant ? 'Variant ' + num(b.variant) : esc(b.code ? 'Name has ' + b.code.replace(/\\/g, '') : 'Name')}</td>
        <td>${esc((b.builder || {}).style || b.style || '')}</td><td>${getP(b, 'fit.m.espresso') ?? ''}</td><td>${getP(b, 'fit.m.filter') ?? ''}</td><td>${b.hidden ? 'Hidden' : 'Shown'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No burrs in this size yet.</td></tr>'}
      </tbody></table></div><button class="btn primary" id="addb">Add burr</button>`;
    $$('[data-sz]').forEach((b) => { b.onclick = () => nav('burrs/' + b.dataset.sz); });
    $$('tr[data-b]').forEach((tr) => { tr.onclick = () => nav(`burrs/${sz}/${tr.dataset.b}`); });
    $('#addb').onclick = () => {
      const name = (prompt('Burr name, as in the variant title, such as SSP Brew') || '').trim(); if (!name) return;
      let key = Cat.slug(name).slice(0, 24); while (C.burrs.some((b) => b.key === key && b.size === sz)) key += '-2';
      const tpl = C.burrs.find((b) => b.size === sz) || C.burrs[0] || {};
      C.burrs.push({ key, size: sz, name, short: name.replace(/^SSP\s+/i, ''), variant: null, code: '', image: null, builder: { style: '', taste: '', roast: '', coating: '' },
        fit: tpl.fit ? clone(tpl.fit) : { m: { espresso: 1, filter: 1, both: 1, turbo: 1 }, r: { light: 1, medium: 1, dark: 1 }, t: { clarity: 1, sweet: 1, body: 1 }, processed: 0, forgiving: 0 },
        sum: '', m: {}, tp: {}, r: {}, pick: '', warn: '', style: '', roast: '', coat: '' });
      Z.markDirty(); nav(`burrs/${sz}/${key}`);
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
  async function texturePage(id) {
    body().innerHTML = `<div class="ph"><button class="back" id="back" aria-label="Back to textures">&larr;</button><h1>Texture</h1></div><div id="studio">${spin()}</div>`;
    $('#back').onclick = () => { if (studio && studio.destroy) studio.destroy(); studio = null; nav('textures'); };
    try { if (!texItems) await loadTexItems(); } catch (e) { $('#studio').innerHTML = errBox(e); return; }
    const item = texItems.find((x) => String(x.id) === String(id));
    if (!item || !window.ZBStudio) { $('#studio').innerHTML = errBox(item ? 'The Art studio did not load. Refresh the page.' : 'That product is no longer in the catalog.'); return; }
    $('h1').textContent = 'Texture · ' + item.title;
    A.cat.textures = A.cat.textures || {};
    $('#studio').innerHTML = '';
    studio = window.ZBStudio.openTexture($('#studio'), { catalog: A.cat, item, upload: Z.uploadImage, onChange: () => Z.markDirty() });
  }

  /* ---------- Burr guides: one per burr size ---------- */
  async function showGuides(sub) {
    const C = A.cat, sz = (C.sizes.find((s) => s.key === sub) || C.sizes[0] || {}).key;
    A.onSave = async () => { await saveCat(); }; A.onDiscard = () => { A.cat = clone(A.catSaved); Z.clean(); showGuides(sz); };
    const bs = C.burrs.filter((b) => b.size === sz), gs = C.grinders.filter((g) => g.size === sz);
    const cols = [['fit.m.espresso', 'Espresso'], ['fit.m.filter', 'Pour over'], ['fit.m.both', 'Both'], ['fit.m.turbo', 'Turbo'], ['fit.t.clarity', 'Clarity'], ['fit.t.sweet', 'Sweet'], ['fit.t.body', 'Body'], ['fit.r.light', 'Light'], ['fit.r.medium', 'Medium'], ['fit.r.dark', 'Dark'], ['fit.processed', 'Processed'], ['fit.forgiving', 'Easy dial-in']];
    body().innerHTML = head('Burr guides', 'One guide per burr size. Fit scores decide how the Burr Guide ranks burrs on the Burr Guide page and in "Help me choose" in every builder on that size.', '<button class="btn primary" id="gsave">Save</button>') + `
      <div class="tabs" role="tablist">${C.sizes.map((s) => `<button role="tab" data-gs="${esc(s.key)}" aria-selected="${s.key === sz}">${esc(s.name)}</button>`).join('')}</div>
      <div class="card"><h2>Grinders on ${esc(sz)} burrs</h2>${gs.length ? gs.map((g) => `<div class="field"><label for="gd-${esc(g.key)}">${esc(g.name)}: line under its card</label><input type="text" id="gd-${esc(g.key)}" data-gd="${esc(g.key)}" value="${esc((g.guide || {}).desc || '')}"></div>`).join('') : '<p class="muted">No grinder uses this size yet, so the guide for it does not show on the store.</p>'}</div>
      <div class="card flush"><div style="padding:12px 16px"><h2>Fit scores</h2><p class="sub" style="margin:0">0 to 3. Click a burr name to edit its copy.</p></div><div class="scroll"><table class="list mat"><thead><tr><th>Burr</th>${cols.map(([, n]) => `<th>${n}</th>`).join('')}<th>Show</th></tr></thead><tbody>
      ${bs.map((b) => `<tr data-b="${esc(b.key)}"><td><a href="#/catalog/burrs/${esc(sz)}/${esc(b.key)}" data-ed="${esc(b.key)}">${esc(b.name)}</a></td>${cols.map(([p]) => `<td><input type="number" step="0.5" data-sc="${p}" value="${getP(b, p) ?? ''}" aria-label="${esc(b.name)} ${p}"></td>`).join('')}
        <td><label class="switch"><input type="checkbox" data-hid ${b.hidden ? '' : 'checked'} aria-label="Show ${esc(b.name)}"></label></td></tr>`).join('')}
      </tbody></table></div></div>
      <div class="pv"><div class="pvh"><b>Live preview</b><span><button class="btn sm" id="gpv">Refresh preview</button></span></div><div class="pvb guidepv" id="gprev"></div></div>`;
    $('#gsave').onclick = saveCat;
    $$('[data-gs]').forEach((b) => { b.onclick = () => { history.replaceState(null, '', '#/guides/' + b.dataset.gs); showGuides(b.dataset.gs); }; });
    $$('[data-gd]').forEach((el) => { el.oninput = () => { const g = C.grinders.find((x) => x.key === el.dataset.gd); g.guide = { ...(g.guide || {}), desc: el.value }; Z.markDirty(); }; });
    $$('tr[data-b]').forEach((tr) => {
      const b = bs.find((x) => x.key === tr.dataset.b);
      $$('[data-sc]', tr).forEach((el) => { el.oninput = () => { setP(b, el.dataset.sc, parseFloat(el.value) || 0); Z.markDirty(); }; });
      $('[data-hid]', tr).onchange = (e) => { b.hidden = !e.target.checked; Z.markDirty(); };
    });
    $$('[data-ed]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); if (Z.go('catalog', `burrs/${sz}/${a.dataset.ed}`) === false) return; }; });
    $('#gpv').onclick = () => guidePreview(sz);
    guidePreview(sz);
  }
  async function guidePreview(sz) {
    const box = $('#gprev'); if (!box) return;
    if (!window.ZernoBurrGuide) { box.innerHTML = errBox('The Burr Guide preview did not load.'); return; }
    const s = A.cat.sizes.find((x) => x.key === sz) || {};
    let shop = null;
    try {
      const prods = await Z.productsByHandles(s.products || []);
      shop = { [sz]: prods.flatMap((p) => p.variants.nodes.map(Z.toVariant)).map((v) => ({ id: v.id, title: v.title, price: v.price, available: v.available, img: null, url: '#' })) };
    } catch (e) { /* the guide shows catalog burrs without prices */ }
    box.innerHTML = '<div data-zbg-root data-zbg-width="section" style="--zb-ink:#0a0b0d;--zb-stage:#17191d;--zb-fg:#eceae6;--zb-accent:#c08a4e;--zb-sticky:0px"></div>';
    try { new window.ZernoBurrGuide(box.firstChild, { mode: 'page', size: sz, catalog: A.cat, shop, assetBase: 'preview/catalog.js', heading: 'Burr guide', cartAddUrl: '#', money: Z.money }); }
    catch (e) { box.innerHTML = errBox(e); }
  }

  window.ZBAdminCatalog = { showCatalog, showGuides };
})();
