/* 雾岭疗养院 · bodies: the night matron and the sister are rigged GLBs (blender/sanatorium_characters.py: skin-modifier
   bodies, cloth-simulated dress / nightgown, walk / idle / chase / grab clips). The matron carries a real hurricane
   lantern from Poly Haven with the only warm light in the level. Movement comes from ai.js and main.js; here they
   are only placed and animated. Actors face +x in their own frame. */
(function () {
  "use strict";
  const S = (window.SANA = window.SANA || {});
  const A = (S.Actors = {});
  let scene, D;

  function canvas(w, h, draw) { return S.Engine.canvasTex(w, h, draw); }
  function bandageTex() {
    return canvas(512, 256, (g, w, h) => {
      g.fillStyle = "#a59d8a"; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 7) {
        g.fillStyle = `rgba(${120 + Math.random() * 50},${110 + Math.random() * 40},${85 + Math.random() * 30},0.7)`;
        g.save(); g.translate(0, y); g.rotate((Math.random() - 0.5) * 0.06); g.fillRect(-10, 0, w + 20, 3); g.restore();
      }
      for (let i = 0; i < 22; i++) {
        const x = Math.random() * w, y = Math.random() * h, r = 6 + Math.random() * 26;
        const c = g.createRadialGradient(x, y, 0, x, y, r);
        c.addColorStop(0, "rgba(80,38,24,0.6)"); c.addColorStop(1, "rgba(80,38,24,0)");
        g.fillStyle = c; g.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
      // two dark slits where the eyes are (the sphere's u = 0.75 is +y, i.e. the face)
      g.fillStyle = "rgba(10,6,5,0.92)";
      for (const dx of [-26, 26]) { g.beginPath(); g.ellipse(w * 0.75 + dx, h * 0.42, 15, 5, 0, 0, 7); g.fill(); }
      g.fillStyle = "rgba(40,18,14,0.6)"; g.fillRect(w * 0.75 - 18, h * 0.62, 36, 4);
    });
  }
  let _halo;
  function haloTex() {
    if (_halo) return _halo;
    _halo = canvas(128, 128, (g, w, h) => {
      const c = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      c.addColorStop(0, "rgba(255,255,255,1)"); c.addColorStop(0.25, "rgba(255,220,160,0.5)"); c.addColorStop(1, "rgba(255,200,120,0)");
      g.fillStyle = c; g.fillRect(0, 0, w, h);
    });
    return _halo;
  }

  // a GLB character wrapped so that it faces +x, with its animation mixer
  function character(name) {
    const src = S.Props.models[name];
    if (!src) return null;
    const holder = new THREE.Group();
    const inner = new THREE.Group();
    inner.rotation.y = -Math.PI / 2;
    holder.add(inner);
    inner.add(src);
    const bones = {};
    src.traverse((o) => {
      if (o.isBone) bones[o.name.replace(/[^a-zA-Z]/g, "").toLowerCase()] = o;
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        const m = o.material;
        if (m && m.name) {
          if (/bandage/.test(m.name)) { m.map = bandageTex(); m.color.set(0xffffff); m.roughness = 0.95; }
          if (/dress/.test(m.name)) { m.color.setRGB(0.028, 0.03, 0.036); m.roughness = 0.95; }
          if (/apron/.test(m.name)) { m.map = S.Props.pm("linen").map; m.color.setRGB(0.55, 0.52, 0.46); }
          if (/gown/.test(m.name)) { m.map = S.Props.pm("linen").map; m.color.setRGB(0.62, 0.6, 0.55); }
          if (/hair/.test(m.name)) { m.color.setRGB(0.012, 0.011, 0.01); m.roughness = 0.5; }
          if (/skin/.test(m.name)) { m.color.setRGB(0.36, 0.32, 0.29); }
          m.envMapIntensity = 0.3;
          m.needsUpdate = true;
        }
      }
    });
    const mixer = new THREE.AnimationMixer(src);
    const actions = {};
    for (const clip of (S.Props.clips && S.Props.clips[name]) || []) actions[clip.name] = mixer.clipAction(clip);
    return { holder, inner, src, bones, mixer, actions, current: null };
  }
  function play(c, name, fade, speed) {
    if (!c || !c.actions[name]) return;
    const a = c.actions[name];
    a.timeScale = speed || 1;
    if (c.current === name) return;
    const prev = c.current && c.actions[c.current];
    a.reset();
    a.setLoop(name === "grab" ? THREE.LoopOnce : THREE.LoopRepeat);
    a.clampWhenFinished = true;
    a.play();
    if (prev) prev.crossFadeTo(a, fade || 0.3, false);
    c.current = name;
  }

  function buildMatron() {
    const c = character("matron");
    const root = c ? c.holder : new THREE.Group();
    // the lantern hangs from the right hand and swings
    const swing = new THREE.Group();
    root.add(swing);
    const lantern = S.Props.models.Lantern_01 ? S.Props.models.Lantern_01.clone(true) : new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.25, 0.12));
    const box = new THREE.Box3().setFromObject(lantern);
    const sz = box.getSize(new THREE.Vector3());
    const sc = 0.32 / Math.max(0.01, sz.y);
    lantern.scale.setScalar(sc);
    lantern.position.set(-(box.min.x + sz.x / 2) * sc, -0.36 - box.min.y * sc, -(box.min.z + sz.z / 2) * sc);
    lantern.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    swing.add(lantern);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffb060 }));
    flame.scale.set(1, 1.6, 1);
    flame.position.set(0, -0.22, 0);
    swing.add(flame);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(), color: 0xffa040, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.set(0.85, 0.85, 1);
    halo.position.set(0, -0.22, 0);
    swing.add(halo);
    const light = new THREE.PointLight(0xffa24a, 9, 13, 2);
    light.position.set(0, -0.22, 0);
    light.castShadow = !!S.Engine.quality.lanternShadow;
    swing.add(light);
    return { c, root, swing, light, flame, hand: c && (c.bones.handr || c.bones.handR) };
  }

  function buildSister() {
    const c = character("sister");
    return { c, root: c ? c.holder : new THREE.Group() };
  }

  /* ---------------------------------------------------------------- state */
  const M = { x: 0, y: 0, z: 0, h: 0, speed: 0, phase: 0, swing: 0, swingV: 0, visible: true, state: "patrol" };
  const SI = { x: 0, y: 0, z: 0, h: 0, phase: 0, awake: false, speed: 0 };
  A.M = M; A.SI = SI;
  A.init = function (sc, data) {
    scene = sc; D = data;
    A.matron = buildMatron();
    scene.add(A.matron.root);
    A.sister = buildSister();
    scene.add(A.sister.root);
    const it = D.nav.items.find((i) => i.key === "sister");
    A.sisterHome = [3.5, 62.5, it ? it.p[2] : 31.7, 225];
    A.reset(null, false);
  };
  A.reset = function (pos, met) {
    SI.awake = !!met;
    if (pos) { SI.x = pos[0]; SI.y = pos[1]; SI.z = pos[2]; }
    else if (!met) { const h = A.sisterHome; SI.x = h[0]; SI.y = h[1]; SI.z = h[2]; SI.h = h[3] === undefined ? 225 : h[3]; }
  };
  A.wakeSister = function () { SI.awake = true; };
  A.placeSister = function (x, y, z) { SI.x = x; SI.y = y; SI.z = z; };
  A.setMatron = function (x, y, z, h, speed, visible, state) {
    M.x = x; M.y = y; M.z = z; M.h = h; M.speed = speed; M.visible = visible; M.state = state;
  };

  const tmpV = new THREE.Vector3();
  A.update = function (dt, P, ST) {
    const m = A.matron;
    m.root.visible = M.visible;
    m.root.position.set(M.x, M.z, -M.y);
    m.root.rotation.y = M.h * Math.PI / 180;
    if (m.c) {
      const clip = M.state === "grab" ? "grab" : M.state === "chase" && M.speed > 0.2 ? "chase" : M.speed > 0.1 ? "walk" : "idle";
      play(m.c, clip, 0.35, clip === "walk" ? Math.max(0.6, M.speed / 1.45) : clip === "chase" ? Math.max(0.7, M.speed / 2.65) : 1);
      m.c.mixer.update(dt);
    }
    // lantern pendulum, hung from the right hand and kicked by her steps
    M.phase += dt * (0.8 + M.speed * 2.1);
    const acc = -Math.sin(M.phase * 2) * 2.2 * Math.min(1, M.speed);
    M.swingV += (-M.swing * 26 + acc - M.swingV * 1.8) * dt;
    M.swing += M.swingV * dt;
    if (m.hand) {
      m.root.updateMatrixWorld(true);
      m.hand.getWorldPosition(tmpV);
      m.root.worldToLocal(tmpV);
      m.swing.position.copy(tmpV);
    } else m.swing.position.set(0.3, 1.0, 0.2);
    m.swing.rotation.z = M.swing * 0.5;
    m.swing.rotation.x = Math.sin(M.phase * 0.7) * 0.08;
    const f = 1 - 0.18 * (0.5 + 0.5 * Math.sin(performance.now() / 70)) * Math.random();
    m.light.intensity = 9 * f;
    m.flame.scale.set(1, 1.5 + 0.3 * f, 1);
    // sister: stands facing the corner of 307 until woken, then follows your footsteps
    const s = A.sister;
    SI.speed = 0;
    if (SI.awake && ST.sister) {
      const trail = P.trail;
      let tx = P.x, ty = P.y, tz = P.z, acc2 = 0;
      for (let i = trail.length - 1; i > 0; i--) {
        acc2 += Math.hypot(trail[i][0] - trail[i - 1][0], trail[i][1] - trail[i - 1][1]);
        if (acc2 > 1.3) { tx = trail[i - 1][0]; ty = trail[i - 1][1]; tz = trail[i - 1][2]; break; }
      }
      const dx = tx - SI.x, dy = ty - SI.y, d = Math.hypot(dx, dy);
      if (Math.hypot(P.x - SI.x, P.y - SI.y) > 14 || (Math.abs(P.z - SI.z) > 3.5 && d > 6)) {
        SI.x = tx; SI.y = ty; SI.z = tz;
      } else if (d > 0.15) {
        const sp = Math.min(d * 2.2, 1.9);
        SI.x += dx / d * sp * dt; SI.y += dy / d * sp * dt;
        const want = Math.atan2(dy, dx) * 180 / Math.PI;
        SI.h += (((want - SI.h + 540) % 360) - 180) * Math.min(1, dt * 8);
        const k = S.Walk.entry(SI.x, SI.y, SI.z, 0.6, true);
        if (k >= 0) SI.z += (S.Walk.height(k) - SI.z) * Math.min(1, dt * 10);
        SI.speed = sp;
      }
    }
    s.root.position.set(SI.x, SI.z, -SI.y);
    s.root.rotation.y = SI.h * Math.PI / 180;
    if (s.c) {
      play(s.c, !SI.awake ? "stand" : SI.speed > 0.15 ? "walk" : "idle", 0.3, SI.speed > 0.15 ? Math.max(0.6, SI.speed / 1.2) : 1);
      s.c.mixer.update(dt);
    }
    s.root.visible = !SI.awake || ST.sister;
  };
})();
