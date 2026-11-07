/* Space Track homepage: the four worlds as a slowly turning point cloud behind the hero, each flowing into the next.
   The points are sampled from the worlds' 3D models by bench/home_cloud.js (window.SA_CLOUD). Plain WebGL, no three.js.

     <canvas class="hero-fx"></canvas> inside the hero, and an optional element [data-fx-label] for the world's name */
(function () {
  "use strict";
  const C = window.SA_CLOUD, cv = document.querySelector(".hero-fx");
  if (!C || !cv) return;
  const still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const gl = cv.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: true });
  if (!gl) return;
  const NAMES = { renovate: ["A · Renovation", "A · 旧宅翻新"], course: ["B · Obstacle course", "B · 冲关"], loop: ["C · Corridor", "C · 无尽回廊"],
    sana: ["D · Sanatorium", "D · 雾岭疗养院"] };
  const HOLD = 4.6, MORPH = 2.4;

  const N = C.n, raw = atob(C.pos), q = new Int8Array(raw.length);
  for (let i = 0; i < raw.length; i++) q[i] = raw.charCodeAt(i) << 24 >> 24;
  const worlds = C.worlds.map((w, k) => {
    const a = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) a[i] = q[k * N * 3 + i] / 127;
    return a;
  });
  const seed = new Float32Array(N);
  let s = 7;
  for (let i = 0; i < N; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; seed[i] = s / 4294967296; }

  const VS = `
attribute vec3 a; attribute vec3 b; attribute float s;
uniform float t, time, size, spread, zoom; uniform mat4 mvp; uniform vec2 off;
varying float vk, va;
void main() {
  float u = clamp((t - s * 0.35) / 0.65, 0.0, 1.0);
  u = u * u * (3.0 - 2.0 * u);
  vec3 p = mix(a, b, u);
  p.y += sin(u * 3.14159) * (0.18 + 0.25 * s);
  p += 0.010 * vec3(sin(time * 0.7 + s * 40.0), sin(time * 0.9 + s * 31.0), cos(time * 0.6 + s * 23.0));
  p *= 1.0 + spread * (0.5 + s);
  vec4 c = mvp * vec4(p, 1.0);
  c.xy += off * c.w;
  gl_Position = c;
  float z = c.w / zoom;
  gl_PointSize = size / z;
  vk = clamp(c.x / c.w * 0.5 + 0.5, 0.0, 1.0);
  va = clamp(1.7 - z * 0.25, 0.25, 1.0) * smoothstep(-0.96, -0.28, c.y / c.w);
}`;
  const FS = `
precision mediump float;
varying float vk, va;
uniform float alpha;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d);
  if (r > 0.25) discard;
  vec3 c1 = vec3(0.878, 0.200, 0.541), c2 = vec3(0.710, 0.357, 0.816), c3 = vec3(0.208, 0.788, 0.910);
  vec3 c = vk < 0.45 ? mix(c1, c2, vk / 0.45) : mix(c2, c3, (vk - 0.45) / 0.55);
  float a = smoothstep(0.25, 0.06, r) * va * alpha;
  gl_FragColor = vec4(c * a, a);
}`;
  const shader = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); return sh; };
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);
  const buf = (data, name, n) => {
    const b = gl.createBuffer(), loc = gl.getAttribLocation(prog, name);
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0);
    return b;
  };
  const bufA = buf(worlds[0], "a", 3), bufB = buf(worlds[1 % worlds.length], "b", 3);
  buf(seed, "s", 1);
  const U = {};
  ["t", "time", "size", "spread", "zoom", "mvp", "alpha", "off"].forEach((k) => (U[k] = gl.getUniformLocation(prog, k)));
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  function setPair(k) {
    gl.bindBuffer(gl.ARRAY_BUFFER, bufA);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, worlds[k % worlds.length]);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufB);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, worlds[(k + 1) % worlds.length]);
  }
  const label = document.querySelector("[data-fx-label]");
  function name(k) {
    if (!label) return;
    const w = C.worlds[k % C.worlds.length], n = NAMES[w] || [w, w];
    label.innerHTML = `<span class="en">${n[0]}</span><span class="zh">${n[1]}</span>`;
  }

  // ---- camera: perspective, a little above, the cloud turning slowly; the pointer tilts it
  const zoomFor = (aspect) => Math.pow(Math.max(1, 1.3 / aspect), 0.85);
  function mat(aspect, yaw, pitch) {
    const f = 1 / Math.tan((34 * Math.PI) / 360), near = 0.1, far = 40, dist = 3.3 * zoomFor(aspect);
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // model-view: rotate about y, then tilt about x, then push back
    const m = [cy, sy * sp, -sy * cp, 0, 0, cp, sp, 0, sy, -cy * sp, cy * cp, 0, 0, -0.08, -dist, 1];
    const p = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += p[k * 4 + r] * m[c * 4 + k];
      o[c * 4 + r] = v;
    }
    return o;
  }
  let w = 0, h = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = cv.clientWidth; h = cv.clientHeight;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    gl.viewport(0, 0, cv.width, cv.height);
  }
  resize();
  window.addEventListener("resize", resize);

  const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener("pointermove", (e) => { ptr.tx = (e.clientX / window.innerWidth - 0.5) * 2; ptr.ty = (e.clientY / window.innerHeight - 0.5) * 2; }, { passive: true });

  let visible = true, raf = 0, t0 = performance.now(), pair = 0, shown = -1;
  setPair(0); name(0);
  function frame(now) {
    raf = 0;
    if (!visible || document.hidden) return;
    const time = Math.max(0, now - t0) / 1000, cycle = HOLD + MORPH, k = Math.floor(time / cycle), local = time - k * cycle;
    if (k !== pair) { pair = k; setPair(k); }
    const t = still ? 0 : Math.max(0, (local - HOLD) / MORPH);
    const cur = t > 0.5 ? k + 1 : k;
    if (cur !== shown) { shown = cur; name(cur); }
    ptr.x += (ptr.tx - ptr.x) * 0.04; ptr.y += (ptr.ty - ptr.y) * 0.04;
    const scroll = Math.min(1, window.scrollY / (h || 1));
    if (scroll >= 0.98) return;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(U.t, t);
    gl.uniform1f(U.time, still ? 0 : time);
    gl.uniform1f(U.size, (w < 700 ? 6.5 : 7.2) * dpr);
    gl.uniform1f(U.spread, scroll * 0.9);
    gl.uniform1f(U.zoom, zoomFor(w / h));
    gl.uniform1f(U.alpha, (w < 700 ? 0.55 : 0.8) * (1 - scroll * 0.9));
    gl.uniform2f(U.off, 0, w < 700 ? 0.38 : 0.3);
    gl.uniformMatrix4fv(U.mvp, false, mat(w / h, (still ? 0.6 : time * 0.09) + ptr.x * 0.22, 0.42 + ptr.y * 0.08));
    gl.drawArrays(gl.POINTS, 0, N);
    if (!still) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  if ("IntersectionObserver" in window) new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) kick(); }).observe(cv);
  document.addEventListener("visibilitychange", kick);
  window.addEventListener("scroll", () => { if (still) kick(); }, { passive: true });
  kick();
})();
