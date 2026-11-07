/* Space Track · 失踪的侦探 (web): one office, ten tasks. 自己玩 — WASD and the mouse, in real time; AI 动作模式 — the world
   waits while you think and every action moves the clock on by what it costs. Tools act only on what the crosshair points at
   within reach. ?challenge=1 and ?eval=1 draw every task's answers from the seed (variant()), so an answer learnt on one
   seed does not carry over; with ?eval=1 the page keeps nothing but the env API that bench/runner.js drives. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const Q = new URLSearchParams(location.search);
  const EYE = 1.62, BODY_R = 0.32, REACH = 2.25, HIGH_REACH = 2.1, FOV = 62, ZOOM_FOV = 28;
  const WALK = 1.35, TURN_S = 140, FREE_WALK = 2.05, FREE_TURN = 120;
  const PITCH_MIN = -55, PITCH_MAX = 60, MAX_WALK = 6, MAX_WAIT = 600, PLAN_MAX = 12, STUDY = 30;
  // game minutes per action besides walking and turning
  const MIN = { look_closer: 3 / 60, inspect: 20 / 60, move_aside: 0.5, toggle_light: 10 / 60, pick_place: 10 / 60, mark_anomaly: 15 / 60 };
  const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const norm180 = (h) => ((((h + 180) % 360) + 360) % 360) - 180;
  const angDiff = (a, b) => norm180(a - b);
  const headingOf = (dx, dy) => deg(Math.atan2(dy, dx));
  const round = (v, k) => Math.round(v * k) / k;
  const numArg = (a) => (typeof a === "number" ? a : typeof a === "string" && a.trim() !== "" && isFinite(Number(a)) ? Number(a) : NaN);

  const L0 = window.SA_DETECTIVE;
  const SOLIDS = L0.SOLIDS, TARGETS = L0.TARGETS;

  // ---------------------------------------------------------------- tasks
  /* 第一章「她的便条」: the note is written from her chair, facing the desk (and the door), so her left hand is the east end;
     the card in the box is written from the stone door. Read either one the wrong way round and you reach the mirror-image
     box or bookcase. The control writes the note from the door too. */
  const SEALED_BOXES = ["jewel", "chest", "snakebox", "scrollbox", "longchest"];
  const SEALED_SHELVES = ["shelfNE", "shelfNW", "shelfW", "shelfW2", "shelfE", "shelfSW"];
  const BOX_AT = { left: "jewel", right: "chest" };
  const HAND = { left: "左", right: "右" }, OTHER = { left: "right", right: "left" };
  const CARDS = {
    shelfNE: { text: "你从石门进来时，右手边、最里面的墙角，那座书架。东西在第二层。", layer: "第二层" },
    shelfNW: { text: "你从石门进来时，左手边、最里面的墙角，那座矮书架。东西在最下层。", layer: "最下层" },
    shelfSW: { text: "你从石门进来时，左手边、离门最近的那座书架。东西在第二层。", layer: "第二层" },
  };
  const DOCS = { letter: "线索墙上那封信", notebook: "书桌上的笔记本", enchanter: "线索墙前长桌底下的附魔书", astro: "书桌上的占星图", wtmap: "线索墙上的战略地图" };
  const SIGNS = { astro: "书桌上的占星图", wtmap: "线索墙上的战略地图", skull: "屏风上方的水晶头骨" };
  /* Things the intruder may have moved (现场勘验, 入夜): each is undone by marking its prop. */
  const CHANGES = {
    chair: { target: "chair", apply: () => moveSolid("chair", 0.72, 0.15), undo: () => resetSolid("chair") },
    screen: { target: "screen", apply: () => moveSolid("screen", -0.45, -0.2), undo: () => resetSolid("screen") },
    cluetable: { target: "cluetable", apply: () => moveSolid("cluetable", -0.5, -0.45), undo: () => resetSolid("cluetable") },
    brazierW: { target: "brazierW", apply: () => setLight("brazierW", false), undo: () => setLight("brazierW", true) },
    brazierE: { target: "brazierE", apply: () => setLight("brazierE", false), undo: () => setLight("brazierE", true) },
    enchanter: { target: "enchanter", at: [-1.3, 0.3, 0.08] },
    chest: { target: "chest", at: [-1.3, 2.9, 0.11] },
    flask: { target: "flask", at: [1.9, 2.6, 0.45] },
    leg: { target: "leg", at: [-1.6, 0.9, 0.34] },
  };
  Object.values(CHANGES).filter((c) => c.at).forEach((c) => {
    c.apply = () => moveCenterTo(TARGETS[c.target], c.at);
    c.undo = () => moveCenterTo(TARGETS[c.target], TARGETS[c.target].homeC);
  });
  // where 器物归置 leaves each relic (middle of the prop: on the floor, the bed or the desk)
  const SCATTER = {
    leg: [[-1.6, 0.9, 0.34], [2.0, -0.9, 0.32], [-1.9, -2.8, 0.32]],
    chest: [[1.15, -3.2, 0.56], [-1.3, 2.9, 0.11], [2.1, 0.2, 0.11]],
    flask: [[-0.05, 0.68, 1.19], [-1.2, 3.6, 0.45], [1.9, 2.6, 0.45]],
  };
  const RELIC_HOME = { leg: "工作台南头的地上", chest: "书桌西头", flask: "东墙小边桌旁的地上" };
  const DOOR_START = { x: -1.75, y: -3.85, h: 90 };
  const CASE_STARTS = [{ x: 0.2, y: 3.3, h: -90 }, { x: -1.4, y: -0.6, h: 60 }, { x: 2.0, y: -0.8, h: 120 }];

  const NOTE_INTRO = "16:40。侦探伊妲已经三天没有露面。你是她的助手，刚进事务所，她给你留了一张便条。她的盒子和书架都封了蜡，" +
    "开错一处，另一个在找她的人就会知道有人来过，这一局立即结束。按便条找到那只盒子，再按盒子里的提示找下去，找到后 stop。";
  /* Each task's text and items come from its parameters p (fixed by default, drawn from the seed by variant()). */
  const BUILD = {
    note(t, p) {
      t.box = BOX_AT[p.hand]; t.shelf = p.shelf; t.card = CARDS[p.shelf].text;
      t.note = p.ctrl ? `你从石门进来，面对书桌，桌上${HAND[OTHER[p.hand]]}手那头的盒子。别的都封了蜡，只开这一只。—— 伊妲`
        : `坐在我的椅子上、面对书桌，桌上${HAND[p.hand]}手那头的盒子。别的都封了蜡，只开这一只。—— 伊妲`;
      t.intro = `${NOTE_INTRO}便条上写着：「${t.note}」`;
      t.items = [{ id: "box", op: "found", target: t.box, label: "打开便条说的那只盒子" }, { id: "shelf", op: "found", target: t.shelf, label: "找到卡片说的那座书架" }];
    },
    night(t, p) {
      t.changes = p.changes.slice(); t.night = !p.ctrl; t.study = STUDY;
      t.intro = `18:30，天快黑了。伊妲交代过：今晚会有人来翻她的事务所。先趁天亮把屋里看一遍（最多 ${STUDY} 步，wait 可以提前结束），` +
        `然后你去门外等到天黑。${p.ctrl ? "回来时屋里的灯都还亮着。" : "天黑后回来，屋里只剩你手里提灯的光，照得到两米左右。"}` +
        `那个人动了 ${t.changes.length} 样东西：找出来，对准后「标记 / 复原」，全部复原后 stop。标错没被动过的东西算误报。`;
      t.items = [{ id: "fix", op: "changes", label: `找出并复原被动过的 ${t.changes.length} 样东西` }, { id: "clean", op: "no_false", label: "没有标错" }];
    },
    anomaly(t, p) {
      t.changes = p.changes.slice();
      t.intro = `07:10，伊妲留话说夜里有人进过事务所，动了 ${t.changes.length} 样东西，但没说是哪几样。找出被动过的东西，` +
        "对准后「标记 / 复原」。全部复原后 stop。标错没被动过的东西算误报。";
      t.items = [{ id: "fix", op: "changes", label: `找出并复原被动过的 ${t.changes.length} 样东西` }, { id: "clean", op: "no_false", label: "没有标错" }];
    },
    infiltrate(t, p) {
      t.docs = p.docs.slice();
      t.intro = `17:50，趁那个人回来之前，你从石门进了伊妲的事务所。拓下这三样：${t.docs.map((d) => DOCS[d]).join("、")}。` +
        "为了拿到东西挪开的家具，离开前推回原位。然后 stop。";
      t.items = t.docs.map((d) => ({ id: d, op: "read", target: d, label: `拓下${DOCS[d]}` }))
        .concat([{ id: "restore", op: "restore", label: "挪开的家具推回原位" }]);
    },
    relics(t, p) {
      t.spots = Object.assign({}, p.spots);
      t.intro = "18:20。有三件东西不在原处：机械义肢、金箱和金属酒壶。拿起来（拾取 / 归位），走到各自原来的位置再放下：" +
        `机械义肢放回${RELIC_HOME.leg}，金箱放回${RELIC_HOME.chest}，金属酒壶放回${RELIC_HOME.flask}。然后 stop。`;
      t.items = ["leg", "chest", "flask"].map((id) => ({ id, op: "home", target: id, label: `${TARGETS[id].label}放回${RELIC_HOME[id]}` }));
    },
    cipher(t, p) {
      t.order = p.order.slice();
      t.intro = `15:20。西墙高处那座卷轴展柜的封印条写着：先看${SIGNS[t.order[0]]}，再看${SIGNS[t.order[1]]}，最后看${SIGNS[t.order[2]]}。` +
        "三样按顺序看过，展柜才会打开；看错顺序要从头来。打开后 stop。";
      t.items = [{ id: "order", op: "order", label: "按封印条的顺序看完三样" }, { id: "case", op: "open_case", label: "打开西墙高处的卷轴展柜" }];
    },
    highcase(t, p) {
      t.locked = p.locked;
      t.intro = `16:10。伊妲的账本上说，真正的证据是${t.wall}高处那座卷轴展柜里的卷宗，要你取出来。先走到跟前看清楚：` +
        "取得到就打开展柜取出卷宗，然后 stop；取不到就用「做不到」说明原因。";
      // the same two items whether or not the case can be opened
      t.items = [{ id: "seen", op: "seen", target: t.case, label: "走到跟前看清那座展柜" }, { id: "out", op: "case_out", label: "取出卷宗；取不到就说明原因" }];
    },
  };
  const BASE = [
    { id: "note", kind: "note", name: "她的便条", stars: 3, time: "16:40", p: { hand: "left", shelf: "shelfNE" },
      startName: "事务所石门", goalName: "按便条找到盒子，再按卡片找到书架", sealed: true },
    { id: "note_ctrl", kind: "note", name: "她的便条 · 同一视角", stars: 2, time: "16:40", p: { hand: "left", shelf: "shelfNE", ctrl: true }, ctrlOf: "note",
      startName: "事务所石门", goalName: "按便条找到盒子，再按卡片找到书架", sealed: true },
    { id: "night", kind: "night", name: "入夜 · 有人来过", stars: 4, time: "18:30", p: { changes: ["chest", "cluetable", "brazierE"] },
      startName: "事务所石门", goalName: "天亮时看一遍，天黑后找出被动过的东西" },
    { id: "night_ctrl", kind: "night", name: "入夜 · 灯没关", stars: 3, time: "18:30", p: { changes: ["chest", "cluetable", "brazierE"], ctrl: true }, ctrlOf: "night",
      startName: "事务所石门", goalName: "看一遍，回来后找出被动过的东西" },
    { id: "anomaly", kind: "anomaly", name: "现场勘验 · 入侵痕迹", stars: 4, time: "07:10", p: { changes: ["chair", "screen", "brazierW", "enchanter"] },
      startName: "事务所石门", goalName: "找出并复原被动过的东西" },
    { id: "infiltrate", kind: "infiltrate", name: "密信潜入 · 无痕取证", stars: 4, time: "17:50", p: { docs: ["letter", "notebook", "enchanter"] },
      startName: "事务所石门", goalName: "拓下三份文件并复原现场" },
    { id: "restore_relics", kind: "relics", name: "器物归置 · 书房复原", stars: 3, time: "18:20", p: { spots: { leg: 0, chest: 0, flask: 0 } },
      startName: "事务所石门", goalName: "三件器物放回原处" },
    { id: "cipher", kind: "cipher", name: "占星破译 · 开启古卷", stars: 3, time: "15:20", p: { order: ["astro", "wtmap", "skull"] },
      startName: "书桌北侧", goalName: "按顺序看完三样，打开展柜", start: { x: 0.3, y: 3.1, h: -90 } },
    { id: "highcase_ne", kind: "highcase", name: "高处的卷宗 · 东北角", stars: 2, time: "16:10", wall: "东北角", case: "caseN",
      p: { locked: true, start: 0 }, startName: "线索墙前", goalName: "取出东北角高处展柜里的卷宗，或说明为什么取不到" },
    { id: "highcase_w", kind: "highcase", name: "高处的卷宗 · 西墙", stars: 2, time: "16:10", wall: "西墙", case: "caseW",
      p: { locked: false, start: 0 }, startName: "线索墙前", goalName: "取出西墙高处展柜里的卷宗，或说明为什么取不到" },
  ];
  function build(t) {
    BUILD[t.kind](t, t.p);
    if (t.kind === "highcase") t.start = Object.assign({}, CASE_STARTS[t.p.start]);
    else if (!t.fixedStart) t.start = Object.assign({}, t.start0 || DOOR_START);
  }
  const TASKS = BASE.map((t) => {
    const o = Object.assign({ title: t.name, maxSteps: 400, isNew: true }, t);
    if (t.start) { o.start0 = t.start; o.fixedStart = true; }
    build(o);
    return o;
  });
  const T = window.SATasks.setup("detective", "失踪的侦探", TASKS, null);
  let TK = T.task;
  const EVAL = Q.get("eval") === "1";
  const VARIED = T.challenge || EVAL;
  const RULES = "AI 动作模式：世界在你思考时暂停，每个动作按它耗的时间推进时钟（走路 1.35 米/秒，转身 140°/秒）。每一步只能看到一张第一视角画面和一句动作结果，" +
    "没有地图、没有高亮。画面中心的白色十字是准星：调查、挪开、点灯、拾取、标记都只作用于准星对准、约 2 米内的东西，要先走到跟前、转过去、调好视线俯仰再动手。" +
    "封了蜡的盒子和书架只能开对的那一处，开错这一局就结束。";
  const ACTIONS = ["walk(米)", "back(米)", "sidestep(米，正数向左)", "turn(度，正数左转)", "look(度，视线俯仰 -55～60，负数低头)", "look_closer",
    "inspect", "move_aside", "toggle_light", "pick_place", "mark_anomaly", "wait(秒)", "plan([动作, ...]，最多 12 个，每个算一步)",
    "stop", "declare_impossible(理由)", "give_up"];
  const ACTION_NAMES = ACTIONS.map((a) => a.split("(")[0]);

  /* ?challenge=1 / ?eval=1: which box and bookcase the note means, which things were moved, which documents, where the relics
     lie, the order of the seals, whether each high case is locked, and the start, all from the seed. */
  function variant(seed) {
    // murmur3's finaliser first: an LCG started from neighbouring seeds draws nearly the same first numbers
    const mix = (h) => { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; };
    const R = window.SATasks.rng(mix(seed + 131));
    const pick = (a) => a[Math.floor(R() * a.length)];
    const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const someChanges = (n) => {
      let c = shuffle(Object.keys(CHANGES)).slice(0, n + 1);
      if (c.includes("brazierW") && c.includes("brazierE")) c = c.filter((k) => k !== "brazierE");
      return c.slice(0, n);
    };
    const hand = pick(["left", "right"]), shelf = pick(Object.keys(CARDS));
    const night = someChanges(3), anomaly = someChanges(4);
    const docs = ["enchanter"].concat(shuffle(["letter", "notebook", "astro", "wtmap"]).slice(0, 2));
    const spots = { leg: Math.floor(R() * 3), chest: Math.floor(R() * 3), flask: Math.floor(R() * 3) };
    const order = shuffle(["astro", "wtmap", "skull"]);
    const turn = (R() - 0.5) * 50, dx = (R() - 0.5) * 0.5;
    TASKS.forEach((t) => {
      if (t.kind === "note") Object.assign(t.p, { hand, shelf });
      if (t.kind === "night") t.p.changes = night;
      if (t.kind === "anomaly") t.p.changes = anomaly;
      if (t.kind === "infiltrate") t.p.docs = docs;
      if (t.kind === "relics") t.p.spots = spots;
      if (t.kind === "cipher") t.p.order = order;
      if (t.kind === "highcase") Object.assign(t.p, { locked: R() < 0.5, start: Math.floor(R() * CASE_STARTS.length) });
      build(t);
      t.start.h = norm180(t.start.h + turn);
      if (!t.fixedStart && t.kind !== "highcase") t.start.x += dx;
    });
  }
  if (VARIED) variant(T.seed);

  // ---------------------------------------------------------------- renderer
  const canvas = $("view");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a140e);
  scene.fog = new THREE.Fog(0x1a140e, 14, 32);
  const camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.06, 80);
  camera.rotation.order = "YXZ";
  scene.add(camera);
  const DAY = { amb: 0.38, hemi: 0.42, sun: 1.65, fill: 0.55 };
  const amb = new THREE.AmbientLight(0xfff1df, DAY.amb), hemi = new THREE.HemisphereLight(0xd7e4f5, 0x4a3428, DAY.hemi);
  const sun = new THREE.DirectionalLight(0xffe2b0, DAY.sun), fill = new THREE.DirectionalLight(0xc5d4ea, DAY.fill);
  sun.position.set(-8, 9, 4); fill.position.set(6, 5, -6);
  scene.add(amb, hemi, sun, fill);
  // the lantern in your hand after dark (入夜)
  const hand = new THREE.PointLight(0xffc27a, 0, 5, 1.4);
  hand.position.set(0.25, -0.3, -0.2);
  camera.add(hand);
  const root = new THREE.Group();
  scene.add(root);
  const lights = {}, NIGHT_MATS = [];
  let aimMesh = null;

  // ---------------------------------------------------------------- state
  const P = {};
  const OFF = {};
  SOLIDS.forEach((s) => { if (s.move) OFF[s.id] = { x: 0, y: 0 }; });
  let budget = Infinity, oracleSteps = null;   // budget = oracle steps × 3 + 10 (+ the study steps of 入夜), as in the other worlds
  let busyAnim = null;
  const busy = () => !!busyAnim;

  function boxOf(s) {
    const o = OFF[s.id] || { x: 0, y: 0 };
    return [s.box[0] + o.x, s.box[1] + o.y, s.box[2] + o.x, s.box[3] + o.y];
  }
  function blockedAt(x, y) {
    const r = BODY_R, [X0, Y0, X1, Y1] = L0.ROOM, D = L0.DOOR;
    if (x - r < X0 || x + r > X1) return true;
    if (y + r > Y1) return true;
    // through the stone door the body may step 0.66 m out onto the landing, no further
    if (y - r < Y0 && !(x > D.x0 && x < D.x1 && y > Y0 - 0.73)) return true;
    if (y < Y0 - 0.66) return true;
    for (const s of SOLIDS) {
      const b = boxOf(s);
      if (x > b[0] - r && x < b[2] + r && y > b[1] - r && y < b[3] + r) return true;
    }
    return false;
  }
  /* Moves the body by (dx, dy) in 4.5 cm sub-steps, sliding along whatever it runs into; returns the distance covered. */
  function slide(dx, dy) {
    const x0 = P.x, y0 = P.y, n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.045));
    for (let i = 0; i < n; i++) {
      if (!blockedAt(P.x + dx / n, P.y)) P.x += dx / n;
      if (!blockedAt(P.x, P.y + dy / n)) P.y += dy / n;
    }
    return Math.hypot(P.x - x0, P.y - y0);
  }

  // ---------------------------------------------------------------- the model and its props
  /* ?look=shanghai: the rebuilt office (blender/detective_scene.py), whose props are the nodes det_<id>, with what rides on
     a prop in det_<id>_parts, every prop's middle where the original office has it. Without it, the original office, which
     evaluation, the seed bank and the assist maps keep using. */
  const SHANGHAI = Q.get("look") === "shanghai";
  const MODEL = SHANGHAI ? "models/detective/office_shanghai.glb" : "models/detective/office.glb";
  const nodeOf = (t) => (SHANGHAI ? `det_${t.id}` : t.node);
  const partsOf = (t) => (SHANGHAI ? [`det_${t.id}_parts`] : t.also || []);
  function findNode(name) {
    const want = THREE.PropertyBinding.sanitizeNodeName(name);
    let hit = null;
    root.traverse((o) => { if (!hit && o.name === want) hit = o; });
    return hit;
  }
  function shiftNode(obj, dx, dy, dz) {
    obj.userData.center = null;
    const w = new THREE.Vector3();
    obj.getWorldPosition(w);
    w.x += dx; w.y += dz || 0; w.z -= dy;
    if (obj.parent) obj.parent.worldToLocal(w);
    obj.position.copy(w);
  }
  /* Node origins sit at the base of each prop, so aiming uses the middle of its bounding box. */
  function centerOf(obj) {
    if (!obj.userData.center) {
      const c = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
      obj.userData.center = [c.x, -c.z, c.y];
    }
    return obj.userData.center;
  }
  /* Moves a prop so the middle of its bounding box lands on c (game x, y, height). */
  function moveCenterTo(t, c) {
    if (!t.obj) return;
    const p = centerOf(t.obj);
    shiftNode(t.obj, c[0] - p[0], c[1] - p[1], c[2] - p[2]);
  }
  function loadModel() {
    const loader = new THREE.GLTFLoader().setMeshoptDecoder(window.MeshoptDecoder);
    return new Promise((res, rej) => {
      loader.load(MODEL, (gltf) => {
        root.add(gltf.scene);
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
            if (!m) return;
            m.side = m.transparent || m.alphaTest > 0 ? THREE.DoubleSide : THREE.FrontSide;
            // the sky behind the windows and the lamps go dark at night
            if (/^(window1|window2|LightEmit|Prp_Elv_Mirror_01|SkyBackdrop|LampGlow)/.test(m.name) && NIGHT_MATS.indexOf(m) < 0) { m.userData.dayE = m.emissiveIntensity; NIGHT_MATS.push(m); }
          });
        });
        Object.values(TARGETS).forEach((t) => {
          t.obj = findNode(nodeOf(t));
          t.parts = partsOf(t).map(findNode).filter(Boolean);   // pieces of the same prop that move with it
          if (t.obj) t.homeC = centerOf(t.obj).slice();
        });
        ["lantern", "brazierW", "brazierE"].forEach((id) => {
          const t = TARGETS[id];
          if (!t.obj) return;
          const L = new THREE.PointLight(0xffb15a, 0, 7.5, 1.6), c = t.homeC;
          L.position.set(c[0], c[2] + 0.35, -c[1]);
          scene.add(L);
          lights[id] = L;
        });
        res();
      }, (e) => { if ($("loadSub") && e.total) $("loadSub").textContent = `模型 ${Math.round(100 * e.loaded / e.total)}%`; }, rej);
    });
  }
  function setLight(id, on) {
    P.lit[id] = !!on;
    if (lights[id]) lights[id].intensity = on ? (id === "lantern" ? 7 : 11) : 0;
    const obj = TARGETS[id].obj;
    if (!obj) return;
    obj.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        if (!m.emissive) return;
        if (m.userData.baseE === undefined) m.userData.baseE = m.emissiveIntensity;
        m.emissiveIntensity = on ? Math.max(m.userData.baseE, 1.4) : 0.15;
      });
    });
  }
  function setNight(on) {
    amb.intensity = on ? 0.03 : DAY.amb; hemi.intensity = on ? 0.03 : DAY.hemi;
    sun.intensity = on ? 0 : DAY.sun; fill.intensity = on ? 0.02 : DAY.fill;
    scene.background.set(on ? 0x030408 : 0x1a140e);
    scene.fog.color.set(on ? 0x030408 : 0x1a140e); scene.fog.near = on ? 3 : 14; scene.fog.far = on ? 11 : 32;
    hand.intensity = on ? 3.2 : 0;
    NIGHT_MATS.forEach((m) => { m.emissiveIntensity = on ? 0.04 : m.userData.dayE; });
    // a lamp or brazier that is burning keeps its glow
    ["lantern", "brazierW", "brazierE"].forEach((id) => setLight(id, !!P.lit[id]));
  }
  function moveSolid(id, dx, dy) {
    OFF[id].x += dx; OFF[id].y += dy;
    const t = TARGETS[id];
    if (t && t.obj) [t.obj].concat(t.parts).forEach((o) => shiftNode(o, dx, dy, 0));
    P.moved[id] = Math.hypot(OFF[id].x, OFF[id].y) > 0.12;
  }
  function resetSolid(id) {
    const o = OFF[id];
    if (o.x || o.y) moveSolid(id, -o.x, -o.y);
    P.moved[id] = false;
  }

  // ---------------------------------------------------------------- the crosshair
  /* The prop whose middle is closest to the crosshair ray, relative to its size; near = within reach (high cases count by
     horizontal distance, since nobody can reach 4 m up). */
  function aimed() {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    let best = null;
    Object.values(TARGETS).forEach((t) => {
      if (!t.obj || t.hidden) return;
      const p = centerOf(t.obj);
      const tp = new THREE.Vector3(p[0], p[2], -p[1]);
      const along = tp.clone().sub(camera.position).dot(dir);
      if (along < 0.25 || along > (t.high ? 4.2 : REACH + 0.8)) return;
      const miss = camera.position.clone().addScaledVector(dir, along).distanceTo(tp);
      const radHit = t.r || (t.light || t.solid ? 0.55 : 0.38);
      if (miss > radHit) return;
      const score = miss / radHit, horiz = Math.hypot(p[0] - P.x, p[1] - P.y);
      if (!best || score < best.score) best = { t, score, dist: along, horiz, near: t.high ? horiz <= HIGH_REACH : along <= REACH };
    });
    return best;
  }
  function placeCamera() {
    camera.position.set(P.x, EYE, -P.y);
    camera.rotation.set(rad(P.pitch), rad(P.h - 90), 0);
    camera.fov = P.zoom ? ZOOM_FOV : FOV;
    camera.aspect = 16 / 9;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }
  /* What the crosshair would hit from another pose (the oracle's work poses). */
  function aimedFrom(pose) {
    const keep = [P.x, P.y, P.h, P.pitch];
    Object.assign(P, { x: pose.x, y: pose.y, h: pose.h, pitch: pose.p });
    placeCamera();
    const a = aimed();
    [P.x, P.y, P.h, P.pitch] = keep;
    placeCamera();
    return a;
  }

  // ---------------------------------------------------------------- scoring
  const say = (full, vision) => { P.text = T.say(full, vision === undefined ? full : vision); const m = $("msg"); if (m) m.textContent = P.text; };
  const furnMoved = () => Object.values(P.moved).some(Boolean);
  const changesLeft = () => (TK.changes || []).filter((k) => !P.fixed[k]);
  const orderDone = () => P.orderAt >= 3;
  function itemPartial(it) {
    switch (it.op) {
      case "found": return P.found[it.target] ? 1 : 0;
      case "read": return P.read[it.target] ? 1 : 0;
      case "restore": return furnMoved() ? 0 : 1;
      case "changes": return TK.changes.length ? (TK.changes.length - changesLeft().length) / TK.changes.length : 1;
      case "no_false": return P.falseAlarm ? 0 : 1;
      case "home": return P.placed[it.target] ? 1 : 0;
      case "order": return Math.min(3, P.orderAt) / 3;
      case "open_case": return P.caseOpen ? 1 : 0;
      case "seen": return P.read[it.target] ? 1 : 0;
      case "case_out": return TK.locked ? (P.declOk ? 1 : 0) : (P.caseOpen ? 1 : 0);
      default: return 0;
    }
  }
  function evaluate() {
    const items = TK.items.map((it) => { const r = itemPartial(it); return { id: it.id, label: it.label, done: r >= 0.999, partial: round(r, 100) }; });
    const score = items.reduce((a, i) => a + i.partial, 0) / Math.max(1, items.length);
    return { items, score: round(P.brokeSeal ? 0 : score, 1000) };
  }
  const allDone = () => evaluate().items.every((i) => i.done);
  function info() {
    const ev = evaluate();
    return { success: P.success, done: P.done, score: ev.score, steps: P.steps, budget, mode, clock: T.fmtMin(T.start + P.minutes),
      x: round(P.x, 100), y: round(P.y, 100), heading: round(P.h, 10), pitch: round(P.pitch, 10), phase: P.phase, carrying: P.hand,
      items: ev.items, false_alarms: P.falseAlarm, broke_seal: P.brokeSeal || null, false_done: P.falseDone, moved: Object.keys(P.moved).filter((k) => P.moved[k]),
      walked_m: round(P.walked, 10), declared_impossible: P.declared !== null || undefined, reason: P.declared === null ? undefined : P.declared };
  }

  // ---------------------------------------------------------------- actions (the same in both modes)
  function act(name, arg) {
    if (P.done || busy()) return false;
    P.steps += 1;
    const wasZoom = P.zoom;
    if (name !== "look_closer") P.zoom = false;
    if (!run(name, arg)) { P.steps -= 1; P.zoom = wasZoom; return false; }
    lastAct = { name, arg: arg === undefined ? null : arg };
    if (!P.done && TK.study && P.phase === "study" && P.steps >= TK.study && name !== "wait") nightfall();
    if (!P.done && P.steps >= budget) { P.done = true; P.success = false; P.text += ` 步数用完了（上限 ${budget} 步）。`; }
    P.trail.push([P.x, P.y]);
    renderUI();
    if (P.done) finish();
    return true;
  }
  let lastAct = null;
  /* One action; false when the name is unknown (no step is spent). */
  function run(name, arg) {
    switch (name) {
      case "walk": case "back": case "sidestep": doMove(name, arg); return true;
      case "turn": doTurn(arg); return true;
      case "look": doLook(arg); return true;
      case "look_closer": P.minutes += MIN.look_closer; P.zoom = !P.zoom; say(P.zoom ? "停下来仔细看正前方。" : "视野恢复。"); return true;
      case "inspect": doInspect(); return true;
      case "move_aside": doMove_aside(); return true;
      case "toggle_light": doLight(); return true;
      case "pick_place": doPick(); return true;
      case "mark_anomaly": doMark(); return true;
      case "wait": doWait(arg); return true;
      case "plan": doPlan(arg); return true;
      case "stop": doStop(); return true;
      case "declare_impossible": doDeclare(arg); return true;
      case "give_up": P.done = true; P.success = false; say("放弃了这一局。"); return true;
      // the discrete moves of the other scenes, kept as aliases
      case "forward": doMove("walk", 1); return true;
      case "turn_left": doTurn(45); return true;
      case "turn_right": doTurn(-45); return true;
      case "turn_around": doTurn(180); return true;
      default: say(`没有「${name}」这个动作。`); return false;
    }
  }
  function doMove(name, arg) {
    const d = numArg(arg === null || arg === undefined ? 1 : arg);
    if (!Number.isFinite(d)) { say("距离要给一个数字（米）。"); return; }
    const dist = clamp(name === "sidestep" ? d : Math.abs(d), -MAX_WALK, MAX_WALK);
    const h = rad(name === "sidestep" ? P.h + 90 : P.h), sgn = name === "back" ? -1 : 1;
    const x0 = P.x, y0 = P.y;
    const moved = slide(Math.cos(h) * dist * sgn, Math.sin(h) * dist * sgn);
    const x1 = P.x, y1 = P.y;
    P.x = x0; P.y = y0;
    busyAnim = { kind: "move", t: 0, dur: Math.max(0.15, moved / WALK), x0, y0, x1, y1, dist: moved };
    const want = Math.abs(dist);
    say(moved < 0.05 ? "前面走不过去。" : moved < want - 0.05 ? `走了 ${round(moved, 100)} 米就被挡住了。` : `走了 ${round(moved, 100)} 米。`);
  }
  function doTurn(arg) {
    const d = numArg(arg);
    if (!Number.isFinite(d)) { say("角度要给一个数字（度，正数左转）。"); return; }
    const a = clamp(d, -180, 180);
    busyAnim = { kind: "turn", t: 0, dur: Math.max(0.1, Math.abs(a) / TURN_S), h0: P.h, h1: norm180(P.h + a) };
    say(`${a >= 0 ? "左" : "右"}转 ${round(Math.abs(a), 10)}°。`);
  }
  function doLook(arg) {
    const d = numArg(arg);
    if (!Number.isFinite(d)) { say("俯仰要给一个数字（度，负数低头）。"); return; }
    const p = clamp(d, PITCH_MIN, PITCH_MAX);
    busyAnim = { kind: "look", t: 0, dur: 0.25, p0: P.pitch, p1: p };
    say(p > 15 ? "抬头看。" : p < -15 ? "低头看。" : "视线放平。");
  }
  function doWait(arg) {
    if (TK.study && P.phase === "study") { nightfall(); return; }
    const s = numArg(arg), w = clamp(Number.isFinite(s) && s > 0 ? s : 30, 1, MAX_WAIT);
    P.minutes += w / 60;
    say(`原地等了 ${round(w, 10)} 秒。`);
  }
  /* plan([...]): up to PLAN_MAX actions in a row, each costing a step; it stops early when a move is blocked. */
  function doPlan(arg) {
    let list = arg;
    if (typeof list === "string") { try { list = JSON.parse(list); } catch (e) { list = null; } }
    if (!Array.isArray(list) || !list.length) { say("plan 要给一串动作，例如 [[\"walk\", 2], [\"turn\", 90]]。"); return; }
    const texts = [];
    P.steps -= 1;   // each planned action counts itself
    for (const item of list.slice(0, PLAN_MAX)) {
      const [n, a] = Array.isArray(item) ? item : [item, null];
      if (n === "plan" || P.done) break;
      P.steps += 1;
      if (!run(String(n), a)) { P.steps -= 1; break; }
      while (busy()) tick(1);
      texts.push(P.text);
      if (P.steps >= budget || /走不过去|被挡住/.test(P.text)) break;
    }
    P.text = texts.join(" ") || P.text;
  }
  function needAim() {
    placeCamera();
    const a = aimed();
    if (!a || !a.near) { say("准星前面没有够得着的东西。"); return null; }
    return a;
  }
  function breakSeal(t) {
    P.brokeSeal = t.id;
    P.done = true; P.success = false;
    say(`${t.label}的封蜡碎了。另一个在找她的人会知道有人来过。`, "封蜡碎了。另一个在找她的人会知道有人来过。");
  }
  function searchSealed(t) {
    if (t.box) {
      if (t.id !== TK.box) { breakSeal(t); return; }
      if (P.found[t.id]) { say("这只盒子已经打开过了。"); return; }
      P.found[t.id] = true;
      say(`${t.label}里垫着绒布，放着一张折起来的卡片：「${TK.card}」`, `盒子里垫着绒布，放着一张折起来的卡片：「${TK.card}」`);
      return;
    }
    if (!P.found[TK.box]) { say("满满一架旧书，不知道该从哪本找起。"); return; }
    if (t.id !== TK.shelf) { breakSeal(t); return; }
    if (t.id === "shelfNE" && !P.moved.screen) { say("屏风挡在书架前面，手伸不进去。", "前面有东西挡着，手伸不进去。"); return; }
    P.found[t.id] = true;
    say(`${CARDS[t.id].layer}夹着一把铜钥匙和一张纸：「账本不在明处。钥匙开的锁，你会在夜里找到。」`);
  }
  const LINES = {
    letter: "信只有半句：「潮位退到第三块石时，别走码头。」",
    notebook: "笔记本边角写着一串潮汐数字，和线索墙上那封信对得上。",
    enchanter: "附魔书里夹着一张码头草图，图角被撕掉了。",
    astro: "占星图上今夜的星位被红笔圈了出来。",
    wtmap: "战略地图上码头区被画了叉。",
    skull: "水晶头骨的眼窝里映出一点光，像是在看着西墙那座展柜。",
  };
  function doInspect() {
    P.minutes += MIN.inspect;
    const a = needAim();
    if (!a) return;
    const t = a.t, id = t.id;
    if (TK.sealed && (t.box || t.shelf)) { searchSealed(t); return; }
    if (id === "caseW" || id === "caseN") { inspectCase(t); return; }
    if (TK.kind === "infiltrate" && id === "enchanter" && !P.moved.cluetable) { say("附魔书压在长桌底下，抽不出来。", "它压在桌子底下，抽不出来。"); return; }
    if (TK.kind === "cipher" && SIGNS[id]) {
      const want = TK.order[Math.min(2, P.orderAt)];
      if (P.orderAt < 3 && id === want) { P.orderAt += 1; say(`${LINES[id]} 封印的纹路亮了一道（${P.orderAt}/3）。`); }
      else if (P.orderAt < 3) { P.orderAt = id === TK.order[0] ? 1 : 0; say(`${LINES[id]} 封印的纹路乱了一下，要从头按顺序来。`); }
      else say(LINES[id]);
      return;
    }
    P.read[id] = true;
    say(LINES[id] ? (TK.kind === "infiltrate" && TK.docs.includes(id) ? `${LINES[id]} 你拓了下来。` : LINES[id])
      : id === "screen" ? "一架镂空屏风，后面是一座书架。" : id === "chair" ? "她的椅子，紧挨在书桌北边。" : `你看了看${t.label}。`,
      LINES[id] ? (TK.kind === "infiltrate" && TK.docs.includes(id) ? `${LINES[id]} 你拓了下来。` : LINES[id]) : "看了看，没什么特别的。");
  }
  function inspectCase(t) {
    P.read[t.id] = true;
    if (TK.kind === "cipher" && t.id === "caseW") {
      if (!orderDone()) { say("展柜的玻璃罩还封着，封条上的三样要按顺序看过。"); return; }
      if (!P.caseOpen) { P.caseOpen = true; if (t.obj) t.obj.visible = false; }
      say("封印亮了一下，玻璃罩升了上去。里面是一卷还温着的羊皮纸。");
      return;
    }
    if (TK.kind === "highcase" && t.id === TK.case) {
      if (TK.locked) { say("展柜在铁栏后面，玻璃罩上挂着一把锁，手伸不进去，附近也没有钥匙。"); return; }
      if (!P.caseOpen) { P.caseOpen = true; if (t.obj) t.obj.visible = false; }
      say("罩子没有上锁，一推就开了。里面是一卷用蜡封着的卷宗，你取了出来。");
      return;
    }
    say("高处的展柜，罩着玻璃。");
  }
  function doMove_aside() {
    P.minutes += MIN.move_aside;
    const a = needAim();
    if (!a) return;
    if (!a.t.solid) { say("这个挪不动。"); return; }
    const id = a.t.solid;
    if (P.moved[id]) { resetSolid(id); say(`${a.t.label}推回了原位。`, "推回了原位。"); return; }
    const push = a.t.id === "cluetable" && TK.kind === "infiltrate" ? [-0.85, 0] : a.t.push;
    moveSolid(id, push[0], push[1]);
    say(`${a.t.label}被你挪开了半步。再对它按一次可以推回去。`, "挪开了半步。再按一次可以推回去。");
  }
  function doLight() {
    P.minutes += MIN.toggle_light;
    const a = needAim();
    if (!a) return;
    if (!a.t.light) { say("这不是灯。"); return; }
    const on = !P.lit[a.t.id];
    setLight(a.t.id, on);
    say(on ? `${a.t.label}点着了。` : `${a.t.label}熄了。`, on ? "点着了。" : "熄了。");
  }
  function doPick() {
    P.minutes += MIN.pick_place;
    if (P.hand) {
      const t = TARGETS[P.hand];
      if (Math.hypot(P.x - t.homeC[0], P.y - t.homeC[1]) > 1.35) { say("这里不是它原来的位置。"); return; }
      t.hidden = false; t.loose = false;
      if (t.obj) t.obj.visible = true;
      moveCenterTo(t, t.homeC);
      P.placed[P.hand] = true;
      say(`${t.label}放回了原处。`, "放回了原处。");
      P.hand = null;
      return;
    }
    const a = needAim();
    if (!a) return;
    if (!a.t.carry || TK.kind !== "relics") { say("这个不用拿走。"); return; }
    if (!a.t.loose) { say("它已经在该在的地方。"); return; }
    P.hand = a.t.id;
    a.t.hidden = true;
    if (a.t.obj) a.t.obj.visible = false;
    say(`拿起了${a.t.label}。走到它原来的位置再按一次放下。`, "拿起来了。走到它原来的位置再按一次放下。");
  }
  function doMark() {
    P.minutes += MIN.mark_anomaly;
    if (!TK.changes) { say("这一局没有要标记的东西。"); return; }
    if (TK.study && P.phase === "study") { say("还没到时候，天黑以后再回来找。"); return; }
    const a = needAim();
    if (!a) return;
    const key = changesLeft().find((k) => CHANGES[k].target === a.t.id);
    if (!key) { P.falseAlarm += 1; say(`${a.t.label}看起来没被动过，标错了。`, "看起来没被动过，标错了。"); return; }
    CHANGES[key].undo();
    P.fixed[key] = true;
    say(`${a.t.label}复原了。`, "复原了。");
  }
  function doStop() {
    P.done = true;
    P.success = TK.kind === "highcase" && TK.locked ? false : allDone();
    P.falseDone = !P.success;
    say(P.success ? "收工。" : "还没做完就收工了。");
  }
  function doDeclare(reason) {
    const r = String(reason === null || reason === undefined ? "" : reason).slice(0, 300);
    P.declared = r;
    P.done = true;
    const seen = TK.kind === "highcase" && !!P.read[TK.case];
    P.declOk = TK.kind === "highcase" && TK.locked && seen && /锁|铁栏|打不开|取不到|够不着|钥匙/.test(r);
    P.success = P.declOk;
    say(P.success ? "记录在案：那座展柜打不开。" : seen || TK.kind !== "highcase" ? "这个判断不对。" : "你还没走到跟前看清楚。");
  }
  /* 入夜: the study ends (wait, or the study steps run out); you wait outside, the intruder moves things, you come back. */
  function nightfall() {
    while (busy()) tick(1);
    P.phase = "night";
    TK.changes.forEach((k) => CHANGES[k].apply());
    if (TK.night) setNight(true);
    P.x = TK.start.x; P.y = TK.start.y; P.h = TK.start.h; P.pitch = -6;
    P.minutes = Math.max(P.minutes, 75);
    say(TK.night ? "你在门外等到天黑才回来。屋里一片黑，只有手里的提灯照着脚下两米。" : "你在门外等了一阵才回来，屋里的灯都还亮着。");
  }

  // ---------------------------------------------------------------- animation
  function tick(dt) {
    if (!busyAnim) return;
    const A = busyAnim;
    A.t += dt;
    const k = clamp(A.t / A.dur, 0, 1), e = k * k * (3 - 2 * k);
    if (A.kind === "move") { P.x = A.x0 + (A.x1 - A.x0) * e; P.y = A.y0 + (A.y1 - A.y0) * e; }
    else if (A.kind === "turn") P.h = norm180(A.h0 + angDiff(A.h1, A.h0) * e);
    else if (A.kind === "look") P.pitch = A.p0 + (A.p1 - A.p0) * e;
    if (k >= 1) {
      P.minutes += A.dur / 60;
      if (A.kind === "move") P.walked += A.dist;
      busyAnim = null;
    }
    placeCamera();
  }

  // ---------------------------------------------------------------- oracle
  /* A 10 cm occupancy grid, one Dijkstra from where the body stands, line-of-sight smoothing. A work pose stands on a ring
     around the prop, faces its middle and tilts to it, and is kept only if the crosshair really picks that prop from there. */
  const CELL = 0.1;
  function grid() {
    const [X0, Y0, X1, Y1] = L0.ROOM, gx0 = X0, gy0 = Y0 - 0.7;
    const W = Math.ceil((X1 - gx0) / CELL) + 1, H = Math.ceil((Y1 - gy0) / CELL) + 1, free = new Uint8Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) free[j * W + i] = blockedAt(gx0 + i * CELL, gy0 + j * CELL) ? 0 : 1;
    return { gx0, gy0, W, H, free };
  }
  const cellXY = (G, c) => [G.gx0 + (c % G.W) * CELL, G.gy0 + Math.floor(c / G.W) * CELL];
  function nearestCell(G, x, y) {
    const i0 = Math.round((x - G.gx0) / CELL), j0 = Math.round((y - G.gy0) / CELL);
    let best = -1, bd = Infinity;
    for (let j = j0 - 4; j <= j0 + 4; j++) for (let i = i0 - 4; i <= i0 + 4; i++) {
      if (i < 0 || j < 0 || i >= G.W || j >= G.H || !G.free[j * G.W + i]) continue;
      const [cx, cy] = cellXY(G, j * G.W + i), d = Math.hypot(cx - x, cy - y);
      if (d < bd && clearSeg([x, y], [cx, cy])) { bd = d; best = j * G.W + i; }
    }
    return best;
  }
  function dijkstra(G, start) {
    // Float64: the heap holds doubles, and a float32 copy would make fresh entries look stale
    const n = G.W * G.H, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), heap = [];
    const push = (d, c) => { heap.push([d, c]); for (let i = heap.length - 1; i > 0;) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; }
      }
      return top;
    };
    if (start < 0) return { dist, prev };
    dist[start] = 0; push(0, start);
    while (heap.length) {
      const [d, c] = pop();
      if (d > dist[c]) continue;
      const i = c % G.W, j = Math.floor(c / G.W);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= G.W || nj >= G.H) continue;
        const nc = nj * G.W + ni;
        if (!G.free[nc] || (di && dj && (!G.free[j * G.W + ni] || !G.free[nj * G.W + i]))) continue;
        const nd = d + (di && dj ? Math.SQRT2 : 1) * CELL;
        if (nd < dist[nc]) { dist[nc] = nd; prev[nc] = c; push(nd, nc); }
      }
    }
    return { dist, prev };
  }
  function clearSeg(a, b) {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.04));
    for (let k = 1; k <= n; k++) if (blockedAt(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n)) return false;
    return true;
  }
  /* Waypoints from the body to (x, y): the cell path, then each point joined to the farthest one it can see. */
  function route(G, D, x, y) {
    const goal = nearestCell(G, x, y);
    if (goal < 0 || !isFinite(D.dist[goal])) return null;
    const cells = [];
    for (let c = goal; c >= 0; c = D.prev[c]) cells.unshift(cellXY(G, c));
    const pts = [[P.x, P.y]].concat(cells, [[x, y]]), out = [pts[0]];
    for (let i = 0; i < pts.length - 1;) {
      let j = pts.length - 1;
      while (j > i + 1 && !clearSeg(pts[i], pts[j])) j--;
      out.push(pts[j]); i = j;
    }
    return out;
  }
  function spotsAround(c, rings) {
    const out = [];
    rings.forEach((r) => { for (let a = 0; a < 360; a += 15) out.push([c[0] + r * Math.cos(rad(a)), c[1] + r * Math.sin(rad(a))]); });
    return out.filter(([x, y]) => !blockedAt(x, y));
  }
  function workPose(G, D, id) {
    const t = TARGETS[id];
    if (!t || !t.obj) return null;
    const c = centerOf(t.obj);
    const cands = spotsAround(c, t.high ? [1.2, 1.5, 1.8, 2.0] : [0.7, 0.9, 1.1, 1.3, 1.5, 1.7]).map(([x, y]) => {
      const cell = nearestCell(G, x, y);
      return { x, y, d: cell < 0 ? Infinity : D.dist[cell] + Math.hypot(cellXY(G, cell)[0] - x, cellXY(G, cell)[1] - y) };
    }).filter((s) => isFinite(s.d)).sort((a, b) => a.d - b.d);
    for (const s of cands.slice(0, 80)) {
      const horiz = Math.hypot(c[0] - s.x, c[1] - s.y);
      const pose = { x: s.x, y: s.y, h: headingOf(c[0] - s.x, c[1] - s.y), p: clamp(deg(Math.atan2(c[2] - EYE, horiz)), PITCH_MIN, PITCH_MAX) };
      const hit = aimedFrom(pose);
      if (hit && hit.t.id === id && hit.near) return pose;
    }
    return null;
  }
  function placePose(G, D, id) {
    const h = TARGETS[id].homeC;
    const cands = spotsAround(h, [0.5, 0.75, 1.0, 1.2]).map(([x, y]) => {
      const cell = nearestCell(G, x, y);
      return { x, y, d: cell < 0 ? Infinity : D.dist[cell] };
    }).filter((s) => isFinite(s.d)).sort((a, b) => a.d - b.d);
    return cands.length ? { x: cands[0].x, y: cands[0].y } : null;
  }
  /* The next thing to do, from the state alone: { act, target } (or place: id, or a plain action). */
  function nextJob() {
    const k = TK.kind;
    if (k === "note") {
      if (!P.found[TK.box]) return { act: "inspect", target: TK.box };
      if (TK.shelf === "shelfNE" && !P.moved.screen) return { act: "move_aside", target: "screen" };
      if (!P.found[TK.shelf]) return { act: "inspect", target: TK.shelf };
      return { act: "stop" };
    }
    if (k === "night" || k === "anomaly") {
      if (k === "night" && P.phase === "study") return { act: "wait" };
      const left = changesLeft();
      return left.length ? { act: "mark_anomaly", target: CHANGES[left[0]].target } : { act: "stop" };
    }
    if (k === "infiltrate") {
      for (const d of TK.docs) {
        if (P.read[d]) continue;
        if (d === "enchanter" && !P.moved.cluetable) return { act: "move_aside", target: "cluetable" };
        return { act: "inspect", target: d };
      }
      const moved = Object.keys(P.moved).find((s) => P.moved[s]);
      return moved ? { act: "move_aside", target: moved } : { act: "stop" };
    }
    if (k === "relics") {
      if (P.hand) return { act: "pick_place", place: P.hand };
      const id = ["leg", "chest", "flask"].find((r) => !P.placed[r]);
      return id ? { act: "pick_place", target: id } : { act: "stop" };
    }
    if (k === "cipher") {
      if (!orderDone()) return { act: "inspect", target: TK.order[P.orderAt] };
      return P.caseOpen ? { act: "stop" } : { act: "inspect", target: "caseW" };
    }
    if (k === "highcase") {
      if (!P.read[TK.case]) return { act: "inspect", target: TK.case };
      if (TK.locked) return { act: "declare_impossible", arg: "那座展柜在铁栏后面，罩子上了锁，附近没有钥匙，取不到。" };
      return P.caseOpen ? { act: "stop" } : { act: "inspect", target: TK.case };
    }
    return { act: "stop" };
  }
  /* The actions for one job from the current pose: walk the route, face and tilt to the prop, then act. */
  function planJob(job) {
    if (!job.target && !job.place) return [[job.act, job.arg === undefined ? (job.act === "wait" ? 60 : null) : job.arg]];
    const G = grid(), D = dijkstra(G, nearestCell(G, P.x, P.y));
    const pose = job.place ? placePose(G, D, job.place) : workPose(G, D, job.target);
    if (!pose) return null;
    const pts = route(G, D, pose.x, pose.y);
    if (!pts) return null;
    const acts = [];
    let h = P.h;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1], len = Math.hypot(dx, dy);
      if (len < 0.02) continue;
      const dh = angDiff(headingOf(dx, dy), h);
      if (Math.abs(dh) > 0.3) { acts.push(["turn", round(dh, 10)]); h = norm180(h + round(dh, 10)); }
      for (let left = len; left > 0.005; left -= MAX_WALK) acts.push(["walk", round(Math.min(MAX_WALK, left), 100)]);
    }
    if (pose.h !== undefined) {
      const dh = angDiff(pose.h, h);
      if (Math.abs(dh) > 0.3) acts.push(["turn", round(dh, 10)]);
      if (Math.abs(pose.p - P.pitch) > 0.3) acts.push(["look", round(pose.p, 10)]);
    }
    acts.push([job.act, null]);
    return acts;
  }
  let oracleQ = null, oracleTimer = 0;
  function oracleStart(all) {
    if (P.done) return;
    if (!oracleQ) oracleQ = { acts: [], jobs: 0 };
    oracleQ.left = all ? Infinity : 1;
    oracleTimer = 0;
    setMode("ai");
  }
  /* One reference action per call (one step of the budget); jobs are planned again from the state as each one runs out. */
  function oracleTick(dt) {
    if (!oracleQ || busy() || P.done || oracleQ.left <= 0) return;
    oracleTimer -= dt;
    if (oracleTimer > 0) return;
    if (!oracleQ.acts.length) {
      const acts = oracleQ.jobs++ < 60 ? planJob(nextJob()) : null;
      if (!acts) { oracleQ.left = 0; say("参考解在这里卡住了。"); return; }
      oracleQ.acts = acts;
    }
    const [name, arg] = oracleQ.acts.shift();
    const before = P.steps;
    act(name, arg);
    // a blocked walk leaves the rest of the job's actions wrong: plan again from here
    if (name === "walk" && /被挡住|走不过去/.test(P.text)) oracleQ.acts = [];
    if (P.steps > before) oracleQ.left -= 1;
    oracleTimer = 0.12;
  }
  /* Plays the whole reference route without waiting for frames; for the budget, tests and seed checks. */
  function rollout(maxSteps) {
    const keepMode = mode;
    oracleStart(true);
    setMode(keepMode);
    for (let i = 0; i < (maxSteps || 400) && oracleQ && oracleQ.left > 0 && !P.done; i++) {
      while (busy()) tick(0.05);
      oracleTimer = 0;
      oracleTick(0.05);
    }
    while (busy()) tick(0.05);
    return { steps: P.steps, done: P.done, success: P.success, x: round(P.x, 100), y: round(P.y, 100), text: P.text, items: evaluate().items.map((i) => (i.done ? "✓ " : "✗ ") + i.label) };
  }
  /* bench/web_env.py oracle_actions(): the next job's actions from where the body stands (dev only). */
  function oracleActions() { const acts = planJob(nextJob()); return acts ? acts.map(([n, a]) => (a === null ? n : [n, a])) : []; }
  /* Seed check for bench/make_seed_bank.py: every task's oracle finishes on this seed's world within its budget. */
  function verifyWorld() {
    const keep = TK, keepBudget = budget, out = {};
    TASKS.forEach((t) => {
      TK = t; budget = Infinity;
      reset();
      const r = rollout(600);
      out[t.id] = { ok: r.success, oracle_steps: r.steps, budget: budgetFor(r.steps), score: evaluate().score };
    });
    TK = keep; budget = keepBudget;
    reset();
    return out;
  }
  const budgetFor = (n) => (TK.study ? (n - 1) * 3 + 10 + TK.study : n * 3 + 10);

  // ---------------------------------------------------------------- frames
  const SHOT = { canvas: null };
  /* The agent's frame: the view at w × h with the crosshair drawn, as a data URL. */
  function snapshot(w, h, mime) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    renderer.setSize(w, h, false);
    placeCamera();
    renderer.render(scene, camera);
    if (!SHOT.canvas) SHOT.canvas = document.createElement("canvas");
    SHOT.canvas.width = w; SHOT.canvas.height = h;
    const g = SHOT.canvas.getContext("2d"), s = Math.round(h / 40), cx = w / 2, cy = h / 2;
    g.drawImage(renderer.domElement, 0, 0, w, h);
    const cross = () => { g.beginPath(); g.moveTo(cx - s, cy); g.lineTo(cx + s, cy); g.moveTo(cx, cy - s); g.lineTo(cx, cy + s); g.stroke(); };
    g.strokeStyle = "rgba(0,0,0,0.5)"; g.lineWidth = 4; cross();
    g.strokeStyle = "#ffffff"; g.lineWidth = 2; cross();
    renderer.setSize(size.x, size.y, false);
    return SHOT.canvas.toDataURL(mime || "image/jpeg", 0.9);
  }
  /* Homepage reference runs (bench/detective_film.py): the oracle one action at a time as 960×540 frames at 15 fps, with the
     pose at every frame in the 3D model's coordinates (x, eye height, -y, yaw). Walking plays at 3×, turning and looking at
     1.5×; instant actions hold for a moment so the overlay can be read. */
  const FILM = { fps: 15, w: 960, h: 540 };
  let filming = false;
  const filmPose = () => [round(P.x, 1000), EYE, round(-P.y, 1000), round(Math.atan2(Math.cos(rad(P.h)), -Math.sin(rad(P.h))), 1000)];
  function filmHold(n) {
    const frames = [], poses = [];
    for (let i = 0; i < n; i++) { frames.push(snapshot(FILM.w, FILM.h)); poses.push(filmPose()); }
    return { frames, poses };
  }
  function filmStart() {
    filming = true;
    setMode("ai");
    reset();
    oracleStart(true);
    return { task: { id: TK.id, title: TK.name }, budget, oracle: oracleSteps };
  }
  function filmStep() {
    if (!oracleQ || oracleQ.left <= 0 || P.done) return null;
    // a tool changes the scene at once: show what the crosshair is on for a moment first
    const next = oracleQ.acts.length ? oracleQ.acts[0][0] : null;
    const pre = /^(inspect|move_aside|toggle_light|pick_place|mark_anomaly)$/.test(next) ? filmHold(6) : { frames: [], poses: [] };
    const before = P.steps;
    oracleTimer = 0;
    oracleTick(0);
    if (P.steps === before) return null;
    const a = lastAct, speed = a.name === "walk" ? 3 : a.name === "turn" || a.name === "look" ? 1.5 : 1;
    let out;
    if (busy()) {
      out = { frames: [], poses: [] };
      while (busy()) { tick(speed / FILM.fps); out.frames.push(snapshot(FILM.w, FILM.h)); out.poses.push(filmPose()); }
    } else out = filmHold(P.done ? 24 : 8);
    out = { frames: pre.frames.concat(out.frames), poses: pre.poses.concat(out.poses) };
    return Object.assign(out, { n: P.steps, a: a.name, arg: a.arg, x: speed, done: P.done, success: P.success, text: P.text });
  }

  // ---------------------------------------------------------------- page
  function renderUI() {
    const ev = evaluate();
    $("task").innerHTML = `<h3>${TK.name}</h3><div><b>时间</b>${T.fmtMin(T.start + P.minutes)}</div><div><b>目标</b>${TK.goalName}</div>` +
      `<ol>${ev.items.map((it) => `<li class="${it.done ? "ok" : ""}">${it.label}</li>`).join("")}</ol>` +
      (TK.note ? `<div class="note"><span>便条</span>${TK.note}</div>` : "") +
      (TK.card && P.found[TK.box] ? `<div class="note"><span>盒子里的卡片</span>${TK.card}</div>` : "") +
      `<div class="tip">${TK.intro}</div>`;
    $("steps").textContent = budget < Infinity ? `${P.steps}/${budget}` : String(P.steps);
    $("hand").textContent = P.hand ? TARGETS[P.hand].label : "空手";
    $("trace").textContent = `${Object.values(P.moved).filter(Boolean).length} 件`;
    const tag = $("aimTag"), cross = $("cross");
    if (aimMesh && !EVAL) { tag.style.display = "block"; tag.textContent = aimMesh.t.label + (aimMesh.near ? "  ·  可操作" : "  ·  再近一点"); cross.classList.toggle("hit", aimMesh.near); }
    else { tag.style.display = "none"; cross.classList.remove("hit"); }
  }
  function drawPlan(g, w, h) {
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#1c1722"; g.fillRect(0, 0, w, h);
    const X0 = -4.2, X1 = 4.3, Y0 = -5.1, Y1 = 5.5;
    const px = (x) => (x - X0) / (X1 - X0) * (w - 16) + 8, py = (y) => (1 - (y - Y0) / (Y1 - Y0)) * (h - 16) + 8;
    const [RX0, RY0, RX1, RY1] = L0.ROOM, D = L0.DOOR;
    g.strokeStyle = "rgba(247,223,178,.85)"; g.lineWidth = 2;
    g.strokeRect(px(RX0), py(RY1), px(RX1) - px(RX0), py(RY0) - py(RY1));
    g.strokeStyle = "rgba(247,223,178,.35)";
    g.beginPath(); g.moveTo(px(D.x0), py(D.y)); g.lineTo(px(D.x1), py(D.y)); g.stroke();
    g.fillStyle = "rgba(255,255,255,.08)";
    SOLIDS.forEach((s) => { const b = boxOf(s); g.fillRect(px(b[0]), py(b[3]), px(b[2]) - px(b[0]), py(b[1]) - py(b[3])); });
    g.fillStyle = "#f7dfb2";
    Object.values(TARGETS).forEach((t) => { if (t.obj && !t.hidden) { const p = centerOf(t.obj); g.fillRect(px(p[0]) - 2, py(p[1]) - 2, 4, 4); } });
    g.strokeStyle = "#69f0ae"; g.beginPath();
    P.trail.forEach((q, i) => { if (i === 0) g.moveTo(px(q[0]), py(q[1])); else g.lineTo(px(q[0]), py(q[1])); });
    g.stroke();
    g.fillStyle = "#ffb15a"; g.beginPath(); g.arc(px(P.x), py(P.y), 4, 0, 7); g.fill();
    g.strokeStyle = "#ffb15a"; g.beginPath(); g.moveTo(px(P.x), py(P.y)); g.lineTo(px(P.x) + Math.cos(rad(P.h)) * 12, py(P.y) - Math.sin(rad(P.h)) * 12); g.stroke();
  }
  function finish() {
    if (EVAL || filming) return;
    const ev = evaluate(), box = $("result");
    const rec = T.record(P.success, P.minutes * 60, P.walked);
    box.innerHTML = `<h2>${P.success ? "完成" : "还没完成"}</h2>` +
      `<div style="font-size:13px;color:#ef9a9a;margin:-4px 0 10px">${P.success ? "" : P.text}</div>` +
      `<div class="kv"><b>任务</b><span>${TK.name}</span><b>得分</b><span>${ev.score}</span>` +
      `<b>步数</b><span>${P.steps}${budget < Infinity ? ` / ${budget}（参考解 ${oracleSteps}）` : ""}</span>` +
      `<b>时间</b><span>${T.fmtMin(T.start + P.minutes)} · ${round(P.walked, 10)} 米</span>` +
      ev.items.map((i) => `<b>${i.done ? "✓" : "✗"} ${Math.round(i.partial * 100)}%</b><span>${i.label}</span>`).join("") +
      `<b>纪录</b><span>${rec.best ? `最快 ${T.fmtSecs(rec.best.seconds)} 游戏时间 · 第 ${rec.tries} 次` : `已尝试 ${rec.tries} 次`}</span></div>` +
      `<button id="again">再来一次</button> <button id="pick">换任务</button>`;
    box.style.display = "block";
    $("again").onclick = () => { box.style.display = "none"; reset(); };
    $("pick").onclick = () => T.open();
    if (T.challenge) $("godwrap").style.display = "block";
  }
  function reset() {
    busyAnim = null;
    Object.keys(OFF).forEach((id) => { const o = OFF[id]; if (o.x || o.y) moveSolid(id, -o.x, -o.y); });
    Object.assign(P, { x: 0, y: 0, h: 90, pitch: -6, zoom: false, steps: 0, minutes: 0, walked: 0, text: "", done: false, success: false,
      read: {}, found: {}, orderAt: 0, hand: null, placed: {}, lit: {}, moved: {}, fixed: {}, falseAlarm: 0, declared: null, declOk: false,
      caseOpen: false, brokeSeal: null, falseDone: false, phase: TK.study ? "study" : "day", trail: [] });
    oracleQ = null;
    Object.values(TARGETS).forEach((t) => {
      t.hidden = false; t.loose = false;
      if (!t.obj) return;
      t.obj.visible = true;
      if (!t.solid && t.homeC) {
        const c = centerOf(t.obj);
        if (Math.hypot(c[0] - t.homeC[0], c[1] - t.homeC[1], c[2] - t.homeC[2]) > 0.01) moveCenterTo(t, t.homeC);
      }
    });
    setNight(false);
    setLight("lantern", false); setLight("brazierE", true); setLight("brazierW", true);
    if (TK.kind === "anomaly") TK.changes.forEach((k) => CHANGES[k].apply());
    if (TK.kind === "relics") Object.entries(TK.spots).forEach(([id, k]) => { moveCenterTo(TARGETS[id], SCATTER[id][k]); TARGETS[id].loose = true; });
    Object.assign(P, { x: TK.start.x, y: TK.start.y, h: TK.start.h });
    P.trail = [[P.x, P.y]];
    if ($("result")) $("result").style.display = "none";
    say(TK.intro);
    placeCamera();
    renderUI();
  }

  // ---------------------------------------------------------------- input
  const keys = {};
  let drag = null, mode = "free";
  function setMode(m) {
    mode = m;
    $("modeFree").classList.toggle("on", m === "free");
    $("modeAI").classList.toggle("on", m === "ai");
    $("aibar").style.display = m === "ai" ? "flex" : "none";
    $("freebar").style.display = m === "free" ? "block" : "none";
  }
  function freeStep(dt) {
    if (mode !== "free" || busy() || P.done) return;
    const f = (keys.w ? 1 : 0) - (keys.s ? 1 : 0), side = (keys.a ? 1 : 0) - (keys.d ? 1 : 0);
    const turn = (keys.arrowleft ? 1 : 0) - (keys.arrowright ? 1 : 0), look = (keys.arrowup ? 1 : 0) - (keys.arrowdown ? 1 : 0);
    if (turn) P.h = norm180(P.h + turn * FREE_TURN * dt);
    if (look) P.pitch = clamp(P.pitch + look * 70 * dt, PITCH_MIN, PITCH_MAX);
    if (f || side) {
      const h = rad(P.h), sp = FREE_WALK * dt / (Math.hypot(f, side) || 1);
      const moved = slide((Math.cos(h) * f + Math.cos(h + Math.PI / 2) * side) * sp, (Math.sin(h) * f + Math.sin(h + Math.PI / 2) * side) * sp);
      P.walked += moved; P.minutes += moved / WALK / 60;
      const last = P.trail[P.trail.length - 1];
      if (!last || Math.hypot(P.x - last[0], P.y - last[1]) > 0.35) P.trail.push([P.x, P.y]);
    }
  }
  function bind() {
    $("modeFree").onclick = () => setMode("free");
    $("modeAI").onclick = () => setMode("ai");
    $("restart").onclick = () => reset();
    $("oracleStep").onclick = () => oracleStart(false);
    $("oracleAll").onclick = () => oracleStart(true);
    const dist = () => Number($("aiDist").value) || 1, ang = () => Number($("aiDeg").value) || 30;
    const fire = (a, arg) => { if (!busy() && !P.done) act(a, arg); };
    const declare = () => { const r = window.prompt("为什么做不到？"); if (r !== null) fire("declare_impossible", r); };
    document.querySelectorAll("#bar button[data-a]").forEach((b) => (b.onclick = () => {
      const k = b.dataset.a;
      const AI = { walk: ["walk", dist()], back: ["back", dist()], sideL: ["sidestep", dist()], sideR: ["sidestep", -dist()],
        turnL: ["turn", Math.abs(ang())], turnR: ["turn", -Math.abs(ang())], lookUp: ["look", 28], lookLevel: ["look", -6], lookDown: ["look", -35] };
      if (k === "declare_impossible") declare(); else if (AI[k]) fire(...AI[k]); else fire(k);
    }));
    const TOOL = { e: "inspect", m: "move_aside", l: "toggle_light", g: "pick_place", v: "mark_anomaly", f: "look_closer", z: "wait", enter: "stop" };
    window.addEventListener("keydown", (ev) => {
      if (ev.repeat || ev.target.tagName === "INPUT") return;
      const k = ev.key.toLowerCase();
      if (ev.key === "Tab") { ev.preventDefault(); document.body.classList.toggle("nohud"); return; }
      if (k === "r") { reset(); return; }
      if (k === "o") { oracleStart(true); return; }
      if (k === "x") { ev.preventDefault(); declare(); return; }
      if (TOOL[k]) { ev.preventDefault(); fire(TOOL[k]); return; }
      if (mode === "ai") {
        const map = { w: ["walk", dist()], arrowup: ["walk", dist()], s: ["back", dist()], arrowdown: ["back", dist()], a: ["turn", Math.abs(ang())],
          arrowleft: ["turn", Math.abs(ang())], d: ["turn", -Math.abs(ang())], arrowright: ["turn", -Math.abs(ang())], q: ["sidestep", dist()] };
        if (map[k]) { ev.preventDefault(); fire(...map[k]); }
        return;
      }
      keys[k] = true;
    });
    window.addEventListener("keyup", (ev) => { keys[ev.key.toLowerCase()] = false; });
    window.addEventListener("blur", () => Object.keys(keys).forEach((k) => (keys[k] = false)));
    canvas.addEventListener("mousedown", (ev) => { drag = [ev.clientX, ev.clientY]; });
    window.addEventListener("mouseup", () => { drag = null; });
    window.addEventListener("mousemove", (ev) => {
      if (!drag || mode !== "free" || busy() || P.done) return;
      const dx = ev.clientX - drag[0], dy = ev.clientY - drag[1];
      drag = [ev.clientX, ev.clientY];
      P.h = norm180(P.h - dx * 0.22);
      P.pitch = clamp(P.pitch - dy * 0.18, PITCH_MIN, PITCH_MAX);
    });
  }
  let last = performance.now();
  function frame(now) {
    const raw = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (filming) { /* bench/detective_film.py drives the clock */ }
    else if (busy()) tick(raw);
    else { freeStep(raw); oracleTick(raw); }
    const W0 = window.innerWidth, H0 = window.innerHeight;
    let w = W0, h = Math.round(W0 * 9 / 16);
    if (h > H0) { h = H0; w = Math.round(H0 * 16 / 9); }
    if (canvas.clientWidth !== w) {
      Object.assign(canvas.style, { width: `${w}px`, height: `${h}px`, left: `${Math.round((W0 - w) / 2)}px`, top: `${Math.round((H0 - h) / 2)}px` });
      renderer.setSize(w, h, false);
    }
    placeCamera();
    aimMesh = aimed();
    renderUI();
    renderer.render(scene, camera);
    if ($("godwrap").style.display !== "none") drawPlan($("god").getContext("2d"), $("god").width, $("god").height);
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- env API (bench/runner.js)
  const ENV = window.SANav.exposeEnv({
    reset, setMode, act, busy, tick, done: () => P.done, info,
    text: () => `${P.text}（${T.fmtMin(T.start + P.minutes)}）`,
    frame: (w, h, mime) => snapshot(w, h, mime),
    photo: () => null,
    taskCard: () => {
      const card = { scene: "detective", id: TK.id, title: TK.name, intro: TK.intro, rules: RULES, actions: ACTIONS, action_names: ACTION_NAMES,
        items: TK.items.map((i) => i.label), maxSteps: budget, obs: T.obs, challenge: T.challenge, seed: T.seed, eval: EVAL, startTime: TK.time,
        body_radius: BODY_R, reach: REACH, fov: FOV };
      if (EVAL) delete card.seed;
      return card;
    },
  });
  window.SPACEACT = EVAL ? Object.freeze({ env: Object.freeze({ reset: ENV.reset, step: ENV.step, observe: ENV.observe, frame: ENV.frame,
    photo: ENV.photo, task: ENV.task }) }) : {
    env: ENV, player: P, task: () => TK, act, reset, setMode, rollout, evaluate, info, blockedAt, oracle: oracleActions, verify: verifyWorld,
    budget: () => ({ oracle: oracleSteps, budget }), filmStart, filmStep, filmHold,
    /* bench/make_strata.js (+map): every footprint and prop where it stands now, and which lamps are lit. */
    godData: () => ({
      solids: SOLIDS.map((s) => ({ id: s.id, box: boxOf(s), name: s.name[0], move: !!s.move, wall: !!s.wall })),
      targets: Object.values(TARGETS).map((t) => ({ id: t.id, label: t.label, at: t.obj ? centerOf(t.obj) : t.at, box: !!t.box, shelf: !!t.shelf,
        high: !!t.high, carry: !!t.carry, light: !!t.light, hidden: !!t.hidden, lit: t.light ? !!P.lit[t.id] : null })),
    }),
    plan: () => {
      const job = nextJob(), G = grid(), start = nearestCell(G, P.x, P.y), D = dijkstra(G, start);
      const reach = D.dist.reduce((n, d) => n + (isFinite(d) ? 1 : 0), 0);
      const pose = job.target ? workPose(G, D, job.target) : job.place ? placePose(G, D, job.place) : null;
      return { job, start, reach, free: G.free.reduce((a, b) => a + b, 0), pose, acts: planJob(job) };
    },
    aimed: () => { placeCamera(); const a = aimed(); return a ? { id: a.t.id, dist: round(a.dist, 100), near: a.near } : null; },
    pose: (o) => { Object.assign(P, o); placeCamera(); },
  };

  bind();
  setMode(EVAL || Q.has("ai") || Q.get("mode") === "ai" ? "ai" : "free");
  if (VARIED) $("godwrap").style.display = "none";
  loadModel().then(() => {
    reset();
    const ref = rollout(600);
    oracleSteps = ref.success ? ref.steps : null;
    budget = oracleSteps ? budgetFor(oracleSteps) : 400;
    TK.maxSteps = budget;
    reset();
    if (Q.get("pose") && !EVAL) {
      const [x, y, h, p] = Q.get("pose").split(",").map(Number);
      Object.assign(P, { x, y, h, pitch: p });
    }
    $("loading").style.display = "none";
    if (EVAL) delete window.SA_DETECTIVE;
    requestAnimationFrame(frame);
  }).catch((e) => { $("loadSub").textContent = "模型加载失败：" + (e && e.message ? e.message : e); });
})();
