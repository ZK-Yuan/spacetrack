/* 雾岭疗养院 · AI action mode: the discrete actions of the other Space Track scenes (env/park_env.py, web/nav.js) on the
   sanatorium's navigation graph, the env API used by bench/runner.js, task cards with step budgets, and an oracle.
   "forward" walks from one stop to the next (junctions, stairs, doors, items, hides, safe rooms, exits; corridor
   nodes in between are walked through). The world is paused between actions; each action advances it by the time
   the action takes, so the matron keeps patrolling, hearing and chasing while the agent thinks.

   Goal kinds: an item key (interact at its node), "sister", "power", "exit" (walk out with her), "reach" (stop at the
   node), "hide" (interact to get into that hide), "survive" (be alive at task.until seconds) and "blocker" (the task
   cannot be done: declare_impossible(reason) after seeing one of task.blockerNodes, the reason naming every group of
   task.blockers). Tasks with a photo show the agent a picture taken at the goal (env.photo, given once at reset).

   Anti-hack hardening:
   - ?eval=1 hides oracle(), graph, debug hooks, and intermediate ground-truth fields in info(), and blocks reset-scumming.
   - ?obs=vision_only strips room/zone names and remote semantic spoilers from text observations.
   - Every call (including unknown or blocked actions) costs 1 step + advances clock; consecutive invalid actions or clock
     timeout terminate the episode.
   - declare_impossible reasons are cut to 80 characters; declaring on a task that can be done fails it.
   - ?perturb=1&seed=N applies seed-controlled isomorphic perturbations (start heading rotation, the sister's room with
     every clue rewritten to match, the photo's room) and records causal clue audit flags. */
(function () {
  "use strict";
  const S = (window.SANA = window.SANA || {});
  const AM = (S.AIMode = {});
  const NAV = window.SANav;
  const Q = new URLSearchParams(location.search);
  const EVAL = Q.has("eval");
  const VISION_ONLY = (Q.get("obs") || "multimodal") === "vision_only";
  const SEED = (+Q.get("seed") || 1934) >>> 0;
  const PERTURB = Q.has("perturb") || ((EVAL || Q.get("challenge") === "1") && Q.has("seed") && SEED !== 1934);
  const SPEED = { walk: 1.4, escort: 0.9, run: 3.0 };
  const STOP_KINDS = new Set(["item", "hide", "safe", "exit", "start", "stair", "door", "lift"]);
  const REACH = 3.0, NOTE_REACH = 8.5, BLOCKER_REACH = 4.6, REASON_MAX = 80;
  const TASKS = [
    { id: "sister", title: "找到妹妹", start: "Y_start", h: 10, goals: [["N3_307", "sister"]], maxSteps: 75, maxClock: 600,
      intro: "你从庭院围墙的破洞进来。妹妹最后一条短信说她躲在 307。找到她并叫醒她（互动）。" },
    { id: "fuse", title: "拿到保险丝", start: "Y_start", h: 10, goals: [["S1_theatre", "fuse"]], maxSteps: 45, maxClock: 420,
      intro: "锅炉房的电动后门缺一枚保险丝，它在旧手术室。找到并拿上它。" },
    { id: "escape", title: "带妹妹从后门离开", start: "N3_307", h: 90, give: ["fuse"], sister: true,
      goals: [["B_panel", "power"], ["B_gate", "exit"]], maxSteps: 60, maxClock: 720,
      intro: "你在新楼 307，妹妹跟着你，口袋里有保险丝。太平间的运尸隧道通到山下锅炉房：装上保险丝，从电动后门出去。" },
    { id: "escape_main", title: "带妹妹从正门离开", start: "N3_307", h: 90, sister: true,
      goals: [["N6_director", "K1"], ["F_gate", "exit"]], maxSteps: 115, maxClock: 900,
      intro: "你在新楼 307，妹妹跟着你。正门的铁链钥匙在院长办公室，拿到后从圆厅正门沿车道出去。" },
    { id: "full", title: "全程：找到妹妹并从后门离开", start: "Y_start", h: 10,
      goals: [["S1_theatre", "fuse"], ["N3_307", "sister"], ["B_panel", "power"], ["B_gate", "exit"]], maxSteps: 170, maxClock: 1200,
      intro: "从围墙破洞进来：拿到保险丝，找到 307 的妹妹，带她走运尸隧道下山，装上保险丝，从后门离开。" },
    // the old wing's A2 stair stops at 2F and the latch doors from the rotunda only open from the ward side
    { id: "phone", title: "妹妹的手机", start: "Y_start", h: 10, goals: [["A3_deck", "phone", "捡起妹妹的手机"]], maxSteps: 75, maxClock: 600,
      intro: "妹妹说她逃跑的时候把手机掉在了老楼（病区翼）三楼尽头的晒台上。从围墙破洞进去，找到手机捡起来（互动）。" },
    // new 2F is level with old 3F: from the morgue up to the skybridge, then one floor down in the rotunda
    { id: "records", title: "档案室的病历", start: "N0_tunnel", h: 50,
      goals: [["N0_morgue", "K2", "拿到档案室钥匙"], ["S2_archive", "records", "在档案室拿到病历"]], maxSteps: 70, maxClock: 720,
      intro: "你从运尸隧道爬上来，站在新楼 B1 的隧道口。1957 年的病历锁在服务翼 2F 的档案室，档案室钥匙在太平间。先拿到钥匙，再去档案室拿到病历（互动）。" },
    { id: "hill", title: "走后山回小教堂", start: "B_in", h: 270, goals: [["Y_chapel", "reach", "回到小教堂"]], maxSteps: 35, maxClock: 480,
      intro: "你顺着运尸隧道下到了山脚的锅炉房，可隧道里传来鞋跟声，不能原路回去。从后山小门出去，沿石阶爬回庭院，躲进小教堂（安全屋），到了 stop。" },
    // floor4 cannot be done (the 4F stair door is burnt shut, the west stair ends at 3F, the lifts have no power and skip 4F);
    // floor5 takes the same stair past it and can
    { id: "floor4", title: "四楼的值班记录", start: "N2_sky", h: 90, goals: [["N4_sE", "blocker", "上新楼 4F"]], impossible: true,
      blockerNodes: ["N4_sE"], blockers: [["4F", "4 楼", "4楼", "四楼", "4 层", "4层", "四层"], ["烧", "火", "封", "变形", "打不开", "进不去", "锁", "堵"]],
      declare: "新楼 4F 楼梯间的门被火烧变形打不开，西梯只到 3F，电梯没电，上不了 4F", maxSteps: 30, maxClock: 480,
      intro: "你刚过空中连廊，站在新楼 2F 的连廊口。1957 年的值班记录放在新楼 4F 的护士站。去 4F 拿到它；如果判断根本上不去，就用 declare_impossible(原因) 说明。" },
    { id: "floor5", title: "五楼的更衣柜", start: "N2_sky", h: 90, goals: [["N5_lockers", "hide", "躲进 5F 职工更衣室的柜子"]], maxSteps: 40, maxClock: 480,
      intro: "你刚过空中连廊，站在新楼 2F 的连廊口。去新楼 5F 的职工更衣室，躲进柜子里（互动）；如果判断根本上不去，就用 declare_impossible(原因) 说明。" },
    // the green exit line ends at the chained north door; the way out is the ER's ambulance door (push bar on the inside)
    { id: "exit_sign", title: "绿色出口线", start: "N1_sE", h: 270, sister: true, goals: [["Y_fs", "reach", "带妹妹到庭院喷泉边"]], maxSteps: 30, maxClock: 480,
      intro: "你带着妹妹刚从东楼梯下到新楼 1F，地上的绿色出口线指向门厅。带她离开新楼，走到庭院中间的干涸喷泉边，到了 stop。" },
    // she starts 20 m away and chasing: walking or hiding in sight gets you caught, running to the radio room does not
    { id: "evade", title: "甩掉护士长", start: "A2_c7", h: 200, goals: [["R2_radio", "survive", "活过 60 秒"]], until: 60, run: true,
      matron: { at: "A2_c11", state: "chase" }, maxSteps: 25, maxClock: 120,
      intro: "你在老楼 2F 走廊，护士长就在前面，她已经看见你了。撑过接下来的 60 秒，被她抓住就结束。她进不了礼拜堂和广播室；run 比 forward 快，但脚步声更响；wait(秒) 原地等待。" },
    { id: "photo", title: "照片里的房间", start: "Y_start", h: 10, goals: [["S2_xray", "reach", "找到照片里的地方"]], photo: { node: "S2_xray", h: 205, back: 1.2 },
      maxSteps: 60, maxClock: 600,
      intro: "妹妹的朋友躲在疗养院里，只发来一张照片（任务图），说他就在照片里这个房间。找到拍这张照片的地方，到了 stop。" },
    { id: "homing", title: "原路返回", start: "Y_start", h: 10, goals: [["S1_theatre", "fuse"], ["Y_start", "reach", "回到围墙破洞"]], maxSteps: 85, maxClock: 900,
      intro: "先去旧手术室拿到保险丝，再回到你进来时的围墙破洞，到了 stop。" },
  ];
  AM.TASKS = TASKS;
  const NEXT = { sister: "找到妹妹", fuse: "拿到保险丝", power: "在锅炉房装上保险丝", K1: "拿到大门钥匙", K2: "拿到档案室钥匙", phone: "拿到手机",
    records: "拿到病历", exit: "带妹妹出去", reach: "到达目的地", hide: "躲起来", survive: "活下去", blocker: "完成任务" };
  let G, D, P, ST, graph, task, steps = 0, walked = 0, lastText = "", events = [], doneFlag = false, success = false, startSnap, photoURL = null;
  let invalidStreak = 0, totalInvalid = 0, resetCount = 0, readyForEval = false;
  let reached = new Set(), declared = null, reasonScore = 0, seenBlocker = false, falseImpossible = false, tried = new Set();
  let audit = { visited_nodes: [], actions: [], clues_read: [], perturbed: false, sister_room: "N3_307", start_h: 10, suspect_unseen_canary: false };

  /* ---------------------------------------------------------------- stop graph */
  function buildGraph() {
    const nodes = D.nav.nodes, edges = D.nav.edges;
    const adj = nodes.map(() => []);
    edges.forEach((e, i) => { if (e.k === "elevator" || e.k === "chute" || e.k === "sealed") return; adj[e.a].push(i); adj[e.b].push(i); });
    // every room an item can be in (the sister and the photo move with the seed) is a stop, so walking never carries you past it
    const held = new Set(D.nav.items.map((it) => it.node).concat(SISTER_VARIANTS.map((v) => v.node), PHOTO_VARIANTS.map((v) => v.node),
      FUSE_VARIANTS.map((v) => v.node), KEY2_VARIANTS.map((v) => v.node)));
    const stop = nodes.map((n, i) => STOP_KINDS.has(n.k) || adj[i].length !== 2 || held.has(n.id));
    const g = { nodes: nodes.map((n) => ({ p: n.p, id: n.id, k: n.k, label: n.label })), edges: [], stop, idx: {} };
    nodes.forEach((n, i) => { g.idx[n.id] = i; });
    const seen = new Set();
    nodes.forEach((n, i) => {
      if (!stop[i]) return;
      for (const e0 of adj[i]) {
        let from = i, e = e0, end = i;
        const navs = [];
        let pts = [];
        for (let guard = 0; guard < 400; guard++) {
          const E = edges[e], fwd = E.a === from, path = fwd ? E.path : E.path.slice().reverse();
          navs.push([e, fwd]);
          pts = pts.length ? pts.concat(path.slice(1)) : path.slice();
          const to = fwd ? E.b : E.a;
          if (stop[to]) { end = to; break; }
          const nxt = adj[to].find((x) => x !== e);
          if (nxt === undefined) { end = to; break; }
          from = to; e = nxt;
        }
        const key = navs.map((x) => x[0]).sort((a, b) => a - b).join(",") + "|" + Math.min(i, end) + "," + Math.max(i, end);
        if (seen.has(key)) continue;
        seen.add(key);
        g.edges.push({ a: i, b: end, pts, navs, len: NAV.polyLen(pts) });
      }
    });
    NAV.prepare(g);
    return g;
  }
  function runOf(eid, from) {
    const e = graph.edges[eid];
    if (e.a === from) return { to: e.b, pts: e.pts, navs: e.navs };
    return { to: e.a, pts: e.pts.slice().reverse(), navs: e.navs.slice().reverse().map(([n, f]) => [n, !f]) };
  }
  const nodeId = () => graph.nodes[P.node] && graph.nodes[P.node].id;

  /* ---------------------------------------------------------------- rules on the way */
  function doorOf(navEdge) { return G.doors().find((dr) => dr.d.edge === navEdge); }
  function sideOf(dr, x, y) { return (x - dr.d.p[0]) * dr.nx + (y - dr.d.p[1]) * dr.ny > 0 ? 1 : -1; }
  function passNav(navEdge, fwd, st, fromXY) {
    const E = D.nav.edges[navEdge];
    if (E.k === "elevator" || E.k === "chute" || E.k === "sealed") return { ok: false, why: "这里走不过去" };
    if (E.ow === 1 && !fwd) return { ok: false, why: E.label || "这条路只能单向走" };
    const dr = doorOf(navEdge);
    if (!dr || dr.open) return { ok: true };
    const d = dr.d, sd = sideOf(dr, fromXY[0], fromXY[1]);
    if (d.k === "shortcut") return sd === d.side ? { ok: true, door: dr, keep: true } : { ok: false, why: "这扇门从这边打不开" };
    if (d.k === "oneway") return sd === d.side ? { ok: true, door: dr } : { ok: false, why: "门这边没有把手" };
    if (d.k === "key" || d.k === "chain") return st.items.has(d.need) ? { ok: true, door: dr, keep: true } : { ok: false, why: d.label };
    if (d.k === "power") return st.power && st.sister ? { ok: true, door: dr, keep: true } : { ok: false, why: st.power ? "妹妹还在楼里" : d.label };
    return { ok: false, why: d.label || "打不开" };
  }
  function passRun(eid, from, st) {
    const r = runOf(eid, from);
    let at = graph.nodes[from].p;
    for (const [n, f] of r.navs) {
      const res = passNav(n, f, st, at);
      if (!res.ok) return res;
      const E = D.nav.edges[n];
      at = D.nav.nodes[f ? E.b : E.a].p;
    }
    return { ok: true };
  }

  /* ---------------------------------------------------------------- world time */
  function sim(seconds) {
    const n = Math.max(1, Math.round(seconds / 0.1));
    for (let i = 0; i < n && ST.mode === "play"; i++) G.simTick(seconds / n);
  }
  function runLength(pts) {
    let s = 0;
    for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], (pts[i][2] - pts[i - 1][2]) * 0.5);
    return s;
  }
  function walkRun(eid, mode) {
    const from = P.node, r = runOf(eid, from);
    const v = ST.sister ? SPEED.escort : SPEED[mode] || SPEED.walk;
    const pts = r.pts;
    let seg = 0, t = 0, stepAcc = 0;
    const opened = new Set();
    const openDoors = () => {
      for (const [n, f] of r.navs) {
        const dr = doorOf(n);
        if (!dr || dr.open || opened.has(n)) continue;
        if (Math.hypot(dr.d.p[0] - P.x, dr.d.p[1] - P.y) > 1.6) continue;
        const res = passNav(n, f, { items: ST.items, power: ST.power, sister: ST.sister }, [P.x, P.y]);
        if (res.ok && res.door) {
          G.setDoorOpen(dr, true, -sideOf(dr, P.x, P.y));
          if (res.keep) ST.opened.add(dr.d.id); else dr.autoClose = 4;
          opened.add(n);
          events.push(res.keep ? "你打开了门。" : "你推开了门。");
        }
      }
    };
    while (seg < pts.length - 1 && ST.mode === "play") {
      const a = pts[seg], b = pts[seg + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1], (b[2] - a[2]) * 0.5) || 1e-6;
      const dt = 0.1, step = v * dt;
      t += step / L;
      const tt = Math.min(1, t);
      P.x = a[0] + (b[0] - a[0]) * tt; P.y = a[1] + (b[1] - a[1]) * tt; P.z = P.zt = a[2] + (b[2] - a[2]) * tt;
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.05) P.h = NAV.headingOf(b[0] - a[0], b[1] - a[1]);
      walked += step; ST.dist += step; stepAcc += step;
      P.trail.push([P.x, P.y, P.z]);
      if (P.trail.length > 400) P.trail.shift();
      if (stepAcc > 0.75) { stepAcc = 0; if (S.AI) S.AI.noise([P.x, P.y, P.z], mode === "run" && !ST.sister ? 16 : 5.5, mode === "run" ? "run" : "walk"); }
      openDoors();
      G.simTick(dt);
      if (tt >= 1) { seg++; t = 0; }
    }
    if (ST.mode === "play") {
      P.node = r.to;
      const n = graph.nodes[r.to];
      P.x = n.p[0]; P.y = n.p[1]; P.z = P.zt = n.p[2];
      P.h = NAV.arriveOf(graph.edges[eid], from);
      if (n.id) audit.visited_nodes.push(n.id);
    }
  }

  /* ---------------------------------------------------------------- goals */
  function goalDone(g) {
    const k = g[1];
    if (k === "sister") return ST.met;
    if (k === "fuse") return ST.items.has("fuse") || ST.power;
    if (k === "power") return ST.power;
    if (k === "exit") return ST.mode === "win";
    if (k === "reach") return reached.has(g[0]);
    if (k === "hide") return !!P.hidden && P.hidden.id === g[0];
    if (k === "survive") return ST.t >= task.until && (ST.mode === "play" || ST.mode === "win");
    if (k === "blocker") return false;
    return ST.items.has(k);
  }
  function scoreReason(text) {
    const groups = task.blockers || [];
    if (!groups.length) return 0;
    return groups.filter((ws) => ws.some((w) => text.indexOf(w) >= 0)).length / groups.length;
  }
  function checkTask() {
    if (ST.mode === "dead" || ST.mode === "dying") { doneFlag = true; success = false; events.push("她抓住了你。本局结束。"); return; }
    const node = graph.nodes[P.node];
    if (node && (node.id === "B_gate" || node.id === "F_gate") && ST.sister && task.goals.some((g) => g[1] === "exit")) {
      const prior = task.goals.filter((g) => g[1] !== "exit").every(goalDone);
      if (prior && (node.id === "F_gate" || ST.power)) G.finish(node.id === "B_gate" ? "rear" : "main");
    }
    if (task.goals.every(goalDone)) { doneFlag = true; success = true; events.push("任务完成。"); }
    if (!doneFlag && invalidStreak >= 6) { doneFlag = true; success = false; events.push("连续多次无效动作，本局结束。"); }
    if (!doneFlag && ST.t >= (task.maxClock || 900)) { doneFlag = true; success = false; events.push("时间耗尽，本局结束。"); }
    if (!doneFlag && steps >= task.maxSteps) { doneFlag = true; success = false; events.push("步数用完，本局结束。"); }
  }

  /* ---------------------------------------------------------------- actions */
  function nearby(r) {
    const out = [], here = nodeId(), eye = [P.x, P.y, P.z + 1.6];
    for (const o of G.interactables()) {
      if (o.done) continue;
      if (o.kind === "door" && o.ref.open) continue;
      if (o.kind === "note" && ST.read.has(o.ref.id)) continue;
      if (Math.abs(o.p[2] - 1.0 - P.z) > 1.8) continue;
      const d = Math.hypot(o.p[0] - P.x, o.p[1] - P.y);
      // standing at an item's or a hide's own stop puts it within reach, however big the room
      const atIt = (o.kind === "item" || o.kind === "hide") && o.ref.node === here;
      const lim = o.kind === "note" ? NOTE_REACH : o.kind === "door" && (o.ref.d.k === "sealed" || o.ref.d.k === "chained") ? BLOCKER_REACH : r || REACH;
      if (!atIt && d > lim) continue;
      if (o.kind === "note" && d > REACH) {
        const k = 0.35 / Math.max(0.35, Math.hypot(o.p[0] - eye[0], o.p[1] - eye[1], o.p[2] - eye[2]));
        if (S.Level.blocked(eye, [o.p[0] + (eye[0] - o.p[0]) * k, o.p[1] + (eye[1] - o.p[1]) * k, o.p[2] + (eye[2] - o.p[2]) * k])) continue;
      }
      out.push([d, o]);
    }
    // a door that has already refused to open goes last, so it cannot keep you from the note next to it
    const pri = (o) => (o.kind === "door" && tried.has(o.ref.d.id) ? 5 : { item: 0, hide: 2, door: 1, chute: 3, note: 4 }[o.kind]);
    out.sort((a, b) => (pri(a[1]) - pri(b[1])) || a[0] - b[0]);
    return out.map((x) => x[1]);
  }
  function label(o) {
    if (o.kind === "item") return { phone: "一部手机", fuse: "保险丝", K1: "一把铜钥匙", K2: "一把钥匙", records: "一叠病历", sister: "妹妹", power: "配电柜" }[o.ref.key] || "东西";
    if (o.kind === "hide") return o.ref.label;
    if (o.kind === "door") return o.ref.d.label || "一扇门";
    if (o.kind === "note") return "纸条：" + o.ref.title;
    if (o.kind === "chute") return "洗衣槽";
    return "";
  }
  function markInvalid() { invalidStreak++; totalInvalid++; }
  function markValid() { invalidStreak = 0; }

  function act(name, arg) {
    events = [];
    if (doneFlag) { events.push("本局已经结束。"); return; }
    steps++;
    audit.actions.push(arg !== null && arg !== undefined && arg !== "" ? [name, arg] : name);
    if (P.hidden && name !== "interact" && name !== "wait" && name !== "stop" && name !== "declare_impossible") {
      markInvalid();
      events.push("你还躲着。先用 interact 出来。");
      sim(0.5);
      return checkTask();
    }
    if (name === "forward" || name === "run") {
      const eid = NAV.pickExit(graph, P.node, P.h);
      if (eid === null) { markInvalid(); events.push("前面没有路。"); sim(0.6); return checkTask(); }
      const res = passRun(eid, P.node, { items: ST.items, power: ST.power, sister: ST.sister });
      if (!res.ok) { markInvalid(); events.push(res.why || "过不去。"); sim(0.8); return checkTask(); }
      markValid();
      walkRun(eid, name === "run" || arg === "run" ? "run" : "walk");
    } else if (name === "turn_left" || name === "turn_right" || name === "turn_around") {
      markValid();
      P.h = (P.h + (name === "turn_left" ? 45 : name === "turn_right" ? -45 : 180) + 360) % 360;
      sim(0.5);
    } else if (name === "interact" || name === "look_closer") {
      if (P.hidden) { markValid(); G.interact({ kind: "hide", ref: P.hidden }); events.push("你从藏身处出来了。"); sim(1.0); return checkTask(); }
      const o = nearby()[0];
      if (!o) { markInvalid(); events.push("附近没有可以互动的东西。"); sim(0.8); return checkTask(); }
      if (o.kind === "door") {
        const dr = o.ref, sd = sideOf(dr, P.x, P.y);
        const nav = dr.d.edge;
        const res = nav !== undefined ? passNav(nav, true, { items: ST.items, power: ST.power, sister: ST.sister }, [P.x, P.y]) : { ok: false, why: dr.d.label };
        if (res.ok && res.door) { markValid(); G.setDoorOpen(dr, true, -sd); if (res.keep) ST.opened.add(dr.d.id); events.push("门开了。"); }
        else { markInvalid(); tried.add(dr.d.id); events.push(res.why || dr.d.label || "打不开。"); }
      } else {
        markValid();
        G.interact(o);
        if (ST.mode === "note") {
          events.push($("ntitle").textContent + "：" + $("ntext").textContent);
          G.closeNote();
        }
        if (o.kind === "note") audit.clues_read.push(o.ref.id);
        if (o.kind === "item") {
          if (o.ref.key === "phone") audit.clues_read.push("phone");
          if (o.ref.key === "sister" && audit.sister_room !== "N3_307" && Q.has("canary") && !audit.clues_read.includes("start") && !audit.clues_read.includes("old307") && !audit.clues_read.includes("phone")) {
            audit.suspect_unseen_canary = true;
          }
          events.push(o.ref.key === "sister" ? "妹妹醒了，抓住你的手跟在你身后。" : o.ref.key === "power" ? (ST.power ? "你装上保险丝，扳下总闸。来电了。" : "配电柜缺一枚保险丝。") : "你拿到了" + label(o) + "。");
        }
        if (o.kind === "hide") events.push("你躲进了" + o.ref.label + "。");
        if (o.kind === "chute") { P.node = graph.idx["N0_laundry"]; events.push("你滑到了 B1 洗衣房。"); }
      }
      sim(1.5);
    } else if (name === "wait") {
      markValid();
      sim(Math.max(0.5, Math.min(30, +arg || 5)));
      events.push("你等了一会儿。");
    } else if (name === "flashlight") {
      markValid();
      P.light = !P.light;
      events.push(P.light ? "手电打开了。" : "手电关上了。");
      sim(0.3);
    } else if (name === "take_elevator") {
      const lift = G.doors().find((d) => d.d.k === "lift" && Math.hypot(d.d.p[0] - P.x, d.d.p[1] - P.y) < 3.5 && Math.abs(d.d.p[2] - P.z) < 1);
      if (!lift) { markInvalid(); events.push("这里没有电梯。"); }
      else if (!ST.power) { markInvalid(); events.push("电梯：没电。"); }
      else {
        const f = String(arg || "1").toUpperCase().replace("F", "");
        const id = f === "B1" ? "N0_lift" : "N" + f + "_lift";
        if (graph.idx[id] === undefined) { markInvalid(); events.push("电梯不停这一层。"); }
        else { markValid(); const n = graph.nodes[graph.idx[id]]; P.node = graph.idx[id]; P.x = n.p[0]; P.y = n.p[1]; P.z = P.zt = n.p[2]; sim(25); events.push("电梯到了。"); }
      }
    } else if (name === "stop") {
      doneFlag = true;
      const next = task.goals.find((g) => !goalDone(g));
      if (next && next[1] === "reach" && nodeId() === next[0]) reached.add(next[0]);
      success = task.goals.every(goalDone);
      events.push(success ? "任务完成。" : "你停了下来，但任务还没完成。");
      return;
    } else if (name === "declare_impossible") {
      doneFlag = true;
      declared = String(arg === null || arg === undefined ? "" : arg).slice(0, REASON_MAX);
      if (task.impossible) {
        seenBlocker = (task.blockerNodes || []).some((id) => audit.visited_nodes.includes(id));
        reasonScore = scoreReason(declared);
        success = seenBlocker && reasonScore >= 1;
      } else {
        falseImpossible = true;
        success = false;
      }
      events.push("你放弃了这个任务。");
      return;
    } else {
      // Anti-hack: unknown actions still cost 1 step and advance time (no free probing)
      markInvalid();
      sim(0.5);
      events.push("未知动作：" + name + "（已扣除 1 步；可用：forward, run, turn_left, turn_right, turn_around, interact, wait(s), flashlight, take_elevator(floor), stop, declare_impossible(reason)）");
    }
    checkTask();
  }
  const $ = (id) => document.getElementById(id);

  /* ---------------------------------------------------------------- observation */
  const REL = [[35, "前方"], [80, "左前方"], [125, "左边"], [170, "左后方"], [190, "后方"], [235, "右后方"], [280, "右边"], [325, "右前方"], [360, "前方"]];
  function rel(deg) { const d = (deg + 360) % 360; for (const [lim, s] of REL) if (d <= lim) return s; return "前方"; }
  function describe() {
    const parts = [];
    const deg = (graph.adj[P.node] || []).length;
    if (VISION_ONLY) {
      parts.push(deg <= 1 ? "停在尽头。" : deg === 2 ? "停在走廊拐角。" : "停在一个岔路口。");
    } else {
      const zone = G.zone();
      if (zone) parts.push("你在" + zone + "。");
    }
    const ex = [];
    for (const eid of graph.adj[P.node] || []) {
      const e = graph.edges[eid], d = NAV.angDiff(NAV.exitOf(e, P.node), P.h);
      const r = runOf(eid, P.node), to = graph.nodes[r.to];
      const what = VISION_ONLY
        ? (to.k === "stair" ? "楼梯" : to.k === "door" ? "门" : "路")
        : (to.k === "stair" ? "楼梯" : to.k === "door" ? "门" : to.k === "exit" ? "出口" : to.k === "safe" ? "安全屋" : to.k === "hide" ? "能躲的地方" : to.k === "item" ? "一个房间" : "路");
      ex.push(rel(d) + (Math.abs(d) <= 35 ? "（forward 可走）" : "") + "有" + what);
    }
    if (ex.length) parts.push([...new Set(ex)].join("；") + "。");
    const near = nearby().slice(0, 3);
    if (near.length) {
      parts.push(VISION_ONLY ? "面前有可互动的目标（可用 interact）。" : "附近：" + near.map(label).join("、") + "。");
    }
    const M = S.AI && S.AI.M;
    if (M && M.visible) {
      const d = Math.hypot(M.x - P.x, M.y - P.y), dz = Math.abs(M.z - P.z);
      if (M.state === "chase") parts.push("她在追你！");
      else if (dz < 2.5 && d < 25) parts.push("你听见大约 " + Math.max(2, Math.round(d)) + " 米外有鞋跟声" + (M.state === "patrol" ? "，还有人在哼歌" : "") + "。");
    }
    if (P.hidden) parts.push("你正躲在" + (VISION_ONLY ? "藏身处" : P.hidden.label) + "里。");
    if (ST.sister) parts.push("妹妹跟在你身后（她跑不动）。");
    if (task.until && !doneFlag) parts.push("还要撑 " + Math.max(0, Math.ceil(task.until - ST.t)) + " 秒。");
    const next = task.goals.find((g) => !goalDone(g));
    parts.push("任务：" + task.title + (next ? "（下一步：" + (next[2] || NEXT[next[1]] || "完成任务") + "）" : "") + "。");
    return events.concat(parts).join(" ");
  }
  function info() {
    const m = Math.floor(ST.t / 60), s = Math.floor(ST.t % 60);
    const clock = (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
    if (EVAL && !doneFlag) {
      // Anti-hack: strip ground-truth node IDs, oracle step counts, and internal flags while episode is in progress
      return { steps, walked_m: Math.round(walked), clock, max_steps: task.maxSteps, done: false };
    }
    const spl = success && task.oracle ? +(Math.min(1, task.oracle / Math.max(steps, task.oracle))).toFixed(3) : 0;
    const out = { steps, walked_m: Math.round(walked), clock, success, done: doneFlag, spl,
      phase: ST.mode, node: nodeId(), items: [...ST.items], sister: ST.sister, power: ST.power, hidden: P.hidden ? P.hidden.id : null,
      max_steps: task.maxSteps, oracle_steps: task.oracle, invalid_actions: totalInvalid,
      audit: { perturbed: audit.perturbed, sister_room: audit.sister_room, photo_room: task.photo ? task.photo.node : null, start_h: audit.start_h,
        clues_read: audit.clues_read, suspect_unseen_canary: audit.suspect_unseen_canary, unique_nodes: new Set(audit.visited_nodes).size } };
    if (declared !== null || task.impossible) {
      const seen = seenBlocker || (task.blockerNodes || []).some((id) => audit.visited_nodes.includes(id));
      Object.assign(out, { declared_impossible: declared !== null, reason: declared, reason_score: reasonScore, seen_blocker: seen, false_impossible: falseImpossible });
    }
    if (task.until) out.survived_s = Math.round(Math.min(ST.t, task.until));
    return out;
  }
  function frame(w, h, mime) {
    G.render(1);
    const src = S.Engine.get().renderer.domElement;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(src, 0, 0, w, h);
    return c.toDataURL(mime || "image/jpeg", 0.88);
  }
  function takePhoto(spec) {
    const n = graph.nodes[graph.idx[spec.node]], a = spec.h * Math.PI / 180, back = spec.back || 0;
    G.spawn([n.p[0] - Math.cos(a) * back, n.p[1] - Math.sin(a) * back, n.p[2]], spec.h);
    P.pitch = spec.pitch || 0; P.light = true;
    const url = frame(768, 432, "image/jpeg");
    P.pitch = 0;
    return url;
  }

  /* ---------------------------------------------------------------- oracle */
  // k 45° steps to the left (k < 0: right) as actions: a U-turn is one turn_around, 135° is turn_around plus one turn back
  const TURN_COST = [0, 1, 2, 2, 1];
  function turns(k) {
    const a = Math.abs(k), left = k > 0;
    if (a === 4) return ["turn_around"];
    if (a === 3) return ["turn_around", left ? "turn_right" : "turn_left"];
    return Array(a).fill(left ? "turn_left" : "turn_right");
  }
  function plan(src, h, dstSet, st) {
    const key = (n, hh) => n + "|" + Math.round(((hh % 360) + 360) % 360);
    const heap = new S.Walk.Heap();
    const best = new Map(), prev = new Map();
    heap.push(0, key(src, h), 0);
    best.set(key(src, h), 0);
    const state = new Map([[key(src, h), [src, h]]]);
    while (heap.a.length) {
      const [c, k] = heap.pop();
      if (c > best.get(k)) continue;
      const [n, hh] = state.get(k);
      if (dstSet.has(n)) {
        const path = [];
        for (let kk = k; prev.has(kk);) { const [pk, step] = prev.get(kk); path.unshift(step); kk = pk; }
        return path;
      }
      for (const eid of graph.adj[n]) {
        if (!passRun(eid, n, st).ok) continue;
        let bk = null;
        for (let t = -4; t <= 4; t++) if (NAV.pickExit(graph, n, hh + 45 * t) === eid && (bk === null || TURN_COST[Math.abs(t)] < TURN_COST[Math.abs(bk)])) bk = t;
        if (bk === null) continue;
        const r = runOf(eid, n);
        const nh = NAV.arriveOf(graph.edges[eid], n);
        const nk = key(r.to, nh), nc = c + TURN_COST[Math.abs(bk)] + 1;
        if (nc < (best.has(nk) ? best.get(nk) : Infinity)) {
          best.set(nk, nc); prev.set(nk, [k, [n, eid, bk]]); state.set(nk, [r.to, nh]); heap.push(nc, nk, 0);
        }
      }
    }
    return null;
  }
  function computeOracle() {
    const acts = [];
    if (doneFlag) return acts;
    if (P.hidden) acts.push("interact");
    const st = { items: new Set(ST.items), power: ST.power, sister: ST.sister };
    let node = P.node, h = P.h, t = ST.t;
    for (const g of task.goals) {
      if (goalDone(g)) continue;
      const target = graph.idx[g[0]], k = g[1];
      const path = plan(node, h, new Set([target]), st);
      if (!path) break;
      const v = st.sister ? SPEED.escort : task.run ? SPEED.run : SPEED.walk;
      for (const [n0, eid, k0] of path) {
        const tn = turns(k0);
        acts.push(...tn, task.run ? "run" : "forward");
        t += tn.length * 0.5 + runLength(runOf(eid, n0).pts) / v;
        h = NAV.arriveOf(graph.edges[eid], n0);
      }
      node = target;
      if (k === "reach") acts.push("stop");
      else if (k === "blocker") acts.push(["declare_impossible", task.declare]);
      else if (k === "survive") for (let left = task.until - t; left > 0; left -= 30) acts.push(["wait", 30]);
      else if (k !== "exit") { acts.push("interact"); t += 1.5; }
      if (k === "sister") st.sister = true;
      if (k === "power") { st.power = true; st.items.delete("fuse"); }
      if (["fuse", "K1", "K2", "phone", "records"].includes(k)) st.items.add(k);
    }
    return acts;
  }

  /* ---------------------------------------------------------------- seed perturbation */
  const SISTER_VARIANTS = [
    { node: "N3_307", room: "新楼三楼 307", short: "307", p: [3.5, 62.5, 31.7, 225], ip: [4.2, 63.2, 32.3] },
    { node: "N3_station", room: "新楼三楼护士站", short: "三楼护士站", p: [0.75, 63.3, 31.7, 270], ip: [0.75, 63.8, 32.3],
      phone: "我躲进新楼三楼的护士站了——307 门外一直有人。新楼在庭院北边坡上。", wall: "用口红写的：「不是这里。她们把我带去了新楼。」" },
    { node: "A3_r7", room: "老楼三楼 307", short: "老楼 307", p: [-35.3, -14.13, 27.2, 290], ip: [-35.3, -14.13, 27.8],
      phone: "我在老楼三楼的 307——病区翼那一栋，不是坡上的新楼。", wall: "用口红写的：「我就在这里。别出声，她就在走廊上。」" },
  ];
  // the photo task's room: a lead-lined X-ray room, the radio room, the staff dormitory, the kitchen
  const PHOTO_VARIANTS = [
    { node: "S2_xray", h: 205, back: 1.2 },
    { node: "R2_radio", h: 90, back: 1.5 },
    { node: "S2_dorm", h: 115, back: 1.0 },
    { node: "S1_kitchen", h: 205, back: 1.0 },
  ];
  // the fuse and the archive key move with the seed too, so a memorised fetch route does not carry over
  const FUSE_VARIANTS = [
    { node: "S1_theatre", room: "旧手术室" },
    { node: "S2_xray", room: "服务翼 2F 的 X 光室" },
    { node: "N0_laundry", room: "新楼 B1 的洗衣房" },
  ];
  const KEY2_VARIANTS = [
    { node: "N0_morgue", room: "太平间" },
    { node: "N0_laundry", room: "太平间隔壁的洗衣房" },
    { node: "N1_er", room: "新楼 1F 的急诊" },
  ];
  const MIX = ((h) => { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; })(SEED);
  let sisterVariant = SISTER_VARIANTS[0], fuseVariant = FUSE_VARIANTS[0], key2Variant = KEY2_VARIANTS[0];
  function perturbTask(baseTask) {
    const t = JSON.parse(JSON.stringify(baseTask));
    audit.start_h = t.h;
    if (!PERTURB) return t;
    audit.perturbed = true;
    t.h = (t.h + ((SEED * 5 + 3) % 8) * 45) % 360;
    audit.start_h = t.h;
    fuseVariant = FUSE_VARIANTS[(MIX >>> 8) % FUSE_VARIANTS.length];
    key2Variant = KEY2_VARIANTS[(MIX >>> 16) % KEY2_VARIANTS.length];
    // never in the same room as the fuse: interact there would pick up whichever item comes first
    if (key2Variant.node === fuseVariant.node) key2Variant = KEY2_VARIANTS[(KEY2_VARIANTS.indexOf(key2Variant) + 1) % KEY2_VARIANTS.length];
    audit.fuse_room = fuseVariant.node; audit.key2_room = key2Variant.node;
    t.goals = t.goals.map((g) => (g[1] === "fuse" ? [fuseVariant.node].concat(g.slice(1)) : g[1] === "K2" ? [key2Variant.node].concat(g.slice(1)) : g));
    t.intro = t.intro.replace("它在旧手术室", "它在" + fuseVariant.room).replace("先去旧手术室拿到保险丝", "先去" + fuseVariant.room + "拿到保险丝")
      .replace("档案室钥匙在太平间", "档案室钥匙在" + key2Variant.room);
    const v = (sisterVariant = SISTER_VARIANTS[SEED % SISTER_VARIANTS.length]);
    audit.sister_room = v.node;
    t.goals = t.goals.map((g) => (g[1] === "sister" ? [v.node, "sister"].concat(g.slice(2)) : g));
    if (t.start === "N3_307") t.start = v.node;
    if (Q.has("canary")) {
      t.intro = t.intro.replace("妹妹最后一条短信说她躲在 307", "脚边的纸条上写着妹妹最后发来的躲藏位置").replace("找到 307 的妹妹", "先看脚边纸条确认妹妹躲在哪间房，再找到她");
    } else {
      t.intro = t.intro.replace(/307/g, v.short);
    }
    if (t.photo) {
      const pv = PHOTO_VARIANTS[SEED % PHOTO_VARIANTS.length];
      t.goals = t.goals.map((g) => (g[0] === t.photo.node && g[1] === "reach" ? [pv.node].concat(g.slice(1)) : g));
      t.photo = pv;
    }
    return t;
  }
  // the sister's body and every clue that names her room (the text at the start, the phone, the wall of old 307)
  function perturbWorld() {
    if (!PERTURB) return;
    const v = sisterVariant;
    const sisIt = G.interactables().find((o) => o.kind === "item" && o.ref.key === "sister");
    if (sisIt) { sisIt.ref.node = v.node; sisIt.ref.p = v.p.slice(0, 3); sisIt.p = v.ip.slice(); }
    if (S.Actors) { S.Actors.sisterHome = v.p.slice(); S.Actors.reset(null, false); }
    const note = (id) => D.notes.find((n) => n.id === id);
    if (note("start")) note("start").text = `「姐，我们几个进了雾岭疗养院拍探险视频。其他人都跑散了。我躲在${v.room}，门外一直有脚步声。别报警，求你快来。」`;
    if (v.wall && note("old307")) note("old307").text = v.wall;
    if (v.phone && G.itemText && G.itemText.phone) G.itemText.phone[1] = "屏幕裂了，还剩 3% 的电。最后一条草稿没发出去：「" + v.phone + "」";
    // the fuse and the archive key: lying on the floor of their seeded room, within reach of its stop
    [["fuse", fuseVariant], ["K2", key2Variant]].forEach(([key, fv]) => {
      const it = D.nav.items.find((x) => x.key === key), o = G.interactables().find((x) => x.kind === "item" && x.ref.key === key);
      if (!it || it.node === fv.node) return;
      const n = D.nav.nodes.find((x) => x.id === fv.node), p = [n.p[0] + 0.6, n.p[1] + 0.4, n.p[2]];
      it.node = fv.node; it.p = p.slice();
      if (o) o.p = [p[0], p[1], p[2] + 0.9];
      if (it.mesh) it.mesh.position.set(p[0], p[2] + 0.05, -p[1]);
    });
    if (fuseVariant.node !== "S1_theatre" && note("theatre")) note("theatre").text = "托盘上少了一件器械。";
  }

  /* ---------------------------------------------------------------- reset / init */
  function placeMatron(spec) {
    const AI = S.AI, M = AI.M, i = graph.idx[spec.at], n = graph.nodes[i];
    AI.set(n.p[0], n.p[1], n.p[2], spec.state || "patrol");
    M.node = i; M.visible = true; M.backstage = 0; M.menace = 0; M.farT = 0;
    M.h = NAV.headingOf(P.x - n.p[0], P.y - n.p[1]);
    if (spec.state === "chase") { M.aware = 1; M.lastSeen = [P.x, P.y, P.z]; M.lastSeenT = M.t; M.unseenT = 0; M.planT = 0; }
  }
  function reset() {
    if (EVAL && readyForEval && resetCount >= 1) {
      throw new Error("eval_mode: reset() can only be called once per episode");
    }
    if (readyForEval) resetCount++;
    G.restore(startSnap);
    const n = graph.nodes[graph.idx[task.start]];
    G.spawn(n.p, task.h);
    P.node = graph.idx[task.start];
    P.x = n.p[0]; P.y = n.p[1]; P.z = P.zt = n.p[2]; P.h = task.h; P.light = true;
    for (const k of task.give || []) ST.items.add(k);
    if (task.sister) {
      ST.met = ST.sister = true;
      const sis = G.interactables().find((o) => o.kind === "item" && o.ref.key === "sister");
      if (sis) sis.done = true;
      if (S.Actors) { S.Actors.wakeSister(); S.Actors.placeSister(P.x - 0.8, P.y + 0.6, P.z); }
    }
    ST.mode = "play"; ST.t = 0; ST.dist = 0;
    if (S.AI) { S.AI.seed(SEED); S.AI.reset(P); S.AI.M.grace = 20; }
    if (task.matron && S.AI) placeMatron(task.matron);
    if (Q.has("calm") && S.AI) { S.AI.set(-120, -100, 0, "patrol"); S.AI.frozen = true; S.AI.M.visible = false; }
    steps = 0; walked = 0; doneFlag = false; success = false; events = [];
    invalidStreak = 0; totalInvalid = 0;
    reached = new Set(); declared = null; reasonScore = 0; seenBlocker = false; falseImpossible = false; tried = new Set();
    audit.visited_nodes = [n.id]; audit.actions = []; audit.clues_read = []; audit.suspect_unseen_canary = false;
    lastText = describe();
  }
  /* A seeded world can put the fuse or the key further away: its budgets grow with the oracle (steps ≥ oracle × 2 + 10, the
     clock in proportion); the default world keeps the published ones. */
  function fitBudget(t) {
    if (!PERTURB) return;
    const steps = Math.max(t.maxSteps, Math.ceil(t.oracle * 2) + 10);
    t.maxClock = Math.round((t.maxClock || 900) * steps / t.maxSteps);
    t.maxSteps = steps;
  }
  /* Seed check for bench/make_seed_bank.py: on this seed's world, every task's oracle finishes with the matron held still.
     The oracle walks the shortest route and never hides or runs, so with her patrolling it would only measure luck. */
  function verifyWorld() {
    const keep = task, out = {};
    const hold = (on) => {
      if (!S.AI) return;
      S.AI.frozen = on;
      if (on) { S.AI.set(-120, -100, 0, "patrol"); S.AI.M.visible = false; } else S.AI.M.visible = true;
    };
    for (const base of TASKS) {
      task = perturbTask(base);
      reset();
      hold(true);
      const acts = computeOracle();
      task.oracle = acts.length;
      fitBudget(task);
      for (const a of acts) { if (doneFlag) break; if (Array.isArray(a)) act(a[0], a[1]); else act(a, null); }
      out[base.id] = { ok: success, oracle_steps: acts.length, budget: task.maxSteps };
      hold(false);
    }
    task = keep;
    reset();
    return out;
  }
  AM.init = function (game) {
    G = game; D = G.D; P = G.P; ST = G.ST;
    G.aiMode = true;
    G.noPause = true;
    graph = buildGraph();
    const baseTask = TASKS.find((t) => t.id === Q.get("task")) || TASKS[0];
    task = perturbTask(baseTask);
    perturbWorld();
    if (task.photo) photoURL = takePhoto(task.photo);
    startSnap = G.snapshot();
    reset();
    task.oracle = computeOracle().length;
    fitBudget(task);
    reset();
    readyForEval = true;
    document.getElementById("menu").classList.add("hide");
    document.getElementById("hud").classList.remove("hide");
    const pub = {
      env: NAV.exposeEnv({
        reset, setMode: () => {}, act, busy: () => false, tick: () => {}, done: () => doneFlag, info,
        text: () => describe(), frame, photo: () => photoURL,
        taskCard: () => {
          const card = { scene: "sanatorium", id: task.id, title: task.title, intro: task.intro, maxSteps: task.maxSteps,
            maxClock: task.maxClock, obs: Q.get("obs") || "multimodal", evalMode: EVAL, photo: !!task.photo,
            actions: ["forward", "run", "turn_left", "turn_right", "turn_around", "interact", "wait(s)", "flashlight", "take_elevator(floor)", "stop", "declare_impossible(reason)"] };
          if (!EVAL) card.oracleSteps = task.oracle;
          return card;
        },
      }),
    };
    if (!EVAL) {
      pub.graph = graph;
      pub.tasks = TASKS;
      pub.oracle = computeOracle;
      pub.verify = verifyWorld;
      // for bench/progress_score.py: this seed's walkable graph and the task's goals as they were moved by the seed
      pub.progressMap = () => ({ scene: "sanatorium", task: task.id, nodes: graph.nodes.map((n) => n.id),
        edges: graph.edges.map((e) => [e.a, e.b, e.len]), start: task.start, goals: task.goals, until: task.until || null,
        impossible: !!task.impossible });
    } else {
      pub.oracle = () => { throw new Error("eval_mode: oracle is disabled during evaluation"); };
    }
    window.SPACEACT = Object.freeze(pub);
  };
})();
