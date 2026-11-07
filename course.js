/* Space Track · 冲关模式 (web): a first-person obstacle course over a pool, built from course_layout.js (generated
   from course/layout.py). One fixed-step physics model drives human play, the turn-based AI action mode and the
   oracle. Everything that moves is a pure function of time and the seed, so the same actions always give the same run.
   window.SPACEACT.env is the bench/runner.js API; env.frames() returns a burst of past frames so motion is visible. */
(function () {
  "use strict";
  const L0 = window.SA_COURSE;
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------------------------------------------ constants
  const DT = 1 / 60, GRAV = 9.81;
  const BODY = L0.BODY, WALK = BODY.walk, RUN = BODY.run, PR = BODY.radius, JMAX = BODY.jump_long;
  const V0 = Math.sqrt(2 * GRAV * BODY.jump_up), AIR = (2 * V0) / GRAV;
  const STEP_UP = 0.4, DROP = 0.08, TOL = 0.16, LAND_TOL = 0.12, CLIMB = 0.5, RESPAWN = 3.0, CRAWL = 0.8;
  /* People only (the AI always jumps from the ground): a jump still works this long after running off an edge,
     and steering in the air is this strong (m/s²). */
  const COYOTE = 0.15, AIR_CONTROL = 6;
  const EYE = L0.EYE, EYE_DUCK = 0.95, HANDS = 2.0, DECK = L0.DECK;
  const BURST_N = 4, BURST_DT = 0.25, FOV = 60, AI_PITCH = -8, MAX_WAIT = 20;
  const BUDGET = [3, 10]; // AI step limit per section = oracle steps × 3 + 10
  const SECTION_LIMIT = 300; // seconds of game time per section
  const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const normDeg = (h) => ((((h + 180) % 360) + 360) % 360) - 180;
  const angDiff = (a, b) => normDeg(a - b);
  const headingOf = (dx, dy) => deg(Math.atan2(dy, dx));
  const round = (v, k) => Math.round(v * k) / k;
  const fmtT = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
  const ZERO = [0, 0];

  const [LA, LB, LC] = L0.LANE_X;
  const CP_NAMES = ["起点", "CP1", "CP2", "CP3", "CP4", "CP5", "CP6", "CP7", "CP8", "CP9", "CP10", "CP11", "CP12", "终点"];
  const CP_OF = { "起点": 0, CP1: 1, CP2: 2, CP3: 3, "折返台 1": 4, CP5: 5, CP6: 6, CP7: 7, "折返台 2": 8, CP9: 9, CP10: 10, CP11: 11, "中转台": 12, "终点": 13 };
  const FINISH = 13;
  /* Respawn pose per checkpoint: x, y, heading. */
  const POSES = [[LA, -6, 90], [LA, 21.1, 90], [LA, 45.0, 90], [LA, 61.5, 90], [LB, 89.3, -90], [LB, 67.0, -90], [LB, 40.0, -90],
    [LB, 23.0, -90], [LC, 6.6, 90], [LC, 26.5, 90], [LC, 40.2, 90], [LC, 52.1, 90], [LC, 76.4, 90]];
  const secOf = (cp) => Math.min(12, cp + 1);

  const SECS = L0.SECTIONS;
  const STARS = [1, 3, 3, 3, 4, 3, 4, 3, 2, 4, 3, 5];
  /* intro is what an agent is told (no mechanics); hint is the design note, shown to people on the task card only. */
  const TASKS = [{ id: "full", title: "全程闯关", time: "10:00", stars: 5, startCp: 0, goalCp: FINISH, maxSteps: 600, limit: 12 * 300, isNew: true,
    startName: "起点", goalName: "终点", intro: "从起点出发，闯过 12 关到达终点。掉水回到上一个检查点，3 秒后重新出发，时间照算。",
    hint: "12 关一口气跑完，每关的门口有关卡牌。" }]
    .concat(SECS.map((s, i) => {
      const goal = CP_NAMES[i === 11 ? FINISH : i + 1];
      return { id: "s" + s.no, title: `第 ${s.no} 关 · ${s.name}`, time: "10:00", stars: STARS[i], startCp: i, goalCp: i === 11 ? FINISH : i + 1,
        maxSteps: 80, limit: 300, startName: CP_NAMES[i], goalName: goal, hint: s.brief,
        intro: `从 ${CP_NAMES[i]} 出发，过了前面这一关，到达 ${goal}。掉水回到 ${CP_NAMES[i]}，3 秒后重新出发，时间照算。` };
    }));

  const T = window.SATasks.setup("course", "冲关模式", TASKS);
  const TASK = TASKS[T.index];
  /* Evaluation mode (?eval=1): every world is seeded-random, the page exposes only the env API, no answer labels. */
  const EVAL = new URLSearchParams(location.search).get("eval") === "1";
  const clockCell = $("clock");
  if (clockCell) clockCell.parentElement.style.display = "none";

  // ------------------------------------------------------------------------------------------------ world (seeded)
  const deckThick = (z) => (z > DECK + 0.5 ? z - DECK + 0.3 : 0.55);
  function makeWorld(seed, challenge) {
    const W = JSON.parse(JSON.stringify(L0));
    const R = window.SATasks.rng((seed * 7919 + 13) >>> 0);
    const pick = (a, b) => a + (b - a) * R();
    W.MEM_PHASE = 0;
    if (challenge) {
      W.HAMMERS.forEach((h) => { h.T = round(h.T * pick(0.92, 1.18), 100); h.phase = R(); });
      W.SPINNERS.forEach((s) => { s.omega *= pick(0.85, 1.15) * (R() < 0.5 ? -1 : 1); s.phase = R(); });
      W.RAFTS.forEach((r) => { r.T = round(pick(4.4, 6.4), 100); r.phase = R(); });
      // No order where each group is the neighbour of the last (0-1-2-3, 3-2-1-0): the gap would travel along the wall
      // like a wave at about running speed, and a straight run would ride it through.
      const order = [0, 1, 2, 3], wave = (o) => [1, 3].some((d) => o.every((g, i) => (o[(i + 1) % 4] - g + 4) % 4 === d));
      do { for (let i = 3; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } } while (wave(order));
      W.PUNCH.order = order;
      W.PUNCH.beat = round(pick(0.6, 0.8), 100);
      W.FAKE = W.FAKE.map(() => (R() < 0.5 ? 0 : 1));
      let c = Math.floor(R() * 3);
      W.MEM_PATH = W.MEM_PATH.map((_, i) => { if (i) c = clamp(c + Math.floor(R() * 3) - 1, 0, 2); return c; });
      W.MEM_PHASE = round(R() * W.MEM_CYCLE, 10);
      W.LAST_FROM_CENTER = R() < 0.5 ? 3.0 : 4.0;
      // At least two fans on: one gust alone can be crossed blind by running or hopping straight ahead.
      const off = Math.floor(R() * 4);
      W.WIND.fans.forEach((f, i) => (f[2] = i !== off));
      W.LOG.carry *= R() < 0.5 ? -1 : 1;
      const ph = R();
      W.SWING.ropes[0][3] = ph;
      W.SWING.ropes[1][3] = (ph + 0.5 + (R() - 0.5) * 0.16) % 1;
      // Geometry and dynamics as well, so no action sequence carries over from one seed to another.
      const room = W.DECKS.find((d) => d[0] === "CP1")[3] - W.WARMUP_GAPS.length * 2 * W.WARMUP_R;
      let gaps, rest;
      do { gaps = W.WARMUP_GAPS.map(() => round(pick(1.0, 2.6), 100)); rest = room - gaps.reduce((a, b) => a + b, 0); } while (rest < 0.9 || rest > 2.6);
      let edge = 0;
      W.WARMUP = gaps.map((g) => { const p = { x: LA, y: edge + g + W.WARMUP_R, r: W.WARMUP_R, gap: g }; edge += g + 2 * W.WARMUP_R; return p; });
      W.WARMUP_GAPS = gaps;
      W.HAMMERS.forEach((h) => (h.y = round(h.y + pick(-0.3, 0.3), 100)));
      W.BELT.speed = round(pick(2.2, 2.8), 100);
      W.LOG.carry = Math.sign(W.LOG.carry) * round(pick(0.8, 1.2), 100);
      W.WIND.push = round(pick(0.75, 1.0), 100);
      W.RAFTS.forEach((r) => (r.amp = round(r.sec === 7 ? pick(1.4, 2.0) : pick(1.3, 1.9), 100)));
      const rt = round(pick(3.3, 3.9), 100);
      W.SWING.ropes.forEach((r) => (r[2] = rt));
      W.MEM_CYCLE = round(pick(10, 14), 10);
      W.MEM_LIT = round(pick(2.5, 3.5), 10);
    }
    const weights = W.LAST_FROM_CENTER <= JMAX ? W.BALL_WEIGHTS.map(() => 1) : W.BALL_WEIGHTS;
    const span = W.LAND_EDGE - W.LAST_FROM_CENTER - W.BALL_FIRST, sum = weights.reduce((a, b) => a + b, 0);
    let y = W.BALL_FIRST;
    W.BALLS = [{ x: LA, y }];
    weights.forEach((w) => { y += (span * w) / sum; W.BALLS.push({ x: LA, y }); });

    const S = (W.SUP = []);
    const add = (o) => { o.id = S.length; S.push(o); return o; };
    const rect = (x0, x1, y0, y1, z, th, extra) => add(Object.assign({ kind: "rect", x0: Math.min(x0, x1), x1: Math.max(x0, x1),
      y0: Math.min(y0, y1), y1: Math.max(y0, y1), z, th }, extra || {}));
    W.DECKS.forEach(([name, x0, x1, y0, y1, z, kind]) => rect(x0, x1, y0, y1, z, deckThick(z), { cp: CP_OF[name], finish: kind === "finish", deck: kind, name }));
    W.STEPS.forEach(([x0, x1, y0, y1, z]) => rect(x0, x1, y0, y1, z, z - DECK + 0.3, { step: true }));
    W.WARMUP.forEach((p) => add({ kind: "circle", cx: p.x, cy: p.y, r: p.r, z: DECK, th: 0.5, warm: true }));
    W.BEAMS.forEach((b) => rect(b.x - b.w / 2, b.x + b.w / 2, b.y0, b.y1, DECK, 0.5));
    W.SPINNERS.forEach((s) => add({ kind: "circle", cx: s.x, cy: s.y, r: s.r, z: DECK, th: 0.6 }));
    W.BALLS.forEach((b) => add({ kind: "ball", cx: b.x, cy: b.y, R: W.BALL_R, cz: W.BALL_Z, stick: W.BALL_STICK, th: 2 * W.BALL_R }));
    const rb = W.ROPE_BRIDGE;
    add({ kind: "bridge", x0: rb.x - rb.w / 2, x1: rb.x + rb.w / 2, y0: rb.y0, y1: rb.y1, z0: DECK - 0.05, sag: rb.sag, cap: rb.speed, th: 0.1 });
    const P = W.PUNCH;
    rect(P.x_ledge - P.ledge_w / 2, P.x_ledge + P.ledge_w / 2, P.y0, P.y1, DECK, 0.45);
    rect(W.BELT.x - W.BELT.w / 2, W.BELT.x + W.BELT.w / 2, W.BELT.y0, W.BELT.y1, DECK, 0.3, { vel: [0, W.BELT.speed] });
    const g = W.LOG;
    add({ kind: "log", cx: g.x, y0: Math.min(g.y0, g.y1), y1: Math.max(g.y0, g.y1), r: g.r, cz: g.z, stand: g.stand, vel: [g.carry, 0], th: 2 * g.r });
    W.RAFTS.forEach((r, i) => add({ kind: "raft", ri: i, cy: r.y, half: W.RAFT / 2, z: W.RAFT_Z, th: 0.5 }));
    W.FAKE_ROWS.forEach((y, i) => W.FAKE_COLS.forEach((x, j) =>
      rect(x - W.TILE / 2, x + W.TILE / 2, y - W.TILE / 2, y + W.TILE / 2, DECK, 0.12, { tile: [i, j], fragile: W.FAKE[i] === j })));
    rect(W.WIND.x - W.WIND.w / 2, W.WIND.x + W.WIND.w / 2, W.WIND.y0, W.WIND.y1, DECK, 0.4, { wind: true });
    W.MEM_ROWS.forEach((y, i) => W.MEM_COLS.forEach((x, j) =>
      rect(x - W.MEM_TILE / 2, x + W.MEM_TILE / 2, y - W.MEM_TILE / 2, y + W.MEM_TILE / 2, DECK, 0.14, { mem: [i, j], fragile: W.MEM_PATH[i] !== j })));
    S.forEach((s) => {
      if (s.kind === "circle") s.bb = [s.cx - s.r - 0.3, s.cx + s.r + 0.3, s.cy - s.r - 0.3, s.cy + s.r + 0.3];
      else if (s.kind === "ball") s.bb = [s.cx - 1.2, s.cx + 1.2, s.cy - 1.2, s.cy + 1.2];
      else if (s.kind === "log") s.bb = [s.cx - 1, s.cx + 1, s.y0 - 0.3, s.y1 + 0.3];
      else if (s.kind === "raft") { const r = W.RAFTS[s.ri]; s.bb = [r.x - r.amp - 2, r.x + r.amp + 2, s.cy - 1.5, s.cy + 1.5]; }
      else s.bb = [s.x0 - 0.3, s.x1 + 0.3, s.y0 - 0.3, s.y1 + 0.3];
    });
    return W;
  }

  // ------------------------------------------------------------------------------------------------ motion
  const TAU = Math.PI * 2;
  const hammerAngle = (W, h, t) => W.HAMMER_AMP * Math.sin(TAU * (t / h.T + h.phase));
  const hammerRate = (W, h, t) => W.HAMMER_AMP * (TAU / h.T) * Math.cos(TAU * (t / h.T + h.phase));
  const spinnerAngle = (s, t) => s.omega * t + TAU * s.phase;
  const raftX = (r, t) => r.x + r.amp * Math.sin(TAU * (t / r.T + r.phase));
  const raftVX = (r, t) => r.amp * (TAU / r.T) * Math.cos(TAU * (t / r.T + r.phase));
  const ropeAngle = (W, i, t) => { const r = W.SWING.ropes[i]; return W.SWING_AMP * Math.sin(TAU * (t / r[2] + r[3])); };
  const ropeRate = (W, i, t) => { const r = W.SWING.ropes[i]; return W.SWING_AMP * (TAU / r[2]) * Math.cos(TAU * (t / r[2] + r[3])); };
  function grip(W, i, t) {
    const r = W.SWING.ropes[i], a = ropeAngle(W, i, t), w = ropeRate(W, i, t), G = W.SWING_GRIP;
    return { x: r[0], y: r[1] + G * Math.sin(a), z: W.SWING.top_z - G * Math.cos(a), vy: G * w * Math.cos(a), vz: G * w * Math.sin(a) };
  }
  /* Group i % 4 fires on the beats where it is next in P.order and stays out for two beats. */
  function punchExt(W, i, t) {
    const P = W.PUNCH, k = Math.floor(t / P.beat), sm = (x) => x * x * (3 - 2 * x);
    for (const d of [0, 1]) {
      if (i % 4 !== P.order[(((k - d) % 4) + 4) % 4]) continue;
      const u = (t - (k - d) * P.beat) / (2 * P.beat);
      return P.reach * (u < 0.08 ? sm(u / 0.08) : u < 0.9 ? 1 : 1 - sm((u - 0.9) / 0.1));
    }
    return 0;
  }
  const memLit = (W, t) => (((t + W.MEM_PHASE) % W.MEM_CYCLE) + W.MEM_CYCLE) % W.MEM_CYCLE < W.MEM_LIT;

  // ------------------------------------------------------------------------------------------------ supports
  const gone = (S, s, t) => S.gone[s.id] !== undefined && S.gone[s.id] <= t;
  function contains(W, s, x, y, t, tol) {
    if (x < s.bb[0] || x > s.bb[1] || y < s.bb[2] || y > s.bb[3]) return false;
    switch (s.kind) {
      case "rect": case "bridge": return x >= s.x0 - tol && x <= s.x1 + tol && y >= s.y0 - tol && y <= s.y1 + tol;
      case "circle": { const dx = x - s.cx, dy = y - s.cy, r = s.r + tol; return dx * dx + dy * dy <= r * r; }
      case "ball": { const dx = x - s.cx, dy = y - s.cy; return dx * dx + dy * dy <= s.stick * s.stick; }
      case "log": return Math.abs(x - s.cx) <= s.stand + 0.03 && y >= s.y0 - tol && y <= s.y1 + tol;
      case "raft": { const cx = raftX(W.RAFTS[s.ri], t); return Math.abs(x - cx) <= s.half + tol && Math.abs(y - s.cy) <= s.half + tol; }
    }
    return false;
  }
  function topOf(s, x, y) {
    switch (s.kind) {
      case "ball": { const dx = x - s.cx, dy = y - s.cy; return s.cz + Math.sqrt(Math.max(0, s.R * s.R - dx * dx - dy * dy)); }
      case "log": { const dx = clamp(x - s.cx, -s.r, s.r); return s.cz + Math.sqrt(s.r * s.r - dx * dx); }
      case "bridge": { const u = clamp((y - s.y0) / (s.y1 - s.y0), 0, 1); return s.z0 - s.sag * 4 * u * (1 - u); }
    }
    return s.z;
  }
  function surfVel(W, s, x, y, t) {
    if (s.vel) return s.vel;
    if (s.kind === "raft") return [raftVX(W.RAFTS[s.ri], t), 0];
    if (s.wind) for (const f of W.WIND.fans) if (f[2] && Math.abs(y - f[1]) < W.WIND.reach) return [W.WIND.push, 0];
    return ZERO;
  }
  /* Highest support under (x, y) whose top is at most zMax. */
  function supportAt(W, S, x, y, zMax, tol) {
    let best = null, bt = -Infinity;
    for (const s of W.SUP) {
      if (gone(S, s, S.t) || !contains(W, s, x, y, S.t, s.kind === "ball" ? 0 : tol)) continue;
      const top = topOf(s, x, y);
      if (top <= zMax + 1e-6 && top > bt) { best = s; bt = top; }
    }
    return best ? { s: best, top: bt } : null;
  }
  function blockedAhead(W, S, x, y, z, height) {
    for (const s of W.SUP) {
      if (s.kind === "ball" || s.kind === "bridge" || gone(S, s, S.t) || !contains(W, s, x, y, S.t, 0)) continue;
      const top = topOf(s, x, y);
      if (top > z + STEP_UP && top - s.th < z + height) return true;
    }
    return false;
  }
  function solids(W, S, x, y) {
    if (S.z < DECK + 2.3) {
      for (const sp of W.SPINNERS) {
        const dx = x - sp.x, dy = y - sp.y, d = Math.hypot(dx, dy), r = 0.55 + PR;
        if (d < r && d > 1e-6) { x = sp.x + (dx / d) * r; y = sp.y + (dy / d) * r; }
      }
    }
    const P = W.PUNCH, face = P.x_wall + 0.25;
    if (y > Math.min(P.y0, P.y1) && y < Math.max(P.y0, P.y1) && S.x > P.x_wall && x - PR < face && S.z < P.wall_h) x = face + PR;
    return [x, y];
  }

  // ------------------------------------------------------------------------------------------------ state + tick
  function initState(W, task) {
    const [x, y, h] = POSES[task.startCp];
    return { t: 0, x, y, z: DECK, vx: 0, vy: 0, vz: 0, h, pitch: AI_PITCH, mode: "ground", duck: false, stun: false, cp: task.startCp,
      goal: task.goalCp, falls: 0, fallsBy: {}, gone: {}, rope: -1, ropeCool: 0, waterT: 0, npc: [1, -9], npcLog: [], offT: -9,
      done: false, success: false, timeout: false, gaveUp: false, walked: 0, sup: -1, limit: task.limit, ev: [], hit: "" };
  }
  const cloneState = (S) => JSON.parse(JSON.stringify(S));
  const ev = (S, e, x) => S.ev.push(x === undefined ? [e, S.t, S.cp] : [e, S.t, S.cp, x]);

  function tick(W, S, I) {
    S.t += DT;
    if (S.done) return;
    if (S.t >= S.limit) { S.done = true; S.timeout = true; ev(S, "timeout"); return; }
    if (S.ropeCool > 0) S.ropeCool -= DT;
    if (S.mode === "water") {
      S.waterT += DT;
      if (S.waterT >= RESPAWN) respawn(S);
      return;
    }
    if (I.turn) S.h = normDeg(S.h + I.turn);
    if (S.mode === "rope") ropeTick(W, S, I);
    else if (S.mode === "ground") groundTick(W, S, I);
    else airTick(W, S, I);
    if (S.mode !== "water" && !S.stun) hazards(W, S);
    if (S.mode === "ground") arrive(W, S);
    npcTick(W, S);
  }

  function groundTick(W, S, I) {
    const cur = supportAt(W, S, S.x, S.y, S.z + 0.05, TOL);
    if (!cur || cur.top < S.z - DROP) return fall(S, S.vx, S.vy);
    S.duck = !!I.duck;
    const hr = rad(S.h), fx = Math.cos(hr), fy = Math.sin(hr);
    let sp = S.duck ? CRAWL : I.run ? RUN : WALK;
    if (cur.s.cap) sp = Math.min(sp, cur.s.cap);
    let mf = I.f || 0, ms = I.s || 0;
    const mm = Math.hypot(mf, ms);
    if (mm > 1) { mf /= mm; ms /= mm; }
    const ix = (mf * fx - ms * fy) * sp, iy = (mf * fy + ms * fx) * sp;
    const sv = surfVel(W, cur.s, S.x, S.y, S.t);
    const vx = ix + sv[0], vy = iy + sv[1];
    let [nx, ny] = solids(W, S, S.x + vx * DT, S.y + vy * DT);
    if (blockedAhead(W, S, nx, ny, S.z, S.duck ? BODY.duck : BODY.height)) { nx = S.x; ny = S.y; }
    S.walked += Math.hypot(nx - S.x, ny - S.y);
    S.x = nx; S.y = ny; S.vx = vx; S.vy = vy;
    if (I.jump || (I.jd !== undefined && I.jd !== null)) {
      let hx = ix, hy = iy;
      if (I.jd !== undefined && I.jd !== null) { const v = clamp(+I.jd, 0, JMAX) / AIR; hx = fx * v; hy = fy * v; }
      S.vx = hx + sv[0]; S.vy = hy + sv[1]; S.vz = V0; S.mode = "air"; S.duck = false; S.offT = -9;
      ev(S, "jump");
      return;
    }
    const nxt = supportAt(W, S, nx, ny, S.z + STEP_UP, TOL);
    if (!nxt || nxt.top < S.z - DROP) return fall(S, vx, vy);
    if (nxt.s.fragile) { S.gone[nxt.s.id] = S.t; ev(S, "collapse", nxt.s.id); fall(S, vx, vy); S.offT = -9; return; }
    S.z = nxt.top; S.sup = nxt.s.id;
    if (I.grab) grab(W, S, W.SWING_REACH, false);
  }
  function fall(S, vx, vy) { S.mode = "air"; S.vx = vx; S.vy = vy; S.vz = 0; S.duck = false; S.offT = S.t; }
  const canCoyote = (S) => S.mode === "air" && !S.stun && S.vz <= 0 && S.t - S.offT <= COYOTE;

  function airTick(W, S, I) {
    const hr = rad(S.h), fx = Math.cos(hr), fy = Math.sin(hr), sp = I.run ? RUN : WALK;
    const tx = ((I.f || 0) * fx - (I.s || 0) * fy) * sp, ty = ((I.f || 0) * fy + (I.s || 0) * fx) * sp;
    if (I.jump && canCoyote(S)) {
      if (I.f || I.s) { S.vx = tx; S.vy = ty; }
      S.vz = V0; S.offT = -9;
      ev(S, "jump");
    } else if (I.human && !S.stun && (I.f || I.s)) {
      S.vx += clamp(tx - S.vx, -1, 1) * AIR_CONTROL * DT;
      S.vy += clamp(ty - S.vy, -1, 1) * AIR_CONTROL * DT;
    }
    S.vz -= GRAV * DT;
    let nx = S.x + S.vx * DT, ny = S.y + S.vy * DT;
    const nz = S.z + S.vz * DT;
    for (const s of W.SUP) {
      if (S.stun || s.kind === "ball" || s.kind === "bridge" || s.kind === "log" || gone(S, s, S.t)) continue;
      if (!contains(W, s, nx, ny, S.t, 0) || contains(W, s, S.x, S.y, S.t, 0)) continue;
      const top = topOf(s, nx, ny);
      if (nz < top - CLIMB && nz + BODY.height > top - s.th) { S.vx *= -0.2; S.vy *= -0.2; nx = S.x; ny = S.y; break; }
    }
    [nx, ny] = solids(W, S, nx, ny);
    let land = null, lt = -Infinity;
    for (const s of W.SUP) {
      if (S.stun) break;
      if (gone(S, s, S.t) || !contains(W, s, nx, ny, S.t, s.kind === "ball" ? 0 : LAND_TOL)) continue;
      const top = topOf(s, nx, ny);
      const crossed = top <= S.z + 1e-6 && top >= nz;
      const climb = !S.stun && S.vz < 2.0 && top > nz && top - nz <= CLIMB && s.kind !== "ball";
      if ((crossed || climb) && top > lt) { land = s; lt = top; }
    }
    S.x = nx; S.y = ny;
    if (land && land.fragile) { S.gone[land.id] = S.t; ev(S, "collapse", land.id); land = null; }
    if (land) {
      const impact = -S.vz;
      S.z = lt; S.mode = "ground"; S.vx = S.vy = S.vz = 0; S.sup = land.id;
      ev(S, "land", impact);
      return;
    }
    S.z = nz;
    if (!S.stun) grab(W, S, W.SWING_REACH * 0.8, true);
    if (S.mode === "air" && S.z <= 0) splash(S);
  }

  function grab(W, S, reach, air) {
    if (S.ropeCool > 0) return false;
    const hz = S.z + HANDS;
    for (let i = 0; i < W.SWING.ropes.length; i++) {
      if (i === S.rope) continue;
      const g = grip(W, i, S.t);
      if (Math.hypot(S.x - g.x, S.y - g.y, hz - g.z) < reach) {
        S.mode = "rope"; S.rope = i; S.vx = S.vy = S.vz = 0; S.duck = false;
        ev(S, "grab");
        return true;
      }
    }
    if (!air) ev(S, "miss");
    return false;
  }
  function ropeTick(W, S, I) {
    const g = grip(W, S.rope, S.t);
    S.x = g.x; S.y = g.y; S.z = g.z - W.SWING_HANG;
    if (I.release || I.jump || (I.jd !== undefined && I.jd !== null)) {
      S.mode = "air"; S.vx = 0; S.vy = g.vy; S.vz = g.vz; S.rope = -1; S.ropeCool = 0.5;
      ev(S, "release");
      return;
    }
    if (I.grab) {
      for (let j = 0; j < W.SWING.ropes.length; j++) {
        if (j === S.rope) continue;
        const o = grip(W, j, S.t);
        if (Math.hypot(o.x - g.x, o.y - g.y, o.z - g.z) < W.SWING_REACH * 1.6) { S.rope = j; ev(S, "switch"); return; }
      }
      ev(S, "miss");
    }
  }

  function hazards(W, S) {
    const z0 = S.z, z1 = S.z + (S.mode === "rope" ? W.SWING_HANG : S.duck ? BODY.duck : BODY.height);
    for (const hm of W.HAMMERS) {
      if (Math.abs(S.y - hm.y) > W.HAMMER_HEAD_L / 2 + PR) continue;
      const a = hammerAngle(W, hm, S.t), hx = hm.x + W.HAMMER_R * Math.sin(a), hz = W.HAMMER_PIVOT_Z - W.HAMMER_R * Math.cos(a);
      if (Math.hypot(S.x - hx, clamp(hz, z0, z1) - hz) < W.HAMMER_HEAD_R + PR) return knock(S, hammerRate(W, hm, S.t) >= 0 ? 1 : -1, 0, "hammer");
    }
    for (const sp of W.SPINNERS) {
      const dx = S.x - sp.x, dy = S.y - sp.y;
      if (dx * dx + dy * dy > (sp.r + 1.2) * (sp.r + 1.2)) continue;
      const a0 = spinnerAngle(sp, S.t);
      for (let k = 0; k < sp.arms.length; k++) {
        const za = sp.arms[k][0];
        if (z1 < za - 0.22 || z0 > za + 0.22) continue;
        const a = a0 + Math.PI * k, ux = Math.cos(a), uy = Math.sin(a);
        const along = dx * ux + dy * uy, perp = Math.abs(dx * uy - dy * ux);
        if (along > 0.4 && along < sp.r - 0.05 && perp < 0.24 + PR) { const sg = Math.sign(sp.omega); return knock(S, -uy * sg, ux * sg, "arm"); }
      }
    }
    const P = W.PUNCH, face = P.x_wall + 0.25;
    if (S.y > Math.min(P.y0, P.y1) - 1 && S.y < Math.max(P.y0, P.y1) + 1) {
      for (let i = 0; i < P.cols.length; i++) {
        const e = punchExt(W, i, S.t);
        if (e < 0.35 || Math.abs(S.y - P.cols[i]) > 0.4 + PR || S.x - PR > face + e + 0.38 || S.x + PR < face) continue;
        if (P.rows.some((rz) => z1 > rz - 0.4 && z0 < rz + 0.4)) return knock(S, 1, 0, "punch");
      }
    }
  }
  /* A hit always ends in the water: a stunned body does not land on anything. */
  function knock(S, px, py, what) {
    S.stun = true; S.mode = "air"; S.vx = px * 6; S.vy = py * 6; S.vz = 3.0; S.rope = -1; S.duck = false; S.hit = what;
    ev(S, "hit");
  }
  function splash(S) {
    S.mode = "water"; S.z = 0; S.waterT = 0; S.falls += 1; S.vx = S.vy = S.vz = 0; S.stun = false; S.rope = -1;
    const sec = secOf(S.cp);
    S.fallsBy[sec] = (S.fallsBy[sec] || 0) + 1;
    ev(S, "splash");
  }
  function respawn(S) {
    const [x, y, h] = POSES[S.cp];
    Object.assign(S, { x, y, z: DECK, h, vx: 0, vy: 0, vz: 0, mode: "ground", duck: false, stun: false, rope: -1 });
    ev(S, "respawn");
  }
  function arrive(W, S) {
    const s = W.SUP[S.sup];
    if (!s || s.cp === undefined) return;
    const cp = s.finish ? FINISH : s.cp;
    if (cp > S.cp) { S.cp = cp; ev(S, "cp"); }
    if (S.cp >= S.goal) { S.done = true; S.success = true; ev(S, "goal"); }
  }
  function playerRow(W, S) {
    if (Math.abs(S.x - LB) > 2.6) return null;
    const half = W.TILE / 2 + 0.1;
    if (S.y > W.FAKE_ROWS[0] + half && S.y < W.FAKE_ROWS[0] + half + 2.5) return -1;
    for (let i = 0; i < W.FAKE_ROWS.length; i++) if (Math.abs(S.y - W.FAKE_ROWS[i]) <= half) return i;
    return null;
  }
  function npcTick(W, S) {
    const [row, t0] = S.npc;
    if (row >= 6 || S.t - t0 < 0.8) return;
    const pr = playerRow(W, S);
    if (pr !== null && row <= pr + 1) { S.npc = [row + 1, S.t]; S.npcLog.push([S.t, row, row + 1]); }
  }

  // ------------------------------------------------------------------------------------------------ AI actions
  const ACTION_DOC = Object.fromEntries(L0.ACTIONS);
  const ticksOf = (sec) => Math.max(1, Math.round(sec / DT));
  function num(arg, fallback) {
    if (Array.isArray(arg)) arg = arg[0];
    if (arg === "left" || arg === "左") return fallback === undefined ? 90 : Math.abs(fallback);
    if (arg === "right" || arg === "右") return fallback === undefined ? -90 : -Math.abs(fallback);
    const v = parseFloat(arg);
    return Number.isFinite(v) ? v : NaN;
  }
  /* Run one action to completion (falls and respawns included). rec(S) is called after every tick. */
  function runAction(W, S, name, arg, rec) {
    const t0 = S.t, falls0 = S.falls;
    const step = (I) => { tick(W, S, I); if (rec) rec(S); };
    const hold = (n, I) => {
      for (let i = 0; i < n && !S.done; i++) {
        step(S.mode === "ground" || S.mode === "rope" ? I : {});
        if (S.falls > falls0 || S.stun) break;
      }
    };
    const out = { ok: true, desc: "" };
    if (S.done) return Object.assign(out, { ok: false, desc: "本局已经结束" });
    if (S.mode === "water") { while (S.mode === "water" && !S.done) step({}); }
    switch (name) {
      case "wait": { const s = num(arg); if (!(s > 0)) return bad("wait 要给秒数"); hold(ticksOf(clamp(s, 0.05, MAX_WAIT)), {}); out.desc = `原地等了 ${round(clamp(s, 0.05, MAX_WAIT), 100)} 秒`; break; }
      case "walk": case "run": case "back": {
        const m = num(arg);
        if (!(m > 0)) return bad(`${name} 要给米数`);
        const d = clamp(m, 0.01, name === "back" ? 10 : 60), sp = name === "run" ? RUN : WALK;
        if (S.mode === "rope") return bad("挂在绳子上，只能等、换绳或松手");
        hold(ticksOf(d / sp), name === "run" ? { f: 1, run: true } : { f: name === "back" ? -1 : 1 });
        out.desc = `${name === "run" ? "往前跑" : name === "walk" ? "往前走" : "往后退"}了 ${round(d, 100)} 米`;
        break;
      }
      case "sidestep": {
        const m = num(arg, 0.5);
        if (!Number.isFinite(m) || m === 0) return bad("sidestep 要给米数，正数向左");
        if (S.mode === "rope") return bad("挂在绳子上，只能等、换绳或松手");
        const d = clamp(Math.abs(m), 0.01, 4);
        hold(ticksOf(d / WALK), { s: Math.sign(m) });
        out.desc = `向${m > 0 ? "左" : "右"}平移了 ${round(d, 100)} 米`;
        break;
      }
      case "turn": {
        const a = num(arg);
        if (!Number.isFinite(a)) return bad("turn 要给角度，正数向左");
        const d = clamp(a, -180, 180);
        step({ turn: d });
        hold(ticksOf(0.1) - 1, {});
        out.desc = `向${d >= 0 ? "左" : "右"}转了 ${round(Math.abs(d), 10)}°`;
        break;
      }
      case "look": { const a = num(arg); if (!Number.isFinite(a)) return bad("look 要给角度"); S.pitch = clamp(a, -60, 30); out.desc = `视线调到 ${round(S.pitch, 10)}°`; break; }
      case "duck": { const s = num(arg); if (!(s > 0)) return bad("duck 要给秒数"); if (S.mode !== "ground") return bad("现在蹲不了"); hold(ticksOf(clamp(s, 0.05, 6)), { duck: true }); out.desc = `蹲了 ${round(clamp(s, 0.05, 6), 100)} 秒`; break; }
      case "jump": {
        const d = num(arg);
        if (!Number.isFinite(d) || d < 0) return bad("jump 要给 0–3.2 米");
        if (S.mode === "rope") { step({ release: true }); out.desc = "松开了绳子"; break; }
        if (S.mode !== "ground") return bad("现在跳不了");
        step({ jd: clamp(d, 0, JMAX) });
        out.desc = `向前跳了出去（${round(clamp(d, 0, JMAX), 100)} 米）`;
        break;
      }
      case "grab": step({ grab: true }); hold(ticksOf(0.1) - 1, {}); out.desc = S.mode === "rope" ? "伸手抓绳" : "伸手去抓绳子"; break;
      case "release": if (S.mode !== "rope") return bad("手上没有抓着绳子"); step({ release: true }); out.desc = "松开了绳子"; break;
      case "plan": {
        let list = arg;
        if (typeof list === "string") { try { list = JSON.parse(list); } catch (e) { list = null; } }
        if (!Array.isArray(list) || !list.length) return bad("plan 要给动作列表");
        const descs = [];
        for (const a of list.slice(0, 12)) {
          const [n, v] = Array.isArray(a) ? a : [a];
          if (n === "plan") continue;
          const r = runAction(W, S, n, v, rec);
          descs.push(r.desc);
          if (S.done || S.falls > falls0) break;
        }
        out.desc = descs.join("，");
        break;
      }
      case "give_up": S.done = true; S.gaveUp = true; out.desc = "放弃了本局"; break;
      default: return bad(`没有这个动作：${name}`);
    }
    while ((S.mode === "air" || S.mode === "water") && !S.done && S.t - t0 < 40) step({});
    out.dt = S.t - t0;
    return out;
    function bad(msg) { return { ok: false, desc: msg, dt: 0 }; }
  }

  function narrate(W, S, res, evs, vision) {
    const parts = [res.desc];
    for (const [e, , cp] of evs) {
      if (e === "collapse") parts.push("脚下的板子塌了");
      else if (e === "hit") parts.push("被撞飞了");
      else if (e === "splash") parts.push("掉进了水里");
      else if (e === "respawn") parts.push(vision ? "回到了上一个检查点" : `回到 ${CP_NAMES[cp]} 重新出发`);
      else if (e === "grab") parts.push("抓住了绳子");
      else if (e === "switch") parts.push("换到了另一根绳子");
      else if (e === "miss") parts.push("没抓到");
      else if (e === "cp" && !S.success) parts.push(vision ? "到达检查点" : `到达 ${CP_NAMES[cp]}`);
      else if (e === "goal") parts.push(S.goal === FINISH ? "冲过终点！" : `到达 ${CP_NAMES[S.goal]}，本关完成！`);
      else if (e === "timeout") parts.push("时间用完了");
    }
    const land = evs.some((e) => e[0] === "land") && !evs.some((e) => e[0] === "splash");
    if (land && /跳|松开/.test(res.desc)) parts.splice(1, 0, "落地了");
    let txt = parts.filter(Boolean).join("，") + "。";
    const sec = SECS[secOf(S.cp) - 1];
    txt += `（比赛用时 ${fmtT(S.t)}，落水 ${S.falls} 次${S.mode === "rope" ? "，正挂在绳子上" : ""}${vision ? "" : `；当前第 ${sec.no} 关 ${sec.name}`}）`;
    return txt;
  }

  // ------------------------------------------------------------------------------------------------ oracle
  function makeOracle(W) {
    const A = (n, v) => (v === undefined ? [n] : [n, round(v, 1000)]);
    const sim = (S, acts) => { const C = cloneState(S); for (const a of acts) runAction(W, C, a[0], a[1], null); return C; };
    const clean = (S0, S1) => S1.falls === S0.falls && !S1.timeout;
    const waits = (w) => { const out = []; while (w > 1e-9) { const d = Math.min(w, MAX_WAIT); out.push(A("wait", d)); w = round(w - d, 100); } return out; };
    const face = (S, h, always) => { const d = angDiff(h, S.h); return always || Math.abs(d) > 0.01 ? [A("turn", d)] : []; };
    function goTo(S, x, y, kind) {
      const d = Math.hypot(x - S.x, y - S.y);
      if (d < 0.01) return [];
      return face(S, headingOf(x - S.x, y - S.y)).concat([A(kind || "walk", d)]);
    }
    function until(S, kind, pred, maxT) {
      const C = cloneState(S), sp = kind === "run" ? RUN : WALK, I = kind === "run" ? { f: 1, run: true } : { f: 1 };
      let n = 0;
      while ((!pred(C) || C.mode === "air") && !C.done && n * DT < (maxT || 40)) {
        tick(W, C, I); n++;
        if (C.falls !== S.falls || C.stun) return null;
      }
      return n && C.mode === "ground" ? [A(kind, n * DT * sp)] : n ? null : [];
    }
    function seq(S, acts) { const C = sim(S, acts); return clean(S, C) ? { acts, S: C } : null; }
    let failed = null;
    function chain(S, steps) {
      let cur = S, all = [];
      for (let i = 0; i < steps.length; i++) {
        const r = steps[i](cur);
        if (!r) { failed = failed || { step: i, x: round(cur.x, 100), y: round(cur.y, 100), z: round(cur.z, 100), h: round(cur.h, 10), t: round(cur.t, 100) }; return null; }
        all = all.concat(r.acts); cur = r.S;
      }
      return { acts: all, S: cur };
    }
    const step = (fn) => (S) => { const a = fn(S); return a ? seq(S, a) : null; };
    function search(S, make, accept, wmax, dw) {
      let Sw = cloneState(S), w = 0;
      dw = dw || 0.05;
      while (w <= (wmax || 14) + 1e-9) {
        if (Sw.falls !== S.falls) return null;
        const acts = make(Sw);
        if (acts) {
          const C = sim(Sw, acts);
          if (clean(S, C) && (accept(C) || (C.done && C.success))) return { acts: waits(w).concat(acts), S: C };
        }
        runAction(W, Sw, "wait", dw, null);
        w = round(w + dw, 100);
      }
      return null;
    }
    /* Walk to a checkpoint's start pose; on the first turn deck go round the north side of the ball landing pad. */
    const at = (cp) => (S) => {
      const p = POSES[cp];
      let acts = [];
      if (cp === 4 && S.x < LA + 2 && S.y < 90.2) acts = goTo(S, S.x, 90.5);
      const S1 = sim(S, acts);
      acts = acts.concat(goTo(S1, p[0], p[1]));
      return seq(S, acts.concat(face(sim(S, acts), p[2])));
    };
    function edgeRoom(S) {
      const hr = rad(S.h), fx = Math.cos(hr), fy = Math.sin(hr);
      let s = 0;
      while (s < 6) {
        const n = supportAt(W, S, S.x + fx * (s + 0.05), S.y + fy * (s + 0.05), S.z + 0.05, TOL);
        if (!n || Math.abs(n.top - S.z) > 0.05) break;
        s += 0.05;
      }
      return s;
    }
    function jumpOnto(tx, ty, ok) {
      return (S) => {
        const pre = face(S, headingOf(tx - S.x, ty - S.y));
        let C = sim(S, pre);
        const D = Math.hypot(tx - C.x, ty - C.y), walk = clamp(D - 3.0, 0, Math.max(0, edgeRoom(C) - 0.03));
        if (walk > 0.005) { pre.push(A("walk", walk)); C = sim(S, pre); }
        const d0 = Math.min(Math.hypot(tx - C.x, ty - C.y), 3.15);
        for (const k of [0, -1, 1, -2, 2, -3, 3]) {
          const d = clamp(d0 + k * 0.1, 0.3, 3.15), R = sim(C, [A("jump", d)]);
          if (clean(S, R) && (ok(R) || (R.done && R.success))) return { acts: pre.concat([A("jump", d)]), S: R };
        }
        return null;
      };
    }
    /* Jump at the moment a moving (or fixed) target will be under the landing point; target(t) -> [x, y]. */
    function aim(target, zTop) {
      return (Sw) => {
        const cur = supportAt(W, Sw, Sw.x, Sw.y, Sw.z + 0.05, TOL);
        const sv0 = cur ? surfVel(W, cur.s, Sw.x, Sw.y, Sw.t) : ZERO;
        const px = Sw.x + sv0[0] * 0.1, py = Sw.y + sv0[1] * 0.1, tj = Sw.t + 0.1;
        const sv = cur ? surfVel(W, cur.s, px, py, tj) : ZERO;
        const h = zTop - Sw.z, disc = V0 * V0 - 2 * GRAV * h;
        if (disc < 0) return null;
        const tl = (V0 + Math.sqrt(disc)) / GRAV;
        const [tx, ty] = target(tj + tl);
        const ex = tx - px - sv[0] * tl, ey = ty - py - sv[1] * tl, d = (Math.hypot(ex, ey) / tl) * AIR;
        if (d > JMAX) return null;
        return face(Sw, headingOf(ex, ey), true).concat([A("jump", d)]);
      };
    }
    const onRaft = (i) => (C) => C.mode === "ground" && W.SUP[C.sup].kind === "raft" && W.SUP[C.sup].ri === i;
    const raftsOf = (sec) => W.RAFTS.map((r, i) => (r.sec === sec ? i : -1)).filter((i) => i >= 0);
    const raftTarget = (i, dy) => (t) => [raftX(W.RAFTS[i], t), W.RAFTS[i].y + dy];
    /* Land on raft i (near half), then walk to its far edge, ready for the next jump. dir = +1 heading north, -1 south. */
    function raftHop(i, dir) {
      return (S) => chain(S, [(s) => search(s, aim(raftTarget(i, -0.55 * dir), W.RAFT_Z), onRaft(i), 16),
        step((s) => face(s, dir > 0 ? 90 : -90)),
        step((s) => { const d = (W.RAFTS[i].y + 0.85 * dir - s.y) * dir; return d > 0.02 ? [A("walk", d)] : []; })]);
    }
    const runTo = (y) => (S) => search(S, (Sw) => [A("run", Math.abs(y - Sw.y))], (C) => C.mode === "ground" && Math.abs(C.y - y) < 0.15);
    function crossSpinner(sp, y0, y1, done) {
      return (S) => {
        let best = null;
        for (const side of [1.3, -1.3]) {
          const pre = goTo(S, sp.x + side, y0).concat([]);
          const S1 = sim(S, pre), pre2 = pre.concat(face(S1, 90));
          const S2 = sim(S, pre2);
          if (!clean(S, S2)) continue;
          const r = search(S2, () => [A("run", y1 - y0)], done, Math.abs(TAU / sp.omega) + 1);
          if (r && (!best || r.S.t < best.S.t)) best = { acts: pre2.concat(r.acts), S: r.S };
        }
        return best;
      };
    }

    const LEGS = [];
    LEGS[0] = (S) => chain(S, [step((s) => goTo(s, LA, -0.05))].concat(W.WARMUP.map((p, i) =>
      jumpOnto(p.x, p.y, (C) => C.mode === "ground" && W.SUP[C.sup].warm && Math.hypot(W.SUP[C.sup].cy - p.y, 0) < 0.01)),
    [jumpOnto(LA, 20.5, (C) => C.cp >= 1 && C.mode === "ground"), at(1)]));
    /* Safe stops on a beam: halfway between consecutive hammers. */
    const between = (sec) => { const ys = W.HAMMERS.filter((h) => h.sec === sec).map((h) => h.y).sort((a, b) => a - b); return ys.slice(1).map((y, i) => (y + ys[i]) / 2); };
    LEGS[1] = (S) => chain(S, [step((s) => goTo(s, LA, 22.85))].concat(between(2).map((y) => runTo(y)), [runTo(44.6), at(2)]));
    LEGS[2] = (S) => chain(S, [crossSpinner(W.SPINNERS[0], 46.95, 60.6, (C) => C.cp >= 3 && C.mode === "ground"), at(3)]);
    LEGS[3] = (S) => chain(S, [step((s) => goTo(s, W.ROPE_BRIDGE.x, 64.2)), step((s) => face(s, 90)),
      step((s) => until(s, "walk", (C) => C.y >= 90.5, 40)), at(4)]);
    LEGS[4] = (S) => chain(S, [step((s) => goTo(s, LB, 87.25))].concat(W.PUNCH.cols.slice(0, 7).map((cy) => runTo(cy - 1.05)), [runTo(67.4), at(5)]));
    LEGS[5] = (S) => {
      const carry = W.LOG.carry, h = headingOf(-carry, -Math.sqrt(RUN * RUN - carry * carry));
      return chain(S, [step((s) => until(s, "run", (C) => C.y <= 52.8, 30)), step((s) => face(s, h)),
        step((s) => until(s, "run", (C) => C.y <= 41.6, 20)), at(6)]);
    };
    LEGS[6] = (S) => chain(S, [step((s) => goTo(s, LB, 38.12)), step((s) => face(s, -90))].concat(
      raftsOf(7).map((i) => raftHop(i, -1)),
      [(s) => search(s, aim(() => [LB, 24.6], DECK), (C) => C.cp >= 7 && C.mode === "ground", 16), at(7)]));
    const supOf = (key, i, j) => W.SUP.find((s) => s[key] && s[key][0] === i && s[key][1] === j).id;
    const onSup = (id) => (C) => C.mode === "ground" && C.sup === id;
    LEGS[7] = (S) => {
      const steps = W.FAKE_ROWS.map((y, i) => {
        const j = 1 - W.FAKE[i], x = W.FAKE_COLS[j], id = supOf("tile", i, j);
        return (s) => (i > 0 && Math.abs(s.x - x) > 0.5 ? jumpOnto(x, y, onSup(id))(s) : step((q) => goTo(q, x, y))(s));
      });
      return chain(S, steps.concat([step((s) => goTo(s, s.x, 8.3)), at(8)]));
    };
    LEGS[8] = (S) => {
      const Wd = W.WIND, zones = [];
      Wd.fans.filter((f) => f[2]).map((f) => [Math.max(Wd.y0, f[1] - Wd.reach), Math.min(Wd.y1, f[1] + Wd.reach)]).sort((a, b) => a[0] - b[0])
        .forEach((z) => { const last = zones[zones.length - 1]; if (last && z[0] - last[1] < 0.6) last[1] = Math.max(last[1], z[1]); else zones.push(z.slice()); });
      const hComp = headingOf(-Wd.push, Math.sqrt(WALK * WALK - Wd.push * Wd.push));
      const steps = [];
      zones.forEach(([a, b]) => {
        steps.push(step((s) => until(s, "walk", (C) => C.y >= a - 0.02, 30)), step((s) => face(s, hComp)),
          step((s) => until(s, "walk", (C) => C.y >= b, 30)), step((s) => face(s, 90)));
      });
      steps.push(step((s) => until(s, "walk", (C) => C.cp >= 9 && C.y >= 26.3, 30)), at(9));
      return chain(S, steps);
    };
    LEGS[9] = (S) => chain(S, [step((s) => goTo(s, LC, 28.5)), step((s) => face(s, 90)),
      (s) => search(s, () => [A("grab")], (C) => C.mode === "rope" && C.rope === 0, 10),
      (s) => search(s, () => [A("grab")], (C) => C.mode === "rope" && C.rope === 1, 40),
      (s) => search(s, () => [A("release")], (C) => C.cp >= 10 && C.mode === "ground", 10), at(10)]);
    LEGS[10] = (S) => chain(S, [step((s) => goTo(s, LC, 41.9))].concat(
      W.MEM_ROWS.map((y, i) => jumpOnto(W.MEM_COLS[W.MEM_PATH[i]], y, onSup(supOf("mem", i, W.MEM_PATH[i])))),
      [jumpOnto(LC, 52.3, (C) => C.cp >= 11 && C.mode === "ground"), at(11)]));
    const finale = (S) => chain(S, [crossSpinner(W.SPINNERS[1], 77.45, 86.6, (C) => C.done && C.success)]);
    LEGS[11] = (S) => chain(S, [step((s) => goTo(s, LC, 53.85))].concat(between(12).map((y) => runTo(y)), [runTo(64.6)],
      raftsOf(12).map((i) => raftHop(i, 1)),
      [(s) => search(s, aim(() => [LC, 75.6], DECK), (C) => C.cp >= 12 && C.mode === "ground", 16), at(12), finale]));
    LEGS[12] = finale;

    return function plan(S0) {
      let S = cloneState(S0);
      S.ev = [];
      const out = [];
      if (S.mode !== "ground") return null;
      const p = POSES[S.cp];
      if (S.cp < LEGS.length && Math.hypot(S.x - p[0], S.y - p[1]) > 0.05) {
        const r = at(S.cp)(S);
        if (!r) return null;
        out.push(...r.acts); S = r.S;
      }
      while (!S.done) {
        const leg = LEGS[S.cp];
        failed = null;
        const r = leg && leg(S);
        if (!r) return { acts: out, S, stuck: S.cp, failed };
        out.push(...r.acts); S = r.S;
      }
      return { acts: out, S };
    };
  }

  // ------------------------------------------------------------------------------------------------ episode
  let W = makeWorld(T.seed, T.challenge || EVAL);
  let ORACLE = makeOracle(W);
  /* The oracle's run of a task in this world: its steps and time set the step budget and the score. */
  function oracleOf(task) {
    const S0 = initState(W, task), r = ORACLE(S0);
    if (!r || !r.S.done || !r.S.success) return null;
    const C = cloneState(S0);
    let steps = 0;
    for (const a of r.acts) { runAction(W, C, a[0], a[1], null); steps++; if (C.done) break; }
    return C.success ? { steps, t: round(C.t, 100) } : null;
  }
  /* Every section is scored on its own: own oracle reference, own step budget, own time limit. */
  const TASK_SECS = TASK.startCp === 0 && TASK.goalCp === FINISH ? SECS.map((s) => s.no) : [secOf(TASK.startCp)];
  const REF = oracleOf(TASK);
  const SEC_REF = {};
  TASK_SECS.forEach((k) => (SEC_REF[k] = TASK_SECS.length === 1 ? REF : oracleOf(TASKS[k])));
  const budgetOf = (k) => (SEC_REF[k] ? SEC_REF[k].steps * BUDGET[0] + BUDGET[1] : 80);
  TASK.maxSteps = TASK_SECS.reduce((n, k) => n + budgetOf(k), 0);
  let S = initState(W, TASK);
  const EP = { steps: 0, text: "", mode: "free", replay: null, hist: [], banner: -1, finished: false, oraclePlan: null,
    count: null, countShown: 0, splitT: 0, osplits: null, secs: [] };
  const eyeOf = (St) => (St.mode === "water" ? 0.22 : St.mode === "rope" ? St.z + 1.55 : St.z + (St.duck ? EYE_DUCK : EYE));
  const poseOf = (St) => ({ t: St.t, x: St.x, y: St.y, e: eyeOf(St), h: St.h, p: St.pitch, m: St.mode, k: St.stun ? 1 : 0, u: St.sup });
  function record(St, actHist) {
    const p = poseOf(St);
    EP.hist.push(p);
    if (EP.hist.length > 360) EP.hist.splice(0, EP.hist.length - 300);
    if (actHist) actHist.push(p);
  }
  function resetEpisode() {
    S = initState(W, TASK);
    if (EP.mode === "free") S.pitch = -6;
    Object.assign(EP, { steps: 0, replay: null, hist: [poseOf(S)], banner: -1, finished: false, oraclePlan: null,
      count: EP.mode === "free" ? 3 : null, countShown: 4, splitT: 0,
      secs: TASK_SECS.map((k) => ({ sec: k, budget: budgetOf(k), ref: null, steps: 0, t0: null, t1: null, passed: null })) });
    openSection(EP.secs[0], S);
    PRES.pending = [];
    FX.camera.reset();
    $("fade").style.opacity = 0;
    $("result").style.display = "none";
    say(TASK.intro);
    hud();
  }
  function say(t) { EP.text = t; $("msg").textContent = t; }
  const oracleRun = () => (REF ? REF.t : null);

  const curSection = () => EP.secs.find((e) => e.passed === null && e.t0 !== null);
  /* Oracle for one section from an exact state (same place, same moment of the obstacle cycles). */
  function sectionOracle(St, sec) {
    const C0 = cloneState(St);
    Object.assign(C0, { goal: sec === 12 ? FINISH : sec, done: false, success: false, ev: [] });
    const r = ORACLE(C0);
    if (!r || !r.S.done || !r.S.success) return null;
    const C = cloneState(C0);
    let steps = 0;
    for (const a of r.acts) { runAction(W, C, a[0], a[1], null); steps++; if (C.done) break; }
    return C.success ? { steps, t: round(C.t - St.t, 100) } : null;
  }
  /* A section's clock, oracle reference and step budget all start from the state it is entered in. */
  function openSection(e, St) {
    e.t0 = St.t;
    const canonical = St.t === 0 && St.cp === TASK.startCp;
    e.ref = canonical || EP.mode !== "ai" ? SEC_REF[e.sec] : sectionOracle(St, e.sec);
    e.budget = e.ref ? e.ref.steps * BUDGET[0] + BUDGET[1] : 80;
  }
  /* Close the section a checkpoint ends (CP12 is the halfway deck inside section 12) and open the next one.
     snaps[cp] is the state at the tick the checkpoint was reached, when the caller has it. */
  function sectionEvents(evs, snaps) {
    for (const [e, t, cp] of evs) {
      if (e !== "cp" || cp === 12) continue;
      const i = EP.secs.findIndex((x) => x.sec === (cp === FINISH ? 12 : cp));
      if (i < 0 || EP.secs[i].passed !== null) continue;
      EP.secs[i].passed = true; EP.secs[i].t1 = t;
      if (EP.secs[i + 1]) openSection(EP.secs[i + 1], (snaps && snaps[cp]) || S);
    }
  }
  /* A section out of steps or time fails; the run goes on from the start of the next section. */
  function checkSection() {
    const e = curSection();
    if (!e || S.done) return "";
    const over = e.steps >= e.budget ? "步数" : S.t - e.t0 >= SECTION_LIMIT ? "时间" : null;
    if (!over) return "";
    e.passed = false; e.t1 = S.t;
    const next = EP.secs[EP.secs.indexOf(e) + 1];
    if (!next) { S.done = true; return `这一关${over}用完，判失败，本局结束。`; }
    const cp = next.sec - 1, [x, y, h] = POSES[cp];
    Object.assign(S, { x, y, z: DECK, h, vx: 0, vy: 0, vz: 0, mode: "ground", duck: false, stun: false, rope: -1, waterT: 0, cp });
    openSection(next, S);
    EP.hist = [poseOf(S)];
    EP.splitT = S.t;
    return T.vision ? `这一关${over}用完，判失败，跳到下一关的起点继续。`
      : `第 ${e.sec} 关${over}用完，判失败，跳到第 ${next.sec} 关的起点 ${CP_NAMES[cp]} 继续。`;
  }
  function sectionInfo() {
    return EP.secs.map((e) => {
      const ref = e.ref || SEC_REF[e.sec], time = e.t0 === null ? null : round((e.t1 === null ? S.t : e.t1) - e.t0, 100);
      return { section: e.sec, name: SECS[e.sec - 1].name, passed: e.passed, steps: e.steps, budget: e.budget, time_s: time,
        falls: S.fallsBy[e.sec] || 0, oracle_steps: ref ? ref.steps : null, oracle_s: ref ? ref.t : null,
        score: e.passed && ref ? round(Math.min(1, ref.t / Math.max(time, ref.t)), 1000) : 0 };
    });
  }
  const meanScore = (secs) => round(secs.reduce((a, s) => a + s.score, 0) / secs.length, 1000);

  function act(name, arg, headless) {
    if (EP.mode !== "ai" || S.done || EP.replay) return;
    EP.steps += 1;
    const sec = curSection();
    if (sec) sec.steps += 1;
    if (name === "plan") {
      /* Every action inside a plan costs a step; the plan is cut to what is left of the section's budget. */
      let list = arg;
      if (typeof list === "string") { try { list = JSON.parse(list); } catch (e) { list = null; } }
      if (Array.isArray(list)) {
        const left = sec ? sec.budget - sec.steps + 1 : TASK.maxSteps - EP.steps + 1;
        arg = list.slice(0, Math.max(1, Math.min(12, left)));
        EP.steps += arg.length - 1;
        if (sec) sec.steps += arg.length - 1;
      }
    }
    S.ev = [];
    const acts = headless ? null : [], snaps = {};
    let lastCp = S.cp;
    const res = runAction(W, S, name, arg, (St) => {
      record(St, acts);
      if (St.cp !== lastCp) { lastCp = St.cp; snaps[St.cp] = cloneState(St); }
    });
    const evs = S.ev.slice();
    let text = narrate(W, S, res, evs, T.vision);
    sectionEvents(evs, snaps);
    text += checkSection();
    EP.text = text;
    if (!headless && acts.length > 1) { EP.replay = { hist: acts, i: 0, ei: 0, t: acts[0].t, text, evs }; say("……"); }
    else { say(text); afterEvents(evs); }
    if (S.done && (headless || !EP.replay)) finish();
  }

  function afterEvents(evs) {
    hud();
    for (const [e] of evs) if (e === "splash" && EP.mode === "free") say(`掉水了！3 秒后回到 ${CP_NAMES[S.cp]}。`);
  }

  /* score = mean over the task's sections of (oracle section time / your section time), 0 for a failed section. */
  function info() {
    const secs = sectionInfo(), passed = secs.filter((s) => s.passed).length;
    const d = { success: S.success && passed === secs.length, done: S.done, steps: EP.steps, max_steps: secs.reduce((n, s) => n + s.budget, 0), clock: round(S.t, 100),
      clock_str: fmtT(S.t), walked_m: Math.round(S.walked), falls: S.falls, falls_by_section: Object.assign({}, S.fallsBy), checkpoint: S.cp,
      checkpoint_name: CP_NAMES[S.cp], section: secOf(S.cp), mode: S.mode, x: round(S.x, 100), y: round(S.y, 100), z: round(S.z, 100),
      heading: round(S.h, 10), timeout: S.timeout, gave_up: S.gaveUp, sections: secs, sections_passed: passed };
    if (S.done) { d.oracle_s = oracleRun(); d.score = meanScore(secs); }
    return d;
  }

  const MEDALS = [[0.7, "金", "#ffd54f"], [0.5, "银", "#cfd8dc"], [0.3, "铜", "#d7a06b"]];
  function sectionTable(secs, ai) {
    const cell = (s) => (s.passed ? "✓" : s.passed === false ? "✗" : "—");
    return `<table class="secs"><tr><th>关</th><th></th>${ai ? "<th>步数</th>" : ""}<th>用时</th><th>落水</th><th>得分</th></tr>` +
      secs.map((s) => `<tr><td>${s.section} ${s.name}</td><td>${cell(s)}</td>${ai ? `<td>${s.steps}/${s.budget}</td>` : ""}` +
        `<td>${s.time_s === null ? "—" : s.time_s.toFixed(1)}</td><td>${s.falls}</td><td>${Math.round(s.score * 100)}</td></tr>`).join("") + "</table>";
  }
  function finish() {
    if (EP.finished) return;
    EP.finished = true;
    hud();
    const ai = EP.mode === "ai", o = oracleRun(), secs = sectionInfo(), passed = secs.filter((s) => s.passed).length;
    const success = S.success && passed === secs.length, ratio = meanScore(secs);
    const rows = [["模式", ai ? `AI 动作模式 · ${T.vision ? "纯视觉" : "图文"}` : "自己玩"], ["比赛用时", fmtT(S.t)], ["落水", `${S.falls} 次`]];
    if (ai) rows.push(["动作步数", `${EP.steps} / 上限 ${EP.secs.reduce((n, e) => n + e.budget, 0)}${REF ? `（程序解 ${REF.steps} 步）` : ""}`]);
    if (o) rows.push(["参考用时", `${fmtT(o)}（程序解）`]);
    if (secs.length > 1) rows.push(["分关", `通过 ${passed} / ${secs.length} 关${sectionTable(secs, ai)}`]);
    const medal = success ? MEDALS.find((m) => ratio >= m[0]) : null;
    if (ratio > 0) rows.push(["得分", `${(ratio * 100).toFixed(0)}${secs.length > 1 ? "（各关平均）" : ""}${medal ? ` · ${medal[1]}牌` : ""}${success && S.falls === 0 ? " · 零落水" : ""}`]);
    if (T.challenge) rows.push(["本局", `第 ${T.seed} 局${W.LAST_FROM_CENTER <= JMAX ? "（大红球能跳过去）" : "（大红球最后一跳够不着）"}`]);
    let title = success ? (TASK.goalCp === FINISH ? "冲过终点 ✓" : `${TASK.title} 完成 ✓`) : S.success ? `到达终点（${secs.length - passed} 关判负）`
      : S.timeout ? "时间到" : S.gaveUp ? "已放弃" : "未完成";
    if (medal) title = `<span class="medal" style="background:${medal[2]}">${medal[1]}</span>${title}`;
    $("result").innerHTML = T.resultHTML(title, rows, success, S.t, S.walked);
    $("result").classList.toggle("wide", secs.length > 1);
    $("result").style.display = "block";
    T.bindResult(resetEpisode, () => { if (!state.god) toggleGod(); });
  }

  // ------------------------------------------------------------------------------------------------ rendering
  const canvas = $("view");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.05, 1600);
  camera.rotation.order = "YXZ";
  const SKY = { top: 0x1f63c4, horizon: 0xc4dcee, below: 0x8fb39a };
  scene.fog = new THREE.Fog(SKY.horizon, 180, 950);
  const SUN = new THREE.Vector3(0.55, 0.72, 0.42).normalize();
  const FONT = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
  const P3 = (x, y, z) => new THREE.Vector3(x, z, -y);
  const rnd = window.SATasks.rng(20261023);

  function skyMesh(radius) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      uniforms: { top: { value: new THREE.Color(SKY.top) }, horizon: { value: new THREE.Color(SKY.horizon) },
        below: { value: new THREE.Color(SKY.below) }, sunDir: { value: SUN }, time: { value: 0 } },
      vertexShader: "varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: [
        "uniform vec3 top; uniform vec3 horizon; uniform vec3 below; uniform vec3 sunDir; uniform float time; varying vec3 vDir;",
        "float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
        "float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);",
        "  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }",
        "float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int k = 0; k < 5; k++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; } return v; }",
        "void main(){ vec3 d = normalize(vDir); float h = d.y;",
        "  vec3 col = h >= 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.6, h), 0.7)) : mix(horizon, below, smoothstep(0.0, -0.06, h));",
        "  float s = max(dot(d, sunDir), 0.0);",
        "  if (h > 0.0) {",
        "    vec2 uv = d.xz / (h + 0.15) * 1.4 + vec2(time * 0.012, time * 0.005);",
        "    float c = smoothstep(0.5, 0.78, fbm(uv)) * smoothstep(0.02, 0.22, h);",
        "    vec3 cloud = mix(vec3(0.78, 0.83, 0.9), vec3(1.02, 1.0, 0.97), smoothstep(0.45, 0.85, fbm(uv * 1.7 + 4.0)));",
        "    col = mix(col, cloud * (0.9 + 0.25 * pow(s, 4.0)), c * 0.85);",
        "  }",
        "  col += vec3(1.0, 0.94, 0.82) * (pow(s, 900.0) * 6.0 + pow(s, 10.0) * 0.16);",
        "  gl_FragColor = vec4(col, 1.0);",
        "  #include <tonemapping_fragment>",
        "  #include <colorspace_fragment>",
        "}"].join("\n"),
    }));
    m.renderOrder = -10;
    m.frustumCulled = false;
    return m;
  }
  const sky = skyMesh(1400);
  scene.add(sky);
  {
    const pm = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene();
    envScene.add(skyMesh(100));
    scene.environment = pm.fromScene(envScene, 0.04).texture;
  }
  scene.add(new THREE.HemisphereLight(0xdcecff, 0x7d9a6a, 0.55));
  const sun = new THREE.DirectionalLight(0xfff0da, 2.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 220 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  function aimSun(x, y, h) {
    const tx = x + Math.cos(rad(h)) * 16, ty = y + Math.sin(rad(h)) * 16;
    sun.target.position.copy(P3(tx, ty, 0));
    sun.position.copy(sun.target.position).addScaledVector(SUN, 100);
    sun.target.updateMatrixWorld();
  }

  // ---- textures
  function canvasTex(w, h, draw, srgb) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    return t;
  }
  function speckle(g, w, h, n, alpha) {
    for (let i = 0; i < n; i++) {
      g.fillStyle = `rgba(${rnd() < 0.5 ? "0,0,0" : "255,255,255"},${alpha * rnd()})`;
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
    }
  }
  const tileTex = (base, alt, grout, n, px, gw) => canvasTex(px, px, (g, w) => {
    const s = w / n;
    g.fillStyle = grout; g.fillRect(0, 0, w, w);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.fillStyle = rnd() < 0.5 ? base : alt;
      g.fillRect(i * s + gw, j * s + gw, s - 2 * gw, s - 2 * gw);
    }
    speckle(g, w, w, w * 3, 0.06);
  });
  const TX = {
    foam: tileTex("#1f6fd6", "#1d69cc", "#173f7a", 1, 256, 3),
    foamRed: tileTex("#e2332b", "#d92e27", "#7a1712", 1, 256, 3),
    foamYellow: tileTex("#ffc21a", "#f7ba14", "#8a6200", 1, 256, 3),
    foamOrange: tileTex("#ff8a1f", "#f7821a", "#8a4200", 1, 256, 3),
    pool: tileTex("#5cc3e2", "#54bcdc", "#dff2f8", 8, 512, 2.5),
    deck: tileTex("#e9e6df", "#e1ddd5", "#bdb7ac", 4, 512, 2),
    grass: canvasTex(512, 512, (g, w) => {
      g.fillStyle = "#6aad4c"; g.fillRect(0, 0, w, w);
      for (let i = 0; i < 9000; i++) { g.fillStyle = `hsla(${95 + rnd() * 25},${40 + rnd() * 20}%,${30 + rnd() * 22}%,0.5)`; g.fillRect(rnd() * w, rnd() * w, 2, 2 + rnd() * 3); }
    }),
  };
  TX.pool.repeat.set(1 / 2, 1 / 2);
  TX.deck.repeat.set(1 / 2.4, 1 / 2.4);
  TX.grass.repeat.set(1 / 6, 1 / 6);
  const waterN = canvasTex(256, 256, (g, w) => {
    const img = g.createImageData(w, w), H = new Float32Array(w * w);
    const waves = [];
    for (let k = 0; k < 7; k++) waves.push([1 + Math.floor(rnd() * 4), Math.floor(rnd() * 5) - 2, rnd() * TAU, 0.4 + rnd()]);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      let v = 0;
      for (const [a, b, ph, amp] of waves) v += amp * Math.sin(TAU * ((a * x) / w + (b * y) / w) + ph);
      H[y * w + x] = v;
    }
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const dx = H[y * w + ((x + 1) % w)] - H[y * w + ((x + w - 1) % w)], dy = H[((y + 1) % w) * w + x] - H[((y + w - 1) % w) * w + x];
      const nx = -dx * 0.6, ny = -dy * 0.6, l = Math.hypot(nx, ny, 1), i = (y * w + x) * 4;
      img.data[i] = (nx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, false);
  const beltTex = canvasTex(256, 256, (g, w) => {
    g.fillStyle = "#25282e"; g.fillRect(0, 0, w, w);
    g.strokeStyle = "#ffc21a"; g.lineWidth = 34; g.lineCap = "butt";
    for (const oy of [-w, 0]) { g.beginPath(); g.moveTo(10, w * 0.75 + oy + w); g.lineTo(w / 2, w * 0.25 + oy + w); g.lineTo(w - 10, w * 0.75 + oy + w); g.stroke(); }
    speckle(g, w, w, 2000, 0.08);
  });
  const logTex = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = "#f2f2ee"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#e8302a";
    for (let k = -2; k < 6; k++) { g.beginPath(); g.moveTo(k * w / 3, 0); g.lineTo(k * w / 3 + w / 6, 0); g.lineTo(k * w / 3 + w / 6 + w / 3, h); g.lineTo(k * w / 3 + w / 3, h); g.fill(); }
  });
  const ringTex = canvasTex(1024, 1024, (g, w) => {
    g.fillStyle = "#e2332b"; g.fillRect(0, 0, w, w);
    g.strokeStyle = "#f4f1ea"; g.lineWidth = 16;
    for (let r = 1.5; r < 6.2; r += 1.5) { g.beginPath(); g.arc(w / 2, w / 2, (r / 12) * w, 0, TAU); g.stroke(); }
    speckle(g, w, w, 6000, 0.05);
  });
  const tileFaceTex = (fake) => perTile(canvasTex(512, 512, (g, w) => {
    g.fillStyle = fake ? "#cfd5db" : "#eef2f5"; g.fillRect(0, 0, w, w);
    speckle(g, w, w, 2500, 0.05);
    if (!fake) { g.fillStyle = "#30343a"; for (const [x, y] of [[40, 40], [w - 40, 40], [40, w - 40], [w - 40, w - 40]]) { g.beginPath(); g.arc(x, y, 11, 0, TAU); g.fill(); } }
    else {
      g.strokeStyle = "rgba(70,76,84,0.85)"; g.lineWidth = 2.2;
      const R = window.SATasks.rng(Math.floor(rnd() * 1e6));
      for (let k = 0; k < 5; k++) {
        let x = w * (0.3 + 0.4 * R()), y = w * (0.3 + 0.4 * R()), a = R() * TAU;
        g.beginPath(); g.moveTo(x, y);
        for (let s = 0; s < 14; s++) { a += (R() - 0.5) * 0.9; x += Math.cos(a) * 22; y += Math.sin(a) * 22; g.lineTo(x, y); }
        g.stroke();
      }
    }
  }));
  /* Tile tops have UVs in metres around the tile centre; stretch one texture over exactly one tile. */
  function perTile(t) { t.repeat.set(1 / L0.TILE, 1 / L0.TILE); t.offset.set(0.5, 0.5); return t; }
  /* Tileable caustic web: bright where a sum of integer-frequency waves crosses zero. */
  const causticTex = canvasTex(256, 256, (g, w) => {
    const img = g.createImageData(w, w), waves = [[3, 1, 0.3], [1, 4, 1.7], [-2, 3, 2.9], [4, -1, 0.8], [2, 5, 4.1]];
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      let v = 0;
      for (const [a, b, ph] of waves) v += Math.sin((TAU * (a * x + b * y)) / w + ph);
      const c = Math.pow(Math.max(0, 1 - Math.abs(v) * 0.55), 5), i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(c * 255); img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
  causticTex.repeat.set(1 / 3, 1 / 3);
  /* Inflatable vinyl: welded seams on a 0.5 m grid and a few soft wrinkles, as a normal map. */
  const vinylN = canvasTex(256, 256, (g, w) => {
    const img = g.createImageData(w, w), H = new Float32Array(w * w), R = window.SATasks.rng(99);
    const wr = Array.from({ length: 6 }, () => [R() * w, R() * w, 20 + R() * 40, R() * TAU]);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const e = Math.min(x, w - 1 - x, y, w - 1 - y);
      let v = e < 4 ? -1 + e / 4 : 0;
      for (const [cx, cy, r, a] of wr) { const d = Math.hypot(x - cx, y - cy); if (d < r) v += 0.25 * Math.sin(((x - cx) * Math.cos(a) + (y - cy) * Math.sin(a)) * 0.35) * (1 - d / r); }
      H[y * w + x] = v;
    }
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const dx = H[y * w + ((x + 1) % w)] - H[y * w + ((x + w - 1) % w)], dy = H[((y + 1) % w) * w + x] - H[((y + w - 1) % w) * w + x];
      const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
      img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, false);
  vinylN.repeat.set(2, 2);
  function textTex(lines, o) {
    o = Object.assign({ w: 512, h: 128, bg: null, fg: "#ffffff", size: 64, weight: 700, align: "center", pad: 24, badge: null }, o);
    return canvasTex(o.w, o.h, (g, w, h) => {
      if (o.bg) { g.fillStyle = o.bg; g.fillRect(0, 0, w, h); }
      let x = o.align === "center" ? w / 2 : o.pad;
      if (o.badge) {
        g.fillStyle = o.badge[1]; g.beginPath(); g.arc(o.pad + h * 0.36, h / 2, h * 0.34, 0, TAU); g.fill();
        g.fillStyle = o.badge[2]; g.font = `800 ${Math.round(h * 0.42)}px ${FONT}`; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(o.badge[0], o.pad + h * 0.36, h / 2 + 2);
        x = o.pad + h * 0.8;
      }
      g.fillStyle = o.fg; g.font = `${o.weight} ${o.size}px ${FONT}`; g.textAlign = o.align === "center" && !o.badge ? "center" : "left"; g.textBaseline = "middle";
      const list = Array.isArray(lines) ? lines : [lines];
      list.forEach((s, i) => g.fillText(s, x, h / 2 + (i - (list.length - 1) / 2) * o.size * 1.15 + 2));
    });
  }

  // ---- materials
  const COL = { red: 0xe8302a, yellow: 0xffc21a, blue: 0x1e6fd9, white: 0xf2f2ee, orange: 0xff7a1a, green: 0x2dbe60, navy: 0x1b2a4a, purple: 0x7b4dff, cyan: 0x18b8d8 };
  const M = {};
  Object.keys(COL).forEach((k) => (M[k] = new THREE.MeshPhysicalMaterial({ color: COL[k], roughness: 0.36, clearcoat: 0.6, clearcoatRoughness: 0.16,
    envMapIntensity: 0.9, normalMap: vinylN, normalScale: new THREE.Vector2(0.45, 0.45) })));
  const std = (o) => new THREE.MeshStandardMaterial(o);
  Object.assign(M, {
    foam: std({ map: TX.foam, roughness: 0.82 }), foamRed: std({ map: TX.foamRed, roughness: 0.82 }), foamYellow: std({ map: TX.foamYellow, roughness: 0.82 }),
    foamOrange: std({ map: TX.foamOrange, roughness: 0.82 }),
    steel: std({ color: 0xd9dde2, metalness: 0.8, roughness: 0.32 }), steelRed: std({ color: 0xc9302a, metalness: 0.35, roughness: 0.4 }),
    rope: std({ color: 0xc9a66b, roughness: 0.95 }), wood: std({ color: 0x9c6b3e, roughness: 0.8 }), rubber: std({ color: 0x2a2d33, roughness: 0.8 }),
    pool: std({ map: TX.pool, roughness: 0.3, emissive: 0xc8f4ff, emissiveMap: causticTex, emissiveIntensity: 1.0 }),
    deck: std({ map: TX.deck, roughness: 0.7 }), grass: std({ map: TX.grass, roughness: 0.95 }),
    concrete: std({ color: 0xc9c5bd, roughness: 0.85 }), laneLine: std({ color: 0x123d7a, roughness: 0.4 }), trunk: std({ color: 0x6b4a2f, roughness: 0.9 }),
    belt: std({ map: beltTex, roughness: 0.6 }), log: new THREE.MeshPhysicalMaterial({ map: logTex, roughness: 0.35, clearcoat: 0.4 }),
    ring: std({ map: ringTex, roughness: 0.7 }), tileReal: new THREE.MeshPhysicalMaterial({ map: tileFaceTex(false), roughness: 0.25, clearcoat: 0.5 }),
    memDark: new THREE.MeshPhysicalMaterial({ color: 0x1a2230, roughness: 0.12, clearcoat: 0.6 }),
    memLit: std({ color: 0x2fd8ff, emissive: 0x2fd8ff, emissiveIntensity: 1.6, roughness: 0.2 }),
    screen: std({ color: 0x0b0e14, roughness: 0.15 }),
  });
  const water = new THREE.MeshPhysicalMaterial({ color: 0x1b9fc0, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.6, depthWrite: false,
    normalMap: waterN, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.25 });
  water.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace("#include <opaque_fragment>",
      "float fr = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);\ndiffuseColor.a = mix(0.5, 0.96, fr);\n#include <opaque_fragment>");
  };

  // ---- geometry helpers
  /* Box with rounded edges and exact normals; w along x, h up, d along three z. UVs are in metres. */
  function RB(w, h, d, r, seg) {
    seg = seg || 3;
    const half = [w / 2, h / 2, d / 2];
    r = Math.max(0.002, Math.min(r, half[0] - 0.001, half[1] - 0.001, half[2] - 0.001));
    const inner = half.map((v) => v - r), n = 2 * seg + 1;
    const g = new THREE.BoxGeometry(1, 1, 1, n, n, n);
    const p = g.attributes.position, nr = g.attributes.normal, uv = g.attributes.uv, c = [0, 0, 0], q = [0, 0, 0];
    for (let i = 0; i < p.count; i++) {
      for (let k = 0; k < 3; k++) {
        const j = Math.round((p.getComponent(i, k) + 0.5) * n);
        c[k] = j <= seg ? -inner[k] - r + (r * j) / seg : inner[k] + (r * (j - seg - 1)) / seg;
        q[k] = clamp(c[k], -inner[k], inner[k]);
      }
      let dx = c[0] - q[0], dy = c[1] - q[1], dz = c[2] - q[2];
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len; dy /= len; dz /= len;
      const x = q[0] + dx * r, y = q[1] + dy * r, z = q[2] + dz * r;
      p.setXYZ(i, x, y, z); nr.setXYZ(i, dx, dy, dz);
      const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
      if (ay >= ax && ay >= az) uv.setXY(i, x, -z); else if (ax >= az) uv.setXY(i, -z * Math.sign(dx), y); else uv.setXY(i, x * Math.sign(dz), y);
    }
    return g;
  }
  function PC(r, h, rb, seg) {
    rb = Math.min(rb, r * 0.95, (h / 2) * 0.95);
    const pts = [new THREE.Vector2(0.0001, -h / 2)];
    for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + (Math.PI / 2) * (i / 6); pts.push(new THREE.Vector2(r - rb + rb * Math.cos(a), -h / 2 + rb + rb * Math.sin(a))); }
    for (let i = 0; i <= 6; i++) { const a = (Math.PI / 2) * (i / 6); pts.push(new THREE.Vector2(r - rb + rb * Math.cos(a), h / 2 - rb + rb * Math.sin(a))); }
    pts.push(new THREE.Vector2(0.0001, h / 2));
    return new THREE.LatheGeometry(pts, seg || 40);
  }
  function mesh(geo, mat, parent, shadow) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow !== false; m.receiveShadow = true;
    (parent || scene).add(m);
    return m;
  }
  /* Rounded slab by world extents; mats: one material, or [side, top]. */
  function slab(x0, x1, y0, y1, zTop, th, mats, r, parent) {
    const top = Array.isArray(mats) ? mats[1] : mats, side = Array.isArray(mats) ? mats[0] : mats;
    const m = mesh(RB(x1 - x0, th, y1 - y0, r === undefined ? 0.12 : r), [side, side, top, side, side, side], parent);
    m.position.copy(P3((x0 + x1) / 2, (y0 + y1) / 2, zTop - th / 2));
    return m;
  }
  const POSTS = [];
  const post = (x, y, zTop, r, mat, zBot) => POSTS.push([x, y, zTop, zBot === undefined ? -1.6 : zBot, r || 0.14, mat || "steel"]);
  function buildPosts() {
    const groups = {};
    POSTS.forEach((p) => (groups[p[5]] = groups[p[5]] || []).push(p));
    const geo = new THREE.CylinderGeometry(1, 1, 1, 14), mtx = new THREE.Matrix4(), q = new THREE.Quaternion();
    Object.keys(groups).forEach((k) => {
      const list = groups[k], im = new THREE.InstancedMesh(geo, M[k], list.length);
      list.forEach(([x, y, zt, zb, r], i) => im.setMatrixAt(i, mtx.compose(P3(x, y, (zt + zb) / 2), q, new THREE.Vector3(r, zt - zb, r))));
      im.castShadow = true; im.receiveShadow = true;
      scene.add(im);
    });
  }
  function tube(points, r, mat, parent, closed) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => P3(p[0], p[1], p[2])), !!closed);
    return mesh(new THREE.TubeGeometry(curve, Math.max(8, points.length * 3), r, 10, !!closed), mat, parent);
  }
  const sag = (p0, p1, depth, n) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n; return [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, p0[2] + (p1[2] - p0[2]) * t - depth * 4 * t * (1 - t)]; });
  /* Text card: facing 0 = readable by someone looking +y (north), 180 = looking -y, 90 = looking -x (card faces +x), "up" = lying flat. */
  function card(tex, wm, hm, x, y, z, facing, parent, lit) {
    const mat = lit ? new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false })
      : new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(wm, hm), mat);
    m.position.copy(P3(x, y, z));
    if (facing === "up") m.rotation.x = -Math.PI / 2; else m.rotation.y = rad(facing);
    (parent || scene).add(m);
    return m;
  }

  // ---- environment
  const [PX0, PX1, PY0, PY1] = L0.POOL;
  function buildEnvironment() {
    const MG = 9, X0 = PX0 - MG, X1 = PX1 + MG, Y0 = PY0 - MG, Y1 = PY1 + MG;
    const wGeo = new THREE.PlaneGeometry(PX1 - PX0, PY1 - PY0);
    wGeo.rotateX(-Math.PI / 2);
    const wm = new THREE.Mesh(wGeo, water);
    wm.position.copy(P3((PX0 + PX1) / 2, (PY0 + PY1) / 2, 0));
    wm.receiveShadow = true; wm.renderOrder = 2;
    scene.add(wm);
    waterN.repeat.set((PX1 - PX0) / 6, (PY1 - PY0) / 6);
    slab(PX0, PX1, PY0, PY1, -1.6, 0.2, M.pool, 0.001);
    for (const lx of L0.LANE_X) slab(lx - 0.2, lx + 0.2, PY0 + 2, PY1 - 2, -1.585, 0.01, M.laneLine, 0.001);
    for (const a of [[PX0 - 0.3, PX1 + 0.3, PY0 - 0.3, PY0], [PX0 - 0.3, PX1 + 0.3, PY1, PY1 + 0.3], [PX0 - 0.3, PX0, PY0, PY1], [PX1, PX1 + 0.3, PY0, PY1]])
      slab(a[0], a[1], a[2], a[3], 0.32, 2.0, M.pool, 0.001);
    for (const a of [[X0, X1, Y0, PY0 - 0.3], [X0, X1, PY1 + 0.3, Y1], [X0, PX0 - 0.3, PY0 - 0.3, PY1 + 0.3], [PX1 + 0.3, X1, PY0 - 0.3, PY1 + 0.3]])
      slab(a[0], a[1], a[2], a[3], 0.35, 0.8, M.deck, 0.001);
    for (const [a, b] of [[[PX0 - 0.15, PY0 - 0.15], [PX1 + 0.15, PY0 - 0.15]], [[PX0 - 0.15, PY1 + 0.15], [PX1 + 0.15, PY1 + 0.15]],
      [[PX0 - 0.15, PY0 - 0.15], [PX0 - 0.15, PY1 + 0.15]], [[PX1 + 0.15, PY0 - 0.15], [PX1 + 0.15, PY1 + 0.15]]]) tube([[a[0], a[1], 0.36], [b[0], b[1], 0.36]], 0.12, M.white);
    for (const a of [[-600, 600, -600, Y0], [-600, 600, Y1, 600], [-600, X0, Y0, Y1], [X1, 600, Y0, Y1]]) {
      const g = new THREE.PlaneGeometry(a[1] - a[0], a[3] - a[2]);
      g.rotateX(-Math.PI / 2);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (a[1] - a[0]), uv.getY(i) * (a[3] - a[2]));
      const m = mesh(g, M.grass, null, false);
      m.position.copy(P3((a[0] + a[1]) / 2, (a[2] + a[3]) / 2, 0.3));
    }
    const hillMat = [0x6fa37a, 0x86b191, 0x9dbfa8].map((c) => std({ color: c, roughness: 0.95 }));
    for (let i = 0; i < 16; i++) {
      const a = (TAU * i) / 16 + (rnd() - 0.5) * 0.2, d = 320 + rnd() * 120, r = 90 + rnd() * 70;
      const m = mesh(new THREE.SphereGeometry(r, 32, 16), hillMat[i % 3], null, false);
      m.position.copy(P3(24 + Math.cos(a) * d, 45 + Math.sin(a) * d, -r * 0.55));
      m.scale.set(1, 0.32 + rnd() * 0.18, 1);
    }
    const trees = [];
    while (trees.length < 150) {
      const x = X0 - 70 + rnd() * (X1 - X0 + 140), y = Y0 - 70 + rnd() * (Y1 - Y0 + 140);
      const outside = x < X0 - 3 || x > X1 + 3 || y < Y0 - 3 || y > Y1 + 3, stands = x > X1 && x < X1 + 20 && y > Y0 + 10 && y < Y1 - 10;
      if (outside && !stands) trees.push([x, y, 5 + rnd() * 4]);
    }
    const crownGeo = new THREE.IcosahedronGeometry(1, 2), trunkGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
    const crowns = [0x3e9b3a, 0x58b044, 0x2f7f3a].map((c) => new THREE.InstancedMesh(crownGeo, std({ color: c, roughness: 0.85, flatShading: true }), trees.length * 3));
    const trunks = new THREE.InstancedMesh(trunkGeo, M.trunk, trees.length);
    const counts = [0, 0, 0], mtx = new THREE.Matrix4(), q = new THREE.Quaternion();
    trees.forEach(([x, y, h], i) => {
      trunks.setMatrixAt(i, mtx.compose(P3(x, y, 0.3 + h * 0.27), q, new THREE.Vector3(0.22 * h / 7, h * 0.55, 0.22 * h / 7)));
      const n = 2 + (rnd() < 0.5 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const ci = Math.floor(rnd() * 3), r = h * (0.22 + rnd() * 0.1);
        crowns[ci].setMatrixAt(counts[ci]++, mtx.compose(P3(x + (rnd() - 0.5) * 1.6, y + (rnd() - 0.5) * 1.6, 0.3 + h * (0.62 + 0.14 * k)), q, new THREE.Vector3(r, r * (0.85 + rnd() * 0.25), r)));
      }
    });
    crowns.forEach((c, i) => { c.count = counts[i]; c.castShadow = true; scene.add(c); });
    trunks.castShadow = true;
    scene.add(trunks);
    buildStands(X1 + 2, Y0 + 14, Y1 - 14);
    buildScreen(LC, PY1 + 6.5);
    for (const by of [14, 50, 86]) bunting(X0 + 1, X1 - 1, by, 10.5);
    buoyLine(12, PY0 + 1, PY1 - 1, 0.5);
    buoyLine(36, PY0 + 1, PY1 - 1, 0.5);
  }
  function buildStands(x0, y0, y1) {
    const seatGeo = RB(0.5, 0.42, 0.48, 0.06, 2), seats = [];
    for (let k = 0; k < 9; k++) {
      const z = 0.35 + 0.7 * (k + 1);
      slab(x0 + 1.5 * k, x0 + 1.5 * (k + 1), y0, y1, z, z, M.concrete, 0.001);
      for (let y = y0 + 0.6; y < y1 - 0.6; y += 0.62) seats.push([x0 + 1.5 * k + 0.55, y + 0.24, z + 0.21, k % 3]);
    }
    for (const yy of [y0, y1]) slab(x0, x0 + 13.5, yy - 0.4, yy, 7.0, 6.7, M.concrete, 0.001);
    const im = new THREE.InstancedMesh(seatGeo, std({ roughness: 0.4 }), seats.length), mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    const cols = [new THREE.Color(0x2459c9), new THREE.Color(0xf2b705), new THREE.Color(0xd23a2e)];
    seats.forEach(([x, y, z, c], i) => { im.setMatrixAt(i, mtx.compose(P3(x, y, z), q, one)); im.setColorAt(i, cols[c]); });
    im.castShadow = true;
    scene.add(im);
    buildCrowd(seats);
  }
  /* Bean spectators on about two thirds of the seats; they bob, and jump when CROWD.cheer rises. */
  const CROWD = { time: { value: 0 }, cheer: { value: 0.15 } };
  function buildCrowd(seats) {
    const R = window.SATasks.rng(31), taken = seats.filter(() => R() < 0.66);
    const geo = new THREE.CapsuleGeometry(0.19, 0.3, 4, 10);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.55 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = CROWD.time; sh.uniforms.uCheer = CROWD.cheer;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime; uniform float uCheer;")
        .replace("#include <begin_vertex>", [
          "#include <begin_vertex>",
          "float ph = float(gl_InstanceID) * 1.731;",
          "transformed.y += uCheer * abs(sin(uTime * 7.0 + ph)) * 0.32 + 0.025 * sin(uTime * 1.7 + ph);"].join("\n"));
    };
    const headMat = mat.clone();
    headMat.onBeforeCompile = mat.onBeforeCompile;
    const im = new THREE.InstancedMesh(geo, mat, taken.length), head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.14, 12, 8), headMat, taken.length);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    const shirts = [0xe53935, 0xfdd835, 0x1e88e5, 0x43a047, 0xfb8c00, 0x8e24aa, 0xf5f5f5, 0x00acc1, 0xec407a].map((c) => new THREE.Color(c));
    const skins = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac].map((c) => new THREE.Color(c));
    taken.forEach(([x, y, z], i) => {
      im.setMatrixAt(i, mtx.compose(P3(x + 0.05, y, z + 0.6), q, one));
      im.setColorAt(i, shirts[Math.floor(R() * shirts.length)]);
      head.setMatrixAt(i, mtx.compose(P3(x + 0.05, y, z + 1.08), q, one));
      head.setColorAt(i, skins[Math.floor(R() * skins.length)]);
    });
    scene.add(im, head);
  }
  const SCREEN = {};
  function buildScreen(x, y) {
    for (const dx of [-6.2, 6.2]) post(x + dx, y, 11, 0.3, "steel", 0.3);
    slab(x - 7.3, x + 7.3, y - 0.2, y + 0.4, 11.2, 7.2, M.navy, 0.15);
    const c = document.createElement("canvas");
    c.width = 1024; c.height = 448;
    SCREEN.ctx = c.getContext("2d");
    SCREEN.tex = new THREE.CanvasTexture(c);
    SCREEN.tex.colorSpace = THREE.SRGBColorSpace;
    SCREEN.last = "";
    const m = new THREE.Mesh(new THREE.PlaneGeometry(13.6, 5.95), new THREE.MeshBasicMaterial({ map: SCREEN.tex, toneMapped: false }));
    m.position.copy(P3(x, y - 0.22, 7.6));
    scene.add(m);
  }
  function drawScreen(St) {
    const s = `${fmtT(St.t)}|${St.falls}|${St.cp}`;
    if (s === SCREEN.last) return;
    SCREEN.last = s;
    const g = SCREEN.ctx, w = 1024, h = 448;
    g.fillStyle = "#06090f"; g.fillRect(0, 0, w, h);
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = "#ffffff"; g.font = `700 64px ${FONT}`; g.fillText("Space Track · 冲关", w / 2, 70);
    g.fillStyle = "#ffd54a"; g.font = `700 190px ${FONT}`; g.fillText(fmtT(St.t), w / 2, 230);
    g.fillStyle = "#cfd8dc"; g.font = `600 52px ${FONT}`; g.fillText(`${CP_NAMES[St.cp]}  ·  落水 ${St.falls}`, w / 2, 375);
    SCREEN.tex.needsUpdate = true;
  }
  function bunting(x0, x1, y, z) {
    post(x0, y, z + 0.5, 0.12, "white", 0.3);
    post(x1, y, z + 0.5, 0.12, "white", 0.3);
    tube(sag([x0, y, z], [x1, y, z], 1.6, 40), 0.015, M.white);
    const pos = [], col = [], cs = [0xe8302a, 0xffc21a, 0x1e6fd9, 0x2dbe60, 0xff7a1a].map((c) => new THREE.Color(c));
    const n = Math.floor((x1 - x0) / 1.1);
    for (let i = 1; i < n; i++) {
      const t = i / n, px = x0 + (x1 - x0) * t, pz = z - 1.6 * 4 * t * (1 - t), c = cs[i % 5];
      [P3(px - 0.32, y, pz), P3(px + 0.32, y, pz), P3(px, y, pz - 0.6)].forEach((v) => { pos.push(v.x, v.y, v.z); col.push(c.r, c.g, c.b); });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    mesh(g, std({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.7 }), null, false);
  }
  function buoyLine(x, y0, y1, stepM) {
    const n = Math.floor((y1 - y0) / stepM) + 1, im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 10, 6), std({ roughness: 0.4 }), n);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1.6), cr = new THREE.Color(0xe8302a), cw = new THREE.Color(0xf2f2ee);
    for (let i = 0; i < n; i++) { im.setMatrixAt(i, mtx.compose(P3(x, y0 + i * stepM, 0.05), q, sc)); im.setColorAt(i, i % 2 ? cw : cr); }
    scene.add(im);
  }

  // ---- course
  const DYN = { hammers: [], spinners: [], rafts: [], punches: [], ropes: [], tiles: [], mem: [], ribbons: [], fans: [], log: null, npc: null };
  function buildCourse() {
    const tops = { start: M.foamRed, cp: M.foam, turn: M.foam, finish: M.foamYellow, step: M.foam };
    const sides = { start: M.white, cp: M.yellow, turn: M.yellow, finish: M.red, step: M.yellow };
    W.DECKS.forEach(([name, x0, x1, y0, y1, z, kind]) => {
      slab(x0, x1, y0, y1, z, deckThick(z), [sides[kind], tops[kind]], 0.14);
      for (const px of [x0 + 0.5, x1 - 0.5]) for (const py of [y0 + 0.5, y1 - 0.5]) post(px, py, z - 0.5);
      const cp = CP_OF[name];
      if (cp > 0 && cp < FINISH && kind !== "step") {
        const facingN = W.SECTIONS.find((s) => s.no === secOf(cp)).lane === 1;
        const sx = kind === "turn" ? (x0 + x1) / 2 : x1 - 0.35, sy = kind === "turn" ? (cp === 4 ? y1 - 0.4 : y0 + 0.4) : (y0 + y1) / 2;
        post(sx, sy, 2.95, 0.05, "white", z);
        const tex = textTex(CP_NAMES[cp], { w: 256, h: 160, bg: "#c62828", size: 84 });
        card(tex, 0.75, 0.47, sx, sy + (facingN ? 0.03 : -0.03), 2.95, facingN ? 180 : 0);
        card(tex, 0.75, 0.47, sx, sy + (facingN ? -0.03 : 0.03), 2.95, facingN ? 0 : 180);
      }
    });
    W.STEPS.forEach(([x0, x1, y0, y1, z]) => slab(x0, x1, y0, y1, z, z - DECK + 0.3, [M.yellow, M.foam], 0.05));
    arch(LA, -2.6, 3.6, 0.55, M.red, "起点  START");
    arch(LC, 89.0, 4.8, 0.65, M.yellow, "终点  FINISH");
    W.SECTIONS.forEach(sectionSign);
    // 1 warm-up
    W.WARMUP.forEach((p) => {
      const m = mesh(PC(p.r, 0.5, 0.12), M.red);
      m.position.copy(P3(p.x, p.y, DECK - 0.25));
      const top = mesh(new THREE.CircleGeometry(p.r - 0.1, 40), M.foamYellow, null, false);
      top.rotation.x = -Math.PI / 2; top.position.copy(P3(p.x, p.y, DECK + 0.003));
      post(p.x, p.y, DECK - 0.5, 0.25);
      if (!EVAL) card(textTex(`${p.gap.toFixed(1)} m`, { w: 256, h: 96, fg: "#1b2a4a", size: 64 }), 0.8, 0.3, p.x, p.y - p.r + 0.42, DECK + 0.006, "up");
    });
    buoyLine(LA + 2.2, 0.2, 19.0, 0.5);
    // 2 / 12 beams + hammers
    W.BEAMS.forEach((b) => { slab(b.x - b.w / 2, b.x + b.w / 2, b.y0, b.y1, DECK, 0.5, [M.white, M.foam], 0.12); for (let y = b.y0 + 1.5; y < b.y1; y += 3) post(b.x, y, DECK - 0.5, 0.12); });
    const rodGeo = new THREE.CylinderGeometry(0.06, 0.06, W.HAMMER_R - 0.8, 10), headGeo = PC(W.HAMMER_HEAD_R, W.HAMMER_HEAD_L, 0.3), bandGeo = new THREE.CylinderGeometry(W.HAMMER_HEAD_R + 0.02, W.HAMMER_HEAD_R + 0.02, 0.28, 32);
    W.HAMMERS.forEach((h) => {
      for (const dx of [-5.4, 5.4]) post(h.x + dx, h.y, W.HAMMER_PIVOT_Z + 0.35, 0.2, "steelRed");
      slab(h.x - 5.7, h.x + 5.7, h.y - 0.22, h.y + 0.22, W.HAMMER_PIVOT_Z + 0.52, 0.45, M.white, 0.08);
      const g = new THREE.Group();
      g.position.copy(P3(h.x, h.y, W.HAMMER_PIVOT_Z));
      scene.add(g);
      const rod = mesh(rodGeo, M.steel, g); rod.position.y = -(W.HAMMER_R - 0.8) / 2;
      const head = mesh(headGeo, M.red, g); head.position.y = -W.HAMMER_R; head.rotation.x = Math.PI / 2;
      for (const s of [-1, 1]) { const band = mesh(bandGeo, M.white, g); band.position.set(0, -W.HAMMER_R, s * (W.HAMMER_HEAD_L / 2 - 0.4)); band.rotation.x = Math.PI / 2; }
      DYN.hammers.push([g, h]);
    });
    // 3 / 12 sweepers
    W.SPINNERS.forEach((s) => {
      const deckM = mesh(new THREE.CylinderGeometry(s.r, s.r, 0.6, 64), [M.yellow, M.ring, M.yellow]);
      deckM.position.copy(P3(s.x, s.y, DECK - 0.3));
      post(s.x, s.y, DECK - 0.6, 1.2);
      const pil = mesh(PC(0.55, 2.2, 0.15), M.yellow); pil.position.copy(P3(s.x, s.y, DECK + 1.1));
      const cap = mesh(new THREE.SphereGeometry(0.62, 24, 12), M.red); cap.position.copy(P3(s.x, s.y, DECK + 2.25)); cap.scale.y = 0.6;
      const g = new THREE.Group();
      g.position.copy(P3(s.x, s.y, 0));
      scene.add(g);
      s.arms.forEach(([za, kind], k) => {
        const len = s.r - 0.35 - 0.5, a = Math.PI * k;
        const arm = mesh(PC(0.21, len, 0.1, 20), kind === "low" ? M.blue : M.orange, g);
        arm.rotation.z = Math.PI / 2; arm.rotation.y = a;
        arm.position.set(Math.cos(a) * (0.5 + len / 2), za, -Math.sin(a) * (0.5 + len / 2));
        const tip = mesh(new THREE.SphereGeometry(0.27, 16, 10), M.white, g);
        tip.position.set(Math.cos(a) * (0.5 + len), za, -Math.sin(a) * (0.5 + len));
      });
      DYN.spinners.push([g, s]);
    });
    // 4 balls + rope bridge
    W.BALLS.forEach((b) => { const m = mesh(new THREE.SphereGeometry(W.BALL_R, 48, 24), M.red); m.position.copy(P3(b.x, b.y, W.BALL_Z)); post(b.x, b.y, W.BALL_Z - W.BALL_R + 0.1, 0.14); });
    const rb = W.ROPE_BRIDGE, planks = [];
    for (let y = rb.y0; y <= rb.y1; y += 0.42) { const u = (y - rb.y0) / (rb.y1 - rb.y0); planks.push([rb.x, y, DECK - 0.08 - rb.sag * 4 * u * (1 - u)]); }
    const pim = new THREE.InstancedMesh(RB(rb.w, 0.06, 0.26, 0.015, 1), M.wood, planks.length), mtx = new THREE.Matrix4(), q0 = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    planks.forEach(([x, y, z], i) => pim.setMatrixAt(i, mtx.compose(P3(x, y, z), q0, one)));
    pim.castShadow = pim.receiveShadow = true;
    scene.add(pim);
    for (const dx of [-rb.w / 2 - 0.05, rb.w / 2 + 0.05]) {
      tube(sag([rb.x + dx, rb.y0, DECK + 0.95], [rb.x + dx, rb.y1, DECK + 0.95], rb.sag * 0.6, 24), 0.03, M.rope);
      tube(sag([rb.x + dx, rb.y0, DECK - 0.05], [rb.x + dx, rb.y1, DECK - 0.05], rb.sag, 24), 0.03, M.rope);
      for (const y of [rb.y0, rb.y1]) post(rb.x + dx, y, DECK + 1.15, 0.07, "wood", DECK - 0.3);
    }
    // 5 punch wall
    const P = W.PUNCH, face = P.x_wall + 0.25, ylo = Math.min(P.y0, P.y1), yhi = Math.max(P.y0, P.y1);
    slab(P.x_ledge - P.ledge_w / 2, P.x_ledge + P.ledge_w / 2, ylo, yhi, DECK, 0.45, [M.yellow, M.foamYellow], 0.08);
    for (let y = ylo + 1; y < yhi; y += 3) post(P.x_ledge, y, DECK - 0.45, 0.1);
    slab(P.x_wall - 0.25, P.x_wall + 0.25, ylo, yhi, P.wall_h, P.wall_h + 1.6, M.blue, 0.15);
    const pistonGeo = new THREE.CylinderGeometry(0.1, 0.1, 1.6, 12), padGeo = PC(0.4, 0.38, 0.15, 28), faceGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.05, 24);
    P.cols.forEach((cy, i) => {
      P.rows.forEach((rz) => {
        const g = new THREE.Group();
        g.position.copy(P3(face, cy, rz));
        scene.add(g);
        const pi = mesh(pistonGeo, M.steel, g); pi.rotation.z = Math.PI / 2; pi.position.x = -0.8;
        const pad = mesh(padGeo, M.red, g); pad.rotation.z = Math.PI / 2; pad.position.x = 0.19;
        const fc = mesh(faceGeo, M.white, g); fc.rotation.z = Math.PI / 2; fc.position.x = 0.39;
        DYN.punches.push([g, i, face]);
      });
      card(textTex(String(i + 1), { w: 128, h: 128, size: 100 }), 0.55, 0.55, face + 0.02, cy, 3.35, 90);
    });
    // 6 belt + log
    const B = W.BELT, by0 = Math.min(B.y0, B.y1), by1 = Math.max(B.y0, B.y1);
    slab(B.x - B.w / 2, B.x + B.w / 2, by0, by1, DECK - 0.01, 0.3, M.rubber, 0.03);
    const bg = new THREE.PlaneGeometry(B.w, by1 - by0);
    bg.rotateX(-Math.PI / 2);
    const belt = mesh(bg, M.belt, null, false);
    belt.position.copy(P3(B.x, (by0 + by1) / 2, DECK + 0.002));
    beltTex.repeat.set(1, (by1 - by0) / 1.1);
    for (const dx of [-B.w / 2 - 0.18, B.w / 2 + 0.18]) {
      tube([[B.x + dx, by0, DECK + 0.12], [B.x + dx, by1, DECK + 0.12]], 0.2, M.orange);
      for (const y of [by0 + 1, (by0 + by1) / 2, by1 - 1]) post(B.x + dx, y, DECK - 0.3, 0.12);
    }
    const g6 = W.LOG, ly0 = Math.min(g6.y0, g6.y1), ly1 = Math.max(g6.y0, g6.y1);
    const lg = new THREE.Group();
    lg.position.copy(P3(g6.x, (ly0 + ly1) / 2, g6.z));
    scene.add(lg);
    const logM = mesh(PC(g6.r, ly1 - ly0, 0.2, 48), M.log, lg);
    logM.rotation.x = Math.PI / 2;
    logTex.repeat.set(1, 3);
    DYN.log = lg;
    for (const y of [ly0 - 0.3, ly1 + 0.3]) for (const dx of [-0.9, 0.9]) tube([[g6.x + dx, y, -1.6], [g6.x, y, g6.z]], 0.09, M.steelRed);
    // 7 / 12 rafts
    W.RAFTS.forEach((r) => {
      const m = mesh(RB(W.RAFT, 0.5, W.RAFT, 0.18), [M.orange, M.orange, M.foamYellow, M.orange, M.orange, M.orange]);
      m.position.copy(P3(r.x, r.y, W.RAFT_Z - 0.25));
      DYN.rafts.push([m, r]);
      tube([[r.x - r.amp - 1.6, r.y, 0.06], [r.x + r.amp + 1.6, r.y, 0.06]], 0.025, M.white);
      for (const dx of [-r.amp - 1.6, r.amp + 1.6]) { const b = mesh(new THREE.SphereGeometry(0.28, 20, 12), M.red); b.position.copy(P3(r.x + dx, r.y, 0.05)); }
    });
    // 8 fake tiles + NPC
    const realM = M.tileReal;
    W.SUP.filter((s) => s.tile).forEach((s) => {
      const fake = s.fragile;
      const mat = fake ? new THREE.MeshPhysicalMaterial({ map: tileFaceTex(true), roughness: 0.25, clearcoat: 0.5 }) : realM;
      const m = slab(s.x0, s.x1, s.y0, s.y1, DECK, 0.12, [M.white, mat], 0.03);
      DYN.tiles.push([m, s, m.position.y]);
      for (const dx of [-0.6, 0.6]) post((s.x0 + s.x1) / 2 + dx, (s.y0 + s.y1) / 2, DECK - 0.12, 0.06);
    });
    DYN.npc = buildNpc();
    // 9 wind
    const Wd = W.WIND;
    slab(Wd.x - Wd.w / 2, Wd.x + Wd.w / 2, Wd.y0, Wd.y1, DECK, 0.4, [M.white, M.foam], 0.08);
    for (let y = Wd.y0 + 1; y < Wd.y1; y += 3) post(Wd.x, y, DECK - 0.4, 0.1);
    const torus = new THREE.TorusGeometry(1.45, 0.2, 12, 48), torus2 = new THREE.TorusGeometry(1.45, 0.12, 10, 48), bladeGeo = RB(0.06, 1.15, 0.38, 0.02, 1);
    Wd.fans.forEach(([fx, fy, on]) => {
      const cz = 2.3;
      post(fx - 0.3, fy, 0.4, 0.2);
      slab(fx - 0.9, fx + 0.3, fy - 0.8, fy + 0.8, 0.7, 0.3, M.navy, 0.08);
      post(fx - 0.3, fy, cz - 1.45, 0.12, "steel", 0.7);
      const ring = mesh(torus, M.white); ring.position.copy(P3(fx, fy, cz)); ring.rotation.y = Math.PI / 2;
      const ring2 = mesh(torus2, M.navy); ring2.position.copy(P3(fx - 0.6, fy, cz)); ring2.rotation.y = Math.PI / 2;
      const hub = mesh(new THREE.SphereGeometry(0.3, 20, 12), on ? M.red : M.navy); hub.position.copy(P3(fx + 0.05, fy, cz));
      const blades = new THREE.Group();
      blades.position.copy(P3(fx, fy, cz));
      scene.add(blades);
      for (let k = 0; k < 5; k++) {
        const a = (TAU * k) / 5, b = mesh(bladeGeo, M.white, blades);
        b.position.set(0, Math.sin(a) * 0.68, -Math.cos(a) * 0.68);
        b.rotation.x = a; b.rotation.y = 0.35;
      }
      DYN.fans.push([blades, on]);
    });
    const px = Wd.x - Wd.w / 2 - 0.9;
    let k = 0;
    for (let y = Wd.y0 + 0.8; y < Wd.y1 - 0.4; y += 1.6, k++) {
      const blowing = Wd.fans.some(([, fy, on]) => on && Math.abs(y - fy) < Wd.reach);
      post(px, y, 2.3, 0.04, "white", -1.6);
      const geo = new THREE.PlaneGeometry(1, 0.16, 12, 1);
      const rm = mesh(geo, k % 2 ? M.yellow : M.red, null, false);
      rm.material = rm.material.clone(); rm.material.side = THREE.DoubleSide;
      DYN.ribbons.push([rm, px, y, blowing, k]);
    }
    // 10 swing
    const Sg = W.SWING, ys = Sg.ropes.map((r) => r[1]);
    ys.forEach((yy) => {
      for (const dx of [-3.8, 3.8]) post(Sg.x + dx, yy, Sg.top_z + 0.3, 0.2, "steelRed");
      slab(Sg.x - 4.0, Sg.x + 4.0, yy - 0.2, yy + 0.2, Sg.top_z + 0.45, 0.4, M.white, 0.08);
    });
    for (const dx of [-3.8, 3.8]) slab(Sg.x + dx - 0.17, Sg.x + dx + 0.17, ys[0], ys[1], Sg.top_z + 0.42, 0.35, M.white, 0.06);
    const ropeGeo = new THREE.CylinderGeometry(0.045, 0.045, W.SWING_LEN, 10), gripGeo = PC(0.09, 0.8, 0.04, 16);
    Sg.ropes.forEach((r, i) => {
      const g = new THREE.Group();
      g.position.copy(P3(r[0], r[1], Sg.top_z));
      scene.add(g);
      const rope = mesh(ropeGeo, M.rope, g); rope.position.y = -W.SWING_LEN / 2;
      const knot = mesh(new THREE.SphereGeometry(0.13, 16, 10), M.rope, g); knot.position.y = -W.SWING_LEN + 0.1;
      const gr = mesh(gripGeo, M.red, g); gr.position.y = -W.SWING_GRIP;
      DYN.ropes.push([g, i]);
    });
    // 11 memory
    W.SUP.filter((s) => s.mem).forEach((s) => {
      const m = slab(s.x0, s.x1, s.y0, s.y1, DECK, 0.14, [M.steel, M.memDark], 0.03);
      DYN.mem.push([m, s, m.position.y]);
    });
    for (const x of [W.MEM_COLS[0] - W.MEM_TILE / 2 - 0.25, W.MEM_COLS[2] + W.MEM_TILE / 2 + 0.25]) {
      slab(x - 0.07, x + 0.07, W.MEM_ROWS[0] - 0.8, W.MEM_ROWS[W.MEM_ROWS.length - 1] + 0.8, DECK - 0.07, 0.25, M.steel, 0.03);
      W.MEM_ROWS.forEach((y) => post(x, y, DECK - 0.3, 0.08));
    }
  }
  function arch(x, y, R, r, mat, label) {
    const m = mesh(new THREE.TorusGeometry(R, r, 18, 56, Math.PI), mat);
    m.position.copy(P3(x, y, DECK));
    slab(x - R + 0.8, x + R - 0.8, y - 0.12, y + 0.12, DECK + R + 0.3, 0.9, M.white, 0.12);
    const tex = textTex(label, { w: 1024, h: 160, fg: "#1b2a4a", size: 96 }), wm = 2 * R - 1.9;
    card(tex, wm, (wm * 160) / 1024, x, y - 0.14, DECK + R - 0.15, 0);
    card(tex, wm, (wm * 160) / 1024, x, y + 0.14, DECK + R - 0.15, 180);
  }
  function sectionSign(s) {
    const lane = s.lane, x = L0.LANE_X[lane] + (lane === 1 ? 3.6 : -3.6), y = s.y0, facing = lane === 1 ? 180 : 0;
    const wm = 1.1 + 0.42 * s.name.length;
    post(x, y, 3.2, 0.08, "white");
    slab(x - wm / 2, x + wm / 2, y - 0.06, y + 0.06, 3.76, 0.72, M.navy, 0.05);
    const tex = textTex(s.name, { w: Math.round(200 * wm), h: 144, align: "left", size: 72, badge: [String(s.no), "#ffc21a", "#1b2a4a"], pad: 18 });
    card(tex, wm, 0.72, x, y + (lane === 1 ? 0.07 : -0.07), 3.4, facing);
  }
  function buildNpc() {
    const g = new THREE.Group(), purple = M.purple;
    const body = mesh(new THREE.CapsuleGeometry(0.33, 0.62, 6, 18), purple, g); body.position.y = 0.78;
    for (const s of [-1, 1]) {
      const leg = mesh(new THREE.CapsuleGeometry(0.1, 0.18, 4, 10), M.navy, g); leg.position.set(s * 0.14, 0.17, 0);
      const arm = mesh(new THREE.CapsuleGeometry(0.08, 0.38, 4, 10), purple, g); arm.position.set(s * 0.45, 1.0, 0); arm.rotation.z = s * 1.1;
    }
    const visor = mesh(new THREE.SphereGeometry(0.2, 20, 12), M.navy, g); visor.position.set(0, 1.12, 0.26); visor.scale.set(1.25, 0.75, 0.5);
    const bib = card(textTex("07", { w: 128, h: 112, bg: "#f2f2ee", fg: "#1b2a4a", size: 72 }), 0.4, 0.35, 0, 0.29, 0.95, 180, g);
    bib.position.set(0, 0.95, -0.345);
    scene.add(g);
    return g;
  }

  // ---- dressing: flags, foam where posts meet the water, banner boards, camera crane, judges' tent
  const FLAG = { time: { value: 0 } };
  function buildDressing() {
    const flagGeo = new THREE.PlaneGeometry(1.4, 0.85, 12, 1);
    flagGeo.translate(0.7, 0, 0);
    const flagMats = [0xe8302a, 0xffc21a, 0x1e6fd9, 0x2dbe60, 0xff7a1a].map((c) => {
      const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, side: THREE.DoubleSide });
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = FLAG.time;
        sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime;")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\nfloat fu = position.x / 1.4;\ntransformed.z += sin(position.x * 4.0 - uTime * 7.0 + modelMatrix[3][0] * 0.3) * 0.13 * fu;\ntransformed.y -= 0.06 * fu * fu;");
      };
      return m;
    });
    const spots = [];
    for (let y = PY0 + 2; y <= PY1 - 2; y += 10) spots.push([PX0 - 4.5, y], [PX1 + 4, y]);
    for (let x = PX0 + 2; x <= PX1 - 2; x += 10) { if (Math.abs(x - LA) > 7) spots.push([x, PY0 - 4.5]); if (Math.abs(x - LC) > 8) spots.push([x, PY1 + 3.5]); }
    spots.forEach(([x, y], i) => {
      post(x, y, 6.2, 0.06, "white", 0.35);
      const f = new THREE.Mesh(flagGeo, flagMats[i % flagMats.length]);
      f.position.copy(P3(x + 0.06, y, 5.75));
      scene.add(f);
    });
    const foam = POSTS.filter((p) => p[3] < 0 && p[2] > 0.05);
    const ringGeo = new THREE.PlaneGeometry(4, 4);
    ringGeo.rotateX(-Math.PI / 2);
    const foamTex = canvasTex(128, 128, (g, w) => {
      const img = g.createImageData(w, w);
      for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
        const dx = x - w / 2 + 0.5, dy = y - w / 2 + 0.5, d = Math.hypot(dx, dy) / (w / 2), a = Math.atan2(dy, dx);
        const ragged = 0.08 * Math.sin(a * 7) + 0.05 * Math.sin(a * 13 + 1.3);
        const v = Math.max(0, 1 - Math.abs(d - 0.42 - ragged) / 0.16) * (d < 0.24 ? 0 : 1), i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(Math.pow(v, 1.5) * 200);
      }
      g.putImageData(img, 0, 0);
    });
    const rings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, depthWrite: false }), foam.length);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion();
    foam.forEach(([x, y, , , r], i) => rings.setMatrixAt(i, mtx.compose(P3(x, y, 0.015), q, new THREE.Vector3(0.35 + r, 1, 0.35 + r))));
    rings.renderOrder = 3;
    scene.add(rings);
    const ads = ["Space Track · 男生女生向前冲", "冲关模式 · 掉水重来，时间照算"];
    [8, 38, 68].forEach((y, i) => {
      slab(PX0 - 1.8, PX0 - 1.6, y - 3, y + 3, 1.55, 1.2, M.navy, 0.03);
      card(textTex(ads[i % 2], { w: 1024, h: 200, bg: i % 2 ? "#1e6fd9" : "#e8302a", size: 84 }), 5.9, 1.15, PX0 - 1.58, y, 0.95, 90);
    });
    [12, 36].forEach((x, i) => {
      slab(x - 3, x + 3, PY0 - 1.8, PY0 - 1.6, 1.55, 1.2, M.navy, 0.03);
      card(textTex(ads[(i + 1) % 2], { w: 1024, h: 200, bg: i % 2 ? "#e8302a" : "#ffc21a", fg: i % 2 ? "#ffffff" : "#1b2a4a", size: 84 }), 5.9, 1.15, x, PY0 - 1.58, 0.95, 180);
    });
    // camera crane by the start
    slab(9, 11.4, -15.2, -12.8, 0.75, 0.4, M.navy, 0.08);
    post(10.2, -14, 4.2, 0.18, "steel", 0.75);
    tube([[10.2, -14, 4.2], [12.6, -10.5, 5.6], [14.2, -8.2, 6.2]], 0.1, M.steel);
    rbox(14.2, -8.2, 6.0, 0.9, 0.55, 0.6, M.navy, 0.06);
    const lens = mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.5, 16), M.rubber); lens.rotation.x = Math.PI / 2; lens.position.copy(P3(14.2, -7.7, 6.0));
    // judges' tent by the finish
    const tx = LC - 12, ty = PY1 + 4;
    for (const [dx, dy] of [[-2.4, -1.8], [2.4, -1.8], [-2.4, 1.8], [2.4, 1.8]]) post(tx + dx, ty + dy, 2.6, 0.06, "white", 0.35);
    const roof = mesh(new THREE.ConeGeometry(3.6, 1.4, 4), M.red); roof.rotation.y = Math.PI / 4; roof.position.copy(P3(tx, ty, 3.3));
    slab(tx - 2, tx + 2, ty - 0.5, ty + 0.5, 1.15, 0.08, M.white, 0.02);
    for (const dx of [-1.4, 0, 1.4]) post(tx + dx, ty + 0.9, 1.0, 0.18, "steel", 0.35);
  }
  /* Solid box by centre and size in world metres. */
  function rbox(x, y, z, w, d, h, mat, r) {
    const m = mesh(RB(w, h, d, r), mat);
    m.position.copy(P3(x, y, z));
    return m;
  }

  // ---- posing for a given time (live view, replay and bench bursts all use this)
  function poseWorld(t, St, cheer) {
    sky.material.uniforms.time.value = t;
    causticTex.offset.set(t * 0.035, t * 0.022);
    CROWD.time.value = t;
    CROWD.cheer.value = cheer === undefined ? 0.15 : cheer;
    FLAG.time.value = t;
    DYN.hammers.forEach(([g, h]) => (g.rotation.z = hammerAngle(W, h, t)));
    DYN.spinners.forEach(([g, s]) => (g.rotation.y = spinnerAngle(s, t)));
    DYN.rafts.forEach(([m, r]) => (m.position.x = raftX(r, t)));
    DYN.punches.forEach(([g, i, face]) => (g.position.x = face + punchExt(W, i, t)));
    DYN.log.rotation.z = (-W.LOG.carry / W.LOG.r) * t;
    DYN.ropes.forEach(([g, i]) => (g.rotation.x = ropeAngle(W, i, t)));
    const fallOff = (s, base, m) => {
      const tg = St.gone[s.id];
      if (tg !== undefined && t >= tg) { const dt = t - tg; m.position.y = base - 0.5 * GRAV * dt * dt; m.visible = dt < 1.2; m.rotation.x = dt * 0.8; }
      else { m.position.y = base; m.visible = true; m.rotation.x = 0; }
    };
    DYN.tiles.forEach(([m, s, base]) => fallOff(s, base, m));
    const lit = memLit(W, t);
    DYN.mem.forEach(([m, s, base]) => { fallOff(s, base, m); m.material[2] = lit && !s.fragile ? M.memLit : M.memDark; });
    // NPC: hops recorded in npcLog; between hops it stands on the safe tile of its row
    let row = 1, from = 1, t0 = -9;
    for (const [th, a, b] of St.npcLog) if (th <= t) { row = b; from = a; t0 = th; }
    const rowPos = (r) => (r >= 6 ? [LB + 0.6, 7.6] : [W.FAKE_COLS[1 - W.FAKE[r]], W.FAKE_ROWS[r]]);
    const u = clamp((t - t0) / 0.5, 0, 1), [ax, ay] = rowPos(from), [bx, by] = rowPos(row);
    let nx = ax + (bx - ax) * u, ny = ay + (by - ay) * u, nz = DECK + Math.sin(Math.PI * u) * 0.5;
    if (row >= 6 && u >= 1) { nx += Math.min(10, (t - t0 - 0.5) * 1.2); }
    DYN.npc.position.copy(P3(nx, ny, nz));
    DYN.npc.rotation.y = row >= 6 && u >= 1 ? Math.PI / 2 : 0;
    DYN.fans.forEach(([b, on]) => (b.rotation.x = on ? t * 9 : 0.3));
    DYN.ribbons.forEach(([m, px, y, blowing, k]) => {
      const p = m.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const col = i % 13, row2 = Math.floor(i / 13), u2 = col / 12, side = row2 ? -0.08 : 0.08;
        let wx, wy, wz;
        if (blowing) { wx = px + 1.05 * u2; wy = y + 0.1 * Math.sin(7 * u2 - t * 11 + k) * u2; wz = 2.22 - 0.1 * u2 + side + 0.05 * Math.sin(5 * u2 - t * 9 + k) * u2; }
        else { wx = px + 0.04 * Math.sin(3 * u2 + t * 1.3 + k) * u2; wy = y + side; wz = 2.22 - 1.1 * u2; }
        p.setXYZ(i, wx, wz, -wy);
      }
      p.needsUpdate = true;
      m.geometry.computeVertexNormals();
    });
    beltTex.offset.y = -(W.BELT.speed * t) / 1.1;
    waterN.offset.set(t * 0.012, t * 0.008);
    drawScreen(St);
  }
  function placeCamera(p, fov, roll) {
    camera.position.set(p.x, p.e, -p.y);
    camera.rotation.set(rad(p.p), rad(p.h - 90), rad(roll || 0));
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    sky.position.copy(camera.position);
    aimSun(p.x, p.y, p.h);
  }
  /* Bench frames: plain pose, no particles, no underwater fog, no camera motion. */
  function shot(t, p, w, h, mime) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    const savedAspect = camera.aspect, wasUnder = underwater(false);
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    FX.particles.setVisible(false);
    poseWorld(t, S);
    placeCamera(p, FOV, 0);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL(mime || "image/jpeg", 0.9);
    FX.particles.setVisible(true);
    underwater(wasUnder);
    renderer.setSize(size.x, size.y, false);
    camera.aspect = savedAspect; camera.updateProjectionMatrix();
    return url;
  }
  /* Switch the underwater look on or off; returns the previous state. */
  const FOG = { color: scene.fog.color.getHex(), near: scene.fog.near, far: scene.fog.far, under: false };
  const surfaceBelow = (() => {
    const g = new THREE.PlaneGeometry(L0.POOL[1] - L0.POOL[0], L0.POOL[3] - L0.POOL[2]);
    g.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x8fe6f5, transparent: true, opacity: 0.85, depthWrite: false }));
    m.position.copy(P3((L0.POOL[0] + L0.POOL[1]) / 2, (L0.POOL[2] + L0.POOL[3]) / 2, -0.01));
    m.visible = false;
    scene.add(m);
    return m;
  })();
  function underwater(on) {
    const was = FOG.under;
    if (on === was) return was;
    FOG.under = on;
    surfaceBelow.visible = on;
    scene.fog.color.setHex(on ? 0x0b5574 : FOG.color);
    scene.fog.near = on ? 0.2 : FOG.near;
    scene.fog.far = on ? 13 : FOG.far;
    sky.visible = !on;
    scene.background = on ? new THREE.Color(0x0b5574) : null;
    return was;
  }
  function poseAt(t) {
    const H = EP.hist;
    if (!H.length) return poseOf(S);
    if (t <= H[0].t) return H[0];
    let lo = 0, hi = H.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (H[mid].t <= t + 1e-9) lo = mid; else hi = mid - 1; }
    return H[lo];
  }

  // ---- presentation for people: sound, camera motion, splashes, captions, splits (never in bench frames)
  const FX = window.SACourseFX(THREE, scene, FOV, $("caption"));
  const PRES = { pending: [], beat: null, closeCool: 0, jumpFrom: null, splitTimer: null, countEl: $("countdown"), cheer: 0.15 };
  const PB_KEY = "spaceact2.course.split";
  function surfaceOf(id) {
    const s = W.SUP[id];
    if (!s) return "foam";
    if (s.kind === "bridge") return "wood";
    if (s.tile || s.mem) return "hard";
    if (s.kind === "ball" || s.kind === "log") return "vinyl";
    if (s.vel) return "rubber";
    return "foam";
  }
  /* Bearing of a world point relative to the view, as a stereo pan in [-1, 1] (right positive). */
  const panOf = (p, x, y) => clamp(-Math.sin(Math.atan2(y - p.y, x - p.x) - rad(p.h)), -1, 1);
  function present(e, cp, x, pose) {
    const snd = FX.sound;
    if (e === "jump") { snd.jump(); PRES.jumpFrom = [pose.x, pose.y]; }
    else if (e === "land") {
      snd.land(x || 3); FX.camera.land(x || 3);
      const s = W.SUP[pose.u];
      if (s && s.kind === "ball" && Math.hypot(pose.x - s.cx, pose.y - s.cy) < 0.15) FX.captions.say("ball");
      else if (PRES.jumpFrom && Math.hypot(pose.x - PRES.jumpFrom[0], pose.y - PRES.jumpFrom[1]) > 2.9) FX.captions.say("far");
      PRES.jumpFrom = null;
    } else if (e === "collapse") {
      snd.collapse(); FX.captions.say("collapse");
      const s = W.SUP[x];
      if (s) PRES.pending.push([pose.t + 0.45, (s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2]);
    } else if (e === "hit") { snd.hit(); FX.camera.hit(); FX.captions.say("hit"); }
    else if (e === "splash") { snd.splash(1); snd.oooh(); FX.particles.splash(pose.x, pose.y, 1); FX.captions.say("splash"); PRES.cheer = 0.5; }
    else if (e === "respawn") { $("fade").style.opacity = 0; FX.camera.reset(); }
    else if (e === "grab" || e === "switch") snd.grab();
    else if (e === "release") snd.release();
    else if (e === "cp") { snd.chime(); snd.cheer(0.6); split(cp, pose.t); PRES.cheer = 1; }
    else if (e === "goal") { snd.fanfare(); snd.cheer(1.3); FX.captions.say("goal"); PRES.cheer = 1.2; }
  }
  function loadPB() { try { return JSON.parse(localStorage.getItem(PB_KEY)) || {}; } catch (e) { return {}; } }
  /* Oracle time for each checkpoint-to-checkpoint segment of this world, run once. */
  function oracleSplits() {
    if (EP.osplits) return EP.osplits;
    const S0 = initState(W, { startCp: 0, goalCp: FINISH, limit: 1800 }), r = ORACLE(S0), out = {};
    if (r && r.S.done) {
      const C = cloneState(S0);
      C.ev = [];
      for (const a of r.acts) runAction(W, C, a[0], a[1], null);
      let prev = 0;
      for (const [e, t, cp] of C.ev) if (e === "cp") { out[cp] = t - prev; prev = t; }
    }
    return (EP.osplits = out);
  }
  function split(cp, t) {
    const seg = t - EP.splitT, pbs = loadPB(), pb = pbs[cp], o = oracleSplits()[cp];
    EP.splitT = t;
    let html = `<b>${CP_NAMES[cp]} · 本段 ${seg.toFixed(1)} 秒</b>`;
    if (pb !== undefined) { const d = seg - pb; html += `<br><span class="${d <= 0 ? "fast" : "slow"}">个人最佳 ${pb.toFixed(1)}（${d <= 0 ? "" : "+"}${d.toFixed(1)}）</span>`; }
    if (o) html += `<br><small>程序解 ${o.toFixed(1)} 秒</small>`;
    const el = $("split");
    el.innerHTML = html;
    el.classList.add("show");
    clearTimeout(PRES.splitTimer);
    PRES.splitTimer = setTimeout(() => el.classList.remove("show"), 3200);
    if (EP.mode === "free" && !T.challenge && (pb === undefined || seg < pb)) {
      pbs[cp] = round(seg, 100);
      try { localStorage.setItem(PB_KEY, JSON.stringify(pbs)); } catch (e) { /* storage disabled */ }
    }
    FX.captions.say(cp === FINISH ? "goal" : "cp", `${seg.toFixed(1)} 秒`);
  }
  function showCount(text) {
    const el = PRES.countEl;
    el.textContent = text;
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
  }
  /* Whoosh from swinging hammers and sweeping arms, hum from fans, belt and log, thuds from the punch wall. */
  function ambience(t, p) {
    let w = 0, wp = 0, freq = 380, m = 0, mp = 0;
    const add = (x, y, z, speed) => {
      const d2 = (x - p.x) ** 2 + (y - p.y) ** 2 + (z - p.e) ** 2, k = (speed * speed) / (400 * (1 + d2 / 2));
      w += k; wp += k * panOf(p, x, y);
      if (k > 0.02) freq = Math.max(freq, 300 + speed * 70);
    };
    for (const h of W.HAMMERS) {
      const a = hammerAngle(W, h, t);
      add(h.x + W.HAMMER_R * Math.sin(a), h.y, W.HAMMER_PIVOT_Z - W.HAMMER_R * Math.cos(a), Math.abs(hammerRate(W, h, t)) * W.HAMMER_R);
    }
    for (const s of W.SPINNERS) {
      const a0 = spinnerAngle(s, t), r = s.r - 0.6;
      s.arms.forEach(([za], k) => add(s.x + Math.cos(a0 + Math.PI * k) * r, s.y + Math.sin(a0 + Math.PI * k) * r, za, Math.abs(s.omega) * r));
    }
    const hum = (x, y, level) => { const k = level / (1 + ((x - p.x) ** 2 + (y - p.y) ** 2) / 25); m += k; mp += k * panOf(p, x, y); };
    W.WIND.fans.forEach(([fx, fy, on]) => on && hum(fx, fy, 0.16));
    hum(W.BELT.x, (W.BELT.y0 + W.BELT.y1) / 2, 0.07);
    hum(W.LOG.x, (W.LOG.y0 + W.LOG.y1) / 2, 0.05);
    FX.sound.ambient(w * 0.6, w > 1e-4 ? wp / w : 0, freq, m, m > 1e-4 ? mp / m : 0);
    const P = W.PUNCH, k = Math.floor(t / P.beat);
    if (PRES.beat !== null && k !== PRES.beat) {
      const g = P.order[((k % 4) + 4) % 4], face = P.x_wall + 0.25;
      P.cols.forEach((cy, i) => {
        if (i % 4 !== g) return;
        const gain = 1 / (1 + ((face - p.x) ** 2 + (cy - p.y) ** 2) / 16);
        if (gain > 0.05) FX.sound.punch(gain, panOf(p, face, cy));
      });
    }
    PRES.beat = k;
  }
  /* A hammer or arm passing within half a metre of the body without hitting it. */
  function nearMiss(t, p) {
    if (p.m !== "ground" && p.m !== "air") return false;
    const z0 = p.e - EYE, z1 = z0 + BODY.height;
    for (const h of W.HAMMERS) {
      if (Math.abs(p.y - h.y) > W.HAMMER_HEAD_L / 2 + PR + 0.3) continue;
      const a = hammerAngle(W, h, t), hx = h.x + W.HAMMER_R * Math.sin(a), hz = W.HAMMER_PIVOT_Z - W.HAMMER_R * Math.cos(a);
      const d = Math.hypot(p.x - hx, clamp(hz, z0, z1) - hz);
      if (d < W.HAMMER_HEAD_R + PR + 0.5 && Math.abs(hammerRate(W, h, t)) > 0.8) return true;
    }
    for (const s of W.SPINNERS) {
      const dx = p.x - s.x, dy = p.y - s.y, a0 = spinnerAngle(s, t);
      for (let k = 0; k < s.arms.length; k++) {
        const za = s.arms[k][0];
        if (z1 < za - 0.6 || z0 > za + 0.6) continue;
        const a = a0 + Math.PI * k, along = dx * Math.cos(a) + dy * Math.sin(a), perp = Math.abs(dx * Math.sin(a) - dy * Math.cos(a));
        if (along > 0.4 && along < s.r && perp < 0.24 + PR + 0.4) return true;
      }
    }
    return false;
  }
  /* Everything the live view adds on top of the pose; returns the camera to render with. */
  function decorate(view, tWorld, dtReal) {
    const cf = FX.camera.apply(view, dtReal);
    if (cf.step && view.m === "ground") FX.sound.step(surfaceOf(view.u), cf.fast);
    for (let i = PRES.pending.length - 1; i >= 0; i--) {
      const [t, x, y] = PRES.pending[i];
      if (tWorld < t) continue;
      PRES.pending.splice(i, 1);
      FX.particles.splash(x, y, 0.45);
      FX.sound.smallSplash(1 / (1 + ((x - view.x) ** 2 + (y - view.y) ** 2) / 30), panOf(view, x, y));
    }
    ambience(tWorld, view);
    PRES.cheer = Math.max(0.15, PRES.cheer - dtReal * 0.35);
    for (const [fx, fy, on] of W.WIND.fans) {
      if (on && (fx - view.x) ** 2 + (fy - view.y) ** 2 < 900) FX.particles.mist(fx + 0.3, fy, 2.3);
    }
    PRES.closeCool -= dtReal;
    if (PRES.closeCool <= 0 && !view.k && nearMiss(tWorld, view)) { FX.captions.say("close"); PRES.closeCool = 4; }
    underwater(cf.underwater);
    $("splash").style.opacity = cf.underwater ? 0.45 : 0;
    if (view.m === "water") {
      const hr = rad(view.h);
      FX.particles.bubbles(view.x + Math.cos(hr) * 1.4, view.y + Math.sin(hr) * 1.4, cf.pose.e - 0.3);
      if (FX.camera.waterT > RESPAWN - 0.55) $("fade").style.opacity = 1;
    }
    FX.particles.update(dtReal);
    return cf;
  }
  function toggleMute() {
    const m = FX.sound.toggle();
    $("muteBtn").innerHTML = `${m ? "静音" : "声音"} <kbd>M</kbd>`;
    $("muteBtn").classList.toggle("on", !m);
  }
  ["pointerdown", "keydown"].forEach((t) => window.addEventListener(t, () => FX.sound.unlock(), true));

  // ---- god view (debug, hidden from the agent)
  const god = $("god"), gctx = god.getContext("2d");
  const state = { god: false };
  const gx = (x) => 8 + ((x - PX0) / (PX1 - PX0)) * (god.width - 16), gy = (y) => god.height - 8 - ((y - PY0) / (PY1 - PY0)) * (god.height - 16);
  function drawGod() {
    gctx.fillStyle = "#cfeff8"; gctx.fillRect(0, 0, god.width, god.height);
    for (const s of W.SUP) {
      if (gone(S, s, S.t)) continue;
      gctx.fillStyle = s.fragile && (s.tile || s.mem) ? "#b0bec5" : s.cp !== undefined ? "#1e6fd9" : "#ff9800";
      if (s.kind === "rect" || s.kind === "bridge") gctx.fillRect(gx(s.x0), gy(s.y1), Math.max(1, gx(s.x1) - gx(s.x0)), Math.max(1, gy(s.y0) - gy(s.y1)));
      else if (s.kind === "log") gctx.fillRect(gx(s.cx - s.r), gy(s.y1), gx(s.cx + s.r) - gx(s.cx - s.r), gy(s.y0) - gy(s.y1));
      else { const cx = s.kind === "raft" ? raftX(W.RAFTS[s.ri], S.t) : s.cx, cy = s.kind === "raft" ? s.cy : s.cy, r = s.kind === "raft" ? s.half : s.kind === "ball" ? s.R : s.r;
        gctx.beginPath(); gctx.arc(gx(cx), gy(cy), (r / (PX1 - PX0)) * (god.width - 16), 0, TAU); gctx.fill(); }
    }
    const h = rad(S.h), px = gx(S.x), py = gy(S.y);
    gctx.beginPath(); gctx.moveTo(px + Math.cos(h) * 8, py - Math.sin(h) * 8);
    gctx.lineTo(px + Math.cos(h + 2.5) * 5, py - Math.sin(h + 2.5) * 5); gctx.lineTo(px + Math.cos(h - 2.5) * 5, py - Math.sin(h - 2.5) * 5);
    gctx.closePath(); gctx.fillStyle = "#d81b60"; gctx.fill();
  }
  function toggleGod() {
    if (!state.god && T.godLocked(S.done)) { say("挑战模式：俯视图要到结算后才能看。"); return; }
    state.god = !state.god;
    $("godwrap").style.display = state.god ? "block" : "none";
    $("godBtn").classList.toggle("on", state.god);
  }

  // ------------------------------------------------------------------------------------------------ HUD & input
  function hud() {
    $("time").textContent = fmtT(S.t);
    $("falls").textContent = S.falls;
    $("cpNow").textContent = CP_NAMES[S.cp];
    const sec = secOf(S.cp);
    if (sec !== EP.banner && !S.done) {
      EP.banner = sec;
      const s = SECS[sec - 1];
      $("bannerN").textContent = `第 ${s.no} 关`; $("bannerT").textContent = s.name;
      $("bannerA").textContent = s.abil.map((a) => L0.ABILITY[a][0]).join(" · ");
      const b = $("banner");
      b.style.opacity = 1;
      clearTimeout(EP.bannerTimer);
      EP.bannerTimer = setTimeout(() => (b.style.opacity = 0), 2200);
    }
  }
  const keys = {};
  const queued = { jump: false, grab: false };
  window.addEventListener("keydown", (e) => {
    if (e.target && e.target.tagName === "INPUT") return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === "g") return toggleGod();
    if (k === "r") return resetEpisode();
    if (k === "m") return toggleMute();
    if (EP.mode !== "free") return;
    if (k === " ") { queued.jump = true; queued.jumpAt = performance.now(); e.preventDefault(); }
    if (k === "e") queued.grab = true;
    keys[k] = true;
    if (k.startsWith("Arrow")) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => { keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false; });
  window.addEventListener("blur", () => Object.keys(keys).forEach((k) => (keys[k] = false)));
  let drag = null;
  canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointerup", () => { drag = null; });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag || EP.mode !== "free" || S.done) return;
    S.h = normDeg(S.h - (e.clientX - drag.x) * 0.25);
    S.pitch = clamp(S.pitch - (e.clientY - drag.y) * 0.2, -60, 30);
    drag = { x: e.clientX, y: e.clientY };
  });
  function humanInput(dtReal) {
    const turn = (keys.ArrowLeft ? 1 : 0) - (keys.ArrowRight ? 1 : 0);
    if (keys.ArrowUp) S.pitch = clamp(S.pitch + 60 * dtReal, -60, 30);
    if (keys.ArrowDown) S.pitch = clamp(S.pitch - 60 * dtReal, -60, 30);
    const I = { human: true, f: (keys.w ? 1 : 0) - (keys.s ? 1 : 0), s: (keys.a ? 1 : 0) - (keys.d ? 1 : 0), run: !!keys.Shift,
      duck: !!(keys.c || keys.Control), turn: turn * 110 * DT };
    /* A jump pressed up to 0.15 s before touching down is kept until it can happen. */
    if (queued.jump) {
      if (S.mode === "rope") { I.release = true; queued.jump = false; }
      else if (S.mode === "ground" || canCoyote(S)) { I.jump = true; queued.jump = false; }
      else if (performance.now() - queued.jumpAt > 150) queued.jump = false;
    }
    if (queued.grab) { I.grab = true; queued.grab = false; }
    return I;
  }

  function setMode(m) {
    if (m === EP.mode || EP.replay) return;
    EP.mode = m;
    $("modeFree").classList.toggle("on", m === "free");
    $("modeAI").classList.toggle("on", m === "ai");
    $("aibar").style.display = m === "ai" ? "block" : "none";
    $("hint").style.display = m === "ai" ? "none" : "block";
    if (m === "ai") { S.pitch = AI_PITCH; EP.count = null; say("AI 动作模式：世界在你思考时暂停，每个动作按它耗的时间推进。"); }
    else say("自己玩：WASD 移动，Shift 跑，空格跳，C 蹲，E 抓绳。");
  }
  $("modeFree").onclick = () => setMode("free");
  $("modeAI").onclick = () => setMode("ai");
  $("godBtn").onclick = toggleGod;
  $("resetBtn").onclick = resetEpisode;
  $("muteBtn").onclick = toggleMute;
  $("muteBtn").innerHTML = `${FX.sound.muted ? "静音" : "声音"} <kbd>M</kbd>`;
  $("muteBtn").classList.toggle("on", !FX.sound.muted);
  document.querySelectorAll("#aibar button[data-a]").forEach((b) => (b.onclick = () => {
    const v = parseFloat($("aiVal").value) || 0, d = parseFloat($("aiDeg").value) || 0, a = b.dataset.a;
    const map = { sideL: ["sidestep", v], sideR: ["sidestep", -v], turnL: ["turn", d], turnR: ["turn", -d], look: ["look", d], grab: ["grab"], release: ["release"], give_up: ["give_up"] };
    const [n, arg] = map[a] || [a, v];
    act(n, arg, false);
  }));
  $("task").innerHTML = T.card([["起点", TASK.startName], ["目标", TASK.goalName],
    ["步数上限", TASK_SECS.length > 1
      ? `每关单独计：程序解步数 × 3 + 10，合计 ${TASK.maxSteps}；某关用完就判这关失败，跳到下一关继续（AI 动作模式）`
      : `${TASK.maxSteps}（AI 动作模式；程序解 ${REF ? REF.steps : "—"} 步 × 3 + 10）`],
    ["规则", "掉水回到上一个检查点，3 秒后重新出发，时间照算。障碍按固定周期运动，同一局每次都一样。"]]);

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);

  // ------------------------------------------------------------------------------------------------ loop
  let lastT = performance.now(), acc = 0;
  function frame(now) {
    const dtReal = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    let view = null, tWorld = S.t;
    if (EP.replay) {
      const R = EP.replay;
      R.t += dtReal;
      while (R.i < R.hist.length - 1 && R.hist[R.i + 1].t <= R.t) R.i++;
      view = R.hist[R.i];
      tWorld = view.t;
      const end = R.i >= R.hist.length - 1;
      while (R.ei < R.evs.length && (end || R.evs[R.ei][1] <= view.t + 1e-9)) { const [e, , cp, x] = R.evs[R.ei++]; present(e, cp, x, view); }
      $("time").textContent = fmtT(view.t);
      if (end) { EP.replay = null; say(R.text); afterEvents(R.evs); if (S.done) finish(); }
    } else if (EP.mode === "free" && !S.done && EP.count !== null) {
      const picker = $("picker");
      if (!picker || picker.style.display !== "flex") EP.count -= dtReal;
      const n = Math.ceil(EP.count);
      if (n !== EP.countShown && n >= 0) { EP.countShown = n; showCount(n > 0 ? String(n) : "GO!"); FX.sound.beep(n <= 0); }
      tWorld = -Math.max(0, EP.count);
      if (EP.count <= 0) { EP.count = null; acc = 0; }
    } else if (EP.mode === "free" && !S.done) {
      acc += dtReal;
      let n = 0;
      while (acc >= DT && n < 8) {
        S.ev = [];
        tick(W, S, humanInput(DT));
        record(S, null);
        acc -= DT; n++;
        const pose = poseOf(S);
        sectionEvents(S.ev);
        for (const [e, , cp, x] of S.ev) {
          present(e, cp, x, pose);
          if (e === "splash") say(`掉水了！3 秒后回到 ${CP_NAMES[S.cp]}。`);
          else if (e === "respawn") say(`回到 ${CP_NAMES[S.cp]}，继续！`);
          else if (e === "cp" && !S.done) say(`到达 ${CP_NAMES[S.cp]}`);
          else if (e === "collapse") say("脚下的板子塌了！");
          else if (e === "hit") say("被撞飞了！");
        }
        if (S.done) { finish(); break; }
      }
      if (n) hud();
      tWorld = S.t;
    }
    const cf = decorate(view || poseOf(S), tWorld, dtReal);
    poseWorld(tWorld, S, PRES.cheer);
    placeCamera(cf.pose, cf.fov, cf.roll);
    renderer.render(scene, camera);
    if (state.god) drawGod();
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------------------------------------ env API
  const env = {
    reset() { EP.mode = "free"; setMode("ai"); resetEpisode(); S.pitch = AI_PITCH; EP.hist = [poseOf(S)]; return env.observe(); },
    step(name, arg) {
      if (EP.mode !== "ai") setMode("ai");
      act(name, arg === null ? undefined : arg, true);
      return env.observe();
    },
    observe() { return { text: EP.text, done: S.done, info: info() }; },
    frame(width, height, mime) { return shot(S.t, poseOf(S), width || 768, height || 432, mime || "image/jpeg"); },
    /* BURST_N frames, oldest first, BURST_DT apart, ending now. */
    frames(width, height, mime) {
      const out = [];
      for (let k = BURST_N - 1; k >= 0; k--) {
        const t = S.t - k * BURST_DT, p = Object.assign({}, poseAt(t), { t });
        out.push(shot(t, k === 0 ? poseOf(S) : p, width || 768, height || 432, mime || "image/jpeg"));
      }
      return out;
    },
    photo() { return null; },
    task() {
      const card = { scene: "course", id: TASK.id, title: TASK.title, intro: TASK.intro, maxSteps: TASK.maxSteps, oracle_steps: REF ? REF.steps : null,
        sections: TASK_SECS.map((k) => ({ section: k, name: SECS[k - 1].name, oracle_steps: SEC_REF[k] ? SEC_REF[k].steps : null, budget: budgetOf(k) })),
        section_rules: "每关单独计步数、用时、落水和得分；步数上限 = 进入这一关时程序解的步数 × 3 + 10，时间上限 300 秒；用完判这关失败，跳到下一关起点继续；score 是各关得分的平均",
        obs: T.obs, challenge: T.challenge, seed: T.seed, eval: EVAL,
        start: CP_NAMES[TASK.startCp], goal: CP_NAMES[TASK.goalCp], actions: ACTION_DOC, body: BODY, burst: { frames: BURST_N, dt: BURST_DT }, fov: FOV, time_limit_s: TASK.limit };
      if (EVAL) { delete card.oracle_steps; delete card.sections; delete card.seed; }
      return card;
    },
  };
  /* Seed check for the evaluation bank: in this world every section must be solvable by the oracle and must defeat
     every blind policy (no look at the frames, fixed actions until the step budget runs out). */
  const BLIND = [["run", () => ["run", 4]], ["run_short", () => ["run", 2]], ["walk", () => ["walk", 2]],
    ["jump_far", () => ["jump", 3.2]], ["jump_mid", () => ["jump", 2.4]], ["jump_near", () => ["jump", 1.6]],
    ["wait_run", (n) => (n === 0 ? ["wait", 1] : ["run", 4])], ["wait2_run", (n) => (n === 0 ? ["wait", 2] : ["run", 4])],
    ["hop_wait", (n) => (n % 2 ? ["wait", 0.5] : ["jump", 3.2])]];
  function verifyWorld() {
    const out = {};
    for (let k = 1; k <= 12; k++) {
      const task = TASKS[k], ref = oracleOf(task), budget = ref ? ref.steps * BUDGET[0] + BUDGET[1] : 0, beaten = [];
      for (const [name, next] of BLIND) {
        const C = initState(W, task);
        C.ev = [];
        for (let n = 0; n < budget && !C.done; n++) { const [a, v] = next(n); runAction(W, C, a, v, null); }
        if (C.success) beaten.push(name);
      }
      out[task.id] = { ok: !!ref && beaten.length === 0, oracle_steps: ref ? ref.steps : null, oracle_s: ref ? ref.t : null, budget, blind_passed: beaten };
    }
    out.full = { ok: Object.keys(out).every((k) => out[k].ok) };
    return out;
  }
  window.SPACEACT = EVAL ? Object.freeze({ env: Object.freeze({ reset: env.reset, step: env.step, observe: env.observe, frame: env.frame,
    frames: env.frames, photo: env.photo, task: env.task }) }) : {
    verify: verifyWorld,
    env, info, world: () => W, state: () => S, task: TASK,
    oracle() { const r = ORACLE(S); return r ? r.acts.map((a) => (a.length > 1 ? a : a[0])) : []; },
    oraclePlan: () => ORACLE(S),
    simulate(acts) { const C = cloneState(S); acts.forEach((a) => (Array.isArray(a) ? runAction(W, C, a[0], a[1], null) : runAction(W, C, a, undefined, null))); return C; },
    /* Keyboard play on a copy of the state: segments of [ticks, input], e.g. [[30, {f: 1, run: true}], [1, {f: 1, run: true, jump: true}]]. */
    play(segments) { const C = cloneState(S); C.ev = []; for (const [n, I] of segments) for (let i = 0; i < n; i++) tick(W, C, Object.assign({ human: true }, I)); return C; },
    shot: (x, y, eye, h, p, w, hh, t) => shot(t === undefined ? S.t : t, { x, y, e: eye, h, p }, w || 768, hh || 432, "image/png"),
    teleport(cp) { const [x, y, h] = POSES[cp]; Object.assign(S, { x, y, z: DECK, h, cp, mode: "ground", vx: 0, vy: 0, vz: 0 }); },
  };

  buildEnvironment();
  buildCourse();
  buildDressing();
  buildPosts();
  resize();
  resetEpisode();
  $("loading").style.display = "none";
  requestAnimationFrame(frame);
  if (EVAL) delete window.SA_COURSE;
  if (new URLSearchParams(location.search).has("ai")) setMode("ai");
  else setTimeout(oracleSplits, 800);
})();
