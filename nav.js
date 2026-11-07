/* Space Track · discrete "AI action mode" shared by the park, the mall and the city: graph helpers, an
   earliest-arrival planner, oracle action sequences, the action bar, and the env API used by bench/runner.js.
   Action names match env/park_env.py. Elevators and vehicles are ordinary graph edges: "forward" only walks,
   take_elevator(floor) / take_transit pick the matching non-walking edge. */
(function () {
  "use strict";
  const TOL = 35;
  const angDiff = (a, b) => ((a - b + 540) % 360) - 180;
  const headingOf = (dx, dy) => ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
  const other = (e, n) => (e.a === n ? e.b : e.a);
  const exitOf = (e, n) => (e.a === n ? e.exitA : e.exitB);
  const arriveOf = (e, n) => (e.a === n ? e.arriveB : e.arriveA);
  const ACTION_KEYS = { w: "forward", arrowup: "forward", a: "turn_left", arrowleft: "turn_left", d: "turn_right",
    arrowright: "turn_right", s: "turn_around", arrowdown: "turn_around", f: "look_closer", t: "take_transit",
    p: "point", x: "declare_impossible", enter: "stop" };

  function polyLen(pts) {
    let s = 0;
    for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return s;
  }
  function pointAt(pts, d) {
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const seg = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      if (acc + seg >= d || i === pts.length - 2) {
        const t = seg > 0 ? Math.min(1, Math.max(0, (d - acc) / seg)) : 0;
        return pts[i].map((v, k) => v + (pts[i + 1][k] - v) * t);
      }
      acc += seg;
    }
    return pts[pts.length - 1].slice();
  }

  /* Fill in lengths, adjacency and exit / arrival headings (same 1.5-unit look-ahead as park_env.Graph). */
  function prepare(graph) {
    if (!graph.adj) {
      graph.adj = graph.nodes.map(() => []);
      graph.edges.forEach((e, i) => { graph.adj[e.a].push(i); graph.adj[e.b].push(i); });
    }
    graph.edges.forEach((e) => {
      if (e.len === undefined) e.len = polyLen(e.pts);
      if (e.exitA !== undefined) return;
      const pts = e.pts, rev = pts.slice().reverse(), L = Math.max(e.len, polyLen(pts)), flat = L < 1e-6;
      const dir = (p, d0, d1) => { const a = pointAt(p, d0), b = pointAt(p, d1); return headingOf(b[0] - a[0], b[1] - a[1]); };
      e.exitA = flat ? 0 : dir(pts, 0, Math.min(1.5, L / 2));
      e.arriveB = flat ? 0 : dir(pts, Math.max(0, L - 1.5), L);
      e.exitB = flat ? 0 : dir(rev, 0, Math.min(1.5, L / 2));
      e.arriveA = flat ? 0 : dir(rev, Math.max(0, L - 1.5), L);
    });
    return graph;
  }

  function pickExit(graph, node, h, allow) {
    let best = null;
    graph.adj[node].forEach((eid) => {
      const e = graph.edges[eid];
      if (allow && !allow(e)) return;
      const d = Math.abs(angDiff(exitOf(e, node), h));
      if (d <= TOL && (!best || d < best.d)) best = { d, eid };
    });
    return best ? best.eid : null;
  }

  /* Earliest-arrival search; cost(eid, from, minutes) gives minutes or null when the edge is shut at that time. */
  function plan(graph, src, goals, t0, cost, goalOk) {
    const heap = [[t0, src]], best = new Map([[src, t0]]), prev = new Map(), seen = new Set();
    const less = (x, y) => x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);
    const push = (item) => {
      heap.push(item);
      for (let i = heap.length - 1; i > 0;) { const p = (i - 1) >> 1; if (!less(heap[i], heap[p])) break; [heap[i], heap[p]] = [heap[p], heap[i]]; i = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && less(heap[l], heap[m])) m = l;
          if (r < heap.length && less(heap[r], heap[m])) m = r;
          if (m === i) break;
          [heap[i], heap[m]] = [heap[m], heap[i]]; i = m;
        }
      }
      return top;
    };
    while (heap.length) {
      const [t, n] = pop();
      if (seen.has(n)) continue;
      seen.add(n);
      if (goals.has(n) && (!goalOk || goalOk(n, t))) {
        const path = [];
        for (let m = n; m !== src;) { const [n0, eid] = prev.get(m); path.unshift([n0, eid]); m = n0; }
        return { minutes: t - t0, len: path.reduce((s, [, e]) => s + graph.edges[e].len, 0), path };
      }
      for (const eid of graph.adj[n]) {
        const dt = cost(eid, n, t);
        if (dt === null || dt === undefined) continue;
        const m = other(graph.edges[eid], n);
        if (t + dt < (best.has(m) ? best.get(m) : Infinity) - 1e-9) { best.set(m, t + dt); prev.set(m, [n, eid]); push([t + dt, m]); }
      }
    }
    return null;
  }

  /* Turn-by-turn actions along a planned path; special(e, from) returns the action for non-walking edges. */
  function oracle(graph, path, h, walkable, special) {
    const acts = [];
    for (const [n0, eid] of path) {
      const e = graph.edges[eid], sp = special && special(e, n0);
      if (sp) { acts.push(sp); h = arriveOf(e, n0); continue; }
      const k0 = angDiff(exitOf(e, n0), h) / 45;
      let bk = null;
      for (let k = -4; k <= 4; k++) if (pickExit(graph, n0, h + 45 * k, walkable) === eid && (bk === null || Math.abs(k - k0) < Math.abs(bk - k0))) bk = k;
      for (let i = 0; i < Math.abs(bk); i++) acts.push(bk > 0 ? "turn_left" : "turn_right");
      acts.push("forward");
      h = arriveOf(e, n0);
    }
    return acts;
  }

  const junction = (deg) => (deg <= 1 ? "前面没路了。" : deg === 2 ? "停在路的拐弯处。" : "停在一个岔路口。");
  const meters10 = (m) => Math.max(10, Math.round(m / 10) * 10);

  const STYLE = `
  #aibar { display: none; margin-top: 10px; }
  #aibar .row { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
  #aibar .row + .row { margin-top: 6px; }
  #aibar button { min-width: 92px; padding: 8px 10px; }
  #aibar button.go { background: #ef6c00; }
  #aibar button.stop { background: #c2185b; }
  #aibar button.warn { background: #6d4c41; }
  #aibar button:disabled { opacity: .35; cursor: default; }
  #aibar .floors { display: none; gap: 6px; align-items: center; font-size: 12.5px; color: #9fb0ba; }
  #aibar .floors button { min-width: 44px; padding: 7px 8px; background: #37474f; }
  #aibar input { width: 64px; font: inherit; font-size: 13px; padding: 6px; border-radius: 6px; border: 0; background: rgba(255,255,255,.12); color: #fff; }`;

  /* Mode buttons in the top bar plus the action bar under the message line. */
  function ui(opts) {
    const style = document.createElement("style");
    style.textContent = STYLE;
    document.head.appendChild(style);
    const top = document.getElementById("top");
    const anchor = top.querySelector("a.btn, a");
    const free = document.createElement("button"), ai = document.createElement("button");
    free.id = "modeFree"; free.textContent = "自由行走"; free.className = "on";
    ai.id = "modeAI"; ai.textContent = "AI 动作模式";
    top.insertBefore(free, anchor); top.insertBefore(ai, anchor);
    const bar = document.createElement("div");
    bar.id = "aibar";
    bar.innerHTML = `<div class="row">
        <button data-a="turn_left">↶ 左转 45° <kbd>A</kbd></button><button data-a="forward" class="go">↑ 前进 <kbd>W</kbd></button>
        <button data-a="turn_right">↷ 右转 45° <kbd>D</kbd></button><button data-a="turn_around">掉头 <kbd>S</kbd></button>
        <button data-a="look_closer">走近看 <kbd>F</kbd></button><button data-a="take_transit">乘坐 <kbd>T</kbd></button>
        <button data-a="stop" class="stop">到了 <kbd>Enter</kbd></button></div>
      <div class="row"><span class="floors" id="aiFloors"></span>
        <span id="aiPoint" style="display:none"><input id="aiDeg" type="number" value="0" step="15" title="相对当前朝向的角度，左正右负"> °
        <button data-a="point">指向 <kbd>P</kbd></button></span>
        <button data-a="declare_impossible" class="warn">做不到… <kbd>X</kbd></button></div>`;
    document.getElementById("bottom").insertBefore(bar, document.getElementById("hint"));
    const fire = (a) => {
      if (a === "point") return opts.onAction("point", Number(document.getElementById("aiDeg").value) || 0);
      if (a === "declare_impossible") return opts.onDeclare();
      opts.onAction(a);
    };
    bar.querySelectorAll("button[data-a]").forEach((b) => (b.onclick = () => fire(b.dataset.a)));
    let mode = "free";
    const api = {
      get mode() { return mode; },
      setMode(m) {
        if (m === mode || (opts.canSwitch && !opts.canSwitch())) return;
        mode = m;
        free.classList.toggle("on", m === "free"); ai.classList.toggle("on", m === "ai");
        bar.style.display = m === "ai" ? "block" : "none";
        opts.onMode(m);
        api.refresh();
      },
      /* Show floor buttons only at an elevator, the transit button only at a station, pointing only when asked. */
      refresh() {
        const s = opts.state ? opts.state() : {};
        const fl = document.getElementById("aiFloors");
        fl.style.display = s.floors ? "flex" : "none";
        fl.innerHTML = s.floors ? `${s.liftName || "电梯"}：` + s.floors.map((f) => `<button data-floor="${f}">${f}</button>`).join("") : "";
        fl.querySelectorAll("button").forEach((b) => (b.onclick = () => opts.onAction("take_elevator", b.dataset.floor)));
        bar.querySelector('[data-a="take_transit"]').disabled = !s.transit;
        document.getElementById("aiPoint").style.display = s.pointing ? "inline" : "none";
      },
    };
    free.onclick = () => api.setMode("free");
    ai.onclick = () => api.setMode("ai");
    window.addEventListener("keydown", (e) => {
      if (mode !== "ai" || e.repeat || e.target.tagName === "INPUT") return;
      const a = ACTION_KEYS[e.key.toLowerCase()];
      if (!a) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      fire(a);
    }, true);
    return api;
  }

  /* Synchronous env API for bench/runner.js: step() runs the action, fast-forwards its animation, returns text. */
  function exposeEnv(o) {
    const env = {
      reset() { o.reset(); o.setMode("ai"); return env.observe(); },
      step(name, arg) {
        o.act(name, arg);
        for (let i = 0; i < 4000 && o.busy(); i++) o.tick(0.05);
        return env.observe();
      },
      observe() { return Object.assign({ text: o.text(), done: o.done() }, { info: o.info() }); },
      frame(width, height, mime) { return o.frame(width || 768, height || 432, mime || "image/jpeg"); },
      photo() { return o.photo ? o.photo() : null; },
      task() { return o.taskCard(); },
    };
    return env;
  }

  window.SANav = { TOL, angDiff, headingOf, other, exitOf, arriveOf, polyLen, pointAt, prepare, pickExit, plan, oracle,
    junction, meters10, ui, exposeEnv };
})();
