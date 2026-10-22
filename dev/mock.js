/* Local test double for Shopify admin: answers the admin's GraphQL calls from test data.
   Loaded only with ?mock in the URL (test/admin.js). Never used inside Shopify. */
(() => {
  const F = window.ZBA_FIXTURE;
  const P = (n) => `gid://shopify/Product/${n}`, V = (n) => `gid://shopify/ProductVariant/${n}`;
  const products = [];
  const mk = (id, handle, title, img, opts, vs) => products.push({ id: P(id), title, handle, templateSuffix: null, featuredMedia: { preview: { image: { url: img } } }, options: opts,
    variants: { nodes: vs.map((v) => ({ id: V(v.id), title: v.title, price: (v.price / 100).toFixed(2), availableForSale: v.available !== false, image: v.image ? { url: v.image } : null, selectedOptions: v.sel || [{ name: 'Title', value: v.title }], product: null })) } });
  const g = F.grinder;
  mk(g.id, 'zerno-z2', g.title, g.variants[0].image, g.options, g.variants.map((v) => ({ ...v, sel: v.options.map((o, i) => ({ name: g.options[i].name, value: o })) })));
  mk(8148860928176, '80mm-burrs', '80mm Burrs', F.burrs[0].image, [{ name: 'Burr Type', values: F.burrs.map((b) => b.title) }], F.burrs);
  mk(8148860993712, 'z2-accent-pieces', 'Z2 Accent Piece', F.accents[0].image, [{ name: 'Wood', values: F.accents.map((b) => b.title) }], F.accents);
  mk(8148861026480, 'funnel-caps', '58mm Funnel Cap', F.caps[0].image, [{ name: 'Finish', values: F.caps.map((b) => b.title) }], F.caps);
  F.accessories.forEach((a) => mk(a.productId, a.handle, a.title, a.image, [{ name: 'Title', values: [a.variantTitle] }], [{ id: a.variantId, title: a.variantTitle, price: a.price, image: a.image }]));
  products.forEach((p) => p.variants.nodes.forEach((v) => { v.product = { id: p.id, title: p.title, handle: p.handle, featuredMedia: p.featuredMedia }; }));
  const variants = Object.fromEntries(products.flatMap((p) => p.variants.nodes.map((v) => [v.id, v])));
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));

  // two app orders and one ordinary order
  const line = (v, attrs, qty = 1) => ({ title: variants[V(v.id)].product.title, variantTitle: v.title, quantity: qty, customAttributes: Object.entries(attrs).map(([key, value]) => ({ key, value })), originalTotalSet: { shopMoney: { amount: (v.price / 100).toFixed(2) } } });
  const day = (n) => new Date(Date.now() - n * 864e5).toISOString();
  const orders = [
    { id: 'gid://shopify/Order/5001', name: '#1001', createdAt: day(2), displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'UNFULFILLED', currentTotalPriceSet: { shopMoney: { amount: '2649.00', currencyCode: 'USD' } },
      lineItems: { nodes: [line(g.variants[1], { Build: 'Z2-TEST01' }), line(F.burrs[0], { Build: 'Z2-TEST01', Fitting: 'Install in grinder' }), line(F.caps[0], { Build: 'Z2-TEST01', Fitting: 'On the grinder' })] } },
    { id: 'gid://shopify/Order/5002', name: '#1002', createdAt: day(5), displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'FULFILLED', currentTotalPriceSet: { shopMoney: { amount: '350.00', currencyCode: 'USD' } },
      lineItems: { nodes: [line(F.burrs[1], { _source: 'Burr Guide' })] } },
    { id: 'gid://shopify/Order/5003', name: '#1003', createdAt: day(6), displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'FULFILLED', currentTotalPriceSet: { shopMoney: { amount: '99.00', currencyCode: 'USD' } },
      lineItems: { nodes: [line(F.caps[1], {})] } }
  ];

  const store = JSON.parse(sessionStorage.getItem('zba-mock') || '{"mos":[],"n":1}');
  const persist = () => sessionStorage.setItem('zba-mock', JSON.stringify(store));
  window.ZBA_MOCK = { store, products, calls: [], uploads: [] };
  const byHandle = (type, handle) => store.mos.find((x) => x.type === type && x.handle === handle) || null;
  const answer = (q, v) => {
    window.ZBA_MOCK.calls.push(q.replace(/\s+/g, ' ').slice(0, 60));
    if (/metaobjectCreate/.test(q)) { const m = { id: `gid://shopify/Metaobject/${store.n++}`, type: v.m.type, handle: v.m.handle, updatedAt: new Date().toISOString(), fields: v.m.fields }; store.mos.push(m); persist(); return { metaobjectCreate: { metaobject: m, userErrors: [] } }; }
    if (/metaobjectUpdate/.test(q)) { const m = store.mos.find((x) => x.id === v.id); v.f.forEach((f) => { const o = m.fields.find((x) => x.key === f.key); if (o) o.value = f.value; else m.fields.push(f); }); m.updatedAt = new Date().toISOString(); persist(); return { metaobjectUpdate: { metaobject: m, userErrors: [] } }; }
    if (/metaobjectDelete/.test(q)) { store.mos = store.mos.filter((x) => x.id !== v.id); persist(); return { metaobjectDelete: { userErrors: [] } }; }
    if (/metaobjectUpsert/.test(q)) { let m = byHandle(v.h.type, v.h.handle); if (!m) { m = { id: `gid://shopify/Metaobject/${store.n++}`, type: v.h.type, handle: v.h.handle, fields: [] }; store.mos.push(m); } m.fields = v.m.fields; m.updatedAt = new Date().toISOString(); persist(); return { metaobjectUpsert: { metaobject: m, userErrors: [] } }; }
    if (/c: metaobjectByHandle/.test(q)) return { c: byHandle('$app:catalog', 'main'), g: byHandle('$app:burr_guide', 'main') };
    if (/metaobjects\(type:"(\$app:[a-z_]+)"/.test(q)) { const t = q.match(/metaobjects\(type:"(\$app:[a-z_]+)"/)[1]; return { metaobjects: { nodes: store.mos.filter((x) => x.type === t) } }; }
    if (/productVariantsBulkUpdate/.test(q)) { v.v.forEach((x) => { variants[x.id].price = x.price; }); return { productVariantsBulkUpdate: { userErrors: [] } }; }
    if (/files\(first/.test(q)) {
      const all = ['z2-jet-black.jpg', 'z1-jet-black.jpg', 'burr-core-blind.png', 'burr-ssp-brew-blind.png', 'incl-cup.png'].map((f, i) => ({ id: `gid://shopify/MediaImage/${900 + i}`, alt: f, image: { url: `/extensions/zerno-builder/assets/${f}`, width: 1000, height: 1000 } }));
      const term = (v.q || '').replace('media_type:IMAGE', '').trim().toLowerCase();
      return { files: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: all.filter((n) => !term || n.image.url.toLowerCase().includes(term)) } };
    }
    if (/orders\(/.test(q)) return { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: orders } };
    if (/nodes\(ids/.test(q)) return { nodes: v.ids.map((id) => variants[id] || byId[id] || null) };
    if (/products\((first|last)/.test(q)) {
      const qq = v.q || '', hs = [...qq.matchAll(/handle:([\w-]+)/g)].map((m) => m[1]), term = qq.replace(/\(?handle:[\w-]+( OR )?\)?/g, '').replace(/\*/g, '').trim().toLowerCase();
      const list = products.filter((p) => (!hs.length || hs.includes(p.handle)) && (!term || p.title.toLowerCase().includes(term))).map((p) => ({ status: 'ACTIVE', productType: 'Grinder parts', vendor: 'Zerno', ...p }));
      return { products: { pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null }, nodes: list } };
    }
    if (/node\(id:\$id\)\{ \.\.\. on Product/.test(q)) { const p = byId[v.id]; return { node: p ? { status: 'ACTIVE', productType: 'Grinder parts', vendor: 'Zerno', ...p } : null }; }
    throw new Error('mock: unhandled query ' + q.slice(0, 80));
  };
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, init) => {
    if (String(url).startsWith('shopify:admin')) {
      const { query, variables } = JSON.parse(init.body);
      try { return new Response(JSON.stringify({ data: answer(query, variables || {}) }), { headers: { 'Content-Type': 'application/json' } }); }
      catch (e) { return new Response(JSON.stringify({ errors: [{ message: e.message }] })); }
    }
    return realFetch(url, init);
  };
  // Shopify Files stand-in: uploads become data URLs
  window.ZBA_UPLOAD = (blob, filename) => new Promise((res) => { const r = new FileReader(); r.onload = () => { window.ZBA_MOCK.uploads.push(filename); res(r.result); }; r.readAsDataURL(blob); });
  window.shopify = {
    toast: { show: (m) => { window.ZBA_MOCK.lastToast = m; const t = document.getElementById('toast'); t.textContent = m; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 1500); } },
    resourcePicker: async ({ type }) => (type === 'variant' ? [{ id: V(F.burrs[0].id) }] : [{ id: P(g.id), handle: 'zerno-z2' }])
  };
})();
