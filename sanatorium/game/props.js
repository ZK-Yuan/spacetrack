/* 雾岭疗养院 · props: Poly Haven CC0 models (GLB) where one exists, procedural ones for the rest; every prop type
   is built once and instanced at all its placements. Props face +x in their own frame; r is the world heading. */
(function () {
  "use strict";
  const S = (window.SANA = window.SANA || {});
  const PR = (S.Props = {});
  const E = () => S.Engine;
  const MODEL_DIR = "game/models/";
  // prop type -> GLB file; h: target height, yaw: extra turn so the model's front faces +x
  const MODELS = {
    bed: { file: "old_bed_frame", yaw: 0 }, nightstand: { file: "painted_wooden_nightstand" }, wheelchair: { file: "wheelchair_01" },
    chair: { file: "SchoolChair_01" }, desk: { file: "metal_office_desk", yaw: 180 }, desk_big: { file: "metal_office_desk", yaw: 180 },
    file_cabinet: { file: "drawer_cabinet" }, medical_box: { file: "medical_box" }, bench: { file: "painted_wooden_bench" },
    radio: { file: "vintage_radio_transceiver" }, shelf: { file: "steel_frame_shelves_01", h: 2.0 },
    shelf_files: { file: "steel_frame_shelves_01", h: 2.1 }, bookshelf: { file: "wooden_bookshelf_worn" },
    cabinet: { file: "vintage_cabinet_01", h: 1.9 }, wardrobe: { file: "vintage_cabinet_01", h: 2.05 }, barrel: { file: "Barrel_01" },
    crate: { file: "wooden_crate_01" }, tool_chest: { file: "metal_tool_chest" }, grandfather_clock: { file: "vintage_grandfather_clock_01" },
    gothic_statue: { file: "gothic_statue" }, stump: { file: "tree_stump_01" }, iron_gate: { file: "large_iron_gate", yaw: 90 },
  };
  PR.models = {};
  const gltf = () => new THREE.GLTFLoader(E().manager);

  PR.loadModels = function () {
    const files = [...new Set(Object.values(MODELS).map((m) => m.file).concat(["Lantern_01", "hanging_industrial_lamp", "dead_tree_trunk_02", "cardboard_box_01", "vintage_crutches_01", "wall_clock", "matron", "sister"]))];
    return Promise.all(files.map((f) => new Promise((res) => {
      gltf().load(MODEL_DIR + f + ".glb", (g) => { PR.models[f] = g.scene; PR.clips = PR.clips || {}; PR.clips[f] = g.animations; res(); }, undefined, () => { console.warn("model failed", f); res(); });
    })));
  };

  /* ---------------------------------------------------------------- shared prop materials */
  const M = {};
  function pm(name) {
    if (M[name]) return M[name];
    const T = E();
    const defs = {
      enamel: () => new THREE.MeshStandardMaterial({ color: 0xc9c3b4, roughness: 0.45, metalness: 0.25, normalMap: T.tex("metal_plate_n.jpg", false, 2), roughnessMap: T.tex("rusty_metal_r.jpg", false, 1) }),
      steel: () => new THREE.MeshStandardMaterial({ color: 0x8e959b, roughness: 0.35, metalness: 0.85, normalMap: T.tex("metal_plate_n.jpg", false, 2) }),
      rust: () => T.mat("rust"), wood: () => T.mat("door_wood"), dark_wood: () => T.mat("frame_wood"),
      linen: () => new THREE.MeshStandardMaterial({ color: 0xb8b0a0, roughness: 0.95, map: stainTex() }),
      canvas: () => new THREE.MeshStandardMaterial({ color: 0x6b6a55, roughness: 0.95 }),
      stone: () => T.mat("stone"), brick: () => T.mat("brick"), black: () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 }),
      rubber: () => new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.9 }),
      glass: () => T.mat("glass"), brass: () => new THREE.MeshStandardMaterial({ color: 0x9a7a3a, roughness: 0.35, metalness: 0.9 }),
      green: () => T.mat("door_green"), concrete: () => T.mat("concrete"), coal: () => new THREE.MeshStandardMaterial({ color: 0x0d0c0c, roughness: 0.7, metalness: 0.2 }),
      shroud: () => new THREE.MeshStandardMaterial({ color: 0x8f897c, roughness: 0.97, map: stainTex() }),
      bark: () => new THREE.MeshStandardMaterial({ color: 0x2b2622, roughness: 1.0, normalMap: T.tex("forest_leaves_02_n.jpg", false, 3) }),
      bulb_on: () => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffc27a, emissiveIntensity: 6 }),
      bulb_off: () => new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.3 }),
      exit: () => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x33ff77, emissiveIntensity: 2.2, emissiveMap: exitTex() }),
      flame: () => new THREE.MeshBasicMaterial({ color: 0xffb35c, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
      screen: () => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x9fd0ff, emissiveIntensity: 2.5 }),
      glow_warm: () => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa050, emissiveIntensity: 0.9 }),
      fire: () => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff6a20, emissiveIntensity: 5 }),
      map_old: () => new THREE.MeshStandardMaterial({ map: oldMapTex(), roughness: 0.9 }),
      paper: () => new THREE.MeshStandardMaterial({ color: 0xcfc7b4, roughness: 0.95, transparent: true, alphaTest: 0.3, map: paperTex() }),
      note: () => new THREE.MeshStandardMaterial({ color: 0xe8e0c8, roughness: 0.9, emissive: 0x2a2416, emissiveIntensity: 0.6, map: noteTex() }),
      stain: () => new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 1, transparent: true, opacity: 0.55, depthWrite: false, map: blotTex(), polygonOffset: true, polygonOffsetFactor: -2 }),
      clockface: () => new THREE.MeshStandardMaterial({ map: clockTex(), emissive: 0xffffff, emissiveMap: clockTex(), emissiveIntensity: 0.12, roughness: 0.8 }),
    };
    M[name] = (defs[name] || defs.enamel)();
    return M[name];
  }
  PR.pm = pm;
  let _stain;
  function stainTex() {
    if (_stain) return _stain;
    _stain = E().canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) {
        const x = Math.random() * w, y = Math.random() * h, r = 4 + Math.random() * 30;
        const c = g.createRadialGradient(x, y, 0, x, y, r);
        c.addColorStop(0, `rgba(${110 + Math.random() * 40},${80 + Math.random() * 30},40,${0.25 + Math.random() * 0.3})`);
        c.addColorStop(1, "rgba(120,90,40,0)");
        g.fillStyle = c; g.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
    });
    _stain.wrapS = _stain.wrapT = THREE.RepeatWrapping;
    return _stain;
  }
  function exitTex() {
    return E().canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = "#0a3"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#dfffe8"; g.font = "bold 54px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("出口", w * 0.38, h * 0.52); g.font = "bold 40px sans-serif"; g.fillText("→", w * 0.8, h * 0.52);
    });
  }
  function paperTex() {
    return E().canvasTex(64, 96, (g, w, h) => {
      g.fillStyle = "rgba(0,0,0,0)"; g.clearRect(0, 0, w, h);
      g.fillStyle = "#ddd5c0"; g.beginPath(); g.moveTo(2, 3); g.lineTo(w - 3, 1); g.lineTo(w - 1, h - 4); g.lineTo(4, h - 1); g.fill();
      g.fillStyle = "rgba(60,50,40,0.35)";
      for (let y = 12; y < h - 10; y += 6) g.fillRect(8, y, (w - 20) * (0.6 + Math.random() * 0.4), 1.5);
    });
  }
  function noteTex() {
    return E().canvasTex(128, 170, (g, w, h) => {
      g.fillStyle = "#efe6cc"; g.fillRect(0, 0, w, h);
      g.fillStyle = "rgba(40,30,20,0.6)";
      for (let y = 18; y < h - 14; y += 9) g.fillRect(12, y, (w - 30) * (0.5 + Math.random() * 0.5), 2);
      g.strokeStyle = "rgba(120,60,30,0.4)"; g.lineWidth = 6; g.beginPath(); g.arc(w * 0.75, h * 0.8, 14, 0, 6); g.stroke();
    });
  }
  function blotTex() {
    return E().canvasTex(128, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      for (let i = 0; i < 14; i++) {
        const x = w / 2 + (Math.random() - 0.5) * w * 0.5, y = h / 2 + (Math.random() - 0.5) * h * 0.5, r = 10 + Math.random() * 30;
        const c = g.createRadialGradient(x, y, 0, x, y, r);
        c.addColorStop(0, "rgba(255,255,255,0.8)"); c.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = c; g.fillRect(0, 0, w, h);
      }
      g.fillStyle = "rgba(255,255,255,0.5)";
      for (let i = 0; i < 6; i++) g.fillRect(w / 2 + (Math.random() - 0.5) * 50, h / 2, 2, 20 + Math.random() * 50);
    });
  }
  function clockTex() {
    if (PR._clock) return PR._clock;
    PR._clock = E().canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = "#cfc8b4"; g.beginPath(); g.arc(128, 128, 124, 0, 7); g.fill();
      g.strokeStyle = "#2a2622"; g.lineWidth = 6; g.stroke();
      g.fillStyle = "#2a2622";
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.fillRect(128 + Math.sin(a) * 100 - 3, 128 - Math.cos(a) * 100 - 9, 6, 18); }
      g.lineCap = "round";
      g.lineWidth = 9; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.sin(0.05) * 60, 128 - Math.cos(0.05) * 60); g.stroke();
      g.lineWidth = 5; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.sin(0.73) * 92, 128 - Math.cos(0.73) * 92); g.stroke();
    });
    return PR._clock;
  }
  function oldMapTex() {
    return E().canvasTex(512, 384, (g, w, h) => {
      g.fillStyle = "#c9b98f"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "#5a4a32"; g.lineWidth = 3; g.strokeRect(10, 10, w - 20, h - 20);
      g.fillStyle = "#4a3b26"; g.font = "bold 22px serif"; g.fillText("雾岭疗养院  院区图  1934", 24, 40);
      g.save(); g.translate(260, 210);
      g.strokeStyle = "#3a2e1e"; g.lineWidth = 3; g.fillStyle = "rgba(90,70,40,0.25)";
      g.beginPath(); g.arc(0, 0, 26, 0, 7); g.fill(); g.stroke();
      g.save(); g.rotate(-200 * Math.PI / 180 + Math.PI); g.fillRect(26, -14, 150, 28); g.strokeRect(26, -14, 150, 28); g.restore();
      g.save(); g.rotate(-25 * Math.PI / 180); g.fillRect(26, -14, 96, 44); g.strokeRect(26, -14, 96, 44); g.restore();
      g.strokeRect(-60, -150, 120, 84);
      g.font = "16px serif"; g.fillStyle = "#3a2e1e";
      g.fillText("圆厅", -16, 6); g.fillText("庭院", -14, -104); g.fillText("病区", -170, 70); g.fillText("服务翼", 70, -40);
      g.fillText("（北）", -16, -165);
      g.restore();
      g.fillStyle = "rgba(90,60,30,0.25)";
      for (let i = 0; i < 25; i++) { g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 3 + Math.random() * 14, 0, 7); g.fill(); }
    });
  }

  /* ---------------------------------------------------------------- procedural builder */
  class PB {
    constructor() { this.parts = new Map(); }
    add(mat, geo, x, y, z, rx, ry, rz) {
      geo.rotateX(rx || 0); geo.rotateY(ry || 0); geo.rotateZ(rz || 0);
      geo.translate(x, y, z);
      if (!this.parts.has(mat)) this.parts.set(mat, []);
      this.parts.get(mat).push(geo.index ? geo.toNonIndexed() : geo);
      return this;
    }
    box(mat, x, y, z, sx, sy, sz, ry) { return this.add(mat, new THREE.BoxGeometry(sx, sy, sz), x, y, z, 0, ry || 0, 0); }
    cyl(mat, x, y, z, r, h, n, rx, rz) { return this.add(mat, new THREE.CylinderGeometry(r, r, h, n || 8), x, y, z, rx || 0, 0, rz || 0); }
    sph(mat, x, y, z, r) { return this.add(mat, new THREE.SphereGeometry(r, 10, 7), x, y, z); }
    done() {
      const out = [];
      for (const [mat, list] of this.parts) out.push({ mat, geo: merge(list) });
      return out;
    }
  }
  function merge(list) {
    let n = 0;
    for (const g of list) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    let o = 0;
    for (const g of list) {
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
      o += g.attributes.position.count;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.computeBoundingSphere();
    return geo;
  }
  PR.PB = PB;
  PR.merge = merge;

  const GEN = {
    trolley: (b) => { for (const y of [0.25, 0.82]) b.box("steel", 0, y, 0, 0.5, 0.025, 0.9); for (const x of [-0.23, 0.23]) for (const z of [-0.43, 0.43]) { b.cyl("steel", x, 0.46, z, 0.012, 0.86); b.sph("rubber", x, 0.04, z, 0.04); } b.box("enamel", 0.05, 0.86, 0.1, 0.25, 0.05, 0.35); },
    iv_stand: (b) => { b.cyl("steel", 0, 0.95, 0, 0.012, 1.9); for (let i = 0; i < 4; i++) b.box("steel", Math.cos(i * 1.57) * 0.16, 0.04, Math.sin(i * 1.57) * 0.16, 0.34, 0.02, 0.025, i * 1.57); b.box("steel", 0, 1.88, 0, 0.3, 0.012, 0.012); b.box("glass", 0.12, 1.7, 0, 0.09, 0.2, 0.04); b.cyl("steel", 0.12, 1.35, 0, 0.003, 0.5); },
    deck_chair: (b) => { b.box("wood", 0.1, 0.32, 0, 1.2, 0.05, 0.58); b.box("wood", -0.62, 0.62, 0, 0.62, 0.05, 0.58, 0); b.add("wood", new THREE.BoxGeometry(0.66, 0.05, 0.58), -0.55, 0.6, 0, 0, 0, 0.75); for (const z of [-0.26, 0.26]) { b.box("wood", 0.55, 0.16, z, 0.05, 0.32, 0.05); b.box("wood", -0.35, 0.16, z, 0.05, 0.32, 0.05); } },
    telescope: (b) => { for (let i = 0; i < 3; i++) b.add("brass", new THREE.CylinderGeometry(0.012, 0.012, 1.3, 6), Math.cos(i * 2.1) * 0.25, 0.62, Math.sin(i * 2.1) * 0.25, 0, 0, 0); b.add("brass", new THREE.CylinderGeometry(0.05, 0.035, 1.0, 10), 0.15, 1.3, 0, 0, 0, 1.2); },
    phone: (b) => { b.box("black", 0, 0.004, 0, 0.16, 0.008, 0.075); b.box("screen", 0, 0.0085, 0, 0.14, 0.001, 0.065); },
    reception: (b) => { b.box("dark_wood", 0, 0.55, 0, 0.8, 1.1, 2.6); b.box("wood", 0.1, 1.12, 0, 1.0, 0.04, 2.7); b.box("black", -0.41, 0.5, 0, 0.02, 0.6, 2.2); },
    cot: (b) => { b.box("canvas", 0, 0.42, 0, 1.9, 0.04, 0.72); for (const x of [-0.85, 0.85]) for (const z of [-0.33, 0.33]) b.box("rust", x, 0.2, z, 0.04, 0.42, 0.04); b.box("linen", -0.7, 0.5, 0, 0.35, 0.1, 0.55); },
    counter: (b) => { b.box("enamel", 0, 0.45, 0, 0.7, 0.9, 3.4); b.box("steel", 0.02, 0.93, 0, 0.74, 0.04, 3.45); for (let i = 0; i < 4; i++) b.box("black", 0.36, 0.5, -1.25 + i * 0.83, 0.01, 0.6, 0.02); },
    stove: (b) => { b.box("black", 0, 0.45, 0, 0.8, 0.9, 1.6); b.box("steel", 0, 0.92, 0, 0.82, 0.04, 1.62); for (const z of [-0.5, 0, 0.5]) b.cyl("rust", 0, 0.95, z, 0.15, 0.03, 12); b.box("steel", 0.41, 0.4, 0, 0.02, 0.45, 1.2); },
    long_table: (b) => { b.box("wood", 0, 0.76, 0, 4.0, 0.05, 0.9); for (const x of [-1.85, 1.85]) for (const z of [-0.38, 0.38]) b.box("dark_wood", x, 0.37, z, 0.07, 0.74, 0.07); },
    op_table: (b) => { b.box("steel", 0, 0.95, 0, 2.0, 0.08, 0.62); b.cyl("steel", 0, 0.5, 0, 0.09, 0.9, 10); b.box("steel", 0, 0.06, 0, 0.8, 0.12, 0.5); b.box("linen", 0.1, 1.01, 0, 1.6, 0.04, 0.55); },
    op_lamp: (b) => { b.cyl("steel", 0, 3.1, 0, 0.02, 1.1); b.add("enamel", new THREE.CylinderGeometry(0.42, 0.55, 0.22, 20, 1, true), 0, 2.45, 0); b.cyl("glass", 0, 2.35, 0, 0.45, 0.02, 20); },
    cabinet_glass: (b) => { b.box("enamel", 0, 0.95, 0, 0.45, 1.9, 1.0); b.box("glass", 0.235, 1.2, 0, 0.01, 1.3, 0.92); for (const y of [0.75, 1.15, 1.55]) { b.box("glass", 0, y, 0, 0.4, 0.01, 0.92); for (let i = 0; i < 5; i++) b.cyl(Math.random() < 0.5 ? "brass" : "glass", 0.05, y + 0.08, -0.35 + i * 0.17, 0.025, 0.15); } },
    tub: (b) => { b.box("enamel", 0, 0.35, 0, 0.8, 0.7, 1.6); b.box("black", 0, 0.69, 0, 0.66, 0.02, 1.46); for (const z of [-0.6, 0.6]) b.cyl("steel", -0.3, 0.9, z, 0.015, 0.4); },
    xray: (b) => { b.box("enamel", 0, 0.45, 0, 2.0, 0.08, 0.7); b.box("enamel", 0, 0.22, 0, 1.6, 0.45, 0.5); b.box("steel", -0.8, 1.2, -0.5, 0.15, 2.4, 0.15); b.box("enamel", -0.3, 1.6, -0.5, 1.0, 0.1, 0.12); b.cyl("enamel", 0.1, 1.45, -0.5, 0.16, 0.36, 14); },
    piano: (b) => { b.box("dark_wood", 0, 0.65, 0, 0.6, 1.3, 1.5); b.box("dark_wood", 0.32, 0.72, 0, 0.3, 0.06, 1.45); b.box("enamel", 0.38, 0.76, 0, 0.18, 0.03, 1.3); b.box("black", 0.36, 0.785, 0, 0.12, 0.012, 1.25); },
    pew: (b) => { b.box("dark_wood", 0, 0.45, 0, 0.42, 0.05, 4.6); b.box("dark_wood", -0.2, 0.75, 0, 0.05, 0.6, 4.6); for (const z of [-2.3, 0, 2.3]) b.box("dark_wood", -0.02, 0.48, z, 0.5, 0.96, 0.06); b.box("dark_wood", 0.22, 0.12, 0, 0.04, 0.24, 4.6); },
    altar: (b) => { b.box("stone", 0, 0.5, 0, 0.9, 1.0, 2.2); b.box("stone", 0, 1.03, 0, 1.0, 0.06, 2.4); b.box("linen", 0.06, 1.07, 0, 0.92, 0.02, 2.0); b.box("linen", 0.47, 0.8, 0, 0.02, 0.5, 2.0); },
    candles: (b) => { for (let i = 0; i < 7; i++) { const z = -0.8 + i * 0.27, hh = 0.12 + (i % 3) * 0.08; b.cyl("enamel", 0, hh / 2, z, 0.025, hh, 8); b.add("flame", new THREE.SphereGeometry(0.018, 6, 5).scale(1, 2, 1), 0, hh + 0.03, z); } },
    cross: (b) => { b.box("dark_wood", 0, 0.3, 0, 0.06, 1.6, 0.1); b.box("dark_wood", 0, 0.75, 0, 0.06, 0.1, 0.8); },
    old_map: (b) => { b.box("dark_wood", 0, 0, 0, 0.04, 0.78, 1.04); b.add("map_old", new THREE.PlaneGeometry(0.96, 0.7), 0.025, 0, 0, 0, Math.PI / 2, 0); },
    gravestone: (b) => { b.box("stone", 0, 0.42, 0, 0.14, 0.84, 0.6); b.add("stone", new THREE.CylinderGeometry(0.3, 0.3, 0.14, 14, 1, false, 0, Math.PI), 0, 0.84, 0, 0, 0, Math.PI / 2); },
    washer: (b) => { b.box("enamel", 0, 0.5, 0, 0.8, 1.0, 0.8); b.add("glass", new THREE.CylinderGeometry(0.22, 0.22, 0.03, 18), 0.41, 0.55, 0, 0, 0, Math.PI / 2); b.add("steel", new THREE.TorusGeometry(0.24, 0.025, 6, 18), 0.41, 0.55, 0, 0, Math.PI / 2, 0); },
    cart: (b) => { b.box("canvas", 0, 0.6, 0, 0.6, 0.65, 1.0); for (const x of [-0.25, 0.25]) for (const z of [-0.45, 0.45]) b.sph("rubber", x, 0.07, z, 0.07); b.box("steel", 0, 0.28, 0, 0.62, 0.03, 1.02); },
    hatch: (b) => { b.box("steel", 0.0, 0, 0, 0.04, 0.62, 0.62); b.box("rust", 0.03, 0, 0, 0.02, 0.5, 0.5); b.box("steel", 0.05, -0.15, 0.18, 0.03, 0.04, 0.12); },
    chute_hatch: (b) => { b.box("steel", 0, 0, 0, 0.05, 0.75, 0.7); b.box("black", 0.03, 0, 0, 0.02, 0.6, 0.55); b.box("steel", 0.06, 0.25, 0, 0.04, 0.05, 0.4); },
    gurney: (b) => { b.box("steel", 0, 0.72, 0, 1.95, 0.04, 0.62); b.box("linen", 0.05, 0.79, 0, 1.85, 0.1, 0.58); for (const x of [-0.85, 0.85]) for (const z of [-0.26, 0.26]) { b.cyl("steel", x, 0.36, z, 0.015, 0.72); b.sph("rubber", x, 0.05, z, 0.05); } },
    morgue_drawers: (b) => { b.box("steel", 0, 1.1, 0, 0.8, 2.2, 2.6); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { b.box("steel", 0.41, 0.4 + j * 0.7, -0.86 + i * 0.86, 0.02, 0.6, 0.78); b.box("black", 0.43, 0.6 + j * 0.7, -0.86 + i * 0.86, 0.03, 0.04, 0.3); } },
    autopsy_table: (b) => { b.box("steel", 0, 0.88, 0, 2.1, 0.06, 0.8); b.box("steel", 0, 0.94, 0.38, 2.1, 0.08, 0.04); b.box("steel", 0, 0.94, -0.38, 2.1, 0.08, 0.04); b.cyl("steel", 0, 0.44, 0, 0.1, 0.88); b.box("steel", 0, 0.04, 0, 0.9, 0.08, 0.6); },
    panel: (b) => { b.box("enamel", 0, 0.95, 0, 0.5, 1.9, 1.0); b.box("black", 0.26, 1.2, -0.2, 0.02, 0.5, 0.3); b.box("rust", 0.27, 1.25, 0.25, 0.06, 0.06, 0.3); b.box("black", 0.26, 0.6, 0, 0.02, 0.4, 0.7); },
    furnace: (b) => { b.box("brick", 0, 1.2, 0, 1.6, 2.4, 2.2); b.box("black", 0.81, 0.8, 0, 0.04, 0.7, 0.9); b.box("fire", 0.83, 0.62, 0, 0.02, 0.06, 0.7); b.cyl("rust", 0, 2.9, 0, 0.25, 1.0); },
    coal: (b) => { for (let i = 0; i < 14; i++) b.add("coal", new THREE.DodecahedronGeometry(0.25 + Math.random() * 0.35), (Math.random() - 0.5) * 2.2, 0.15 + Math.random() * 0.3, (Math.random() - 0.5) * 1.4); },
    caged_bulb: (b, v) => { b.sph(v ? "bulb_off" : "bulb_on", 0, -0.12, 0, 0.06); for (let i = 0; i < 4; i++) b.cyl("iron", Math.cos(i * 1.57) * 0.09, -0.12, Math.sin(i * 1.57) * 0.09, 0.006, 0.22, 4); b.cyl("iron", 0, 0, 0, 0.05, 0.06, 8); },
    exit_sign: (b) => { b.box("exit", 0, 0, 0, 0.06, 0.22, 0.44); },
    locker_bank: (b) => { for (let i = 0; i < 3; i++) { const z = -0.63 + i * 0.63; b.box("green", 0, 1.0, z, 0.5, 2.0, 0.61); b.box("black", 0.255, 1.65, z, 0.01, 0.18, 0.3); b.box("steel", 0.26, 1.0, z + 0.22, 0.02, 0.18, 0.03); for (let k = 0; k < 4; k++) b.box("black", 0.256, 1.82 - k * 0.04, z, 0.006, 0.012, 0.32); } },
    coldroom: (b) => { b.box("steel", 0, 1.1, 0, 0.12, 2.2, 1.6); b.box("steel", 0.08, 1.05, 0, 0.06, 2.0, 1.2); b.box("black", 0.13, 1.1, 0.45, 0.06, 0.4, 0.06); b.box("rust", 0.12, 1.1, 0.0, 0.03, 1.8, 0.03); },
    body_cart: (b) => { b.box("rust", 0, 0.44, 0, 2.1, 0.06, 0.95); for (const x of [-0.72, 0.72]) for (const z of [-0.35, 0.35]) b.box("rust", x, 0.22, z, 0.34, 0.34, 0.07); b.cyl("rust", 1.02, 0.75, 0.45, 0.016, 0.62); b.cyl("rust", 1.02, 0.75, -0.45, 0.016, 0.62); b.box("rust", 1.02, 1.06, 0, 0.035, 0.035, 0.94); b.add("shroud", shroudGeo(), 0, 0.47, 0); },
    glow_window: (b) => { b.add("glow_warm", new THREE.PlaneGeometry(1.7, 1.4), 0.25, 0, 0, 0, Math.PI / 2, 0); },
    bed_mattress: (b) => { b.box("linen", 0, 0.0, 0, 1.86, 0.14, 0.84); b.add("linen", new THREE.BoxGeometry(0.34, 0.1, 0.55), -0.72, 0.1, 0, 0, 0, 0.1); },
  };
  function shroudGeo() {
    const blobs = [[-0.86, 0, 0.11, 0.1, 0.16], [-0.56, 0, 0.17, 0.21, 0.15], [-0.25, 0, 0.2, 0.19, 0.135], [0.06, 0, 0.16, 0.18, 0.12],
      [0.42, 0.09, 0.3, 0.075, 0.085], [0.42, -0.09, 0.3, 0.075, 0.085], [0.87, 0.1, 0.05, 0.055, 0.15], [0.87, -0.1, 0.05, 0.055, 0.15]];
    const H = (x, y) => Math.pow(blobs.reduce((s, b) => s + Math.pow(b[4], 4) * Math.exp(-Math.pow((x - b[0]) / b[2], 2) - Math.pow((y - b[1]) / b[3], 2)), 0), 0.25);
    const nx = 40, ny = 18, hx = 1.05, hy = 0.47;
    const geo = new THREE.PlaneGeometry(2 * (hx + 0.17), 2 * (hy + 0.18), nx, ny);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      const xe = Math.max(-hx, Math.min(hx, x)), ye = Math.max(-hy, Math.min(hy, y));
      const z = H(xe, ye) + 0.01 * Math.sin(11 * x + 4 * y) * Math.cos(9 * y - 2 * x) - 1.8 * Math.hypot(x - xe, y - ye);
      p.setXYZ(i, x, z + 0.015, y);
    }
    geo.computeVertexNormals();
    return geo;
  }

  function treeGeo(seed) {
    let s = seed;
    const R = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    const parts = [];
    function branch(p, dir, len, r, depth) {
      const segs = depth === 0 ? 4 : 2;
      let cur = p.clone(), d = dir.clone();
      for (let k = 0; k < segs; k++) {
        d.add(new THREE.Vector3((R() - 0.5) * 0.5, (R() - 0.3) * 0.25, (R() - 0.5) * 0.5)).normalize();
        const l = len / segs, nxt = cur.clone().addScaledVector(d, l);
        const g = new THREE.CylinderGeometry(r * (1 - (k + 1) / (segs + 1) * 0.5), r * (1 - k / (segs + 1) * 0.5), l, depth === 0 ? 6 : 4, 1, true);
        g.translate(0, l / 2, 0);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
        g.applyQuaternion(q);
        g.translate(cur.x, cur.y, cur.z);
        parts.push(g.toNonIndexed());
        if (depth < 3 && k >= (depth === 0 ? 1 : 0)) {
          const n = depth === 0 ? 2 : 2;
          for (let i = 0; i < n; i++) {
            if (R() < 0.25 && depth > 0) continue;
            const nd = d.clone().add(new THREE.Vector3((R() - 0.5) * 1.8, R() * 0.6, (R() - 0.5) * 1.8)).normalize();
            branch(nxt, nd, len * (0.45 + R() * 0.2), r * 0.45, depth + 1);
          }
        }
        cur = nxt;
      }
    }
    branch(new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0, 1, 0), 7 + R() * 3, 0.22 + R() * 0.08, 0);
    return merge(parts);
  }

  /* ---------------------------------------------------------------- instancing */
  const tmp = new THREE.Object3D();
  function placementMatrix(p, r, s, yaw) {
    tmp.position.set(p[0], p[2], -p[1]);
    tmp.rotation.set(0, (r + (yaw || 0)) * Math.PI / 180, 0);
    tmp.scale.setScalar(s || 1);
    tmp.updateMatrix();
    return tmp.matrix.clone();
  }
  function instanceParts(scene, parts, mats, opts) {
    // parts: [{geo, mat}], mats: array of Matrix4 per instance; chunks by 40 m so culling keeps working
    const chunks = new Map();
    mats.forEach((m) => {
      const k = Math.floor(m.elements[12] / 40) + "," + Math.floor(m.elements[14] / 40);
      if (!chunks.has(k)) chunks.set(k, []);
      chunks.get(k).push(m);
    });
    for (const list of chunks.values()) {
      for (const part of parts) {
        const mat = typeof part.mat === "string" ? pm(part.mat) : part.mat;
        const im = new THREE.InstancedMesh(part.geo, mat, list.length);
        list.forEach((m, i) => im.setMatrixAt(i, part.local ? m.clone().multiply(part.local) : m));
        im.castShadow = !(opts && opts.noShadow) && mat.emissiveIntensity === undefined ? true : !(opts && opts.noShadow);
        im.receiveShadow = true;
        im.computeBoundingSphere();
        scene.add(im);
      }
    }
  }
  function modelParts(name, spec) {
    const root = PR.models[spec.file];
    if (!root) return null;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const sc = spec.h ? spec.h / size.y : 1;
    const norm = new THREE.Matrix4().makeScale(sc, sc, sc).multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z));
    const parts = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      if (o.material) o.material.envMapIntensity = 0.4;
      parts.push({ geo: o.geometry, mat: o.material, local: norm.clone().multiply(o.matrixWorld) });
    });
    return parts;
  }
  PR.modelParts = modelParts;

  /* ---------------------------------------------------------------- build */
  PR.build = function (scene, D) {
    const groups = new Map();
    for (const p of D.props) {
      const key = p.t + (p.v !== undefined ? "#" + p.v : "");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    const treeVariants = [11, 23, 37, 51].map((s) => [{ geo: treeGeo(s), mat: "bark" }]);
    for (const [key, list] of groups) {
      const [t, v] = key.split("#");
      if (t === "dead_tree") {
        treeVariants.forEach((parts, vi) => {
          const sub = list.filter((_, i) => i % treeVariants.length === vi);
          if (sub.length) instanceParts(scene, parts, sub.map((p) => placementMatrix(p.p, p.r, p.s || 1)));
        });
        continue;
      }
      const spec = MODELS[t];
      if (spec) {
        const parts = modelParts(t, spec);
        if (parts) {
          instanceParts(scene, parts, list.map((p) => placementMatrix(p.p, p.r, p.s || 1, 90 + (spec.yaw || 0))));
          if (t === "bed") {
            const mb = new PB(); GEN.bed_mattress(mb);
            instanceParts(scene, mb.done(), list.map((p) => placementMatrix([p.p[0], p.p[1], p.p[2] + 0.5], p.r - 90 + 90, 1)).map((m) => m.multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2))));
          }
          continue;
        }
      }
      if (GEN[t]) {
        const b = new PB();
        GEN[t](b, v === undefined ? undefined : +v);
        instanceParts(scene, b.done(), list.map((p) => placementMatrix(p.p, p.r, p.s || 1)), { noShadow: t === "exit_sign" || t === "phone" });
      } else {
        console.warn("no prop builder for", t);
      }
    }
    // paper litter and stains as instanced quads
    const papers = D.decals.filter((d) => d.k === "paper"), stains = D.decals.filter((d) => d.k === "stain");
    if (papers.length) {
      const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      const im = new THREE.InstancedMesh(geo, pm("paper"), papers.length);
      papers.forEach((d, i) => {
        tmp.position.set(d.p[0], d.p[2] + 0.004, -d.p[1]); tmp.rotation.set(0, d.r * Math.PI / 180, 0); tmp.scale.set(d.s[0], 1, d.s[1]); tmp.updateMatrix();
        im.setMatrixAt(i, tmp.matrix);
      });
      im.receiveShadow = true;
      scene.add(im);
    }
    if (stains.length) {
      const geo = new THREE.PlaneGeometry(1, 1);
      const im = new THREE.InstancedMesh(geo, pm("stain"), stains.length);
      stains.forEach((d, i) => {
        const a = d.r * Math.PI / 180;
        tmp.position.set(d.p[0] - Math.cos(a) * 0.01, d.p[2], -(d.p[1] - Math.sin(a) * 0.01)); tmp.rotation.set(0, a - Math.PI / 2, 0); tmp.scale.set(d.s[0], d.s[1], 1); tmp.updateMatrix();
        im.setMatrixAt(i, tmp.matrix);
      });
      scene.add(im);
    }
    // clock faces on the towers
    for (const c of S.Level.clockFaces) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(1.4, 32), pm("clockface"));
      m.position.set(c.p[0], c.p[2], -c.p[1]);
      m.rotation.set(0, c.r * Math.PI / 180 + Math.PI / 2, 0);
      scene.add(m);
    }
  };

  /* ---------------------------------------------------------------- practical lights */
  PR.lights = function (scene, D) {
    const out = [];
    D.lights.forEach((L, i) => {
      const rec = Object.assign({ seed: i * 7.31, glow: 0 }, L);
      rec.on = !!L.on;
      if (L.k === "candle") {
        rec.glow = 1;
      } else if (L.k === "fluor") {
        const b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.12), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xdff0ff, emissiveIntensity: 3 }));
        b.position.set(L.p[0], L.p[2] + 0.25, -L.p[1]);
        scene.add(b);
        rec.mesh = b; rec.glow = 3;
      } else if (L.k === "lamp") {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(L.c[0], L.c[1], L.c[2]), emissiveIntensity: 4 }));
        b.position.set(L.p[0], L.p[2], -L.p[1]);
        scene.add(b);
        rec.mesh = b; rec.glow = 4;
      }
      out.push(rec);
    });
    return out;
  };
})();
