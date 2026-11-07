/* Space Track · 旧宅翻新 (web): the six-room flat of renovate/layout.py (through renovate_layout.js), cleaned, painted,
   opened up and fitted out from a client's work order. Like the course (冲关模式), one body model drives both ways to play:
   自己玩 — WASD, mouse drag or arrow keys to look, tools on keys, in real time; AI 动作模式 — the world waits while you think
   and every action (walk / back / sidestep / turn / look and the tools) moves the clock on by what it costs.
   Every tool acts only on what the crosshair points at within 1.5 m. window.SPACEACT.env is the bench/runner.js API. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const L0 = window.SA_RENO;
  const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif';
  // calibration knobs for playtests: ?alpha=0.2,0.6,0.95 (stain levels 1..3) &reach=1.5 &radius=0.85
  const Q = new URLSearchParams(location.search);
  const num = (k, d) => (Q.has(k) && isFinite(Number(Q.get(k))) ? Number(Q.get(k)) : d);
  const EYE = L0.EYE, CEIL = L0.CEIL, DOOR_H = L0.DOOR_H, WIN_SILL = L0.WIN_SILL, WIN_HEAD = L0.WIN_HEAD, PART = L0.PART;
  const BODY_R = L0.BODY.radius, WALK = L0.BODY.walk, TURN_S = L0.BODY.turn_deg_s;
  const FOV = 66, ZOOM_FOV = 26, REACH = num("reach", 1.5), CLEAN_R = num("radius", 0.85), PICK_R = 0.6, BAG = 6, BIN_R = 1.6;
  const PITCH_MIN = -70, PITCH_MAX = 70, AI_PITCH = -4, LOOKS = { up: 50, level: -4, down: -50 };
  const FREE_WALK = 1.6, FREE_TURN = 110, FILM_WALK = 1.9, MAX_WALK = 20, MAX_WAIT = 600, PLAN_MAX = 12;
  const LEVEL_ALPHA = [0].concat((Q.get("alpha") || L0.STAIN_ALPHA.slice(1).join(",")).split(",").map(Number).slice(0, 3));
  const MIN = { look: 1 / 60, look_closer: 3 / 60, clean: 20 / 60, pick_up: 5 / 60, put_down: 5 / 60, dispose: 10 / 60, paint: 3, demolish: 5, install: 5, move_aside: 0.5 };
  const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = (k) => k * k * (3 - 2 * k);
  const norm180 = (h) => ((((h + 180) % 360) + 360) % 360) - 180;
  const angDiff = (a, b) => norm180(a - b);
  const headingOf = (dx, dy) => deg(Math.atan2(dy, dx));
  const lerpAng = (a, b, k) => a + angDiff(b, a) * k;
  const round = (v, k) => Math.round(v * k) / k;
  const v3 = (x, y, h) => new THREE.Vector3(x, h, -y);
  const rng = (seed) => window.SATasks.rng(seed);

  // ---------------------------------------------------------------- layout (renovate/layout.py)
  const COLORS = L0.COLORS, FIXTURES = L0.FIXTURES, ROOMS = L0.ROOMS, WALLS = L0.WALLS, FURN = L0.FURN, STAINS = L0.STAINS, TRASH = L0.TRASH;
  const DECOR = L0.DECOR || [];
  const RD = {};
  ROOMS.forEach((R) => (RD[R.id] = R));
  const ENTRANCE = { x: 6.0, y: 0.75, h: 90 }, KITCHEN = { x: 1.75, y: 2.1, h: 90 };

  // ---------------------------------------------------------------- tasks
  const BASE = [
    { id: "sweep", kind: "order", name: "无提示保洁", time: "09:00", stars: 3, start: ENTRANCE,
      items: [{ id: "clean", op: "clean", rooms: ["kitchen", "hall", "living"], label: "厨房、门厅、客厅的污渍全部擦掉" },
        { id: "trash", op: "trash", rooms: ["kitchen", "hall", "living"], label: "垃圾全部扔进门厅的大垃圾桶" }],
      startName: "门厅入户门", goalName: "厨房、门厅、客厅打扫干净",
      intro: "09:00，你是保洁队的师傅，刚进门厅。客户要求把厨房、门厅和客厅打扫干净：地上、墙上、台面上的污渍都要擦掉，垃圾扔进门厅的大垃圾桶。打扫完 stop。",
      ctrl: { id: "sweep_hud", name: "无提示保洁 · 有提示", hud: true } },
    { id: "paint_rel", kind: "order", name: "刷卧室", time: "09:00", stars: 4, start: ENTRANCE,
      items: [{ id: "paint", op: "paint", room: "second", color: "浅绿", label: "卫生间隔壁那间卧室四面墙刷成浅绿" },
        { id: "restore", op: "restore", label: "挪开的家具推回原位" }],
      startName: "门厅入户门", goalName: "卫生间隔壁那间卧室刷成浅绿",
      intro: "09:00，你是装修队的师傅，刚进门厅。客户要求：把卫生间隔壁那间卧室的四面墙都刷成浅绿，衣柜后面那面也要刷；刷完把挪开的家具推回原位。完工后 stop。",
      ctrl: { id: "paint_plate", name: "刷卧室 · 门牌", goalName: "门牌「卧室 B」那间刷成浅绿",
        intro: "09:00，你是装修队的师傅，刚进门厅。客户要求：把门牌「卧室 B」那间卧室的四面墙都刷成浅绿，衣柜后面那面也要刷；刷完把挪开的家具推回原位。完工后 stop。" } },
    { id: "install_rule", kind: "order", name: "按规则安装", time: "09:00", stars: 3, start: ENTRANCE,
      items: [{ id: "rad", op: "radiators", room: "second", label: "次卧每扇窗下装一个暖气片" },
        { id: "socket", op: "socket", room: "second", label: "次卧床头旁装一个插座" },
        { id: "smoke", op: "smoke", room: "second", label: "次卧天花板装一个烟感" }],
      startName: "门厅入户门", goalName: "次卧装好暖气片、插座、烟感",
      intro: "09:00，你是安装师傅，刚进门厅。客户要求：次卧（门牌「卧室 B」）每扇窗下装一个暖气片，床头旁装一个插座，天花板装一个烟感。装完 stop。",
      ctrl: { id: "install_marked", name: "按规则安装 · 标好位置", marks: true } },
    { id: "open_plan", kind: "order", name: "拆墙后走新路", time: "09:00", stars: 5, start: KITCHEN,
      items: [{ id: "demolish", op: "demolish", seg: "KL", label: "拆掉厨房和客厅之间的隔墙" },
        { id: "rubble", op: "rubble", seg: "KL", label: "碎渣清干净、扔进大垃圾桶" },
        { id: "carry", op: "carry", item: "tilebox", goal: { face: "living:W", u: 6.0 }, label: "厨房那箱瓷砖搬到客厅电视柜前" }],
      startName: "厨房", goalName: "拆墙 → 清碎渣 → 搬瓷砖到客厅电视柜前",
      intro: "09:00，你站在厨房中间。客户要求：先把厨房和客厅之间那道隔墙拆掉（附件平面图上涂黑的是承重墙，别动），碎渣清干净、扔进门厅的大垃圾桶；再把厨房那箱瓷砖搬到客厅电视柜前，到了 stop。",
      ctrl: { id: "open_plan_pre", name: "拆墙后走新路 · 墙已拆好", pre: "KL",
        items: [{ id: "carry", op: "carry", item: "tilebox", goal: { face: "living:W", u: 6.0 }, label: "厨房那箱瓷砖搬到客厅电视柜前" }],
        goalName: "搬瓷砖到客厅电视柜前",
        intro: "09:00，你站在厨房中间。厨房和客厅之间的隔墙前几天已经拆掉了。把厨房那箱瓷砖搬到客厅电视柜前，到了 stop。" } },
    // the bedroom is named by its wall colour, which the first item changes: the second item has to remember which room it was
    { id: "repaint_ref", kind: "order", name: "刷完再找", time: "09:00", stars: 5, start: ENTRANCE, paintFirst: "second",
      items: [{ id: "paint", op: "paint", room: "second", color: "浅绿", label: "墙是{wallB}的那间卧室四面墙刷成浅绿" },
        { id: "restore", op: "restore", label: "挪开的家具推回原位" },
        { id: "rad", op: "radiators", room: "second", label: "原来那间{wallB}卧室每扇窗下装一个暖气片" }],
      startName: "门厅入户门", goalName: "刷完{wallB}的那间卧室，再给它装暖气片",
      intro: "09:00，你是装修队的师傅，刚进门厅。工单：① 把墙是{wallB}的那间卧室四面墙都刷成浅绿，衣柜后面那面也要刷，挪开的家具推回原位；" +
        "② 漆干了以后，在原来那间{wallB}卧室的每扇窗下装一个暖气片（漆没干不能往墙上装东西）。全部完工后 stop。",
      ctrl: { id: "repaint_plate", name: "刷完再找 · 门牌", goalName: "刷完{wallB}的那间卧室，再给门牌「卧室 B」那间装暖气片",
        items: [{ id: "paint", op: "paint", room: "second", color: "浅绿", label: "墙是{wallB}的那间卧室四面墙刷成浅绿" },
          { id: "restore", op: "restore", label: "挪开的家具推回原位" },
          { id: "rad", op: "radiators", room: "second", label: "门牌「卧室 B」那间每扇窗下装一个暖气片" }],
        intro: "09:00，你是装修队的师傅，刚进门厅。工单：① 把墙是{wallB}的那间卧室四面墙都刷成浅绿，衣柜后面那面也要刷，挪开的家具推回原位；" +
          "② 漆干了以后，在门牌「卧室 B」那间的每扇窗下装一个暖气片（漆没干不能往墙上装东西）。全部完工后 stop。" } },
    { id: "full_order", kind: "order", name: "完整工单", time: "08:30", stars: 5, start: ENTRANCE,
      items: [{ id: "paint", op: "paint", room: "second", color: "浅绿", label: "卫生间隔壁那间卧室四面墙刷成浅绿" },
        { id: "restore", op: "restore", label: "挪开的家具推回原位" },
        { id: "rad", op: "radiators", room: "second", label: "那间卧室每扇窗下装一个暖气片" },
        { id: "demolish", op: "demolish", seg: "KL", label: "拆掉厨房和客厅之间的隔墙" },
        { id: "rubble", op: "rubble", seg: "KL", label: "碎渣清干净、扔进大垃圾桶" },
        { id: "clean", op: "clean", rooms: ["kitchen"], label: "厨房地面、墙面、台面擦干净" },
        { id: "trash", op: "trash", rooms: ["kitchen"], label: "厨房垃圾扔进大垃圾桶" }],
      startName: "门厅入户门", goalName: "七项工单",
      intro: "08:30，你是装修队的师傅，刚进门厅。工单：① 卫生间隔壁那间卧室四面墙刷成浅绿（衣柜后面也刷），挪开的家具推回原位；② 那间卧室每扇窗下装一个暖气片；③ 拆掉厨房和客厅之间的隔墙（涂黑的是承重墙，别动），碎渣清干净；④ 厨房擦干净，垃圾扔进门厅的大垃圾桶。全部完工后 stop。" },
  ];
  const TASKS = [];
  BASE.forEach((t) => {
    t.chalNote = "污渍和垃圾的位置、脏的程度、瓷砖箱、墙色、要刷的颜色和开局朝向都按这一局重新随机，记住的路线和脏点用不上。";
    const { ctrl, ...main } = t;
    TASKS.push(Object.assign({ isNew: true, title: t.name, maxSteps: 400 }, main));
    if (ctrl) TASKS.push(Object.assign({ isNew: true, maxSteps: 400 }, main, ctrl, { title: ctrl.name, ctrlOf: t.id, stars: Math.max(1, t.stars - 1) }));
  });
  const T = window.SATasks.setup("renovate", "旧宅翻新", TASKS, null);
  let TK = T.task;   // reassigned only by verifyWorld(), which runs every task on this seed's world
  const STILL = Q.has("ai"), CALIB = Q.has("calib");
  /* Evaluation mode (?eval=1): a seeded-random world like the challenge mode, and the page exposes only the env API. */
  const EVAL = Q.get("eval") === "1";
  const RULES = "AI 动作模式：世界在你思考时暂停，每个动作按它耗的时间推进时钟（走路 1.25 米/秒，转身 120°/秒，擦一遍 20 秒，刷一面墙 3 分钟）。" +
    "每一步只能看到一张第一视角画面和一句动作结果；没有进度百分比、没有高亮、没有小地图。画面中心的白色十字是准星：施工动作只作用于准星正前方 1.5 米内的东西，" +
    "要先走到跟前、转过去、调好视线俯仰再动手。附件是客户画的平面图，涂黑的是承重墙。";
  const ACTIONS = ["walk(米)", "back(米)", "sidestep(米，正数向左)", "turn(度，正数左转)", "look(度，视线俯仰 -70～70，负数低头)", "look_closer",
    "clean", "pick_up", "put_down", "dispose", "paint(颜色：" + Object.keys(COLORS).join("/") + ")", "demolish", "install(暖气片|插座|烟感)", "move_aside",
    "wait(秒)", "plan([动作, ...]，最多 12 个，每个算一步)", "stop", "declare_impossible(理由)", "give_up"];
  const ACTION_NAMES = ACTIONS.map((a) => a.split("(")[0]);

  // ---------------------------------------------------------------- renderer
  const canvas = $("view");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.localClippingEnabled = true;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);
  const camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.05, 60);
  camera.rotation.order = "YXZ";
  scene.add(camera);

  // ---------------------------------------------------------------- textures and models
  const IMG = {}, MODELS = {};
  function loadImages() {
    const src = Object.assign({}, window.SA_RENO_TEX || {});
    if (LM) {
      src.sky = LM.sky;
      Object.entries(LM.variants).forEach(([v, files]) => Object.entries(files).forEach(([k, f]) => (src[lmKey(v, k)] = f)));
    }
    return Promise.all(Object.keys(src).map((k) => new Promise((res) => {
      const im = new Image();
      im.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = c.height = 1;
          const g = c.getContext("2d");
          g.drawImage(im, 0, 0, 1, 1);
          g.getImageData(0, 0, 1, 1);
          IMG[k] = im;
        } catch (e) { /* a file:// page without file access: plain colours instead of photos */ }
        res();
      };
      im.onerror = () => res();
      im.src = src[k];
    })));
  }
  /* GLBs exported from the Blender scene (blender/renovate_scene.py --export-web); boxes stand in for any that fail. */
  function loadModels() {
    if (!THREE.GLTFLoader || Q.has("boxes")) return Promise.resolve();
    const loader = new THREE.GLTFLoader(), packed = window.SA_RENO_GLB || {};
    const ids = FURN.map((f) => f.id).concat(["decor"]);
    return Promise.all(ids.map((id) => new Promise((res) => {
      const done = setTimeout(res, 20000), ok = (g) => { MODELS[id] = g.scene; clearTimeout(done); res(); }, fail = () => { clearTimeout(done); res(); };
      if (packed[id]) {
        // models.js (base64) works from file:// pages, where fetch() of the .glb would be refused
        const bin = atob(packed[id]), buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        loader.parse(buf.buffer, "models/renovate/", ok, fail);
      } else loader.load(`models/renovate/${id}.glb`, ok, undefined, fail);
    })));
  }
  function canvasOf(w, h, draw) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    return c;
  }
  function texOf(source, repeat) {
    const t = source instanceof HTMLCanvasElement ? new THREE.CanvasTexture(source) : new THREE.Texture(source);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
    return t;
  }
  function photo(key, fallback) {
    return texOf(IMG[key] || canvasOf(64, 64, (g) => { g.fillStyle = fallback; g.fillRect(0, 0, 64, 64); }), true);
  }
  /* Fallback for the stain PNGs (assets/renovate_textures.py) when the page cannot read image files. */
  function stainCanvas(seed) {
    return canvasOf(128, 128, (g) => {
      const R = rng(seed);
      for (let i = 0; i < 12; i++) {
        const x = 64 + (R() - 0.5) * 50, y = 64 + (R() - 0.5) * 50, r = 14 + R() * 24, gr = g.createRadialGradient(x, y, 1, x, y, r);
        gr.addColorStop(0, "rgba(80,60,40,0.55)"); gr.addColorStop(1, "rgba(80,60,40,0)");
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
    });
  }
  const STAIN_TEX = {};
  function stainTex(look, seed) {
    if (!STAIN_TEX[look]) STAIN_TEX[look] = IMG[`stain_${look}`] ? texOf(IMG[`stain_${look}`]) : texOf(stainCanvas(seed));
    return STAIN_TEX[look];
  }
  // ---------------------------------------------------------------- baked light (blender/renovate_bake.py)
  /* Every floor, ceiling and wall of every room has a Cycles-baked lightmap. Room surfaces are unlit materials whose
     texture is multiplied by it (MeshBasicMaterial adds lightMap × intensity / π), so they show the bake's soft shadows,
     bounced light and sun patches; what moves keeps real-time lights. Without the lightmaps (a file:// page that cannot
     read images) the real-time look is used throughout. */
  const LM = window.SA_RENO_LM || null;
  const GRAIN = 0.85;   // mean of the scan_plaster grain map (assets/renovate_textures.py)
  let LIT = false, LM_OPEN = false, LIT_MATS = [];
  const LM_TEX = {}, LM_PIX = {};
  function lmKey(variant, key) { return `lm:${variant}:${key}`; }
  function lmCur(key) { return lmKey(LM_OPEN && LM.variants.open[key] ? "open" : "closed", key); }
  function lmTex(key) {
    const k = lmCur(key);
    if (!LM_TEX[k]) { const t = new THREE.Texture(IMG[k]); t.colorSpace = THREE.SRGBColorSpace; t.channel = 1; t.needsUpdate = true; LM_TEX[k] = t; }
    return LM_TEX[k];
  }
  function litMat(o, key) {
    const m = new THREE.MeshBasicMaterial(o);
    m.lightMap = lmTex(key); m.lightMapIntensity = Math.PI * LM.scale;
    m.userData.lmKey = key;
    LIT_MATS.push(m);
    return m;
  }
  /* Partition KL knocked down: the kitchen and the living room switch to the lightmaps baked without it. */
  function relight() {
    const open = LIT && !!segs[LM.open_seg] && !segs[LM.open_seg].present;
    if (open === LM_OPEN) return;
    LM_OPEN = open;
    LIT_MATS.forEach((m) => { m.lightMap = lmTex(m.userData.lmKey); });
  }
  /* The baked light at (u, v) of a surface: the factor its albedo is multiplied by. */
  function lightAt(key, u, v) {
    const k = lmCur(key), im = IMG[k];
    if (!LIT || !im) return 1;
    if (!LM_PIX[k]) { const c = canvasOf(im.width, im.height, (g) => g.drawImage(im, 0, 0)); LM_PIX[k] = { w: im.width, h: im.height, d: c.getContext("2d").getImageData(0, 0, im.width, im.height).data }; }
    const px = LM_PIX[k], x = clamp(Math.round(u * (px.w - 1)), 0, px.w - 1), y = clamp(Math.round((1 - v) * (px.h - 1)), 0, px.h - 1), i = (y * px.w + x) * 4;
    const lin = (b) => { const c = b / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return LM.scale * (0.2126 * lin(px.d[i]) + 0.7152 * lin(px.d[i + 1]) + 0.0722 * lin(px.d[i + 2]));
  }
  /* Lightmap UVs (attribute uv1) from world positions, the same mapping the bake used. fn(x, y, z, nx, ny) in game axes. */
  function setUV1(g, fn) {
    const p = g.attributes.position, n = g.attributes.normal, a = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const [u, v] = fn(p.getX(i), -p.getZ(i), p.getY(i), n ? n.getX(i) : 0, n ? -n.getZ(i) : 0);
      a[2 * i] = u; a[2 * i + 1] = v;
    }
    g.setAttribute("uv1", new THREE.BufferAttribute(a, 2));
    return g;
  }
  const faceUV = (F) => (x, y, z) => [((F.ax === "x" ? x : y) - F.u0) / (F.u1 - F.u0), z / CEIL];
  const roomUV = (R) => (x, y) => [(x - R.r[0]) / (R.r[2] - R.r[0]), (y - R.r[1]) / (R.r[3] - R.r[1])];
  /* A wall piece's big faces read their own room's lightmap; its edges (reveals, ends) read the room side's. */
  function wallUV1(g, s) {
    const near = faces[s.sides.pos] || faces[s.sides.neg];
    return setUV1(g, (x, y, z, nx, ny) => {
      const across = s.ax === "x" ? ny : nx, F = (Math.abs(across) > 0.5 && faces[s.sides[across > 0 ? "pos" : "neg"]]) || near;
      return F ? faceUV(F)(x, y, z) : [0, 0];
    });
  }
  function wallColor(name, tiled) { return tiled ? new THREE.Color(1, 1, 1) : new THREE.Color(COLORS[name]).multiplyScalar(1 / GRAIN); }
  /* Frames, casings and skirting on a face share its lightmap. */
  function faceLit(F, kind) {
    F.lit = F.lit || {};
    // casings get a little extra: the bake's walnut also shows its varnish highlights, which an unlit material cannot
    if (!F.lit[kind]) F.lit[kind] = litMat(kind === "doorframe" ? { map: TX.walnut, color: new THREE.Color().setScalar(1.8) } : { color: kind === "trim" ? "#f4f2ed" : "#f2efe8" }, F.id);
    return F.lit[kind];
  }
  function skyOnce() {
    const t = new THREE.Texture(IMG.sky);
    t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
    scene.background = t; scene.backgroundIntensity = LM.sky_intensity;
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromEquirectangular(t).texture;
    pm.dispose();
  }

  const skyCanvas = () => canvasOf(256, 256, (g, S) => {
    const gr = g.createLinearGradient(0, 0, 0, S);
    gr.addColorStop(0, "#8fbbe6"); gr.addColorStop(0.55, "#d6e7f4"); gr.addColorStop(0.7, "#eef3f2"); gr.addColorStop(0.72, "#8aa77a"); gr.addColorStop(1, "#5f7d55");
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    const R = rng(5);
    for (let i = 0; i < 9; i++) { g.fillStyle = "rgba(255,255,255,0.55)"; g.beginPath(); g.ellipse(R() * S, 30 + R() * 70, 30 + R() * 30, 9 + R() * 6, 0, 0, Math.PI * 2); g.fill(); }
    for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(${70 + R() * 30 | 0},${100 + R() * 30 | 0},${60 + R() * 20 | 0},0.9)`; g.beginPath(); g.arc(R() * S, S * 0.72 + R() * 8, 10 + R() * 18, 0, Math.PI * 2); g.fill(); }
  });
  const plateCanvas = (text) => canvasOf(256, 96, (g, w, h) => {
    g.fillStyle = "#f7f4ec"; g.strokeStyle = "#5c5040"; g.lineWidth = 6;
    g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, 12); g.fill(); g.stroke();
    g.fillStyle = "#2b251d"; g.font = `700 46px ${FONT}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, w / 2, h / 2 + 2);
  });
  /* Soft contact shadow under pieces that move (their shadows are not in the bake). */
  const blobCanvas = () => canvasOf(128, 128, (g) => { g.filter = "blur(14px)"; g.fillStyle = "#fff"; g.fillRect(26, 26, 76, 76); });
  const WALL_TILE = 2.0, FLOOR_TILE = { wood: 1.7, tiles: 3.0, terrazzo: 2.0 }, CEIL_TILE = 2.0;   // metres per texture tile of the scans
  const dustCanvas = () => canvasOf(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    gr.addColorStop(0, "rgba(232,226,214,0.9)"); gr.addColorStop(1, "rgba(232,226,214,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });

  let TX = null, MAT = null;
  function makeMaterials() {
    TX = { wood: photo("wood", "#a07a52"), plaster: photo("plaster", "#e8e4dc"), tiles: photo("tiles", "#e9ebea"), terrazzo: photo("terrazzo", "#cfc8bc"),
      ceiling: photo("ceiling", "#f0eee8"), darkwood: photo("darkwood", "#6b4f3a"), sky: texOf(skyCanvas()), dust: texOf(dustCanvas()), blob: texOf(blobCanvas()) };
    LIT = !!LM && !!IMG.sky && !!IMG.scan_plaster && Object.entries(LM.variants).every(([v, files]) => Object.keys(files).every((k) => IMG[lmKey(v, k)]));
    if (LIT) {
      Object.assign(TX, { grain: photo("scan_plaster", "#d9d9d9"), laminate: photo("scan_laminate", "#a07a52"), floorTiles: photo("scan_floor_tiles", "#e4e1dc"),
        terrazzoScan: photo("scan_terrazzo", "#dcd5c8"), ceilingScan: photo("scan_ceiling", "#f3f1ec"), wallTiles: photo("scan_wall_tiles", "#eeeeea"),
        walnut: photo("scan_walnut", "#6e4f3a") });
      TX.grain.colorSpace = THREE.NoColorSpace;   // linear grain around GRAIN, multiplied by the paint colour
      TX.wallTiles.repeat.set(WALL_TILE / 1.27, WALL_TILE / 1.27);
      renderer.toneMapping = THREE.AgXToneMapping;
      renderer.toneMappingExposure = LM.exposure;
      skyOnce();
    }
    const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.85 }, o));
    MAT = {
      floor: { wood: std({ map: TX.wood, color: "#f3e7d6", roughness: 0.62 }), tiles: std({ map: TX.tiles, roughness: 0.4 }),
        terrazzo: std({ map: TX.terrazzo, roughness: 0.5 }) },
      ceiling: std({ map: TX.ceiling, color: "#ffffff", roughness: 0.95 }),
      edge: std({ map: TX.plaster, color: "#e2ddd3" }),
      facade: std({ color: "#b9b2a6" }),
      frame: std({ color: "#f2efe8", roughness: 0.5 }),
      trim: std({ color: "#f4f2ed", roughness: 0.4 }),
      doorframe: std({ map: TX.darkwood, color: "#a07b58", roughness: 0.6 }),
      sky: LIT ? new THREE.MeshBasicMaterial({ color: "#dfe8ec", transparent: true, opacity: 0.07, depthWrite: false })
        : new THREE.MeshBasicMaterial({ map: TX.sky, side: THREE.DoubleSide }),
      wood: std({ map: TX.darkwood, color: "#cfa47a", roughness: 0.7 }),
      darkwood: std({ map: TX.darkwood, color: "#7a5a42", roughness: 0.6 }),
      white: std({ color: "#f1f0ec", roughness: 0.35 }),
      top: std({ color: "#d9d3c5", roughness: 0.45 }),
      fabric: std({ color: "#6e8196", roughness: 0.95 }),
      pillow: std({ color: "#f3efe6", roughness: 0.9 }),
      black: std({ color: "#141516", roughness: 0.25 }),
      steel: std({ color: "#8e949a", roughness: 0.4, metalness: 0.5 }),
      green: std({ color: "#3f6e4c", roughness: 0.6 }),
      card: std({ color: "#b98a55", roughness: 0.85 }),
      tape: std({ color: "#d9c27a", roughness: 0.6 }),
      lamp: new THREE.MeshBasicMaterial({ color: "#fff6e2" }),
      rubble: std({ color: "#a39d92", roughness: 1 }),
      red: std({ color: "#c0392b", roughness: 0.5 }),
      sponge: std({ color: "#e8c547", roughness: 0.9 }),
      scrub: std({ color: "#3c7d3a", roughness: 0.9 }),
      drill: std({ color: "#e2b33c", roughness: 0.5 }),
    };
  }

  // ---------------------------------------------------------------- geometry helpers
  /* World-space box projection: textures keep the same scale on every wall piece, chunk and prop. */
  function worldUV(g, s) {
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
      let u, v;
      if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); } else if (ay >= az) { u = p.getX(i); v = p.getZ(i); } else { u = p.getX(i); v = p.getY(i); }
      uv.setXY(i, u / s, v / s);
    }
    uv.needsUpdate = true;
    return g;
  }
  /* Box from plan extents: x0..x1, y0..y1, z0..z1. */
  function boxMesh(x0, y0, x1, y1, z0, z1, mat, uvScale) {
    const g = new THREE.BoxGeometry(Math.max(0.001, x1 - x0), Math.max(0.001, z1 - z0), Math.max(0.001, y1 - y0));
    g.translate((x0 + x1) / 2, (z0 + z1) / 2, -(y0 + y1) / 2);
    worldUV(g, uvScale || 1);
    return new THREE.Mesh(g, mat);
  }
  function cylMesh(x, y, z0, z1, r, mat, seg) {
    const g = new THREE.CylinderGeometry(r, r, z1 - z0, seg || 20);
    g.translate(x, (z0 + z1) / 2, -y);
    return new THREE.Mesh(g, mat);
  }
  const noRay = (m) => { m.raycast = () => {}; return m; };
  const inRect = (x, y, r, m) => x > r[0] - m && x < r[2] + m && y > r[1] - m && y < r[3] + m;
  function roomAt(x, y) { return ROOMS.find((R) => x > R.r[0] && x < R.r[2] && y > R.r[1] && y < R.r[3]); }

  // ---------------------------------------------------------------- world state (rebuilt by reset)
  let root = null, segs = {}, faces = {}, furn = {}, stains = [], trash = [], fixtures = [], targets = [], blockCache = null;
  const P = { x: 0, y: 0, h: 90, pitch: AI_PITCH, zoom: false, steps: 0, minutes: 0, walked: 0, bag: [], carrying: null, done: false,
    success: false, text: "", delivered: false, declared: false, reason: "", reasonScore: 0, lbHit: false, removed: [], trail: [], falseDone: false, shown: false };
  const C = { x: 0, y: 0, h: 90, p: AI_PITCH, fov: FOV, sx: 0, sy: 0, sz: 0 };
  const EP = { mode: "ai" };
  let anims = [];
  let budget = 400;

  /* How far a wall piece reaches past its end to close a corner or T: the half-thickness of the thickest wall crossing there.
     Not where another wall carries on along the same line (as blender/renovate_scene.py): reaching into it would lay one
     room's wall face over the next room's on the same plane, and the two flicker. */
  function endExt(s, at) {
    if (Object.values(segs).some((o) => o !== s && o.ax === s.ax && Math.abs(o.c - s.c) < 1e-6 && (Math.abs(o.s0 - at) < 1e-6 || Math.abs(o.s1 - at) < 1e-6))) return 0;
    let half = 0;
    Object.values(segs).forEach((o) => {
      if (o === s || o.ax === s.ax) return;
      if (Math.abs(o.c - at) < 1e-6 && s.c >= o.s0 - 1e-6 && s.c <= o.s1 + 1e-6) half = Math.max(half, o.t / 2);
    });
    return half > 0 ? half - 0.004 : 0;
  }
  function makeFaces() {
    faces = {};
    ROOMS.forEach((R) => {
      const [x0, y0, x1, y1] = R.r;
      [["N", "x", y1, x0, x1, [0, -1]], ["S", "x", y0, x0, x1, [0, 1]], ["E", "y", x1, y0, y1, [-1, 0]], ["W", "y", x0, y0, y1, [1, 0]]].forEach(([side, ax, line, u0, u1, nrm]) => {
        const F = { id: `${R.id}:${side}`, room: R.id, side, ax, line, u0, u1, normal: nrm, segs: [], color: R.wall, orig: R.wall,
          partial: false, stain: false, painted: false };
        F.mat = LIT ? litMat({ map: R.tiled ? TX.wallTiles : TX.grain, color: wallColor(R.wall, R.tiled) }, F.id)
          : new THREE.MeshStandardMaterial({ map: R.tiled ? TX.tiles : TX.plaster, color: COLORS[R.wall], roughness: R.tiled ? 0.4 : 0.92 });
        if (LIT) {
          // reveals and wall ends: the face's paint without its grain (a sliver of texture at a grazing angle flickers);
          // it shares the face's Color, so paint reaches it too
          F.edge = litMat({}, F.id);
          F.edge.color = F.mat.color;
          if (!R.tiled) F.edge.lightMapIntensity *= GRAIN;
        }
        Object.values(segs).forEach((s) => {
          if (s.ax !== ax || Math.abs(s.c - line) > 1e-6 || Math.min(s.s1, u1) - Math.max(s.s0, u0) < 0.05) return;
          F.segs.push(s.id);
          // the room lies on the negative side of its N / E wall and on the positive side of its S / W wall
          s.sides[side === "N" || side === "E" ? "neg" : "pos"] = F.id;
        });
        faces[F.id] = F;
      });
    });
  }
  function segAt(F, u) { return F.segs.map((id) => segs[id]).find((s) => u >= s.s0 - 1e-6 && u <= s.s1 + 1e-6) || segs[F.segs[0]]; }
  function facePlane(F, u) { const s = segAt(F, u), t = s ? s.t : PART; return F.side === "N" || F.side === "E" ? F.line - t / 2 : F.line + t / 2; }
  function facePoint(F, u, d) { const pl = facePlane(F, u); return F.ax === "x" ? [u, pl + F.normal[1] * d] : [pl + F.normal[0] * d, u]; }
  function holesOf(s) {
    return (s.ops || []).map((o) => ({ o, a: o.at - o.w / 2, b: o.at + o.w / 2, z0: o.k === "door" ? 0 : (o.sill || WIN_SILL), z1: o.k === "door" ? DOOR_H : (o.head || WIN_HEAD) }))
      .sort((p, q) => p.a - q.a);
  }
  function sideMat(s, side) { const fid = s.sides[side]; return fid ? faces[fid].mat : MAT.facade; }
  /* One wall piece between a..b along the wall and z0..z1 up; its two big faces wear the materials of the rooms on either side.
     Pieces standing on the floor block the body, and get a skirting board on each room side. */
  function wallPiece(s, a, b, z0, z1, group) {
    const h = s.t / 2, uvs = LIT ? WALL_TILE : 1.2;
    const neg = sideMat(s, "neg"), pos = sideMat(s, "pos"), edge = LIT ? faces[s.sides.pos || s.sides.neg].edge : MAT.edge;
    let m;
    if (s.ax === "x") {
      m = boxMesh(a, s.c - h, b, s.c + h, z0, z1, null, uvs);
      m.material = [edge, edge, edge, edge, neg, pos];
    } else {
      m = boxMesh(s.c - h, a, s.c + h, b, z0, z1, null, uvs);
      m.material = [pos, neg, edge, edge, edge, edge];
    }
    if (LIT) wallUV1(m.geometry, s);
    m.userData = { t: "wall", seg: s.id, a, b, z0, z1 };
    group.add(m); s.pieces.push(m); targets.push(m);
    if (z0 > 0.001) return m;
    s.blocks.push(s.ax === "x" ? [a, s.c - h, b, s.c + h] : [s.c - h, a, s.c + h, b]);
    ["neg", "pos"].forEach((k) => {
      const F = s.sides[k] && faces[s.sides[k]];
      if (!F || RD[F.room].tiled) return;
      const u0 = Math.max(a, F.u0 + h * 0), u1 = Math.min(b, F.u1);
      if (u1 - u0 < 0.05) return;
      const sg = k === "pos" ? 1 : -1, w0 = s.c + sg * h, w1 = s.c + sg * (h + 0.014), mat = LIT ? faceLit(F, "trim") : MAT.trim;
      const sk = s.ax === "x" ? boxMesh(u0, Math.min(w0, w1), u1, Math.max(w0, w1), 0, 0.085, mat) : boxMesh(Math.min(w0, w1), u0, Math.max(w0, w1), u1, 0, 0.085, mat);
      if (LIT) setUV1(sk.geometry, faceUV(F));
      group.add(noRay(sk));
    });
    return m;
  }
  function buildSeg(s) {
    const g = new THREE.Group();
    s.group = g; s.pieces = []; s.panes = []; s.blocks = [];
    const holes = holesOf(s), ext0 = endExt(s, s.s0), ext1 = endExt(s, s.s1), h = s.t / 2;
    // the pieces round an opening overlap by E and the frames cover the reveals: pieces that only touch leave hairline
    // cracks along T-junctions, and a frame face lying on a reveal flickers between the two
    const E = 0.002;
    let cur = s.s0 - ext0;
    holes.forEach((hh) => {
      if (hh.a - cur > 0.002) wallPiece(s, cur, hh.a + E, 0, CEIL, g);
      if (hh.z0 > 0) wallPiece(s, hh.a, hh.b, 0, hh.z0 + E, g);
      wallPiece(s, hh.a, hh.b, hh.z1 - E, CEIL, g);
      cur = hh.b - E;
      const near = faces[s.sides.pos] || faces[s.sides.neg];
      const lit = (m, kind) => { if (LIT && near) { m.material = faceLit(near, kind); setUV1(m.geometry, faceUV(near)); } return m; };
      const box = (a, b, z0, z1, d, mat) => {
        const m = s.ax === "x" ? boxMesh(a, s.c - d, b, s.c + d, z0, z1, mat, 0.8) : boxMesh(s.c - d, a, s.c + d, b, z0, z1, mat, 0.8);
        g.add(noRay(lit(m, mat === MAT.doorframe ? "doorframe" : "frame")));
      };
      if (hh.o.k === "win") {
        const pane = s.ax === "x" ? boxMesh(hh.a, s.c - 0.01, hh.b, s.c + 0.01, hh.z0, hh.z1, MAT.sky) : boxMesh(s.c - 0.01, hh.a, s.c + 0.01, hh.b, hh.z0, hh.z1, MAT.sky);
        pane.userData = { t: "win", seg: s.id, op: hh.o };
        g.add(pane); s.panes.push(pane); targets.push(pane);
        box(hh.a, hh.a + 0.06, hh.z0, hh.z1, h + 0.01, MAT.frame); box(hh.b - 0.06, hh.b, hh.z0, hh.z1, h + 0.01, MAT.frame);
        box(hh.a, hh.b, hh.z1 - 0.06, hh.z1, h + 0.01, MAT.frame); box(hh.a, hh.b, hh.z0, hh.z0 + 0.05, h + 0.01, MAT.frame);
        box((hh.a + hh.b) / 2 - 0.025, (hh.a + hh.b) / 2 + 0.025, hh.z0, hh.z1, 0.03, MAT.frame);
        const inSide = s.sides.pos ? 1 : -1;
        const sill = s.ax === "x" ? boxMesh(hh.a - 0.06, s.c + inSide * h - (inSide > 0 ? 0 : 0.14), hh.b + 0.06, s.c + inSide * h + (inSide > 0 ? 0.14 : 0), hh.z0 - 0.03, hh.z0 + 0.01, MAT.frame)
          : boxMesh(s.c + inSide * h - (inSide > 0 ? 0 : 0.14), hh.a - 0.06, s.c + inSide * h + (inSide > 0 ? 0.14 : 0), hh.b + 0.06, hh.z0 - 0.03, hh.z0 + 0.01, MAT.frame);
        g.add(noRay(lit(sill, "frame")));
      } else {
        // casings wrap 4 mm into the opening, so they line the reveals instead of lying on them
        box(hh.a - 0.05, hh.a + 0.004, 0, hh.z1 + 0.05, h + 0.012, MAT.doorframe); box(hh.b - 0.004, hh.b + 0.05, 0, hh.z1 + 0.05, h + 0.012, MAT.doorframe);
        box(hh.a - 0.05, hh.b + 0.05, hh.z1 - 0.004, hh.z1 + 0.05, h + 0.012, MAT.doorframe);
        if (hh.o.plate) plate(s, hh, g);
        // nobody walks out of the front door
        if (hh.o.ext) s.blocks.push(s.ax === "x" ? [hh.a, s.c - 0.6, hh.b, s.c] : [s.c - 0.6, hh.a, s.c, hh.b]);
      }
    });
    if (s.s1 + ext1 - cur > 0.002) wallPiece(s, cur, s.s1 + ext1, 0, CEIL, g);
    root.add(g);
  }
  /* Door plate on the side you approach from (the side that is not the named room). */
  function plate(s, hh, g) {
    const named = ROOMS.find((R) => R.name === hh.o.plate || R.plate === hh.o.plate);
    const side = ["pos", "neg"].find((k) => s.sides[k] && faces[s.sides[k]].room !== (named && named.id));
    if (!side) return;
    const sgn = side === "pos" ? 1 : -1, u = hh.b + 0.24, off = s.t / 2 + 0.006;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.13), new THREE.MeshStandardMaterial({ map: texOf(plateCanvas(hh.o.plate)), roughness: 0.6 }));
    if (s.ax === "x") { m.position.copy(v3(u, s.c + sgn * off, 1.55)); m.rotation.y = sgn > 0 ? Math.PI : 0; } else { m.position.copy(v3(s.c + sgn * off, u, 1.55)); m.rotation.y = sgn > 0 ? Math.PI / 2 : -Math.PI / 2; }
    g.add(noRay(m));
  }

  // ---------------------------------------------------------------- furniture, stains, trash
  /* Simple boxes: the aiming proxy every piece keeps, and what people see when the Blender GLB is missing. */
  function furnBoxes(f, g) {
    const [x0, y0, x1, y1] = f.r, h = f.h, add = (m) => { g.add(m); return m; };
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    switch (f.kind) {
      case "counter":
        add(boxMesh(x0, y0, x1, y1 - 0.03, 0.1, h - 0.04, MAT.wood, 0.8)); add(boxMesh(x0, y0, x1, y1, 0, 0.1, MAT.darkwood));
        add(boxMesh(x0, y0, x1 + 0.02, y1 + 0.02, h - 0.04, h, MAT.top));
        break;
      case "bin":
        add(cylMesh(cx, cy, 0, h - 0.06, 0.28, MAT.green)); add(cylMesh(cx, cy, h - 0.06, h, 0.3, MAT.green));
        f.lid = add(boxMesh(cx - 0.16, cy - 0.16, cx + 0.16, cy + 0.16, h, h + 0.02, MAT.black));
        break;
      case "bed":
        add(boxMesh(x0, y0, x1, y1, 0, 0.3, MAT.darkwood)); add(boxMesh(x0 + 0.03, y0 + 0.03, x1 - 0.03, y1 - 0.03, 0.3, h, MAT.pillow));
        add(boxMesh(x0, y1 - 0.06, x1, y1, 0, 1.05, MAT.darkwood));
        break;
      case "tv":
        add(boxMesh(x0, y0, x1, y1, 0, h, MAT.darkwood)); add(boxMesh(x0 + 0.06, cy - 0.62, x0 + 0.11, cy + 0.62, h + 0.08, h + 0.78, MAT.black));
        break;
      case "sofa":
        add(boxMesh(x0, y0, x1, y1, 0.1, 0.45, MAT.fabric)); add(boxMesh(x1 - 0.22, y0, x1, y1, 0.1, h, MAT.fabric)); add(boxMesh(x0, y0, x1, y1, 0, 0.1, MAT.darkwood));
        break;
      case "box":
        add(boxMesh(x0, y0, x1, y1, 0, h, MAT.card, 0.6)); add(boxMesh(x0 - 0.002, cy - 0.03, x1 + 0.002, cy + 0.03, h - 0.002, h + 0.002, MAT.tape));
        break;
      default:
        add(boxMesh(x0, y0, x1, y1, 0, h, { fridge: MAT.white, toilet: MAT.white, tub: MAT.white, sink: MAT.white }[f.kind] || MAT.wood, 0.8));
    }
  }
  function furnGroup(f) {
    const g = new THREE.Group(), boxes = new THREE.Group();
    furnBoxes(f, boxes);
    g.add(boxes);
    const m = MODELS[f.id];
    if (m) {
      // the GLB's origin is the footprint centre on the floor; the boxes stay as the invisible aiming proxy
      const vis = m.clone(true);
      vis.position.copy(v3((f.r[0] + f.r[2]) / 2, (f.r[1] + f.r[3]) / 2, 0));
      vis.traverse(noRay);
      g.add(vis);
      boxes.visible = false;
    }
    if (LIT && (f.movable || f.carry)) {
      const [x0, y0, x1, y1] = f.r, pad = 0.16;
      const blob = noRay(new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + 2 * pad, y1 - y0 + 2 * pad), new THREE.MeshBasicMaterial({ map: TX.blob, color: 0x000000,
        transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 })));
      blob.rotation.x = -Math.PI / 2;
      blob.position.copy(v3((x0 + x1) / 2, (y0 + y1) / 2, 0.002));
      g.add(blob); f.blob = blob;
    }
    g.userData = { t: "furn", f: f.id };
    return g;
  }
  /* Trash pieces keep their geometry centred and sit where they lie through their position, so they can fly to the bag. */
  function trashGroup(tr) {
    const g = new THREE.Group(), [x, y] = tr.p, R = rng(tr.id.length * 31 + 7);
    if (tr.kind === "can") {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.12, 16), MAT.red);
      m.rotation.set(0, 0.6, Math.PI / 2, "YXZ"); m.position.copy(v3(x, y, 0.034)); g.add(m);
    } else if (tr.kind === "paper" || tr.kind === "rubble") {
      const n = tr.kind === "paper" ? 1 : 6;
      for (let i = 0; i < n; i++) {
        const r = tr.kind === "paper" ? 0.075 : 0.06 + R() * 0.07, geo = new THREE.IcosahedronGeometry(r, 1), pos = geo.attributes.position;
        for (let k = 0; k < pos.count; k++) pos.setXYZ(k, pos.getX(k) * (0.75 + R() * 0.5), pos.getY(k) * (0.6 + R() * 0.5), pos.getZ(k) * (0.75 + R() * 0.5));
        geo.computeVertexNormals();
        const m = new THREE.Mesh(geo, tr.kind === "paper" ? MAT.pillow : MAT.rubble);
        m.position.copy(v3(x + (i ? (R() - 0.5) * 0.4 : 0), y + (i ? (R() - 0.5) * 0.4 : 0), r * 0.7)); g.add(m);
      }
    } else if (tr.kind === "pizza") {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.045, 0.34), MAT.card);
      m.rotation.y = 0.3; m.position.copy(v3(x, y, 0.0225)); g.add(m);
    } else {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 14), new THREE.MeshStandardMaterial({ color: "#7fb2c9", roughness: 0.2, transparent: true, opacity: 0.8 }));
      m.rotation.set(0, -0.4, Math.PI / 2, "YXZ"); m.position.copy(v3(x, y, 0.035)); g.add(m);
    }
    g.userData = { t: "trash", tr: tr.id };
    return g;
  }
  /* Where a stain sits in 3D, and its plane's orientation. */
  function stainPose(st) {
    if (st.on === "floor") return { pos: v3(st.p[0], st.p[1], 0.003 + (st.rubble ? 0.002 : 0)), rot: [-Math.PI / 2, 0, 0] };
    if (st.on === "furn") { const f = furn[st.furn]; return { pos: v3(st.p[0], st.p[1], f.h + 0.004), rot: [-Math.PI / 2, 0, 0] }; }
    const F = faces[st.face], [x, y] = facePoint(F, st.u, 0.004);
    const ry = { N: 0, S: Math.PI, E: -Math.PI / 2, W: Math.PI / 2 }[F.side];
    return { pos: v3(x, y, st.z), rot: [0, ry, 0] };
  }
  /* With baked light a stain is unlit too, darkened or brightened by the light the bake found where it lies. */
  function stainLight(st) {
    if (st.on === "wall") { const F = faces[st.face]; return lightAt(F.id, (st.u - F.u0) / (F.u1 - F.u0), st.z / CEIL); }
    const R = roomAt(st.p[0], st.p[1]);
    if (!R) return 1;
    const [u, v] = roomUV(R)(st.p[0], st.p[1]);
    return lightAt(`${R.id}:floor`, u, v) * (st.on === "furn" ? 1.15 : 1);
  }
  function stainMesh(st, alpha) {
    const o = { map: stainTex(st.look, st.id.length * 97 + st.id.charCodeAt(0)), transparent: true, depthWrite: false, opacity: alpha,
      polygonOffset: true, polygonOffsetFactor: -2 };
    const mat = LIT ? new THREE.MeshBasicMaterial(Object.assign(o, { color: new THREE.Color().setScalar(stainLight(st)) }))
      : new THREE.MeshStandardMaterial(Object.assign(o, { roughness: 0.95 }));
    const m = noRay(new THREE.Mesh(new THREE.PlaneGeometry(st.size, st.size), mat));
    const ps = stainPose(st);
    m.position.copy(ps.pos); m.rotation.set(ps.rot[0], ps.rot[1], ps.rot[2], "YXZ");
    if (st.on === "floor" || st.on === "furn") m.rotation.set(-Math.PI / 2, 0, (st.id.length % 5) * 0.7);
    return m;
  }
  function addStain(st) {
    st.max = st.max || st.level;
    st.mesh = stainMesh(st, LEVEL_ALPHA[st.level]); root.add(st.mesh);
    if (st.on === "furn") furn[st.furn].stains.push(st);
    stains.push(st);
  }

  // ---------------------------------------------------------------- challenge / evaluation worlds
  /* ?challenge=1 and ?eval=1 draw the world from the seed (layout VARY): the flat and the work orders stay, but where the
     stains are and how bad, the trash, the tile box, the wall colours, the colour to paint and the start heading change,
     so a route or a list of dirty spots learnt on one seed does not carry over. bench/make_seed_bank.py keeps only seeds
     whose every task the oracle finishes. */
  const VARIED = T.challenge || EVAL;
  const WORLD = { stains: STAINS, trash: TRASH, dh: 0 };
  function variant(seed) {
    // murmur3's finaliser first: an LCG started from neighbouring seeds draws nearly the same first numbers
    const mix = (h) => { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; };
    const V = L0.VARY, R = rng(mix(seed + 97));
    const pick = (a) => a[Math.floor(R() * a.length)];
    const uni = (a, b) => a + (b - a) * R();
    Object.entries(V.walls).forEach(([rid, cs]) => (RD[rid].wall = pick(cs.filter((c) => rid !== "second" || c !== RD.master.wall))));
    const paint = pick(V.paint.filter((c) => c !== RD.second.wall && c !== RD.master.wall));
    TASKS.forEach((t) => {
      const sub = (s) => (s ? s.split("浅绿").join(paint) : s);
      t.intro = sub(t.intro); t.goalName = sub(t.goalName);
      t.items.forEach((it) => { if (it.op === "paint") { it.color = paint; it.label = sub(it.label); } });
    });
    // the tile box: kitchen floor, clear of the other furniture, the start and the way in from the hall door
    const box = FURN.find((f) => f.carry), bw = box.r[2] - box.r[0], bd = box.r[3] - box.r[1], [ax0, ay0, ax1, ay1] = V.tilebox;
    for (let k = 0; k < 400; k++) {
      const x = uni(ax0, ax1 - bw), y = uni(ay0, ay1 - bd), cx = x + bw / 2, cy = y + bd / 2;
      if (FURN.some((f) => f !== box && inRect(cx, cy, f.r, 0.75))) continue;
      if (Math.hypot(cx - KITCHEN.x, cy - KITCHEN.y) < 0.9 || (cx > 2.4 && Math.abs(cy - 2.6) < 0.8)) continue;
      box.r = [x, y, x + bw, y + bd].map((v) => round(v, 100));
      break;
    }
    // stains and trash on free floor of their own room: off furniture, the rug, plants and lamps, and apart
    const used = [];
    const spot = (room, size, rug) => {
      const [x0, y0, x1, y1] = RD[room].r;
      for (let k = 0; k < 500; k++) {
        const x = uni(x0 + 0.45, x1 - 0.45), y = uni(y0 + 0.45, y1 - 0.45);
        if (FURN.some((f) => inRect(x, y, f.r, size / 2 + 0.3))) continue;
        if (DECOR.some((d) => (d.p && Math.hypot(x - d.p[0], y - d.p[1]) < size / 2 + 0.45) || (rug && d.kind === "rug" && inRect(x, y, d.r, size / 2 + 0.05)))) continue;
        if (used.some(([ux, uy, ur]) => Math.hypot(x - ux, y - uy) < ur + size / 2 + 0.25)) continue;
        used.push([x, y, size / 2]);
        return [round(x, 100), round(y, 100)];
      }
      return null;
    };
    const level = () => 1 + Math.floor(R() * 3);
    WORLD.stains = STAINS.map((d) => {
      const st = Object.assign({}, d, { level: level() });
      if (d.on === "floor") st.p = spot(roomAt(d.p[0], d.p[1]).id, d.size, true) || d.p.slice();
      if (d.on === "wall" && V.wall_spots[d.id]) {
        const [face, spans, zs] = pick(V.wall_spots[d.id]), total = spans.reduce((a, s) => a + s[1] - s[0], 0);
        let u = R() * total;
        const span = spans.find((s) => (u -= s[1] - s[0]) <= 0) || spans[spans.length - 1];
        Object.assign(st, { face, u: round(Math.min(span[1], span[1] + u), 100), z: round(uni(zs[0], zs[1]), 100) });
      }
      return st;
    });
    WORLD.trash = TRASH.map((d) => Object.assign({}, d, { p: spot(roomAt(d.p[0], d.p[1]).id, 0.35, false) || d.p.slice() }));
    WORLD.dh = round(uni(-V.heading, V.heading), 10);
  }

  // ---------------------------------------------------------------- build / reset
  function build() {
    if (root) { scene.remove(root); root.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    camera.children.filter((o) => o.userData.holder).forEach((o) => camera.remove(o));
    root = new THREE.Group(); scene.add(root);
    targets = []; stains = []; trash = []; fixtures = []; furn = {}; segs = {}; blockCache = null;
    LIT_MATS = []; LM_OPEN = false;
    WALLS.forEach((d) => (segs[d.id] = { id: d.id, ax: d.ax, c: d.c, s0: d.s[0], s1: d.s[1], t: d.t, lb: !!d.lb, ops: d.ops || [], sides: {}, present: true }));
    makeFaces();
    Object.values(segs).forEach(buildSeg);
    const FLOOR_TX = LIT ? { wood: TX.laminate, tiles: TX.floorTiles, terrazzo: TX.terrazzoScan } : null;
    ROOMS.forEach((R) => {
      const [x0, y0, x1, y1] = R.r;
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), LIT ? litMat({ map: FLOOR_TX[R.floor] }, `${R.id}:floor`) : MAT.floor[R.floor]);
      fl.rotation.x = -Math.PI / 2; fl.position.copy(v3((x0 + x1) / 2, (y0 + y1) / 2, 0)); fl.updateMatrix();
      fl.geometry.applyMatrix4(fl.matrix); fl.position.set(0, 0, 0); fl.rotation.set(0, 0, 0);
      worldUV(fl.geometry, LIT ? FLOOR_TILE[R.floor] : R.floor === "wood" ? 1.6 : 1.2);
      if (LIT) setUV1(fl.geometry, roomUV(R));
      fl.userData = { t: "floor", room: R.id }; root.add(fl); targets.push(fl);
      const ce = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), LIT ? litMat({ map: TX.ceilingScan }, `${R.id}:ceil`) : MAT.ceiling);
      ce.rotation.x = Math.PI / 2; ce.position.copy(v3((x0 + x1) / 2, (y0 + y1) / 2, CEIL)); ce.updateMatrix();
      ce.geometry.applyMatrix4(ce.matrix); ce.position.set(0, 0, 0); ce.rotation.set(0, 0, 0); worldUV(ce.geometry, LIT ? CEIL_TILE : 1.5);
      if (LIT) setUV1(ce.geometry, roomUV(R));
      ce.userData = { t: "ceil", room: R.id }; root.add(ce); targets.push(ce);
      root.add(noRay(cylMesh(R.hub[0], R.hub[1], CEIL - 0.04, CEIL - 0.005, 0.2, MAT.lamp, 24)));
    });
    FURN.forEach((d) => {
      const f = Object.assign({}, d, { r: d.r.slice(), orig: d.r.slice(), moved: false, stains: [], taken: false });
      f.room = roomAt((f.r[0] + f.r[2]) / 2, (f.r[1] + f.r[3]) / 2).id;
      f.against = againstFace(f);
      f.group = furnGroup(f); root.add(f.group); targets.push(f.group); furn[f.id] = f;
    });
    if (MODELS.decor) { const d = MODELS.decor.clone(true); d.traverse(noRay); root.add(d); }
    WORLD.stains.forEach((d) => addStain(Object.assign({}, d, { p: d.p && d.p.slice(), max: d.level })));
    WORLD.trash.forEach((d) => { const tr = Object.assign({}, d, { p: d.p.slice(), taken: false, disposed: false }); tr.room = roomAt(tr.p[0], tr.p[1]).id; tr.group = trashGroup(tr); root.add(tr.group); targets.push(tr.group); trash.push(tr); });
    stains.forEach((st) => (st.room = st.on === "wall" ? faces[st.face].room : st.on === "furn" ? furn[st.furn].room : roomAt(st.p[0], st.p[1]).id));
  }
  /* The face a piece of furniture stands flush against (its back within 3 cm of the wall surface), if any. */
  function againstFace(f) {
    const [x0, y0, x1, y1] = f.r, room = roomAt((x0 + x1) / 2, (y0 + y1) / 2);
    const F = Object.values(faces).find((Fc) => {
      if (!room || Fc.room !== room.id) return false;
      const pl = facePlane(Fc, Fc.ax === "x" ? (x0 + x1) / 2 : (y0 + y1) / 2);
      const back = { N: y1, S: y0, E: x1, W: x0 }[Fc.side];
      return Math.abs(back - pl) < 0.03;
    });
    return F ? F.id : null;
  }
  /* Real-time light for what is not baked (furniture models, trash, tools); with baked light the sky environment adds to it. */
  function lightsOnce() {
    const k = LIT ? LIGHT_K : { hemi: 1.7, sun: 0.7, lamp: 5 };
    scene.add(new THREE.HemisphereLight(0xfffaf2, 0xd6cbbb, k.hemi));
    const sun = new THREE.DirectionalLight(0xfff0dc, k.sun); sun.position.set(6, 10, -4); scene.add(sun); scene.add(sun.target);
    ROOMS.forEach((R) => { const l = new THREE.PointLight(0xffe8cc, k.lamp, 10, 1.3); l.position.copy(v3(R.hub[0], R.hub[1], CEIL - 0.35)); scene.add(l); });
  }
  const LIGHT_K = { hemi: num("hemi", 0.9), sun: num("sun", 0.5), lamp: num("lamp", 2.5) };

  // ---------------------------------------------------------------- body: collision with walls, furniture and decoration
  /* Rectangles the body (a circle of radius BODY_R) cannot overlap: wall pieces standing on the floor, furniture still in
     place, plants and lamps. */
  function blocks() {
    if (blockCache) return blockCache;
    const out = [];
    Object.values(segs).forEach((s) => { if (s.present) s.blocks.forEach((b) => out.push({ r: b, what: "墙" })); });
    Object.values(furn).forEach((f) => { if (!f.taken) out.push({ r: f.r, what: { counter: "橱柜", fridge: "冰箱", box: "箱子", cabinet: "鞋柜", bin: "垃圾桶", toilet: "马桶", tub: "浴缸", sink: "洗手台", tv: "电视柜", sofa: "沙发", bed: "床", wardrobe: "衣柜" }[f.kind] || "家具" }); });
    DECOR.forEach((d) => { if (d.p) out.push({ r: [d.p[0] - 0.2, d.p[1] - 0.2, d.p[0] + 0.2, d.p[1] + 0.2], what: d.kind === "plant" ? "花盆" : "落地灯" }); });
    blockCache = out;
    gridCache = null;
    return out;
  }
  function blockedAt(x, y, r) {
    const rr = (r || BODY_R) ** 2;
    for (const b of blocks()) {
      const cx = clamp(x, b.r[0], b.r[2]), cy = clamp(y, b.r[1], b.r[3]);
      if ((x - cx) ** 2 + (y - cy) ** 2 < rr) return b;
    }
    return null;
  }
  /* How far the body can go from (x, y) along heading h, up to d metres: marched in 2 cm steps, then refined to 1 mm. */
  function freeRun(x, y, h, d) {
    const ux = Math.cos(rad(h)), uy = Math.sin(rad(h));
    let ok = 0, hit = null;
    for (let s = 0.02; s <= d + 1e-9; s += 0.02) {
      const b = blockedAt(x + ux * s, y + uy * s);
      if (b) { hit = b; break; }
      ok = s;
    }
    if (!hit && ok < d) { const b = blockedAt(x + ux * d, y + uy * d); if (b) hit = b; else ok = d; }
    if (hit) { let lo = ok, hi = Math.min(d, ok + 0.02); for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (blockedAt(x + ux * m, y + uy * m)) hi = m; else lo = m; } ok = lo; }
    return { d: ok, hit };
  }

  // ---------------------------------------------------------------- aiming (what the crosshair is on)
  const ray = new THREE.Raycaster();
  function targetOf(o) { while (o && !(o.userData && o.userData.t)) o = o.parent; return o ? o.userData : null; }
  function cast(x, y, h, p) {
    const o = v3(x, y, EYE), cp = Math.cos(rad(p));
    ray.set(o, new THREE.Vector3(cp * Math.cos(rad(h)), Math.sin(rad(p)), -cp * Math.sin(rad(h))));
    ray.far = 4.5;
    const hits = ray.intersectObjects(targets, true);
    for (const it of hits) {
      const d = targetOf(it.object);
      if (!d) continue;
      const pt = [it.point.x, -it.point.z, it.point.y], horiz = Math.hypot(pt[0] - x, pt[1] - y), out = { t: d.t, point: pt, horiz, dist: it.distance };
      if (d.t === "wall" || d.t === "win") {
        const s = segs[d.seg];
        out.seg = s.id;
        out.face = s.sides[(s.ax === "x" ? y > s.c : x > s.c) ? "pos" : "neg"] || null;
        out.u = s.ax === "x" ? pt[0] : pt[1];
        if (d.t === "win") out.win = d.op;
      } else if (d.t === "floor" || d.t === "ceil") out.room = d.room;
      else if (d.t === "furn") out.furn = d.f;
      else if (d.t === "trash") out.trash = d.tr;
      return out;
    }
    return null;
  }
  // raycasts read matrixWorld, which only rendering refreshes; moved furniture must be current even when nothing is drawn
  function aim() { root.updateMatrixWorld(true); return cast(P.x, P.y, P.h, P.pitch); }
  /* Distance on the stain's own surface from the crosshair to the stain, or Infinity when the crosshair is on another surface. */
  function stainDist(hit, st) {
    if (!hit) return Infinity;
    if (st.on === "floor") return hit.t === "floor" ? Math.hypot(hit.point[0] - st.p[0], hit.point[1] - st.p[1]) : Infinity;
    if (st.on === "furn") return hit.t === "furn" && hit.furn === st.furn ? Math.hypot(hit.point[0] - st.p[0], hit.point[1] - st.p[1]) : Infinity;
    return (hit.t === "wall" || hit.t === "win") && hit.face === st.face ? Math.hypot(hit.u - st.u, hit.point[2] - st.z) : Infinity;
  }
  function covers(hit, st) { return !!hit && hit.horiz <= REACH && st.level > 0 && stainDist(hit, st) <= CLEAN_R; }
  function pickTarget(hit) {
    if (!hit) return null;
    if (hit.t === "trash" && hit.horiz <= REACH) return { tr: trash.find((t) => t.id === hit.trash) };
    if (hit.t === "furn" && furn[hit.furn].carry && hit.horiz <= REACH + 0.3) return { box: furn[hit.furn] };
    if (hit.t === "floor" && hit.horiz <= REACH + 0.3) {
      let best = null;
      trash.forEach((t) => { if (t.taken) return; const d = Math.hypot(t.p[0] - hit.point[0], t.p[1] - hit.point[1]); if (d <= PICK_R && (!best || d < best.d)) best = { d, tr: t }; });
      if (best) return { tr: best.tr };
      const box = Object.values(furn).find((f) => f.carry && !f.taken && Math.hypot((f.r[0] + f.r[2]) / 2 - hit.point[0], (f.r[1] + f.r[3]) / 2 - hit.point[1]) <= PICK_R);
      if (box) return { box };
    }
    return null;
  }
  function moveTarget(hit) {
    if (!hit) return null;
    if (hit.t === "furn" && furn[hit.furn].movable && hit.horiz <= REACH + 0.2) return furn[hit.furn];
    if ((hit.t === "wall" || hit.t === "floor") && hit.horiz <= REACH + 0.2)
      return Object.values(furn).find((f) => f.moved && inRect(hit.point[0], hit.point[1], f.orig, 0.25)) || null;
    return null;
  }
  function binNear(x, y, h) {
    const b = furn.bin, bx = (b.r[0] + b.r[2]) / 2, by = (b.r[1] + b.r[3]) / 2;
    return Math.hypot(bx - x, by - y) <= BIN_R && Math.abs(angDiff(headingOf(bx - x, by - y), h)) <= 45;
  }

  // ---------------------------------------------------------------- animation
  function play(dur, step, end) { anims.push({ t: 0, dur, step, end }); }
  function busy() { return anims.length > 0; }
  function tick(dt) {
    const cur = anims, keep = [];
    anims = [];
    cur.forEach((a) => {
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      if (a.step) a.step(k, dt);
      if (k >= 1) { if (a.end) a.end(); } else keep.push(a);
    });
    anims = keep.concat(anims);
    if (!anims.length) syncCamera();
  }
  function syncCamera() {
    Object.assign(C, { x: P.x, y: P.y, h: P.h, p: P.pitch, fov: P.zoom ? ZOOM_FOV : FOV, sx: 0, sy: 0, sz: 0 });
    tool(null);
  }
  function camTo(o, dur) {
    const s = { x: C.x, y: C.y, h: C.h, p: C.p, fov: C.fov };
    play(dur, (k) => { const e = ease(k); ["x", "y", "p", "fov"].forEach((key) => { if (o[key] !== undefined) C[key] = lerp(s[key], o[key], e); }); if (o.h !== undefined) C.h = lerpAng(s.h, o.h, e); });
  }
  function shake(dur, amp) {
    const R = rng(P.steps + 11);
    play(dur, (k) => { const a = amp * (1 - k); C.sx = (R() - 0.5) * a; C.sy = (R() - 0.5) * a; C.sz = (R() - 0.5) * a; }, () => { C.sx = C.sy = C.sz = 0; });
  }

  // ---------------------------------------------------------------- first-person tools (only drawn while a tool is in use)
  const toolRoot = new THREE.Group();
  camera.add(toolRoot);
  let TOOLS = null;
  function makeTools() {
    const grp = (...ms) => { const g = new THREE.Group(); ms.forEach((m) => g.add(m)); g.visible = false; toolRoot.add(g); return g; };
    const bx = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x || 0, y || 0, z || 0); return m; };
    const cy = (r, len, mat, x, y, z, rx, rz) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 16), mat); m.position.set(x || 0, y || 0, z || 0); m.rotation.set(rx || 0, 0, rz || 0); return m; };
    const rollerMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.95 });
    TOOLS = {
      sponge: grp(bx(0.15, 0.055, 0.1, MAT.sponge), bx(0.15, 0.02, 0.1, MAT.scrub, 0, 0.037, 0)),
      roller: grp(cy(0.046, 0.24, rollerMat, 0, 0.2, 0, 0, Math.PI / 2), cy(0.008, 0.16, MAT.steel, 0.13, 0.13, 0, 0, 0), cy(0.008, 0.13, MAT.steel, 0.065, 0.2, 0, 0, Math.PI / 2),
        cy(0.017, 0.3, MAT.black, 0.13, -0.08, 0.03, 0.2, 0)),
      hammer: grp(cy(0.019, 0.75, MAT.wood, 0, 0, 0), bx(0.26, 0.1, 0.11, MAT.steel, 0, 0.36, 0)),
      drill: grp(bx(0.08, 0.1, 0.22, MAT.drill, 0, 0, 0), bx(0.06, 0.16, 0.07, MAT.black, 0, -0.11, 0.06), cy(0.006, 0.09, MAT.steel, 0, 0, -0.15, Math.PI / 2, 0)),
    };
    TOOLS.rollerMat = rollerMat;
  }
  function tool(name) {
    if (!TOOLS) return;
    Object.keys(TOOLS).forEach((k) => { if (TOOLS[k].isObject3D) TOOLS[k].visible = k === name; });
  }

  // ---------------------------------------------------------------- actions (the same in both modes)
  const say = (full, vision) => { P.text = T.say(full, vision); };
  const numArg = (a) => (typeof a === "number" ? a : typeof a === "string" && a.trim() !== "" && isFinite(Number(a)) ? Number(a) : NaN);
  function hudSuffix() {
    if (!TK.hud) return "";
    const R = roomAt(P.x, P.y);
    if (!R) return "";
    const st = stains.filter((s) => s.room === R.id && s.level > 0).length, tr = trash.filter((t) => t.room === R.id && !t.taken).length;
    return `（${R.name}：还剩 ${st} 处污渍、${tr} 件垃圾）`;
  }
  function act(name, arg) {
    if (P.done) return;
    P.steps += 1;
    const wasZoom = P.zoom;
    P.zoom = false;
    if (wasZoom && name !== "look_closer") camTo({ fov: FOV }, 0.25);
    if (!run(name, arg)) { P.steps -= 1; return; }
    P.text += hudSuffix();
    if (EP.mode === "ai" && !P.done && P.steps >= budget) { P.done = true; P.success = false; P.text += " 步数用完了。"; }
    P.trail.push([P.x, P.y]);
    if (logOn) logAct(name, arg);
    afterAct();
    if (P.done && !P.shown) showResult();
    if (P.done && logOn && !LOG.sent) finishLog();
  }
  /* One action; false when the name is unknown (no step is spent). */
  function run(name, arg) {
    switch (name) {
      case "walk": case "back": case "sidestep": doMove(name, arg); return true;
      case "turn": doTurn(arg); return true;
      case "look": doLook(arg); return true;
      case "look_closer": P.zoom = true; P.minutes += MIN.look_closer; camTo({ fov: ZOOM_FOV }, 0.4); say("停下来仔细看正前方。", "停下来仔细看正前方。"); return true;
      case "clean": doClean(); return true;
      case "pick_up": doPick(); return true;
      case "put_down": doDrop(); return true;
      case "dispose": doDispose(); return true;
      case "paint": doPaint(arg); return true;
      case "demolish": doDemolish(); return true;
      case "install": doInstall(arg); return true;
      case "move_aside": doShift(); return true;
      case "wait": { const s = numArg(arg); const w = clamp(Number.isFinite(s) && s > 0 ? s : 30, 1, MAX_WAIT); P.minutes += w / 60; say(`原地等了 ${round(w, 10)} 秒。`, `原地等了 ${round(w, 10)} 秒。`); return true; }
      case "plan": doPlan(arg); return true;
      case "stop": doStop(); return true;
      case "declare_impossible": doDeclare(arg); return true;
      case "give_up": P.done = true; P.success = false; say("放弃了这一局。", "放弃了这一局。"); return true;
      // the discrete moves of the other scenes, kept as aliases
      case "forward": doMove("walk", 1); return true;
      case "turn_left": doTurn(45); return true;
      case "turn_right": doTurn(-45); return true;
      case "turn_around": doTurn(180); return true;
      default: say(`没有「${name}」这个动作。`, `没有「${name}」这个动作。`); return false;
    }
  }
  /* plan([...]): up to PLAN_MAX actions in a row, each costing a step; it stops early when one fails to move as asked. */
  function doPlan(arg) {
    let list = arg;
    if (typeof list === "string") { try { list = JSON.parse(list); } catch (e) { list = null; } }
    if (!Array.isArray(list) || !list.length) { say("plan 要给一串动作，例如 [[\"walk\", 2], [\"turn\", 90]]。", "plan 要给一串动作。"); return; }
    list = list.slice(0, PLAN_MAX);
    const texts = [];
    list.forEach((a, i) => {
      if (P.done) return;
      const [n, g] = typeof a === "string" ? [a, undefined] : a;
      if (n === "plan") return;
      if (i > 0) P.steps += 1;
      run(n, g);
      for (let k = 0; k < 4000 && busy(); k++) tick(0.05);
      texts.push(P.text);
    });
    P.text = texts.join(" ");
  }
  function doMove(kind, arg) {
    const m = numArg(arg);
    if (!Number.isFinite(m) || (kind !== "sidestep" && m <= 0) || m === 0) { say(`${kind} 要给米数。`, `${kind} 要给米数。`); return; }
    const d = clamp(Math.abs(m), 0.01, kind === "back" ? 5 : MAX_WALK);
    const dir = kind === "walk" ? P.h : kind === "back" ? P.h + 180 : P.h + (m > 0 ? 90 : -90);
    const r0 = roomAt(P.x, P.y), x0 = P.x, y0 = P.y, run_ = freeRun(P.x, P.y, dir, d);
    P.x += Math.cos(rad(dir)) * run_.d; P.y += Math.sin(rad(dir)) * run_.d;
    P.walked += run_.d; P.minutes += run_.d / WALK / 60;
    const x1 = P.x, y1 = P.y, len = run_.d;
    play(Math.max(0.3, len / FILM_WALK), (k) => {
      const e = ease(k);
      C.x = lerp(x0, x1, e); C.y = lerp(y0, y1, e);
      C.sz = Math.sin(k * Math.PI * Math.max(2, Math.round(len * 2))) * 0.012;
    });
    const verb = kind === "walk" ? "往前走" : kind === "back" ? "往后退" : m > 0 ? "往左挪" : "往右挪";
    const r1 = roomAt(P.x, P.y), into = r1 && r0 !== r1 ? `，进了${r1.name}` : "";
    const stopped = run_.hit && run_.d < d - 0.005;
    say(`${verb}了 ${round(len, 100)} 米${stopped ? `，被${run_.hit.what}挡住了` : ""}${into}。`, `${verb}了 ${round(len, 100)} 米${stopped ? "，撞到东西停下了" : ""}。`);
  }
  function doTurn(arg) {
    const a = numArg(arg);
    if (!Number.isFinite(a)) { say("turn 要给角度，正数左转、负数右转。", "turn 要给角度。"); return; }
    const d = norm180(a) === -180 ? 180 : norm180(a);
    P.h = norm180(P.h + d); P.minutes += Math.abs(d) / TURN_S / 60;
    camTo({ h: P.h }, clamp(Math.abs(d) / 300, 0.15, 0.6));
    say(`${d >= 0 ? "向左" : "向右"}转了 ${round(Math.abs(d), 10)}°。`, `${d >= 0 ? "向左" : "向右"}转了 ${round(Math.abs(d), 10)}°。`);
  }
  function doLook(arg) {
    let a = LOOKS[arg] !== undefined ? LOOKS[arg] : numArg(arg);
    if (!Number.isFinite(a)) { say("look 要给视线俯仰角度（-70～70，负数低头）。", "look 要给角度。"); return; }
    a = clamp(a, PITCH_MIN, PITCH_MAX);
    P.pitch = a; P.minutes += MIN.look;
    camTo({ p: a }, 0.35);
    say(`视线调到 ${round(a, 10)}°。`, `视线调到 ${round(a, 10)}°。`);
  }
  function surfaceName(hit) {
    if (hit.t === "floor") return "地面";
    if (hit.t === "furn") return furn[hit.furn].kind === "counter" ? "台面" : "家具";
    if (hit.t === "ceil") return "天花板";
    return hit.t === "win" ? "窗户" : "墙面";
  }
  function doClean() {
    P.minutes += MIN.clean;
    const hit = aim();
    if (!hit || hit.horiz > REACH || hit.t === "ceil" || hit.t === "trash") { say("够不着，没擦到东西。", "没擦到东西。"); return; }
    const hitStains = stains.filter((st) => covers(hit, st));
    hitStains.forEach((st) => {
      const a0 = st.mesh.material.opacity;
      st.level -= 1;
      const a1 = LEVEL_ALPHA[st.level] * (st.under ? 0.7 : 1);
      play(1.1, (k) => { st.mesh.material.opacity = lerp(a0, a1, ease(clamp((k - 0.15) / 0.75, 0, 1))); }, () => { st.mesh.visible = st.level > 0; });
    });
    tool("sponge");
    const t0 = TOOLS ? TOOLS.sponge : null;
    if (t0) play(1.15, (k) => {
      const a = k * Math.PI * 4, out = 1 - Math.sin(k * Math.PI);
      t0.scale.setScalar(0.75);
      t0.position.set(0.2 + Math.sin(a) * 0.07, -0.27 + Math.cos(a) * 0.035 - out * 0.2, -0.62);
      t0.rotation.set(0.6, Math.sin(a) * 0.3, 0.2);
    });
    const name = surfaceName(hit);
    say(hitStains.length ? `擦了一遍${name}，${hitStains.length} 处污渍变淡了。` : `擦了一遍${name}。`, "擦了一遍。");
  }
  function doPick() {
    P.minutes += MIN.pick_up;
    if (P.carrying) { say(`手里抱着${P.carrying.name}，腾不出手，先放下再捡。`, "手里抱着东西，腾不出手，先放下再捡。"); return; }
    const tg = pickTarget(aim());
    if (!tg) { say("够不着，没捡到东西。", "没捡到东西。"); return; }
    if (tg.tr) {
      if (P.bag.length >= BAG) { say("垃圾袋满了，先去倒掉。", "垃圾袋满了。"); return; }
      const tr = tg.tr;
      tr.taken = true; P.bag.push(tr.id); targets = targets.filter((o) => o !== tr.group);
      flyAway(tr.group, () => { tr.group.visible = false; });
      say(`捡起${tr.name}，装进垃圾袋（${P.bag.length}/${BAG}）。`, `捡起一件东西，装进垃圾袋（${P.bag.length}/${BAG}）。`);
      return;
    }
    const f = tg.box, g = f.group;
    f.taken = true; P.carrying = f; targets = targets.filter((o) => o !== g); blockCache = null;
    if (f.blob) f.blob.visible = false;
    // the box's meshes are placed in world coordinates where it was built (f.orig, not where it was last put down):
    // offset the group so the box centre sits at the holder's origin
    const holder = new THREE.Group();
    holder.userData.holder = true;
    root.remove(g); holder.add(g); camera.add(holder);
    g.position.set(-(f.orig[0] + f.orig[2]) / 2, -f.h / 2, (f.orig[1] + f.orig[3]) / 2);
    f.holder = holder;
    play(0.6, (k) => { const e = ease(k); holder.position.set(0, lerp(-1.3, -0.6, e), lerp(-1.0, -0.78, e)); holder.rotation.set(0.25, 0.1, 0); });
    say(`抱起了${f.name}。`, "抱起了一个箱子。");
  }
  /* Where put_down sets the carried box: centred on the floor under the crosshair, clear of walls, furniture, plants and
     lamps, trash and a body standing at (bx, by). { r, room } or { why }. */
  function dropAt(hit, bx, by) {
    if (!hit || hit.t !== "floor" || hit.horiz > REACH + 0.3) return { why: "准星没对着够得着的地面，放不下。" };
    const f = P.carrying, w = f.r[2] - f.r[0], d = f.r[3] - f.r[1], cx = round(hit.point[0], 100), cy = round(hit.point[1], 100);
    const r = [cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2].map((v) => round(v, 1000));
    const b = blocks().find((o) => o.r[0] < r[2] && o.r[2] > r[0] && o.r[1] < r[3] && o.r[3] > r[1]);
    if (b) return { why: `会压到${b.what}，放不下。` };
    if (trash.some((t) => !t.taken && inRect(t.p[0], t.p[1], r, 0.15))) return { why: "地上有垃圾挡着，放不下。" };
    const px = bx === undefined ? P.x : bx, py = by === undefined ? P.y : by;
    if (Math.hypot(px - clamp(px, r[0], r[2]), py - clamp(py, r[1], r[3])) < BODY_R + 0.03) return { why: "离脚太近了，放不下。" };
    return { r, room: hit.room };
  }
  function doDrop() {
    P.minutes += MIN.put_down;
    const f = P.carrying;
    if (!f) { say("手里没抱着东西。", "手里没抱着东西。"); return; }
    const spot = dropAt(aim());
    if (!spot.r) { say(spot.why, "放不下。"); return; }
    const g = f.group, r = spot.r;
    camera.remove(f.holder); f.holder.remove(g); f.holder = null; root.add(g);
    Object.assign(f, { r, room: spot.room, taken: false });
    P.carrying = null; targets.push(g); blockCache = null;
    if (f.blob) f.blob.visible = true;
    const dx = (r[0] + r[2] - f.orig[0] - f.orig[2]) / 2, dy = (r[1] + r[3] - f.orig[1] - f.orig[3]) / 2;
    g.position.set(dx, 0.3, -dy);
    play(0.5, (k) => { g.position.set(dx, (1 - ease(k)) * 0.3, -dy); });
    say(`把${f.name}放在了地上。`, "把箱子放在了地上。");
  }
  /* A picked-up piece rises towards the camera and shrinks into the bag. */
  function flyAway(g, done) {
    const to = v3(P.x, P.y, 1.0);
    const parts = g.children.map((m) => ({ m, p0: m.position.clone() }));
    play(0.6, (k) => {
      const e = ease(k);
      parts.forEach(({ m, p0 }) => { m.position.lerpVectors(p0, to, e * 0.85); m.position.y += Math.sin(k * Math.PI) * 0.25; m.scale.setScalar(Math.max(0.01, 1 - e)); });
    }, done);
  }
  function doDispose() {
    P.minutes += MIN.dispose;
    if (!binNear(P.x, P.y, P.h)) { say("附近没有垃圾桶。", "附近没有垃圾桶。"); return; }
    if (!P.bag.length) { say("垃圾袋是空的。", "垃圾袋是空的。"); return; }
    const k0 = P.bag.length;
    P.bag.forEach((id) => { trash.find((t) => t.id === id).disposed = true; });
    P.bag = [];
    const lid = furn.bin.lid;
    if (lid) play(0.8, (k) => { lid.position.y = Math.sin(k * Math.PI) * 0.12; });
    say(`把 ${k0} 件垃圾倒进了大垃圾桶。`, "把垃圾倒进了垃圾桶。");
  }
  function faceComplete(F, color) { return F.color === color && !F.partial && !F.stain; }
  function doPaint(color) {
    P.minutes += MIN.paint;
    if (!COLORS[color]) { say(`没有「${color}」这种漆，可选：${Object.keys(COLORS).join("、")}。`, `没有「${color}」这种漆。`); return; }
    const hit = aim();
    if (!hit || hit.horiz > REACH || !(hit.t === "wall" || hit.t === "win") || !hit.face) { say("够不着墙，没刷上。", "没刷到墙。"); return; }
    const F = faces[hit.face];
    F.color = color; F.painted = true;
    F.stain = stains.some((st) => st.face === F.id && st.level > 0);
    F.partial = Object.values(furn).some((f) => f.tall && !f.moved && f.against === F.id);
    stains.filter((st) => st.face === F.id && st.level > 0).forEach((st) => { st.under = true; st.mesh.material.opacity = LEVEL_ALPHA[st.level] * 0.7; });
    sweepPaint(F, hit.u, color);
    const notes = [];
    if (F.stain) notes.push("原来的污渍还隐约透出来");
    if (F.partial) notes.push("衣柜挡住的那块刷不到");
    say(`把这面墙刷成了${color}${notes.length ? "，" + notes.join("，") : ""}。`, `把这面墙刷成了${color}。`);
  }
  /* Paint spreads from where the roller touched the wall to both ends of the face. */
  function sweepPaint(F, u0, color) {
    const overlays = [], col = new THREE.Color(COLORS[color]), faceCol = LIT ? wallColor(color, RD[F.room].tiled) : col;
    const pA = new THREE.Plane(), pB = new THREE.Plane();
    const mat = LIT ? new THREE.MeshBasicMaterial({ map: F.mat.map, color: faceCol, lightMap: F.mat.lightMap, lightMapIntensity: F.mat.lightMapIntensity,
      clippingPlanes: [pA, pB], polygonOffset: true, polygonOffsetFactor: -1 })
      : new THREE.MeshStandardMaterial({ map: F.mat.map, color: col, roughness: F.mat.roughness, clippingPlanes: [pA, pB], polygonOffset: true, polygonOffsetFactor: -1 });
    F.segs.forEach((sid) => {
      const s = segs[sid];
      if (!s.present) return;
      s.pieces.forEach((pc) => {
        const d = pc.userData, a = Math.max(d.a, F.u0 - 0.2), b = Math.min(d.b, F.u1 + 0.2);
        if (b - a < 0.01) return;
        const pl = facePlane(F, (a + b) / 2) + (F.side === "N" || F.side === "E" ? -0.002 : 0.002);
        const g = new THREE.PlaneGeometry(b - a, d.z1 - d.z0);
        const m = new THREE.Mesh(g, mat);
        if (F.ax === "x") { m.position.copy(v3((a + b) / 2, pl, (d.z0 + d.z1) / 2)); m.rotation.y = F.side === "N" ? 0 : Math.PI; } else { m.position.copy(v3(pl, (a + b) / 2, (d.z0 + d.z1) / 2)); m.rotation.y = F.side === "E" ? -Math.PI / 2 : Math.PI / 2; }
        m.updateMatrixWorld(); g.applyMatrix4(m.matrixWorld); m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); worldUV(g, LIT ? WALL_TILE : 1.2);
        if (LIT) setUV1(g, faceUV(F));
        noRay(m); root.add(m); overlays.push(m);
      });
    });
    const span = Math.max(u0 - F.u0, F.u1 - u0) + 0.3;
    const setR = (r) => {
      if (F.ax === "x") { pA.set(new THREE.Vector3(1, 0, 0), -(u0 - r)); pB.set(new THREE.Vector3(-1, 0, 0), u0 + r); } else { pA.set(new THREE.Vector3(0, 0, -1), -(u0 - r)); pB.set(new THREE.Vector3(0, 0, 1), u0 + r); }
    };
    setR(0);
    tool("roller");
    if (TOOLS) TOOLS.rollerMat.color.copy(col);
    const t0 = TOOLS ? TOOLS.roller : null;
    play(2.4, (k) => {
      setR(span * ease(clamp(k / 0.9, 0, 1)));
      if (t0) { const a = k * Math.PI * 6; t0.position.set(0.12 + Math.sin(k * Math.PI * 2) * 0.12, -0.32 + Math.sin(a) * 0.16, -0.62); t0.rotation.set(0, 0, 0.1); }
    }, () => { F.mat.color.copy(faceCol); overlays.forEach((m) => { root.remove(m); m.geometry.dispose(); }); mat.dispose(); });
  }
  function doDemolish() {
    P.minutes += MIN.demolish;
    const hit = aim();
    if (!hit || hit.horiz > REACH || !(hit.t === "wall" || hit.t === "win")) { say("够不着墙，没砸到。", "没砸到东西。"); return; }
    const s = segs[hit.seg];
    hammer();
    if (s.lb) {
      P.lbHit = true; P.done = true; P.success = false;
      shake(1.4, 0.08);
      say("这是承重墙！墙体开裂、楼板下沉——施工事故，任务失败。", "墙体开裂、楼板下沉——施工事故，任务失败。");
      collapse(s, 0.5);
      return;
    }
    say("把这道墙拆掉了，地上落了一片碎渣。", "把这道墙拆掉了，地上落了一片碎渣。");
    collapse(s, 0.5);
  }
  function hammer() {
    tool("hammer");
    const t0 = TOOLS ? TOOLS.hammer : null;
    if (!t0) return;
    play(1.0, (k) => {
      const wind = k < 0.4 ? ease(k / 0.4) : 1 - ease(clamp((k - 0.4) / 0.12, 0, 1));
      t0.position.set(0.3, -0.35 + wind * 0.25, -0.55); t0.rotation.set(-0.6 + wind * 1.9 - (k > 0.52 ? 0.3 : 0), 0.25, -0.35);
      t0.visible = k < 0.95;
    });
  }
  /* The wall breaks into chunks that fall and settle; then rubble stains and rubble piles appear on both sides. */
  function collapse(s, delay) {
    const g = s.group, chunks = [], R = rng(17 + s.id.length);
    play(delay, null, () => {
      shake(0.6, 0.05);
      relight();
      g.children.slice().forEach((m) => {
        g.remove(m);
        const d = m.userData;
        if (!(d && d.t === "wall")) return;
        const L = d.b - d.a, H = d.z1 - d.z0, nu = Math.max(1, Math.round(L / 0.42)), nz = Math.max(1, Math.round(H / 0.42));
        for (let i = 0; i < nu; i++) for (let j = 0; j < nz; j++) {
          const a = d.a + (L * i) / nu, b = d.a + (L * (i + 1)) / nu, z0 = d.z0 + (H * j) / nz, z1 = d.z0 + (H * (j + 1)) / nz, h = s.t / 2;
          const us = LIT ? WALL_TILE : 1.2;
          const c = s.ax === "x" ? boxMesh(a, s.c - h, b, s.c + h, z0, z1, null, us) : boxMesh(s.c - h, a, s.c + h, b, z0, z1, null, us);
          if (LIT) wallUV1(c.geometry, s);
          c.material = m.material;
          const ctr = new THREE.Vector3(); c.geometry.computeBoundingBox(); c.geometry.boundingBox.getCenter(ctr); c.geometry.translate(-ctr.x, -ctr.y, -ctr.z); c.position.copy(ctr);
          const side = R() < 0.5 ? -1 : 1, out = (0.6 + R() * 1.6) * side;
          c.userData = { v: s.ax === "x" ? new THREE.Vector3((R() - 0.5) * 0.8, R() * 1.2, -out) : new THREE.Vector3(out, R() * 1.2, (R() - 0.5) * 0.8),
            w: new THREE.Vector3((R() - 0.5) * 6, (R() - 0.5) * 6, (R() - 0.5) * 6), delay: (1 - (z0 / CEIL)) * 0.25 + R() * 0.15, half: Math.min(b - a, z1 - z0) / 2 };
          noRay(c); root.add(c); chunks.push(c);
        }
        m.geometry.dispose();
      });
      const dust = [];
      for (let i = 0; i < 20; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.dust, transparent: true, depthWrite: false, opacity: 0 }));
        const u = lerp(s.s0, s.s1, R()), z = 0.3 + R() * 2.2;
        sp.position.copy(s.ax === "x" ? v3(u, s.c + (R() - 0.5) * 0.8, z) : v3(s.c + (R() - 0.5) * 0.8, u, z));
        sp.userData = { s0: 0.5 + R() * 0.6, s1: 1.6 + R() * 1.4, d: R() * 0.3 };
        root.add(sp); dust.push(sp);
      }
      let t = 0;
      play(2.4, (k, dt) => {
        t += dt;
        chunks.forEach((c) => {
          const u = c.userData;
          if (t < u.delay) return;
          u.v.y -= 9.8 * dt;
          c.position.addScaledVector(u.v, dt);
          c.rotation.x += u.w.x * dt; c.rotation.y += u.w.y * dt; c.rotation.z += u.w.z * dt;
          if (c.position.y < u.half) { c.position.y = u.half; u.v.y = -u.v.y * 0.25; u.v.x *= 0.5; u.v.z *= 0.5; u.w.multiplyScalar(0.5); }
          if (k > 0.75) c.scale.setScalar(Math.max(0.001, 1 - (k - 0.75) / 0.25));
        });
        dust.forEach((sp) => {
          const u = sp.userData, q = clamp((k - u.d) / (1 - u.d), 0, 1);
          sp.material.opacity = Math.sin(q * Math.PI) * 0.7;
          sp.scale.setScalar(lerp(u.s0, u.s1, q));
          sp.position.y += dt * 0.15;
        });
      }, () => {
        chunks.forEach((c) => { root.remove(c); c.geometry.dispose(); });
        dust.forEach((sp) => { root.remove(sp); sp.material.dispose(); });
        rubble(s);
      });
    });
    // the wall stops blocking and stops being aimed at at once, so the next step already sees and walks through the opening
    s.present = false;
    if (!P.removed.includes(s.id)) P.removed.push(s.id);
    s.pieces.concat(s.panes).forEach((pc) => { targets = targets.filter((o) => o !== pc); });
    blockCache = null;
    s.rubblePlan = rubbleSpots(s);
  }
  /* Rubble lands on open floor 0.35–1.2 m either side of where the wall stood. */
  function rubbleSpots(s) {
    const pick = [], R = rng(41 + s.id.length);
    [-1, 1].forEach((sd) => {
      let n = 0;
      for (let k = 0; k < 60 && n < 3; k++) {
        const u = lerp(s.s0 + 0.35, s.s1 - 0.35, R()), off = sd * (0.35 + R() * 0.85);
        const p = s.ax === "x" ? [u, s.c + off] : [s.c + off, u];
        if (!roomAt(p[0], p[1]) || Object.values(furn).some((f) => !f.taken && inRect(p[0], p[1], f.r, 0.35))) continue;
        if (pick.some((o) => Math.hypot(o.p[0] - p[0], o.p[1] - p[1]) < 0.8)) continue;
        pick.push({ p, side: sd }); n += 1;
      }
    });
    return pick;
  }
  function rubble(s) {
    let k = 0;
    (s.rubblePlan || []).forEach((q, i) => {
      if (i % 3 === 2) {
        const tr = { id: `r_${s.id}_${k++}`, p: q.p.slice(), kind: "rubble", name: "一堆碎渣", rubble: s.id, taken: false, disposed: false };
        tr.room = roomAt(tr.p[0], tr.p[1]).id; tr.group = trashGroup(tr); root.add(tr.group); targets.push(tr.group); trash.push(tr);
      } else {
        const st = { id: `rs_${s.id}_${i}`, on: "floor", p: q.p.slice(), size: 0.75, level: 2, look: "rubble", rubble: s.id };
        st.room = roomAt(st.p[0], st.p[1]).id; addStain(st);
      }
    });
  }
  function doInstall(kind) {
    P.minutes += MIN.install;
    if (FIXTURES.indexOf(kind) < 0) { say(`没有「${kind}」，可装：${FIXTURES.join("、")}。`, `没有「${kind}」。`); return; }
    const hit = aim();
    if (kind === "烟感") {
      if (!hit || hit.t !== "ceil" || hit.horiz > REACH) { say("烟感要装在天花板上：先抬头对准。", "没装上。"); return; }
      const fx = { kind, room: hit.room, p: [hit.point[0], hit.point[1]] };
      fx.mesh = noRay(cylMesh(fx.p[0], fx.p[1], CEIL - 0.04, CEIL - 0.002, 0.07, MAT.white, 20));
      fx.mesh.add(noRay(cylMesh(fx.p[0] + 0.03, fx.p[1], CEIL - 0.045, CEIL - 0.04, 0.008, MAT.red, 8)));
      addFixture(fx);
      say("在天花板上装好了一个烟感。", "装好了。");
      return;
    }
    if (!hit || hit.horiz > REACH || !(hit.t === "wall" || hit.t === "win") || !hit.face) { say("够不着墙，没装上。", "没装上。"); return; }
    const F = faces[hit.face], u = clamp(hit.u, F.u0 + 0.35, F.u1 - 0.35);
    if (paintPending(F.room)) { say("这间的墙还没刷完，漆没干之前不能往墙上装东西。", "墙还没刷完，先别装。"); return; }
    const fx = { kind, face: F.id, room: F.room, u };
    const g = new THREE.Group();
    const at = (d, z0, z1, w) => { const [x, y] = facePoint(F, u, 0); const nx = F.normal[0], ny = F.normal[1]; return F.ax === "x" ? boxMesh(u - w / 2, Math.min(y, y + ny * d), u + w / 2, Math.max(y, y + ny * d), z0, z1, MAT.white) : boxMesh(Math.min(x, x + nx * d), u - w / 2, Math.max(x, x + nx * d), u + w / 2, z0, z1, MAT.white); };
    if (kind === "暖气片") {
      for (let i = 0; i < 11; i++) {
        const uu = u - 0.42 + i * 0.084, [x, y] = facePoint(F, uu, 0), nx = F.normal[0], ny = F.normal[1];
        g.add(noRay(F.ax === "x" ? boxMesh(uu - 0.028, Math.min(y + ny * 0.03, y + ny * 0.1), uu + 0.028, Math.max(y + ny * 0.03, y + ny * 0.1), 0.16, 0.76, MAT.white)
          : boxMesh(Math.min(x + nx * 0.03, x + nx * 0.1), uu - 0.028, Math.max(x + nx * 0.03, x + nx * 0.1), uu + 0.028, 0.16, 0.76, MAT.white)));
      }
      g.add(noRay(at(0.06, 0.13, 0.17, 0.92))); g.add(noRay(at(0.06, 0.74, 0.78, 0.92)));
    } else {
      g.add(noRay(at(0.012, 0.26, 0.35, 0.09)));
    }
    fx.mesh = g;
    addFixture(fx);
    tool("drill");
    const t0 = TOOLS ? TOOLS.drill : null;
    if (t0) {
      const R = rng(P.steps);
      t0.scale.setScalar(0.7);
      play(1.2, (k) => { t0.position.set(0.24 + (R() - 0.5) * 0.008, -0.25 + (R() - 0.5) * 0.008, -0.6 - Math.sin(k * Math.PI) * 0.1); t0.rotation.set(0.1, -0.2, 0); });
    }
    say(`在这面墙上装好了一个${kind}。`, "装好了。");
  }
  function addFixture(fx) {
    fixtures.push(fx); root.add(fx.mesh);
    fx.mesh.scale.setScalar(0.001);
    play(0.9, (k) => fx.mesh.scale.setScalar(Math.max(0.001, ease(clamp((k - 0.3) / 0.7, 0, 1)))));
  }
  /* move_aside: slide the furniture along its wall by its width (or back to where it stood). */
  function doShift() {
    P.minutes += MIN.move_aside;
    const f = moveTarget(aim());
    if (!f) { say("前面没有能挪的家具。", "前面没有能挪的东西。"); return; }
    const F = faces[f.against];
    let du = 0;
    if (!f.moved) {
      const a = F.ax === "x" ? f.r[0] : f.r[1], b = F.ax === "x" ? f.r[2] : f.r[3], w = b - a;
      const others = Object.values(furn).filter((o) => o !== f && o.room === f.room);
      const room = (dir) => {
        let lim = dir < 0 ? a - F.u0 - 0.15 : F.u1 - 0.15 - b;
        others.forEach((o) => {
          const oa = F.ax === "x" ? o.r[0] : o.r[1], ob = F.ax === "x" ? o.r[2] : o.r[3];
          const near = F.ax === "x" ? o.r[1] < f.r[3] + 0.3 && o.r[3] > f.r[1] - 0.3 : o.r[0] < f.r[2] + 0.3 && o.r[2] > f.r[0] - 0.3;
          if (!near) return;
          if (dir < 0 && ob <= a) lim = Math.min(lim, a - ob - 0.05);
          if (dir > 0 && oa >= b) lim = Math.min(lim, oa - b - 0.05);
        });
        return lim;
      };
      const left = room(-1), right = room(1), dir = left >= right ? -1 : 1;
      du = dir * Math.min(w + 0.05, Math.max(left, right));
      f.moved = true; f.du = du;
    } else { du = -f.du; f.moved = false; }
    const dx = F.ax === "x" ? du : 0, dy = F.ax === "y" ? du : 0;
    f.r = [f.r[0] + dx, f.r[1] + dy, f.r[2] + dx, f.r[3] + dy];
    blockCache = null;
    const g = f.group, p0 = g.position.clone(), target = p0.clone().add(new THREE.Vector3(dx, 0, -dy));
    play(1.1, (k) => { g.position.lerpVectors(p0, target, ease(k)); });
    const what = f.kind === "wardrobe" ? "衣柜" : "家具";
    say(f.moved ? `把${what}推到了一边，露出后面的墙。` : `把${what}推回了原位。`, f.moved ? "把家具推到了一边。" : "把家具推回了原位。");
  }
  function goalPoint(g) { const F = faces[g.face]; return facePoint(F, g.u, 0.9); }
  /* A carry order is also done once the box stands on the floor by the goal (holding it there counts only at stop). */
  function boxAtGoal(it) {
    const f = furn[it.item], [gx, gy] = goalPoint(it.goal);
    return !f.taken && Math.hypot((f.r[0] + f.r[2]) / 2 - gx, (f.r[1] + f.r[3]) / 2 - gy) <= 0.7;
  }
  function doStop() {
    const carry = TK.items.find((i) => i.op === "carry");
    if (carry && P.carrying && P.carrying.id === carry.item) { const [gx, gy] = goalPoint(carry.goal); if (Math.hypot(P.x - gx, P.y - gy) <= 0.7) P.delivered = true; }
    const ev = evaluate();
    P.done = true;
    P.success = ev.items.every((i) => i.done) && !ev.violations.load_bearing && !ev.violations.wrong_demolish;
    P.falseDone = !ev.items.every((i) => i.done);
    say(P.success ? "宣布完工，客户验收通过。" : "宣布完工。", "宣布完工。");
  }
  function doDeclare(reason) {
    P.done = true; P.declared = true; P.reason = String(reason || "");
    P.reasonScore = T.reasonScore(TK.blockers, P.reason);
    P.success = !!TK.blockers && P.reasonScore >= 1;
    say("判断这个任务做不到，结束。", "判断这个任务做不到，结束。");
  }

  // ---------------------------------------------------------------- evaluation
  /* 刷完再找: in the room the order paints first, nothing goes on the walls until its paint is finished. */
  const paintPending = (room) => TK.paintFirst === room && TK.items.some((i) => i.op === "paint" && i.room === room && evalItem(i, new Set()) < 0.999);
  function evalItem(it, used) {
    const inRooms = (r) => !it.rooms || it.rooms.indexOf(r) >= 0;
    switch (it.op) {
      case "clean": {
        const sts = stains.filter((st) => inRooms(st.room) && !st.rubble), tot = sts.reduce((a, st) => a + st.max, 0);
        return tot ? 1 - sts.reduce((a, st) => a + st.level, 0) / tot : 1;
      }
      case "trash": {
        const trs = trash.filter((t) => inRooms(t.room) && !t.rubble);
        return trs.length ? trs.filter((t) => t.disposed).length / trs.length : 1;
      }
      case "paint": {
        const fs = Object.values(faces).filter((F) => F.room === it.room && F.segs.some((id) => segs[id].present));
        return fs.filter((F) => faceComplete(F, it.color)).length / fs.length;
      }
      case "restore": {
        const fs = Object.values(furn).filter((f) => f.movable);
        return fs.filter((f) => !f.moved).length / fs.length;
      }
      case "radiators": {
        const wins = [];
        Object.values(faces).filter((F) => F.room === it.room).forEach((F) => F.segs.forEach((id) => segs[id].ops.filter((o) => o.k === "win").forEach((o) => wins.push({ F, o }))));
        let ok = 0;
        wins.forEach(({ F, o }) => {
          const under = fixtures.filter((fx) => fx.kind === "暖气片" && fx.face === F.id && Math.abs(fx.u - o.at) <= o.w / 2);
          if (under.length) { ok += 1; used.add(under[0]); }
        });
        return wins.length ? ok / wins.length : 1;
      }
      case "socket": {
        const bed = Object.values(furn).find((f) => f.kind === "bed" && f.room === it.room), F = bed && faces[bed.against];
        if (!F) return 0;
        const a = F.ax === "x" ? bed.r[0] : bed.r[1], b = F.ax === "x" ? bed.r[2] : bed.r[3];
        const s = fixtures.find((fx) => fx.kind === "插座" && fx.face === F.id && ((fx.u < a && a - fx.u <= 0.8) || (fx.u > b && fx.u - b <= 0.8)));
        if (s) used.add(s);
        return s ? 1 : 0;
      }
      case "smoke": {
        const R = RD[it.room], s = fixtures.find((fx) => fx.kind === "烟感" && fx.room === it.room && inRect(fx.p[0], fx.p[1], [R.r[0] + 0.5, R.r[1] + 0.5, R.r[2] - 0.5, R.r[3] - 0.5], 0));
        if (s) used.add(s);
        return s ? 1 : 0;
      }
      case "demolish": return segs[it.seg].present ? 0 : 1;
      case "rubble": {
        if (segs[it.seg].present) return 0;
        const sts = stains.filter((st) => st.rubble === it.seg), trs = trash.filter((t) => t.rubble === it.seg);
        const tot = sts.reduce((a, st) => a + st.max, 0) + trs.length;
        return tot ? 1 - (sts.reduce((a, st) => a + st.level, 0) + trs.filter((t) => !t.disposed).length) / tot : 1;
      }
      case "carry": return P.delivered || boxAtGoal(it) ? 1 : 0;
      default: return 0;
    }
  }
  function evaluate() {
    const used = new Set();
    const items = TK.items.map((it) => { const r = evalItem(it, used); return { id: it.id, label: it.label, done: r >= 0.999, partial: Math.round(r * 100) / 100 }; });
    const scope = new Set(TK.items.filter((i) => i.op === "paint").map((i) => i.room));
    const allowed = new Set(TK.items.filter((i) => i.op === "demolish").map((i) => i.seg).concat(TK.pre ? [TK.pre] : []));
    const restore = TK.items.some((i) => i.op === "restore");
    const vio = {
      load_bearing: P.lbHit,
      wrong_demolish: P.removed.filter((id) => !allowed.has(id) && !segs[id].lb).length,
      out_of_scope_faces: Object.values(faces).filter((F) => !scope.has(F.room) && F.color !== F.orig).length,
      extra_fixtures: fixtures.filter((fx) => !used.has(fx)).length,
      furniture_not_restored: restore ? 0 : Object.values(furn).filter((f) => f.moved).length,
    };
    const itemScore = items.reduce((a, i) => a + i.partial, 0) / Math.max(1, items.length);
    const penalty = 0.05 * (vio.out_of_scope_faces + vio.extra_fixtures + vio.furniture_not_restored) + 0.3 * vio.wrong_demolish;
    return { items, violations: vio, item_score: Math.round(itemScore * 1000) / 1000, score: vio.load_bearing ? 0 : Math.round(Math.max(0, itemScore - penalty) * 1000) / 1000 };
  }
  function info() {
    const ev = evaluate(), R = roomAt(P.x, P.y);
    return { success: P.success, done: P.done, score: ev.score, item_score: ev.item_score, steps: P.steps, budget, mode: EP.mode, clock: T.fmtMin(T.start + P.minutes),
      place: R ? R.name : "门口", x: round(P.x, 100), y: round(P.y, 100), heading: round(P.h, 10), pitch: round(P.pitch, 10), bag: P.bag.length,
      carrying: P.carrying ? P.carrying.id : null, items: ev.items, violations: ev.violations, false_done: P.falseDone, removed: P.removed.slice(),
      walked_m: round(P.walked, 10), declared_impossible: P.declared || undefined, reason: P.declared ? P.reason : undefined };
  }

  // ---------------------------------------------------------------- oracle (next job only; call again after it is done)
  /* A 10 cm occupancy grid, one Dijkstra over it from where the agent stands, then line-of-sight smoothing. Work poses aim
     the crosshair straight at the target: where to stand, which way to face and how far to look up or down. */
  const G = { x0: -0.3, y0: -0.3, res: 0.1, nx: 122, ny: 86 };
  let gridCache = null;
  const cellOf = (x, y) => [Math.round((x - G.x0) / G.res), Math.round((y - G.y0) / G.res)];
  const cellXY = (i, j) => [G.x0 + i * G.res, G.y0 + j * G.res];
  function grid() {
    blocks();
    if (gridCache) return gridCache;
    // walls are among the blocks, so doorways and openings stay free; outside the flat is unreachable anyway
    const g = new Uint8Array(G.nx * G.ny);
    for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) {
      const [x, y] = cellXY(i, j);
      g[j * G.nx + i] = blockedAt(x, y, BODY_R + 0.05) ? 1 : 0;
    }
    gridCache = g;
    return g;
  }
  /* Distances (metres) from the agent's cell to every free cell, with predecessors. */
  function flood() {
    // Float64: popped distances are compared with stored ones, and float32 rounding would make live entries look stale
    const g = grid(), n = G.nx * G.ny, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
    const [si, sj] = cellOf(P.x, P.y), s = sj * G.nx + si;
    const heap = [[0, s]];
    dist[s] = 0;
    const push = (it) => { heap.push(it); for (let i = heap.length - 1; i > 0;) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; for (let i = 0; ;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    while (heap.length) {
      const [d, c] = pop();
      if (d > dist[c]) continue;
      const ci = c % G.nx, cj = (c - ci) / G.nx;
      for (const [di, dj, w] of DIRS) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= G.nx || j >= G.ny) continue;
        const k = j * G.nx + i;
        if (g[k] || (di && dj && (g[cj * G.nx + i] || g[j * G.nx + ci]))) continue;
        const nd = d + w * G.res;
        if (nd < dist[k] - 1e-6) { dist[k] = nd; prev[k] = c; push([nd, k]); }
      }
    }
    return { dist, prev };
  }
  function lineFree(a, b, margin) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 0.04));
    for (let i = 1; i <= n; i++) { const k = i / n; if (blockedAt(lerp(a[0], b[0], k), lerp(a[1], b[1], k), BODY_R + (margin || 0))) return false; }
    return true;
  }
  /* How far (x, y) is: the grid is inflated by 5 cm, so a pose close to a wall can sit in a blocked cell; take the best
     reachable cell nearby that has a clear straight line to it. */
  function reachOf(x, y, dist) {
    const [ci, cj] = cellOf(x, y);
    let best = null;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= G.nx || j >= G.ny) continue;
      const k = j * G.nx + i, d = dist[k];
      if (!(d < Infinity)) continue;
      const [cx, cy] = cellXY(i, j), tot = d + Math.hypot(cx - x, cy - y);
      if (best && tot >= best.d) continue;
      if ((di || dj) && !lineFree([cx, cy], [x, y], 0)) continue;
      best = { d: tot, cell: k };
    }
    return best;
  }
  /* turn / walk actions from the agent's pose along the cell path to (x, y). */
  function routeActs(prev, x, y, cell) {
    const [gi, gj] = cellOf(x, y);
    let c = cell === undefined ? gj * G.nx + gi : cell;
    const cells = [];
    for (let guard = 0; c >= 0 && guard < 20000; guard++) { cells.push(c); c = prev[c]; }
    cells.reverse();
    const pts = [[P.x, P.y]].concat(cells.slice(1).map((k) => cellXY(k % G.nx, Math.floor(k / G.nx)))).concat([[x, y]]);
    const way = [pts[0]];
    for (let i = 0; i < pts.length - 1;) {
      let j = pts.length - 1;
      while (j > i + 1 && !lineFree(pts[i], pts[j], 0.02)) j--;
      way.push(pts[j]); i = j;
    }
    const acts = [];
    let h = P.h, cx = P.x, cy = P.y;
    for (let i = 1; i < way.length; i++) {
      const [wx, wy] = way[i], d = Math.hypot(wx - cx, wy - cy);
      if (d < 0.01) continue;
      const dd = round(d, 100), ahead = angDiff(headingOf(wx - cx, wy - cy), h);
      if (Math.abs(ahead) > 160 && d <= 1.5) {
        // a short way straight behind: step back instead of turning round twice
        acts.push(["back", dd]);
        cx -= Math.cos(rad(h)) * dd; cy -= Math.sin(rad(h)) * dd;
        continue;
      }
      const dh = round(ahead, 10);
      if (Math.abs(dh) >= 0.1) { acts.push(["turn", dh]); h = norm180(h + dh); }
      acts.push(["walk", dd]);
      cx += Math.cos(rad(h)) * dd; cy += Math.sin(rad(h)) * dd;
    }
    return { acts, h, x: cx, y: cy };
  }
  /* Candidate poses that put the crosshair on 3D point T from distances ds, either all around it (ring) or along a wall's
     normal n (with sideways offsets). */
  function posesAt(T, opts) {
    const out = [];
    const add = (x, y) => {
      const horiz = Math.hypot(T[0] - x, T[1] - y);
      out.push({ x, y, h: headingOf(T[0] - x, T[1] - y), p: clamp(deg(Math.atan2(T[2] - EYE, horiz)), PITCH_MIN, PITCH_MAX) });
    };
    if (opts.n) {
      const t = [-opts.n[1], opts.n[0]];
      opts.ds.forEach((d) => (opts.lat || [0]).forEach((l) => add(T[0] + opts.n[0] * d + t[0] * l, T[1] + opts.n[1] * d + t[1] * l)));
    } else {
      opts.ds.forEach((d) => { for (let a = 0; a < 360; a += 30) add(T[0] + Math.cos(rad(a)) * d, T[1] + Math.sin(rad(a)) * d); });
    }
    return out;
  }
  function stainPoint(st) {
    if (st.on === "floor") return [st.p[0], st.p[1], 0.003];
    if (st.on === "furn") return [st.p[0], st.p[1], furn[st.furn].h];
    const [x, y] = facePoint(faces[st.face], st.u, 0);
    return [x, y, st.z];
  }
  function faceSamples(F, step) {
    const us = [];
    for (let u = F.u0 + 0.35; u <= F.u1 - 0.35 + 1e-6; u += step) us.push(u);
    if (!us.length) us.push((F.u0 + F.u1) / 2);
    return us;
  }
  /* Poses for one job, each with the test its crosshair hit must pass. */
  function posesFor(j) {
    const ring = { ds: [0.8, 1.0, 1.2] };
    switch (j.k) {
      case "clean": {
        const T = stainPoint(j.st);
        const ps = j.st.on === "wall" ? posesAt(T, { n: faces[j.st.face].normal, ds: [0.75, 0.95, 1.15], lat: [0, -0.3, 0.3] }) : posesAt(T, j.st.on === "furn" ? { ds: [0.85, 1.05, 1.25] } : ring);
        return ps.map((p) => Object.assign(p, { ok: (hit) => covers(hit, j.st) && stainDist(hit, j.st) <= 0.35 }));
      }
      case "pick": {
        const f = j.box, T = j.tr ? [j.tr.p[0], j.tr.p[1], 0.04] : [(f.r[0] + f.r[2]) / 2, (f.r[1] + f.r[3]) / 2, f.h];
        return posesAt(T, ring).map((p) => Object.assign(p, { ok: (hit) => { const t = pickTarget(hit); return !!t && (j.tr ? t.tr === j.tr : t.box === j.box); } }));
      }
      case "dispose": {
        const b = furn.bin, T = [(b.r[0] + b.r[2]) / 2, (b.r[1] + b.r[3]) / 2, 0.6];
        return posesAt(T, { ds: [0.8, 1.0, 1.25] }).map((p) => Object.assign(p, { p: -25, ok: () => true, near: true }));
      }
      case "paint": {
        const F = j.F, out = [];
        faceSamples(F, 0.5).forEach((u) => { const [x, y] = facePoint(F, u, 0); posesAt([x, y, 1.45], { n: F.normal, ds: [0.8, 1.1] }).forEach((p) => out.push(p)); });
        return out.map((p) => Object.assign(p, { ok: (hit) => !!hit && (hit.t === "wall" || hit.t === "win") && hit.face === F.id && hit.horiz <= REACH }));
      }
      case "move": {
        const f = j.f, F = faces[f.against], r = f.moved ? f.orig : f.r;
        const u = F.ax === "x" ? (r[0] + r[2]) / 2 : (r[1] + r[3]) / 2, depth = F.ax === "x" ? r[3] - r[1] : r[2] - r[0];
        const [x, y] = facePoint(F, u, f.moved ? 0 : depth);
        return posesAt([x, y, 1.0], { n: F.normal, ds: [0.65, 0.85, 1.05, 1.25], lat: [0, -0.25, 0.25] }).map((p) => Object.assign(p, { ok: (hit) => moveTarget(hit) === f }));
      }
      case "demolish": {
        const s = segs[j.seg], out = [];
        ["neg", "pos"].forEach((k) => {
          const F = s.sides[k] && faces[s.sides[k]];
          if (!F) return;
          for (let u = s.s0 + 0.4; u <= s.s1 - 0.4 + 1e-6; u += 0.4) { const [x, y] = facePoint(F, u, 0); posesAt([x, y, 1.4], { n: F.normal, ds: [0.8, 1.0, 1.2] }).forEach((p) => out.push(p)); }
        });
        return out.map((p) => Object.assign(p, { ok: (hit) => !!hit && hit.t === "wall" && hit.seg === j.seg && hit.horiz <= REACH }));
      }
      case "install": {
        if (j.kind === "烟感") {
          const R = RD[j.room], T = [R.hub[0], R.hub[1], CEIL];
          return posesAt(T, { ds: [0.6, 0.8, 1.0] }).map((p) => Object.assign(p, { ok: (hit) => !!hit && hit.t === "ceil" && hit.room === j.room && hit.horiz <= REACH && inRect(hit.point[0], hit.point[1], [R.r[0] + 0.55, R.r[1] + 0.55, R.r[2] - 0.55, R.r[3] - 0.55], 0) }));
        }
        if (j.kind === "暖气片") {
          // low fixtures are fitted looking down at them, so the agent sees what it installed
          const [x, y] = facePoint(j.F, j.o.at, 0);
          return posesAt([x, y, 0.45], { n: j.F.normal, ds: [0.75, 0.95], lat: [0, -0.15, 0.15] }).map((p) => Object.assign(p, { ok: (hit) => !!hit && (hit.t === "wall" || hit.t === "win") && hit.face === j.F.id && Math.abs(hit.u - j.o.at) <= j.o.w / 2 - 0.08 && hit.horiz <= REACH }));
        }
        const bed = Object.values(furn).find((f) => f.kind === "bed" && f.room === j.room), F = faces[bed.against];
        const a = F.ax === "x" ? bed.r[0] : bed.r[1], b = F.ax === "x" ? bed.r[2] : bed.r[3], out = [];
        [b + 0.35, a - 0.35].forEach((u) => { if (u < F.u0 + 0.35 || u > F.u1 - 0.35) return; const [x, y] = facePoint(F, u, 0); posesAt([x, y, 0.3], { n: F.normal, ds: [0.75, 0.95], lat: [0, 0.15] }).forEach((p) => out.push(p)); });
        return out.map((p) => Object.assign(p, { ok: (hit) => { if (!hit || !(hit.t === "wall" || hit.t === "win") || hit.face !== F.id || hit.horiz > REACH) return false; const u = clamp(hit.u, F.u0 + 0.35, F.u1 - 0.35); return (u < a && a - u <= 0.75) || (u > b && u - b <= 0.75); } }));
      }
      case "goto": { const [x, y] = j.at; return [{ x, y, h: P.h, p: P.pitch, ok: () => true, goal: true }]; }
      case "drop": {
        // where the agent stands, or a step away when the floor around it is taken
        const out = [], spots = [[P.x, P.y]];
        for (let a = 0; a < 360; a += 45) spots.push([P.x + Math.cos(rad(a)) * 0.6, P.y + Math.sin(rad(a)) * 0.6]);
        spots.forEach(([x, y]) => { for (let h = -180; h < 180; h += 30) out.push({ x, y, h, p: -55, ok: (hit) => !!dropAt(hit, x, y).r }); });
        return out;
      }
      default: return [];
    }
  }
  function jobs() {
    const J = [], add = (j) => { if (!J.some((o) => o.key === j.key)) J.push(j); };
    TK.items.forEach((it) => {
      const inRooms = (r) => !it.rooms || it.rooms.indexOf(r) >= 0;
      switch (it.op) {
        case "clean": stains.filter((st) => st.level > 0 && inRooms(st.room) && !st.rubble).forEach((st) => add({ k: "clean", st, key: st.id })); break;
        case "trash": trash.filter((t) => !t.taken && inRooms(t.room) && !t.rubble).forEach((t) => add({ k: "pick", tr: t, key: t.id })); break;
        case "paint":
          Object.values(faces).filter((F) => F.room === it.room && F.segs.some((id) => segs[id].present) && !faceComplete(F, it.color)).forEach((F) => {
            const dirt = stains.filter((st) => st.face === F.id && st.level > 0);
            const block = Object.values(furn).filter((f) => f.tall && !f.moved && f.against === F.id && f.movable);
            dirt.forEach((st) => add({ k: "clean", st, key: st.id }));
            block.forEach((f) => add({ k: "move", f, key: "mv:" + f.id }));
            if (!dirt.length && !block.length) add({ k: "paint", F, color: it.color, key: "pt:" + F.id });
          });
          break;
        case "restore":
          Object.values(furn).filter((f) => f.moved).forEach((f) => {
            const pending = TK.items.some((i) => i.op === "paint" && faces[f.against].room === i.room && !faceComplete(faces[f.against], i.color));
            if (!pending) add({ k: "move", f, key: "mv:" + f.id });
          });
          break;
        case "radiators":
          if (paintPending(it.room)) break;
          Object.values(faces).filter((F) => F.room === it.room).forEach((F) => F.segs.forEach((id) => segs[id].ops.filter((o) => o.k === "win").forEach((o) => {
            if (!fixtures.some((fx) => fx.kind === "暖气片" && fx.face === F.id && Math.abs(fx.u - o.at) <= o.w / 2)) add({ k: "install", kind: "暖气片", F, o, key: `rad:${F.id}:${o.at}` });
          })));
          break;
        case "socket": if (evalItem(it, new Set()) < 1) add({ k: "install", kind: "插座", room: it.room, key: "socket" }); break;
        case "smoke": if (evalItem(it, new Set()) < 1) add({ k: "install", kind: "烟感", room: it.room, key: "smoke" }); break;
        case "demolish": if (segs[it.seg].present) add({ k: "demolish", seg: it.seg, key: "dm:" + it.seg }); break;
        case "rubble":
          if (!segs[it.seg].present) {
            stains.filter((st) => st.rubble === it.seg && st.level > 0).forEach((st) => add({ k: "clean", st, key: st.id }));
            trash.filter((t) => t.rubble === it.seg && !t.taken).forEach((t) => add({ k: "pick", tr: t, key: t.id }));
          }
          break;
        default: break;
      }
    });
    const carry = TK.items.find((i) => i.op === "carry"), toCarry = carry && !P.delivered && !boxAtGoal(carry);
    // trash needs both hands, and a box the order does not ask for only gets in the way
    if (P.carrying && (!toCarry || J.some((j) => j.k === "pick"))) return [{ k: "drop", key: "drop" }];
    if (toCarry) {
      const others = J.length > 0 || P.bag.length > 0;
      if (!P.carrying && !others) add({ k: "pick", box: furn[carry.item], key: "box" });
      if (P.carrying) add({ k: "goto", at: goalPoint(carry.goal), key: "goto" });
    }
    const morePicks = J.some((j) => j.k === "pick" && j.tr);
    if (P.bag.length >= BAG || (P.bag.length && !morePicks)) return [{ k: "dispose", key: "dispose" }];
    if (P.carrying) return J.filter((j) => j.k !== "pick" && j.k !== "dispose");
    return J;
  }
  function jobActs(j) {
    switch (j.k) {
      case "clean": return new Array(j.st.level).fill("clean");
      case "pick": return ["pick_up"];
      case "drop": return ["put_down"];
      case "dispose": return ["dispose"];
      case "paint": return [["paint", j.color]];
      case "move": return ["move_aside"];
      case "demolish": return ["demolish"];
      case "install": return [["install", j.kind]];
      case "goto": return ["stop"];
      default: return [];
    }
  }
  /* Cheapest valid pose over the given jobs: path length + 0.004 per degree of turning, checked in cost order. A pose must
     still pass with the aim 1.5° off either way: walks are rounded to 1 cm and turns to 0.1°, so a pose grazing an edge
     (a wardrobe just pushed aside) would otherwise be missed for ever. */
  const JITTER = [[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]];
  function bestPose(J) {
    const { dist, prev } = flood();
    root.updateMatrixWorld(true);
    const cands = [];
    J.forEach((j) => posesFor(j).forEach((p) => {
      const r = reachOf(p.x, p.y, dist);
      if (!r) return;
      cands.push({ j, p, cell: r.cell, cost: r.d + 0.004 * Math.abs(angDiff(p.h, P.h)) });
    }));
    cands.sort((a, b) => a.cost - b.cost);
    for (const c of cands.slice(0, 400)) {
      const { p } = c;
      if (!p.goal && blockedAt(p.x, p.y, BODY_R + 0.02)) continue;
      if (p.near ? !binNear(p.x, p.y, p.h) : !JITTER.every(([dh, dp]) => p.ok(cast(p.x, p.y, p.h + dh, p.p + dp)))) continue;
      return Object.assign(c, { prev });
    }
    return null;
  }
  function poseActs(best) {
    const r = routeActs(best.prev, best.p.x, best.p.y, best.cell), acts = r.acts.slice();
    if (!best.p.goal) {
      const dh = round(angDiff(best.p.h, r.h), 10);
      if (Math.abs(dh) >= 0.1) acts.push(["turn", dh]);
      if (Math.abs(best.p.p - P.pitch) >= 0.1) acts.push(["look", round(best.p.p, 10)]);
    }
    return acts;
  }
  /* Planned next job: { job, acts } (acts: the route, the final turn and look, then the job's own actions). */
  function nextJob() {
    if (P.done) return null;
    const J = jobs();
    if (!J.length) return { job: { k: "stop" }, acts: ["stop"] };
    const best = bestPose(J);
    if (!best) return { job: { k: "stuck" }, acts: [["declare_impossible", "oracle：剩下的活够不着"]], stuck: J.map((j) => j.key) };
    return { job: best.j, acts: poseActs(best).concat(jobActs(best.j)) };
  }
  function oracleActions() { const nj = nextJob(); return nj ? nj.acts : []; }
  /* Film helper (never part of the env): the actions that bring the agent to face one target, without doing the work. */
  function routeTo(kind, id, extra) {
    const j = { k: kind };
    if (kind === "clean") j.st = stains.find((st) => st.id === id);
    if (kind === "pick") j.tr = trash.find((t) => t.id === id);
    if (kind === "paint") { j.F = faces[id]; j.color = extra || "浅绿"; }
    if (kind === "move") j.f = furn[id];
    if (kind === "demolish") j.seg = id;
    if (kind === "install") {
      j.kind = extra;
      if (extra === "暖气片") { const [fid, at] = id.split("@"); j.F = faces[fid]; j.o = j.F.segs.map((sid) => segs[sid].ops).flat().find((o) => Math.abs(o.at - Number(at)) < 1e-6); } else j.room = id;
    }
    const best = bestPose([j]);
    return best ? poseActs(best) : null;
  }
  function place(x, y, h, pitch) {
    anims = [];
    Object.assign(P, { x, y, h: h === undefined ? P.h : h, pitch: pitch === undefined ? AI_PITCH : pitch, trail: [[x, y]] });
    syncCamera();
  }
  function stepAction(a) {
    const [name, arg] = typeof a === "string" ? [a, undefined] : a;
    act(name, arg);
    for (let i = 0; i < 4000 && busy(); i++) tick(0.05);
  }
  function rollout(limit) {
    let n = 0;
    while (!P.done && n < limit) {
      const acts = oracleActions();
      if (!acts.length) break;
      for (const a of acts) { stepAction(a); n += 1; if (P.done || n >= limit) break; }
    }
    return n;
  }

  // ---------------------------------------------------------------- reset
  function reset() {
    anims = [];
    build();
    Object.assign(P, { x: TK.start.x, y: TK.start.y, h: TK.start.h + WORLD.dh, pitch: AI_PITCH, zoom: false, steps: 0, minutes: 0, walked: 0, bag: [], carrying: null,
      done: false, success: false, delivered: false, declared: false, reason: "", reasonScore: 0, lbHit: false, removed: [], trail: [[TK.start.x, TK.start.y]],
      falseDone: false, shown: false });
    if (logOn) newLog();
    if (TK.pre) {
      const s = segs[TK.pre];
      s.present = false; s.group.visible = false;
      s.pieces.concat(s.panes).forEach((pc) => { targets = targets.filter((o) => o !== pc); });
      blockCache = null;
      relight();
    }
    say(TK.intro, TK.intro);
    syncCamera();
    renderUI();
  }

  // ---------------------------------------------------------------- frames
  function placeCamera(pose) {
    camera.position.copy(v3(pose.x + pose.sx, pose.y + pose.sy, EYE + pose.sz));
    camera.rotation.set(rad(pose.p), rad(pose.h - 90), 0);
    camera.fov = pose.fov;
  }
  /* cross: draw the crosshair people see, so agents know exactly where their tools act. */
  function snapshot(pose, w, h, withTool, mime, cross) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    renderer.setSize(w, h, false);
    placeCamera(pose);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    toolRoot.visible = !!withTool;
    renderer.render(scene, camera);
    let url;
    if (cross) {
      url = canvasOf(w, h, (g) => {
        g.drawImage(renderer.domElement, 0, 0, w, h);
        const s = Math.round(h / 40), cx = w / 2, cy = h / 2, line = () => { g.beginPath(); g.moveTo(cx - s, cy); g.lineTo(cx + s, cy); g.moveTo(cx, cy - s); g.lineTo(cx, cy + s); g.stroke(); };
        g.strokeStyle = "rgba(0,0,0,0.5)"; g.lineWidth = 4; line();
        g.strokeStyle = "#ffffff"; g.lineWidth = 2; line();
      }).toDataURL(mime || "image/jpeg", 0.9);
    } else url = renderer.domElement.toDataURL(mime || "image/jpeg", 0.9);
    toolRoot.visible = true;
    renderer.setSize(size.x, size.y, false);
    return url;
  }
  function logicalPose() { return { x: P.x, y: P.y, h: P.h, p: P.pitch, fov: P.zoom ? ZOOM_FOV : FOV, sx: 0, sy: 0, sz: 0 }; }
  /* Frames of one action's animation for GIFs: the camera moves smoothly and the tool in use is drawn. */
  function film(name, arg, o) {
    o = o || {};
    const w = o.w || 640, h = o.h || 360, fps = o.fps || 12, frames = [];
    const shot = () => frames.push({ img: snapshot(C, w, h, true), plan: o.plan ? planURL(o.plan.w, o.plan.h, Object.assign({ pose: C }, o.plan)) : null });
    act(name, arg);
    for (let i = 0; i < 600 && busy(); i++) { tick(1 / fps); shot(); }
    if (!frames.length) shot();
    for (let i = 0; i < (o.hold || 0); i++) shot();
    return { frames, text: P.text, info: info() };
  }

  /* 自己玩 for GIFs: held keys (or "walk to a point", steering like a person would) advance the real-time body frame by
     frame; { act } items run a tool. */
  function filmFree(seq, o) {
    o = o || {};
    const w = o.w || 640, h = o.h || 360, fps = o.fps || 12, dt = 1 / fps, frames = [], prev = EP.mode;
    EP.mode = "free";
    const shot = (label) => frames.push({ img: snapshot(C, w, h, true), plan: o.plan ? planURL(o.plan.w, o.plan.h, Object.assign({ pose: C }, o.plan)) : null, label, text: P.text });
    const release = () => Object.keys(keys).forEach((k) => (keys[k] = false));
    seq.forEach((s) => {
      release();
      if (s.act) { act(s.act, s.arg); for (let i = 0; i < 600 && busy(); i++) { tick(dt); shot(s.label || s.act); } return; }
      if (s.face) {
        for (let i = 0; i < 10 * fps; i++) {
          const diff = angDiff(headingOf(s.face[0] - P.x, s.face[1] - P.y), P.h);
          if (Math.abs(diff) < 2) break;
          release(); keys[diff > 0 ? "arrowleft" : "arrowright"] = true;
          freeStep(Math.min(dt, Math.abs(diff) / FREE_TURN)); shot(s.label || (diff > 0 ? "← 转" : "→ 转"));
        }
        return;
      }
      if (s.goto) {
        for (let i = 0; i < 40 * fps; i++) {
          const [tx, ty] = s.goto, d = Math.hypot(tx - P.x, ty - P.y), diff = angDiff(headingOf(tx - P.x, ty - P.y), P.h);
          if (d < 0.12) break;
          release();
          if (Math.abs(diff) > 4) keys[diff > 0 ? "arrowleft" : "arrowright"] = true;
          if (Math.abs(diff) < 35) keys.w = true;
          freeStep(dt); shot(s.label || "W 走");
        }
        return;
      }
      (s.keys || []).forEach((k) => (keys[k] = true));
      for (let i = 0; i < Math.round((s.t || 1) * fps); i++) {
        if (s.until && s.until()) break;
        freeStep(dt); shot(s.label || (s.keys || []).join("+"));
      }
    });
    release();
    EP.mode = prev;
    return { frames, info: info() };
  }

  // ---------------------------------------------------------------- top-down plan (god view, client's plan)
  const FLOOR_TINT = { wood: "#e8d9c2", tiles: "#e6e9ea", terrazzo: "#e2ddd3" };
  function drawPlan(g, W, H, o) {
    o = o || {};
    const client = o.style === "client", top = client ? 30 : 0;
    const B = [-0.35, -0.35, 11.85, 8.35], s = Math.min(W / (B[2] - B[0]), (H - top) / (B[3] - B[1]));
    const ox = (W - (B[2] - B[0]) * s) / 2, oy = (H - top - (B[3] - B[1]) * s) / 2;
    const X = (x) => ox + (x - B[0]) * s, Y = (y) => H - oy - (y - B[1]) * s;
    g.save();
    g.fillStyle = client ? "#fbfaf5" : "#f4f0e6"; g.fillRect(0, 0, W, H);
    ROOMS.forEach((R) => { g.fillStyle = client ? "#ffffff" : FLOOR_TINT[R.floor]; g.fillRect(X(R.r[0]), Y(R.r[3]), (R.r[2] - R.r[0]) * s, (R.r[3] - R.r[1]) * s); });
    if (!client) {
      Object.values(faces).forEach((F) => {
        if (!F.segs.some((id) => segs[id].present)) return;
        g.fillStyle = COLORS[F.color];
        F.segs.forEach((id) => {
          const sg = segs[id];
          if (!sg.present) return;
          const a = Math.max(sg.s0, F.u0), b = Math.min(sg.s1, F.u1), pl = facePlane(F, (a + b) / 2), d = 0.2 * F.normal[F.ax === "x" ? 1 : 0];
          if (F.ax === "x") g.fillRect(X(a), Y(Math.max(pl, pl + d)), (b - a) * s, Math.abs(d) * s); else g.fillRect(X(Math.min(pl, pl + d)), Y(b), Math.abs(d) * s, (b - a) * s);
        });
      });
      if (o.dirt !== false) stains.forEach((st) => {
        if (st.level <= 0) return;
        const ps = st.on === "wall" ? facePoint(faces[st.face], st.u, 0.12) : st.p;
        g.fillStyle = `rgba(110,72,36,${0.25 + 0.22 * st.level})`; g.beginPath(); g.arc(X(ps[0]), Y(ps[1]), Math.max(2, st.size * s * 0.32), 0, Math.PI * 2); g.fill();
      });
      trash.forEach((t) => { if (t.taken) return; g.fillStyle = t.rubble ? "#7d776c" : "#c0392b"; g.fillRect(X(t.p[0]) - 2.5, Y(t.p[1]) - 2.5, 5, 5); });
    }
    Object.values(furn).forEach((f) => {
      if (f.taken) return;
      if (f.moved && !client) { g.setLineDash([3, 3]); g.strokeStyle = "rgba(120,100,70,0.6)"; g.strokeRect(X(f.orig[0]), Y(f.orig[3]), (f.orig[2] - f.orig[0]) * s, (f.orig[3] - f.orig[1]) * s); g.setLineDash([]); }
      g.fillStyle = client ? "rgba(0,0,0,0.04)" : "rgba(150,124,92,0.35)"; g.strokeStyle = client ? "#9a9a9a" : "rgba(110,90,62,0.8)"; g.lineWidth = 1;
      g.fillRect(X(f.r[0]), Y(f.r[3]), (f.r[2] - f.r[0]) * s, (f.r[3] - f.r[1]) * s); g.strokeRect(X(f.r[0]), Y(f.r[3]), (f.r[2] - f.r[0]) * s, (f.r[3] - f.r[1]) * s);
    });
    if (!client) fixtures.forEach((fx) => {
      if (fx.kind === "烟感") { g.strokeStyle = "#c0392b"; g.lineWidth = 1.5; g.beginPath(); g.arc(X(fx.p[0]), Y(fx.p[1]), 3.5, 0, Math.PI * 2); g.stroke(); return; }
      const F = faces[fx.face], [x, y] = facePoint(F, fx.u, 0.06), w = fx.kind === "暖气片" ? 0.9 : 0.12;
      g.fillStyle = "#d35400";
      if (F.ax === "x") g.fillRect(X(fx.u - w / 2), Y(y) - 2, w * s, 4); else g.fillRect(X(x) - 2, Y(fx.u + w / 2), 4, w * s);
    });
    Object.values(segs).forEach((sg) => {
      const e0 = endExt(sg, sg.s0), e1 = endExt(sg, sg.s1), h = sg.t / 2;
      const rect = (a, b) => (sg.ax === "x" ? [X(a), Y(sg.c + h), (b - a) * s, sg.t * s] : [X(sg.c - h), Y(b), sg.t * s, (b - a) * s]);
      if (!sg.present) {
        if (client) return;
        g.setLineDash([4, 3]); g.strokeStyle = "#d84315"; g.lineWidth = 1.5; g.strokeRect(...rect(sg.s0, sg.s1)); g.setLineDash([]);
        return;
      }
      let cur = sg.s0 - e0;
      const draw = (a, b) => { const r = rect(a, b); if (sg.lb) { g.fillStyle = "#1d1d1d"; g.fillRect(...r); } else { g.fillStyle = client ? "#ffffff" : "#8a8580"; g.fillRect(...r); g.strokeStyle = "#1d1d1d"; g.lineWidth = 1; g.strokeRect(...r); } };
      holesOf(sg).forEach((hh) => {
        draw(cur, hh.a); cur = hh.b;
        if (hh.o.k === "win") { const r = rect(hh.a, hh.b); g.fillStyle = "#ffffff"; g.fillRect(...r); g.strokeStyle = "#3a8fd6"; g.lineWidth = 1.2; g.strokeRect(...r); if (sg.ax === "x") { g.beginPath(); g.moveTo(r[0], r[1] + r[3] / 2); g.lineTo(r[0] + r[2], r[1] + r[3] / 2); g.stroke(); } else { g.beginPath(); g.moveTo(r[0] + r[2] / 2, r[1]); g.lineTo(r[0] + r[2] / 2, r[1] + r[3]); g.stroke(); } }
        else if (client) {
          g.strokeStyle = "#555"; g.lineWidth = 1; g.beginPath();
          if (sg.ax === "x") { g.moveTo(X(hh.a), Y(sg.c)); g.arc(X(hh.a), Y(sg.c), (hh.b - hh.a) * s, -Math.PI / 2, 0); } else { g.moveTo(X(sg.c), Y(hh.a)); g.arc(X(sg.c), Y(hh.a), (hh.b - hh.a) * s, Math.PI, Math.PI * 1.5); }
          g.stroke();
        }
      });
      draw(cur, sg.s1 + e1);
    });
    g.textAlign = "center"; g.textBaseline = "middle";
    ROOMS.forEach((R) => {
      const cx = X((R.r[0] + R.r[2]) / 2), cy = Y((R.r[1] + R.r[3]) / 2);
      g.fillStyle = client ? "#222" : "rgba(40,36,30,0.85)"; g.font = `600 ${Math.max(10, Math.round(s * 0.36))}px ${FONT}`;
      g.fillText(R.name, cx, cy - (R.plate ? s * 0.2 : 0));
      if (R.plate) { g.font = `${Math.max(9, Math.round(s * 0.26))}px ${FONT}`; g.fillStyle = client ? "#555" : "rgba(40,36,30,0.6)"; g.fillText(`门牌「${R.plate}」`, cx, cy + s * 0.25); }
    });
    if (o.marks) {
      const mark = (x, y) => { g.strokeStyle = "#d32f2f"; g.lineWidth = 2; g.beginPath(); g.moveTo(X(x) - 4, Y(y) - 4); g.lineTo(X(x) + 4, Y(y) + 4); g.moveTo(X(x) + 4, Y(y) - 4); g.lineTo(X(x) - 4, Y(y) + 4); g.stroke(); };
      TK.items.forEach((it) => {
        if (it.op === "radiators") Object.values(faces).filter((F) => F.room === it.room).forEach((F) => F.segs.forEach((id) => segs[id].ops.filter((op) => op.k === "win").forEach((op) => { const [x, y] = facePoint(F, op.at, 0.15); mark(x, y); })));
        if (it.op === "smoke") { const R = RD[it.room]; mark(R.hub[0], R.hub[1]); }
        if (it.op === "socket") { const bed = Object.values(furn).find((f) => f.kind === "bed" && f.room === it.room), F = faces[bed.against]; const [x, y] = facePoint(F, (F.ax === "x" ? bed.r[2] : bed.r[3]) + 0.35, 0.12); mark(x, y); }
      });
    }
    if (o.trail && P.trail.length > 1) {
      g.strokeStyle = "rgba(239,108,0,0.6)"; g.lineWidth = 2; g.beginPath();
      P.trail.forEach(([x, y], i) => { if (i) g.lineTo(X(x), Y(y)); else g.moveTo(X(x), Y(y)); });
      g.stroke();
    }
    if (o.agent !== false && !client) {
      const ps = o.pose || logicalPose(), x = X(ps.x), y = Y(ps.y), a = -rad(ps.h);
      g.fillStyle = "rgba(255,160,40,0.22)"; g.beginPath(); g.moveTo(x, y); g.arc(x, y, s * 1.5, a - rad(33), a + rad(33)); g.closePath(); g.fill();
      g.strokeStyle = "rgba(230,81,0,0.5)"; g.lineWidth = 1; g.beginPath(); g.arc(x, y, BODY_R * s, 0, Math.PI * 2); g.stroke();
      g.fillStyle = "#e65100"; g.beginPath(); g.moveTo(x + Math.cos(a) * 8, y + Math.sin(a) * 8); g.lineTo(x + Math.cos(a + 2.5) * 6, y + Math.sin(a + 2.5) * 6); g.lineTo(x + Math.cos(a - 2.5) * 6, y + Math.sin(a - 2.5) * 6); g.closePath(); g.fill();
    }
    if (client) {
      g.fillStyle = "#333"; g.textAlign = "left"; g.textBaseline = "top"; g.font = `600 ${Math.max(11, Math.round(s * 0.3))}px ${FONT}`;
      g.fillText("客户附件：平面图（涂黑为承重墙）", 8, 6);
    }
    g.restore();
  }
  function planURL(w, h, o) { const c = canvasOf(w, h, (g) => drawPlan(g, w, h, o)); return c.toDataURL("image/png"); }
  function taskImage() { return planURL(768, 560, { style: "client", marks: !!TK.marks }); }

  // ---------------------------------------------------------------- UI: 自己玩 and AI 动作模式, as in the course
  function renderUI() {
    const rows = [["模式", EP.mode === "ai" ? `AI 动作模式 · ${T.vision ? "纯视觉" : "图文"}` : "自己玩"], ["起点", TK.startName], ["目标", TK.goalName], ["时间", TK.time]];
    if (EP.mode === "ai") rows.push(["步数上限", `${budget}（程序解 × 3 + 10）`]);
    $("task").innerHTML = T.card(rows) + `<ol>${TK.items.map((i) => `<li>${i.label}</li>`).join("")}</ol>`;
    const db = $("declBtn");
    if (db) db.onclick = () => { const r = window.prompt("为什么做不到？"); if (r !== null) act("declare_impossible", r); };
    if (TASK_IMG) T.photo(TASK_IMG);
    afterAct();
  }
  function afterAct() {
    $("msg").textContent = P.text;
    $("steps").textContent = String(P.steps);
    $("bag").textContent = `${P.bag.length}/${BAG}`;
    T.showClock(T.start + P.minutes);
  }
  function setMode(m) {
    EP.mode = m;
    $("modeFree").classList.toggle("on", m === "free");
    $("modeAI").classList.toggle("on", m === "ai");
    $("aibar").style.display = m === "ai" ? "flex" : "none";
    $("freebar").style.display = m === "free" ? "block" : "none";
    if (m === "ai") { P.pitch = round(P.pitch, 10); say("AI 动作模式：世界在你思考时暂停，每个动作按它耗的时间推进。", "AI 动作模式：世界在你思考时暂停，每个动作按它耗的时间推进。"); }
    else say("自己玩：WASD 移动，拖动鼠标或方向键看四周，C 擦、G 捡、V 放下、P 刷、H 拆、I 装、M 挪、F 走近看，Enter 完工。", "自己玩。");
    syncCamera();
    renderUI();
  }
  function showResult() {
    P.shown = true;
    if (STILL || !logOn) return;
    const ev = evaluate();
    const box = $("result");
    // the home page reads these records; "best" is the shortest game time of a passed order
    const rec = T.record(P.success, P.minutes * 60, P.walked);
    const recLine = P.success ? (rec.isBest ? `<b>新纪录！</b>第 ${rec.tries} 次尝试` : `本任务最快 ${T.fmtSecs(rec.best.seconds)} 游戏时间（第 ${rec.tries} 次尝试）`)
      : `已尝试 ${rec.tries} 次`;
    box.innerHTML = `<h2>${P.success ? "验收通过" : "未通过验收"}</h2>` +
      `<div style="font-size:12.5px;color:#b9ae98;margin:-4px 0 10px">${T.challenge ? `挑战模式 · 第 ${T.seed} 局 · ` : ""}${recLine}</div>` +
      `<div class="kv"><b>模式</b><span>${EP.mode === "ai" ? "AI 动作模式" : "自己玩"}</span>` +
      `<b>得分</b><span>${ev.score}</span><b>${EP.mode === "ai" ? "步数" : "施工动作"}</b><span>${P.steps}${EP.mode === "ai" ? ` / ${budget}（oracle ${ORACLE.steps}）` : ""}</span>` +
      `<b>游戏时间</b><span>${T.fmtMin(T.start + P.minutes)}（走了 ${round(P.walked, 10)} 米）</span>` +
      ev.items.map((i) => `<b>${i.done ? "✓" : "✗"} ${Math.round(i.partial * 100)}%</b><span>${i.label}</span>`).join("") +
      `<b>违规</b><span>${Object.entries(ev.violations).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join("，") || "无"}</span></div>` +
      `<div id="logState" style="font-size:12.5px;color:#b9ae98;margin:-6px 0 10px">正在保存试玩记录…</div>` +
      `<button id="again">再来一次</button> ${T.challenge ? `<button id="reroll">换一局</button> ` : ""}<button id="pick">换任务</button> ` +
      `<button id="god2">看上帝视角</button> <button id="dl">下载记录</button>`;
    box.style.display = "block";
    $("again").onclick = () => { box.style.display = "none"; $("godwrap").style.display = "none"; reset(); };
    if (T.challenge) $("reroll").onclick = () => T.go(T.index, { challenge: "1" });
    $("pick").onclick = () => T.open();
    $("god2").onclick = () => { const g = $("godwrap"); g.style.display = g.style.display === "none" ? "block" : "none"; };
    $("dl").onclick = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(LOG, null, 1)], { type: "application/json" }));
      a.download = `renovate_${TK.id}_${LOG.started}.json`; a.click();
    };
  }

  // ---------------------------------------------------------------- playtest log (people only; bench/playtest_server.py saves it)
  let logOn = false, LOG = null, lastPoseLog = 0;
  function newLog() {
    LOG = { kind: "play", task: TK.id, title: TK.name, obs: T.obs, mode: EP.mode, url: location.href, ua: navigator.userAgent, started: Date.now(),
      knobs: { alpha: LEVEL_ALPHA.slice(1), reach: REACH, radius: CLEAN_R }, oracle_steps: ORACLE.steps, budget, challenge: T.challenge, seed: T.seed,
      actions: [], poses: [], sent: false };
  }
  function logAct(name, arg) {
    LOG.mode = EP.mode;
    const R = roomAt(P.x, P.y);
    LOG.actions.push({ i: P.steps, a: name, arg: arg === undefined ? null : arg, ms: Date.now() - LOG.started, mode: EP.mode, x: round(P.x, 100), y: round(P.y, 100),
      room: R ? R.id : null, heading: round(P.h, 10), pitch: round(P.pitch, 10), text: P.text });
  }
  function sendLog(obj) {
    try { localStorage.setItem("spaceact2.renovate.lastlog", JSON.stringify(obj)); } catch (e) { /* storage full or disabled */ }
    return fetch("api/playtest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) })
      .then((r) => r.ok).catch(() => false);
  }
  function finishLog() {
    LOG.sent = true; LOG.ended = Date.now(); LOG.final = info();
    sendLog(LOG).then((ok) => { const s = $("logState"); if (s) s.textContent = ok ? "试玩记录已保存到服务器。" : "没连上记录服务器：点「下载记录」自己保存。"; });
  }

  // ---------------------------------------------------------------- photoreal stills (bench/playtest_server.py --photoreal)
  /* Once the view has held still for half a second (in either mode), the server renders exactly this view with Cycles —
     the frames the photoreal benchmark shows models — and it fades in over the live view; any movement or action brings
     the live view straight back. Without that server (a static host, a file:// page) the button never appears. */
  const PHOTO = { on: false, seq: 0, key: null, still: 0, sig: "", shown: false, client: Math.random().toString(36).slice(2, 10) };
  function photoProbe(tries) {
    if (STILL || EVAL || CALIB) return;
    fetch("api/render").then((r) => r.json()).then((j) => {
      if (j.starting && tries < 40) { setTimeout(() => photoProbe(tries + 1), 3000); return; }
      if (!j.ok) return;
      const b = $("photoBtn");
      PHOTO.on = Q.get("photo") !== "0";
      b.style.display = ""; b.classList.toggle("on", PHOTO.on);
      b.onclick = () => { PHOTO.on = !PHOTO.on; b.classList.toggle("on", PHOTO.on); if (!PHOTO.on) photoHide(); };
    }).catch(() => {});
  }
  function photoHide() {
    PHOTO.key = null; PHOTO.seq += 1;
    $("photoNote").style.display = "none";
    if (PHOTO.shown) { const img = $("photo"); img.classList.add("quick"); img.style.opacity = "0"; PHOTO.shown = false; }
  }
  /* Every frame: notice movement, and ask for a still once the camera has rested. */
  function photoTick(dt) {
    if (!PHOTO.on) return;
    const sig = [C.x, C.y, C.h, C.p, C.fov, C.sx, C.sy, C.sz].map((v) => Math.round(v * 1000)).join(",");
    const moving = sig !== PHOTO.sig || busy();
    PHOTO.sig = sig;
    if (moving) { PHOTO.still = 0; if (PHOTO.key) photoHide(); return; }
    PHOTO.still += dt;
    if (PHOTO.still < 0.5 || PHOTO.key) return;
    const st = sceneState(), key = JSON.stringify(st), seq = ++PHOTO.seq;
    const w = Math.min(960, canvas.clientWidth || 960), h = Math.round((w * 9) / 16);
    PHOTO.key = key;
    $("photoNote").style.display = "block";
    fetch("api/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: st, w, h, client: PHOTO.client, seq }) })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (!blob || seq !== PHOTO.seq || PHOTO.key !== key) return;
        const img = $("photo"), old = img.src;
        img.onload = () => {
          if (old.startsWith("blob:")) URL.revokeObjectURL(old);
          if (seq !== PHOTO.seq) return;
          img.classList.remove("quick"); img.style.opacity = "1"; PHOTO.shown = true;
          $("photoNote").style.display = "none";
        };
        img.src = URL.createObjectURL(blob);
      })
      .catch(() => { if (seq === PHOTO.seq) $("photoNote").style.display = "none"; });
  }

  // ---------------------------------------------------------------- input
  const keys = {};
  let drag = null;
  function bindUI() {
    const sel = $("color"), fx = $("fixture");
    sel.innerHTML = Object.keys(COLORS).map((c) => `<option>${c}</option>`).join("");
    fx.innerHTML = FIXTURES.map((c) => `<option>${c}</option>`).join("");
    const dist = () => Number($("aiDist").value) || 1, ang = () => Number($("aiDeg").value) || 0;
    const fire = (a, arg) => {
      if (busy() || P.done) return;
      if (a === "paint") arg = sel.value;
      if (a === "install") arg = fx.value;
      if (a === "declare_impossible") { const r = window.prompt("为什么做不到？"); if (r === null) return; arg = r; }
      act(a, arg);
    };
    const AI = { walk: () => ["walk", dist()], back: () => ["back", dist()], sideL: () => ["sidestep", dist()], sideR: () => ["sidestep", -dist()],
      turnL: () => ["turn", Math.abs(ang())], turnR: () => ["turn", -Math.abs(ang())], look: () => ["look", ang()],
      lookUp: () => ["look", LOOKS.up], lookLevel: () => ["look", LOOKS.level], lookDown: () => ["look", LOOKS.down] };
    document.querySelectorAll("#bar button[data-a]").forEach((b) => (b.onclick = () => { const k = b.dataset.a; if (AI[k]) fire(...AI[k]()); else fire(k); }));
    $("modeFree").onclick = () => setMode("free");
    $("modeAI").onclick = () => setMode("ai");
    $("restart").onclick = () => { $("result").style.display = "none"; reset(); };
    const TOOLKEYS = { c: "clean", g: "pick_up", v: "put_down", b: "dispose", p: "paint", h: "demolish", i: "install", m: "move_aside", f: "look_closer", enter: "stop", x: "declare_impossible" };
    window.addEventListener("keydown", (ev) => {
      if (ev.repeat || ev.target.tagName === "SELECT" || ev.target.tagName === "INPUT" || CALIB) return;
      const k = ev.key.toLowerCase();
      if (ev.key === "Tab") { ev.preventDefault(); document.body.classList.toggle("nohud"); return; }
      if (k === "r" && !TOOLKEYS[k]) { reset(); return; }
      if (TOOLKEYS[k]) { ev.preventDefault(); fire(TOOLKEYS[k]); return; }
      if (EP.mode === "ai") {
        const map = { w: "walk", arrowup: "walk", s: "back", arrowdown: "back", a: "turnL", arrowleft: "turnL", d: "turnR", arrowright: "turnR", q: "sideL", e: "sideR" };
        if (map[k]) { ev.preventDefault(); fire(...AI[map[k]]()); }
        return;
      }
      keys[k] = true;
      if (["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) ev.preventDefault();
    });
    window.addEventListener("keyup", (ev) => { keys[ev.key.toLowerCase()] = false; });
    window.addEventListener("blur", () => Object.keys(keys).forEach((k) => (keys[k] = false)));
    canvas.addEventListener("mousedown", (ev) => { drag = [ev.clientX, ev.clientY]; });
    window.addEventListener("mouseup", () => { drag = null; });
    window.addEventListener("mousemove", (ev) => {
      if (!drag || EP.mode !== "free" || busy() || P.done) return;
      const dx = ev.clientX - drag[0], dy = ev.clientY - drag[1];
      drag = [ev.clientX, ev.clientY];
      P.h = norm180(P.h - dx * 0.25); P.pitch = clamp(P.pitch - dy * 0.2, PITCH_MIN, PITCH_MAX);
      P.minutes += (Math.abs(dx) * 0.25) / TURN_S / 60;
    });
  }
  /* 自己玩: walking slides along walls; turning and looking are continuous; the game clock counts what the body did. */
  function freeStep(dt) {
    if (EP.mode !== "free" || busy() || P.done) return;
    const f = (keys.w ? 1 : 0) - (keys.s ? 1 : 0), side = (keys.a ? 1 : 0) - (keys.d ? 1 : 0);
    const turn = (keys.arrowleft ? 1 : 0) - (keys.arrowright ? 1 : 0), look = (keys.arrowup ? 1 : 0) - (keys.arrowdown ? 1 : 0);
    if (turn) { P.h = norm180(P.h + turn * FREE_TURN * dt); P.minutes += (FREE_TURN * dt) / TURN_S / 60; }
    if (look) P.pitch = clamp(P.pitch + look * 60 * dt, PITCH_MIN, PITCH_MAX);
    if (f || side) {
      // real elapsed time, moved in 4 cm sub-steps so a slow frame cannot carry the body through a 12 cm wall
      const h = rad(P.h), len = Math.hypot(f, side), sp = FREE_WALK * dt / len;
      const dx = (Math.cos(h) * f - Math.sin(h) * side) * sp, dy = (Math.sin(h) * f + Math.cos(h) * side) * sp;
      const x0 = P.x, y0 = P.y, n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.04));
      for (let i = 0; i < n; i++) {
        if (!blockedAt(P.x + dx / n, P.y)) P.x += dx / n;
        if (!blockedAt(P.x, P.y + dy / n)) P.y += dy / n;
      }
      const moved = Math.hypot(P.x - x0, P.y - y0);
      P.walked += moved; P.minutes += moved / WALK / 60;
      const last = P.trail[P.trail.length - 1];
      if (!last || Math.hypot(P.x - last[0], P.y - last[1]) > 0.3) P.trail.push([P.x, P.y]);
    }
    if (logOn && LOG && Date.now() - lastPoseLog > 1000) { lastPoseLog = Date.now(); LOG.poses.push([Date.now() - LOG.started, round(P.x, 100), round(P.y, 100), round(P.h, 10), round(P.pitch, 10)]); }
    T.showClock(T.start + P.minutes);
    syncCamera();
  }
  let last = performance.now();
  function frame(now) {
    const raw = Math.min(0.25, (now - last) / 1000), dt = Math.min(0.05, raw);
    last = now;
    if (busy()) tick(dt); else freeStep(raw);
    // letterbox to 16:9 so people see what agents see: same aspect, same field of view
    const W0 = window.innerWidth, H0 = window.innerHeight;
    let w = W0, h = Math.round((W0 * 9) / 16);
    if (h > H0) { h = H0; w = Math.round((H0 * 16) / 9); }
    if (canvas.style.width !== `${w}px` || canvas.style.height !== `${h}px`) {
      const box = { width: `${w}px`, height: `${h}px`, left: `${Math.round((W0 - w) / 2)}px`, top: `${Math.round((H0 - h) / 2)}px` };
      Object.assign(canvas.style, box);
      Object.assign($("photo").style, box);
      renderer.setSize(w, h, false);
    }
    placeCamera(C);
    camera.aspect = 16 / 9; camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    photoTick(raw);
    if ($("godwrap").style.display !== "none") drawPlan($("god").getContext("2d"), $("god").width, $("god").height, { trail: true });
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- stain visibility calibration (?calib=1)
  /* Agent frames from real working poses (anywhere in a room, facing a surface 0.8–1.5 m away, looking level to well down),
     with one stain near the crosshair at a test opacity, or none (catch trials). People answer "stain or not". */
  function runCalib() {
    const box = $("calib"), R = rng(Number(Q.get("seed")) || Date.now() % 100000);
    box.style.display = "flex";
    stains.forEach((st) => (st.mesh.visible = false));
    trash.forEach((t) => (t.group.visible = false));
    root.updateMatrixWorld(true);
    const alphas = (Q.get("levels") || "0.08,0.12,0.16,0.2,0.3,0.45").split(",").map(Number);
    const trials = [];
    alphas.forEach((a) => [false, true].forEach((zoom) => { for (let k = 0; k < 2; k++) trials.push({ alpha: a, zoom, present: true }); }));
    for (let k = 0; k < 6; k++) trials.push({ alpha: 0, zoom: k % 2 === 1, present: false });
    for (let i = trials.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [trials[i], trials[j]] = [trials[j], trials[i]]; }
    const looks = ["coffee", "mud", "grime", "mold"];
    const randomView = () => {
      for (let k = 0; k < 400; k++) {
        const Rm = ROOMS[Math.floor(R() * ROOMS.length)], x = lerp(Rm.r[0] + 0.4, Rm.r[2] - 0.4, R()), y = lerp(Rm.r[1] + 0.4, Rm.r[3] - 0.4, R());
        if (blockedAt(x, y)) continue;
        const h = R() * 360 - 180, p = -5 - R() * 50, hit = cast(x, y, h, p);
        if (hit && hit.horiz >= 0.8 && hit.horiz <= REACH && (hit.t === "floor" || (hit.t === "wall" && hit.face))) return { x, y, h, p, hit };
      }
      return null;
    };
    const place_ = (v, st) => {
      for (let k = 0; k < 12; k++) {
        const du = (R() - 0.5) * 0.5, dv = (R() - 0.5) * 0.5;
        if (v.hit.t === "floor") {
          const p = [v.hit.point[0] + du, v.hit.point[1] + dv], room = roomAt(p[0], p[1]);
          if (!room || room.id !== v.hit.room || Object.values(furn).some((f) => inRect(p[0], p[1], f.r, 0.25))) continue;
          return Object.assign(st, { on: "floor", p });
        }
        const F = faces[v.hit.face], u = v.hit.u + du, z = clamp(v.hit.point[2] + dv, 0.35, 2.2);
        if (u < F.u0 + 0.4 || u > F.u1 - 0.4 || holesOf(segAt(F, u)).some((hh) => u > hh.a - 0.3 && u < hh.b + 0.3 && z > hh.z0 - 0.3 && z < hh.z1 + 0.3)) continue;
        return Object.assign(st, { on: "wall", face: F.id, u, z });
      }
      return null;
    };
    let i = 0, t0 = 0;
    const show = () => {
      if (i >= trials.length) { finish(); return; }
      const tr = trials[i];
      let v = null, st = null;
      for (let k = 0; k < 30 && !st; k++) { v = randomView(); if (v) st = place_(v, { id: `calib${i}_${k}`, size: 0.5, look: looks[Math.floor(R() * looks.length)] }); }
      const mesh = tr.present ? stainMesh(st, tr.alpha) : null;
      if (mesh) root.add(mesh);
      const img = snapshot({ x: v.x, y: v.y, h: v.h, p: v.p, fov: tr.zoom ? ZOOM_FOV : FOV, sx: 0, sy: 0, sz: 0 }, 768, 432, false, "image/png", true);
      if (mesh) { root.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }
      Object.assign(tr, { x: round(v.x, 100), y: round(v.y, 100), heading: round(v.h, 10), pitch: round(v.p, 10), surface: st.on, look: st.look });
      box.innerHTML = `<div class="q">第 ${i + 1} / ${trials.length} 张：画面里有没有污渍？</div><img src="${img}">` +
        `<div class="btns"><button class="yes">有污渍 <kbd>Y</kbd></button><button class="no">没有 <kbd>N</kbd></button></div>` +
        `<div class="sub">${tr.zoom ? "这是「走近看」的画面" : "这是正常视角的画面"} · 凭第一眼判断，拿不准就选“没有”</div>`;
      box.querySelector(".yes").onclick = () => answer(true);
      box.querySelector(".no").onclick = () => answer(false);
      t0 = performance.now();
    };
    const answer = (yes) => { if (i >= trials.length) return; Object.assign(trials[i], { answer: yes, rt: Math.round(performance.now() - t0) }); i += 1; show(); };
    window.addEventListener("keydown", (e) => { const k = e.key.toLowerCase(); if (k === "y") answer(true); if (k === "n") answer(false); });
    const finish = () => {
      const rate = (ts) => (ts.length ? ts.filter((t) => t.answer).length / ts.length : null);
      const rows = alphas.map((a) => ({ alpha: a, normal: rate(trials.filter((t) => t.present && t.alpha === a && !t.zoom)), zoom: rate(trials.filter((t) => t.present && t.alpha === a && t.zoom)) }));
      const falseAlarm = rate(trials.filter((t) => !t.present));
      const pick = rows.find((r) => r.zoom >= 0.75 && r.normal <= 0.5);
      const summary = { rows, false_alarm: falseAlarm, suggested_level1_alpha: pick ? pick.alpha : null, current_level1_alpha: LEVEL_ALPHA[1] };
      const pct = (x) => `${Math.round(x * 100)}%`;
      box.innerHTML = `<div class="q">校准结果</div><table><tr><th>透明度</th><th>正常视角检出率</th><th>走近看检出率</th></tr>` +
        rows.map((r) => `<tr><td>${r.alpha}</td><td>${pct(r.normal)}</td><td>${pct(r.zoom)}</td></tr>`).join("") + `</table>` +
        `<div class="sub">没有污渍时误报 ${pct(falseAlarm)}。当前 1 级污渍透明度 ${LEVEL_ALPHA[1]}；` +
        `${pick ? `建议改为 ${pick.alpha}（正常看不太出、走近看能看出）` : "没有哪一档同时满足“正常看不太出、走近看能看出”"}。</div><div class="sub" id="calibSave">正在保存…</div>`;
      sendLog({ kind: "calib", url: location.href, ua: navigator.userAgent, ended: Date.now(), trials, summary })
        .then((ok) => { $("calibSave").textContent = ok ? "结果已保存到服务器。" : "没连上记录服务器，结果只在本页。"; });
    };
    show();
  }

  /* Seed check for bench/make_seed_bank.py: every task's oracle finishes on this seed's world within its step budget. */
  function verifyWorld() {
    const keep = TK, keepBudget = budget, out = {};
    TASKS.forEach((t) => {
      TK = t; budget = Infinity;
      reset();
      const n = rollout(3000), ev = evaluate();
      out[t.id] = { ok: P.success, oracle_steps: n, budget: n * 3 + 10, score: ev.score };
    });
    TK = keep; budget = keepBudget;
    reset();
    return out;
  }
  /* Everything the photoreal renderer (blender/renovate_photoreal.py --serve) needs to draw the agent's view; furniture
     comes as absolute footprints because a seed may have moved it away from the layout. Harness-side only. */
  const sceneState = () => ({
    pose: { x: P.x, y: P.y, h: P.h, pitch: P.pitch, fov: P.zoom ? ZOOM_FOV : FOV },
    faces: Object.fromEntries(Object.values(faces).map((F) => [F.id, F.color])),
    removed: Object.values(segs).filter((s) => !s.present).map((s) => s.id),
    stains: stains.map((st) => ({ id: st.id, on: st.on, p: st.p || null, face: st.face || null, furn: st.furn || null, u: st.u, z: st.z,
      size: st.size, look: st.look, alpha: LEVEL_ALPHA[st.level] * (st.under ? 0.7 : 1) })),
    trash: trash.map((t) => ({ id: t.id, kind: t.kind, p: t.p, taken: t.taken })),
    furn: Object.values(furn).map((f) => ({ id: f.id, r: f.r.slice(), taken: f.taken })),
    fixtures: fixtures.map((fx) => ({ kind: fx.kind, face: fx.face || null, u: fx.u === undefined ? null : fx.u, p: fx.p || null })),
    carrying: P.carrying ? P.carrying.id : null,
  });

  let TASK_IMG = null;
  const ORACLE = { steps: null, ok: null };
  const ENV = window.SANav.exposeEnv({
    reset, setMode, act, busy, tick, done: () => P.done, info,
    text: () => `${P.text}（${T.fmtMin(T.start + P.minutes)}）`,
    frame: (w, h, mime) => snapshot(logicalPose(), w, h, false, mime, true),
    photo: () => TASK_IMG,
    taskCard: () => {
      const card = { scene: "renovate", id: TK.id, title: TK.name, intro: TK.intro, rules: RULES, actions: ACTIONS, action_names: ACTION_NAMES,
        items: TK.items.map((i) => i.label), maxSteps: budget, obs: T.obs, challenge: T.challenge, seed: T.seed, eval: EVAL, startTime: TK.time,
        colors: Object.keys(COLORS), fixtures: FIXTURES, body_radius: BODY_R, reach: REACH, fov: FOV };
      if (EVAL) delete card.seed;
      return card;
    },
  });
  window.SPACEACT = EVAL ? Object.freeze({ env: Object.freeze({ reset: ENV.reset, step: ENV.step, observe: ENV.observe, frame: ENV.frame,
    photo: ENV.photo, task: ENV.task }), state: sceneState }) : {
    task: TK, player: P, scene, mode: () => EP.mode, setMode, verify: verifyWorld, world: WORLD,
    get faces() { return faces; }, get stains() { return stains; }, get trash() { return trash; }, get furn() { return furn; }, get fixtures() { return fixtures; },
    get oracleSteps() { return ORACLE.steps; }, get oracleSuccess() { return ORACLE.ok; },
    act, info, evaluate, oracle: oracleActions, nextJob, rollout, film, filmFree, cast, aim, routeTo, place, blockedAt, freeRun,
    state: sceneState,
    /* Self-check: every candidate pose of the pending jobs with its path length, blocked flag and crosshair test. */
    poses: () => {
      const { dist } = flood();
      root.updateMatrixWorld(true);
      return jobs().map((j) => ({ job: j.key, poses: posesFor(j).map((p) => {
        const r = reachOf(p.x, p.y, dist);
        return { x: round(p.x, 100), y: round(p.y, 100), h: round(p.h, 10), p: round(p.p, 10), dist: r ? round(r.d, 100) : null,
          blocked: !p.goal && !!blockedAt(p.x, p.y, BODY_R + 0.02), ok: p.near ? binNear(p.x, p.y, p.h) : p.ok(cast(p.x, p.y, p.h, p.p)) };
      }) }));
    },
    still: (o) => ({ img: snapshot(C, o.w || 640, o.h || 360, true), plan: o.plan ? planURL(o.plan.w, o.plan.h, Object.assign({ pose: C }, o.plan)) : null }),
    plan: (w, h, o) => planURL(w || 600, h || 430, o),
    frame: (w, h, mime) => snapshot(logicalPose(), w || 768, h || 432, false, mime, true),
    shot: (pose, w, h) => snapshot(Object.assign(logicalPose(), pose), w || 960, h || 540, false, "image/png"),
    env: ENV,
  };

  if (VARIED) variant(T.seed);
  // 刷完再找 names the bedroom by the colour its walls have in this world
  TASKS.forEach((t) => {
    const fill = (s) => (s ? s.split("{wallB}").join(RD.second.wall) : s);
    t.intro = fill(t.intro); t.goalName = fill(t.goalName);
    t.items.forEach((it) => { it.label = fill(it.label); });
  });
  Promise.all([loadImages(), loadModels()]).then(() => {
    makeMaterials();
    makeTools();
    lightsOnce();
    bindUI();
    EP.mode = "ai";
    reset();
    // budget = oracle steps × 3 + 10, from a full oracle run on a fresh copy of the flat
    budget = Infinity;
    ORACLE.steps = rollout(3000); ORACLE.ok = P.success;
    budget = ORACLE.steps * 3 + 10;
    TK.maxSteps = budget;
    logOn = !STILL && !CALIB && !EVAL;
    reset();
    TASK_IMG = taskImage();
    T.photo(TASK_IMG);
    if (Q.has("god") && !VARIED) $("godwrap").style.display = "block";
    setMode(STILL || EVAL || Q.get("mode") === "ai" ? "ai" : "free");
    $("loading").style.display = "none";
    if (EVAL) delete window.SA_RENO;
    if (CALIB) runCalib();
    else if (!STILL) { requestAnimationFrame(frame); photoProbe(0); }
  });
})();
