/* 雾岭疗养院 · rendering engine: renderer, HDR post (bloom, grade, grain, vignette), PBR material library from the
   CC0 texture sets, night sky, fog, and a small pool of point lights handed to whichever practical lights are near.
   World coordinates are metres east (x), north (y), up (z); three.js uses (x, z, -y). */
(function () {
  "use strict";
  const S = (window.SANA = window.SANA || {});
  const E = (S.Engine = {});
  const TEXDIR = "game/tex/";

  /* ---------------------------------------------------------------- material library */
  // set: Poly Haven texture set, m: metres per texture repeat, tint: albedo multiplier (sRGB hex), rough: roughness scale
  const DEF = {
    lino: { set: "old_linoleum_flooring_01", m: 2.6, tint: 0xc9b9a0 },
    terrazzo: { set: "terrazzo_tiles", m: 2.2, tint: 0xcfc8bd, rough: 0.75 },
    terrazzo_dark: { set: "terrazzo_tiles", m: 1.4, tint: 0x8d8780, rough: 0.8 },
    wood: { set: "old_wood_floor", m: 2.2, tint: 0xb9a48c },
    gallery: { set: "old_wood_floor", m: 2.2, tint: 0xa8957f },
    plank: { set: "dark_wooden_planks", m: 2.6, tint: 0xb8a28a },
    concrete: { set: "chipped_concrete", m: 3.2, tint: 0xb3ada5 },
    burnt: { set: "chipped_concrete", m: 2.6, tint: 0x3b3431, rough: 1.0 },
    paving: { set: "rectangular_paving", m: 2.6, tint: 0xa9a49b },
    balcony: { set: "dirty_tiles", m: 2.0, tint: 0xb9b0a1 },
    cobble: { set: "mossy_cobblestone", m: 2.8, tint: 0xa8a59a },
    grass: { set: "withered_grass", m: 3.2, tint: 0x8f8a74 },
    leaves: { set: "forest_leaves_02", m: 3.6, tint: 0x8e8070 },
    gravel: { set: "gravel_floor", m: 2.6, tint: 0xa19d95 },
    path: { set: "stony_dirt_path", m: 3.0, tint: 0x9f978b },
    metal: { set: "metal_plate", m: 1.6, tint: 0x9aa0a4, metal: 0.55, rough: 0.8 },
    tile_floor: { set: "dirty_tiles", m: 1.6, tint: 0xcfc6b8 },
    carpet: { set: "withered_grass", m: 1.2, tint: 0x5a2a26, rough: 1.0 },
    dado_green: { set: "peeling_painted_wall", m: 2.2, tint: 0x5b7a62 },
    dado_room: { set: "peeling_painted_wall", m: 2.2, tint: 0x6b8a78 },
    dado_teal: { set: "peeling_painted_wall", m: 2.4, tint: 0x557a78 },
    plaster_cream: { set: "damaged_plaster", m: 2.0, tint: 0xd2c8ae },
    plaster_room: { set: "damaged_plaster", m: 2.0, tint: 0xc4bda9 },
    plaster_new: { set: "painted_plaster_wall", m: 2.6, tint: 0xc9c7bd },
    paint_new_lo: { set: "painted_plaster_wall", m: 2.6, tint: 0x6f8790 },
    plaster_stair: { set: "painted_plaster_wall", m: 2.6, tint: 0x9a968c },
    block_painted: { set: "concrete_block_wall", m: 2.4, tint: 0x8f8d86 },
    ext: { set: "worn_mossy_plasterwall", m: 3.6, tint: 0x9d978a },
    ext_light: { set: "worn_mossy_plasterwall", m: 3.6, tint: 0xb3ad9f },
    ext_new: { set: "painted_plaster_wall", m: 3.0, tint: 0x7d7f80 },
    tile: { set: "long_white_tiles", m: 1.2, tint: 0xd2d4cf, rough: 0.55 },
    block: { set: "concrete_block_wall", m: 2.4, tint: 0x9c968c },
    stone: { set: "mossy_stone_wall", m: 3.2, tint: 0x9a968c },
    chapel_lo: { set: "mossy_stone_wall", m: 2.6, tint: 0x8c8880 },
    chapel_hi: { set: "damaged_plaster", m: 3.0, tint: 0xbdb4a0 },
    lead: { set: "metal_plate", m: 1.4, tint: 0x5c6670, metal: 0.4, rough: 0.7 },
    ceiling: { set: "ceiling_interior", m: 2.6, tint: 0xa9a59c },
    ceiling_tiles: { set: "ceiling_interior", m: 1.2, tint: 0xb3b0a8 },
    beams: { set: "dark_wooden_planks", m: 2.4, tint: 0x8f7c6a },
    roof_slate: { set: "red_slate_roof_tiles_01", m: 2.2, tint: 0x7d7c80 },
    roof_flat: { set: "gravel_floor", m: 3.0, tint: 0x6d6a66 },
    roof_metal: { set: "rusty_metal", m: 2.0, tint: 0x8d7a6a, metal: 0.4 },
    column: { set: "painted_plaster_wall", m: 2.4, tint: 0xb8b2a4 },
    brick: { set: "concrete_block_wall", m: 1.6, tint: 0x8a6250 },
    rust: { set: "rusty_metal", m: 1.0, tint: 0x6f5e54, metal: 0.5 },
    skirting: { color: 0x2f2a25, rough: 0.6 },
    dado_rail: { color: 0x3a3128, rough: 0.55 },
    frame_wood: { set: "dark_wooden_planks", m: 1.0, tint: 0x7a6656 },
    door_wood: { set: "old_wood_floor", m: 1.6, tint: 0x8c7f6c },
    door_green: { set: "peeling_painted_wall", m: 1.6, tint: 0x4f6a5c },
    iron: { color: 0x26282a, rough: 0.55, metal: 0.8 },
    glass: { color: 0x9fb4c0, rough: 0.05, metal: 0.0, transparent: true, opacity: 0.16 },
    void: { color: 0x000000, rough: 1.0 },
  };
  // wall schemes: one side of a wall, split at a dado height
  const SCHEME = {
    ward: { lo: "dado_green", hi: "plaster_cream", dado: 1.25, base: true },
    room: { lo: "dado_room", hi: "plaster_room", dado: 1.25, base: true },
    rot: { lo: "dado_teal", hi: "plaster_cream", dado: 1.5, base: true },
    stair: { hi: "plaster_stair", base: true },
    plaster: { hi: "plaster_new", base: true },
    plaster_new: { lo: "paint_new_lo", hi: "plaster_new", dado: 1.0, base: true },
    room_new: { lo: "paint_new_lo", hi: "plaster_new", dado: 1.0, base: true },
    stair_new: { hi: "block_painted" },
    ext: { hi: "ext" }, balc: { hi: "ext_light" }, court: { hi: "ext" }, ext_new: { hi: "ext_new" },
    tile: { hi: "tile" }, lead: { lo: "lead", hi: "plaster_new", dado: 2.0 }, chapel: { lo: "chapel_lo", hi: "chapel_hi", dado: 1.0 },
    stone: { hi: "stone" }, block: { hi: "block" }, brick_ext: { hi: "block" }, metal: { hi: "metal" }, brick: { hi: "brick" },
    burnt: { hi: "burnt" },
  };
  E.SCHEME = SCHEME;

  let renderer, scene, camera, loader, aniso = 8;
  const texCache = {}, matCache = {};
  let pending = 0, loadedCount = 0, onProgress = null, itemsTotal = 0;
  const manager = new THREE.LoadingManager();
  manager.onStart = (url, a, b) => { itemsTotal = Math.max(itemsTotal, b); };
  manager.onProgress = (url, a, b) => { loadedCount = a; itemsTotal = b; if (onProgress) onProgress(a, b); };

  function tex(file, srgb, repeat) {
    const key = file + "|" + repeat;
    if (texCache[key]) return texCache[key];
    let base = texCache[file];
    if (!base) {
      base = loader.load(TEXDIR + file);
      base.wrapS = base.wrapT = THREE.RepeatWrapping;
      base.anisotropy = aniso;
      base.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texCache[file] = base;
    }
    const t = repeat === 1 ? base : base.clone();
    t.repeat.set(repeat, repeat);
    texCache[key] = t;
    return t;
  }
  E.tex = tex;

  E.mat = function (name, opts) {
    const key = name + (opts ? JSON.stringify(opts) : "");
    if (matCache[key]) return matCache[key];
    const d = Object.assign({}, DEF[name] || { color: 0x808080 }, opts || {});
    const o = { roughness: d.rough !== undefined ? d.rough : 1.0, metalness: d.metal || 0 };
    if (d.set) {
      const rep = 1 / d.m;
      o.map = tex(d.set + "_d.jpg", true, rep);
      o.normalMap = tex(d.set + "_n.jpg", false, rep);
      o.roughnessMap = tex(d.set + "_r.jpg", false, rep);
      o.normalScale = new THREE.Vector2(1, -1).multiplyScalar(d.ns || 1.0);
      o.color = new THREE.Color(d.tint || 0xffffff);
    } else {
      o.color = new THREE.Color(d.color);
    }
    if (d.transparent) Object.assign(o, { transparent: true, opacity: d.opacity, depthWrite: false });
    if (d.emissive) Object.assign(o, { emissive: new THREE.Color(d.emissive), emissiveIntensity: d.ei || 1 });
    if (d.vc) o.vertexColors = true;
    if (d.side) o.side = d.side;
    const m = new THREE.MeshStandardMaterial(o);
    m.name = name;
    matCache[key] = m;
    return m;
  };
  E.basic = function (color, intensity) {
    const key = "emit|" + color + "|" + intensity;
    if (!matCache[key]) {
      matCache[key] = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(color), emissiveIntensity: intensity, roughness: 1 });
    }
    return matCache[key];
  };

  /* ---------------------------------------------------------------- canvas textures */
  E.canvasTex = function (w, h, draw, srgb) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    return t;
  };

  /* ---------------------------------------------------------------- sky */
  function skyTexture() {
    return E.canvasTex(1024, 512, (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0.0, "#04060b");
      grad.addColorStop(0.35, "#0a101b");
      grad.addColorStop(0.5, "#1a2433");
      grad.addColorStop(0.53, "#202a36");
      grad.addColorStop(1.0, "#0b0d10");
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
      let s = 9;
      const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
      for (let i = 0; i < 900; i++) {
        const y = rnd() * h * 0.46, a = rnd() * 0.5 * (1 - y / (h * 0.46));
        g.fillStyle = `rgba(210,220,255,${a})`; g.fillRect(rnd() * w, y, 1, 1);
      }
      for (let i = 0; i < 70; i++) {
        const x = rnd() * w, y = h * (0.2 + rnd() * 0.3), r = 40 + rnd() * 140;
        const cg = g.createRadialGradient(x, y, 0, x, y, r);
        cg.addColorStop(0, "rgba(60,70,90,0.18)"); cg.addColorStop(1, "rgba(60,70,90,0)");
        g.fillStyle = cg; g.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
    });
  }

  /* ---------------------------------------------------------------- post-processing */
  const QUAD = new THREE.PlaneGeometry(2, 2);
  const ORTHO = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  function pass(frag, uniforms) {
    const m = new THREE.ShaderMaterial({
      uniforms, depthTest: false, depthWrite: false,
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: frag,
    });
    const sc = new THREE.Scene();
    sc.add(new THREE.Mesh(QUAD, m));
    return { m, sc };
  }
  const BRIGHT = `uniform sampler2D tSrc; uniform float uThr; varying vec2 vUv;
    void main(){ vec3 c = texture2D(tSrc, vUv).rgb; float l = max(max(c.r,c.g),c.b);
      gl_FragColor = vec4(c * smoothstep(uThr, uThr * 2.5, l), 1.0); }`;
  const BLUR = `uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
    void main(){ vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270;
      c += texture2D(tSrc, vUv + uDir * 1.3846154).rgb * 0.3162162; c += texture2D(tSrc, vUv - uDir * 1.3846154).rgb * 0.3162162;
      c += texture2D(tSrc, vUv + uDir * 3.2307692).rgb * 0.0702703; c += texture2D(tSrc, vUv - uDir * 3.2307692).rgb * 0.0702703;
      gl_FragColor = vec4(c, 1.0); }`;
  const FINAL = `uniform sampler2D tScene, tB1, tB2, tB3; uniform float uExposure, uBloom, uTime, uVig, uGrain, uCA, uFear, uDesat, uFade, uRed;
    varying vec2 vUv;
    vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
    void main(){
      vec2 d = vUv - 0.5; float r2 = dot(d, d);
      float ca = uCA * (1.0 + uFear * 2.5) * r2;
      vec3 col;
      col.r = texture2D(tScene, vUv - d * ca).r; col.g = texture2D(tScene, vUv).g; col.b = texture2D(tScene, vUv + d * ca).b;
      vec3 bl = texture2D(tB1, vUv).rgb * 0.5 + texture2D(tB2, vUv).rgb * 0.8 + texture2D(tB3, vUv).rgb * 1.2;
      col += bl * uBloom;
      col *= uExposure;
      col = aces(col);
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l), uDesat);
      col = mix(col, col * vec3(0.92, 0.98, 1.08), 0.6);
      col = pow(col, vec3(1.04));
      col.r += uRed * 0.25 * (0.5 + 0.5 * sin(uTime * 7.0)) * r2 * 3.0;
      float vig = smoothstep(0.85, 0.15, r2 * (uVig + uFear * 1.2));
      col *= mix(0.25, 1.0, vig);
      vec3 s = toSRGB(clamp(col, 0.0, 1.0));
      float n = hash(vUv * vec2(1931.0, 1173.0) + fract(uTime * 13.7)) - 0.5;
      s += n * uGrain * (1.15 - l);
      s *= 1.0 - uFade;
      gl_FragColor = vec4(s, 1.0);
    }`;

  let rtScene, rtB, P = {};
  function makeTargets(w, h) {
    const opt = { type: THREE.HalfFloatType, depthBuffer: false };
    rtScene = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: E.quality.msaa });
    rtB = [2, 4, 8].map((k) => [new THREE.WebGLRenderTarget(Math.max(1, w / k | 0), Math.max(1, h / k | 0), opt),
      new THREE.WebGLRenderTarget(Math.max(1, w / k | 0), Math.max(1, h / k | 0), opt)]);
  }
  E.post = { exposure: 1.0, bloom: 0.55, vig: 1.0, grain: 0.06, ca: 0.012, fear: 0, desat: 0.12, fade: 0, red: 0, thr: 1.1 };

  /* ---------------------------------------------------------------- init */
  E.quality = { scale: 1.0, shadows: true, msaa: 4, lanternShadow: false };
  E.init = function (container, q) {
    Object.assign(E.quality, q || {});
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * E.quality.scale);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = E.quality.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    container.appendChild(renderer.domElement);
    aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    loader = new THREE.TextureLoader(manager);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 420);
    camera.rotation.order = "YXZ";
    scene.add(camera);
    const sky = skyTexture();
    sky.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = new THREE.Color(0x05070b);
    const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(400, 48, 24),
      new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide, fog: false, depthWrite: false }));
    skyMesh.renderOrder = -10;
    scene.add(skyMesh);
    E.skyMesh = skyMesh;
    const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(9, 32), new THREE.MeshBasicMaterial({ color: 0xdfe6ff, fog: false }));
    E.moonDisc = moonDisc;
    scene.add(moonDisc);
    const pm = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide })));
    scene.environment = pm.fromScene(envScene, 0.04).texture;
    scene.fog = new THREE.FogExp2(0x111821, 0.05);
    // lights
    E.hemi = new THREE.HemisphereLight(0x4a5c7c, 0x14110e, 0.85);
    scene.add(E.hemi);
    const moon = new THREE.DirectionalLight(0x9db8ff, 1.5);
    moon.userData.dir = new THREE.Vector3(-0.55, 0.62, -0.56).normalize();
    moon.castShadow = E.quality.shadows;
    moon.shadow.mapSize.set(2048, 2048);
    const sc = moon.shadow.camera;
    sc.left = -42; sc.right = 42; sc.top = 42; sc.bottom = -42; sc.near = 1; sc.far = 260;
    moon.shadow.bias = -0.0006;
    moon.shadow.normalBias = 0.04;
    scene.add(moon, moon.target);
    E.moon = moon;
    E.pool = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      scene.add(l);
      E.pool.push(l);
    }
    // post
    const w = renderer.domElement.width, h = renderer.domElement.height;
    makeTargets(w, h);
    P.bright = pass(BRIGHT, { tSrc: { value: null }, uThr: { value: 1.0 } });
    P.blur = pass(BLUR, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    P.down = pass("uniform sampler2D tSrc; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tSrc, vUv); }", { tSrc: { value: null } });
    P.final = pass(FINAL, {
      tScene: { value: null }, tB1: { value: null }, tB2: { value: null }, tB3: { value: null }, uExposure: { value: 1 },
      uBloom: { value: 0.5 }, uTime: { value: 0 }, uVig: { value: 1 }, uGrain: { value: 0.05 }, uCA: { value: 0.01 },
      uFear: { value: 0 }, uDesat: { value: 0 }, uFade: { value: 0 }, uRed: { value: 0 },
    });
    window.addEventListener("resize", E.resize);
    return { renderer, scene, camera };
  };
  E.resize = function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    rtScene.dispose(); rtB.forEach((p) => p.forEach((t) => t.dispose()));
    makeTargets(renderer.domElement.width, renderer.domElement.height);
  };
  E.onProgress = (fn) => { onProgress = fn; };
  E.manager = manager;
  // textures stream in after the level is built; resolves once every texture requested so far has arrived
  E.texturesReady = (timeout) => new Promise((resolve) => {
    const t0 = performance.now();
    const check = () => (loadedCount >= itemsTotal || performance.now() - t0 > (timeout || 60000) ? resolve() : setTimeout(check, 100));
    check();
  });

  /* ---------------------------------------------------------------- per-frame */
  let practical = [];
  E.setPractical = (list) => { practical = list; };
  E.updateLights = function (px, py, pz, t) {
    // the moon's shadow box follows the player
    const m = E.moon, c = new THREE.Vector3(px, pz, -py);
    m.target.position.copy(c);
    m.position.copy(c).addScaledVector(m.userData.dir, 120);
    m.target.updateMatrixWorld();
    E.moonDisc.position.copy(camera.position).addScaledVector(m.userData.dir, 380);
    E.moonDisc.lookAt(camera.position);
    E.skyMesh.position.copy(camera.position);
    // nearest practical lights get the pool
    const cand = [];
    for (const L of practical) {
      if (!L.on) continue;
      const dx = L.p[0] - px, dy = L.p[1] - py, dz = (L.p[2] - pz) * 2.0;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 900) cand.push([d2, L]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < E.pool.length; i++) {
      const l = E.pool[i], it = cand[i];
      if (!it) { l.intensity = 0; continue; }
      const L = it[1];
      l.position.set(L.p[0], L.p[2], -L.p[1]);
      l.color.setRGB(L.c[0], L.c[1], L.c[2]);
      l.distance = L.d * 1.6;
      let f = 1;
      if (L.f > 0) {
        const n = Math.sin(t * 13.0 + L.seed) * 0.5 + Math.sin(t * 31.7 + L.seed * 3.1) * 0.3 + Math.sin(t * 2.3 + L.seed) * 0.2;
        f = 1 - L.f * 0.5 * (0.5 + 0.5 * n);
        if (L.k === "fluor" && Math.sin(t * 1.7 + L.seed) > 0.93) f *= 0.05;
      }
      l.intensity = L.i * f * 1.4;
      if (L.mesh) L.mesh.material.emissiveIntensity = L.glow * f;
    }
  };

  E.render = function (t) {
    renderer.setRenderTarget(rtScene);
    renderer.render(scene, camera);
    const pp = E.post;
    P.bright.m.uniforms.tSrc.value = rtScene.texture;
    P.bright.m.uniforms.uThr.value = pp.thr;
    renderer.setRenderTarget(rtB[0][0]); renderer.render(P.bright.sc, ORTHO);
    for (let k = 0; k < 3; k++) {
      const [a, b] = rtB[k];
      if (k > 0) {
        P.down.m.uniforms.tSrc.value = rtB[k - 1][0].texture;
        renderer.setRenderTarget(a); renderer.render(P.down.sc, ORTHO);
      }
      for (let it = 0; it < 2; it++) {
        P.blur.m.uniforms.tSrc.value = a.texture; P.blur.m.uniforms.uDir.value.set(1 / a.width, 0);
        renderer.setRenderTarget(b); renderer.render(P.blur.sc, ORTHO);
        P.blur.m.uniforms.tSrc.value = b.texture; P.blur.m.uniforms.uDir.value.set(0, 1 / a.height);
        renderer.setRenderTarget(a); renderer.render(P.blur.sc, ORTHO);
      }
    }
    const u = P.final.m.uniforms;
    u.tScene.value = rtScene.texture; u.tB1.value = rtB[0][0].texture; u.tB2.value = rtB[1][0].texture; u.tB3.value = rtB[2][0].texture;
    u.uExposure.value = pp.exposure; u.uBloom.value = pp.bloom; u.uTime.value = t; u.uVig.value = pp.vig; u.uGrain.value = pp.grain;
    u.uCA.value = pp.ca; u.uFear.value = pp.fear; u.uDesat.value = pp.desat; u.uFade.value = pp.fade; u.uRed.value = pp.red;
    renderer.setRenderTarget(null);
    renderer.render(P.final.sc, ORTHO);
  };
  E.get = () => ({ renderer, scene, camera });
})();
