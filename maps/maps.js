/* Space Track · 首页「上帝视角」空间图。每张图都从场景自己的布局数据画出来（world.js、course_layout.js、
   sanatorium/game/data/level.json、renovate_layout.js；回廊的平面写在 loop.js 的闭包里，下面 LOOP 照抄了一份）。
   两种主题（dark 深色蓝图 / light 浅色、单一蓝色强调）× 两种语言；首页用 light 的中英两套，make_maps.js 把它们导出成
   ../thumbs/map_<scene>_zh.jpg 和 ../thumbs/map_<scene>_en.jpg。
   只画结构，不画答案：不标假踏板和记忆桥的安全路线，不画污渍和垃圾的位置。 */
(function () {
  "use strict";
  const W = 1920, H = 1080, TAU = Math.PI * 2;
  const THEMES = {
    dark: { light: false, bg: "#0a0f15", grid: "rgba(255,255,255,0.032)", vignette: "rgba(0,0,0,0.45)", text: "#eef2f4", soft: "#b9c6ce",
      muted: "#7d8d98", red: "#ff5a5a", blue: "#5fb4ff", water: "#0f2b40", waterEdge: "#3b86b8", halo: "rgba(10,15,21,0.92)",
      onAccent: "#0b0f12", rule: "rgba(255,255,255,.1)", swEdge: "rgba(255,255,255,.2)" },
    light: { light: true, accent: "#0071e3", bg: "#f5f5f7", grid: "rgba(0,0,0,0.035)", vignette: null, text: "#1d1d1f", soft: "#424245",
      muted: "#6e6e73", red: "#e0352b", blue: "#0071e3", water: "#dde9f6", waterEdge: "#80b8f1", halo: "rgba(245,245,247,0.94)",
      onAccent: "#ffffff", rule: "#d2d2d7", swEdge: "rgba(0,0,0,.14)" },
  };
  const FONTS = {
    zh: { sans: '"PingFang SC","Microsoft YaHei","Noto Sans SC","Noto Sans CJK SC","Helvetica Neue",Arial,sans-serif',
      mono: '"JetBrains Mono","SF Mono",Menlo,Consolas,"Liberation Mono",monospace' },
    en: { sans: '"Inter","Helvetica Neue",Arial,sans-serif', display: '"Inter Tight","Inter","Helvetica Neue",Arial,sans-serif',
      mono: '"JetBrains Mono",Menlo,Consolas,monospace' },
  };
  let K = THEMES.dark, EN = false, F = FONTS.zh;
  const tr = (zh, en) => (EN ? en : zh);

  /* ---------------------------------------------------------------- drawing kit */
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  function setFont(g, size, weight, o) {
    const fam = o && o.mono ? F.mono : o && o.display && F.display ? F.display : F.sans;
    g.font = `${weight || 600} ${size}px ${fam}`;
    if ("letterSpacing" in g) g.letterSpacing = o && o.display && EN ? `${-size * 0.015}px` : "0px";
  }

  function label(g, str, x, y, o) {
    o = o || {};
    const size = o.size || 26;
    g.save();
    setFont(g, size, o.weight, o);
    g.textAlign = o.align || "center"; g.textBaseline = "middle";
    if (o.rotate) { g.translate(x, y); g.rotate(o.rotate); x = 0; y = 0; }
    if (o.pill) {
      const w = g.measureText(str).width + size * 1.0, h = size * 1.6;
      const x0 = o.align === "left" ? x - size * 0.5 : o.align === "right" ? x - w + size * 0.5 : x - w / 2;
      roundRect(g, x0, y - h / 2, w, h, Math.min(h / 2, 10));
      g.fillStyle = o.pill; g.fill();
      if (o.border) { g.strokeStyle = o.border; g.lineWidth = 2; g.stroke(); }
    } else if (o.halo !== false) {
      g.lineJoin = "round"; g.strokeStyle = o.halo || K.halo; g.lineWidth = size * 0.36; g.strokeText(str, x, y);
    }
    g.fillStyle = o.color || K.text; g.fillText(str, x, y);
    g.restore();
  }

  /* Chinese wraps between characters, English between words. */
  function wrap(g, str, maxW) {
    const lines = [];
    let cur = "";
    const parts = EN ? str.split(/(\s+)/) : [...str];
    for (const p of parts) {
      const next = cur + p;
      if (cur.trim() && g.measureText(next).width > maxW && (EN ? p.trim() : !"，。；：、）」".includes(p))) { lines.push(cur.trimEnd()); cur = EN ? p.trimStart() : p; }
      else cur = next;
    }
    if (cur.trim()) lines.push(cur.trim());
    return lines;
  }

  function xmark(g, x, y, r, color, lw) {
    g.save(); g.strokeStyle = K.halo; g.lineCap = "round"; g.lineWidth = lw + 4;
    g.beginPath(); g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.moveTo(x + r, y - r); g.lineTo(x - r, y + r); g.stroke();
    g.strokeStyle = color; g.lineWidth = lw; g.stroke(); g.restore();
  }
  function star(g, x, y, r, color) {
    g.save(); g.beginPath();
    for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    g.closePath(); g.fillStyle = color; g.fill(); g.strokeStyle = K.halo; g.lineWidth = 2.5; g.stroke(); g.restore();
  }
  function tri(g, x, y, r, color) {
    g.save(); g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r * 0.9, y + r * 0.6); g.lineTo(x - r * 0.9, y + r * 0.6); g.closePath();
    g.fillStyle = color; g.fill(); g.strokeStyle = K.halo; g.lineWidth = 2.5; g.stroke(); g.restore();
  }
  function square(g, x, y, r, color, border) {
    g.save(); g.fillStyle = color; g.fillRect(x - r, y - r, 2 * r, 2 * r);
    g.strokeStyle = border || "#fff"; g.lineWidth = 2; g.strokeRect(x - r, y - r, 2 * r, 2 * r); g.restore();
  }
  function dot(g, x, y, r, color, border) {
    g.save(); g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = color; g.fill();
    if (border) { g.strokeStyle = border; g.lineWidth = 2; g.stroke(); } g.restore();
  }
  function badge(g, x, y, text, color, r) {
    r = r || 17;
    dot(g, x, y, r + 3, K.halo);
    dot(g, x, y, r, color);
    label(g, text, x, y + 1, { size: r * 1.15, weight: 800, color: K.onAccent, halo: false });
  }
  function arrowHead(g, x, y, ang, size, color) {
    g.save(); g.translate(x, y); g.rotate(ang); g.beginPath(); g.moveTo(size, 0); g.lineTo(-size * 0.7, size * 0.65); g.lineTo(-size * 0.7, -size * 0.65);
    g.closePath(); g.fillStyle = color; g.fill(); g.restore();
  }

  function backdrop(g) {
    g.fillStyle = K.bg; g.fillRect(0, 0, W, H);
    g.strokeStyle = K.grid; g.lineWidth = 1;
    for (let x = 0; x <= W; x += 48) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke(); }
    for (let y = 0; y <= H; y += 48) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke(); }
    if (K.vignette) {
      const vg = g.createRadialGradient(W * 0.4, H * 0.45, H * 0.3, W * 0.4, H * 0.45, H * 1.1);
      vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, K.vignette);
      g.fillStyle = vg; g.fillRect(0, 0, W, H);
    }
  }

  /* World → screen. b = [x0, y0, x1, y1] in world units (y north), box = [x, y, w, h] on screen. With rot the world's +y runs to
     the right and +x runs down (north points right), for long thin layouts such as the pool. */
  function fit(b, box, rot) {
    const ww = rot ? b[3] - b[1] : b[2] - b[0], wh = rot ? b[2] - b[0] : b[3] - b[1];
    const s = Math.min(box[2] / ww, box[3] / wh);
    const ox = box[0] + (box[2] - ww * s) / 2, oy = box[1] + (box[3] - wh * s) / 2;
    const P = rot ? (x, y) => [ox + (y - b[1]) * s, oy + (x - b[0]) * s] : (x, y) => [ox + (x - b[0]) * s, oy + (b[3] - y) * s];
    return { s, P, rot: !!rot, rect: [ox, oy, ww * s, wh * s] };
  }

  function pen(g, v) {
    const path = (pts, close) => {
      g.beginPath();
      pts.forEach((p, i) => { const q = v.P(p[0], p[1]); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); });
      if (close) g.closePath();
    };
    const d = {
      path,
      poly(pts, fill, stroke, lw, dash) {
        path(pts, true);
        if (fill) { g.fillStyle = fill; g.fill(); }
        if (stroke) { g.setLineDash(dash || []); g.strokeStyle = stroke; g.lineWidth = lw || 2; g.lineJoin = "round"; g.stroke(); g.setLineDash([]); }
      },
      line(pts, color, lw, dash, cap) {
        path(pts, false);
        g.setLineDash(dash || []); g.strokeStyle = color; g.lineWidth = lw; g.lineCap = cap || "round"; g.lineJoin = "round"; g.stroke(); g.setLineDash([]);
      },
      rect(x0, y0, x1, y1, fill, stroke, lw, dash) { d.poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], fill, stroke, lw, dash); },
      circle(x, y, r, fill, stroke, lw) {
        const q = v.P(x, y);
        g.beginPath(); g.arc(q[0], q[1], r * v.s, 0, TAU);
        if (fill) { g.fillStyle = fill; g.fill(); }
        if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw || 2; g.stroke(); }
      },
      text(str, x, y, o) { const q = v.P(x, y); label(g, str, q[0] + ((o && o.dx) || 0), q[1] + ((o && o.dy) || 0), o); },
      hatch(pts, fill, color, gap) {
        g.save(); path(pts, true); if (fill) { g.fillStyle = fill; g.fill(); } g.clip();
        g.strokeStyle = color; g.lineWidth = 1.5;
        for (let k = -H; k < W; k += gap) { g.beginPath(); g.moveTo(k, H); g.lineTo(k + H, 0); g.stroke(); }
        g.restore();
      },
    };
    return d;
  }

  function swatch(g, kind, color, x, y) {
    g.save();
    if (kind === "line" || kind === "dash" || kind === "dots") {
      g.strokeStyle = color; g.lineWidth = kind === "line" ? 6 : 4; g.lineCap = "round";
      g.setLineDash(kind === "dash" ? [10, 7] : kind === "dots" ? [1, 9] : []);
      g.beginPath(); g.moveTo(x + 4, y); g.lineTo(x + 52, y); g.stroke();
    } else if (kind === "fill") {
      roundRect(g, x, y - 14, 56, 28, 6); g.fillStyle = color; g.fill(); g.strokeStyle = K.swEdge; g.lineWidth = 1.5; g.stroke();
    } else if (kind === "hatch") {
      roundRect(g, x, y - 14, 56, 28, 6); g.fillStyle = color[0]; g.fill(); g.clip();
      g.strokeStyle = color[1]; g.lineWidth = 1.5;
      for (let k = -40; k < 80; k += 10) { g.beginPath(); g.moveTo(x + k, y + 14); g.lineTo(x + k + 28, y - 14); g.stroke(); }
    } else if (kind === "outline") {
      roundRect(g, x + 2, y - 12, 52, 24, 4); g.setLineDash([8, 5]); g.strokeStyle = color; g.lineWidth = 3; g.stroke();
    } else if (kind === "bar") {
      g.fillStyle = color; g.fillRect(x + 4, y - 6, 48, 12);
    } else if (kind === "dot") dot(g, x + 28, y, 7, color);
    else if (kind === "square") square(g, x + 28, y, 7, color);
    else if (kind === "x") xmark(g, x + 28, y, 9, color, 4);
    else if (kind === "star") star(g, x + 28, y, 15, color);
    else if (kind === "tri") tri(g, x + 28, y + 3, 14, color);
    else if (kind === "num") badge(g, x + 28, y, "1", color, 14);
    else if (kind === "arrow") {
      g.strokeStyle = color; g.lineWidth = 4; g.beginPath(); g.moveTo(x + 6, y); g.lineTo(x + 40, y); g.stroke(); arrowHead(g, x + 44, y, 0, 11, color);
    }
    g.restore();
  }

  /* The side panel: scene letter, title, a line of facts, then whatever the map needs (legend, notes, scale). */
  function panelHead(g, o) {
    const x = o.x;
    let y = o.y;
    roundRect(g, x, y, 70, 70, 16); g.fillStyle = o.accent; g.fill();
    label(g, o.letter, x + 35, y + 37, { size: 42, weight: 800, color: K.onAccent, halo: false, display: true });
    label(g, tr("GOD VIEW · 上帝视角", "GOD VIEW"), x + 92, y + 22, { size: 21, mono: true, weight: 700, color: o.accent, align: "left", halo: false });
    label(g, tr("模型只看得到第一人称画面", "Never shown to models"), x + 92, y + 52, { size: 21, color: K.muted, align: "left", halo: false, weight: 500 });
    y += 132;
    setFont(g, 58, 800, { display: true });
    const titleSize = Math.min(58, Math.floor(58 * o.w / Math.max(o.w, g.measureText(o.title).width)));
    label(g, o.title, x, y, { size: titleSize, weight: EN ? 700 : 800, align: "left", halo: false, display: true });
    y += 58;
    setFont(g, 26, 500);
    wrap(g, o.sub, o.w).forEach((ln) => { label(g, ln, x, y, { size: 26, color: K.soft, align: "left", halo: false, weight: 500 }); y += 38; });
    y += 4;
    g.fillStyle = K.rule; g.fillRect(x, y, o.w, 2);
    return y + 40;
  }
  function legend(g, items, x, y, w, cols) {
    cols = cols || 1;
    const colW = w / cols;
    items.forEach((it, i) => {
      const cx = x + (i % cols) * colW, cy = y + Math.floor(i / cols) * 48;
      swatch(g, it[0], it[1], cx, cy);
      label(g, it[2], cx + 72, cy, { size: EN ? 24 : 25, align: "left", color: K.soft, halo: false, weight: 500 });
    });
    return y + Math.ceil(items.length / cols) * 48;
  }
  function notes(g, text, x, y, w, color) {
    setFont(g, 23, 500);
    wrap(g, text, w).forEach((ln) => { label(g, ln, x, y, { size: 23, align: "left", color: color || K.muted, halo: false, weight: 500 }); y += 36; });
    return y;
  }
  /* Scale bar of `len` world units labelled `text`, plus a north arrow (pointing right on rotated maps). */
  function scale(g, v, x, y, len, text) {
    const px = len * v.s;
    g.save();
    g.strokeStyle = K.soft; g.lineWidth = 3; g.beginPath();
    g.moveTo(x, y - 8); g.lineTo(x, y); g.lineTo(x + px, y); g.lineTo(x + px, y - 8); g.stroke();
    g.fillStyle = K.soft; g.fillRect(x, y - 3, px / 2, 3);
    label(g, text, x + px + 16, y - 4, { size: 22, mono: true, align: "left", color: K.soft, halo: false });
    const nx = x + px + 150, ny = y - 4, ang = v.rot ? 0 : -Math.PI / 2;
    g.translate(nx, ny); g.rotate(ang);
    g.beginPath(); g.moveTo(22, 0); g.lineTo(-12, 11); g.lineTo(-5, 0); g.lineTo(-12, -11); g.closePath(); g.fillStyle = K.soft; g.fill();
    g.restore();
    const lx = v.rot ? nx + 46 : nx, ly = v.rot ? ny : ny - 40;
    label(g, "N", lx, ly, { size: 22, mono: true, weight: 800, color: K.soft, halo: false });
  }

  /* ---------------------------------------------------------------- E · 移动迷宫 (world.js, 1 unit = 10 m) */
  function park(g, Wd) {
    const A = K.accent || "#0071e3", G = Wd.graph;
    const C = K.light ? {
      ground: "#eceef2", groundEdge: "#9aa0a8", wet: "#dfe4ea", wetHatch: "rgba(60,72,88,.18)", wetKey: "rgba(60,72,88,.48)", wetEdge: "#7d8590",
      tree: "rgba(70,82,94,.16)", hill: "rgba(55,71,79,.32)", island: "#e2e7ee", islandEdge: "#6e7782", maze: "#5c6470", path: "#424852",
      road: "#d5d9e0", roadDash: "#8e95a0", underShadow: null, underpass: "#525862", overUnder: "#ffffff", overpass: "#1d1d1f", longBridge: "#1d1d1f",
      zigzag: "#e65100", ferry: K.blue, node: "#1d1d1f", sign: K.blue, closeText: "#c4161c", zigText: "#bf360c", ferryText: "#0060c0",
      woods: "#263238", wetText: "#37474f", gatePill: "#ffffff",
    } : {
      ground: "#11161d", groundEdge: "#3a4654", wet: "#161e27", wetHatch: "rgba(130,160,190,.14)", wetKey: "rgba(130,160,190,.42)", wetEdge: "#4e6175",
      tree: "rgba(90,115,140,.22)", hill: "rgba(140,175,205,.25)", island: "#18222c", islandEdge: "#4a5d70", maze: "rgba(255,183,77,.65)", path: "#b0bec5",
      road: "#19232b", roadDash: "#4a5964", underShadow: "rgba(0,0,0,.55)", underpass: "#d6c290", overUnder: K.bg, overpass: "#a9bccb", longBridge: "#e6d6b0",
      zigzag: "#ff7a59", ferry: K.blue, node: "rgba(255,255,255,.9)", sign: K.blue, closeText: "#ff9a9a", zigText: "#ffb39e", ferryText: "#9fd0ff",
      woods: "#ffe082", wetText: "#90a4ae", gatePill: "rgba(17,22,29,.95)",
    };
    backdrop(g);
    const v = fit([-2, -3, 102, 72], [40, 40, 1400, 1000]);
    const d = pen(g, v), P = v.P;
    d.poly(Wd.boundary, C.ground, C.groundEdge, 3);
    // Draw the Square Glade courtyard in the central heart (50, 25)
    d.rect(42.0, 17.0, 58.0, 33.0, K.light ? "#dcebd6" : "#16291e", K.light ? "#5c8a58" : "#3b6e4c", 3);
    // Draw the 7 Concentric Maze Wall Rings & 16 Radial Sector Spokes around (50, 35)
    const ringCol = K.light ? "rgba(70,80,92,0.22)" : "rgba(140,165,190,0.18)";
    [10.5, 14.0, 17.5, 21.0, 24.5, 28.0, 31.5].forEach((R) => {
      const rpts = [];
      for (let k = 0; k <= 64; k++) {
        const a = (k / 64) * TAU, rx = 50.0 + Math.cos(a) * R * 1.12, ry = 35.0 + Math.sin(a) * R * 0.94;
        if (rx > 2 && rx < 75.5 && ry > 2 && ry < 68 && !(Math.abs(rx - 50) < 8.4 && Math.abs(ry - 25) < 8.4)) rpts.push([rx, ry]);
        else if (rpts.length > 1) { d.line(rpts, ringCol, 6); rpts.length = 0; } else rpts.length = 0;
      }
      if (rpts.length > 1) d.line(rpts, ringCol, 6);
    });
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU, spts = [];
      for (let r = 9; r <= 34; r += 0.8) {
        const rx = 50.0 + Math.cos(a) * r * 1.12, ry = 35.0 + Math.sin(a) * r * 0.94;
        if (rx > 2 && rx < 75.5 && ry > 2 && ry < 68 && !(Math.abs(rx - 50) < 8.4 && Math.abs(ry - 25) < 8.4)) spts.push([rx, ry]);
      }
      if (spts.length > 1) d.line(spts, ringCol, 4, [10, 8]);
    }
    d.hatch(Wd.wetland, C.wet, C.wetHatch, 16);
    d.poly(Wd.wetland, null, C.wetEdge, 2.2, [8, 6]);
    const hl = Wd.hill, hq = P(hl.x, hl.y);
    [1, 0.76, 0.52, 0.28].forEach((f) => {
      g.beginPath(); g.ellipse(hq[0], hq[1], hl.r * f * v.s, hl.r * f * (hl.ys || 1) * v.s, 0, 0, TAU);
      g.strokeStyle = C.hill; g.lineWidth = 1.6; g.stroke();
    });
    d.poly(Wd.lake, K.light ? "#d4dce4" : "#16202a", K.light ? "#7a8b9c" : "#3b5268", 2.5);
    d.poly(Wd.island, C.island, C.islandEdge, 2.5);
    d.poly(Wd.bird, C.island, C.islandEdge, 2);
    Wd.maze.forEach((p) => d.line(p, C.maze, 3.2));
    Wd.paths.concat([Wd.spiral]).forEach((p) => d.line(p, C.path, 4.2));
    d.line(Wd.road, C.road, 2.3 * v.s);
    d.line(Wd.road, C.roadDash, 2, [16, 14]);
    if (C.underShadow) d.line(Wd.underpass, C.underShadow, 10);
    d.line(Wd.underpass, C.underpass, 3.6, [9, 7]);
    d.line(Wd.overpass, C.overUnder, 11);
    d.line(Wd.overpass, C.overpass, 6);
    d.line(Wd.longBridge, C.longBridge, 5.5);
    d.line(Wd.zigzag, C.zigzag, 5.5);
    d.line(Wd.ferry, C.ferry, 3.2, [10, 8]);
    Wd.docks.forEach(([x, y]) => { const q = P(x, y); square(g, q[0], q[1], 7, C.ferry); });
    G.nodes.forEach(([x, y]) => { const q = P(x, y); dot(g, q[0], q[1], 3.8, C.node); });
    Wd.signs.forEach(([x, y]) => { const q = P(x, y); square(g, q[0], q[1], 6.5, C.sign); });
    const lb = Wd.barriers.long_bridge_far[0], lq = P(lb[0], lb[1]);
    xmark(g, lq[0], lq[1], 11, K.red, 4.5);

    const tw = G.nodes[G.tower], tq = P(tw[0], tw[1]);
    tri(g, tq[0], tq[1], 17, A);
    label(g, tr("中央瞭望塔", "Watchtower"), tq[0], tq[1] - 34, { size: 27 });
    const tea = P(Wd.tea[0], Wd.tea[1]);
    star(g, tea[0], tea[1], 18, A);
    label(g, tr("中央深槽 · 核心终端舱", "Core Vault"), tea[0], tea[1] - 36, { size: 27 });
    d.text(tr("一号主轴活墙 W-1", "Wall W-1"), 48.4, 30.6, { size: 24, align: "right" });
    d.text(tr("白昼闭锁 08:00–19:00", "Closed 08:00–19:00"), 48.4, 35.45, { size: 22, align: "right", color: C.closeText });
    d.text(tr("二号折廊活墙 W-2 · 06:00–19:00", "Wall W-2 · 06:00–19:00"), 63.4, 41.6, { size: 23, color: C.zigText });
    d.text(tr("轨道摆渡车 09:00–17:30", "Rail shuttle 09:00–17:30"), 35.8, 44.5, { size: 23, align: "right", color: C.ferryText });
    d.text(tr("每 15 分钟一班", "every 15 min"), 35.8, 42.2, { size: 21, align: "right", color: C.ferryText });
    d.text(tr("地下暗渠", "Underground culvert"), 78.6, 17.4, { size: 23 });
    d.text(tr("高空连廊", "Skybridge"), 79.3, 57.2, { size: 23 });
    d.text(tr("机械滑轨深槽", "Mechanical trench"), 80.9, 32, { size: 22, color: K.muted, rotate: -Math.PI / 2 });
    const mz = Wd.maze.flat(), mc = mz.reduce((a, p) => [a[0] + p[0] / mz.length, a[1] + p[1] / mz.length], [0, 0]);
    d.text(tr("刀片迷阵", "Blade Sector"), mc[0], mc[1] + 8, { size: 28, color: C.woods });
    const wc = Wd.wetland.reduce((a, p) => [a[0] + p[0] / Wd.wetland.length, a[1] + p[1] / Wd.wetland.length], [0, 0]);
    d.text(tr("隔离排洪槽", "Flood basin"), wc[0], wc[1], { size: 23, color: C.wetText });
    d.text(tr("林间空地 · 地图室", "The Glade · Map Room"), Wd.plaza[0] + 2.2, Wd.plaza[1], { size: 22, align: "left", color: K.soft });
    const gateOff = { 南门: [0, 38, "center", "South gate"], 西门: [26, 0, "left", "West gate"], 东门: [-26, 0, "right", "East gate"] };
    Wd.gates.forEach(([x, y, name]) => {
      const q = P(x, y), o = gateOff[name] || [0, 30, "center", name];
      dot(g, q[0], q[1], 9, A, K.halo);
      label(g, tr(name, o[3]), q[0] + o[0], q[1] + o[1], { size: 25, weight: 700, align: o[2], pill: C.gatePill, border: A });
    });

    let y = panelHead(g, { x: 1478, y: 56, w: 400, accent: A, letter: "E", title: tr("移动迷宫", "The Shifting Maze"),
      sub: tr("约 1.0 × 0.7 km · 74 个路口", "1.0 × 0.7 km · 74 junctions") });
    y = legend(g, [["line", C.path, tr("巨墙走廊", "Maze corridor")], ["line", C.zigzag, tr("二号折廊活墙 W-2", "Sliding wall W-2")],
      ["dash", C.ferry, tr("轨道摆渡车", "Rail shuttle")], ["dash", C.underpass, tr("地下暗渠", "Culvert")],
      ["line", C.overpass, tr("高空连廊", "Skybridge")], ["hatch", [C.wet, C.wetKey], tr("隔离排洪槽", "Flood basin")],
      ["dot", C.node, tr("走廊路口", "Junction")], ["square", C.sign, tr("扇区路牌", "Sector sign")],
      ["x", K.red, tr("按周期合拢活墙", "Timed shifting wall")]], 1478, y, 400, 1);
    y = notes(g, tr("20 米高混凝土巨墙夹峙，没有全图和指南针：看周期牌、对沙盘、盯日落锁门时间。",
      "20 m concrete walls, no map or compass: read cycle boards, align the sand table, beat the sundown lockout."), 1478, y + 18, 400);
    scale(g, v, 1478, 1024, 10, "100 m");
  }

  /* ---------------------------------------------------------------- B · 冲关模式 (course_layout.js, metres; the pool is drawn with north to the right) */
  const SECTION_EN = { 1: "Warm-up pads", 2: "Hammer corridor", 3: "Spinning sweeper", 4: "Big red balls", 5: "Punch wall", 6: "Conveyor + roller",
    7: "Moving rafts", 8: "Fake tiles", 9: "Crosswind beam", 10: "Rope swing", 11: "Memory bridge", 12: "Final stage" };
  function course(g, Cd) {
    const A = K.accent || "#ff8a50";
    const C = K.light ? {
      lane: "rgba(0,113,227,.10)", route: "rgba(0,113,227,.55)", endFill: "rgba(0,113,227,.12)", deck: "#e8e8ed", deckEdge: "#6e6e73", step: "#d2d2d7",
      supF: "#ffffff", supS: "#8e8e93", move: "#e0352b", rope: "#a8834c", ropeFill: "rgba(168,131,76,.10)", wall: "#6e6e73", belt: "#e8e8ed", chevron: "#ff9f0a",
      log: "#e2cfb4", logEdge: "#a0825f", spin: "rgba(255,255,255,.9)", arm2: "#ff9f0a", fan: "#ffffff", fanEdge: "#0071e3", wind: "rgba(0,113,227,.5)",
      hub: "#ffffff", ball: "#ff5a4f", ballEdge: "#b42318", endText: "#0060c0",
    } : {
      lane: "rgba(120,190,240,.14)", route: "rgba(255,138,80,.6)", endFill: "rgba(255,138,80,.3)", deck: "#1c3043", deckEdge: "#5f8099", step: "#2c4359",
      supF: "#24425a", supS: "#7fb0d4", move: "#ff6b6b", rope: "#c9b38a", ropeFill: "rgba(201,179,138,.12)", wall: "#9fb3c2", belt: "#26313c", chevron: "#ffb74d",
      log: "#4f3d30", logEdge: "#a07a5a", spin: "rgba(36,66,90,.75)", arm2: "#ffb74d", fan: "#1c3043", fanEdge: "#9fd3ff", wind: "rgba(159,211,255,.7)",
      hub: "#ffd1d1", ball: "#e5534b", ballEdge: "#ffa59c", endText: "#ffd2bd",
    };
    backdrop(g);
    const v = fit([-11, -14, 59, 98], [40, 70, 1420, 940], true);
    const d = pen(g, v), P = v.P;
    const [px0, px1, py0, py1] = Cd.POOL;
    d.rect(px0, py0, px1, py1, K.water, K.waterEdge, 3);
    Cd.LANE_X.forEach((x) => d.line([[x, py0 + 2], [x, py1 - 2]], C.lane, 0.5 * v.s, null, "butt"));
    const route = [[0, -6], [0, 89.35], [24, 89.35], [24, 6.7], [48, 6.7], [48, 90.5]];
    d.line(route, C.route, 4, [14, 10]);
    for (let i = 0; i + 1 < route.length; i++) {
      const a = P(...route[i]), b = P(...route[i + 1]);
      arrowHead(g, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.atan2(b[1] - a[1], b[0] - a[0]), 13, A);
    }
    Cd.DECKS.forEach(([name, x0, x1, y0, y1, z, kind]) => {
      const end = kind === "start" || kind === "finish";
      d.rect(x0, y0, x1, y1, end ? C.endFill : C.deck, end ? A : C.deckEdge, 2);
    });
    Cd.STEPS.forEach(([x0, x1, y0, y1]) => d.rect(x0, y0, x1, y1, C.step, null));
    Cd.WARMUP.forEach((p) => d.circle(p.x, p.y, p.r, C.supF, C.supS, 2));
    Cd.BEAMS.forEach((b) => d.rect(b.x - b.w / 2, b.y0, b.x + b.w / 2, b.y1, C.supF, C.supS, 1.5));
    const rb = Cd.ROPE_BRIDGE;
    d.rect(rb.x - rb.w / 2, rb.y0, rb.x + rb.w / 2, rb.y1, C.ropeFill, C.rope, 2, [8, 6]);
    const pu = Cd.PUNCH;
    d.rect(pu.x_ledge - pu.ledge_w / 2, pu.y1, pu.x_ledge + pu.ledge_w / 2, pu.y0, C.supF, C.supS, 1.5);
    d.line([[pu.x_wall, pu.y1], [pu.x_wall, pu.y0]], C.wall, 5, null, "butt");
    pu.cols.forEach((y) => d.rect(pu.x_wall, y - 0.4, pu.x_wall + 0.55, y + 0.4, C.move));
    const bt = Cd.BELT;
    d.rect(bt.x - bt.w / 2, Math.min(bt.y0, bt.y1), bt.x + bt.w / 2, Math.max(bt.y0, bt.y1), C.belt, C.supS, 1.5);
    for (let y = Math.min(bt.y0, bt.y1) + 1.2; y < Math.max(bt.y0, bt.y1) - 0.6; y += 2) d.line([[bt.x - 0.6, y - 0.5], [bt.x, y + 0.3], [bt.x + 0.6, y - 0.5]], C.chevron, 2.5);
    const lg = Cd.LOG;
    d.rect(lg.x - lg.r, Math.min(lg.y0, lg.y1), lg.x + lg.r, Math.max(lg.y0, lg.y1), C.log, C.logEdge, 1.5);
    Cd.SPINNERS.forEach((sp) => {
      d.circle(sp.x, sp.y, sp.r, C.spin, C.supS, 2);
      d.line([[sp.x - sp.r * 0.95, sp.y], [sp.x + sp.r * 0.95, sp.y]], C.move, 4);
      if (sp.arms.length > 1) d.line([[sp.x, sp.y - sp.r * 0.95], [sp.x, sp.y + sp.r * 0.95]], C.arm2, 4);
    });
    Cd.RAFTS.forEach((r) => {
      const a = P(r.x - r.amp, r.y), b = P(r.x + r.amp, r.y);
      d.line([[r.x - r.amp, r.y], [r.x + r.amp, r.y]], C.move, 2.5);
      arrowHead(g, a[0], a[1], Math.atan2(a[1] - b[1], a[0] - b[0]), 9, C.move);
      arrowHead(g, b[0], b[1], Math.atan2(b[1] - a[1], b[0] - a[0]), 9, C.move);
      d.rect(r.x - Cd.RAFT / 2, r.y - Cd.RAFT / 2, r.x + Cd.RAFT / 2, r.y + Cd.RAFT / 2, C.supF, C.supS, 2);
    });
    Cd.FAKE_ROWS.forEach((y) => Cd.FAKE_COLS.forEach((x) => d.rect(x - Cd.TILE / 2, y - Cd.TILE / 2, x + Cd.TILE / 2, y + Cd.TILE / 2, C.supF, C.supS, 1.5)));
    const wd = Cd.WIND;
    d.rect(wd.x - wd.w / 2, wd.y0, wd.x + wd.w / 2, wd.y1, C.supF, C.supS, 1.5);
    wd.fans.forEach(([x, y]) => {
      d.circle(x, y, 0.8, C.fan, C.fanEdge, 2);
      [-0.6, 0, 0.6].forEach((dy) => d.line([[x + 1.1, y + dy], [x + 2.3, y + dy]], C.wind, 2));
    });
    Cd.MEM_ROWS.forEach((y) => Cd.MEM_COLS.forEach((x) => d.rect(x - Cd.MEM_TILE / 2, y - Cd.MEM_TILE / 2, x + Cd.MEM_TILE / 2, y + Cd.MEM_TILE / 2, C.supF, C.supS, 1.5)));
    const swing = Math.sin(Cd.SWING_AMP) * Cd.SWING_LEN;
    Cd.SWING.ropes.forEach(([x, y]) => { d.line([[x, y - swing], [x, y + swing]], C.move, 2.5, [6, 5]); d.circle(x, y, 0.45, C.move); });
    const reach = Cd.HAMMER_R * Math.sin(Cd.HAMMER_AMP);
    Cd.HAMMERS.forEach((h) => {
      d.line([[h.x - reach, h.y], [h.x + reach, h.y]], C.move, 3);
      [-reach, reach].forEach((dx) => d.rect(h.x + dx - 0.45, h.y - Cd.HAMMER_HEAD_L / 2, h.x + dx + 0.45, h.y + Cd.HAMMER_HEAD_L / 2, C.move));
      d.circle(h.x, h.y, 0.35, C.hub);
    });
    Cd.BALLS.forEach((b) => d.circle(b.x, b.y, Cd.BALL_R, C.ball, C.ballEdge, 2));

    const secSize = EN ? 21 : 24, placed = {};
    Cd.SECTIONS.forEach((sec) => {
      const y = (sec.y0 + sec.y1) / 2, name = tr(sec.name, SECTION_EN[sec.no] || sec.name);
      setFont(g, secSize, 600);
      const tw = g.measureText(name).width, prev = placed[sec.lane];
      let x = Cd.LANE_X[sec.lane] - 8.6, q = P(x, y);
      if (prev && prev.x === x && Math.abs(q[0] - prev.cx) < (tw + 44 + prev.w) / 2 + 10) { x -= 2.8; q = P(x, y); }
      placed[sec.lane] = { cx: q[0], w: tw + 44, x };
      const x0 = q[0] - (tw + 44) / 2;
      badge(g, x0 + 17, q[1], String(sec.no), A, 16);
      label(g, name, x0 + 44, q[1] + 1, { size: secSize, align: "left" });
    });
    const deckLabel = { 起点: ["起点", "Start"], 终点: ["终点", "Finish"], "折返台 1": ["折返台", "Turn"], "折返台 2": ["折返台", "Turn"] };
    Cd.DECKS.forEach(([name, x0, x1, y0, y1]) => {
      if (!deckLabel[name]) return;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, end = name === "起点" || name === "终点";
      d.text(tr(...deckLabel[name]), end ? cx : cx + 4, cy, { size: end ? 26 : 21, weight: end ? 800 : 600, color: end ? C.endText : K.soft });
    });

    let y = panelHead(g, { x: 1500, y: 56, w: 380, accent: A, letter: "E", title: tr("冲关模式", "Obstacle Course"),
      sub: tr("泳池 68 × 105 m · 12 道关卡", "Pool 68 × 105 m · 12 sections") });
    y = legend(g, [["fill", C.deck, tr("平台 / 检查点", "Deck / checkpoint")], ["fill", C.supF, tr("能踩的支撑", "Footing")],
      ["bar", C.move, tr("摆动、往返的障碍", "Swinging, moving obstacle")], ["dot", C.ball, tr("大红球", "Big red ball")],
      ["outline", C.rope, tr("吊桥（绕行）", "Rope bridge (detour)")], ["dash", A, tr("闯关路线", "Route")]], 1500, y, 380, 1);
    y = notes(g, tr("障碍按固定周期运动，每一步之间世界暂停，每次观察给 4 帧连拍。图上不标假踏板和记忆桥的安全路线。",
      "Obstacles move on fixed cycles. The world pauses between steps; each observation is a 4-frame burst. Fake tiles and the memory bridge’s safe path are not shown."), 1500, y + 18, 380);
    scale(g, v, 1500, 1024, 10, "10 m");
  }

  /* ---------------------------------------------------------------- C · 无尽回廊 (copied from the floor plan in loop.js; metres, B1 at z = 0) */
  const HW = 1.2;
  const LOOP = {
    rooms: [["lobby", -4.5, -4.5, 4.5, 4.5], ["vest", -7.7, -HW, -4.7, HW], ["A1", -HW, 4.7, HW, 15], ["A2", -HW, 15, HW, 31],
      ["K1", -4.2, 31, 3.8, 38], ["B", 3.8, 32.8, 26.2, 35.2], ["K2", 26.2, 31, 34.2, 38], ["C2", 28.8, 13.2, 31.2, 31],
      ["C1", 28.8, HW, 31.2, 13.2], ["K3", 28.8, -HW, 31.2, HW], ["S", 26, -HW, 28.8, HW]],
    passages: [[-0.8, 4.5, 0.8, 4.7], [4.5, -0.8, 4.7, 0.8], [-4.7, -0.55, -4.5, 0.55], [-7.9, -0.55, -7.7, 0.55], [31.2, -0.55, 31.4, 0.55]],
    ctrlD: [4.7, -HW, 26, HW],
    b3: [-7.7, -HW, 31.2, HW],
    stairW: [-14.1, -1.5, -7.9, 1.5], stairE: [31.4, -1.5, 37.6, 1.5],
    doors: [["茶水间", "Pantry", -HW, 12, "W"], ["办公室 B1-03", "Office B1-03", HW, 24, "E"], ["办公室 B1-05", "Office B1-05", 11, 35.2, "N"],
      ["会议室", "Meeting room", 21, 32.8, "S"], ["档案室", "Archive", 31.2, 29, "E"], ["打印室", "Print room", 28.8, 15, "W"]],
    b3doors: [["水泵房", "Pump room", -2, HW, "N"], ["配电间", "Switch room", 10, HW, "N"], ["储藏室", "Storeroom", 16, -HW, "S"], ["排风机房", "Fan room", 24, HW, "N"]],
  };
  function loop(g) {
    const A = K.accent || "#e4c766", B3DY = -13;
    const C = K.light ? {
      floor: "#ffffff", hall: "#fafafc", edge: "#1d1d1f", shut: "#ff9500", ctrlFill: "rgba(0,0,0,.02)", ctrlEdge: "#aeaeb2", ctrlKey: "#8e8e93",
      stair: "#e8e8ed", stairEdge: "#8e8e93", stairHatch: "rgba(0,0,0,.16)", fire: "#6e6e73", seamText: "#c4161c", shutText: "#b35900", panelText: "#0060c0",
      door: "#1d1d1f", b3: "#f0f0f3", b3Edge: "#6e6e73", flood: "rgba(0,113,227,.22)", floodKey: "rgba(0,113,227,.45)", sand: "#c8a77d", floodText: "#0060c0",
      b3door: "#6e6e73", link: "#aeaeb2", okFill: "rgba(0,113,227,.07)", okEdge: "rgba(0,113,227,.45)", rowFill: "#ffffff", rowEdge: "#d2d2d7", zig: "#aeaeb2",
    } : {
      floor: "#2a2615", hall: "#332e19", edge: "rgba(228,199,102,.75)", shut: "#ff9b50", ctrlFill: "rgba(255,255,255,.025)", ctrlEdge: "rgba(160,175,185,.45)",
      ctrlKey: "rgba(160,175,185,.7)", stair: "#18212a", stairEdge: "#8796a3", stairHatch: "rgba(135,150,163,.4)", fire: "#9aa9b5", seamText: "#ff8a8a",
      shutText: "#ffc08a", panelText: "#f3dc8a", door: A, b3: "#1d2125", b3Edge: "rgba(180,190,200,.55)", flood: "rgba(60,140,255,.38)",
      floodKey: "rgba(60,140,255,.6)", sand: "#a08a6a", floodText: "#cfe6ff", b3door: "#b8c4cc", link: "rgba(185,198,206,.6)",
      okFill: "rgba(228,199,102,.14)", okEdge: "rgba(228,199,102,.6)", rowFill: "rgba(255,255,255,.04)", rowEdge: "rgba(255,255,255,.14)", zig: "rgba(185,198,206,.45)",
    };
    backdrop(g);
    const v = fit([-16, -18, 39.5, 39.5], [40, 50, 1000, 980]);
    const d = pen(g, v), P = v.P;
    const box = (r, fill, stroke, lw, dash, dy) => d.rect(r[0], r[1] + (dy || 0), r[2], r[3] + (dy || 0), fill, stroke, lw, dash);
    const stair = (r, dy, dash) => {
      box(r, C.stair, C.stairEdge, 2, dash, dy);
      for (let x = r[0] + 1.5; x < r[2] - 1.5; x += 0.42) d.line([[x, r[1] + 0.25 + (dy || 0)], [x, r[3] - 0.25 + (dy || 0)]], C.stairHatch, 1.2);
    };

    box(LOOP.ctrlD, C.ctrlFill, C.ctrlEdge, 2, [10, 8]);
    stair(LOOP.stairW); stair(LOOP.stairE);
    LOOP.rooms.forEach(([id, ...r]) => box(r, id === "lobby" || id[0] === "K" ? C.hall : C.floor, null));
    LOOP.passages.forEach((r) => box(r, C.floor, null));
    LOOP.rooms.forEach(([id, ...r]) => box(r, null, C.edge, 2.5));
    LOOP.passages.forEach((r) => box([r[0] - 0.02, r[1] + 0.04, r[2] + 0.02, r[3] - 0.04], C.floor, null));
    [[-4.6, 0], [-7.8, 0], [31.3, 0]].forEach(([x, y]) => d.line([[x, y - 0.55], [x, y + 0.55]], C.fire, 4, null, "butt"));

    const a = P(26, 0), b = P(4.7, 0), c1 = P(22, -5.4), c2 = P(9, -5.4);
    g.save(); g.strokeStyle = K.red; g.lineWidth = 3.5; g.setLineDash([12, 8]);
    g.beginPath(); g.moveTo(a[0], a[1]); g.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], b[0], b[1]); g.stroke(); g.restore();
    arrowHead(g, b[0] + 5, b[1] + 8, Math.atan2(b[1] - c2[1], b[0] - c2[0]), 14, K.red);
    d.text(tr("从这里出去，就是电梯厅东门", "Opens into the lobby"), 15.3, -5.9, { size: EN ? 23 : 25, color: C.seamText, weight: 700 });
    d.text(tr("右转三次回到原点", "Three right turns, you’re back"), 15.3, -7.5, { size: 21, color: C.seamText });
    d.text(tr("对照楼层：这里是一条 24 m 的走廊", "Control floor: a 24 m corridor here"), 15.6, 0, { size: 20, color: K.muted, halo: false });

    d.line([[-0.8, 4.6], [0.8, 4.6]], C.shut, 6, null, "butt");
    d.line([[4.6, -0.8], [4.6, 0.8]], C.shut, 6, null, "butt");
    d.text(tr("两道卷帘互锁", "Interlocked shutters"), 5.5, 3.3, { size: 21, align: "left", color: C.shutText });
    const pq = P(2.55, 4.0);
    square(g, pq[0], pq[1], 7, A, K.light ? "#ffffff" : "#0b0f12");
    d.text(tr("配电箱", "Breaker panel"), 2.1, 6.1, { size: 21, align: "left", color: C.panelText });
    d.line([[28.8, 20.8], [31.2, 20.8]], C.shut, 5, [6, 4], "butt");
    d.text(tr("卷帘", "Shutter"), 32.4, 20.8, { size: 21, align: "left", color: C.shutText });
    d.text(tr("电梯厅", "Lobby"), 0, 0.9, { size: 28, weight: 800 });
    d.text(tr("值班台", "duty desk"), 0, -1.1, { size: 21, color: K.soft });
    d.text(tr("电梯（检修中）", "Lift (out of order)"), 0, -5.6, { size: 20, color: K.muted });
    LOOP.doors.forEach(([zh, en, x, y, side]) => {
      const off = { W: [-0.7, 0, "right"], E: [0.7, 0, "left"], N: [0, 0.9, "center"], S: [0, -0.9, "center"] }[side];
      const t = side === "W" || side === "E" ? [[x, y - 0.5], [x, y + 0.5]] : [[x - 0.5, y], [x + 0.5, y]];
      d.line(t, C.door, 5, null, "butt");
      d.text(tr(zh, en), x + off[0], y + off[1], { size: 22, align: off[2], color: K.soft });
    });
    d.text(tr("西楼梯", "West stairs"), -11, 2.5, { size: 23, weight: 700 });
    d.text(tr("东楼梯", "East stairs"), 34.5, 2.5, { size: 23, weight: 700 });

    box(LOOP.b3, C.b3, C.b3Edge, 2.5, null, B3DY);
    stair(LOOP.stairW, B3DY, [8, 6]); stair(LOOP.stairE, B3DY);
    d.rect(-7.7, -HW + B3DY, 5.75, HW + B3DY, C.flood, null);
    d.rect(5.2, -HW + B3DY, 5.75, HW + B3DY, C.sand, null);
    d.text(tr("积水", "Flood"), -0.9, B3DY, { size: 21, color: C.floodText, halo: false });
    LOOP.b3doors.forEach(([zh, en, x, y, side]) => {
      d.line([[x - 0.5, y + B3DY], [x + 0.5, y + B3DY]], C.b3door, 5, null, "butt");
      d.text(tr(zh, en), x, y + B3DY + (side === "N" ? 0.95 : -0.95), { size: 21, color: K.soft });
    });
    const bq = P(8.2, 0.9 + B3DY);
    square(g, bq[0], bq[1], 6, C.b3door, K.light ? "#ffffff" : "#0b0f12");
    d.line([[31.3, -0.55 + B3DY], [31.3, 0.55 + B3DY]], C.shut, 5, null, "butt");
    d.line([[-7.8, -0.55 + B3DY], [-7.8, 0.55 + B3DY]], K.red, 5, null, "butt");
    d.text("B3", -11, B3DY + 2.7, { size: 28, mono: true, weight: 800, color: K.soft });
    d.line([[34.5, -1.7], [34.5, -11.3]], C.link, 2.5, [8, 6]);
    d.text(tr("下两层", "two floors down"), 33.9, -5.7, { size: 20, align: "right", color: K.soft });
    d.text(tr("B2 锁着", "B2 locked"), 33.9, -7.4, { size: 20, align: "right", color: K.muted });

    let y = panelHead(g, { x: 1090, y: 56, w: 790, accent: A, letter: "B", title: tr("无尽回廊 · B1 夜班层", "Endless Corridor · B1 night shift"),
      sub: tr("回字形走廊 · 两座楼梯 · 下面还有 B3（实验楼层）", "A ring corridor, two stairwells and B3 below (experimental floor)") });
    label(g, tr("楼梯剖面", "Stair section"), 1090, y, { size: 24, weight: 700, align: "left", halo: false, color: A });
    y += 34;
    const rows = (x, list, title) => {
      label(g, title, x, y + 4, { size: 23, weight: 700, align: "left", halo: false });
      list.forEach(([lv, text, kind], i) => {
        const ry = y + 34 + i * 74;
        roundRect(g, x, ry, 360, 52, 10);
        g.fillStyle = kind === "ok" ? C.okFill : C.rowFill; g.fill();
        g.strokeStyle = kind === "ok" ? C.okEdge : C.rowEdge; g.lineWidth = 2; g.stroke();
        label(g, lv, x + 22, ry + 27, { size: 24, mono: true, weight: 800, align: "left", halo: false, color: kind === "ok" ? A : K.soft });
        label(g, text, x + 86, ry + 27, { size: 21, align: "left", halo: false, color: kind === "lock" ? K.muted : K.soft, weight: 500 });
        if (i) {
          g.save(); g.strokeStyle = C.zig; g.lineWidth = 2; g.beginPath();
          g.moveTo(x + 180, ry - 22); g.lineTo(x + 196, ry - 15); g.lineTo(x + 164, ry - 8); g.lineTo(x + 180, ry - 1); g.stroke(); g.restore();
        }
      });
    };
    rows(1090, [["B1", tr("门通回廊", "door to the ring"), "ok"], ["B1", tr("门打不开", "door won’t open"), "dead"], ["B1", tr("门打不开", "door won’t open"), "dead"],
      ["B1", tr("……一直往下", "…all the way down"), "dead"]], tr("西楼梯", "West stairs"));
    rows(1500, [["1F", tr("铁栅门锁着", "gate locked"), "lock"], ["B1", tr("门通回廊", "door to the ring"), "ok"], ["B2", tr("设备层，锁着", "plant floor, locked"), "lock"],
      ["B3", tr("门通 B3 走廊", "door to B3 corridor"), "ok"]], tr("东楼梯", "East stairs"));
    y += 34 + 4 * 74 + 18;
    y = notes(g, tr("西楼梯每往下走一层，门牌上都还是 B1。对照楼层的回廊有正常的第四条边，两座楼梯都通到 B3。",
      "Every flight down the west stairs, the sign still says B1. On the control floor the ring has an ordinary fourth side and both stairs reach B3."), 1090, y, 790, K.soft);
    y = legend(g, [["fill", C.floor, tr("走廊 / 房间", "Corridor / room")], ["bar", C.shut, tr("防火卷帘、单向门", "Fire shutter, one-way door")],
      ["fill", C.floodKey, tr("积水（抽水任务）", "Flood (pump task)")], ["square", A, tr("配电箱", "Breaker panel")],
      ["dash", K.red, tr("回廊的「开口」", "The ring’s “opening”")], ["outline", C.ctrlKey, tr("只在对照楼层", "Control floor only")]], 1090, y + 22, 790, 2);
    scale(g, v, 1090, 1030, 5, "5 m");
  }

  /* ---------------------------------------------------------------- D · 雾岭疗养院 (sanatorium/game/data/level.json, metres) */
  function sana(g, L) {
    const A = K.accent || "#ef6b6b";
    const C = K.light ? {
      major: "rgba(0,0,0,.13)", minor: "rgba(0,0,0,.05)", grass: "#e2eedf", leaves: "#e9ece0", plank: "#efe6da", court: "#ebebef", front: "#e8e8ed",
      bldg: { old: "#e8e1de", rotunda: "#e0d6d3", service: "#e6e2e8", new: "#e3e0ea", boiler: "#e7dfd6" }, bldgDef: "#e6e1e1",
      hillShadow: null, hill: "#6e6e73", tubeBand: "#d8d8de", tube: "#6e6e73", ext: "#1d1d1f", int: "#aeaeb2", hide: "#8e8e93", safe: "#30a46c",
      oneway: "#ff9500", courtText: "#2f6b3e", tunnelText: "#424245", hillText: "#424245", mark: "#ffffff", contourKey: "rgba(0,0,0,.3)",
    } : {
      major: "rgba(214,170,176,.17)", minor: "rgba(214,170,176,.07)", grass: "#16231a", leaves: "#1c2216", plank: "#2a231c", court: "#20232a", front: "#22242a",
      bldg: { old: "#2c2124", rotunda: "#36262b", service: "#2a2329", new: "#2d2632", boiler: "#2c231e" }, bldgDef: "#2a2427",
      hillShadow: "rgba(0,0,0,.5)", hill: "#c8b48e", tubeBand: "rgba(20,14,16,.85)", tube: "#9c7f84", ext: "#c9b0b4", int: "rgba(160,135,140,.55)",
      hide: "#c98d93", safe: "#7fd1a8", oneway: "#ffb74d", courtText: "#a9c9b2", tunnelText: "#d8b9be", hillText: "#d9c9a8", mark: "#0b0f12",
      contourKey: "rgba(214,170,176,.5)",
    };
    backdrop(g);
    const v = fit([-122, -92, 66, 86], [36, 40, 1040, 1000]);
    const d = pen(g, v), P = v.P;
    const T = L.terrain, hz = (i, j) => T.h[j * T.nx + i] / 20;
    g.save(); g.beginPath(); g.rect(v.rect[0], v.rect[1], v.rect[2], v.rect[3]); g.clip();
    let lo = Infinity, hi = -Infinity;
    T.h.forEach((z) => { lo = Math.min(lo, z / 20); hi = Math.max(hi, z / 20); });
    for (let lvl = Math.ceil(lo); lvl <= hi; lvl += 1) {
      const major = lvl % 5 === 0;
      g.strokeStyle = major ? C.major : C.minor; g.lineWidth = major ? 1.6 : 1;
      g.beginPath();
      for (let j = 0; j < T.ny - 1; j++) for (let i = 0; i < T.nx - 1; i++) {
        const c = [hz(i, j), hz(i + 1, j), hz(i + 1, j + 1), hz(i, j + 1)];
        const xy = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
        const cut = [];
        for (let k = 0; k < 4; k++) {
          const za = c[k], zb = c[(k + 1) % 4];
          if ((za < lvl) !== (zb < lvl)) {
            const t = (lvl - za) / (zb - za), p0 = xy[k], p1 = xy[(k + 1) % 4];
            cut.push(P(T.x0 + (p0[0] + (p1[0] - p0[0]) * t) * T.res, T.y0 + (p0[1] + (p1[1] - p0[1]) * t) * T.res));
          }
        }
        for (let k = 0; k + 1 < cut.length; k += 2) { g.moveTo(cut[k][0], cut[k][1]); g.lineTo(cut[k + 1][0], cut[k + 1][1]); }
      }
      g.stroke();
    }
    g.restore();

    const PLAN = { A1: 1, R1: 1, S1: 1, Y: 1, F: 1, N1: 1, B: 1 };
    const fillOf = (f) => {
      if (f.lv === "Y") return { grass: C.grass, leaves: C.leaves, plank: C.plank }[f.mat] || C.court;
      if (f.lv === "F") return C.front;
      return C.bldg[L.levels[f.lv].b] || C.bldgDef;
    };
    L.floors.filter((f) => PLAN[f.lv]).forEach((f) => d.poly(f.poly, fillOf(f), null));
    const tube = L.tubes.find((t) => t.style === "chute"), under = L.tubes.find((t) => t.style === "underpass");
    const hill = L.paths[0].pts;
    if (C.hillShadow) d.line(hill, C.hillShadow, 9);
    d.line(hill, C.hill, 3.5, [2, 9]);
    [tube, under].forEach((t) => { d.line(t.pts, C.tubeBand, t.w * v.s + 6); d.line(t.pts, C.tube, 3, [12, 8]); });
    const wallZ = { 20: 1, 22.7: 1, 4.5: 1 };
    L.walls.forEach((w) => {
      if (w.k === "plinth") return;
      const base = Math.round((w.z0 + 0.3) * 10) / 10, base2 = Math.round(w.z0 * 10) / 10;
      if (!wallZ[base] && !wallZ[base2]) return;
      d.line([w.a, w.b], w.k === "ext" ? C.ext : C.int, w.k === "ext" ? (K.light ? 2.2 : 2.6) : 1.3, null, "butt");
    });
    const node = {};
    L.nav.nodes.forEach((n) => (node[n.id] = n));
    L.nav.nodes.filter((n) => n.k === "hide").forEach((n) => { const q = P(n.p[0], n.p[1]); square(g, q[0], q[1], 5, C.hide, C.mark); });
    L.nav.safes.forEach((sf) => { const n = node[sf.node], q = P(n.p[0], n.p[1]); square(g, q[0], q[1], 9, C.safe, C.mark); });
    L.doors.filter((o) => o.k === "oneway").forEach((o) => {
      const q = P(o.p[0], o.p[1]);
      arrowHead(g, q[0], q[1], -o.r * Math.PI / 180, 12, C.oneway);
    });
    const tubeLen = tube.pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - tube.pts[i - 1][0], p[1] - tube.pts[i - 1][1], p[2] - tube.pts[i - 1][2]) : 0), 0);

    const labelAt = (lv, text, dx, dy, o) => {
      const pts = L.floors.filter((f) => f.lv === lv).flatMap((f) => f.poly);
      const c = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]);
      d.text(text, c[0] + (dx || 0), c[1] + (dy || 0), Object.assign({ size: 26, weight: 700 }, o || {}));
    };
    labelAt("A1", tr("老楼 · 1934", "Old wing · 1934"), 2, -4, { rotate: -0.35 });
    labelAt("R1", tr("圆厅", "Rotunda"), 0, 0, { size: EN ? 23 : 26 });
    labelAt("S1", tr("服务翼", "Service wing"), 3, -3);
    labelAt("Y", tr("庭院", "Courtyard"), -2, 2, { color: C.courtText });
    labelAt("N1", tr("新楼 · 1992", "New wing · 1992"), 0, 0);
    d.text(tr("前庭车道", "Front drive"), 0, -36, { size: 22, color: K.soft });
    d.text(tr("锅炉房", "Boiler house"), -90, -84.5, { size: 23, weight: 700 });
    d.text(tr(`运尸隧道 · 地下 ${Math.round(tubeLen)} m`, `Body chute · ${Math.round(tubeLen)} m underground`), -66, 10, { size: EN ? 21 : 22, color: C.tunnelText, rotate: -1.08 });
    d.text(tr("后山石阶", "Hillside steps"), -50.5, 4, { size: 21, color: C.hillText, rotate: -1.18 });

    const pins = [
      ["1", node.Y_start.p, tr("起点：围墙破洞", "Start: a gap in the wall")],
      ["2", L.nav.items.find((it) => it.key === "sister").p, tr("妹妹：新楼 3F 的 307", "Your sister: room 307, new wing 3F")],
      ["3", L.nav.items.find((it) => it.key === "fuse").p, tr("保险丝：服务翼旧手术室", "Fuse: old operating theatre, service wing")],
      ["4", L.nav.items.find((it) => it.key === "power").p, tr("锅炉房配电柜：装上保险丝恢复供电", "Boiler-house panel: fit the fuse, restore power")],
      ["5", node.B_gate.p, tr("后门（电动）：恢复供电才能开", "Back gate (electric): needs power")],
      ["6", L.nav.items.find((it) => it.key === "K1").p, tr("大门钥匙：新楼 6F 院长办公室", "Gate key: director’s office, new wing 6F")],
      ["7", L.doors.find((o) => o.id === "R1_s>F_drive").p, tr("正门：铁链锁着，要大门钥匙", "Main door: chained, needs the gate key")],
      ["8", L.doors.find((o) => o.id === "N1_north").p, tr("新楼北门：锁死了，绿色出口线骗了你", "New wing north door: locked. The green exit line lies.")],
    ];
    const nudge = { 4: [10, 14], 5: [-14, -12], 6: [12, -10], 8: [-14, -6] };
    pins.forEach(([n, p]) => { const q = P(p[0], p[1]), o = nudge[n] || [0, 0]; badge(g, q[0] + o[0], q[1] + o[1], n, A, 15); });

    let y = panelHead(g, { x: 1120, y: 56, w: 760, accent: A, letter: "C", title: tr("雾岭疗养院（夜）", "Misty Ridge Sanatorium"),
      sub: tr("4 栋楼 · B1–6F · 33 条独立环路 · 19 个藏身点", "4 buildings · B1–6F · 33 independent loops · 19 hiding places") });
    pins.forEach(([n, , text]) => {
      badge(g, 1136, y, n, A, 15);
      label(g, text, 1170, y + 1, { size: EN ? 23 : 24, align: "left", halo: false, color: K.soft, weight: 500 });
      y += 46;
    });
    y = legend(g, [["fill", C.bldg.old, tr("楼体首层平面", "Ground-floor plan")], ["line", C.ext, tr("外墙", "Exterior wall")],
      ["dash", C.tube, tr("运尸隧道（地下）", "Body chute")], ["dots", C.hill, tr("后山石阶", "Hillside steps")],
      ["square", C.hide, tr("藏身点", "Hiding place")], ["square", C.safe, tr("安全屋（广播室、小教堂）", "Safe room")],
      ["tri", C.oneway, tr("单向门", "One-way door")], ["line", C.contourKey, tr("等高线（5 m 一根粗线）", "Contours, bold every 5 m")]], 1120, y + 26, 760, 2);
    scale(g, v, 1120, 1030, 20, "20 m");
  }

  /* ---------------------------------------------------------------- E · 旧宅翻新 (renovate_layout.js, metres) */
  const ROOM_EN = { kitchen: "Kitchen", hall: "Hall", bath: "Bathroom", living: "Living room", master: "Main bedroom", second: "Second bedroom" };
  const FURN = { counter: ["橱柜", "Counter"], fridge: ["冰箱", "Fridge"], box: ["瓷砖", "Tiles"], cabinet: ["鞋柜", "Shoes"], bin: ["垃圾桶", "Bin"],
    toilet: ["马桶", "WC"], tub: ["浴缸", "Bath"], sink: ["洗手池", "Sink"], tv: ["电视柜", "TV"], sofa: ["沙发", "Sofa"], bed: ["床", "Bed"], wardrobe: ["衣柜", "Wardrobe"] };
  function renovate(g, R) {
    const A = K.accent || "#e0a96d";
    const C = K.light ? {
      lb: "#1d1d1f", part: "#aeaeb2", floors: { wood: "#f3ece3", tiles: "#edf0f3", terrazzo: "#efeff1" }, floorDef: "#f0f0f0", furnFill: "#ffffff",
      furnEdge: "#c7c7cc", movFill: "rgba(0,113,227,.07)", furnText: "#8e8e93", plant: "#d3e6cc", plantEdge: "#6f9a6f", targetFill: "rgba(0,113,227,.10)",
      glass: "#ffffff", win: "#80b8f1", doorArc: "#aeaeb2", targetText: "#0060c0", roomText: "#1d1d1f", dim: "#aeaeb2", dimTick: "#8e8e93", entryText: "#0060c0",
    } : {
      lb: "#e2cfae", part: "#8b8073", floors: { wood: "#2a2119", tiles: "#1e2529", terrazzo: "#25252a" }, floorDef: "#232323", furnFill: "rgba(255,255,255,.05)",
      furnEdge: "#7d6f60", movFill: "rgba(224,169,109,.14)", furnText: "#b3a493", plant: "#3e5f3e", plantEdge: "#6f9a6f", targetFill: "rgba(224,169,109,.18)",
      glass: "#0d1a24", win: "#8cc8ff", doorArc: "rgba(226,207,174,.55)", targetText: "#ffd2a1", roomText: "#f1e6d6", dim: "rgba(185,198,206,.6)",
      dimTick: "rgba(185,198,206,.8)", entryText: "#ffd2a1",
    };
    backdrop(g);
    const v = fit([-1.6, -1.9, 12.6, 9.1], [40, 40, 1340, 1000]);
    const d = pen(g, v), P = v.P;
    R.ROOMS.forEach((r) => d.rect(r.r[0], r.r[1], r.r[2], r.r[3], C.floors[r.floor] || C.floorDef, null));
    R.FURN.forEach((f) => {
      d.rect(f.r[0], f.r[1], f.r[2], f.r[3], f.movable ? C.movFill : C.furnFill, f.movable ? A : C.furnEdge, 2, f.movable ? [7, 5] : null);
      const w = (f.r[2] - f.r[0]) * v.s, h = (f.r[3] - f.r[1]) * v.s, name = FURN[f.kind] ? tr(...FURN[f.kind]) : "";
      const vert = h > w * 1.6 && w < 70;
      if (Math.max(w, h) > 54) d.text(name, (f.r[0] + f.r[2]) / 2, (f.r[1] + f.r[3]) / 2, { size: 19, color: C.furnText, halo: false, rotate: vert ? -Math.PI / 2 : 0 });
    });
    (R.DECOR || []).filter((o) => o.kind === "plant").forEach((o) => d.circle(o.p[0], o.p[1], 0.22, C.plant, C.plantEdge, 1.5));

    R.WALLS.forEach((wl) => {
      const t = wl.t, along = (u0, u1) => (wl.ax === "x" ? [u0, wl.c - t / 2, u1, wl.c + t / 2] : [wl.c - t / 2, u0, wl.c + t / 2, u1]);
      const gaps = (wl.ops || []).map((o) => [o.at - o.w / 2, o.at + o.w / 2, o]).sort((p, q) => p[0] - q[0]);
      const segs = [];
      let u = wl.s[0];
      gaps.forEach(([g0, g1]) => { if (g0 > u) segs.push([u, g0]); u = g1; });
      if (u < wl.s[1]) segs.push([u, wl.s[1]]);
      const target = wl.id === "KL";
      segs.forEach(([u0, u1]) => {
        const r = along(u0, u1);
        if (target) d.rect(r[0], r[1], r[2], r[3], C.targetFill, A, 3, [9, 6]);
        else d.rect(r[0], r[1], r[2], r[3], wl.lb ? C.lb : C.part, null);
      });
      gaps.forEach(([g0, g1, o]) => {
        const r = along(g0, g1);
        if (o.k === "win") {
          d.rect(r[0], r[1], r[2], r[3], C.glass, null);
          const m = wl.c;
          if (wl.ax === "x") { d.line([[g0, m - t / 4], [g1, m - t / 4]], C.win, 2, null, "butt"); d.line([[g0, m + t / 4], [g1, m + t / 4]], C.win, 2, null, "butt"); }
          else { d.line([[m - t / 4, g0], [m - t / 4, g1]], C.win, 2, null, "butt"); d.line([[m + t / 4, g0], [m + t / 4, g1]], C.win, 2, null, "butt"); }
        } else {
          const hinge = wl.ax === "x" ? P(g0, wl.c) : P(wl.c, g0), rr = o.w * v.s;
          const base = wl.ax === "x" ? 0 : -Math.PI / 2;
          const sweep = o.ext ? 1 : -1;
          g.save(); g.strokeStyle = C.doorArc; g.lineWidth = 2;
          g.beginPath(); g.moveTo(hinge[0], hinge[1]); g.arc(hinge[0], hinge[1], rr, base, base + sweep * Math.PI / 2, sweep < 0); g.closePath(); g.stroke();
          g.restore();
        }
      });
    });
    const kl = R.WALLS.find((w) => w.id === "KL");
    d.text(tr("要拆的隔墙", "Wall to demolish"), (kl.s[0] + kl.s[1]) / 2, kl.c + 0.42, { size: 24, weight: 700, color: C.targetText });
    const kb = R.WALLS.find((w) => w.id === "KLb");
    d.text(tr("承重", "Load-bearing"), (kb.s[0] + kb.s[1]) / 2 + (EN ? 0.25 : 0), kb.c - 0.36, { size: 20, color: K.soft });
    R.ROOMS.forEach((r) => {
      const cx = (r.r[0] + r.r[2]) / 2, cy = (r.r[1] + r.r[3]) / 2, name = tr(r.name, ROOM_EN[r.id] || r.name);
      setFont(g, 40, 800);
      const roomW = (r.r[2] - r.r[0]) * v.s * 0.84, size = Math.min(40, Math.floor((40 * roomW) / Math.max(roomW, g.measureText(name).width)));
      d.text(name, cx, cy + (r.plate ? 0.25 : 0), { size, weight: EN ? 700 : 800, color: C.roomText, display: true });
      if (r.plate) d.text(tr(`门牌「${r.plate}」`, `Door sign “${r.plate.replace("卧室", "Bedroom")}”`), cx, cy - 0.4, { size: 23, color: K.soft });
    });
    const door = R.WALLS.find((w) => (w.ops || []).some((o) => o.ext)), op = door.ops.find((o) => o.ext);
    const ea = P(op.at, door.c - 1.25), eb = P(op.at, door.c - 0.35);
    g.save(); g.strokeStyle = A; g.lineWidth = 4; g.beginPath(); g.moveTo(ea[0], ea[1]); g.lineTo(eb[0], eb[1]); g.stroke(); g.restore();
    arrowHead(g, eb[0], eb[1] + 2, -Math.PI / 2, 14, A);
    d.text(tr("入户门", "Front door"), op.at + 0.25, door.c - 0.95, { size: 23, align: "left", color: C.entryText });
    const X1 = Math.max(...R.ROOMS.map((r) => r.r[2])), Y1 = Math.max(...R.ROOMS.map((r) => r.r[3]));
    const dim = (p0, p1, text, vert) => {
      d.line([p0, p1], C.dim, 1.8, null, "butt");
      [p0, p1].forEach((p) => d.line(vert ? [[p[0] - 0.12, p[1]], [p[0] + 0.12, p[1]]] : [[p[0], p[1] - 0.12], [p[0], p[1] + 0.12]], C.dimTick, 2, null, "butt"));
      d.text(text, (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, { size: 22, mono: true, color: K.soft, rotate: vert ? -Math.PI / 2 : 0 });
    };
    dim([0, Y1 + 0.6], [X1, Y1 + 0.6], `${X1} m`);
    dim([-0.75, 0], [-0.75, Y1], `${Y1} m`, true);

    let y = panelHead(g, { x: 1420, y: 56, w: 460, accent: A, letter: "A", title: tr("旧宅翻新", "Old Flat Renovation"),
      sub: tr(`六个房间 · ${X1} × ${Y1} m`, `Six rooms · ${X1} × ${Y1} m`) });
    y = legend(g, [["fill", C.lb, tr("承重墙（不能拆）", "Load-bearing wall (keep)")], ["fill", C.part, tr("隔墙", "Partition")],
      ["outline", A, tr("工单要拆的隔墙", "Partition on the work order")], ["line", C.win, tr("窗", "Window")],
      ["fill", K.light ? "#ffffff" : "rgba(255,255,255,.12)", tr("家具", "Furniture")], ["outline", A, tr("能挪开的衣柜", "Movable wardrobe")]], 1420, y, 460, 1);
    y = notes(g, tr("施工动作只作用于准星正前方 1.5 米内。污渍、垃圾和墙色每局随机，图上不画。",
      "Tools act only on what the crosshair hits within 1.5 m. Stains, trash and wall colours are random each episode and not shown."), 1420, y + 18, 460);
    scale(g, v, 1420, 1024, 1, "1 m");
  }

  /* ---------------------------------------------------------------- E · 失踪的侦探 (detective_layout.js, metres) */
  /* Every sealed box and bookcase is drawn the same way: which one the note means is the task, not the map. */
  function detective(g, D) {
    const A = K.accent || "#e0a96d";
    const C = K.light ? { wall: "#1d1d1f", floor: "#f3ece3", landing: "#ebe6df", furnFill: "#ffffff", furnEdge: "#c7c7cc", furnText: "#8e8e93",
      movFill: "rgba(0,113,227,.07)", shelf: ["#efe7dc", "#c9b8a3"], glass: "#ffffff", win: "#80b8f1", rug: "rgba(160,60,40,.10)", lamp: "#c98a2b",
      dim: "#aeaeb2", dimTick: "#8e8e93", roomText: "#1d1d1f" }
      : { wall: "#e2cfae", floor: "#2a2119", landing: "#231c15", furnFill: "rgba(255,255,255,.05)", furnEdge: "#7d6f60", furnText: "#b3a493",
        movFill: "rgba(224,169,109,.14)", shelf: ["#2f261d", "#6b5a47"], glass: "#0d1a24", win: "#8cc8ff", rug: "rgba(200,90,60,.16)", lamp: "#ffb15a",
        dim: "rgba(185,198,206,.6)", dimTick: "rgba(185,198,206,.8)", roomText: "#f1e6d6" };
    backdrop(g);
    const [X0, Y0, X1, Y1] = D.ROOM, T = 0.3, door = D.DOOR;
    const v = fit([X0 - 1.0, Y0 - 1.25, X1 + 0.7, Y1 + 0.95], [40, 40, 1340, 1000]);
    const d = pen(g, v), P = v.P;
    d.rect(X0, Y0, X1, Y1, C.floor, null);
    d.rect(door.x0, Y0 - 0.73, door.x1, Y0, C.landing, null);
    d.rect(-1.89, 0.06, 1.99, 2.16, C.rug, null);
    D.SOLIDS.filter((s) => !s.wall).forEach((s) => {
      const [x0, y0, x1, y1] = s.box.map((c, i) => (i % 2 ? Math.min(Math.max(c, Y0), Y1) : Math.min(Math.max(c, X0), X1)));
      if (s.id.startsWith("shelf")) d.hatch([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], C.shelf[0], C.shelf[1], 10);
      d.rect(x0, y0, x1, y1, s.id.startsWith("shelf") ? null : s.move ? C.movFill : C.furnFill, s.move ? A : C.furnEdge, 2, s.move ? [7, 5] : null);
      const name = tr(s.name[0], s.name[1]), w = (x1 - x0) * v.s, h = (y1 - y0) * v.s;
      if (name && Math.max(w, h) > 50) d.text(name, (x0 + x1) / 2, (y0 + y1) / 2, { size: 19, color: C.furnText, halo: false, rotate: h > w * 1.6 && w < 70 ? -Math.PI / 2 : 0 });
    });
    const Tg = D.TARGETS;
    ["lantern", "brazierW", "brazierE"].forEach((id) => { const q = P(Tg[id].at[0], Tg[id].at[1]); dot(g, q[0], q[1], 9, C.lamp, K.halo); });
    ["caseW", "caseN"].forEach((id) => {
      const q = P(Tg[id].at[0], Tg[id].at[1]);
      g.save(); g.setLineDash([6, 5]); g.strokeStyle = K.soft; g.lineWidth = 2.5; g.beginPath(); g.arc(q[0], q[1], 0.42 * v.s, 0, TAU); g.stroke(); g.restore();
      label(g, tr("高处展柜", "High case"), q[0], q[1] - 0.62 * v.s, { size: 19, color: K.soft });
    });
    Object.values(Tg).filter((t) => t.box).forEach((t) => { const q = P(t.at[0], t.at[1]); square(g, q[0], q[1], 9, A, K.halo); });

    // walls, the window bays between the piers, the clue wall and the stone door
    d.rect(X0 - T, Y0 - T, X0, Y1 + T, C.wall, null);
    d.rect(X1, Y0 - T, X1 + T, Y1 + T, C.wall, null);
    d.rect(X0 - T, Y1, X1 + T, Y1 + T, C.wall, null);
    d.rect(X0 - T, Y0 - T, door.x0, Y0, C.wall, null);
    d.rect(door.x1, Y0 - T, X1 + T, Y0, C.wall, null);
    D.WINDOWS.forEach(([a, b]) => [[X0 - T, X0], [X1, X1 + T]].forEach(([w0, w1]) => {
      d.rect(w0, a, w1, b, C.glass, null);
      d.line([[w0 + T / 4, a], [w0 + T / 4, b]], C.win, 2, null, "butt");
      d.line([[w1 - T / 4, a], [w1 - T / 4, b]], C.win, 2, null, "butt");
    }));
    d.line([[D.CLUE_WALL[0], Y1 - 0.06], [D.CLUE_WALL[1], Y1 - 0.06]], A, 7, null, "butt");
    d.text(tr("线索墙", "Clue wall"), (D.CLUE_WALL[0] + D.CLUE_WALL[1]) / 2, Y1 - 0.42, { size: 22, weight: 700, color: A });
    d.text(tr("事务所", "The office"), 0.2, -1.2, { size: 40, weight: EN ? 700 : 800, color: C.roomText, display: true });
    const ea = P((door.x0 + door.x1) / 2, Y0 - 1.15), eb = P((door.x0 + door.x1) / 2, Y0 - 0.3);
    g.save(); g.strokeStyle = A; g.lineWidth = 4; g.beginPath(); g.moveTo(ea[0], ea[1]); g.lineTo(eb[0], eb[1]); g.stroke(); g.restore();
    arrowHead(g, eb[0], eb[1] + 2, -Math.PI / 2, 14, A);
    d.text(tr("石门", "Stone door"), door.x1 + 0.2, Y0 - 0.85, { size: 23, align: "left", color: A });
    const dim = (p0, p1, text, vert) => {
      d.line([p0, p1], C.dim, 1.8, null, "butt");
      [p0, p1].forEach((p) => d.line(vert ? [[p[0] - 0.12, p[1]], [p[0] + 0.12, p[1]]] : [[p[0], p[1] - 0.12], [p[0], p[1] + 0.12]], C.dimTick, 2, null, "butt"));
      d.text(text, (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, { size: 22, mono: true, color: K.soft, rotate: vert ? -Math.PI / 2 : 0 });
    };
    const wx = Math.round((X1 - X0) * 10) / 10, wy = Math.round((Y1 - Y0) * 10) / 10;
    dim([X0, Y1 + 0.65], [X1, Y1 + 0.65], `${wx} m`);
    dim([X0 - 0.7, Y0], [X0 - 0.7, Y1], `${wy} m`, true);

    let y = panelHead(g, { x: 1420, y: 56, w: 460, accent: A, letter: "D", title: tr("失踪的侦探", "The Missing Detective"),
      sub: tr(`一间事务所 · ${wx} × ${wy} m`, `One office · ${wx} × ${wy} m`) });
    y = legend(g, [["fill", C.wall, tr("墙", "Wall")], ["line", C.win, tr("窗", "Window")],
      ["fill", K.light ? "#ffffff" : "rgba(255,255,255,.12)", tr("家具", "Furniture")], ["outline", A, tr("能挪开的家具", "Can be moved aside")],
      ["hatch", C.shelf, tr("封蜡的书架", "Sealed bookcase")], ["square", A, tr("封蜡的盒子", "Sealed box")], ["dot", C.lamp, tr("提灯和火盆", "Lamp and braziers")]], 1420, y, 460, 1);
    y = notes(g, tr("动作只作用于准星正前方约 2 米内。每只盒子、每座书架都封了蜡，开错一处，这一局就结束；图上不标哪一只是对的。",
      "Actions reach about 2 m past the crosshair. Every box and bookcase is sealed: open the wrong one and the episode ends. The map does not say which one is right."), 1420, y + 18, 460);
    scale(g, v, 1420, 1024, 1, "1 m");
  }

  /* ---------------------------------------------------------------- entry points */
  const draw = {
    park: (g) => park(g, window.WORLD),
    course: (g) => course(g, window.SA_COURSE),
    loop: (g) => loop(g),
    sana: (g) => sana(g, window.SANA_LEVEL),
    renovate: (g) => renovate(g, window.SA_RENO),
    detective: (g) => detective(g, window.SA_DETECTIVE),
  };
  /* opts: { theme: "dark" | "light", lang: "zh" | "en" }; defaults to the dark Chinese maps. */
  function canvas(name, opts) {
    opts = opts || {};
    K = THEMES[opts.theme] || THEMES.dark;
    EN = opts.lang === "en";
    F = EN ? FONTS.en : FONTS.zh;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    draw[name](c.getContext("2d"));
    return c;
  }
  window.SAMaps = { draw, canvas, ready: false, jpeg: (name, q, opts) => canvas(name, opts).toDataURL("image/jpeg", q || 0.9) };
})();
