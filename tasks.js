/* Space Track · shared task system for every scene: task picker, challenge mode, in-game clock, opening hours,
   "this can't be done" dialog, friend's photo, local best records. */
(function () {
  "use strict";
  const STYLE = `
  #taskBtn b { color: #ffb74d; font-weight: 600; margin-left: 2px; }
  #picker { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; background: rgba(8,11,14,.6); z-index: 8; }
  #picker .box { width: min(860px, 94vw); max-height: 88vh; overflow: auto; background: rgba(18,24,29,.95); border: 1px solid rgba(255,255,255,.1);
    border-radius: 12px; padding: 18px 20px; }
  #picker h2 { margin: 0 0 4px; font-size: 18px; }
  #picker .sub { color: #9fb0ba; font-size: 12.5px; margin-bottom: 10px; }
  #picker .close { float: right; }
  #picker .mode { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; font-size: 13px; color: #d9dee1; flex-wrap: wrap; }
  #picker .mode label { display: flex; gap: 6px; align-items: center; cursor: pointer; background: rgba(255,255,255,.06); padding: 6px 10px; border-radius: 8px; }
  #picker .mode small { color: #9fb0ba; }
  #picker .list { display: grid; grid-template-columns: repeat(auto-fill, minmax(236px, 1fr)); gap: 10px; }
  #picker .card { text-align: left; white-space: normal; padding: 12px 13px; border-radius: 9px; background: rgba(255,255,255,.06);
    border: 1px solid rgba(255,255,255,.07); line-height: 1.5; display: block; width: 100%; }
  #picker .card:hover { background: rgba(255,255,255,.13); }
  #picker .card.cur { border-color: #ffb74d; }
  #picker .card .t { font-size: 15px; font-weight: 600; color: #fff; }
  #picker .card .t i { font-style: normal; font-size: 11px; color: #1b2228; background: #ffb74d; border-radius: 4px; padding: 0 5px; margin-left: 6px; vertical-align: 2px; }
  #picker .card .m { font-size: 12px; color: #9fb0ba; margin-top: 2px; }
  #picker .card .m i { font-style: normal; color: #ffb74d; letter-spacing: 1px; }
  #picker .card .d { font-size: 12.5px; color: #d9dee1; margin: 6px 0 4px; }
  #picker .card .r { font-size: 12px; color: #81c784; }
  #picker .card .r.no { color: #78909c; }
  #task .tip { margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,.08); color: #ffcc80; }
  #task .chal { margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,.08); color: #ef9a9a; }
  #task .decl { margin-top: 8px; width: 100%; background: rgba(109,76,65,.55); font-size: 12px; padding: 5px 8px; }
  #task .photo { display: block; width: 100%; margin-top: 8px; border-radius: 6px; cursor: zoom-in; border: 1px solid rgba(255,255,255,.15); }
  #photoBig { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; background: rgba(8,11,14,.78); z-index: 9; cursor: zoom-out; }
  #photoBig img { max-width: 86vw; max-height: 80vh; border-radius: 10px; box-shadow: 0 8px 40px rgba(0,0,0,.6); }
  #photoBig div { position: absolute; bottom: 6vh; color: #d9dee1; font-size: 14px; }
  #declare { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; background: rgba(8,11,14,.6); z-index: 9; }
  #declare .box { width: min(420px, 92vw); background: rgba(18,24,29,.96); border: 1px solid rgba(255,255,255,.12); border-radius: 12px; padding: 16px 18px; }
  #declare h3 { margin: 0 0 4px; font-size: 16px; }
  #declare p { margin: 0 0 10px; font-size: 12.5px; color: #9fb0ba; line-height: 1.6; }
  #declare .opts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 12px; }
  #declare .opts label { display: flex; gap: 6px; align-items: center; font-size: 13.5px; background: rgba(255,255,255,.06); border-radius: 7px; padding: 6px 8px; cursor: pointer; }
  #declare .btns { display: flex; gap: 8px; justify-content: flex-end; }
  #declare .btns .ok { background: #c62828; }
  #result .rec { font-size: 12.5px; color: #9fb0ba; margin: -4px 0 12px; }
  #result .rec b { color: #ffb74d; font-weight: 600; }
  #result .btns { display: flex; gap: 6px; flex-wrap: wrap; }
  #result .btns .next { background: #ef6c00; }`;
  const KEY = "spaceact2.records";
  const RATE = 6;
  const pad = (n) => String(n).padStart(2, "0");
  const toMin = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
  const fmtMin = (m) => { m = ((Math.floor(m) % 1440) + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
  const fmtSecs = (s) => `${Math.floor(s / 60)}:${pad(Math.round(s % 60))}`;
  const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);
  const inWindow = (m, a, b) => { m = ((m % 1440) + 1440) % 1440; a = toMin(a); b = toMin(b); return a <= b ? m >= a && m < b : m >= a || m < b; };
  const loadAll = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const saveAll = (r) => { try { localStorage.setItem(KEY, JSON.stringify(r)); } catch (e) { /* storage disabled */ } };
  /* Same generator as park_env.lcg(), so a seed gives the same variant in Python and in the browser. */
  function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

  function setup(sceneKey, sceneName, tasks, hours) {
    const style = document.createElement("style");
    style.textContent = STYLE;
    document.head.appendChild(style);
    const params = new URLSearchParams(location.search);
    const q = params.get("task");
    let index = tasks.findIndex((t) => t.id === q);
    if (index < 0 && q && /^\d+$/.test(q)) index = Math.min(tasks.length, Math.max(1, +q)) - 1;
    const chosen = index >= 0;
    if (!chosen) index = 0;
    const task = tasks[index];
    const challenge = params.get("challenge") === "1";
    const seed = params.has("seed") ? (Number(params.get("seed")) >>> 0) : (challenge ? 1 + Math.floor(Math.random() * 99999) : 1);
    const obs = params.get("obs") || (challenge ? "vision_only" : "multimodal");
    const start = toMin(task.time);
    const recKey = (t) => `${sceneKey}/${t.id}${challenge ? "#c" : ""}`;

    function go(i, extra) {
      const u = new URL(location.href);
      u.searchParams.set("task", tasks[i].id);
      u.searchParams.delete("seed");
      Object.entries(extra || {}).forEach(([k, v]) => (v === null ? u.searchParams.delete(k) : u.searchParams.set(k, v)));
      location.href = u.toString();
    }

    const picker = document.createElement("div");
    picker.id = "picker";
    document.body.appendChild(picker);
    function renderPicker() {
      const recs = loadAll();
      picker.innerHTML = `<div class="box"><button class="close" id="pickClose">关闭 <kbd>Esc</kbd></button>` +
        `<h2>${sceneName} · 选择任务</h2><div class="sub">同一张地图，不同的起点、终点和时间段；设施按时刻表开关。纪录只保存在这台电脑的浏览器里。</div>` +
        `<div class="mode"><label><input type="checkbox" id="pickChal"${challenge ? " checked" : ""}> 挑战模式</label>` +
        `<small>不给提示 · 每局随机关掉一些设施（偶尔会根本去不了）· 起雾 · 文字只说走了多远 · 上帝视角结算后才开</small></div>` +
        `<div class="list">${tasks.map((t, i) => {
          const r = recs[`${sceneKey}/${t.id}${challenge ? "#c" : ""}`];
          const rec = r && r.best ? `<div class="r">✓ 最佳 ${fmtSecs(r.best.seconds)} · ${r.best.meters} 米</div>` : `<div class="r no">${r ? `尝试 ${r.tries} 次，未完成` : "未挑战"}</div>`;
          return `<button class="card${i === index ? " cur" : ""}" data-i="${i}"><div class="t">${i + 1}. ${t.title}${t.isNew ? "<i>新</i>" : ""}</div>` +
            `<div class="m">${t.time} · 难度 <i>${stars(t.stars)}</i></div><div class="d">${t.startName} → ${t.goalName}</div>${rec}</button>`;
        }).join("")}</div></div>`;
      picker.querySelectorAll(".card").forEach((b) => (b.onclick = () => {
        const i = +b.dataset.i, c = picker.querySelector("#pickChal").checked;
        if (i === index && c === challenge) close(); else go(i, { challenge: c ? "1" : null });
      }));
      picker.querySelector("#pickClose").onclick = close;
    }
    function open() { renderPicker(); picker.style.display = "flex"; }
    function close() { picker.style.display = "none"; }
    window.addEventListener("keydown", (e) => { if (e.key === "Escape" && picker.style.display === "flex") close(); }, true);

    const big = document.createElement("div");
    big.id = "photoBig";
    big.innerHTML = `<img alt="朋友发来的照片"><div>朋友发来的照片 · 点任意处关闭</div>`;
    big.onclick = () => (big.style.display = "none");
    document.body.appendChild(big);

    const declareBox = document.createElement("div");
    declareBox.id = "declare";
    document.body.appendChild(declareBox);

    const top = document.getElementById("top");
    const btn = document.createElement("button");
    btn.id = "taskBtn";
    btn.innerHTML = `任务 <b>${index + 1}/${tasks.length}</b> ${task.title}${challenge ? " · 挑战" : ""} ▾`;
    btn.onclick = open;
    top.insertBefore(btn, top.querySelector("h1").nextSibling);

    const stats = document.getElementById("stats");
    const clockCell = document.createElement("div");
    clockCell.innerHTML = `<strong id="clock">${task.time}</strong><small>当前时间</small>`;
    stats.insertBefore(clockCell, stats.firstChild);
    const clockEl = clockCell.querySelector("strong");

    const T = {
      task, index, tasks, open, go, fmtMin, fmtSecs, toMin, inWindow, rng, challenge, seed, obs, start,
      vision: obs === "vision_only",
      closed: Object.assign({}, task.closed || {}),
      minutes: (secs) => start + (secs * RATE) / 60,
      clock(secs) { const m = T.minutes(secs); clockEl.textContent = fmtMin(m); return m; },
      showClock(m) { clockEl.textContent = fmtMin(m); return m; },
      say(full, vision) { return T.vision && vision !== undefined ? vision : full; },
      godLocked(done) { return challenge && !done; },
      status(key, minutes) {
        if (T.closed[key]) return { open: false, why: T.closed[key] };
        const h = hours && hours[key];
        if (!h) return { open: true, why: "" };
        const open = inWindow(minutes, h[0], h[1]);
        return { open, why: open ? "" : `${h[2]} 运营时间 ${h[0]}–${h[1]}，现在 ${fmtMin(minutes)}，已停运。` };
      },
      card(rows) {
        const extra = challenge
          ? `<div class="chal">挑战模式 · 第 ${seed} 局：${task.chalNote || "没有提示，部分设施可能临时关闭；去不了就按「做不到」并勾选原因。"}</div>`
          : (task.hint ? `<div class="tip">${task.hint}</div>` : "");
        return `<h3>任务 ${index + 1}/${tasks.length} · ${task.title}</h3>` +
          rows.map(([k, v]) => `<div><b>${k}</b>${v}</div>`).join("") + extra + `<div id="taskPhoto"></div>` +
          `<button id="declBtn" class="decl">判断做不到… <kbd>X</kbd></button>`;
      },
      photo(url) {
        const slot = document.getElementById("taskPhoto");
        if (!slot) return;
        slot.innerHTML = `<img class="photo" src="${url}" alt="朋友发来的照片" title="点击放大">`;
        slot.querySelector("img").onclick = () => { big.querySelector("img").src = url; big.style.display = "flex"; };
      },
      /* Ask which facilities make the task impossible; calls back with the ticked names. */
      declare(options, onSubmit) {
        declareBox.innerHTML = `<div class="box"><h3>判断：这个任务做不到</h3>` +
          `<p>确认后本局立即结束。勾选你认为走不通的原因：判断对、原因也对，才算完成。</p>` +
          `<div class="opts">${options.map((o, i) => `<label><input type="checkbox" value="${i}"> ${o}</label>`).join("")}</div>` +
          `<div class="btns"><button id="declCancel">再想想</button><button class="ok" id="declOk">确认：做不到</button></div></div>`;
        declareBox.style.display = "flex";
        declareBox.querySelector("#declCancel").onclick = () => (declareBox.style.display = "none");
        declareBox.querySelector("#declOk").onclick = () => {
          const picked = [...declareBox.querySelectorAll("input:checked")].map((x) => options[+x.value]);
          declareBox.style.display = "none";
          onSubmit(picked);
        };
      },
      reasonScore(blockers, text) {
        if (!blockers || !blockers.length) return 0;
        const hits = blockers.filter((words) => words.some((w) => text.indexOf(w) >= 0)).length;
        return Math.round((hits / blockers.length) * 100) / 100;
      },
      record(success, seconds, meters) {
        const all = loadAll(), k = recKey(task), r = all[k] || { tries: 0 };
        r.tries += 1;
        let isBest = false;
        if (success && (!r.best || seconds < r.best.seconds)) { r.best = { seconds: Math.round(seconds), meters: Math.round(meters) }; isBest = true; }
        all[k] = r; saveAll(all);
        return { best: r.best, isBest, tries: r.tries };
      },
      resultHTML(title, rows, success, seconds, meters) {
        const rec = T.record(success, seconds, meters);
        const recLine = success
          ? (rec.isBest ? `<b>新纪录！</b>第 ${rec.tries} 次尝试` : `本任务最佳 ${fmtSecs(rec.best.seconds)}（第 ${rec.tries} 次尝试）`)
          : `已尝试 ${rec.tries} 次`;
        const next = index + 1 < tasks.length;
        return `<h2>${title}</h2><div class="kv">${rows.map(([k, v]) => `<b>${k}</b><span>${v}</span>`).join("")}</div>` +
          `<div class="rec">${recLine}</div><div class="btns"><button id="again">再来一次</button>` +
          (challenge ? `<button id="reroll">换一局</button>` : "") +
          (next ? `<button id="nextTask" class="next">下一个任务 →</button>` : "") +
          `<button id="pickTask">选任务</button><button id="showGod">看上帝视角</button></div>`;
      },
      bindResult(again, god) {
        document.getElementById("again").onclick = again;
        document.getElementById("showGod").onclick = god;
        document.getElementById("pickTask").onclick = open;
        const rr = document.getElementById("reroll");
        if (rr) rr.onclick = () => go(index, { challenge: "1" });
        const n = document.getElementById("nextTask");
        if (n) n.onclick = () => go(index + 1, challenge ? { challenge: "1" } : null);
      },
    };
    if (!chosen && !params.has("ai")) setTimeout(open, 0);
    return T;
  }

  window.SATasks = { setup, stars, rng, toMin, fmtMin, inWindow };
})();
