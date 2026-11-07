/* Space Track homepage: the five worlds as 3D models you can turn in the hand (drag to orbit, wheel or pinch to zoom,
   right-drag or two fingers to pan). Each model is the scene's own geometry, exported by bench/home_models.js, shown on a
   transparent canvas over the page with a soft shadow under it.

     SAModel3D.mount(element, { src: "models3d/park.glb", world: "park" })   // also: still (no spin), onReady; returns { pause(on) }

   three.js and GLTFLoader are loaded from vendor/ the first time a model is opened, unless the page already has them. */
(function () {
  "use strict";

  /* az / el: starting orbit in degrees; zoom: distance as a fraction of the framing distance; tone and exposure as in the
     scene's own page; lights "scene" uses the lights stored with the model (baked light maps were made for those);
     groundY: where the shadow catcher sits (default: under the lowest point); clip: [x0, z0, x1, z1] trims the model to a
     box, so terrain ends in a clean edge; cut: a slider that slices the building from the top down; ground: false leaves out the
     shadow catcher (a clipped hillside catches its own shadows, and the catcher would show the clipped-off ones). */
  /* cardZoom replaces zoom on the homepage, where the model sits between two columns of text. */
  const PRESETS = {
    park: { az: 205, el: 42, zoom: 0.78, cardZoom: 0.9, tone: "agx", exposure: 1.0 },
    course: { az: 145, el: 33, zoom: 0.68, cardZoom: 0.95, tone: "agx", exposure: 0.95 },
    loop: { az: 35, el: 52, zoom: 0.78, cardZoom: 0.95, tone: "agx", exposure: 1.2, groundY: -0.05 },
    sana: { az: 30, el: 36, zoom: 0.7, cardZoom: 0.8, tone: "agx", exposure: 1.1, cut: true, clip: [-116, -82, 62, 88], ground: false },
    renovate: { az: 20, el: 56, zoom: 0.92, cardZoom: 1.08, tone: "agx", exposure: 1.5, lights: "scene" },
    detective: { az: 28, el: 52, zoom: 0.68, cardZoom: 1.05, tone: "agx", exposure: 1.0, clip: [-4.4, -5.7, 4.7, 5.4] },
  };
  const D2R = Math.PI / 180;
  const EL_MIN = 4 * D2R, EL_MAX = 88 * D2R;

  let threeReady = null, lastScrollTime = 0, scrollResumeTimer = 0;
  const activeKicks = new Set();
  window.addEventListener("scroll", () => {
    lastScrollTime = performance.now();
    clearTimeout(scrollResumeTimer);
    scrollResumeTimer = setTimeout(() => { activeKicks.forEach((fn) => fn()); }, 120);
  }, { passive: true });
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = () => rej(new Error("failed to load " + src));
      document.head.appendChild(s);
    });
  }
  function ensureThree(base) {
    if (window.THREE && window.THREE.GLTFLoader && window.MeshoptDecoder) return Promise.resolve();
    if (!threeReady) {
      threeReady = (window.THREE ? Promise.resolve() : loadScript(base + "vendor/three.min.js"))
        .then(() => Promise.all([window.THREE.GLTFLoader ? null : loadScript(base + "vendor/GLTFLoader.js"),
          window.MeshoptDecoder ? null : loadScript(base + "vendor/meshopt_decoder.js")]));
    }
    return threeReady;
  }

  /* three's RoomEnvironment (examples/jsm/environments), for soft reflections on the glossy materials. */
  function roomEnvironment(T, renderer) {
    const scene = new T.Scene(), geo = new T.BoxGeometry();
    geo.deleteAttribute("uv");
    const room = new T.MeshStandardMaterial({ side: T.BackSide }), boxMat = new T.MeshStandardMaterial();
    const light = new T.PointLight(0xffffff, 900, 28, 2);
    light.position.set(0.418, 16.199, 0.3);
    scene.add(light);
    const add = (mat, p, s, ry) => { const m = new T.Mesh(geo, mat); m.position.set(...p); m.scale.set(...s); if (ry) m.rotation.y = ry; scene.add(m); };
    add(room, [-0.757, 13.219, 0.717], [31.713, 28.305, 28.591]);
    add(boxMat, [-10.906, 2.009, 1.846], [2.328, 7.905, 4.651], -0.195);
    add(boxMat, [-5.607, -0.754, -0.758], [1.97, 1.534, 3.955], 0.994);
    add(boxMat, [6.167, 0.857, 7.803], [3.927, 6.285, 3.687], 0.561);
    add(boxMat, [-2.017, 0.018, 6.124], [2.002, 4.566, 2.064], 0.333);
    add(boxMat, [2.291, -0.756, -2.621], [1.546, 1.552, 1.496], -0.286);
    add(boxMat, [-2.193, -0.369, -5.547], [3.875, 3.487, 2.986], 0.516);
    const area = (k) => { const m = new T.MeshBasicMaterial(); m.color.setScalar(k); return m; };
    add(area(50), [-16.116, 14.37, 8.208], [0.1, 2.428, 2.739]);
    add(area(50), [-16.109, 18.021, -8.207], [0.1, 2.425, 2.751]);
    add(area(17), [14.904, 12.198, -1.832], [0.15, 4.265, 6.331]);
    add(area(43), [-0.462, 8.89, 14.52], [4.38, 5.441, 0.088]);
    add(area(20), [3.235, 11.486, -12.541], [2.5, 2.0, 0.1]);
    add(area(100), [0, 20, 0], [1, 0.1, 1]);
    const pm = new T.PMREMGenerator(renderer), tex = pm.fromScene(scene, 0.04).texture;
    pm.dispose();
    scene.traverse((o) => { if (o.isMesh) o.material.dispose(); });
    geo.dispose();
    return tex;
  }

  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; }
  const bi = (en, zh) => `<span class="en">${en}</span><span class="zh">${zh}</span>`;

  function mount(host, opt) {
    const preset = Object.assign({ az: 30, el: 40, zoom: 0.9, tone: "aces", exposure: 1 }, PRESETS[opt.world] || {}, opt.preset || {});
    if (opt.card && preset.cardZoom) preset.zoom = preset.cardZoom;
    const base = opt.base || "";
    host.classList.add("m3d");
    const load = el("div", "m3d-load", bi("Loading the model…", "正在加载模型…"));
    const touch = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    const hint = el("div", "m3d-hint", touch ? bi("Drag to turn · two fingers to zoom and pan · double-tap to look closer", "拖动旋转 · 双指缩放平移 · 双击看细节")
      : bi("Drag to turn · scroll to zoom · right-drag to pan · double-click to look closer", "拖动旋转 · 滚轮缩放 · 右键平移 · 双击看细节"));
    const ui = el("div", "m3d-ui");
    const top = el("button", "m3d-text", bi("Top view", "俯视")), zin = el("button", "", "+"), zout = el("button", "", "−");
    const reset = el("button", "m3d-text", bi("Reset", "复位"));
    top.type = zin.type = zout.type = reset.type = "button";
    zin.setAttribute("aria-label", "Zoom in"); zout.setAttribute("aria-label", "Zoom out");
    ui.append(top, zin, zout, reset);
    host.append(load, hint, ui);
    let cutBox = null, cutInput = null;
    if (preset.cut) {
      cutBox = el("label", "m3d-cut", bi("Cut height", "剖切高度"));
      cutInput = el("input");
      cutInput.type = "range"; cutInput.min = "0"; cutInput.max = "1000"; cutInput.value = "1000";
      cutBox.appendChild(cutInput);
      host.appendChild(cutBox);
    }

    const state = { alive: true, visible: false, paused: false, ready: false, dirty: true, raf: 0, last: 0, lastRender: 0, lastInteract: 0, idle: 0, engaged: false, auto: !opt.still,
      introUntil: 0, scrollAz: 0, scrollAzCur: 0 };
    const api = { dispose, host, pause(on) { state.paused = !!on; if (!on && api.kick) { state.last = 0; api.kick(); } } };

    ensureThree(base).then(() => {
      if (!state.alive) return;
      const T = window.THREE;
      const canvas = el("canvas", "m3d-canvas");
      host.insertBefore(canvas, host.firstChild);
      const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = preset.tone === "agx" ? T.AgXToneMapping : T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = preset.exposure;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFShadowMap;
      renderer.shadowMap.autoUpdate = false;
      renderer.localClippingEnabled = !!(preset.cut || preset.clip);
      const scene = new T.Scene(), camera = new T.PerspectiveCamera(32, 1, 0.1, 2000);
      const env = roomEnvironment(T, renderer);
      const cur = { az: preset.az * D2R, el: preset.el * D2R, dist: 10, target: new T.Vector3() };
      const goal = { az: cur.az, el: cur.el, dist: 10, target: new T.Vector3() };
      const home = { az: cur.az, el: cur.el, dist: 10, target: new T.Vector3() };
      let minDist = 1, maxDist = 100, radius = 10, plane = null, cutRange = [0, 1], model = null;
      Object.assign(api, { renderer, scene, camera, cur, goal });

      // the framing fits the model's height; on a canvas narrower than 5:4 it backs off so that the width fits too
      const fit = () => (radius / Math.sin(camera.fov * 0.5 * D2R)) * preset.zoom * Math.max(1, Math.pow(1.25 / camera.aspect, 0.9));
      function resize() {
        const w = host.clientWidth, h = host.clientHeight;
        if (!w || !h) return;
        const maxDpr = opt.world === "sana" || opt.world === "park" ? 1.15 : 1.35;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        if (state.ready && !state.touched) { home.dist = goal.dist = cur.dist = fit(); maxDist = home.dist * 2.4; }
        state.dirty = true;
        kick();
      }
      new ResizeObserver(resize).observe(host);

      function place() {
        const c = Math.cos(cur.el), az = cur.az + state.scrollAzCur;
        camera.position.set(cur.target.x + cur.dist * c * Math.sin(az), cur.target.y + cur.dist * Math.sin(cur.el), cur.target.z + cur.dist * c * Math.cos(az));
        camera.lookAt(cur.target);
      }

      // ---- a run traced on the model: a tube that grows with the video, a marker with a view cone at the current frame
      const trail = { group: null, tube: null, total: 0, marker: null, pts: null, n: 0, frame: -1 };
      function clearPath() {
        if (!trail.group) return;
        scene.remove(trail.group);
        trail.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        trail.group = trail.tube = trail.marker = trail.pts = null;
      }
      function showPath(path) {
        clearPath();
        if (!path || !path.pts || path.pts.length < 6 || !state.ready) return;
        const raw = path.pts, n = raw.length / 3, lift = path.lift || 0;
        const pts = [];
        for (let i = 0; i < n; i++) pts.push(new T.Vector3(raw[i * 3], raw[i * 3 + 1] + lift, raw[i * 3 + 2]));
        // the curve runs through distinct points only (the agent stands still while it turns or works, and repeated points
        // break the curve); each frame keeps the fraction of the route walked by then, for the visible length of the tube
        const uniq = [pts[0]], walked = new Float32Array(n);
        let len = 0;
        for (let i = 1; i < n; i++) {
          const d = pts[i].distanceTo(uniq[uniq.length - 1]);
          if (d > 0.02) { len += d; uniq.push(pts[i]); }
          walked[i] = len;
        }
        if (uniq.length < 2) return;
        for (let i = 0; i < n; i++) walked[i] /= len;
        const g = new T.Group(), r = Math.max(radius * 0.011, 0.06);
        const curve = new T.CatmullRomCurve3(uniq, false, "catmullrom", 0.2);
        const segs = Math.min(1600, Math.max(64, uniq.length * 3)), radial = 8;
        const geo = new T.TubeGeometry(curve, segs, r, radial, false);
        const cols = new Float32Array(geo.attributes.position.count * 3), a = new T.Color("#e0338a"), b = new T.Color("#35c9e8"), m = new T.Color("#b55bd0"), c = new T.Color();
        for (let i = 0; i < geo.attributes.position.count; i++) {
          const u = Math.floor(i / (radial + 1)) / segs;
          if (u < 0.45) c.copy(a).lerp(m, u / 0.45); else c.copy(m).lerp(b, (u - 0.45) / 0.55);
          c.toArray(cols, i * 3);
        }
        geo.setAttribute("color", new T.BufferAttribute(cols, 3));
        const tube = new T.Mesh(geo, new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
        tube.renderOrder = 5;
        // the whole route stays faintly visible; the coloured tube is the part already walked. Both also show through
        // walls and roofs, faintly (the sanatorium's routes run indoors, under its roofs).
        const ghostGeo = new T.TubeGeometry(curve, segs, r * 0.7, radial, false);
        const ghost = new T.Mesh(ghostGeo, new T.MeshBasicMaterial({ color: 0x1d1d1f, transparent: true, opacity: 0.16, depthWrite: false }));
        const ghostX = new T.Mesh(ghostGeo, new T.MeshBasicMaterial({ color: 0x1d1d1f, transparent: true, opacity: 0.1, depthWrite: false, depthTest: false }));
        const tubeX = new T.Mesh(geo, new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, opacity: 0.4, depthWrite: false, depthTest: false }));
        ghostX.renderOrder = 6; tubeX.renderOrder = 7;
        g.add(ghost, tube, ghostX, tubeX);
        const start = new T.Mesh(new T.TorusGeometry(r * 3.2, r * 0.7, 10, 32), new T.MeshBasicMaterial({ color: 0x1d1d1f }));
        start.rotation.x = Math.PI / 2; start.position.copy(pts[0]);
        g.add(start);
        const marker = new T.Group();
        const ball = new T.Mesh(new T.SphereGeometry(r * 1.9, 20, 14), new T.MeshBasicMaterial({ color: 0xffffff }));
        const rim = new T.Mesh(new T.SphereGeometry(r * 2.4, 20, 14), new T.MeshBasicMaterial({ color: 0x1d1d1f, side: T.BackSide }));
        const reach = Math.max(radius * 0.09, 1.6);
        const cone = new T.Mesh(new T.CircleGeometry(reach, 24, -0.55, 1.1), new T.MeshBasicMaterial({ color: 0x35c9e8, transparent: true, opacity: 0.28, depthWrite: false, side: T.DoubleSide }));
        cone.rotation.x = -Math.PI / 2;
        const coneHolder = new T.Group();
        coneHolder.add(cone);
        const ballX = new T.Mesh(ball.geometry, new T.MeshBasicMaterial({ color: 0x1d1d1f, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false }));
        ballX.renderOrder = 8;
        marker.add(ball, rim, coneHolder, ballX);
        marker.userData.cone = coneHolder;
        g.add(marker);
        scene.add(g);
        Object.assign(trail, { group: g, tube, total: geo.index.count, marker, pts, n, walked, frame: -1, yaw: path.yaw || null, segs, clock: 0, ext: 0 });
        drawAt(0);
        kick();
      }
      // the page calls this as the run's video plays; when the video is off screen the stage plays the run on its own clock
      function pathAt(frame) { trail.ext = performance.now(); trail.clock = frame; drawAt(frame); }
      function drawAt(frame) {
        if (!trail.group || frame === trail.frame) return;
        trail.frame = frame;
        const f = Math.max(0, Math.min(trail.n - 1, frame)), u = trail.walked[f];
        trail.tube.geometry.setDrawRange(0, Math.max(6, Math.round((trail.total * u) / 6) * 6));
        trail.marker.position.copy(trail.pts[f]);
        let yaw = trail.yaw ? trail.yaw[f] : null;
        if (yaw === null) { const a = trail.pts[Math.max(0, f - 1)], b = trail.pts[Math.min(trail.n - 1, f + 1)]; yaw = Math.atan2(b.x - a.x, b.z - a.z); }
        trail.marker.userData.cone.rotation.y = yaw - Math.PI / 2;
        state.dirty = true; kick();
      }
      Object.assign(api, { showPath, pathAt, scrollTurn(rad) { if (!state.touched) { state.scrollAz = rad; kick(); } } });

      function lights(stored) {
        if (preset.lights === "scene" && stored && stored.length) {
          stored.forEach((L) => {
            if (L.type === "HemisphereLight") scene.add(new T.HemisphereLight(L.color, L.ground, L.intensity));
            else if (L.type === "AmbientLight") scene.add(new T.AmbientLight(L.color, L.intensity));
            else if (L.type === "DirectionalLight") addSun(L.color, L.intensity, new T.Vector3(...L.dir));
          });
          return;
        }
        scene.environment = env;
        scene.add(new T.HemisphereLight(0xffffff, 0xd9d3c7, 1.1));
        addSun(0xfff1df, 2.4, new T.Vector3(-0.55, 0.78, 0.32).normalize());
      }
      function addSun(color, intensity, dir) {
        const sun = new T.DirectionalLight(color, intensity);
        sun.position.copy(dir.normalize().multiplyScalar(radius * 2.2)).add(home.target);
        sun.target.position.copy(home.target);
        sun.castShadow = true;
        sun.shadow.mapSize.set(touch ? 1024 : 2048, touch ? 1024 : 2048);
        sun.shadow.bias = -0.0004;
        sun.shadow.normalBias = 0.02;
        const sc = sun.shadow.camera;
        sc.left = sc.bottom = -radius * 1.1; sc.right = sc.top = radius * 1.1;
        sc.near = radius * 0.2; sc.far = radius * 4.5;
        scene.add(sun, sun.target);
      }

      const loader = new T.GLTFLoader().setMeshoptDecoder(window.MeshoptDecoder);
      loader.load(opt.src, (gltf) => {
        if (!state.alive) return;
        const root = gltf.scene, meta = root.userData.spaceact || {};
        if (preset.cut) plane = new T.Plane(new T.Vector3(0, -1, 0), 1e6);
        const planes = plane ? [plane] : [];
        if (preset.clip) {
          const [x0, z0, x1, z1] = preset.clip;
          planes.push(new T.Plane(new T.Vector3(1, 0, 0), -x0), new T.Plane(new T.Vector3(-1, 0, 0), x1),
            new T.Plane(new T.Vector3(0, 0, 1), -z0), new T.Plane(new T.Vector3(0, 0, -1), z1));
        }
        root.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = o.receiveShadow = true;
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
            const kind = m.userData.kind;
            if (m.isMeshStandardMaterial && kind && kind !== "MeshStandardMaterial" && kind !== "MeshPhysicalMaterial") {
              m.metalness = 0;
              m.roughness = kind === "MeshPhongMaterial" ? 0.55 : 0.9;
            }
            if (m.userData.lm !== undefined && m.aoMap) {
              m.lightMap = m.aoMap; m.lightMapIntensity = m.userData.lm; m.aoMap = null;
            }
            if (planes.length) { m.clippingPlanes = planes; m.clipShadows = true; }
            m.needsUpdate = true;
          });
        });
        scene.add(root);
        model = root;
        const box = new T.Box3().setFromObject(root);
        if (preset.clip) { box.min.x = Math.max(box.min.x, preset.clip[0]); box.min.z = Math.max(box.min.z, preset.clip[1]); box.max.x = Math.min(box.max.x, preset.clip[2]); box.max.z = Math.min(box.max.z, preset.clip[3]); }
        const size = box.getSize(new T.Vector3()), center = box.getCenter(new T.Vector3());
        radius = 0.5 * Math.hypot(size.x, size.y, size.z);
        home.target.copy(center).setY(box.min.y + size.y * 0.35);
        if (host.clientWidth && host.clientHeight) camera.aspect = host.clientWidth / host.clientHeight;
        home.dist = fit();
        minDist = radius * 0.05; maxDist = home.dist * 2.4;
        camera.near = radius * 0.01; camera.far = radius * 12; camera.updateProjectionMatrix();
        Object.assign(cur, { dist: home.dist }); cur.target.copy(home.target);
        Object.assign(goal, { dist: home.dist }); goal.target.copy(home.target);
        lights(meta.lights);
        const ground = new T.Mesh(new T.PlaneGeometry(radius * 8, radius * 8), new T.ShadowMaterial({ opacity: 0.16 }));
        ground.rotation.x = -Math.PI / 2;
        ground.position.set(center.x, preset.groundY !== undefined ? preset.groundY : box.min.y - radius * 0.002, center.z);
        ground.receiveShadow = true;
        if (preset.ground !== false) scene.add(ground);
        if (plane) {
          cutRange = [box.min.y + 0.4, box.max.y + 0.01];
          plane.constant = cutRange[1];
          cutInput.addEventListener("input", () => {
            const u = Number(cutInput.value) / 1000;
            plane.constant = cutRange[0] + (cutRange[1] - cutRange[0]) * u;
            renderer.shadowMap.needsUpdate = true;
            state.dirty = true; kick();
          });
        }
        renderer.shadowMap.needsUpdate = true;
        state.ready = true; state.dirty = true;
        if (opt.intro) {
          // fly in: start further out, higher and turned, and ease into the starting view more slowly than usual
          cur.az = home.az + 0.9; cur.el = Math.min(EL_MAX, home.el + 0.26); cur.dist = home.dist * 1.4;
          state.introUntil = performance.now() + 2200;
        }
        load.remove();
        host.classList.add("m3d-ready");
        resize();
        kick();
        if (opt.onReady) opt.onReady(api);
      }, (e) => {
        if (e.total) load.innerHTML = bi(`Loading the model… ${Math.round((e.loaded / e.total) * 100)}%`, `正在加载模型… ${Math.round((e.loaded / e.total) * 100)}%`);
      }, (err) => {
        load.innerHTML = bi("The model could not be loaded.", "模型加载失败。");
        console.error(err);
      });

      // ---- input
      const ptrs = new Map();
      let mode = null, lastPinch = 0, lastMid = null, activeTimer = 0;
      const interact = () => {
        state.idle = 0; state.lastInteract = performance.now(); state.auto = false; state.touched = true; hint.classList.add("gone"); kick();
        if (opt.onActive) {
          if (!activeTimer) opt.onActive(true);
          clearTimeout(activeTimer);
          activeTimer = setTimeout(() => { activeTimer = 0; opt.onActive(false); }, 2500);
        }
      };
      function pan(dx, dy) {
        const k = (cur.dist * 2 * Math.tan(camera.fov * 0.5 * D2R)) / Math.max(1, host.clientHeight);
        const right = new T.Vector3().setFromMatrixColumn(camera.matrix, 0), up = new T.Vector3().setFromMatrixColumn(camera.matrix, 1);
        goal.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
      }
      function zoomBy(f) { goal.dist = Math.min(maxDist, Math.max(minDist, goal.dist * f)); interact(); }
      canvas.addEventListener("contextmenu", (e) => e.preventDefault());
      canvas.addEventListener("pointerdown", (e) => {
        canvas.setPointerCapture(e.pointerId);
        ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        state.engaged = true; host.classList.add("engaged");
        mode = ptrs.size === 2 ? "pinch" : e.button === 2 || e.shiftKey || e.ctrlKey || e.metaKey ? "pan" : "orbit";
        if (mode === "pinch") { const [a, b] = [...ptrs.values()]; lastPinch = Math.hypot(a.x - b.x, a.y - b.y); lastMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
        interact();
      });
      canvas.addEventListener("pointermove", (e) => {
        const p = ptrs.get(e.pointerId);
        if (!p) return;
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        p.x = e.clientX; p.y = e.clientY;
        if (mode === "pinch" && ptrs.size === 2) {
          const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          if (lastPinch > 0) goal.dist = Math.min(maxDist, Math.max(minDist, goal.dist * (lastPinch / d)));
          pan(mid.x - lastMid.x, mid.y - lastMid.y);
          lastPinch = d; lastMid = mid;
        } else if (mode === "pan") pan(dx, dy);
        else if (mode === "orbit") {
          goal.az -= dx * 0.0065;
          goal.el = Math.min(EL_MAX, Math.max(EL_MIN, goal.el + dy * 0.0045));
        }
        interact();
      });
      const up = (e) => {
        ptrs.delete(e.pointerId);
        mode = ptrs.size === 1 ? "orbit" : ptrs.size ? mode : null;
        if (ptrs.size === 1) { const [p] = [...ptrs.values()]; lastMid = { x: p.x, y: p.y }; }
      };
      canvas.addEventListener("pointerup", up);
      canvas.addEventListener("pointercancel", up);
      canvas.addEventListener("pointerleave", () => { if (!ptrs.size) { state.engaged = false; host.classList.remove("engaged"); } });
      canvas.addEventListener("wheel", (e) => {
        if (!state.engaged && !e.ctrlKey) return;
        e.preventDefault();
        zoomBy(Math.exp(Math.max(-60, Math.min(60, e.deltaY)) * (e.ctrlKey ? 0.01 : 0.0022)));
      }, { passive: false });
      // double-click: fly to the point under the cursor; on empty space, back to the start
      const ray = new T.Raycaster();
      canvas.addEventListener("dblclick", (e) => {
        if (!model) return;
        const r = canvas.getBoundingClientRect();
        ray.setFromCamera(new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
        const hit = ray.intersectObject(model, true).find((h) => !plane || h.point.y <= plane.constant);
        if (!hit) return goHome();
        goal.target.copy(hit.point);
        goal.dist = Math.max(minDist * 1.6, Math.min(goal.dist * 0.5, radius * 0.3));
        interact();
      });
      top.addEventListener("click", () => {
        const flat = goal.el > 80 * D2R;
        goal.el = flat ? home.el : 89 * D2R;
        if (!flat) goal.az = Math.round(goal.az / (Math.PI / 2)) * (Math.PI / 2);
        top.classList.toggle("on", !flat);
        interact();
      });
      zin.addEventListener("click", () => zoomBy(0.8));
      zout.addEventListener("click", () => zoomBy(1.25));
      reset.addEventListener("click", () => { top.classList.remove("on"); goHome(); });
      function goHome() {
        goal.az = home.az + Math.round((cur.az - home.az) / (2 * Math.PI)) * 2 * Math.PI;
        goal.el = home.el; goal.dist = home.dist; goal.target.copy(home.target);
        state.idle = 0; state.auto = !opt.still; kick();
      }

      // ---- frame loop: runs only while the model is on screen and something moves; yields during active page scroll
      function frame(now) {
        state.raf = 0;
        if (!state.alive || !state.visible || state.paused) return;
        const scrolling = now - lastScrollTime < 110 && !ptrs.size;
        if (scrolling && state.lastRender > 0) return;
        const userActive = ptrs.size > 0 || now - state.lastInteract < 900 || now < state.introUntil;
        if (!userActive && !state.dirty && now - state.lastRender < 30) { kick(); return; }
        const dt = Math.min(0.05, (now - (state.last || now)) / 1000);
        state.last = now;
        state.idle += dt;
        if (state.ready && !opt.still && (state.auto || state.idle > 6) && !ptrs.size) { state.auto = true; goal.az += dt * 0.11; }
        const k = 1 - Math.exp(-dt * (now < state.introUntil ? 1.9 : 9));
        let moving = false;
        ["az", "el", "dist"].forEach((key) => { const d = goal[key] - cur[key]; if (Math.abs(d) > 1e-5) moving = true; cur[key] += d * k; });
        if (cur.target.distanceToSquared(goal.target) > 1e-10) { moving = true; cur.target.lerp(goal.target, k); }
        const ds = state.scrollAz - state.scrollAzCur;
        if (Math.abs(ds) > 1e-5) { moving = true; state.scrollAzCur += ds * (1 - Math.exp(-dt * 4)); }
        if (trail.group && state.ready && now - trail.ext > 700) {
          trail.clock = (trail.clock + dt * 15) % (trail.n + 30);
          drawAt(Math.min(trail.n - 1, Math.floor(trail.clock)));
          moving = true;
        }
        if (state.ready && (moving || state.dirty)) {
          place();
          renderer.render(scene, camera);
          state.lastRender = now;
          state.dirty = false;
        }
        if (moving || state.auto || ptrs.size) kick();
        else state.last = 0;
      }
      function kick() { if (!state.raf && state.alive && state.visible && !state.paused) state.raf = requestAnimationFrame(frame); }
      api.kick = kick;
      activeKicks.add(kick);
      new IntersectionObserver((ents) => { state.visible = ents[0].isIntersecting; if (state.visible) { state.last = 0; kick(); } }).observe(host);
    }).catch((err) => { load.innerHTML = bi("3D needs WebGL, which is not available here.", "这里没法显示 3D（需要 WebGL）。"); console.error(err); });

    function dispose() {
      state.alive = false;
      if (api.kick) activeKicks.delete(api.kick);
      if (state.raf) cancelAnimationFrame(state.raf);
      if (api.renderer) { api.renderer.dispose(); api.renderer.forceContextLoss(); }
    }
    return api;
  }

  window.SAModel3D = { mount, ensureThree, PRESETS };
})();
