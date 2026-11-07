/* Space Track · rendering helpers shared by the mall and city pages: offline textures, box-projected reflection probes,
   shop interiors behind glass, leaf-card trees and light halos. */
(function () {
  "use strict";
  const G = (window.SAGfx = {});
  const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
  function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

  /* Textures listed in window.SA_TEX (blender/urban_textures.py). `get` returns one shared texture per key and
     metres-per-repeat; `ready` resolves once every requested image has loaded. */
  G.textures = function (renderer) {
    const TD = (window.SA_TEX && window.SA_TEX.tex) || {};
    const manager = new THREE.LoadingManager();
    const loader = new THREE.TextureLoader(manager);
    const aniso = renderer.capabilities.getMaxAnisotropy();
    const cache = {};
    let requested = 0, resolve;
    const ready = new Promise((r) => (resolve = r));
    manager.onLoad = () => resolve();
    function get(key, metres, linear) {
      if (!TD[key]) return null;
      const id = key + "|" + (metres || 1);
      if (cache[id]) return cache[id];
      requested += 1;
      const t = loader.load(TD[key]);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = linear || /_(n|r)$/.test(key) ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      t.anisotropy = aniso;
      if (metres) t.repeat.set(1 / metres, 1 / metres);
      cache[id] = t;
      return t;
    }
    return { get, has: (k) => !!TD[k], ready: () => (requested ? ready : Promise.resolve()) };
  };

  /* A PBR material from a texture set: key (colour), key_n (normal), key_r (roughness in G). */
  G.pbr = function (tx, key, metres, o, Material) {
    const p = Object.assign({ metalness: 0 }, o);
    const map = tx.get(key, metres), n = tx.get(key + "_n", metres), r = tx.get(key + "_r", metres);
    if (map) p.map = map;
    if (n) { p.normalMap = n; p.normalScale = p.normalScale || new THREE.Vector2(0.6, 0.6); }
    if (r) p.roughnessMap = r;
    if (p.roughness === undefined) p.roughness = r ? 1 : 0.8;
    return new (Material || THREE.MeshStandardMaterial)(p);
  };

  /* Planar UVs in metres (u along x, v along plan y) plus a second set spanning [x0, x1] x [y0, y1] for baked occlusion. */
  G.planUV = function (geo, box) {
    const p = geo.attributes.position, uv = [], uv1 = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = -p.getZ(i);
      uv.push(x, y);
      if (box) uv1.push((x - box[0]) / (box[2] - box[0]), (y - box[1]) / (box[3] - box[1]));
    }
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    if (box) geo.setAttribute("uv1", new THREE.Float32BufferAttribute(uv1, 2));
    return geo;
  };

  /* Floor occlusion from plan footprints: dark under walls and furniture, fading out over `reach` metres. A rect's optional
     fifth number weakens it (furniture and people cast a lighter shadow than walls). */
  G.footprintAO = function (box, rects, circles, reach, pxPerM) {
    const W = Math.round((box[2] - box[0]) * pxPerM), H = Math.round((box[3] - box[1]) * pxPerM);
    const occ = new Float32Array(W * H);
    const fill = (x0, y0, x1, y1, w) => {
      const i0 = Math.max(0, Math.floor((x0 - box[0]) * pxPerM)), i1 = Math.min(W - 1, Math.ceil((x1 - box[0]) * pxPerM));
      const j0 = Math.max(0, Math.floor((y0 - box[1]) * pxPerM)), j1 = Math.min(H - 1, Math.ceil((y1 - box[1]) * pxPerM));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) occ[j * W + i] = Math.max(occ[j * W + i], w);
    };
    rects.forEach((r) => fill(r[0], r[1], r[2], r[3], r[4] === undefined ? 1 : r[4]));
    (circles || []).forEach(([cx, cy, r]) => {
      const i0 = Math.max(0, Math.floor((cx - r - box[0]) * pxPerM)), i1 = Math.min(W - 1, Math.ceil((cx + r - box[0]) * pxPerM));
      const j0 = Math.max(0, Math.floor((cy - r - box[1]) * pxPerM)), j1 = Math.min(H - 1, Math.ceil((cy + r - box[1]) * pxPerM));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = box[0] + (i + 0.5) / pxPerM, y = box[1] + (j + 0.5) / pxPerM;
        if (Math.hypot(x - cx, y - cy) < r) occ[j * W + i] = 1;
      }
    });
    for (let i = 0; i < W; i++) { occ[i] = 1; occ[(H - 1) * W + i] = 1; }
    for (let j = 0; j < H; j++) { occ[j * W] = 1; occ[j * W + W - 1] = 1; }
    const r = Math.max(1, Math.round((reach * pxPerM) / 2));
    const a = occ, b = new Float32Array(W * H);
    for (let pass = 0; pass < 3; pass++) {
      for (let j = 0; j < H; j++) {
        let s = 0;
        for (let i = -r; i <= r; i++) s += a[j * W + Math.min(W - 1, Math.max(0, i))];
        for (let i = 0; i < W; i++) {
          b[j * W + i] = s / (2 * r + 1);
          s += a[j * W + Math.min(W - 1, i + r + 1)] - a[j * W + Math.max(0, i - r)];
        }
      }
      for (let i = 0; i < W; i++) {
        let s = 0;
        for (let j = -r; j <= r; j++) s += b[Math.min(H - 1, Math.max(0, j)) * W + i];
        for (let j = 0; j < H; j++) {
          a[j * W + i] = s / (2 * r + 1);
          s += b[Math.min(H - 1, j + r + 1) * W + i] - b[Math.max(0, j - r) * W + i];
        }
      }
    }
    const data = new Uint8Array(W * H * 4);
    for (let k = 0; k < W * H; k++) {
      const v = Math.round(255 * (1 - Math.min(1, a[k] * 1.6)));
      data[k * 4] = data[k * 4 + 1] = data[k * 4 + 2] = v; data[k * 4 + 3] = 255;
    }
    const t = new THREE.DataTexture(data, W, H);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.channel = 1;
    t.needsUpdate = true;
    return t;
  };

  /* A reflection probe: the scene seen from `pos`, prefiltered for every roughness. */
  G.probe = function (renderer, scene, pos, size, near, far) {
    const rt = new THREE.WebGLCubeRenderTarget(size || 128, { type: THREE.HalfFloatType });
    const cam = new THREE.CubeCamera(near || 0.1, far || 400, rt);
    cam.position.copy(pos);
    cam.update(renderer, scene);
    const pm = new THREE.PMREMGenerator(renderer);
    const tex = pm.fromCubemap(rt.texture).texture;
    rt.dispose(); pm.dispose();
    return tex;
  };

  /* Box projection: reflections line up with the walls of the room the probe was taken in (min/max/pos in world space). */
  G.boxProject = function (mat, env, min, max, pos) {
    mat.envMap = env;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.boxMin = { value: min }; sh.uniforms.boxMax = { value: max }; sh.uniforms.probePos = { value: pos };
      sh.vertexShader = "varying vec3 vBoxWorld;\n" + sh.vertexShader.replace("#include <worldpos_vertex>",
        "#include <worldpos_vertex>\n  vBoxWorld = worldPosition.xyz;");
      sh.fragmentShader = "varying vec3 vBoxWorld;\nuniform vec3 boxMin; uniform vec3 boxMax; uniform vec3 probePos;\n" +
        sh.fragmentShader.replace("#include <envmap_physical_pars_fragment>", THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
          "reflectVec = inverseTransformDirection( reflectVec, viewMatrix );",
          ["reflectVec = inverseTransformDirection( reflectVec, viewMatrix );",
            "{ vec3 bMax = ( boxMax - vBoxWorld ) / reflectVec; vec3 bMin = ( boxMin - vBoxWorld ) / reflectVec;",
            "  vec3 bf = max( bMax, bMin ); float bd = min( min( bf.x, bf.y ), bf.z );",
            "  reflectVec = normalize( vBoxWorld + reflectVec * bd - probePos ); }"].join("\n")));
    };
    mat.customProgramCacheKey = () => "boxproject";
    mat.needsUpdate = true;
    return mat;
  };

  /* Shop interiors behind glass ("interior mapping"): each window quad carries its room size and the atlas tile to use.
     The quad's uv is in metres (u to the right, v up); aRoom = (tile, width, height, depth); aRight = world direction of +u. */
  G.interiorMaterial = function (atlas, o) {
    o = Object.assign({ cols: 4, rows: 2, tileM: 4, gain: 1.25, reflect: 0.22, env: null }, o);
    const mat = new THREE.MeshBasicMaterial({ map: atlas, envMap: o.env, reflectivity: o.reflect, combine: THREE.MixOperation });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.gain = { value: o.gain };
      sh.vertexShader = ["attribute vec4 aRoom;", "attribute vec3 aRight;", "varying vec4 vRoom;", "varying vec3 vRay;", "varying vec2 vRoomUv;", "varying float vFres;",
        sh.vertexShader.replace("#include <begin_vertex>", [
          "#include <begin_vertex>",
          "  vec4 roomW = modelMatrix * vec4( position, 1.0 );",
          "  vec3 roomN = normalize( mat3( modelMatrix ) * normal ), roomR = normalize( mat3( modelMatrix ) * aRight );",
          "  vec3 roomV = roomW.xyz - cameraPosition;",
          "  vRay = vec3( dot( roomV, roomR ), roomV.y, dot( roomV, - roomN ) );",
          "  vRoom = aRoom; vRoomUv = uv;",
          "  vFres = pow( 1.0 - abs( dot( normalize( roomV ), roomN ) ), 4.0 );"].join("\n"))].join("\n");
      sh.fragmentShader = ["uniform float gain;", "varying vec4 vRoom;", "varying vec3 vRay;", "varying vec2 vRoomUv;", "varying float vFres;",
        sh.fragmentShader.replace("#include <map_pars_fragment>", `#include <map_pars_fragment>
        vec3 roomTex( vec2 q ) {
          vec2 tile = vec2( mod( vRoom.x, ${o.cols.toFixed(1)} ), floor( vRoom.x / ${o.cols.toFixed(1)} ) );
          vec2 s = vec2( 1.0 / ${o.cols.toFixed(1)}, 1.0 / ${o.rows.toFixed(1)} );
          vec2 uv = vec2( ( tile.x + clamp( fract( q.x ), 0.004, 0.996 ) ) * s.x, 1.0 - ( tile.y + 1.0 ) * s.y + clamp( q.y, 0.004, 0.996 ) * s.y );
          return texture2D( map, uv ).rgb;
        }`).replace("#include <map_fragment>", [
          "  vec3 d = normalize( vRay ); vec3 p = vec3( vRoomUv, 0.0 );",
          "  float W = vRoom.y, H = vRoom.z, D = vRoom.w;",
          "  float tx = d.x > 0.0 ? ( W - p.x ) / d.x : - p.x / min( d.x, -1e-4 );",
          "  float ty = d.y > 0.0 ? ( H - p.y ) / d.y : - p.y / min( d.y, -1e-4 );",
          "  float tz = D / max( d.z, 1e-3 );",
          "  float t = min( min( tx, ty ), tz ); vec3 h = p + d * t; vec3 col;",
          `  if ( t == tz ) col = roomTex( h.xy / ${o.tileM.toFixed(1)} );`,
          `  else if ( t == tx ) col = roomTex( vec2( h.z / ${o.tileM.toFixed(1)} + 0.37, h.y / ${o.tileM.toFixed(1)} ) ) * 0.8;`,
          "  else if ( d.y < 0.0 ) { vec2 f = fract( h.xz / 0.8 ); float g = step( 0.03, f.x ) * step( 0.03, f.y );",
          "    col = mix( vec3( 0.55, 0.52, 0.48 ), vec3( 0.80, 0.77, 0.72 ), g ) * ( 0.75 + 0.25 * fract( sin( vRoom.x * 12.9 ) * 43758.5 ) ); }",
          "  else { vec2 f = fract( h.xz / vec2( 1.6, 1.2 ) ); float lamp = step( 0.62, f.x ) * step( 0.5, f.y );",
          "    col = mix( vec3( 0.86, 0.85, 0.82 ), vec3( 3.0, 2.85, 2.6 ), lamp ); }",
          "  col *= ( 1.0 - 0.38 * h.z / D ) * gain;",
          "  diffuseColor.rgb = col;"].join("\n")).replace("#include <envmap_fragment>",
          THREE.ShaderChunk.envmap_fragment.replace(/specularStrength \* reflectivity/g, "specularStrength * reflectivity * ( 0.35 + 0.65 * vFres )"))].join("\n");
    };
    mat.customProgramCacheKey = () => "interior" + o.cols + o.rows + o.tileM;
    return mat;
  };

  /* One window quad for interiorMaterial: centre (x, z, y) in world space, facing `normal` (a horizontal unit vector). */
  G.windowQuad = function (cx, cy, cz, w, h, nx, nz, tile, depth) {
    const rx = nz, rz = -nx;
    const pos = [], uv = [];
    [[0, 0], [w, 0], [w, h], [0, h]].forEach(([u, v]) => {
      pos.push(cx + rx * (u - w / 2), cy + v - h / 2, cz + rz * (u - w / 2));
      uv.push(u, v);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute([nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz], 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("aRoom", new THREE.Float32BufferAttribute(Array(4).fill([tile, w, h, depth]).flat(), 4));
    g.setAttribute("aRight", new THREE.Float32BufferAttribute(Array(4).fill([rx, 0, rz]).flat(), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    return g;
  };

  /* UVs of a BoxGeometry(w, h, d) in metres on every face, so tiled textures keep their size on long or tall boxes. */
  G.boxMetres = function (geo, w, h, d) {
    const uv = geo.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
    }
    return geo;
  };

  /* Several box geometries with their transforms baked in: [w, h, d, x, y, z (three.js centre), rotY]. */
  G.boxes = function (list, metres) {
    return G.merge(list.map(([w, h, d, x, y, z, ry]) => {
      const g = new THREE.BoxGeometry(w, h, d);
      if (metres) G.boxMetres(g, w, h, d);
      if (ry) g.rotateY(ry);
      return g.translate(x, y, z);
    }));
  };

  G.merge = function (geos) {
    const out = new THREE.BufferGeometry(), attrs = {}, idx = [];
    let base = 0;
    geos.forEach((g) => {
      Object.keys(g.attributes).forEach((k) => { (attrs[k] = attrs[k] || { size: g.attributes[k].itemSize, data: [] }).data.push(...g.attributes[k].array); });
      const n = g.attributes.position.count;
      if (g.index) g.index.array.forEach((i) => idx.push(i + base)); else for (let i = 0; i < n; i++) idx.push(i + base);
      base += n;
    });
    Object.keys(attrs).forEach((k) => out.setAttribute(k, new THREE.Float32BufferAttribute(attrs[k].data, attrs[k].size)));
    out.setIndex(idx);
    return out;
  };

  /* CC0 props from window.SA_MODELS (blender/build_props.py). place(name, items) instances a model; items are
     { p: THREE.Vector3, rot: radians about Y, s: scale, colors: { Paint|Shirt|Pants|Hair|Skin: hex } }. Materials named in
     `colors` are tinted per instance. object(name) gives one ordinary copy (filled in once loaded). */
  const RECOLOR = ["Paint", "Shirt", "Pants", "Hair", "Skin", "Shoes", "Planter"];
  G.props = function (scene, o) {
    o = Object.assign({ shadows: true }, o);
    const MD = window.SA_MODELS || {};
    const loader = THREE.GLTFLoader ? new THREE.GLTFLoader() : null;
    const protos = {}, pending = [];
    let count = 0;
    function proto(name) {
      if (!protos[name]) protos[name] = new Promise((res) => {
        if (!loader || !MD[name]) return res(null);
        loader.load(MD[name], (gltf) => {
          const parts = [];
          gltf.scene.updateMatrixWorld(true);
          gltf.scene.traverse((m) => {
            if (!m.isMesh) return;
            const g = m.geometry.clone();
            g.applyMatrix4(m.matrixWorld);
            const mat = m.material;
            if (mat.map) mat.map.anisotropy = 4;
            if (/^p_/.test(name) && !mat.map) { mat.roughness = Math.max(mat.roughness, 0.75); mat.metalness = 0; }
            if (RECOLOR.indexOf(mat.name) >= 0) mat.color.set(0xffffff);
            parts.push({ geometry: g, material: mat, recolor: RECOLOR.indexOf(mat.name) >= 0 ? mat.name : null });
          });
          res(parts);
        }, undefined, () => res(null));
      });
      return protos[name];
    }
    const dummy = new THREE.Object3D(), col = new THREE.Color();
    function place(name, items, opt) {
      opt = Object.assign({ cast: o.shadows, receive: true }, opt);
      if (!items.length) return;
      count += items.length;
      pending.push(proto(name).then((parts) => {
        if (!parts) return;
        parts.forEach(({ geometry, material, recolor }) => {
          const m = new THREE.InstancedMesh(geometry, material, items.length);
          items.forEach((it, i) => {
            dummy.position.copy(it.p); dummy.rotation.set(0, it.rot || 0, 0);
            const s = it.s || 1;
            if (Array.isArray(s)) dummy.scale.set(s[0], s[1], s[2]); else dummy.scale.setScalar(s);
            dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix);
            if (recolor) m.setColorAt(i, col.set((it.colors && it.colors[recolor] !== undefined) ? it.colors[recolor] : 0xffffff));
          });
          m.castShadow = opt.cast; m.receiveShadow = opt.receive; m.frustumCulled = false;
          (opt.parent || scene).add(m);
        });
      }));
    }
    function object(name, colors) {
      const g = new THREE.Group();
      pending.push(proto(name).then((parts) => {
        (parts || []).forEach(({ geometry, material, recolor }) => {
          const mat = recolor && colors && colors[recolor] !== undefined ? material.clone() : material;
          if (mat !== material) mat.color.set(colors[recolor]);
          const m = new THREE.Mesh(geometry, mat);
          m.castShadow = o.shadows; m.receiveShadow = true;
          g.add(m);
        });
      }));
      return g;
    }
    return { place, object, has: (n) => !!MD[n], count: () => count, ready: () => Promise.all(pending) };
  };

  /* Clothes and paint for props: never red or pink, so a friend in a red shirt stays the only one. */
  G.PALETTE = {
    shirt: [0x2f4858, 0x33658a, 0x86bbd8, 0xe9e9e4, 0x3a3a3a, 0x7a9e7e, 0x5b5f97, 0xd9c5a0, 0x9aa5b1, 0x6d597a, 0xf2e8cf, 0x2a9d8f],
    pants: [0x2b2d42, 0x3d405b, 0x6b705c, 0x1f1f1f, 0x8d99ae, 0x4a4e69, 0xa68a64, 0x33415c],
    hair: [0x1b1b1b, 0x2b1d14, 0x3b2a20, 0x111111, 0x4a3628],
    skin: [0xf1c7a5, 0xe8b894, 0xdcae8a, 0xf3d0b4],
    paint: [0xf2f2f2, 0xb8bcc0, 0x1c1d20, 0x4a4f55, 0x22355e, 0x6e1f24, 0xd8d2c4, 0x2e4d3b, 0x8a8d91],
  };
  G.personColors = function (r) {
    const pick = (a) => a[Math.floor(r() * a.length)];
    return { Shirt: pick(G.PALETTE.shirt), Pants: pick(G.PALETTE.pants), Hair: pick(G.PALETTE.hair), Skin: pick(G.PALETTE.skin) };
  };

  /* Clear glass: no diffuse colour, the background dimmed by `tint`, the Fresnel reflection added on top. */
  G.glass = function (o) {
    o = Object.assign({ tint: 0.1, env: 1.0, color: 0x000000 }, o);
    return new THREE.MeshStandardMaterial({ color: o.color, roughness: 0.03, metalness: 0, transparent: true, opacity: o.tint, side: THREE.DoubleSide,
      depthWrite: false, envMapIntensity: o.env, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
  };

  /* Water with a live planar reflection (same shader as the park lake). Call render(camera) instead of renderer.render. */
  G.mirrorWater = function (renderer, scene, y, o) {
    o = Object.assign({ color: 0x0c2730, normalMap: null, normalScale: 0.16, env: 0.5, strength: 0.92, base: 0.35, scale: 0.5 }, o);
    const rt = new THREE.WebGLRenderTarget(256, 144, { type: THREE.HalfFloatType });
    const cam = new THREE.PerspectiveCamera();
    const reflMatrix = new THREE.Matrix4();
    const clip = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -y)];
    const mat = new THREE.MeshStandardMaterial({ color: o.color, roughness: 0.1, normalMap: o.normalMap,
      normalScale: new THREE.Vector2(o.normalScale, o.normalScale), envMapIntensity: o.env });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.tReflect = { value: rt.texture };
      sh.uniforms.uReflMatrix = { value: reflMatrix };
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform mat4 uReflMatrix;\nvarying vec4 vReflUv;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvReflUv = uReflMatrix * modelMatrix * vec4(transformed, 1.0);");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform sampler2D tReflect;\nvarying vec4 vReflUv;")
        .replace("#include <opaque_fragment>", [
          "vec2 ruv = vReflUv.xy / vReflUv.w + (normal.xy - nonPerturbedNormal.xy) * 0.25;",
          "vec3 refl = texture2D(tReflect, ruv).rgb;",
          "float cosT = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);",
          "float fres = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);",
          `outgoingLight = mix(outgoingLight, refl * ${o.strength.toFixed(2)}, clamp(${o.base.toFixed(2)} + fres, 0.0, 1.0));`,
          "#include <opaque_fragment>"].join("\n"));
    };
    const hidden = [];
    const _rot = new THREE.Matrix4(), _look = new THREE.Vector3(), _target = new THREE.Vector3(), _up = new THREE.Vector3(), _size = new THREE.Vector2();
    function render(camera, visible) {
      if (visible !== false) {
        renderer.getDrawingBufferSize(_size);
        const rw = Math.max(256, Math.round(_size.x * o.scale)), rh = Math.max(144, Math.round(_size.y * o.scale));
        if (rt.width !== rw || rt.height !== rh) rt.setSize(rw, rh);
        camera.updateMatrixWorld();
        _rot.extractRotation(camera.matrixWorld);
        _look.set(0, 0, -1).applyMatrix4(_rot);
        _target.copy(camera.position).add(_look);
        _target.y = 2 * y - _target.y;
        _up.set(0, 1, 0).applyMatrix4(_rot);
        _up.y = -_up.y;
        cam.position.set(camera.position.x, 2 * y - camera.position.y, camera.position.z);
        cam.up.copy(_up);
        cam.lookAt(_target);
        cam.fov = camera.fov; cam.aspect = camera.aspect; cam.near = camera.near; cam.far = camera.far;
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
        reflMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
        reflMatrix.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
        hidden.forEach((m) => (m.visible = false));
        const saved = renderer.clippingPlanes;
        renderer.clippingPlanes = clip;
        renderer.setRenderTarget(rt);
        renderer.render(scene, cam);
        renderer.setRenderTarget(null);
        renderer.clippingPlanes = saved;
        hidden.forEach((m) => (m.visible = true));
      }
      renderer.render(scene, camera);
    }
    return { material: mat, render, hide: (m) => hidden.push(m) };
  };

  /* Glows for many small lights in one draw call: points with a soft round sprite, sized in world units. */
  G.glowPoints = function (scene, pts, color, size, opacity) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts.flat(), 3));
    const m = G.halo(color, opacity);
    const mat = new THREE.PointsMaterial({ map: m.map, size, sizeAttenuation: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false, opacity: m.opacity, fog: true });
    const p = new THREE.Points(g, mat);
    p.frustumCulled = false;
    scene.add(p);
    return p;
  };

  /* Soft additive glow around a light source. */
  const haloTex = {};
  G.halo = function (color, opacity) {
    const key = color;
    if (!haloTex[key]) {
      const c = document.createElement("canvas"); c.width = c.height = 128;
      const ctx = c.getContext("2d"), g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64), col = new THREE.Color(color);
      const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
      g.addColorStop(0, `rgba(${rgb},1)`); g.addColorStop(0.12, `rgba(${rgb},.55)`); g.addColorStop(0.4, `rgba(${rgb},.12)`); g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
      haloTex[key] = new THREE.CanvasTexture(c);
      haloTex[key].colorSpace = THREE.SRGBColorSpace;
    }
    return new THREE.SpriteMaterial({ map: haloTex[key], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      toneMapped: false, opacity: opacity === undefined ? 1 : opacity, fog: true });
  };

  /* Leaf-card trees and bushes (same recipe as the park, blender/park_scene.py). Prototypes are 1 unit tall;
     items: [kind, x(three), y(three), z(three), height, width]. Full crowns within `near` metres, a few big cards beyond. */
  G.vegetation = function (scene, tx, items, o) {
    o = Object.assign({ near: 40, trunk: 0x3b2a1f, tint: 0xc4c4c4 }, o);
    const leafMats = {};
    ["leaves_green", "leaves_dark", "leaves_autumn"].forEach((k) => {
      const map = tx.get(k);
      if (!map) return;
      map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
      const mat = new THREE.MeshLambertMaterial({ map, color: o.tint, alphaTest: 0.45, side: THREE.DoubleSide });
      mat.userData.depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.45, side: THREE.DoubleSide });
      leafMats[k] = mat;
    });
    const trunkMat = new THREE.MeshLambertMaterial({ color: o.trunk });
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
            const n = t1.clone().multiplyScalar(c).addScaledVector(t2, s), q = P.clone().addScaledVector(n, rr);
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
      return { leaves: geo(lp, ln, lu, li), trunk: tp.length ? geo(tp, tn, null, ti) : null };
    }
    const both = (kind, seed) => [proto(kind, seed, 0), proto(kind, seed, 1)];
    const PROTOS = { round: [both("round", 10), both("round", 12)], tall: [both("tall", 11)], bush: [both("bush", 50), both("bush", 51)] };
    const groups = new Map(), r = rng(o.seed || 31);
    items.forEach(([kind, x, y, z, h, w, leaf]) => {
      const list = PROTOS[kind] || PROTOS.round, pr = list[Math.floor(r() * list.length)];
      const key = pr[0].leaves.uuid + (leaf || "leaves_green");
      if (!groups.has(key)) groups.set(key, { pr, leaf: leaf || "leaves_green", list: [] });
      groups.get(key).list.push([x, y, z, h, w || h, r() * 6.2832, 0.82 + r() * 0.3]);
    });
    const dummy = new THREE.Object3D(), col = new THREE.Color(), sets = [];
    const mesh = (g, mat, n) => {
      const inst = new THREE.InstancedMesh(g, mat, n);
      inst.castShadow = true; inst.receiveShadow = true; inst.frustumCulled = false;
      if (mat.userData.depth) inst.customDepthMaterial = mat.userData.depth;
      scene.add(inst);
      return inst;
    };
    groups.forEach(({ pr: [hi, lo], leaf, list }) => {
      const mat = leafMats[leaf];
      if (!mat) return;
      const n = list.length, mats = new Float32Array(n * 16), cols = new Float32Array(n * 3), pos = new Float32Array(n * 2);
      list.forEach(([x, y, z, h, w, rot, tint], i) => {
        dummy.position.set(x, y, z); dummy.rotation.set(0, rot, 0); dummy.scale.set(w, h, w); dummy.updateMatrix();
        dummy.matrix.toArray(mats, i * 16);
        col.setRGB(tint, tint, tint * 0.94).toArray(cols, i * 3);
        pos[i * 2] = x; pos[i * 2 + 1] = z;
      });
      const set = { n, mats, cols, pos, near: [mesh(hi.leaves, mat, n)], far: [mesh(lo.leaves, mat, n)] };
      if (hi.trunk) { set.near.push(mesh(hi.trunk, trunkMat, n)); set.far.push(mesh(lo.trunk, trunkMat, n)); }
      [...set.near, ...set.far].forEach((m) => { if (m.material !== trunkMat) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3); });
      sets.push(set);
    });
    const last = new THREE.Vector2(1e9, 1e9);
    function update(cx, cz) {
      if (Math.hypot(cx - last.x, cz - last.y) < 1) return;
      last.set(cx, cz);
      const r2 = o.near * o.near;
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
    return { update, count: items.length };
  };
})();
