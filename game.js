/* Space Track · scene B in the browser: free walking, the AI action mode (step for step the same rules as
   env/park_env.py), task logic and HUD. Visuals live in scene.js, the shared action layer in nav.js. */
(function () {
  "use strict";
  const W = window.WORLD;
  const G = W.graph;
  const SA = window.SA, N = window.SANav;
  const { v3, smoothstep, groundAt, modeAt, pointAt, terrainH, MODE } = SA;
  const EYE = 0.17, BOAT_EYE = 0.38, BOW = -0.22;
  const WALK = 1.6, RUN = 3.4, TURN_DEG = 75;
  const FOV = 60, ZOOM_FOV = 22, BENCH_FOV = 58.7, BENCH_ZOOM_FOV = 17.1;
  const M_PER_UNIT = W.units.metersPerUnit;
  const CK = W.clock, FAC = W.facilities;
  const FAC_KEYS = W.randomClosures;
  const BARRIER_KEYS = FAC_KEYS.filter((k) => k !== "ferry");
  const NEW = ["photo", "treasure", "homing", "lost", "island"];
  const DECLARE_OPTIONS = ["一号主轴活墙", "二号折廊活墙", "轨道摆渡车", "地下暗渠", "高空连廊", "南门", "西门", "东门"];
  const $ = (id) => document.getElementById(id);
  const angDiff = N.angDiff;
  const rad = (d) => (d * Math.PI) / 180;
  const hm = SATasks.toMin;
  const bearing = (from, to) => N.headingOf(to[0] - from[0], to[1] - from[1]);

  const T = SATasks.setup("park", "移动迷宫 · 巨墙扇区", W.tasks.map((t) => Object.assign({ isNew: NEW.indexOf(t.id) >= 0 }, t)), null);
  const TK = T.task;
  N.prepare(G);
  const FERRY = G.edges.findIndex((e) => e.kind === "ferry");
  const walkable = (e) => e.kind !== "ferry";

  // ---------------------------------------------------------------- today's variant (same draws, same order as ParkEnv)
  const rnd = SATasks.rng(T.seed);
  let startNode = TK.startNode, startHeading = TK.heading;
  if (TK.kind === "lost") {
    startNode = TK.starts[Math.floor(rnd() * TK.starts.length)];
    startHeading = Math.floor(rnd() * 8) * 45;
  }
  const START_MIN = hm(TK.time);
  const GOAL0 = new Set(TK.goalNodes);
  const gateClose = {};
  Object.keys(TK.gates || {}).forEach((k) => (gateClose[k] = hm(TK.gates[k])));
  const LAST_CLOSE = Object.keys(gateClose).length ? Math.max(...Object.values(gateClose)) : null;
  let force = Object.assign({}, TK.force);

  function isOpen(key, m) {
    const f = force[key];
    if (f === "open" || f === "closed") return f === "open";
    return SATasks.inWindow(m, FAC[key].hours[0], FAC[key].hours[1]);
  }
  function nextDeparture(m) {
    if (force.ferry === "closed") return null;
    const a = hm(FAC.ferry.hours[0]), b = hm(FAC.ferry.hours[1]), every = FAC.ferry.every;
    const dep = a + Math.max(0, Math.ceil((m - a) / every - 1e-9)) * every;
    return dep <= b ? dep : null;
  }
  const usable = (key, m) => (key === "ferry" ? nextDeparture(m) !== null : isOpen(key, m));
  function edgeMinutes(eid, from, m) {
    const e = G.edges[eid];
    if (e.kind === "ferry") { const dep = nextDeparture(m); return dep === null ? null : dep - m + (e.len * M_PER_UNIT) / CK.boatMPerMin; }
    if (e.facility && e.gated.indexOf(from) >= 0 && !isOpen(e.facility, m)) return null;
    let t = (e.len * M_PER_UNIT) / CK.walkMPerMin;
    if (e.rise) t += Math.abs(e.rise) * ((from === e.a) === (e.rise > 0) ? CK.climbUp : CK.climbDown);
    return t;
  }
  const goalOk = (n, m) => TK.kind !== "lost" || (G.gates[n] !== undefined && m < gateClose[G.gates[n]]);
  const planFrom = (src, goals, m) => N.plan(G, src, goals, m, edgeMinutes, goalOk);
  if (T.challenge && TK.kind === "reach" && !TK.blockers && !TK.friend) {
    for (let i = 0; i < 40; i++) {
      force = Object.assign({}, TK.force);
      FAC_KEYS.forEach((k) => { if (rnd() < 0.3) force[k] = "closed"; });
      if (planFrom(startNode, GOAL0, START_MIN) || rnd() < 0.25) break;
    }
  }
  const BLOCKERS = TK.blockers || FAC_KEYS.filter((k) => !usable(k, START_MIN)).map((k) => W.facilityWords[k]);
  const closedText = (key) => (force[key] === "closed" ? W.forcedText : W.scheduleText)[key];
  const blockedText = (key) => T.say(closedText(key), key === "ferry" ? "轨站月台边没有摆渡车。" : "前面被巨墙或防爆障封住了，过不去。");

  const canvas = $("view");
  const view = SA.build(canvas, { look: TK.look, force });
  const { renderer, camera } = view;
  let PHOTO = null;
  if (TK.friend) view.friend.place(...TK.friend);
  if (TK.id === "maze" && view.sandTablePhoto) {
    PHOTO = view.sandTablePhoto();
    T.photo(PHOTO);
  }

  // ---------------------------------------------------------------- player state
  const P = {};
  const keys = {};
  const state = { god: false };
  let lastClosed = "";

  function reset() {
    const s = G.nodes[startNode];
    Object.assign(P, { x: s[0], y: s[1], heading: startHeading, camH: startHeading, pitch: -0.05, camY: groundAt(s[0], s[1]) + EYE,
      walked: 0, steps: 0, minutes: START_MIN, done: false, success: false, node: startNode, anim: null, zoom: false,
      trail: [[s[0], s[1]]], lastMode: MODE.PATH, ferryLock: true, lastBump: 0, phase: "go", goals: new Set(GOAL0),
      visibility: T.challenge ? 0.6 : 1, declared: false, reasonScore: null, pointErr: null, treasureErr: null, text: TK.intro,
      announced: {} });
    const plan = planFrom(startNode, P.goals, START_MIN);
    P.solvable = !!plan; P.optMin = plan ? plan.minutes : 0; P.optLen = plan ? plan.len : 0;
    view.chest.group.visible = false;
    view.setVisibility(T.challenge ? 0.5 : 1, false);
    $("result").style.display = "none";
    parkBoat();
    syncBarriers();
    say(TK.intro);
    refreshStats();
    if (aiUI) aiUI.refresh();
  }

  function say(text) { P.text = text; $("msg").textContent = text; }

  function refreshStats() {
    $("steps").textContent = aiUI && aiUI.mode === "ai" ? `${P.steps} / ${TK.maxSteps}` : "–";
    $("walked").textContent = Math.round(P.walked * M_PER_UNIT);
  }

  function nearestNode(x, y) {
    let best = 0, bd = Infinity;
    G.nodes.forEach(([nx, ny], i) => { const d = Math.hypot(nx - x, ny - y); if (d < bd) { bd = d; best = i; } });
    return [best, bd];
  }

  /* Barrier meshes follow the clock: a schedule closure and a one-off closure carry different wording. */
  function syncBarriers() {
    const st = {};
    BARRIER_KEYS.forEach((k) => { st[k] = isOpen(k, P.minutes) ? null : force[k] === "closed" ? "forced" : "schedule"; });
    const sig = JSON.stringify(st);
    if (sig !== lastClosed) { lastClosed = sig; view.setClosed(st); }
  }

  function updateHint() {
    $("hint").innerHTML = aiUI.mode === "ai"
      ? "动作规则与 Python 环境一致：前进只沿与朝向相差 ≤35° 的高墙走廊走到下一个路口；轨站用「乘坐」；时钟按动作前进"
      : "<kbd>W</kbd><kbd>S</kbd> 前后 <kbd>A</kbd><kbd>D</kbd> 平移 <kbd>←</kbd><kbd>→</kbd>/拖动 转身 <kbd>Shift</kbd> 跑 " +
        "按住<kbd>F</kbd> 走近看 <kbd>Enter</kbd> 宣布到了 <kbd>X</kbd> 做不到 · 轨站往轨道方向走即可乘摆渡车 · 时钟随路程推进";
  }

  // ---------------------------------------------------------------- free walking
  function barrierAt(x, y) {
    for (const k of BARRIER_KEYS) {
      if (isOpen(k, P.minutes)) continue;
      if (W.barriers[k].some(([bx, by, r]) => Math.hypot(x - bx, y - by) < r)) return k;
    }
    return null;
  }

  function tryMove(nx, ny) {
    const cur = modeAt(P.x, P.y);
    const ok = (x, y) => {
      const m = modeAt(x, y);
      if (m === MODE.BLOCKED) return false;
      if (Math.abs(x - W.tea[0]) < 0.9 && Math.abs(y - W.tea[1]) < 0.6) return false;
      const b = barrierAt(x, y);
      if (b) {
        const now = performance.now();
        if (now - P.lastBump > 2500) { say(blockedText(b)); P.lastBump = now; }
        return false;
      }
      return Math.abs(groundAt(x, y) - groundAt(P.x, P.y)) < 0.25 || cur === MODE.BLOCKED;
    };
    let tx = null, ty = null;
    if (ok(nx, ny)) { tx = nx; ty = ny; } else if (ok(nx, P.y)) { tx = nx; ty = P.y; } else if (ok(P.x, ny)) { tx = P.x; ty = ny; }
    if (tx === null) return;
    const d = Math.hypot(tx - P.x, ty - P.y), dz = groundAt(tx, ty) - groundAt(P.x, P.y);
    P.walked += d;
    P.minutes += (d * M_PER_UNIT) / CK.walkMPerMin;
    if (modeAt(tx, ty) === MODE.TOWER || terrainH(tx, ty) > 0.001) P.minutes += Math.abs(dz) * M_PER_UNIT * (dz > 0 ? CK.climbUp : CK.climbDown);
    P.x = tx; P.y = ty;
    const last = P.trail[P.trail.length - 1];
    if (Math.hypot(last[0] - P.x, last[1] - P.y) > 0.3) P.trail.push([P.x, P.y]);
  }

  function freeUpdate(dt) {
    const turn = (keys.ArrowLeft ? 1 : 0) - (keys.ArrowRight ? 1 : 0) + (keys.q ? 1 : 0) - (keys.e ? 1 : 0);
    P.heading = (P.heading + turn * TURN_DEG * dt + 360) % 360;
    P.camH = P.heading;
    const fwd = (keys.w || keys.ArrowUp ? 1 : 0) - (keys.s || keys.ArrowDown ? 1 : 0);
    const side = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
    if (fwd || side) {
      const h = rad(P.heading), sp = (keys.Shift ? RUN : WALK) * dt;
      let mx = Math.cos(h) * fwd + Math.sin(h) * side, my = Math.sin(h) * fwd - Math.cos(h) * side;
      const n = Math.hypot(mx, my);
      mx = (mx / n) * sp; my = (my / n) * sp;
      const steps = Math.ceil(sp / 0.08);
      for (let k = 0; k < steps; k++) tryMove(P.x + mx / steps, P.y + my / steps);
      announceZone();
      checkDocks(fwd > 0 && !side);
      freeArrival();
    }
    P.zoom = !!keys.f;
  }

  function announceZone() {
    const m = modeAt(P.x, P.y);
    if (m === P.lastMode) return;
    P.lastMode = m;
    if (T.vision) return;
    const text = { 3: "走进了昏暗的地下暗渠。", 4: "走上了横跨滑轨深槽的高空连廊。", 2: "踏上了跨槽栈桥通道。", 6: "登上了中央瞭望塔顶，越过 20 米巨墙，全区尽收眼底。" }[m];
    if (text) say(text);
    if (Math.hypot(P.x - W.teaNode[0], P.y - W.teaNode[1]) < 1.6) say("来到核心终端舱门前，舱门铭牌上写着「CORE VAULT」（核心终端舱）。");
  }

  const nearNode = (n, r) => Math.hypot(P.x - G.nodes[n][0], P.y - G.nodes[n][1]) < r;
  const onIsland = () => Math.hypot(P.x - W.teaNode[0], P.y - W.teaNode[1]) < 1.6 || modeAt(P.x, P.y) === MODE.ISLAND;
  function reachedGoal() {
    if (TK.goalKind === "tea" && P.phase === "go") return onIsland();
    if (TK.goalKind === "tower") return modeAt(P.x, P.y) === MODE.TOWER && groundAt(P.x, P.y) > W.hill.h + 1.0;
    return [...P.goals].some((n) => nearNode(n, TK.friend ? 1.0 : 0.8));
  }

  /* Free-walk arrival rules per task kind (the AI mode uses explicit stop instead). */
  function freeArrival() {
    if (P.done || P.anim) return;
    if (TK.kind === "treasure" || TK.kind === "island") return;
    if (TK.kind === "homing" && P.phase === "go" && onIsland()) { say(beginReturn() + "（转身对准南门的方向，按 P 确认。）"); return; }
    if (TK.kind === "homing" && P.phase === "point") return;
    if (TK.kind === "lost") {
      const n = Object.keys(G.gates).map(Number).find((g) => nearNode(g, 0.8));
      if (n === undefined) return;
      const name = G.gates[n];
      if (P.minutes < gateClose[name]) { P.done = P.success = true; say(T.say(`你赶在落锁前从${name}冲出了迷宫。`, "你冲出了迷宫大门。")); finish(); return; }
      const now = performance.now();
      if (now - P.lastBump > 2500) { say(T.say(`${name}已经落锁封闭（${T.fmtMin(gateClose[name])} 关门），得换一扇大门。`, "巨门已经落锁，出不去。")); P.lastBump = now; }
      return;
    }
    if (reachedGoal()) { P.done = P.success = true; say(TK.friend ? "找到失联行者了！" : `到达${TK.goalName}。`); finish(); }
  }

  // ---------------------------------------------------------------- ferry between the two docks
  function parkBoat() {
    const e = G.edges[FERRY];
    const s = G.nodes[startNode];
    const nearB = Math.hypot(s[0] - G.nodes[e.b][0], s[1] - G.nodes[e.b][1]) < Math.hypot(s[0] - G.nodes[e.a][0], s[1] - G.nodes[e.a][1]);
    const pts = nearB ? e.pts.slice().reverse() : e.pts;
    const [x, y] = pointAt(pts, 0.75);
    const [x2, y2] = pointAt(pts, 1.0);
    view.boat.place(x, y, (Math.atan2(y2 - y, x2 - x) * 180) / Math.PI);
  }

  function checkDocks(forward) {
    const e = G.edges[FERRY];
    let near = null;
    [e.a, e.b].forEach((n) => { if (nearNode(n, 0.4)) near = n; });
    if (near === null) { P.ferryLock = false; return; }
    if (P.ferryLock || !forward) return;
    const exit = near === e.a ? e.exitA : e.exitB;
    if (Math.abs(angDiff(exit, P.heading)) > 60) return;
    P.ferryLock = true;
    const dep = nextDeparture(P.minutes);
    if (dep === null) { say(blockedText("ferry")); return; }
    const wait = Math.round(dep - P.minutes);
    P.node = near;
    P.minutes += edgeMinutes(FERRY, near, P.minutes);
    say(`${wait > 0 ? `等了 ${wait} 分钟，` : ""}${T.say("登上轨道摆渡车，轨车沿钢梁滑出月台……", "登上轨车……")}`);
    startAnim(FERRY, near, null);
  }

  // ---------------------------------------------------------------- AI action mode (mirrors ParkEnv.step)
  const walkDegree = (n) => G.adj[n].filter((i) => walkable(G.edges[i])).length;
  function where(n) {
    if (n === G.tower) return "登上了中央瞭望塔顶，越过 20 米巨墙，全区尽收眼底。";
    if (n === G.tea) return "来到核心终端舱门前，舱门铭牌上写着「CORE VAULT」（核心终端舱）。";
    if (G.gates[n]) return `到了迷宫扇区大门（${G.gates[n]}），再往前就出迷宫了。`;
    if (G.zigzagInner.indexOf(n) >= 0) return "停在二号防爆折廊的一个折角。";
    if (G.docks.indexOf(n) >= 0) return "来到深槽边的轨道摆渡站月台。";
    return N.junction(walkDegree(n));
  }

  /* Logic moves at once (exactly like Python); the camera then walks the edge and the text appears on arrival. */
  function traverse(eid, minutes) {
    const e = G.edges[eid], from = P.node;
    P.heading = e.a === from ? e.arriveB : e.arriveA;
    P.walked += e.len;
    P.minutes += minutes;
    P.node = e.a === from ? e.b : e.a;
    startAnim(eid, from, null);
  }

  function aiForward() {
    const eid = N.pickExit(G, P.node, P.heading, walkable);
    if (eid === null) return "正前方没有可以走的路。";
    const e = G.edges[eid];
    const dt = edgeMinutes(eid, P.node, P.minutes);
    if (dt === null) return blockedText(e.facility);
    const up = e.rise && ((P.node === e.a) === (e.rise > 0));
    traverse(eid, dt);
    const meters = Math.round((e.len * M_PER_UNIT) / 10) * 10;
    if (T.vision) return `往前走了约 ${meters} 米，${e.rise ? (up ? "一路上坡，" : "一路下坡，") : ""}${N.junction(walkDegree(P.node))}`;
    return `${W.travel[e.kind] || "沿着高墙走廊往前走"}，走了约 ${meters} 米，${where(P.node)}`;
  }

  function aiTransit() {
    const eid = G.adj[P.node].find((i) => G.edges[i].kind === "ferry");
    if (eid === undefined) return "这里没有可以乘坐的轨道摆渡车。";
    const dep = nextDeparture(P.minutes);
    if (dep === null) return blockedText("ferry");
    const wait = Math.round(dep - P.minutes), e = G.edges[eid];
    traverse(eid, edgeMinutes(eid, P.node, P.minutes));
    const meters = Math.round((e.len * M_PER_UNIT) / 10) * 10, waited = wait > 0 ? `等了 ${wait} 分钟，` : "";
    return T.say(`${waited}登上轨道摆渡车，沿槽道钢梁滑行约 ${meters} 米，停靠在对岸轨站。`, `${waited}登上轨车，沿轨道滑行约 ${meters} 米，停靠在对岸轨站。`);
  }

  function beginReturn() {
    P.phase = "point";
    P.minutes += TK.stay;
    P.visibility = 0.35;
    view.setVisibility(0.35, true);
    P.goals = new Set(TK.back);
    const plan = planFrom(P.node, P.goals, P.minutes);
    if (!plan) P.solvable = false; else { P.optMin += plan.minutes; P.optLen += plan.len; }
    syncBarriers();
    aiUI.refresh();
    return T.say("你在核心终端舱导出了一个小时日志，出来时 19:00 整点巨墙移位刚过，天已经黑了，深槽上起了雾。先别急着走：用 point(角度) 指出南门在哪个方向（相对你现在的朝向，左正右负）。",
      "过了一个小时，天黑了，巨墙间起了浓雾。先用 point(角度) 指出南门的方向（相对当前朝向，左正右负）。");
  }

  function doPoint(deg) {
    if (P.phase !== "point") return "现在不需要指方向。";
    const here = aiUI.mode === "ai" ? G.nodes[P.node] : [P.x, P.y];
    P.pointErr = Math.abs(angDiff((P.heading + (Number(deg) || 0) + 360) % 360, bearing(here, TK.pointTo)));
    P.phase = "back";
    aiUI.refresh();
    return "记下了你指的方向。现在回南门，到了南门 stop。";
  }

  function doDeclare(text) {
    P.done = P.declared = true;
    P.success = !P.solvable;
    P.reasonScore = T.reasonScore(BLOCKERS, String(text || ""));
    return "你宣布这个任务做不到。";
  }

  /* Two sight lines: the first pair must be front-then-back, the leading posts may overlap either way round. */
  function treasureErrors(x, y) {
    return TK.treasure.transits.map(([[, a], [, b]], i) => {
      const da = Math.hypot(a[0] - x, a[1] - y), db = Math.hypot(b[0] - x, b[1] - y);
      if (da < 2 || db < 2 || (i === 0 && da >= db)) return 180;
      return Math.abs(angDiff(bearing([x, y], a), bearing([x, y], b)));
    });
  }

  function doStop() {
    const n = P.node;
    if (TK.kind === "homing" && P.phase === "go" && P.goals.has(n)) return beginReturn();
    if (TK.kind === "lost" && G.gates[n]) {
      const name = G.gates[n];
      if (P.minutes < gateClose[name]) { P.done = P.success = true; return T.say(`你赶在落锁前从${name}冲出了迷宫。`, "你冲出了迷宫大门。"); }
      return T.say(`${name}已经落锁封闭（${T.fmtMin(gateClose[name])} 关门），得换一扇大门。`, "巨门已经落锁，出不去。");
    }
    P.done = true;
    P.success = P.goals.has(n) && TK.kind !== "lost";
    if (TK.kind === "treasure") P.treasureErr = treasureErrors(G.nodes[n][0], G.nodes[n][1]);
    return "你宣布已到达终点。";
  }

  function act(name, arg) {
    if (aiUI.mode !== "ai" || P.done || P.anim) return;
    P.steps += 1;
    P.zoom = false;
    let msg;
    if (P.phase === "point" && name !== "point" && name !== "declare_impossible") msg = "先用 point(角度) 指出南门的方向，再继续走。";
    else if (name === "turn_left" || name === "turn_right" || name === "turn_around") {
      const delta = name === "turn_left" ? 45 : name === "turn_right" ? -45 : 180;
      P.anim = { kind: "turn", from: P.heading, to: P.heading + delta, t: 0, dur: delta === 180 ? 0.5 : 0.3 };
      P.heading = (P.heading + delta + 360) % 360;
      msg = name === "turn_left" ? "向左转了 45°。" : name === "turn_right" ? "向右转了 45°。" : "原地掉头。";
    } else if (name === "look_closer") { P.minutes += CK.lookMin; P.zoom = true; msg = "你停下来，仔细看了看正前方。"; }
    else if (name === "forward") msg = aiForward();
    else if (name === "take_transit") msg = aiTransit();
    else if (name === "take_elevator") msg = "这里没有电梯。";
    else if (name === "point") msg = doPoint(arg);
    else if (name === "declare_impossible") msg = doDeclare(arg);
    else msg = doStop();
    if (!P.done && LAST_CLOSE !== null && P.minutes >= LAST_CLOSE) { P.done = true; msg += "所有的门都关了。"; }
    if (!P.done && P.steps >= TK.maxSteps) { P.done = true; msg += "步数用完，本局结束。"; }
    if (P.anim && P.anim.kind === "walk") { P.anim.msg = msg; say("……"); } else say(msg);
    if (P.done) { if (P.anim) P.anim.then = finish; else finish(); }
    syncBarriers();
    refreshStats();
    aiUI.refresh();
  }

  function startAnim(eid, from, msg) {
    const e = G.edges[eid];
    const pts = e.a === from ? e.pts : e.pts.slice().reverse();
    P.anim = { kind: "walk", pts, s: 0, len: e.len, to: e.a === from ? e.b : e.a, endHeading: e.a === from ? e.arriveB : e.arriveA, edge: e, msg };
  }

  function animUpdate(dt) {
    const a = P.anim;
    if (a.kind === "turn") {
      a.t += dt / a.dur;
      const t = smoothstep(0, 1, a.t);
      P.camH = ((a.from + (a.to - a.from) * t) % 360 + 360) % 360;
      if (a.t >= 1) { P.camH = P.heading; P.anim = null; }
      return;
    }
    const ferry = a.edge.kind === "ferry";
    a.s = Math.min(a.len, a.s + (ferry ? 2.2 : 3.2) * dt);
    const [x, y, i] = pointAt(a.pts, a.s);
    const seg = a.pts[Math.min(i + 1, a.pts.length - 1)];
    const want = (Math.atan2(seg[1] - a.pts[i][1], seg[0] - a.pts[i][0]) * 180) / Math.PI;
    P.camH = (P.camH + angDiff(want, P.camH) * Math.min(1, dt * 6) + 360) % 360;
    const last = P.trail[P.trail.length - 1];
    if (Math.hypot(last[0] - x, last[1] - y) > 0.3) P.trail.push([x, y]);
    P.x = x; P.y = y;
    if (ferry) view.boat.place(x - Math.cos(rad(P.camH)) * BOW, y - Math.sin(rad(P.camH)) * BOW, P.camH);
    if (a.s < a.len) return;
    const end = G.nodes[a.to];
    P.x = end[0]; P.y = end[1]; P.anim = null;
    if (aiUI.mode !== "ai") { P.heading = a.endHeading; P.walked += a.len; P.node = a.to; }
    P.camH = P.heading;
    if (ferry) {
      const [bx, by] = pointAt(a.pts, a.len - 0.75);
      view.boat.place(bx, by, P.heading + 180);
      P.ferryLock = true;
      if (aiUI.mode !== "ai") say(T.say("轨道摆渡车停靠在对岸轨站月台。", "停靠对岸轨站了。"));
    }
    if (a.msg) say(a.msg);
    if (a.then) a.then();
    refreshStats();
  }

  // ---------------------------------------------------------------- finishing
  function finish() {
    if ($("result").style.display === "block") return;
    P.done = true;
    if (P.success && TK.kind === "treasure") view.chest.place(P.x + Math.cos(rad(P.heading)) * 0.3, P.y + Math.sin(rad(P.heading)) * 0.3);
    const ai = aiUI.mode === "ai";
    const walked = Math.max(P.walked, 1e-6), opt = P.optLen;
    const spl = P.success && opt > 0 ? opt / Math.max(walked, opt) : 0;
    const used = P.minutes - START_MIN;
    const rows = [["模式", ai ? `AI 动作模式 · ${T.vision ? "纯视觉" : "图文"}` : "自由行走"]];
    if (ai) rows.push(["动作步数", `${P.steps}`]);
    if (P.declared) {
      rows.push(["你的判断", "做不到"], ["实际情况", P.solvable ? "其实走得通" : "确实去不了"],
        ["原因得分", `${Math.round(P.reasonScore * 100)}%（该写到：${BLOCKERS.map((w) => w[0]).join("、") || "—"}）`]);
    } else {
      rows.push(["实际路程", `${Math.round(P.walked * M_PER_UNIT)} 米`],
        ["最快路线", P.solvable ? `${Math.round(opt * M_PER_UNIT)} 米 · ${Math.round(P.optMin)} 分钟` : "无（这题去不了）"],
        ["SPL", spl.toFixed(2)]);
    }
    rows.push(["游戏用时", `${Math.round(used)} 分钟（${TK.time} → ${T.fmtMin(P.minutes)}）`]);
    if (P.pointErr !== null) rows.push(["指向南门", `偏了 ${Math.round(P.pointErr)}°`]);
    if (P.treasureErr) rows.push(["两条视线", P.treasureErr.map((e) => (e >= 180 ? "没对上" : `差 ${e.toFixed(1)}°`)).join(" / ")]);
    if (T.challenge) rows.push(["今天关闭", FAC_KEYS.filter((k) => !usable(k, START_MIN)).map((k) => FAC[k].name).join("、") || "无"]);
    const title = P.success ? (P.declared ? "判断正确：确实被锁死 ✓" : TK.kind === "treasure" ? "找到应急密钥箱了 ✓" : `完成：${TK.goalName} ✓`)
      : P.declared ? "判断错了：其实走得通" : "未完成";
    $("result").innerHTML = T.resultHTML(title, rows, P.success, used * 10, P.walked * M_PER_UNIT);
    $("result").style.display = "block";
    T.bindResult(reset, () => { if (!state.god) toggleGod(); });
    refreshStats();
  }

  function openDeclare() {
    if (P.done || P.anim) return;
    T.declare(DECLARE_OPTIONS, (picked) => {
      const text = picked.join("、");
      if (aiUI.mode === "ai") act("declare_impossible", text);
      else { say(doDeclare(text)); finish(); }
    });
  }

  function freeStop() {
    if (P.done || P.anim) return;
    if (TK.kind === "treasure") {
      P.treasureErr = treasureErrors(P.x, P.y);
      P.success = P.treasureErr.every((e) => e <= TK.treasure.tol);
      P.done = true;
      say(P.success ? "你脚下的金属格栅松动了……取出了应急密钥箱！" : "你检查了脚下的格栅，这里没有密钥箱。");
      finish();
      return;
    }
    P.done = true;
    P.success = reachedGoal() && TK.kind !== "lost" && TK.kind !== "homing";
    say("你宣布已到达终点。");
    finish();
  }

  // ---------------------------------------------------------------- god view
  const godCanvas = $("god");
  const godCtx = godCanvas.getContext("2d");
  const godBase = document.createElement("canvas");
  godBase.width = godCanvas.width; godBase.height = godCanvas.height;
  const gx = (x) => ((x + 1) / 102) * godCanvas.width, gy = (y) => godCanvas.height - ((y + 2) / 73) * godCanvas.height;

  (function drawGodBase() {
    const c = godBase.getContext("2d");
    c.fillStyle = "#10161c"; c.fillRect(0, 0, godBase.width, godBase.height);
    const poly = (pts, fill, stroke) => {
      c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(gx(x), gy(y)) : c.moveTo(gx(x), gy(y))));
      c.closePath(); c.fillStyle = fill; c.fill(); if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); }
    };
    const line = (pts, color, w, dash) => {
      c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(gx(x), gy(y)) : c.moveTo(gx(x), gy(y))));
      c.setLineDash(dash || []);
      c.strokeStyle = color; c.lineWidth = w; c.lineCap = "round"; c.lineJoin = "round"; c.stroke();
      c.setLineDash([]);
    };
    poly(W.boundary, "#1c242d", "#455a64"); poly(W.wetland, "#161e26"); poly(W.lake, "#0d283a", "#29b6f6");
    poly(W.island, "#263238"); poly(W.bird, "#263238");
    W.paths.concat([W.spiral]).forEach((p) => line(p, "#90a4ae", 2.2));
    W.maze.forEach((p) => line(p, "#ffb74d", 1.6));
    line(W.road, "#37474f", 7);
    line(W.zigzag, "#ff7043", 2.2); line(W.longBridge, "#cfd8dc", 2.2);
    line(W.underpass, "#78909c", 2); line(W.overpass, "#eceff1", 3);
    line(G.edges[FERRY].pts, usable("ferry", START_MIN) ? "#29b6f6" : "#546e7a", 1.5, [4, 3]);
    c.fillStyle = "#29b6f6"; W.signs.forEach(([x, y]) => c.fillRect(gx(x) - 2, gy(y) - 2, 4, 4));
    c.fillStyle = "#ff5252"; W.leadPosts.forEach(([x, y]) => c.fillRect(gx(x) - 1.5, gy(y) - 1.5, 3, 3));
  })();

  function drawGod() {
    godCtx.drawImage(godBase, 0, 0);
    godCtx.strokeStyle = "#e53935"; godCtx.lineWidth = 2.5;
    BARRIER_KEYS.forEach((k) => {
      if (isOpen(k, P.minutes)) return;
      W.barriers[k].forEach(([bx, by]) => {
        godCtx.beginPath(); godCtx.moveTo(gx(bx) - 4, gy(by) - 4); godCtx.lineTo(gx(bx) + 4, gy(by) + 4);
        godCtx.moveTo(gx(bx) + 4, gy(by) - 4); godCtx.lineTo(gx(bx) - 4, gy(by) + 4); godCtx.stroke();
      });
    });
    godCtx.fillStyle = "#d81b60"; godCtx.font = "16px sans-serif"; godCtx.textAlign = "center"; godCtx.textBaseline = "middle";
    const star = TK.goalKind === "tea" && P.phase === "go" ? [W.tea[0], W.tea[1] + 3] : G.nodes[[...P.goals][0]];
    if (TK.kind !== "lost") godCtx.fillText("★", gx(star[0]), gy(star[1]));
    else Object.keys(G.gates).forEach((n) => godCtx.fillText(P.minutes < gateClose[G.gates[n]] ? "★" : "✕", gx(G.nodes[n][0]), gy(G.nodes[n][1])));
    godCtx.beginPath();
    P.trail.concat([[P.x, P.y]]).forEach(([x, y], i) => (i ? godCtx.lineTo(gx(x), gy(y)) : godCtx.moveTo(gx(x), gy(y))));
    godCtx.strokeStyle = "#ff6d00"; godCtx.lineWidth = 2.5; godCtx.stroke();
    const h = rad(P.camH), px = gx(P.x), py = gy(P.y);
    godCtx.beginPath();
    godCtx.moveTo(px + Math.cos(h) * 9, py - Math.sin(h) * 9);
    godCtx.lineTo(px + Math.cos(h + 2.5) * 6, py - Math.sin(h + 2.5) * 6);
    godCtx.lineTo(px + Math.cos(h - 2.5) * 6, py - Math.sin(h - 2.5) * 6);
    godCtx.closePath(); godCtx.fillStyle = "#ff6d00"; godCtx.fill();
    godCtx.strokeStyle = "#fff"; godCtx.lineWidth = 1.5; godCtx.stroke();
  }

  function toggleGod() {
    if (!state.god && T.godLocked(P.done)) { say("挑战模式：上帝视角要到结算后才能看。"); return; }
    state.god = !state.god;
    $("godwrap").style.display = state.god ? "block" : "none";
    $("godBtn").classList.toggle("on", state.god);
  }

  // ---------------------------------------------------------------- input
  const aiUI = N.ui({
    onAction: act,
    onDeclare: openDeclare,
    canSwitch: () => !P.anim && !P.done,
    onMode(mode) {
      if (mode === "ai") {
        const [n, d] = nearestNode(P.x, P.y);
        if (d > 0.05) { P.walked += d; P.minutes += (d * M_PER_UNIT) / CK.walkMPerMin; P.x = G.nodes[n][0]; P.y = G.nodes[n][1]; P.trail.push([P.x, P.y]); }
        P.node = n; P.steps = 0; P.pitch = -0.05; P.camH = P.heading;
        say("AI 动作模式：和 AI 一样只能用离散动作，每次前进走到下一个路口；时钟按动作前进。");
      } else {
        P.zoom = false;
        say("自由行走：W/S 前后，A/D 平移，←/→ 或鼠标拖动转身，按住 F 走近看。");
      }
      updateHint();
      refreshStats();
    },
    state: () => ({ transit: G.adj[P.node] && G.adj[P.node].some((i) => G.edges[i].kind === "ferry"), pointing: P.phase === "point" }),
  });

  window.addEventListener("keydown", (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === "g") return toggleGod();
    if (k === "r") return reset();
    if (aiUI.mode === "ai") return;
    if (k === "Enter") return freeStop();
    if (k === "x") return openDeclare();
    if (k === "p" && P.phase === "point" && !P.done) { say(doPoint(0)); return; }
    keys[k] = true;
    if (k.startsWith("Arrow") || k === " ") e.preventDefault();
  });
  window.addEventListener("keyup", (e) => { keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false; });
  window.addEventListener("blur", () => Object.keys(keys).forEach((k) => (keys[k] = false)));

  let drag = null;
  canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointerup", () => { drag = null; });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag || aiUI.mode === "ai" || P.done || P.anim) return;
    P.heading = (P.heading - (e.clientX - drag.x) * 0.25 + 360) % 360;
    P.pitch = Math.min(0.5, Math.max(-0.7, P.pitch - (e.clientY - drag.y) * 0.003));
    drag = { x: e.clientX, y: e.clientY };
  });

  $("godBtn").onclick = toggleGod;
  $("resetBtn").onclick = reset;
  $("task").innerHTML = T.card([["起点", TK.startName], ["目标", TK.goalName], ["出发时间", TK.time],
    ["步数上限", `${TK.maxSteps}（AI 动作模式）`], ["规则", W.rules]]);
  if (PHOTO) T.photo(PHOTO);
  const declBtn = $("declBtn");
  if (declBtn) declBtn.onclick = openDeclare;

  // ---------------------------------------------------------------- main loop
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);

  function step(dt) {
    if (P.anim) animUpdate(dt);
    else if (!P.done && aiUI.mode === "free") freeUpdate(dt);
    if (aiUI.mode === "free" && !P.done && LAST_CLOSE !== null && P.minutes >= LAST_CLOSE) { P.done = true; say("所有的门都关了。"); finish(); }
    syncBarriers();
  }

  const camY = () => {
    const onBoat = P.anim && P.anim.edge && P.anim.edge.kind === "ferry";
    return onBoat ? BOAT_EYE : groundAt(P.x, P.y) + EYE;
  };
  let lastT = performance.now();
  /* Photoreal frames: Blender panoramas at the graph nodes for this task's look (tex/park_pano, see scene.js pano); used whenever
     the AI-mode player stands at a node that has one. ?pano=0 keeps the real-time render. */
  const PANO_LIST = new URLSearchParams(location.search).get("pano") !== "0" && window.SA_PANOS && window.SA_PANOS[TK.look] || [];
  /* only a complete set: one look must not mix panoramas and real-time frames */
  const PANO_NODES = PANO_LIST.length >= G.nodes.length ? PANO_LIST : [];
  const panoUrl = (n, kind) => `tex/park_pano/node_${String(n).padStart(3, "0")}_${TK.look}${kind}`;
  const atPano = () => aiUI.mode === "ai" && !P.anim && view.pano.has(P.node);

  let frameCount = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    step(dt);
    P.camY += (camY() - P.camY) * Math.min(1, dt * 10);
    camera.position.copy(v3(P.x, P.y, P.camY));
    camera.rotation.y = rad(P.camH - 90);
    camera.rotation.x = P.pitch;
    const fov = P.zoom ? ZOOM_FOV : FOV;
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 12); camera.updateProjectionMatrix(); }
    refreshStats();
    T.showClock(P.minutes);
    if (++frameCount <= 3 || aiUI.mode !== "ai" || P.anim || window.__VT) {
      view.update(dt, now / 1000);
      if (!(atPano() && view.pano.draw(camera, P.node))) view.render(camera);
      if (state.god) drawGod();
    }
    requestAnimationFrame(frame);
  }

  function info() {
    const opt = P.optLen, spl = P.success && opt > 0 ? opt / Math.max(P.walked, opt) : 0;
    const d = { success: P.success, steps: P.steps, walked_m: Math.round(P.walked * M_PER_UNIT), optimal_m: Math.round(opt * M_PER_UNIT),
      spl: Math.round(spl * 1000) / 1000, clock: T.fmtMin(P.minutes), elapsed_min: Math.round((P.minutes - START_MIN) * 10) / 10,
      optimal_min: Math.round(P.optMin * 10) / 10, place: G.names[P.node] || G.gates[P.node] || "刀片迷阵深处", solvable: P.solvable, phase: P.phase };
    if (P.pointErr !== null) d.point_error_deg = Math.round(P.pointErr * 10) / 10;
    if (P.declared) { d.declared_impossible = true; d.reason_score = P.reasonScore; }
    if (T.challenge) d.closed_today = Object.keys(force).filter((k) => force[k] === "closed").sort();
    return d;
  }

  function oracleActions() {
    if (P.phase === "point") return [["point", Math.round(angDiff(bearing(G.nodes[P.node], TK.pointTo), P.heading) * 10) / 10]];
    if (!P.solvable) return [["declare_impossible", BLOCKERS.map((w) => w[0]).join("、") + "都走不通"]];
    const plan = planFrom(P.node, P.goals, P.minutes);
    if (!plan) return ["stop"];
    return N.oracle(G, plan.path, P.heading, walkable, (e) => (e.kind === "ferry" ? "take_transit" : null)).concat(["stop"]);
  }

  window.SPACEACT = {
    player: P,
    task: TK,
    scene: view.scene,
    force: () => Object.assign({}, force),
    teleport(x, y, heading) { Object.assign(P, { x, y, heading, camH: heading, camY: groundAt(x, y) + EYE, anim: null, ferryLock: false }); },
    simulate(held, seconds) {
      held.forEach((k) => (keys[k] = true));
      for (let t = 0; t < seconds; t += 0.05) step(0.05);
      held.forEach((k) => (keys[k] = false));
      return { x: +P.x.toFixed(2), y: +P.y.toFixed(2), node: P.node, anim: P.anim && P.anim.edge ? P.anim.edge.kind : P.anim && P.anim.kind,
        done: P.done, success: P.success, clock: T.fmtMin(P.minutes), phase: P.phase, msg: $("msg").textContent };
    },
    act, setMode: (m) => aiUI.setMode(m), oracle: oracleActions, info, freeStop,
    shot: (x, y, heading, pitch, w, h) => view.snapshot(x, y, groundAt(x, y) + EYE, heading, pitch, BENCH_FOV, w, h, "image/png"),
    env: N.exposeEnv({
      reset, setMode: (m) => aiUI.setMode(m), act, busy: () => !!P.anim, tick: step, done: () => P.done, info,
      text: () => `${P.text}（${T.fmtMin(P.minutes)}）`,
      frame: (w, h, mime) => {
        const args = [P.x, P.y, groundAt(P.x, P.y) + EYE, P.heading, -0.05, P.zoom ? BENCH_ZOOM_FOV : BENCH_FOV, w, h, mime];
        return (atPano() && view.pano.shot(P.node, ...args)) || view.snapshot(...args);
      },
      photo: () => PHOTO,
      taskCard: () => ({ scene: "park", id: TK.id, title: TK.title, intro: TK.intro, rules: W.rules, actions: W.actions, maxSteps: TK.maxSteps,
        obs: T.obs, challenge: T.challenge, seed: T.seed, startTime: TK.time }),
    }),
  };

  resize();
  reset();
  updateHint();
  view.ready.then(() => view.pano.load(PANO_NODES, panoUrl)).then(() => {
    if (TK.friend) {
      const [fx, fy, fh] = TK.friend;
      view.friend.group.visible = false;
      const real = PANO_NODES.length && window.SA_PANOS.photos && window.SA_PANOS.photos[TK.id];
      PHOTO = real || view.snapshot(fx, fy, groundAt(fx, fy) + EYE, fh, -0.03, BENCH_FOV, 960, 540);
      view.friend.group.visible = true;
      T.photo(PHOTO);
    }
    $("loading").style.display = "none";
    requestAnimationFrame(frame);
  });
})();
