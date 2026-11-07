/* 雾岭疗养院 · procedural sound (Web Audio, no sample files): ambience, footsteps by surface, the matron's heels
   and humming placed in 3D (HRTF), heartbeat that follows her distance, stingers, doors. */
(function () {
  "use strict";
  const S = (window.SANA = window.SANA || {});
  const AU = (S.Audio = {});
  let ctx, master, wet, dry, noiseBuf, ambience = {}, started = false, humOsc, humGain, humPan, beatT = 0, eventT = 8, breathT = 0;

  function noise(sec) {
    const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function impulse(sec, decay) {
    const b = ctx.createBuffer(2, Math.floor(ctx.sampleRate * sec), ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, decay);
    }
    return b;
  }
  AU.start = function () {
    if (started) return;
    started = true;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp); comp.connect(ctx.destination);
    dry = ctx.createGain(); dry.connect(master);
    const conv = ctx.createConvolver(); conv.buffer = impulse(2.8, 3.2);
    wet = ctx.createGain(); wet.gain.value = 0.35;
    conv.connect(wet); wet.connect(master);
    AU.reverb = conv;
    noiseBuf = noise(3);
    // drone + room tone + wind
    const drone = ctx.createGain(); drone.gain.value = 0.05; drone.connect(dry); drone.connect(conv);
    for (const [f, type, det] of [[55, "sine", 0], [82.4, "triangle", 7], [110.5, "sine", -5]]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det;
      const g = ctx.createGain(); g.gain.value = f > 100 ? 0.2 : 0.5;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + Math.random() * 0.07;
      const lg = ctx.createGain(); lg.gain.value = 0.35; lfo.connect(lg); lg.connect(g.gain);
      o.connect(g); g.connect(drone); o.start(); lfo.start();
    }
    const wind = loopNoise(); const wf = ctx.createBiquadFilter(); wf.type = "bandpass"; wf.frequency.value = 500; wf.Q.value = 0.7;
    const wg = ctx.createGain(); wg.gain.value = 0; wind.connect(wf); wf.connect(wg); wg.connect(dry);
    const wl = ctx.createOscillator(); wl.frequency.value = 0.09; const wlg = ctx.createGain(); wlg.gain.value = 260; wl.connect(wlg); wlg.connect(wf.frequency); wl.start();
    const room = loopNoise(); const rf = ctx.createBiquadFilter(); rf.type = "lowpass"; rf.frequency.value = 180;
    const rg = ctx.createGain(); rg.gain.value = 0.05; room.connect(rf); rf.connect(rg); rg.connect(dry);
    ambience = { wind: wg, room: rg, drone };
    // the matron's humming: a sine with vibrato through a vowel formant, placed at her
    humOsc = ctx.createOscillator(); humOsc.type = "triangle";
    const vib = ctx.createOscillator(); vib.frequency.value = 5.2; const vg = ctx.createGain(); vg.gain.value = 5; vib.connect(vg); vg.connect(humOsc.frequency); vib.start();
    const f1 = ctx.createBiquadFilter(); f1.type = "bandpass"; f1.frequency.value = 700; f1.Q.value = 4;
    humGain = ctx.createGain(); humGain.gain.value = 0;
    humPan = panner();
    humOsc.connect(f1); f1.connect(humGain); humGain.connect(humPan); humPan.connect(dry); humPan.connect(conv);
    humOsc.start();
    AU.ctx = ctx;
  };
  function loopNoise() { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(); return s; }
  function panner() {
    const p = ctx.createPanner();
    p.panningModel = "HRTF"; p.distanceModel = "inverse"; p.refDistance = 1.6; p.rolloffFactor = 1.3; p.maxDistance = 70;
    return p;
  }
  function at(p, node) {
    if (p.positionX) { p.positionX.value = node[0]; p.positionY.value = node[2]; p.positionZ.value = -node[1]; }
    else p.setPosition(node[0], node[2], -node[1]);
  }
  function burst(o) {
    // o: {f, q, type, dur, gain, pos, attack, verb, pitch}
    if (!ctx) return;
    const t = ctx.currentTime + (o.delay || 0);
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.playbackRate.value = o.rate || 1;
    const f = ctx.createBiquadFilter(); f.type = o.type || "bandpass"; f.frequency.value = o.f; f.Q.value = o.q || 1;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.gain, t + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f); f.connect(g);
    let out = g;
    if (o.pos) { const p = panner(); at(p, o.pos); g.connect(p); out = p; }
    out.connect(dry);
    if (o.verb) { const s = ctx.createGain(); s.gain.value = o.verb; out.connect(s); s.connect(AU.reverb); }
    src.start(t, Math.random() * 2, o.dur + 0.05);
  }
  function tone(o) {
    if (!ctx) return;
    const t = ctx.currentTime + (o.delay || 0);
    const osc = ctx.createOscillator(); osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
    if (o.det) osc.detune.value = o.det;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.gain, t + (o.attack || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    let node = g;
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = o.lp; g.connect(f); node = f; }
    osc.connect(g);
    let out = node;
    if (o.pos) { const p = panner(); at(p, o.pos); node.connect(p); out = p; }
    out.connect(dry);
    if (o.verb) { const s = ctx.createGain(); s.gain.value = o.verb; out.connect(s); s.connect(AU.reverb); }
    osc.start(t); osc.stop(t + o.dur + 0.05);
  }

  /* ---------------------------------------------------------------- the player */
  const SURF = [
    { f: 1900, q: 1.2, dur: 0.07, g: 0.5 }, { f: 520, q: 1.5, dur: 0.1, g: 0.6, thump: 1 }, { f: 1100, q: 0.9, dur: 0.06, g: 0.5 },
    { f: 3200, q: 0.5, dur: 0.14, g: 0.25, type: "highpass" }, { f: 2400, q: 0.4, dur: 0.16, g: 0.35, crunch: 1 },
    { f: 2600, q: 9, dur: 0.22, g: 0.35, ring: 1 }, { f: 1300, q: 0.9, dur: 0.07, g: 0.5 }, { f: 400, q: 0.7, dur: 0.08, g: 0.18, type: "lowpass" },
  ];
  AU.footstep = function (surf, loud) {
    if (!ctx) return;
    const s = SURF[surf] || SURF[2];
    burst({ f: s.f * (0.9 + Math.random() * 0.2), q: s.q, dur: s.dur, gain: s.g * loud * 0.55, type: s.type, verb: 0.25 });
    if (s.thump) tone({ f: 90, f2: 50, dur: 0.12, gain: 0.25 * loud });
    if (s.crunch) for (let i = 1; i < 4; i++) burst({ f: 2000 + Math.random() * 1500, q: 0.6, dur: 0.04, gain: 0.12 * loud, delay: i * 0.025 });
  };
  AU.click = () => { burst({ f: 3500, q: 3, dur: 0.03, gain: 0.25 }); };
  AU.pickup = () => { for (const [f, d] of [[880, 0], [1320, 0.08]]) tone({ f, dur: 0.9, gain: 0.06, delay: d, verb: 0.5 }); };
  AU.paper = () => { for (let i = 0; i < 4; i++) burst({ f: 4000, q: 0.5, dur: 0.08, gain: 0.08, delay: i * 0.05, type: "highpass" }); };
  AU.thud = () => { tone({ f: 70, f2: 35, dur: 0.6, gain: 0.7, verb: 0.6 }); burst({ f: 300, q: 0.6, dur: 0.4, gain: 0.5, verb: 0.6 }); };
  AU.power = () => { tone({ f: 50, dur: 3.5, gain: 0.12, type: "sawtooth", lp: 300 }); burst({ f: 800, q: 2, dur: 0.15, gain: 0.6, verb: 0.7 }); tone({ f: 120, dur: 2.5, gain: 0.05, type: "square", lp: 500, delay: 0.3 }); };
  AU.door = function (pos, kind, style) {
    if (!ctx) return;
    if (kind === "open") {
      tone({ f: 180 + Math.random() * 60, f2: 320 + Math.random() * 120, dur: 0.9, gain: 0.07, type: "sawtooth", lp: 900, pos, verb: 0.5 });
      burst({ f: 700, q: 6, dur: 0.6, gain: 0.08, pos, attack: 0.1 });
    } else if (kind === "close") {
      tone({ f: 85, f2: 50, dur: 0.3, gain: 0.5, pos, verb: 0.6 }); burst({ f: 500, q: 1, dur: 0.15, gain: 0.4, pos });
    } else if (kind === "rattle") {
      for (let i = 0; i < 5; i++) burst({ f: 1500 + Math.random() * 800, q: 4, dur: 0.05, gain: 0.3, pos, delay: i * 0.07 });
    } else if (kind === "locker") {
      burst({ f: 900, q: 6, dur: 0.25, gain: 0.35, pos, verb: 0.4 }); tone({ f: 330, dur: 0.4, gain: 0.05, type: "square", lp: 1400, pos });
    }
  };

  /* ---------------------------------------------------------------- the matron */
  AU.matronStep = function (pos, state) {
    if (!ctx) return;
    const g = state === "chase" ? 0.9 : 0.55;
    burst({ f: 2900 + Math.random() * 400, q: 2.5, dur: 0.05, gain: g, pos, verb: 0.55 });
    tone({ f: 140, f2: 80, dur: 0.07, gain: g * 0.3, pos });
  };
  AU.matronNotice = function (kind) {
    if (!ctx) return;
    const p = S.AI ? [S.AI.M.x, S.AI.M.y, S.AI.M.z + 1.6] : null;
    burst({ f: 650, q: 5, dur: 0.5, gain: 0.25, pos: p, attack: 0.08, verb: 0.6 });
    burst({ f: 1100, q: 6, dur: 0.4, gain: 0.12, pos: p, attack: 0.06, delay: 0.05 });
  };
  AU.shaft = function (pos) { for (let i = 0; i < 9; i++) burst({ f: 700 + Math.random() * 900, q: 7, dur: 0.12, gain: 0.25, pos, delay: i * 0.09, verb: 0.7 }); };
  AU.stinger = function (kind) {
    if (!ctx) return;
    if (kind === "spotted") {
      for (const [f, d] of [[110, 0], [116.5, 0], [155.6, 0], [233, 0.02]]) tone({ f, f2: f * 1.06, dur: 2.4, gain: 0.07, type: "sawtooth", lp: 1800, attack: 0.03, delay: d, verb: 0.6 });
      burst({ f: 200, q: 0.5, dur: 0.8, gain: 0.5, verb: 0.8 });
    } else {
      for (const f of [220, 277, 330]) tone({ f, dur: 3, gain: 0.04, attack: 0.8, verb: 0.8 });
    }
  };
  AU.scream = function () {
    if (!ctx) return;
    tone({ f: 900, f2: 300, dur: 1.4, gain: 0.25, type: "sawtooth", lp: 3500, verb: 0.6 });
    tone({ f: 940, f2: 280, dur: 1.4, gain: 0.2, type: "square", lp: 2500 });
    burst({ f: 1500, q: 0.4, dur: 1.2, gain: 0.6, verb: 0.6 });
  };
  const MELODY = [329.6, 392, 440, 392, 329.6, 293.7, 329.6, 0, 329.6, 392, 440, 493.9, 440, 392, 0, 0];

  /* ---------------------------------------------------------------- per frame */
  AU.update = function (dt, P, ST) {
    if (!ctx) return;
    const cam = S.Engine.get().camera;
    const L = ctx.listener;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion), u = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    if (L.positionX) {
      L.positionX.value = cam.position.x; L.positionY.value = cam.position.y; L.positionZ.value = cam.position.z;
      L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = u.x; L.upY.value = u.y; L.upZ.value = u.z;
    } else { L.setPosition(cam.position.x, cam.position.y, cam.position.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
    const k = S.Walk.entry(P.x, P.y, P.z, 0.6);
    const out = k >= 0 && S.Walk.outdoor(k);
    const tunnel = P.z < 17.5 && !out;
    ambience.wind.gain.value += ((out ? 0.06 : 0.008) - ambience.wind.gain.value) * Math.min(1, dt);
    ambience.room.gain.value += ((out ? 0.01 : 0.05) - ambience.room.gain.value) * Math.min(1, dt);
    wet.gain.value += ((tunnel ? 0.7 : out ? 0.15 : 0.38) - wet.gain.value) * Math.min(1, dt);
    // humming while she patrols
    const M = S.AI ? S.AI.M : null;
    if (M) {
      at(humPan, [M.x, M.y, M.z + 1.55]);
      const humming = M.visible && (M.state === "patrol" || M.state === "return");
      const note = MELODY[Math.floor(performance.now() / 520) % MELODY.length];
      if (note) humOsc.frequency.setTargetAtTime(note * 0.5, ctx.currentTime, 0.04);
      humGain.gain.setTargetAtTime(humming && note ? 0.16 : 0, ctx.currentTime, 0.12);
    }
    // heartbeat
    const fear = S.AI ? S.AI.fear() : 0;
    beatT -= dt;
    if (fear > 0.25 && beatT <= 0) {
      const bpm = 70 + fear * 80;
      beatT = 60 / bpm;
      tone({ f: 55, f2: 38, dur: 0.14, gain: 0.25 * fear });
      tone({ f: 50, f2: 36, dur: 0.12, gain: 0.18 * fear, delay: 0.17 });
    }
    // breathing when out of breath or hiding with her near
    breathT -= dt;
    const panting = P.stamina < 0.35 || (P.hidden && fear > 0.4 && !P.holding);
    if (panting && breathT <= 0) {
      breathT = P.hidden ? 1.6 : 0.9;
      burst({ f: 900, q: 0.6, dur: 0.35, gain: 0.12, attack: 0.12 });
      burst({ f: 700, q: 0.6, dur: 0.45, gain: 0.09, attack: 0.15, delay: 0.42 });
    }
    // distant events
    eventT -= dt;
    if (eventT <= 0) {
      eventT = 7 + Math.random() * 14;
      const ang = Math.random() * Math.PI * 2, dist = 12 + Math.random() * 20;
      const pos = [P.x + Math.cos(ang) * dist, P.y + Math.sin(ang) * dist, P.z + 1 + Math.random() * 3];
      const r = Math.random();
      if (r < 0.35) tone({ f: 90 + Math.random() * 60, f2: 160 + Math.random() * 80, dur: 1.4, gain: 0.08, type: "sawtooth", lp: 600, pos, verb: 0.8 });
      else if (r < 0.6) for (let i = 0; i < 3; i++) tone({ f: 80, f2: 50, dur: 0.18, gain: 0.25, pos, delay: i * 0.33, verb: 0.8 });
      else if (r < 0.85) tone({ f: 1400, f2: 700, dur: 0.15, gain: 0.05, pos, verb: 0.9 });
      else burst({ f: 300, q: 3, dur: 1.5, gain: 0.12, pos, attack: 0.5, verb: 0.9 });
    }
  };
})();
