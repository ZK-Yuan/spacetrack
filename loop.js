/* Space Track · 无尽回廊（B1 夜班层）: a basement night-shift floor whose corridor ring closes after three right turns and
   whose west stairwell only ever leads back to B1, with mechanisms that change which corridors can be walked (breaker panel,
   interlocked fire shutters, a pump draining a flood, a one-way door). Every task but one also runs on a control floor where
   the ring has an ordinary fourth side (corridor D) and both stairwells reach B3. Same task system, AI action names and env
   API as the park, plus use(name) and wait. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const N = window.SANav;
  const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif';
  const HW = 1.2, CEIL = 2.7, DOOR_H = 2.1, FH = 3.6, B3Z = -2 * FH, EYE = 1.6, RADIUS = 0.28;
  const WALK = 2.6, RUN = 5.2, TURN_DEG = 85, FOV = 64, ZOOM_FOV = 22, BENCH_FOV = 58.7, BENCH_ZOOM_FOV = 17.1;
  const M_PER_MIN = 60, LOOK_MIN = 0.1, DOOR_MIN = 0.05, DOWN_MIN = 0.35, UP_MIN = 0.45, STAIR_M = 9;
  const SEAM_DX = 21.3, WALL_U = 1.35, FLOOR_M = 2.0, CEIL_M = 2.4;
  const rad = (d) => (d * Math.PI) / 180;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const v3 = (x, y, h) => new THREE.Vector3(x, h, -y);
  function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
  const hash = (str) => [...str].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

  // ---------------------------------------------------------------- tasks: every one fits in 50 actions; all but "pump" (B3 only) also run on an ordinary control floor
  // kind: fetch (lap, then an errand against the clock) · patrol (punch every clock, report the room count) · reach (stop at goal) ·
  // carry (pick up `item` at its node, then stop at goal). tape: the task image is the previous guard's patrol footage; rush: a
  // deadline 8 s over the fastest time (rounded down to 5 s); dark: B1 has no power; mech: shutter / pump / wedge / closed (see
  // MECH below); blockers: what a correct declare_impossible has to name, where the task cannot be done.
  const BASE = [
    // tools: the rope pays out behind you and is reeled in when you walk back along it; chalk writes on whatever is ahead;
    // the camcorder has night vision (one battery bar per action while on) and plays back earlier frames.
    { id: "chalk", kind: "reach", name: "粉笔下楼", time: "23:30", stars: 4, start: "W0", heading: 180, goal: "B3_pump", tools: ["chalk"],
      startName: "西楼梯间 B1 平台（带着粉笔）", goalName: "B3 水泵房门口",
      intro: "23:30，货梯坏了。你抱着一箱灯管站在西楼梯间的 B1 平台，要把它送到 B3 水泵房门口，到了就 stop。兜里有一支红粉笔：" +
        "mark(内容) 会把字写在正前方的墙上（墙太远就写在前面的地上）。" },
    { id: "nv", kind: "reach", name: "夜视找档案室", time: "23:40", stars: 4, start: "L0", heading: 90, goal: "C_arch", dark: true, tools: ["camera"], battery: 6,
      startName: "B1 电梯厅值班台（断电）", goalName: "档案室门口",
      intro: "整层突然断电，只剩安全出口灯还亮着。手里的摄像机有夜视：night_vision 打开或关上，开着的时候每个动作耗一格电，一共只有 6 格；" +
        "rewind(n) 可以回看 n 步之前拍到的画面。找到档案室门口，到了 stop。" },
    { id: "tether", kind: "reach", name: "拉绳探路", time: "23:25", stars: 4, start: "L0", heading: 90, goal: "C_arch", rope: 50,
      blockers: [["绳"], ["不够", "太短", "长度", "米"]], declare: "安全绳只有 50 米，到档案室最短也要 59 米，绳子不够长",
      startName: "B1 电梯厅值班台（系着安全绳）", goalName: "档案室门口，或判断绳子不够",
      intro: "研究所让你带一卷 50 米的安全绳去档案室门口，绳头系在值班台上，不能解开。走过的路上会留下绳子，原路往回走会把绳子收回来，" +
        "绳子放到头就走不动了。到了档案室门口 stop；如果判断绳子怎么也够不着，就用 declare_impossible 说明原因。" },
    { id: "pump", kind: "reach", name: "抽水", time: "23:45", stars: 4, start: "ES3", heading: 180, goal: "B3_pump", mech: "pump", single: true,
      startName: "B3 东楼梯口", goalName: "B3 水泵房门口",
      intro: "你在 B3 东楼梯口。水泵房门口积水过膝，带着工具过不去。想办法走到水泵房门口，到了 stop。开关用 use(名字) 操作，wait 可以原地等一会儿。" },
    { id: "shutter", kind: "carry", name: "防火卷帘", time: "23:15", stars: 5, start: "L0", heading: 0, goal: "A_tea", mech: "shutter", item: ["extinguisher", "C_print", "灭火器箱"],
      startName: "B1 电梯厅值班台", goalName: "打印室取灭火器箱 → 茶水间门口",
      intro: "电梯厅东门的防火卷帘落下来了。打印室门口有一个灭火器箱，把它搬到茶水间门口（茶水间在电梯厅北门出去的走廊上），到了 stop。墙上的开关和按钮用 use(名字) 操作。" },
    { id: "wedge", kind: "carry", name: "门挡", time: "23:35", stars: 5, start: "L0", heading: 0, goal: "L0", mech: "wedge", item: ["fuse", "B3_elec", "备用保险丝"],
      startName: "B1 电梯厅值班台", goalName: "B3 配电间取保险丝 → 回值班台",
      intro: "去 B3 配电间门口取备用保险丝，再回 B1 电梯厅值班台，到了 stop。身边的东西可以用 use(名字) 操作。" },
    { id: "chase", kind: "carry", name: "取件被追", time: "23:50", stars: 5, start: "L0", heading: 90, goal: "L0", item: ["folder", "C_arch", "蓝色文件夹"],
      entity: { at: "K1", on: "item", speed: 85 },
      startName: "B1 电梯厅值班台", goalName: "档案室取文件夹 → 回值班台",
      intro: "去档案室门口的文件架上拿蓝色文件夹，送回值班台 stop。研究所的备忘录上写着：「它比人走得快一点；推不开防火卷帘，推防火门要多花几秒，不下水；" +
        "被它追上就完了。听到嚎叫就跑。」" },
    { id: "holdout", kind: "survive", name: "撑到换班", time: "23:57", stars: 5, start: "L0", heading: 90, until: 3, entity: { at: "A_03", on: "start", speed: 90 },
      startName: "B1 电梯厅", goalName: "撑到 00:00 换班",
      intro: "23:57，你守在 B1 电梯厅，北边走廊里有个东西正朝这边过来。撑到 00:00 换班的人来就安全了。电梯厅北门和东门各有一道防火卷帘，" +
        "按钮在门边，两道卷帘互锁：升起一道，另一道就会落下。备忘录：「它比人走得快一点；推不开防火卷帘，推防火门要多花几秒；被它追上就完了。」" +
        "wait(秒) 原地等几秒（5–60）。" },
  ];
  const TASKS = [];
  BASE.forEach((t) => {
    TASKS.push(Object.assign({ isNew: true, title: t.name, maxSteps: 50 }, t));
    if (!t.single) TASKS.push(Object.assign({ isNew: true, maxSteps: 50 }, t, { id: `${t.id}_ctrl`, ctrl: true, title: `${t.name} · 对照`, stars: Math.max(1, t.stars - 1) }));
  });
  const T = SATasks.setup("loop", "无尽回廊 · B1 夜班层", TASKS, null);
  const TK = T.task;
  const IMP = !TK.ctrl;
  /* ?challenge=1 and ?eval=1: the seed turns the start and, where the puzzle allows, moves the goal or the thing to fetch (the
     dark search), with every text that names the room rewritten to match; with ?eval=1 the page
     keeps nothing but the env API. bench/make_seed_bank.py keeps the seeds whose oracle finishes the task. */
  const EVAL = new URLSearchParams(location.search).get("eval") === "1";
  const VARIED = T.challenge || EVAL;
  const ROOM_NAME = { C_arch: "档案室", B_meet: "会议室", C_print: "打印室", B_05: "B1-05 办公室" };
  if (VARIED) {
    // murmur3's finaliser first: an LCG started from neighbouring seeds draws nearly the same first numbers
    const mix = (h) => { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; };
    const R = rng(mix(T.seed + 977));
    const pick = (a) => a[Math.floor(R() * a.length)];
    const rename = (from, to) => ["intro", "goalName"].forEach((k) => { if (TK[k]) TK[k] = TK[k].split(ROOM_NAME[from]).join(ROOM_NAME[to]); });
    TK.heading = (TK.heading + 90 * Math.floor(R() * 4)) % 360;
    if (TK.id.startsWith("nv")) { const g = pick(["C_arch", "B_meet", "C_print", "B_05"]); rename("C_arch", g); TK.goal = g; }
    // the chase (only the archive leaves time to get back before it catches you) and the fire shutters (built around the print
    // room) keep their rooms and vary only the start
  }
  const params = new URLSearchParams(location.search);
  const LOOK = params.get("look") === "office" ? "office" : "yellow";
  const STILL = params.has("ai");
  // Picture: "vhs" (found-footage camcorder, for people), "film" (bloom and grade, deterministic), "clean" (plain render).
  // Agent frames use ?fx= if given, otherwise "film"; the live view starts as camcorder footage and V cycles the looks.
  const LOOKS = ["vhs", "film", "clean"];
  const FRAME_LOOK = LOOKS.indexOf(params.get("fx")) >= 0 ? params.get("fx") : "film";
  let liveLook = LOOKS.indexOf(params.get("fx")) >= 0 ? params.get("fx") : STILL ? "film" : "vhs";
  const TOOLS = TK.tools || [];
  const RULES = "只靠门牌、楼层牌和指示牌找路，没有平面图；时钟按走过的路程前进（每分钟约 60 米，上下一层楼梯约半分钟）。开关、按钮和身边的东西用 use(名字) 操作，wait 原地等 30 秒。" +
    (TK.rope ? `安全绳总长 ${TK.rope} 米。` : "");
  const ACTIONS = ["forward", "turn_left", "turn_right", "turn_around", "look_closer", "use(名字或编号：操作身边的开关、按钮、物品)", "wait(秒)（原地等，默认 30 秒，5–60 秒）",
    ...(TOOLS.includes("chalk") ? ["mark(内容)（用粉笔在正前方的墙上写字，墙太远就写在前面的地上）"] : []),
    ...(TOOLS.includes("camera") ? ["night_vision（打开 / 关上摄像机夜视，开着时每个动作耗一格电）", "rewind(n)（回看 n 步之前拍到的画面）"] : []),
    "stop（巡夜打卡时带房间数，如 stop(6)）", "declare_impossible(理由)"];

  // ---------------------------------------------------------------- floor plan (metres; x east, y north, z up; B1 floor at z = 0)
  // Ring: lobby → corridor A (north) → B (east) → C (south) → corner K3. On the impossible floor a 2.8 m stub S after the third
  // corner opens into the lobby's east door; on the control floor corridor D (24 m) does. The rooms on either side of that
  // opening are drawn a second time, shifted by SEAM_DX, behind it, so the view through it shows what you will walk into.
  const ROOMS = [
    { id: "lobby", r: [-4.5, -4.5, 4.5, 4.5], z: 0, h: CEIL, lights: "grid" },
    { id: "vest", r: [-7.7, -HW, -4.7, HW], z: 0, h: CEIL },
    { id: "A1", r: [-HW, 4.7, HW, 15], z: 0, h: CEIL, ax: "y" },
    { id: "A2", r: [-HW, 15, HW, 31], z: 0, h: CEIL, ax: "y" },
    { id: "K1", r: [-4.2, 31, 3.8, 38], z: 0, h: CEIL, lights: "hall" },
    { id: "B", r: [3.8, 32.8, 26.2, 35.2], z: 0, h: CEIL, ax: "x" },
    { id: "K2", r: [26.2, 31, 34.2, 38], z: 0, h: CEIL, lights: "hall" },
    { id: "C2", r: [28.8, 13.2, 31.2, 31], z: 0, h: CEIL, ax: "y" },
    { id: "C1", r: [28.8, HW, 31.2, 13.2], z: 0, h: CEIL, ax: "y" },
    { id: "K3", r: [28.8, -HW, 31.2, HW], z: 0, h: CEIL, lights: "none" },
    IMP ? { id: "S", r: [26, -HW, 28.8, HW], z: 0, h: CEIL } : { id: "D", r: [4.7, -HW, 28.8, HW], z: 0, h: CEIL, ax: "x" },
    { id: "B3", r: [-7.7, -HW, 31.2, HW], z: B3Z, h: 2.6, ax: "x", b3: true },
  ];
  const RD = {};
  ROOMS.forEach((r) => (RD[r.id] = r));
  const PASSAGES = [
    { id: "pN", r: [-0.8, 4.5, 0.8, 4.7], z: 0, head: 2.4 },
    { id: "pE", r: [4.5, -0.8, 4.7, 0.8], z: 0, head: 2.4 },
    { id: "pW", r: [-4.7, -0.55, -4.5, 0.55], z: 0, head: DOOR_H, fire: true, side: -1, zones: ["B1", "B1"] },
    { id: "pWS", r: [-7.9, -0.55, -7.7, 0.55], z: 0, head: DOOR_H, fire: true, side: -1, zones: ["SW", "B1"] },
    { id: "pES", r: [31.2, -0.55, 31.4, 0.55], z: 0, head: DOOR_H, fire: true, side: 1, zones: ["SE", "B1"] },
    { id: "pES3", r: [31.2, -0.55, 31.4, 0.55], z: B3Z, head: DOOR_H, fire: true, side: 1, zones: ["SE", "B3"] },
    IMP ? { id: "pWS3", r: [-7.9, -0.55, -7.7, 0.55], z: B3Z, head: DOOR_H, fire: true, side: -1, zones: ["SW", "B3"], dead: true }
      : { id: "pWS3", r: [-7.9, -0.55, -7.7, 0.55], z: B3Z, head: DOOR_H, fire: true, side: -1, zones: ["SW", "B3"] },
  ];
  const PD = {};
  PASSAGES.forEach((p) => (PD[p.id] = p));
  const inst = (def, dx) => ({ def, off: [dx || 0, 0, 0], copy: !!dx });
  const RI = ROOMS.map((r) => inst(r)), PI = PASSAGES.map((p) => inst(p));
  if (IMP) {
    ["lobby", "vest", "A1"].forEach((id) => RI.push(inst(RD[id], SEAM_DX)));
    ["pN", "pW", "pE"].forEach((id) => PI.push(inst(PD[id], SEAM_DX)));
    ["S", "K3", "C1"].forEach((id) => RI.push(inst(RD[id], -SEAM_DX)));
    PI.push(inst(PD.pES, -SEAM_DX));
  }
  // Doors along the corridors (closed, not enterable). facing = the direction the door faces, into the corridor.
  const DOORS = [
    { id: "tea", label: "茶水间", sub: "PANTRY", x: -HW, y: 12, facing: 0, room: "A1", node: "A_tea", clock: true },
    { id: "o03", label: "办公室", sub: "B1-03", x: HW, y: 24, facing: 180, room: "A2", node: "A_03", clock: true },
    { id: "o05", label: "办公室", sub: "B1-05", x: 11, y: 32.8 + 2.4, facing: 270, room: "B", node: "B_05", clock: true },
    { id: "meet", label: "会议室", sub: "MEETING", x: 21, y: 32.8, facing: 90, room: "B", node: "B_meet", clock: true },
    { id: "arch", label: "档案室", sub: "ARCHIVE", x: 31.2, y: 29, facing: 180, room: "C2", node: "C_arch", clock: true },
    { id: "print", label: "打印室", sub: "PRINT", x: 28.8, y: 15, facing: 0, room: "C2", node: "C_print", clock: true },
    { id: "fan", label: "排风机房", x: 24, y: HW, z: B3Z, facing: 270, room: "B3", node: "B3_fan", steel: true },
    { id: "elec", label: "配电间", x: 10, y: HW, z: B3Z, facing: 270, room: "B3", node: "B3_elec", steel: true },
    { id: "store", label: "储藏室", x: 16, y: -HW, z: B3Z, facing: 90, room: "B3", steel: true },
    { id: "pump", label: "水泵房", sub: "PUMP ROOM", x: -2, y: HW, z: B3Z, facing: 270, room: "B3", node: "B3_pump", steel: true, wide: true },
  ];
  const CLOCK_DOORS = DOORS.filter((d) => d.clock);
  const DOOR_AT = {}, CLOCK_AT = {};
  DOORS.forEach((d) => { if (d.node) DOOR_AT[d.node] = d; if (d.clock) CLOCK_AT[d.node] = d; });
  // Switchback stairwells: landing 0–1.5 m from the door wall, flights 1.5–4.6 m, half landing 4.6–6.2 m. From a landing the flight on
  // the +y side goes down and the one on the −y side goes up. The impossible west stairwell repeats every storey and is always B1.
  const STAIRS = [
    { id: "E", xd: 31.4, dir: 1, gate: true,
      levels: [{ z: FH, label: "1F", door: "dead" }, { z: 0, label: "B1", door: "pES" }, { z: -FH, label: "B2", door: "dead", locked: "B2 设备层\n闲人免进" }, { z: B3Z, label: "B3", door: "pES3" }] },
    IMP ? { id: "W", xd: -7.9, dir: -1, periodic: true,
      levels: [4, 3, 2, 1, 0, -1, -2, -3, -4].map((k) => ({ z: k * FH, k, label: "B1", door: k === 0 ? "pWS" : "dead" })) }
      : { id: "W", xd: -7.9, dir: -1, gate: true,
        levels: [{ z: FH, label: "1F", door: "dead" }, { z: 0, label: "B1", door: "pWS" }, { z: -FH, label: "B2", door: "dead", locked: "B2 设备层\n闲人免进" }, { z: B3Z, label: "B3", door: "pWS3" }] },
  ];
  const SW = {};
  STAIRS.forEach((s) => (SW[s.id] = s));
  const sx = (s, t) => s.xd + s.dir * t;
  const inStair = (s, x, y) => Math.abs(y) <= 1.5 && x >= Math.min(sx(s, 0), sx(s, 6.2)) && x <= Math.max(sx(s, 0), sx(s, 6.2));
  /* A landing's node stands at the head of the flight going down, so facing that flight is facing straight ahead. */
  const LAND_T = 1.1, LAND_Y = 0.85;
  function stairPath(s, z, down) {
    const c = sx(s, LAND_T), f0 = sx(s, 1.5), f1 = sx(s, 4.6), m = sx(s, 5.4), h = FH / 2;
    return down
      ? [[c, LAND_Y, z], [f0, 0.85, z], [f1, 0.85, z - h], [m, 0, z - h], [f1, -0.85, z - h], [f0, -0.85, z - FH], [c, LAND_Y, z - FH]]
      : [[c, LAND_Y, z], [f0, -0.85, z], [f1, -0.85, z + h], [m, 0, z + h], [f1, 0.85, z + h], [f0, 0.85, z + FH], [c, LAND_Y, z + FH]];
  }

  // ---------------------------------------------------------------- AI action graph
  const NODE_LIST = [
    ["L0", 0, 0, 0, "B1 电梯厅值班台"], ["A_tea", 0, 12, 0], ["A_03", 0, 24, 0], ["K1", 0, 34, 0], ["B_05", 11, 34, 0], ["B_meet", 21, 34, 0],
    ["K2", 30, 34, 0], ["C_arch", 30, 29, 0], ["C_print", 30, 15, 0], ["K3", 30, 0, 0], ["W0", sx(SW.W, LAND_T), LAND_Y, 0, "西楼梯间 B1 平台"],
    ["ES1", sx(SW.E, LAND_T), LAND_Y, 0, "东楼梯间 B1 平台"], ["ES2", sx(SW.E, LAND_T), LAND_Y, -FH, "东楼梯间 B2 平台"], ["ES3", sx(SW.E, LAND_T), LAND_Y, B3Z, "东楼梯间 B3 平台"],
    ["B3_e", 29.6, 0, B3Z], ["B3_fan", 24, 0, B3Z], ["B3_elec", 10, 0, B3Z], ["B3_pump", -2, 0, B3Z, "B3 水泵房门口"], ["B3_w", -6.3, 0, B3Z],
  ];
  if (!IMP) NODE_LIST.push(["W2", sx(SW.W, LAND_T), LAND_Y, -FH, "西楼梯间 B2 平台"], ["W3", sx(SW.W, LAND_T), LAND_Y, B3Z, "西楼梯间 B3 平台"]);
  const NX = {}, NPOS = [], NINFO = [];
  NODE_LIST.forEach(([id, x, y, z, name], i) => { NX[id] = i; NPOS.push([x, y, z]); NINFO.push({ id, name: name || "" }); });
  const EDGES = [];
  const P3 = (id) => NPOS[NX[id]].slice();
  const edge = (a, b, kind, p3, extra) => EDGES.push(Object.assign({ a: NX[a], b: NX[b], kind, p3 }, extra || {}));
  "L0-A_tea A_tea-A_03 A_03-K1 K1-B_05 B_05-B_meet B_meet-K2 K2-C_arch C_arch-C_print C_print-K3 B3_e-B3_fan B3_fan-B3_elec B3_elec-B3_pump B3_pump-B3_w"
    .split(" ").forEach((pair) => { const [a, b] = pair.split("-"); edge(a, b, "walk", [P3(a), P3(b)]); });
  if (IMP) edge("K3", "L0", "walk", [[30, 0, 0], [SEAM_DX, 0, 0]], { shift: [-SEAM_DX, 0, 0], ring: true });
  else edge("K3", "L0", "walk", [[30, 0, 0], [0, 0, 0]], { ring: true });
  const WEST = { exitA: 180, arriveB: 180, exitB: 0, arriveA: 0 }, EAST = { exitA: 0, arriveB: 0, exitB: 180, arriveA: 180 };
  edge("L0", "W0", "door", [[0, 0, 0], [-4.6, 0, 0], [-7.8, 0, 0], P3("W0")], Object.assign({ doors: ["pW", "pWS"] }, WEST));
  edge("K3", "ES1", "door", [[30, 0, 0], [31.3, 0, 0], P3("ES1")], Object.assign({ doors: ["pES"] }, EAST));
  edge("ES3", "B3_e", "door", [P3("ES3"), [31.3, 0, B3Z], [29.6, 0, B3Z]], Object.assign({ doors: ["pES3"] }, WEST));
  const HEAD = { E: { exitA: 0, arriveB: 180, exitB: 315, arriveA: 180 }, W: { exitA: 180, arriveB: 0, exitB: 225, arriveA: 0 } };
  const stairs = (a, b, s, z) => edge(a, b, "stairs", stairPath(s, z, true), Object.assign({ aDown: true, len: STAIR_M, stair: s.id }, HEAD[s.id]));
  stairs("ES1", "ES2", SW.E, 0);
  stairs("ES2", "ES3", SW.E, -FH);
  if (IMP) {
    edge("W0", "W0", "stairs", stairPath(SW.W, 0, true), { aDown: true, len: STAIR_M, stair: "W", shift: [0, 0, FH], exitA: 180, exitB: 180, arriveA: 0, arriveB: 0 });
    edge("W0", "W0", "stairs", stairPath(SW.W, 0, false), { aDown: false, len: STAIR_M, stair: "W", shift: [0, 0, -FH], exitA: 225, exitB: 225, arriveA: 0, arriveB: 0 });
  } else {
    stairs("W0", "W2", SW.W, 0);
    stairs("W2", "W3", SW.W, -FH);
    edge("W3", "B3_w", "door", [P3("W3"), [-7.8, 0, B3Z], [-6.3, 0, B3Z]], Object.assign({ doors: ["pWS3"] }, EAST));
  }
  const polyLen3 = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1], p[2] - pts[i - 1][2]) : 0), 0);
  EDGES.forEach((e) => { e.pts = e.p3.map((p) => [p[0], p[1]]); if (e.len === undefined) e.len = polyLen3(e.p3); });
  const NG = N.prepare({ nodes: NPOS.map((p) => [p[0], p[1]]), edges: EDGES });
  // Exits that exist but cannot be taken: [heading, text, text in vision-only mode]
  const BLOCKED = {
    L0: [[270, "电梯门上贴着「检修中 · 暂停使用」，按钮按不亮。", "按钮按不亮。"]],
    ES1: [[315, "通往 1F 的铁栅门上了锁。", "铁栅门锁着，过不去。"]],
    ES2: [[180, "B2 的门锁着，门上写着「设备层 · 闲人免进」。", "门锁着。"]],
    ES3: [[0, "楼梯到底了。", "楼梯到底了。"]],
  };
  DOORS.forEach((d) => { if (d.node) (BLOCKED[d.node] = BLOCKED[d.node] || []).push([(d.facing + 180) % 360, `「${d.label}」的门锁着。`, "门锁着。"]); });
  if (IMP) BLOCKED.B3_w = [[180, "这扇楼梯间的门从这边打不开。", "门打不开。"]];
  else {
    BLOCKED.W0 = [[225, "通往 1F 的铁栅门上了锁。", "铁栅门锁着，过不去。"]];
    BLOCKED.W2 = [[0, "B2 的门锁着，门上写着「设备层 · 闲人免进」。", "门锁着。"]];
    BLOCKED.W3 = [[180, "楼梯到底了。", "楼梯到底了。"]];
  }
  // Edges a mechanism can cut: the lobby's north door, the east door (the ring closure runs through it), C between the archive and
  // the print room (a broken shutter), and the flooded stretch in front of the B3 pump room.
  const edgeBetween = (a, b) => EDGES.find((e) => (e.a === NX[a] && e.b === NX[b]) || (e.a === NX[b] && e.b === NX[a]));
  edgeBetween("L0", "A_tea").north = true;
  edgeBetween("C_arch", "C_print").cbreak = true;
  edgeBetween("B3_elec", "B3_pump").wet = true;
  edgeBetween("B3_pump", "B3_w").wet = true;
  // where along each cuttable edge (metres from its node a) the shutter, sandbags or door stands
  edgeBetween("L0", "A_tea").bar = 4.6;
  edgeBetween("K3", "L0").bar = 30 - 4.6 - (IMP ? SEAM_DX : 0);
  edgeBetween("C_arch", "C_print").bar = 29 - 20.8;
  edgeBetween("B3_elec", "B3_pump").bar = 10 - 5.75;
  edgeBetween("B3_pump", "B3_w").bar = 0;
  EDGES.forEach((e) => { if (e.doors && e.bar === undefined) e.bar = Math.hypot(e.p3[1][0] - e.p3[0][0], e.p3[1][1] - e.p3[0][1], e.p3[1][2] - e.p3[0][2]); });

  // ---------------------------------------------------------------- mechanisms: each state changes which edges can be walked, and each shows in the scene
  // shutter: B1 breaker panel (1 corridor lights · 2 shutter motor · 3 freight lift · 4 exhaust fan; at most two on, a third trips the
  //   main switch), and the lobby's north and east fire shutters, interlocked — raising one lowers the other — powered by breaker 2.
  // pump: the B3 box runs either the exhaust fan or the pump (both trips it); the pump drains the water in front of the pump room.
  // wedge: the east stairwell door on B3 cannot be opened from the corridor side unless a wedge holds it open.
  // closed: the east stairwell door on B1 is locked for maintenance.
  const WET = 0.2, DRAIN_MIN = 1.2;
  const BR_NAMES = { 1: "走廊照明", 2: "防火卷帘", 3: "货梯", 4: "排风机" };
  const MECH = {};
  function initialMech() {
    return { main: true, br: { 1: true, 2: !!TK.entity, 3: !TK.entity, 4: false }, north: true, east: TK.mech !== "shutter", broken: TK.mech === "shutter",
      box: true, fan: true, pump: false, level: TK.mech === "pump" ? 1 : 0, wedged: false, trips: 0, waits: 0, bumps: 0, uses: 0 };
  }
  Object.assign(MECH, initialMech());
  const breakersOn = (S) => [1, 2, 3, 4].filter((k) => S.br[k]).length;
  const motorOn = () => MECH.main && MECH.br[2];
  const pumpOn = () => MECH.box && MECH.pump;
  let forceLit = false;   // the patrol footage was shot before the power went
  const b1Lit = () => forceLit || (!P.dark && !TK.dark && MECH.main && MECH.br[1]);
  function blockedBy(e, from, S) {
    if (e.ring && !S.east) return "shutter";
    if (e.north && !S.north) return "shutter";
    if (e.cbreak && S.broken) return "broken";
    if (e.wet && S.level > WET) return "water";
    if (TK.mech === "closed" && e.doors && e.doors[0] === "pES") return "closed";
    if (TK.mech === "wedge" && e.doors && e.doors[0] === "pES3" && from === NX.B3_e && !S.wedged) return "oneway";
    return null;
  }
  function cost(eid, from, t, S) {
    const e = NG.edges[eid];
    if (blockedBy(e, from, S || MECH)) return null;
    if (e.kind === "stairs") return (e.a === from) === e.aDown ? DOWN_MIN : UP_MIN;
    return e.len / M_PER_MIN + (e.doors ? DOOR_MIN * e.doors.length : 0);
  }
  /* Fastest route under the current mechanism state, or under `S` (a what-if copy). */
  const plan = (src, goal, S) => N.plan(NG, src, new Set([goal]), 0, (eid, from, t) => cost(eid, from, t, S));
  const withMech = (o) => Object.assign({}, MECH, o);

  /* On the impossible floor some places are drawn more than once: the rooms either side of the ring's opening, and every storey of
     the west stairwell. canon() maps a drawn point to the real place; copiesOf() gives the offsets where that place is drawn again. */
  function canon(p) {
    let [x, y, z] = p;
    if (!IMP) return [x, y, z];
    if (inStair(SW.W, x, y)) z -= FH * Math.round(z / FH);
    else if (Math.abs(z) < 1 && y < 16) { if (x > 13 && x < 26) x -= SEAM_DX; else if (x > 4.7 && x < 10.5) x += SEAM_DX; }
    return [x, y, z];
  }
  function copiesOf(p) {
    if (!IMP) return [];
    const [x, y, z] = p;
    if (inStair(SW.W, x, y)) return [[0, 0, FH], [0, 0, -FH], [0, 0, 2 * FH], [0, 0, -2 * FH]];
    if (Math.abs(z) < 1 && x >= -7.75 && x <= 4.75 && y >= -4.55 && y <= 15.05) return [[SEAM_DX, 0, 0]];
    if (Math.abs(z) < 1 && x >= 25.95 && x <= 31.25 && y >= -1.25 && y <= 13.25) return [[-SEAM_DX, 0, 0]];
    return [];
  }
  const near3 = (a, b, r) => [[0, 0, 0]].concat(copiesOf(b)).some((o) => Math.hypot(a[0] - b[0] - o[0], a[1] - b[1] - o[1], a[2] - b[2] - o[2]) < r);
  /* An edge's points in walking order from `from` (shifted like the camera through the ring's opening), every ~0.6 m. */
  function edgePoints(e, from) {
    const fwd = e.a === from;
    let pts = fwd ? e.p3 : e.p3.slice().reverse();
    if (!fwd && e.shift) pts = pts.map((p) => [p[0] + e.shift[0], p[1] + e.shift[1], p[2] + e.shift[2]]);
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.6));
      for (let k = 1; k <= n; k++) out.push([0, 1, 2].map((j) => a[j] + ((b[j] - a[j]) * k) / n));
    }
    return out;
  }

  // ---------------------------------------------------------------- the entity: walks the graph toward you, a little faster than a person.
  // Lowered shutters, deep water, the locked door and the one-way door stop it as they stop you; each fire door costs it ENT_DOOR_M.
  const ENT_DOOR_M = 12;
  const entLen = (e) => e.len + (e.doors ? ENT_DOOR_M * e.doors.length : 0);
  const entCost = (eid, from, S) => (blockedBy(NG.edges[eid], from, S) ? null : entLen(NG.edges[eid]));
  function entDist(a, b, S) {
    if (a === b) return 0;
    const p = N.plan(NG, a, new Set([b]), 0, (eid, f) => entCost(eid, f, S));
    return p ? p.minutes : Infinity;
  }
  /* E = { from, eid, s }: at node `from` (eid null) or s metres along edge eid away from `from`. Moves d metres toward node `target`;
     on an edge it turns back whenever that has become the shorter way (a shutter came down in front of it, or you moved). */
  function entMove(E, d, target, S) {
    for (let guard = 0; d > 1e-9 && guard < 80; guard++) {
      if (E.eid === null) {
        if (E.from === target) return;
        const p = N.plan(NG, E.from, new Set([target]), 0, (eid, f) => entCost(eid, f, S));
        if (!p || !p.path.length) return;
        E.eid = p.path[0][1];
        E.s = 0;
      }
      const e = NG.edges[E.eid], L = entLen(e), to = N.other(e, E.from), g = (E.s * e.len) / L;
      const ahead = wayShut(e, E.from, g, S) ? Infinity : L - E.s + entDist(to, target, S);
      const back = wayShut(e, to, e.len - g, S) ? Infinity : E.s + entDist(E.from, target, S);
      if (!isFinite(ahead) && !isFinite(back)) return;
      if (back < ahead - 1e-6) {
        if (E.s <= 1e-9) { E.eid = null; if (!isFinite(back) || E.from === target) return; continue; }
        E.s = L - E.s;
        E.from = to;
      }
      const rem = L - E.s;
      if (d >= rem) { d -= rem; E.from = N.other(e, E.from); E.eid = null; E.s = 0; }
      else { E.s += d; d = 0; }
    }
  }
  /* Is the way from `from` to the edge's other end shut for someone already pos metres along it (only if the barrier is still ahead)? */
  function wayShut(e, from, pos, S) {
    if (!blockedBy(e, from, S)) return false;
    if (e.bar === undefined) return true;
    return (from === e.a ? e.bar : e.len - e.bar) >= pos - 1e-6;
  }
  /* Metres between the entity and someone standing at node n (only counted along the entity's own edge). */
  function entGapTo(E, n) {
    if (E.eid === null) return E.from === n ? 0 : Infinity;
    const e = NG.edges[E.eid], k = e.len / entLen(e);
    if (N.other(e, E.from) === n) return (entLen(e) - E.s) * k;
    return E.from === n ? E.s * k : Infinity;
  }
  /* Which lobby door it will come through: "north", "east", or null (another way, or no way at all). */
  function approachDoor(E0, S) {
    const E = Object.assign({}, E0);
    entMove(E, 0.05, NX.L0, S);
    let node = E.from;
    if (E.eid !== null) {
      const e = NG.edges[E.eid], to = N.other(e, E.from);
      if (to === NX.L0) return e.north ? "north" : e.ring ? "east" : null;
      node = to;
    }
    const p = N.plan(NG, node, new Set([NX.L0]), 0, (eid, f) => entCost(eid, f, S));
    if (!p || !p.path.length) return null;
    const last = NG.edges[p.path[p.path.length - 1][1]];
    return last.north ? "north" : last.ring ? "east" : null;
  }
  /* Fastest way from src through every stop (any order) to end. */
  function tour(src, stops, end) {
    const memo = new Map();
    const dist = (a, b) => { const k = a * 1000 + b; if (!memo.has(k)) memo.set(k, plan(a, b)); return memo.get(k); };
    let best = null;
    const go = (left, cur, acc, order) => {
      if (best && acc >= best.minutes) return;
      if (!left.length) {
        const p = dist(cur, end);
        if (p && (!best || acc + p.minutes < best.minutes)) best = { minutes: acc + p.minutes, order: order.slice() };
        return;
      }
      left.forEach((n, i) => {
        const p = dist(cur, n);
        if (!p) return;
        order.push(n);
        go(left.filter((_, j) => j !== i), n, acc + p.minutes, order);
        order.pop();
      });
    };
    go(stops, src, 0, []);
    if (!best) return null;
    let path = [], len = 0, cur = src;
    best.order.concat([end]).forEach((n) => { const p = dist(cur, n); path = path.concat(p.path); len += p.len; cur = n; });
    return { minutes: best.minutes, len, path };
  }

  // ---------------------------------------------------------------- renderer
  const canvas = $("view");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const FOGS = { B1: LOOK === "yellow" ? [0x857749, 0.02] : [0x7c8186, 0.019], stair: [0x09090a, 0.055], B3: [0x0f100e, 0.042], dark: [0x000000, 0.035] };
  const FXR = window.SALoopFX ? window.SALoopFX.create(renderer) : null;
  const AUD = window.SALoopFX && !STILL ? window.SALoopFX.audio() : null;
  scene.fog = new THREE.FogExp2(FOGS.B1[0], FOGS.B1[1]);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 160);
  camera.rotation.order = "YXZ";
  let fogKey = "B1";
  function zoneOf(x, y, z) {
    if (STAIRS.some((s) => inStair(s, x, y))) return "stair";
    return z < -5 ? "B3" : "B1";
  }
  function applyFog(x, y, z) {
    const zone = zoneOf(x, y, z), k = zone === "B1" && !b1Lit() ? "dark" : zone;
    if (k === fogKey) return;
    fogKey = k;
    scene.fog.color.setHex(FOGS[k][0]);
    scene.fog.density = FOGS[k][1];
  }

  // ---------------------------------------------------------------- textures: three photos (plaster, terrazzo, concrete), the rest drawn on canvases
  const IMG = {};
  function loadImages() {
    const src = window.SA_LOOP_TEX || {};
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
        } catch (e) { /* a file:// page without file access: draw the canvases without photos */ }
        res();
      };
      im.onerror = () => res();
      im.src = src[k];
    })));
  }
  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    if (repeat !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  const photo = (g, key, x, y, w, h) => { if (IMG[key]) g.drawImage(IMG[key], x, y, w, h); };
  function blot(g, w, h, x, y, r, col, wrapY) {
    [-w, 0, w].forEach((dx) => (wrapY ? [-h, 0, h] : [0]).forEach((dy) => {
      const cx = x + dx, cy = y + dy;
      if (cx + r < 0 || cx - r > w || cy + r < 0 || cy - r > h) return;
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      gr.addColorStop(0, col);
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    }));
  }
  const TEX = {};
  function makeTextures() {
    const Y = LOOK === "yellow", R = rng(11);
    const plaster2 = (g, w) => { photo(g, "plaster", 0, 0, w, w); photo(g, "plaster", 0, w, w, w); };
    // B1 walls: one tile is 1.35 m wide and the whole 2.7 m high (canvas bottom = floor)
    TEX.wall = canvasTex(512, 1024, (g, w, h) => {
      g.fillStyle = Y ? "#c8b662" : "#e3e1da";
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = "soft-light";
      g.globalAlpha = Y ? 0.8 : 0.9;
      plaster2(g, w);
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
      if (Y) {
        for (let i = 0; i < 9; i++) {
          const x = (i * w) / 9;
          g.fillStyle = "rgba(255,246,205,0.08)"; g.fillRect(x + 6, 0, w / 9 - 20, h);
          g.fillStyle = "rgba(92,72,24,0.17)"; g.fillRect(x, 0, 2, h);
        }
        g.strokeStyle = "rgba(100,80,28,0.14)";
        g.lineWidth = 2;
        for (let i = 0; i < 9; i++) for (let j = 0; j < 24; j++) {
          const cx = ((i + 0.5) * w) / 9, cy = (j + 0.5) * (h / 24) + (i % 2) * (h / 48);
          g.beginPath(); g.moveTo(cx - 7, cy + 5); g.lineTo(cx, cy - 3); g.lineTo(cx + 7, cy + 5); g.stroke();
        }
      }
      let gr = g.createLinearGradient(0, h, 0, h * 0.88);
      gr.addColorStop(0, Y ? "rgba(58,45,16,0.32)" : "rgba(60,58,52,0.16)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr; g.fillRect(0, h * 0.88, w, h * 0.12);
      if (Y) {
        gr = g.createLinearGradient(0, 0, 0, h * 0.1);
        gr.addColorStop(0, "rgba(115,90,30,0.16)"); gr.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = gr; g.fillRect(0, 0, w, h * 0.1);
        for (let k = 0; k < 3; k++) blot(g, w, h, R() * w, h * (0.8 + 0.2 * R()), 90 + 120 * R(), "rgba(88,68,22,0.09)");
      }
    });
    TEX.wall.wrapT = THREE.ClampToEdgeWrapping;
    // B1 floor: damp carpet tiles (or grey terrazzo), 2 m per tile
    TEX.floor = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = "#b4b4ae"; g.fillRect(0, 0, w, h);
      g.filter = "grayscale(1) contrast(1.15) brightness(1.5)";
      photo(g, "terrazzo", 0, 0, w, h);
      g.filter = "none";
      g.globalCompositeOperation = "multiply";
      g.fillStyle = Y ? "#cdb878" : "#d6d5cf"; g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = "source-over";
      if (Y) for (let k = 0; k < 5; k++) blot(g, w, h, R() * w, R() * h, 40 + 70 * R(), "rgba(62,52,22,0.14)", true);
      else { g.globalCompositeOperation = "screen"; g.fillStyle = "#2e2e2e"; g.fillRect(0, 0, w, h); g.globalCompositeOperation = "source-over"; }
    });
    // suspended ceiling: 2.4 m = 4 × 4 mineral-fibre tiles of 0.6 m in a T-bar grid
    TEX.ceil = canvasTex(1024, 1024, (g, w, h) => {
      g.fillStyle = Y ? "#d9d1b3" : "#e4e3dd"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 26000; i++) {
        g.fillStyle = `rgba(70,62,45,${0.04 + 0.12 * R()})`;
        const s = R() < 0.85 ? 1.5 : 3;
        g.fillRect(R() * w, R() * h, s, s);
      }
      g.strokeStyle = "rgba(90,80,60,0.18)"; g.lineWidth = 1;
      for (let i = 0; i < 420; i++) {
        const x = R() * w, y = R() * h;
        g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 10 * (R() - 0.5), y + 10 * (R() - 0.5), x + 14 * (R() - 0.5), y + 14 * (R() - 0.5)); g.stroke();
      }
      if (Y) { blot(g, w, h, 0.62 * w, 0.37 * h, 70, "rgba(130,96,40,0.32)", true); blot(g, w, h, 0.18 * w, 0.84 * h, 46, "rgba(130,96,40,0.26)", true); }
      const t = w / 4;
      for (let i = 0; i <= 4; i++) {
        g.fillStyle = "rgba(0,0,0,0.16)"; g.fillRect(i * t - 7, 0, 3, h); g.fillRect(0, i * t - 7, w, 3);
        g.fillStyle = Y ? "#ece6cf" : "#f2f2ee"; g.fillRect(i * t - 4, 0, 8, h); g.fillRect(0, i * t - 4, w, 8);
      }
    });
    TEX.troffer = canvasTex(256, 512, (g, w, h) => {
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
      g.fillStyle = "rgba(196,200,203,0.4)";
      for (let x = 16; x < w - 16; x += 7) g.fillRect(x, 16, 1, h - 32);
      for (let y = 16; y < h - 16; y += 7) g.fillRect(16, y, w - 32, 1);
      g.strokeStyle = "#a9adaf"; g.lineWidth = 16; g.strokeRect(8, 8, w - 16, h - 16);
      g.strokeStyle = "rgba(0,0,0,0.3)"; g.lineWidth = 2; g.strokeRect(16, 16, w - 32, h - 32);
    }, false);
    TEX.concrete = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = "#8d8b85"; g.fillRect(0, 0, w, h);
      g.filter = "grayscale(0.6) brightness(1.35)";
      photo(g, "concrete", 0, 0, w, h);
      g.filter = "none";
      g.globalCompositeOperation = "screen"; g.fillStyle = "#3a3a38"; g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = "source-over";
    });
    // stairwell walls: one tile per storey (3.6 m), green dado on the lowest 1.1 m
    TEX.stairWall = canvasTex(512, 1024, (g, w, h) => {
      g.fillStyle = "#d3d1c9"; g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = "soft-light"; g.globalAlpha = 0.9; plaster2(g, w);
      g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
      const d = h * (1.1 / FH);
      g.fillStyle = "#58705f"; g.fillRect(0, h - d, w, d);
      g.globalCompositeOperation = "soft-light"; photo(g, "plaster", 0, h - d, w, d); g.globalCompositeOperation = "source-over";
      g.fillStyle = "#3a4a3f"; g.fillRect(0, h - d - 5, w, 5);
    });
    // B3 walls: 2.6 m high, painted concrete with a green dado
    TEX.b3wall = canvasTex(512, 1024, (g, w, h) => {
      g.fillStyle = "#c4c6be"; g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = "soft-light"; plaster2(g, w); g.globalCompositeOperation = "source-over";
      const d = h * (1.1 / 2.6);
      g.fillStyle = "#53665a"; g.fillRect(0, h - d, w, d);
      g.globalCompositeOperation = "soft-light"; photo(g, "plaster", 0, h - d, w, d); g.globalCompositeOperation = "source-over";
      g.fillStyle = "#33413a"; g.fillRect(0, h - d - 5, w, 5);
      for (let k = 0; k < 5; k++) blot(g, w, h, R() * w, h * (0.8 + 0.2 * R()), 40 + 80 * R(), "rgba(20,24,20,0.25)");
    });
    TEX.b3wall.wrapT = THREE.ClampToEdgeWrapping;
    TEX.wood = canvasTex(256, 512, (g, w, h) => {
      g.fillStyle = Y ? "#a3835a" : "#a88d66"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) {
        const x = R() * w;
        g.strokeStyle = `rgba(70,45,20,${0.07 + 0.12 * R()})`;
        g.lineWidth = 1 + 2 * R();
        g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 8 * (R() - 0.5), h * 0.33, x + 8 * (R() - 0.5), h * 0.66, x + 6 * (R() - 0.5), h); g.stroke();
      }
    }, false);
    TEX.arrow = canvasTex(256, 512, (g, w, h) => {
      g.fillStyle = "#f2c21b";
      g.beginPath(); g.moveTo(w / 2, 18); g.lineTo(w - 22, 206); g.lineTo(w * 0.66, 206); g.lineTo(w * 0.66, h - 18);
      g.lineTo(w * 0.34, h - 18); g.lineTo(w * 0.34, 206); g.lineTo(22, 206); g.closePath(); g.fill();
      g.globalCompositeOperation = "destination-out";
      for (let i = 0; i < 600; i++) { g.fillStyle = `rgba(0,0,0,${0.3 + 0.7 * R()})`; g.fillRect(R() * w, R() * h, 2 + 3 * R(), 2 + 3 * R()); }
      g.globalCompositeOperation = "source-over";
    }, false);
    TEX.stain = canvasTex(256, 256, (g, w, h) => {
      for (let k = 0; k < 6; k++) blot(g, w, h, w * (0.3 + 0.4 * R()), h * (0.3 + 0.4 * R()), 40 + 50 * R(), Y ? "rgba(52,42,14,0.24)" : "rgba(40,40,38,0.16)");
    }, false);
  }
  function signTex(w, h, draw) { return canvasTex(w, h, draw, false); }
  const memo = (fn) => { const m = new Map(); return (...a) => { const k = a.join("|"); if (!m.has(k)) m.set(k, fn(...a)); return m.get(k); }; };
  const center = (g, text, x, y, font, color) => { g.font = font; g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, x, y); };
  const plateTex = memo((label, sub) => signTex(340, 160, (g, w, h) => {
    g.fillStyle = "#f1f0ea"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#8f8f88"; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
    center(g, label, w / 2, sub ? h * 0.42 : h / 2, `600 ${label.length > 3 ? 56 : 64}px ${FONT}`, "#1d1d1b");
    if (sub) center(g, sub, w / 2, h * 0.8, `500 30px ${FONT}`, "#55554f");
  }));
  const steelSignTex = memo((label, sub) => signTex(420, 150, (g, w, h) => {
    g.fillStyle = "#1f4e8c"; g.fillRect(0, 0, w, h);
    center(g, label, w / 2, sub ? h * 0.4 : h / 2, `700 62px ${FONT}`, "#ffffff");
    if (sub) center(g, sub, w / 2, h * 0.8, `600 28px ${FONT}`, "#d7e3f4");
  }));
  const exitTex = memo((text) => signTex(400, 150, (g, w, h) => {
    g.fillStyle = "#0d8a42"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#fff"; g.lineWidth = 9; g.lineCap = "round";
    const x = 62, y = 76;
    g.beginPath(); g.arc(x + 6, y - 40, 9, 0, 7); g.fillStyle = "#fff"; g.fill();
    g.beginPath(); g.moveTo(x, y - 26); g.lineTo(x - 6, y + 4); g.lineTo(x - 26, y + 34);
    g.moveTo(x - 6, y + 4); g.lineTo(x + 16, y + 20); g.lineTo(x + 18, y + 40);
    g.moveTo(x, y - 22); g.lineTo(x + 22, y - 6); g.moveTo(x, y - 22); g.lineTo(x - 22, y - 10); g.stroke();
    g.strokeRect(x + 34, y - 52, 30, 98);
    center(g, "安全出口", 255, 56, `700 52px ${FONT}`, "#ffffff");
    center(g, text, 255, 112, `600 32px ${FONT}`, "#e6ffe9");
  }));
  const floorTex = memo((label) => signTex(400, 290, (g, w, h) => {
    g.fillStyle = "#2d4637"; g.fillRect(0, 0, w, h);
    center(g, label, w / 2, h / 2 + 8, `800 ${label.length > 2 ? 170 : 200}px ${FONT}`, "#f2f0e8");
  }));
  const noticeTex = memo((text, bg, fg) => signTex(360, 220, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = fg; g.lineWidth = 8; g.strokeRect(10, 10, w - 20, h - 20);
    const lines = text.split("\n");
    lines.forEach((l, i) => center(g, l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 62, `700 ${lines.length > 1 ? 50 : 60}px ${FONT}`, fg));
  }));
  const wordTex = memo((text, fg, px) => signTex(1024, 180, (g, w, h) => center(g, text, w / 2, h / 2, `700 ${px}px ${FONT}`, fg)));
  /* A bordered notice whose lettering is sized to fit the longest line. */
  const fitTex = memo((text, bg, fg, w, h) => signTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = fg; g.lineWidth = Math.max(4, Math.round(h / 28)); g.strokeRect(g.lineWidth, g.lineWidth, w - 2 * g.lineWidth, h - 2 * g.lineWidth);
    const lines = text.split("\n"), n = Math.max(...lines.map((l) => l.length));
    const px = Math.min(Math.floor((w * 0.86) / n), Math.floor((h * 0.78) / lines.length / 1.2));
    lines.forEach((l, i) => center(g, l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * px * 1.2, `700 ${px}px ${FONT}`, fg));
  }));
  /* Fire shutter slats, 16 per tile. */
  const slatTex = memo(() => canvasTex(128, 256, (g, w, h) => {
    for (let y = 0; y < h; y += 16) {
      const gr = g.createLinearGradient(0, y, 0, y + 16);
      gr.addColorStop(0, "#c9cdcf"); gr.addColorStop(0.55, "#9ca2a5"); gr.addColorStop(1, "#5a6064");
      g.fillStyle = gr; g.fillRect(0, y, w, 16);
    }
  }));
  const stripeTex = memo((a, b) => canvasTex(64, 256, (g, w, h) => {
    g.fillStyle = a; g.fillRect(0, 0, w, h);
    g.fillStyle = b;
    for (let y = -w; y < h; y += 48) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + w); g.lineTo(w, y + w + 24); g.lineTo(0, y + 24); g.closePath(); g.fill(); }
  }));
  /* Water-level ruler: red and white 5 cm bands from 0 to 60 cm, numbered every 10 cm. */
  const gaugeTex = memo(() => signTex(128, 512, (g, w, h) => {
    g.fillStyle = "#f2f0e8"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? "#f2f0e8" : "#c62828"; g.fillRect(0, h - (i + 1) * (h / 12), w * 0.42, h / 12); }
    for (let i = 1; i < 6; i++) center(g, `${i * 10}`, w * 0.72, h - i * (h / 6), `800 40px ${FONT}`, "#1d1d1b");
  }));
  const waterTex = memo(() => canvasTex(256, 256, (g, w, h) => {
    const R = rng(5);
    g.fillStyle = "#57543d"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const x = R() * w, y = R() * h, l = 8 + 22 * R();
      g.strokeStyle = `rgba(215,205,165,${0.04 + 0.08 * R()})`; g.lineWidth = 1 + R();
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + l / 2, y - 3, x + l, y); g.stroke();
    }
  }));

  // ---------------------------------------------------------------- materials
  const M = {};
  const vc = (o) => new THREE.MeshBasicMaterial(Object.assign({ vertexColors: true }, o));
  const signMat = memo((key, tex, glow) => (glow ? new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(glow, glow, glow) })
    : vc({ map: tex, transparent: !!tex.userData.alpha })));
  function makeMaterials() {
    const Y = LOOK === "yellow";
    Object.assign(M, {
      wall: vc({ map: TEX.wall }), floor: vc({ map: TEX.floor }), ceil: vc({ map: TEX.ceil }),
      base: vc({ color: Y ? 0x6a5833 : 0x84868a }), frame: vc({ color: 0x8b8f91 }), steel: vc({ color: 0xa3a8ab }), dark: vc({ color: 0x262728 }),
      wood: vc({ map: TEX.wood }), fire: vc({ color: 0x7a8577 }), metalDoor: vc({ color: 0x8c9196 }), concrete: vc({ map: TEX.concrete }),
      stairWall: vc({ map: TEX.stairWall }), nosing: vc({ color: 0xc9a227 }), rail: vc({ color: 0x3a3e41 }), b3wall: vc({ map: TEX.b3wall }),
      b3ceil: vc({ map: TEX.concrete, color: 0x8f8f8b }), b3floor: vc({ map: TEX.concrete, color: 0xb3b1aa }), red: vc({ color: 0xb4241c }),
      glassDark: vc({ color: 0x1f2427 }), white: vc({ color: 0xe8e7e2 }), desk: vc({ color: 0x7a5a3c }), deskTop: vc({ color: 0x3b3733 }),
      plant: vc({ color: 0x6b6541 }), pot: vc({ color: 0x5a4636 }), pipe: vc({ color: 0x5f6f64 }), pipe2: vc({ color: 0x8a6a44 }), blue: vc({ color: 0x2f5fa8 }),
      yellow: vc({ color: 0xe0b31c }), chair: vc({ color: 0x2e3238 }), bottle: vc({ color: 0x7fb2d9 }),
      infill: vc({ color: Y ? 0xbba65a : 0xd9d7d0 }), void: new THREE.MeshBasicMaterial({ color: 0x030302 }),
      arrow: vc({ map: TEX.arrow, transparent: true, alphaTest: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      stain: vc({ map: TEX.stain, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      troffer: new THREE.MeshBasicMaterial({ map: TEX.troffer, color: Y ? new THREE.Color(2.5, 2.3, 1.85) : new THREE.Color(2.5, 2.55, 2.65) }),
      trofferOff: vc({ map: TEX.troffer, color: 0x6e6e66 }),
      bulb: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.6, 1.7) }), bulbOff: vc({ color: 0x55524a }),
      bulkhead: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.5, 2.6) }),
      ledRed: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.18, 0.12) }), ledGreen: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 2.6, 0.5) }),
      screen: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.18, 0.3, 0.42) }),
      shutter: vc({ map: slatTex() }), hazard: vc({ map: stripeTex("#e0b31c", "#1a1a1a") }), barrier: vc({ map: stripeTex("#f2f0e8", "#c62828"), side: THREE.DoubleSide }),
      panelGrey: vc({ color: 0x9ea49f }), lever: vc({ color: 0x1f2a36 }), leverMain: vc({ color: 0xb4241c }), btn: vc({ color: 0x2e8b3a }),
      burlap: vc({ color: 0x8a7852 }), rubber: vc({ color: 0xd9a21b }), card: vc({ color: 0xb08a5a }), lampOff: vc({ color: 0x2b2d2b }),
      lampGreen: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 2.4, 0.55) }),
      water: new THREE.MeshBasicMaterial({ map: waterTex(), color: new THREE.Color(0.5, 0.52, 0.5), transparent: true, opacity: 0.88, depthWrite: false }),
      glint: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.3, 0.85), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
    });
    M.trofferFlicker = M.troffer.clone();
    M.trofferLit = M.troffer.color.clone();
    M.screenLit = M.screen.color.clone();
  }

  // ---------------------------------------------------------------- mesh building: static geometry is merged per material and lit by baked vertex colours
  const ACCS = [], SHARED = new Map();
  function acc(mat, own) {
    if (!own && SHARED.has(mat)) return SHARED.get(mat);
    const a = { mat, p: [], n: [], uv: [], s: [], idx: [] };
    ACCS.push(a);
    if (!own) SHARED.set(mat, a);
    return a;
  }
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  /* A grid on the plane o + u·U + v·V (U, V unit vectors in plan space); it faces U × V. */
  function grid(a, o, U, V, us, vs, uvf, surf) {
    const n = cross(U, V), b = a.p.length / 3, nu = us.length;
    vs.forEach((v) => us.forEach((u) => {
      a.p.push(o[0] + U[0] * u + V[0] * v, o[1] + U[1] * u + V[1] * v, o[2] + U[2] * u + V[2] * v);
      a.n.push(n[0], n[1], n[2]);
      const t = uvf(u, v);
      a.uv.push(t[0], t[1]);
      a.s.push(surf);
    }));
    for (let j = 0; j < vs.length - 1; j++) for (let i = 0; i < nu - 1; i++) {
      const k = b + j * nu + i;
      a.idx.push(k, k + 1, k + nu + 1, k, k + nu + 1, k + nu);
    }
  }
  const steps = (len, d) => { const n = Math.max(1, Math.ceil(len / d - 1e-6)); return Array.from({ length: n + 1 }, (_, i) => (i * len) / n); };
  const one = (len) => [0, len];
  function box(a, x0, y0, z0, x1, y1, z1, surf, m) {
    m = m || 1;
    const lx = x1 - x0, ly = y1 - y0, lz = z1 - z0, f = (o, U, V, lu, lv) => grid(a, o, U, V, one(lu), one(lv), (u, v) => [u / m, v / m], surf);
    f([x1, y0, z0], [0, 1, 0], [0, 0, 1], ly, lz);
    f([x0, y1, z0], [0, -1, 0], [0, 0, 1], ly, lz);
    f([x1, y1, z0], [-1, 0, 0], [0, 0, 1], lx, lz);
    f([x0, y0, z0], [1, 0, 0], [0, 0, 1], lx, lz);
    f([x0, y0, z1], [1, 0, 0], [0, 1, 0], lx, ly);
    f([x0, y0, z0], [0, 1, 0], [1, 0, 0], ly, lx);
  }
  /* Box in a wall's frame: t along the wall (to the right when facing it), n out of the wall; walls are axis aligned. */
  function wallBox(a, x, y, facing, t0, t1, n0, n1, z0, z1, surf, m) {
    const c = Math.round(Math.cos(rad(facing))), s = Math.round(Math.sin(rad(facing)));
    const px = (t, n) => x - s * t + c * n, py = (t, n) => y + c * t + s * n;
    const xs = [px(t0, n0), px(t1, n1)], ys = [py(t0, n0), py(t1, n1)];
    box(a, Math.min(...xs), Math.min(...ys), z0, Math.max(...xs), Math.max(...ys), z1, surf, m);
  }
  /* Upright rectangle facing heading f (degrees), centred at (cx, cy, cz). */
  function panel(a, cx, cy, cz, f, w, h, surf, uvf) {
    const U = [-Math.sin(rad(f)), Math.cos(rad(f)), 0];
    grid(a, [cx - (U[0] * w) / 2, cy - (U[1] * w) / 2, cz - h / 2], U, [0, 0, 1], one(w), one(h), uvf || ((u, v) => [u / w, v / h]), surf);
  }
  /* Rectangle on the floor; the texture's up points along heading ang. */
  function decal(a, cx, cy, z, ang, w, l, surf) {
    const V = [Math.cos(rad(ang)), Math.sin(rad(ang)), 0], U = [V[1], -V[0], 0];
    grid(a, [cx - (U[0] * w) / 2 - (V[0] * l) / 2, cy - (U[1] * w) / 2 - (V[1] * l) / 2, z], U, V, one(w), one(l), (u, v) => [u / w, v / l], surf);
  }
  /* A square-section bar from p0 to p1 (handrails). */
  function beam(a, p0, p1, w, h, surf) {
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]), d = norm([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]);
    let s = Math.abs(d[2]) < 0.95 ? norm([-d[1], d[0], 0]) : [1, 0, 0], u = cross(d, s);
    if (u[2] < 0) { s = s.map((v) => -v); u = cross(d, s); }
    const at = (ks, ku) => [p0[0] + s[0] * ks + u[0] * ku, p0[1] + s[1] * ks + u[1] * ku, p0[2] + s[2] * ks + u[2] * ku];
    const neg = (v) => v.map((x) => -x), uv = (q, r) => [q, r];
    grid(a, at(-w / 2, h / 2), d, s, one(L), one(w), uv, surf);
    grid(a, at(w / 2, -h / 2), d, neg(s), one(L), one(w), uv, surf);
    grid(a, at(w / 2, h / 2), d, neg(u), one(L), one(h), uv, surf);
    grid(a, at(-w / 2, -h / 2), d, u, one(L), one(h), uv, surf);
  }
  function tube(a, p0, p1, r, segs, surf, caps) {
    const d = norm([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]), s = Math.abs(d[2]) < 0.9 ? norm([-d[1], d[0], 0]) : [1, 0, 0], u = cross(d, s);
    const b = a.p.length / 3;
    for (let i = 0; i <= segs; i++) {
      const t = (i / segs) * Math.PI * 2, n = [0, 1, 2].map((k) => Math.cos(t) * s[k] + Math.sin(t) * u[k]);
      [p0, p1].forEach((p, j) => { a.p.push(p[0] + n[0] * r, p[1] + n[1] * r, p[2] + n[2] * r); a.n.push(n[0], n[1], n[2]); a.uv.push(i / segs, j); a.s.push(surf); });
    }
    for (let i = 0; i < segs; i++) { const k = b + i * 2; a.idx.push(k, k + 2, k + 3, k, k + 3, k + 1); }
    if (caps) {
      const c = a.p.length / 3;
      a.p.push(p1[0], p1[1], p1[2]); a.n.push(d[0], d[1], d[2]); a.uv.push(0.5, 0.5); a.s.push(surf);
      for (let i = 0; i < segs; i++) a.idx.push(c, b + i * 2 + 1, b + i * 2 + 3);
    }
  }

  // ---------------------------------------------------------------- building the floor plan
  const SEGS = [];     // 2D wall segments: light visibility, distance-to-wall occlusion, collisions
  const LIGHTS = [];   // baked lights
  const SURFS = [];    // walkable surfaces (real geometry only)
  const FIRE = [];     // fire doors that swing: { pass, group, angle, target, x, y, z }
  const LEDS = {};     // clock id → LED meshes (the pantry clock also exists in the copied corridor)
  const FOLDER = [];
  const LCOL = LOOK === "yellow" ? [1.0, 0.93, 0.74] : [0.95, 0.98, 1.0];
  const rectOf = (i) => [i.def.r[0] + i.off[0], i.def.r[1] + i.off[1], i.def.r[2] + i.off[0], i.def.r[3] + i.off[1]];
  const zOf = (i) => i.def.z + i.off[2];
  const seg = (x0, y0, x1, y1, z0, z1, zone, o) => SEGS.push(Object.assign({ x0, y0, x1, y1, z0, z1, zone }, o || {}));
  const near = (a, b) => Math.abs(a - b) < 1e-4;
  /* Openings on one edge of a room instance: neighbouring rooms across the edge (open, no wall) and passages (wall above the head only).
     side: S = edge y = c with the room to the north, N = room to the south, W = edge x = c with the room to the east, E = to the west. */
  function openingsOn(ri, side, c, a, b) {
    const z = zOf(ri), open = [], gaps = [];
    const touch = (R) => (side === "S" ? near(R[3], c) : side === "N" ? near(R[1], c) : side === "W" ? near(R[2], c) : near(R[0], c));
    const span = (R) => (side === "S" || side === "N" ? [R[0], R[2]] : [R[1], R[3]]);
    const take = (R, list, extra) => {
      if (!touch(R)) return;
      const [p, q] = span(R), s = Math.max(a, p), t = Math.min(b, q);
      if (t - s > 1e-4) list.push([s, t, extra]);
    };
    RI.forEach((rj) => { if (rj !== ri && near(zOf(rj), z)) take(rectOf(rj), open); });
    PI.forEach((pj) => { if (near(zOf(pj), z)) take(rectOf(pj), gaps, pj.def.head); });
    return { open, gaps };
  }
  function subtract(a, b, cuts) {
    let out = [[a, b]];
    cuts.forEach(([s, t]) => {
      out = out.flatMap(([p, q]) => (t <= p || s >= q ? [[p, q]] : [[p, Math.max(p, s)], [Math.min(q, t), q]].filter(([u, v]) => v - u > 1e-4)));
    });
    return out;
  }
  const NRM = { S: [0, 1], N: [0, -1], W: [1, 0], E: [-1, 0] };
  /* One wall strip along a room edge, from z0 to z1 (zF is the floor, for texture v); off = the instance offset (keeps copies' textures identical). */
  function wallStrip(mat, side, c, s, t, zF, z0, z1, hTex, off, surf) {
    const n = NRM[side], U = [-n[1], n[0], 0], alongX = side === "S" || side === "N";
    const fwd = alongX ? U[0] > 0 : U[1] > 0, start = fwd ? s : t, o = alongX ? off[0] : off[1];
    const zs = [z0, ...[0.12, 0.45, 1.0, 1.7, 2.3, 2.55].map((d) => zF + d).filter((z) => z > z0 + 0.02 && z < z1 - 0.02), z1];
    grid(acc(mat), alongX ? [start, c, z0] : [c, start, z0], U, [0, 0, 1], steps(t - s, 0.6), zs.map((z) => z - z0), (u, v) => {
      const g = (fwd ? start + u : start - u) - o;
      return [(fwd ? g : -g) / WALL_U, (z0 + v - zF) / hTex];
    }, surf);
  }
  function baseboard(side, c, s, t, z, zone, mat) {
    const sp = { k: "prop", zone }, d = 0.014;
    if (side === "S") box(acc(mat), s, c, z, t, c + d, z + 0.1, sp);
    else if (side === "N") box(acc(mat), s, c - d, z, t, c, z + 0.1, sp);
    else if (side === "W") box(acc(mat), c, s, z, c + d, t, z + 0.1, sp);
    else box(acc(mat), c - d, s, z, c, t, z + 0.1, sp);
  }
  function buildRoom(ri) {
    const d = ri.def, o = ri.off, [x0, y0, x1, y1] = rectOf(ri), z = zOf(ri), zc = z + d.h;
    const zone = d.b3 ? "B3" : "B1", hTex = d.b3 ? 2.6 : CEIL;
    const mw = d.b3 ? M.b3wall : M.wall, mf = d.b3 ? M.b3floor : M.floor, mc = d.b3 ? M.b3ceil : M.ceil;
    grid(acc(mf), [x0, y0, z], [1, 0, 0], [0, 1, 0], steps(x1 - x0, 0.6), steps(y1 - y0, 0.6),
      (u, v) => [(x0 + u - o[0]) / FLOOR_M, (y0 + v - o[1]) / FLOOR_M], { k: "floor", zone, zF: z, zC: zc });
    grid(acc(mc), [x0, y0, zc], [0, 1, 0], [1, 0, 0], steps(y1 - y0, 0.6), steps(x1 - x0, 0.6),
      (u, v) => [(x0 + v - o[0]) / CEIL_M, (y0 + u - o[1]) / CEIL_M], { k: "ceil", zone, zF: z, zC: zc });
    [["S", y0, x0, x1], ["N", y1, x0, x1], ["W", x0, y0, y1], ["E", x1, y0, y1]].forEach(([side, c, a, b]) => {
      const { open, gaps } = openingsOn(ri, side, c, a, b), alongX = side === "S" || side === "N";
      const n = NRM[side], surf = { k: "wall", zone, zF: z, zC: zc, ux: -n[1], uy: n[0] };
      subtract(a, b, open.concat(gaps)).forEach(([s, t]) => {
        wallStrip(mw, side, c, s, t, z, z, zc, hTex, o, surf);
        baseboard(side, c, s, t, z, zone, d.b3 ? M.dark : M.base);
        if (alongX) seg(s, c, t, c, z, zc, zone, { copy: ri.copy }); else seg(c, s, c, t, z, zc, zone, { copy: ri.copy });
      });
      gaps.forEach(([s, t, head]) => {
        if (z + head >= zc - 0.01) return;
        wallStrip(mw, side, c, s, t, z, z + head, zc, hTex, o, surf);
        if (alongX) seg(s, c, t, c, z + head, zc, zone, { copy: ri.copy }); else seg(c, s, c, t, z + head, zc, zone, { copy: ri.copy });
      });
    });
    roomLights(ri);
    (DECOR[d.id] || []).forEach((fn) => fn(o, ri));
    if (!ri.copy) SURFS.push({ x0, y0, x1, y1, z0: z, z1: z, ax: null });
  }
  /* Ceiling lights on a 3 m rhythm in global coordinates, so they run on evenly across corridor pieces; K corners borrow theirs. */
  const DEAD = new Set(["B:16.5", "B3:12.5", "K2:2"]), FLICK = new Set(["C2:22.5", "B3:22.5", "K1:4"]);
  const FLICKERING = [];
  function roomLights(ri) {
    const d = ri.def, o = ri.off, z = zOf(ri) + d.h, [lx0, ly0, lx1, ly1] = d.r, zone = d.b3 ? "B3" : "B1";
    const spots = [];
    if (d.lights === "none") return;
    if (d.b3) for (let x = Math.ceil((lx0 - 2.5) / 5) * 5 + 2.5; x < lx1; x += 5) { if (x >= lx0) spots.push([x, 0, 0, `${d.id}:${x}`]); }
    else if (d.lights === "grid") [-3, 0, 3].forEach((x) => [-3, 0, 3].forEach((y) => spots.push([x, y, 90, ""])));
    else if (d.lights === "hall") {
      const cx = (lx0 + lx1) / 2, cy = (ly0 + ly1) / 2;
      [-2.6, 0, 2.6].forEach((dx, i) => [-1.3, 1.3].forEach((dy, j) => spots.push([cx + dx, cy + dy, 90, `${d.id}:${i * 2 + j}`])));
    }
    else if (d.ax === "y") for (let y = Math.ceil((ly0 - 1.5) / 3) * 3 + 1.5; y < ly1; y += 3) { if (y >= ly0) spots.push([(lx0 + lx1) / 2, y, 90, `${d.id}:${y}`]); }
    else if (d.ax === "x") for (let x = Math.ceil((lx0 - 1.5) / 3) * 3 + 1.5; x < lx1; x += 3) { if (x >= lx0) spots.push([x, (ly0 + ly1) / 2, 0, `${d.id}:${x}`]); }
    else spots.push([(lx0 + lx1) / 2, (ly0 + ly1) / 2, 90, ""]);
    spots.forEach(([lx, ly, ang, key]) => {
      const x = lx + o[0], y = ly + o[1], dead = DEAD.has(key), flick = FLICK.has(key);
      if (d.b3) {
        const zb = zOf(ri) + d.h;
        box(acc(M.dark), x - 0.05, y - 0.05, zb - 0.08, x + 0.05, y + 0.05, zb, { k: "prop", zone });
        const bulb = dead ? acc(M.bulbOff) : acc(M.bulb);
        box(bulb, x - 0.045, y - 0.045, zb - 0.2, x + 0.045, y + 0.045, zb - 0.1, { k: "prop", zone });
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([a, b]) => box(acc(M.rail), x + a * 0.07 - 0.006, y + b * 0.07 - 0.006, zb - 0.22, x + a * 0.07 + 0.006, y + b * 0.07 + 0.006, zb - 0.08, { k: "prop", zone }));
        if (!dead) LIGHTS.push({ x, y, z: zb - 0.16, I: flick ? 0.55 : 1.15, col: [1.0, 0.8, 0.55], zone, down: false, s2: 0.2 });
        return;
      }
      const mat = dead ? M.trofferOff : flick ? M.trofferFlicker : M.troffer;
      const long = ang === 90 ? [0, 1, 0] : [1, 0, 0], across = ang === 90 ? [1, 0, 0] : [0, -1, 0];
      grid(acc(mat), [x - long[0] * 0.6 - across[0] * 0.3, y - long[1] * 0.6 - across[1] * 0.3, z - 0.004], long, across, one(1.2), one(0.6),
        (u, v) => [v / 0.6, u / 1.2], { k: "prop", zone });
      if (flick && !ri.copy) FLICKERING.push([x, y, zOf(ri)]);
      if (!dead) LIGHTS.push({ x, y, z: z - 0.05, I: flick ? 0.6 : 1, col: LCOL, zone, down: true, s2: 0.45 });
    });
  }
  /* A doorway between two rooms: floor, head and jambs, a steel frame on both faces, and a fire door leaf if it has one. */
  function buildPassage(pi) {
    const d = pi.def, o = pi.off, [x0, y0, x1, y1] = rectOf(pi), z = zOf(pi), zh = z + d.head;
    const alongX = x1 - x0 < y1 - y0, zone = z < -5 ? "B3" : "B1", mf = zone === "B3" ? M.b3floor : M.floor;
    const ps = { k: "prop", zone };
    grid(acc(mf), [x0, y0, z], [1, 0, 0], [0, 1, 0], one(x1 - x0), one(y1 - y0), (u, v) => [(x0 + u - o[0]) / FLOOR_M, (y0 + v - o[1]) / FLOOR_M], { k: "floor", zone, zF: z, zC: zh });
    grid(acc(M.frame), [x0, y0, zh], [0, 1, 0], [1, 0, 0], one(y1 - y0), one(x1 - x0), (u, v) => [u, v], ps);
    if (alongX) {
      grid(acc(M.frame), [x1, y0, z], [-1, 0, 0], [0, 0, 1], one(x1 - x0), one(d.head), (u, v) => [u, v], ps);
      grid(acc(M.frame), [x0, y1, z], [1, 0, 0], [0, 0, 1], one(x1 - x0), one(d.head), (u, v) => [u, v], ps);
      seg(x0, y0, x1, y0, z, zh, zone, { copy: pi.copy }); seg(x0, y1, x1, y1, z, zh, zone, { copy: pi.copy });
      [x0, x1].forEach((fx, i) => {
        const sgn = i ? 1 : -1, fa = Math.min(fx, fx + sgn * 0.025), fb = Math.max(fx, fx + sgn * 0.025);
        box(acc(M.frame), fa, y0 - 0.06, z, fb, y0, zh + 0.06, ps); box(acc(M.frame), fa, y1, z, fb, y1 + 0.06, zh + 0.06, ps);
        box(acc(M.frame), fa, y0 - 0.06, zh, fb, y1 + 0.06, zh + 0.06, ps);
      });
    } else {
      grid(acc(M.frame), [x0, y0, z], [0, 1, 0], [0, 0, 1], one(y1 - y0), one(d.head), (u, v) => [u, v], ps);
      grid(acc(M.frame), [x1, y1, z], [0, -1, 0], [0, 0, 1], one(y1 - y0), one(d.head), (u, v) => [u, v], ps);
      seg(x0, y0, x0, y1, z, zh, zone, { copy: pi.copy }); seg(x1, y0, x1, y1, z, zh, zone, { copy: pi.copy });
      [y0, y1].forEach((fy, i) => {
        const sgn = i ? 1 : -1, fa = Math.min(fy, fy + sgn * 0.025), fb = Math.max(fy, fy + sgn * 0.025);
        box(acc(M.frame), x0 - 0.06, fa, z, x0, fb, zh + 0.06, ps); box(acc(M.frame), x1, fa, z, x1 + 0.06, fb, zh + 0.06, ps);
        box(acc(M.frame), x0 - 0.06, fa, zh, x1 + 0.06, fb, zh + 0.06, ps);
      });
    }
    if (d.fire) fireLeaf(pi, x0, y0, x1, y1, z, zh);
    if (!pi.copy && !d.dead) SURFS.push({ x0, y0, x1, y1, z0: z, z1: z, ax: null });
  }
  /* Fire door leaf across an x-direction doorway, hinged on its south jamb, sitting on the `side` face. Copies and locked doors never open. */
  function fireLeaf(pi, x0, y0, x1, y1, z, zh) {
    const d = pi.def, side = d.side, fx = side < 0 ? x0 + 0.03 : x1 - 0.075, w = 0.045;
    const hx = side < 0 ? fx : fx + w, hy = y0 + 0.005;
    const a = acc(new THREE.MeshBasicMaterial({ vertexColors: true, color: 0x7d8a7a }), true);
    const zones = d.zones || ["B1", "B1"];
    const sp = { k: "door2", ax: [side, 0], zoneP: zones[0], zoneN: zones[1] };
    box(a, fx, y0 + 0.01, z + 0.005, fx + w, y1 - 0.01, zh - 0.01, sp);
    const bx = side < 0 ? fx - 0.04 : fx + w, bx2 = side < 0 ? fx : fx + w + 0.04;
    box(a, bx, y0 + 0.2, z + 0.98, bx2, y1 - 0.12, z + 1.04, sp);
    const group = new THREE.Group();
    group.position.copy(v3(hx, hy, 0));
    scene.add(group);
    a.parent = group;
    a.pivot = [hx, hy, 0];
    // notices on the leaf: the locked east stair door (corridor face) and the B3 door you cannot open from the corridor (stair face)
    const note = d.id === "pES" && TK.mech === "closed" ? ["closedNote", "楼梯检修\n暂停通行", -1]
      : d.id === "pES3" && TK.mech === "wedge" ? ["wedgeNote", "此门从走廊一侧打不开\n进出请用门挡卡住", 1] : null;
    if (note) {
      const na = acc(signMat(note[0], fitTex(note[1], "#f4f1e8", "#b3261e", 440, 260)), true);
      panel(na, note[2] < 0 ? fx - 0.003 : fx + w + 0.003, (y0 + y1) / 2, z + 1.45, note[2] < 0 ? 180 : 0, 0.44, 0.26, sp);
      na.parent = group;
      na.pivot = [hx, hy, 0];
    }
    if (!pi.copy && !d.dead) FIRE.push({ id: d.id, group, angle: 0, target: 0, side, x: (x0 + x1) / 2, y: (y0 + y1) / 2, z });
    seg((x0 + x1) / 2, y0, (x0 + x1) / 2, y1, z, zh, z < -5 ? "B3" : "B1", { light: true, copy: pi.copy, dead: !!d.dead });
  }

  // ---------------------------------------------------------------- stairwells
  function buildStair(s) {
    const zone = s.id === "W" ? "SW" : "SE", dir = s.dir, X = (t) => sx(s, t), st = { k: "stair", zone };
    const xa = Math.min(X(0), X(6.2)), xb = Math.max(X(0), X(6.2)), lv = s.levels;
    const zTop = s.periodic ? lv[0].z + FH : lv[0].z + 2.9, zBot = s.periodic ? lv[lv.length - 1].z - FH : lv[lv.length - 1].z - 0.3;
    const fade = (k) => (Math.abs(k || 0) <= 2 ? 1 : Math.abs(k) === 3 ? 0.45 : 0.12);
    const walkable = (z) => (s.periodic ? Math.abs(z) <= FH + 0.01 : z <= 0.01);
    const wall = (side, c, a, b, z0, z1) => {
      const n = NRM[side], U = [-n[1], n[0], 0], alongX = side === "S" || side === "N", fwd = alongX ? U[0] > 0 : U[1] > 0, start = fwd ? a : b;
      grid(acc(M.stairWall), alongX ? [start, c, z0] : [c, start, z0], U, [0, 0, 1], steps(b - a, 0.6), steps(z1 - z0, 0.9),
        (u, v) => [((fwd ? start + u : start - u) * (fwd ? 1 : -1)) / WALL_U, (z0 + v) / FH], st);
    };
    const farSide = dir > 0 ? "E" : "W", doorSide = dir > 0 ? "W" : "E";
    wall(farSide, X(6.2), -1.5, 1.5, zBot, zTop);
    wall("N", 1.5, xa, xb, zBot, zTop);
    wall("S", -1.5, xa, xb, zBot, zTop);
    wall(doorSide, X(0), -1.5, -0.55, zBot, zTop);
    wall(doorSide, X(0), 0.55, 1.5, zBot, zTop);
    const up = lv.slice().reverse();
    let zc = zBot;
    up.forEach((l) => { if (l.z > zc) wall(doorSide, X(0), -0.55, 0.55, zc, l.z); zc = l.z + DOOR_H; });
    wall(doorSide, X(0), -0.55, 0.55, zc, zTop);
    if (!s.periodic) grid(acc(M.stairWall), [xa, -1.5, zTop], [0, 1, 0], [1, 0, 0], one(3), one(xb - xa), (u, v) => [u, v], st);
    // collisions: the shaft walls, with a gap at each door that really opens
    [[xa, -1.5, xb, -1.5], [xa, 1.5, xb, 1.5], [X(6.2), -1.5, X(6.2), 1.5], [X(0), -1.5, X(0), -0.55], [X(0), 0.55, X(0), 1.5]]
      .forEach(([a, b, c, d]) => seg(a, b, c, d, zBot, zTop, zone, { coll: true }));
    let zg = zBot;
    up.forEach((l) => { if (PD[l.door] && !PD[l.door].dead) { seg(X(0), -0.55, X(0), 0.55, zg, l.z, zone, { coll: true }); zg = l.z + DOOR_H; } });
    seg(X(0), -0.55, X(0), 0.55, zg, zTop, zone, { coll: true });
    lv.forEach((l, i) => {
      const f = fade(l.k);
      box(acc(M.concrete), Math.min(X(0), X(1.5)), -1.5, l.z - 0.25, Math.max(X(0), X(1.5)), 1.5, l.z, st);
      if (l.door === "dead") buildPassage({ def: { id: `${s.id}dead${i}`, r: [Math.min(X(0), X(-0.2)), -0.55, Math.max(X(0), X(-0.2)), 0.55], z: l.z, head: DOOR_H, fire: true, side: dir, zones: [zone, zone], dead: true }, off: [0, 0, 0], copy: false });
      panel(acc(signMat(`floor${l.label}`, floorTex(l.label))), X(0.012), 1.0, l.z + 1.55, dir > 0 ? 0 : 180, 0.5, 0.36, st);
      if (l.locked) panel(acc(signMat(`lock${l.label}`, noticeTex(l.locked, "#f4f1e8", "#b3261e"))), X(0.02), 0, l.z + 1.45, dir > 0 ? 0 : 180, 0.42, 0.26, st);
      box(acc(M.bulkhead), Math.min(X(0.005), X(0.06)), -0.14, l.z + 2.3, Math.max(X(0.005), X(0.06)), 0.14, l.z + 2.4, st);
      LIGHTS.push({ x: X(0.35), y: 0, z: l.z + 2.3, I: 2.0 * f, col: [0.95, 0.97, 1.0], zone, down: false, s2: 0.35 });
      if (walkable(l.z) && (!s.periodic || Math.abs(l.k) <= 1)) SURFS.push({ x0: Math.min(X(0), X(1.5)), y0: -1.5, x1: Math.max(X(0), X(1.5)), y1: 1.5, z0: l.z, z1: l.z, ax: null });
      if (i === lv.length - 1) return;
      const za = l.z, zm = za - FH / 2, zb = lv[i + 1].z;
      flight(s, 0.2, 1.5, X(1.5), za, dir, st);
      flight(s, -1.5, -0.2, X(4.6), zm, -dir, st);
      box(acc(M.concrete), Math.min(X(4.6), X(6.2)), -1.5, zm - 0.25, Math.max(X(4.6), X(6.2)), 1.5, zm, st);
      rails(s, za, zm, zb, st);
      box(acc(M.bulkhead), Math.min(X(6.14), X(6.195)), -0.14, zm + 2.2, Math.max(X(6.14), X(6.195)), 0.14, zm + 2.3, st);
      LIGHTS.push({ x: X(5.85), y: 0, z: zm + 2.2, I: 1.8 * f, col: [0.95, 0.97, 1.0], zone, down: false, s2: 0.35 });
      if (s.periodic ? l.k === 1 || l.k === 0 : walkable(za)) {
        SURFS.push(ramp(X(1.5), X(4.6), za, zm, 0.2, 1.5));
        SURFS.push({ x0: Math.min(X(4.6), X(6.2)), y0: -1.5, x1: Math.max(X(4.6), X(6.2)), y1: 1.5, z0: zm, z1: zm, ax: null });
        SURFS.push(ramp(X(4.6), X(1.5), zm, zb, -1.5, -0.2));
      }
    });
    if (s.gate) gate(s, st, zone);
  }
  const ramp = (xa, xb, za, zb, y0, y1) => (xa < xb ? { x0: xa, x1: xb, z0: za, z1: zb, y0, y1, ax: "x" } : { x0: xb, x1: xa, z0: zb, z1: za, y0, y1, ax: "x" });
  /* 12 risers of 0.15 m, 11 treads of 0.28 m, from xa (at za) descending along dx, with a yellow nosing on each tread and a sloped soffit. */
  function flight(s, ya, yb, xa, za, dx, st) {
    for (let i = 0; i < 11; i++) {
      const top = za - 0.15 * (i + 1), p = xa + dx * 0.28 * i, q = xa + dx * 0.28 * (i + 1);
      box(acc(M.concrete), Math.min(p, q), ya, top - 0.3, Math.max(p, q), yb, top, st);
      const e = q - dx * 0.05;
      box(acc(M.nosing), Math.min(e, q), ya + 0.04, top, Math.max(e, q), yb - 0.04, top + 0.004, st);
    }
    const p0 = [xa, 0, za - 0.45], p1 = [xa + dx * 3.08, 0, za - FH / 2 - 0.3];
    const U = norm([p1[0] - p0[0], 0, p1[2] - p0[2]]), V = [0, dx > 0 ? -1 : 1, 0];
    grid(acc(M.concrete), [p0[0], dx > 0 ? yb : ya, p0[2]], U, V, one(Math.hypot(p1[0] - p0[0], p1[2] - p0[2])), one(yb - ya), (u, v) => [u, v], st);
  }
  function rails(s, za, zm, zb, st) {
    const X = (t) => sx(s, t), dir = s.dir;
    const run = (y, x0, z0, x1, z1, dx) => {
      beam(acc(M.rail), [x0, y, z0 + 0.9], [x1, y, z1 + 0.9], 0.045, 0.045, st);
      for (let t = 0.07; t < 3.1; t += 0.14) {
        const x = x0 + dx * t, tread = z0 - 0.15 * (Math.floor(t / 0.28) + 1), top = z0 + 0.9 - ((z0 - z1) * t) / 3.1;
        box(acc(M.rail), x - 0.009, y - 0.009, tread, x + 0.009, y + 0.009, top, st);
      }
    };
    run(0.22, X(1.5), za, X(4.6), zm, dir);
    run(-0.22, X(4.6), zm, X(1.5), zb, -dir);
    beam(acc(M.rail), [X(4.6), 0.22, zm + 0.9], [X(4.6), -0.22, zm + 0.9], 0.045, 0.045, st);
    beam(acc(M.rail), [X(1.5), 0.22, za + 0.9], [X(1.5), -0.22, za + 0.9], 0.045, 0.045, st);
    [0.22, -0.22].forEach((y) => box(acc(M.rail), X(4.6) - 0.012, y - 0.012, zm, X(4.6) + 0.012, y + 0.012, zm + 0.9, st));
  }
  /* Locked bar gate across the flight that leads up from B1. */
  function gate(s, st, zone) {
    const X = (t) => sx(s, t), x = X(1.42), y0 = -1.5, y1 = -0.24;
    for (let y = y0 + 0.06; y < y1; y += 0.11) box(acc(M.rail), x - 0.01, y - 0.01, 0, x + 0.01, y + 0.01, 1.9, st);
    [0.08, 0.95, 1.85].forEach((z) => box(acc(M.rail), x - 0.015, y0, z, x + 0.015, y1, z + 0.035, st));
    box(acc(M.yellow), x - (s.dir > 0 ? 0.07 : 0.03), -0.42, 0.98, x + (s.dir > 0 ? 0.03 : 0.07), -0.36, 1.06, st);
    panel(acc(signMat("gate", noticeTex("通往 1F\n夜间封闭", "#f4f1e8", "#b3261e"))), x - s.dir * 0.03, (y0 + y1) / 2, 1.38, s.dir > 0 ? 180 : 0, 0.42, 0.26, st);
    seg(x, y0, x, -0.2, 0, 2.0, zone, { coll: true });
  }

  // ---------------------------------------------------------------- furniture, signs and other room details (built per room instance, so copies match)
  const B1P = { k: "prop", zone: "B1" }, B3P = { k: "prop", zone: "B3" };
  function roomDoor(o, d) {
    const z = d.z || 0, x = d.x + o[0], y = d.y + o[1], f = d.facing, sp = z < -5 ? B3P : B1P, w = d.wide ? 0.72 : 0.47;
    const leafMat = d.steel ? M.metalDoor : M.wood;
    if (d.wide) { wallBox(acc(leafMat), x, y, f, -w, -0.01, 0.0, 0.045, z, z + 2.05, sp, 2.05); wallBox(acc(leafMat), x, y, f, 0.01, w, 0.0, 0.045, z, z + 2.05, sp, 2.05); }
    else wallBox(acc(leafMat), x, y, f, -w, w, 0.0, 0.045, z, z + 2.05, sp, 2.05);
    wallBox(acc(M.frame), x, y, f, -w - 0.06, -w, 0, 0.06, z, z + 2.12, sp);
    wallBox(acc(M.frame), x, y, f, w, w + 0.06, 0, 0.06, z, z + 2.12, sp);
    wallBox(acc(M.frame), x, y, f, -w - 0.06, w + 0.06, 0, 0.06, z + 2.05, z + 2.12, sp);
    wallBox(acc(M.steel), x, y, f, w - 0.2, w - 0.08, 0.045, 0.1, z + 1.0, z + 1.035, sp);
    wallBox(acc(M.steel), x, y, f, w - 0.11, w - 0.08, 0.045, 0.07, z + 0.95, z + 1.07, sp);
    const fc = Math.round(Math.cos(rad(f))), fs = Math.round(Math.sin(rad(f)));
    const at = (t, n) => [x - fs * t + fc * n, y + fc * t + fs * n];
    const tex = d.steel ? steelSignTex(d.label, d.sub || "") : plateTex(d.label, d.sub), mat = signMat(`plate${d.id}`, tex);
    const [px, py] = at(d.wide ? -0.36 : 0, 0.049);
    panel(acc(mat), px, py, z + 1.58, f, d.steel ? 0.36 : 0.3, d.steel ? 0.13 : 0.14, sp);
    // a flag sign sticking out above the door, readable from along the corridor
    wallBox(acc(M.white), x, y, f, w + 0.12, w + 0.135, 0.02, 0.36, z + 2.06, z + 2.25, sp);
    [1, -1].forEach((k) => { const [qx, qy] = at(w + 0.1275 + k * 0.0085, 0.19); panel(acc(mat), qx, qy, z + 2.155, f + 90 * k, 0.32, 0.15, sp); });
    if (!d.clock) return;
    wallBox(acc(M.steel), x, y, f, 0.78, 0.94, 0, 0.055, z + 1.22, z + 1.44, sp);
    const [sx2, sy2] = at(0.86, 0.056);
    panel(acc(M.screen, false), sx2, sy2, z + 1.37, f, 0.11, 0.05, sp);
    const led = acc(M.ledRed, true);
    wallBox(led, x, y, f, 0.83, 0.85, 0.055, 0.062, z + 1.28, z + 1.3, sp);
    (LEDS[d.id] = LEDS[d.id] || []).push(led);
    if ((d.id === "arch" && TK.kind === "fetch") || (TK.item && TK.item[0] === "folder" && d.node === TK.item[1])) {
      wallBox(acc(M.steel), x, y, f, -0.95, -0.62, 0, 0.16, z + 1.0, z + 1.03, sp);
      wallBox(acc(M.steel), x, y, f, -0.95, -0.62, 0.14, 0.16, z + 1.03, z + 1.12, sp);
      const fo = acc(M.blue, true);
      wallBox(fo, x, y, f, -0.9, -0.67, 0.03, 0.06, z + 1.03, z + 1.33, sp);
      FOLDER.push(fo);
    }
  }
  function hydrant(o, x, y, f) {
    x += o[0]; y += o[1];
    wallBox(acc(M.red), x, y, f, -0.38, 0.38, 0, 0.07, 0.5, 1.45, B1P);
    wallBox(acc(M.glassDark), x, y, f, -0.3, 0.3, 0.07, 0.075, 0.62, 1.33, B1P);
    const c = Math.round(Math.cos(rad(f))), s = Math.round(Math.sin(rad(f)));
    panel(acc(signMat("hyd", wordTex("消火栓", "#ffffff", 120))), x + c * 0.077, y + s * 0.077, 1.2, f, 0.42, 0.075, B1P);
  }
  function extBox(o, x, y, f) {
    x += o[0]; y += o[1];
    wallBox(acc(M.red), x, y, f, -0.22, 0.22, 0, 0.2, 0, 0.62, B1P);
    const c = Math.round(Math.cos(rad(f))), s = Math.round(Math.sin(rad(f)));
    panel(acc(signMat("ext", wordTex("灭火器箱", "#ffffff", 120))), x + c * 0.202, y + s * 0.202, 0.48, f, 0.32, 0.056, B1P);
  }
  function bin(o, x, y) { x += o[0]; y += o[1]; tube(acc(M.chair), [x, y, 0], [x, y, 0.62], 0.16, 14, B1P, true); }
  function wetSign(o, x, y, ang) {
    x += o[0]; y += o[1];
    const c = Math.cos(rad(ang)), s = Math.sin(rad(ang)), mat = acc(M.yellow);
    [-1, 1].forEach((k) => {
      const bx = x + c * 0.12 * k, by = y + s * 0.12 * k, U = [-s, c, 0], tilt = [c * 0.25 * k, s * 0.25 * k, 0.97];
      const V = norm(tilt.map((v, i) => (i === 2 ? v : -v)));
      grid(mat, [bx - U[0] * 0.15, by - U[1] * 0.15, 0], U, V, one(0.3), one(0.62), (u, v) => [u, v], B1P);
      grid(mat, [bx + U[0] * 0.15, by + U[1] * 0.15, 0], U.map((v) => -v), V, one(0.3), one(0.62), (u, v) => [u, v], B1P);
    });
    panel(acc(signMat("wet", noticeTex("小心\n地滑", "#e0b31c", "#1a1a1a"))), x + c * 0.16, y + s * 0.16, 0.36, ang, 0.2, 0.13, B1P);
  }
  function plant(o, x, y) {
    x += o[0]; y += o[1];
    tube(acc(M.pot), [x, y, 0], [x, y, 0.42], 0.2, 14, B1P, true);
    const r = rng(hash(`p${x}`));
    for (let i = 0; i < 9; i++) {
      const a = r() * 6.28, l = 0.25 + 0.3 * r();
      beam(acc(M.plant), [x, y, 0.4], [x + Math.cos(a) * l, y + Math.sin(a) * l, 0.8 + 0.6 * r()], 0.05, 0.02, B1P);
    }
  }
  function dispenser(o, x, y, f) {
    x += o[0]; y += o[1];
    box(acc(M.white), x - 0.16, y - 0.16, 0, x + 0.16, y + 0.16, 1.0, B1P);
    tube(acc(M.bottle), [x, y, 1.0], [x, y, 1.45], 0.13, 14, B1P, true);
    const c = Math.round(Math.cos(rad(f))), s = Math.round(Math.sin(rad(f)));
    box(acc(M.blue), x + c * 0.16 - 0.03, y + s * 0.16 - 0.03, 0.82, x + c * 0.16 + 0.03, y + s * 0.16 + 0.03, 0.86, B1P);
  }
  function exitSign(o, x, y, z, f, text) {
    x += o[0]; y += o[1];
    wallBox(acc(M.white), x, y, f, -0.2, 0.2, 0, 0.04, z - 0.085, z + 0.085, B1P);
    const c = Math.round(Math.cos(rad(f))), s = Math.round(Math.sin(rad(f)));
    panel(acc(signMat(`exit${text}`, exitTex(text), 1.35)), x + c * 0.041, y + s * 0.041, z, f, 0.38, 0.145, B1P);
  }
  function wallWord(o, x, y, z, f, text, w, h, color, px) {
    x += o[0]; y += o[1];
    const c = Math.round(Math.cos(rad(f))), s = Math.round(Math.sin(rad(f)));
    const m = signMat(`word${text}${color}`, wordTex(text, color, px || 120));
    m.transparent = true; m.alphaTest = 0.4;
    panel(acc(m), x + c * 0.006, y + s * 0.006, z, f, w, h, B1P);
  }
  function lobbyFurniture(o) {
    const X = (x) => x + o[0], Y = (y) => y + o[1];
    box(acc(M.desk), X(0.6), Y(-3.6), 0, X(3.4), Y(-2.82), 1.02, B1P);
    box(acc(M.desk), X(2.72), Y(-4.45), 0, X(3.4), Y(-3.6), 1.02, B1P);
    box(acc(M.deskTop), X(0.55), Y(-3.66), 1.02, X(3.46), Y(-2.76), 1.06, B1P);
    box(acc(M.deskTop), X(2.66), Y(-4.47), 1.02, X(3.46), Y(-3.66), 1.06, B1P);
    panel(acc(signMat("desk", plateTex("值班台", "DUTY"))), X(2.0), Y(-2.815), 0.72, 90, 0.5, 0.235, B1P);
    box(acc(M.dark), X(1.62), Y(-3.5), 1.06, X(2.12), Y(-3.44), 1.4, B1P);
    panel(acc(M.screen, false), X(1.87), Y(-3.436), 1.24, 90, 0.44, 0.28, B1P);
    box(acc(M.dark), X(1.8), Y(-3.55), 1.06, X(1.94), Y(-3.45), 1.12, B1P);
    box(acc(M.chair), X(0.95), Y(-3.4), 1.06, X(1.22), Y(-3.2), 1.12, B1P);
    box(acc(M.white), X(2.3), Y(-3.3), 1.06, X(2.62), Y(-3.05), 1.08, B1P);
    tube(acc(M.dark), [X(3.1), Y(-3.35), 1.06], [X(3.1), Y(-3.35), 1.42], 0.015, 6, B1P);
    tube(acc(M.yellow), [X(3.1), Y(-3.35), 1.4], [X(3.1), Y(-3.2), 1.47], 0.06, 10, B1P, true);
    box(acc(M.chair), X(1.75), Y(-4.25), 0.45, X(2.25), Y(-3.8), 0.52, B1P);
    box(acc(M.chair), X(1.75), Y(-4.32), 0.52, X(2.25), Y(-4.25), 1.0, B1P);
    tube(acc(M.rail), [X(2.0), Y(-4.02), 0.05], [X(2.0), Y(-4.02), 0.45], 0.025, 8, B1P);
    [-3.1, -1.3].forEach((ex) => {
      box(acc(M.steel), X(ex - 0.55), Y(-4.5), 0, X(ex + 0.55), Y(-4.47), 2.15, B1P);
      box(acc(M.frame), X(ex - 0.62), Y(-4.5), 0, X(ex - 0.55), Y(-4.44), 2.25, B1P);
      box(acc(M.frame), X(ex + 0.55), Y(-4.5), 0, X(ex + 0.62), Y(-4.44), 2.25, B1P);
      box(acc(M.frame), X(ex - 0.62), Y(-4.5), 2.15, X(ex + 0.62), Y(-4.44), 2.25, B1P);
      box(acc(M.dark), X(ex - 0.004), Y(-4.47), 0, X(ex + 0.004), Y(-4.465), 2.15, B1P);
      panel(acc(signMat("lift", noticeTex("检修中\n暂停使用", "#e8b923", "#1a1a1a"))), X(ex), Y(-4.464), 1.45, 90, 0.42, 0.26, B1P);
      box(acc(M.dark), X(ex - 0.2), Y(-4.5), 2.33, X(ex + 0.2), Y(-4.46), 2.45, B1P);
    });
    box(acc(M.steel), X(-2.28), Y(-4.5), 1.0, X(-2.12), Y(-4.47), 1.3, B1P);
    wallWord(o, -2.2, -4.5, 2.52, 90, "B1  电梯厅", 1.9, 0.33, "#3a3424", 110);
    plant(o, -3.85, 3.85);
    dispenser(o, 3.95, 3.7, 180);
    box(acc(M.wood), X(-4.45), Y(1.5), 0.42, X(-4.0), Y(3.3), 0.47, B1P);
    [1.6, 3.2].forEach((by) => box(acc(M.rail), X(-4.4), Y(by - 0.04), 0, X(-4.05), Y(by + 0.04), 0.42, B1P));
    exitSign(o, -4.5, 0, 2.3, 0, "西楼梯");
    exitSign(o, 4.5, 0, 2.55, 180, "东楼梯");
  }
  function stains(o, ri) {
    const d = ri.def, r = rng(hash(d.id));
    const [x0, y0, x1, y1] = d.r, n = Math.round(((x1 - x0) * (y1 - y0)) / 26);
    for (let i = 0; i < n; i++) {
      const x = x0 + 0.4 + r() * (x1 - x0 - 0.8), y = y0 + 0.4 + r() * (y1 - y0 - 0.8);
      decal(acc(M.stain), x + o[0], y + o[1], (d.z || 0) + 0.002, r() * 360, 0.6 + 1.4 * r(), 0.6 + 1.4 * r(), { k: "floor", zone: d.b3 ? "B3" : "B1", zF: d.z, zC: d.z + d.h });
    }
  }
  /* The patrol route taped on the floor (only in the fetch task). Each arrow belongs to the room it lies in. */
  const ARROWS = [];
  (function arrowSpots() {
    if (TK.kind !== "fetch") return;
    const line = (x0, y0, x1, y1, step, first) => {
      const L = Math.hypot(x1 - x0, y1 - y0), ang = N.headingOf(x1 - x0, y1 - y0);
      for (let t = first; t <= L - 0.5; t += step) ARROWS.push([x0 + ((x1 - x0) * t) / L, y0 + ((y1 - y0) * t) / L, ang]);
    };
    line(0, 1.4, 0, 34, 3, 0);
    line(0, 34, 30, 34, 3, 0);
    line(30, 34, 30, 0, 3, 0);
    line(30, 0, IMP ? 26.05 : 4.7, 0, 3, 0);
    line(4.2, 0, 1.9, -1.9, 2.2, 0.3);
  })();
  function arrowsIn(o, ri) {
    const [x0, y0, x1, y1] = ri.def.r;
    ARROWS.forEach(([x, y, ang]) => { if (x >= x0 && x < x1 && y >= y0 && y < y1) decal(acc(M.arrow), x + o[0], y + o[1], 0.004, ang, 0.42, 0.84, { k: "floor", zone: "B1", zF: 0, zC: CEIL }); });
  }
  const doorsIn = (id) => (o) => DOORS.filter((d) => d.room === id).forEach((d) => roomDoor(o, d));
  /* Square column from floor to ceiling, papered like the walls; it also blocks light and walking. */
  function pillar(o, x, y, s) {
    x += o[0]; y += o[1];
    const h = s / 2, c = [[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]];
    const rows = [0, 0.12, 0.45, 1.0, 1.7, 2.3, 2.55, CEIL];
    c.forEach((p, i) => {
      const q = c[(i + 1) % 4], U = norm([q[0] - p[0], q[1] - p[1], 0]), L = s;
      grid(acc(M.wall), [p[0], p[1], 0], U, [0, 0, 1], steps(L, 0.3), rows, (u, v) => [(i * s + u) / WALL_U, v / CEIL],
        { k: "wall", zone: "B1", zF: 0, zC: CEIL, ux: U[0], uy: U[1] });
      seg(p[0], p[1], q[0], q[1], 0, CEIL, "B1");
    });
    box(acc(M.base), x - h - 0.014, y - h - 0.014, 0, x + h + 0.014, y + h + 0.014, 0.1, B1P);
  }
  /* A doorway that was walled over: the steel frame is still there, the opening is plastered flush. */
  function sealedDoor(o, x, y, f) {
    x += o[0]; y += o[1];
    wallBox(acc(M.infill), x, y, f, -0.47, 0.47, 0, 0.008, 0, 2.05, B1P);
    wallBox(acc(M.frame), x, y, f, -0.53, -0.47, 0, 0.05, 0, 2.12, B1P);
    wallBox(acc(M.frame), x, y, f, 0.47, 0.53, 0, 0.05, 0, 2.12, B1P);
    wallBox(acc(M.frame), x, y, f, -0.53, 0.53, 0, 0.05, 2.05, 2.12, B1P);
    wallBox(acc(M.white), x, y, f, 0.68, 0.76, 0, 0.012, 1.25, 1.37, B1P);
  }
  /* A plastic chair; `f` is the way it faces. */
  function chair(o, x, y, f) {
    x += o[0]; y += o[1];
    const c = Math.cos(rad(f)), s = Math.sin(rad(f)), at = (a, b) => [x + c * a - s * b, y + s * a + c * b];
    box(acc(M.chair), x - 0.22, y - 0.22, 0.43, x + 0.22, y + 0.22, 0.47, B1P);
    const [bx, by] = at(-0.21, 0);
    box(acc(M.chair), Math.min(bx, bx - c * 0.03) - Math.abs(s) * 0.22, Math.min(by, by - s * 0.03) - Math.abs(c) * 0.22, 0.47,
      Math.max(bx, bx - c * 0.03) + Math.abs(s) * 0.22, Math.max(by, by - s * 0.03) + Math.abs(c) * 0.22, 0.9, B1P);
    [[-0.19, -0.19], [0.19, -0.19], [0.19, 0.19], [-0.19, 0.19]].forEach(([a, b]) => box(acc(M.rail), x + a - 0.012, y + b - 0.012, 0, x + a + 0.012, y + b + 0.012, 0.43, B1P));
  }
  /* A ceiling tile gone: a black hole in the grid, and (optionally) the tile lying on the carpet below. */
  function missingTile(o, x0, y0, fallen) {
    const x = x0 + o[0], y = y0 + o[1];
    grid(acc(M.void), [x, y, CEIL - 0.003], [0, 1, 0], [1, 0, 0], one(0.6), one(0.6), (u, v) => [u, v], B1P);
    if (!fallen) return;
    const a = rad(23), U = [Math.cos(a), Math.sin(a), 0], V = [-Math.sin(a), Math.cos(a), 0], cx = x + 0.3 + fallen[0], cy = y + 0.3 + fallen[1];
    grid(acc(M.ceil), [cx - (U[0] + V[0]) * 0.3, cy - (U[1] + V[1]) * 0.3, 0.018], U, V, one(0.6), one(0.6), (u, v) => [u / 2.4, v / 2.4], { k: "floor", zone: "B1", zF: 0, zC: CEIL });
  }
  function outlet(o, x, y, f) { wallBox(acc(M.white), x + o[0], y + o[1], f, -0.05, 0.05, 0, 0.018, 0.27, 0.39, B1P); }

  // ---------------------------------------------------------------- mechanisms in the scene: moving parts are meshes of their own, listed in MV and updated by refreshMech()
  const MV = { lever: {}, lamp: {}, curtain: [], items: [], wedge: [], water: null };
  const B1F = { k: "floor", zone: "B1", zF: 0, zC: CEIL }, SEP = { k: "stair", zone: "SE" };
  const reg = (map, id, v) => { (map[id] = map[id] || []).push(v); return v; };
  const own = (mat, group) => { const a = acc(mat, true); if (group) { a.parent = group; a.pivot = [0, 0, 0]; } return a; };
  const wallAt = (x, y, f) => { const c = Math.round(Math.cos(rad(f))), s = Math.round(Math.sin(rad(f))); return (t, n) => [x - s * t + c * n, y + c * t + s * n]; };
  /* Fire shutter curtain, built down; its group lifts it by h into the roller box. axis "x": it spans x s0..s1 at y = c, "y": y s0..s1 at x = c. */
  function shutter(id, axis, c, s0, s1, h) {
    const group = new THREE.Group();
    scene.add(group);
    const slab = (a, d, z0, z1) => (axis === "x" ? box(a, s0, c - d, z0, s1, c + d, z1, B1P, 1.3) : box(a, c - d, s0, z0, c + d, s1, z1, B1P, 1.3));
    slab(own(M.shutter, group), 0.02, 0.07, h);
    slab(own(M.dark, group), 0.035, 0, 0.07);
    MV.curtain.push({ id, group, h, cur: 0, target: 0 });
  }
  /* Roller box over an opening and the two guide rails, on one face of the wall. */
  function shutterFrame(x, y, f, half, head) {
    wallBox(acc(M.steel), x, y, f, -half - 0.12, half + 0.12, 0, 0.24, head, CEIL, B1P);
    [-half - 0.07, half + 0.01].forEach((t) => wallBox(acc(M.steel), x, y, f, t, t + 0.06, 0, 0.07, 0, head, B1P));
  }
  function lobbyMech(o) {
    const X = (x) => x + o[0], Y = (y) => y + o[1];
    shutter("north", "x", Y(4.6), X(-0.85), X(0.85), 2.4);
    shutter("east", "y", X(4.6), Y(-0.85), Y(0.85), 2.4);
    shutterFrame(X(0), Y(4.5), 270, 0.8, 2.4);
    shutterFrame(X(4.5), Y(0), 180, 0.8, 2.4);
    decal(acc(M.hazard), X(0), Y(4.36), 0.005, 0, 0.2, 1.6, B1F);
    decal(acc(M.hazard), X(4.36), Y(0), 0.005, 90, 0.2, 1.6, B1F);
    breakerPanel(o);
    shutterButton(o, "btnN", 1.5, 4.5, 270, "北门卷帘");
    shutterButton(o, "btnE", 4.5, -1.5, 180, "东门卷帘");
  }
  /* B1 breaker panel on the lobby's north wall: open in the shutter task, locked everywhere else. Up = on. */
  function breakerPanel(o) {
    const x = 2.55 + o[0], y = 4.5 + o[1], f = 270, at = wallAt(x, y, f);
    wallBox(acc(M.panelGrey), x, y, f, -0.5, 0.5, 0, 0.13, 1.1, 1.98, B1P);
    if (TK.mech !== "shutter") {
      wallBox(acc(M.panelGrey), x, y, f, -0.48, 0.48, 0.13, 0.142, 1.12, 1.96, B1P);
      const [px, py] = at(0, 0.144);
      panel(acc(signMat("panelShut", fitTex("配电箱\n非电工请勿操作", "#f4f1e8", "#b3261e", 400, 240))), px, py, 1.62, f, 0.4, 0.24, B1P);
      wallBox(acc(M.dark), x, y, f, 0.36, 0.41, 0.142, 0.17, 1.4, 1.5, B1P);
      return;
    }
    wallBox(acc(M.dark), x, y, f, -0.47, 0.47, 0.13, 0.133, 1.13, 1.95, B1P);
    const [tx, ty] = at(0, 0.135);
    panel(acc(signMat("panelB1", fitTex("B1 配电箱 · 最多同时合两路", "#e0b31c", "#1a1a1a", 1000, 120))), tx, ty, 1.86, f, 0.86, 0.1, B1P);
    [1, 2, 3, 4, 0].forEach((k, i) => {
      const t = -0.36 + i * 0.18, id = k ? `br${k}` : "main", mat = k ? M.lever : M.leverMain;
      wallBox(acc(M.white), x, y, f, t - 0.055, t + 0.055, 0.133, 0.19, 1.4, 1.64, B1P);
      const up = own(mat), dn = own(mat);
      wallBox(up, x, y, f, t - 0.022, t + 0.022, 0.19, 0.24, 1.54, 1.61, B1P);
      wallBox(dn, x, y, f, t - 0.022, t + 0.022, 0.19, 0.24, 1.43, 1.5, B1P);
      reg(MV.lever, id, { up, dn });
      wallBox(reg(MV.lamp, id, own(M.lampOff)), x, y, f, t - 0.022, t + 0.022, 0.133, 0.15, 1.69, 1.74, B1P);
      const [lx, ly] = at(t, 0.135);
      panel(acc(signMat(`brl${k}`, fitTex(k ? `${k}\n${BR_NAMES[k]}` : "总闸", "#f3f1e7", "#1d1d1b", 200, 150))), lx, ly, 1.27, f, 0.16, 0.12, B1P);
    });
  }
  function shutterButton(o, id, x, y, f, label) {
    x += o[0]; y += o[1];
    const [px, py] = wallAt(x, y, f)(0, 0.004);
    wallBox(acc(M.steel), x, y, f, -0.1, 0.1, 0, 0.06, 1.18, 1.48, B1P);
    wallBox(acc(M.btn), x, y, f, -0.035, 0.035, 0.06, 0.085, 1.26, 1.33, B1P);
    wallBox(reg(MV.lamp, id, own(M.lampOff)), x, y, f, -0.02, 0.02, 0.06, 0.07, 1.39, 1.43, B1P);
    panel(acc(signMat(`btn${id}`, fitTex(`${label}\n按下升起`, "#f3f1e7", "#1d1d1b", 300, 160))), px, py, 1.62, f, 0.3, 0.16, B1P);
  }
  /* The shutter across corridor C between the archive and the print room: up, except in the shutter task, where it is stuck down. */
  function cShutter() {
    box(acc(M.steel), 28.8, 20.62, 2.36, 31.2, 20.98, CEIL, B1P);
    [28.8, 31.13].forEach((x0) => box(acc(M.steel), x0, 20.74, 0, x0 + 0.07, 20.86, 2.36, B1P));
    shutter("broken", "x", 20.8, 28.8, 31.2, 2.36);
    if (TK.mech !== "shutter") return;
    const m = signMat("brokenNote", fitTex("卷帘故障\n维修中 · 禁止通行", "#f4f1e8", "#b3261e", 420, 240));
    panel(acc(m), 30, 20.775, 1.45, 270, 0.75, 0.43, B1P);
    panel(acc(m), 30, 20.825, 1.45, 90, 0.75, 0.43, B1P);
  }
  function closedTape(o) {
    if (TK.mech !== "closed") return;
    const x = 31.17 + o[0], y = o[1];
    beam(acc(M.barrier), [x, y - 0.62, 0.35], [x, y + 0.62, 1.75], 0.004, 0.075, B1P);
    beam(acc(M.barrier), [x, y + 0.62, 0.35], [x, y - 0.62, 1.75], 0.004, 0.075, B1P);
  }
  /* B3 box by the switch-room door: exhaust fan and pump switches (only one may be on) and a reset button; locked outside the pump task. */
  function b3Box() {
    const x = 8.2, y = HW, z = B3Z, f = 270, at = wallAt(x, y, f);
    wallBox(acc(M.panelGrey), x, y, f, -0.34, 0.34, 0, 0.13, z + 1.1, z + 1.9, B3P);
    if (TK.mech !== "pump") {
      wallBox(acc(M.panelGrey), x, y, f, -0.32, 0.32, 0.13, 0.142, z + 1.12, z + 1.88, B3P);
      const [px, py] = at(0, 0.144);
      panel(acc(signMat("panelShut", fitTex("配电箱\n非电工请勿操作", "#f4f1e8", "#b3261e", 400, 240))), px, py, z + 1.6, f, 0.4, 0.24, B3P);
      return;
    }
    wallBox(acc(M.dark), x, y, f, -0.31, 0.31, 0.13, 0.133, z + 1.13, z + 1.87, B3P);
    const [tx, ty] = at(0, 0.135);
    panel(acc(signMat("panelB3", fitTex("B3 配电箱 · 只能开一路", "#e0b31c", "#1a1a1a", 760, 120))), tx, ty, z + 1.78, f, 0.57, 0.09, B3P);
    [["fan", "排风机"], ["pump", "水泵"]].forEach(([id, name], i) => {
      const t = -0.18 + i * 0.18;
      wallBox(acc(M.white), x, y, f, t - 0.055, t + 0.055, 0.133, 0.19, z + 1.36, z + 1.6, B3P);
      const up = own(M.lever), dn = own(M.lever);
      wallBox(up, x, y, f, t - 0.022, t + 0.022, 0.19, 0.24, z + 1.5, z + 1.57, B3P);
      wallBox(dn, x, y, f, t - 0.022, t + 0.022, 0.19, 0.24, z + 1.39, z + 1.46, B3P);
      reg(MV.lever, id, { up, dn });
      wallBox(reg(MV.lamp, id, own(M.lampOff)), x, y, f, t - 0.022, t + 0.022, 0.133, 0.15, z + 1.65, z + 1.7, B3P);
      const [lx, ly] = at(t, 0.135);
      panel(acc(signMat(`b3l${id}`, fitTex(name, "#f3f1e7", "#1d1d1b", 200, 120))), lx, ly, z + 1.25, f, 0.15, 0.09, B3P);
    });
    wallBox(acc(M.red), x, y, f, 0.16, 0.24, 0.133, 0.17, z + 1.44, z + 1.52, B3P);
    wallBox(reg(MV.lamp, "box", own(M.lampOff)), x, y, f, 0.178, 0.222, 0.133, 0.15, z + 1.65, z + 1.7, B3P);
    const [rx, ry] = at(0.2, 0.135);
    panel(acc(signMat("b3lreset", fitTex("复位", "#f3f1e7", "#1d1d1b", 200, 120))), rx, ry, z + 1.25, f, 0.15, 0.09, B3P);
  }
  /* Flood in front of the pump room (pump task): sandbags at x 5.2–5.75 hold the water on the west side; the water's group sets its level. */
  function flood() {
    [[-1.2, -0.4], [-0.4, 0.4], [0.4, 1.2]].forEach(([a, b]) => box(acc(M.burlap), 5.22, a + 0.02, B3Z, 5.74, b - 0.02, B3Z + 0.23, B3P));
    [[-1.2, -0.8], [-0.8, 0], [0, 0.8], [0.8, 1.2]].forEach(([a, b]) => box(acc(M.burlap), 5.27, a + 0.02, B3Z + 0.23, 5.69, b - 0.02, B3Z + 0.45, B3P));
    panel(acc(signMat("gauge", gaugeTex())), 4.95, HW - 0.004, B3Z + 0.3, 270, 0.2, 0.6, B3P);
    const group = new THREE.Group();
    scene.add(group);
    grid(own(M.water, group), [-7.7, -HW, 0], [1, 0, 0], [0, 1, 0], one(12.92), one(2 * HW), (u, v) => [u / 1.6, v / 1.6], B3P);
    // the bulbs' reflections, stretched toward someone looking down the corridor
    [-7.5, -2.5, 2.5].forEach((x) => grid(own(M.glint, group), [x - 1.1, -0.1, 0.002], [1, 0, 0], [0, 1, 0], one(2.2), one(0.2), (u, v) => [u, v], B3P));
    MV.water = group;
  }
  /* What the carry tasks pick up, and the wedge hanging by the B3 door of the east stairwell. */
  function mechProps() {
    if (TK.item && TK.item[0] === "extinguisher") {
      // against the wall 1.6 m beside the door it belongs to (the print room's unless the seed moved it)
      const d = DOOR_AT[TK.item[1]], a = rad(d.facing + 90), f = rad(d.facing);
      const ax = d.x + Math.cos(a) * 1.6, ay = d.y + Math.sin(a) * 1.6;
      MV.items.push(own(M.red), own(signMat("ext", wordTex("灭火器箱", "#ffffff", 120))));
      wallBox(MV.items[0], ax, ay, d.facing, -0.22, 0.22, 0, 0.2, 0, 0.62, B1P);
      panel(MV.items[1], ax + Math.cos(f) * 0.202, ay + Math.sin(f) * 0.202, 0.48, d.facing, 0.32, 0.056, B1P);
    }
    if (TK.item && TK.item[0] === "fuse") {
      MV.items.push(own(M.card), own(signMat("fuse", fitTex("备用保险丝", "#efe6d2", "#7a1f16", 300, 110))));
      box(MV.items[0], 9.0, 0.72, B3Z, 9.32, 1.0, B3Z + 0.18, B3P);
      panel(MV.items[1], 9.16, 0.716, B3Z + 0.1, 270, 0.28, 0.1, B3P);
    }
    if (TK.mech === "pump") flood();
    if (TK.mech === "wedge") {
      MV.wedge.push(own(M.rubber), own(M.steel), own(signMat("wedgeTag", fitTex("门挡", "#f3f1e7", "#1d1d1b", 160, 100))));
      wallBox(MV.wedge[0], 31.4, 1.0, 0, -0.07, 0.07, 0.01, 0.07, B3Z + 0.86, B3Z + 0.95, SEP);
      wallBox(MV.wedge[1], 31.4, 1.0, 0, -0.008, 0.008, 0, 0.08, B3Z + 0.95, B3Z + 0.965, SEP);
      panel(MV.wedge[2], 31.402, 1.0, B3Z + 0.77, 0, 0.12, 0.075, SEP);
    }
  }
  const DECOR = {
    lobby: [(o) => lobbyFurniture(o), (o) => outlet(o, -4.5, -2.5, 0), (o) => outlet(o, 4.5, 2.6, 180), (o) => lobbyMech(o)],
    vest: [(o) => exitSign(o, -7.7, 0, 2.3, 0, "西楼梯"), (o) => extBox(o, -5.3, 1.2, 270)],
    A1: [doorsIn("A1"), (o) => bin(o, -0.92, 6.4), (o) => outlet(o, HW, 9, 180), (o) => shutterFrame(o[0], 4.7 + o[1], 90, 0.8, 2.4)],
    S: [(o) => shutterFrame(26 + o[0], o[1], 0, 0.8, 2.4)],
    A2: [doorsIn("A2"), (o) => hydrant(o, HW, 19, 180), (o) => extBox(o, HW, 20.15, 180), (o) => missingTile(o, 0, 20.4),
      (o) => outlet(o, -HW, 17, 0), (o) => outlet(o, -HW, 27.5, 0)],
    K1: [(o) => pillar(o, 1.1, 36.9, 0.6), (o) => pillar(o, -3.0, 32.0, 0.6), (o) => sealedDoor(o, -4.2, 35.0, 0), (o) => outlet(o, 3.8 - 0.0, 37.4, 180)],
    B: [doorsIn("B"), (o) => hydrant(o, 25.5, 35.2, 270), (o) => wetSign(o, 15.6, 34.35, 0), (o) => bin(o, 6.5, 33.1), (o) => missingTile(o, 12.6, 33.6),
      (o) => outlet(o, 8, 35.2, 270), (o) => outlet(o, 18.5, 32.8, 90)],
    K2: [(o) => pillar(o, 31.5, 36.9, 0.6), (o) => pillar(o, 33.3, 32.0, 0.6), (o) => chair(o, 28.0, 37.3, 90), (o) => missingTile(o, 31.2, 34.8, [0.2, -1.1])],
    C2: [doorsIn("C2"), (o) => outlet(o, 28.8, 20, 0), (o) => outlet(o, 28.8, 26.5, 0), () => cShutter()],
    C1: [(o) => hydrant(o, 28.8, 8.5, 0), (o) => extBox(o, 28.8, 9.65, 0)],
    K3: [(o) => exitSign(o, 31.2, 0, 2.3, 180, "东楼梯"), (o) => closedTape(o)],
    D: [(o) => hydrant(o, 15, -HW, 90), (o) => extBox(o, 16.15, -HW, 90), (o) => shutterFrame(4.7 + o[0], o[1], 0, 0.8, 2.4)],
    B3: [doorsIn("B3"), (o) => b3Details(o), () => b3Box()],
  };
  ROOMS.forEach((r) => { (DECOR[r.id] = DECOR[r.id] || []).push((o, ri) => stains(o, ri), (o, ri) => arrowsIn(o, ri)); });
  function b3Details(o) {
    tube(acc(M.pipe), [-7.6, 0.72, B3Z + 2.38], [31.1, 0.72, B3Z + 2.38], 0.085, 12, B3P);
    tube(acc(M.pipe2), [-7.6, 0.42, B3Z + 2.44], [31.1, 0.42, B3Z + 2.44], 0.05, 10, B3P);
    for (let x = -6; x < 31; x += 3) box(acc(M.rail), x - 0.02, 0.25, B3Z + 2.3, x + 0.02, 1.2, B3Z + 2.6, B3P);
    exitSign(o, 31.2, 0, B3Z + 2.3, 180, "东楼梯");
    exitSign(o, -7.7, 0, B3Z + 2.3, 0, "西楼梯");
    decal(acc(M.stain), 5.5, -0.35, B3Z + 0.003, 30, 1.4, 0.9, { k: "floor", zone: "B3", zF: B3Z, zC: B3Z + 2.6 });
  }

  // ---------------------------------------------------------------- baked lighting: direct light with 2D wall visibility, a little bounce, and contact occlusion
  const AMB = { B1: LOOK === "yellow" ? [0.15, 0.135, 0.095] : [0.14, 0.145, 0.15], B3: [0.035, 0.035, 0.032], SW: [0.05, 0.052, 0.056], SE: [0.05, 0.052, 0.056] };
  const BOUNCE = 0.2;
  let ZL = {}, ZS = {};
  const orient = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  function crosses(ax, ay, bx, by, s) {
    const d1 = orient(s.x0, s.y0, s.x1, s.y1, ax, ay), d2 = orient(s.x0, s.y0, s.x1, s.y1, bx, by);
    if (!((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9))) return false;
    const d3 = orient(ax, ay, bx, by, s.x0, s.y0), d4 = orient(ax, ay, bx, by, s.x1, s.y1);
    return (d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9);
  }
  function visible(ax, ay, bx, by, zone, zm) {
    const list = ZS[zone];
    if (!list) return true;
    const minx = Math.min(ax, bx), maxx = Math.max(ax, bx), miny = Math.min(ay, by), maxy = Math.max(ay, by);
    for (const s of list) {
      if (s.z0 > zm || s.z1 < zm) continue;
      if (Math.max(s.x0, s.x1) < minx || Math.min(s.x0, s.x1) > maxx || Math.max(s.y0, s.y1) < miny || Math.min(s.y0, s.y1) > maxy) continue;
      if (crosses(ax, ay, bx, by, s)) return false;
    }
    return true;
  }
  function segDist(px, py, s) {
    const dx = s.x1 - s.x0, dy = s.y1 - s.y0, L2 = dx * dx + dy * dy;
    const t = L2 ? clamp(((px - s.x0) * dx + (py - s.y0) * dy) / L2, 0, 1) : 0;
    return Math.hypot(px - (s.x0 + t * dx), py - (s.y0 + t * dy));
  }
  function wallDist(px, py, zone, zm, ux, uy) {
    let best = 9;
    for (const s of ZS[zone] || []) {
      if (s.z0 > zm || s.z1 < zm || s.light) continue;
      if (ux !== undefined) {
        const L = Math.hypot(s.x1 - s.x0, s.y1 - s.y0) || 1;
        if (Math.abs(((s.x1 - s.x0) * ux + (s.y1 - s.y0) * uy) / L) > 0.5) continue;
      }
      const d = segDist(px, py, s);
      if (d < best) best = d;
    }
    return best;
  }
  function occlusion(x, y, z, nz, s, zone) {
    if (s.k === "floor") return 1 - 0.42 * Math.exp(-wallDist(x, y, zone, z + 0.5) / 0.32);
    if (s.k === "ceil") return 1 - 0.3 * Math.exp(-wallDist(x, y, zone, z - 0.5) / 0.3);
    if (s.k === "wall") {
      const a = 1 - 0.38 * Math.exp(-(z - s.zF) / 0.2), b = 1 - 0.25 * Math.exp(-(s.zC - z) / 0.16);
      return a * b * (1 - 0.3 * Math.exp(-wallDist(x, y, zone, clamp(z, s.zF + 0.05, s.zC - 0.05), s.ux, s.uy) / 0.22));
    }
    return nz < -0.5 ? 0.72 : 1;
  }
  function bake(x, y, z, nx, ny, nz, s) {
    let zone = s.zone;
    if (s.k === "door2") zone = nx * s.ax[0] + ny * s.ax[1] > 0.5 ? s.zoneP : s.zoneN;
    const amb = AMB[zone], lights = ZL[zone] || [], stairy = zone === "SW" || zone === "SE";
    let r = amb[0], g = amb[1], b = amb[2];
    const ox = x + nx * 0.04, oy = y + ny * 0.04, oz = z + nz * 0.04;
    for (const l of lights) {
      const dx = l.x - ox, dy = l.y - oy, dz = l.z - oz, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 220) continue;
      let vis = 1;
      if (stairy) { const a = Math.abs(dz); vis = a < 1.4 ? 1 : a < 2.8 ? 0.4 : a < 4.2 ? 0.12 : 0.03; }
      else if (!visible(ox, oy, l.x, l.y, zone, (oz + l.z) / 2)) continue;
      const d = Math.sqrt(d2) || 1e-3, fl = l.down ? Math.max(0.1, dz / d) : 1, fs = Math.max(0, (nx * dx + ny * dy + nz * dz) / d);
      const e = (l.I * vis * fl * fs) / (d2 + l.s2) + (l.I * vis * BOUNCE) / (d2 + 3.5);
      r += e * l.col[0]; g += e * l.col[1]; b += e * l.col[2];
    }
    const ao = occlusion(x, y, z, nz, s, zone);
    return [r * ao, g * ao, b * ao];
  }
  function finishMeshes() {
    ZL = {}; ZS = {};
    LIGHTS.forEach((l) => (ZL[l.zone] = ZL[l.zone] || []).push(l));
    SEGS.forEach((s) => { if (!s.coll) (ZS[s.zone] = ZS[s.zone] || []).push(s); });
    const GAIN = LOOK === "yellow" ? 2.3 : 2.2;
    ACCS.forEach((a) => {
      if (!a.p.length) return;
      const n = a.p.length / 3, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { pos[3 * i] = a.p[3 * i]; pos[3 * i + 1] = a.p[3 * i + 2]; pos[3 * i + 2] = -a.p[3 * i + 1]; }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(a.uv, 2));
      if (a.mat.vertexColors) {
        const col = new Float32Array(n * 3), b1 = CAN_DARK ? new Uint8Array(n) : null;
        for (let i = 0; i < n; i++) {
          const s = a.s[i], c = bake(a.p[3 * i], a.p[3 * i + 1], a.p[3 * i + 2], a.n[3 * i], a.n[3 * i + 1], a.n[3 * i + 2], s);
          col[3 * i] = c[0] * GAIN; col[3 * i + 1] = c[1] * GAIN; col[3 * i + 2] = c[2] * GAIN;
          if (b1) b1[i] = (s.k === "door2" ? (a.n[3 * i] * s.ax[0] + a.n[3 * i + 1] * s.ax[1] > 0.5 ? s.zoneP : s.zoneN) : s.zone) === "B1" ? 1 : 0;
        }
        g.setAttribute("color", new THREE.BufferAttribute(col, 3));
        if (b1) { a.lit = col.slice(); a.b1 = b1; }
      }
      g.setIndex(a.idx);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, a.mat);
      if (a.pivot) mesh.position.set(-a.pivot[0], -a.pivot[2], a.pivot[1]);
      mesh.updateMatrix();
      mesh.matrixAutoUpdate = false;
      (a.parent || scene).add(mesh);
      a.mesh = mesh;
    });
  }
  /* B1 without power: its baked light drops to almost nothing; exit signs, clock LEDs and the stairwells' own lights stay on. */
  const CAN_DARK = TK.dark || TK.kind === "fetch" || TK.mech === "shutter";
  let litNow = true;
  function applyPower(force) {
    const lit = b1Lit();
    if (lit === litNow && !force) return;
    litNow = lit;
    const k = lit ? 1 : 0.035;
    ACCS.forEach((a) => {
      if (!a.lit || !a.mesh) return;
      const attr = a.mesh.geometry.attributes.color, arr = attr.array;
      for (let i = 0; i < a.b1.length; i++) if (a.b1[i]) { arr[3 * i] = a.lit[3 * i] * k; arr[3 * i + 1] = a.lit[3 * i + 1] * k; arr[3 * i + 2] = a.lit[3 * i + 2] * k; }
      attr.needsUpdate = true;
    });
    M.troffer.color.copy(M.trofferLit).multiplyScalar(lit ? 1 : 0.02);
    M.trofferFlicker.color.copy(M.troffer.color);
    M.screen.color.copy(M.screenLit).multiplyScalar(lit ? 1 : 0.05);
    if (P.ropePts) drawRope();
    MARKS.forEach(drawMark);
    fogKey = null;
  }
  /* Light on a small thing at (x, y, z), the way the baked surfaces get it (a dark B1 included). Cached per 10 cm. */
  const LIGHT_GAIN = LOOK === "yellow" ? 2.3 : 2.2, LIGHT_CACHE = new Map();
  const zoneAt = (x, y, z) => (inStair(SW.W, x, y) ? "SW" : inStair(SW.E, x, y) ? "SE" : z < -5 ? "B3" : "B1");
  function lightAt(x, y, z, nx, ny, nz) {
    const zone = zoneAt(x, y, z), dark = zone === "B1" && !b1Lit();
    const key = `${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)},${nx.toFixed(1)},${ny.toFixed(1)},${dark}`;
    if (!LIGHT_CACHE.has(key)) {
      const c = bake(x, y, z, nx, ny, nz, { k: "prop", zone }), k = LIGHT_GAIN * (dark ? 0.035 : 1);
      LIGHT_CACHE.set(key, [c[0] * k, c[1] * k, c[2] * k]);
    }
    return LIGHT_CACHE.get(key);
  }

  // ---------------------------------------------------------------- tools on screen: the rope on the floor, chalk marks, the entity
  let ropeMesh = null, ropeMat = null;
  const ROPE_RGB = [0.95, 0.42, 0.12];
  /* The rope as a flat ribbon just above the floor, drawn again wherever its place is drawn again; it breaks where the walk
     jumped (through the ring's opening, or into another storey of the west stairwell). */
  function drawRope() {
    if (ropeMesh) { scene.remove(ropeMesh); ropeMesh.geometry.dispose(); ropeMesh = null; }
    if (!TK.rope || !P.ropePts || P.ropePts.length < 2) return;
    const pos = [], col = [], idx = [], W = 0.028;
    const strip = (pts) => {
      if (pts.length < 2) return;
      const b = pos.length / 3;
      pts.forEach((p, i) => {
        const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)];
        let tx = c[0] - a[0], ty = c[1] - a[1];
        const l = Math.hypot(tx, ty) || 1;
        tx /= l; ty /= l;
        const lt = lightAt(p[0], p[1], p[2] + 0.05, 0, 0, 1);
        // on a flight (between landings) it lies across the nosings, above the stair's mean slope
        const lift = zoneAt(p[0], p[1], p[2]) !== "B1" && zoneAt(p[0], p[1], p[2]) !== "B3" && Math.abs(p[2] - Math.round(p[2] / (FH / 2)) * (FH / 2)) > 0.03 ? 0.13 : 0;
        [-1, 1].forEach((sg) => {
          pos.push(p[0] - ty * W * sg, p[2] + lift + 0.014, -(p[1] + tx * W * sg));
          col.push(ROPE_RGB[0] * lt[0], ROPE_RGB[1] * lt[1], ROPE_RGB[2] * lt[2]);
        });
      });
      for (let i = 0; i < pts.length - 1; i++) { const k = b + i * 2; idx.push(k, k + 1, k + 3, k, k + 3, k + 2); }
    };
    const runs = [[]];
    P.ropePts.forEach((p, i) => {
      const q = P.ropePts[i - 1];
      if (q && Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > 1.6) runs.push([]);
      runs[runs.length - 1].push(p);
    });
    runs.forEach((run) => {
      strip(run);
      const offs = new Map();
      run.forEach((p) => copiesOf(p).forEach((o) => offs.set(o.join(","), o)));
      offs.forEach((o, key) => {
        let cur = [];
        run.forEach((p) => {
          if (copiesOf(p).some((q) => q.join(",") === key)) cur.push([p[0] + o[0], p[1] + o[1], p[2] + o[2]]);
          else { strip(cur); cur = []; }
        });
        strip(cur);
      });
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    ropeMat = ropeMat || new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    ropeMesh = new THREE.Mesh(g, ropeMat);
    scene.add(ropeMesh);
  }
  /* Chalk marks: { text, wall, p (real place), f (the way the writing faces), node, meshes }. */
  const MARKS = [];
  const chalkTex = (text) => signTex(256, 160, (g, w, h) => {
    const px = Math.min(110, Math.floor((w * 0.9) / Math.max(1, text.length))), R = rng(hash(text));
    g.font = `700 ${px}px ${FONT}`; g.textAlign = "center"; g.textBaseline = "middle";
    for (let k = 0; k < 4; k++) { g.fillStyle = `rgba(205,44,32,${0.35 + 0.15 * k})`; g.fillText(text, w / 2 + (R() - 0.5) * 4, h / 2 + (R() - 0.5) * 4); }
    g.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(0,0,0,${0.3 + 0.6 * R()})`; g.fillRect(R() * w, R() * h, 1 + 2 * R(), 1 + 2 * R()); }
    g.globalCompositeOperation = "source-over";
  });
  function drawMark(m) {
    m.meshes.forEach((x) => { scene.remove(x); x.geometry.dispose(); x.material.dispose(); });
    m.meshes = [];
    m.tex = m.tex || chalkTex(m.text);
    const [w, h] = m.wall ? [0.75, 0.47] : [1.0, 0.62], n = m.wall ? [Math.cos(rad(m.f)), Math.sin(rad(m.f)), 0] : [0, 0, 1];
    [[0, 0, 0]].concat(copiesOf(m.p)).forEach((o) => {
      const q = [m.p[0] + o[0], m.p[1] + o[1], m.p[2] + o[2]], lt = lightAt(q[0] + n[0] * 0.1, q[1] + n[1] * 0.1, q[2] + n[2] * 0.1, n[0], n[1], n[2]);
      const mat = new THREE.MeshBasicMaterial({ map: m.tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
        color: new THREE.Color(Math.min(1.6, lt[0]), Math.min(1.6, lt[1]), Math.min(1.6, lt[2])) });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      mesh.position.copy(v3(q[0], q[1], q[2]));
      mesh.rotation.order = "YXZ";
      if (m.wall) mesh.rotation.set(0, Math.atan2(n[0], -n[1]), 0);
      else mesh.rotation.set(-Math.PI / 2, rad(m.f) - Math.PI / 2, 0);
      scene.add(mesh);
      m.meshes.push(mesh);
    });
  }
  /* The entity: the model from blender/loop_entity.py (a tall, emaciated, hunched figure with a hanging jaw and long claws), posed
     procedurally and lit by lights of its own (nothing else in the scene takes lights), as bright as the place it stands in.
     One copy per place it is drawn; a stick figure if the model is missing. */
  const ENT_GROUPS = [];
  let entMat = null, entHemi = null, entLamp = null;
  const entHash = (k) => { const s = Math.sin(k * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
  /* Wet dark skin: low roughness, plus a little rim light so it separates from a dark corridor. */
  function entMaterial() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0 });
    mat.userData.rim = { value: new THREE.Color(0.25, 0.22, 0.16) };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uRim = mat.userData.rim;
      sh.fragmentShader = "uniform vec3 uRim;\n" + sh.fragmentShader.replace("#include <opaque_fragment>",
        "float fres = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 2.5);\noutgoingLight += uRim * fres;\n#include <opaque_fragment>");
    };
    return mat;
  }
  /* Bones by name; turn(name, pitch, yaw, roll) rotates about the model's own axes (X its left, Y up, Z forward) from the rest pose. */
  function entRig(root) {
    const bones = {};
    root.traverse((o) => { if (o.isBone) bones[o.name] = o; });
    root.updateMatrixWorld(true);
    const inv = root.getWorldQuaternion(new THREE.Quaternion()).invert();
    Object.values(bones).forEach((b) => {
      b.userData.rest = b.quaternion.clone();
      b.userData.restW = inv.clone().multiply(b.getWorldQuaternion(new THREE.Quaternion()));
    });
    const q = new THREE.Quaternion(), t1 = new THREE.Quaternion(), ax = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    function turn(name, x, y, z) {
      const b = bones[name.replace(/\./g, "")];   // three.js drops the dots from glTF node names
      if (!b) return;
      q.identity();
      [x, y, z].forEach((a, i) => { if (a) q.premultiply(t1.setFromAxisAngle(ax[i], a)); });
      const W = b.userData.restW;
      t1.copy(W).invert().multiply(q).multiply(W);
      b.quaternion.copy(b.userData.rest).multiply(t1);
    }
    /* t: seconds (poses change 12 times a second, like stop-motion); w: 0 standing, 1 striding with a limp; look: head yaw toward
       you (rad); lunge: 0..1 reaching for you. Returns how far to lift the body. */
    function pose(t, w, look, lunge) {
      const tt = Math.floor(t * 12) / 12, ph = tt * 4.4, s = Math.sin(ph), c = Math.cos(ph);
      turn("thigh.L", -0.6 * w * s - 0.25 * lunge, 0, 0.02 + 0.1 * lunge);
      turn("thigh.R", 0.45 * w * s - 0.2 * lunge, 0, -0.06 * w - 0.02 - 0.1 * lunge);
      turn("shin.L", 0.85 * w * Math.max(0, -c) + 0.12 + 0.35 * lunge, 0, 0);
      turn("shin.R", 0.6 * w * Math.max(0, c) + 0.16 + 0.3 * lunge, 0, 0);
      turn("foot.L", -0.35 * w * Math.max(0, -c) - 0.1, 0, 0);
      turn("foot.R", -0.25 * w * Math.max(0, c) - 0.1, 0, 0);
      turn("hips", 0.05 * w * Math.sin(2 * ph) + 0.12 * lunge, 0.14 * w * s, 0.08 * w * s);
      turn("spine", 0.12 + 0.06 * w * Math.sin(2 * ph + 0.6) + 0.1 * lunge, -0.09 * w * s, 0.03 * Math.sin(tt * 0.7));
      turn("chest", 0.18 + 0.04 * Math.sin(tt * 0.9) + 0.06 * lunge, -0.11 * w * s, -0.05 * w * s);
      turn("shoulder.L", 0, 0, 0.1 * w * Math.max(0, s));
      turn("shoulder.R", 0, 0, -0.1 * w * Math.max(0, -s));
      turn("upperarm.L", 0.4 * w * Math.sin(ph - 0.9) + 0.06 * Math.sin(tt * 1.3) - 0.55 * lunge, 0, 0.08 + 0.95 * lunge);
      turn("upperarm.R", -0.35 * w * Math.sin(ph - 0.9) + 0.06 * Math.sin(tt * 1.1 + 1) - 0.5 * lunge, 0, -0.08 - 0.95 * lunge);
      turn("forearm.L", -0.18 - 0.25 * w * Math.max(0, Math.sin(ph - 1.6)) - 0.85 * lunge, 0, 0);
      turn("forearm.R", -0.22 - 0.25 * w * Math.max(0, -Math.sin(ph - 1.6)) - 0.85 * lunge, 0, 0);
      turn("hand.L", -0.1, 0, 0);
      turn("hand.R", -0.15, 0, 0);
      turn("fingers.L", -0.3 - 0.35 * (0.5 + 0.5 * Math.sin(tt * 3.7)) + 0.55 * lunge, 0, 0);
      turn("fingers.R", -0.35 - 0.3 * (0.5 + 0.5 * Math.sin(tt * 3.1 + 2)) + 0.55 * lunge, 0, 0);
      // the head juts forward and twitches; now and then it hangs far over to one side
      const k = Math.floor(t * 2.3), jerk = entHash(k + 7) - 0.5, tilt = entHash(k) > 0.7 ? 0.95 * Math.sign(jerk) : 0.14 * jerk;
      turn("neck", -0.3 - 0.3 * lunge + 0.08 * (entHash(k + 11) - 0.5), 0.45 * look, 0);
      turn("head", 0.12 + 0.2 * (entHash(k + 3) - 0.5) - 1.0 * lunge, 0.5 * look + 0.3 * jerk, tilt * (1 - 0.7 * lunge) + 0.2 * lunge);
      turn("jaw", -0.15 - 0.55 * lunge - 0.1 * entHash(k + 5), 0, 0);
      return 0.035 * w * Math.abs(s);
    }
    return { pose };
  }
  function makeEntity() {
    if (!TK.entity) return Promise.resolve();
    entHemi = new THREE.HemisphereLight(0xfff1c8, 0x2a2214, 0);
    entLamp = new THREE.PointLight(0xffe8b0, 0, 7, 2);
    scene.add(entHemi, entLamp);
    if (!window.SA_LOOP_ENTITY || !THREE.GLTFLoader) { stickFigures(); return Promise.resolve(); }
    const bin = Uint8Array.from(atob(window.SA_LOOP_ENTITY), (ch) => ch.charCodeAt(0)).buffer;
    entMat = entMaterial();
    const one = () => new Promise((res, rej) => new THREE.GLTFLoader().parse(bin.slice(0), "", res, rej));
    return Promise.all([0, 1, 2, 3, 4].map(one)).then((list) => list.forEach((gltf) => {
      const g = new THREE.Group(), model = gltf.scene;
      model.rotation.y = Math.PI / 2;   // the model faces +Z; the group faces +X
      model.traverse((o) => { if (o.isMesh) { o.material = entMat; o.frustumCulled = false; } });
      g.add(model);
      g.userData = { rig: entRig(model) };
      g.visible = false;
      scene.add(g);
      ENT_GROUPS.push(g);
    })).catch(() => { ENT_GROUPS.forEach((g) => scene.remove(g)); ENT_GROUPS.length = 0; stickFigures(); });
  }
  function stickFigures() {
    const body = new THREE.MeshBasicMaterial({ color: 0x060606 });
    for (let k = 0; k < 5; k++) {
      const g = new THREE.Group();
      const add = (geo, x, y, z) => { const m = new THREE.Mesh(geo, body); m.position.set(x, y, z); g.add(m); };
      add(new THREE.CylinderGeometry(0.075, 0.05, 1.15, 8), 0, 0.575, 0.11);
      add(new THREE.CylinderGeometry(0.075, 0.05, 1.15, 8), 0, 0.575, -0.11);
      add(new THREE.BoxGeometry(0.22, 0.9, 0.4), 0.05, 1.55, 0);
      add(new THREE.SphereGeometry(0.16, 12, 10), 0.22, 2.22, 0);
      g.userData = { rig: null };
      g.visible = false;
      scene.add(g);
      ENT_GROUPS.push(g);
    }
  }
  function entWorld() {
    const E = P.ent;
    if (E.free) return E.free.slice();
    if (E.eid === null) return NPOS[E.from].slice();
    const e = NG.edges[E.eid], pts = edgePoints(e, E.from);
    return pointAt3(pts, (E.s / entLen(e)) * polyLen3(pts));
  }
  /* The way it is walking (deg), or null when it stands at a node or comes straight at you. */
  function entWalkDir() {
    const E = P.ent;
    if (E.free || E.eid === null) return null;
    const e = NG.edges[E.eid], pts = edgePoints(e, E.from), L = polyLen3(pts), s = (E.s / entLen(e)) * L;
    const a = pointAt3(pts, Math.max(0, s - 0.3)), b = pointAt3(pts, Math.min(L, s + 0.3));
    return Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-3 ? N.headingOf(b[0] - a[0], b[1] - a[1]) : null;
  }
  function entPlace(t) {
    ENT_GROUPS.forEach((g) => (g.visible = false));
    if (entLamp) entLamp.intensity = entHemi.intensity = 0;
    if (!TK.entity || !P.ent || !P.ent.on) return;
    let list, walkDir = null;
    if (P.caught) { const h = rad(P.heading); list = [[P.x + Math.cos(h) * 2.0, P.y + Math.sin(h) * 2.0, P.z]]; }
    else {
      const p = canon(entWorld());
      list = [p].concat(copiesOf(p).map((o) => [p[0] + o[0], p[1] + o[1], p[2] + o[2]]));
      walkDir = entWalkDir();
    }
    const walking = !P.caught && (walkDir !== null || !!P.ent.free);
    list.forEach((q, i) => {
      const g = ENT_GROUPS[i];
      if (!g) return;
      const toMe = N.headingOf(P.x - q[0], P.y - q[1]), face = walkDir === null ? toMe : walkDir;
      const lift = g.userData.rig ? g.userData.rig.pose(t, walking ? 1 : 0, clamp(rad(N.angDiff(toMe, face)), -1.1, 1.1), P.caught ? 1 : 0) : 0;
      g.visible = true;
      g.position.copy(v3(q[0], q[1], q[2] + lift));
      g.rotation.y = rad(face);
    });
    // its own light, as bright as the place it stands in
    const p0 = list[0], lt = lightAt(p0[0], p0[1], p0[2] + 1.2, 0, 0, 1), lum = (lt[0] + lt[1] + lt[2]) / 3;
    entHemi.intensity = 0.45 * lum;
    entLamp.intensity = 2.2 * lum;
    entLamp.position.copy(v3(p0[0], p0[1], p0[2] + 2.6));
    if (entMat) entMat.userData.rim.value.setRGB(0.16 * lum, 0.14 * lum, 0.1 * lum);
  }
  function buildWorld() {
    RI.forEach(buildRoom);
    PI.forEach(buildPassage);
    STAIRS.forEach(buildStair);
    mechProps();
    finishMeshes();
  }

  // ---------------------------------------------------------------- player state
  const P = {};
  const keys = {};
  const state = { god: false };
  const START_MIN = T.start, START_NODE = NX[TK.start], LOBBY = NX.L0, ARCH = NX.C_arch, GOAL = NX[TK.goal];
  const ITEM = TK.item ? NX[TK.item[1]] : null;
  const SOLVABLE = TK.rope ? plan(START_NODE, GOAL).len <= TK.rope + 1e-6 : !(IMP && TK.mech === "closed");
  const WAIT_MIN = 0.5;
  const optimal = { len: 0, minutes: 0 };
  /* Shortest walk once every mechanism is set the right way (switching costs no distance). */
  (function computeOptimal() {
    const S = (o) => Object.assign(initialMech(), o);
    let parts = [];
    if (TK.kind === "fetch") parts = [plan(LOBBY, NX.K1), plan(NX.K1, NX.K2), plan(NX.K2, NX.K3), plan(NX.K3, LOBBY), plan(LOBBY, ARCH), plan(ARCH, LOBBY)];
    else if (TK.kind === "patrol") parts = [tour(LOBBY, CLOCK_DOORS.map((d) => NX[d.node]), LOBBY)];
    else if (TK.mech === "shutter") {
      const east = S({ east: true, north: false });
      parts = [plan(START_NODE, ITEM, east), plan(ITEM, LOBBY, east), plan(LOBBY, GOAL, S({ east: false, north: true }))];
    } else if (TK.kind === "carry") { const s = S({ wedged: true }); parts = [plan(START_NODE, ITEM, s), plan(ITEM, GOAL, s)]; }
    else if (SOLVABLE && TK.kind !== "survive") parts = [plan(START_NODE, GOAL, S({ level: 0 }))];
    parts.forEach((p) => { optimal.len += p.len; optimal.minutes += p.minutes; });
    if (TK.mech === "pump") optimal.minutes += 2 * WAIT_MIN;
  })();
  const beep = () => { if (AUD) AUD.beep(); };
  function reset() {
    const s = NPOS[START_NODE];
    Object.assign(MECH, initialMech());
    Object.assign(P, { x: s[0], y: s[1], z: s[2], camZ: s[2] + EYE, heading: TK.heading, camH: TK.heading, pitch: -0.03, aiPitch: aiPitch(s[0], s[1], s[2]), walked: 0, steps: 0,
      t0: performance.now(), minutes: START_MIN, done: false, success: false, anim: null, zoom: false, node: START_NODE,
      trail: [[s[0], s[1], s[2]]], text: INTRO, declared: false, reason: null, reasonScore: null, dark: false, item: false,
      phase: TK.kind === "fetch" ? "lap" : "go", lap: {}, folder: false, deadline: BUDGET ? START_MIN + BUDGET / 60 : null, budget: BUDGET, lateTold: false,
      ringUses: 0, ringUsesAfterCall: 0, punched: {}, repunch: 0, report: null, westDown: 0, westUp: 0, leftWest: null, nodes: [TK.start], near: {}, lastRing: false,
      stride: 0, bob: 0, move: 0, moving: false, bumpT: -1e9,
      ropePts: [canon(s)], ropeStack: [], ropeSeg: [], ropeLen: 0, ropePend: 0, ropeMax: 0, ropeTaut: 0,
      nv: false, nvT: 0, battery: TK.battery || 12, nvSteps: 0, rewinds: 0, replay: null, caught: false,
      ent: { on: !!TK.entity && TK.entity.on === "start", from: TK.entity ? NX[TK.entity.at] : 0, eid: null, s: 0, free: null, minD: Infinity } });
    MARKS.forEach((m) => m.meshes.forEach((x) => { scene.remove(x); x.geometry.dispose(); x.material.dispose(); }));
    MARKS.length = 0;
    FRAMEC.length = 0;
    drawRope();
    $("result").style.display = "none";
    FOLDER.forEach((a) => { if (a.mesh) a.mesh.visible = true; });
    refreshLEDs();
    FIRE.forEach((f) => { f.target = 0; });
    refreshMech(true);
    say(INTRO);
    refreshStats();
    if (aiUI) aiUI.refresh();
  }
  function say(t) { P.text = t; $("msg").textContent = t; }
  function refreshStats() {
    $("walked").textContent = Math.round(P.walked);
    $("steps").textContent = aiUI && aiUI.mode === "ai" ? `${P.steps}/${TK.maxSteps}` : "–";
  }
  function refreshLEDs() {
    Object.keys(LEDS).forEach((id) => LEDS[id].forEach((a) => { if (a.mesh) a.mesh.material = TK.led && P.punched && P.punched[id] ? M.ledGreen : M.ledRed; }));
  }
  const allPunched = () => CLOCK_DOORS.every((d) => P.punched[d.id]);
  const late = () => P.deadline !== null && P.minutes > P.deadline + 1e-9;
  const fmtBudget = (s) => (s >= 60 ? `${Math.floor(s / 60)} 分${s % 60 ? ` ${s % 60} 秒` : "钟"}` : `${s} 秒`);
  const BUDGET = TK.rush ? Math.floor((optimal.minutes * 60 + 8) / 5) * 5 : null;
  const INTRO = TK.intro.replace("{budget}", BUDGET ? fmtBudget(BUDGET) : "");
  const floorOf = (z) => (z > 1.8 ? "1F" : z > -1.8 ? "B1" : z > -5.4 ? "B2" : "B3");

  // ---------------------------------------------------------------- task events shared by both modes
  function punch(d) {
    beep();
    if (P.punched[d.id]) { P.repunch += 1; return "门边的打卡器「嘀」了一声。"; }
    P.punched[d.id] = true;
    refreshLEDs();
    return TK.led ? T.say("门边的打卡器「嘀」了一声，指示灯变绿了。", "门边的打卡器「嘀」了一声。") : "门边的打卡器「嘀」了一声。";
  }
  function phoneCall() {
    P.phase = "fetch";
    const opt = plan(LOBBY, ARCH).minutes + plan(ARCH, LOBBY).minutes;
    P.budget = Math.floor((opt * 1.3 * 60) / 10) * 10;
    P.deadline = P.minutes + P.budget / 60;
    return `值班台的电话响了：「档案室门口文件架上那个蓝色文件夹，马上送到值班台来！整层 ${fmtBudget(P.budget)}后断电。」拿到文件夹、回到值班台后 stop。`;
  }
  function takeFolder() {
    P.folder = true;
    FOLDER.forEach((a) => { if (a.mesh) a.mesh.visible = false; });
    return "从档案室门口的文件架上拿到了蓝色文件夹。";
  }
  function powerCut() {
    P.done = true;
    P.dark = true;
    applyPower();
    if (AUD) AUD.cut();
    return "啪的一声，整层断电了，四下一片漆黑。";
  }
  function takeItem() {
    P.item = true;
    if (TK.item[0] === "folder") FOLDER.forEach((a) => { if (a.mesh) a.mesh.visible = false; });
    refreshMech();
    beep();
    const got = `拿起了${TK.item[2]}。`;
    if (!TK.entity || TK.entity.on !== "item") return got;
    Object.assign(P.ent, { on: true, from: NX[TK.entity.at], eid: null, s: 0, free: null, minD: Infinity });
    if (AUD) AUD.howl();
    return got + T.say("就在这时，北边拐角那头传来一声又长又哑的嚎叫——有东西过来了。", "远处传来一声嚎叫。");
  }
  const parseCount = (v) => { const m = String(v === undefined || v === null ? "" : v).match(/\d+/); return m ? Number(m[0]) : null; };
  /* Game time passes only by walking, looking closer and waiting; a running pump drains the flood meanwhile, and the entity walks.
     move: the edge being walked during this time, if any. */
  function addTime(dm, move) {
    const t0 = P.minutes;
    P.minutes += dm;
    if (pumpOn() && MECH.level > 0) MECH.level = Math.max(0, MECH.level - dm / DRAIN_MIN);
    if (TK.entity && P.ent && P.ent.on && !P.caught && aiUI.mode === "ai") entSim(t0, dm, move);
  }
  const waterCm = () => Math.round(MECH.level * 40);

  // ---------------------------------------------------------------- switches and buttons: use(name) works on those at the current node (AI) or within reach (walking)
  const CONTROLS = [];
  const control = (id, node, pos, names, run) => CONTROLS.push({ id, node: NX[node], pos, names, run });
  const clunk = () => { if (AUD) AUD.clunk(); };
  const sparkTrip = () => { MECH.trips += 1; if (AUD) AUD.cut(); };
  const locked = () => T.say("配电箱上了锁，打不开。", "打不开。");
  if (TK.mech === "shutter") {
    [1, 2, 3, 4].forEach((k) => control(`br${k}`, "L0", [2.55, 4.2, 0], [BR_NAMES[k], `${k}号`, `${k}`, `${k}号开关`], () => toggleBreaker(k)));
    control("main", "L0", [2.55, 4.2, 0], ["总闸", "总开关", "主闸"], toggleMain);
  } else control("panel", "L0", [2.55, 4.2, 0], ["配电箱"], locked);
  control("btnN", "L0", [1.5, 4.2, 0], ["北门卷帘", "北门卷帘按钮", "北门"], () => pressShutter("north"));
  control("btnE", "L0", [4.2, -1.5, 0], ["东门卷帘", "东门卷帘按钮", "东门"], () => pressShutter("east"));
  if (TK.mech === "pump") {
    control("fan", "B3_elec", [8.2, 0.9, B3Z], ["排风机"], () => toggleBox("fan"));
    control("pump", "B3_elec", [8.2, 0.9, B3Z], ["水泵"], () => toggleBox("pump"));
    control("reset", "B3_elec", [8.2, 0.9, B3Z], ["复位", "复位按钮", "复位键"], resetBox);
  } else control("box", "B3_elec", [8.2, 0.9, B3Z], ["配电箱"], locked);
  if (TK.mech === "wedge") control("wedge", "ES3", [31.6, 0.9, B3Z], ["门挡", "橡胶门挡"], useWedge);
  /* B1 panel: at most two breakers on, or the main switch trips and takes everything with it. */
  function toggleBreaker(k) {
    clunk();
    MECH.br[k] = !MECH.br[k];
    const did = `把 ${k} 号「${BR_NAMES[k]}」${MECH.br[k] ? "推了上去" : "拉了下来"}。`;
    if (MECH.main && breakersOn(MECH) > 2) {
      MECH.main = false;
      sparkTrip();
      return T.say(`${did}「啪」的一声，总闸跳了，整层的灯全灭了。`, "拨了一下开关。「啪」的一声，四下一片漆黑。");
    }
    const fx = !MECH.main ? "" : k === 1 ? (MECH.br[1] ? "走廊的灯亮了。" : "走廊的灯全灭了，只剩安全出口指示牌还亮着。")
      : k === 2 ? (MECH.br[2] ? "卷帘按钮上的电源灯亮了。" : "卷帘按钮上的电源灯灭了。") : "";
    return T.say(did + fx, "拨了一下开关。");
  }
  function toggleMain() {
    clunk();
    if (MECH.main) { MECH.main = false; return T.say("把总闸拉了下来，整层断电，四下一片漆黑。", "拨了一下总闸。"); }
    if (breakersOn(MECH) > 2) { sparkTrip(); return T.say("合上总闸——「啪」，又跳了。", "拨了一下总闸，「啪」的一声。"); }
    MECH.main = true;
    return T.say(`合上了总闸${MECH.br[1] ? "，走廊的灯亮了" : ""}。`, "拨了一下总闸。");
  }
  /* The two lobby shutters are interlocked: raising one lowers the other. They need breaker 2. */
  function pressShutter(which) {
    beep();
    const other = which === "north" ? "east" : "north", name = which === "north" ? "北门" : "东门", oname = which === "north" ? "东门" : "北门";
    if (!motorOn()) return T.say(`按了「${name}卷帘」，没有反应，按钮上的电源灯不亮。`, "按了按钮，没有反应。");
    if (MECH[which] && !MECH[other]) return T.say(`${name}的卷帘本来就是升起的，按了没有变化。`, "按了按钮，没有变化。");
    const fell = MECH[other];
    MECH[which] = true;
    MECH[other] = false;
    if (AUD) AUD.shutter();
    return T.say(`${name}的防火卷帘轰隆隆地升了起来${fell ? `；与此同时，${oname}的卷帘落了下来` : ""}。`, "按了按钮，传来卷帘的轰隆声。");
  }
  /* B3 box: fan or pump, not both (both trips it; reset once one is off). */
  function toggleBox(k) {
    clunk();
    MECH[k] = !MECH[k];
    const name = k === "fan" ? "排风机" : "水泵", did = `把「${name}」的开关${MECH[k] ? "合上" : "断开"}了。`;
    if (MECH.box && MECH.fan && MECH.pump) {
      MECH.box = false;
      sparkTrip();
      return T.say(`${did}「啪」的一声，配电箱跳闸了，排风机和水泵都停了。`, "拨了一下开关，「啪」的一声。");
    }
    if (!MECH.box) return T.say(`${did}配电箱还跳着闸。`, "拨了一下开关。");
    const fx = k === "pump" ? (MECH.pump ? "水泵轰地转了起来，积水开始慢慢往下退。" : "水泵停了。") : MECH.fan ? "排风机呼呼地转了起来。" : "排风机停了。";
    return T.say(did + fx, "拨了一下开关。");
  }
  function resetBox() {
    clunk();
    if (MECH.box) return T.say("配电箱没有跳闸，按复位没有反应。", "按了按钮，没有反应。");
    if (MECH.fan && MECH.pump) { sparkTrip(); return T.say("按下复位——「啪」，又跳了。", "按了按钮，「啪」的一声。"); }
    MECH.box = true;
    return T.say(`按下复位，配电箱恢复了供电。${MECH.pump ? "水泵轰地转了起来，积水开始慢慢往下退。" : MECH.fan ? "排风机又转了起来。" : ""}`, "按了按钮。");
  }
  function useWedge() {
    if (MECH.wedged) return "门挡已经把门卡住了。";
    MECH.wedged = true;
    if (AUD) AUD.door();
    return T.say("从墙上取下橡胶门挡，推开防火门，把门挡塞在门下：这扇门现在一直敞着。", "把门挡塞在了门下，门一直敞着。");
  }
  function controlsHere() {
    if (P.done) return [];
    if (aiUI.mode === "ai") return P.anim ? [] : CONTROLS.filter((c) => c.node === P.node);
    return CONTROLS.filter((c) => Math.hypot(P.x - c.pos[0], P.y - c.pos[1]) < 1.7 && Math.abs(P.z - c.pos[2]) < 1.2);
  }
  /* Whole-name match first, then the longest name contained in the argument ("打开东门卷帘" → 东门卷帘); a single control needs no name. */
  function matchControl(list, arg) {
    const s = String(arg === undefined || arg === null ? "" : arg).replace(/[\s"'“”‘’「」『』《》()（）【】[\]·.,，。:：!！?？]/g, "");
    if (!s) return list.length === 1 ? list[0] : null;
    let best = null, score = 0;
    list.forEach((c) => c.names.forEach((n) => {
      const hit = s === n ? 100 + n.length : n.length > 1 && s.indexOf(n) >= 0 ? n.length : 0;
      if (hit > score) { score = hit; best = c; }
    }));
    return best;
  }
  function doUse(arg) {
    const here = controlsHere(), c = matchControl(here, arg);
    if (!c) {
      if (!here.length) return T.say("身边没有可以操作的开关或按钮。", "这里没有可以操作的东西。");
      return T.say(`这里没有「${arg === undefined || arg === null ? "" : arg}」。身边能操作的有：${here.map((h) => h.names[0]).join("、")}。`, "这里没有这个东西。");
    }
    MECH.uses += 1;
    const msg = c.run();
    refreshMech();
    return msg;
  }
  function doWait(arg) {
    const n = Number(String(arg === undefined || arg === null ? "" : arg).replace(/[^\d.]/g, "")), sec = n ? clamp(Math.round(n), 5, 60) : 30;
    MECH.waits += 1;
    addTime(sec / 60);
    refreshMech();
    const w = TK.mech === "pump" && P.z < -5 ? (MECH.level > 0.005 ? `积水还有约 ${waterCm()} 厘米深。` : "积水已经退干净了。") : "";
    return T.say(`原地等了 ${sec} 秒。${w}`, `原地等了 ${sec} 秒。`);
  }
  /* Why forward goes nowhere, by mechanism. */
  function blockedText(why) {
    if (why === "shutter") return T.say("前面的防火卷帘落着，把门封死了。", "卷帘挡着，过不去。");
    if (why === "broken") return T.say("走廊中间落着一道防火卷帘，上面贴着「卷帘故障 · 维修中」，推不动。", "卷帘挡着，过不去。");
    if (why === "water") return T.say(`前面积水约 ${waterCm()} 厘米深，带着工具蹚不过去。`, "水太深，过不去。");
    if (why === "closed") return T.say("东楼梯的防火门锁着，门上贴着「楼梯检修 · 暂停通行」，还拉着警戒带。", "门锁着，过不去。");
    return T.say("这扇防火门在走廊这一侧没有把手，推不开也拉不开。", "门打不开。");
  }
  /* What a guard notices on arriving somewhere a mechanism matters (text mode only). */
  function placeNote(id) {
    const out = [];
    if (id === "L0") {
      if (TK.mech === "shutter") {
        out.push(`北墙上的配电箱开着：${[1, 2, 3, 4].map((k) => `${k} 号${BR_NAMES[k]}${MECH.br[k] ? "合着" : "断开"}`).join("，")}，总闸${MECH.main ? "合着" : "跳了"}；` +
          "箱子上写着「最多同时合两路」。北门和东门旁边各有一个卷帘按钮。");
      }
      const down = [MECH.north ? null : "北门", MECH.east ? null : "东门"].filter(Boolean);
      if (down.length) out.push(`${down.join("和")}的防火卷帘落着。`);
    }
    if (id === "C_arch" && MECH.broken) out.push("往南的走廊被一道落下的防火卷帘挡住了。");
    if (id === "B3_elec" && TK.mech === "pump") {
      out.push(`门边墙上有个配电箱：排风机${MECH.fan ? "合着" : "断开"}，水泵${MECH.pump ? "合着" : "断开"}${MECH.box ? "" : "，已经跳闸"}，还有一个复位按钮；箱子上写着「只能开一路」。`);
    }
    if (TK.mech === "pump" && /^B3_(e|fan|elec)$/.test(id) && MECH.level > 0.005) out.push(`往西看，水泵房那头积着水，约 ${waterCm()} 厘米深，前面堆着一排沙袋。`);
    if (id === "ES3" && TK.mech === "wedge") {
      out.push(MECH.wedged ? "通往 B3 走廊的门被门挡卡着，一直敞着。" : "通往 B3 走廊的门上贴着告示：「此门从走廊一侧打不开，进出请用门挡卡住」；门边墙上挂着一个橡胶门挡。");
    }
    if (id === "K3" && TK.mech === "closed") out.push("东楼梯的防火门上拉着警戒带。");
    const ms = MARKS.filter((m) => m.node === NX[id]).map((m) => `「${m.text}」`);
    if (ms.length) out.push(`这里有你用粉笔写的${ms.join("")}。`);
    return out.length ? ` ${out.join("")}` : "";
  }
  /* Moving parts follow MECH: levers and lamps at once, shutters over 1.8 s (at once when snap), the flood with the clock. */
  function refreshMech(snap) {
    const on = { main: MECH.main, fan: MECH.fan, pump: MECH.pump };
    [1, 2, 3, 4].forEach((k) => (on[`br${k}`] = MECH.br[k]));
    Object.keys(MV.lever).forEach((id) => MV.lever[id].forEach((l) => { if (l.up.mesh) { l.up.mesh.visible = !!on[id]; l.dn.mesh.visible = !on[id]; } }));
    const lamp = { main: MECH.main ? M.lampGreen : M.ledRed, btnN: motorOn() ? M.lampGreen : M.lampOff, btnE: motorOn() ? M.lampGreen : M.lampOff,
      fan: MECH.box && MECH.fan ? M.lampGreen : M.lampOff, pump: pumpOn() ? M.lampGreen : M.lampOff, box: MECH.box ? M.lampGreen : M.ledRed };
    [1, 2, 3, 4].forEach((k) => (lamp[`br${k}`] = MECH.main && MECH.br[k] ? M.lampGreen : M.lampOff));
    Object.keys(MV.lamp).forEach((id) => MV.lamp[id].forEach((a) => { if (a.mesh) a.mesh.material = lamp[id]; }));
    const up = { north: MECH.north, east: MECH.east, broken: !MECH.broken };
    MV.curtain.forEach((c) => {
      c.target = up[c.id] ? 1 : 0;
      if (snap) { c.cur = c.target; c.group.position.y = c.cur * c.h; }
    });
    MV.items.forEach((a) => { if (a.mesh) a.mesh.visible = !P.item; });
    MV.wedge.forEach((a) => { if (a.mesh) a.mesh.visible = !MECH.wedged; });
    if (MECH.wedged) setDoors(["pES3"], 1);
    if (snap) FIRE.forEach((f) => { f.angle = f.target; f.group.rotation.y = -f.side * f.angle * 1.45; });
    if (MV.water) { MV.water.visible = MECH.level > 0.005; MV.water.position.y = B3Z + MECH.level * 0.4; }
    applyPower();
  }
  const mechMoving = () => MV.curtain.some((c) => c.cur !== c.target) || FIRE.some((f) => Math.abs(f.target - f.angle) > 0.02);
  function mechUpdate(dt) {
    MV.curtain.forEach((c) => {
      if (c.cur === c.target) return;
      c.cur = c.target > c.cur ? Math.min(c.target, c.cur + dt / 1.8) : Math.max(c.target, c.cur - dt / 1.8);
      c.group.position.y = c.cur * c.h;
    });
  }

  // ---------------------------------------------------------------- tools: rope, chalk, camcorder
  /* Action mode: the rope pays out along each edge walked and is reeled in when you walk straight back along its last stretch
     (going down the repeating stairwell and then up again counts as walking back). */
  function reverses(last, eid, from) {
    if (!last) return false;
    const e = NG.edges[eid], l = NG.edges[last.eid];
    if (e.a === e.b) return l.a === l.b && e.aDown !== l.aDown;
    return last.eid === eid && N.other(e, from) === last.from;
  }
  const ropeRoom = (eid, from) => !TK.rope || reverses(P.ropeStack[P.ropeStack.length - 1], eid, from) || P.ropeLen + NG.edges[eid].len <= TK.rope + 1e-6;
  function ropeAlong(eid, from) {
    if (!TK.rope) return;
    const e = NG.edges[eid];
    if (reverses(P.ropeStack[P.ropeStack.length - 1], eid, from)) {
      const last = P.ropeStack.pop();
      P.ropeLen -= NG.edges[last.eid].len;
      P.ropePts.length -= last.n;
    } else {
      const pts = edgePoints(e, from).slice(1).map(canon);
      P.ropePts.push(...pts);
      P.ropeStack.push({ eid, from, n: pts.length });
      P.ropeLen += e.len;
      P.ropeMax = Math.max(P.ropeMax, P.ropeLen);
    }
    drawRope();
  }
  /* Walking: the rope follows you and stepping back onto its previous point reels it in. Without commit, only says whether a step
     of d metres to c keeps within the rope's length. */
  function ropeFree(c, d, commit) {
    if (!TK.rope) return true;
    const pts = P.ropePts, n = pts.length, back = n >= 2 && near3(c, pts[n - 2], 0.4);
    if (!commit) return back || P.ropeLen + P.ropePend + d <= TK.rope + 1e-6;
    if (back) { pts.pop(); P.ropeLen -= P.ropeSeg.pop() || 0; P.ropePend = 0; drawRope(); return true; }
    P.ropePend += d;
    if (!near3(c, pts[n - 1], 0.45)) {
      pts.push(c);
      P.ropeSeg.push(P.ropePend);
      P.ropeLen += P.ropePend;
      P.ropePend = 0;
      P.ropeMax = Math.max(P.ropeMax, P.ropeLen);
      drawRope();
    }
    return true;
  }
  const ropeTautText = () => T.say(`安全绳放到头了（${TK.rope} 米），绷得紧紧的，再往前走不动了。`, "绳子绷紧了，走不动。");
  /* Chalk goes on the wall straight ahead if one is within 6 m, otherwise on the floor 2.8 m ahead. */
  function placeMark(text) {
    text = String(text === undefined || text === null ? "" : text).trim().slice(0, 8) || String(MARKS.length + 1);
    const h = rad(P.heading), dx = Math.cos(h), dy = Math.sin(h), ez = P.z + 1.35;
    let best = 6;
    SEGS.forEach((s) => {
      if (s.copy || (s.light && !s.dead) || s.z0 > ez || s.z1 < ez) return;
      const ex = s.x1 - s.x0, ey = s.y1 - s.y0, den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) return;
      const t = ((s.x0 - P.x) * ey - (s.y0 - P.y) * ex) / den, u = ((s.x0 - P.x) * dy - (s.y0 - P.y) * dx) / den;
      if (t > 0.15 && t < best && u >= 0 && u <= 1) best = t;
    });
    const wall = best < 6, d = wall ? best - 0.015 : 2.8;
    const m = { text, wall, f: wall ? (P.heading + 180) % 360 : P.heading, node: aiUI.mode === "ai" ? P.node : nearestNode(P.x, P.y, P.z), meshes: [],
      p: canon([P.x + dx * d, P.y + dy * d, wall ? ez : P.z + 0.008]) };
    MARKS.push(m);
    drawMark(m);
    return T.say(`用粉笔在${wall ? `正前方约 ${Math.max(1, Math.round(best))} 米的墙上` : "前面的地上"}写下了「${text}」。`, `写下了「${text}」。`);
  }
  const BATTERY = TK.battery || 12;
  function toggleNV() {
    if (!TOOLS.includes("camera")) return "你手上没有摄像机。";
    if (P.nv) { P.nv = false; return "关上了夜视。"; }
    if (P.battery <= 0) return "摄像机没电了，夜视开不了。";
    P.nv = true;
    return `打开了夜视（电量 ${P.battery}/${BATTERY}，开着的每个动作耗一格）。`;
  }
  const nvExposure = (x, y, z) => (zoneOf(x, y, z) === "B1" && !b1Lit() ? 14 : 1.4);
  /* Frames already seen, by step: the env's own frames in agent runs, small snapshots when people play the action mode. */
  const FRAMEC = [];
  function cacheFrame() {
    if (!TOOLS.includes("camera") || STILL) return;
    FRAMEC[P.steps] = snapshot(P.x, P.y, P.z, P.heading, aiPitch(P.x, P.y, P.z), P.zoom ? BENCH_ZOOM_FOV : BENCH_FOV, 480, 270, "image/jpeg");
  }
  function doRewind(arg) {
    if (!TOOLS.includes("camera")) return "你手上没有摄像机。";
    const n = clamp(parseInt(String(arg === undefined || arg === null ? "1" : arg).replace(/[^\d]/g, ""), 10) || 1, 1, 10), url = FRAMEC[P.steps - 1 - n];
    if (!url) return "录像带里没有那么早的画面。";
    P.rewinds += 1;
    P.replay = url;
    addTime(LOOK_MIN);
    if (!STILL) showReplay(url, n);
    return T.say(`倒带回看了 ${n} 步之前拍到的画面。`, `回看了 ${n} 步之前的画面。`);
  }

  // ---------------------------------------------------------------- the entity in play
  /* Action mode: it moves while game time passes. While you walk an edge it heads for where you are going; it catches you when it
     is within 1.5 m along the same stretch, or reaches the node you stand on. Nothing happens after the shift change. */
  function entSim(t0, dm, move) {
    const E = P.ent, span = TK.until ? Math.min(dm, START_MIN + TK.until - t0) : dm;
    if (span <= 0) return;
    const speed = TK.entity.speed, ticks = Math.max(1, Math.ceil((span * speed) / 1.2));
    for (let i = 1; i <= ticks && !P.caught; i++) {
      entMove(E, (span * speed) / ticks, move ? move.to : P.node, MECH);
      const gap = move ? entGapMoving(E, move, Math.min(1, (span * i) / ticks / dm)) : entGapTo(E, P.node);
      E.minD = Math.min(E.minD, gap);
      if (gap < 1.5) P.caught = true;
    }
  }
  function entGapMoving(E, move, frac) {
    const e = NG.edges[move.eid], sp = frac * e.len;
    if (frac >= 1 - 1e-9) return entGapTo(E, move.to);
    if (E.eid === move.eid && e.a !== e.b) { const k = e.len / entLen(e), pe = E.from === move.from ? E.s * k : e.len - E.s * k; return Math.abs(pe - sp); }
    if (E.eid === null && E.from === move.from) return sp;
    if (E.eid === null && E.from === move.to) return e.len - sp;
    return Math.min(entGapTo(E, move.from) + sp, entGapTo(E, move.to) + e.len - sp);
  }
  /* Walking: it follows the graph to the node nearest you, then comes straight at you while it can see you. */
  const ENT_FREE_SPEED = 3.3;
  function dist3c(a, b) { return Math.min(...[[0, 0, 0]].concat(copiesOf(b)).map((o) => Math.hypot(a[0] - b[0] - o[0], a[1] - b[1] - o[1], a[2] - b[2] - o[2]))); }
  function entFree(dt) {
    const E = P.ent, me = [P.x, P.y, P.z], target = nearestNode(P.x, P.y, P.z);
    if (E.free) {
      const d = Math.hypot(E.free[0] - P.x, E.free[1] - P.y), zone = zoneOf(P.x, P.y, P.z);
      const lost = Math.abs(E.free[2] - P.z) > 1.2 || d > 8 || (zone !== "stair" && !visible(E.free[0], E.free[1], P.x, P.y, zone, P.z + 1.2)) ||
        shutterSegs().some((s) => crosses(E.free[0], E.free[1], P.x, P.y, s));
      if (lost) Object.assign(E, { from: nearestNode(E.free[0], E.free[1], E.free[2]), eid: null, s: 0, free: null });
      else { const k = Math.min(1, (ENT_FREE_SPEED * dt) / Math.max(d, 1e-6)); E.free[0] += (P.x - E.free[0]) * k; E.free[1] += (P.y - E.free[1]) * k; }
    }
    if (!E.free) {
      entMove(E, ENT_FREE_SPEED * dt, target, MECH);
      if (E.eid === null && E.from === target) E.free = canon(NPOS[target]);
    }
    const gap = dist3c(me, canon(entWorld()));
    E.minD = Math.min(E.minD, gap);
    if (gap < 0.9) P.caught = true;
  }
  /* Lowered shutters as lines of sight are cut (the real ones and their copies). */
  function shutterSegs() {
    const s = [], add = (x0, y0, x1, y1) => { s.push({ x0, y0, x1, y1 }); if (IMP) s.push({ x0: x0 + SEAM_DX, y0, x1: x1 + SEAM_DX, y1 }); };
    if (!MECH.north) add(-0.85, 4.6, 0.85, 4.6);
    if (!MECH.east) add(4.6, -0.85, 4.6, 0.85);
    if (MECH.broken) s.push({ x0: 28.8, y0: 20.8, x1: 31.2, y1: 20.8 });
    return s;
  }
  /* Metres to the entity if it is in the current view (in the dark only close by, unless night vision is on). */
  function entSeen() {
    const p = canon(entWorld()), list = [p].concat(copiesOf(p).map((o) => [p[0] + o[0], p[1] + o[1], p[2] + o[2]]));
    // in the action mode the walk animation lags behind; where you are is the node you are walking to
    const [mx, my, mz] = aiUI.mode === "ai" ? NPOS[P.node] : [P.x, P.y, P.z];
    const zone = zoneOf(mx, my, mz), dark = zone === "B1" && !b1Lit() && !P.nv, sh = shutterSegs();
    let best = null;
    list.forEach((q) => {
      const d = Math.hypot(q[0] - mx, q[1] - my);
      if (Math.abs(q[2] - mz) > 1.3 || d > 35 || (dark && d > 4)) return;
      if (d > 0.5 && Math.abs(N.angDiff(N.headingOf(q[0] - mx, q[1] - my), P.heading)) > 42) return;
      if (zone !== "stair" && !visible(mx, my, q[0], q[1], zone, mz + 1.2)) return;
      if (sh.some((s) => crosses(mx, my, q[0], q[1], s))) return;
      if (best === null || d < best) best = d;
    });
    return best;
  }
  /* Metres it still has to walk to reach you. */
  function entGap() {
    const E = P.ent;
    if (E.free) return Math.hypot(E.free[0] - P.x, E.free[1] - P.y);
    const n = aiUI.mode === "ai" ? P.node : nearestNode(P.x, P.y, P.z);
    if (E.eid === null) return entDist(E.from, n, MECH);
    const e = NG.edges[E.eid], L = entLen(e);
    return Math.min(L - E.s + entDist(N.other(e, E.from), n, MECH), E.s + entDist(E.from, n, MECH));
  }
  function entityNote() {
    if (!P.ent.on || P.caught) return "";
    const seen = entSeen();
    if (seen !== null) return T.say(` 前面约 ${Math.max(1, Math.round(seen))} 米处站着一个很高的黑影，正朝你这边过来。`, "");
    return entGap() < 25 ? T.say(" 附近传来沉重、拖沓的脚步声，越来越近。", " （听到沉重的脚步声）") : "";
  }
  /* Walking with tools or the entity: night vision drains one bar per 4 s; with the entity, the clock runs in real time. */
  function freeTools(dt) {
    if (P.nv) {
      P.nvT += dt;
      if (P.nvT >= 4) { P.nvT -= 4; P.battery -= 1; P.nvSteps += 1; if (P.battery <= 0) { P.battery = 0; P.nv = false; say("摄像机没电了，夜视关了。"); } }
    }
    if (!TK.entity) return;
    addTime(dt / 60);
    if (P.ent.on) {
      entFree(dt);
      if (P.caught) { P.done = true; P.success = false; if (AUD) AUD.howl(); say("它追上了你。"); finish(); return; }
    }
    if (TK.kind === "survive" && P.minutes >= START_MIN + TK.until) { P.done = true; P.success = true; say("00:00，换班的人到了，那个东西不见了。"); finish(); }
  }

  // ---------------------------------------------------------------- free walking
  function surfaceAt(x, y, z) {
    let best = null, bd = 0.45;
    for (const s of SURFS) {
      if (x < s.x0 - 1e-6 || x > s.x1 + 1e-6 || y < s.y0 - 1e-6 || y > s.y1 + 1e-6) continue;
      const sz = s.ax === "x" ? s.z0 + ((s.z1 - s.z0) * (x - s.x0)) / (s.x1 - s.x0) : s.z0;
      const d = Math.abs(sz - z);
      if (d < bd) { bd = d; best = sz; }
    }
    return best;
  }
  function clearAt(x, y, z) {
    for (const s of SEGS) {
      if (s.copy || (s.light && !s.dead) || s.z1 < z + 0.25 || s.z0 > z + 1.7) continue;
      if (segDist(x, y, s) < RADIUS) return false;
    }
    return true;
  }
  function crossSeam(ox, nx, y, z) {
    if (!IMP || Math.abs(z) > 1 || Math.abs(y) > HW) return 0;
    if (ox < 4.7 && nx >= 4.7) return SEAM_DX;
    if (ox > 26 && nx <= 26) return -SEAM_DX;
    return 0;
  }
  /* Mechanisms as walls while walking: coming within 0.3 m of a closed shutter, a locked door or the deep water's sandbags stops you. */
  function mechWall(ox, oy, nx, ny, z) {
    const into = (a0, a1, c) => Math.abs(a1 - c) < 0.3 && Math.abs(a1 - c) < Math.abs(a0 - c);
    if (Math.abs(z) < 1) {
      if (!MECH.north && Math.abs(nx) < 0.85 && into(oy, ny, 4.6)) return "shutter";
      if (!MECH.east && Math.abs(ny) < 0.85 && (into(ox, nx, 4.6) || (IMP && into(ox, nx, 4.6 + SEAM_DX)))) return "shutter";
      if (MECH.broken && nx > 28.8 && nx < 31.2 && into(oy, ny, 20.8)) return "broken";
      if (TK.mech === "closed" && Math.abs(ny) < 0.6 && into(ox, nx, 31.3)) return "closed";
    } else if (Math.abs(z - B3Z) < 1) {
      if (MECH.level > WET && into(ox, nx, 5.75)) return "water";
      if (TK.mech === "wedge" && !MECH.wedged && Math.abs(ny) < 0.6 && ox < 31.3 && into(ox, nx, 31.3)) return "oneway";
    }
    return null;
  }
  function tryMove(nx, ny) {
    const why = mechWall(P.x, P.y, nx, ny, P.z);
    if (why) {
      const now = performance.now();
      if (now - P.bumpT > 2500) { MECH.bumps += 1; say(blockedText(why)); }
      P.bumpT = now;
      return false;
    }
    const shift = crossSeam(P.x, nx, ny, P.z), x = nx + shift, y = ny;
    const z = surfaceAt(x, y, P.z);
    if (z === null || !clearAt(x, y, z)) return false;
    const d = Math.hypot(nx - P.x, ny - P.y);
    if (!ropeFree(canon([x, y, z]), d, false)) {
      const now = performance.now();
      if (now - P.bumpT > 2500) { P.ropeTaut += 1; say(ropeTautText()); }
      P.bumpT = now;
      return false;
    }
    P.walked += d;
    if (!TK.entity) addTime(d / M_PER_MIN);
    P.x = x; P.y = y; P.z = z;
    stride(d);
    if (shift) { P.trail.push(null); P.lastRing = true; if (P.phase === "fetch") P.ringUsesAfterCall += 1; P.ringUses += 1; }
    if (IMP && inStair(SW.W, P.x, P.y)) {
      if (P.z < -0.75 * FH) { P.z += FH; P.camZ += FH; P.trail.push(null); P.westDown += 1; }
      else if (P.z > 0.75 * FH) { P.z -= FH; P.camZ -= FH; P.trail.push(null); P.westUp += 1; }
    }
    ropeFree(canon([P.x, P.y, P.z]), d, true);
    const last = P.trail[P.trail.length - 1];
    if (!last || Math.hypot(last[0] - P.x, last[1] - P.y) > 0.4 || Math.abs(last[2] - P.z) > 0.4) P.trail.push([P.x, P.y, P.z]);
    return true;
  }
  const nearNode = (id, r) => { const p = NPOS[NX[id]]; return Math.hypot(P.x - p[0], P.y - p[1]) < r && Math.abs(P.z - p[2]) < 1.2; };
  /* Arrival rules for walking: punch clocks within reach, mark the lap corners, the phone at the desk, the folder at the archive. */
  function freeEvents() {
    if (TK.kind === "patrol") CLOCK_DOORS.forEach((d) => {
      const p = NPOS[NX[d.node]], close = Math.hypot(P.x - p[0], P.y - p[1]) < 1.15 && Math.abs(P.z) < 1;
      if (close && !P.near[d.id]) say(punch(d));
      P.near[d.id] = close;
    });
    if (TK.kind === "fetch") {
      if (P.phase === "lap") {
        ["K1", "K2", "K3"].forEach((k) => { if (nearNode(k, 1.7)) P.lap[k] = true; });
        if (P.lap.K1 && P.lap.K2 && P.lap.K3 && nearNode("L0", 2.4)) say(phoneCall());
      } else if (!P.folder && Math.hypot(P.x - 30.5, P.y - 29) < 1.3 && Math.abs(P.z) < 1) say(takeFolder());
      if (P.phase === "fetch" && late() && !P.done) { say(powerCut()); finish(); }
    }
    if (TK.kind === "carry" && !P.item && nearNode(TK.item[1], 1.4)) say(takeItem());
    if (BUDGET && late() && !P.lateTold) { P.lateTold = true; say("已经超过时限了。"); }
    if (TK.start === "W0" && P.leftWest === null && P.x > -7.6 && Math.abs(P.z) < 1) P.leftWest = 0;
  }
  function freeUpdate(dt) {
    const turn = (keys.ArrowLeft ? 1 : 0) - (keys.ArrowRight ? 1 : 0) + (keys.q ? 1 : 0) - (keys.e ? 1 : 0);
    P.heading = (P.heading + turn * TURN_DEG * dt + 360) % 360;
    P.camH = P.heading;
    const fwd = (keys.w || keys.ArrowUp ? 1 : 0) - (keys.s || keys.ArrowDown ? 1 : 0), side = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
    if (fwd || side) {
      P.moving = true;
      const h = rad(P.heading), sp = (keys.Shift ? RUN : WALK) * dt;
      let mx = Math.cos(h) * fwd + Math.sin(h) * side, my = Math.sin(h) * fwd - Math.cos(h) * side;
      const n = Math.hypot(mx, my);
      mx = (mx / n) * sp; my = (my / n) * sp;
      const k = Math.ceil(sp / 0.06);
      for (let i = 0; i < k; i++) if (!tryMove(P.x + mx / k, P.y + my / k)) { if (!tryMove(P.x + mx / k, P.y)) tryMove(P.x, P.y + my / k); }
      freeEvents();
    }
    P.zoom = !!keys.f;
  }
  function freeStop() {
    if (P.done || P.anim) return;
    if (TK.kind === "fetch" && P.phase === "lap") { say("先跟着地上的箭头巡完一圈。"); return; }
    if (TK.kind === "survive") { say("还没到 00:00，换班的人还没来。"); return; }
    if (TK.kind === "patrol") {
      const v = STILL ? null : window.prompt("交班报告：这层一共有几间房？", "");
      P.report = parseCount(v);
      P.success = nearNode("L0", 3.2) && allPunched();
    } else if (TK.kind === "fetch") P.success = nearNode("L0", 3.2) && P.folder && !late();
    else P.success = nearNode(TK.goal, TK.goal === "L0" ? 3.2 : 1.8) && (TK.kind !== "carry" || P.item) && !late();
    P.done = true;
    say("你宣布结束。");
    finish();
  }

  // ---------------------------------------------------------------- AI action mode on the graph
  const degree = (n) => new Set(NG.adj[n]).size;
  const junction = (n) => { const d = degree(n); return d <= 1 ? "前面没路了。" : d === 2 ? "停下了。" : "停在一个岔口。"; };
  function whereText(n) {
    const id = NINFO[n].id, z = NPOS[n][2], door = DOOR_AT[id];
    if (!b1Lit() && !P.nv && zoneOf(NPOS[n][0], NPOS[n][1], z) === "B1") {
      if (id === "L0") return "来到一处宽敞的地方，几扇门的上方亮着绿色的安全出口指示牌。";
      if (door && door.clock) return "黑暗里摸到一扇门，看不清门牌，门边打卡器的小红灯亮着。";
      if (id === "K3") return "停在走廊拐角，旁边一扇门的上方亮着绿色的安全出口指示牌。";
      if (/^K[12]$/.test(id)) return "停在走廊拐角。";
      return junction(n);
    }
    if (id === "L0") return "来到 B1 电梯厅值班台。";
    if (door) return `停在「${door.label}${door.label === "办公室" ? ` ${door.sub}` : ""}」门口${door.clock ? "，门边有个打卡器" : ""}。`;
    if (id === "K3") return "停在走廊拐角，旁边有一扇防火门，门上方写着「东楼梯」。";
    if (/^K[12]$/.test(id)) return "停在走廊拐角。";
    if (/^W\d$/.test(id)) return `在西楼梯间的平台上，墙上写着「${floorOf(z)}」。`;
    if (/^ES\d$/.test(id)) return `在东楼梯间的平台上，墙上写着「${floorOf(z)}」。`;
    if (id === "B3_e") return "来到 B3 走廊东头。";
    if (id === "B3_w") return "来到 B3 走廊西头，尽头是一扇楼梯间的门。";
    return junction(n);
  }
  function arrive(e) {
    const id = NINFO[P.node].id, out = [];
    if (TK.kind === "patrol" && CLOCK_AT[id]) out.push(punch(CLOCK_AT[id]));
    if (TK.kind === "fetch") {
      if (P.phase === "lap" && /^K[123]$/.test(id)) P.lap[id] = true;
      if (P.phase === "lap" && id === "L0" && e.ring && P.lap.K1 && P.lap.K2 && P.lap.K3) out.push(phoneCall());
      else if (P.phase === "fetch" && id === "C_arch" && !P.folder) out.push(takeFolder());
    }
    if (TK.kind === "carry" && !P.item && P.node === ITEM) out.push(takeItem());
    return out.length ? ` ${out.join(" ")}` : "";
  }
  /* Logic moves at once; the camera then follows the edge (shifting through the ring opening or a repeating storey at the end). */
  function traverse(eid) {
    const e = NG.edges[eid], from = P.node, to = N.other(e, from), fwd = e.a === from;
    P.heading = N.arriveOf(e, from);
    P.walked += e.len;
    ropeAlong(eid, from);
    addTime(cost(eid, from), { eid, from, to });
    P.node = to;
    let pts = fwd ? e.p3 : e.p3.slice().reverse();
    if (!fwd && e.shift) pts = pts.map((p) => [p[0] + e.shift[0], p[1] + e.shift[1], p[2] + e.shift[2]]);
    const shift = e.shift ? (fwd ? e.shift : e.shift.map((v) => -v)) : null;
    if (e.ring) { P.ringUses += 1; if (P.phase === "fetch") P.ringUsesAfterCall += 1; }
    if (e.stair === "W") { if ((e.a === from) === e.aDown) P.westDown += 1; else P.westUp += 1; }
    if (e.kind === "door" && NINFO[from].id === "W0" && P.leftWest === null) P.leftWest = P.steps;
    P.nodes.push(NINFO[to].id);
    P.anim = { kind: "walk", pts, s: 0, len: polyLen3(pts), shift, to, doors: e.doors || [], speed: e.kind === "stairs" ? 3.4 : 5.5 };
    setDoors(P.anim.doors, 1);
  }
  function aiForward() {
    const eid = N.pickExit(NG, P.node, P.heading);
    if (eid === null) {
      const b = (BLOCKED[NINFO[P.node].id] || []).find(([h]) => Math.abs(N.angDiff(h, P.heading)) <= N.TOL);
      return b ? T.say(b[1], b[2]) : "正前方没有可以走的路。";
    }
    const e = NG.edges[eid], down = e.kind === "stairs" && (e.a === P.node) === e.aDown, why = blockedBy(e, P.node, MECH);
    if (why) { MECH.bumps += 1; return blockedText(why); }
    if (!ropeRoom(eid, P.node)) { P.ropeTaut += 1; return ropeTautText(); }
    traverse(eid);
    if (e.kind === "stairs") {
      const fl = floorOf(NPOS[P.node][2]);
      return T.say(`顺着楼梯往${down ? "下" : "上"}走了一层，墙上写着「${fl}」。${placeNote(NINFO[P.node].id)}`, `顺着楼梯往${down ? "下" : "上"}走了一层。`) + arrive(e);
    }
    const m = Math.max(1, Math.round(e.len)), pre = e.kind === "door" ? "推开防火门，" : "";
    return T.say(`${pre}走了约 ${m} 米，${whereText(P.node)}${placeNote(NINFO[P.node].id)}`, `${pre}往前走了约 ${m} 米，${junction(P.node)}`) + arrive(e);
  }
  function doStop(arg) {
    const id = NINFO[P.node].id;
    if (TK.kind === "fetch" && P.phase === "lap") return "先跟着地上的箭头巡完一圈。";
    if (TK.kind === "survive") return "还没到 00:00，换班的人还没来。";
    P.done = true;
    if (TK.kind === "patrol") {
      P.report = parseCount(arg);
      P.success = id === "L0" && allPunched();
      return P.report === null ? "你宣布巡逻结束（没有报告房间数）。" : `你宣布巡逻结束，报告这层一共 ${P.report} 间房。`;
    }
    if (TK.kind === "fetch") { P.success = id === "L0" && P.folder && !late(); return "你宣布已经送到。"; }
    P.success = P.node === GOAL && (TK.kind !== "carry" || P.item) && !late();
    if (TK.kind === "carry" && !P.item) return `你宣布已经送到，可是手里并没有${TK.item[2]}。`;
    return "你宣布已到达终点。";
  }
  /* Right only where the task really cannot be done, and only with every reason named. */
  function doDeclare(text) {
    P.done = P.declared = true;
    P.reason = String(text || "");
    P.reasonScore = SOLVABLE ? 0 : T.reasonScore(TK.blockers, P.reason);
    P.success = !SOLVABLE && P.reasonScore >= 1;
    return "你宣布这个任务做不到。";
  }
  function act(name, arg) {
    if (aiUI.mode !== "ai" || P.done || P.anim) return;
    P.steps += 1;
    P.replay = null;
    P.zoom = false;
    let msg;
    if (name === "turn_left" || name === "turn_right" || name === "turn_around") {
      const delta = name === "turn_left" ? 45 : name === "turn_right" ? -45 : 180;
      P.anim = { kind: "turn", from: P.heading, to: P.heading + delta, t: 0, dur: delta === 180 ? 0.5 : 0.3 };
      P.heading = (P.heading + delta + 360) % 360;
      msg = name === "turn_left" ? "向左转了 45°。" : name === "turn_right" ? "向右转了 45°。" : "原地掉头。";
    } else if (name === "look_closer") { addTime(LOOK_MIN); P.zoom = true; msg = "你停下来，仔细看了看正前方。"; }
    else if (name === "forward") msg = aiForward();
    else if (name === "use") msg = doUse(arg);
    else if (name === "wait") msg = doWait(arg);
    else if (name === "mark") msg = TOOLS.includes("chalk") ? placeMark(arg) : "你身上没有粉笔。";
    else if (name === "night_vision") msg = toggleNV();
    else if (name === "rewind") msg = doRewind(arg);
    else if (name === "take_elevator") msg = NINFO[P.node].id === "L0" ? T.say("电梯门上贴着「检修中 · 暂停使用」，按钮按不亮。", "按钮按不亮。") : "这里没有电梯。";
    else if (name === "take_transit") msg = "这里没有可以乘坐的交通工具。";
    else if (name === "point") msg = "现在不需要指方向。";
    else if (name === "declare_impossible") msg = doDeclare(arg);
    else if (name === "stop") msg = doStop(arg);
    else if (name === "give_up") { P.done = true; P.success = false; msg = "放弃了这一局。"; }
    else msg = `没有「${name}」这个动作。`;
    if (!P.done && TK.kind === "fetch" && P.phase === "fetch" && late()) msg += ` ${powerCut()}`;
    if (!P.done && BUDGET && late() && !P.lateTold) { P.lateTold = true; msg += " 已经超过时限了。"; }
    if (P.nv) { P.battery -= 1; P.nvSteps += 1; if (P.battery <= 0) { P.battery = 0; P.nv = false; msg += " 摄像机没电了，夜视关了。"; } }
    if (TK.entity && P.ent.on && !P.done) {
      if (P.caught) { P.done = true; P.success = false; if (AUD) AUD.howl(); msg += " 它追上了你。"; }
      else msg += entityNote();
    }
    if (!P.done && TK.kind === "survive" && P.minutes >= START_MIN + TK.until - 1e-9) { P.done = true; P.success = true; msg += " 00:00，换班的人到了，那个东西不见了。"; }
    if (!P.done && P.steps >= TK.maxSteps) { P.done = true; msg += "步数用完，本局结束。"; }
    if (P.anim && P.anim.kind !== "turn") { P.anim.msg = msg; say("……"); } else say(msg);
    if (TOOLS.includes("camera") && !STILL) { if (P.anim) P.anim.cache = true; else cacheFrame(); }
    if (P.done) { if (P.anim) P.anim.then = finish; else finish(); }
    refreshStats();
    aiUI.refresh();
  }
  function setDoors(ids, target) { FIRE.forEach((f) => { if (ids.indexOf(f.id) >= 0) f.target = target; }); }
  function endAnim(a) {
    P.anim = null;
    P.camH = P.heading;
    if (a.msg) say(a.msg);
    if (a.then) a.then();
    if (a.cache) cacheFrame();
    aiUI.refresh();
  }
  function pointAt3(pts, s) {
    let acc0 = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1], pts[i + 1][2] - pts[i][2]);
      if (acc0 + L >= s || i === pts.length - 2) {
        const t = L > 0 ? clamp((s - acc0) / L, 0, 1) : 0;
        return [0, 1, 2].map((k) => pts[i][k] + (pts[i + 1][k] - pts[i][k]) * t);
      }
      acc0 += L;
    }
    return pts[pts.length - 1].slice();
  }
  function animUpdate(dt) {
    const a = P.anim;
    if (a.kind === "turn") {
      a.t += dt / a.dur;
      const t = Math.min(1, a.t), s = t * t * (3 - 2 * t);
      P.camH = ((a.from + (a.to - a.from) * s) % 360 + 360) % 360;
      if (a.t >= 1) endAnim(a);
      return;
    }
    const s0 = a.s;
    a.s = Math.min(a.len, a.s + a.speed * dt);
    stride(a.s - s0);
    const p = pointAt3(a.pts, a.s), q = pointAt3(a.pts, Math.min(a.len, a.s + 0.7));
    P.x = p[0]; P.y = p[1]; P.z = p[2];
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-3) {
      const want = N.headingOf(q[0] - p[0], q[1] - p[1]);
      P.camH = (P.camH + N.angDiff(want, P.camH) * Math.min(1, dt * 7) + 360) % 360;
    }
    const last = P.trail[P.trail.length - 1];
    if (!last || Math.hypot(last[0] - P.x, last[1] - P.y) > 0.5) P.trail.push([P.x, P.y, P.z]);
    if (a.s < a.len) return;
    const n = NPOS[a.to];
    if (a.shift) { P.camZ += a.shift[2]; P.trail.push(null); }
    P.x = n[0]; P.y = n[1]; P.z = n[2];
    P.trail.push([P.x, P.y, P.z]);
    setDoors(a.doors, 0);
    endAnim(a);
  }

  // ---------------------------------------------------------------- finishing
  function finish() {
    if ($("result").style.display === "block") return;
    P.done = true;
    const ai = aiUI.mode === "ai", used = P.minutes - START_MIN;
    const rows = [["模式", ai ? `AI 动作模式 · ${T.vision ? "纯视觉" : "图文"}` : "自由行走"], ["楼层", IMP ? "实验版（回廊三边就闭合）" : "对照版（正常楼层）"]];
    if (ai) rows.push(["动作步数", `${P.steps}`]);
    if (P.declared) {
      rows.push(["你的判断", "做不到"], ["实际情况", SOLVABLE ? "其实走得通" : `确实去不了（原因说对 ${Math.round(P.reasonScore * 100)}%）`]);
      if (!SOLVABLE) rows.push(["你给的原因", P.reason || "（没写）"]);
    } else {
      const spl = P.success && optimal.len > 0 ? optimal.len / Math.max(P.walked, optimal.len) : 0;
      rows.push(["实际路程", `${Math.round(P.walked)} 米`], ["最短路线", `${Math.round(optimal.len)} 米`], ["SPL", spl.toFixed(2)]);
    }
    if (TK.kind === "patrol") {
      rows.push(["打卡", `${Object.keys(P.punched).length}/${CLOCK_DOORS.length}，重复打卡 ${P.repunch} 次`],
        ["报告房间数", P.report === null ? "没有报告" : `${P.report}（实际 ${CLOCK_DOORS.length}）`]);
    }
    if (TK.kind === "fetch") {
      rows.push(["文件夹", P.folder ? "拿到了" : "没拿到"], ["断电时间", P.deadline ? T.fmtMin(P.deadline) : "（还没接到电话）"],
        ["电话后走东门", `${P.ringUsesAfterCall} 次`]);
    }
    if (TK.kind === "carry") rows.push([TK.item[2], P.item ? "拿到了" : "没拿到"]);
    if (BUDGET) rows.push(["时限", `${fmtBudget(BUDGET)}（${late() ? "超时了" : "没超时"}）`]);
    if (TK.mech === "shutter") rows.push(["跳闸", `${MECH.trips} 次`], ["卷帘", `北门${MECH.north ? "升着" : "落着"}，东门${MECH.east ? "升着" : "落着"}`]);
    if (TK.mech === "pump") rows.push(["积水", `还剩 ${waterCm()} 厘米`], ["跳闸", `${MECH.trips} 次`], ["原地等", `${MECH.waits} 次`]);
    if (TK.mech === "wedge") rows.push(["门挡", MECH.wedged ? "卡住了门" : "没用"]);
    if (TK.mech) rows.push(["操作开关 / 按钮", `${MECH.uses} 次`], ["被机关挡回", `${MECH.bumps} 次`]);
    if (TK.rope) rows.push(["安全绳", `最远放出 ${Math.round(P.ropeMax)} / ${TK.rope} 米，绷紧 ${P.ropeTaut} 次`]);
    if (TOOLS.includes("chalk")) rows.push(["粉笔记号", MARKS.length ? MARKS.map((m) => `「${m.text}」`).join("") : "没写"]);
    if (TOOLS.includes("camera")) rows.push(["夜视", `用了 ${P.nvSteps} 格电，剩 ${P.battery} 格`], ["回放", `${P.rewinds} 次`]);
    if (TK.entity) rows.push(["那个东西", P.caught ? "追上了你" : P.ent.on ? `最近离你 ${Math.round(P.ent.minD)} 米` : "没有出现"]);
    if (TK.start === "W0") rows.push(["西楼梯", `往下 ${P.westDown} 层，往上 ${P.westUp} 层`]);
    rows.push(["游戏用时", `${Math.round(used * 10) / 10} 分钟（${TK.time} → ${T.fmtMin(P.minutes)}）`]);
    const title = P.success ? `完成：${TK.name} ✓` : P.caught ? "被它追上了" : P.dark ? "断电了：没赶上" : P.declared ? (SOLVABLE ? "判断错了：其实走得通" : "判断对了，但原因没说全") : "未完成";
    $("result").innerHTML = T.resultHTML(title, rows, P.success, (performance.now() - P.t0) / 1000, P.walked);
    $("result").style.display = "block";
    T.bindResult(reset, () => { if (!state.god) toggleGod(); });
  }
  function openDeclare() {
    if (P.done || P.anim) return;
    T.declare(["西楼梯", "东楼梯", "电梯", "走廊绕回原处", "B2 的门锁着", "防火卷帘", "积水", "门打不开", "时间不够"], (picked) => {
      const text = picked.join("、");
      if (aiUI.mode === "ai") act("declare_impossible", text);
      else { say(doDeclare(text)); finish(); }
    });
  }

  // ---------------------------------------------------------------- god view (debugging only; the impossible ring is drawn with its opening marked)
  const god = $("god"), gctx = god.getContext("2d");
  const GB = [-15, -5.5, 38.5, 36.5], GS = Math.min((god.width - 16) / (GB[2] - GB[0]), (god.height - 30) / (GB[3] - GB[1]));
  const gx = (x) => 8 + (x - GB[0]) * GS, gy = (y) => god.height - 8 - (y - GB[1]) * GS;
  function drawGod() {
    const lv = floorOf(P.z);
    gctx.fillStyle = "#1c1a15"; gctx.fillRect(0, 0, god.width, god.height);
    const rect = (r, fill) => { gctx.fillStyle = fill; gctx.fillRect(gx(r[0]), gy(r[3]), (r[2] - r[0]) * GS, (r[3] - r[1]) * GS); };
    ROOMS.forEach((r) => { if ((lv === "B3") === !!r.b3 && lv !== "B2") rect(r.r, r.b3 ? "#5b5b53" : "#9b8b58"); });
    PASSAGES.forEach((p) => { if (floorOf(p.z) === lv) rect(p.r, p.dead ? "#7a2a24" : "#c9b98a"); });
    STAIRS.forEach((s) => rect([Math.min(sx(s, 0), sx(s, 6.2)), -1.5, Math.max(sx(s, 0), sx(s, 6.2)), 1.5], "#4b5258"));
    if (IMP && lv === "B1") {
      gctx.strokeStyle = "#ff5252"; gctx.setLineDash([4, 3]); gctx.lineWidth = 1.5;
      gctx.beginPath(); gctx.moveTo(gx(26), gy(0)); gctx.bezierCurveTo(gx(22), gy(-4.8), gx(9), gy(-4.8), gx(4.7), gy(0)); gctx.stroke();
      gctx.setLineDash([]);
      gctx.fillStyle = "#ff8a80"; gctx.font = "11px sans-serif"; gctx.textAlign = "center"; gctx.fillText("开口直通电梯厅", gx(15.3), gy(-4.9));
    }
    if (lv === "B1") CLOCK_DOORS.forEach((d) => { const p = NPOS[NX[d.node]]; gctx.fillStyle = P.punched[d.id] ? "#66bb6a" : "#ffa726"; gctx.fillRect(gx(p[0]) - 3, gy(p[1]) - 3, 6, 6); });
    // closed shutters and locked doors in red, the one-way door in orange, the flood in blue
    const bar = (x0, y0, x1, y1, col) => { gctx.strokeStyle = col || "#ff1744"; gctx.lineWidth = 3; gctx.beginPath(); gctx.moveTo(gx(x0), gy(y0)); gctx.lineTo(gx(x1), gy(y1)); gctx.stroke(); };
    if (lv === "B1") {
      if (!MECH.north) bar(-0.8, 4.6, 0.8, 4.6);
      if (!MECH.east) bar(4.6, -0.8, 4.6, 0.8);
      if (MECH.broken) bar(28.8, 20.8, 31.2, 20.8);
      if (TK.mech === "closed") bar(31.3, -0.6, 31.3, 0.6);
    }
    if (lv === "B3") {
      if (MECH.level > 0.005) { gctx.fillStyle = `rgba(60,140,255,${0.2 + 0.4 * MECH.level})`; gctx.fillRect(gx(-7.7), gy(HW), (5.75 + 7.7) * GS, 2 * HW * GS); }
      if (TK.mech === "wedge" && !MECH.wedged) bar(31.3, -0.6, 31.3, 0.6, "#ff9100");
    }
    if (TK.rope && P.ropePts.length > 1) {
      gctx.strokeStyle = "#ff9100"; gctx.lineWidth = 1.5; gctx.beginPath();
      let on = false;
      P.ropePts.forEach((p, i) => {
        const q = P.ropePts[i - 1];
        if (floorOf(p[2]) !== lv || (q && Math.hypot(p[0] - q[0], p[1] - q[1]) > 1.6)) on = false;
        if (floorOf(p[2]) !== lv) return;
        if (on) gctx.lineTo(gx(p[0]), gy(p[1])); else gctx.moveTo(gx(p[0]), gy(p[1]));
        on = true;
      });
      gctx.stroke();
    }
    MARKS.forEach((m) => { if (floorOf(m.p[2]) === lv) { gctx.fillStyle = "#ffffff"; gctx.fillRect(gx(m.p[0]) - 2, gy(m.p[1]) - 2, 4, 4); } });
    if (TK.entity && P.ent.on) {
      const q = canon(entWorld());
      if (floorOf(q[2]) === lv) { gctx.fillStyle = "#ff1744"; gctx.beginPath(); gctx.arc(gx(q[0]), gy(q[1]), 5, 0, 7); gctx.fill(); }
    }
    gctx.font = "15px sans-serif"; gctx.textAlign = "center"; gctx.textBaseline = "middle"; gctx.fillStyle = "#ff4081";
    const gnode = TK.kind === "fetch" ? (P.phase === "fetch" && !P.folder ? ARCH : LOBBY) : TK.kind === "carry" && !P.item ? ITEM : GOAL;
    const goal = NPOS[gnode];
    if (floorOf(goal[2]) === lv) gctx.fillText("★", gx(goal[0]), gy(goal[1]));
    gctx.strokeStyle = "#ff6d00"; gctx.lineWidth = 2; gctx.beginPath();
    let pen = false;
    P.trail.concat([[P.x, P.y, P.z]]).forEach((t) => {
      if (!t || floorOf(t[2]) !== lv) { pen = false; return; }
      if (pen) gctx.lineTo(gx(t[0]), gy(t[1])); else gctx.moveTo(gx(t[0]), gy(t[1]));
      pen = true;
    });
    gctx.stroke();
    const h = rad(aiUI.mode === "ai" ? P.camH : P.heading), px = gx(P.x), py = gy(P.y);
    gctx.beginPath(); gctx.moveTo(px + Math.cos(h) * 8, py - Math.sin(h) * 8);
    gctx.lineTo(px + Math.cos(h + 2.5) * 5, py - Math.sin(h + 2.5) * 5); gctx.lineTo(px + Math.cos(h - 2.5) * 5, py - Math.sin(h - 2.5) * 5);
    gctx.closePath(); gctx.fillStyle = "#ff6d00"; gctx.fill();
    $("godTitle").textContent = `上帝视角 · ${lv}${IMP ? " · 实验版" : " · 对照版"}（调试用，AI 看不到）`;
  }
  function toggleGod() {
    if (!state.god && T.godLocked(P.done)) { say("挑战模式：上帝视角要到结算后才能看。"); return; }
    state.god = !state.god;
    $("godwrap").style.display = state.god ? "block" : "none";
    $("godBtn").classList.toggle("on", state.god);
  }

  // ---------------------------------------------------------------- input & loop
  function nearestNode(x, y, z) {
    let best = 0, bd = Infinity;
    NPOS.forEach((p, i) => { const d = Math.hypot(p[0] - x, p[1] - y) + Math.abs(p[2] - z) * 3; if (d < bd) { bd = d; best = i; } });
    return best;
  }
  const aiUI = N.ui({
    onAction: (name, arg) => {
      if (name === "stop" && TK.kind === "patrol" && arg === undefined && !STILL) arg = window.prompt("交班报告：这层一共有几间房？", "");
      act(name, arg);
    },
    onDeclare: openDeclare,
    canSwitch: () => !P.anim && !P.done,
    onMode(mode) {
      if (mode === "ai") {
        const n = nearestNode(P.x, P.y, P.z), p = NPOS[n];
        const d = Math.hypot(p[0] - P.x, p[1] - P.y);
        P.walked += d; addTime(d / M_PER_MIN);
        P.node = n; P.x = p[0]; P.y = p[1]; P.z = p[2]; P.steps = 0; P.camH = P.heading; P.pitch = -0.03;
        FRAMEC.length = 0;
        setTimeout(cacheFrame, 0);
        P.trail.push([P.x, P.y, P.z]);
        say("AI 动作模式：每次前进走到下一个门口或拐角；楼梯也是朝着它前进；时钟按动作前进。");
      } else say("自由行走：W/S 前后，A/D 平移，←/→ 或鼠标拖动转身，按住 F 走近看。");
      $("hint").style.display = mode === "ai" ? "none" : "block";
      refreshStats();
    },
    state: () => ({ floors: null, transit: false, pointing: false }),
  });
  /* Switches within reach (or at this stop) as buttons, keys 1–9; Z waits 30 s. In the action mode both count as actions. */
  const useBar = document.createElement("div");
  useBar.id = "usebar";
  $("bottom").insertBefore(useBar, $("hint"));
  /* Tools as buttons: chalk (C), night vision (N), replay of the previous step (B, action mode only). */
  const toolBar = document.createElement("div");
  toolBar.id = "toolbar";
  $("bottom").insertBefore(toolBar, $("hint"));
  let toolKey = "";
  function refreshTools() {
    if (!TOOLS.length) return;
    const ai = aiUI.mode === "ai", key = `${ai}|${P.done}|${P.nv}|${P.battery}|${MARKS.length}`;
    if (key === toolKey) return;
    toolKey = key;
    toolBar.innerHTML = P.done ? "" : (TOOLS.includes("chalk") ? `<button data-t="mark">粉笔记号 <kbd>C</kbd></button>` : "") +
      (TOOLS.includes("camera") ? `<button data-t="nv">夜视${P.nv ? "（开着）" : ""} · 电量 ${P.battery}/${BATTERY} <kbd>N</kbd></button>` +
        (ai ? `<button data-t="rewind">回放上一步 <kbd>B</kbd></button>` : "") : "");
    toolBar.querySelectorAll("button").forEach((b) => (b.onclick = () => toolUI(b.dataset.t)));
  }
  function toolUI(t) {
    if (P.done || !t) return;
    const ai = aiUI.mode === "ai";
    if (t === "mark" && TOOLS.includes("chalk")) {
      if (!ai) say(placeMark(String(MARKS.length + 1)));
      else { const v = STILL ? String(MARKS.length + 1) : window.prompt("用粉笔写什么？", String(MARKS.length + 1)); if (v !== null) act("mark", v); }
    } else if (t === "nv" && TOOLS.includes("camera")) { if (ai) act("night_vision"); else say(toggleNV()); }
    else if (t === "rewind" && TOOLS.includes("camera")) { if (ai) act("rewind", 1); else say("自由行走时不能回放。"); }
  }
  const replayBox = document.createElement("div");
  replayBox.id = "replay";
  replayBox.innerHTML = `<img alt="回放"><div></div>`;
  replayBox.onclick = () => (replayBox.style.display = "none");
  document.body.appendChild(replayBox);
  function showReplay(url, n) {
    replayBox.querySelector("img").src = url;
    replayBox.querySelector("div").textContent = `回放：${n} 步之前拍到的画面 · 点任意处关闭`;
    replayBox.style.display = "flex";
  }
  let useKey = "";
  const ctlState = (id) => {
    const b = /^br(\d)$/.exec(id);
    if (b) return MECH.br[b[1]] ? "（合）" : "（断）";
    if (id === "main") return MECH.main ? "（合）" : "（断）";
    if (id === "fan" || id === "pump") return MECH[id] ? "（合）" : "（断）";
    return "";
  };
  function refreshUse() {
    const here = controlsHere();
    const key = `${aiUI.mode}|${P.done}|${here.map((c) => c.id + ctlState(c.id)).join(",")}`;
    if (key === useKey) return;
    useKey = key;
    useBar.innerHTML = here.map((c, i) => `<button data-i="${i}">${c.names[0]}${ctlState(c.id)} <kbd>${i + 1}</kbd></button>`).join("") +
      (P.done ? "" : `<button data-w="1" class="wait">原地等 30 秒 <kbd>Z</kbd></button>`);
    useBar.querySelectorAll("button[data-i]").forEach((b) => (b.onclick = () => useAt(+b.dataset.i)));
    const w = useBar.querySelector("button[data-w]");
    if (w) w.onclick = waitUI;
  }
  function useAt(i) {
    const c = controlsHere()[i];
    if (!c) return;
    if (aiUI.mode === "ai") act("use", c.names[0]);
    else say(doUse(c.names[0]));
  }
  function waitUI() {
    if (aiUI.mode === "ai") act("wait");
    else if (!P.done) say(doWait());
  }
  window.addEventListener("keydown", (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === "g") return toggleGod();
    if (k === "r") return reset();
    if (e.target.tagName !== "INPUT" && /^[1-9]$/.test(k)) return useAt(+k - 1);
    if (e.target.tagName !== "INPUT" && k === "z") return waitUI();
    if (e.target.tagName !== "INPUT" && (k === "c" || k === "n" || k === "b") && TOOLS.length) return toolUI({ c: "mark", n: "nv", b: "rewind" }[k]);
    if (aiUI.mode === "ai") return;
    if (k === "Enter") return freeStop();
    if (k === "x") return openDeclare();
    keys[k] = true;
    if (k.startsWith("Arrow") || k === " ") e.preventDefault();
  });
  window.addEventListener("keyup", (e) => { keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false; });
  window.addEventListener("blur", () => Object.keys(keys).forEach((k) => (keys[k] = false)));
  let drag = null;
  canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointerup", () => { drag = null; });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag || P.done || aiUI.mode === "ai") return;
    P.heading = (P.heading - (e.clientX - drag.x) * 0.25 + 360) % 360;
    P.pitch = clamp(P.pitch - (e.clientY - drag.y) * 0.003, -0.9, 0.7);
    drag = { x: e.clientX, y: e.clientY };
  });
  $("godBtn").onclick = toggleGod;
  $("resetBtn").onclick = reset;
  $("task").innerHTML = T.card([["起点", TK.startName], ["目标", TK.goalName], ["出发时间", TK.time], ["步数上限", `${TK.maxSteps}（AI 动作模式）`], ["规则", RULES]]);
  $("declBtn").onclick = openDeclare;

  /* Camcorder footage is framed 4:3 and pillarboxed; the other looks fill the window. */
  function resize() {
    const tape = liveLook === "vhs";
    document.body.classList.toggle("tape", tape);
    let w = window.innerWidth, h = window.innerHeight;
    if (tape) { if (w / h > 4 / 3) w = Math.round((h * 4) / 3); else h = Math.round((w * 3) / 4); }
    [canvas, $("osd")].forEach((el) => { if (el) { el.style.width = `${w}px`; el.style.height = `${h}px`; } });
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  const LOOK_NAMES = { vhs: "录像带", film: "胶片", clean: "原始" };
  function setLook(l) {
    liveLook = l;
    $("lookBtn").innerHTML = `画面：${LOOK_NAMES[l]} <kbd>V</kbd>`;
    renderer.setPixelRatio(l === "vhs" ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
    resize();
  }
  function setMuted(m) {
    if (AUD) AUD.setMuted(m);
    $("soundBtn").innerHTML = `声音：${m ? "关" : "开"} <kbd>M</kbd>`;
  }
  $("lookBtn").onclick = () => setLook(LOOKS[(LOOKS.indexOf(liveLook) + 1) % LOOKS.length]);
  $("soundBtn").onclick = () => setMuted(!(AUD && AUD.muted));
  window.addEventListener("keydown", (e) => {
    if (AUD) AUD.start();
    if (e.target.tagName === "INPUT") return;
    const k = e.key.toLowerCase();
    if (k === "v") setLook(LOOKS[(LOOKS.indexOf(liveLook) + 1) % LOOKS.length]);
    else if (k === "m") setMuted(!(AUD && AUD.muted));
    else if (k === "h") document.body.classList.toggle("nohud");
  });
  window.addEventListener("pointerdown", () => { if (AUD) AUD.start(); });
  $("task").addEventListener("click", (e) => { if (e.target.tagName === "H3") $("task").classList.toggle("mini"); });
  /* Footfalls: one sound and one bob per 0.72 m, carpet on B1 and concrete elsewhere. */
  function stride(d) {
    P.stride += d;
    P.bob += (d * Math.PI) / 0.72;
    if (P.stride < 0.72) return;
    P.stride -= 0.72;
    if (AUD) AUD.step(LOOK === "yellow" && zoneOf(P.x, P.y, P.z) === "B1" ? "carpet" : "hard");
  }
  function step(dt) {
    if (P.anim) animUpdate(dt);
    else if (!P.done && aiUI.mode === "free") freeUpdate(dt);
    if (!P.anim || P.anim.kind === "turn") P.camZ += (P.z + EYE - P.camZ) * Math.min(1, dt * 10);
    else P.camZ = P.z + EYE;
    mechUpdate(dt);
    if (aiUI.mode === "free" && !P.done && (TK.entity || P.nv)) freeTools(dt);
    FIRE.forEach((f) => {
      if (aiUI.mode === "free" && !P.done) f.target = Math.hypot(P.x - f.x, P.y - f.y) < 1.5 && Math.abs(P.z - f.z) < 1.2 ? 1 : 0;
      if (TK.mech === "closed" && f.id === "pES") f.target = 0;
      if (TK.mech === "wedge" && f.id === "pES3") f.target = MECH.wedged ? 1 : aiUI.mode === "free" && P.x < 31.3 ? 0 : f.target;
      if (f.target > 0.5 && !f.wasOpen && AUD) AUD.door();
      f.wasOpen = f.target > 0.5;
      f.angle += (f.target - f.angle) * Math.min(1, dt * 6);
      f.group.rotation.y = -f.side * f.angle * 1.45;
    });
    P.move += ((P.moving || (P.anim && P.anim.kind === "walk") ? 1 : 0) - P.move) * Math.min(1, dt * 4);
    P.moving = false;
    P.aiPitch += (aiPitch(P.x, P.y, P.z) - P.aiPitch) * Math.min(1, dt * 5);
  }
  /* In the action mode the view looks a little down inside stairwells, the way people do on stairs; otherwise straight ahead. */
  const aiPitch = (x, y, z) => (zoneOf(x, y, z) === "stair" ? -0.3 : -0.03);
  function draw(look, o) {
    if (look === "clean" || !FXR) renderer.render(scene, camera);
    else FXR.render(scene, camera, Object.assign({ look }, o));
  }
  const T0 = performance.now(), pad2 = (n) => String(n).padStart(2, "0");
  let lastT = T0, nextStomp = 0, flickOn = true, nextThud = 25 + Math.random() * 30, nextGlitch = 9 + Math.random() * 14, glitchUntil = 0;
  /* Tape starting up for the first second and a half, then a tracking glitch every 10–28 s. */
  function liveGlitch(t, since) {
    if (liveLook !== "vhs") return 0;
    if (t > nextGlitch) { glitchUntil = t + 0.25 + Math.random() * 0.5; nextGlitch = t + 10 + Math.random() * 18; }
    return Math.max(Math.max(0, 1 - since / 1.4), t < glitchUntil ? 0.35 + 0.4 * Math.random() : 0);
  }
  /* The camcorder's auto exposure hunts a little; it also fades in as the tape starts. */
  function liveExposure(t, since) {
    return liveLook === "vhs" ? Math.min(1, since / 1.2) * (1 + 0.035 * Math.sin(t * 0.37) + 0.02 * Math.sin(t * 1.13)) : 1;
  }
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000), t = now / 1000, since = (now - T0) / 1000;
    lastT = now;
    step(dt);
    // hand-held: slow drift and roll, plus a bob in step with walking
    const ai = aiUI.mode === "ai", hand = liveLook === "vhs" ? 1 : liveLook === "film" ? 0.4 : 0;
    const yaw = hand * (0.45 * Math.sin(t * 0.71) + 0.25 * Math.sin(t * 1.37 + 1.3)) * (1 + P.move * 0.6);
    const pit = hand * (0.3 * Math.sin(t * 0.53 + 2.1) + 0.15 * Math.sin(t * 1.91) + P.move * 0.5 * Math.sin(P.bob * 2));
    const roll = hand * (0.35 * Math.sin(t * 0.61 + 3.0) + P.move * 0.6 * Math.sin(P.bob));
    camera.position.copy(v3(P.x, P.y, P.camZ + hand * P.move * 0.028 * Math.sin(P.bob * 2)));
    camera.rotation.set((ai ? P.aiPitch : P.pitch) + rad(pit), rad((ai ? P.camH : P.heading) - 90 + yaw), rad(roll));
    const fov = P.zoom ? ZOOM_FOV : liveLook === "vhs" ? 60 : FOV;
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 12); camera.updateProjectionMatrix(); }
    if (!STILL) {
      const on = Math.sin(t * 23) + Math.sin(t * 7.3) > -0.4 || Math.sin(t * 1.7) > 0.6;
      M.trofferFlicker.color.copy(M.troffer.color).multiplyScalar(on ? 1 : 0.18);
      if (on !== flickOn && AUD) AUD.crackle(Math.min(99, ...FLICKERING.map((p) => Math.hypot(p[0] - P.x, p[1] - P.y) + Math.abs(p[2] - P.z) * 4)));
      flickOn = on;
      const zone = zoneOf(P.x, P.y, P.z) === "B1" && !b1Lit() ? "dark" : zoneOf(P.x, P.y, P.z);
      if (AUD && zone !== P.soundZone) { P.soundZone = zone; AUD.setZone(zone); }
      if (t > nextThud) { nextThud = t + 25 + Math.random() * 35; if (AUD && zone === "B1") AUD.distant(); }
    }
    applyFog(P.x, P.y, P.z);
    refreshStats();
    refreshUse();
    refreshTools();
    if (!P.done) { const s = Math.floor((now - P.t0) / 1000); $("time").textContent = `${Math.floor(s / 60)}:${pad2(s % 60)}`; }
    T.showClock(P.minutes);
    const osd = $("osd");
    if (osd) {
      osd.style.display = liveLook === "vhs" ? "block" : "none";
      const m = P.minutes, h = Math.floor(m / 60) % 24;
      $("osdTime").textContent = `${h >= 12 ? "PM" : "AM"} ${((h + 11) % 12) + 1}:${pad2(Math.floor(m % 60))}:${pad2(Math.floor((m * 60) % 60))}`;
    }
    entPlace(t);
    const gapNow = TK.entity && P.ent.on && !P.done ? entGap() : Infinity;
    if (AUD && t > nextStomp && gapNow < 30) { nextStomp = t + 0.6; AUD.stomp(1 - gapNow / 30); }
    const batt = $("osdBatt");
    if (batt) batt.textContent = TOOLS.includes("camera") ? `BATT ${"▮".repeat(P.battery)}${"▯".repeat(Math.max(0, BATTERY - P.battery))}${P.nv ? "   NV" : ""}` : "";
    draw(P.nv ? "nv" : liveLook, { time: t, glitch: Math.max(liveGlitch(t, since), clamp(1 - gapNow / 12, 0, 1) * 0.6),
      exposure: P.nv ? nvExposure(P.x, P.y, P.z) : liveExposure(t, since), tape: liveLook === "vhs" ? 540 : 0 });
    if (state.god) drawGod();
    requestAnimationFrame(frame);
  }
  /* One picture from any pose (agent frames) without disturbing the live view: no hand-held motion, and the frame look
     is deterministic (grain in "vhs" frames is seeded by the step count). */
  function snapshot(x, y, z, headingDeg, pitch, fov, w, h, mime, look, o) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    const saved = [camera.position.clone(), camera.rotation.clone(), camera.fov, camera.aspect];
    renderer.setSize(w, h, false);
    camera.position.copy(v3(x, y, z + EYE));
    camera.rotation.set(pitch, rad(headingDeg - 90), 0);
    camera.fov = fov; camera.aspect = w / h; camera.updateProjectionMatrix();
    applyFog(x, y, z);
    const nv = P.nv && !(o && o.fx);
    entPlace(P.steps * 0.37);
    draw(nv ? "nv" : look || FRAME_LOOK, Object.assign({ time: P.steps * 0.37, seed: P.steps, exposure: nv ? nvExposure(x, y, z) : 1, noScan: true }, o && o.fx));
    const url = o && o.into ? o.into(renderer.domElement) : renderer.domElement.toDataURL(mime || "image/jpeg", 0.88);
    renderer.setSize(size.x, size.y, false);
    camera.position.copy(saved[0]); camera.rotation.copy(saved[1]);
    camera.fov = saved[2]; camera.aspect = saved[3]; camera.updateProjectionMatrix();
    return url;
  }
  /* Task images. The tape: ten frames of the previous guard's patrol (lobby → A → B → C → back through the east door) with the
     camcorder clock, shot before the power went; the clock shows how far apart the frames are. The photo: a colleague's view. */
  const TAPE = [[0, 0, 90, 0], [0, 9, 90, 9], [0.6, 34, 0, 36.6], [12, 34, 0, 48], [24, 34, 0, 60], [30, 32, 270, 70], [30, 18, 270, 84],
    [30, 4, 270, 98], [30, 0, 180, 104], [3.4, 0, 225, IMP ? 109.3 : 130.6]];
  function tapeSheet() {
    const W = 384, H = 216, CAP = 30, PAD = 8, cols = 5, c = document.createElement("canvas");
    c.width = cols * W + (cols + 1) * PAD;
    c.height = 2 * (H + CAP) + 3 * PAD;
    const g = c.getContext("2d"), t0 = 22 * 3600 + 41 * 60 + 7, nums = "①②③④⑤⑥⑦⑧⑨⑩";
    g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height);
    forceLit = true; applyPower();
    TAPE.forEach(([x, y, h, sec], i) => {
      const dx = PAD + (i % cols) * (W + PAD), dy = PAD + Math.floor(i / cols) * (H + CAP + PAD);
      snapshot(x, y, 0, h, -0.03, BENCH_FOV, W, H, null, FRAME_LOOK, { fx: { seed: i + 1, time: i * 0.37 }, into: (cv) => g.drawImage(cv, 0, 0, cv.width, cv.height, dx, dy, W, H) });
      const s = Math.round(t0 + sec), hh = Math.floor(s / 3600) % 24;
      g.fillStyle = "#111"; g.fillRect(dx, dy + H, W, CAP);
      g.font = `600 20px ${FONT}`; g.textBaseline = "middle"; g.textAlign = "left"; g.fillStyle = "#fff";
      g.fillText(`${nums[i]}   ${hh >= 12 ? "PM" : "AM"} ${((hh + 11) % 12) + 1}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`, dx + 10, dy + H + CAP / 2);
    });
    forceLit = false; applyPower();
    return c.toDataURL("image/png");
  }
  function taskImage() {
    if (TK.photo) { const [x, y, z, h] = TK.photo; return snapshot(x, y, z, h, -0.03, BENCH_FOV, 768, 432, "image/png", FRAME_LOOK, { fx: { seed: 7, time: 2.6 } }); }
    return TK.tape ? tapeSheet() : null;
  }
  let TASK_IMG = null;
  function info() {
    const spl = P.success && optimal.len > 0 ? optimal.len / Math.max(P.walked, optimal.len) : 0;
    const d = { success: P.success, steps: P.steps, walked_m: Math.round(P.walked), optimal_m: Math.round(optimal.len), spl: Math.round(spl * 1000) / 1000,
      clock: T.fmtMin(P.minutes), elapsed_min: Math.round((P.minutes - START_MIN) * 10) / 10, optimal_min: Math.round(optimal.minutes * 10) / 10,
      place: NINFO[P.node].name || NINFO[P.node].id, level: floorOf(P.z), solvable: SOLVABLE, variant: IMP ? "impossible" : "control", look: LOOK,
      phase: P.phase, nodes: P.nodes.slice() };
    if (TK.kind === "fetch") Object.assign(d, { lap_done: P.phase !== "lap", has_folder: P.folder, budget_s: P.budget,
      deadline: P.deadline === null ? null : T.fmtMin(P.deadline), power_cut: P.dark, east_door_uses_after_call: P.ringUsesAfterCall });
    if (TK.kind === "patrol") Object.assign(d, { punched: CLOCK_DOORS.filter((c) => P.punched[c.id]).map((c) => c.id), rooms: CLOCK_DOORS.length,
      repunches: P.repunch, report: P.report, report_correct: P.report === CLOCK_DOORS.length });
    if (TK.kind === "reach" || TK.kind === "carry") Object.assign(d, { goal: TK.goal, at_goal: P.node === GOAL });
    if (TK.kind === "carry") Object.assign(d, { item: TK.item[0], has_item: P.item });
    if (BUDGET) Object.assign(d, { budget_s: BUDGET, deadline: T.fmtMin(P.deadline), late: late() });
    if (TK.start === "W0") Object.assign(d, { west_descents: P.westDown, west_ascents: P.westUp,
      extra_west_descents: IMP ? Math.max(0, P.westDown - 1) : null, left_west_stair_at_step: P.leftWest });
    if (TK.mech) {
      const m = { uses: MECH.uses, blocked_moves: MECH.bumps };
      if (TK.mech === "shutter") Object.assign(m, { breakers: Object.assign({}, MECH.br), main_on: MECH.main, trips: MECH.trips, north_shutter_up: MECH.north, east_shutter_up: MECH.east });
      if (TK.mech === "pump") Object.assign(m, { fan_on: MECH.fan, pump_on: MECH.pump, box_on: MECH.box, trips: MECH.trips, water_cm: waterCm(), waits: MECH.waits });
      if (TK.mech === "wedge") m.wedged = MECH.wedged;
      d.mech = m;
    }
    if (TK.rope) Object.assign(d, { rope_out_m: Math.round(P.ropeLen), rope_max_m: Math.round(P.ropeMax), rope_taut: P.ropeTaut });
    if (TOOLS.includes("chalk")) d.marks = MARKS.map((m) => m.text);
    if (TOOLS.includes("camera")) Object.assign(d, { night_vision: P.nv, battery: P.battery, nv_bars_used: P.nvSteps, rewinds: P.rewinds });
    if (TK.entity) Object.assign(d, { entity_out: P.ent.on, caught: P.caught, closest_m: P.ent.on && isFinite(P.ent.minD) ? Math.round(P.ent.minD * 10) / 10 : null });
    if (TK.kind === "survive") d.survived = !P.caught && P.minutes >= START_MIN + TK.until - 1e-9;
    if (P.declared) Object.assign(d, { declared_impossible: true, reason: P.reason, reason_score: P.reasonScore });
    return d;
  }
  /* nav.oracle turns 180° as four 45° turns and 135° as three; one turn_around (plus one turn back) is the same heading in fewer actions. */
  function compactTurns(acts) {
    const out = [];
    for (let i = 0; i < acts.length;) {
      const a = acts[i];
      if (a !== "turn_left" && a !== "turn_right") { out.push(a); i += 1; continue; }
      let j = i;
      while (j < acts.length && acts[j] === a) j += 1;
      if (j - i === 4) out.push("turn_around");
      else if (j - i === 3) out.push("turn_around", a === "turn_left" ? "turn_right" : "turn_left");
      else for (let k = i; k < j; k++) out.push(a);
      i = j;
    }
    return out;
  }
  /* Fastest actions for what is left, switching mechanisms on the way where needed (self-checks only, never shown to an agent).
     The fetch lap ends at the desk; call again for the errand. */
  /* Shift change: stay in the lobby; each time it is about to come through the open door, wait until the last safe second and
     lower that door's shutter (the interlock raises the other one, so it has to go all the way round). */
  function holdoutPlan() {
    const out = [], deadline = START_MIN + TK.until, clone = (E) => Object.assign({}, E);
    const sim = (E, S, dm) => {
      const speed = TK.entity.speed, ticks = Math.max(1, Math.ceil((dm * speed) / 1.2));
      for (let i = 1; i <= ticks; i++) { entMove(E, (dm * speed) / ticks, LOBBY, S); if (entGapTo(E, LOBBY) < 1.5) return (dm * i) / ticks; }
      return null;
    };
    const waits = (sec) => { while (sec > 0) { let k = Math.min(60, sec); if (sec - k > 0 && sec - k < 5) k = sec - 5; out.push(["wait", k]); sec -= k; } };
    let E = clone(P.ent), S = withMech({}), t = P.minutes;
    for (let guard = 0; guard < 12 && t < deadline - 1e-9; guard++) {
      const left = deadline - t, T = E.on ? sim(clone(E), S, left) : null;
      if (T === null) { waits(Math.max(5, Math.ceil(left * 60 - 1e-6))); break; }
      const door = approachDoor(E, S);
      if (!door) break;
      const btn = door === "north" ? "east" : "north", S2 = Object.assign({}, S, { [btn]: true, [door]: false });
      let best = null;
      for (let sec = Math.floor(T * 60 - 1e-6); sec >= 0 && !best; sec--) {
        if (sec > 0 && sec < 5) continue;
        const E1 = clone(E);
        if (sec && sim(E1, S, sec / 60) !== null) continue;
        const T2 = sim(clone(E1), S2, Math.min(left - sec / 60, 0.5));
        if (T2 === null || T2 > 6 / 60) best = { sec, E1 };
      }
      if (!best) break;
      waits(best.sec);
      out.push(["use", btn === "north" ? "北门卷帘" : "东门卷帘"]);
      E = best.E1; S = S2; t += best.sec / 60;
    }
    return out;
  }
  function oracleActions() {
    const out = [], use = (name) => out.push(["use", name]);
    let n = P.node, h = P.heading, wedged = MECH.wedged;
    const walk = (path) => {
      let piece = [];
      const flush = () => {
        if (!piece.length) return;
        out.push(...compactTurns(N.oracle(NG, piece, h, null, null)));
        const [n0, eid] = piece[piece.length - 1];
        h = N.arriveOf(NG.edges[eid], n0);
        n = N.other(NG.edges[eid], n0);
        piece = [];
      };
      path.forEach(([n0, eid]) => {
        const e = NG.edges[eid];
        if (TK.mech === "wedge" && !wedged && n0 === NX.ES3 && e.doors && e.doors[0] === "pES3") { flush(); use("门挡"); wedged = true; }
        piece.push([n0, eid]);
      });
      flush();
    };
    const go = (goal, S) => { if (n === goal) return true; const p = plan(n, goal, S); if (p) walk(p.path); return !!p; };
    if (TK.kind === "patrol") {
      const t = tour(n, CLOCK_DOORS.filter((d) => !P.punched[d.id]).map((d) => NX[d.node]), LOBBY);
      if (t) walk(t.path);
      return out.concat([["stop", CLOCK_DOORS.length]]);
    }
    if (TK.kind === "fetch" && P.phase === "lap") {
      ["K1", "K2", "K3"].filter((k) => !P.lap[k]).map((k) => NX[k]).concat([LOBBY]).forEach((w) => go(w));
      return out;
    }
    if (TK.kind === "fetch") { if (!P.folder) go(ARCH); go(LOBBY); return out.concat(["stop"]); }
    if (!SOLVABLE) return [["declare_impossible", TK.declare || "西楼梯一直绕回 B1，东楼梯在检修、门锁着，下不到 B3"]];
    if (TK.kind === "survive") return holdoutPlan();
    if (TK.mech === "pump") {
      if (!plan(n, GOAL)) {
        const before = MECH.level - (pumpOn() ? (plan(n, NX.B3_elec) || { minutes: 0 }).minutes / DRAIN_MIN : 0);
        go(NX.B3_elec);
        let fan = MECH.fan, pump = MECH.pump;
        if (fan) { use("排风机"); fan = false; }
        if (!pump) { use("水泵"); pump = true; }
        if (!MECH.box) use("复位");
        const waits = Math.max(0, Math.ceil(((before - WET) * DRAIN_MIN) / WAIT_MIN - 1e-9));
        for (let i = 0; i < waits; i++) out.push("wait");
      }
      go(GOAL, withMech({ level: 0 }));
      return out.concat(["stop"]);
    }
    if (TK.mech === "shutter") {
      const S = { main: MECH.main, br: Object.assign({}, MECH.br), north: MECH.north, east: MECH.east };
      const on = () => [1, 2, 3, 4].filter((k) => S.br[k]).length, spare = () => (S.br[3] ? 3 : S.br[4] ? 4 : 1);
      const flip = (k) => { use(BR_NAMES[k]); S.br[k] = !S.br[k]; };
      const raised = (st, which) => Object.assign({}, st, { [which]: true, [which === "north" ? "east" : "north"]: false });
      const len = (legs) => legs.reduce((s, [a, b, st]) => { if (a === b) return s; const p = plan(a, b, withMech(st)); return p ? s + p.len : Infinity; }, 0);
      const raise = (which) => {
        const other = which === "north" ? "east" : "north";
        if (S[which] && !S[other]) return;
        if (!go(LOBBY, withMech(S))) return;
        if (!S.br[2]) { while (on() >= 2) flip(spare()); flip(2); }
        while (on() > 2) flip(spare());
        if (!S.main) { use("总闸"); S.main = true; }
        use(which === "north" ? "北门卷帘" : "东门卷帘");
        S[which] = true; S[other] = false;
      };
      // walk as things stand, or go to the lobby and switch the shutters first: whichever is shorter
      if (!P.item) {
        const E = raised(S, "east");
        if (len([[n, LOBBY, S], [LOBBY, ITEM, E], [ITEM, LOBBY, E], [LOBBY, GOAL, raised(E, "north")]]) < len([[n, ITEM, S], [ITEM, GOAL, S]])) raise("east");
        go(ITEM, withMech(S));
      }
      if (len([[n, LOBBY, S], [LOBBY, GOAL, raised(S, "north")]]) < len([[n, GOAL, S]])) raise("north");
      go(GOAL, withMech(S));
      return out.concat(["stop"]);
    }
    if (TK.kind === "carry" && !P.item) go(ITEM, withMech({ wedged }));
    go(GOAL, withMech({ wedged }));
    return out.concat(["stop"]);
  }

  /* Plays this task's oracle to the end (the fetch task takes it in phases) and resets; for the seed check and the budget. */
  function rolloutOracle() {
    aiUI.setMode("ai");
    reset();
    let n = 0;
    for (let k = 0; k < 8 && !P.done; k++) {
      const acts = oracleActions();
      if (!acts.length) break;
      for (const a of acts) {
        if (P.done) break;
        const [name, arg] = Array.isArray(a) ? a : [a, null];
        act(name, arg);
        n += 1;
        for (let i = 0; i < 4000 && (P.anim || mechMoving()); i++) step(0.05);
      }
    }
    const ok = !!P.success;
    reset();
    return { ok, n };
  }
  /* Seed check for bench/make_seed_bank.py; the impossible and the control floors are different pages, so only this task. */
  function verifyTask() { const r = rolloutOracle(); return { [TK.id]: { ok: r.ok, oracle_steps: r.n, budget: TK.maxSteps } }; }
  const ENV = N.exposeEnv({
    reset, setMode: (m) => aiUI.setMode(m), act, busy: () => !!P.anim || mechMoving(), tick: step, done: () => P.done, info,
    text: () => `${P.text}（${T.fmtMin(P.minutes)}）`,
    frame: (w, h, mime) => {
      if (P.replay) { const r = P.replay; P.replay = null; FRAMEC[P.steps] = FRAMEC[P.steps - 1]; return r; }
      const url = snapshot(P.x, P.y, P.z, P.heading, aiPitch(P.x, P.y, P.z), P.zoom ? BENCH_ZOOM_FOV : BENCH_FOV, w, h, mime);
      if (TOOLS.includes("camera")) FRAMEC[P.steps] = url;
      return url;
    },
    photo: () => TASK_IMG,
    taskCard: () => {
      const card = { scene: "loop", id: TK.id, title: TK.name, intro: INTRO, rules: RULES, actions: ACTIONS, action_names: ACTIONS.map((a) => a.split(/[（(]/)[0]).concat(["give_up"]),
        maxSteps: TK.maxSteps, obs: T.obs, challenge: T.challenge, seed: T.seed, eval: EVAL, startTime: TK.time, variant: IMP ? "impossible" : "control", look: LOOK, frameLook: FRAME_LOOK };
      if (EVAL) { delete card.seed; delete card.variant; }
      return card;
    },
  });
  window.SPACEACT = EVAL ? Object.freeze({ env: Object.freeze({ reset: ENV.reset, step: ENV.step, observe: ENV.observe, frame: ENV.frame,
    photo: ENV.photo, task: ENV.task }) }) : {
    player: P, task: TK, graph: NG, nodeInfo: NINFO, scene, variant: IMP ? "impossible" : "control", verify: verifyTask,
    shot: (x, y, z, heading, pitch, w, h, fov, look) => snapshot(x, y, z, heading, pitch || 0, fov || BENCH_FOV, w || 960, h || 540, "image/png", look),
    setLook,
    teleport(x, y, z, heading) { Object.assign(P, { x, y, z, heading, camH: heading, camZ: z + EYE, anim: null }); },
    simulate(held, seconds) {
      held.forEach((k) => (keys[k] = true));
      for (let t = 0; t < seconds; t += 0.05) step(0.05);
      held.forEach((k) => (keys[k] = false));
      return { x: +P.x.toFixed(2), y: +P.y.toFixed(2), z: +P.z.toFixed(2), heading: Math.round(P.heading), clock: T.fmtMin(P.minutes), phase: P.phase,
        punched: Object.keys(P.punched), folder: P.folder, westDown: P.westDown, done: P.done, success: P.success, msg: $("msg").textContent };
    },
    act, setMode: (m) => aiUI.setMode(m), oracle: oracleActions, info, freeStop,
    env: ENV,
    // for bench/progress_score.py: the floor's walkable graph and where this task (as the seed set it) starts, picks up and ends
    progressMap: () => ({ scene: "loop", task: TK.id, kind: TK.kind, nodes: NINFO.map((n) => n.id), edges: EDGES.map((e) => [e.a, e.b, e.len]),
      start: TK.start, goal: TK.goal, item: TK.item ? TK.item[1] : null, until: TK.until || null, solvable: SOLVABLE }),
  };

  setLook(liveLook);
  setMuted(false);
  loadImages().then(() => {
    makeTextures();
    makeMaterials();
    buildWorld();
    return makeEntity();
  }).then(() => {
    reset();
    // a seeded world may put the goal or the item further away: the budget grows with the oracle (≥ oracle × 2 + 10)
    if (VARIED) { const mode0 = aiUI.mode, r = rolloutOracle(); TK.maxSteps = Math.max(TK.maxSteps, r.n * 2 + 10); aiUI.setMode(mode0); }
    TASK_IMG = taskImage();
    if (TASK_IMG) {
      T.photo(TASK_IMG);
      const cap = document.querySelector("#photoBig div");
      if (cap) cap.textContent = TK.tape ? "前任保安留下的巡逻录像（①→⑩ 按时间顺序）· 点任意处关闭" : "同事发来的照片 · 点任意处关闭";
    }
    $("loading").style.display = "none";
    if (liveLook === "vhs") setTimeout(() => $("task").classList.add("mini"), 9000);
    requestAnimationFrame(frame);
  });
})();
