/* Space Track · 冲关模式: presentation only. Synthesised sound (Web Audio, no files), camera motion, splash and
   bubble particles, commentary captions. Nothing here reads or writes the physics state directly: course.js feeds it
   poses and events, and the bench frames are rendered with all of it switched off. */
(function () {
  "use strict";
  const rand = (a, b) => a + (b - a) * Math.random();
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  // ------------------------------------------------------------------------------------------------ sound
  function Sound() {
    const KEY = "spaceact2.mute";
    let ctx = null, master = null, noise = null, muted = false;
    const loops = {};
    try { muted = localStorage.getItem(KEY) === "1"; } catch (e) { /* storage disabled */ }

    function unlock() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!ctx) {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 0.9;
        master.connect(ctx.destination);
        const len = ctx.sampleRate * 2;
        noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        loops.crowd = loop("bandpass", 650, 0.6);
        loops.crowd.g.gain.value = 0.03;
        const lfo = ctx.createOscillator(), depth = ctx.createGain();
        lfo.frequency.value = 0.11; depth.gain.value = 0.012;
        lfo.connect(depth); depth.connect(loops.crowd.g.gain); lfo.start();
        loops.whoosh = loop("bandpass", 500, 1.4);
        loops.machine = loop("lowpass", 240, 0.9);
      }
      if (ctx.state === "suspended") ctx.resume();
    }
    function loop(type, freq, q) {
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = noise; src.loop = true;
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      g.gain.value = 0;
      src.connect(f); f.connect(g);
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (p) { g.connect(p); p.connect(master); } else g.connect(master);
      src.start();
      return { src, f, g, p };
    }
    function envelope(param, t0, peak, attack, dur) {
      param.setValueAtTime(0.0001, t0);
      param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
      param.exponentialRampToValueAtTime(0.0001, t0 + dur);
    }
    function out(node, pan) {
      if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); node.connect(p); p.connect(master); }
      else node.connect(master);
    }
    /* Filtered noise one-shot: o = {type, f0, f1, q, gain, attack, dur, delay, pan}. */
    function burst(o) {
      if (!ctx) return;
      const t0 = ctx.currentTime + (o.delay || 0), src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = noise;
      f.type = o.type || "bandpass"; f.Q.value = o.q || 1;
      f.frequency.setValueAtTime(o.f0, t0);
      if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t0 + o.dur);
      envelope(g.gain, t0, o.gain, o.attack || 0.005, o.dur);
      src.connect(f); f.connect(g); out(g, o.pan);
      src.start(t0, Math.random() * 1.5);
      src.stop(t0 + o.dur + 0.05);
    }
    /* Oscillator one-shot: o = {wave, f0, f1, gain, attack, dur, delay, pan}. */
    function tone(o) {
      if (!ctx) return;
      const t0 = ctx.currentTime + (o.delay || 0), osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = o.wave || "sine";
      osc.frequency.setValueAtTime(o.f0, t0);
      if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t0 + o.dur);
      envelope(g.gain, t0, o.gain, o.attack || 0.005, o.dur);
      osc.connect(g); out(g, o.pan);
      osc.start(t0);
      osc.stop(t0 + o.dur + 0.05);
    }

    const api = {
      unlock,
      get ready() { return !!ctx; },
      get muted() { return muted; },
      toggle() {
        muted = !muted;
        try { localStorage.setItem(KEY, muted ? "1" : "0"); } catch (e) { /* storage disabled */ }
        if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.05);
        return muted;
      },
      step(surface, fast) {
        const k = fast ? 1.25 : 1;
        if (surface === "wood") { burst({ f0: 900, q: 3, gain: 0.22 * k, dur: 0.07 }); tone({ f0: 210, f1: 160, gain: 0.04 * k, dur: 0.06 }); }
        else if (surface === "hard") { burst({ f0: 2300, q: 4, gain: 0.12 * k, dur: 0.05 }); tone({ f0: 1250, f1: 950, gain: 0.025 * k, dur: 0.05 }); }
        else if (surface === "rubber") burst({ type: "lowpass", f0: 320, gain: 0.2 * k, dur: 0.1 });
        else if (surface === "vinyl") { tone({ f0: 320, f1: 230, gain: 0.05 * k, dur: 0.09 }); burst({ type: "lowpass", f0: 450, gain: 0.12 * k, dur: 0.08 }); }
        else burst({ type: "lowpass", f0: rand(420, 560), gain: 0.22 * k, dur: 0.09 });
      },
      jump() { burst({ f0: 1300, f1: 600, gain: 0.07, dur: 0.18, attack: 0.02 }); tone({ f0: 230, f1: 330, gain: 0.05, dur: 0.12 }); },
      land(impact) {
        const k = Math.min(1, Math.max(0.25, impact / 6));
        burst({ type: "lowpass", f0: 420, f1: 140, gain: 0.32 * k, dur: 0.2 });
        tone({ f0: 95, f1: 48, gain: 0.25 * k, dur: 0.22 });
      },
      splash(power) {
        const k = power || 1;
        burst({ type: "lowpass", f0: 3200, f1: 380, gain: 0.5 * k, dur: 0.95, attack: 0.01 });
        burst({ f0: 1500, q: 0.8, gain: 0.25 * k, dur: 0.45 });
        for (let i = 0; i < 9 * k; i++) tone({ f0: rand(380, 900), f1: rand(900, 1400), gain: 0.035, dur: rand(0.04, 0.09), delay: rand(0.2, 1.3) });
      },
      hit(pan) { tone({ f0: 130, f1: 45, gain: 0.5, dur: 0.28, pan }); burst({ f0: 850, q: 1, gain: 0.4, dur: 0.12, pan }); },
      punch(gain, pan) { tone({ f0: 95, f1: 50, gain: 0.3 * gain, dur: 0.15, pan }); burst({ type: "lowpass", f0: 650, gain: 0.25 * gain, dur: 0.08, pan }); },
      collapse() { burst({ type: "highpass", f0: 2600, gain: 0.28, dur: 0.12 }); burst({ type: "lowpass", f0: 300, gain: 0.2, dur: 0.32, delay: 0.05 }); },
      smallSplash(gain, pan) { burst({ type: "lowpass", f0: 2200, f1: 420, gain: 0.28 * gain, dur: 0.5, pan }); },
      grab() { burst({ f0: 620, q: 6, gain: 0.14, dur: 0.16 }); tone({ f0: 150, f1: 120, gain: 0.05, dur: 0.1 }); },
      release() { burst({ f0: 900, f1: 380, gain: 0.08, dur: 0.26, attack: 0.03 }); },
      beep(go) {
        if (go) { tone({ f0: 880, gain: 0.22, dur: 0.55 }); tone({ f0: 1320, gain: 0.08, dur: 0.55 }); }
        else tone({ f0: 660, gain: 0.2, dur: 0.18 });
      },
      chime() { tone({ f0: 784, gain: 0.14, dur: 0.28 }); tone({ f0: 1046, gain: 0.14, dur: 0.42, delay: 0.12 }); },
      fanfare() { [523, 659, 784, 1046].forEach((f, i) => tone({ wave: "triangle", f0: f, gain: 0.16, dur: i === 3 ? 0.8 : 0.22, delay: i * 0.13 })); },
      cheer(level) {
        burst({ f0: 1200, q: 0.5, gain: 0.13 * level, dur: 1.7, attack: 0.18 });
        burst({ f0: 2600, q: 0.7, gain: 0.05 * level, dur: 1.3, attack: 0.15 });
      },
      oooh() { burst({ f0: 720, f1: 340, q: 2.2, gain: 0.1, dur: 1.25, attack: 0.22 }); },
      /* Continuous whoosh (moving obstacles) and machine hum (fans, belt), set every frame. */
      ambient(whoosh, whooshPan, whooshFreq, machine, machinePan) {
        if (!ctx) return;
        const t = ctx.currentTime;
        loops.whoosh.g.gain.setTargetAtTime(Math.min(0.35, whoosh), t, 0.05);
        loops.whoosh.f.frequency.setTargetAtTime(whooshFreq, t, 0.05);
        if (loops.whoosh.p) loops.whoosh.p.pan.setTargetAtTime(whooshPan, t, 0.05);
        loops.machine.g.gain.setTargetAtTime(Math.min(0.25, machine), t, 0.1);
        if (loops.machine.p) loops.machine.p.pan.setTargetAtTime(machinePan, t, 0.1);
      },
    };
    return api;
  }

  // ------------------------------------------------------------------------------------------------ particles
  function Particles(THREE, scene) {
    const N = 700;
    const pos = new Float32Array(N * 3), alpha = new Float32Array(N), size = new Float32Array(N);
    const vel = new Float32Array(N * 3), life = new Float32Array(N), max = new Float32Array(N), kind = new Uint8Array(N);
    let next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("alpha", new THREE.BufferAttribute(alpha, 1));
    geo.setAttribute("psize", new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { color: { value: new THREE.Color(0xe8f8ff) } },
      vertexShader: "attribute float alpha; attribute float psize; varying float vA;" +
        "void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); float z = max(0.1, -mv.z);" +
        " vA = alpha * smoothstep(0.25, 1.2, z); gl_PointSize = min(psize * (320.0 / z), 14.0); gl_Position = projectionMatrix * mv; }",
      fragmentShader: "uniform vec3 color; varying float vA;" +
        "void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(color, vA * smoothstep(0.5, 0.15, d)); }",
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 3;
    scene.add(pts);
    const rings = [];
    const ringGeo = new THREE.RingGeometry(0.86, 1.0, 48);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false; m.renderOrder = 3;
      scene.add(m);
      rings.push({ m, t: 0, life: 0, r0: 0.3, grow: 1.6 });
    }
    let ringNext = 0;
    /* World coordinates (x east, y north, z up); stored in three.js axes. */
    function spawn(x, y, z, vx, vy, vz, l, s, k) {
      const i = next; next = (next + 1) % N;
      pos[i * 3] = x; pos[i * 3 + 1] = z; pos[i * 3 + 2] = -y;
      vel[i * 3] = vx; vel[i * 3 + 1] = vz; vel[i * 3 + 2] = -vy;
      life[i] = max[i] = l; size[i] = s; kind[i] = k; alpha[i] = 1;
    }
    function ring(x, y, delay, scale) {
      const r = rings[ringNext]; ringNext = (ringNext + 1) % rings.length;
      r.m.position.set(x, 0.03, -y);
      r.t = -(delay || 0); r.life = 1.4; r.r0 = 0.3 * (scale || 1); r.grow = 1.8 * (scale || 1);
      r.m.visible = false;
    }
    const api = {
      splash(x, y, power) {
        const p = power || 1;
        for (let i = 0; i < 110 * p; i++) {
          const a = Math.random() * Math.PI * 2, sp = rand(0.6, 3.2) * p, up = rand(2.5, 6.5) * Math.sqrt(p);
          spawn(x + Math.cos(a) * 0.3, y + Math.sin(a) * 0.3, 0.05, Math.cos(a) * sp, Math.sin(a) * sp, up, rand(0.8, 1.6), rand(0.05, 0.13), 0);
        }
        ring(x, y, 0, p); ring(x, y, 0.25, p * 0.8); ring(x, y, 0.55, p * 0.6);
      },
      /* Fan spray drifting downwind (+x). */
      mist(x, y, z) {
        for (let i = 0; i < 2; i++) spawn(x, y + rand(-1.1, 1.1), z + rand(-1.1, 1.1), rand(2.5, 4.5), rand(-0.3, 0.3), rand(-0.1, 0.3), rand(0.9, 1.5), rand(0.16, 0.3), 2);
      },
      bubbles(x, y, z) {
        for (let i = 0; i < 3; i++) spawn(x + rand(-0.6, 0.6), y + rand(-0.6, 0.6), z + rand(-0.6, 0.1), rand(-0.1, 0.1), rand(-0.1, 0.1), rand(0.5, 1.1), rand(0.6, 1.2), rand(0.03, 0.07), 1);
      },
      update(dt) {
        for (let i = 0; i < N; i++) {
          if (life[i] <= 0) { if (alpha[i] !== 0) { alpha[i] = 0; } continue; }
          life[i] -= dt;
          if (kind[i] === 0) vel[i * 3 + 1] -= 9.81 * dt;
          else if (kind[i] === 1) vel[i * 3 + 1] += 0.4 * dt;
          else { const k = 1 - Math.min(1, dt * 0.8); vel[i * 3] *= k; vel[i * 3 + 1] *= k; vel[i * 3 + 2] *= k; }
          pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
          if ((kind[i] === 0 && pos[i * 3 + 1] < 0) || (kind[i] === 1 && pos[i * 3 + 1] > 0)) life[i] = 0;
          alpha[i] = life[i] > 0 ? Math.min(1, (life[i] / max[i]) * 1.6) * (kind[i] === 2 ? 0.3 : 1) : 0;
        }
        geo.attributes.position.needsUpdate = true;
        geo.attributes.alpha.needsUpdate = true;
        geo.attributes.psize.needsUpdate = true;
        for (const r of rings) {
          if (r.life <= 0) continue;
          r.t += dt;
          if (r.t < 0) continue;
          const u = r.t / r.life;
          if (u >= 1) { r.life = 0; r.m.visible = false; continue; }
          r.m.visible = true;
          const s = r.r0 + r.grow * Math.sqrt(u);
          r.m.scale.set(s, 1, s);
          r.m.material.opacity = 0.55 * (1 - u);
        }
      },
      setVisible(v) { pts.visible = v; rings.forEach((r) => (r.m.visible = v && r.life > 0 && r.t >= 0)); },
    };
    return api;
  }

  // ------------------------------------------------------------------------------------------------ camera
  /* Head bob, landing dip, FOV kick, hit shake and tumble, sinking under water. Works on poses only, so it is the
     same for live play and for the replay of AI actions. */
  function CameraFX(fov0) {
    const st = { last: null, dist: 0, steps: 0, amp: 0, dip: 0, dipV: 0, trauma: 0, roll: 0, fov: fov0, waterT: 0, pitchW: 0 };
    return {
      reset() { st.last = null; st.dist = 0; st.steps = 0; st.amp = 0; st.dip = 0; st.dipV = 0; st.trauma = 0; st.roll = 0; st.waterT = 0; st.pitchW = 0; },
      land(impact) { st.dipV -= Math.min(1, impact / 7) * 2.4; },
      hit() { st.trauma = 1; },
      get waterT() { return st.waterT; },
      apply(p, dt) {
        const o = Object.assign({}, p);
        let speed = 0, stepped = false;
        if (st.last && dt > 0) speed = Math.hypot(p.x - st.last.x, p.y - st.last.y) / dt;
        if (speed > 20) speed = 0;
        st.last = { x: p.x, y: p.y };
        const fast = speed > 2.6, grounded = p.m === "ground";
        if (grounded && speed > 0.3) {
          st.dist += speed * dt;
          const stride = fast ? 1.15 : 0.72, n = Math.floor(st.dist / stride);
          if (n !== st.steps) { st.steps = n; stepped = true; }
        }
        const target = grounded ? Math.min(0.05, 0.013 * speed) : 0;
        st.amp += (target - st.amp) * Math.min(1, dt * 8);
        const ph = (st.dist / (fast ? 1.15 : 0.72)) * Math.PI;
        for (let rem = dt; rem > 1e-6; rem -= 1 / 120) {
          const h = Math.min(rem, 1 / 120);
          st.dipV += (-st.dip * 140 - st.dipV * 15) * h;
          st.dip = Math.max(-0.35, Math.min(0.15, st.dip + st.dipV * h));
        }
        st.trauma = Math.max(0, st.trauma - dt * 1.4);
        const sh = st.trauma * st.trauma;
        const hr = (p.h * Math.PI) / 180, rx = Math.sin(hr), ry = -Math.cos(hr);
        const sway = Math.sin(ph) * st.amp * 0.6;
        o.x += rx * sway; o.y += ry * sway;
        o.e += Math.sin(ph * 2) * st.amp + st.dip;
        o.h += (Math.random() - 0.5) * sh * 7;
        o.p += (Math.random() - 0.5) * sh * 6;
        let rollTarget = Math.sin(ph) * st.amp * 10;
        if (p.k) { st.roll += dt * 280; st.pitchW += dt * 6; o.p += Math.sin(st.pitchW) * 12; }
        else st.roll += (rollTarget - st.roll) * Math.min(1, dt * 6);
        if (st.roll > 120) st.roll = 120;
        if (p.m === "water") {
          st.waterT += dt;
          o.e = 0.28 - Math.min(0.75, st.waterT * 1.7);
          o.p = p.p + Math.min(14, st.waterT * 30);
        } else st.waterT = 0;
        const fovT = fov0 + (grounded && fast ? 6 : 0) + (p.m === "air" ? 3 : 0);
        st.fov += (fovT - st.fov) * Math.min(1, dt * 4);
        return { pose: o, roll: st.roll, fov: st.fov, step: stepped, speed, fast, underwater: o.e < 0 };
      },
    };
  }

  // ------------------------------------------------------------------------------------------------ captions
  function Captions(el) {
    let timer = null;
    const LINES = {
      splash: ["哎呀，下去了！", "落水！再来一次", "扑通——", "差一点点！", "全场惋惜！"],
      hit: ["被撞飞了！", "这一下好狠！", "飞出去了！", "躲不开啊！"],
      collapse: ["踩到假板了！", "板子塌了！"],
      close: ["好险！", "擦身而过！", "惊险！"],
      cp: ["漂亮！", "过关！", "干净利落！", "稳！"],
      goal: ["冲线！", "完成挑战！"],
      far: ["好远的一跳！", "飞跃！"],
      ball: ["稳稳落在球顶！", "这一脚踩得准！"],
    };
    return {
      say(kind, extra) {
        const text = (LINES[kind] ? pick(LINES[kind]) : kind) + (extra ? " " + extra : "");
        el.textContent = text;
        el.classList.remove("show");
        void el.offsetWidth;
        el.classList.add("show");
        clearTimeout(timer);
        timer = setTimeout(() => el.classList.remove("show"), 1700);
      },
    };
  }

  window.SACourseFX = function (THREE, scene, fov0, captionEl) {
    return { sound: Sound(), particles: Particles(THREE, scene), camera: CameraFX(fov0), captions: Captions(captionEl) };
  };
})();
