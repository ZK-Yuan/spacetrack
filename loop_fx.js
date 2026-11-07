/* Space Track · 无尽回廊: the camcorder look and the sound.
   create(renderer) → HDR post: bloom, ACES, a fluorescent-yellow grade, and two looks — "film" (clean enough for frames shown to
   agents) and "vhs" for people (tape softness, chroma bleed, grain, scanlines, head-switching noise at the bottom, tracking glitches).
   audio() → procedural sound: mains hum and ballast buzz, footsteps, flicker crackle, door thuds, stairwell echo, B3 rumble. */
(function () {
  "use strict";
  const QUAD = new THREE.PlaneGeometry(2, 2);
  const ORTHO = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const VERT = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
  function pass(frag, uniforms) {
    const m = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: frag, depthTest: false, depthWrite: false });
    const sc = new THREE.Scene();
    sc.add(new THREE.Mesh(QUAD, m));
    return { m, sc };
  }
  const BRIGHT = `uniform sampler2D tSrc; uniform float uThr; varying vec2 vUv;
    void main(){ vec3 c = texture2D(tSrc, vUv).rgb; float l = max(max(c.r, c.g), c.b);
      gl_FragColor = vec4(c * smoothstep(uThr, uThr * 2.4, l), 1.0); }`;
  const BLUR = `uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
    void main(){ vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270;
      c += texture2D(tSrc, vUv + uDir * 1.3846154).rgb * 0.3162162; c += texture2D(tSrc, vUv - uDir * 1.3846154).rgb * 0.3162162;
      c += texture2D(tSrc, vUv + uDir * 3.2307692).rgb * 0.0702703; c += texture2D(tSrc, vUv - uDir * 3.2307692).rgb * 0.0702703;
      gl_FragColor = vec4(c, 1.0); }`;
  const COPY = "uniform sampler2D tSrc; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tSrc, vUv); }";
  // three.js's own ACES fit, so "film" and the plain renderer agree on brightness
  const FINAL = `uniform sampler2D tScene, tB1, tB2, tB3;
    uniform vec2 uRes;
    uniform float uTime, uSeed, uExposure, uBloom, uVig, uGrain, uVHS, uGlitch, uDistort, uScan, uLift, uDesat, uCA;
    uniform vec3 uHalo, uTint;
    varying vec2 vUv;
    vec3 fit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
    vec3 aces(vec3 c){
      const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      return clamp(O * fit(I * (c / 0.6)), 0.0, 1.0);
    }
    vec3 toSRGB(vec3 c){ return mix(pow(c, vec3(0.41666)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    vec3 shade(vec2 uv){
      vec3 c = texture2D(tScene, uv).rgb;
      vec3 b = texture2D(tB1, uv).rgb * 0.5 + texture2D(tB2, uv).rgb * 0.8 + texture2D(tB3, uv).rgb * 1.1;
      return toSRGB(aces((c + b * uBloom * uHalo) * uExposure));
    }
    const mat3 YIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
    const mat3 RGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
    void main(){
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      // barrel distortion, scaled so "film" never shows a black edge (the camcorder keeps its dark rounded corners)
      vec2 uv = 0.5 + d * (1.0 + uDistort * r2) / (1.0 + uDistort * (uVHS > 0.0 ? 0.22 : 0.5));
      float px = 1.0 / uRes.x, line = floor(uv.y * 240.0), tf = floor(uTime * 29.97);
      float j = (hash(vec2(line, tf + uSeed)) - 0.5) * 0.0011 * uVHS;
      float head = smoothstep(0.035, 0.0, uv.y) * uVHS;
      j += head * (0.012 + 0.02 * hash(vec2(line * 1.7, tf)));
      float band = uGlitch * smoothstep(0.05, 0.0, abs(uv.y - fract(uTime * 0.37 + uSeed * 0.13)));
      j += band * (hash(vec2(line, tf * 1.3)) - 0.5) * 0.05 + uGlitch * 0.004 * sin(uv.y * 40.0 + uTime * 20.0);
      uv.x += j;
      vec3 col;
      if (uVHS > 0.0) {
        vec3 c0 = shade(uv), cl = shade(uv - vec2(px, 0.0)), cr = shade(uv + vec2(px, 0.0));
        float Y = dot(c0 * 0.5 + (cl + cr) * 0.25, vec3(0.299, 0.587, 0.114));
        vec2 iq = vec2(0.0);
        for (int k = 0; k < 4; k++) iq += (YIQ * shade(uv + vec2(px * (1.0 + 2.2 * float(k)), 0.0))).yz;
        col = clamp(RGB * vec3(Y, iq * 0.25), 0.0, 1.0);
      } else {
        vec2 o = d * uCA * r2;
        col = vec3(shade(uv - o).r, shade(uv).g, shade(uv + o).b);
      }
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l), uDesat) * uTint;
      col = col * (1.0 - uLift) + uLift * vec3(0.5, 0.465, 0.36);
      col *= mix(0.42, 1.0, smoothstep(0.95, 0.18, r2 * uVig * 2.0));
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) col = vec3(0.0);
      col += (hash(vUv * uRes + vec2(uTime * 61.0, uSeed)) - 0.5) * uGrain * (1.1 - l);
      // tape dropouts: now and then a short bright dash on one line
      float drop = step(0.9994, hash(vec2(line, tf + 7.0))) * step(hash(vec2(floor(uv.x * 22.0), line + tf)), 0.12) * uVHS;
      col = mix(col, vec3(0.92), drop * 0.65);
      col = mix(col, vec3(hash(vec2(uv.x * 400.0, line + tf))), head * 0.55 + band * 0.35);
      col *= 1.0 - uScan + uScan * cos(uv.y * 240.0 * 6.2831853);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`;

  /* Looks: "film" is deterministic (no grain, no glitches) and goes into agent frames; "vhs" is the found-footage camcorder. */
  const LOOKS = {
    film: { bloom: 0.5, halo: [1.0, 0.9, 0.72], vig: 0.7, grain: 0, vhs: 0, distort: 0.02, scan: 0, lift: 0.03, desat: 0.05, tint: [1.01, 1.0, 0.93], ca: 0.006 },
    vhs: { bloom: 0.75, halo: [1.0, 0.82, 0.55], vig: 1.25, grain: 0.075, vhs: 1, distort: 0.07, scan: 0.045, lift: 0.085, desat: 0.14, tint: [1.04, 1.0, 0.82], ca: 0 },
    // the camcorder's night vision: monochrome green, heavy gain and grain
    nv: { bloom: 0.9, halo: [0.8, 1.0, 0.8], vig: 1.5, grain: 0.17, vhs: 0, distort: 0.05, scan: 0.03, lift: 0.02, desat: 1.0, tint: [0.42, 1.32, 0.5], ca: 0 },
  };
  function create(renderer) {
    const sets = new Map();
    const P = {
      bright: pass(BRIGHT, { tSrc: { value: null }, uThr: { value: 1.0 } }),
      blur: pass(BLUR, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } }),
      down: pass(COPY, { tSrc: { value: null } }),
      final: pass(FINAL, {
        tScene: { value: null }, tB1: { value: null }, tB2: { value: null }, tB3: { value: null }, uRes: { value: new THREE.Vector2() },
        uTime: { value: 0 }, uSeed: { value: 0 }, uExposure: { value: 1 }, uBloom: { value: 0.5 }, uVig: { value: 1 }, uGrain: { value: 0 },
        uVHS: { value: 0 }, uGlitch: { value: 0 }, uDistort: { value: 0 }, uScan: { value: 0 }, uLift: { value: 0 }, uDesat: { value: 0 }, uCA: { value: 0 },
        uHalo: { value: new THREE.Vector3(1, 1, 1) }, uTint: { value: new THREE.Vector3(1, 1, 1) },
      }),
    };
    const size = new THREE.Vector2();
    function targets(w, h) {
      const key = `${w}x${h}`;
      if (sets.has(key)) return sets.get(key);
      const opt = { type: THREE.HalfFloatType, depthBuffer: false };
      const t = {
        scene: new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 }),
        b: [2, 4, 8].map((k) => [0, 1].map(() => new THREE.WebGLRenderTarget(Math.max(1, (w / k) | 0), Math.max(1, (h / k) | 0), opt))),
      };
      if (sets.size > 6) { sets.forEach((s) => { s.scene.dispose(); s.b.flat().forEach((r) => r.dispose()); }); sets.clear(); }
      sets.set(key, t);
      return t;
    }
    /* o: { look: "film" | "vhs", time, seed, exposure, glitch, tape (render height for the tape softness, or 0) } */
    function render(scene, camera, o) {
      const L = LOOKS[o.look] || LOOKS.film;
      renderer.getDrawingBufferSize(size);
      const ih = o.tape ? Math.min(size.y, o.tape) : size.y, iw = Math.max(1, Math.round((ih * size.x) / size.y));
      const T = targets(iw, ih);
      renderer.setRenderTarget(T.scene);
      renderer.render(scene, camera);
      P.bright.m.uniforms.tSrc.value = T.scene.texture;
      renderer.setRenderTarget(T.b[0][0]);
      renderer.render(P.bright.sc, ORTHO);
      for (let k = 0; k < 3; k++) {
        const [a, b] = T.b[k];
        if (k > 0) { P.down.m.uniforms.tSrc.value = T.b[k - 1][0].texture; renderer.setRenderTarget(a); renderer.render(P.down.sc, ORTHO); }
        for (let it = 0; it < 2; it++) {
          P.blur.m.uniforms.tSrc.value = a.texture; P.blur.m.uniforms.uDir.value.set(1 / a.width, 0);
          renderer.setRenderTarget(b); renderer.render(P.blur.sc, ORTHO);
          P.blur.m.uniforms.tSrc.value = b.texture; P.blur.m.uniforms.uDir.value.set(0, 1 / a.height);
          renderer.setRenderTarget(a); renderer.render(P.blur.sc, ORTHO);
        }
      }
      const u = P.final.m.uniforms;
      u.tScene.value = T.scene.texture; u.tB1.value = T.b[0][0].texture; u.tB2.value = T.b[1][0].texture; u.tB3.value = T.b[2][0].texture;
      u.uRes.value.copy(size);
      u.uTime.value = o.time || 0; u.uSeed.value = o.seed || 0; u.uExposure.value = o.exposure === undefined ? 1 : o.exposure;
      u.uGlitch.value = o.glitch || 0; u.uBloom.value = L.bloom; u.uVig.value = L.vig; u.uGrain.value = L.grain; u.uVHS.value = L.vhs;
      u.uDistort.value = L.distort; u.uScan.value = o.noScan ? 0 : L.scan; u.uLift.value = L.lift; u.uDesat.value = L.desat; u.uCA.value = L.ca;
      u.uHalo.value.set(...L.halo); u.uTint.value.set(...L.tint);
      renderer.setRenderTarget(null);
      renderer.render(P.final.sc, ORTHO);
    }
    return { render };
  }

  /* ---------------------------------------------------------------- sound: nothing plays until start() is called from a click or key */
  function audio() {
    let ctx = null, out = null, hum = null, humTone = null, rumble = null, wet = null, verb = null, muted = false, zone = "B1";
    const level = { B1: [0.55, 5200, 0, 0.12], stair: [0.12, 420, 0.06, 0.55], B3: [0.16, 300, 0.32, 0.35], dark: [0, 200, 0.1, 0.2] };
    function noise(sec, brown) {
      const n = Math.round(ctx.sampleRate * sec), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
      return buf;
    }
    function impulse(sec, decay) {
      const n = Math.round(ctx.sampleRate * sec), buf = ctx.createBuffer(2, n, ctx.sampleRate);
      for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
      return buf;
    }
    function start() {
      if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      out = ctx.createGain(); out.gain.value = muted ? 0 : 0.9; out.connect(ctx.destination);
      verb = ctx.createConvolver(); verb.buffer = impulse(2.4, 2.8);
      wet = ctx.createGain(); wet.gain.value = 0.12; verb.connect(wet); wet.connect(out);
      humTone = ctx.createBiquadFilter(); humTone.type = "lowpass"; humTone.frequency.value = 5200;
      hum = ctx.createGain(); hum.gain.value = 0; humTone.connect(hum); hum.connect(out);
      [[60, 0.05, "sine"], [120, 0.04, "sine"], [180, 0.012, "triangle"], [240, 0.006, "sine"], [360, 0.003, "sine"]].forEach(([f, g, type]) => {
        const o = ctx.createOscillator(), gn = ctx.createGain();
        o.type = type; o.frequency.value = f + (Math.random() - 0.5) * 0.3; gn.gain.value = g;
        o.connect(gn); gn.connect(humTone); o.start();
      });
      // ballast buzz: band-passed noise amplitude-modulated at 120 Hz
      const nz = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), am = ctx.createGain(), mod = ctx.createOscillator(), mg = ctx.createGain();
      nz.buffer = noise(2); nz.loop = true; bp.type = "bandpass"; bp.frequency.value = 2600; bp.Q.value = 0.9;
      am.gain.value = 0.004; mod.frequency.value = 120; mg.gain.value = 0.006;
      mod.connect(mg); mg.connect(am.gain); nz.connect(bp); bp.connect(am); am.connect(humTone); nz.start(); mod.start();
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 0.09; lg.gain.value = 0.08; lfo.connect(lg); lg.connect(hum.gain); lfo.start();
      // B3: machinery rumble with a slow pump throb
      const br = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), throb = ctx.createOscillator(), tg = ctx.createGain();
      rumble = ctx.createGain(); rumble.gain.value = 0;
      br.buffer = noise(4, true); br.loop = true; lp.type = "lowpass"; lp.frequency.value = 110;
      throb.frequency.value = 0.7; tg.gain.value = 0.12; throb.connect(tg); tg.connect(rumble.gain);
      br.connect(lp); lp.connect(rumble); rumble.connect(out); br.start(); throb.start();
      setZone(zone, true);
    }
    function setZone(z, now) {
      zone = z;
      if (!ctx) return;
      const [h, f, r, w] = level[z] || level.B1, t = ctx.currentTime, k = now ? 0.01 : 0.5;
      hum.gain.setTargetAtTime(h, t, k); humTone.frequency.setTargetAtTime(f, t, k);
      rumble.gain.setTargetAtTime(r, t, k); wet.gain.setTargetAtTime(w, t, k);
    }
    function burst(dur, freq, type, gain, wetMix, q) {
      if (!ctx || muted) return;
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime;
      s.buffer = noise(dur + 0.05); f.type = type; f.frequency.value = freq; if (q) f.Q.value = q;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
      s.connect(f); f.connect(g); g.connect(out);
      if (wetMix) { const sg = ctx.createGain(); sg.gain.value = wetMix; g.connect(sg); sg.connect(verb); }
      s.start(t); s.stop(t + dur + 0.05);
    }
    function tone(freq, dur, gain, type) {
      if (!ctx || muted) return;
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
      o.type = type || "sine"; o.frequency.value = freq;
      g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
    }
    return {
      start, setZone,
      step(surface) {
        if (surface === "carpet") { burst(0.12, 320, "lowpass", 0.32, 0.05); tone(70, 0.08, 0.12); }
        else { burst(0.08, 1700, "bandpass", 0.22, 0.6, 1.2); tone(95, 0.06, 0.1); }
      },
      crackle(dist) { const g = Math.max(0, 1 - dist / 14); if (g > 0) { burst(0.04 + Math.random() * 0.06, 3200, "highpass", 0.1 * g); tone(120, 0.05, 0.03 * g, "square"); } },
      door() { burst(0.3, 150, "lowpass", 0.45, 0.4); tone(55, 0.25, 0.15); },
      beep() { tone(1760, 0.12, 0.06); },
      distant() { burst(0.9, 90, "lowpass", 0.12, 1.0); },
      cut() { burst(0.5, 900, "bandpass", 0.3, 0.6); },
      clunk() { burst(0.06, 2400, "bandpass", 0.28, 0.3, 2); tone(140, 0.07, 0.08, "square"); },
      shutter() { burst(1.8, 240, "lowpass", 0.24, 0.5); burst(1.8, 1500, "bandpass", 0.05, 0.4, 3); },
      stomp(g) { burst(0.25, 110, "lowpass", 0.55 * g, 0.6); tone(46, 0.22, 0.28 * g); },
      howl() {
        if (!ctx || muted) return;
        const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(), s = ctx.createGain(), t = ctx.currentTime;
        o.type = "sawtooth"; o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(62, t + 1.9);
        f.type = "lowpass"; f.frequency.value = 650;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.2, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0005, t + 2.1);
        s.gain.value = 0.7;
        o.connect(f); f.connect(g); g.connect(out); g.connect(s); s.connect(verb);
        o.start(t); o.stop(t + 2.2);
        burst(1.6, 500, "bandpass", 0.06, 0.8, 2);
      },
      setMuted(m) { muted = m; if (out) out.gain.value = m ? 0 : 0.9; },
      get muted() { return muted; },
      get started() { return !!ctx; },
    };
  }
  window.SALoopFX = { create, audio, LOOKS };
})();
