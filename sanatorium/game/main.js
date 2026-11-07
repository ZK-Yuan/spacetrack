/* 雾岭疗养院（夜）· the game: boot, player, interaction, objectives, checkpoints, endings, HUD.
   The matron's brain lives in ai.js, the bodies in actors.js, the sound in audio.js. */
(function () {
  "use strict";
  const S = (window.SANA = window.SANA || {});
  const $ = (id) => document.getElementById(id);
  const G = (S.Game = {});
  const EYE = 1.6, CROUCH_EYE = 1.02, WALK = 2.1, RUN = 4.3, CROUCH = 1.05, ESCORT = 1.5, RADIUS = 0.24, REACH = 2.1;
  window.addEventListener("error", (e) => { $("err").textContent += (e.message || e) + "\n"; });
  const QS = new URLSearchParams(location.search);
  if (QS.has("ai")) {
    let seed = (+QS.get("seed") || 1934) >>> 0;
    Math.random = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  let D, scene, camera, flash, flashTarget, practical = [];
  const P = { x: 0, y: 0, z: 0, zt: 0, h: 0, pitch: 0, stamina: 1, breath: 1, crouch: 0, run: false, hidden: null, light: true,
    bob: 0, stepAcc: 0, moving: 0, noise: 0, onEntry: -1, trail: [] };
  const ST = { items: new Set(), opened: new Set(), power: false, sister: false, met: false, clues: new Set(), checkpoint: null,
    t: 0, spotted: 0, hidesUsed: 0, deaths: 0, dist: 0, mode: "loading", read: new Set(), safeSeen: new Set() };
  G.P = P; G.ST = ST;
  const keys = {};
  let doors = [], inter = [], target = null, lastZone = "", zoneT = 0, msgT = 0;

  /* ---------------------------------------------------------------- boot */
  function setLoad(t, f) { $("lmsg").textContent = t; if (f !== undefined) $("bar").firstChild.style.width = Math.round(f * 100) + "%"; }
  async function boot() {
    setLoad("读取关卡…", 0.05);
    D = await (await fetch("game/data/level.json")).json();
    G.D = D;
    await S.Walk.load("game/data/walk.bin.gz", D.grid);
    const q = { high: { scale: 1.0, shadows: true, msaa: 4 }, mid: { scale: 0.85, shadows: true, msaa: 2 }, low: { scale: 0.7, shadows: false, msaa: 0 } };
    const quality = QS.get("q") || (QS.has("ai") ? "low" : localStorage.getItem("sana.q") || "mid");
    $("quality").value = quality;
    const three = S.Engine.init($("view"), q[quality] || q.mid);
    scene = three.scene; camera = three.camera;
    S.Engine.onProgress((a, b) => setLoad("载入贴图和模型… " + a + "/" + b, 0.1 + 0.6 * a / Math.max(1, b)));
    setLoad("载入模型…", 0.15);
    await S.Props.loadModels();
    setLoad("搭建建筑…", 0.75);
    await new Promise((r) => setTimeout(r, 30));
    const info = S.Level.build(scene, D);
    S.Props.build(scene, D);
    practical = S.Props.lights(scene, D);
    S.Engine.setPractical(practical);
    G.triangles = info.triangles;
    buildFlashlight();
    buildDoors();
    if (S.Actors) S.Actors.init(scene, D);
    buildInteractables();
    if (S.AI) S.AI.init(D, G);
    // AI mode renders frames (and the photo task's picture) from the first step, so it waits for every texture
    if (QS.has("ai")) { setLoad("等待贴图…", 0.95); await S.Engine.texturesReady(90000); }
    setLoad("完成", 1);
    spawn(D.spawn.p, D.spawn.h);
    ST.checkpoint = snapshot();
    ST.mode = "menu";
    $("loading").classList.add("hide");
    $("loading").style.display = "none";
    $("menu").classList.remove("hide");
    if (QS.has("auto") || QS.has("ai")) startGame(true);
    if (QS.has("ai") && S.AIMode) S.AIMode.init(G);
    requestAnimationFrame(loop);
  }

  function buildFlashlight() {
    const cookie = S.Engine.canvasTex(256, 256, (g, w, h) => {
      const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      r.addColorStop(0, "#fff"); r.addColorStop(0.18, "#fff8ec"); r.addColorStop(0.24, "#d8cfc0"); r.addColorStop(0.32, "#f2eadc");
      r.addColorStop(0.55, "#8a8378"); r.addColorStop(0.85, "#2a2724"); r.addColorStop(1, "#000");
      g.fillStyle = r; g.fillRect(0, 0, w, h);
      g.globalAlpha = 0.08;
      for (let i = 0; i < 30; i++) { g.fillStyle = Math.random() < 0.5 ? "#000" : "#fff"; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 4 + Math.random() * 20, 0, 7); g.fill(); }
    });
    flash = new THREE.SpotLight(0xfff1dc, 20, 36, 0.44, 0.5, 1.0);
    flash.map = cookie;
    flash.castShadow = S.Engine.quality.shadows;
    flash.shadow.mapSize.set(1024, 1024);
    flash.shadow.camera.near = 0.15;
    flash.shadow.camera.far = 30;
    flash.shadow.bias = -0.0015;
    flash.shadow.normalBias = 0.07;
    flashTarget = new THREE.Object3D();
    G.bounce = new THREE.PointLight(0xffe6c8, 0, 7, 2);
    scene.add(flash, flashTarget, G.bounce);
    flash.target = flashTarget;
    G.flash = flash;
  }

  /* ---------------------------------------------------------------- doors */
  function doorMat(style) {
    const E = S.Engine;
    if (style === "gate") return S.Props.pm("rust");
    if (style === "fire") return E.mat("door_green");
    if (style === "main") return E.mat("door_wood");
    if (style === "lift") return E.mat("metal");
    if (style === "burnt") return E.mat("burnt");
    if (style === "chained") return S.Props.pm("rust");
    return E.mat("door_wood");
  }
  function buildDoors() {
    doors = D.doors.map((d, i) => {
      const id = i + 1;
      const g = new THREE.Group();
      const a = d.r * Math.PI / 180;
      const ux = Math.cos(a), uy = Math.sin(a);
      const leaves = [];
      const two = d.w > 1.7;
      const n = two ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const lw = d.w / n - 0.02;
        const pivot = new THREE.Group();
        const sgn = k === 0 ? -1 : 1;
        const hx = d.p[0] + ux * sgn * d.w / 2 * (two ? 1 : 1) * (k === 0 ? 1 : 1), hy = d.p[1] + uy * sgn * d.w / 2;
        pivot.position.set(k === 0 ? d.p[0] - ux * d.w / 2 : d.p[0] + ux * d.w / 2, d.p[2], -(k === 0 ? d.p[1] - uy * d.w / 2 : d.p[1] + uy * d.w / 2));
        pivot.rotation.y = a + (k === 0 ? 0 : Math.PI);
        const geo = d.style === "gate" ? gateGeo(lw, d.h - 0.05) : new THREE.BoxGeometry(lw, d.h - 0.04, 0.06);
        const mesh = new THREE.Mesh(geo, doorMat(d.style));
        mesh.position.set(lw / 2, (d.h - 0.04) / 2, 0);
        mesh.castShadow = true; mesh.receiveShadow = true;
        pivot.add(mesh);
        if (d.style !== "gate" && d.style !== "lift") {
          const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.14), S.Props.pm("steel"));
          handle.position.set(lw - 0.1, 1.0, 0);
          pivot.add(handle);
        }
        if (d.k === "chain" || d.style === "chained") {
          for (let c = 0; c < 8; c++) {
            const link = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 4, 8), S.Props.pm("steel"));
            link.position.set(lw - 0.05 - c * 0.055 * (k === 0 ? -1 : 1) * 0 , 1.05 + Math.sin(c) * 0.02, 0.05 + c * 0.0);
            link.position.x = lw - 0.04;
            link.position.y = 0.95 + c * 0.05;
            link.rotation.y = c % 2 ? Math.PI / 2 : 0;
            pivot.add(link);
          }
        }
        g.add(pivot);
        leaves.push({ pivot, sgn: k === 0 ? 1 : -1 });
      }
      scene.add(g);
      const open0 = false;
      S.Walk.setDoor(id, !open0);
      return { d, id, leaves, open: open0, ang: 0, target: 0, autoClose: 0, locked: true, nx: -uy, ny: ux };
    });
  }
  function gateGeo(w, h) {
    const b = new S.Props.PB();
    for (let x = 0.05; x < w; x += 0.12) b.box("rust", x - w / 2, 0, 0, 0.025, h, 0.025);
    for (const y of [-h / 2 + 0.1, 0, h / 2 - 0.1]) b.box("rust", 0, y, 0, w, 0.05, 0.04);
    const parts = b.done();
    return parts[0].geo;
  }
  function setDoorOpen(dr, open, swingSide) {
    dr.open = open;
    dr.target = open ? (swingSide || 1) * 1.65 : 0;
    S.Walk.setDoor(dr.id, !open);
    if (S.Audio) S.Audio.door([dr.d.p[0], dr.d.p[1], dr.d.p[2] + 1], open ? "open" : "close", dr.d.style);
    if (S.AI) S.AI.noise([dr.d.p[0], dr.d.p[1], dr.d.p[2]], 10, "door");
  }
  G.doors = () => doors;
  G.interactables = () => inter;
  G.interact = (o) => interact(o);
  G.closeNote = () => closeNote();
  G.side = (dr) => side(dr);
  G.setDoorOpen = (dr, open, sw) => setDoorOpen(dr, open, sw);
  G.objective = () => objective();
  G.zone = () => findZone();
  G.finish = (k) => finish(k);
  G.snapshot = () => snapshot();
  G.restore = (s) => restore(s);
  G.simTick = function (dt) {
    ST.t += dt;
    updateDoors(dt);
    if (S.AI) S.AI.update(dt, P, ST);
    if (S.Actors) S.Actors.update(dt, P, ST);
    if (ST.mode === "dying") { G.dyingT += dt; if (G.dyingT > 0.3) ST.mode = "dead"; }
    checkSafe();
  };
  G.render = function (dt) {
    placeCamera(dt || 0.016);
    S.Engine.updateLights(P.x, P.y, P.z, ST.t);
    S.Engine.render(ST.t);
  };
  G.npcDoor = (dr) => {
    if (dr.open) return;
    const sd = (S.AI.M.x - dr.d.p[0]) * dr.nx + (S.AI.M.y - dr.d.p[1]) * dr.ny > 0 ? 1 : -1;
    setDoorOpen(dr, true, -sd);
    dr.autoClose = 3.5;
  };
  G.doorOpen = (edge) => {
    const dr = doors.find((x) => x.d.edge === edge);
    return !dr || dr.open;
  };

  /* ---------------------------------------------------------------- interactables */
  function buildInteractables() {
    inter = [];
    doors.forEach((dr) => inter.push({ kind: "door", p: [dr.d.p[0], dr.d.p[1], dr.d.p[2] + 1.1], ref: dr }));
    for (const h of D.nav.hides) inter.push({ kind: "hide", p: [h.p[0], h.p[1], h.p[2] + 1.0], ref: h });
    for (const it of D.nav.items) {
      const p = it.key === "sister" && S.Actors ? [S.Actors.SI.x, S.Actors.SI.y, S.Actors.SI.z + 0.55] : [it.p[0], it.p[1], it.p[2] + 0.9];
      inter.push({ kind: "item", p, ref: it });
    }
    for (const n of D.notes) {
      inter.push({ kind: "note", p: n.p, ref: n });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.28), S.Props.pm("note"));
      const flat = n.p[2] % 1 < 0.1 || n.id === "start";
      m.position.set(n.p[0], n.p[2], -n.p[1]);
      if (flat) { m.rotation.set(-Math.PI / 2, 0, n.r * Math.PI / 180); m.position.y += 0.01; }
      else m.rotation.set(0, n.r * Math.PI / 180 - Math.PI / 2, 0);
      scene.add(m);
    }
    for (const c of D.chutes || []) inter.push({ kind: "chute", p: [c.p[0], c.p[1], c.p[2] + 0.9], ref: c });
    // item visuals
    for (const it of D.nav.items) {
      let m = null;
      if (it.key === "fuse") { m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 10), S.Props.pm("enamel")); m.rotation.z = Math.PI / 2; }
      if (it.key === "K1" || it.key === "K2") { m = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 12), S.Props.pm("brass")); m.rotation.x = Math.PI / 2; }
      if (it.key === "records") m = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.04, 0.33), S.Props.pm("canvas"));
      if (!m) continue;
      const z = it.key === "fuse" ? it.p[2] + 0.92 : it.key === "K1" ? it.p[2] + 0.8 : it.key === "K2" ? it.p[2] + 0.93 : it.p[2] + 1.0;
      m.position.set(it.p[0], z, -it.p[1]);
      scene.add(m);
      it.mesh = m;
    }
  }

  function findTarget() {
    const dir = viewDir();
    const eye = eyePos();
    let best = null, bs = 0;
    for (const o of inter) {
      if (o.done) continue;
      const dx = o.p[0] - eye[0], dy = o.p[1] - eye[1], dz = o.p[2] - eye[2];
      const d = Math.hypot(dx, dy, dz);
      if (d > REACH + (o.kind === "door" ? 0.4 : 0)) continue;
      const c = (dx * dir[0] + dy * dir[1] + dz * dir[2]) / d;
      if (c < 0.72) continue;
      const score = c * 2 - d * 0.3;
      if (score > bs && !S.Level.blocked(eye, [o.p[0] - dx / d * 0.35, o.p[1] - dy / d * 0.35, o.p[2] - dz / d * 0.35])) { bs = score; best = o; }
    }
    return best;
  }
  function promptFor(o) {
    if (!o) return "";
    if (o.kind === "door") {
      const dr = o.ref, d = dr.d;
      if (dr.open) return d.k === "oneway" ? "" : "";
      return "[E] " + ({ shortcut: "拔开插销", oneway: "推开", key: "开锁", chain: "解开铁链", power: "推开电动门", sealed: "试着开门", chained: "试着开门", lift: "按电梯" }[d.k] || "开门");
    }
    if (o.kind === "hide") return P.hidden ? "[E] 出来" : "[E] 躲进" + o.ref.label;
    if (o.kind === "item") return "[E] " + ({ phone: "捡起手机", fuse: "拿保险丝", K1: "拿钥匙", K2: "拿钥匙", records: "拿病历", sister: ST.met ? "" : "叫醒妹妹", power: ST.power ? "" : "检查配电柜" }[o.ref.key] || "拾取");
    if (o.kind === "note") return "[E] 阅读：" + o.ref.title;
    if (o.kind === "chute") return "[E] 跳进洗衣槽（回不来）";
    return "";
  }

  function interact(o) {
    if (!o) return;
    if (o.kind === "door") return useDoor(o.ref);
    if (o.kind === "hide") return P.hidden ? leaveHide() : enterHide(o.ref);
    if (o.kind === "note") return readNote(o.ref);
    if (o.kind === "chute") return useChute(o.ref);
    if (o.kind === "item") return useItem(o);
  }
  function side(dr) {
    return (P.x - dr.d.p[0]) * dr.nx + (P.y - dr.d.p[1]) * dr.ny > 0 ? 1 : -1;
  }
  function useDoor(dr) {
    const d = dr.d;
    if (dr.open) return;
    const sd = side(dr);
    if (d.k === "shortcut") {
      if (sd !== d.side) return say(d.label.replace("从这边拔开，", "这边没有插销——").replace("只能从山路这边推开", "从里面推不开，锁在外侧"), 3);
      ST.opened.add(d.id);
      setDoorOpen(dr, true, -sd);
      return say("插销拔开了。现在这扇门两边都能走——包括她。", 3);
    }
    if (d.k === "oneway") {
      if (sd !== d.side) return say("门这边没有把手，推不开。", 2.5);
      setDoorOpen(dr, true, -sd);
      dr.autoClose = 4.5;
      return;
    }
    if (d.k === "key" || d.k === "chain") {
      if (!ST.items.has(d.need)) return say(d.label, 3);
      ST.opened.add(d.id);
      setDoorOpen(dr, true, -sd);
      return say(d.k === "chain" ? "铁链哗啦一声落在地上。正门开了。" : "钥匙转动了。", 3);
    }
    if (d.k === "power") {
      if (!ST.power) return say(d.label + "。配电柜就在旁边。", 3);
      if (!ST.sister) return say("妹妹还在楼里。不能丢下她。", 3);
      ST.opened.add(d.id);
      setDoorOpen(dr, true, -sd);
      return say("电机嗡地一声，后门慢慢升了起来。", 3);
    }
    if (d.k === "lift") {
      if (!ST.power) return say("电梯：没电。指示灯是黑的。", 2.5);
      return useLift(dr);
    }
    say(d.label || "打不开。", 3);
    if (S.Audio) S.Audio.door([d.p[0], d.p[1], d.p[2] + 1], "rattle");
    if (S.AI) S.AI.noise([d.p[0], d.p[1], d.p[2]], 8, "rattle");
  }
  function useLift(dr) {
    const stops = [0, 1, 3, 6];
    const cur = dr.d.floor;
    const next = stops[(stops.indexOf(cur) + 1) % stops.length];
    const z = next === 0 ? 18.2 : 22.7 + 4.5 * (next - 1);
    say("电梯吱呀着动了…… 到了 " + (next === 0 ? "B1" : next + "F"), 3);
    spawn([3.75, 72.6, z], 270);
    if (ST.sister && S.Actors) S.Actors.placeSister(3.4, 73.2, z);
  }
  function useChute(c) {
    say("你钻进洗衣槽，顺着铁皮滑了下去……", 3);
    if (S.Audio) S.Audio.thud();
    if (S.AI) S.AI.noise(c.p, 14, "thud");
    spawn([c.to[0], c.to[1] + 1.2, c.to[2]], 90);
    if (ST.sister && S.Actors) S.Actors.placeSister(c.to[0] + 0.6, c.to[1] + 1.6, c.to[2]);
  }
  const ITEM_TEXT = {
    phone: ["妹妹的手机", "屏幕裂了，还剩 3% 的电。最后一条草稿没发出去：「我在新楼三楼的 307——不是老楼的那个 307。新楼在庭院北边坡上。」"],
    fuse: ["保险丝", "一枚陶瓷保险丝，标签：锅炉房总闸 · 备用。"],
    K1: ["大门钥匙", "一把很沉的铜钥匙，挂牌上写着「正门」。"],
    K2: ["档案室钥匙", "钥匙牌：服务翼 2F 档案室。"],
    records: ["1957 年病历", "病历记录了 1957 年冬天的一场「夜班事故」：三名病人在夜里失踪，护士长此后再没离开过这栋楼。"],
  };
  G.itemText = ITEM_TEXT;
  function useItem(o) {
    const it = o.ref;
    if (it.key === "sister") {
      if (ST.met) return;
      ST.met = true; ST.sister = true;
      o.done = true;
      if (S.Actors) S.Actors.wakeSister();
      say("「姐……？你真的来了。她刚才就在门外。」妹妹抓住你的手，跟在你身后。", 5);
      if (S.Audio) S.Audio.stinger("soft");
      return;
    }
    if (it.key === "power") {
      if (ST.power) return;
      if (!ST.items.has("fuse")) return say("配电柜的总闸少了一枚保险丝。", 3);
      ST.power = true;
      ST.items.delete("fuse");
      o.done = true;
      for (const L of practical) if (L.p[0] < -78 && L.p[1] < -60) L.on = true;
      if (S.Audio) S.Audio.power();
      if (S.AI) S.AI.noise(it.p, 60, "power");
      return say("你把保险丝按进去，扳下总闸。灯一盏盏亮了起来——电动后门有电了。远处传来一声尖叫。", 5);
    }
    o.done = true;
    if (it.mesh) it.mesh.visible = false;
    ST.items.add(it.key);
    if (it.key === "phone") ST.clues.add("new307");
    const t = ITEM_TEXT[it.key];
    if (t) readNote({ title: t[0], text: t[1] }, true);
    if (S.Audio) S.Audio.pickup();
  }
  function readNote(n, isItem) {
    $("ntitle").textContent = n.title;
    $("ntext").textContent = n.text;
    $("note").classList.remove("hide");
    ST.mode = "note";
    if (!isItem) ST.read.add(n.id);
    if (n.id === "old307") ST.clues.add("new307");
    if (n.id === "chapel_map") ST.clues.add("oldmap");
    if (S.Audio) S.Audio.paper();
  }
  function closeNote() { $("note").classList.add("hide"); ST.mode = "play"; }

  /* ---------------------------------------------------------------- hiding */
  function enterHide(h) {
    P.hidden = h;
    P.preHide = { x: P.x, y: P.y, z: P.z, h: P.h };
    const a = h.r * Math.PI / 180;
    const back = h.k === "niche" ? -0.5 : -0.15;
    P.x = h.p[0] + Math.cos(a) * back; P.y = h.p[1] + Math.sin(a) * back; P.z = P.zt = h.p[2];
    P.h = h.r; P.pitch = -0.05;
    ST.hidesUsed++;
    $("hideov").classList.toggle("hide", h.k === "niche");
    if (S.Audio) S.Audio.door([h.p[0], h.p[1], h.p[2] + 1], "locker");
    if (S.AI) S.AI.playerHid(h);
  }
  function leaveHide() {
    const h = P.hidden;
    if (!h) return;
    const a = h.r * Math.PI / 180;
    P.x = h.p[0] + Math.cos(a) * 0.75; P.y = h.p[1] + Math.sin(a) * 0.75;
    const s = S.Walk.stand(P.x, P.y, h.p[2], RADIUS, 0.8);
    if (s === null) { P.x = P.preHide.x; P.y = P.preHide.y; }
    P.zt = h.p[2];
    P.hidden = null;
    $("hideov").classList.add("hide");
    if (S.Audio) S.Audio.door([h.p[0], h.p[1], h.p[2] + 1], "locker");
  }
  G.forceOut = leaveHide;

  /* ---------------------------------------------------------------- player */
  function spawn(p, h) {
    P.x = p[0]; P.y = p[1];
    const k = S.Walk.entry(p[0], p[1], p[2], 1.5);
    P.z = P.zt = k >= 0 ? S.Walk.height(k) : p[2];
    P.h = h; P.pitch = 0; P.trail = [];
  }
  G.spawn = spawn;
  function viewDir() {
    const h = P.h * Math.PI / 180;
    return [Math.cos(h) * Math.cos(P.pitch), Math.sin(h) * Math.cos(P.pitch), Math.sin(P.pitch)];
  }
  function eyePos() { return [P.x, P.y, P.z + (P.crouch > 0.5 ? CROUCH_EYE : EYE)]; }
  G.eyePos = eyePos;
  G.viewDir = viewDir;

  function updatePlayer(dt) {
    if (P.hidden) {
      P.moving = 0;
      const want = keys.Space && P.breath > 0;
      P.holding = want;
      P.breath = Math.max(0, Math.min(1, P.breath + (want ? -dt / 9 : dt / 6)));
      return;
    }
    P.crouch += ((keys.KeyC || keys.ControlLeft ? 1 : 0) - P.crouch) * Math.min(1, dt * 8);
    const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    const s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    if (keys.ArrowLeft) P.h += 110 * dt;
    if (keys.ArrowRight) P.h -= 110 * dt;
    let speed = 0;
    const wantRun = keys.ShiftLeft || keys.ShiftRight;
    P.run = false;
    if (f || s) {
      const th = P.h * Math.PI / 180;
      let dx = Math.cos(th) * f + Math.sin(th) * s, dy = Math.sin(th) * f - Math.cos(th) * s;
      const n = Math.hypot(dx, dy); dx /= n; dy /= n;
      speed = P.crouch > 0.5 ? CROUCH : WALK;
      if (wantRun && P.stamina > 0.05 && P.crouch < 0.5 && f > 0) { speed = RUN; P.run = true; }
      if (ST.sister) speed = Math.min(speed, ESCORT);
      if (ST.sister && P.run) P.run = false;
      const B = { x: P.x, y: P.y, zt: P.zt };
      if (S.Walk.move(B, dx * speed * dt, dy * speed * dt, RADIUS)) {
        const d = Math.hypot(B.x - P.x, B.y - P.y);
        ST.dist += d;
        P.x = B.x; P.y = B.y; P.zt = B.zt;
        P.stepAcc += d;
      } else speed = 0;
    }
    P.moving = speed;
    P.stamina = Math.max(0, Math.min(1, P.stamina + (P.run ? -dt / 8 : dt / (P.moving ? 10 : 6))));
    P.z += (P.zt - P.z) * Math.min(1, dt * 12);
    // footsteps and noise
    const stride = P.run ? 1.15 : P.crouch > 0.5 ? 0.55 : 0.75;
    if (P.stepAcc > stride) {
      P.stepAcc = 0;
      const k = S.Walk.entry(P.x, P.y, P.z, 0.6);
      const surf = k >= 0 ? S.Walk.surf(k) : 2;
      const loud = P.run ? 1.0 : P.crouch > 0.5 ? 0.12 : 0.45;
      if (S.Audio) S.Audio.footstep(surf, loud);
      if (S.AI) S.AI.noise([P.x, P.y, P.z], P.run ? 16 : P.crouch > 0.5 ? 0 : 5.5, P.run ? "run" : "walk");
    }
    P.bob += dt * (P.moving ? (P.run ? 13 : 8.5) : 1.2);
    // breadcrumbs for the sister
    const last = P.trail[P.trail.length - 1];
    if (!last || Math.hypot(last[0] - P.x, last[1] - P.y) > 0.35) {
      P.trail.push([P.x, P.y, P.z]);
      if (P.trail.length > 400) P.trail.shift();
    }
  }

  let flashDir = new THREE.Vector3(1, 0, 0);
  function placeCamera(dt) {
    const eyeH = P.hidden ? 1.55 : EYE + (CROUCH_EYE - EYE) * P.crouch;
    const bobA = P.moving ? (P.run ? 0.055 : 0.03) : 0.008;
    camera.position.set(P.x, P.z + eyeH + Math.sin(P.bob * 2) * bobA, -P.y);
    camera.rotation.set(P.pitch + Math.sin(P.bob) * bobA * 0.08, (P.h - 90) * Math.PI / 180, Math.sin(P.bob) * bobA * 0.3);
    // flashlight: held low and right, lagging behind the view a little
    const want = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
    flashDir.lerp(want, Math.min(1, dt * 9)).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyEuler(camera.rotation);
    flash.position.copy(camera.position).addScaledVector(right, 0.22).add(new THREE.Vector3(0, -0.28, 0));
    flashTarget.position.copy(flash.position).addScaledVector(flashDir, 10);
    flashTarget.updateMatrixWorld();
    const flick = ST.flicker > 0 ? (Math.random() < 0.5 ? 0.1 : 1) : 1;
    flash.intensity = P.light && !P.hidden ? 20 * flick : 0;
    G.bounce.position.copy(camera.position).addScaledVector(flashDir, 1.6);
    G.bounce.intensity = P.light && !P.hidden ? 0.9 * flick : 0;
  }

  /* ---------------------------------------------------------------- objectives & HUD */
  function objective() {
    if (!ST.met) {
      if (ST.clues.has("new307")) return ["找到妹妹", "她在新楼的 307——新楼是庭院北边坡上那栋。从圆厅 3F 有空中连廊过去。"];
      return ["找到妹妹", "她说她躲在 307。疗养院里有两栋楼都有 307。"];
    }
    if (ST.power) return ["带妹妹离开", "后门有电了。从锅炉房西墙的电动门出去。"];
    const a = [];
    if (ST.items.has("K1")) a.push("回圆厅用钥匙打开正门，沿车道出去");
    if (ST.items.has("fuse")) a.push("去锅炉房装上保险丝：太平间（新楼 B1）的运尸隧道通到山下");
    if (!a.length) a.push("正门的铁链钥匙在院长办公室（新楼 6F）；后门是电动门，缺一枚保险丝（旧手术室，服务翼 1F）");
    return ["带妹妹离开（她跑不动）", a.join("；或者") + "。"];
  }
  let hudT = 0;
  function updateHUD(dt) {
    hudT -= dt;
    if (hudT <= 0) {
      hudT = 0.25;
      const o = objective();
      $("obj").innerHTML = "<b>" + o[0] + "</b>" + o[1];
      const inv = [];
      for (const k of ST.items) inv.push({ fuse: "保险丝", K1: "大门钥匙", K2: "档案室钥匙", phone: "妹妹的手机", records: "病历" }[k] || k);
      if (ST.sister) inv.push("妹妹");
      $("inv").innerHTML = inv.map((s) => "<span>" + s + "</span>").join("");
      $("flash").textContent = P.light ? "手电：开（F）" : "手电：关（F）";
      // location
      const z = findZone();
      if (z && z !== lastZone) { lastZone = z; $("loc").textContent = z; $("loc").style.opacity = 1; zoneT = 2.5; }
    }
    if (zoneT > 0) { zoneT -= dt; if (zoneT <= 0) $("loc").style.opacity = 0; }
    if (msgT > 0) { msgT -= dt; if (msgT <= 0) $("msg").style.opacity = 0; }
    $("prompt").textContent = ST.mode === "play" ? promptFor(target) : "";
    $("stam").style.opacity = P.stamina < 0.98 || P.hidden ? 1 : 0;
    $("stam").firstChild.style.width = Math.round((P.hidden ? P.breath : P.stamina) * 100) + "%";
    const aw = S.AI ? S.AI.awareness() : 0;
    $("eye").style.opacity = aw > 0.05 ? Math.min(1, 0.4 + aw) : 0;
    $("eyeball").setAttribute("fill", aw >= 1 ? "#d33" : "#e9c98d");
    $("eyeball").setAttribute("r", 2 + 4 * Math.min(1, aw));
  }
  function say(t, sec) { $("msg").textContent = t; $("msg").style.opacity = 1; msgT = sec || 3; }
  G.say = say;
  function findZone() {
    let best = null;
    for (const zn of D.zones) {
      if (Math.abs(zn.z - P.z) > 2.2 && !(zn.lv === "T" || zn.lv === "H")) continue;
      if (zn.lv === "T" || zn.lv === "H") continue;
      if (inPoly(P.x, P.y, zn.poly)) best = zn.name;
    }
    if (!best) {
      const k = S.Walk.entry(P.x, P.y, P.z, 0.6);
      if (k >= 0 && S.Walk.outdoor(k)) best = P.z < 15 && P.x < -40 ? "后山石阶" : null;
      if (P.z < 17.8 && P.z > 4.6 && !best) best = "运尸隧道";
    }
    return best;
  }
  function inPoly(x, y, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
  G.inPoly = inPoly;

  /* ---------------------------------------------------------------- old map */
  function drawMap() {
    const cv = $("mapc"), g = cv.getContext("2d"), W = cv.width, H = cv.height;
    g.fillStyle = "#c9b98f"; g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(90,60,30,0.18)";
    for (let i = 0; i < 40; i++) { g.beginPath(); g.arc(Math.random() * W, Math.random() * H, 4 + Math.random() * 20, 0, 7); g.fill(); }
    const x0 = -105, x1 = 60, y0 = -45, y1 = 62;
    const sc = Math.min(W / (x1 - x0), H / (y1 - y0));
    const T = (x, y) => [(x - x0) * sc, H - (y - y0) * sc];
    g.lineWidth = 1.2; g.strokeStyle = "#3a2e1e"; g.fillStyle = "rgba(90,70,40,0.22)";
    const old = new Set(["A1", "R1", "S1", "Y"]);
    for (const f of D.floors) {
      if (!old.has(f.lv) || f.mat === "grass" || f.mat === "cobble") continue;
      g.beginPath();
      f.poly.forEach((p, i) => { const q = T(p[0], p[1]); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); });
      g.closePath(); g.fill(); g.stroke();
    }
    g.fillStyle = "#3a2e1e"; g.font = "bold 20px serif";
    g.fillText("雾岭疗养院 院区图（1934）", 20, 34);
    g.font = "15px serif";
    for (const [t, x, y] of [["中央圆厅", -8, 0], ["病区翼", -60, -27], ["服务翼", 30, 12], ["庭院", -6, 40], ["礼拜堂", -42, 35], ["正门", -6, -16]]) {
      const q = T(x, y); g.fillText(t, q[0], q[1]);
    }
    const q = T(0, 61); g.fillText("↑ 北", q[0] - 10, q[1] + 18);
    if (P.x > x0 && P.x < x1 && P.y > y0 && P.y < y1 && P.z < 36) {
      const p = T(P.x, P.y);
      g.fillStyle = "#a01818"; g.beginPath(); g.arc(p[0], p[1], 6, 0, 7); g.fill();
      g.save(); g.translate(p[0], p[1]); g.rotate(-P.h * Math.PI / 180); g.beginPath(); g.moveTo(14, 0); g.lineTo(5, -4); g.lineTo(5, 4); g.fill(); g.restore();
    } else {
      g.fillStyle = "#6b1a1a"; g.font = "16px serif"; g.fillText("你现在的位置不在这张图上。", 20, H - 24);
    }
  }
  function toggleMap() {
    if (ST.mode === "map") { $("mapv").classList.add("hide"); ST.mode = "play"; return; }
    if (ST.mode !== "play") return;
    drawMap(); $("mapv").classList.remove("hide"); ST.mode = "map";
  }

  /* ---------------------------------------------------------------- checkpoints, death, endings */
  function snapshot() {
    return { p: [P.x, P.y, P.z], h: P.h, items: [...ST.items], opened: [...ST.opened], power: ST.power, sister: ST.sister, met: ST.met,
      clues: [...ST.clues], done: inter.filter((o) => o.done).map((o) => inter.indexOf(o)) };
  }
  function restore(s) {
    ST.items = new Set(s.items); ST.opened = new Set(s.opened); ST.power = s.power; ST.sister = s.sister; ST.met = s.met; ST.clues = new Set(s.clues);
    inter.forEach((o, i) => { o.done = s.done.includes(i); if (o.ref && o.ref.mesh) o.ref.mesh.visible = !o.done; });
    doors.forEach((dr) => { const op = ST.opened.has(dr.d.id); dr.open = op; dr.target = op ? 1.65 : 0; dr.ang = dr.target; S.Walk.setDoor(dr.id, !op); applyDoor(dr); });
    P.hidden = null; $("hideov").classList.add("hide");
    spawn(s.p, s.h);
    P.stamina = 1;
    if (S.Actors) S.Actors.reset(ST.sister ? [P.x - 0.8, P.y - 0.5, P.z] : null, ST.met);
    if (S.AI) S.AI.reset(P);
  }
  function checkSafe() {
    const k = S.Walk.entry(P.x, P.y, P.z, 0.6);
    const safe = k >= 0 && S.Walk.safe(k);
    P.safe = safe;
    if (safe && !P.hidden) {
      const key = Math.round(P.x / 10) + "," + Math.round(P.y / 10);
      if (!ST.lastSafe || Date.now() - ST.lastSafe > 4000) {
        ST.checkpoint = snapshot();
        ST.lastSafe = Date.now();
        if (!ST.safeSeen.has(key)) { ST.safeSeen.add(key); say("安全屋：她进不来这里。进度已保存。", 3.5); }
      }
    }
  }
  G.caught = function (by) {
    if (ST.mode !== "play") return;
    ST.mode = "dying";
    ST.deaths++;
    if (S.Audio) S.Audio.scream();
    S.Engine.post.red = 1;
    G.dyingT = 0;
    G.dyingFrom = by;
  };
  function updateDying(dt) {
    G.dyingT += dt;
    const m = G.dyingFrom;
    if (m) {
      const tx = m[0] - P.x, ty = m[1] - P.y;
      const want = Math.atan2(ty, tx) * 180 / Math.PI;
      let d = ((want - P.h + 540) % 360) - 180;
      P.h += d * Math.min(1, dt * 10);
      P.pitch += (0.12 - P.pitch) * Math.min(1, dt * 8);
    }
    S.Engine.post.fade = Math.min(1, Math.max(0, (G.dyingT - 0.9) / 0.6));
    if (G.dyingT > 1.6) {
      ST.mode = "dead";
      document.exitPointerLock();
      $("deadtxt").textContent = ["提灯的光照到你脸上的时候，已经太近了。", "她不跑，但她知道你会往哪里去。", "下次试试绕环路，或者躲进她没看见你进去的柜子。"][ST.deaths % 3];
      $("dead").classList.remove("hide");
    }
  }
  function retry(fromStart) {
    $("dead").classList.add("hide");
    S.Engine.post.red = 0; S.Engine.post.fade = 0;
    restore(fromStart ? G.initial : ST.checkpoint);
    ST.mode = "play";
    lockPointer();
  }
  function checkEndings() {
    if (!ST.sister) return;
    if (P.y < -47 && Math.abs(P.x) < 4.5 && P.z < 19) finish("main");
    if (P.x < -106.5 && P.y < -72 && P.y > -84 && P.z < 6) finish("rear");
  }
  function finish(kind) {
    if (ST.mode !== "play") return;
    ST.mode = "win";
    document.exitPointerLock();
    const min = Math.floor(ST.t / 60), sec = Math.floor(ST.t % 60);
    $("wintitle").textContent = kind === "main" ? "从正门离开" : "从后门离开";
    $("wintxt").textContent = kind === "main" ?
      "铁门在身后合上。车道尽头的雾里，疗养院的钟楼还停在三点零七分。妹妹一直没有回头。" :
      "电动门在你们身后落下。山下的雾薄了一点，你听见门后有人敲了三下，然后是一首走了调的摇篮曲。";
    $("winstats").textContent = `用时 ${min} 分 ${sec} 秒 · 走了 ${Math.round(ST.dist)} 米 · 被发现 ${ST.spotted} 次 · 躲藏 ${ST.hidesUsed} 次 · 重来 ${ST.deaths} 次`;
    $("win").classList.remove("hide");
  }

  /* ---------------------------------------------------------------- doors animation */
  function applyDoor(dr) {
    dr.leaves.forEach((l, i) => { l.pivot.rotation.y = dr.d.r * Math.PI / 180 + (i === 0 ? 0 : Math.PI) + dr.ang * l.sgn; });
  }
  function updateDoors(dt) {
    for (const dr of doors) {
      if (Math.abs(dr.ang - dr.target) > 1e-3) { dr.ang += (dr.target - dr.ang) * Math.min(1, dt * 4); applyDoor(dr); }
      if (dr.autoClose > 0) {
        dr.autoClose -= dt;
        const near = Math.hypot(P.x - dr.d.p[0], P.y - dr.d.p[1]) < 1.3;
        if (dr.autoClose <= 0) { if (near) dr.autoClose = 1; else setDoorOpen(dr, false); }
      }
    }
  }

  /* ---------------------------------------------------------------- input */
  function lockPointer() { const c = document.querySelector("#view canvas"); if (c && c.requestPointerLock) c.requestPointerLock(); }
  window.addEventListener("keydown", (e) => {
    keys[e.code] = true;
    if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    if (ST.mode === "note" && (e.code === "KeyE" || e.code === "Escape")) return closeNote();
    if (e.code === "KeyM") return toggleMap();
    if (ST.mode === "map" && e.code === "Escape") return toggleMap();
    if (ST.mode !== "play") return;
    if (e.code === "KeyE") interact(P.hidden ? { kind: "hide", ref: P.hidden } : target);
    if (e.code === "KeyF" && !P.hidden) { P.light = !P.light; if (S.Audio) S.Audio.click(); }
  });
  window.addEventListener("keyup", (e) => { keys[e.code] = false; });
  document.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement !== document.querySelector("#view canvas") || ST.mode !== "play") return;
    const lim = P.hidden ? 40 : 360;
    P.h -= e.movementX * 0.11;
    if (P.hidden) { let d = ((P.h - P.hidden.r + 540) % 360) - 180; if (Math.abs(d) > lim) P.h = P.hidden.r + Math.sign(d) * lim; }
    P.pitch = Math.max(-1.4, Math.min(1.4, P.pitch - e.movementY * 0.002));
  });
  document.addEventListener("pointerlockchange", () => {
    const locked = document.pointerLockElement === document.querySelector("#view canvas");
    if (!locked && ST.mode === "play" && !G.noPause) { ST.mode = "pause"; $("pause").classList.remove("hide"); $("pausetxt").textContent = objective().join("：");  }
  });
  $("view").addEventListener("click", () => { if (ST.mode === "play") lockPointer(); });
  $("start").onclick = () => startGame(false);
  $("resume").onclick = () => { $("pause").classList.add("hide"); ST.mode = "play"; lockPointer(); };
  $("pmap").onclick = () => { $("pause").classList.add("hide"); ST.mode = "play"; toggleMap(); };
  $("retry").onclick = () => retry(false);
  $("restart").onclick = () => retry(true);
  $("again").onclick = () => location.reload();
  $("quality").onchange = () => { localStorage.setItem("sana.q", $("quality").value); location.search = "?q=" + $("quality").value; };

  function startGame(auto) {
    $("menu").classList.add("hide");
    $("hud").classList.remove("hide");
    ST.mode = "play";
    G.initial = snapshot();
    if (S.Audio && !auto) S.Audio.start();
    if (!auto) lockPointer();
    say("围墙的破洞外面，雾比你想的还要浓。", 4);
  }

  /* ---------------------------------------------------------------- loop */
  let last = performance.now(), frames = 0, fpsT = 0;
  G.fps = 0;
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    if (G.aiMode) {
      // the world waits between actions and frames are rendered on demand (env.frame)
      setTimeout(() => requestAnimationFrame(loop), 250);
      return;
    }
    if (ST.mode === "play" || ST.mode === "dying") {
      ST.t += dt;
      if (ST.mode === "play") {
        updatePlayer(dt);
        target = P.hidden ? null : findTarget();
        checkSafe();
        checkEndings();
      } else updateDying(dt);
      updateDoors(dt);
      if (S.AI) S.AI.update(dt, P, ST);
      if (S.Actors) S.Actors.update(dt, P, ST);
      updateHUD(dt);
      fear(dt);
    }
    placeCamera(dt);
    S.Engine.updateLights(P.x, P.y, P.z, t);
    if (S.Audio) S.Audio.update(dt, P, ST);
    S.Engine.render(t);
    frames++; fpsT += dt;
    if (fpsT > 1) { G.fps = frames / fpsT; frames = 0; fpsT = 0; }
    requestAnimationFrame(loop);
  }
  function fear(dt) {
    const pp = S.Engine.post;
    const f = S.AI ? S.AI.fear() : 0;
    pp.fear += (f - pp.fear) * Math.min(1, dt * 2);
    pp.desat = 0.12 + pp.fear * 0.35;
    const k = S.Walk.entry(P.x, P.y, P.z, 0.6);
    const out = k >= 0 && S.Walk.outdoor(k);
    const fog = scene.fog;
    const wantD = out ? 0.032 : P.z < 17.5 ? 0.06 : 0.045;
    fog.density += (wantD - fog.density) * Math.min(1, dt);
    pp.exposure = 1.22;
    // without shadow maps the moon would shine through walls: keep it for outdoors only
    if (!S.Engine.quality.shadows) {
      const want = out ? 1.5 : 0.12;
      S.Engine.moon.intensity += (want - S.Engine.moon.intensity) * Math.min(1, dt * 2);
    }
  }

  /* ---------------------------------------------------------------- debug hooks (used by the automated playtest) */
  if (!QS.has("eval")) {
    S.debug = {
      tp: (x, y, z, h, pitch) => { spawn([x, y, z], h || 0); P.pitch = pitch || 0; },
      look: (h, pitch) => { P.h = h; P.pitch = pitch || 0; },
      give: (k) => ST.items.add(k), power: () => { ST.power = true; }, sister: () => { ST.met = ST.sister = true; if (S.Actors) S.Actors.wakeSister(); },
      state: () => ({ x: P.x, y: P.y, z: P.z, h: P.h, mode: ST.mode, items: [...ST.items], sister: ST.sister, power: ST.power, fps: G.fps, tri: G.triangles, zone: lastZone }),
      interact: () => interact(findTarget()), target: () => { const o = findTarget(); return o ? o.kind + ":" + (o.ref.id || o.ref.key || o.ref.label || "") : null; },
      keys, start: () => startGame(true), light: (on) => { P.light = on; }, retry, doors: () => doors.map((d) => [d.d.id, d.open]),
    };
  } else {
    Object.freeze(S);
  }
  boot().catch((e) => { console.error(e); $("lmsg").textContent = "加载失败：" + (e.message || e); });
})();
