/* 雾岭疗养院 · the night matron's brain.
   She walks the same navigation graph the level was compiled from (doors, one-way doors, locks and safe rooms
   apply to her as they do to you), sees within her lantern and your torch beam, hears by walking distance
   through the walk grid (lead walls stop sound), and a menace gauge sends her backstage into the service shafts
   so she never camps on you and never pops up in your view (after RE2's Mr X and Alien: Isolation's director). */
(function () {
  "use strict";
  const S = (window.SANA = window.SANA || {});
  const AI = (S.AI = {});
  // AI mode gives her a seeded stream of her own, so what she does never depends on how many frames were rendered
  const QS = new URLSearchParams(location.search);
  let rs = 0;
  const rand = QS.has("ai") ? () => { rs = (rs + 0x6D2B79F5) >>> 0; let t = rs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; } : Math.random;
  AI.seed = (n) => { rs = ((n >>> 0) ^ 0x9e3779b9) >>> 0; };
  AI.seed(+QS.get("seed") || 1934);
  const SPEED = { patrol: 1.45, investigate: 1.95, chase: 2.65, search: 1.6, return: 1.55, retreat: 2.1, grab: 0.4 };
  let D, G, nodes, edges, adj, doorByEdge = {}, nodeHash = new Map(), patrols = {};
  const M = { x: 0, y: 0, z: 0, h: 0, state: "patrol", route: [], node: 0, patrol: "wards", pidx: 0, wait: 0, aware: 0,
    lastSeen: null, lastSeenT: -99, menace: 0, backstage: 0, visible: true, sens: 1, unseenT: 0, sawHide: null, searchT: 0,
    searchList: [], grace: 45, breathT: 0, speed: 0, senseT: 0, planT: 0, stepAcc: 0, farT: 0, look: 0, see: 0, t: 0, catchT: 0 };
  AI.M = M;

  AI.init = function (data, game) {
    D = data; G = game;
    nodes = D.nav.nodes.map((n, i) => ({ i, id: n.id, p: n.p, k: n.k, lv: n.lv, safe: n.k === "safe" }));
    edges = D.nav.edges;
    adj = nodes.map(() => []);
    edges.forEach((e, i) => { adj[e.a].push({ e: i, to: e.b, fwd: true }); adj[e.b].push({ e: i, to: e.a, fwd: false }); });
    D.doors.forEach((d, i) => { if (d.edge !== undefined && d.edge !== null) doorByEdge[d.edge] = i; });
    nodes.forEach((n) => {
      const k = Math.floor(n.p[0] / 8) + "," + Math.floor(n.p[1] / 8);
      if (!nodeHash.has(k)) nodeHash.set(k, []);
      nodeHash.get(k).push(n.i);
    });
    for (const k in D.nav.patrols) patrols[k] = D.nav.patrols[k];
    const idx = (id) => nodes.findIndex((n) => n.id === id);
    patrols.tunnel = ["N0_morgue", "N0_tunnel", "T_1", "T_2", "T_3", "T_4", "B_in", "B_panel", "B_in", "B_closet", "B_in", "T_4", "T_3", "T_2", "T_1", "N0_tunnel", "N0_morgue"].map(idx).filter((i) => i >= 0);
    AI.reset(G.P);
  };
  AI.reset = function (P) {
    const start = patrols.wards[Math.floor(patrols.wards.length / 2)];
    setPos(nodes[start].p);
    M.node = start; M.patrol = "wards"; M.pidx = patrols.wards.indexOf(start); M.state = "patrol"; M.route = [];
    M.aware = 0; M.menace = 0; M.backstage = 0; M.visible = true; M.sawHide = null; M.grace = P && G.ST.deaths ? 20 : 45; M.farT = 0;
    // after a retry she starts far from you
    if (P && G.ST.deaths) emergeFarFrom(P);
  };
  function setPos(p) { M.x = p[0]; M.y = p[1]; M.z = p[2]; }

  /* ---------------------------------------------------------------- graph */
  function passable(i, fwd) {
    const e = edges[i];
    if (e.k === "elevator" || e.k === "chute" || e.k === "sealed") return false;
    if (nodes[e.a].safe || nodes[e.b].safe) return false;
    const di = doorByEdge[i];
    if (di !== undefined) {
      const dr = G.doors()[di];
      if (!dr) return false;
      if (dr.d.k === "oneway") return fwd || dr.open;
      return dr.open;
    }
    if (e.ow && !fwd) return false;
    if (e.need) return e.need === "power" ? !!G.ST.power : false;
    return true;
  }
  function astar(src, dst) {
    if (src === dst) return { nodes: [src], edges: [] };
    const n = nodes.length;
    const g = new Float64Array(n).fill(Infinity), pe = new Int32Array(n).fill(-1), pn = new Int32Array(n).fill(-1);
    const H = (i) => Math.hypot(nodes[i].p[0] - nodes[dst].p[0], nodes[i].p[1] - nodes[dst].p[1], (nodes[i].p[2] - nodes[dst].p[2]) * 1.5);
    const heap = new S.Walk.Heap();
    g[src] = 0; heap.push(H(src), src, 0);
    while (heap.a.length) {
      const [, u] = heap.pop();
      if (u === dst) break;
      for (const a of adj[u]) {
        if (!passable(a.e, a.fwd)) continue;
        const c = g[u] + edges[a.e].len;
        if (c < g[a.to]) { g[a.to] = c; pe[a.to] = a.e; pn[a.to] = u; heap.push(c + H(a.to), a.to, 0); }
      }
    }
    if (g[dst] === Infinity) return null;
    const out = [dst], es = [];
    let u = dst;
    while (u !== src) { es.push(pe[u]); u = pn[u]; out.push(u); }
    return { nodes: out.reverse(), edges: es.reverse(), cost: g[dst] };
  }
  AI.astar = astar;
  function nearestNode(x, y, z, needLOS) {
    let best = -1, bd = 1e9;
    const gx = Math.floor(x / 8), gy = Math.floor(y / 8);
    for (let r = 0; r <= 3 && best < 0; r++) {
      for (let i = gx - r; i <= gx + r; i++) for (let j = gy - r; j <= gy + r; j++) {
        if (Math.max(Math.abs(i - gx), Math.abs(j - gy)) !== r) continue;
        for (const ni of nodeHash.get(i + "," + j) || []) {
          const n = nodes[ni];
          if (n.safe) continue;
          const dz = Math.abs(n.p[2] - z);
          if (dz > 2.2) continue;
          const d = Math.hypot(n.p[0] - x, n.p[1] - y) + dz * 3;
          if (d >= bd) continue;
          if (needLOS && S.Level.blocked([x, y, z + 1.0], [n.p[0], n.p[1], n.p[2] + 1.0])) continue;
          bd = d; best = ni;
        }
      }
    }
    if (best < 0 && needLOS) return nearestNode(x, y, z, false);
    return best;
  }
  AI.nearestNode = nearestNode;
  function planTo(dst, extraPoint) {
    const src = nearestNode(M.x, M.y, M.z, true);
    if (src < 0 || dst < 0) return false;
    const r = astar(src, dst);
    if (!r) return false;
    const pts = [{ p: nodes[src].p.slice(), e: -1 }];
    r.edges.forEach((ei, k) => {
      const e = edges[ei], fwd = e.a === r.nodes[k];
      const path = fwd ? e.path : e.path.slice().reverse();
      for (let i = 1; i < path.length; i++) pts.push({ p: path[i], e: ei, fwd, node: i === path.length - 1 ? r.nodes[k + 1] : -1 });
    });
    if (extraPoint) pts.push({ p: extraPoint, e: -1 });
    // replanning every 0.6 s in a chase would otherwise send her back to the node she just left, over and over
    if (pts.length > 2 && pts[1].e >= 0) {
      const a = pts[0].p, b = pts[1].p, abx = b[0] - a[0], aby = b[1] - a[1], L2 = abx * abx + aby * aby;
      const t = L2 > 1e-6 ? ((M.x - a[0]) * abx + (M.y - a[1]) * aby) / L2 : 0;
      const off = Math.hypot(a[0] + abx * t - M.x, a[1] + aby * t - M.y);
      if (t > 0 && t < 1 && off < 0.8 && Math.abs(M.z - (a[2] + (b[2] - a[2]) * t)) < 0.6) pts.shift();
    }
    M.route = pts;
    return true;
  }

  /* ---------------------------------------------------------------- senses */
  function doorBoxes() {
    const out = [];
    for (const dr of G.doors()) {
      if (dr.open) continue;
      const a = dr.d.r * Math.PI / 180;
      out.push({ c: [dr.d.p[0], dr.d.p[1], dr.d.p[2] + dr.d.h / 2], h: [dr.d.w / 2, 0.06, dr.d.h / 2], ca: Math.cos(a), sa: Math.sin(a) });
    }
    return out;
  }
  function slabBlocked(a, b) {
    if (Math.abs(a[2] - b[2]) < 1.2) return false;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const n = Math.ceil(L / 0.4);
    for (let i = 1; i < n; i++) {
      const t = i / n, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
      const c = S.Walk.cell(x, y);
      if (c < 0) continue;
      for (let k = S.Walk.start[c]; k < S.Walk.start[c + 1]; k++) {
        const h = S.Walk.h[k] / 20;
        if (z < h + 0.02 && z > h - 0.35) return true;
      }
    }
    return false;
  }
  function sight(P) {
    if (P.hidden || !M.visible) return 0;
    const eye = [M.x, M.y, M.z + 1.62], pe = G.eyePos();
    const dx = pe[0] - eye[0], dy = pe[1] - eye[1], dz = pe[2] - eye[2], d = Math.hypot(dx, dy, dz);
    const range = P.light ? 30 : P.crouch > 0.5 ? 6.5 : 11.5;
    if (d > Math.max(range, 3.2)) return 0;
    const h = M.h * Math.PI / 180;
    const c = (dx * Math.cos(h) + dy * Math.sin(h)) / Math.max(0.01, Math.hypot(dx, dy));
    if (d > 2.0 && c < (P.light ? 0.25 : 0.42)) return 0;
    if (S.Level.blocked(eye, pe, doorBoxes()) || slabBlocked(eye, pe)) return 0;
    return Math.max(0.15, 1 - d / (range + 2));
  }
  AI.noise = function (p, radius, kind) {
    if (!D || radius <= 0 || M.backstage > 0 || !M.visible) return;
    const r = radius * M.sens;
    const dz = Math.abs(p[2] - M.z);
    if (Math.hypot(p[0] - M.x, p[1] - M.y) > r * 1.05 || (dz > 7 && r < 30)) return;
    const dist = S.Walk.flood(p[0], p[1], p[2], r, false);
    const k = S.Walk.entry(M.x, M.y, M.z, 0.9, true);
    if (k < 0 || !dist.has(k)) return;
    heard(p, kind);
  };
  function heard(p, kind) {
    if (M.state === "chase" || M.state === "retreat" || M.state === "grab") return;
    M.target = p.slice();
    if (M.state !== "investigate" || kind === "run" || kind === "power") {
      M.state = "investigate";
      M.look = 0;
      const n = nearestNode(p[0], p[1], p[2], true);
      if (!planTo(n, p)) M.state = "patrol";
      if (S.Audio) S.Audio.matronNotice(kind);
    }
  }
  AI.playerHid = function (h) {
    if (M.t - M.lastSeenT < 1.5 && M.aware > 0.45) M.sawHide = h;
  };

  /* ---------------------------------------------------------------- movement */
  function turnTo(tx, ty, dt) {
    const want = Math.atan2(ty - M.y, tx - M.x) * 180 / Math.PI;
    const d = ((want - M.h + 540) % 360) - 180;
    M.h += Math.max(-300 * dt, Math.min(300 * dt, d));
  }
  function followRoute(dt, speed) {
    let left = speed * dt;
    M.speed = 0;
    while (left > 0 && M.route.length) {
      const wp = M.route[0];
      if (wp.e >= 0) {
        const di = doorByEdge[wp.e];
        if (di !== undefined) {
          const dr = G.doors()[di];
          if (!dr.open && dr.d.k === "oneway" && wp.fwd) G.npcDoor(dr);
          if (!dr.open && dr.d.k !== "oneway") { M.route = []; break; }
        }
      }
      const dx = wp.p[0] - M.x, dy = wp.p[1] - M.y, dz = wp.p[2] - M.z;
      const d = Math.hypot(dx, dy);
      if (d < 1e-3 && Math.abs(dz) < 0.05) { M.route.shift(); if (wp.node >= 0) M.node = wp.node; continue; }
      const step = Math.min(left, d || 0.01);
      const t = d > 1e-6 ? step / d : 1;
      M.x += dx * t; M.y += dy * t; M.z += dz * t;
      if (d > 0.05) turnTo(wp.p[0], wp.p[1], dt);
      left -= step;
      M.speed = speed;
      M.stepAcc += step;
      if (t >= 1 - 1e-6) { M.route.shift(); if (wp.node >= 0) M.node = wp.node; }
    }
  }
  function moveDirect(tx, ty, dt, speed) {
    const dx = tx - M.x, dy = ty - M.y, d = Math.hypot(dx, dy);
    if (d < 0.05) return true;
    const step = Math.min(d, speed * dt);
    const B = { x: M.x, y: M.y, zt: M.z };
    const ok = S.Walk.move(B, dx / d * step, dy / d * step, 0.22);
    const k = S.Walk.entry(B.x, B.y, B.zt, 0.6);
    if (!ok || (k >= 0 && S.Walk.safe(k))) return false;
    M.stepAcc += Math.hypot(B.x - M.x, B.y - M.y);
    M.x = B.x; M.y = B.y; M.z += (B.zt - M.z) * Math.min(1, dt * 10);
    turnTo(tx, ty, dt);
    M.speed = speed;
    return true;
  }
  function walkable(ax, ay, az, bx, by) {
    const d = Math.hypot(bx - ax, by - ay), n = Math.ceil(d / 0.4);
    let z = az;
    for (let i = 1; i <= n; i++) {
      const k = S.Walk.entry(ax + (bx - ax) * i / n, ay + (by - ay) * i / n, z, 0.5);
      if (k < 0 || S.Walk.safe(k)) return false;
      z = S.Walk.height(k);
    }
    return true;
  }

  /* ---------------------------------------------------------------- director */
  function regionPatrol(P) {
    const k = S.Walk.entry(P.x, P.y, P.z, 0.8);
    if (P.z < 17.5) return "tunnel";
    if (P.y > 60) return "new";
    if (Math.hypot(P.x, P.y) < 14 || (P.y > 14 && P.y < 60)) return "hub";
    const du = P.x - 10.88, dv = P.y - 5.07;
    if (du * 0.906 + dv * 0.423 > 0 && P.x > 8) return "service";
    return "wards";
  }
  function emergeNear(P) {
    let best = null, bc = 1e9;
    const pn = nearestNode(P.x, P.y, P.z, false);
    for (const sh of D.nav.shafts) {
      const ni = nodes.findIndex((n) => n.id === sh.node);
      if (ni < 0) continue;
      const d = Math.hypot(sh.p[0] - P.x, sh.p[1] - P.y, (sh.p[2] - P.z) * 2);
      if (d < 15) continue;
      const pe = G.eyePos();
      if (!S.Level.blocked(pe, [sh.p[0], sh.p[1], sh.p[2] + 1.2]) && d < 30) continue;
      const r = pn >= 0 ? astar(ni, pn) : null;
      const c = r ? r.cost : d * 3;
      if (c < bc) { bc = c; best = ni; }
    }
    if (best === null) return emergeFarFrom(P);
    setPos(nodes[best].p);
    M.node = best;
    M.visible = true;
    M.backstage = 0;
    M.patrol = regionPatrol(P);
    M.pidx = closestIndex(patrols[M.patrol]);
    M.state = "return";
    planTo(patrols[M.patrol][M.pidx]);
    if (S.Audio) S.Audio.shaft([M.x, M.y, M.z]);
  }
  function emergeFarFrom(P) {
    let best = null, bd = -1;
    for (const sh of D.nav.shafts) {
      const d = Math.hypot(sh.p[0] - P.x, sh.p[1] - P.y);
      if (d > bd) { bd = d; best = sh; }
    }
    const ni = nodes.findIndex((n) => n.id === best.node);
    setPos(nodes[ni].p); M.node = ni; M.visible = true; M.backstage = 0;
    M.patrol = "wards"; M.pidx = closestIndex(patrols.wards); M.state = "return"; planTo(patrols.wards[M.pidx]);
  }
  function closestIndex(route) {
    let bi = 0, bd = 1e9;
    route.forEach((ni, i) => { const n = nodes[ni]; const d = Math.hypot(n.p[0] - M.x, n.p[1] - M.y) + Math.abs(n.p[2] - M.z) * 4; if (d < bd) { bd = d; bi = i; } });
    return bi;
  }
  function goBackstage() {
    let best = -1, bc = 1e9;
    const src = nearestNode(M.x, M.y, M.z, true);
    for (const sh of D.nav.shafts) {
      const ni = nodes.findIndex((n) => n.id === sh.node);
      const r = ni >= 0 && src >= 0 ? astar(src, ni) : null;
      if (r && r.cost < bc) { bc = r.cost; best = ni; }
    }
    M.state = "retreat";
    if (best < 0 || !planTo(best)) { M.backstage = 30; M.visible = false; }
    M.retreatNode = best;
  }

  /* ---------------------------------------------------------------- update */
  AI.update = function (dt, P, ST) {
    if (!D) return;
    if (AI.frozen) { S.Actors.setMatron(M.x, M.y, M.z, M.h, 0, true, "patrol"); return; }
    M.t += dt;
    M.grace -= dt;
    const dP = Math.hypot(P.x - M.x, P.y - M.y), dz = Math.abs(P.z - M.z);
    if (M.backstage > 0) {
      M.backstage -= dt;
      M.visible = false;
      if (M.backstage <= 0) emergeNear(P);
      S.Actors.setMatron(M.x, M.y, M.z, M.h, 0, false, M.state);
      return;
    }
    // senses
    M.senseT -= dt;
    if (M.senseT <= 0) {
      M.senseT = 0.12;
      M.see = M.grace > 0 ? 0 : sight(P);
      if (M.see > 0) { M.lastSeen = [P.x, P.y, P.z]; M.lastSeenT = M.t; }
    }
    if (M.see > 0) {
      M.aware = Math.min(1, M.aware + 0.12 * (0.7 + 3.2 * M.see) * (P.run ? 1.6 : 1) * (M.state === "chase" ? 4 : 1) * (dt / 0.12));
      if (M.aware >= 1 && M.state !== "chase" && M.state !== "grab") {
        M.state = "chase"; M.planT = 0;
        ST.spotted++;
        if (S.Audio) S.Audio.stinger("spotted");
      }
      M.unseenT = 0;
    } else {
      M.unseenT += dt;
      if (M.state !== "chase") M.aware = Math.max(0, M.aware - dt * 0.22);
      if (M.unseenT > 180) { M.sens = Math.min(1.5, M.sens * 1.1); M.unseenT = 0; }
    }
    // menace: never camp on the player
    if (M.see > 0) M.menace += dt * 0.8;
    else if (dP < 14 && dz < 4) M.menace += dt * 0.35;
    else M.menace = Math.max(0, M.menace - dt * 0.12);
    if (M.menace >= 10 && M.state !== "chase" && M.state !== "retreat" && M.state !== "grab") { M.menace = 0; goBackstage(); }
    // the director brings her closer when you have been far for long
    const far = dP + dz * 4 > 70;
    M.farT = far && M.state === "patrol" ? M.farT + dt : 0;
    if (M.farT > 55) { M.farT = 0; goBackstage(); M.backstageShort = true; }
    // hidden player: she opens the locker she saw you enter, or hears your breathing
    if (P.hidden) {
      const near = dP < 2.6 && dz < 1.5;
      if (near && !P.holding) M.breathT += dt; else M.breathT = Math.max(0, M.breathT - dt);
      if (P.holding && P.breath <= 0 && near) M.breathT = 3;
      if (M.breathT > 2.2 && !M.sawHide) { M.sawHide = P.hidden; if (S.Audio) S.Audio.matronNotice("breath"); }
      if (M.sawHide === P.hidden && M.state !== "grab") {
        M.state = "grab";
        planTo(nearestNode(P.hidden.p[0], P.hidden.p[1], P.hidden.p[2], true), [P.hidden.p[0] + Math.cos(P.hidden.r * Math.PI / 180) * 0.9, P.hidden.p[1] + Math.sin(P.hidden.r * Math.PI / 180) * 0.9, P.hidden.p[2]]);
      }
    } else if (M.sawHide) M.sawHide = null;
    // state machine
    switch (M.state) {
      case "patrol": {
        if (M.wait > 0) { M.wait -= dt; M.speed = 0; M.h += Math.sin(M.t * 1.3) * 20 * dt; break; }
        if (!M.route.length) {
          const route = patrols[M.patrol];
          M.pidx = (M.pidx + 1) % route.length;
          if (!planTo(route[M.pidx])) { M.pidx = closestIndex(route); planTo(route[M.pidx]); }
          if (rand() < 0.12) M.wait = 1.5 + rand() * 2;
        }
        followRoute(dt, SPEED.patrol);
        break;
      }
      case "investigate": case "return": {
        if (!M.route.length) {
          if (M.state === "return") { M.state = "patrol"; break; }
          M.look += dt; M.speed = 0;
          M.h += 70 * dt * Math.sin(M.look * 1.7);
          if (M.look > 3.5) { M.state = "search"; M.searchT = 0; M.searchList = searchSpots(M.target || [M.x, M.y, M.z]); }
          break;
        }
        followRoute(dt, M.state === "return" ? SPEED.return : SPEED.investigate);
        break;
      }
      case "chase": {
        M.planT -= dt;
        const losWalk = M.see > 0 && dz < 1.0 && dP < 14 && walkable(M.x, M.y, M.z, P.x, P.y);
        if (losWalk) {
          M.route = [];
          if (!moveDirect(P.x, P.y, dt, SPEED.chase)) M.planT = 0;
        } else {
          if (M.planT <= 0 || !M.route.length) {
            M.planT = 0.6;
            const tgt = M.lastSeen || [P.x, P.y, P.z];
            planTo(nearestNode(tgt[0], tgt[1], tgt[2], true), tgt);
          }
          followRoute(dt, SPEED.chase);
        }
        if (M.unseenT > 2.2) { M.state = "search"; M.searchT = 0; M.searchList = searchSpots(M.lastSeen || [M.x, M.y, M.z]); M.aware = 0.6; }
        break;
      }
      case "search": {
        M.searchT += dt;
        if (!M.route.length) {
          if (M.searchList.length) {
            const n = M.searchList.shift();
            planTo(n);
            M.wait = 1.2;
          } else M.searchT = 99;
        }
        if (M.wait > 0 && !M.route.length) { M.wait -= dt; M.h += 90 * dt; }
        followRoute(dt, SPEED.search);
        if (M.searchT > 20) { M.state = "return"; M.patrol = regionPatrol(P); M.pidx = closestIndex(patrols[M.patrol]); planTo(patrols[M.patrol][M.pidx]); }
        break;
      }
      case "retreat": {
        followRoute(dt, SPEED.retreat);
        if (!M.route.length) {
          M.visible = false;
          M.backstage = M.backstageShort ? 18 + rand() * 15 : 60 + rand() * 30;
          M.backstageShort = false;
          if (S.Audio) S.Audio.shaft([M.x, M.y, M.z]);
        }
        break;
      }
      case "grab": {
        followRoute(dt, SPEED.chase * 0.8);
        if (!M.route.length && P.hidden) {
          M.catchT += dt;
          if (M.catchT > 0.6) { G.forceOut(); G.caught([M.x, M.y]); M.catchT = 0; }
        }
        if (!P.hidden) { M.state = "chase"; M.aware = 1; }
        break;
      }
    }
    // catch
    if (!P.hidden && !P.safe && M.visible && M.grace <= 0 && dP < 0.95 && dz < 1.3 && ST.mode === "play") G.caught([M.x, M.y]);
    // sound
    if (M.stepAcc > 0.62) {
      M.stepAcc = 0;
      if (S.Audio) S.Audio.matronStep([M.x, M.y, M.z], M.state);
    }
    S.Actors.setMatron(M.x, M.y, M.z, M.h, M.speed, M.visible, M.state);
  };
  function searchSpots(p) {
    const start = nearestNode(p[0], p[1], p[2], true);
    if (start < 0) return [];
    const seen = new Set([start]), out = [];
    let frontier = [start];
    for (let depth = 0; depth < 3; depth++) {
      const next = [];
      for (const u of frontier) for (const a of adj[u]) {
        if (seen.has(a.to) || !passable(a.e, a.fwd)) continue;
        seen.add(a.to); next.push(a.to);
      }
      frontier = next;
    }
    const pool = [...seen].filter((i) => i !== start);
    for (let i = 0; i < 3 && pool.length; i++) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
    return [start].concat(out);
  }

  AI.fear = function () {
    if (!M.visible) return 0;
    const P = G.P, d = Math.hypot(P.x - M.x, P.y - M.y) + Math.abs(P.z - M.z) * 3;
    if (M.state === "chase" || M.state === "grab") return 1;
    return Math.max(0, 1 - d / 24) * (0.45 + 0.55 * M.aware);
  };
  AI.awareness = () => (M.state === "chase" || M.state === "grab" ? 1 : M.aware);
  AI.debug = () => ({ x: M.x, y: M.y, z: M.z, state: M.state, aware: M.aware, menace: M.menace, backstage: M.backstage, patrol: M.patrol, route: M.route.length, visible: M.visible });
  AI.set = (x, y, z, state) => { setPos([x, y, z]); M.route = []; if (state) M.state = state; M.grace = 0; };
})();
