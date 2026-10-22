/* Zerno Builder admin: Art studio.
 * The team makes every overlay for a grinder here, from their own photos: cut out the grinder, mark the front
 * assembly, the accent piece, the funnel cap and the burr chamber, mold the wood onto the accent piece, and save.
 * The studio renders the same files the builder reads (see replica/art-studio.md), uploads them with opts.upload
 * and writes grinder.art (source "files") and grinder.geom. openTexture sets which part of an accent or cap
 * product photo becomes the texture (catalog.textures).
 *
 * Auto cut-out uses OpenCV.js GrabCut, loaded the first time it is needed. Edges end as vector paths, so they
 * stay crisp at any size and every point can be moved.
 */
(() => {
  'use strict';
  const CV_URL = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js';
  const MAX_SIDE = 2000, WORK = 640, REFINE = 1400, SHADE_MAX = 1.4;
  const COL = { mask: '#2c6ecb', front: '#e8a33a', knob: '#ff6a3d', cap: '#9b6bff', face: '#2bd18a' };
  const BAND = [0.08, 0.40, 0.84, 0.20];
  const STEPS = [
    { k: 'photo', n: 'Photo', d: 'One photo per color' },
    { k: 'mask', n: 'Cut out grinder', d: 'Remove the background' },
    { k: 'front', n: 'Front assembly', d: 'The part that opens' },
    { k: 'knob', n: 'Accent piece', d: 'Where the wood shows' },
    { k: 'cap', n: 'Funnel cap', d: 'The cap on the funnel' },
    { k: 'face', n: 'Burr chamber', d: 'What shows when open' },
    { k: 'save', n: 'Preview and save', d: 'Check and publish' }
  ];

  /* ---------- small helpers ---------- */
  const $ = (s, el) => el.querySelector(s);
  const $$ = (s, el) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const r2 = (v) => Math.round(v * 100) / 100;
  const deg = (r) => r * 180 / Math.PI, rad = (d) => d * Math.PI / 180;
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  const ctxR = (c) => c.getContext('2d', { willReadFrequently: true });
  function copyCanvas(src) { if (!src) return null; const c = canvas(src.width, src.height); c.getContext('2d').drawImage(src, 0, 0); return c; }
  function loadImage(url) {
    return new Promise((res, rej) => {
      const i = new Image();
      if (!/^(data|blob):/.test(url)) i.crossOrigin = 'anonymous';
      i.onload = () => res(i); i.onerror = () => rej(new Error('Could not load the image. Upload the file instead.'));
      i.src = url;
    });
  }
  const toBlob = (c, type = 'image/png', q) => new Promise((res) => c.toBlob(res, type, q));
  const pickFile = () => new Promise((res) => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = () => res(i.files[0] || null); i.click(); });
  function imageCanvas(img, W, H) {
    const nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height;
    if (!W) { const k = Math.min(1, MAX_SIDE / Math.max(nw, nh)); W = Math.round(nw * k); H = Math.round(nh * k); }
    const c = canvas(W, H); const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, W, H); return c;
  }
  function readRGBA(src, w, h) { const c = canvas(w, h), x = ctxR(c); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, w, h); return x.getImageData(0, 0, w, h).data; }
  function bbox(c, thr = 8) {
    if (!c) return null;
    const d = ctxR(c).getImageData(0, 0, c.width, c.height).data, w = c.width, h = c.height;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) { const o = y * w * 4; for (let x = 0; x < w; x++) if (d[o + x * 4 + 3] > thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; } }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  /* the builder's frame for a set of colors: the union of the cut-outs, with room above for the funnel */
  function cropOf(list) {
    let X0 = Infinity, Y0 = Infinity, X1 = 0, Y1 = 0; const W = list[0].photo.width, H = list[0].photo.height;
    list.forEach((F) => { const b = bbox(F.layers.mask); if (b) { X0 = Math.min(X0, b.x); Y0 = Math.min(Y0, b.y); X1 = Math.max(X1, b.x + b.w); Y1 = Math.max(Y1, b.y + b.h); } });
    if (X1 <= 0) return { X0: 0, Y0: 0, BW: W, BH: H };
    X0 = Math.max(0, Math.floor(X0 - W * 0.004)); Y0 = Math.max(0, Math.floor(Y0 - H * 0.02)); X1 = Math.min(W, Math.ceil(X1 + W * 0.004)); Y1 = Math.min(H, Math.ceil(Y1 + H * 0.004));
    return { X0, Y0, BW: X1 - X0, BH: Y1 - Y0 };
  }
  function combine(a, b, op) { const c = copyCanvas(a); if (!b) return c; const x = c.getContext('2d'); x.globalCompositeOperation = op; x.drawImage(b, 0, 0, c.width, c.height); return c; }
  function tint(mask, color) { const c = canvas(mask.width, mask.height), x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, c.width, c.height); x.globalCompositeOperation = 'destination-in'; x.drawImage(mask, 0, 0); return c; }
  function masked(photo, mask) { const c = copyCanvas(photo); if (!mask) return c; const x = c.getContext('2d'); x.globalCompositeOperation = 'destination-in'; x.drawImage(mask, 0, 0, c.width, c.height); return c; }
  function ellipseMask(E, W, H) { const c = canvas(W, H), x = c.getContext('2d'); x.fillStyle = '#fff'; x.beginPath(); x.ellipse(E.cx, E.cy, Math.max(1, E.rx), Math.max(1, E.ry), E.a, 0, Math.PI * 2); x.fill(); return c; }

  /* ---------- texture square and mesh: the same math as the builder (shared/engine/builder.js) ---------- */
  function texSquare(img, tex, crop) {
    if (window.ZernoBuilderDraw) return window.ZernoBuilderDraw.texSquare(img, tex, crop);
    const nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height;
    let sx, sy, sw, sh;
    if (tex && Array.isArray(tex.crop)) { sx = tex.crop[0] * nw; sy = tex.crop[1] * nh; sw = tex.crop[2] * nw; sh = tex.crop[3] * nh; }
    else { const side = Math.min(nw, nh) * (crop || 1); sx = (nw - side) / 2; sy = (nh - side) / 2; sw = sh = side; }
    const T = Math.max(64, Math.min(1024, Math.round(Math.max(sw, sh)))), c = canvas(T, T), x = c.getContext('2d'), r = rad((tex && +tex.rot) || 0);
    x.translate(T / 2, T / 2);
    if (r) { x.rotate(r); const k = Math.abs(Math.cos(r)) + Math.abs(Math.sin(r)); x.scale(k, k); }
    x.drawImage(img, sx, sy, sw, sh, -T / 2, -T / 2, T, T);
    return c;
  }
  function meshTri(ctx, img, s0, s1, s2, d0, d1, d2) {
    const [x0, y0] = s0, [x1, y1] = s1, [x2, y2] = s2, [u0, v0] = d0, [u1, v1] = d1, [u2, v2] = d2;
    const den = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1); if (!den) return;
    const cx = (u0 + u1 + u2) / 3, cy = (v0 + v1 + v2) / 3;
    const grow = (u, v) => { const dx = u - cx, dy = v - cy, l = Math.hypot(dx, dy) || 1; return [u + dx / l * 0.75, v + dy / l * 0.75]; };
    ctx.save(); ctx.beginPath(); ctx.moveTo(...grow(u0, v0)); ctx.lineTo(...grow(u1, v1)); ctx.lineTo(...grow(u2, v2)); ctx.closePath(); ctx.clip();
    ctx.transform((u0 * (y1 - y2) + u1 * (y2 - y0) + u2 * (y0 - y1)) / den, (v0 * (y1 - y2) + v1 * (y2 - y0) + v2 * (y0 - y1)) / den,
      (u0 * (x2 - x1) + u1 * (x0 - x2) + u2 * (x1 - x0)) / den, (v0 * (x2 - x1) + v1 * (x0 - x2) + v2 * (x1 - x0)) / den,
      (u0 * (x1 * y2 - x2 * y1) + u1 * (x2 * y0 - x0 * y2) + u2 * (x0 * y1 - x1 * y0)) / den, (v0 * (x1 * y2 - x2 * y1) + v1 * (x2 * y0 - x0 * y2) + v2 * (x0 * y1 - x1 * y0)) / den);
    ctx.drawImage(img, 0, 0); ctx.restore();
  }
  function drawMesh(ctx, src, mesh, W, H, sx = 0, sy = 0, sw = src.width, sh = src.height) {
    if (window.ZernoBuilderDraw) return window.ZernoBuilderDraw.drawMesh(ctx, src, mesh, W, H, sx, sy, sw, sh);
    const n = mesh.n, P = mesh.pts, at = (i, j) => P[j * (n + 1) + i];
    const S = (i, j) => [sx + (i / n) * sw, sy + (j / n) * sh], D = (i, j) => [at(i, j)[0] * W, at(i, j)[1] * H];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      meshTri(ctx, src, S(i, j), S(i + 1, j), S(i + 1, j + 1), D(i, j), D(i + 1, j), D(i + 1, j + 1));
      meshTri(ctx, src, S(i, j), S(i + 1, j + 1), S(i, j + 1), D(i, j), D(i + 1, j + 1), D(i, j + 1));
    }
  }
  // the builder's shading: multiply by D, then add texture x L for highlights
  function shade(ctx, W, H, D, L) {
    const off = canvas(W, H), o = off.getContext('2d');
    o.drawImage(ctx.canvas, 0, 0);
    o.globalCompositeOperation = 'multiply'; o.drawImage(L, 0, 0, W, H);
    o.globalCompositeOperation = 'destination-in'; o.drawImage(L, 0, 0, W, H);
    ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(D, 0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = SHADE_MAX - 1; ctx.drawImage(off, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(D, 0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }
  const gridUV = (n) => { const p = []; for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) p.push([i / n - 0.5, j / n - 0.5]); return p; };
  const gridFr = (n) => { const p = []; for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) p.push([i / n, j / n]); return p; };
  function ellPoint(E, u, v) { const w = 2 * E.rx, h = 2 * E.ry, c = Math.cos(E.a), s = Math.sin(E.a); return [E.cx + u * w * c - v * h * s, E.cy + u * w * s + v * h * c]; }
  function ellLocal(E, X, Y) { const dx = X - E.cx, dy = Y - E.cy, c = Math.cos(E.a), s = Math.sin(E.a); return [(dx * c + dy * s) / (2 * E.rx), (-dx * s + dy * c) / (2 * E.ry)]; }

  /* ---------- how the front opens: grinder.geom.hinge, the same fields and timing as the builder ---------- */
  function hingeFrom(geom, slug) {
    const h = (geom && geom.hinge) || {}, mode = h.mode || 'swing', g0 = (geom && geom[slug]) || {};
    return { mode, angle: h.angle != null ? +h.angle : -25, pivotPct: Array.isArray(h.pivot) ? h.pivot.map(Number) : null, pivotPx: null,
      dist: h.dist != null ? +h.dist : mode === 'slide' && g0.open ? +g0.open : 10, dir: h.dir != null ? +h.dir : null, ms: h.ms ? +h.ms : 1800 };
  }
  // cubic-bezier(x1, y1, x2, y2) easing, solved for x
  function bezier(x1, y1, x2, y2) {
    const A = (a, b) => 1 - 3 * b + 3 * a, B = (a, b) => 3 * b - 6 * a, C = (a) => 3 * a;
    const at = (t, a, b) => ((A(a, b) * t + B(a, b)) * t + C(a)) * t, slope = (t, a, b) => 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a);
    return (x) => { let t = x; for (let i = 0; i < 8; i++) { const d = slope(t, x1, x2); if (!d) break; t -= (at(t, x1, x2) - x) / d; } return at(clamp(t, 0, 1), y1, y2); };
  }
  const SETTLE = bezier(0.5, 0, 0.3, 1);
  const lerpPose = (a, b, t) => ({ rot: (a.rot || 0) + ((b.rot || 0) - (a.rot || 0)) * t, tx: (a.tx || 0) + ((b.tx || 0) - (a.tx || 0)) * t, ty: (a.ty || 0) + ((b.ty || 0) - (a.ty || 0)) * t });
  /* the builder's front keyframes: hold to 14%, open by 34%, hold to 70%, overshoot by 86%, settle to 100% */
  function poseAt(p, P1, P2) {
    const P0 = { rot: 0, tx: 0, ty: 0 };
    if (p <= 0.14) return P0;
    if (p <= 0.34) return lerpPose(P0, P1, (p - 0.14) / 0.2);
    if (p <= 0.7) return lerpPose(P1, P1, 0);
    if (p <= 0.86) return lerpPose(P1, P2, (p - 0.7) / 0.16);
    return lerpPose(P2, P0, SETTLE((p - 0.86) / 0.14));
  }
  // the chamber fades in while the front is open: 0 to 16%, in by 30%, out from 76% to 86%
  function chamberAt(p) { return p < 0.16 ? 0 : p < 0.3 ? (p - 0.16) / 0.14 : p < 0.76 ? 1 : p < 0.86 ? 1 - (p - 0.76) / 0.1 : 0; }

  /* ---------- OpenCV.js, loaded on first use ---------- */
  let cvP = null;
  function loadCV() {
    if (cvP) return cvP;
    cvP = new Promise((res, rej) => {
      const settle = () => {
        const c = window.cv;
        if (!c) return rej(new Error('The cut-out tool did not load.'));
        if (c.Mat) return res({ cv: c });
        if (typeof c.then === 'function') return c.then((m) => { window.cv = m; res({ cv: m }); });   // wrap: the module is itself "thenable"
        c.onRuntimeInitialized = () => res({ cv: c });
      };
      if (window.cv) return settle();
      const s = document.createElement('script'); s.src = window.ZBStudioCV_URL || CV_URL; s.async = true;
      s.onload = settle; s.onerror = () => { cvP = null; rej(new Error('The cut-out tool could not load. Check the connection and try again.')); };
      document.head.appendChild(s);
    });
    return cvP;
  }
  function matRGB(cv, img, w, h) { const c = canvas(w, h); c.getContext('2d').drawImage(img, 0, 0, w, h); const m = cv.imread(c); cv.cvtColor(m, m, cv.COLOR_RGBA2RGB); return m; }
  function applyHard(d, w, h, s, o) {
    const R = o.R, rx0 = R.x * s, ry0 = R.y * s, rx1 = (R.x + R.w) * s, ry1 = (R.y + R.h) * s;
    const ha = o.hints ? readRGBA(o.hints, w, h) : null, la = o.limit ? readRGBA(o.limit, w, h) : null;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x < rx0 || x >= rx1 || y < ry0 || y >= ry1) d[i] = 0;
      if (la && la[i * 4 + 3] < 128) d[i] = 0;
      if (ha && ha[i * 4 + 3] > 60) d[i] = ha[i * 4 + 1] > ha[i * 4] ? 1 : 0;
    }
  }
  function ensureBoth(d, w, h) {
    let fg = 0, bg = 0; for (let i = 0; i < d.length; i++) { if (d[i] & 1) fg++; else bg++; }
    if (!fg) throw new Error('Nothing is marked to keep. Paint over the part with the Keep brush, or draw a box around it.');
    if (!bg) { for (let x = 0; x < w; x++) { d[x] = 0; d[(h - 1) * w + x] = 0; } for (let y = 0; y < h; y++) { d[y * w] = 0; d[y * w + w - 1] = 0; } }
  }
  /* Studio backdrops are smooth: flood in from the photo's edges over small color steps. What the flood reaches is
     probably background, which gives GrabCut a much better start than a plain rectangle. Returns null when the
     backdrop is too busy to trust. */
  function backdropSeed(img, w, h, far = 70) {
    const c = canvas(w, h), x = ctxR(c); x.filter = 'blur(1px)'; x.drawImage(img, 0, 0, w, h); x.filter = 'none';
    const d = x.getImageData(0, 0, w, h).data, seen = new Uint8Array(w * h), q = new Int32Array(w * h);
    let head = 0, tail = 0, n = 0, sr = 0, sg = 0, sb = 0, cnt = 0;
    for (let i = 0; i < w; i++) [i, (h - 1) * w + i].forEach((k) => { sr += d[k * 4]; sg += d[k * 4 + 1]; sb += d[k * 4 + 2]; cnt++; });
    for (let j = 0; j < h; j++) [j * w, j * w + w - 1].forEach((k) => { sr += d[k * 4]; sg += d[k * 4 + 1]; sb += d[k * 4 + 2]; cnt++; });
    const mr = sr / cnt, mg = sg / cnt, mb = sb / cnt;
    const push = (k) => { if (!seen[k]) { seen[k] = 1; q[tail++] = k; } };
    for (let i = 0; i < w; i++) { push(i); push((h - 1) * w + i); }
    for (let j = 0; j < h; j++) { push(j * w); push(j * w + w - 1); }
    const step = 5;
    while (head < tail) {
      const k = q[head++], xk = k % w, r = d[k * 4], g = d[k * 4 + 1], b = d[k * 4 + 2];
      if (Math.abs(r - mr) + Math.abs(g - mg) + Math.abs(b - mb) > far * 3) { seen[k] = 2; continue; }   // too far from the backdrop color
      n++;
      const nb = [xk > 0 ? k - 1 : -1, xk < w - 1 ? k + 1 : -1, k - w, k + w];
      for (const m of nb) {
        if (m < 0 || m >= w * h || seen[m]) continue;
        if (Math.max(Math.abs(d[m * 4] - r), Math.abs(d[m * 4 + 1] - g), Math.abs(d[m * 4 + 2] - b)) <= step) push(m);
      }
    }
    if (n < w * h * 0.08) return null;
    return seen;   // 1 = backdrop
  }
  function grab(cv, src, m, iters) { const bg = new cv.Mat(), fg = new cv.Mat(); try { cv.grabCut(src, m, new cv.Rect(0, 0, 1, 1), bg, fg, iters, cv.GC_INIT_WITH_MASK); } finally { bg.delete(); fg.delete(); } }
  /* binary 8U mat (0/255) to rings: [{ pts: [[x, y]...], hole }], in pixels of the full image */
  function ringsOf(cv, bin, { eps = 0.8, scale = 1, keep = 0.04 } = {}) {
    const cs = new cv.MatVector(), hi = new cv.Mat();
    cv.findContours(bin, cs, hi, cv.RETR_CCOMP, cv.CHAIN_APPROX_NONE);
    const n = cs.size(), areas = [], parent = [];
    for (let i = 0; i < n; i++) { const c = cs.get(i); areas.push(Math.abs(cv.contourArea(c))); parent.push(hi.data32S[i * 4 + 3]); c.delete(); }
    const big = Math.max(0, ...areas.filter((a, i) => parent[i] < 0));
    const keepOuter = new Set(); areas.forEach((a, i) => { if (parent[i] < 0 && a >= Math.max(12, big * keep)) keepOuter.add(i); });
    const rings = [];
    for (let i = 0; i < n; i++) {
      const hole = parent[i] >= 0;
      if (hole ? !keepOuter.has(parent[i]) || areas[i] < Math.max(10, big * 0.0015) : !keepOuter.has(i)) continue;
      const c = cs.get(i), ap = new cv.Mat(); cv.approxPolyDP(c, ap, eps, true);
      const pts = []; for (let k = 0; k < ap.rows; k++) pts.push([(ap.data32S[k * 2] + 0.5) * scale, (ap.data32S[k * 2 + 1] + 0.5) * scale]);
      if (pts.length >= 3) rings.push({ pts, hole });
      c.delete(); ap.delete();
    }
    cs.delete(); hi.delete();
    return rings;
  }
  function binOf(cv, src, thr = 128) {
    const w = src.width, h = src.height, d = ctxR(src).getImageData(0, 0, w, h).data, m = new cv.Mat(h, w, cv.CV_8UC1);
    for (let i = 0; i < w * h; i++) m.data[i] = d[i * 4 + 3] >= thr ? 255 : 0;
    return m;
  }
  /* GrabCut at 640px, then again at up to 1400px around the edge, then vector rings at full size. */
  async function autoCut(img, o = {}) {
    const { cv } = await loadCV();
    const W = img.width, H = img.height, R = o.rect || { x: W * 0.01, y: H * 0.01, w: W * 0.98, h: H * 0.98 };
    const s1 = Math.min(1, WORK / Math.max(W, H)), w1 = Math.round(W * s1), h1 = Math.round(H * s1);
    const src1 = matRGB(cv, img, w1, h1), m1 = new cv.Mat(h1, w1, cv.CV_8UC1, new cv.Scalar(0));
    const pa = o.prior ? readRGBA(o.prior, w1, h1) : null, bd = !pa && !o.rect ? backdropSeed(img, w1, h1, o.seedFar) : null;
    for (let i = 0; i < w1 * h1; i++) m1.data[i] = pa ? (pa[i * 4 + 3] >= 128 ? 3 : 2) : bd ? (bd[i] === 1 ? 2 : 3) : 3;
    applyHard(m1.data, w1, h1, s1, { ...o, R });
    try { ensureBoth(m1.data, w1, h1); grab(cv, src1, m1, 5); } catch (e) { src1.delete(); m1.delete(); throw e; }
    const small = canvas(w1, h1), sx = ctxR(small), id = sx.createImageData(w1, h1);
    for (let i = 0; i < w1 * h1; i++) { const f = m1.data[i] & 1; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255; id.data[i * 4 + 3] = f ? 255 : 0; }
    sx.putImageData(id, 0, 0); src1.delete(); m1.delete();
    const s2 = Math.min(1, REFINE / Math.max(W, H)), w2 = Math.round(W * s2), h2 = Math.round(H * s2);
    let fin;
    if (s2 > s1 * 1.15) {
      const up = readRGBA(small, w2, h2), bin = new cv.Mat(h2, w2, cv.CV_8UC1);
      for (let i = 0; i < w2 * h2; i++) bin.data[i] = up[i * 4 + 3] >= 128 ? 255 : 0;
      const r = Math.max(2, Math.round(2.5 * s2 / s1)), k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(2 * r + 1, 2 * r + 1));
      const er = new cv.Mat(), di = new cv.Mat(); cv.erode(bin, er, k); cv.dilate(bin, di, k);
      const m2 = new cv.Mat(h2, w2, cv.CV_8UC1);
      for (let i = 0; i < w2 * h2; i++) m2.data[i] = di.data[i] === 0 ? 0 : er.data[i] ? 1 : (bin.data[i] ? 3 : 2);
      applyHard(m2.data, w2, h2, s2, { ...o, R });
      const bb = cv.boundingRect(di), pad = r + 3;
      const roi = new cv.Rect(Math.max(0, bb.x - pad), Math.max(0, bb.y - pad), 0, 0);
      roi.width = Math.min(w2, bb.x + bb.width + pad) - roi.x; roi.height = Math.min(h2, bb.y + bb.height + pad) - roi.y;
      if (roi.width > 4 && roi.height > 4) {
        const src2 = matRGB(cv, img, w2, h2), sv = src2.roi(roi), sub = sv.clone(), mv = m2.roi(roi), ms = mv.clone();
        let fg = 0, bg = 0; for (let i = 0; i < ms.data.length; i++) { if (ms.data[i] & 1) fg++; else bg++; }
        if (fg && bg) { grab(cv, sub, ms, 2); ms.copyTo(mv); }
        [src2, sv, sub, mv, ms].forEach((x) => x.delete());
      }
      fin = new cv.Mat(h2, w2, cv.CV_8UC1);
      for (let i = 0; i < w2 * h2; i++) fin.data[i] = (m2.data[i] & 1) ? 255 : 0;
      [bin, er, di, m2, k].forEach((x) => x.delete());
    } else {
      fin = binOf(cv, small);
    }
    let rings = ringsOf(cv, fin, { eps: 0.7, scale: W / fin.cols, keep: o.keep == null ? 0.04 : o.keep });
    fin.delete();
    if (o.hull && rings.length) {   // round parts (cap, accent piece): the outline of what was found, with no bites out of it
      const pts = rings.filter((r) => !r.hole).flatMap((r) => r.pts), m = cv.matFromArray(pts.length, 1, cv.CV_32FC2, pts.flat()), hl = new cv.Mat();
      cv.convexHull(m, hl, false, true);
      rings = [{ pts: Array.from({ length: hl.rows }, (_, k) => [hl.data32F[k * 2], hl.data32F[k * 2 + 1]]), hole: false }];
      m.delete(); hl.delete();
    }
    if (!rings.length) throw new Error('The cut-out came back empty. Mark more of the part with the Keep brush.');
    return rings;
  }
  /* product photos: a tighter backdrop seed. Gray or dark items on a dark backdrop keep their parts, where the
     grinder flow's looser seed would let the backdrop color flow into them. */
  async function autoCutBest(img, o = {}) {
    if (o.hints || o.prior || o.rect) return autoCut(img, o);
    try { return await autoCut(img, { ...o, seedFar: 25 }); } catch (e) { return autoCut(img, o); }
  }
  async function vectorize(raster, eps) { const { cv } = await loadCV(); const b = binOf(cv, raster); const r = ringsOf(cv, b, { eps, keep: 0.01 }); b.delete(); return r; }
  function ringPath(p, pts, smooth) {
    const n = pts.length; if (n < 3) return;
    if (!smooth) { p.moveTo(...pts[0]); for (let i = 1; i < n; i++) p.lineTo(...pts[i]); p.closePath(); return; }
    const P = (i) => pts[(i + n) % n];
    // a corner (a turn sharper than 55 degrees) keeps its point; everything else becomes a smooth curve
    const corner = pts.map((q, i) => { const a = P(i - 1), b = P(i + 1); const v1 = [q[0] - a[0], q[1] - a[1]], v2 = [b[0] - q[0], b[1] - q[1]];
      const c = (v1[0] * v2[0] + v1[1] * v2[1]) / ((Math.hypot(...v1) * Math.hypot(...v2)) || 1); return c < Math.cos(rad(55)); });
    const tan = (i) => (corner[(i + n) % n] ? [0, 0] : [(P(i + 1)[0] - P(i - 1)[0]) / 6, (P(i + 1)[1] - P(i - 1)[1]) / 6]);
    p.moveTo(...P(0));
    for (let i = 0; i < n; i++) { const a = P(i), b = P(i + 1), ta = tan(i), tb = tan(i + 1); p.bezierCurveTo(a[0] + ta[0], a[1] + ta[1], b[0] - tb[0], b[1] - tb[1], b[0], b[1]); }
    p.closePath();
  }
  function renderRings(rings, W, H, { smooth = true, feather = 0 } = {}) {
    const c = canvas(W, H), x = c.getContext('2d'), p = new Path2D();
    rings.forEach((r) => ringPath(p, r.pts, smooth));
    x.fillStyle = '#fff'; if (feather > 0.05) x.filter = `blur(${feather}px)`;
    x.fill(p, 'evenodd'); x.filter = 'none';
    return c;
  }

  /* ---------- shading maps (same encoding as tools/export_overlays.py) ---------- */
  function blurF(cv, arr, w, h, sx, sy) {
    const m = cv.matFromArray(h, w, cv.CV_32F, arr), o = new cv.Mat();
    cv.GaussianBlur(m, o, new cv.Size(0, 0), sx, sy || sx, cv.BORDER_REPLICATE);
    const r = new Float32Array(o.data32F); m.delete(); o.delete(); return r;
  }
  function pct(arr, cond, p) { const v = []; for (let i = 0; i < arr.length; i++) if (cond(i)) v.push(arr[i]); if (!v.length) return 1; v.sort((a, b) => a - b); return v[Math.min(v.length - 1, Math.floor(v.length * p))] || 1; }
  function lumOf(photo, x0, y0, w, h) { const d = ctxR(photo).getImageData(x0, y0, w, h).data, L = new Float32Array(w * h); for (let i = 0; i < w * h; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; return L; }
  function shadeMaps(sh, mk, w, h) {
    const D = canvas(w, h), L = canvas(w, h), dd = ctxR(D).createImageData(w, h), ll = ctxR(L).createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const a = clamp(mk[i], 0, 1) * 255, d = clamp(Math.min(sh[i], 1), 0, 1) * 255, l = clamp((sh[i] - 1) / (SHADE_MAX - 1), 0, 1) * 255;
      dd.data[i * 4] = dd.data[i * 4 + 1] = dd.data[i * 4 + 2] = d; dd.data[i * 4 + 3] = a;
      ll.data[i * 4] = ll.data[i * 4 + 1] = ll.data[i * 4 + 2] = l; ll.data[i * 4 + 3] = a;
    }
    ctxR(D).putImageData(dd, 0, 0); ctxR(L).putImageData(ll, 0, 0);
    return { D, L };
  }
  /* accent piece: an S x S square around the ellipse; wood keeps the photo's own light and shadow */
  function knobShade(cv, F, opt) {
    const E = F.knobEll, W = F.photo.width, H = F.photo.height;
    let half = Math.max(E.rx, E.ry) + 8;
    const ex = F.layers.knob ? bbox(F.layers.knob) : null;
    if (ex) [[ex.x, ex.y], [ex.x + ex.w, ex.y], [ex.x, ex.y + ex.h], [ex.x + ex.w, ex.y + ex.h]].forEach(([x, y]) => { half = Math.max(half, Math.abs(x - E.cx) + 2, Math.abs(y - E.cy) + 2); });
    const x0 = Math.round(E.cx - half), y0 = Math.round(E.cy - half), S = Math.round(2 * half);
    const lum = lumOf(F.photo, x0, y0, S, S), km = new Float32Array(S * S), dd = new Float32Array(S * S);
    const c = Math.cos(E.a), s = Math.sin(E.a), ra = Math.max(1, E.rx - 0.6), rb = Math.max(1, E.ry - 0.6), mr = Math.min(E.rx, E.ry);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = x + 0.5 - (E.cx - x0), dy = y + 0.5 - (E.cy - y0), u = dx * c + dy * s, v = -dx * s + dy * c, d = Math.hypot(u / ra, v / rb);
      dd[y * S + x] = d; km[y * S + x] = clamp((1 - d) * mr + 0.5, 0, 1);
    }
    const lk = lum.map((l, i) => l * km[i]), b1 = blurF(cv, lk, S, S, 16), b2 = blurF(cv, km, S, S, 16);
    const ksh = b1.map((v, i) => v / Math.max(b2[i], 1e-3)), p = pct(ksh, (i) => km[i] > 0.5, 0.6);
    const extra = new Float32Array(S * S);
    if (F.layers.knob) {
      const reg = combine(F.layers.knob, F.layers.mask, 'destination-in'), d = ctxR(reg).getImageData(x0, y0, S, S).data;
      for (let i = 0; i < S * S; i++) extra[i] = d[i * 4 + 3] / 255;
    }
    const sh = new Float32Array(S * S), mk = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) {
      let k = clamp(1 + opt.contrast * (ksh[i] / p - 1), 0.65, 1.25); k *= 1 - 0.14 * clamp((dd[i] - 0.9) / 0.1, 0, 1);
      sh[i] = km[i] > 0.02 ? k : opt.side; mk[i] = clamp(km[i] + extra[i] * (1 - km[i]), 0, 1);
    }
    return { x0, y0, S, ...shadeMaps(sh, mk, S, S) };
  }
  /* funnel cap: the cap region's box; a soft horizontal blur keeps the cap's rim light */
  function capShade(cv, F) {
    const reg = combine(F.layers.cap, F.layers.mask, 'destination-in'), b = bbox(reg, 12);
    if (!b) return null;
    const { x: cl, y: ct, w, h } = b, d = ctxR(reg).getImageData(cl, ct, w, h).data, m = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) m[i] = d[i * 4 + 3] / 255;
    const lum = lumOf(F.photo, cl, ct, w, h), b1 = blurF(cv, lum.map((l, i) => l * m[i]), w, h, 14, 1.5), b2 = blurF(cv, m, w, h, 14, 1.5);
    let sh = b1.map((v, i) => v / Math.max(b2[i], 1e-3)); const p = pct(sh, (i) => m[i] > 0.5, 0.7);
    sh = sh.map((v, i) => { const y = Math.floor(i / w); let k = clamp(0.55 + 0.55 * (v / p - 1) + 0.45, 0.45, 1.35); return k * (1 + 0.18 * clamp(1 - y / (h * 0.28), 0, 1)); });
    // the funnel's open top, for "No cap": an ellipse on the cap's bottom edge (as tools/export_overlays.py)
    const low = []; for (let x = 0; x < w; x++) { let ly = -1; for (let y = h - 1; y >= 0; y--) if (m[y * w + x] > 0.5) { ly = y; break; } low.push(ly); }
    const valid = low.map((v, i) => [i, v]).filter((q) => q[1] >= 0);
    const mid = valid.filter(([i]) => Math.abs(i - w / 2) < w * 0.1).map((q) => q[1]), ends = valid.filter(([i]) => i < w * 0.1 || i > w * 0.9).map((q) => q[1]);
    const avg = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
    const bottom = ct + (mid.length ? avg(mid) : h - 1), sag = bottom - (ct + (ends.length ? avg(ends) : h - 1));
    const eh = Math.max(2 * sag, 7, h * 0.3), ecy = bottom - eh / 2, pad = 4, ow = Math.round(w + 2 * pad), oh = Math.round(eh + 2 * pad + 2), oy0 = Math.round(ecy - oh / 2), ox0 = Math.round(cl + w / 2 - ow / 2);
    const none = canvas(ow, oh), nx = ctxR(none), nd = nx.createImageData(ow, oh), exm = ow / 2, eym = ecy - oy0, a1 = w / 2, b1e = eh / 2;
    for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
      const i = (y * ow + x) * 4, dd = ((x - exm) / a1) ** 2 + ((y - eym) / b1e) ** 2, outer = clamp((1 - dd) * a1 * 0.5, 0, 1);
      const d2 = ((x - exm) / (a1 * 0.9)) ** 2 + ((y - eym + 0.6) / (b1e * 0.78)) ** 2, inner = clamp((1 - d2) * a1 * 0.45, 0, 1);
      const rim = 150 + 70 * Math.exp(-((((x - exm) / a1 + 0.25) / 0.35) ** 2)), hole = 12 * Math.max(0, y - eym) / Math.max(b1e, 1);
      nd.data[i] = rim * (1 - inner) + (18 + hole) * inner; nd.data[i + 1] = rim * (1 - inner) + (18 + hole) * inner; nd.data[i + 2] = rim * (1 - inner) + (21 + hole) * inner; nd.data[i + 3] = outer * 255;
    }
    nx.putImageData(nd, 0, 0);
    return { cl, ct, w, h, ...shadeMaps(sh, m, w, h), none, nonePos: [ox0, oy0, ow, oh], region: reg };
  }

  /* ======================================================================
     Grinder Art studio
     ====================================================================== */
  class Studio {
    constructor(host, opts) {
      this.host = host; this.o = opts || {}; this.g = this.o.grinder || {};
      this.fins = (this.o.finishes || []).map((f) => ({ slug: f.slug || slugify(f.name), name: f.name || f.slug, image: f.image || null, swatch: f.swatch || '' }));
      if (!this.fins.length) this.fins = [{ slug: 'default', name: 'Default', image: null }];
      this.F = {}; this.fins.forEach((f) => { this.F[f.slug] = this.blank(f); });
      this.cur = this.fins[0].slug; this.step = 0; this.tool = null; this.mode = 'add';
      this.H = hingeFrom(this.g.geom || {}, this.cur);
      this.view = { s: 1, x: 0, y: 0 }; this.brush = 26; this.feather = 0.6; this.detail = 1.2; this.contrast = 0.45; this.side = 0.55; this.meshN = 3;
      this.showBg = true; this.previewOpen = false; this.previewNoCap = false;
      this.undoStack = []; this.texCache = new Map(); this.drag = null; this.poly = null; this.keys = {};
      this.accents = (this.o.accents || []).filter((a) => a && a.image); this.caps = (this.o.caps || []).filter((a) => a && a.image);
      this.prevAcc = this.accents[0] ? String(this.accents[0].id) : ''; this.prevCap = this.caps[0] ? String(this.caps[0].id) : '';
      this.mount(); this.loadExisting();
    }
    get hinge() { return this.H.mode; }
    set hinge(v) { this.H.mode = v; }
    blank(f) { return { ...f, fromArt: false, photo: null, layers: { mask: null, front: null, knob: null, cap: null }, vec: {}, hints: {}, knobEll: null, faceEll: null, band: null, knobMesh: null, capMesh: null, uncapped: null, uncappedMask: null, steel: null, capMetalImg: null, ver: 0 }; }
    get f() { return this.F[this.cur]; }
    get layerKey() { return { mask: 'mask', front: 'front', knob: 'knob', cap: 'cap' }[STEPS[this.step].k] || null; }
    changed(F = this.f) { F.ver++; F._cache = null; this.dirty = true; this.draw(); this.refreshSteps(); }   // the catalog changes only on Save art

    /* ---------- layout ---------- */
    mount() {
      this.host.innerHTML = `<div class="zs" data-zs>
        <div class="zs-top"><h2>Art studio</h2><span class="zs-sub">${esc(this.g.name || this.g.key || 'Grinder')}</span><div class="zs-fins" data-r="fins"></div></div>
        <nav class="zs-steps"><ol data-r="steps"></ol><div class="zs-lay" data-r="lays"></div></nav>
        <div class="zs-main"><div class="zs-tools" data-r="tools"></div>
          <div class="zs-view" data-r="view"><canvas data-r="cv"></canvas>
            <div class="zs-zoom"><button type="button" data-z="out" aria-label="Zoom out">&minus;</button><span data-r="zl">100%</span><button type="button" data-z="in" aria-label="Zoom in">+</button><button type="button" data-z="fit">Fit</button></div>
            <div class="zs-busy" data-r="busy"><div><span class="zs-spin"></span><span data-r="busyT">Working</span></div></div></div></div>
        <aside class="zs-side" data-r="side"></aside></div>`;
      this.root = $('[data-zs]', this.host); this.q = (r) => $(`[data-r="${r}"]`, this.root);
      this.cv = this.q('cv'); this.ctx = this.cv.getContext('2d');
      $$('[data-z]', this.root).forEach((b) => { b.onclick = () => (b.dataset.z === 'fit' ? this.fit() : this.zoomBy(b.dataset.z === 'in' ? 1.25 : 0.8)); });
      this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this.q('view'));
      this.bindPointer(); this.bindKeys();
      this.renderFins(); this.renderAll();
    }
    destroy() { cancelAnimationFrame(this._play); this.ro.disconnect(); document.removeEventListener('keydown', this._kd); document.removeEventListener('keyup', this._ku); this.host.innerHTML = ''; }
    renderAll() { this.refreshSteps(); this.renderTools(); this.renderSide(); this.renderLayers(); this.draw(); }
    renderFins() {
      this.q('fins').innerHTML = this.fins.length > 1 || this.fins[0].slug !== 'default' ? this.fins.map((f) => `<button type="button" data-f="${esc(f.slug)}" aria-pressed="${f.slug === this.cur}"><i style="background:${esc(f.swatch || (/white|cream|silver/.test(f.slug) ? '#e9e9e6' : /black/.test(f.slug) ? '#141517' : '#999'))}"></i>${esc(f.name)}</button>`).join('') : '';
      $$('[data-f]', this.q('fins')).forEach((b) => { b.onclick = () => { this.cur = b.dataset.f; this.poly = null; this.renderFins(); this.renderAll(); this.fit(); }; });
    }
    stepDone(i, F = this.f) {
      const k = STEPS[i].k;
      if (k === 'photo') return !!F.photo;
      if (k === 'mask') return !!F.layers.mask;
      if (k === 'front') return this.hinge === 'none' || !!F.layers.front;
      if (k === 'knob') return !!F.knobEll;
      if (k === 'cap') return !!F.layers.cap;
      if (k === 'face') return this.hinge === 'none' || !!F.faceEll;
      return false;
    }
    refreshSteps() {
      this.q('steps').innerHTML = STEPS.map((s, i) => `<li><button type="button" data-s="${i}" class="${this.stepDone(i) ? 'done' : ''}" ${i === this.step ? 'aria-current="step"' : ''}><span class="n">${this.stepDone(i) ? '&#10003;' : i + 1}</span><span>${s.n}<small>${s.d}</small></span></button></li>`).join('');
      $$('[data-s]', this.q('steps')).forEach((b) => { b.onclick = () => this.go(+b.dataset.s); });
    }
    renderLayers() {
      const F = this.f, row = (k, n, on) => `<label><i style="background:${COL[k]}"></i>${n}<span style="margin-left:auto;color:${on ? '#29845a' : '#8a8a8a'}">${on ? 'Set' : 'Not set'}</span></label>`;
      this.q('lays').innerHTML = `<h4>Layers for ${esc(F.name)}</h4>${row('mask', 'Grinder', !!F.layers.mask)}${row('front', 'Front assembly', !!F.layers.front)}${row('knob', 'Accent piece', !!F.knobEll)}${row('cap', 'Funnel cap', !!F.layers.cap)}${row('face', 'Burr chamber', !!F.faceEll)}`;
    }
    go(i) { this.step = clamp(i, 0, STEPS.length - 1); this.poly = null; this.tool = this.defaultTool(); this.renderAll(); }
    defaultTool() { return { photo: 'pan', mask: 'keep', front: this.f.layers.front && this.hinge !== 'none' ? 'hinge' : 'lasso', knob: 'ellipse', cap: 'rect', face: 'ellipse', save: 'pan' }[STEPS[this.step].k]; }

    /* ---------- toolbar ---------- */
    renderTools() {
      const k = STEPS[this.step].k; if (!this.tool) this.tool = this.defaultTool();
      const T = (id, label, dot, title) => `<button type="button" class="zs-tool" data-t="${id}" aria-pressed="${this.tool === id}" title="${esc(title || label)}">${dot ? `<span class="dot" style="background:${dot}"></span>` : ''}${label}</button>`;
      const sets = {
        photo: [T('pan', 'Move view')],
        mask: [T('keep', 'Keep', '#00c853', 'Paint over parts to keep. The cut-out updates when you let go.'), T('remove', 'Remove', '#ff1744', 'Paint over background to remove. The cut-out updates when you let go.'), '<span class="sep"></span>', T('paint', 'Paint'), T('erase', 'Erase'), T('lasso', 'Lasso'), T('poly', 'Polygon'), T('points', 'Edit points'), '<span class="sep"></span>', T('pan', 'Move view')],
        front: [T('hinge', 'Hinge', '#e8a33a', 'Drag the hinge point or the slide arrow. Click to place it.'), '<span class="sep"></span>', T('rect', 'Box select', '', 'Draw a box around the part. The app finds it inside the box.'), T('keep', 'Keep', '#00c853'), T('remove', 'Remove', '#ff1744'), '<span class="sep"></span>', T('lasso', 'Lasso'), T('poly', 'Polygon'), T('paint', 'Paint'), T('erase', 'Erase'), T('points', 'Edit points'), '<span class="sep"></span>', T('pan', 'Move view')],
        knob: [T('ellipse', 'Ellipse'), T('rect', 'Find in box', '', 'Draw a box around the accent piece. The app fits the ellipse.'), T('mesh', 'Mold'), '<span class="sep"></span>', T('paint', 'Add edge', '', 'Paint the visible side of the piece'), T('erase', 'Erase edge'), '<span class="sep"></span>', T('pan', 'Move view')],
        cap: [T('rect', 'Box select'), T('keep', 'Keep', '#00c853'), T('remove', 'Remove', '#ff1744'), '<span class="sep"></span>', T('lasso', 'Lasso'), T('poly', 'Polygon'), T('paint', 'Paint'), T('erase', 'Erase'), T('points', 'Edit points'), T('mesh', 'Mold'), '<span class="sep"></span>', T('pan', 'Move view')],
        face: [T('ellipse', 'Ellipse'), '<span class="sep"></span>', T('pan', 'Move view')],
        save: [T('pan', 'Move view')]
      }[k];
      const brushy = ['keep', 'remove', 'paint', 'erase'].includes(this.tool), shapey = ['lasso', 'poly'].includes(this.tool);
      this.q('tools').innerHTML = sets.join('') + `<span style="flex:1"></span>`
        + (shapey ? `<span class="zs-seg" style="width:150px"><button type="button" data-m="add" aria-pressed="${this.mode === 'add'}">Add</button><button type="button" data-m="sub" aria-pressed="${this.mode === 'sub'}">Remove</button></span>` : '')
        + (brushy ? `<label>Brush <input type="range" min="4" max="120" value="${this.brush}" data-r="brush"></label>` : '')
        + `<button type="button" class="zs-tool" data-act="undo" ${this.undoStack.length ? '' : 'disabled'} title="Undo (Ctrl+Z)">Undo</button>`;
      $$('[data-t]', this.q('tools')).forEach((b) => { b.onclick = () => { this.tool = b.dataset.t; this.poly = null; if (this.tool === 'points') this.ensureVec(); if (this.tool === 'mesh') this.ensureMesh(); this.renderTools(); this.draw(); }; });
      $$('[data-m]', this.q('tools')).forEach((b) => { b.onclick = () => { this.mode = b.dataset.m; this.renderTools(); }; });
      const br = this.q('brush'); if (br) br.oninput = () => { this.brush = +br.value; };
      $('[data-act="undo"]', this.q('tools')).onclick = () => this.undo();
      this.q('view').className = 'zs-view' + (this.tool === 'pan' ? ' pan' : '');
    }

    /* ---------- side panel ---------- */
    renderSide() {
      const k = STEPS[this.step].k, F = this.f, side = this.q('side');
      const others = this.fins.filter((f) => f.slug !== this.cur && this.stepDone(this.step, this.F[f.slug]) && this.F[f.slug].photo);
      const copyBtn = others.length && k !== 'photo' && k !== 'save' && F.photo ? `<button type="button" class="zs-btn full" data-act="copy">Copy this step from ${esc(others[0].name)}</button>` : '';
      const needPhoto = !F.photo && k !== 'photo' ? `<p class="zs-warn">Add a photo for ${esc(F.name)} first (step 1).</p>` : '';
      const next = this.step < STEPS.length - 1 ? `<button type="button" class="zs-btn primary full" data-act="next">Next: ${STEPS[this.step + 1].n}</button>` : '';
      const edges = (lk) => `<div class="zs-k">Edges</div>
        <button type="button" class="zs-btn full" data-act="crisp" ${F.layers[lk] ? '' : 'disabled'}>Make edges crisp</button>
        <label class="zs-field"><span>Detail</span><input type="range" min="0.4" max="4" step="0.1" value="${this.detail}" data-in="detail"><small>Fewer points give smoother lines. More points follow every bump.</small></label>
        <label class="zs-field"><span>Edge softness</span><input type="range" min="0" max="2" step="0.1" value="${this.feather}" data-in="feather"><small>0 is razor sharp. 0.5 to 1 matches a photo's natural edge.</small></label>
        <label class="zs-check"><input type="checkbox" data-in="smooth" ${!F.vec[lk] || F.vec[lk].smooth !== false ? 'checked' : ''}><span>Smooth curves between points</span></label>
        ${F.hints[lk] ? '<button type="button" class="zs-btn full" data-act="clearHints">Clear Keep and Remove marks</button>' : ''}`;
      let h = '';
      if (k === 'photo') {
        h = `<h3>1. Photo for ${esc(F.name)}</h3><p>Use a sharp, evenly lit photo of the grinder on a plain background. Every color must use the same framing, so the shapes line up.</p>
          <div class="zs-drop" data-act="upload">${F.photo ? `<img src="${F.photo.toDataURL('image/jpeg', 0.6)}" alt="">` : ''}<b>${F.photo ? 'Replace the photo' : 'Upload a photo'}</b><span>Drop a JPG or PNG here, or click to choose</span></div>
          ${F.image ? `<button type="button" class="zs-btn full" data-act="shopify">Use the ${esc(F.name)} product photo</button>` : ''}
          ${this.o.pickFile ? '<button type="button" class="zs-btn full" data-act="files">Choose from Shopify Files</button>' : ''}
          ${F.photo ? `<p class="zs-ok">${F.photo.width} x ${F.photo.height} px. Next, cut out the grinder.</p>` : ''}`;
      } else if (k === 'mask') {
        h = `<h3>2. Cut out the grinder</h3><p>The app finds the grinder and removes the background. Then fix any spot with the Keep and Remove brushes: paint over it and let go.</p>
          <button type="button" class="zs-btn primary full" data-act="auto" ${F.photo ? '' : 'disabled'}>${F.layers.mask ? 'Cut out again' : 'Cut out automatically'}</button>
          <label class="zs-check"><input type="checkbox" data-in="showBg" ${this.showBg ? 'checked' : ''}><span>Show the removed background faintly</span></label>
          ${edges('mask')}`;
      } else if (k === 'front') {
        h = `<h3>3. Front assembly</h3><p>Mark the part that opens to show the burrs: the dial, the accent piece and everything that moves with them. Then set how it opens.</p>
          ${this.openingPanel()}
          ${this.hinge === 'none' ? '<p class="zs-tip">The burr falls into the accent piece instead. Skip to step 4.</p>' : `<p class="zs-tip">Tip: draw a box around the front, or trace it with the Lasso. Hold Shift with the Lasso to remove.</p>${edges('front')}`}`;
      } else if (k === 'knob') {
        const E = F.knobEll;
        h = `<h3>4. Accent piece</h3><p>Fit the ellipse to the face of the wood piece. Drag the middle to move it, the side dots to size it and the top dot to turn it. Paint the edge you can see around the side.</p>
          ${this.previewSelect('acc')}
          ${E ? `<div class="zs-k">Mold the wood</div><p>Use Mold to bend the wood grain so it follows the piece. Drag the grid points.</p>
          <div class="zs-row"><button type="button" class="zs-btn" data-act="mesh">${this.tool === 'mesh' ? 'Done molding' : 'Mold the wood'}</button><button type="button" class="zs-btn" data-act="meshReset" ${F.knobMesh ? '' : 'disabled'}>Reset</button></div>
          <label class="zs-field"><span>Grid</span><select data-in="meshN">${[2, 3, 4, 5].map((n) => `<option value="${n}" ${this.meshN === n ? 'selected' : ''}>${n} x ${n}</option>`).join('')}</select></label>
          <div class="zs-k">Light and shadow</div>
          <label class="zs-field"><span>Shading strength</span><input type="range" min="0" max="1" step="0.05" value="${this.contrast}" data-in="contrast"><small>Taken from the photo. Higher shows more of the photo's highlights and shadows.</small></label>
          <label class="zs-field"><span>Edge darkness</span><input type="range" min="0.3" max="1" step="0.05" value="${this.side}" data-in="side"></label>` : '<p class="zs-tip">Draw the ellipse over the wood face, or use Find in box.</p>'}`;
      } else if (k === 'cap') {
        h = `<h3>5. Funnel cap</h3><p>Mark the cap on top of the funnel. Draw a box around it and the app finds it. Then choose the strip of the cap photo that becomes its edge.</p>
          ${this.previewSelect('cap')}
          ${F.layers.cap ? `<div class="zs-k">Cap edge from the product photo</div><div class="zs-band" data-r="band"><canvas data-r="bandCv" width="240" height="240"></canvas><div class="r" data-r="bandR"><i></i></div></div>
          <div class="zs-row"><button type="button" class="zs-btn" data-act="mesh">${this.tool === 'mesh' ? 'Done molding' : 'Mold the cap'}</button><button type="button" class="zs-btn" data-act="bandReset">Reset strip</button><button type="button" class="zs-btn" data-act="meshReset" ${F.capMesh ? '' : 'disabled'}>Reset mold</button></div>` : ''}
          <div class="zs-k">Optional photos, same framing</div>
          <div class="zs-row"><button type="button" class="zs-btn" data-act="uncapped">${F.uncapped ? 'Replace' : 'Add'} a photo without the cap</button>${this.o.pickFile ? '<button type="button" class="zs-btn" data-act="uncappedFiles">From Files</button>' : ''}</div><p style="font-size:12px">Shows the real open funnel for "No cap". Without it the app draws one.</p>
          <div class="zs-row"><button type="button" class="zs-btn" data-act="steel">${F.steel ? 'Replace' : 'Add'} a photo with the steel cap</button>${this.o.pickFile ? '<button type="button" class="zs-btn" data-act="steelFiles">From Files</button>' : ''}</div>
          ${F.layers.cap ? edges('cap') : ''}`;
      } else if (k === 'face') {
        h = this.hinge === 'none' ? '<h3>6. Burr chamber</h3><p class="zs-tip">This grinder does not open, so it needs no burr chamber. Go to Preview and save.</p>'
          : `<h3>6. Burr chamber</h3><p>Draw the ellipse where the burr chamber shows when the front ${this.hinge === 'slide' ? 'slides out' : 'swings open'}. It is usually the round face where the front meets the body.</p>
          <label class="zs-check"><input type="checkbox" data-in="previewOpen" ${this.previewOpen ? 'checked' : ''}><span>Show it open</span></label>
          <button type="button" class="zs-btn full" data-act="play" ${F.layers.front ? '' : 'disabled'}>Play the opening</button>`;
      } else if (k === 'save') {
        const ready = this.fins.map((f) => { const G = this.F[f.slug]; const miss = STEPS.slice(0, 6).filter((s, i) => !this.stepDone(i, G)).map((s) => s.n); return { f, G, miss }; });
        h = `<h3>7. Preview and save</h3><p>Check each color, then save. The app uploads the files to Shopify and the builder uses them after you save the catalog.</p>
          <div class="zs-list">${ready.map(({ f, miss }) => `<div class="it"><b>${esc(f.name)}</b>${miss.length ? `<span>Missing: ${esc(miss.join(', '))}</span>` : '<span class="y">Ready</span>'}</div>`).join('')}</div>
          ${this.previewSelect('acc')}${this.previewSelect('cap')}
          <label class="zs-check"><input type="checkbox" data-in="previewNoCap" ${this.previewNoCap ? 'checked' : ''}><span>Show "No cap"</span></label>
          ${this.hinge !== 'none' ? `<label class="zs-check"><input type="checkbox" data-in="previewOpen" ${this.previewOpen ? 'checked' : ''}><span>Show it open</span></label><button type="button" class="zs-btn full" data-act="play" ${F.layers.front ? '' : 'disabled'}>Play the opening</button>` : ''}
          <button type="button" class="zs-btn primary full" data-act="export" ${ready.some((r) => r.G.photo && r.G.layers.mask) ? '' : 'disabled'}>Save art</button>
          <div class="zs-prog" data-r="prog" hidden><i></i></div><p data-r="saveMsg"></p>
          ${ready.some((r) => r.miss.length && r.G.photo) ? '<p class="zs-warn">Colors with missing steps save what they have. A color without a cut-out shows its plain photo in the builder.</p>' : ''}`;
      }
      side.innerHTML = needPhoto + h + copyBtn + next;
      this.bindSide(); if (k === 'cap' && F.layers.cap) this.drawBand();
    }
    openingPanel() {
      const H = this.H, F = this.f, on = H.mode !== 'none', saved = !!(this.g.geom && this.g.art);
      const dirNow = H.dir != null ? H.dir : Math.round(deg(Math.atan2(0.06, -1)));
      return `<div class="zs-k">How it opens</div><div class="zs-seg">${[['swing', 'Swings open'], ['slide', 'Slides out'], ['none', 'Does not open']].map(([v, n]) => `<button type="button" data-hinge="${v}" aria-pressed="${H.mode === v}">${n}</button>`).join('')}</div>
        ${H.mode === 'swing' ? `<label class="zs-field"><span data-lab="hAngle">Opening angle: ${r2(H.angle)}&deg;</span><input type="range" min="-60" max="60" step="0.5" value="${H.angle}" data-in="hAngle"><small>Negative tips the top forward. Positive tips it back.</small></label>
          <p class="zs-tip">Drag the orange crosshair on the photo to move the hinge point, or click with the Hinge tool to place it.</p>
          <button type="button" class="zs-btn" data-act="pivotReset" ${H.pivotPx || H.pivotPct ? '' : 'disabled'}>Hinge at the bottom of the burr chamber</button>` : ''}
        ${H.mode === 'slide' ? `<label class="zs-field"><span data-lab="hDist">How far it slides: ${r2(H.dist)}%</span><input type="range" min="1" max="45" step="0.5" value="${H.dist}" data-in="hDist"></label>
          <label class="zs-field"><span data-lab="hDir">Direction: ${Math.round(dirNow)}&deg;</span><input type="range" min="0" max="360" step="1" value="${dirNow}" data-in="hDir"><small>0 is right, 90 is down, 180 is left. Or drag the arrow tip on the photo.</small></label>
          <button type="button" class="zs-btn" data-act="dirReset" ${H.dir != null ? '' : 'disabled'}>Slide along the grinder (default)</button>` : ''}
        ${on ? `<label class="zs-field"><span data-lab="hMs">Speed: ${(H.ms / 1000).toFixed(1)} s</span><input type="range" min="0.6" max="4" step="0.1" value="${H.ms / 1000}" data-in="hMs"><small>The whole move: open, drop the burr, close.</small></label>` : ''}
        <div class="zs-row">${on ? `<button type="button" class="zs-btn" data-act="play" ${F.layers.front ? '' : 'disabled'}>Play</button>` : ''}${saved ? '<button type="button" class="zs-btn primary" data-act="saveOpening">Save opening</button>' : ''}</div>
        ${saved ? '<p style="font-size:12px">Save opening keeps the current art and changes only how it opens.</p>' : '<p style="font-size:12px">Save art in step 7 saves the opening too.</p>'}<p data-r="openMsg"></p>`;
    }
    previewSelect(kind) {
      const list = kind === 'acc' ? this.accents : this.caps, cur = kind === 'acc' ? this.prevAcc : this.prevCap;
      if (!list.length) return '';
      return `<label class="zs-field"><span>${kind === 'acc' ? 'Preview accent piece' : 'Preview funnel cap'}</span><select data-prev="${kind}">${list.map((a) => `<option value="${esc(a.id)}" ${String(a.id) === cur ? 'selected' : ''}>${esc(a.title)}</option>`).join('')}</select></label>`;
    }
    bindSide() {
      const side = this.q('side'), F = this.f, act = (n, fn) => { const b = $(`[data-act="${n}"]`, side); if (b) b.onclick = fn; };
      act('next', () => this.go(this.step + 1));
      act('upload', async () => { const file = await pickFile(); if (file) this.setPhoto(URL.createObjectURL(file)); });
      act('shopify', () => this.setPhoto(F.image));
      act('files', async () => { const u = await this.o.pickFile({ title: `Photo for ${F.name}` }); if (u) this.setPhoto(u); });
      act('uncappedFiles', async () => { const u = await this.o.pickFile({ title: 'Photo without the cap' }); if (u) this.setExtraPhoto('uncapped', u); });
      act('steelFiles', async () => { const u = await this.o.pickFile({ title: 'Photo with the steel cap' }); if (u) this.setExtraPhoto('steel', u); });
      const drop = $('.zs-drop', side);
      if (drop) {
        drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over');
        drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); const file = e.dataTransfer.files[0]; if (file) this.setPhoto(URL.createObjectURL(file)); };
      }
      act('auto', () => this.runAuto('mask', {}));
      act('crisp', () => this.makeCrisp());
      act('clearHints', () => { this.pushUndo(); F.hints[this.layerKey] = null; this.renderSide(); this.draw(); });
      act('copy', () => this.copyStep());
      act('mesh', () => { this.tool = this.tool === 'mesh' ? (STEPS[this.step].k === 'knob' ? 'ellipse' : 'rect') : 'mesh'; this.ensureMesh(); this.renderTools(); this.renderSide(); this.draw(); });
      act('meshReset', () => { this.pushUndo(); if (STEPS[this.step].k === 'knob') F.knobMesh = null; else F.capMesh = null; this.ensureMesh(); this.changed(); this.renderSide(); });
      act('bandReset', () => { this.pushUndo(); F.band = null; this.changed(); this.drawBand(); });
      act('uncapped', async () => { const file = await pickFile(); if (file) this.setExtraPhoto('uncapped', URL.createObjectURL(file)); });
      act('steel', async () => { const file = await pickFile(); if (file) this.setExtraPhoto('steel', URL.createObjectURL(file)); });
      act('export', () => this.exportArt());
      act('play', () => this.play());
      act('saveOpening', () => this.saveOpening());
      act('pivotReset', () => { this.H.pivotPx = null; this.H.pivotPct = null; this.dirty = true; this.renderSide(); this.draw(); });
      act('dirReset', () => { this.H.dir = null; this.dirty = true; this.renderSide(); this.draw(); });
      $$('[data-hinge]', side).forEach((b) => { b.onclick = () => { this.hinge = b.dataset.hinge; this.dirty = true; if (STEPS[this.step].k === 'front') this.tool = this.defaultTool(); this.renderTools(); this.renderSide(); this.refreshSteps(); this.draw(); }; });
      $$('[data-prev]', side).forEach((s) => { s.onchange = () => { if (s.dataset.prev === 'acc') this.prevAcc = s.value; else this.prevCap = s.value; this.draw(); if (STEPS[this.step].k === 'cap') this.drawBand(); }; });
      $$('[data-in]', side).forEach((el) => {
        const k = el.dataset.in;
        el[el.type === 'checkbox' || el.tagName === 'SELECT' ? 'onchange' : 'oninput'] = () => {
          const v = el.type === 'checkbox' ? el.checked : el.type === 'range' || el.tagName === 'SELECT' ? +el.value : el.value;
          if (k === 'smooth') { const lk = this.layerKey, V = F.vec[lk]; if (V) { V.smooth = v; this.fromVec(lk); } return; }
          if (k === 'feather') { this.feather = v; const lk = this.layerKey; if (F.vec[lk]) this.fromVec(lk); return; }
          if (k === 'detail') { this.detail = v; clearTimeout(this._dt); this._dt = setTimeout(() => { if (F.vec[this.layerKey]) this.makeCrisp(true); }, 250); return; }
          if (k === 'meshN') { this.meshN = v; this.pushUndo(); if (STEPS[this.step].k === 'knob') F.knobMesh = null; else F.capMesh = null; this.ensureMesh(); this.changed(); return; }
          const lab = (t) => { const l = $(`[data-lab="${k}"]`, side); if (l) l.innerHTML = t; this.dirty = true; this.draw(); };
          if (k === 'hAngle') { this.H.angle = v; return lab(`Opening angle: ${r2(v)}&deg;`); }
          if (k === 'hDist') { this.H.dist = v; return lab(`How far it slides: ${r2(v)}%`); }
          if (k === 'hDir') { this.H.dir = v; const b = $('[data-act="dirReset"]', side); if (b) b.disabled = false; return lab(`Direction: ${Math.round(v)}&deg;`); }
          if (k === 'hMs') { this.H.ms = Math.round(v * 1000); return lab(`Speed: ${v.toFixed(1)} s`); }
          this[k] = v; if (k === 'contrast' || k === 'side') F._cache = null; this.draw();
        };
      });
    }

    /* ---------- photos ---------- */
    async setPhoto(url) {
      this.busy('Loading the photo');
      try {
        const img = await loadImage(url), F = this.f, ref = this.fins.map((f) => this.F[f.slug].photo).find((p) => p && this.F[this.cur].photo !== p);
        let W, H;
        if (ref) {   // every color shares the framing of the first photo
          W = ref.width; H = ref.height;
          const ar = (img.naturalWidth / img.naturalHeight) / (W / H);
          if (Math.abs(ar - 1) > 0.02) this.toast(`This photo has a different shape than the other colors. The app resized it to ${W} x ${H}. Shapes may not line up.`);
        }
        this.pushUndo();
        F.photo = imageCanvas(img, W, H); F.fromArt = false;
        if (F.layers.mask && (F.layers.mask.width !== F.photo.width || F.layers.mask.height !== F.photo.height)) Object.assign(F, this.blank(F), { photo: F.photo });
        this.changed(F); this.renderSide(); this.renderLayers(); this.fit();
      } catch (e) { this.toast(e.message); } finally { this.busy(false); }
    }
    async setExtraPhoto(kind, url) {
      const F = this.f; if (!F.photo) return;
      this.busy('Loading the photo');
      try {
        const img = await loadImage(url); F[kind] = imageCanvas(img, F.photo.width, F.photo.height);
        if (kind === 'uncapped' && F.layers.mask) {   // its own cut-out, so the open funnel never shows the backdrop
          this.busy('Cutting out the photo');
          const b = bbox(F.layers.mask);
          const rings = await autoCut(F.uncapped, { rect: { x: b.x - 10, y: b.y - 40, w: b.w + 20, h: b.h + 50 } });
          F.uncappedMask = renderRings(rings, F.photo.width, F.photo.height, { feather: this.feather });
        }
        this.changed(F); this.renderSide();
      } catch (e) { this.toast(e.message); } finally { this.busy(false); }
    }
    async loadExisting() {
      const g = this.g, C = window.ZernoCatalog;
      if (!g.art || !C) return;
      const base = this.o.assetBase != null ? this.o.assetBase : 'preview/';
      const urls = C.art(g, base.endsWith('/') || !base ? base : base.replace(/[^/]*$/, '')), geom = g.geom || {};
      const slugs = Object.keys(urls).filter((s) => this.F[s] && geom[s]);
      if (!slugs.length) return;
      this.busy('Loading the current art');
      const img = (u) => (u ? loadImage(u).catch(() => null) : Promise.resolve(null));
      try {
        for (const s of slugs) {
          const u = urls[s], G = geom[s], F = this.F[s];
          const [photo, mask, front, kd, cd, cm] = await Promise.all([img(u.photo), img(u.mask), img(u.front), img(u.knobD), img(u.capD), img(u.capMetal)]);
          if (!photo) continue;
          F.photo = imageCanvas(photo, photo.naturalWidth, photo.naturalHeight); F.fromArt = true;   // the saved photo is the builder's frame
          const W = F.photo.width, H = F.photo.height, at = (p) => [p[0] / 100 * W, p[1] / 100 * H, p[2] / 100 * W, p[3] / 100 * H];
          const lay = (im, p) => { if (!im) return null; const c = canvas(W, H), x = c.getContext('2d'); if (p) x.drawImage(im, ...at(p)); else x.drawImage(im, 0, 0, W, H); return c; };
          F.layers.mask = lay(mask) || null; F.layers.front = lay(front);
          if (G.knob && G.knobPos) {
            const [kx, ky, kw] = at(G.knobPos), k = kw / G.knob.size;
            F.knobEll = { cx: kx + G.knob.cx * k, cy: ky + G.knob.cy * k, rx: G.knob.w / 2 * k, ry: G.knob.h / 2 * k, a: rad(-(G.knob.rot || 0)) };
            if (kd) F.layers.knob = lay(kd, G.knobPos);
            if (G.knob.mesh && G.knob.mesh.pts) F.knobMesh = { n: G.knob.mesh.n, uv: G.knob.mesh.pts.map(([fx, fy]) => ellLocal(F.knobEll, kx + fx * kw, ky + fy * kw)) };
          }
          if (G.capPos && cd) F.layers.cap = lay(cd, G.capPos);
          if (G.cap && Array.isArray(G.cap.band)) F.band = G.cap.band.slice();
          if (G.cap && G.cap.mesh) F.capMesh = { n: G.cap.mesh.n, pts: G.cap.mesh.pts.map((p) => p.slice()) };
          if (G.face) F.faceEll = { cx: G.face.c[0] / 100 * W, cy: G.face.c[1] / 100 * H, rx: G.face.w / 100 * W, ry: G.face.h / 100 * H, a: rad(G.face.rot || 0) };
          if (cm) F.capMetalImg = cm;
          if (G.open && this.H.mode === 'slide' && !(g.geom.hinge && g.geom.hinge.dist != null)) this.H.dist = +G.open;
        }
        this.dirty = false; this.renderAll(); this.fit();
      } catch (e) { this.toast('The current art could not load: ' + e.message); } finally { this.busy(false); }
    }

    /* ---------- cut-out ---------- */
    async runAuto(lk, { rect } = {}) {
      const F = this.f; if (!F.photo) return;
      if (lk !== 'mask' && !F.layers.mask) { this.toast('Cut out the grinder first (step 2).'); return; }
      this.busy(rect ? 'Finding it in the box' : 'Cutting out');
      try {
        this.pushUndo();
        const limit = lk === 'mask' ? null : F.layers.mask;
        const o = { hints: F.hints[lk] || null, limit, keep: lk === 'mask' ? 0.04 : 0.15, hull: !!rect && (lk === 'cap' || lk === 'knob') };
        if (rect) o.rect = rect; else if (F.layers[lk]) o.prior = F.layers[lk];
        else if (lk !== 'mask') { this.toast('Draw a box around the part first.'); return; }
        if (lk === 'knob') {   // the accent piece: fit an ellipse to what the box finds
          const rings = await autoCut(F.photo, { ...o, prior: null, hints: null, hull: true });
          const area = (P) => Math.abs(P.reduce((t, p, i) => { const q = P[(i + 1) % P.length]; return t + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
          const best = rings.filter((r) => !r.hole && r.pts.length >= 5).sort((a, b) => area(b.pts) - area(a.pts))[0];
          if (!best) throw new Error('No accent piece found in the box. Draw the ellipse by hand.');
          const { cv } = await loadCV();
          const m = cv.matFromArray(best.pts.length, 1, cv.CV_32FC2, best.pts.flat()), e = cv.fitEllipse(m); m.delete();
          F.knobEll = { cx: e.center.x, cy: e.center.y, rx: e.size.width / 2, ry: e.size.height / 2, a: rad(e.angle) };
          // everything the box found, side edge included, is covered by the new wood
          F.layers.knob = combine(renderRings([best], F.photo.width, F.photo.height, { smooth: false, feather: this.feather }), F.layers.mask, 'destination-in');
          this.tool = 'ellipse';
        } else {
          const rings = await autoCut(F.photo, o);
          F.vec[lk] = { rings, smooth: true };
          this.fromVec(lk, true);
        }
        this.changed(F); this.renderAll();
      } catch (e) { this.undoStack.pop(); this.toast(e.message); } finally { this.busy(false); }
    }
    fromVec(lk, quiet) {
      const F = this.f, V = F.vec[lk]; if (!V) return;
      let r = renderRings(V.rings, F.photo.width, F.photo.height, { smooth: V.smooth !== false, feather: this.feather });
      if (lk !== 'mask' && F.layers.mask) r = combine(r, F.layers.mask, 'destination-in');
      F.layers[lk] = r; if (!quiet) this.changed(F);
    }
    async makeCrisp(again) {
      const F = this.f, lk = this.layerKey; if (!lk || !F.layers[lk]) return;
      this.busy('Tracing the edges');
      try {
        if (!again) this.pushUndo();
        const src = again && F.vec[lk] ? renderRings(F.vec[lk].rings, F.photo.width, F.photo.height, { smooth: F.vec[lk].smooth !== false }) : F.layers[lk];
        F.vec[lk] = { rings: await vectorize(src, this.detail), smooth: F.vec[lk] ? F.vec[lk].smooth !== false : true };
        this.fromVec(lk); this.tool = 'points'; this.renderTools();
      } catch (e) { this.toast(e.message); } finally { this.busy(false); }
    }
    ensureVec() { const lk = this.layerKey, F = this.f; if (lk && F.layers[lk] && !F.vec[lk]) this.makeCrisp(); }
    ensureMesh() {
      const F = this.f, k = STEPS[this.step].k;
      if (k === 'knob' && F.knobEll && !F.knobMesh) F.knobMesh = { n: this.meshN, uv: gridUV(this.meshN), fresh: true };
      if (k === 'cap' && F.layers.cap && !F.capMesh) F.capMesh = { n: this.meshN, pts: gridFr(this.meshN), fresh: true };
    }
    copyStep() {
      const F = this.f, k = STEPS[this.step].k, src = this.fins.map((f) => this.F[f.slug]).find((G) => G !== F && this.stepDone(this.step, G) && G.photo);
      if (!src || !F.photo) return;
      if (src.photo.width !== F.photo.width || src.photo.height !== F.photo.height) { this.toast('The photos have different sizes, so the shapes cannot be copied.'); return; }
      this.pushUndo();
      const cpL = (lk) => { F.layers[lk] = copyCanvas(src.layers[lk]); F.vec[lk] = src.vec[lk] ? JSON.parse(JSON.stringify(src.vec[lk])) : null; };
      if (k === 'mask' || k === 'front') cpL(k);
      if (k === 'knob') { F.knobEll = src.knobEll && { ...src.knobEll }; F.layers.knob = copyCanvas(src.layers.knob); F.knobMesh = src.knobMesh && JSON.parse(JSON.stringify(src.knobMesh)); }
      if (k === 'cap') { cpL('cap'); F.band = src.band && src.band.slice(); F.capMesh = src.capMesh && JSON.parse(JSON.stringify(src.capMesh)); }
      if (k === 'face') F.faceEll = src.faceEll && { ...src.faceEll };
      if (k === 'front' || k === 'cap') { if (F.layers[k] && F.layers.mask) F.layers[k] = combine(F.layers[k], F.layers.mask, 'destination-in'); }
      this.changed(F); this.renderAll();
    }

    /* ---------- undo ---------- */
    pushUndo() {
      const F = this.f;
      this.undoStack.push({ slug: this.cur, layers: Object.fromEntries(Object.entries(F.layers).map(([k, v]) => [k, v])), hints: { ...F.hints }, vec: JSON.stringify(F.vec),
        knobEll: F.knobEll && { ...F.knobEll }, faceEll: F.faceEll && { ...F.faceEll }, band: F.band && F.band.slice(), knobMesh: JSON.stringify(F.knobMesh), capMesh: JSON.stringify(F.capMesh), photo: F.photo });
      if (this.undoStack.length > 20) this.undoStack.shift();
      const b = $('[data-act="undo"]', this.q('tools')); if (b) b.disabled = false;
    }
    undo() {
      const u = this.undoStack.pop(); if (!u) return;
      const F = this.F[u.slug]; this.cur = u.slug;
      Object.assign(F, { layers: u.layers, hints: u.hints, vec: JSON.parse(u.vec), knobEll: u.knobEll, faceEll: u.faceEll, band: u.band, knobMesh: JSON.parse(u.knobMesh), capMesh: JSON.parse(u.capMesh), photo: u.photo });
      this.changed(F); this.renderAll();
    }
    // raster edits draw on a copy, so undo keeps the old canvas
    editable(lk) { const F = this.f; F.layers[lk] = F.layers[lk] ? copyCanvas(F.layers[lk]) : canvas(F.photo.width, F.photo.height); return F.layers[lk]; }

    /* ---------- view ---------- */
    resize() { const v = this.q('view'), d = devicePixelRatio || 1; this.cv.width = Math.round(v.clientWidth * d); this.cv.height = Math.round(v.clientHeight * d); if (!this._fitted && this.f.photo) { this._fitted = true; this.fit(); } else this.draw(); }
    fit() {
      const F = this.f, v = this.q('view'); if (!F.photo || !v.clientWidth) { this.draw(); return; }
      const s = Math.min(v.clientWidth / F.photo.width, v.clientHeight / F.photo.height) * 0.92;
      this.view = { s, x: (v.clientWidth - F.photo.width * s) / 2, y: (v.clientHeight - F.photo.height * s) / 2 }; this.draw();
    }
    zoomBy(k, cx, cy) {
      const v = this.q('view'); if (cx == null) { cx = v.clientWidth / 2; cy = v.clientHeight / 2; }
      const s = clamp(this.view.s * k, 0.05, 16), r = s / this.view.s;
      this.view = { s, x: cx - (cx - this.view.x) * r, y: cy - (cy - this.view.y) * r }; this.draw();
    }
    toImg(e) { const b = this.cv.getBoundingClientRect(); const sx = e.clientX - b.left, sy = e.clientY - b.top; return [(sx - this.view.x) / this.view.s, (sy - this.view.y) / this.view.s, sx, sy]; }
    texImg(kind) {
      const id = kind === 'acc' ? this.prevAcc : this.prevCap, it = (kind === 'acc' ? this.accents : this.caps).find((a) => String(a.id) === id);
      if (!it) return null;
      const T = ((this.o.catalog || {}).textures || {})[String(id)] || null, url = (T && T.src) || it.image;
      if (!this.texCache.has(url)) { this.texCache.set(url, null); loadImage(url).then((im) => { this.texCache.set(url, im); this.f._cache = null; this.draw(); if (STEPS[this.step].k === 'cap') this.drawBand(); }).catch(() => {}); }
      const im = this.texCache.get(url); return im ? { im, tex: T, title: it.title } : null;
    }
    /* shading is computed in the background and cached until the shape changes */
    shading(F) {
      const key = [F.ver, this.contrast, this.side].join(':');
      if (F._cache && F._cache.key === key) return F._cache;
      if (!window.cv || !window.cv.Mat) { loadCV().then(() => this.draw()).catch(() => {}); return null; }
      const out = { key };
      try { if (F.knobEll) out.knob = knobShade(window.cv, F, { contrast: this.contrast, side: this.side }); if (F.layers.cap && F.layers.mask) out.cap = capShade(window.cv, F); } catch (e) { console.warn('[Art studio]', e); }
      F._cache = out; return out;
    }
    knobCanvas(F, sh) {
      const t = this.texImg('acc'); if (!t || !sh || !sh.knob) return null;
      const { x0, y0, S, D, L } = sh.knob, E = F.knobEll, c = canvas(S, S), x = c.getContext('2d'), sq = texSquare(t.im, t.tex, 0.7);
      if (F.knobMesh) drawMesh(x, sq, { n: F.knobMesh.n, pts: F.knobMesh.uv.map(([u, v]) => { const [X, Y] = ellPoint(E, u, v); return [(X - x0) / S, (Y - y0) / S]; }) }, S, S);
      else { x.save(); x.translate(E.cx - x0, E.cy - y0); x.rotate(E.a); x.drawImage(sq, -E.rx, -E.ry, 2 * E.rx, 2 * E.ry); x.restore(); }
      shade(x, S, S, D, L); return { c, x0, y0 };
    }
    capCanvas(F, sh) {
      const t = this.texImg('cap'); if (!t || !sh || !sh.cap) return null;
      const { cl, ct, w, h, D, L } = sh.cap, c = canvas(w, h), x = c.getContext('2d'), sq = texSquare(t.im, t.tex, 0.66), T = sq.width, b = F.band || BAND;
      if (/steel|stainless|metal|alumin|titan|chrome/i.test(t.title) && (F.steel || F.capMetalImg)) {
        if (F.steel) x.drawImage(masked(F.steel, sh.cap.region), cl, ct, w, h, 0, 0, w, h); else x.drawImage(F.capMetalImg, 0, 0, w, h);
        return { c, cl, ct };
      }
      if (F.capMesh) drawMesh(x, sq, F.capMesh, w, h, b[0] * T, b[1] * T, b[2] * T, b[3] * T); else x.drawImage(sq, b[0] * T, b[1] * T, b[2] * T, b[3] * T, 0, 0, w, h);
      shade(x, w, h, D, L); return { c, cl, ct };
    }
    cutCache(F) {
      if (F._cut && F._cut.ver === F.ver) return F._cut;
      const cut = F.layers.mask ? masked(F.photo, F.layers.mask) : null;
      const t = {}; ['mask', 'front', 'knob', 'cap'].forEach((k) => { if (F.layers[k]) t[k] = tint(F.layers[k], COL[k]); });
      const hint = {}; Object.entries(F.hints).forEach(([k, v]) => { if (v) hint[k] = v; });
      F._cut = { ver: F.ver, cut, t, hint }; return F._cut;
    }
    /* the still parts (body, plus the cap on the Z1 kind) and the moving part (front, accent piece, plus the cap on the Z2 kind) */
    parts(F, sh, { noCap = false } = {}) {
      const W = F.photo.width, H = F.photo.height, still = canvas(W, H), move = canvas(W, H), xs = still.getContext('2d'), xm = move.getContext('2d');
      let body = F.layers.mask; if (F.layers.front && this.hinge !== 'none') body = combine(body, F.layers.front, 'destination-out'); if (F.layers.cap) body = combine(body, F.layers.cap, 'destination-out');
      const front = F.layers.front && this.hinge !== 'none' ? masked(F.photo, combine(F.layers.front, F.layers.mask, 'destination-in')) : null;
      xs.drawImage(masked(F.photo, body), 0, 0);
      const drawCap = (x) => { if (noCap) { if (sh && sh.cap) { const [ox, oy, ow, oh] = sh.cap.nonePos; x.drawImage(F.uncapped && F.uncappedMask ? this.uncappedPatch(F, sh.cap) : sh.cap.none, ox, oy, ow, oh); } } else { const cc = this.capCanvas(F, sh); if (cc) x.drawImage(cc.c, cc.cl, cc.ct); else if (F.layers.cap) x.drawImage(masked(F.photo, F.layers.cap), 0, 0); } };
      if (this.hinge === 'slide') drawCap(xs);
      if (front) xm.drawImage(front, 0, 0);
      const kc = this.knobCanvas(F, sh); if (kc) xm.drawImage(kc.c, kc.x0, kc.y0);
      if (this.hinge !== 'slide') drawCap(xm);
      return { still, move, front: !!front };
    }
    drawParts(x, F, P, pose, chamber) {
      const E = F.faceEll;
      if (chamber > 0 && E && P.front) { x.save(); x.globalAlpha = chamber; x.fillStyle = '#0d0d0f'; x.beginPath(); x.ellipse(E.cx, E.cy, E.rx, E.ry, E.a, 0, Math.PI * 2); x.fill(); x.restore(); }
      x.drawImage(P.still, 0, 0);
      x.save(); if (pose && P.front) this.applyPose(x, pose, F); x.drawImage(P.move, 0, 0); x.restore();
    }
    composite(F, sh, { open = false, noCap = false } = {}) {
      const W = F.photo.width, H = F.photo.height, c = canvas(W, H), x = c.getContext('2d');
      if (!F.layers.mask) { x.drawImage(F.photo, 0, 0); return c; }
      const P = this.parts(F, sh, { noCap });
      this.drawParts(x, F, P, open && F.faceEll ? this.openPose(F) : null, open ? 1 : 0);
      return c;
    }

    /* ---------- opening: frame, hinge point, poses (in photo pixels) ---------- */
    // the builder's frame: the saved photo for loaded art, else the crop Save art makes (the union of the cut-outs)
    frameBox(F = this.f) {
      const W = F.photo.width, H = F.photo.height;
      if (F.fromArt) return { X0: 0, Y0: 0, BW: W, BH: H };
      const list = this.fins.map((f) => this.F[f.slug]).filter((G) => G.photo && G.layers.mask);
      if (!list.length) return { X0: 0, Y0: 0, BW: W, BH: H };
      const key = list.map((G) => G.slug + ':' + G.ver).join();
      if (this._fb && this._fb.key === key) return this._fb.b;
      const b = cropOf(list); this._fb = { key, b }; return b;
    }
    frontBox(F) { if (!F.layers.front) return null; if (!F._fbx || F._fbx.ver !== F.ver) F._fbx = { ver: F.ver, b: bbox(F.layers.front) }; return F._fbx.b; }
    defaultPivot(F) {
      const E = F.faceEll; if (E) return this.hinge === 'slide' ? [E.cx, E.cy] : [E.cx, E.cy + E.ry];
      const b = this.frontBox(F); return b ? [b.x + b.w / 2, this.hinge === 'slide' ? b.y + b.h / 2 : b.y + b.h] : [F.photo.width / 2, F.photo.height / 2];
    }
    pivotPx(F = this.f) {
      const H = this.H;
      if (H.pivotPx) return H.pivotPx;
      if (H.pivotPct && F.photo) { const b = this.frameBox(F); H.pivotPx = [b.X0 + H.pivotPct[0] / 100 * b.BW, b.Y0 + H.pivotPct[1] / 100 * b.BH]; return H.pivotPx; }
      return this.defaultPivot(F);
    }
    slideVec(F) {
      const H = this.H, b = this.frameBox(F), out = H.dist;
      const dx = H.dir == null ? -out : out * Math.cos(rad(H.dir)), dy = H.dir == null ? out * 0.06 : out * Math.sin(rad(H.dir));
      return { dx, dy, px: dx / 100 * b.BW, py: dy / 100 * b.BH };
    }
    openPose(F) { if (this.hinge === 'slide') { const v = this.slideVec(F); return { tx: v.px, ty: v.py }; } return { rot: this.H.angle }; }
    overPose(F) { if (this.hinge === 'slide') { const v = this.slideVec(F); return { tx: -v.px * 0.03, ty: 0 }; } return { rot: -this.H.angle * 0.032 }; }
    applyPose(x, pose, F) {
      if (this.hinge === 'slide') { x.translate(pose.tx || 0, pose.ty || 0); return; }
      const [px, py] = this.pivotPx(F); x.translate(px, py); x.rotate(rad(pose.rot || 0)); x.translate(-px, -py);
    }
    slideOrigin(F) { const E = F.faceEll; if (E) return [E.cx, E.cy]; const b = this.frontBox(F); return b ? [b.x + b.w / 2, b.y + b.h / 2] : this.pivotPx(F); }
    play() {
      const F = this.f;
      if (!F.photo || !F.layers.mask || !F.layers.front || this.hinge === 'none') { this.toast('Mark the front assembly first (step 3).'); return; }
      cancelAnimationFrame(this._play);
      const P = this.parts(F, this.shading(F)), P1 = this.openPose(F), P2 = this.overPose(F), D = this.H.ms, t0 = performance.now();
      this.playLog = [];
      const tick = (now) => {
        const p = Math.min(1, (now - t0) / D), pose = poseAt(p, P1, P2);
        this.playing = { P, pose, chamber: chamberAt(p) }; this.playLog.push({ p, ...pose }); this.paint();
        if (p < 1) this._play = requestAnimationFrame(tick); else { this.playing = null; this.draw(); }
      };
      this._play = requestAnimationFrame(tick);
    }
    hingeOut(b, F) {
      const H = this.H, o = { mode: H.mode };
      if (H.mode === 'swing') o.angle = r2(H.angle);
      if (H.mode === 'slide') { o.dist = r2(H.dist); if (H.dir != null) o.dir = r2(((H.dir % 360) + 360) % 360); }
      if (H.mode !== 'none') {
        if (H.pivotPx && b && F && F.photo) o.pivot = [r3((H.pivotPx[0] - b.X0) / b.BW * 100), r3((H.pivotPx[1] - b.Y0) / b.BH * 100)];
        else if (H.pivotPct) o.pivot = H.pivotPct.map(r3);
        o.ms = Math.round(H.ms);
      }
      return o;
    }
    /* change only how it opens, on the art that is already saved (the built-in Z1 and Z2 art too) */
    saveOpening() {
      const g = this.g, msg = this.q('openMsg');
      if (!g.geom || !g.art) { if (msg) { msg.className = 'zs-warn'; msg.textContent = 'Save art first. It saves the opening too.'; } return; }
      const F = this.fins.map((f) => this.F[f.slug]).find((G) => G.fromArt && G.photo) || this.f;
      g.geom.hinge = this.hingeOut(F.photo ? this.frameBox(F) : null, F);
      if (this.hinge === 'slide') Object.values(g.geom).forEach((G) => { if (G && typeof G === 'object' && G.face) G.open = r2(this.H.dist); });
      if (this.o.onChange) this.o.onChange();
      this.openingSaved = JSON.parse(JSON.stringify(g.geom.hinge));
      if (msg) { msg.className = 'zs-ok'; msg.textContent = 'Opening saved. The art stays as it is.'; }
    }
    uncappedPatch(F, cap) {
      const [ox, oy, ow, oh] = cap.nonePos, pad = Math.round(cap.h * 0.6);
      const reg = canvas(F.photo.width, F.photo.height), x = reg.getContext('2d'); x.filter = 'blur(1px)'; x.drawImage(cap.region, 0, 0); x.filter = 'none';
      const m = combine(reg, F.uncappedMask, 'destination-in'), p = masked(F.uncapped, m), c = canvas(ow, oh + pad);
      c.getContext('2d').drawImage(p, ox, oy, ow, oh + pad, 0, 0, ow, oh + pad); return c;
    }
    draw() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; this.paint(); });
    }
    paint() {
      const x = this.ctx, d = devicePixelRatio || 1, F = this.f, k = STEPS[this.step].k, vw = this.cv.width / d, vh = this.cv.height / d;
      x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, vw, vh); x.fillStyle = '#2a2b2e'; x.fillRect(0, 0, vw, vh);
      this.q('zl').textContent = Math.round(this.view.s * 100) + '%';
      if (!F.photo) { x.fillStyle = '#c9c9c9'; x.font = '600 15px -apple-system,Segoe UI,sans-serif'; x.textAlign = 'center'; x.fillText(`Add a photo for ${F.name} to start`, vw / 2, vh / 2); return; }
      const { s, x: tx, y: ty } = this.view, W = F.photo.width, H = F.photo.height;
      x.setTransform(d * s, 0, 0, d * s, d * tx, d * ty);
      // checkerboard shows what is see-through
      x.save(); x.fillStyle = this._checker || (this._checker = (() => { const c = canvas(16, 16), y = c.getContext('2d'); y.fillStyle = '#3a3b3f'; y.fillRect(0, 0, 16, 16); y.fillStyle = '#323336'; y.fillRect(0, 0, 8, 8); y.fillRect(8, 8, 8, 8); return x.createPattern(c, 'repeat'); })());
      x.fillRect(0, 0, W, H); x.restore();
      x.imageSmoothingQuality = 'high';
      const C = F.photo && this.cutCache(F);
      const lk = this.layerKey;
      if (this.playing && C.cut) { this.drawParts(x, F, this.playing.P, this.playing.pose, this.playing.chamber); }
      else if (k === 'photo' || !C.cut) { x.drawImage(F.photo, 0, 0); }
      else if (k === 'save' || (k === 'face' && this.previewOpen)) { x.drawImage(this.composite(F, this.shading(F), { open: this.previewOpen, noCap: this.previewNoCap && k === 'save' }), 0, 0); }
      else {
        if (k === 'mask' && this.showBg) { x.globalAlpha = 0.28; x.drawImage(F.photo, 0, 0); x.globalAlpha = 1; }
        x.drawImage(C.cut, 0, 0);
        if (k === 'mask') { x.globalAlpha = 0.12; x.drawImage(C.t.mask, 0, 0); x.globalAlpha = 1; }
        if (k === 'front' && C.t.front) {
          x.globalAlpha = 0.38; x.drawImage(C.t.front, 0, 0); x.globalAlpha = 1;
          if (this.hinge !== 'none') { x.save(); x.globalAlpha = 0.3; this.applyPose(x, this.openPose(F), F); x.drawImage(C.t.front, 0, 0); x.restore(); }   // where it ends up when open
        }
        if (k === 'knob') { const kc = this.knobCanvas(F, this.shading(F)); if (kc) x.drawImage(kc.c, kc.x0, kc.y0); if (C.t.knob) { x.globalAlpha = 0.35; x.drawImage(C.t.knob, 0, 0); x.globalAlpha = 1; } }
        if (k === 'cap') { const cc = this.capCanvas(F, this.shading(F)); if (cc) x.drawImage(cc.c, cc.cl, cc.ct); if (C.t.cap) { x.globalAlpha = cc ? 0.18 : 0.45; x.drawImage(C.t.cap, 0, 0); x.globalAlpha = 1; } }
        if (k === 'face' && C.t.front && this.hinge !== 'none') { x.globalAlpha = 0.18; x.drawImage(C.t.front, 0, 0); x.globalAlpha = 1; }
        if (lk && C.hint[lk]) { x.globalAlpha = 0.5; x.drawImage(C.hint[lk], 0, 0); x.globalAlpha = 1; }
      }
      // shape outlines and handles, drawn in screen pixels
      x.setTransform(d, 0, 0, d, 0, 0);
      const P = (X, Y) => [tx + X * s, ty + Y * s];
      if (lk && this.tool === 'points' && F.vec[lk]) this.paintPoints(x, F.vec[lk], P);
      if (k === 'knob' && F.knobEll) { this.paintEllipse(x, F.knobEll, COL.knob, P, this.tool === 'ellipse'); if (this.tool === 'mesh' && F.knobMesh) this.paintMesh(x, F.knobMesh.n, F.knobMesh.uv.map(([u, v]) => ellPoint(F.knobEll, u, v)), P); }
      if (k === 'cap' && this.tool === 'mesh' && F.capMesh) { const sh = this.shading(F); if (sh && sh.cap) { const { cl, ct, w, h } = sh.cap; this.paintMesh(x, F.capMesh.n, F.capMesh.pts.map(([fx, fy]) => [cl + fx * w, ct + fy * h]), P); } }
      if (k === 'face' && F.faceEll && this.hinge !== 'none') this.paintEllipse(x, F.faceEll, COL.face, P, this.tool === 'ellipse', true);
      if (k === 'front' && this.hinge !== 'none' && C.cut && !this.playing) this.paintHinge(x, F, P);
      if (this.lasso && this.lasso.length > 1) { x.strokeStyle = '#fff'; x.setLineDash([5, 4]); x.lineWidth = 1.5; x.beginPath(); this.lasso.forEach((p, i) => x[i ? 'lineTo' : 'moveTo'](...P(...p))); x.stroke(); x.setLineDash([]); }
      if (this.poly && this.poly.length) { x.strokeStyle = '#fff'; x.lineWidth = 1.5; x.beginPath(); this.poly.forEach((p, i) => x[i ? 'lineTo' : 'moveTo'](...P(...p))); if (this.hover) x.lineTo(...P(...this.hover)); x.stroke(); this.poly.forEach((p, i) => { x.fillStyle = i ? '#fff' : '#ffd400'; x.fillRect(P(...p)[0] - 3, P(...p)[1] - 3, 6, 6); }); }
      if (this.rectDrag) { const [a, b] = this.rectDrag, [ax, ay] = P(...a), [bx, by] = P(...b); x.strokeStyle = '#fff'; x.setLineDash([6, 4]); x.lineWidth = 1.5; x.strokeRect(ax, ay, bx - ax, by - ay); x.setLineDash([]); }
      if (this.hover && ['keep', 'remove', 'paint', 'erase'].includes(this.tool)) { const [hx, hy] = P(...this.hover); x.strokeStyle = this.tool === 'keep' ? '#00c853' : this.tool === 'remove' ? '#ff1744' : '#fff'; x.lineWidth = 1.5; x.beginPath(); x.arc(hx, hy, this.brush / 2, 0, Math.PI * 2); x.stroke(); }
    }
    hingeHandle(F) {
      if (this.hinge === 'slide') { const o = this.slideOrigin(F), v = this.slideVec(F); return { kind: 'tip', o, p: [o[0] + v.px, o[1] + v.py] }; }
      return { kind: 'pivot', p: this.pivotPx(F) };
    }
    paintHinge(x, F, P) {
      const h = this.hingeHandle(F), col = COL.front, [hx, hy] = P(...h.p);
      x.save(); x.lineWidth = 2; x.strokeStyle = col; x.fillStyle = col;
      if (h.kind === 'tip') {
        const [ox, oy] = P(...h.o), a = Math.atan2(hy - oy, hx - ox);
        x.setLineDash([6, 4]); x.beginPath(); x.moveTo(ox, oy); x.lineTo(hx, hy); x.stroke(); x.setLineDash([]);
        x.beginPath(); x.moveTo(hx, hy); x.lineTo(hx - 12 * Math.cos(a - 0.45), hy - 12 * Math.sin(a - 0.45)); x.lineTo(hx - 12 * Math.cos(a + 0.45), hy - 12 * Math.sin(a + 0.45)); x.closePath(); x.fill();
        x.beginPath(); x.arc(ox, oy, 4, 0, Math.PI * 2); x.fill();
        x.beginPath(); x.arc(hx, hy, 8, 0, Math.PI * 2); x.strokeStyle = '#fff'; x.stroke();
      } else {
        // the swing: an arc from straight up through the opening angle
        const R = 46, a0 = -Math.PI / 2, a1 = a0 + rad(this.H.angle);
        x.globalAlpha = 0.85; x.beginPath(); x.moveTo(hx, hy); x.arc(hx, hy, R, Math.min(a0, a1), Math.max(a0, a1)); x.closePath(); x.fillStyle = 'rgba(232,163,58,.25)'; x.fill(); x.globalAlpha = 1;
        x.beginPath(); x.moveTo(hx, hy); x.lineTo(hx + R * Math.cos(a1), hy + R * Math.sin(a1)); x.stroke();
        x.strokeStyle = '#fff'; x.lineWidth = 3; x.beginPath(); x.moveTo(hx - 14, hy); x.lineTo(hx + 14, hy); x.moveTo(hx, hy - 14); x.lineTo(hx, hy + 14); x.stroke();
        x.strokeStyle = col; x.lineWidth = 1.5; x.beginPath(); x.moveTo(hx - 14, hy); x.lineTo(hx + 14, hy); x.moveTo(hx, hy - 14); x.lineTo(hx, hy + 14); x.stroke();
        x.beginPath(); x.arc(hx, hy, 8, 0, Math.PI * 2); x.strokeStyle = '#fff'; x.lineWidth = 2; x.stroke();
      }
      x.restore();
    }
    paintPoints(x, V, P) {
      x.lineWidth = 1; x.strokeStyle = 'rgba(255,255,255,.75)';
      V.rings.forEach((r, ri) => { x.beginPath(); r.pts.forEach((p, i) => x[i ? 'lineTo' : 'moveTo'](...P(...p))); x.closePath(); x.stroke();
        r.pts.forEach((p, i) => { const [a, b] = P(...p), sel = this.sel && this.sel[0] === ri && this.sel[1] === i; x.fillStyle = sel ? '#005bd3' : '#fff'; x.strokeStyle = '#1a1a1a'; x.fillRect(a - 3, b - 3, 6, 6); x.strokeRect(a - 3, b - 3, 6, 6); }); });
    }
    ellHandles(E) { const c = Math.cos(E.a), s = Math.sin(E.a), off = 26 / this.view.s; return { c: [E.cx, E.cy], rx: [E.cx + E.rx * c, E.cy + E.rx * s], ry: [E.cx - E.ry * s, E.cy + E.ry * c], rot: [E.cx + (E.ry + off) * s, E.cy - (E.ry + off) * c] }; }
    paintEllipse(x, E, col, P, handles, fill) {
      const [cx, cy] = P(E.cx, E.cy), s = this.view.s;
      x.save(); x.lineWidth = 2; x.strokeStyle = col; x.beginPath(); x.ellipse(cx, cy, E.rx * s, E.ry * s, E.a, 0, Math.PI * 2);
      if (fill) { x.fillStyle = 'rgba(13,13,15,.45)'; x.fill(); } x.stroke();
      if (handles) {
        const h = this.ellHandles(E), top = P(...h.ry.map((v, i) => 2 * [E.cx, E.cy][i] - v));
        x.setLineDash([4, 3]); x.beginPath(); x.moveTo(...top); x.lineTo(...P(...h.rot)); x.stroke(); x.setLineDash([]);
        Object.entries(h).forEach(([k, p]) => { const [a, b] = P(...p); x.fillStyle = k === 'rot' ? col : '#fff'; x.strokeStyle = '#1a1a1a'; x.lineWidth = 1.5; x.beginPath(); x.arc(a, b, k === 'c' ? 5 : 6, 0, Math.PI * 2); x.fill(); x.stroke(); });
      }
      x.restore();
    }
    paintMesh(x, n, pts, P) {
      x.save(); x.strokeStyle = 'rgba(255,255,255,.85)'; x.lineWidth = 1;
      for (let j = 0; j <= n; j++) { x.beginPath(); for (let i = 0; i <= n; i++) x[i ? 'lineTo' : 'moveTo'](...P(...pts[j * (n + 1) + i])); x.stroke(); }
      for (let i = 0; i <= n; i++) { x.beginPath(); for (let j = 0; j <= n; j++) x[j ? 'lineTo' : 'moveTo'](...P(...pts[j * (n + 1) + i])); x.stroke(); }
      pts.forEach((p) => { const [a, b] = P(...p); x.fillStyle = '#ffd400'; x.strokeStyle = '#1a1a1a'; x.beginPath(); x.arc(a, b, 5, 0, Math.PI * 2); x.fill(); x.stroke(); });
      x.restore();
    }
    /* cap strip picker in the side panel: which band of the cap photo becomes the cap's edge */
    drawBand() {
      const cv = this.q('bandCv'), R = this.q('bandR'), F = this.f; if (!cv || !R) return;
      const t = this.texImg('cap'), x = cv.getContext('2d'); x.clearRect(0, 0, 240, 240);
      if (t) x.drawImage(texSquare(t.im, t.tex, 0.66), 0, 0, 240, 240); else { x.fillStyle = '#eee'; x.fillRect(0, 0, 240, 240); }
      const b = F.band || BAND; Object.assign(R.style, { left: b[0] * 100 + '%', top: b[1] * 100 + '%', width: b[2] * 100 + '%', height: b[3] * 100 + '%' });
      const box = this.q('band');
      R.onpointerdown = (e) => {
        e.preventDefault(); const r = box.getBoundingClientRect(), resize = e.target.tagName === 'I', b0 = (F.band || BAND).slice(), sx = e.clientX, sy = e.clientY;
        this.pushUndo(); R.setPointerCapture(e.pointerId);
        R.onpointermove = (m) => {
          const dx = (m.clientX - sx) / r.width, dy = (m.clientY - sy) / r.height, nb = b0.slice();
          if (resize) { nb[2] = clamp(b0[2] + dx, 0.05, 1 - b0[0]); nb[3] = clamp(b0[3] + dy, 0.02, 1 - b0[1]); } else { nb[0] = clamp(b0[0] + dx, 0, 1 - b0[2]); nb[1] = clamp(b0[1] + dy, 0, 1 - b0[3]); }
          F.band = nb.map(r3); Object.assign(R.style, { left: nb[0] * 100 + '%', top: nb[1] * 100 + '%', width: nb[2] * 100 + '%', height: nb[3] * 100 + '%' }); this.draw();
        };
        R.onpointerup = () => { R.onpointermove = null; this.changed(F); };
      };
    }

    /* ---------- pointer tools ---------- */
    bindPointer() {
      const v = this.q('view');
      v.addEventListener('wheel', (e) => { e.preventDefault(); const [, , sx, sy] = this.toImg(e); this.zoomBy(Math.exp(-e.deltaY * 0.0015), sx, sy); }, { passive: false });
      v.addEventListener('pointermove', (e) => { const [X, Y] = this.toImg(e); this.hover = [X, Y]; if (!this.drag && (this.poly || ['keep', 'remove', 'paint', 'erase'].includes(this.tool))) this.draw(); });
      v.addEventListener('pointerleave', () => { this.hover = null; this.draw(); });
      v.addEventListener('dblclick', (e) => {
        const [X, Y] = this.toImg(e);
        if (this.poly) { this.closePoly(); return; }
        if (this.tool === 'points') this.insertPoint(X, Y);
      });
      v.addEventListener('pointerdown', (e) => {
        const F = this.f; if (!F.photo) return;
        v.setPointerCapture(e.pointerId);
        const [X, Y, sx, sy] = this.toImg(e), tool = (e.button === 1 || this.keys.space) ? 'pan' : this.tool;
        const end = (fn) => { const up = () => { v.removeEventListener('pointermove', mv); v.removeEventListener('pointerup', up); v.removeEventListener('pointercancel', up); this.drag = null; fn && fn(); }; v.addEventListener('pointerup', up); v.addEventListener('pointercancel', up); };
        let mv = () => {};
        if (tool === 'pan') {
          const v0 = { ...this.view }; v.classList.add('panning');
          mv = (m) => { this.view = { ...v0, x: v0.x + m.clientX - e.clientX, y: v0.y + m.clientY - e.clientY }; this.draw(); };
          v.addEventListener('pointermove', mv); this.drag = 'pan'; end(() => v.classList.remove('panning')); return;
        }
        const lk = this.layerKey, k = STEPS[this.step].k;
        if (k === 'front' && this.hinge !== 'none' && F.layers.mask) {
          const h = this.hingeHandle(F), near = Math.hypot((h.p[0] - X) * this.view.s, (h.p[1] - Y) * this.view.s) < 14;
          if (near || tool === 'hinge') {
            const set = (mx, my) => {
              if (h.kind === 'pivot') { this.H.pivotPx = [mx, my]; this.H.pivotPct = null; }
              else { const b = this.frameBox(F), ddx = (mx - h.o[0]) / b.BW * 100, ddy = (my - h.o[1]) / b.BH * 100; this.H.dist = clamp(r2(Math.hypot(ddx, ddy)), 0.5, 60); this.H.dir = r2(((deg(Math.atan2(ddy, ddx)) % 360) + 360) % 360); }
              this.dirty = true; this.draw();
            };
            if (!near) set(X, Y);
            mv = (m) => { const [mx, my] = this.toImg(m); set(mx, my); };
            v.addEventListener('pointermove', mv); this.drag = 'hinge';
            end(() => this.renderSide());
            return;
          }
        }
        if (tool === 'hinge') return;
        if (['keep', 'remove', 'paint', 'erase'].includes(tool)) {
          if (!lk || (lk !== 'mask' && !F.layers.mask)) { this.toast('Cut out the grinder first (step 2).'); return; }
          this.pushUndo();
          const hint = tool === 'keep' || tool === 'remove';
          let target;
          if (hint) { F.hints[lk] = F.hints[lk] ? copyCanvas(F.hints[lk]) : canvas(F.photo.width, F.photo.height); target = F.hints[lk]; }
          else { target = this.editable(lk); F.vec[lk] = null; }
          const g = target.getContext('2d'), r = this.brush / 2 / this.view.s;
          g.lineCap = g.lineJoin = 'round'; g.lineWidth = 2 * r;
          g.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
          g.strokeStyle = g.fillStyle = tool === 'keep' ? 'rgb(0,200,83)' : tool === 'remove' ? 'rgb(255,23,68)' : '#fff';
          let last = [X, Y]; g.beginPath(); g.arc(X, Y, r, 0, Math.PI * 2); g.fill();
          mv = (m) => { const [mx, my] = this.toImg(m); g.beginPath(); g.moveTo(...last); g.lineTo(mx, my); g.stroke(); last = [mx, my]; this.hover = last; F._cut = null; this.draw(); };
          v.addEventListener('pointermove', mv); this.drag = 'brush';
          end(() => {
            g.globalCompositeOperation = 'source-over';
            if (hint) this.runAuto(lk, F.layers[lk] ? {} : { rect: this.hintRect(F.hints[lk]) });
            else { if (lk !== 'mask' && F.layers.mask && lk !== 'knob') F.layers[lk] = combine(F.layers[lk], F.layers.mask, 'destination-in'); this.changed(F); this.renderSide(); this.renderLayers(); }
          });
          return;
        }
        if (tool === 'lasso') {
          this.lasso = [[X, Y]]; const sub = e.shiftKey || e.altKey || this.mode === 'sub';
          mv = (m) => { const [mx, my] = this.toImg(m); this.lasso.push([mx, my]); this.draw(); };
          v.addEventListener('pointermove', mv); this.drag = 'lasso';
          end(() => { const pts = this.lasso; this.lasso = null; if (pts.length > 2) this.fillShape(pts, sub); else this.draw(); });
          return;
        }
        if (tool === 'poly') {
          if (!this.poly) this.poly = [];
          const first = this.poly[0];
          if (first && this.poly.length > 2 && Math.hypot((first[0] - X) * this.view.s, (first[1] - Y) * this.view.s) < 9) { this.closePoly(); return; }
          this.poly.push([X, Y]); this.polySub = e.shiftKey || e.altKey || this.mode === 'sub'; this.draw(); return;
        }
        if (tool === 'rect') {
          this.rectDrag = [[X, Y], [X, Y]];
          mv = (m) => { const [mx, my] = this.toImg(m); this.rectDrag[1] = [mx, my]; this.draw(); };
          v.addEventListener('pointermove', mv); this.drag = 'rect';
          end(() => {
            const [[ax, ay], [bx, by]] = this.rectDrag; this.rectDrag = null; this.draw();
            const R = { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
            if (R.w * this.view.s < 8 || R.h * this.view.s < 8) return;
            this.runAuto(lk || 'mask', { rect: R });
          });
          return;
        }
        if (tool === 'ellipse') {
          const key = k === 'knob' ? 'knobEll' : 'faceEll', E = F[key];
          const hit = E && Object.entries(this.ellHandles(E)).find(([, p]) => Math.hypot((p[0] - X) * this.view.s, (p[1] - Y) * this.view.s) < 10);
          const inside = E && (() => { const [u, w] = ellLocal(E, X, Y); return u * u + w * w < 0.25; })();
          this.pushUndo();
          if (hit || inside) {
            const which = hit ? hit[0] : 'c', E0 = { ...E };
            mv = (m) => {
              const [mx, my] = this.toImg(m), N = { ...E0 };
              if (which === 'c') { N.cx = E0.cx + mx - X; N.cy = E0.cy + my - Y; }
              else if (which === 'rot') N.a = Math.atan2(mx - E0.cx, -(my - E0.cy));
              else { const c = Math.cos(E0.a), s = Math.sin(E0.a), dx = mx - E0.cx, dy = my - E0.cy; if (which === 'rx') N.rx = Math.max(2, Math.abs(dx * c + dy * s)); else N.ry = Math.max(2, Math.abs(-dx * s + dy * c)); }
              F[key] = N; F._cache = null; this.draw();
            };
          } else {
            const a0 = E ? E.a : 0;
            mv = (m) => { const [mx, my] = this.toImg(m); F[key] = { cx: (X + mx) / 2, cy: (Y + my) / 2, rx: Math.max(2, Math.abs(mx - X) / 2), ry: Math.max(2, Math.abs(my - Y) / 2), a: a0 }; F._cache = null; this.draw(); };
          }
          v.addEventListener('pointermove', mv); this.drag = 'ellipse';
          end(() => { if (F.knobMesh && key === 'knobEll') { /* the mold follows the ellipse */ } this.changed(F); this.renderSide(); this.renderLayers(); });
          return;
        }
        if (tool === 'points' && lk && F.vec[lk]) {
          let best = null;
          F.vec[lk].rings.forEach((r, ri) => r.pts.forEach((p, i) => { const dd = Math.hypot((p[0] - X) * this.view.s, (p[1] - Y) * this.view.s); if (dd < 8 && (!best || dd < best[2])) best = [ri, i, dd]; }));
          this.sel = best ? [best[0], best[1]] : null; this.draw();
          if (!best) return;
          this.pushUndo(); F.vec[lk] = JSON.parse(JSON.stringify(F.vec[lk]));
          const pt = F.vec[lk].rings[best[0]].pts[best[1]];
          mv = (m) => { const [mx, my] = this.toImg(m); pt[0] = mx; pt[1] = my; clearTimeout(this._pt); this._pt = setTimeout(() => this.fromVec(lk, true), 30); F._cut = null; this.draw(); };
          v.addEventListener('pointermove', mv); this.drag = 'point';
          end(() => this.fromVec(lk));
          return;
        }
        if (tool === 'mesh') {
          const isKnob = k === 'knob', M = isKnob ? F.knobMesh : F.capMesh; if (!M) return;
          const sh = this.shading(F), capBox = sh && sh.cap;
          if (!isKnob && !capBox) return;
          const toP = (q) => (isKnob ? ellPoint(F.knobEll, ...q) : [capBox.cl + q[0] * capBox.w, capBox.ct + q[1] * capBox.h]);
          const list = isKnob ? M.uv : M.pts;
          let best = -1, bd = 12; list.forEach((q, i) => { const p = toP(q), dd = Math.hypot((p[0] - X) * this.view.s, (p[1] - Y) * this.view.s); if (dd < bd) { bd = dd; best = i; } });
          if (best < 0) return;
          this.pushUndo(); if (isKnob) F.knobMesh = JSON.parse(JSON.stringify(M)); else F.capMesh = JSON.parse(JSON.stringify(M));
          const L2 = isKnob ? F.knobMesh.uv : F.capMesh.pts;
          mv = (m) => { const [mx, my] = this.toImg(m); L2[best] = isKnob ? ellLocal(F.knobEll, mx, my) : [(mx - capBox.cl) / capBox.w, (my - capBox.ct) / capBox.h]; (isKnob ? F.knobMesh : F.capMesh).fresh = false; this.draw(); };
          v.addEventListener('pointermove', mv); this.drag = 'mesh';
          end(() => { this.dirty = true; this.renderSide(); });
        }
      });
    }
    hintRect(h) { const b = bbox(h); return b ? { x: b.x - b.w * 0.15, y: b.y - b.h * 0.15, w: b.w * 1.3, h: b.h * 1.3 } : null; }
    closePoly() { const pts = this.poly; this.poly = null; if (pts && pts.length > 2) this.fillShape(pts, this.polySub); else this.draw(); }
    fillShape(pts, sub) {
      const F = this.f, lk = this.layerKey; if (!lk) return;
      if (lk !== 'mask' && !F.layers.mask) { this.toast('Cut out the grinder first (step 2).'); return; }
      this.pushUndo();
      const c = this.editable(lk), g = c.getContext('2d');
      g.globalCompositeOperation = sub ? 'destination-out' : 'source-over'; g.fillStyle = '#fff';
      g.beginPath(); pts.forEach((p, i) => g[i ? 'lineTo' : 'moveTo'](...p)); g.closePath(); g.fill(); g.globalCompositeOperation = 'source-over';
      if (lk !== 'mask' && lk !== 'knob') F.layers[lk] = combine(F.layers[lk], F.layers.mask, 'destination-in');
      F.vec[lk] = null; this.changed(F); this.renderSide(); this.renderLayers();
    }
    insertPoint(X, Y) {
      const F = this.f, lk = this.layerKey, V = F.vec[lk]; if (!V) return;
      let best = null;
      V.rings.forEach((r, ri) => r.pts.forEach((a, i) => { const b = r.pts[(i + 1) % r.pts.length], dx = b[0] - a[0], dy = b[1] - a[1], t = clamp(((X - a[0]) * dx + (Y - a[1]) * dy) / ((dx * dx + dy * dy) || 1), 0, 1);
        const dd = Math.hypot(a[0] + t * dx - X, a[1] + t * dy - Y) * this.view.s; if (dd < 10 && (!best || dd < best[2])) best = [ri, i + 1, dd]; }));
      if (!best) return;
      this.pushUndo(); F.vec[lk] = JSON.parse(JSON.stringify(V)); F.vec[lk].rings[best[0]].pts.splice(best[1], 0, [X, Y]); this.sel = [best[0], best[1]]; this.fromVec(lk);
    }
    bindKeys() {
      this._kd = (e) => {
        if (!this.root.isConnected || /INPUT|SELECT|TEXTAREA/.test((e.target || {}).tagName)) return;
        if (e.code === 'Space') { this.keys.space = true; this.q('view').classList.add('pan'); e.preventDefault(); }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); this.undo(); }
        if (e.key === 'Enter' && this.poly) this.closePoly();
        if (e.key === 'Escape') { this.poly = null; this.draw(); }
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel && this.tool === 'points') {
          const F = this.f, lk = this.layerKey, V = F.vec[lk]; if (!V) return; e.preventDefault();
          this.pushUndo(); F.vec[lk] = JSON.parse(JSON.stringify(V)); const r = F.vec[lk].rings[this.sel[0]]; if (r.pts.length > 3) r.pts.splice(this.sel[1], 1); this.sel = null; this.fromVec(lk);
        }
      };
      this._ku = (e) => { if (e.code === 'Space') { this.keys.space = false; this.q('view').classList.toggle('pan', this.tool === 'pan'); } };
      document.addEventListener('keydown', this._kd); document.addEventListener('keyup', this._ku);
    }
    busy(t) { const b = this.q('busy'); b.classList.toggle('on', !!t); if (t) this.q('busyT').textContent = t; }
    toast(m) { if (window.shopify && shopify.toast) shopify.toast.show(m); else { const p = document.createElement('p'); p.className = 'zs-warn'; p.textContent = m; this.q('side').prepend(p); setTimeout(() => p.remove(), 6000); } this.lastMessage = m; }

    /* ---------- export: render, upload and write grinder.art and grinder.geom ---------- */
    async exportArt() {
      const list = this.fins.map((f) => this.F[f.slug]).filter((F) => F.photo && F.layers.mask);
      if (!list.length || !this.o.upload) { this.toast(this.o.upload ? 'Cut out at least one color first.' : 'Saving is not available here.'); return; }
      const btn = $('[data-act="export"]', this.q('side')), prog = this.q('prog'), msg = this.q('saveMsg');
      btn.disabled = true; prog.hidden = false; msg.textContent = 'Preparing the files';
      try {
        const { cv } = await loadCV();
        // one frame for every color: the union of the cut-outs, with room above for the funnel
        const pv = this.pivotPx(list[0]);                 // the hinge point in photo pixels, before the frame moves
        const { X0, Y0, BW, BH } = cropOf(list), pc = (x, y, w, h) => [r3((x - X0) / BW * 100), r3((y - Y0) / BH * 100), r3(w / BW * 100), r3(h / BH * 100)];
        const crop = (c, type) => { const o = canvas(BW, BH), x = o.getContext('2d'); if (type === 'jpg') { x.fillStyle = '#fff'; x.fillRect(0, 0, BW, BH); } x.drawImage(c, -X0, -Y0); return o; };
        const ver = Date.now().toString(36), key = slugify(this.g.key || this.g.name || 'grinder'), jobs = [], geom = { box: [BW, BH], shadeMax: SHADE_MAX }, finishes = {};
        if (this.H.pivotPx || this.H.pivotPct) this.H.pivotPx = pv;
        geom.hinge = this.hingeOut({ X0, Y0, BW, BH }, list[0]);
        for (const F of list) {
          const sh = { knob: F.knobEll ? knobShade(cv, F, { contrast: this.contrast, side: this.side }) : null, cap: F.layers.cap ? capShade(cv, F) : null };
          const files = {}, add = (part, c, type = 'png') => { files[part] = null; jobs.push({ F, part, c, type, name: `${key}-${F.slug}-${part.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}-${ver}.${type}` }); };
          const front = F.layers.front && this.hinge !== 'none' ? combine(F.layers.front, F.layers.mask, 'destination-in') : null;
          let body = F.layers.mask; if (front) body = combine(body, front, 'destination-out'); if (sh.cap) body = combine(body, sh.cap.region, 'destination-out');
          add('photo', crop(F.photo, 'jpg'), 'jpg'); add('mask', crop(F.layers.mask)); add('body', crop(body)); if (front) add('front', crop(front));
          const G = {};
          if (sh.knob) {
            const k = sh.knob, E = F.knobEll; add('knobD', k.D); add('knobL', k.L);
            G.knobPos = pc(k.x0, k.y0, k.S, k.S);
            G.knob = { size: k.S, cx: r2(E.cx - k.x0), cy: r2(E.cy - k.y0), w: r2(2 * E.rx), h: r2(2 * E.ry), rot: r2(-deg(E.a)) };
            if (F.knobMesh && !F.knobMesh.fresh) G.knob.mesh = { n: F.knobMesh.n, pts: F.knobMesh.uv.map(([u, v]) => { const [X, Y] = ellPoint(E, u, v); return [r3((X - k.x0) / k.S), r3((Y - k.y0) / k.S)]; }) };
          }
          if (sh.cap) {
            const c = sh.cap; add('capD', c.D); add('capL', c.L);
            G.capPos = pc(c.cl, c.ct, c.w, c.h); G.cap = { w: c.w, h: c.h };
            if (F.band) G.cap.band = F.band.map(r3);
            if (F.capMesh && !F.capMesh.fresh) G.cap.mesh = { n: F.capMesh.n, pts: F.capMesh.pts.map((p) => p.map(r3)) };
            if (F.uncapped && F.uncappedMask) { const p = this.uncappedPatch(F, c); add('capNone', p); G.capNonePos = pc(c.nonePos[0], c.nonePos[1], c.nonePos[2], p.height); }
            else { add('capNone', c.none); G.capNonePos = pc(...c.nonePos); }
            if (F.steel) { const m = canvas(c.w, c.h); m.getContext('2d').drawImage(masked(F.steel, c.region), c.cl, c.ct, c.w, c.h, 0, 0, c.w, c.h); add('capMetal', m); }
            else if (F.capMetalImg) { const m = canvas(c.w, c.h); m.getContext('2d').drawImage(F.capMetalImg, 0, 0, c.w, c.h); add('capMetal', m); }
          }
          if (F.faceEll && this.hinge !== 'none' && front) { const E = F.faceEll; G.face = { c: [r3((E.cx - X0) / BW * 100), r3((E.cy - Y0) / BH * 100)], w: r3(E.rx / BW * 100), h: r3(E.ry / BH * 100), rot: r2(deg(E.a)) }; G.open = this.hinge === 'slide' ? r2(this.H.dist) : 25; }
          geom[F.slug] = G; finishes[F.slug] = files;
        }
        let done = 0;
        const run = async (j) => {
          const blob = await toBlob(j.c, j.type === 'jpg' ? 'image/jpeg' : 'image/png', 0.9);
          const url = await this.o.upload(blob, j.name);
          if (!url) throw new Error(`${j.name} did not upload.`);
          finishes[j.F.slug][j.part] = url; done++; $('i', prog).style.width = Math.round(done / jobs.length * 100) + '%'; msg.textContent = `Uploading ${done} of ${jobs.length}`;
        };
        const q = jobs.slice(), workers = Array.from({ length: 3 }, async () => { while (q.length) await run(q.shift()); });
        await Promise.all(workers);
        Object.values(finishes).forEach((f) => Object.keys(f).forEach((k) => { if (!f[k]) delete f[k]; }));
        this.g.art = { source: 'files', finishes };
        this.g.geom = geom;
        list.forEach((F) => { if (F.photo) F.fromArt = false; });
        this.dirty = false;
        if (this.o.onChange) this.o.onChange();
        msg.className = 'zs-ok'; msg.textContent = `Saved ${jobs.length} files for ${list.map((F) => F.name).join(' and ')}. Save the catalog to publish them.`;
        this.result = { art: this.g.art, geom };
      } catch (e) { msg.className = 'zs-warn'; msg.textContent = 'Not saved: ' + e.message; }
      finally { btn.disabled = false; }
    }
  }

  /* ======================================================================
     Texture editor: which part of an accent or cap product photo is the texture
     ====================================================================== */
  class TexEditor {
    constructor(host, opts) {
      this.host = host; this.o = opts || {}; this.item = this.o.item || {}; this.cat = this.o.catalog || {};
      this.kind = this.item.kind === 'cap' ? 'cap' : 'accent'; this.view = { s: 1, x: 0, y: 0 }; this.cut = null; this.rot = 0;
      this.host.innerHTML = `<div class="zs tex" data-zs>
        <div class="zs-top"><h2>Texture</h2><span class="zs-sub">${esc(this.item.title || '')}</span></div>
        <div class="zs-main"><div class="zs-tools"><span style="color:#616161">Drag the square to choose the ${this.kind === 'cap' ? 'cap' : 'wood'} texture. Drag a corner to size it.</span></div>
          <div class="zs-view" data-r="view"><canvas data-r="cv"></canvas><div class="zs-busy" data-r="busy"><div><span class="zs-spin"></span><span data-r="busyT">Working</span></div></div></div></div>
        <aside class="zs-side" data-r="side"></aside></div>`;
      this.root = $('[data-zs]', host); this.q = (r) => $(`[data-r="${r}"]`, this.root); this.cv = this.q('cv');
      this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this.q('view'));
      this.bind(); this.renderSide(); this.load();
    }
    destroy() { this.ro.disconnect(); this.host.innerHTML = ''; }
    async load() {
      const T = ((this.cat.textures || {})[String(this.item.id)]) || null;
      this.q('busy').classList.add('on');
      try {
        const img = await loadImage((T && T.src) || this.item.image); this.img = imageCanvas(img);
        const W = this.img.width, H = this.img.height;
        if (T && T.crop) { this.sq = { x: T.crop[0] * W, y: T.crop[1] * H, s: T.crop[2] * W }; this.rot = T.rot || 0; if (T.src) this.cut = this.img; }
        else { const s = Math.min(W, H) * (this.kind === 'cap' ? 0.66 : 0.7); this.sq = { x: (W - s) / 2, y: (H - s) / 2, s }; }
        this.renderSide(); this.fit();
      } catch (e) { this.q('side').insertAdjacentHTML('afterbegin', `<p class="zs-warn">${esc(e.message)}</p>`); } finally { this.q('busy').classList.remove('on'); }
    }
    resize() { const v = this.q('view'), d = devicePixelRatio || 1; this.cv.width = Math.round(v.clientWidth * d); this.cv.height = Math.round(v.clientHeight * d); this.fit(); }
    fit() { const v = this.q('view'); if (!this.img || !v.clientWidth) return; const s = Math.min(v.clientWidth / this.img.width, v.clientHeight / this.img.height) * 0.92; this.view = { s, x: (v.clientWidth - this.img.width * s) / 2, y: (v.clientHeight - this.img.height * s) / 2 }; this.draw(); }
    texNow() { const W = this.img.width, H = this.img.height; return { crop: [r3(this.sq.x / W), r3(this.sq.y / H), r3(this.sq.s / W), r3(this.sq.s / H)], rot: this.rot }; }
    draw() {
      if (!this.img) return;
      const x = this.cv.getContext('2d'), d = devicePixelRatio || 1, { s, x: tx, y: ty } = this.view;
      x.setTransform(d, 0, 0, d, 0, 0); x.fillStyle = '#2a2b2e'; x.fillRect(0, 0, this.cv.width, this.cv.height);
      x.setTransform(d * s, 0, 0, d * s, d * tx, d * ty); x.drawImage(this.cut || this.img, 0, 0);
      const q = this.sq; x.fillStyle = 'rgba(0,0,0,.45)'; x.beginPath(); x.rect(0, 0, this.img.width, this.img.height); x.rect(q.x + q.s, q.y, -q.s, q.s); x.fill('evenodd');
      x.setTransform(d, 0, 0, d, 0, 0); x.strokeStyle = '#fff'; x.lineWidth = 2; x.strokeRect(tx + q.x * s, ty + q.y * s, q.s * s, q.s * s);
      x.fillStyle = '#fff'; x.fillRect(tx + (q.x + q.s) * s - 6, ty + (q.y + q.s) * s - 6, 12, 12);
      this.preview();
    }
    preview() {
      const c = this.q('pv'); if (!c || !this.img) return;
      const x = c.getContext('2d'), sq = texSquare(this.cut || this.img, this.texNow(), 1); x.clearRect(0, 0, c.width, c.height);
      if (this.kind === 'cap') { x.drawImage(sq, BAND[0] * sq.width, BAND[1] * sq.width, BAND[2] * sq.width, BAND[3] * sq.width, 10, 90, 220, 60); return; }
      x.save(); x.beginPath(); x.ellipse(120, 120, 80, 104, 0, 0, Math.PI * 2); x.clip(); x.drawImage(sq, 40, 16, 160, 208);
      const gr = x.createRadialGradient(95, 85, 10, 120, 120, 110); gr.addColorStop(0, 'rgba(255,255,255,.18)'); gr.addColorStop(1, 'rgba(0,0,0,.35)'); x.fillStyle = gr; x.fillRect(0, 0, 240, 240); x.restore();
    }
    renderSide() {
      this.q('side').innerHTML = `<h3>${this.kind === 'cap' ? 'Funnel cap texture' : 'Accent piece texture'}</h3>
        <p>The builder uses the square as the ${this.kind === 'cap' ? 'cap material. The middle strip becomes the cap edge.' : 'wood on the accent piece.'}</p>
        <canvas data-r="pv" width="240" height="240" class="zs-thumb"></canvas>
        <label class="zs-field"><span>Turn the grain: <b data-r="rotV">${this.rot}&deg;</b></span><input type="range" min="-180" max="180" step="1" value="${this.rot}" data-r="rot"></label>
        <div class="zs-k">Photo</div><div class="zs-row"><button type="button" class="zs-btn" data-act="newphoto">Upload a photo</button>${this.o.pickFile ? '<button type="button" class="zs-btn" data-act="newfiles">Shopify Files</button>' : ''}</div>
        ${this.newSrc ? '<p style="font-size:12px">New photo. It is saved with the texture.</p>' : '<p style="font-size:12px">Starts from the product photo. Use a cleaner close-up if that photo has props in it.</p>'}
        <button type="button" class="zs-btn full" data-act="cut">${this.cut ? 'Undo the cut-out' : 'Remove the background'}</button>
        <p style="font-size:12px">Remove the background when the square includes the edge of the piece.</p>
        <button type="button" class="zs-btn full" data-act="reset">Reset</button>
        <button type="button" class="zs-btn primary full" data-act="apply">Use this texture</button><p data-r="msg"></p>`;
      const rot = this.q('rot'); rot.oninput = () => { this.rot = +rot.value; this.q('rotV').textContent = this.rot + '°'; this.draw(); };
      $('[data-act="reset"]', this.root).onclick = () => { if (!this.img) return; const W = this.img.width, H = this.img.height, s = Math.min(W, H) * (this.kind === 'cap' ? 0.66 : 0.7); this.sq = { x: (W - s) / 2, y: (H - s) / 2, s }; this.rot = 0; this.cut = null; this.renderSide(); this.draw(); };
      $('[data-act="cut"]', this.root).onclick = async () => {
        if (this.cut) { this.cut = null; this.renderSide(); this.draw(); return; }
        this.q('busy').classList.add('on');
        try { const rings = await autoCut(this.img, {}); this.cut = masked(this.img, renderRings(rings, this.img.width, this.img.height, { feather: 0.6 })); this.renderSide(); this.draw(); }
        catch (e) { this.q('msg').className = 'zs-warn'; this.q('msg').textContent = e.message; } finally { this.q('busy').classList.remove('on'); }
      };
      $('[data-act="apply"]', this.root).onclick = () => this.apply();
      $('[data-act="newphoto"]', this.root).onclick = async () => { const file = await pickFile(); if (file) this.useSource({ blob: file, url: URL.createObjectURL(file), name: file.name }); };
      const nf = $('[data-act="newfiles"]', this.root); if (nf) nf.onclick = async () => { const u = await this.o.pickFile({ title: `Photo for ${this.item.title || 'the texture'}` }); if (u) this.useSource({ url: u }); };
      this.preview();
    }
    async useSource(src) {
      this.q('busy').classList.add('on');
      try {
        this.img = imageCanvas(await loadImage(src.url)); this.cut = null; this.rot = 0; this.newSrc = src;
        const W = this.img.width, H = this.img.height, s = Math.min(W, H) * (this.kind === 'cap' ? 0.66 : 0.7); this.sq = { x: (W - s) / 2, y: (H - s) / 2, s };
        this.renderSide(); this.fit();
      } catch (e) { this.q('msg').className = 'zs-warn'; this.q('msg').textContent = e.message; } finally { this.q('busy').classList.remove('on'); }
    }
    async apply() {
      const msg = this.q('msg'), T = this.texNow();
      try {
        if (this.newSrc && !(this.cut && this.cut !== this.img)) {
          // a new photo without a cut-out: Shopify Files photos are used as they are, computer photos are uploaded first
          if (this.newSrc.blob) { if (!this.o.upload) throw new Error('Saving is not available here.'); msg.textContent = 'Uploading'; this.newSrc = { url: await this.o.upload(this.newSrc.blob, this.newSrc.name || `texture-${Date.now().toString(36)}.jpg`) }; }
          T.src = this.newSrc.url;
        } else if (this.cut && this.cut !== this.img) {
          if (!this.o.upload) throw new Error('Saving is not available here.');
          msg.textContent = 'Uploading';
          T.src = await this.o.upload(await toBlob(this.cut), `texture-${slugify(this.item.title || this.item.id)}-${Date.now().toString(36)}.png`);
        } else if (this.cut) T.src = ((this.cat.textures || {})[String(this.item.id)] || {}).src;
        if (!T.src) delete T.src;
        this.cat.textures = this.cat.textures || {}; this.cat.textures[String(this.item.id)] = T;
        if (this.o.onChange) this.o.onChange();
        msg.className = 'zs-ok'; msg.textContent = 'Texture set. Save the catalog to publish it.';
      } catch (e) { msg.className = 'zs-warn'; msg.textContent = 'Not saved: ' + e.message; }
    }
    bind() {
      const v = this.q('view');
      v.addEventListener('wheel', (e) => { e.preventDefault(); const b = this.cv.getBoundingClientRect(), cx = e.clientX - b.left, cy = e.clientY - b.top, k = Math.exp(-e.deltaY * 0.0015), s = clamp(this.view.s * k, 0.05, 16), r = s / this.view.s; this.view = { s, x: cx - (cx - this.view.x) * r, y: cy - (cy - this.view.y) * r }; this.draw(); }, { passive: false });
      v.addEventListener('pointerdown', (e) => {
        if (!this.img) return; v.setPointerCapture(e.pointerId);
        const b = this.cv.getBoundingClientRect(), X = (e.clientX - b.left - this.view.x) / this.view.s, Y = (e.clientY - b.top - this.view.y) / this.view.s, q0 = { ...this.sq }, W = this.img.width, H = this.img.height;
        const corner = Math.hypot((q0.x + q0.s - X) * this.view.s, (q0.y + q0.s - Y) * this.view.s) < 12, inside = X > q0.x && X < q0.x + q0.s && Y > q0.y && Y < q0.y + q0.s;
        const mv = (m) => {
          const mx = (m.clientX - b.left - this.view.x) / this.view.s, my = (m.clientY - b.top - this.view.y) / this.view.s;
          if (corner) this.sq.s = clamp(Math.max(mx - q0.x, my - q0.y), 16, Math.min(W - q0.x, H - q0.y));
          else if (inside) { this.sq.x = clamp(q0.x + mx - X, 0, W - q0.s); this.sq.y = clamp(q0.y + my - Y, 0, H - q0.s); }
          else { this.view.x += m.movementX; this.view.y += m.movementY; }
          this.draw();
        };
        const up = () => { v.removeEventListener('pointermove', mv); v.removeEventListener('pointerup', up); };
        v.addEventListener('pointermove', mv); v.addEventListener('pointerup', up);
      });
    }
  }

  /* ======================================================================
     Cut-out editor: any product photo to a transparent PNG (burrs, accessories, in-the-box items)
     ====================================================================== */
  const BGS = [['checker', 'See-through'], ['dark', 'Store'], ['light', 'White']];
  class CutoutEditor {
    constructor(host, opts) {
      this.host = host; this.o = opts || {}; this.view = { s: 1, x: 0, y: 0 }; this.tool = 'keep'; this.brush = 26;
      this.feather = 0.6; this.detail = 1.2; this.smooth = true; this.trim = true; this.square = false; this.pad = 6; this.bg = 'checker'; this.showBg = true;
      this.img = null; this.mask = null; this.vec = null; this.hints = null; this.undoStack = []; this.keys = {};
      host.innerHTML = `<div class="zs cut" data-zs>
        <div class="zs-top"><h2>Cut out</h2><span class="zs-sub">${esc(this.o.title || '')}</span></div>
        <div class="zs-main"><div class="zs-tools" data-r="tools"></div>
          <div class="zs-view" data-r="view"><canvas data-r="cv"></canvas>
            <div class="zs-zoom"><button type="button" data-z="out" aria-label="Zoom out">&minus;</button><span data-r="zl">100%</span><button type="button" data-z="in" aria-label="Zoom in">+</button><button type="button" data-z="fit">Fit</button></div>
            <div class="zs-busy" data-r="busy"><div><span class="zs-spin"></span><span data-r="busyT">Working</span></div></div></div></div>
        <aside class="zs-side" data-r="side"></aside></div>`;
      this.root = $('[data-zs]', host); this.q = (r) => $(`[data-r="${r}"]`, this.root); this.cv = this.q('cv');
      $$('[data-z]', this.root).forEach((b) => { b.onclick = () => (b.dataset.z === 'fit' ? this.fit() : this.zoomBy(b.dataset.z === 'in' ? 1.25 : 0.8)); });
      this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this.q('view'));
      this.bindPointer(); this.bindKeys(); this.renderTools(); this.renderSide();
      if (this.o.image) this.setImage(this.o.image);
    }
    destroy() { this.ro.disconnect(); document.removeEventListener('keydown', this._kd); document.removeEventListener('keyup', this._ku); this.host.innerHTML = ''; }
    busy(t) { const b = this.q('busy'); b.classList.toggle('on', !!t); if (t) this.q('busyT').textContent = t; }
    say(t, cls = 'zs-warn') { const m = this.q('msg'); if (m) { m.className = cls; m.textContent = t; } this.lastMessage = t; }
    async setImage(url) {
      this.busy('Loading the photo');
      try {
        this.img = imageCanvas(await loadImage(url)); this.mask = null; this.vec = null; this.hints = null; this.undoStack = []; this.src = url;
        this.fit(); this.renderSide();
      } catch (e) { this.busy(false); this.say(e.message); return; }
      this.busy(false);
      await this.auto();
    }
    async auto() {
      if (!this.img) return;
      this.busy('Cutting out');
      try {
        if (this.mask) this.pushUndo();
        const o = { keep: 0.04 }; if (this.hints) o.hints = this.hints; if (this.hints && this.mask) o.prior = this.mask;
        this.vec = { rings: await autoCutBest(this.img, o), smooth: this.smooth };
        this.fromVec(); this.say('', '');
      } catch (e) { if (this.mask) this.undoStack.pop(); this.say(e.message); } finally { this.busy(false); this.renderSide(); this.draw(); }
    }
    fromVec() { if (this.vec) this.mask = renderRings(this.vec.rings, this.img.width, this.img.height, { smooth: this.vec.smooth !== false, feather: this.feather }); this._out = null; this.draw(); this.preview(); }
    async crisp(again) {
      if (!this.mask) return;
      this.busy('Tracing the edges');
      try {
        if (!again) this.pushUndo();
        const src = again && this.vec ? renderRings(this.vec.rings, this.img.width, this.img.height, { smooth: this.vec.smooth !== false }) : this.mask;
        this.vec = { rings: await vectorize(src, this.detail), smooth: this.smooth }; this.fromVec(); this.tool = 'points'; this.renderTools();
      } catch (e) { this.say(e.message); } finally { this.busy(false); }
    }
    pushUndo() { this.undoStack.push({ mask: this.mask, vec: JSON.stringify(this.vec), hints: this.hints }); if (this.undoStack.length > 20) this.undoStack.shift(); const b = $('[data-act="undo"]', this.q('tools')); if (b) b.disabled = false; }
    undo() { const u = this.undoStack.pop(); if (!u) return; this.mask = u.mask; this.vec = JSON.parse(u.vec); this.hints = u.hints; this._out = null; this.renderTools(); this.draw(); this.preview(); }
    /* the PNG: the object on a see-through background, trimmed and padded, square if asked */
    output() {
      if (!this.img || !this.mask) return null;
      if (this._out) return this._out;
      const cut = masked(this.img, this.mask), W = cut.width, H = cut.height;
      const b = this.trim ? bbox(this.mask, 10) : { x: 0, y: 0, w: W, h: H };
      if (!b) return null;
      const p = this.trim || this.square ? Math.round(Math.max(b.w, b.h) * this.pad / 100) : 0;
      let ow = b.w + 2 * p, oh = b.h + 2 * p; if (this.square) ow = oh = Math.max(ow, oh);
      const o = canvas(ow, oh); o.getContext('2d').drawImage(cut, b.x, b.y, b.w, b.h, Math.round((ow - b.w) / 2), Math.round((oh - b.h) / 2), b.w, b.h);
      this._out = o; return o;
    }
    preview() {
      const c = this.q('pv'); if (!c) return;
      const x = c.getContext('2d'), o = this.output(); x.clearRect(0, 0, c.width, c.height);
      if (this.bg !== 'checker') { x.fillStyle = this.bg === 'dark' ? '#0a0b0d' : '#fff'; x.fillRect(0, 0, c.width, c.height); }
      if (!o) return;
      const k = Math.min((c.width - 20) / o.width, (c.height - 20) / o.height);
      x.imageSmoothingQuality = 'high'; x.drawImage(o, (c.width - o.width * k) / 2, (c.height - o.height * k) / 2, o.width * k, o.height * k);
      const sz = this.q('size'); if (sz) sz.textContent = `${o.width} x ${o.height} px`;
    }
    async save() {
      const o = this.output();
      if (!o) { this.say('Cut out the photo first.'); return; }
      if (!this.o.upload) { this.say('Saving is not available here.'); return; }
      const btn = $('[data-act="save"]', this.q('side')); if (btn) btn.disabled = true;
      this.say('Uploading', 'zs-tip');
      try {
        const url = await this.o.upload(await toBlob(o), `${slugify(this.o.title || 'cutout') || 'cutout'}-cutout-${Date.now().toString(36)}.png`);
        if (!url) throw new Error('The file did not upload.');
        this.result = url; this.say('Cut-out saved.', 'zs-ok');
        if (this.o.onDone) this.o.onDone(url);
      } catch (e) { this.say('Not saved: ' + e.message); } finally { if (btn) btn.disabled = false; }
    }
    renderTools() {
      const T = (id, label, dot, title) => `<button type="button" class="zs-tool" data-t="${id}" aria-pressed="${this.tool === id}" title="${esc(title || label)}">${dot ? `<span class="dot" style="background:${dot}"></span>` : ''}${label}</button>`;
      const brushy = ['keep', 'remove', 'paint', 'erase'].includes(this.tool);
      this.q('tools').innerHTML = [T('keep', 'Keep', '#00c853', 'Paint over parts to keep. The cut-out updates when you let go.'), T('remove', 'Remove', '#ff1744', 'Paint over background to remove. The cut-out updates when you let go.'), '<span class="sep"></span>',
        T('paint', 'Paint'), T('erase', 'Erase'), T('points', 'Edit points'), '<span class="sep"></span>', T('pan', 'Move view')].join('') + '<span style="flex:1"></span>'
        + (brushy ? `<label>Brush <input type="range" min="4" max="120" value="${this.brush}" data-r="brush"></label>` : '')
        + `<button type="button" class="zs-tool" data-act="undo" ${this.undoStack.length ? '' : 'disabled'} title="Undo (Ctrl+Z)">Undo</button>`;
      $$('[data-t]', this.q('tools')).forEach((b) => { b.onclick = () => { this.tool = b.dataset.t; if (this.tool === 'points' && !this.vec) this.crisp(); this.renderTools(); this.draw(); }; });
      const br = this.q('brush'); if (br) br.oninput = () => { this.brush = +br.value; };
      $('[data-act="undo"]', this.q('tools')).onclick = () => this.undo();
      this.q('view').className = 'zs-view' + (this.tool === 'pan' ? ' pan' : '');
    }
    renderSide() {
      const side = this.q('side'), has = !!this.img;
      side.innerHTML = `<h3>Cut out</h3><p>${esc(this.o.hint || 'The app removes the background. Fix any spot with Keep and Remove, then save.')}</p>
        <div class="zs-k">Photo</div>
        <div class="zs-row"><button type="button" class="zs-btn" data-act="upload">${has ? 'Upload another' : 'Upload a photo'}</button>${this.o.pickFile ? '<button type="button" class="zs-btn" data-act="files">Shopify Files</button>' : ''}</div>
        ${has ? `<button type="button" class="zs-btn primary full" data-act="auto">${this.mask ? 'Cut out again' : 'Cut out automatically'}</button>
        <label class="zs-check"><input type="checkbox" data-in="showBg" ${this.showBg ? 'checked' : ''}><span>Show the removed background faintly</span></label>
        <div class="zs-k">Edges</div>
        <button type="button" class="zs-btn full" data-act="crisp" ${this.mask ? '' : 'disabled'}>Make edges crisp</button>
        <label class="zs-field"><span>Detail</span><input type="range" min="0.4" max="4" step="0.1" value="${this.detail}" data-in="detail"><small>Fewer points give smoother lines. More points follow every bump.</small></label>
        <label class="zs-field"><span>Edge softness</span><input type="range" min="0" max="2" step="0.1" value="${this.feather}" data-in="feather"><small>0 is razor sharp. 0.5 to 1 matches a photo's natural edge.</small></label>
        <label class="zs-check"><input type="checkbox" data-in="smooth" ${this.smooth ? 'checked' : ''}><span>Smooth curves between points</span></label>
        <div class="zs-k">Result</div>
        <label class="zs-check"><input type="checkbox" data-in="trim" ${this.trim ? 'checked' : ''}><span>Trim to the object</span></label>
        <label class="zs-check"><input type="checkbox" data-in="square" ${this.square ? 'checked' : ''}><span>Make it square</span></label>
        <label class="zs-field"><span data-lab="pad">Padding: ${this.pad}%</span><input type="range" min="0" max="25" step="1" value="${this.pad}" data-in="pad"></label>
        <div class="zs-seg">${BGS.map(([k, n]) => `<button type="button" data-bg="${k}" aria-pressed="${this.bg === k}">${n}</button>`).join('')}</div>
        <canvas data-r="pv" width="240" height="240" class="zs-thumb"></canvas><small class="zs-kbd" data-r="size"></small>
        <button type="button" class="zs-btn primary full" data-act="save" ${this.mask ? '' : 'disabled'}>Save cut-out</button>` : '<p class="zs-tip">Start with a sharp photo of the item on a plain background.</p>'}
        <p data-r="msg"></p>`;
      const act = (n, fn) => { const b = $(`[data-act="${n}"]`, side); if (b) b.onclick = fn; };
      act('upload', async () => { const f = await pickFile(); if (f) this.setImage(URL.createObjectURL(f)); });
      act('files', async () => { const u = await this.o.pickFile({ title: this.o.title ? `Photo for ${this.o.title}` : 'Choose a photo' }); if (u) this.setImage(u); });
      act('auto', () => this.auto()); act('crisp', () => this.crisp()); act('save', () => this.save());
      $$('[data-bg]', side).forEach((b) => { b.onclick = () => { this.bg = b.dataset.bg; $$('[data-bg]', side).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); this.preview(); }; });
      $$('[data-in]', side).forEach((el) => {
        const k = el.dataset.in;
        el[el.type === 'checkbox' ? 'onchange' : 'oninput'] = () => {
          const v = el.type === 'checkbox' ? el.checked : +el.value;
          if (k === 'showBg') { this.showBg = v; this.draw(); return; }
          if (k === 'smooth') { this.smooth = v; if (this.vec) { this.vec.smooth = v; this.fromVec(); } return; }
          if (k === 'feather') { this.feather = v; if (this.vec) this.fromVec(); return; }
          if (k === 'detail') { this.detail = v; clearTimeout(this._dt); this._dt = setTimeout(() => { if (this.vec) this.crisp(true); }, 250); return; }
          if (k === 'pad') { this.pad = v; const l = $('[data-lab="pad"]', side); if (l) l.textContent = `Padding: ${v}%`; }
          if (k === 'trim') this.trim = v; if (k === 'square') this.square = v;
          this._out = null; this.preview();
        };
      });
      this.preview();
    }
    resize() { const v = this.q('view'), d = devicePixelRatio || 1; this.cv.width = Math.round(v.clientWidth * d); this.cv.height = Math.round(v.clientHeight * d); this.fit(); }
    fit() { const v = this.q('view'); if (!this.img || !v.clientWidth) { this.draw(); return; } const s = Math.min(v.clientWidth / this.img.width, v.clientHeight / this.img.height) * 0.92; this.view = { s, x: (v.clientWidth - this.img.width * s) / 2, y: (v.clientHeight - this.img.height * s) / 2 }; this.draw(); }
    zoomBy(k, cx, cy) { const v = this.q('view'); if (cx == null) { cx = v.clientWidth / 2; cy = v.clientHeight / 2; } const s = clamp(this.view.s * k, 0.05, 16), r = s / this.view.s; this.view = { s, x: cx - (cx - this.view.x) * r, y: cy - (cy - this.view.y) * r }; this.draw(); }
    toImg(e) { const b = this.cv.getBoundingClientRect(), sx = e.clientX - b.left, sy = e.clientY - b.top; return [(sx - this.view.x) / this.view.s, (sy - this.view.y) / this.view.s, sx, sy]; }
    draw() { if (this._raf) return; this._raf = requestAnimationFrame(() => { this._raf = 0; this.paint(); }); }
    paint() {
      const x = this.cv.getContext('2d'), d = devicePixelRatio || 1, vw = this.cv.width / d, vh = this.cv.height / d;
      x.setTransform(d, 0, 0, d, 0, 0); x.fillStyle = '#2a2b2e'; x.fillRect(0, 0, vw, vh);
      this.q('zl').textContent = Math.round(this.view.s * 100) + '%';
      if (!this.img) { x.fillStyle = '#c9c9c9'; x.font = '600 15px -apple-system,Segoe UI,sans-serif'; x.textAlign = 'center'; x.fillText('Add a photo to start', vw / 2, vh / 2); return; }
      const { s, x: tx, y: ty } = this.view, W = this.img.width, H = this.img.height;
      x.setTransform(d * s, 0, 0, d * s, d * tx, d * ty);
      x.save(); x.fillStyle = this._checker || (this._checker = (() => { const c = canvas(16, 16), y = c.getContext('2d'); y.fillStyle = '#3a3b3f'; y.fillRect(0, 0, 16, 16); y.fillStyle = '#323336'; y.fillRect(0, 0, 8, 8); y.fillRect(8, 8, 8, 8); return x.createPattern(c, 'repeat'); })()); x.fillRect(0, 0, W, H); x.restore();
      if (this.mask) {
        if (this.showBg) { x.globalAlpha = 0.25; x.drawImage(this.img, 0, 0); x.globalAlpha = 1; }
        if (!this._cut || this._cutFor !== this.mask) { this._cut = masked(this.img, this.mask); this._cutFor = this.mask; }
        x.drawImage(this._cut, 0, 0);
      } else x.drawImage(this.img, 0, 0);
      if (this.hints) { x.globalAlpha = 0.5; x.drawImage(this.hints, 0, 0); x.globalAlpha = 1; }
      x.setTransform(d, 0, 0, d, 0, 0);
      const P = (X, Y) => [tx + X * s, ty + Y * s];
      if (this.tool === 'points' && this.vec) {
        x.lineWidth = 1; x.strokeStyle = 'rgba(255,255,255,.75)';
        this.vec.rings.forEach((r, ri) => { x.beginPath(); r.pts.forEach((p, i) => x[i ? 'lineTo' : 'moveTo'](...P(...p))); x.closePath(); x.stroke();
          r.pts.forEach((p, i) => { const [a, b] = P(...p), sel = this.sel && this.sel[0] === ri && this.sel[1] === i; x.fillStyle = sel ? '#005bd3' : '#fff'; x.strokeStyle = '#1a1a1a'; x.fillRect(a - 3, b - 3, 6, 6); x.strokeRect(a - 3, b - 3, 6, 6); }); });
      }
      if (this.hover && ['keep', 'remove', 'paint', 'erase'].includes(this.tool)) { const [hx, hy] = P(...this.hover); x.strokeStyle = this.tool === 'keep' ? '#00c853' : this.tool === 'remove' ? '#ff1744' : '#fff'; x.lineWidth = 1.5; x.beginPath(); x.arc(hx, hy, this.brush / 2, 0, Math.PI * 2); x.stroke(); }
    }
    bindPointer() {
      const v = this.q('view');
      v.addEventListener('wheel', (e) => { e.preventDefault(); const [, , sx, sy] = this.toImg(e); this.zoomBy(Math.exp(-e.deltaY * 0.0015), sx, sy); }, { passive: false });
      v.addEventListener('pointermove', (e) => { if (!this.drag && ['keep', 'remove', 'paint', 'erase'].includes(this.tool)) { this.hover = this.toImg(e).slice(0, 2); this.draw(); } });
      v.addEventListener('pointerleave', () => { this.hover = null; this.draw(); });
      v.addEventListener('pointerdown', (e) => {
        if (!this.img) return;
        v.setPointerCapture(e.pointerId);
        const [X, Y] = this.toImg(e), tool = (e.button === 1 || this.keys.space) ? 'pan' : this.tool;
        let mv = () => {};
        const end = (fn) => { const up = () => { v.removeEventListener('pointermove', mv); v.removeEventListener('pointerup', up); v.removeEventListener('pointercancel', up); this.drag = null; if (fn) fn(); }; v.addEventListener('pointerup', up); v.addEventListener('pointercancel', up); };
        if (tool === 'pan') { const v0 = { ...this.view }; mv = (m) => { this.view = { ...v0, x: v0.x + m.clientX - e.clientX, y: v0.y + m.clientY - e.clientY }; this.draw(); }; v.addEventListener('pointermove', mv); this.drag = 'pan'; end(); return; }
        if (['keep', 'remove', 'paint', 'erase'].includes(tool)) {
          const hint = tool === 'keep' || tool === 'remove';
          if (!hint && !this.mask) return;
          this.pushUndo();
          let target;
          if (hint) { this.hints = this.hints ? copyCanvas(this.hints) : canvas(this.img.width, this.img.height); target = this.hints; }
          else { this.mask = copyCanvas(this.mask); target = this.mask; this.vec = null; }
          const g = target.getContext('2d'), r = this.brush / 2 / this.view.s;
          g.lineCap = g.lineJoin = 'round'; g.lineWidth = 2 * r; g.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
          g.strokeStyle = g.fillStyle = tool === 'keep' ? 'rgb(0,200,83)' : tool === 'remove' ? 'rgb(255,23,68)' : '#fff';
          let last = [X, Y]; g.beginPath(); g.arc(X, Y, r, 0, Math.PI * 2); g.fill();
          mv = (m) => { const [mx, my] = this.toImg(m); g.beginPath(); g.moveTo(...last); g.lineTo(mx, my); g.stroke(); last = [mx, my]; this.hover = last; this._cutFor = null; this.draw(); };
          v.addEventListener('pointermove', mv); this.drag = 'brush';
          end(() => { g.globalCompositeOperation = 'source-over'; this._out = null; if (hint) { this.undoStack.pop(); this.auto(); } else { this.draw(); this.preview(); } });
          return;
        }
        if (tool === 'points' && this.vec) {
          let best = null;
          this.vec.rings.forEach((r, ri) => r.pts.forEach((p, i) => { const dd = Math.hypot((p[0] - X) * this.view.s, (p[1] - Y) * this.view.s); if (dd < 8 && (!best || dd < best[2])) best = [ri, i, dd]; }));
          this.sel = best ? [best[0], best[1]] : null; this.draw(); if (!best) return;
          this.pushUndo(); this.vec = JSON.parse(JSON.stringify(this.vec));
          const pt = this.vec.rings[best[0]].pts[best[1]];
          mv = (m) => { const [mx, my] = this.toImg(m); pt[0] = mx; pt[1] = my; clearTimeout(this._pt); this._pt = setTimeout(() => this.fromVec(), 30); this.draw(); };
          v.addEventListener('pointermove', mv); this.drag = 'point'; end(() => this.fromVec());
        }
      });
    }
    bindKeys() {
      this._kd = (e) => {
        if (!this.root.isConnected || /INPUT|SELECT|TEXTAREA/.test((e.target || {}).tagName)) return;
        if (e.code === 'Space') { this.keys.space = true; e.preventDefault(); }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); this.undo(); }
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel && this.tool === 'points' && this.vec) { e.preventDefault(); this.pushUndo(); this.vec = JSON.parse(JSON.stringify(this.vec)); const r = this.vec.rings[this.sel[0]]; if (r.pts.length > 3) r.pts.splice(this.sel[1], 1); this.sel = null; this.fromVec(); }
      };
      this._ku = (e) => { if (e.code === 'Space') this.keys.space = false; };
      document.addEventListener('keydown', this._kd); document.addEventListener('keyup', this._ku);
    }
  }

  window.ZBStudio = {
    open: (host, opts) => new Studio(host, opts),
    openTexture: (host, opts) => new TexEditor(host, opts),
    openCutout: (host, opts) => new CutoutEditor(host, opts),
    loadCV,
    _internals: { autoCut, autoCutBest, renderRings, vectorize, knobShade, capShade, texSquare, drawMesh, hingeFrom, poseAt, chamberAt }
  };
})();
