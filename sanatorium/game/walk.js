/* 雾岭疗养院 · the multi-layer walk grid (sketches/sanatorium_level.py): every cell lists the heights you can stand
   at, with surface/safe/lead flags and the id of the door (if any) that can close it. */
(function () {
  "use strict";
  const S = (window.SANA = window.SANA || {});
  const W = (S.Walk = {});
  const STEP = 0.45;

  W.load = async function (url, meta) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + " → HTTP " + r.status);
    if (!("DecompressionStream" in window)) throw new Error("浏览器不支持 DecompressionStream，请用新版 Chrome / Edge / Firefox");
    const buf = await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    const nx = meta.nx, ny = meta.ny, n = meta.n, cells = nx * ny;
    const counts = new Uint8Array(buf, 0, cells);
    const hb = buf.slice(cells, cells + n * 2);
    W.h = new Int16Array(hb);
    W.f = new Uint8Array(buf, cells + n * 2, n);
    W.door = new Uint8Array(buf, cells + n * 3, n);
    W.start = new Uint32Array(cells + 1);
    for (let i = 0; i < cells; i++) W.start[i + 1] = W.start[i] + counts[i];
    W.blocked = new Uint8Array(n);
    Object.assign(W, { x0: meta.x0, y0: meta.y0, res: meta.res, nx, ny, n });
  };

  W.cell = (x, y) => {
    const i = Math.floor((x - W.x0) / W.res), j = Math.floor((y - W.y0) / W.res);
    if (i < 0 || j < 0 || i >= W.nx || j >= W.ny) return -1;
    return j * W.nx + i;
  };
  // index of the entry nearest to z (within tol), or -1
  W.entry = function (x, y, z, tol, ignoreDoors) {
    const c = W.cell(x, y);
    if (c < 0) return -1;
    let best = -1, bd = tol;
    for (let k = W.start[c]; k < W.start[c + 1]; k++) {
      if (!ignoreDoors && W.blocked[k]) continue;
      const d = Math.abs(W.h[k] / 20 - z);
      if (d <= bd) { bd = d; best = k; }
    }
    return best;
  };
  W.height = (k) => W.h[k] / 20;
  W.surf = (k) => (W.f[k] >> 3) & 7;
  W.safe = (k) => !!(W.f[k] & 1);
  W.lead = (k) => !!(W.f[k] & 2);
  W.outdoor = (k) => !!(W.f[k] & 4);

  // a body of radius r can stand at (x, y) near height z: returns the new height or null
  W.stand = function (x, y, z, r, step) {
    const k = W.entry(x, y, z, step || STEP);
    if (k < 0) return null;
    const h = W.height(k);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      if (W.entry(x + Math.cos(a) * r, y + Math.sin(a) * r, h, 0.6) < 0) return null;
    }
    return h;
  };

  // move a body, sliding along walls; returns true if it moved
  W.move = function (B, dx, dy, r) {
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.12));
    let moved = false;
    for (let s = 0; s < n; s++) {
      const sx = dx / n, sy = dy / n;
      let h = W.stand(B.x + sx, B.y + sy, B.zt, r);
      if (h !== null) { B.x += sx; B.y += sy; B.zt = h; moved = true; continue; }
      h = Math.abs(sx) > 1e-5 ? W.stand(B.x + sx, B.y, B.zt, r) : null;
      if (h !== null) { B.x += sx; B.zt = h; moved = true; continue; }
      h = Math.abs(sy) > 1e-5 ? W.stand(B.x, B.y + sy, B.zt, r) : null;
      if (h !== null) { B.y += sy; B.zt = h; moved = true; continue; }
      break;
    }
    return moved;
  };

  W.setDoor = function (id, shut) {
    for (let k = 0; k < W.n; k++) if (W.door[k] === id) W.blocked[k] = shut ? 1 : 0;
  };

  // walking distance (metres) from a point to every cell within maxD: Dijkstra over entries
  function Heap() { this.a = []; }
  Heap.prototype.push = function (d, k, c) {
    const a = this.a; a.push([d, k, c]);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; const t = a[p]; a[p] = a[i]; a[i] = t; i = p; }
  };
  Heap.prototype.pop = function () {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        const t = a[m]; a[m] = a[i]; a[i] = t; i = m;
      }
    }
    return top;
  };
  W.Heap = Heap;
  W.flood = function (x, y, z, maxD, through) {
    const k0 = W.entry(x, y, z, 1.0);
    const dist = new Map();
    if (k0 < 0) return dist;
    const heap = new Heap();
    heap.push(0, k0, W.cell(x, y));
    dist.set(k0, 0);
    while (heap.a.length) {
      const [d, k, c] = heap.pop();
      if (d > dist.get(k) + 1e-9) continue;
      if (W.lead(k) && !through) continue;
      const ci = c % W.nx, cj = (c / W.nx) | 0, h = W.h[k] / 20;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = ci + di, jj = cj + dj;
        if (ii < 0 || jj < 0 || ii >= W.nx || jj >= W.ny) continue;
        const cc = jj * W.nx + ii;
        for (let kk = W.start[cc]; kk < W.start[cc + 1]; kk++) {
          if (W.blocked[kk] || Math.abs(W.h[kk] / 20 - h) > STEP) continue;
          const nd = d + W.res * (di && dj ? 1.4142 : 1);
          if (nd > maxD) continue;
          if (!dist.has(kk) || nd < dist.get(kk)) { dist.set(kk, nd); heap.push(nd, kk, cc); }
        }
      }
    }
    return dist;
  };
})();
