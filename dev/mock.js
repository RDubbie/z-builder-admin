/* Local test double for Shopify admin: answers the admin's GraphQL calls from test data.
   Loaded only with ?mock in the URL (test/admin.js). Never used inside Shopify. */
(() => {
  const F = window.ZBA_FIXTURE;
  const P = (n) => `gid://shopify/Product/${n}`, V = (n) => `gid://shopify/ProductVariant/${n}`;
  const products = [];
  const mk = (id, handle, title, img, opts, vs) => products.push({ id: P(id), title, handle, featuredMedia: { preview: { image: { url: img } } }, options: opts,
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
  const store = JSON.parse(sessionStorage.getItem('zba-mock') || '{"mos":[],"n":1}');
  const persist = () => sessionStorage.setItem('zba-mock', JSON.stringify(store));
  window.ZBA_MOCK = { store, products, calls: [] };
  const answer = (q, v) => {
    window.ZBA_MOCK.calls.push(q.replace(/\s+/g, ' ').slice(0, 60));
    if (/metaobjectCreate/.test(q)) { const m = { id: `gid://shopify/Metaobject/${store.n++}`, type: v.m.type, handle: v.m.handle, updatedAt: new Date().toISOString(), fields: v.m.fields }; store.mos.push(m); persist(); return { metaobjectCreate: { metaobject: m, userErrors: [] } }; }
    if (/metaobjectUpdate/.test(q)) { const m = store.mos.find((x) => x.id === v.id); v.f.forEach((f) => { const o = m.fields.find((x) => x.key === f.key); if (o) o.value = f.value; else m.fields.push(f); }); m.updatedAt = new Date().toISOString(); persist(); return { metaobjectUpdate: { metaobject: m, userErrors: [] } }; }
    if (/metaobjectDelete/.test(q)) { store.mos = store.mos.filter((x) => x.id !== v.id); persist(); return { metaobjectDelete: { userErrors: [] } }; }
    if (/metaobjectUpsert/.test(q)) { let m = store.mos.find((x) => x.type === v.h.type && x.handle === v.h.handle); if (!m) { m = { id: `gid://shopify/Metaobject/${store.n++}`, type: v.h.type, handle: v.h.handle, fields: [] }; store.mos.push(m); } m.fields = v.m.fields; persist(); return { metaobjectUpsert: { metaobject: m, userErrors: [] } }; }
    if (/metaobjectByHandle/.test(q)) return { metaobjectByHandle: store.mos.find((x) => x.type === '$app:burr_guide' && x.handle === 'main') || null };
    if (/metaobjects\(type:"\$app:option_set"/.test(q)) return { metaobjects: { nodes: store.mos.filter((x) => x.type === '$app:option_set') } };
    if (/productVariantsBulkUpdate/.test(q)) { v.v.forEach((x) => { variants[x.id].price = x.price; }); return { productVariantsBulkUpdate: { userErrors: [] } }; }
    if (/nodes\(ids/.test(q)) return { nodes: v.ids.map((id) => variants[id] || byId[id] || null) };
    if (/products\(first/.test(q)) { const hs = [...v.q.matchAll(/handle:([\w-]+)/g)].map((m) => m[1]); return { products: { nodes: products.filter((p) => hs.includes(p.handle)) } }; }
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
  window.shopify = {
    toast: { show: (m) => { window.ZBA_MOCK.lastToast = m; const t = document.getElementById('toast'); t.textContent = m; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 1500); } },
    resourcePicker: async ({ type }) => (type === 'variant' ? [{ id: V(F.burrs[0].id) }] : [{ id: P(g.id) }])
  };
})();
