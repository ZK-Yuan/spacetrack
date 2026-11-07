/* Space Track · scene B: world queries shared with the game logic, plus everything visual. */
(function () {
  "use strict";
  const W = window.WORLD;
  const SA = (window.SA = {});
  const MODE = { BLOCKED: 0, PATH: 1, BRIDGE: 2, UNDER: 3, OVER: 4, ISLAND: 5, TOWER: 6 };
  const UNDER_DEPTH = 0.32, OVER_H = 0.5, TOWER_TOP = 1.2;
  const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif';
  const SUN_DIR = new THREE.Vector3(-0.8, 0.27, 0.42).normalize();
  const LOOKS = {
    morning: { sun: [0.72, 0.42, 0.45], top: 0x356fbe, mid: 0x93b9e0, horizon: 0xe2eaf0, below: 0xc8c4b4, sunCol: 0xfff6e6,
      light: 0xfff0dc, power: 3.0, hemi: 0.5, fog: 0xd2dde6, exposure: 1.15 },
    noon: { sun: [-0.35, 0.86, 0.38], top: 0x2f6fc6, mid: 0x8fbde6, horizon: 0xdbe8f0, below: 0xc8c4b4, sunCol: 0xfffaf0,
      light: 0xfffaf0, power: 3.1, hemi: 0.55, fog: 0xd0dce6, exposure: 1.1 },
    afternoon: { sun: [-0.85, 0.42, 0.3], top: 0x3a76c6, mid: 0x9fc3e2, horizon: 0xf0dcc0, below: 0xcbbda4, sunCol: 0xffecd0,
      light: 0xffe4bf, power: 3.0, hemi: 0.45, fog: 0xdcd6c8, exposure: 1.12 },
    dusk: { sun: [-0.85, 0.3, 0.45], top: 0x2f5b96, mid: 0x7da4cc, horizon: 0xf0d2ae, below: 0xcbbda4, sunCol: 0xfff1d6,
      light: 0xffc890, power: 3.2, hemi: 0.4, fog: 0xd9c6b0, exposure: 1.15 },
  };
  let FOG = LOOKS.dusk.fog;

  // ---------------------------------------------------------------- math & world queries
  const v3 = (x, y, h) => new THREE.Vector3(x, h, -y);
  const rad = (d) => (d * Math.PI) / 180;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

  function rng(seed) {
    let s = seed >>> 0;
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  }
  function hash(x, y) {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const fbm = (x, y) => 0.5 * vnoise(x, y) + 0.3 * vnoise(2.1 * x + 17, 2.1 * y + 5) + 0.2 * vnoise(4.3 * x + 3, 4.3 * y + 11);

  function terrainH(x, y) {
    const h = W.hill;
    const dx = (x - h.x) / h.r, dy = (y - h.y) / (h.r * h.ys);
    const r2 = dx * dx + dy * dy;
    return r2 < 1 ? h.h * 0.5 * (1 + Math.cos(Math.PI * Math.sqrt(r2))) : 0;
  }

  const MASK = (() => {
    const bin = atob(W.mask.data);
    const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  })();

  /* The paving as drawn: [ax, ay, bx, by, half width less a body's radius, mode] per segment, bucketed by 1-unit cell. The mask's
     2.5 m cells cut corners off curved paths; a point on the paving is walkable whatever its cell says. */
  const LANES = [], LANE_GRID = new Map();
  (function lanes() {
    const put = (lines, w, mode) => lines.forEach((l) => { for (let i = 0; i < l.length - 1; i++) LANES.push([l[i][0], l[i][1], l[i + 1][0], l[i + 1][1], w / 2 - 0.03, mode]); });
    put(W.paths.concat([W.spiral, [W.zigzag[W.zigzag.length - 1], W.teaNode]]), 0.46, MODE.PATH);
    put(W.maze, 0.32, MODE.PATH);
    put([W.zigzag], 0.36, MODE.BRIDGE);
    put([W.longBridge], 0.42, MODE.BRIDGE);
    LANES.forEach(([ax, ay, bx, by, hw], k) => {
      for (let i = Math.floor(Math.min(ax, bx) - hw); i <= Math.floor(Math.max(ax, bx) + hw); i++)
        for (let j = Math.floor(Math.min(ay, by) - hw); j <= Math.floor(Math.max(ay, by) + hw); j++) {
          const key = i * 1000 + j;
          if (!LANE_GRID.has(key)) LANE_GRID.set(key, []);
          LANE_GRID.get(key).push(k);
        }
    });
  })();
  function laneAt(x, y) {
    const cell = LANE_GRID.get(Math.floor(x) * 1000 + Math.floor(y));
    if (cell) for (const k of cell) {
      const [ax, ay, bx, by, hw, mode] = LANES[k], L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
      const t = clamp(((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L2, 0, 1);
      if (Math.hypot(ax + t * (bx - ax) - x, ay + t * (by - ay) - y) < hw) return mode;
    }
    return MODE.BLOCKED;
  }

  function modeAt(x, y) {
    const m = W.mask;
    const i = Math.floor((x - m.x0) / m.res), j = Math.floor((y - m.y0) / m.res);
    if (i < 0 || j < 0 || i >= m.nx || j >= m.ny) return MODE.BLOCKED;
    const v = MASK[j * m.nx + i];
    return v === MODE.BLOCKED ? laneAt(x, y) : v;
  }

  function alongLine(x, y, a, b) {
    const abx = b[0] - a[0], aby = b[1] - a[1];
    const L = Math.hypot(abx, aby);
    const t = clamp(((x - a[0]) * abx + (y - a[1]) * aby) / (L * L), 0, 1);
    return [t * L, L];
  }
  const underFloor = (s, L) => -UNDER_DEPTH * smoothstep(0, 1.5, Math.min(s, L - s));
  const overDeck = (s, L) => OVER_H * smoothstep(0, 1.2, Math.min(s, L - s));

  function groundAt(x, y) {
    const mode = modeAt(x, y);
    if (mode === MODE.UNDER) { const [s, L] = alongLine(x, y, W.underpass[0], W.underpass[1]); return underFloor(s, L); }
    if (mode === MODE.OVER) { const [s, L] = alongLine(x, y, W.overpass[0], W.overpass[1]); return overDeck(s, L); }
    if (mode === MODE.BRIDGE) return 0.03;
    if (mode === MODE.TOWER) {
      const d = Math.hypot(x - W.hill.x, y - W.hill.y);
      return W.hill.h + TOWER_TOP * smoothstep(1.05, 0.45, d);
    }
    return terrainH(x, y);
  }

  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function pointAt(pts, dist) {
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const seg = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      if (acc + seg >= dist || i === pts.length - 2) {
        const t = seg > 0 ? clamp((dist - acc) / seg, 0, 1) : 0;
        return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t, i];
      }
      acc += seg;
    }
    return [pts[pts.length - 1][0], pts[pts.length - 1][1], pts.length - 2];
  }

  function offsetLine(line, d) {
    return line.map((p, i) => {
      const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
      const n = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [p[0] - ((b[1] - a[1]) / n) * d, p[1] + ((b[0] - a[0]) / n) * d];
    });
  }

  function resample(line, step) {
    const out = [line[0]];
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, ay] = line[i], [bx, by] = line[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
      for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
    }
    return out;
  }

  Object.assign(SA, { MODE, UNDER_DEPTH, OVER_H, TOWER_TOP, v3, clamp, smoothstep, terrainH, modeAt, groundAt,
    alongLine, pointAt, pointInPoly });

  // ---------------------------------------------------------------- visuals
  SA.build = function (canvas, opts) {
    const LOOK = LOOKS[(opts && opts.look) || "dusk"] || LOOKS.dusk;
    const force = (opts && opts.force) || {};
    SUN_DIR.set(LOOK.sun[0], LOOK.sun[1], LOOK.sun[2]).normalize();
    FOG = LOOK.fog;
    const isAI = new URLSearchParams(location.search).has("ai");
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isAI, preserveDrawingBuffer: true });
    renderer.setPixelRatio(isAI ? 1 : Math.min(2, window.devicePixelRatio || 1));
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = LOOK.exposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    let shadowDirty = true;
    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(FOG, 30, 175);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 700);
    camera.rotation.order = "YXZ";

    // ---- sky dome + image-based lighting from the same sky
    function skyMesh(radius) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
        uniforms: {
          top: { value: new THREE.Color(LOOK.top) }, mid: { value: new THREE.Color(LOOK.mid) },
          horizon: { value: new THREE.Color(LOOK.horizon) }, below: { value: new THREE.Color(LOOK.below) },
          sunDir: { value: SUN_DIR }, sunCol: { value: new THREE.Color(LOOK.sunCol) },
        },
        vertexShader: "varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: [
          "uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 below; uniform vec3 sunDir; uniform vec3 sunCol;",
          "varying vec3 vDir;",
          "void main(){",
          "  vec3 d = normalize(vDir); float h = d.y; float s = max(dot(d, normalize(sunDir)), 0.0);",
          "  vec3 col = h >= 0.0 ? mix(mix(horizon, mid, smoothstep(0.0, 0.18, h)), top, smoothstep(0.12, 0.75, h))",
          "                      : mix(horizon, below, smoothstep(0.0, -0.12, h));",
          "  col = mix(col, vec3(1.0, 0.78, 0.52), pow(s, 4.0) * (1.0 - smoothstep(0.0, 0.4, abs(h))) * 0.55);",
          "  col += sunCol * (pow(s, 12.0) * 0.18 + pow(s, 180.0) * 0.6 + smoothstep(0.9993, 0.9997, s) * 6.0);",
          "  gl_FragColor = vec4(col, 1.0);",
          "  #include <tonemapping_fragment>",
          "  #include <colorspace_fragment>",
          "}"].join("\n"),
      }));
      m.renderOrder = -10;
      return m;
    }
    const sky = skyMesh(520);
    scene.add(sky);
    const envScene = new THREE.Scene();
    envScene.add(skyMesh(50));
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(envScene, 0.035, 0.1, 200).texture;

    scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x6f7f4c, LOOK.hemi));
    const sun = new THREE.DirectionalLight(LOOK.light, LOOK.power);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 180 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.025;
    scene.add(sun, sun.target);

    // ---- procedural textures
    function canvasTex(w, h, draw, opts) {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      draw(c.getContext("2d"), w, h);
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = opts && opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      t.anisotropy = maxAniso;
      return t;
    }
    function speckle(ctx, w, h, n, colors, r0, r1, seed) {
      const r = rng(seed);
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = colors[Math.floor(r() * colors.length)];
        ctx.beginPath();
        ctx.arc(r() * w, r() * h, r0 + r() * (r1 - r0), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const grassTex = canvasTex(512, 512, (ctx, w, h) => {
      ctx.fillStyle = "#e3e8da"; ctx.fillRect(0, 0, w, h);
      const r = rng(3);
      for (let i = 0; i < 14000; i++) {
        const g = 198 + Math.floor(r() * 57);
        ctx.strokeStyle = `rgb(${g - 10},${g},${g - 25})`;
        ctx.lineWidth = 1 + r();
        const x = r() * w, y = r() * h, a = -Math.PI / 2 + (r() - 0.5) * 0.9, l = 3 + r() * 6;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
      }
    });
    const gravelTex = canvasTex(512, 512, (ctx, w, h) => {
      ctx.fillStyle = "#cfbd96"; ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, 22000, ["#c4b18a", "#d9c9a5", "#bba882", "#e0d2b0", "#b3a07a", "#cbb994"], 0.5, 1.5, 5);
    });
    const asphaltTex = canvasTex(512, 512, (ctx, w, h) => {
      ctx.fillStyle = "#585d62"; ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, 16000, ["#4b5054", "#62676c", "#6d7276", "#53585c", "#7a7f83"], 0.5, 1.6, 7);
    });
    const woodTex = canvasTex(256, 256, (ctx, w, h) => {
      const cols = ["#9a6a45", "#a9774e", "#8d5f3c", "#a16f49"], r = rng(9);
      for (let y = 0; y < h; y += 32) {
        ctx.fillStyle = cols[(y / 32) % cols.length]; ctx.fillRect(0, y, w, 32);
        ctx.strokeStyle = "rgba(60,35,20,.25)";
        for (let k = 0; k < 6; k++) { ctx.beginPath(); const yy = y + 4 + r() * 24; ctx.moveTo(0, yy); ctx.bezierCurveTo(w * .3, yy + 3, w * .6, yy - 3, w, yy); ctx.stroke(); }
        ctx.fillStyle = "#4a2f1d"; ctx.fillRect(0, y, w, 3);
      }
    });
    const stoneTex = canvasTex(256, 256, (ctx, w, h) => {
      ctx.fillStyle = "#8f8b84"; ctx.fillRect(0, 0, w, h);
      const r = rng(11);
      for (let y = 0; y < h; y += 32) for (let x = (y / 32) % 2 ? -32 : 0; x < w; x += 64) {
        const g = 185 + Math.floor(r() * 35);
        ctx.fillStyle = `rgb(${g},${g - 4},${g - 12})`; ctx.fillRect(x + 2, y + 2, 60, 28);
      }
    });
    const concreteTex = canvasTex(256, 256, (ctx, w, h) => {
      ctx.fillStyle = "#a7a49e"; ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, 5000, ["#9c9993", "#b2afa9", "#94918b", "#bbb8b2"], 0.5, 1.8, 13);
      ctx.strokeStyle = "rgba(70,70,70,.25)"; ctx.lineWidth = 2;
      for (let x = 0; x <= w; x += 128) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    });
    const pavingTex = canvasTex(256, 256, (ctx, w, h) => {
      ctx.fillStyle = "#9d978b"; ctx.fillRect(0, 0, w, h);
      const r = rng(17);
      for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) {
        const g = 178 + Math.floor(r() * 30);
        ctx.fillStyle = `rgb(${g},${g - 5},${g - 14})`; ctx.fillRect(x + 1.5, y + 1.5, 29, 29);
      }
    });
    const waterNormal = canvasTex(512, 512, (ctx, w, h) => {
      const img = ctx.createImageData(w, h), waves = [];
      const r = rng(23);
      for (let k = 0; k < 28; k++) {
        const f = 3 + Math.floor(r() * (6 + k * 1.2));
        const a = r() * 6.2832;
        waves.push([Math.round(Math.cos(a) * f), Math.round(Math.sin(a) * f), r() * 6.28, 0.5 / (1 + k * 0.25)]);
      }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let dx = 0, dy = 0;
        waves.forEach(([kx, ky, ph, a]) => {
          const c = Math.cos(((kx * x + ky * y) / w) * 6.2832 + ph) * a;
          dx += c * kx; dy += c * ky;
        });
        const n = new THREE.Vector3(-dx * 0.035, -dy * 0.035, 1).normalize();
        const i = (y * w + x) * 4;
        img.data[i] = (n.x * 0.5 + 0.5) * 255; img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
        img.data[i + 2] = (n.z * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }, { linear: true });
    waterNormal.repeat.set(0.22, 0.22);

    const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.9, metalness: 0 }, o));
    const M = {
      grass: std({ map: grassTex, vertexColors: true, roughness: 0.96 }),
      grassFlat: std({ map: grassTex, color: 0x86ad5e, roughness: 0.96, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
      marsh: std({ map: grassTex, color: 0x95a35f, roughness: 1 }),
      gravel: std({ map: gravelTex, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
      forestPath: std({ map: gravelTex, color: 0xb9a783, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
      asphalt: std({ map: asphaltTex, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
      tunnelWall: std({ map: concreteTex, color: 0x9a948c, roughness: 0.95, envMapIntensity: 0.45, side: THREE.DoubleSide }),
      tunnelFloor: std({ map: stoneTex, color: 0x77726c, roughness: 0.95, envMapIntensity: 0.45 }),
      wood: std({ map: woodTex, roughness: 0.8 }),
      stone: std({ map: stoneTex, roughness: 0.9 }),
      concrete: std({ map: concreteTex, roughness: 0.92 }),
      concreteDS: std({ map: concreteTex, roughness: 0.92, side: THREE.DoubleSide }),
      paving: std({ map: pavingTex, roughness: 0.95 }),
      sand: std({ map: gravelTex, color: 0xe2d2ad, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
      plaza: std({ map: pavingTex, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
      lines: std({ color: 0xf2e6b0, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }),
      lineWhite: std({ color: 0xf2efe8, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }),
      water: std({ color: 0x2c6a96, roughness: 0.07, metalness: 0.15, normalMap: waterNormal,
        normalScale: new THREE.Vector2(0.4, 0.4), envMapIntensity: 1.5 }),
      red: std({ color: 0xa8322a, roughness: 0.55 }),
      roof: std({ color: 0x3b3e44, roughness: 0.7 }),
      darkMetal: std({ color: 0x3d4a52, roughness: 0.5, metalness: 0.6 }),
      metalDS: std({ color: 0x4f5d66, roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide }),
      white: std({ color: 0xf2efe8, roughness: 0.7 }),
      trunk: new THREE.MeshLambertMaterial({ color: 0x3b2a1f }),
      glass: std({ color: 0xbfe3f2, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    };
    gravelTex.repeat.set(1, 1);

    // ---- textures made offline (blender/web_textures.py, blender/bake_park_ao.py); the game waits for `ready`
    const TD = window.SA_TEX || { tex: {}, boards: {} };
    const loadingManager = new THREE.LoadingManager();
    const texLoader = new THREE.TextureLoader(loadingManager);
    let pending = 0, readyDone = null;
    const ready = new Promise((res) => (readyDone = res));
    loadingManager.onLoad = () => readyDone();
    function loadTex(url, srgb) {
      pending += 1;
      const t = texLoader.load(url);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      t.anisotropy = maxAniso;
      return t;
    }
    const texFile = (key, srgb) => (TD.tex[key] ? loadTex(TD.tex[key], srgb) : null);
    const AO = texFile("ao", false);
    if (AO) { AO.wrapS = AO.wrapT = THREE.ClampToEdgeWrapping; AO.channel = 1; }
    function texMat(key, o, Material, repeat) {
      const map = texFile(key), normalMap = texFile(key + "_n", false), roughMap = texFile(key + "_r", false);
      [map, normalMap, roughMap].forEach((t) => { if (t && repeat) t.repeat.set(repeat, repeat); });
      const props = Object.assign({ normalScale: new THREE.Vector2(1.1, 1.1), aoMapIntensity: 1.0 }, o);
      if (map) props.map = map;
      if (normalMap) props.normalMap = normalMap;
      if (roughMap) props.roughnessMap = roughMap;
      if (AO) props.aoMap = AO;
      return Material ? new Material(props) : std(props);
    }
    const offsetLayer = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 };
    const MT = {
      grass: texMat("grass", { vertexColors: true, roughness: 0.92, normalScale: new THREE.Vector2(0.8, 0.8) }),
      gravel: texMat("gravel", Object.assign({ roughness: 0.9, color: 0xb8b4ac }, offsetLayer)),
      forest: texMat("forest", Object.assign({ roughness: 0.88, color: 0x9ea4aa }, offsetLayer)),
      asphalt: texMat("asphalt", Object.assign({ roughness: 0.85, color: 0x70767c }, offsetLayer)),
      wood: texMat("wood", { roughness: 0.78 }, null, 2),
      stone: texMat("stone", { roughness: 0.88, side: THREE.DoubleSide }),
      monolith: texMat("monolith", { roughness: 0.86, color: 0xadb2b0, side: THREE.DoubleSide }),
      concrete_wall: texMat("concrete_wall", { roughness: 0.85, color: 0x9ca2a6, side: THREE.DoubleSide }),
      rust: texMat("rust", { roughness: 0.65, metalness: 0.55, side: THREE.DoubleSide }, null, 2),
      metal: texMat("metal", { roughness: 0.45, metalness: 0.7, side: THREE.DoubleSide }, null, 2),
    };
    const roofMat = std({ color: 0x33363b, roughness: 0.6, side: THREE.DoubleSide });
    const uvWorld = (x, y) => [(x + 1) / 102, (y + 2) / 73];

    /* A sign board: two textured faces back to back on a thin core, facing `headingDeg` (world degrees). */
    function board(key, x, y, z, height, headingDeg) {
      const b = TD.boards[key];
      if (!b) return false;
      const t = loadTex(b.url);
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      const mat = std({ map: t, alphaTest: 0.5, roughness: 0.55, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.12 });
      const w = height * b.aspect, g = new THREE.PlaneGeometry(w, height);
      [0, Math.PI].forEach((flip) => {
        const p = new THREE.Mesh(g, mat);
        p.position.copy(v3(x, y, z));
        p.rotation.y = rad(headingDeg + 90) + flip;
        p.translateZ(0.004);
        p.castShadow = true;
        scene.add(p);
      });
      const core = new THREE.Mesh(new THREE.BoxGeometry(w * 0.97, height * 0.94, 0.005), M.darkMetal);
      core.position.copy(v3(x, y, z)); core.rotation.y = rad(headingDeg + 90); scene.add(core);
      return true;
    }

    /* Concave hip roof with upturned eaves (segs 4) or a hexagonal tent roof (segs 6), as in park_scene.py. */
    function curvedRoofGeo(w, d, h, segs, upturn) {
      const n = 22, pos = [], idx = [];
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
        const u = -1 + (2 * i) / n, v = -1 + (2 * j) / n, r = Math.max(Math.abs(u), Math.abs(v));
        let px = (u * w) / 2, py = (v * d) / 2;
        if (segs !== 4) {
          const ang = Math.atan2(v, u), sector = Math.PI / 3;
          const k = Math.cos(Math.PI / 6) / Math.cos((((ang % sector) + sector) % sector) - Math.PI / 6);
          px = (Math.cos(ang) * r * k * w) / 2; py = (Math.sin(ang) * r * k * w) / 2;
        }
        const z = h * Math.pow(1 - r, 1.7) + upturn * h * Math.pow(Math.abs(u * v), 6) + upturn * h * 0.4 * Math.pow(r, 8);
        pos.push(px, z, -py);
      }
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const p = j * (n + 1) + i;
        idx.push(p, p + n + 1, p + 1, p + 1, p + n + 1, p + n + 2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    }

    // ---- geometry helpers
    function ribbon(lines, width, heightFn, uvLen) {
      const pos = [], uv = [], uv1 = [];
      lines.forEach((line) => {
        if (line.length < 2) return;
        const L = [], R = [], V = [];
        let acc = 0;
        for (let i = 0; i < line.length; i++) {
          const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
          let tx = b[0] - a[0], ty = b[1] - a[1];
          const n = Math.hypot(tx, ty) || 1;
          tx /= n; ty /= n;
          const nx = -ty * width / 2, ny = tx * width / 2, [x, y] = line[i];
          L.push([x + nx, heightFn(x + nx, y + ny, i), -(y + ny)]);
          R.push([x - nx, heightFn(x - nx, y - ny, i), -(y - ny)]);
          V.push(acc / (uvLen || width));
          if (i < line.length - 1) acc += Math.hypot(line[i + 1][0] - x, line[i + 1][1] - y);
        }
        for (let i = 0; i < line.length - 1; i++) {
          const quad = [L[i], R[i], R[i + 1], L[i], R[i + 1], L[i + 1]];
          quad.forEach((p) => { pos.push(...p); uv1.push(...uvWorld(p[0], -p[2])); });
          uv.push(0, V[i], 1, V[i], 1, V[i + 1], 0, V[i], 1, V[i + 1], 0, V[i + 1]);
        }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute("uv1", new THREE.Float32BufferAttribute(uv1, 2));
      g.computeVertexNormals();
      return g;
    }
    function wall(line, bottomFn, topFn, uvLen) {
      const pos = [], uv = [], uv1 = [];
      let acc = 0;
      const tile = uvLen || 1.4;
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, ay] = line[i], [bx, by] = line[i + 1];
        const seg = Math.hypot(bx - ax, by - ay), u0 = acc / tile, u1 = (acc + seg) / tile;
        acc += seg;
        const z0a = bottomFn(ax, ay, i), z1a = topFn(ax, ay, i);
        const z0b = bottomFn(bx, by, i + 1), z1b = topFn(bx, by, i + 1);
        const v0 = z0a / tile, v1 = z1a / tile;
        const a0 = [ax, z0a, -ay], a1 = [ax, z1a, -ay];
        const b0 = [bx, z0b, -by], b1 = [bx, z1b, -by];
        pos.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1);
        uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
        [a0, b0, b1, a0, b1, a1].forEach((p) => uv1.push(...uvWorld(p[0], -p[2])));
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute("uv1", new THREE.Float32BufferAttribute(uv1, 2));
      g.computeVertexNormals();
      return g;
    }
    function tiledBoxGeo(w, h, d, tile) {
      const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, pos = g.attributes.position, uv1 = [];
      const s = tile || 1.4;
      for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        const u = uv.getX(i), v = uv.getY(i);
        if (f === 2 || f === 3) uv.setXY(i, u * (w / s), v * (d / s));
        else if (f < 2) uv.setXY(i, u * (d / s), v * (h / s));
        else uv.setXY(i, u * (w / s), v * (h / s));
      }
      for (let i = 0; i < pos.count; i++) uv1.push(0.5, 0.5);
      g.setAttribute("uv1", new THREE.Float32BufferAttribute(uv1, 2));
      return g;
    }
    function add(geo, mat, opts) {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = !!(opts && opts.cast);
      m.receiveShadow = !(opts && opts.receive === false);
      scene.add(m);
      return m;
    }
    function shapeGeo(poly, uvScale) {
      const g = new THREE.ShapeGeometry(new THREE.Shape(poly.map((p) => new THREE.Vector2(p[0], p[1]))));
      if (uvScale) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvScale, uv.getY(i) * uvScale); }
      g.rotateX(-Math.PI / 2);
      const pos = g.attributes.position, uv1 = [];
      for (let i = 0; i < pos.count; i++) uv1.push(...uvWorld(pos.getX(i), -pos.getZ(i)));
      g.setAttribute("uv1", new THREE.Float32BufferAttribute(uv1, 2));
      return g;
    }
    function flat(poly, mat, h, uvScale) {
      const m = add(shapeGeo(poly, uvScale), mat);
      m.position.y = h;
      return m;
    }
    function boxAt(w, h, d, mat, x, y, base, rotY, cast, tile) {
      const m = new THREE.Mesh(tiledBoxGeo(w, h, d, tile), mat);
      m.position.copy(v3(x, y, base + h / 2));
      m.rotation.y = rotY || 0;
      m.castShadow = cast !== false;
      m.receiveShadow = true;
      scene.add(m);
      return m;
    }
    function instanced(geo, mat, items, place, opts) {
      if (!items.length) return null;
      const m = new THREE.InstancedMesh(geo, mat, items.length);
      const d = new THREE.Object3D(), col = new THREE.Color();
      items.forEach((it, i) => {
        d.position.set(0, 0, 0); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1);
        const c = place(d, it, i);
        d.updateMatrix();
        m.setMatrixAt(i, d.matrix);
        if (c !== undefined) m.setColorAt(i, col.set(c));
      });
      m.castShadow = !!(opts && opts.cast);
      m.receiveShadow = !!(opts && opts.receive);
      m.frustumCulled = false;
      scene.add(m);
      return m;
    }
    function radialBlobs(blobs, dark, light, detail) {
      const pos = [], nor = [], col = [];
      const c0 = new THREE.Color(dark), c1 = new THREE.Color(light), c = new THREE.Color(), n = new THREE.Vector3();
      blobs.forEach(([bx, by, bz, br]) => {
        const p = new THREE.IcosahedronGeometry(br, detail === undefined ? 1 : detail).attributes.position.array;
        for (let i = 0; i < p.length; i += 3) {
          const y = p[i + 1] + by;
          pos.push(p[i] + bx, y, p[i + 2] + bz);
          n.set(p[i], p[i + 1], p[i + 2]).normalize();
          nor.push(n.x, n.y, n.z);
          c.copy(c0).lerp(c1, clamp((y + 0.9) / 1.9, 0, 1));
          col.push(c.r, c.g, c.b);
        }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      return g;
    }
    function merged(parts) {
      const pos = [], nor = [], col = [], c = new THREE.Color();
      parts.forEach(([geo, color, tx, ty, tz]) => {
        const g = (geo.index ? geo.toNonIndexed() : geo);
        if (!g.attributes.normal) g.computeVertexNormals();
        const p = g.attributes.position.array, nn = g.attributes.normal.array;
        for (let i = 0; i < p.length; i += 3) {
          pos.push(p[i] + (tx || 0), p[i + 1] + (ty || 0), p[i + 2] + (tz || 0)); nor.push(nn[i], nn[i + 1], nn[i + 2]);
          c.set(typeof color === "function" ? color(p[i + 1]) : color);
          col.push(c.r, c.g, c.b);
        }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      return g;
    }
    function labelTexture(text, o) {
      o = Object.assign({ fg: "#ffffff", bg: "#1d5fa6", size: 60, pad: 26, radius: 18, border: "rgba(255,255,255,.9)" }, o || {});
      const c = document.createElement("canvas"), ctx = c.getContext("2d");
      ctx.font = `600 ${o.size}px ${FONT}`;
      const lines = String(text).split("\n");
      const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + o.pad * 2;
      const h = Math.ceil(lines.length * o.size * 1.3) + o.pad * 1.6;
      c.width = w; c.height = h;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(3, 3, w - 6, h - 6, o.radius); else ctx.rect(3, 3, w - 6, h - 6);
      ctx.fillStyle = o.bg; ctx.fill();
      if (o.border) { ctx.lineWidth = 5; ctx.strokeStyle = o.border; ctx.stroke(); }
      ctx.font = `600 ${o.size}px ${FONT}`;
      ctx.fillStyle = o.fg; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      lines.forEach((l, i) => ctx.fillText(l, w / 2, o.pad * 0.8 + o.size * 1.3 * (i + 0.5)));
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso;
      return { tex: t, aspect: w / h };
    }
    function sprite(text, x, y, h, height, o) {
      const { tex, aspect } = labelTexture(text, o);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, toneMapped: false }));
      s.scale.set(height * aspect, height, 1);
      s.position.copy(v3(x, y, h));
      scene.add(s);
      return s;
    }
    /* A designed sign (blender/signs.py, SA_TEX.boards) as a camera-facing plate `height` units tall. */
    function signSprite(key, x, y, z, height) {
      const b = TD.boards[key];
      if (!b) return new THREE.Object3D();
      const t = loadTex(b.url);
      t.anisotropy = maxAniso;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, color: 0xe2e2e2, alphaTest: 0.05 }));
      s.scale.set(height * b.aspect, height, 1);
      s.position.copy(v3(x, y, z));
      scene.add(s);
      return s;
    }
    /* A spray-painted stencil flat on the ground, the top of the lettering pointing along headingDeg; stretched along that
       direction like road markings so it still reads from eye height. */
    function floorStencil(key, x, y, width, headingDeg) {
      const b = TD.boards[key];
      if (!b) return null;
      const t = loadTex(b.url);
      t.anisotropy = maxAniso;
      const mat = std({ map: t, transparent: true, depthWrite: false, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2 });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(width, (2.4 * width) / b.aspect), mat);
      m.rotation.order = "YXZ";
      m.rotation.set(-Math.PI / 2, rad(headingDeg - 90), 0);
      m.position.copy(v3(x, y, groundAt(x, y) + 0.04));
      m.receiveShadow = true;
      scene.add(m);
      return m;
    }

    function trenchHoles() {
      const [a, b] = W.underpass;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const dx = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L, nx = -dy * 0.32, ny = dx * 0.32;
      const rect = (s0, s1) => [[a[0] + dx * s0 + nx, a[1] + dy * s0 + ny], [a[0] + dx * s1 + nx, a[1] + dy * s1 + ny],
        [a[0] + dx * s1 - nx, a[1] + dy * s1 - ny], [a[0] + dx * s0 - nx, a[1] + dy * s0 - ny]];
      return [rect(0.0, 1.55), rect(L - 1.55, L)];
    }

    // ---- terrain: lush green inside the Square Glade & Watchtower hill, dark weathered slate across the Maze sectors
    (function buildTerrain() {
      const x0 = -1, y0 = -2, res = 0.5, nx = 204, ny = 146;
      const pos = [], col = [], uv = [], uv1 = [], idx = [];
      const glade1 = new THREE.Color(0x527a42), glade2 = new THREE.Color(0x82ad5e);
      const slate1 = new THREE.Color(0x485056), slate2 = new THREE.Color(0x646d74), moss = new THREE.Color(0x4b6148), c = new THREE.Color();
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
        const x = x0 + i * res, y = y0 + j * res;
        pos.push(x, terrainH(x, y), -y);
        uv.push(x / 1.8, y / 1.8);
        uv1.push(...uvWorld(x, y));
        const dGlade = Math.max(Math.abs(x - W.plaza[0]) - 8.0, Math.abs(y - W.plaza[1]) - 8.0);
        const dHill = Math.hypot(x - W.hill.x, y - W.hill.y) - W.hill.r * 0.85;
        const gFac = clamp(1 - Math.min(dGlade, dHill) / 2.5, 0, 1);
        c.copy(slate1).lerp(slate2, fbm(x * 0.09, y * 0.09));
        const d = vnoise(x * 0.06 + 40, y * 0.06 + 9);
        if (d > 0.58) c.lerp(moss, (d - 0.58) * 1.4);
        if (gFac > 0) {
          const gc = new THREE.Color().copy(glade1).lerp(glade2, fbm(x * 0.11, y * 0.11));
          c.lerp(gc, gFac);
        }
        col.push(c.r, c.g, c.b);
      }
      const holes = trenchHoles();
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const cx = x0 + (i + 0.5) * res, cy = y0 + (j + 0.5) * res;
        if (!pointInPoly(cx, cy, W.boundary) || holes.some((h) => pointInPoly(cx, cy, h))) continue;
        if (pointInPoly(cx, cy, W.lake) || pointInPoly(cx, cy, W.wetland)) continue;
        const a = j * (nx + 1) + i;
        idx.push(a, a + 1, a + nx + 1, a + 1, a + nx + 2, a + nx + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute("uv1", new THREE.Float32BufferAttribute(uv1, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      add(g, MT.grass);
      const outer = new THREE.Shape([[-450, -450], [550, -450], [550, 520], [-450, 520]].map((p) => new THREE.Vector2(p[0], p[1])));
      outer.holes.push(new THREE.Path(W.boundary.map((p) => new THREE.Vector2(p[0], p[1]))));
      const wasteland = new THREE.ShapeGeometry(outer);
      const cuv = wasteland.attributes.uv;
      for (let i = 0; i < cuv.count; i++) cuv.setXY(i, cuv.getX(i) / 3.8, cuv.getY(i) / 3.8);
      wasteland.rotateX(-Math.PI / 2);
      add(wasteland, MT.asphalt).position.y = -0.002;
    })();

    // ---- sunken Griever Chasm, mechanical gear pit, and Core Vault octagon
    const CHASM_Y = -0.34;
    flat(W.wetland, std({ map: concreteTex, color: 0x22282e, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), -0.18, 0.45);
    const chasmMat = std({ color: 0x141a20, roughness: 0.35, metalness: 0.45, normalMap: waterNormal, normalScale: new THREE.Vector2(0.12, 0.12), envMapIntensity: 0.7 });
    flat(W.lake, chasmMat, CHASM_Y, 0.35);
    flat(W.island, MT.forest, 0.025, 0.35);
    flat(W.bird, MT.forest, 0.025, 0.35);
    const ring = (poly) => poly.concat([poly[0], poly[1]]);
    add(wall(ring(W.lake), () => CHASM_Y, () => 0.02, 1.4), MT.concrete_wall);
    add(wall(ring(W.wetland), () => -0.18, () => 0.02, 1.4), MT.concrete_wall);
    add(wall(ring(W.island), () => CHASM_Y, () => 0.028, 1.2), MT.monolith);
    add(wall(ring(W.bird), () => CHASM_Y, () => 0.028, 1.2), MT.monolith);
    add(ribbon([ring(W.lake)], 0.48, () => 0.02, 1.2), MT.stone);
    add(ribbon([ring(W.island), ring(W.bird)], 0.36, () => 0.028, 1.2), MT.stone);
    // Sunken steel cross-girders and concrete piers inside the Griever Chasm & Gear Pit
    for (let y = 33; y <= 56; y += 4.5) {
      boxAt(31.0, 0.08, 0.18, MT.rust, 50.8, y, CHASM_Y + 0.06, 0, false, 1.5);
    }
    for (let x = 60; x <= 73; x += 3.2) {
      boxAt(0.18, 0.16, 16.0, MT.rust, x, 33.0, -0.16, 0, false, 1.5);
    }

    // ---- paths, Glade structures, and 38-meter-tall Maze Runner megalithic canyon walls
    const pathH = (x, y) => { const t = terrainH(x, y); return t > 0 ? t + 0.035 : 0.02; };
    const inGlade = (x, y) => Math.abs(x - W.plaza[0]) < 7.6 && Math.abs(y - W.plaza[1]) < 7.6;
    const canyonPaths = W.paths.filter((pts) => !pts.every(([x, y]) => inGlade(x, y))).concat([W.spiral, [W.zigzag[W.zigzag.length - 1], W.teaNode]]);
    add(ribbon(canyonPaths, 0.84, pathH, 0.84), MT.gravel);
    add(ribbon(W.maze, 0.42, pathH, 0.42), MT.forest);
    (function mazeWalls() {
      const posts = [], ties = [], louvers = [], ivyCards = [], runs = [], outerRuns = [], bladeRuns = [];
      const base = (x, y) => Math.max(0, terrainH(x, y));
      W.paths.concat([W.zigzag, W.longBridge]).forEach((line) => {
        const pts = resample(line, 0.25);
        [-1, 1].forEach((side) => {
          let run = [], outRun = [];
          pts.forEach((p, i) => {
            const q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
            const dx = q[0] - o[0], dy = q[1] - o[1], L = Math.hypot(dx, dy) || 1, nx = (-dy / L) * side, ny = (dx / L) * side;
            const at = [p[0] + nx * 0.42, p[1] + ny * 0.42];
            const out = [p[0] + nx * 0.92, p[1] + ny * 0.92];
            const nearGap = Math.hypot(at[0] - 61.0, at[1] - 52.0) < 2.4 || Math.hypot(at[0] - 51.5, at[1] - 45.5) < 2.0;
            if (!nearGap && !inGlade(at[0], at[1]) && modeAt(at[0], at[1]) === MODE.BLOCKED && modeAt(p[0] + nx * 0.52, p[1] + ny * 0.52) === MODE.BLOCKED) {
              run.push(at); outRun.push(out); return;
            }
            if (run.length > 1) { runs.push(run); outerRuns.push(outRun); }
            run = []; outRun = [];
          });
          if (run.length > 1) { runs.push(run); outerRuns.push(outRun); }
        });
        // Overhead concrete tie-beams spanning across the canyon
        pts.forEach((p, i) => {
          if (i % 18 !== 9 || inGlade(p[0], p[1])) return;
          const q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
          const dx = q[0] - o[0], dy = q[1] - o[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
          if (modeAt(p[0] + nx * 0.52, p[1] + ny * 0.52) === MODE.BLOCKED && modeAt(p[0] - nx * 0.52, p[1] - ny * 0.52) === MODE.BLOCKED) {
            ties.push([p[0], p[1], base(p[0], p[1]) + 2.0, Math.atan2(dy, dx)]);
          }
        });
      });
      W.maze.forEach((line) => {
        const pts = resample(line, 0.25);
        [-1, 1].forEach((side) => {
          let run = [];
          pts.forEach((p, i) => {
            const q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
            const dx = q[0] - o[0], dy = q[1] - o[1], L = Math.hypot(dx, dy) || 1, nx = (-dy / L) * side, ny = (dx / L) * side;
            const at = [p[0] + nx * 0.24, p[1] + ny * 0.24];
            if (modeAt(at[0], at[1]) === MODE.BLOCKED && modeAt(p[0] + nx * 0.32, p[1] + ny * 0.32) === MODE.BLOCKED) { run.push(at); return; }
            if (run.length > 1) bladeRuns.push(run);
            run = [];
          });
          if (run.length > 1) bladeRuns.push(run);
        });
        // Angled overhead Blade Louvers across the Blade Sector corridors
        pts.forEach((p, i) => {
          if (i % 5 === 2) {
            const q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
            louvers.push([p[0], p[1], base(p[0], p[1]) + 2.1, Math.atan2(q[1] - o[1], q[0] - o[0])]);
          }
        });
      });

      const H1 = 3.8, H2 = 4.4;
      runs.forEach((r, k) => {
        r.forEach((p, idx) => {
          if (idx % 4 === 0) posts.push([p[0], p[1], H1]);
          if (idx % 3 === 1 && idx + 1 < r.length) {
            const ang = Math.atan2(r[idx + 1][1] - p[1], r[idx + 1][0] - p[0]);
            ivyCards.push([p[0], p[1], base(p[0], p[1]) + H1 * 0.55, ang, H1 * 0.65]);
          }
        });
        // 3-Tier 45m mossy monolith wall: wide battered stone base + main monolith shaft + overhanging concrete cornice
        add(wall(r, (x, y) => base(x, y), (x, y) => base(x, y) + H1, 1.6), MT.monolith, { cast: true });
        add(wall(r, (x, y) => base(x, y), (x, y) => base(x, y) + 0.85, 1.2), MT.stone);
        add(wall(outerRuns[k], (x, y) => base(x, y), (x, y) => base(x, y) + H1, 1.6), MT.concrete_wall, { cast: true });
        const mid = r.map((p, i) => [(p[0] + outerRuns[k][i][0]) * 0.5, (p[1] + outerRuns[k][i][1]) * 0.5]);
        add(ribbon([mid], 0.68, (x, y) => base(x, y) + H1, 1.2), MT.concrete_wall, { cast: true });
        add(ribbon([mid], 0.34, (x, y) => base(x, y) + H1 + 0.06, 1.2), MT.rust);
        add(ribbon([r], 0.18, (x, y) => base(x, y) + 2.2, 1.2), MT.stone);
      });
      bladeRuns.forEach((r) => {
        r.forEach((p, idx) => { if (idx % 5 === 0) posts.push([p[0], p[1], H2]); });
        add(wall(r, (x, y) => base(x, y), (x, y) => base(x, y) + H2, 1.5), MT.concrete_wall, { cast: true });
        add(wall(r, (x, y) => base(x, y), (x, y) => base(x, y) + 0.9, 1.2), MT.rust);
        add(ribbon([r], 0.56, (x, y) => base(x, y) + H2, 1.0), MT.concrete_wall, { cast: true });
        add(ribbon([r], 0.28, (x, y) => base(x, y) + H2 + 0.06, 1.0), MT.rust);
      });
      instanced(tiledBoxGeo(0.32, 1, 0.32, 0.9).translate(0, 0.5, 0), MT.concrete_wall, posts,
        (o, [x, y, h]) => { o.position.copy(v3(x, y, base(x, y))); o.scale.set(1, h - 0.15, 1); }, { cast: true });
      instanced(tiledBoxGeo(0.38, 0.24, 0.38, 0.6).translate(0, 0.5, 0), MT.rust, posts,
        (o, [x, y, h]) => { o.position.copy(v3(x, y, base(x, y) + h * 0.52)); }, { cast: false });
      instanced(tiledBoxGeo(0.22, 0.24, 1.05, 0.8), MT.concrete_wall, ties,
        (o, [x, y, z, a]) => { o.position.copy(v3(x, y, z + 1.8)); o.rotation.y = a; }, { cast: true });
      instanced(tiledBoxGeo(0.12, 0.28, 0.82, 0.6), MT.rust, louvers,
        (o, [x, y, z, a]) => { o.position.copy(v3(x, y, z + 2.2)); o.rotation.set(0.38, a, 0); }, { cast: true });

      // 3D hanging ivy curtains draping down the stone walls
      const ivyTex = texFile("leaves_dark");
      if (ivyTex) {
        ivyTex.wrapS = ivyTex.wrapT = THREE.ClampToEdgeWrapping;
        const ivyMat = new THREE.MeshLambertMaterial({ map: ivyTex, color: 0x7ea86b, alphaTest: 0.42, side: THREE.DoubleSide });
        instanced(new THREE.PlaneGeometry(1.1, 1.6), ivyMat, ivyCards, (o, [x, y, z, a, s]) => {
          o.position.copy(v3(x, y, z)); o.rotation.y = -a; o.scale.set(s * 0.5, s * 0.75, 1);
        });
      }

      // Concentric Ring Megawalls & Radial Sector Spokes (authentic Maze Runner circular-ring labyrinth!)
      const CX = 50.0, CY = 35.0;
      const onSightline = (x, y) => {
        const [s1] = alongLine(x, y, [61.0, 52.0], [29.0, 28.0]);
        if (Math.hypot(x - (61.0 + (-32.0 / 40.0) * s1), y - (52.0 + (-24.0 / 40.0) * s1)) < 1.45) return true;
        const [s2] = alongLine(x, y, [61.0, 52.0], [73.0, 58.0]);
        if (Math.hypot(x - (61.0 + (12.0 / 13.42) * s2), y - (52.0 + (6.0 / 13.42) * s2)) < 1.45) return true;
        if (Math.hypot(x - 69.0, y - 51.0) < 3.2) return true;
        return false;
      };
      const allCorridors = W.paths.concat(W.maze, [W.zigzag, W.longBridge, W.spiral, W.underpass, W.overpass, W.ferry]).map((ln) => resample(ln, 0.25));
      const nearCorridor = (x, y, r) => {
        const r2 = r * r;
        for (const ln of allCorridors) {
          for (const [cx, cy] of ln) if ((cx - x) ** 2 + (cy - y) ** 2 < r2) return true;
        }
        return false;
      };
      const okWallPt = (x, y) => {
        if (x > 75.0 || (Math.abs(x - W.plaza[0]) < 9.2 && Math.abs(y - W.plaza[1]) < 9.2)) return false;
        if (Math.hypot(x - W.hill.x, y - W.hill.y) < W.hill.r * 0.9) return false;
        if (!pointInPoly(x, y, W.boundary) || pointInPoly(x, y, W.lake) || pointInPoly(x, y, W.wetland)) return false;
        if (onSightline(x, y) || nearCorridor(x, y, 1.45)) return false;
        return modeAt(x, y) === MODE.BLOCKED;
      };
      const ringLines = [];
      [10.5, 14.0, 17.5, 21.0, 24.5, 28.0, 31.5].forEach((R) => {
        const pts = [];
        const steps = Math.max(48, Math.round(R * 6));
        for (let k = 0; k <= steps; k++) {
          const a = (k / steps) * Math.PI * 2;
          pts.push([CX + Math.cos(a) * R * 1.12, CY + Math.sin(a) * R * 0.94]);
        }
        ringLines.push(pts);
      });
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const pts = [];
        for (let r = 9.0; r <= 34.0; r += 0.35) {
          pts.push([CX + Math.cos(a) * r * 1.12, CY + Math.sin(a) * r * 0.94]);
        }
        ringLines.push(pts);
      }
      ringLines.forEach((pts, li) => {
        let cur = [];
        const flush = () => {
          if (cur.length < 3) { cur = []; return; }
          const H = 4.35 + (li % 3) * 0.35, hw = 0.68;
          const L = offsetLine(cur, hw), R = offsetLine(cur, -hw);
          const Lb = offsetLine(cur, hw + 0.18), Rb = offsetLine(cur, -hw - 0.18);
          // Stepped base plinth + main monolith wall + overhanging cornice + recessed mechanical track on roof
          add(wall(Lb, (x, y) => base(x, y), (x, y) => base(x, y) + 1.1, 1.4), MT.stone, { cast: true });
          add(wall(Rb, (x, y) => base(x, y), (x, y) => base(x, y) + 1.1, 1.4), MT.stone, { cast: true });
          add(ribbon([cur], (hw + 0.18) * 2.04, (x, y) => base(x, y) + 1.1, 1.4), MT.stone);
          add(wall(L, (x, y) => base(x, y), (x, y) => base(x, y) + H, 1.6), MT.monolith, { cast: true });
          add(wall(R, (x, y) => base(x, y), (x, y) => base(x, y) + H, 1.6), MT.concrete_wall, { cast: true });
          add(wall([L[0], R[0]], (x, y) => base(x, y), (x, y) => base(x, y) + H, 1.2), MT.stone, { cast: true });
          add(wall([R[R.length - 1], L[L.length - 1]], (x, y) => base(x, y), (x, y) => base(x, y) + H, 1.2), MT.stone, { cast: true });
          add(ribbon([cur], hw * 2.16, (x, y) => base(x, y) + H, 1.2), MT.concrete_wall, { cast: true });
          add(ribbon([cur], hw * 0.9, (x, y) => base(x, y) + H + 0.08, 1.2), MT.rust);
          cur.forEach((p, idx) => { if (idx % 6 === 0) posts.push([p[0], p[1], H]); });
          cur = [];
        };
        pts.forEach((p) => { if (okWallPt(p[0], p[1])) cur.push(p); else flush(); });
        flush();
      });

      // ---- THE SQUARE GLADE (林间空地, centered at (50, 25)): 52m Perimeter Walls, 4 Geared Doors, The Box, Homestead & Map Room
      const [px, py] = W.plaza;
      [
        [px - 4.8, py - 8.0, 5.8, 5.2, 1.25, 0], [px + 4.8, py - 8.0, 5.8, 5.2, 1.25, 0],
        [px - 4.8, py + 8.0, 5.8, 5.2, 1.25, 0], [px + 4.8, py + 8.0, 5.8, 5.2, 1.25, 0],
        [px - 8.0, py - 4.8, 1.25, 5.2, 5.8, 0], [px - 8.0, py + 4.8, 1.25, 5.2, 5.8, 0],
        [px + 8.0, py - 4.8, 1.25, 5.2, 5.8, 0], [px + 8.0, py + 4.8, 1.25, 5.2, 5.8, 0],
      ].forEach(([wx, wy, w, h, d, rot]) => {
        boxAt(w + 0.36, 1.25, d + 0.36, MT.stone, wx, wy, 0, rot, true, 1.4);
        boxAt(w, h, d, MT.monolith, wx, wy, 0, rot, true, 1.6);
        boxAt(w + 0.24, 0.24, d + 0.24, MT.concrete_wall, wx, wy, h, rot, true, 1.4);
      });
      // Stepped brutalist portal cheek-towers & interlocking stone/steel teeth at the 4 Glade Doors (N, S, E, W)
      [
        [px, py - 8.0, true], [px, py + 8.0, true],
        [px - 8.0, py, false], [px + 8.0, py, false],
      ].forEach(([gx, gy, ns]) => {
        [-0.95, 0.95].forEach((off) => {
          boxAt(ns ? 0.75 : 1.65, 5.3, ns ? 1.65 : 0.75, MT.concrete_wall, gx + (ns ? off : 0), gy + (ns ? 0 : off), 0, 0, true, 1.4);
        });
        for (let k = 0; k < 7; k++) {
          const tz = 0.25 + k * 0.66, off = (k % 2 === 0 ? -1 : 1) * 0.44;
          boxAt(ns ? 0.88 : 0.52, 0.46, ns ? 0.52 : 0.88, k % 2 === 0 ? MT.stone : MT.rust,
            gx + (ns ? off : 0), gy + (ns ? 0 : off), tz, 0, true, 0.8);
        }
      });
      // 2. THE BOX (中央铁笼升降机) at W.plaza (50.0, 25.0)
      boxAt(1.65, 0.06, 1.65, MT.concrete_wall, px, py, 0.01, 0, false, 1.0);
      boxAt(1.35, 0.07, 1.35, std({ color: 0x111518, roughness: 0.9 }), px, py, 0.015, 0, false);
      for (let g = -0.55; g <= 0.56; g += 0.22) {
        boxAt(1.32, 0.025, 0.035, MT.rust, px, py + g, 0.045, 0, false, 0.5);
        boxAt(0.035, 0.025, 1.32, MT.metal, px + g, py, 0.045, 0, false, 0.5);
      }
      [[-0.72, -0.72], [0.72, -0.72], [-0.72, 0.72], [0.72, 0.72]].forEach(([dx, dy]) => {
        boxAt(0.09, 0.48, 0.09, MT.rust, px + dx, py + dy, 0.02, 0, true, 0.5);
      });
      floorStencil("mark_box", px, py - 1.12, 0.95, 90);

      // 3. THE HOMESTEAD (林间空地木屋营地) at (45.2, 29.2) & Skeletal Timber Watchtower at (47.7, 23.8)
      const hx = px - 4.8, hy = py + 4.2;
      boxAt(2.2, 0.55, 1.6, MT.wood, hx, hy, 0, 0.08, true, 1.0);
      boxAt(1.6, 0.45, 1.2, MT.wood, hx - 0.15, hy + 0.1, 0.55, 0.08, true, 1.0);
      boxAt(2.4, 0.06, 1.8, MT.rust, hx, hy, 0.55, 0.08, true, 1.0);
      boxAt(1.8, 0.06, 1.4, MT.rust, hx - 0.15, hy + 0.1, 1.0, 0.08, true, 1.0);
      const wx = px - 2.3, wy = py - 1.2, wh = 3.2;
      [[-0.38, -0.38], [0.38, -0.38], [0.38, 0.38], [-0.38, 0.38]].forEach(([dx, dy]) => {
        boxAt(0.07, wh, 0.07, MT.wood, wx + dx, wy + dy, 0, 0, true, 0.8);
      });
      [0.8, 1.6, 2.4, 3.2].forEach((tz, ti) => {
        const wt = 0.88 - ti * 0.04;
        boxAt(wt, 0.05, 0.05, MT.wood, wx, wy - wt / 2, tz, 0, true, 0.8);
        boxAt(wt, 0.05, 0.05, MT.wood, wx, wy + wt / 2, tz, 0, true, 0.8);
        boxAt(0.05, 0.05, wt, MT.wood, wx - wt / 2, wy, tz, 0, true, 0.8);
        boxAt(0.05, 0.05, wt, MT.wood, wx + wt / 2, wy, tz, 0, true, 0.8);
        if (ti === 1 || ti === 3) boxAt(wt + 0.16, 0.04, wt + 0.16, MT.wood, wx, wy, tz + 0.04, 0, true, 0.8);
      });
      // 4. THE MAP ROOM BUNKER (地图室混凝土暗堡) behind the guideBoard
      boxAt(1.5, 0.62, 1.1, MT.concrete_wall, W.guideBoard[0], W.guideBoard[1] - 0.65, 0, 0, true, 1.0);
      boxAt(1.62, 0.08, 1.22, MT.rust, W.guideBoard[0], W.guideBoard[1] - 0.65, 0.62, 0, true, 1.0);

      // 5. Sector numbers spray-stencilled on the floor at the ring entrances, read walking away from the Glade
      [
        [50.0, 34.5, "sector_01"], [40.5, 25.0, "sector_02"], [35.0, 44.0, "sector_03"],
        [50.0, 60.5, "sector_04"], [68.0, 49.0, "sector_07"], [85.5, 26.5, "sector_08"],
      ].forEach(([sx, sy, key]) => {
        floorStencil(key, sx, sy, 0.62, (Math.atan2(sy - W.plaza[1], sx - W.plaza[0]) * 180) / Math.PI);
      });
    })();
    const plaza = new THREE.CircleGeometry(1.35, 8).rotateX(-Math.PI / 2);
    const puv = plaza.attributes.uv;
    for (let i = 0; i < puv.count; i++) puv.setXY(i, puv.getX(i) * 4, puv.getY(i) * 4);
    add(plaza, MT.forest).position.copy(v3(W.plaza[0], W.plaza[1], 0.022));

    add(ribbon([W.road], 2.4, () => 0.022, 2.4), MT.asphalt);
    const road = resample(W.road, 0.5), dashes = [];
    for (let i = 0; i + 2 < road.length; i += 4) dashes.push(road.slice(i, i + 3));
    add(ribbon(dashes, 0.06, () => 0.03), M.lines);
    [-1.15, 1.15].forEach((d) => add(ribbon([offsetLine(W.road, d)], 0.05, () => 0.03), M.lineWhite));
    [-1.24, 1.24].forEach((d) => add(wall(offsetLine(W.road, d), () => 0, () => 0.03), M.concreteDS));
    [-1.75, 1.75].forEach((d) => {
      const f = resample(offsetLine(W.road, d), 0.6);
      add(wall(f, () => 0.085, () => 0.095), M.metalDS, { cast: true });
      add(wall(f, () => 0.045, () => 0.052), M.metalDS);
      instanced(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 5).translate(0, 0.05, 0), M.darkMetal, f, (o, [x, y]) => { o.position.copy(v3(x, y, 0)); }, { cast: true });
    });

    // ---- bridges
    function railing(line, deck, mat, postMat, height) {
      const posts = [];
      [-0.18, 0.18].forEach((d) => {
        const r = resample(offsetLine(line, d), 0.45);
        add(wall(r, () => deck + height - 0.012, () => deck + height), mat, { cast: true });
        add(wall(r, () => deck + height * 0.45, () => deck + height * 0.45 + 0.008), mat);
        r.forEach((p) => posts.push(p));
      });
      instanced(new THREE.BoxGeometry(0.016, height, 0.016).translate(0, height / 2, 0), postMat || mat, posts,
        (o, [x, y]) => { o.position.copy(v3(x, y, deck)); }, { cast: true });
    }
    const zig = resample(W.zigzag, 0.2);
    add(ribbon([zig], 0.42, () => 0.03, 0.42), MT.gravel);
    add(wall(offsetLine(zig, 0.21), () => -0.02, () => 0.05), MT.rust);
    add(wall(offsetLine(zig, -0.21), () => -0.02, () => 0.05), MT.rust);
    add(ribbon([resample(W.longBridge, 0.4)], 0.46, () => 0.03, 0.46), MT.gravel);
    railing(resample(W.longBridge, 0.45), 0.03, MT.rust, MT.rust, 0.08);

    const stripes = canvasTex(256, 64, (ctx) => {
      ctx.fillStyle = "#f5b800"; ctx.fillRect(0, 0, 256, 64); ctx.fillStyle = "#1c2226";
      for (let x = -64; x < 256; x += 40) { ctx.beginPath(); ctx.moveTo(x, 64); ctx.lineTo(x + 20, 64); ctx.lineTo(x + 84, 0); ctx.lineTo(x + 64, 0); ctx.fill(); }
    });
    const barrier = std({ map: stripes, roughness: 0.5 });
    const blastDoorMat = std({ map: concreteTex, color: 0x4f565d, roughness: 0.75, metalness: 0.25 });
    /* Sliding monolith walls exist in two wordings (one-off mechanical lock vs. the posted cycle) and are switched on by the clock. */
    const barrierSets = { long_bridge_far: { forced: [], schedule: [], parts: [] }, zigzag: { forced: [], schedule: [], parts: [] } };
    function keep(key, slot, obj) { obj.visible = false; barrierSets[key][slot].push(obj); return obj; }
    (function longBridgeBarrier() {
      const lb = W.longBridgeBlock;
      boxAt(1.8, 0.015, 0.14, M.darkMetal, lb[0], lb[1] - 0.4, 0.025);
      keep("long_bridge_far", "parts", boxAt(1.05, 1.55, 0.18, blastDoorMat, lb[0], lb[1] - 0.4, 0.03));
      keep("long_bridge_far", "parts", boxAt(1.08, 0.22, 0.2, barrier, lb[0], lb[1] - 0.4, 0.18));
      [-0.48, 0.48].forEach((d) => keep("long_bridge_far", "parts", boxAt(0.08, 1.65, 0.22, M.darkMetal, lb[0] + d, lb[1] - 0.4, 0.03)));
      keep("long_bridge_far", "forced", signSprite("forced_lb", lb[0], lb[1] - 0.4, 0.7, 0.17));
      keep("long_bridge_far", "schedule", signSprite("barrier_lb", lb[0], lb[1] - 0.4, 0.7, 0.17));
    })();
    W.barriers.zigzag.forEach(([zx, zy], i) => {
      const rot = i ? -Math.PI / 4 : Math.PI / 4, s2 = i ? -1 : 1;
      boxAt(1.5, 0.015, 0.14, M.darkMetal, zx, zy, 0.025, rot);
      keep("zigzag", "parts", boxAt(0.88, 1.5, 0.16, blastDoorMat, zx, zy, 0.03, rot));
      keep("zigzag", "parts", boxAt(0.9, 0.2, 0.18, barrier, zx, zy, 0.18, rot));
      [-1, 1].forEach((s) => keep("zigzag", "parts", boxAt(0.07, 1.6, 0.2, M.darkMetal, zx + s * 0.38 * Math.SQRT1_2, zy + s * s2 * 0.38 * Math.SQRT1_2, 0.03)));
      keep("zigzag", "forced", signSprite("forced_zig", zx, zy, 0.66, 0.17));
      keep("zigzag", "schedule", signSprite("barrier_zig", zx, zy, 0.66, 0.17));
    });
    ["underpass", "overpass"].forEach((key) => {
      barrierSets[key] = { forced: [], schedule: [], parts: [] };
      const line = key === "underpass" ? W.underpass : W.overpass;
      const ang = Math.atan2(line[1][1] - line[0][1], line[1][0] - line[0][0]);
      W.barriers[key].forEach(([bx, by]) => {
        const base = groundAt(bx, by);
        keep(key, "parts", boxAt(0.08, 0.9, 0.68, blastDoorMat, bx, by, base + 0.02, ang));
        keep(key, "parts", boxAt(0.1, 0.2, 0.7, barrier, bx, by, base + 0.15, ang));
        keep(key, "forced", signSprite("forced_" + key, bx, by, base + 0.6, 0.15));
      });
    });
    function setClosed(state) {
      Object.keys(barrierSets).forEach((key) => {
        const how = state[key];
        const set = barrierSets[key];
        set.parts.forEach((o) => (o.visible = !!how));
        set.forced.forEach((o) => (o.visible = how === "forced"));
        set.schedule.forEach((o) => (o.visible = how === "schedule"));
      });
      shadowDirty = true;
    }
    const wf = W.wetlandFence;
    boxAt(0.06, 0.45, 1.2, barrier, wf[0], wf[1], 0.04);
    signSprite("wetland", wf[0] + 0.1, wf[1], 0.6, 0.15);

    /* Things whose look follows the task (closures, plaques and timetables, the shuttle, people) also live on layer OVERLAY. */
    const OVERLAY = 1;
    const overlayFrom = (n0) => scene.children.slice(n0).forEach((o) => o.traverse((c) => c.layers.enable(OVERLAY)));
    Object.values(barrierSets).forEach((set) => Object.values(set).forEach((list) => list.forEach((o) => o.traverse((c) => c.layers.enable(OVERLAY)))));
    const plaqueStart = scene.children.length;
    (function plaques() {
      const plaque = (key, x, y) => {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.28, 6), M.darkMetal);
        post.position.copy(v3(x, y, 0.14)); scene.add(post);
        signSprite(key, x, y, 0.34, 0.12);
      };
      const zig = force.zigzag === "closed" ? "forced_zig" : "plaque_zig";
      plaque(zig, W.zigzag[0][0] + 0.55, W.zigzag[0][1] - 0.45);
      plaque(zig, W.zigzag[W.zigzag.length - 1][0] - 0.35, W.zigzag[W.zigzag.length - 1][1] - 0.5);
      if (force.long_bridge_far !== "open") {
        plaque(force.long_bridge_far === "closed" ? "forced_lb" : "plaque_lb", W.longBridge[0][0] + 0.45, W.longBridge[0][1] - 0.3);
      }
    })();
    overlayFrom(plaqueStart);

    add(ribbon([W.ferry], 0.16, () => 0.018, 1.0), M.darkMetal);
    W.docks.forEach(([x, y], i) => {
      boxAt(0.75, 0.06, 0.45, M.concrete, x, y, 0.0);
      const boardStart = scene.children.length;
      const key = (i ? "dock_n" : "dock_s") + (force.ferry === "closed" ? "_closed" : "");
      signSprite(key, x + (i ? 0.45 : -0.45), y, 0.44, 0.15);
      overlayFrom(boardStart);
    });

    (function leadPosts() {
      W.leadPosts.forEach(([x, y, h]) => {
        const tallH = h * 9.5, n = 8, seg = tallH / n;
        for (let k = 0; k < n; k++) {
          const m = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, seg, 12), k % 2 ? M.red : M.white);
          m.position.copy(v3(x, y, terrainH(x, y) + seg * (k + 0.5))); m.castShadow = true; scene.add(m);
        }
        const cap = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.35, 12), std({ color: 0xff3d00, emissive: 0xff3d00, emissiveIntensity: 1.2 }));
        cap.position.copy(v3(x, y, terrainH(x, y) + tallH + 0.18)); scene.add(cap);
      });
    })();

    const friend = (function person() {
      const g = new THREE.Group();
      const part = (geo, color, y) => { const m = new THREE.Mesh(geo, std({ color, roughness: 0.7 })); m.position.y = y; m.castShadow = true; g.add(m); };
      [-0.008, 0.008].forEach((dx) => { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.08, 6), std({ color: 0x263238 })); leg.position.set(0, 0.04, dx); g.add(leg); });
      part(new THREE.CylinderGeometry(0.016, 0.02, 0.065, 10), 0xe53935, 0.112);
      part(new THREE.SphereGeometry(0.013, 12, 10), 0xf1c7a5, 0.158);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.06, 6), std({ color: 0xe53935 }));
      arm.position.set(0.012, 0.15, 0.018); arm.rotation.z = -0.9; g.add(arm);
      g.visible = false;
      scene.add(g);
      return { group: g, place(x, y, headingDeg) { g.position.copy(v3(x, y, terrainH(x, y))); g.rotation.y = rad(headingDeg); g.visible = true; shadowDirty = true; } };
    })();

    const chest = (function treasureChest() {
      const g = new THREE.Group();
      const wood = std({ color: 0x8d5524, roughness: 0.7 }), gold = std({ color: 0xffc107, roughness: 0.3, metalness: 0.8 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.08), wood); body.position.y = 0.03; g.add(body);
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.12, 12, 1, false, 0, Math.PI), wood);
      lid.rotation.z = Math.PI / 2; lid.position.y = 0.06; g.add(lid);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.012, 0.085), gold); band.position.y = 0.045; g.add(band);
      g.visible = false;
      scene.add(g);
      return { group: g, place(x, y) { g.position.copy(v3(x, y, 0.03)); g.visible = true; shadowDirty = true; } };
    })();
    const boat = (function shuttleCar() {
      const g = new THREE.Group();
      const part = (w, h, d, mat, x, base) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        m.position.set(x, base + h / 2, 0); m.castShadow = true; m.receiveShadow = true; g.add(m);
      };
      part(1.06, 0.14, 0.42, M.darkMetal, 0, -0.01);
      part(1.08, 0.04, 0.44, std({ color: 0xf57c00, roughness: 0.4 }), 0, 0.08);
      part(0.55, 0.22, 0.34, std({ color: 0x37474f, metalness: 0.5, roughness: 0.4 }), -0.06, 0.12);
      part(0.6, 0.03, 0.38, std({ color: 0xffb300, emissive: 0xff8f00, emissiveIntensity: 0.4 }), -0.06, 0.34);
      scene.add(g);
      const place = (x, y, headingDeg) => { g.position.copy(v3(x, y, 0)); g.rotation.y = (headingDeg * Math.PI) / 180; };
      const [x, y] = W.docks[0];
      place(x + 0.2, y + 0.75, 8.6);
      return { group: g, place };
    })();

    [friend.group, chest.group, boat.group].forEach((g) => g.traverse((c) => c.layers.enable(OVERLAY)));

    // ---- underpass: sunken ramps, tunnel, lights
    (function underpass() {
      const [a, b] = W.underpass;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const dx = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L;
      const line = [];
      for (let s = 0; s <= L + 1e-6; s += 0.2) line.push([a[0] + dx * s, a[1] + dy * s, s]);
      const xy = line.map((p) => [p[0], p[1]]);
      const floorAt = (i) => underFloor(line[i][2], L) - 0.002;
      add(ribbon([xy], 0.62, (x, y, i) => floorAt(i), 0.25), M.tunnelFloor);
      [-0.31, 0.31].forEach((d) => add(wall(offsetLine(xy, d), (x, y, i) => floorAt(i), () => 0.03, 1.0), M.tunnelWall));
      const inner = line.filter((p) => p[2] >= 1.5 && p[2] <= L - 1.5).map((p) => [p[0], p[1]]);
      add(ribbon([inner], 0.7, () => -0.012), M.tunnelWall, { cast: true });
      const lights = inner.filter((p, i) => i % 5 === 2);
      instanced(new THREE.BoxGeometry(0.12, 0.008, 0.03), std({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 1.3 }), lights,
        (o, [x, y]) => { o.position.copy(v3(x, y, -0.02)); o.rotation.y = Math.atan2(dy, dx); });
      [[1.5, -1], [L - 1.5, 1]].forEach(([s, out]) => {
        const x = a[0] + dx * s, y = a[1] + dy * s;
        boxAt(0.1, 0.12, 0.8, M.concrete, x, y, 0.0, Math.atan2(dy, dx));
        signSprite("underpass", x + out * dx * 0.12, y + out * dy * 0.12, 0.3, 0.11);
      });
    })();

    // ---- overpass
    (function overpass() {
      const [a, b] = W.overpass;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const dx = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L;
      const line = [];
      for (let s = 0; s <= L + 1e-6; s += 0.2) line.push([a[0] + dx * s, a[1] + dy * s]);
      const deck = (x, y) => { const [s] = alongLine(x, y, a, b); return overDeck(s, L); };
      add(ribbon([line], 0.56, (x, y) => deck(x, y) + 0.002, 0.6), M.concrete, { cast: true });
      add(ribbon([line], 0.62, (x, y) => deck(x, y) - 0.05), M.concreteDS, { cast: true });
      [-0.28, 0.28].forEach((d) => {
        const r = offsetLine(line, d);
        add(wall(r, (x, y) => deck(x, y) - 0.05, (x, y) => deck(x, y) + 0.02), M.concreteDS);
        add(wall(r, (x, y) => deck(x, y) + 0.02, (x, y) => deck(x, y) + 0.1), M.glass);
        add(wall(r, (x, y) => deck(x, y) + 0.1, (x, y) => deck(x, y) + 0.11), M.metalDS);
      });
      [2.4, L - 2.4].forEach((s) => {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, OVER_H - 0.05, 12), M.darkMetal);
        m.position.copy(v3(a[0] + dx * s, a[1] + dy * s, (OVER_H - 0.05) / 2)); m.castShadow = true; scene.add(m);
      });
    })();

    // ---- trees and bushes: leaf-card crowns (same textures and recipe as blender/park_scene.py), instanced per prototype.
    // Two levels of detail: full crowns near the camera, a few large cards further away and in the lake reflection.
    const NEAR_TREES = 7;
    const veg = (function vegetation() {
      const leafMats = {};
      ["leaves_green", "leaves_dark", "leaves_autumn", "leaves_blossom", "needles"].forEach((k) => {
        const map = texFile(k);
        if (!map) return;
        map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
        const mat = new THREE.MeshLambertMaterial({ map, color: k === "leaves_blossom" ? 0xb8a8b0 : 0xc4c4c4, alphaTest: 0.45, side: THREE.DoubleSide });
        mat.userData.depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.45, side: THREE.DoubleSide });
        leafMats[k] = mat;
      });
      const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
      function geo(p, n, u, idx) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
        g.setAttribute("normal", new THREE.Float32BufferAttribute(n, 3));
        if (u) g.setAttribute("uv", new THREE.Float32BufferAttribute(u, 2));
        g.setIndex(idx);
        return g;
      }
      function proto(kind, seed, lod) {
        const r = rng(seed);
        const gauss = () => Math.sqrt(-2 * Math.log(r() || 1e-6)) * Math.cos(6.2832 * r());
        const lp = [], ln = [], lu = [], li = [], tp = [], tn = [], ti = [];
        const crown = new THREE.Vector3();
        const cards = (full) => (lod ? Math.round(full / 5) : full), grow = lod ? Math.sqrt(5) * 0.92 : 1;
        const tube = (a, b, r0, r1, segs) => {
          const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), axis = B.clone().sub(A).normalize();
          const t1 = new THREE.Vector3().crossVectors(axis, Math.abs(axis.y) < 0.9 ? Y : X).normalize();
          const t2 = new THREE.Vector3().crossVectors(axis, t1);
          const base = tp.length / 3;
          for (let k = 0; k < segs; k++) {
            const ang = (k / segs) * 6.2832, c = Math.cos(ang), s = Math.sin(ang);
            [[A, r0], [B, r1]].forEach(([P, rr]) => {
              const n = t1.clone().multiplyScalar(c).addScaledVector(t2, s);
              const q = P.clone().addScaledVector(n, rr);
              tp.push(q.x, q.y, q.z); tn.push(n.x, n.y, n.z);
            });
            const a0 = base + k * 2, a1 = base + ((k + 1) % segs) * 2;
            ti.push(a0, a1, a1 + 1, a0, a1 + 1, a0 + 1);
          }
        };
        const card = (c, size) => {
          size *= grow;
          const n = new THREE.Vector3(r() * 2 - 1, r() * 1.6 - 0.6, r() * 2 - 1).normalize();
          const t1 = new THREE.Vector3().crossVectors(n, Math.abs(n.y) < 0.9 ? Y : X).normalize();
          const t2 = new THREE.Vector3().crossVectors(n, t1);
          const out = c.clone().sub(crown).normalize().multiplyScalar(0.7).add(new THREE.Vector3(0, 0.5, 0)).normalize();
          const base = lp.length / 3;
          [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([su, sv]) => {
            const p = c.clone().addScaledVector(t1, (su * size) / 2).addScaledVector(t2, (sv * size) / 2);
            lp.push(p.x, p.y, p.z); ln.push(out.x, out.y, out.z); lu.push((su + 1) / 2, (sv + 1) / 2);
          });
          li.push(base, base + 1, base + 2, base, base + 2, base + 3);
        };
        if (kind === "conifer") {
          tube([0, 0, 0], [0, 0.95, 0], 0.035, 0.008, lod ? 4 : 6);
          crown.set(0, 0.5, 0);
          for (let k = 0, n = cards(230); k < n; k++) {
            const t = r(), rr = (1 - t) * 0.26 * Math.sqrt(r()), a = r() * 6.2832;
            card(new THREE.Vector3(Math.cos(a) * rr, 0.18 + t * 0.8, Math.sin(a) * rr), 0.17 * (1.15 - t * 0.5));
          }
        } else {
          const bush = kind === "bush", top = 0.55;
          if (!bush) {
            tube([0, 0, 0], [0.02, top, 0.01], 0.045, 0.028, lod ? 4 : 6);
            for (let k = 0; k < 5; k++) {
              const a = r() * 6.2832, y0 = top * (0.75 + 0.2 * r()), y1 = top + 0.12 + 0.18 * r();
              if (!lod) tube([0.02, y0, 0.01], [Math.cos(a) * 0.22, y1, Math.sin(a) * 0.22], 0.022, 0.008, 5);
            }
          }
          const [cy, rx, ry] = bush ? [0.3, 0.42, 0.28] : kind === "tall" ? [0.7, 0.27, 0.4] : [0.7, 0.36, 0.3];
          crown.set(0, cy, 0);
          for (let k = 0, n = cards(bush ? 110 : 230); k < n; k++) {
            const u = new THREE.Vector3(gauss(), gauss(), gauss()).normalize().multiplyScalar(Math.pow(r(), lod ? 0.6 : 0.35));
            card(new THREE.Vector3(u.x * rx, cy + u.y * ry, u.z * rx), bush ? 0.26 : 0.24 + 0.1 * r());
          }
        }
        return { leaves: geo(lp, ln, lu, li), trunk: tp.length ? geo(tp, tn, null, ti) : null };
      }
      const both = (kind, seed) => [proto(kind, seed, 0), proto(kind, seed, 1)];
      const PROTOS = {
        green: [both("round", 10), both("tall", 11), both("round", 12)], dark: [both("round", 20), both("tall", 21)],
        autumn: [both("round", 30)], blossom: [both("round", 31)], conifer: [both("conifer", 40), both("conifer", 41)],
        bush: [both("bush", 50), both("bush", 51)],
      };
      const LEAF = { green: "leaves_green", dark: "leaves_dark", autumn: "leaves_autumn", blossom: "leaves_blossom", conifer: "needles", bush: "leaves_green" };
      const groups = new Map(), r = rng(31);
      const put = (kind, x, y, sh, sxy) => {
        const pr = PROTOS[kind][Math.floor(r() * PROTOS[kind].length)];
        if (!groups.has(pr)) groups.set(pr, { kind, list: [] });
        groups.get(pr).list.push([x, y, terrainH(x, y), sh, sxy, r() * 6.2832, 0.82 + r() * 0.3]);
      };
      const inGladeOrHill = (x, y) => (Math.abs(x - W.plaza[0]) < 7.4 && Math.abs(y - W.plaza[1]) < 7.4 && Math.hypot(x - W.plaza[0], y - W.plaza[1]) > 2.2)
        || (Math.hypot(x - W.hill.x, y - W.hill.y) < 6.2 && modeAt(x, y) === MODE.BLOCKED);
      W.trees.forEach(([x, y, s, forest]) => {
        if (forest || !inGladeOrHill(x, y)) return;
        const k = r(), h = 0.75 + 0.014 * s;
        const kind = k < 0.35 ? "conifer" : k < 0.7 ? "dark" : "green";
        put(kind, x, y, h, h * 1.05);
      });
      // Add dense Glade forest (Deadheads) in the SW, NW, NE & SE quadrants of the Square Glade (50, 25)
      [
        [44.2, 19.2, 1.35], [46.0, 18.8, 1.15], [44.0, 22.2, 1.45], [44.5, 27.8, 1.25],
        [54.8, 19.5, 1.3], [55.8, 22.4, 1.4], [55.2, 28.8, 1.2], [53.8, 30.8, 1.15],
      ].forEach(([tx, ty, h], i) => put(i % 3 === 0 ? "conifer" : "dark", tx, ty, h, h));
      const rb = rng(41);
      W.paths.forEach((p) => resample(p, 1.2).forEach(([x, y], i, arr) => {
        if (!inGladeOrHill(x, y) || rb() > 0.35) return;
        const q = arr[Math.min(i + 1, arr.length - 1)], pp = arr[Math.max(i - 1, 0)];
        const tx = q[0] - pp[0], ty = q[1] - pp[1], n = Math.hypot(tx, ty) || 1, side = rb() < 0.5 ? -1 : 1, off = 0.5 + rb() * 0.4;
        const bx = x - (ty / n) * off * side, by = y + (tx / n) * off * side, s = (0.08 + rb() * 0.07) * 2.0;
        if (inGladeOrHill(bx, by)) put("bush", bx, by, s, s);
      }));

      const dummy = new THREE.Object3D(), col = new THREE.Color(), sets = [];
      const mesh = (g, mat, n) => {
        const inst = new THREE.InstancedMesh(g, mat, n);
        inst.castShadow = true; inst.receiveShadow = true; inst.frustumCulled = false;
        if (mat.userData.depth) inst.customDepthMaterial = mat.userData.depth;
        scene.add(inst);
        return inst;
      };
      groups.forEach(({ kind, list }, [hi, lo]) => {
        const mat = leafMats[LEAF[kind]];
        if (!mat) return;
        const n = list.length, mats = new Float32Array(n * 16), cols = new Float32Array(n * 3), pos = new Float32Array(n * 2);
        list.forEach(([x, y, z, sh, sxy, rot, tint], i) => {
          dummy.position.copy(v3(x, y, z)); dummy.rotation.set(0, rot, 0); dummy.scale.set(sxy, sh, sxy); dummy.updateMatrix();
          dummy.matrix.toArray(mats, i * 16);
          col.setRGB(tint, tint, tint * 0.94).toArray(cols, i * 3);
          pos[i * 2] = dummy.position.x; pos[i * 2 + 1] = dummy.position.z;
        });
        const set = { n, mats, cols, pos, near: [mesh(hi.leaves, mat, n)], far: [mesh(lo.leaves, mat, n)], all: mesh(lo.leaves, mat, n) };
        if (hi.trunk) { set.near.push(mesh(hi.trunk, M.trunk, n)); set.far.push(mesh(lo.trunk, M.trunk, n)); }
        set.all.instanceMatrix.array.set(mats);
        set.all.instanceColor = new THREE.InstancedBufferAttribute(cols.slice(), 3);
        set.all.visible = false;
        [...set.near, ...set.far].forEach((m) => { if (m.material !== M.trunk) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3); });
        sets.push(set);
      });
      const last = new THREE.Vector2(1e9, 1e9);
      function update(cx, cz) {
        if (Math.hypot(cx - last.x, cz - last.y) < 0.5) return;
        last.set(cx, cz);
        const r2 = NEAR_TREES * NEAR_TREES;
        sets.forEach((s) => {
          let a = 0, b = 0;
          for (let i = 0; i < s.n; i++) {
            const dx = s.pos[i * 2] - cx, dz = s.pos[i * 2 + 1] - cz, near = dx * dx + dz * dz < r2, k = near ? a++ : b++;
            (near ? s.near : s.far).forEach((m) => {
              m.instanceMatrix.array.set(s.mats.subarray(i * 16, i * 16 + 16), k * 16);
              if (m.instanceColor) m.instanceColor.array.set(s.cols.subarray(i * 3, i * 3 + 3), k * 3);
            });
          }
          [[s.near, a], [s.far, b]].forEach(([ms, count]) => ms.forEach((m) => {
            m.count = count;
            m.instanceMatrix.needsUpdate = true;
            if (m.instanceColor) m.instanceColor.needsUpdate = true;
          }));
        });
      }
      /* The reflection only needs the far-detail crowns, without trunks. */
      function mirror(on) {
        sets.forEach((s) => { s.all.visible = on; [...s.near, ...s.far].forEach((m) => (m.visible = !on)); });
      }

      return { update, mirror };
    })();

    // ---- no lawn grass in the concrete Shifting Maze
    const grass = { update() {}, meshes: [] };

    // ---- industrial caged beacons along canyon walls and supply crates in the Glade
    (function mazeBeacons() {
      const beacons = [];
      W.paths.forEach((p) => {
        const pts = resample(p, 0.5);
        if (pts.length < 8) return;
        pts.forEach(([x, y], i) => {
          const q = pts[Math.min(i + 1, pts.length - 1)], pp = pts[Math.max(i - 1, 0)];
          const tx = q[0] - pp[0], ty = q[1] - pp[1], n = Math.hypot(tx, ty) || 1;
          if (i % 16 === 8) beacons.push([x + (ty / n) * 0.25, y - (tx / n) * 0.25, Math.atan2(ty, tx)]);
        });
      });
      const okSpot = ([x, y]) => modeAt(x, y) === MODE.BLOCKED && !pointInPoly(x, y, W.lake) && Math.abs(x - 78.6) > 2.3;
      const L = beacons.filter(okSpot);
      instanced(new THREE.BoxGeometry(0.05, 0.16, 0.05), MT.rust, L,
        (o, [x, y, a]) => { o.position.copy(v3(x, y, terrainH(x, y) + 0.36)); o.rotation.y = a; });
      instanced(new THREE.BoxGeometry(0.035, 0.09, 0.035), std({ color: 0xffab40, emissive: 0xff6d00, emissiveIntensity: 2.2 }), L,
        (o, [x, y, a]) => { o.position.copy(v3(x, y, terrainH(x, y) + 0.36)); o.rotation.y = a; });
    })();

    // ---- signs, guide board, pavilions, gates
    const pathPts = W.paths.map((p) => resample(p, 0.5));
    function pathHeading(x, y) {
      let best = [1e9, 0];
      pathPts.forEach((p) => p.slice(0, -1).forEach(([px, py], i) => {
        const d = Math.hypot(px - x, py - y);
        if (d < best[0]) best = [d, (Math.atan2(p[i + 1][1] - py, p[i + 1][0] - px) * 180) / Math.PI];
      }));
      return best[1];
    }
    W.signs.forEach(([x, y], i) => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.018, 0.36, 8), M.darkMetal);
      post.position.copy(v3(x, y, terrainH(x, y) + 0.18)); post.castShadow = true; scene.add(post);
      signSprite("sign_" + i, x, y, terrainH(x, y) + 0.42, 0.13);
    });

    /* The map-room sand table (blender/signs.py, south-up): the same picture is the "maze" task's photo. */
    const sandTableUrl = TD.sandTable || null;
    (function guideBoard() {
      const [gx, gy] = W.guideBoard;
      if (!TD.boards.guide) return;
      const tex = loadTex(TD.boards.guide.url);
      tex.anisotropy = maxAniso;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.28), std({ map: tex, roughness: 0.4, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 }));
      face.position.copy(v3(gx, gy - 0.015, 0.24)); scene.add(face);
      boxAt(0.46, 0.32, 0.03, M.darkMetal, gx, gy, 0.08);
      boxAt(0.52, 0.03, 0.09, M.darkMetal, gx, gy, 0.4);
      [-0.2, 0.2].forEach((d) => boxAt(0.03, 0.1, 0.03, M.darkMetal, gx + d, gy, 0));
    })();

    function pavilion(x, y, base, w, d, colH, roofW, roofH, segs, walls) {
      if (walls) {
        boxAt(w + 0.6, 0.25, d + 0.6, MT.stone, x, y, base, 0, true, 1.2);
        boxAt(w * 1.1, 1.4, d * 1.1, MT.concrete_wall, x, y, base + 0.25, 0, true, 1.2);
        const glow = std({ color: 0x00e5ff, emissive: 0x00b8d4, emissiveIntensity: 2.0 });
        const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.36, 5.2, 8), MT.rust);
        spire.position.copy(v3(x, y, base + 2.8)); spire.castShadow = true; scene.add(spire);
        const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.75, 12), glow);
        beacon.position.copy(v3(x, y, base + 5.75)); scene.add(beacon);
      }
      const cols = [];
      if (walls) [-1, 1].forEach((sx) => [-1, 1].forEach((sy) => cols.push([x + sx * w / 2, y + sy * d / 2])));
      else for (let k = 0; k < segs; k++) { const a = ((k + 0.5) / segs) * 6.283; cols.push([x + Math.cos(a) * w / 2, y + Math.sin(a) * w / 2]); }
      cols.forEach(([cx, cy]) => {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, colH * 1.6, 10), MT.rust);
        c.position.copy(v3(cx, cy, base + 0.06 + (colH * 1.6) / 2)); c.castShadow = true; scene.add(c);
      });
      boxAt(roofW * 1.6, 0.18, roofW * 1.6, MT.rust, x, y, base + 0.06 + colH * 1.6, 0, true, 1.0);
    }
    pavilion(W.tea[0], W.tea[1], 0.012, 1.8, 1.4, 0.75, 1.3, 0.5, 4, true);
    signSprite("tea", W.tea[0] + 0.9, W.tea[1], 0.8, 0.2);

    const h = W.hill;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.95, TOWER_TOP, 8), MT.monolith);
    stem.position.copy(v3(h.x, h.y, h.h + TOWER_TOP / 2 - 0.05)); stem.castShadow = true; stem.receiveShadow = true; scene.add(stem);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.28, 3.8, 8), MT.rust);
    mast.position.copy(v3(h.x, h.y, h.h + TOWER_TOP + 1.9)); mast.castShadow = true; scene.add(mast);
    const topBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), std({ color: 0xffab00, emissive: 0xff6d00, emissiveIntensity: 2.2 }));
    topBeacon.position.copy(v3(h.x, h.y, h.h + TOWER_TOP + 3.95)); scene.add(topBeacon);
    const deckGeo = new THREE.CylinderGeometry(0.95, 0.95, 0.08, 16), duv = deckGeo.attributes.uv;
    const dpos = deckGeo.attributes.position, duv1 = [];
    for (let i = 0; i < duv.count; i++) {
      duv.setXY(i, duv.getX(i) * 5, duv.getY(i) * 5);
      duv1.push(...uvWorld(h.x + dpos.getX(i), h.y - dpos.getZ(i)));
    }
    deckGeo.setAttribute("uv1", new THREE.Float32BufferAttribute(duv1, 2));
    const deck = new THREE.Mesh(deckGeo, MT.wood);
    deck.position.copy(v3(h.x, h.y, h.h + TOWER_TOP - 0.025)); deck.receiveShadow = true; scene.add(deck);
    pavilion(h.x, h.y, h.h + TOWER_TOP - 0.06, 1.5, 1.5, 0.5, 1.0, 0.42, 6, false);
    [0.1, 0.055].forEach((dz, k) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.88, k ? 0.008 : 0.014, 6, 32), MT.rust);
      ring.rotation.x = Math.PI / 2;
      ring.position.copy(v3(h.x, h.y, h.h + TOWER_TOP + dz)); ring.castShadow = true; scene.add(ring);
    });
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * 6.283;
      boxAt(0.02, 0.12, 0.02, MT.rust, h.x + Math.cos(a) * 0.88, h.y + Math.sin(a) * 0.88, h.h + TOWER_TOP);
    }

    W.gates.forEach(([x, y, name]) => {
      const ns = name === "南门";
      [-0.95, 0.95].forEach((d) => boxAt(0.55, 5.2, 0.55, MT.monolith, x + (ns ? d : 0), y + (ns ? 0 : d), 0, 0, true, 1.2));
      boxAt(ns ? 2.5 : 0.65, 0.65, ns ? 0.65 : 2.5, MT.rust, x, y, 4.8, 0, true, 1.0);
      signSprite("gate_" + name, x, y, 0.7, 0.26);
    });

    // ---- outer megawall perimeter & scorched wasteland monoliths (no city apartment blocks!)
    (function outerMegawall() {
      const bnd = W.boundary.concat([W.boundary[0]]);
      const r = rng(21);
      for (let i = 0; i < bnd.length - 1; i++) {
        const [ax, ay] = bnd[i], [bx, by] = bnd[i + 1];
        const L = mathHypot(bx - ax, by - ay), n = Math.max(1, Math.round(L / 9));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
          if (W.gates.some(([gx, gy]) => Math.hypot(x - gx, y - gy) < 4.5)) continue;
          const ang = Math.atan2(by - ay, bx - ax), nx = -Math.sin(ang) * 2.2, ny = Math.cos(ang) * 2.2;
          const h = 5.4 + r() * 1.2;
          boxAt(L / n + 0.5, h, 2.6, k % 2 ? MT.monolith : MT.concrete_wall, x - nx, y - ny, 0, ang, true, 2.0);
          boxAt(L / n + 0.7, 0.25, 2.8, MT.stone, x - nx, y - ny, h, ang, true, 1.6);
        }
      }
      function mathHypot(dx, dy) { return Math.hypot(dx, dy); }
    })();

    // ---- per-frame updates
    const fwd = new THREE.Vector3(), center = new THREE.Vector3();
    function update(dt, t) {
      sky.position.copy(camera.position);
      camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() > 0) fwd.normalize();
      center.copy(camera.position).addScaledVector(fwd, 8);
      center.set(Math.round(center.x / 24) * 24, 0, Math.round(center.z / 24) * 24);
      if (!center.equals(sun.target.position) || shadowDirty) {
        sun.target.position.copy(center);
        sun.position.copy(center).addScaledVector(SUN_DIR, 90);
        sun.target.updateMatrixWorld();
        renderer.shadowMap.needsUpdate = true;
        shadowDirty = false;
      }
      waterNormal.offset.set(t * 0.012, t * 0.007);
      grass.update(camera.position, fwd, t);
      veg.update(camera.position.x, camera.position.z);
    }

    const _rot = new THREE.Matrix4(), _look = new THREE.Vector3(), _up = new THREE.Vector3(), _target = new THREE.Vector3(), _size = new THREE.Vector2();
    function updateReflection(cam) {
      cam.updateMatrixWorld();
      _rot.extractRotation(cam.matrixWorld);
      _look.set(0, 0, -1).applyMatrix4(_rot);
      _target.copy(cam.position).add(_look);
      _target.y = 2 * WATER_Y - _target.y;
      _up.set(0, 1, 0).applyMatrix4(_rot);
      _up.y = -_up.y;
      mirrorCam.position.set(cam.position.x, 2 * WATER_Y - cam.position.y, cam.position.z);
      mirrorCam.up.copy(_up);
      mirrorCam.lookAt(_target);
      mirrorCam.fov = cam.fov; mirrorCam.aspect = cam.aspect; mirrorCam.near = cam.near; mirrorCam.far = cam.far;
      mirrorCam.updateProjectionMatrix();
      mirrorCam.updateMatrixWorld();
      reflMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
      reflMatrix.multiply(mirrorCam.projectionMatrix).multiply(mirrorCam.matrixWorldInverse);
    }
    function render(cam) {
      renderer.render(scene, cam);
    }

    /* Fog thickens as visibility drops (1 = clear); `dark` also turns dusk into night. */
    const baseExposure = renderer.toneMappingExposure, skyU = sky.material.uniforms;
    const baseSky = ["top", "mid", "horizon", "below"].map((k) => [k, skyU[k].value.clone()]);
    const vis = { v: 1, dark: false };
    function setVisibility(v, dark) {
      vis.v = v; vis.dark = !!dark;
      const fogCol = new THREE.Color(dark ? 0x59606b : FOG);
      scene.fog.color.copy(fogCol);
      scene.fog.near = 30 * Math.pow(v, 2.2);
      scene.fog.far = 175 * Math.pow(v, 1.6);
      baseSky.forEach(([k, c]) => skyU[k].value.copy(c).lerp(fogCol, Math.min(1, (1 - v) * 1.3)));
      renderer.toneMappingExposure = baseExposure * (dark ? 0.62 : 1);
    }

    /* Render one picture from an arbitrary pose (the friend's photo, bench frames) without disturbing the view. */
    function snapshot(x, y, z, headingDeg, pitch, fov, w, h, mime) {
      const size = new THREE.Vector2();
      renderer.getSize(size);
      const saved = [camera.position.clone(), camera.rotation.x, camera.rotation.y, camera.fov, camera.aspect];
      if (size.x !== w || size.y !== h) renderer.setSize(w, h, false);
      camera.position.copy(v3(x, y, z));
      camera.rotation.y = rad(headingDeg - 90);
      camera.rotation.x = pitch;
      camera.fov = fov; camera.aspect = w / h; camera.updateProjectionMatrix();
      update(0, performance.now() / 1000);
      render(camera);
      const url = renderer.domElement.toDataURL(mime || "image/jpeg", 0.88);
      if (!isAI && (size.x !== w || size.y !== h)) renderer.setSize(size.x, size.y, false);
      camera.position.copy(saved[0]); camera.rotation.x = saved[1]; camera.rotation.y = saved[2];
      camera.fov = saved[3]; camera.aspect = saved[4]; camera.updateProjectionMatrix();
      return url;
    }
    /* Photoreal mode: 360-degree Blender panoramas at graph nodes (blender/park_photoreal.py, packed by blender/pack_panos.py).
       A sphere round the camera shows the panorama and writes its distance to the depth buffer; layer OVERLAY is drawn on top,
       so closures, boards, the ferry and people sit in the picture with the right occlusion. Challenge fog follows scene.fog. */
    const pano = (function panorama() {
      const col = new THREE.Texture(), dep = new THREE.Texture();
      [col, dep].forEach((t) => { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; });
      dep.magFilter = dep.minFilter = THREE.NearestFilter;
      const mat = new THREE.ShaderMaterial({
        uniforms: { col: { value: col }, dep: { value: dep }, camPos: { value: new THREE.Vector3() }, fogCol: { value: new THREE.Color() },
          fogNear: { value: 1e6 }, fogFar: { value: 2e6 }, gain: { value: 1 }, proj: { value: new THREE.Matrix4() } },
        vertexShader: "varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
        fragmentShader: [
          "uniform sampler2D col; uniform sampler2D dep; uniform vec3 camPos; uniform vec3 fogCol; uniform float fogNear; uniform float fogFar; uniform float gain;",
          "uniform mat4 proj;",
          "varying vec3 vW;",
          "void main() {",
          "  vec3 d = normalize(vW - camPos);",
          "  float az = atan(-d.z, d.x);",
          "  vec2 uv = vec2(fract(0.5 - az / 6.2831853), 0.5 + asin(clamp(d.y, -1.0, 1.0)) / 3.1415927);",
          "  vec4 dd = texture2D(dep, uv);",
          "  float dist = (floor(dd.r * 255.0 + 0.5) * 256.0 + floor(dd.g * 255.0 + 0.5)) / 100.0;",
          "  vec3 c = texture2D(col, uv).rgb * gain;",
          "  c = mix(c, fogCol, smoothstep(fogNear, fogFar, dist));",
          "  gl_FragColor = vec4(c, 1.0);",
          "  vec4 clip = proj * viewMatrix * vec4(camPos + d * dist, 1.0);",
          "  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);",
          "}"].join("\n"),
        side: THREE.BackSide, depthTest: true, depthFunc: THREE.AlwaysDepth, depthWrite: true,
      });
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(50, 96, 48), mat);
      sphere.frustumCulled = false;
      const pscene = new THREE.Scene();
      pscene.add(sphere);
      scene.traverse((o) => { if (o.isLight) o.layers.enable(OVERLAY); });
      const imgs = new Map();
      let cur = -1;
      const img = (url) => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
      function load(nodes, url) {
        return Promise.all(nodes.map((n) => Promise.all([img(url(n, ".jpg")), img(url(n, "_d.png"))])
          .then(([c, d]) => imgs.set(n, [c, d])).catch(() => null)));
      }
      function use(n) {
        if (cur === n) return true;
        const p = imgs.get(n);
        if (!p) return false;
        col.image = p[0]; dep.image = p[1]; col.needsUpdate = dep.needsUpdate = true; cur = n;
        return true;
      }
      /* Draw node n's panorama for camera cam (already posed at the node's eye point), then the overlays. */
      function draw(cam, n) {
        if (!use(n)) return false;
        cam.updateMatrixWorld();
        sphere.position.copy(cam.position); mat.uniforms.camPos.value.copy(cam.position);
        mat.uniforms.proj.value.copy(cam.projectionMatrix);
        const fogged = vis.v < 0.999;
        mat.uniforms.fogNear.value = fogged ? scene.fog.near : 1e6;
        mat.uniforms.fogFar.value = fogged ? scene.fog.far : 2e6;
        mat.uniforms.fogCol.value.copy(scene.fog.color).convertLinearToSRGB();
        mat.uniforms.gain.value = vis.dark ? 0.62 : 1;
        const auto = renderer.autoClear;
        renderer.autoClear = false;
        renderer.clear();
        renderer.render(pscene, cam);
        cam.layers.set(OVERLAY);
        renderer.render(scene, cam);
        cam.layers.set(0);
        renderer.autoClear = auto;
        return true;
      }
      function shot(n, x, y, z, headingDeg, pitch, fov, w, h, mime) {
        const size = new THREE.Vector2();
        renderer.getSize(size);
        const saved = [camera.position.clone(), camera.rotation.x, camera.rotation.y, camera.fov, camera.aspect];
        renderer.setSize(w, h, false);
        camera.position.copy(v3(x, y, z));
        camera.rotation.y = rad(headingDeg - 90);
        camera.rotation.x = pitch;
        camera.fov = fov; camera.aspect = w / h; camera.updateProjectionMatrix();
        const ok = draw(camera, n);
        const url = ok ? renderer.domElement.toDataURL(mime || "image/jpeg", 0.88) : null;
        renderer.setSize(size.x, size.y, false);
        camera.position.copy(saved[0]); camera.rotation.x = saved[1]; camera.rotation.y = saved[2];
        camera.fov = saved[3]; camera.aspect = saved[4]; camera.updateProjectionMatrix();
        return url;
      }
      return { load: () => Promise.resolve(), has: () => false, draw, shot };
    })();
    if (!pending) readyDone();
    return { renderer, scene, camera, update, render, ready, boat, setClosed, setVisibility, snapshot, friend, chest, pano, sandTablePhoto: () => sandTableUrl };
  };
})();
