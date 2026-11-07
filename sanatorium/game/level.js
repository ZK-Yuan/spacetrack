/* 雾岭疗养院 · builds the level meshes from level.json (sketches/sanatorium_level.py).
   Faces are batched by material and by 24 m tile so frustum culling still works; walls carry vertex-colour
   occlusion at their feet. Also exports wall boxes for the matron's line-of-sight tests. */
(function () {
  "use strict";
  const S = (window.SANA = window.SANA || {});
  const LV = (S.Level = {});
  const E = () => S.Engine;
  const TILE = 24;

  /* ---------------------------------------------------------------- batching */
  class Batch {
    constructor() { this.g = new Map(); }
    grp(mat, x, y, opts) {
      const key = mat + "|" + Math.floor(x / TILE) + "," + Math.floor(y / TILE) + (opts && opts.noShadow ? "|ns" : "");
      let g = this.g.get(key);
      if (!g) { g = { mat, pos: [], nor: [], uv: [], col: [], opts: opts || {} }; this.g.set(key, g); }
      return g;
    }
    // pts: world [x,y,z]; uvs: [u,v]; n: intended normal (world) ; cols: optional per-vertex brightness
    face(mat, pts, uvs, n, cols, opts) {
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      const g = this.grp(mat, cx, cy, opts);
      const p0 = pts[0], p1 = pts[1], p2 = pts[2];
      const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
      const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      let order = pts.map((_, i) => i);
      if (n && nx * n[0] + ny * n[1] + nz * n[2] < 0) { order = order.reverse(); nx = -nx; ny = -ny; nz = -nz; }
      const L = Math.hypot(nx, ny, nz) || 1;
      nx /= L; ny /= L; nz /= L;
      const tri = [];
      for (let i = 1; i < order.length - 1; i++) tri.push(order[0], order[i], order[i + 1]);
      for (const i of tri) {
        const p = pts[i];
        g.pos.push(p[0], p[2], -p[1]);
        g.nor.push(nx, nz, -ny);
        g.uv.push(uvs[i][0], uvs[i][1]);
        const c = cols ? cols[i] : 1;
        g.col.push(c, c, c);
      }
    }
    tris(mat, P, tris, uvf, n, opts) {
      for (const t of tris) this.face(mat, [P[t[0]], P[t[1]], P[t[2]]], [uvf(P[t[0]]), uvf(P[t[1]]), uvf(P[t[2]])], n, null, opts);
    }
    // an oriented box: centre (x,y,z), size along its own axes, rotation (deg) about z
    box(mat, c, s, rot, opts) {
      const a = (rot || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      const hx = s[0] / 2, hy = s[1] / 2, hz = s[2] / 2;
      const P = (x, y, z) => [c[0] + ca * x - sa * y, c[1] + sa * x + ca * y, c[2] + z];
      const F = [
        [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz], [ca, sa, 0], s[1], s[2]],
        [[-hx, hy, -hz], [-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-ca, -sa, 0], s[1], s[2]],
        [[-hx, hy, -hz], [hx, hy, -hz], [hx, hy, hz], [-hx, hy, hz], [-sa, ca, 0], s[0], s[2]],
        [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, -hy, hz], [hx, -hy, hz], [sa, -ca, 0], s[0], s[2]],
        [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [0, 0, 1], s[0], s[1]],
        [[-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz], [-hx, -hy, -hz], [0, 0, -1], s[0], s[1]],
      ];
      for (const f of F) {
        const w = f[5], h = f[6];
        this.face(mat, [P(...f[0]), P(...f[1]), P(...f[2]), P(...f[3])], [[0, 0], [w, 0], [w, h], [0, h]], f[4], null, opts);
      }
    }
    build(scene) {
      const meshes = [];
      for (const g of this.g.values()) {
        if (!g.pos.length) continue;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(g.pos, 3));
        geo.setAttribute("normal", new THREE.Float32BufferAttribute(g.nor, 3));
        geo.setAttribute("uv", new THREE.Float32BufferAttribute(g.uv, 2));
        geo.setAttribute("color", new THREE.Float32BufferAttribute(g.col, 3));
        geo.computeBoundingSphere();
        const mat = typeof g.mat === "string" ? matVC(g.mat) : g.mat;
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = !g.opts.noShadow;
        m.receiveShadow = true;
        m.matrixAutoUpdate = false;
        m.updateMatrix();
        scene.add(m);
        meshes.push(m);
      }
      return meshes;
    }
  }
  LV.Batch = Batch;
  const vcCache = {};
  function matVC(name) {
    if (!vcCache[name]) {
      const base = E().mat(name);
      const m = base.clone();
      m.vertexColors = true;
      vcCache[name] = m;
    }
    return vcCache[name];
  }

  /* ---------------------------------------------------------------- helpers */
  function uvFrame(f) {
    if (!f) return (p) => [p[0], p[1]];
    const a = f[2] * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    return (p) => [(p[0] - f[0]) * ca + (p[1] - f[1]) * sa, -(p[0] - f[0]) * sa + (p[1] - f[1]) * ca];
  }
  function triangulate(poly, holes) {
    const contour = poly.map((p) => new THREE.Vector2(p[0], p[1]));
    const hv = (holes || []).map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
    const faces = THREE.ShapeUtils.triangulateShape(contour, hv);
    const all = poly.concat(...(holes || []));
    return { all, faces };
  }
  function polyFace(B, mat, poly, holes, z, up, uvf, opts) {
    const t = triangulate(poly, holes);
    const P = t.all.map((p) => [p[0], p[1], z]);
    B.tris(mat, P, t.faces, uvf, [0, 0, up ? 1 : -1], opts);
  }
  function ring(poly, z0, z1, B, mat, outward, uvScale) {
    // vertical faces along a closed polygon boundary
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    const ccw = area > 0;
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-4) continue;
      let nx = (b[1] - a[1]) / L, ny = -(b[0] - a[0]) / L;
      if (!ccw) { nx = -nx; ny = -ny; }
      if (!outward) { nx = -nx; ny = -ny; }
      B.face(mat, [[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]],
        [[s, z0], [s + L, z0], [s + L, z1], [s, z1]], [nx, ny, 0]);
      s += L;
    }
  }
  function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

  function wallPieces(w, L) {
    const ops = (w.ops || []).filter((o) => o[4] !== "locked");
    if (!ops.length) return [[0, L, w.z0, w.z1]];
    const cuts = [...new Set([0, L].concat(...ops.map((o) => [Math.min(L, Math.max(0, o[0])), Math.min(L, Math.max(0, o[1]))])))].sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const sa = cuts[i], sb = cuts[i + 1];
      if (sb - sa < 1e-4) continue;
      const mid = (sa + sb) / 2;
      const holes = ops.filter((o) => o[0] <= mid && mid <= o[1]).map((o) => [Math.max(w.z0, o[2]), Math.min(w.z1, o[3])]).sort((a, b) => a[0] - b[0]);
      let z = w.z0;
      for (const h of holes) {
        if (h[0] > z + 1e-4) out.push([sa, sb, z, h[0]]);
        z = Math.max(z, h[1]);
      }
      if (z < w.z1 - 1e-4) out.push([sa, sb, z, w.z1]);
    }
    return out;
  }
  LV.wallPieces = wallPieces;

  /* ---------------------------------------------------------------- walls */
  const STOREYS = [4.5, 18.2, 20.0, 22.7, 23.6, 27.2, 30.8, 31.7, 34.4, 36.2, 40.7, 45.2];
  function floorBelow(z) {
    let best = null;
    for (const s of STOREYS) if (s <= z + 0.31 && (best === null || s > best)) best = s;
    return best === null ? z : best;
  }
  function wallSide(B, w, piece, side, ux, uy, nx, ny, L, occ) {
    const scheme = E().SCHEME[w.m[side]] || { hi: "plaster_new" };
    const sgn = side === 0 ? 1 : -1;
    const off = w.t / 2 * sgn;
    const [s0, s1, za, zb] = piece;
    const A = [w.a[0] + ux * s0 + nx * off, w.a[1] + uy * s0 + ny * off];
    const Bp = [w.a[0] + ux * s1 + nx * off, w.a[1] + uy * s1 + ny * off];
    const n = [nx * sgn, ny * sgn, 0];
    const fz = w.k === "ext" ? floorBelow(w.z0 + 0.31) : floorBelow(w.z0);
    const interior = !!scheme.base;
    const zs = [za, zb];
    const dado = scheme.lo ? fz + scheme.dado : null;
    if (dado && dado > za && dado < zb) zs.push(dado);
    if (interior) {
      if (fz + 0.35 > za && fz + 0.35 < zb) zs.push(fz + 0.35);
      if (w.z1 - 0.3 > za && w.z1 - 0.3 < zb) zs.push(w.z1 - 0.3);
    }
    zs.sort((a, b) => a - b);
    const ao = (z) => interior ? Math.min(1, 0.5 + 0.5 * Math.min(1, Math.max(0, (z - fz) / 0.35))) * (1 - 0.3 * Math.min(1, Math.max(0, (z - (w.z1 - 0.3)) / 0.3))) : 1;
    const u0 = side === 0 ? s0 : L - s0, u1 = side === 0 ? s1 : L - s1;
    for (let i = 0; i < zs.length - 1; i++) {
      const z0 = zs[i], z1 = zs[i + 1];
      if (z1 - z0 < 1e-3) continue;
      const mat = dado && z1 <= dado + 1e-4 ? scheme.lo : scheme.hi;
      B.face(mat, [[A[0], A[1], z0], [Bp[0], Bp[1], z0], [Bp[0], Bp[1], z1], [A[0], A[1], z1]],
        [[u0, z0], [u1, z0], [u1, z1], [u0, z1]], n, [ao(z0), ao(z0), ao(z1), ao(z1)]);
    }
    // skirting and dado rail
    if (interior && za <= fz + 0.01 && zb > fz + 0.2) {
      const o2 = off + 0.018 * sgn;
      const a2 = [w.a[0] + ux * s0 + nx * o2, w.a[1] + uy * s0 + ny * o2], b2 = [w.a[0] + ux * s1 + nx * o2, w.a[1] + uy * s1 + ny * o2];
      B.face("skirting", [[a2[0], a2[1], fz], [b2[0], b2[1], fz], [b2[0], b2[1], fz + 0.13], [a2[0], a2[1], fz + 0.13]],
        [[0, 0], [1, 0], [1, 0.13], [0, 0.13]], n, null, { noShadow: true });
      B.face("skirting", [[A[0], A[1], fz + 0.13], [Bp[0], Bp[1], fz + 0.13], [b2[0], b2[1], fz + 0.13], [a2[0], a2[1], fz + 0.13]],
        [[0, 0], [1, 0], [1, 0.02], [0, 0.02]], [0, 0, 1], null, { noShadow: true });
    }
    if (dado && dado > za + 0.05 && dado < zb - 0.05) {
      const o2 = off + 0.014 * sgn;
      const a2 = [w.a[0] + ux * s0 + nx * o2, w.a[1] + uy * s0 + ny * o2], b2 = [w.a[0] + ux * s1 + nx * o2, w.a[1] + uy * s1 + ny * o2];
      B.face("dado_rail", [[a2[0], a2[1], dado - 0.025], [b2[0], b2[1], dado - 0.025], [b2[0], b2[1], dado + 0.025], [a2[0], a2[1], dado + 0.025]],
        [[0, 0], [1, 0], [1, 0.05], [0, 0.05]], n, null, { noShadow: true });
      B.face("dado_rail", [[A[0], A[1], dado + 0.025], [Bp[0], Bp[1], dado + 0.025], [b2[0], b2[1], dado + 0.025], [a2[0], a2[1], dado + 0.025]],
        [[0, 0], [1, 0], [1, 0.02], [0, 0.02]], [0, 0, 1], null, { noShadow: true });
    }
  }

  function buildWall(B, w, wi, occ, deco) {
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    if (L < 1e-3) return;
    const ux = (w.b[0] - w.a[0]) / L, uy = (w.b[1] - w.a[1]) / L, nx = -uy, ny = ux;
    const pieces = wallPieces(w, L);
    const ht = w.t / 2;
    const rot = Math.atan2(uy, ux) * 180 / Math.PI;
    const mL = (E().SCHEME[w.m[0]] || {}).hi || "plaster_new", mR = (E().SCHEME[w.m[1]] || {}).hi || "plaster_new";
    const capMat = w.k === "ext" ? (w.m[0].startsWith("ext") || w.m[0] === "court" || w.m[0] === "balc" ? mL : mR) : mL;
    for (const pc of pieces) {
      wallSide(B, w, pc, 0, ux, uy, nx, ny, L);
      wallSide(B, w, pc, 1, ux, uy, nx, ny, L);
      const [s0, s1, za, zb] = pc;
      const P = (s, o, z) => [w.a[0] + ux * s + nx * o, w.a[1] + uy * s + ny * o, z];
      // reveals at both ends of the piece
      B.face(capMat, [P(s0, ht, za), P(s0, -ht, za), P(s0, -ht, zb), P(s0, ht, zb)], [[0, za], [w.t, za], [w.t, zb], [0, zb]], [-ux, -uy, 0]);
      B.face(capMat, [P(s1, -ht, za), P(s1, ht, za), P(s1, ht, zb), P(s1, -ht, zb)], [[0, za], [w.t, za], [w.t, zb], [0, zb]], [ux, uy, 0]);
      B.face(capMat, [P(s0, ht, zb), P(s1, ht, zb), P(s1, -ht, zb), P(s0, -ht, zb)], [[s0, 0], [s1, 0], [s1, w.t], [s0, w.t]], [0, 0, 1]);
      if (za > w.z0 + 1e-3) B.face(capMat, [P(s0, -ht, za), P(s1, -ht, za), P(s1, ht, za), P(s0, ht, za)], [[s0, 0], [s1, 0], [s1, w.t], [s0, w.t]], [0, 0, -1]);
      if (occ && w.k !== "plinth") occ.push({ c: [w.a[0] + ux * (s0 + s1) / 2, w.a[1] + uy * (s0 + s1) / 2, (za + zb) / 2], h: [(s1 - s0) / 2, ht, (zb - za) / 2], ca: ux, sa: uy });
    }
    for (const o of w.ops || []) decorateOpening(B, w, o, ux, uy, nx, ny, rot, wi, deco);
  }

  function decorateOpening(B, w, o, ux, uy, nx, ny, rot, wi, deco) {
    const [s0, s1, z0, z1, k, style] = o;
    const wd = s1 - s0, h = z1 - z0, sm = (s0 + s1) / 2;
    const C = (s, off, z) => [w.a[0] + ux * s + nx * off, w.a[1] + uy * s + ny * off, z];
    const R = rng(wi * 131 + Math.round(s0 * 10));
    const frameMat = w.m[0] === "plaster_new" || w.m[0] === "room_new" || w.m[1] === "room_new" ? "iron" : "frame_wood";
    if (k === "window") {
      const ft = Math.min(w.t + 0.02, 0.18);
      const fm = style === "frame" ? "iron" : style === "burnt" ? "burnt" : "frame_wood";
      for (const [c, s] of [[C(sm, 0, z0 + 0.03), [wd, ft, 0.06]], [C(sm, 0, z1 - 0.03), [wd, ft, 0.06]],
        [C(s0 + 0.03, 0, (z0 + z1) / 2), [0.06, ft, h]], [C(s1 - 0.03, 0, (z0 + z1) / 2), [0.06, ft, h]]]) {
        B.box(fm, c, s, rot, { noShadow: false });
      }
      if (style === "glass" || style === "frame" || style === "broken") {
        B.box(fm, C(sm, 0, (z0 + z1) / 2), [0.04, 0.05, h], rot);
        if (style === "glass") B.box(fm, C(sm, 0, z0 + h * 0.62), [wd, 0.05, 0.04], rot);
      }
      if (style === "bars") {
        const n = Math.max(2, Math.round(wd / 0.13));
        for (let i = 1; i < n; i++) B.box("iron", C(s0 + wd * i / n, w.t / 2 - 0.05, (z0 + z1) / 2), [0.022, 0.022, h], rot);
        B.box("iron", C(sm, w.t / 2 - 0.05, z0 + h * 0.5), [wd, 0.02, 0.03], rot);
      }
      // inner sill
      const side = w.m[0].startsWith("ext") || w.m[0] === "balc" || w.m[0] === "court" ? -1 : 1;
      B.box("frame_wood", C(sm, side * (w.t / 2 + 0.04), z0 - 0.02), [wd + 0.1, 0.12, 0.04], rot);
      if (style !== "burnt" && style !== "bars") {
        const broken = style === "broken" || R() < 0.35;
        const panes = broken ? [[s0, sm - 0.02, R() < 0.5]] : [[s0, s1, true]];
        for (const [a, b, keep] of panes) {
          if (!keep) continue;
          deco.glass.push({ p: [w.a[0] + ux * (a + b) / 2, w.a[1] + uy * (a + b) / 2, (z0 + z1) / 2], w: b - a, h, r: rot, stained: false });
        }
      }
      if (style === "stained" || style === "stained_round") {
        deco.glass.push({ p: [w.a[0] + ux * sm, w.a[1] + uy * sm, (z0 + z1) / 2], w: wd, h, r: rot, stained: true });
      }
      return;
    }
    if (k === "arch" || k === "breach" || k === "gate") {
      if (k === "breach") {
        for (let i = 0; i < 9; i++) {
          B.box("block", [w.a[0] + ux * (s0 + R() * wd) + nx * (R() - 0.5) * 1.6, w.a[1] + uy * (s0 + R() * wd) + ny * (R() - 0.5) * 1.6, z0 + 0.08],
            [0.25 + R() * 0.3, 0.2 + R() * 0.2, 0.12 + R() * 0.1], R() * 180);
        }
      }
      return;
    }
    // architraves both sides
    const fw = 0.09, fd = 0.03;
    for (const sg of [1, -1]) {
      const off = sg * (w.t / 2 + fd / 2);
      B.box(frameMat, C(s0 - fw / 2, off, (z0 + z1) / 2), [fw, fd, h + fw], rot, { noShadow: true });
      B.box(frameMat, C(s1 + fw / 2, off, (z0 + z1) / 2), [fw, fd, h + fw], rot, { noShadow: true });
      B.box(frameMat, C(sm, off, z1 + fw / 2), [wd + 2 * fw, fd, fw], rot, { noShadow: true });
    }
    if (k === "locked") {
      const lift = style === "lift";
      const mat = lift ? "metal" : style === "burnt" ? "burnt" : style === "chained" ? "rust" : (R() < 0.5 ? "door_green" : "door_wood");
      B.box(mat, C(sm, 0, (z0 + z1) / 2), [wd - 0.02, 0.05, h - 0.02], rot);
      if (!lift && style !== "chained" && style !== "burnt") {
        B.box("void", C(sm, 0.03, z0 + h * 0.72), [wd * 0.35, 0.012, h * 0.18], rot, { noShadow: true });
        B.box("void", C(sm, -0.03, z0 + h * 0.72), [wd * 0.35, 0.012, h * 0.18], rot, { noShadow: true });
        B.box("iron", C(s0 + wd * 0.85, 0.05, z0 + 1.0), [0.1, 0.05, 0.03], rot, { noShadow: true });
        B.box("iron", C(s0 + wd * 0.85, -0.05, z0 + 1.0), [0.1, 0.05, 0.03], rot, { noShadow: true });
      }
      if (lift) B.box("iron", C(sm, 0.03, (z0 + z1) / 2), [0.02, 0.02, h - 0.1], rot);
      if (style === "chained") {
        for (let i = 0; i < 9; i++) B.box("iron", C(sm - 0.5 + i * 0.12, w.t / 2 + 0.08, z0 + 1.1 + Math.sin(i * 0.7) * 0.08), [0.1, 0.03, 0.04], rot + (i % 2) * 90);
        B.box("rust", C(sm, w.t / 2 + 0.1, z0 + 0.95), [0.12, 0.05, 0.16], rot);
      }
      return;
    }
    if (k === "lift" || k === "special") return;
    // ordinary doorways: leaves left ajar (decoration only)
    const leaves = k === "double" ? 2 : 1;
    if (R() < 0.15 && k === "door") return;
    for (let i = 0; i < leaves; i++) {
      const lw = wd / leaves - 0.03;
      const hingeS = i === 0 ? s0 + 0.02 : s1 - 0.02;
      const dir = i === 0 ? 1 : -1;
      const side = R() < 0.5 ? 1 : -1;
      const open = (70 + R() * 45) * side;
      const hp = C(hingeS, side * (w.t / 2), z0);
      const a0 = Math.atan2(uy, ux) + (dir < 0 ? Math.PI : 0);
      const ang = a0 + open * Math.PI / 180 * dir;
      const cx = hp[0] + Math.cos(ang) * lw / 2, cy = hp[1] + Math.sin(ang) * lw / 2;
      deco.leaves.push({ c: [cx, cy, z0 + (h - 0.03) / 2], s: [lw, 0.045, h - 0.04], r: ang * 180 / Math.PI, mat: R() < 0.5 ? "door_green" : "door_wood" });
    }
  }

  /* ---------------------------------------------------------------- stairs, rails, ramps */
  function flight(B, f) {
    const a = f.a, b = f.b, n = f.n;
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    const rot = Math.atan2(dy, dx) * 180 / Math.PI;
    const rise = (b[2] - a[2]) / n, run = L / n;
    const mat = f.style === "ext_stairs" ? (f.mat === "stone" ? "paving" : "concrete") : "concrete";
    for (let i = 0; i < n; i++) {
      const zt = a[2] + rise * (i + 1);
      const zlo = Math.min(zt, a[2] + rise * i) - (i === 0 ? 0 : 0.0);
      const top = rise > 0 ? zt : a[2] + rise * i;
      const bottom = rise > 0 ? zt - Math.abs(rise) - 0.12 : top - Math.abs(rise) - 0.12;
      const t = (i + 0.5) / n;
      B.box(mat, [a[0] + dx * t, a[1] + dy * t, (top + bottom) / 2], [run + 0.02, f.w, top - bottom], rot);
      B.box("skirting", [a[0] + dx * t + Math.cos(rot * Math.PI / 180) * (run / 2 - 0.015), a[1] + dy * t + Math.sin(rot * Math.PI / 180) * (run / 2 - 0.015), top + 0.006], [0.04, f.w, 0.012], rot, { noShadow: true });
    }
    // sloped underside
    const z0 = Math.min(a[2], b[2]) - 0.25, z1 = Math.max(a[2], b[2]) - 0.25;
    const lo = a[2] < b[2] ? a : b, hi = a[2] < b[2] ? b : a;
    const nx = -dy / L * f.w / 2, ny = dx / L * f.w / 2;
    B.face("concrete", [[lo[0] + nx, lo[1] + ny, z0], [lo[0] - nx, lo[1] - ny, z0], [hi[0] - nx, hi[1] - ny, z1], [hi[0] + nx, hi[1] + ny, z1]],
      [[0, 0], [f.w, 0], [f.w, L], [0, L]], [0, 0, -1]);
  }

  function spiral(B, s) {
    const n = Math.round((s.z1 - s.z0) / 0.165), span = s.a1 - s.a0;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, a = (s.a0 + span * t) * Math.PI / 180, rm = (s.r0 + s.r1) / 2;
      const z = s.z0 + (s.z1 - s.z0) * (i + 1) / n;
      B.box("gallery", [rm * Math.cos(a), rm * Math.sin(a), z - 0.03], [0.48, s.r1 - s.r0, 0.06], a * 180 / Math.PI + 90);
      B.box("gallery", [(rm) * Math.cos(a - 0.02), (rm) * Math.sin(a - 0.02), z - 0.11], [0.03, s.r1 - s.r0, 0.16], a * 180 / Math.PI + 90);
    }
    // helicoid underside and stringers
    const m = 40;
    for (let k = 0; k < m; k++) {
      const t0 = k / m, t1 = (k + 1) / m;
      const a0 = (s.a0 + span * t0) * Math.PI / 180, a1 = (s.a0 + span * t1) * Math.PI / 180;
      const z0 = s.z0 + (s.z1 - s.z0) * t0 - 0.45, z1 = s.z0 + (s.z1 - s.z0) * t1 - 0.45;
      const P = (r, a, z) => [r * Math.cos(a), r * Math.sin(a), z];
      B.face("plaster_cream", [P(s.r0, a0, z0), P(s.r1, a0, z0), P(s.r1, a1, z1), P(s.r0, a1, z1)], [[0, t0 * 9], [1.8, t0 * 9], [1.8, t1 * 9], [0, t1 * 9]], [0, 0, -1]);
      for (const [r, sg] of [[s.r0, -1], [s.r1, 1]]) {
        B.face("plaster_cream", [P(r, a0, z0), P(r, a1, z1), P(r, a1, z1 + 0.4), P(r, a0, z0 + 0.4)], [[t0 * 9, 0], [t1 * 9, 0], [t1 * 9, 0.4], [t0 * 9, 0.4]],
          [Math.cos((a0 + a1) / 2) * sg, Math.sin((a0 + a1) / 2) * sg, 0]);
      }
    }
  }

  function rail(B, r) {
    const pts = r.pts, h = r.h, st = r.style;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy);
      if (L < 1e-3) continue;
      const rot = Math.atan2(dy, dx) * 180 / Math.PI;
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const slope = Math.atan2(dz, L);
      if (st === "parapet") {
        B.box("ext", [mid[0], mid[1], mid[2] + h / 2], [L + 0.25, 0.25, h], rot);
        B.box("concrete", [mid[0], mid[1], mid[2] + h + 0.04], [L + 0.3, 0.34, 0.08], rot);
        continue;
      }
      if (st === "balcony") B.box("ext_light", [mid[0], mid[1], mid[2] + 0.18], [L + 0.2, 0.2, 0.36], rot);
      // top rail (tilted along the slope by stepping it)
      const hm = st === "baluster" || st === "spiral" || st === "stair" ? "frame_wood" : "iron";
      const segs = Math.max(1, Math.round(Math.abs(dz) / 0.15));
      for (let k = 0; k < segs; k++) {
        const t0 = k / segs, t1 = (k + 1) / segs;
        const za = a[2] + dz * (t0 + t1) / 2;
        B.box(hm, [a[0] + dx * (t0 + t1) / 2, a[1] + dy * (t0 + t1) / 2, za + h], [L / segs + 0.02, 0.06, 0.05], rot, { noShadow: true });
      }
      const gap = st === "baluster" || st === "spiral" ? 0.16 : st === "iron" || st === "balcony" ? 0.14 : st === "fence" ? 0.2 : 1.1;
      const n = Math.max(1, Math.round(L / gap));
      for (let k = 0; k <= n; k++) {
        if (k === n && i < pts.length - 2) continue;
        const t = k / n, z = a[2] + dz * t;
        const bh = st === "balcony" ? h - 0.36 : h;
        const bz = st === "balcony" ? z + 0.36 : z;
        B.box("iron", [a[0] + dx * t, a[1] + dy * t, bz + bh / 2], [0.025, 0.025, bh], rot, { noShadow: true });
      }
    }
  }

  function ramp(B, r) {
    if (r.style === "tunnel") return;
    const pts = r.pts, w = r.w / 2;
    const mat = r.mat || "path";
    let s = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      if (L < 1e-3) continue;
      const nx = -dy / L * w, ny = dx / L * w;
      const n = Math.max(1, Math.ceil(L / 2));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const p0 = [a[0] + dx * t0, a[1] + dy * t0, a[2] + (b[2] - a[2]) * t0], p1 = [a[0] + dx * t1, a[1] + dy * t1, a[2] + (b[2] - a[2]) * t1];
        const ext = 0.4;
        const e0 = [p0[0] - dx / L * ext, p0[1] - dy / L * ext], e1 = [p1[0] + dx / L * ext, p1[1] + dy / L * ext];
        B.face(mat, [[e0[0] + nx, e0[1] + ny, p0[2] + 0.02], [e0[0] - nx, e0[1] - ny, p0[2] + 0.02], [e1[0] - nx, e1[1] - ny, p1[2] + 0.02], [e1[0] + nx, e1[1] + ny, p1[2] + 0.02]],
          [[0, s + L * t0], [2 * w, s + L * t0], [2 * w, s + L * t1], [0, s + L * t1]], [0, 0, 1]);
      }
      // timber step edges on the steep parts
      if (r.style === "path") {
        const grade = Math.abs(b[2] - a[2]) / L;
        if (grade > 0.06) {
          const nstep = Math.floor(Math.abs(b[2] - a[2]) / 0.22);
          for (let k = 1; k <= nstep; k++) {
            const t = k / (nstep + 1);
            B.box("beams", [a[0] + dx * t, a[1] + dy * t, a[2] + (b[2] - a[2]) * t + 0.05], [0.14, 2 * w, 0.1], Math.atan2(dy, dx) * 180 / Math.PI);
          }
        }
      }
      s += L;
    }
  }

  /* ---------------------------------------------------------------- tunnel tube */
  function tube(B, t, occ) {
    const pts = t.pts, w = t.w, wh = t.wh, R = w / 2;
    const floorMat = t.floor || "concrete", wallMat = t.mat || "block";
    const prof = [[-R, 0], [-R, wh]];
    for (let k = 1; k < 12; k++) {
      const a = Math.PI - Math.PI * k / 12;
      prof.push([Math.cos(a) * R, wh + Math.sin(a) * R * ((t.crown - wh) / R)]);
    }
    prof.push([R, wh], [R, 0]);
    // rings at every vertex (+ extra rings round niches) with mitred side vectors
    const niche = (t.niches || []).map((n) => {
      let best = null;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
        const u = Math.max(0, Math.min(1, ((n[0] - a[0]) * dx + (n[1] - a[1]) * dy) / L2));
        const px = a[0] + dx * u, py = a[1] + dy * u, d = Math.hypot(n[0] - px, n[1] - py);
        if (!best || d < best.d) {
          const side = ((n[0] - px) * -dy + (n[1] - py) * dx) > 0 ? -1 : 1;
          best = { i, u, d, side, p: n };
        }
      }
      return best;
    });
    let s = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      if (L < 1e-3) continue;
      const lx = -dy / L, ly = dx / L;
      const steep = Math.abs(b[2] - a[2]) / L > 0.2;
      const cuts = [0, 1];
      for (const n of niche) if (n && n.i === i) cuts.push(n.u - 0.85 / L, n.u + 0.85 / L);
      const nn = Math.max(1, Math.ceil(L / 2.5));
      for (let k = 1; k < nn; k++) cuts.push(k / nn);
      cuts.sort((p, q) => p - q);
      for (let c = 0; c < cuts.length - 1; c++) {
        const t0 = Math.max(0, cuts[c]), t1 = Math.min(1, cuts[c + 1]);
        if (t1 - t0 < 1e-4) continue;
        const tm = (t0 + t1) / 2;
        const inNiche = niche.find((n) => n && n.i === i && Math.abs(tm - n.u) < 0.85 / L);
        const P0 = [a[0] + dx * t0, a[1] + dy * t0, a[2] + (b[2] - a[2]) * t0], P1 = [a[0] + dx * t1, a[1] + dy * t1, a[2] + (b[2] - a[2]) * t1];
        // extend slightly to close the mitre gaps at bends
        const ex0 = c === 0 && i > 0 ? 0.35 : 0, ex1 = c === cuts.length - 2 && i < pts.length - 2 ? 0.35 : 0;
        const Q0 = [P0[0] - dx / L * ex0, P0[1] - dy / L * ex0, P0[2]], Q1 = [P1[0] + dx / L * ex1, P1[1] + dy / L * ex1, P1[2]];
        for (let j = 0; j < prof.length - 1; j++) {
          const pa = prof[j], pb = prof[j + 1];
          const isFloor = j === prof.length - 2 && false;
          const side = pa[0] < -R + 1e-3 && pb[0] < -R + 1e-3 ? 1 : pa[0] > R - 1e-3 && pb[0] > R - 1e-3 ? -1 : 0;
          if (inNiche && side !== 0 && side === inNiche.side) continue;
          const V = (Q, p) => [Q[0] + lx * p[0], Q[1] + ly * p[0], Q[2] + p[1]];
          const cx = -(pa[0] + pb[0]) / 2, cz = wh + R * 0.3 - (pa[1] + pb[1]) / 2;
          B.face(wallMat, [V(Q0, pa), V(Q1, pa), V(Q1, pb), V(Q0, pb)],
            [[s + L * t0, j * 0.6], [s + L * t1, j * 0.6], [s + L * t1, (j + 1) * 0.6], [s + L * t0, (j + 1) * 0.6]],
            [lx * cx, ly * cx, cz]);
        }
        const V = (Q, x) => [Q[0] + lx * x, Q[1] + ly * x, Q[2]];
        if (!steep) B.face(floorMat, [V(Q0, -R), V(Q0, R), V(Q1, R), V(Q1, -R)], [[0, s + L * t0], [w, s + L * t0], [w, s + L * t1], [0, s + L * t1]], [0, 0, 1]);
      }
      if (t.style === "chute" && !steep) {
        // rails and sleepers on the left half, timber-edged steps on the right
        const rot = Math.atan2(dy, dx) * 180 / Math.PI;
        const nsl = Math.floor(L / 0.7);
        for (let k = 0; k < nsl; k++) {
          const tt = (k + 0.5) / nsl, P = [a[0] + dx * tt, a[1] + dy * tt, a[2] + (b[2] - a[2]) * tt];
          B.box("beams", [P[0] + lx * 0.8, P[1] + ly * 0.8, P[2] + 0.04], [0.22, 1.25, 0.08], rot, { noShadow: true });
        }
        const segs = Math.max(1, Math.ceil(L / 3));
        for (let k = 0; k < segs; k++) {
          const t0 = k / segs, t1 = (k + 1) / segs, tm = (t0 + t1) / 2;
          const P = [a[0] + dx * tm, a[1] + dy * tm, a[2] + (b[2] - a[2]) * tm];
          for (const off of [0.45, 1.15]) B.box("rust", [P[0] + lx * off, P[1] + ly * off, P[2] + 0.12], [L / segs + 0.02, 0.07, 0.1], rot, { noShadow: true });
          for (const zz of [2.25, 2.5]) B.box("rust", [P[0] - lx * (R - 0.15), P[1] - ly * (R - 0.15), P[2] + zz], [L / segs + 0.02, 0.09, 0.09], rot, { noShadow: true });
        }
        const nst = Math.floor(Math.abs(b[2] - a[2]) / 0.16);
        for (let k = 1; k <= nst; k++) {
          const tt = k / (nst + 1), P = [a[0] + dx * tt, a[1] + dy * tt, a[2] + (b[2] - a[2]) * tt];
          B.box("concrete", [P[0] - lx * 0.8, P[1] - ly * 0.8, P[2] + 0.05], [0.3, 1.5, 0.12], rot);
        }
      }
      s += L;
    }
    for (const n of niche) {
      if (!n) continue;
      const a = pts[n.i], b = pts[n.i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), rot = Math.atan2(dy, dx) * 180 / Math.PI;
      const lx = -dy / L * n.side * -1, ly = dx / L * n.side * -1;
      const c = [a[0] + dx * n.u, a[1] + dy * n.u, a[2] + (b[2] - a[2]) * n.u];
      const back = [c[0] + lx * (R + 1.3), c[1] + ly * (R + 1.3)];
      B.box(wallMat, [back[0], back[1], c[2] + 1.2], [1.9, 0.3, 2.4], rot);
      for (const sg of [-1, 1]) {
        B.box(wallMat, [c[0] + lx * (R + 0.6) + dx / L * 0.95 * sg, c[1] + ly * (R + 0.6) + dy / L * 0.95 * sg, c[2] + 1.2], [0.3, 1.5, 2.4], rot);
      }
      B.box(wallMat, [c[0] + lx * (R + 0.6), c[1] + ly * (R + 0.6), c[2] + 2.5], [1.9, 1.5, 0.3], rot);
      B.box(floorMat, [c[0] + lx * (R + 0.6), c[1] + ly * (R + 0.6), c[2] - 0.05], [1.9, 1.5, 0.1], rot);
    }
  }

  /* ---------------------------------------------------------------- big pieces: dome, towers, gables, terrain */
  function dome(B, d) {
    const n = 48, c = d.c;
    for (let k = 0; k < n; k++) {
      const a0 = 2 * Math.PI * k / n, a1 = 2 * Math.PI * (k + 1) / n;
      const win = k % 4 === 1 || k % 4 === 2;
      const P = (r, a, z) => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a), z];
      const zs = win ? [[d.z0, d.z0 + 0.6], [d.z1 - 0.35, d.z1]] : [[d.z0, d.z1]];
      for (const [za, zb] of zs) {
        B.face("plaster_cream", [P(d.r, a0, za), P(d.r, a1, za), P(d.r, a1, zb), P(d.r, a0, zb)], [[0, za], [1, za], [1, zb], [0, zb]],
          [-Math.cos((a0 + a1) / 2), -Math.sin((a0 + a1) / 2), 0]);
        B.face("ext", [P(d.r + 0.3, a0, za), P(d.r + 0.3, a1, za), P(d.r + 0.3, a1, zb), P(d.r + 0.3, a0, zb)], [[0, za], [1, za], [1, zb], [0, zb]],
          [Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), 0]);
      }
      if (win) B.box("frame_wood", P(d.r + 0.15, (a0 + a1) / 2, (d.z0 + d.z1) / 2), [0.06, 0.32, d.z1 - d.z0 - 0.9], (a0 + a1) / 2 * 180 / Math.PI);
      const rings = 8;
      for (let j = 0; j < rings; j++) {
        const t0 = j / rings, t1 = (j + 1) / rings;
        const r0 = d.oculus + (d.r - d.oculus) * Math.cos(t0 * Math.PI / 2), r1 = d.oculus + (d.r - d.oculus) * Math.cos(t1 * Math.PI / 2);
        const z0 = d.z1 + (d.z2 - d.z1) * Math.sin(t0 * Math.PI / 2), z1 = d.z1 + (d.z2 - d.z1) * Math.sin(t1 * Math.PI / 2);
        B.face("plaster_cream", [P(r0, a0, z0), P(r0, a1, z0), P(r1, a1, z1), P(r1, a0, z1)], [[k, j], [k + 1, j], [k + 1, j + 1], [k, j + 1]], [0, 0, -1]);
        B.face("roof_slate", [P(r0 + 0.25, a0, z0 + 0.25), P(r0 + 0.25, a1, z0 + 0.25), P(r1 + 0.25, a1, z1 + 0.25), P(r1 + 0.25, a0, z1 + 0.25)],
          [[k * 0.8, j * 0.8], [(k + 1) * 0.8, j * 0.8], [(k + 1) * 0.8, (j + 1) * 0.8], [k * 0.8, (j + 1) * 0.8]], [Math.cos(a0) * 0.3, Math.sin(a0) * 0.3, 1]);
      }
    }
    // the flat roof ring between the drum and the outer wall
    const outer = [], inner = [];
    for (let k = 0; k < 64; k++) {
      const a = 2 * Math.PI * k / 64;
      outer.push([c[0] + 12.3 * Math.cos(a), c[1] + 12.3 * Math.sin(a)]);
      inner.push([c[0] + (d.r + 0.3) * Math.cos(a), c[1] + (d.r + 0.3) * Math.sin(a)]);
    }
    polyFace(B, "roof_flat", outer, [inner.slice().reverse()], 31.4, true, (p) => [p[0], p[1]]);
  }
  function tower(B, t) {
    const poly = [[t.x0, t.y0], [t.x1, t.y0], [t.x1, t.y1], [t.x0, t.y1]];
    ring(poly, t.z0, t.z1, B, "ext", true);
    const cx = (t.x0 + t.x1) / 2, cy = (t.y0 + t.y1) / 2, hw = (t.x1 - t.x0) / 2 + 0.3, hd = (t.y1 - t.y0) / 2 + 0.3;
    B.box("concrete", [cx, cy, t.z1 + 0.15], [hw * 2, hd * 2, 0.3], 0);
    const apex = [cx, cy, t.cap];
    const base = [[cx - hw, cy - hd], [cx + hw, cy - hd], [cx + hw, cy + hd], [cx - hw, cy + hd]];
    for (let i = 0; i < 4; i++) {
      const a = base[i], b = base[(i + 1) % 4];
      const nx = (a[1] + b[1]) / 2 - cy, ny = -((a[0] + b[0]) / 2 - cx);
      B.face("roof_slate", [[a[0], a[1], t.z1 + 0.3], [b[0], b[1], t.z1 + 0.3], apex], [[0, 0], [2 * hw, 0], [hw, t.cap - t.z1]],
        [(a[0] + b[0]) / 2 - cx, (a[1] + b[1]) / 2 - cy, 1.2]);
    }
    if (t.clock) {
      for (const [x, y, r] of [[cx, t.y0 - 0.02, -90], [cx, t.y1 + 0.02, 90], [t.x0 - 0.02, cy, 180], [t.x1 + 0.02, cy, 0]]) {
        const rad = r * Math.PI / 180;
        LV.clockFaces.push({ p: [x + Math.cos(rad) * 0.03, y + Math.sin(rad) * 0.03, t.clock], r });
      }
    }
  }
  function gable(B, g) {
    const xm = (g.x0 + g.x1) / 2;
    for (const [xa, xb, sg] of [[g.x0, xm, -1], [g.x1, xm, 1]]) {
      const P = [[xa, g.y0, g.z0], [xa, g.y1, g.z0], [xb, g.y1, g.z1], [xb, g.y0, g.z1]];
      const run = Math.hypot(xm - xa, g.z1 - g.z0);
      B.face(g.mat, P, [[0, 0], [g.y1 - g.y0, 0], [g.y1 - g.y0, run], [0, run]], [sg * (g.z1 - g.z0), 0, Math.abs(xm - xa)]);
      B.face(g.inner, P.map((p) => [p[0], p[1], p[2] - 0.12]), [[0, 0], [g.y1 - g.y0, 0], [g.y1 - g.y0, run], [0, run]], [-sg * (g.z1 - g.z0), 0, -Math.abs(xm - xa)]);
    }
    for (const [y, sg] of [[g.y0 + 0.3, -1], [g.y1 - 0.3, 1]]) {
      B.face("chapel_hi", [[g.x0 + 0.3, y, g.z0], [g.x1 - 0.3, y, g.z0], [xm, y, g.z1 - 0.12]], [[0, 0], [g.x1 - g.x0, 0], [(g.x1 - g.x0) / 2, g.z1 - g.z0]], [0, -sg, 0]);
      B.face("stone", [[g.x0 + 0.3, y + sg * 0.6, g.z0], [g.x1 - 0.3, y + sg * 0.6, g.z0], [xm, y + sg * 0.6, g.z1]], [[0, 0], [g.x1 - g.x0, 0], [(g.x1 - g.x0) / 2, g.z1 - g.z0]], [0, sg, 0]);
    }
  }
  function terrain(scene, t) {
    const nx = t.nx, ny = t.ny;
    const pos = new Float32Array(nx * ny * 3), uv = new Float32Array(nx * ny * 2), col = new Float32Array(nx * ny * 3);
    const R = rng(77);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, x = t.x0 + i * t.res, y = t.y0 + j * t.res, z = t.h[k] / 20;
      pos[3 * k] = x; pos[3 * k + 1] = z; pos[3 * k + 2] = -y;
      uv[2 * k] = x; uv[2 * k + 1] = y;
      const v = 0.78 + 0.22 * Math.sin(x * 0.13 + Math.sin(y * 0.07) * 2) * Math.cos(y * 0.11) + (R() - 0.5) * 0.1;
      col[3 * k] = v; col[3 * k + 1] = v * 0.98; col[3 * k + 2] = v * 0.94;
    }
    const idx = [];
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, matVC("leaves"));
    m.receiveShadow = true;
    m.castShadow = true;
    scene.add(m);
    LV.terrain = t;
  }
  LV.ground = function (x, y) {
    const t = LV.terrain;
    if (!t) return 0;
    const fi = (x - t.x0) / t.res, fj = (y - t.y0) / t.res;
    const i = Math.max(0, Math.min(t.nx - 2, Math.floor(fi))), j = Math.max(0, Math.min(t.ny - 2, Math.floor(fj)));
    const u = fi - i, v = fj - j, h = (a, b) => t.h[(j + b) * t.nx + i + a] / 20;
    return h(0, 0) * (1 - u) * (1 - v) + h(1, 0) * u * (1 - v) + h(0, 1) * (1 - u) * v + h(1, 1) * u * v;
  };

  /* ---------------------------------------------------------------- build all */
  LV.clockFaces = [];
  LV.build = function (scene, D) {
    const B = new Batch();
    const occ = [];
    const deco = { glass: [], leaves: [] };
    for (const f of D.floors) {
      const uvf = uvFrame(f.uv);
      polyFace(B, f.mat, f.poly, f.holes, f.z, true, uvf);
      if (f.ceil !== undefined) polyFace(B, f.cmat || "ceiling", f.poly, f.holes, f.ceil, false, uvf);
      if (f.under) polyFace(B, f.under, f.poly, f.holes, f.z - (f.slab || 0.3), false, uvf);
      if (f.edge) {
        ring(f.poly, f.z - (f.slab || 0.3), f.z, B, f.under || "concrete", true);
        for (const h of f.holes || []) ring(h, f.z - (f.slab || 0.3), f.z, B, f.under || "concrete", false);
      }
    }
    for (const c of D.ceilings || []) polyFace(B, c.mat, c.poly, c.holes, c.z, false, uvFrame(c.uv));
    for (const s of D.slabs || []) {
      const uvf = uvFrame(s.uv);
      if (s.top !== "none") polyFace(B, s.top, s.poly, s.holes, s.z1, true, uvf);
      if (s.bottom !== "none") polyFace(B, s.bottom, s.poly, s.holes, s.z0, false, uvf);
      if (s.side !== "none") ring(s.poly, s.z0, s.z1, B, s.side === "ext" ? "ext" : s.side, true);
    }
    D.walls.forEach((w, i) => buildWall(B, w, i, occ, deco));
    for (const b of D.boxes || []) B.box(b.mat, b.c, b.s, b.r);
    for (const f of D.flights || []) flight(B, f);
    for (const s of D.spirals || []) spiral(B, s);
    for (const r of D.rails || []) rail(B, r);
    for (const r of D.ramps || []) ramp(B, r);
    for (const t of D.tubes || []) tube(B, t, occ);
    for (const d of D.domes || []) dome(B, d);
    for (const t of D.towers || []) tower(B, t);
    for (const g of D.gables || []) gable(B, g);
    for (const c of D.cylinders || []) {
      const n = 40, pts = [];
      for (let k = 0; k < n; k++) pts.push([c.c[0] + c.r * Math.cos(2 * Math.PI * k / n), c.c[1] + c.r * Math.sin(2 * Math.PI * k / n)]);
      ring(pts, c.c[2], c.c[2] + c.h, B, c.mat, true);
      polyFace(B, c.mat, pts, null, c.c[2] + c.h, true, (p) => [p[0], p[1]]);
    }
    for (const f of D.fountains || []) {
      const n = 40, o = [], i2 = [];
      for (let k = 0; k < n; k++) {
        const a = 2 * Math.PI * k / n;
        o.push([f.c[0] + f.r * Math.cos(a), f.c[1] + f.r * Math.sin(a)]);
        i2.push([f.c[0] + (f.r - 0.35) * Math.cos(a), f.c[1] + (f.r - 0.35) * Math.sin(a)]);
      }
      ring(o, f.c[2], f.c[2] + 0.55, B, "stone", true);
      ring(i2, f.c[2] - 0.2, f.c[2] + 0.55, B, "stone", false);
      polyFace(B, "stone", o, [i2.slice().reverse()], f.c[2] + 0.55, true, (p) => [p[0], p[1]]);
      polyFace(B, "leaves", i2, null, f.c[2] - 0.2, true, (p) => [p[0], p[1]]);
      B.box("stone", [f.c[0], f.c[1], f.c[2] + 0.2], [1.1, 1.1, 0.8], 0);
    }
    for (const c of D.chimneys || []) {
      ring([[c.x0, c.y0], [c.x1, c.y0], [c.x1, c.y1], [c.x0, c.y1]], c.z0, c.z1, B, "brick", true);
      B.box("brick", [(c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2, c.z1 + 0.3], [c.x1 - c.x0 + 0.5, c.y1 - c.y0 + 0.5, 0.6], 0);
    }
    for (const b of D.boilers || []) {
      const n = 20;
      for (let k = 0; k < n; k++) {
        const a0 = 2 * Math.PI * k / n, a1 = 2 * Math.PI * (k + 1) / n;
        const P = (x, a) => [b.c[0] + x, b.c[1] + Math.cos(a) * b.r, b.c[2] + b.r + 0.3 + Math.sin(a) * b.r];
        B.face("rust", [P(-b.l / 2, a0), P(b.l / 2, a0), P(b.l / 2, a1), P(-b.l / 2, a1)], [[0, k * 0.5], [b.l, k * 0.5], [b.l, (k + 1) * 0.5], [0, (k + 1) * 0.5]],
          [0, Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2)]);
      }
      for (const sg of [-1, 1]) {
        const pts = [];
        for (let k = 0; k < n; k++) { const a = 2 * Math.PI * k / n; pts.push([b.c[1] + Math.cos(a) * b.r, b.c[2] + b.r + 0.3 + Math.sin(a) * b.r]); }
        const P3 = pts.map((p) => [b.c[0] + sg * b.l / 2, p[0], p[1]]);
        const faces = [];
        for (let k = 1; k < n - 1; k++) faces.push([0, k, k + 1]);
        B.tris("rust", P3, faces, (p) => [p[1], p[2]], [sg, 0, 0]);
      }
      B.box("iron", [b.c[0], b.c[1], b.c[2] + 0.15], [b.l * 0.8, b.r * 1.4, 0.3], 0);
    }
    const meshes = B.build(scene);
    // decorative leaves and glass
    const LB = new Batch();
    for (const l of deco.leaves) LB.box(l.mat, l.c, l.s, l.r);
    LB.build(scene);
    const gm = E().mat("glass"), sm = new THREE.MeshStandardMaterial({ color: 0x223040, emissive: 0x6a5a8a, emissiveIntensity: 0.25, transparent: true, opacity: 0.75, roughness: 0.3 });
    const gp = [], sp = [];
    for (const g of deco.glass) (g.stained ? sp : gp).push(g);
    for (const [list, mat] of [[gp, gm], [sp, sm]]) {
      if (!list.length) continue;
      const geo = new THREE.PlaneGeometry(1, 1);
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      const o = new THREE.Object3D();
      list.forEach((g, i) => {
        o.position.set(g.p[0], g.p[2], -g.p[1]);
        o.rotation.set(0, g.r * Math.PI / 180, 0);
        o.scale.set(g.w, g.h, 1);
        o.updateMatrix();
        im.setMatrixAt(i, o.matrix);
      });
      im.renderOrder = 3;
      scene.add(im);
    }
    if (D.terrain) terrain(scene, D.terrain);
    // line-of-sight boxes in a coarse hash
    LV.occ = occ;
    LV.occHash = new Map();
    occ.forEach((b, i) => {
      const r = Math.hypot(b.h[0], b.h[1]);
      for (let gx = Math.floor((b.c[0] - r) / 8); gx <= Math.floor((b.c[0] + r) / 8); gx++)
        for (let gy = Math.floor((b.c[1] - r) / 8); gy <= Math.floor((b.c[1] + r) / 8); gy++) {
          const k = gx + "," + gy;
          if (!LV.occHash.has(k)) LV.occHash.set(k, []);
          LV.occHash.get(k).push(i);
        }
    });
    return { meshes, triangles: meshes.reduce((s, m) => s + m.geometry.attributes.position.count / 3, 0) };
  };

  // segment vs wall boxes (and extra boxes such as shut doors)
  LV.blocked = function (a, b, extra) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const L = Math.hypot(dx, dy);
    const seen = new Set();
    const steps = Math.max(1, Math.ceil(L / 4));
    const test = (o) => {
      const rx = a[0] - o.c[0], ry = a[1] - o.c[1];
      const ox = rx * o.ca + ry * o.sa, oy = -rx * o.sa + ry * o.ca, oz = a[2] - o.c[2];
      const vx = dx * o.ca + dy * o.sa, vy = -dx * o.sa + dy * o.ca, vz = dz;
      let t0 = 0, t1 = 1;
      for (const [p, v, h] of [[ox, vx, o.h[0]], [oy, vy, o.h[1]], [oz, vz, o.h[2]]]) {
        if (Math.abs(v) < 1e-9) { if (p < -h || p > h) return false; continue; }
        let ta = (-h - p) / v, tb = (h - p) / v;
        if (ta > tb) { const q = ta; ta = tb; tb = q; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) return false;
      }
      return t1 > 0.02 && t0 < 0.98;
    };
    for (let s = 0; s <= steps; s++) {
      const x = a[0] + dx * s / steps, y = a[1] + dy * s / steps;
      const list = LV.occHash.get(Math.floor(x / 8) + "," + Math.floor(y / 8));
      if (!list) continue;
      for (const i of list) {
        if (seen.has(i)) continue;
        seen.add(i);
        if (test(LV.occ[i])) return true;
      }
    }
    if (extra) for (const o of extra) if (test(o)) return true;
    return false;
  };
})();
