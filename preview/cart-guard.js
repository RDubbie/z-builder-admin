/* Zerno Builder cart guard (app embed). A grinder from the builder keeps one burr set and one accent piece: the lines the
   builder tags `_zb: required`. They cannot be removed or changed on their own; removing the grinder removes them (they
   are nested under it). Extra burr sets, extra pieces, the case and other accessories stay removable.
   One grinder per cart: a builder grinder, or a catalog grinder added from any page, can't be joined by a second one.
   Works with any theme: it hides the controls it recognizes and refuses the cart change itself as a safety net. */
(() => {
  if (window.ZernoCartGuard) return;
  const root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
  const cfg = window.ZernoCartGuardText || {};
  const MSG = cfg.locked || 'Bundled with your grinder. Remove the grinder to remove it.';
  const NOTE = cfg.note || 'Bundled with your grinder';
  const ONE = cfg.oneGrinder || 'Your cart already has a grinder. Check out or remove it before adding another.';
  const GH = new Set(cfg.grinderHandles || []), GV = new Set((cfg.grinderVariants || []).map(String));
  let cart = null;

  const zb = (it) => (it && it.properties && it.properties._zb) || '';
  const buildOf = (it) => (it && it.properties && (it.properties._build || it.properties.Build)) || '';
  const grinderFor = (it) => cart && cart.items.find((g) => zb(g) === 'grinder' && ((it.parent_relationship && it.parent_relationship.parent_key === g.key) || (buildOf(g) && buildOf(g) === buildOf(it))));
  // locked: a required part whose grinder is still in the cart
  const locked = (it) => zb(it) === 'required' && !!grinderFor(it);
  const isGrinder = (it) => zb(it) === 'grinder' || GH.has(it.handle) || GV.has(String(it.variant_id));
  const fixedQty = (it) => locked(it) || isGrinder(it);
  const grinderUnits = () => (cart && cart.items ? cart.items.filter(isGrinder).reduce((n, it) => n + it.quantity, 0) : 0);
  // a grinder's quantity can go down or to zero, never up; a locked part can't change at all
  const badQty = (it, q) => q !== it.quantity && (isGrinder(it) ? q > it.quantity : locked(it));

  const realFetch = window.fetch.bind(window);
  async function load() {
    try { cart = await (await realFetch(root + 'cart.js', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })).json(); } catch (e) { /* keep the old copy */ }
    paint(); return cart;
  }

  /* ---------- hide the controls on locked lines ---------- */
  const style = document.createElement('style');
  style.textContent = `
    .zb-locked .cart-items__remove, .zb-locked cart-remove-button, .zb-locked .cart-item__remove, .zb-locked [data-cart-remove],
    .zb-locked a[href*="/cart/change"], .zb-fixed .quantity-selector, .zb-fixed quantity-selector-component, .zb-fixed cart-quantity-selector-component,
    .zb-fixed quantity-input, .zb-fixed .quantity { display: none !important; }
    .zb-lock-note { display: block; font-size: .8em; opacity: .7; margin-top: 4px; }`;
  document.head.appendChild(style);

  function rowsFor(it, i) {
    const out = new Set();
    document.querySelectorAll(`[data-key="${CSS.escape(it.key)}"]`).forEach((r) => out.add(r));
    [`CartItem-${i + 1}`, `CartDrawer-Item-${i + 1}`].forEach((id) => { const r = document.getElementById(id); if (r) out.add(r); });
    return [...out].filter((r) => r.tagName !== 'INPUT');
  }
  function paint() {
    if (!cart || !cart.items) return;
    cart.items.forEach((it, i) => {
      rowsFor(it, i).forEach((r) => {
        const l = locked(it), f = fixedQty(it);
        r.classList.toggle('zb-locked', l); r.classList.toggle('zb-fixed', f);
        const has = r.querySelector('.zb-lock-note');
        if (l && !has) {
          const n = document.createElement('small'); n.className = 'zb-lock-note'; n.textContent = NOTE;
          (r.querySelector('.cart-items__quantity-controls, .cart-item__quantity-wrapper, .cart-item__quantity, .cart-items__quantity') || r.querySelector('td:last-child') || r).appendChild(n);
        } else if (!l && has) has.remove();
      });
    });
  }
  let t = 0;
  new MutationObserver(() => { cancelAnimationFrame(t); t = requestAnimationFrame(paint); }).observe(document.documentElement, { childList: true, subtree: true });

  /* ---------- refuse a change that would take a locked part off the grinder ---------- */
  const target = (key, line) => {
    if (!cart) return null;
    if (line) return cart.items[+line - 1] || null;
    if (key == null) return null;
    return cart.items.find((it) => it.key === String(key)) || cart.items.find((it) => String(it.variant_id) === String(key)) || null;
  };
  function readBody(body) {
    if (!body) return {};
    if (typeof body === 'string') { try { return JSON.parse(body); } catch (e) { return Object.fromEntries(new URLSearchParams(body)); } }
    if (body instanceof FormData || body instanceof URLSearchParams) { const o = {}; body.forEach((v, k) => { o[k] = v; }); return o; }
    return {};
  }
  const why = (it) => (isGrinder(it) ? ONE : MSG);
  // grinder units an add request carries (JSON items, a single id, or a product form's fields)
  function addedGrinders(b) {
    const list = Array.isArray(b.items) ? b.items : b.id != null ? [{ id: b.id, quantity: b.quantity, properties: b.properties || { _zb: b['properties[_zb]'] } }] : [];
    return list.reduce((n, i) => n + ((i.properties && i.properties._zb === 'grinder') || GV.has(String(i.id)) ? Math.max(1, +i.quantity || 1) : 0), 0);
  }
  // returns the message when the change is refused, else null
  function refused(url, body) {
    const path = String(url).split('?')[0];
    if (/\/cart\/add(\.js)?$/.test(path)) {
      const n = addedGrinders(readBody(body));
      if (n && grinderUnits() + n > 1) return ONE;
    }
    if (/\/cart\/change(\.js)?$/.test(path)) {
      const b = readBody(body), it = target(b.id, b.line), q = b.quantity != null ? +b.quantity : null;
      if (it && q != null && badQty(it, q)) return why(it);
    }
    if (/\/cart\/update(\.js)?$/.test(path)) {
      const b = readBody(body), u = b.updates;
      if (u && typeof u === 'object') {
        const pairs = Array.isArray(u) ? u.map((q, i) => [cart && cart.items[i] && cart.items[i].key, q]) : Object.entries(u);
        for (const [k, q] of pairs) { const it = target(k); if (it && badQty(it, +q)) return why(it); }
      }
    }
    return null;
  }
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (/\/cart\/(add|change|update)(\.js)?(\?|$)/.test(url)) {
      // an add checks the cart as it is now (it may have changed in another tab)
      if (!cart || /\/cart\/add/.test(url)) await load();
      const m = refused(url, init.body);
      if (m) {
        document.dispatchEvent(new CustomEvent('zerno:cart:locked', { detail: { message: m } }));
        return new Response(JSON.stringify({ status: 422, message: m, description: m, errors: m }), { status: 422, headers: { 'Content-Type': 'application/json' } });
      }
    }
    const res = await realFetch(input, init);
    if (/\/cart(\/(add|change|update|clear))?(\.js)?(\?|$)/.test(url)) setTimeout(load, 0);
    return res;
  };
  // the theme's own forms (no JavaScript): refuse a second grinder, or a submit that empties a locked line
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (!(f instanceof HTMLFormElement)) return;
    const path = new URL(f.action, location.href).pathname;
    if (/\/cart\/add$/.test(path)) {
      const b = Object.fromEntries(new FormData(f));
      if (addedGrinders(b) && grinderUnits() + addedGrinders(b) > 1) { e.preventDefault(); e.stopImmediatePropagation(); alert(ONE); }
      return;
    }
    if (!/\/cart(\/update|\/change)?$/.test(path)) return;
    const fd = new FormData(f); const updates = {};
    fd.forEach((v, k) => { const m = /^updates\[(.*)\]$/.exec(k); if (m) updates[m[1]] = v; });
    const all = fd.getAll('updates[]'); all.forEach((v, i) => { if (cart && cart.items[i]) updates[cart.items[i].key] = v; });
    for (const [k, q] of Object.entries(updates)) { const it = target(k); if (it && badQty(it, +q)) { e.preventDefault(); alert(why(it)); return; } }
  }, true);

  window.ZernoCartGuard = { load, paint, locked, isGrinder, get cart() { return cart; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load); else load();
})();
