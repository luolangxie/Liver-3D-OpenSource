/* =========================================================================
 * app.js — interactive 3D liver viewer (three.js r150, classic script)
 * ========================================================================= */
(function () {
  'use strict';

  var G = window.LiverGeom, D = window.LiverData;
  var $ = function (s) { return document.querySelector(s); };

  /* ------------------------------------------------------------------ *
   * 把 console.error / warn 收集起来，出错时直接显示在页面上
   * （远程排查“界面正常但画面全黑”时最关键的信息）
   * ------------------------------------------------------------------ */
  var LOGS = [];
  (function () {
    ['error', 'warn'].forEach(function (kind) {
      var orig = (window.console && console[kind]) ? console[kind].bind(console) : function () {};
      console[kind] = function () {
        try {
          var s = Array.prototype.map.call(arguments, function (x) {
            if (x && x.message) return x.message;
            return String(x);
          }).join(' ');
          if (LOGS.length < 12) LOGS.push(kind.toUpperCase() + ': ' + s.slice(0, 260));
        } catch (e) {}
        orig.apply(null, arguments);
      };
    });
  })();

  /* ------------------------------------------------------------------ *
   * diagnostics: never fail silently
   * ------------------------------------------------------------------ */
  function fatal(title, detail) {
    var el = document.getElementById('loading');
    var img = (window.LIVER_IMAGES && window.LIVER_IMAGES.whole) || 'images/liver-whole.png';
    var html = '<div class="fatal">' +
      '<h2>' + title + '</h2>' +
      '<p>' + (detail || '') + '</p>' +
      '<p class="fatal-tip">下面是同一模型的离线渲染图（说明几何数据本身是正常的）：</p>' +
      '<img src="' + img + '" alt="offline render">' +
      '<p class="fatal-tip">若你是在聊天窗口的内嵌预览里打开的，请改用 Chrome / Edge 直接打开 ' +
      '<code>liver-3d.html</code>（单文件版，无任何外部依赖）。</p>' +
      '<p class="fatal-tip" id="fatal-detail"></p>' +
      '</div>';
    if (el) {
      el.classList.remove('hidden');
      el.innerHTML = html;
    } else if (document.body) {
      document.body.insertAdjacentHTML('beforeend', html);
    }
    if (window.console) console.error('[liver]', title, detail);
  }

  function hasWebGL() {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext &&
        (c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) { return false; }
  }

  if (!G || !D || !window.THREE) {
    fatal('依赖脚本未能加载',
      'three.js 或解剖数据脚本没有被浏览器加载。最常见的原因是页面被放在内嵌预览/沙箱里打开，' +
      '相对路径的 script 被拦截。请直接双击文件，或用 liver-3d.html 单文件版。');
    return;
  }
  if (!hasWebGL()) {
    fatal('当前环境不支持 WebGL',
      '浏览器没有可用的 WebGL 上下文（常见于关闭了硬件加速、远程桌面、虚拟机或内嵌预览窗口）。' +
      '请在 Chrome / Edge 中打开 chrome://gpu 确认，或在设置里开启“使用硬件加速”。');
    return;
  }

  /* ------------------------------------------------------------------ *
   * state
   * ------------------------------------------------------------------ */
  var state = {
    cut: 0, cutOn: false,
    translucent: false, segmentColors: false, explode: 0,
    labels: false, rotate: false,
    source: 'builtin',
    partColor: false, partWire: false, isolate: false, selectedPart: null, partEdges: false, showDebris: true, seamless: false,
    groups: { portal: true, 'hepatic-vein': true, artery: true, bile: true, gallbladder: true, vein: true, ligament: true },
    selected: null
  };

  var GROUP_COLOR = {
    portal: '#4f7fd0', 'hepatic-vein': '#2f86c9', artery: '#cf4034', bile: '#3f9c58',
    gallbladder: '#7ab268', vein: '#6d80a8', ligament: '#cfc7b4', parenchyma: '#b3503f', section: '#c86a58'
  };
  var GROUP_LABEL = {
    portal: '门静脉系统', 'hepatic-vein': '肝静脉系统', artery: '肝动脉系统', bile: '胆道系统',
    gallbladder: '胆囊', vein: '下腔静脉', ligament: '韧带／腹膜返折', parenchyma: '肝实质',
    section: '剖面'
  };

  var renderer, scene, camera, raycaster, pointerNDC, controls;
  var root, liverGroup, segMeshes = [], vesselGroup, ligGroup, capGroup, glbGroup;
  var sectionMesh = null;
  var glbModel = null, glbInfo = null;
  var ambientLight = null, keyLight = null;
  var GLB_URL = (window.LIVER_GLB_DATA_URI || './models/sm_liver_cross_section.glb');
  var clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 8);
  var pickables = [];
  var labels = [];
  var segCentroids = {};
  var baseGeometry = null;
  var LIVER_COLOR = new THREE.Color('#a9503f');
  var BARE_COLOR = new THREE.Color('#b9907c');

  /* 观察方向（取景时沿这个方向摆相机） */
  var VIEW_DIR = new THREE.Vector3(0.45, 0.3, 0.85);

  /* ------------------------------------------------------------------ *
   * boot
   * ------------------------------------------------------------------ */
  try {
    init();
  } catch (e) {
    fatal('三维渲染器初始化失败', (e && e.message) ? e.message : String(e));
    return;
  }
  setTimeout(function () {
    try {
      buildLiver();
    } catch (e) {
      fatal('生成肝脏网格时出错', (e && e.message) ? e.message : String(e));
      var d = document.getElementById('fatal-detail');
      if (d) d.textContent = (e && e.stack) ? String(e.stack).slice(0, 600) : '';
    }
    loadGLB();          /* 外部模型：./models/sm_liver_cross_section.glb */
  }, 40);

  function init() {
    var canvas = document.getElementById('scene');
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.localClippingEnabled = true;
    renderer.setClearColor(0x0e1116, 1);
    /* 阴影 + 电影级色调映射：让明暗过渡更像实拍 */
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (THREE.ACESFilmicToneMapping !== undefined) {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
    }

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x131a23);
    scene.fog = new THREE.Fog(0x131a23, 120, 240);

    camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.5, 800);
    camera.position.set(26, 14, 36);

    /* ---- 光照：极暗环境光 + 左上方强力主光（带阴影）+ 弱补光 + 轮廓光 ----
       关键：主光与相机不同向，否则正面被均匀照亮就没有明暗交界线。 */
    ambientLight = new THREE.AmbientLight(0xcfd8e6, 0.08);   /* 大幅压暗 */
    scene.add(ambientLight);

    keyLight = new THREE.DirectionalLight(0xfff0dd, 3.1);    /* 暖白主光，强 */
    keyLight.position.set(-58, 54, 30);                      /* 左上前方（与相机错开） */
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 280;
    keyLight.shadow.camera.left = -26;
    keyLight.shadow.camera.right = 26;
    keyLight.shadow.camera.top = 26;
    keyLight.shadow.camera.bottom = -26;
    keyLight.shadow.camera.updateProjectionMatrix();
    keyLight.shadow.bias = -0.0004;
    keyLight.shadow.normalBias = 0.06;
    scene.add(keyLight);
    scene.add(keyLight.target);          /* 阴影相机以 target 为注视点 */

    var fill2 = new THREE.DirectionalLight(0x9fc4ff, 0.22);  /* 冷色补光，仅压住死黑 */
    fill2.position.set(52, 8, -26);
    scene.add(fill2);

    var rim = new THREE.DirectionalLight(0xffc9a8, 0.5);     /* 背后轮廓光，勾边 */
    rim.position.set(6, -8, -54);
    scene.add(rim);

    var hemi = new THREE.HemisphereLight(0xbfd4ff, 0x1a1410, 0.14);
    scene.add(hemi);

    root = new THREE.Group(); scene.add(root);
    liverGroup = new THREE.Group(); root.add(liverGroup);
    vesselGroup = new THREE.Group(); root.add(vesselGroup);
    ligGroup = new THREE.Group(); root.add(ligGroup);
    capGroup = new THREE.Group(); root.add(capGroup);
    glbGroup = new THREE.Group(); root.add(glbGroup);

    raycaster = new THREE.Raycaster();
    pointerNDC = new THREE.Vector2();

    /* ---- OrbitControls：左键旋转、滚轮缩放、右键平移 ---- */
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.85;
    controls.zoomSpeed = 0.9;
    controls.panSpeed = 0.85;
    controls.screenSpacePanning = true;
    controls.minDistance = 2;
    controls.maxDistance = 400;
    controls.target.set(0, 1.2, 0);
    controls.update();

    bindPointer();
    bindUI();
    window.addEventListener('resize', onResize);

    setupEnvironment();   /* 环境贴图：让高光与暗部更真实 */

    /* 上下文丢失（GPU 进程崩溃）时给出明确提示，而不是静默黑屏 */
    canvas.addEventListener('webglcontextlost', function (ev) {
      ev.preventDefault();
      showWarn('WebGL 上下文丢失（GPU 进程崩溃或被系统回收）');
    }, false);

    /* 调试模式：?debug=1 会在原点放一个不受光照影响的红色立方体，
       用来区分“渲染管线坏了”还是“肝脏网格没画出来” */
    if (location.search.indexOf('debug') >= 0) {
      var dbgMesh = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0xff3355 }));
      dbgMesh.position.set(0, 0, 0);
      scene.add(dbgMesh);
      var axes = new THREE.AxesHelper(14);
      scene.add(axes);
    }

    animate();
  }

  /* ------------------------------------------------------------------ *
   * liver parenchyma
   * ------------------------------------------------------------------ */
  function buildLiver() {
    var t0 = performance.now();
    var mesh = G.buildSurface({ res: 0.26 });
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));

    /* vertex colours: parenchyma + a slightly paler bare area */
    var colors = new Float32Array(mesh.positions.length);
    for (var i = 0; i < mesh.positions.length / 3; i++) {
      var x = mesh.positions[i * 3], y = mesh.positions[i * 3 + 1], z = mesh.positions[i * 3 + 2];
      var nx = mesh.normals[i * 3], ny = mesh.normals[i * 3 + 1], nz = mesh.normals[i * 3 + 2];
      var bare = (z < -4.05 && y > -0.2 && y < 5.2 && x > 3.2 && nz < -0.05);
      var c = bare ? BARE_COLOR : LIVER_COLOR;
      var shade = 0.94 + 0.06 * Math.sin(x * 1.7 + y * 2.3);
      colors[i * 3] = c.r * shade; colors[i * 3 + 1] = c.g * shade; colors[i * 3 + 2] = c.b * shade;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    baseGeometry = geo;

    /* split triangles by Couinaud segment */
    var S = mesh.segments, T = mesh.indices;
    var bySeg = {};
    for (var t = 0; t < T.length; t += 3) {
      var seg = S[T[t]];
      (bySeg[seg] || (bySeg[seg] = [])).push(T[t], T[t + 1], T[t + 2]);
    }

    D.SEGMENTS.forEach(function (segDef) {
      var idx = bySeg[segDef.id];
      if (!idx || !idx.length) return;
      var sg = new THREE.BufferGeometry();
      sg.setAttribute('position', geo.attributes.position);
      sg.setAttribute('normal', geo.attributes.normal);
      sg.setAttribute('color', geo.attributes.color);
      sg.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
      sg.computeBoundingSphere();

      var mat = new THREE.MeshStandardMaterial({
        color: 0xffffff, vertexColors: true, roughness: 0.62, metalness: 0.02,
        side: THREE.DoubleSide, flatShading: false,
        clippingPlanes: [], clipShadows: false
      });
      var m = new THREE.Mesh(sg, mat);
      m.userData = { kind: 'segment', segId: segDef.id, data: segDef };
      m.castShadow = true;
      m.receiveShadow = true;
      liverGroup.add(m);
      segMeshes.push(m);
      pickables.push(m);

      /* centroid for the explode animation */
      var cx = 0, cy = 0, cz = 0, n = 0;
      for (var k = 0; k < idx.length; k++) {
        cx += mesh.positions[idx[k] * 3]; cy += mesh.positions[idx[k] * 3 + 1]; cz += mesh.positions[idx[k] * 3 + 2]; n++;
      }
      segCentroids[segDef.id] = new THREE.Vector3(cx / n, cy / n, cz / n);
    });

    /* 记录内置模型的包围盒，切回内置模型时用于取景 */
    builtinBox = new THREE.Box3(
      new THREE.Vector3(-12.8, -3.6, -5.3),
      new THREE.Vector3(11.8, 8.5, 5.3));

    buildVessels();
    buildLigamentSheets();
    buildLabels();

    document.getElementById('loading').classList.add('hidden');
    var st = document.getElementById('status');
    if (st) {
      st.innerHTML = '渲染就绪 · <b>' + (mesh.positions.length / 3).toLocaleString() + '</b> 顶点 · <b>' +
        D.STRUCTURES.length + '</b> 条管道 · <b>' + D.SEGMENTS.length + '</b> 个肝段 · 点击结构查看要点';
    }
    console.log('[liver] mesh', (performance.now() - t0).toFixed(0) + 'ms', mesh.positions.length / 3, 'verts');
    refreshAppearance();
    if (state.source !== 'glb') { setSource('builtin', true); fitCameraToBox(builtinBox, VIEW_DIR, 1.2); }
  }

  /* ------------------------------------------------------------------ *
   * vessels / ducts / ligament cords
   * ------------------------------------------------------------------ */
  function tubeMesh(def) {
    var t = G.buildTube(def.points, def.radius, { radial: def.radial || 12, samples: 6, capEnds: true });
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(t.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(t.normals, 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(t.indices), 1));
    geo.computeBoundingSphere();
    return geo;
  }

  function buildVessels() {
    D.STRUCTURES.forEach(function (def) {
      var geo = tubeMesh(def);
      var mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(def.color), roughness: 0.42, metalness: 0.05,
        side: THREE.DoubleSide, clippingPlanes: []
      });
      var m = new THREE.Mesh(geo, mat);
      m.userData = { kind: 'structure', group: def.group, data: def, baseColor: def.color };
      m.renderOrder = 2;
      (def.group === 'ligament' ? ligGroup : vesselGroup).add(m);
      pickables.push(m);
    });
  }

  /* falciform + triangular ligaments as thin peritoneal sheets.
     The attachment line is projected onto the true parenchymal surface and
     the free edge is extruded along the local surface normal, so the sheets
     always sit on the capsule. */
  function buildLigamentSheets() {
    var sheets = [
      { id: 'lig-falciform', zh: '镰状韧带', latin: 'ligamentum falciforme hepatis', en: 'falciform ligament',
        base: [[-3.15, -1.30, 3.55], [-3.15, 0.70, 3.30], [-3.15, 2.40, 2.70], [-3.15, 3.60, 1.80], [-3.15, 4.35, 0.55]],
        depth: 1.0,
        bullets: ['连接肝前上面与膈及前腹壁的双层腹膜皱襞，呈矢状位。',
                  '其游离缘内含肝圆韧带（脐静脉闭锁后的遗迹）。',
                  '镰状韧带是肝左、右叶的传统表面分界，但并非功能分界——功能分界为肝中静脉平面（Cantlie 线）。'],
        clinical: ['镰状韧带是左半肝手术入路的标志；其内偶有副肝动脉或脐旁静脉走行。'],
        refs: ['grays43', 'ta2', 'kostov2023'] },
      { id: 'lig-tri-left', zh: '左三角韧带', latin: 'ligamentum triangulare sinistrum', en: 'left triangular ligament',
        base: [[-11.60, 1.62, -0.35], [-12.10, 1.72, 0.12], [-12.45, 1.82, 0.55]],
        depth: 1.8,
        bullets: ['肝左叶上、下面的腹膜在左端相遇形成的三角形皱襞，将左叶固定于膈。'],
        clinical: ['左半肝游离时需切断左三角韧带；其内可能有来自胃左动脉的变异肝动脉。'],
        refs: ['grays43'] },
      { id: 'lig-tri-right', zh: '右三角韧带', latin: 'ligamentum triangulare dextrum', en: 'right triangular ligament',
        base: [[9.20, 2.20, -4.00], [9.80, 1.20, -4.20], [10.10, 0.10, -3.90]],
        depth: 2.2,
        bullets: ['冠状韧带前、后两层在肝右端相遇而成，将肝右叶后部固定于膈。'],
        clinical: ['右半肝游离时最后处理的结构之一；其深面即裸区与右肾上腺。'],
        refs: ['grays43'] }
    ];

    sheets.forEach(function (s) {
      var base = [], tip = [], g = [0, 0, 0];
      s.base.forEach(function (p) {
        var q = [p[0], p[1], p[2]];
        G.projectToSurface(q);
        G.grad(q[0], q[1], q[2], g);
        base.push(q);
        tip.push([q[0] + g[0] * s.depth, q[1] + g[1] * s.depth, q[2] + g[2] * s.depth]);
      });
      var t = G.buildRibbon(base, tip, { samples: 8 });
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(t.positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(t.normals, 3));
      geo.setIndex(new THREE.BufferAttribute(new Uint32Array(t.indices), 1));
      geo.computeBoundingSphere();
      var mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#c9c0ab'), roughness: 0.85, metalness: 0.0,
        side: THREE.DoubleSide, transparent: true, opacity: 0.95, clippingPlanes: []
      });
      var m = new THREE.Mesh(geo, mat);
      m.userData = { kind: 'structure', group: 'ligament', data: s, baseColor: '#c9c0ab' };
      ligGroup.add(m);
      pickables.push(m);
    });
  }

  /* ================================================================== *
   * 写实化：环境贴图（RoomEnvironment → PMREM）+ 材质调优 + 贴图去饱和
   * ================================================================== */
  var envReady = false;
  var DESAT = 0.22;
  var desatCache = {};

  function setupEnvironment() {
    if (!THREE.RoomEnvironment || !THREE.PMREMGenerator) {
      console.warn('[env] RoomEnvironment / PMREMGenerator 不可用，跳过环境贴图');
      window.__liverEnv = false;
      return;
    }
    try {
      var pmrem = new THREE.PMREMGenerator(renderer);
      if (pmrem.compileEquirectangularShader) pmrem.compileEquirectangularShader();
      var room = new THREE.RoomEnvironment();
      var rt = pmrem.fromScene(room, 0.04);
      scene.environment = rt.texture;
      if (room.dispose) room.dispose();
      pmrem.dispose();
      envReady = true;
      window.__liverEnv = true;
      console.log('[env] RoomEnvironment 已应用（PMREM 预滤波）');
    } catch (e) {
      console.warn('[env] 环境贴图生成失败', e);
      window.__liverEnv = false;
    }
  }

  function desaturateTexture(tex, amount) {
    if (!tex) return tex;
    if (desatCache[tex.uuid]) return desatCache[tex.uuid];
    var img = tex.image;
    if (!img) return tex;
    var w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
    if (!w || !h) return tex;
    try {
      var cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      var ctx = cv.getContext('2d');
      if (!ctx || !ctx.drawImage) return tex;
      ctx.drawImage(img, 0, 0, w, h);
      var data = ctx.getImageData(0, 0, w, h);
      var d = data.data;
      for (var i = 0; i < d.length; i += 4) {
        var r = d[i], g = d[i + 1], b = d[i + 2];
        var lum = 0.299 * r + 0.587 * g + 0.114 * b;
        d[i] = r + (lum - r) * amount;
        d[i + 1] = g + (lum - g) * amount;
        d[i + 2] = b + (lum - b) * amount;
      }
      ctx.putImageData(data, 0, 0);
      var t = new THREE.CanvasTexture(cv);
      t.encoding = THREE.sRGBEncoding;
      t.wrapS = tex.wrapS; t.wrapT = tex.wrapT;
      t.flipY = tex.flipY;
      t.anisotropy = tex.anisotropy || 4;
      t.needsUpdate = true;
      desatCache[tex.uuid] = t;
      return t;
    } catch (e) {
      console.warn('[mat] 贴图去饱和失败（可能是 canvas 受限）', e);
      return tex;
    }
  }

  function prepareGLBMaterial(m) {
    if (!m) return;
    var r = (typeof m.roughness === 'number' && isFinite(m.roughness)) ? m.roughness : 0.75;
    m.roughness = Math.min(0.8, Math.max(0.7, r));       /* 0.7 ~ 0.8 */
    m.metalness = 0;
    m.envMapIntensity = 0.7;
    /* 部件是双面材质：阴影 pass 若也渲染背面会产生自遮挡黑斑（shadow acne）。
       只让正面参与阴影贴图。 */
    m.shadowSide = THREE.FrontSide;

    if (m.normalMap) {                                   /* 原模型自带的法线贴图：加强凹凸 */
      m.normalMap.encoding = THREE.LinearEncoding;
      m.normalMap.wrapS = m.normalMap.wrapT = THREE.RepeatWrapping;
      if (!m.normalScale) m.normalScale = new THREE.Vector2(1, 1);
      m.normalScale.set(1.45, 1.45);
      m.normalMap.needsUpdate = true;
    } else if (!m.userData || !m.userData.__noiseNormal) {
      /* 没有法线贴图时，用程序化噪声补一层微凹凸 */
      var nm = makeNoiseTexture(256, 128, 70, true);
      if (nm) {
        m.normalMap = nm;
        m.normalScale = new THREE.Vector2(0.9, 0.9);
        m.userData = m.userData || {};
        m.userData.__noiseNormal = true;
      }
    }

    if (!m.roughnessMap) {                               /* 原模型没有粗糙度贴图：生成一层细微变化 */
      var rm = makeNoiseTexture(256, 236, 22, false);
      if (rm) {
        rm.repeat.set(4, 4);
        m.roughnessMap = rm;
      }
    }

    if (m.map) {                                         /* 降饱和 */
      m.map.encoding = THREE.sRGBEncoding;
      anatomySourceMap = m.map; /* 分类使用原始图集，显示仍使用原有去饱和贴图 */
      m.map = desaturateTexture(m.map, DESAT);
    } else if (m.color) {
      var c = m.color;
      var lum2 = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
      c.setRGB(c.r + (lum2 - c.r) * DESAT, c.g + (lum2 - c.g) * DESAT, c.b + (lum2 - c.b) * DESAT);
    }
    m.needsUpdate = true;

    /* GLB 材质若被标记为透明，这里强制改回实心 */
    m.transparent = false;
    m.opacity = 1;
    m.depthWrite = true;
    m.depthTest = true;
    m.alphaTest = 0;

    var tag = (m.name || 'material') + '：' +
      'roughness=' + m.roughness + ' metalness=' + m.metalness +
      ' normalMap=' + (m.normalMap ? '✓' : '✗') +
      ' roughnessMap=' + (m.roughnessMap ? '✓' : '✗') +
      ' baseColorMap=' + (m.map ? '✓' : '✗') +
      ' transparent=' + m.transparent + ' depthWrite=' + m.depthWrite;
    console.log('[mat] ' + tag);
  }

  /* 程序化噪声贴图：isNormal=true 时输出切线空间法线，否则输出灰度粗糙度 */
  function makeNoiseTexture(size, base, amp, isNormal) {
    try {
      var cv = document.createElement('canvas');
      cv.width = cv.height = size;
      var ctx = cv.getContext('2d');
      if (!ctx || !ctx.fillRect) return null;
      var h = new Float32Array(size * size);
      for (var i = 0; i < h.length; i++) h[i] = base / 255;
      /* 叠若干径向渐变斑块，跨越边界时复制到对侧以保证可平铺 */
      try { ctx.filter = 'blur(1px)'; } catch (e) {}
      for (var n = 0; n < 90; n++) {
        var bx = Math.random() * size, by = Math.random() * size;
        var rad = size * (0.05 + Math.random() * 0.13);
        var dv = (Math.random() < 0.5 ? -1 : 1) * amp * (0.4 + Math.random() * 0.6) / 255;
        for (var ox = -1; ox <= 1; ox++) {
          for (var oy = -1; oy <= 1; oy++) {
            var cx = bx + ox * size, cy = by + oy * size;
            for (var yy = Math.max(0, Math.floor(cy - rad)); yy < Math.min(size, Math.ceil(cy + rad)); yy++) {
              for (var xx = Math.max(0, Math.floor(cx - rad)); xx < Math.min(size, Math.ceil(cx + rad)); xx++) {
                var dx = (xx - cx) / rad, dy = (yy - cy) / rad;
                var d2 = dx * dx + dy * dy;
                if (d2 >= 1) continue;
                var w = 0.5 * (1 + Math.cos(Math.PI * Math.sqrt(d2)));
                h[yy * size + xx] += dv * w;
              }
            }
          }
        }
      }
      var data = new Uint8ClampedArray(size * size * 4);
      if (isNormal) {
        var k = 6.0;
        for (var y2 = 0; y2 < size; y2++) {
          for (var x2 = 0; x2 < size; x2++) {
            var xl = (x2 - 1 + size) % size, xr = (x2 + 1) % size;
            var yt = (y2 - 1 + size) % size, yb = (y2 + 1) % size;
            var dxn = (h[y2 * size + xr] - h[y2 * size + xl]) * k;
            var dyn = (h[yb * size + x2] - h[yt * size + x2]) * k;
            var nx = -dxn, ny = -dyn, nz = 1;
            var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
            var o = (y2 * size + x2) * 4;
            data[o] = (nx / len * 0.5 + 0.5) * 255;
            data[o + 1] = (ny / len * 0.5 + 0.5) * 255;
            data[o + 2] = (nz / len * 0.5 + 0.5) * 255;
            data[o + 3] = 255;
          }
        }
      } else {
        for (var i3 = 0; i3 < size * size; i3++) {
          var v = Math.max(0, Math.min(1, h[i3])) * 255;
          data[i3 * 4] = v; data[i3 * 4 + 1] = v; data[i3 * 4 + 2] = v; data[i3 * 4 + 3] = 255;
        }
      }
      if (ctx.putImageData) {
        try { ctx.putImageData(new ImageData(data, size, size), 0, 0); } catch (e) { /* 忽略 */ }
      }
      var tex = new THREE.CanvasTexture(cv);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.encoding = THREE.LinearEncoding;
      tex.repeat.set(3, 3);
      return tex;
    } catch (e) {
      console.warn('[mat] 噪声贴图生成失败', e);
      return null;
    }
  }

  /* 只取“边界边”（仅被一个三角形使用）画细描边，正好落在部件之间的缝上 */
  function buildBoundaryLineGeometry(geo) {
    if (!geo || !geo.index) return null;
    var idx = geo.index.array;
    var pos = geo.attributes.position;
    if (!pos) return null;
    var edges = new Map();
    function addEdge(u, v) {
      var key = u < v ? (u * 1000003 + v) : (v * 1000003 + u);
      var e = edges.get(key);
      if (e) e.n++;
      else edges.set(key, { a: u, b: v, n: 1 });
    }
    for (var i = 0; i < idx.length; i += 3) {
      addEdge(idx[i], idx[i + 1]);
      addEdge(idx[i + 1], idx[i + 2]);
      addEdge(idx[i + 2], idx[i]);
    }
    var list = [];
    edges.forEach(function (e) { if (e.n === 1) list.push(e.a, e.b); });
    if (!list.length) return null;
    var arr = new Float32Array(list.length * 3);
    for (var j = 0; j < list.length; j++) {
      var vi = list[j];
      arr[j * 3] = pos.getX(vi);
      arr[j * 3 + 1] = pos.getY(vi);
      arr[j * 3 + 2] = pos.getZ(vi);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return g;
  }

  /* ================================================================== *
   * 外部 GLB 模型
   *   - GLTFLoader 读取 ./models/sm_liver_cross_section.glb
   *   - 按包围盒自动缩放（最长边 → 24 单位）并居中到原点
   *   - 用包围盒 + fov + 画布比例算出相机距离，保证完整可见
   *   - 加载完成后在 Console 打印整棵节点树
   * ================================================================== */
  var GLB_TARGET_SIZE = 24;      /* 与内置模型同量级：整机约 24 个单位（cm） */
  var builtinBox = null;         /* 内置模型的包围盒，切回来时用 */
  var glbReady = false;          /* GLB 是否已成功加载并拆分 */
  var EDGE_SEAM_COLOR = 0x5a2e25;   /* 缝隙描边：深红褐，不用纯黑 */
  var EDGE_SEAM_OPACITY = 0.4;
  var EMISSIVE_SEL = 0x4a3410;      /* 选中部件：极暗暖色自发光（不画线） */
  var EMISSIVE_I = 0.45;

  function loadGLB() {
    var hint = document.getElementById('glb-hint');
    if (!THREE.GLTFLoader) {
      if (hint) hint.textContent = 'GLTFLoader 未加载（vendor/GLTFLoader.js 缺失）。';
      return;
    }
    console.log('[GLB] 开始加载', GLB_URL);
    var loader = new THREE.GLTFLoader();
    loader.load(GLB_URL, onGLBLoaded,
      function (ev) {
        if (hint && ev && ev.total) {
          hint.textContent = '正在加载 GLB：' + Math.round(ev.loaded / ev.total * 100) + '%（' +
            (ev.loaded / 1048576).toFixed(1) + ' / ' + (ev.total / 1048576).toFixed(1) + ' MB）';
        }
      },
      function (err) {
        console.error('[GLB] 加载失败', err);
        if (hint) {
          hint.innerHTML = 'GLB 加载失败：' + ((err && err.message) ? err.message : '未知错误') +
            '<br><span style="color:#ffb3a6">双击 file:// 打开时浏览器会拦截本地文件读取。' +
            '请在项目目录运行 <code>node tools/serve.js</code>，再打开 http://127.0.0.1:8123/ ；' +
            '或使用已把模型内嵌进 HTML 的 liver-model.html。</span>';
        }
      });
  }

  function onGLBLoaded(gltf) {
    var obj = gltf.scene || (gltf.scenes && gltf.scenes[0]);
    if (!obj) { console.error('[GLB] 场景为空'); return; }

    /* ---- 1. 自动缩放 + 居中 ---- */
    obj.updateMatrixWorld(true);
    var box0 = new THREE.Box3().setFromObject(obj);
    var size0 = box0.getSize(new THREE.Vector3());
    var maxDim = Math.max(size0.x, size0.y, size0.z) || 1;
    var scaleK = GLB_TARGET_SIZE / maxDim;
    obj.scale.multiplyScalar(scaleK);
    obj.updateMatrixWorld(true);
    var box1 = new THREE.Box3().setFromObject(obj);
    var center1 = box1.getCenter(new THREE.Vector3());
    obj.position.sub(center1);          /* 包围盒中心移到世界原点 */
    obj.updateMatrixWorld(true);

    /* 阴影相机贴合模型范围：贴图密度更高，明显减少自遮挡产生的黑斑 */
    if (keyLight && keyLight.shadow) {
      var size1 = box1.getSize(new THREE.Vector3());
      var sExt = Math.max(size1.x, size1.y, size1.z) * 0.72;
      var sc = keyLight.shadow.camera;
      sc.left = -sExt; sc.right = sExt; sc.top = sExt; sc.bottom = -sExt;
      sc.near = 0.5; sc.far = Math.max(40, sExt * 10);
      sc.updateProjectionMatrix();
      keyLight.shadow.needsUpdate = true;
    }

    glbGroup.add(obj);
    glbModel = obj;

    /* ---- 2. 统计 + 打印节点树 ---- */
    var stats = { meshes: 0, verts: 0, tris: 0, materials: {} };
    var meshesToSplit = [];
    obj.traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      stats.meshes++;
      var pos = o.geometry.attributes && o.geometry.attributes.position;
      var v = pos ? pos.count : 0;
      var tri = o.geometry.index ? o.geometry.index.count / 3 : v / 3;
      stats.verts += v;
      stats.tris += Math.round(tri);
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (m) {
        if (!m) return;
        stats.materials[m.name || m.uuid] = (stats.materials[m.name || m.uuid] || 0) + 1;
        prepareGLBMaterial(m);          /* 粗糙度 / 金属度 / 法线强度 / 降饱和 */
      });
      o.castShadow = true;
      o.receiveShadow = true;
      o.userData = {
        kind: 'glb', name: o.name,
        verts: v, tris: Math.round(tri),
        material: mats.map(function (m) { return m ? (m.name || m.type) : ''; }).join(', ')
      };
      o.renderOrder = 1;
      meshesToSplit.push(o);
    });

    logGLBTree(obj, stats, { scaleK: scaleK, size0: size0 });

    /* ---- 2.5 按连通分量拆成可点击部件 ---- */
    glbParts = [];
    meshesToSplit.forEach(function (m) {
      try { splitMeshIntoParts(m); }
      catch (e) { console.error('[GLB] 拆分部件失败', e); pickables.push(m); }
    });
    if (glbParts.length) {
      applyPartMode();
      buildPartList();
      loadLabels();                              /* 读取已保存的医学标签 */
      buildDebrisFiller();                       /* 碎片合并成实心填补体（默认显示） */
      buildSeamlessMesh();                       /* 平滑无缝模式用的合并整体 */
      sanityCheckSolid();                        /* 硬断言：实心 + 无 z-fighting */
      glbSplitInfo.baseParts = glbParts.slice(); /* 供「还原为 37 个部件」使用 */
      samplePartColors();                        /* 从贴图采样每个部件的代表色 */
      initAnatomy();
      console.log('%c=== 部件拆分结果 ===', 'color:#5aa9ff;font-weight:bold');
      console.log('共 ' + glbParts.length + ' 个可点击部件（原始连通分量 ' + glbSplitInfo.rawCount +
        ' 个；近似平面的切面片合为 1 件，< ' + glbSplitInfo.minTris + ' 三角形的碎片合为 1 件）');
      if (console.table) console.table(glbParts.map(function (p, i) {
        return { 部件: '#' + i, 三角形: p.tris, 顶点: p.verts,
                 尺寸mm: p.size.map(function (v) { return (v * glbSplitInfo.scaleK * 1000).toFixed(0); }).join('×') };
      }).slice(0, 20));
      console.log('%c点击任意部件可在右侧面板看到它的编号与包围盒；window.__liver.parts 可直接访问',
        'color:#ffd479');
      window.__liverParts = glbParts;
    }

    /* ---- 3. 自动取景（包围盒 + fov + 画幅）---- */
    var box2 = new THREE.Box3().setFromObject(obj);
    glbInfo = { box: box2, stats: stats };
    builtinBox = new THREE.Box3(new THREE.Vector3(-12.8, -3.6, -5.3), new THREE.Vector3(11.8, 8.5, 5.3));
    setSource('glb');   // 内部会把相机取景到 glbInfo.box

    var hint = document.getElementById('glb-hint');
    if (hint) {
      hint.innerHTML = '已加载 <b>sm_liver_cross_section.glb</b> · 原始尺寸 ' +
        size0.toArray().map(function (v) { return v.toFixed(3); }).join(' × ') +
        ' · 放大 <b>×' + scaleK.toFixed(0) + '</b> · 网格 <b>' + stats.meshes +
        '</b> 个 · 顶点 <b>' + stats.verts.toLocaleString() + '</b>';
    }
    glbReady = true;
    document.getElementById('loading').classList.add('hidden');
  }

  function logGLBTree(rootObj, stats, meta) {
    var lines = [], rows = [];
    (function walk(o, depth) {
      var pad = new Array(depth + 1).join('  ');
      var line = pad + (depth ? '└─ ' : '') + o.type + '  "' + (o.name || '(未命名)') + '"';
      if (o.isMesh && o.geometry) {
        var g = o.geometry;
        var pos = g.attributes && g.attributes.position;
        var v = pos ? pos.count : 0;
        var tri = g.index ? g.index.count / 3 : v / 3;
        var mats = Array.isArray(o.material) ? o.material : [o.material];
        var matNames = mats.map(function (m) { return m ? (m.name || m.type) : '?'; }).join(' | ');
        line += '   [Mesh] 顶点=' + v + '  三角=' + Math.round(tri) +
                '  子分组=' + (g.groups ? g.groups.length : 0) + '  材质="' + matNames + '"';
        rows.push({ 节点: o.name, 顶点: v, 三角: Math.round(tri), 材质: matNames, 可见: o.visible });
      }
      lines.push(line);
      (o.children || []).forEach(function (c) { walk(c, depth + 1); });
    })(rootObj, 0);

    console.log('%c=== GLB 节点树（共 ' + countNodes(rootObj) + ' 个节点）===',
      'color:#5aa9ff;font-weight:bold;font-size:13px');
    console.log(lines.join('\n'));
    console.log('%c=== 网格清单 ===', 'color:#5aa9ff;font-weight:bold');
    if (console.table) console.table(rows); else console.log(rows);
    console.log('对象数：mesh=' + stats.meshes + '  顶点=' + stats.verts + '  三角=' + stats.tris +
      '  材质=' + JSON.stringify(stats.materials) +
      '  缩放×' + meta.scaleK.toFixed(1));
    console.log(stats.meshes <= 1
      ? '%c结论：整个模型只有 1 个网格 —— 血管与肝主体合并成了同一个 mesh，无法按对象分别绑定点击事件。' +
        '若要分区点击，需要①换成分件模型，②按材质/UV 分区拆网格，或③用射线命中点的世界坐标做区域判定。'
      : '%c结论：共 ' + stats.meshes + ' 个网格，可对每个 mesh 单独绑定点击事件（见下方清单）。',
      'color:#ffd479');
    console.log('%c提示：可在控制台访问 window.__liver = { scene, camera, controls, glbModel, pickables }',
      'color:#8fd18f');

    window.__liver = { scene: scene, camera: camera, controls: controls, glbModel: rootObj, pickables: pickables, stats: stats };
  }

  function countNodes(o) {
    var n = 1;
    (o.children || []).forEach(function (c) { n += countNodes(c); });
    return n;
  }

  /* ================================================================== *
   * 把 GLB 的单一网格按“连通分量”拆成可点击部件
   *   1. 用并查集把共享顶点的三角形归并成壳（shell）
   *   2. 近似平面的壳（切面片）合并为 1 件；过小的壳体合并为 1 件碎片
   *   3. 每个部件单独建几何体 + 独立材质，便于高亮/上色/单独显示
   * ================================================================== */
  var glbParts = [];
  var multiSelect = false, selectedParts = new Set();
  var partGroup = null;
  var seamlessMesh = null;   /* 平滑无缝模式：37 部件合并成的整体 */
  var glbSplitInfo = { rawCount: 0, minTris: 100, scaleK: 1 };
  var baseGLBMap = null;
  var anatomySourceMap = null;

  function splitMeshIntoParts(mesh) {
    var geo = mesh.geometry;
    var posAttr = geo.attributes && geo.attributes.position;
    if (!posAttr) return;

    var nV = posAttr.count;
    var index = geo.index ? geo.index.array : null;
    if (!index) {
      index = new Uint32Array(nV);
      for (var i0 = 0; i0 < nV; i0++) index[i0] = i0;
    }
    var nT = Math.floor(index.length / 3);
    if (nT < 2) { pickables.push(mesh); return; }

    /* ---- 并查集 ---- */
    var parent = new Int32Array(nV);
    for (var i1 = 0; i1 < nV; i1++) parent[i1] = i1;
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function uni(a, b) { var ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; }
    for (var t = 0; t < nT; t++) {
      var a = index[t * 3], b = index[t * 3 + 1], c = index[t * 3 + 2];
      uni(a, b); uni(b, c);
    }

    /* ---- 按根节点归组三角形 + 包围盒 ---- */
    var buckets = Object.create(null);
    for (var t2 = 0; t2 < nT; t2++) {
      var r = find(index[t2 * 3]);
      (buckets[r] || (buckets[r] = [])).push(t2);
    }
    var maxDim = Math.max(
      new THREE.Box3().setFromBufferAttribute(posAttr).getSize(new THREE.Vector3()).x || 0.1,
      new THREE.Box3().setFromBufferAttribute(posAttr).getSize(new THREE.Vector3()).y || 0.1,
      new THREE.Box3().setFromBufferAttribute(posAttr).getSize(new THREE.Vector3()).z || 0.1);
    var flatThresh = maxDim * 0.012;      /* 最薄边 < 1.2% 尺寸 → 视为平面片 */

    var shells = [];
    Object.keys(buckets).forEach(function (key) {
      var tris = buckets[key];
      var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (var i = 0; i < tris.length; i++) {
        for (var k = 0; k < 3; k++) {
          var vi = index[tris[i] * 3 + k];
          var x = posAttr.getX(vi), y = posAttr.getY(vi), z = posAttr.getZ(vi);
          if (x < mn[0]) mn[0] = x; if (y < mn[1]) mn[1] = y; if (z < mn[2]) mn[2] = z;
          if (x > mx[0]) mx[0] = x; if (y > mx[1]) mx[1] = y; if (z > mx[2]) mx[2] = z;
        }
      }
      var size = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
      shells.push({
        tris: tris, count: tris.length, min: mn, max: mx, size: size,
        center: [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2],
        flat: Math.min(size[0], size[1], size[2]) < flatThresh
      });
    });
    glbSplitInfo.rawCount += shells.length;

    var minTris = 100;
    var flats = [], bigs = [], tiny = [];
    shells.forEach(function (s) {
      if (s.flat) flats.push(s);
      else if (s.count >= minTris) bigs.push(s);
      else tiny.push(s);
    });
    bigs.sort(function (p, q) { return q.count - p.count; });

    /* ---- 建立与原 mesh 同变换的容器 ---- */
    var group = new THREE.Group();
    group.name = 'parts_of_' + (mesh.name || 'mesh');
    group.position.copy(mesh.position);
    group.quaternion.copy(mesh.quaternion);
    group.scale.copy(mesh.scale);
    (mesh.parent || glbGroup).add(group);
    mesh.visible = false;
    partGroup = group;

    var baseMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (baseMat && baseMat.map) baseGLBMap = baseMat.map;

    var mkPart = function (triList, label, merged) {
      var sub = buildPartGeometry(geo, index, triList);
      var mat = baseMat.clone();
      mat.name = 'part_' + glbParts.length;
      mat.side = THREE.DoubleSide;
      mat.needsUpdate = true;
      var m = new THREE.Mesh(sub, mat);
      m.name = label;
      m.renderOrder = 1;
      m.castShadow = true;
      m.receiveShadow = true;
      sub.computeBoundingBox();
      var bb = sub.boundingBox;
      var sz = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
      var sorted = sz.slice().sort(function (a, b) { return a - b; });
      var elong = sorted[2] / Math.max(sorted[1], 1e-6);
      var shape = merged ? 'merged' : (sorted[0] < maxDim * 0.012 ? 'flat' : (elong > 2.2 ? 'tube' : 'block'));
      var hue = (glbParts.length * 0.37) % 1;
      var color = new THREE.Color().setHSL(hue, 0.52, 0.56);
      /* 每个部件一点点色差：贴图模式下也保留，让边界更清楚 */
      var th = ((glbParts.length * 37) % 11) / 11;
      var tint = new THREE.Color(1 - th * 0.055, 1 - th * 0.012, 1 - (1 - th) * 0.05);
      m.userData = {
        kind: 'part', index: glbParts.length, label: label,
        tris: triList.length, verts: sub.attributes.position.count,
        bbox: bb, size: sz, merged: !!merged, color: color, tint: tint,
        shape: shape, elong: elong,
        baseRoughness: mat.roughness,
        isDebris: label.indexOf('碎片') === 0
      };
      /* 不做任何 polygonOffset：让每个部件按真实深度绘制，
         否则剖切面会被推到血管后面，露出管腔内部形成“漏洞” */
      mat.polygonOffset = false;
      mat.polygonOffsetFactor = 0;
      mat.polygonOffsetUnits = 0;
      /* 强制实心：绝不透明 */
      mat.transparent = false;
      mat.opacity = 1;
      mat.depthWrite = true;
      mat.depthTest = true;
      mat.alphaTest = 0;
      mat.needsUpdate = true;
      group.add(m);
      pickables.push(m);
      glbParts.push(m.userData);
      glbParts[glbParts.length - 1].mesh = m;
      m.userData.id = partKey(m.userData);       /* 稳定 ID，用于标签持久化 */

      /* 部件缝隙描边：深红褐、低透明度（默认不显示，仅选中时以暖色加色发光） */
      var edgeGeo = buildBoundaryLineGeometry(sub);
      if (edgeGeo) {
        var edgeMat = new THREE.LineBasicMaterial({
          color: EDGE_SEAM_COLOR, transparent: true, opacity: EDGE_SEAM_OPACITY,
          depthWrite: false
        });
        var ls = new THREE.LineSegments(edgeGeo, edgeMat);
        ls.name = 'edges';
        ls.renderOrder = 3;
        ls.visible = false;
        m.add(ls);
        m.userData.edges = ls;
      }
      return m;
    };

    bigs.forEach(function (s, i) { mkPart(s.tris, '部件 ' + (i + 1), false); });
    if (flats.length) {
      var allFlat = [];
      flats.forEach(function (s) { allFlat = allFlat.concat(s.tris); });
      mkPart(allFlat, '切面（' + flats.length + ' 片合并）', true);
    }
    if (tiny.length) {
      var allTiny = [];
      tiny.forEach(function (s) { allTiny = allTiny.concat(s.tris); });
      mkPart(allTiny, '碎片（' + tiny.length + ' 块合并）', true);
      /* 记录碎片信息：加载完成后用 BufferGeometryUtils 再合并一次并做断言 */
      glbSplitInfo.debris = {
        shells: tiny, partIndex: glbParts.length - 1,
        geo: geo, index: index, tris: allTiny.length
      };
    }

    glbSplitInfo.minTris = minTris;
    glbSplitInfo.scaleK = glbSplitInfo.scaleK || 1;
  }

  /* 从原几何体中裁出指定三角形，重建 position/normal/uv/tangent */
  function buildPartGeometry(geo, index, triList) {
    var map = new Map();
    var idx = [];
    var n = 0;
    for (var t = 0; t < triList.length; t++) {
      for (var k = 0; k < 3; k++) {
        var old = index[triList[t] * 3 + k];
        var nv = map.get(old);
        if (nv === undefined) { nv = n; map.set(old, nv); n++; }
        idx.push(nv);
      }
    }

    var attrs = {};
    ['position', 'normal', 'uv', 'tangent'].forEach(function (name) {
      var attr = geo.attributes[name];
      if (!attr) return;
      var item = attr.itemSize;
      var arr = new Float32Array(n * item);
      map.forEach(function (nv, old) {
        for (var k2 = 0; k2 < item; k2++) arr[nv * item + k2] = attr.array[old * item + k2];
      });
      attrs[name] = { array: arr, itemSize: item, normalized: attr.normalized };
    });

    var sub = new THREE.BufferGeometry();
    Object.keys(attrs).forEach(function (name) {
      var a = attrs[name];
      sub.setAttribute(name, new THREE.BufferAttribute(a.array, a.itemSize, a.normalized));
    });
    sub.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
    sub.computeBoundingSphere();
    sub.computeBoundingBox();
    return sub;
  }

  /* ------------------------------------------------------------------ *
   * 碎片合并：把 <100 三角形的细小碎块用一个独立 Mesh 合并，作为
   * “缝隙填补体”默认显示。做法是【替换】碎片部件本身的几何 —— 不再额外
   * 生成第二个重合网格，否则两份几何在同一位置必然 z-fighting。
   * ------------------------------------------------------------------ */
  function buildDebrisFiller() {
    var info = glbSplitInfo.debris;
    if (!info) return null;
    var part = glbParts[info.partIndex];
    if (!part || !part.mesh) return null;

    var BGU = THREE.BufferGeometryUtils || {};
    var merge = BGU.mergeBufferGeometries || BGU.mergeGeometries;
    if (typeof merge !== 'function') {
      console.warn('[debris] BufferGeometryUtils 不可用，保留原有合并几何');
      return null;
    }

    var expect = info.tris;                       /* 合并前三角形总数 */
    var merged = null;
    try {
      var geos = info.shells.map(function (s) {
        return buildPartGeometry(info.geo, info.index, s.tris);
      });
      merged = merge(geos, false);
      geos.forEach(function (g) { g.dispose(); });
    } catch (e) {
      console.warn('[debris] 合并失败', e);
      return null;
    }
    if (!merged) { console.warn('[debris] 合并返回 null'); return null; }

    var got = merged.index ? merged.index.count / 3 : merged.attributes.position.count / 3;
    if (got !== expect) {
      console.error('[debris] 断言失败：合并后 ' + got + ' 三角形 ≠ 原始 ' + expect + '，已放弃合并');
      merged.dispose();
      return null;
    }
    if (!merged.attributes.position || !merged.attributes.normal) {
      console.error('[debris] 断言失败：合并后缺少 position/normal 属性');
      merged.dispose();
      return null;
    }

    /* 替换几何（旧的丢弃），部件编号/标签/点击逻辑全部保持不变 */
    var oldGeo = part.mesh.geometry;
    part.mesh.geometry = merged;
    if (oldGeo && oldGeo !== merged) oldGeo.dispose();
    part.tris = got;
    part.verts = merged.attributes.position.count;
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    part.bbox = merged.boundingBox.clone();

    /* 完全实心的材质：与周围肝实质/血管一致，去掉色差、透明、线框 */
    var mat = part.mesh.material;
    mat.color.setHex(0xffffff);
    mat.emissive.setHex(0x000000);
    mat.emissiveIntensity = 0;
    mat.roughness = 0.75;
    mat.metalness = 0;
    mat.transparent = false;
    mat.opacity = 1;
    mat.depthWrite = true;
    mat.depthTest = true;
    mat.wireframe = false;
    mat.polygonOffset = false;
    mat.polygonOffsetFactor = 0;
    mat.polygonOffsetUnits = 0;
    mat.side = THREE.DoubleSide;
    mat.needsUpdate = true;
    part.noTint = true;
    part.mesh.visible = true;

    console.log('[debris] 已用 mergeBufferGeometries 合并 ' + info.shells.length +
      ' 块碎片 → ' + Math.round(got) + ' 三角形（断言通过：数量与属性均一致）');
    return part.mesh;
  }

  /* ------------------------------------------------------------------ *
   * 硬断言：所有可见部件必须是实心材质，且不存在完全重合的网格（z-fighting）
   * ------------------------------------------------------------------ */
  function sanityCheckSolid() {
    var problems = [];
    var sig = {};
    var visible = 0;
    glbParts.forEach(function (p) {
      if (!p.mesh || !p.mesh.visible) return;
      visible++;
      var m = p.mesh.material, g = p.mesh.geometry;
      if (!m) { problems.push(p.label + '：无材质'); return; }
      if (m.transparent) problems.push(p.label + '：transparent=true');
      if (m.opacity !== 1) problems.push(p.label + '：opacity=' + m.opacity);
      if (!m.depthWrite) problems.push(p.label + '：depthWrite=false');
      if (m.depthTest === false) problems.push(p.label + '：depthTest=false');
      if (m.wireframe) problems.push(p.label + '：wireframe=true');
      if (m.polygonOffset) problems.push(p.label + '：polygonOffset=true');
      if (!g.attributes.position) problems.push(p.label + '：缺 position');
      if (!g.attributes.normal) problems.push(p.label + '：缺 normal');
      if (!g.boundingBox) g.computeBoundingBox();
      var bb = g.boundingBox;
      /* 同一位置 + 同一三角形数 = 重复网格，必然 z-fighting */
      var key = [
        Math.round(bb.min.x * 1e5), Math.round(bb.min.y * 1e5), Math.round(bb.min.z * 1e5),
        Math.round(bb.max.x * 1e5), Math.round(bb.max.y * 1e5), Math.round(bb.max.z * 1e5),
        p.tris
      ].join('|');
      if (sig[key]) problems.push(p.label + ' 与 ' + sig[key] + ' 完全重合（z-fighting 风险）');
      else sig[key] = p.label;
    });

    var ok = problems.length === 0;
    window.__liverSanityCheck = sanityCheckSolid;   /* 控制台可随时复查 */
    window.__liverSanity = { ok: ok, visible: visible, problems: problems };
    if (ok) {
      console.log('%c[断言] ✓ ' + visible + ' 个可见部件全部实心、深度状态正常、无重合网格',
        'color:#7fd18f;font-weight:bold');
    } else {
      console.error('[断言] ✗ 发现问题：\n  ' + problems.join('\n  '));
    }
    return ok;
  }

  /* ================================================================== *
   * 智能解剖合并：把被切成多段的同一根血管自动拼回一根
   *   判据：① 贴图采样色接近 ② 包围盒相接 ③ 都是细长型 ④ 主轴方向一致
   * ================================================================== */
  var MERGE_CFG = {
    colorTol: 0.16,     /* RGB 距离阈值 */
    gapTol: 0.022,      /* 包围盒间隙 / 模型最大尺寸 */
    elongMin: 2.0,      /* 最长边 / 次长边 */
    axisDot: 0.68,      /* 主轴夹角余弦下限 */
    sampleStride: 17    /* 采样顶点步长 */
  };
  var colorCtx = null;

  function samplePartColors() {
    var tex = baseGLBMap;
    if (!tex || !tex.image) { console.warn('[merge] 没有 baseColor 贴图，跳过颜色采样'); return; }
    try {
      var img = tex.image;
      var w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
      if (!w || !h) return;
      if (!colorCtx) {
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        var c2 = cv.getContext('2d');
        if (!c2 || !c2.drawImage) return;
        c2.drawImage(img, 0, 0, w, h);
        colorCtx = { ctx: c2, w: w, h: h };
      }
      var data = colorCtx.ctx.getImageData(0, 0, w, h).data;
      glbParts.forEach(function (p) {
        var uv = p.mesh.geometry.attributes.uv;
        if (!uv) return;
        var r = 0, g = 0, b = 0, n = 0;
        for (var i = 0; i < uv.count; i += MERGE_CFG.sampleStride) {
          var u = uv.getX(i), v = uv.getY(i);
          var px = Math.min(w - 1, Math.max(0, Math.round(u * (w - 1))));
          var py = Math.min(h - 1, Math.max(0, Math.round(v * (h - 1))));
          var o = (py * w + px) * 4;
          r += data[o]; g += data[o + 1]; b += data[o + 2];
          n++;
        }
        if (!n) return;
        p.texColor = new THREE.Color(r / n / 255, g / n / 255, b / n / 255);
      });
      console.log('[merge] 已采样 ' + glbParts.filter(function (p) { return p.texColor; }).length + ' 个部件的贴图颜色');
    } catch (e) {
      console.warn('[merge] 颜色采样失败（canvas 受限）', e);
    }
  }

  /* 包围盒之间的最短距离（相交或接触 = 0） */
  function boxGap(a, b) {
    var dx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x);
    var dy = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y);
    var dz = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /* 包围盒最长轴的下标 */
  function longestAxis(size) {
    var k = 0;
    if (size[1] > size[k]) k = 1;
    if (size[2] > size[k]) k = 2;
    return k;
  }

  /* 是否像"同一根管子的前后两段"：同一长轴、首尾相接、轴线对齐
     （分叉的两支轴线会明显错开，因此不会被合并） */
  function isCollinearSegment(A, B) {
    var ka = longestAxis(A.size), kb = longestAxis(B.size);
    if (ka !== kb) return false;
    var ca = A.bbox.getCenter(new THREE.Vector3());
    var cb = B.bbox.getCenter(new THREE.Vector3());
    var along = Math.abs(cb.getComponent(ka) - ca.getComponent(ka));
    var perp = 0;
    for (var i = 0; i < 3; i++) {
      if (i === ka) continue;
      var d = cb.getComponent(i) - ca.getComponent(i);
      perp += d * d;
    }
    perp = Math.sqrt(perp);
    var meanLen = (A.size[ka] + B.size[ka]) / 2;
    var thick = Math.min(A.size[ka] > 0 ? Math.min(A.size[(ka + 1) % 3], A.size[(ka + 2) % 3]) : 0,
                         Math.min(B.size[(kb + 1) % 3], B.size[(kb + 2) % 3]));
    /* 轴线横向偏移不超过管径量级 */
    if (perp > Math.max(thick * 1.8, meanLen * 0.34)) return false;
    /* 沿轴必须是"接上去"的，而不是并排重叠 */
    if (along < meanLen * 0.32) return false;
    return true;
  }

  /* 包围盒最长轴的方向（归一化） */
  function boxAxis(p) {
    var v = new THREE.Vector3();
    v.setComponent(longestAxis(p.size), 1);
    return v;
  }

  /* 纯函数：输入部件数组，返回合并分组（供测试直接调用） */
  function planVesselMerges(parts, cfg, maxDim) {
    cfg = cfg || MERGE_CFG;
    var gapTol = (maxDim || 1) * cfg.gapTol;
    var n = parts.length;
    var parent = [];
    for (var i = 0; i < n; i++) parent.push(i);
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function union(a, b) { var ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; }

    var statPairs = 0, statElong = 0, statColor = 0, statGap = 0, statAxis = 0, statOk = 0;
    /* 采样不到贴图颜色时（canvas 受限）退化为纯几何判定，此时必须更保守，
       否则会把不同血管连成一大团。 */
    var hasColor = parts.some(function (p) { return !!p.texColor; });
    var axisMin = hasColor ? cfg.axisDot : 0.93;
    var gapMax = hasColor ? gapTol : gapTol * 0.3;
    planVesselMerges.colorMode = hasColor ? 'texture' : 'geometry-only';
    for (var a = 0; a < n; a++) {
      for (var b = a + 1; b < n; b++) {
        statPairs++;
        var A = parts[a], B = parts[b];
        if (!A || !B) continue;
        if (A.isDebris || B.isDebris) continue;              /* 碎片单独处理 */
        if (A.keepSeparate || B.keepSeparate) continue;
        /* 缺失颜色证据不能被解释为“颜色相同”。 */
        if (!A.texColor || !B.texColor) { statColor++; continue; }
        if (!(A.elong >= cfg.elongMin && B.elong >= cfg.elongMin)) { statElong++; continue; }   /* 必须都细长 */
        if (A.texColor && B.texColor) {
          var d = Math.sqrt(
            Math.pow(A.texColor.r - B.texColor.r, 2) +
            Math.pow(A.texColor.g - B.texColor.g, 2) +
            Math.pow(A.texColor.b - B.texColor.b, 2));
          if (d > cfg.colorTol) { statColor++; continue; }     /* 颜色差太多（静脉 vs 动脉） */
        }
        if (boxGap(A.bbox, B.bbox) > gapMax) { statGap++; continue; }   /* 必须挨着 */
        var axisA = A._axis || (A._axis = boxAxis(A));
        var axisB = B._axis || (B._axis = boxAxis(B));
        if (axisA.dot(axisB) < axisMin) { statAxis++; continue; }    /* 走向要一致（分叉不合并） */
        if (!isCollinearSegment(A, B)) { statAxis++; continue; }      /* 必须是首尾相接的同轴段 */
        statOk++;
        union(a, b);
      }
    }
    planVesselMerges.stats = {
      pairs: statPairs, rejectElong: statElong, rejectColor: statColor,
      rejectGap: statGap, rejectAxis: statAxis, accepted: statOk
    };
    var map = {}, groups = [];
    for (var k = 0; k < n; k++) {
      var r = find(k);
      if (map[r] === undefined) { map[r] = groups.length; groups.push([]); }
      groups[map[r]].push(k);
    }
    return groups;
  }
  window.__planVesselMerges = planVesselMerges;   /* 供自动化测试调用 */

  /* 执行合并：重建部件数组 */
  function autoMergeVessels() {
    clearSelection();
    if (!glbParts.length) return null;
    var BGU = THREE.BufferGeometryUtils || {};
    var merge = BGU.mergeBufferGeometries || BGU.mergeGeometries;
    if (typeof merge !== 'function') { console.warn('[merge] BufferGeometryUtils 不可用'); return null; }

    var maxDim = 0;
    glbParts.forEach(function (p) { maxDim = Math.max(maxDim, p.size[0], p.size[1], p.size[2]); });

    updateAnatomy();
    /* 已有人工记录不被几何启发式吞并；未知/混色也不自动合并。 */
    glbParts.forEach(function(p){
      p.keepSeparate = !!LABELS[p.id] || !p.anatomyCandidate || p.anatomyCandidate.system === 'unknown';
    });
    var groups = planVesselMerges(glbParts, MERGE_CFG, maxDim);
    var before = glbParts.length;
    var triBefore = glbParts.reduce(function (s, p) { return s + p.tris; }, 0);
    console.log('[merge] 判据统计', JSON.stringify(planVesselMerges.stats),
      '| 部件体型:', glbParts.map(function (p) { return p.elong.toFixed(1); }).join(','));

    var newParts = [];
    var created = [];
    groups.forEach(function (g) {
      if (g.length === 1) {
        newParts.push(glbParts[g[0]]);
        return;
      }
      var members = g.map(function (i) { return glbParts[i]; });
      var merged;
      try {
        merged = merge(members.map(function (m) { return m.mesh.geometry; }), false);
      } catch (e) { console.warn('[merge] 合并失败', e); merged = null; }
      if (!merged) { members.forEach(function (m) { newParts.push(m); }); return; }

      var triExpect = members.reduce(function (s, m) { return s + m.tris; }, 0);
      var triGot = merged.index ? merged.index.count / 3 : merged.attributes.position.count / 3;
      if (triGot !== triExpect) {
        console.error('[merge] 三角形数不符（' + triGot + ' ≠ ' + triExpect + '），放弃该组');
        merged.dispose();
        members.forEach(function (m) { newParts.push(m); });
        return;
      }

      var first = members[0];
      var mat = first.mesh.material.clone();
      mat.color.setHex(0xffffff);
      mat.emissive.setHex(0x000000);
      mat.emissiveIntensity = 0;
      mat.transparent = false; mat.opacity = 1; mat.depthWrite = true; mat.depthTest = true;
      mat.wireframe = false; mat.polygonOffset = false;
      mat.needsUpdate = true;

      var mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.renderOrder = 1;
      mesh.name = '合并血管 ' + (created.length + 1);
      (partGroup || glbGroup).add(mesh);
      merged.computeBoundingBox();
      var bb = merged.boundingBox;
      var sz = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
      var sortedSz = sz.slice().sort(function (x, y) { return x - y; });

      var part = {
        kind: 'part', label: '合并血管 ' + (created.length + 1),
        tris: triGot, verts: merged.attributes.position.count,
        bbox: bb.clone(), size: sz, merged: true, color: first.color, tint: null,
        noTint: true, shape: 'tube', elong: sortedSz[2] / Math.max(sortedSz[1], 1e-6),
        baseRoughness: 0.75, isDebris: false, texColor: first.texColor,
        members: members.map(function (m) { return m.label; }),
        sourcePartIds: members.reduce(function(ids,m){return ids.concat(m.sourcePartIds || [m.id]);},[]),
        mesh: mesh
      };
      mesh.userData = part;
      part.id = partKey(part);
      newParts.push(part);
      created.push(part);
    });

    /* 重建索引 / 可见性 / 列表 */
    glbParts.forEach(function (p) { if (p.mesh) p.mesh.visible = false; });
    glbParts = newParts;
    glbParts.forEach(function (p, i) { p.index = i; p.mesh.userData.index = i; });
    pickables = pickables.filter(function (o) { return !(o.userData && o.userData.kind === 'part'); });
    glbParts.forEach(function (p) { pickables.push(p.mesh); });

    state.selectedPart = null;
    applyPartMode();
    buildPartList();
    applyLabels();
    window.__liverParts = glbParts;

    var triAfter = glbParts.reduce(function (s, p) { return s + p.tris; }, 0);
    console.log('%c[merge] ' + before + ' 个部件 → ' + glbParts.length + ' 个（合并了 ' +
      created.length + ' 组；三角形 ' + triBefore + ' → ' + triAfter + '）', 'color:#7fd18f;font-weight:bold');
    if (triBefore !== triAfter) console.error('[merge] 断言失败：三角形总数变化了');
    created.forEach(function (c) {
      console.log('  · ' + c.label + ' ← ' + c.members.join(' + '));
    });
    return glbParts;
  }

  /* 还原成最初的 37 个部件 */
  function restoreVesselParts() {
    clearSelection();
    var base = glbSplitInfo.baseParts;
    if (!base || !base.length) return;
    glbParts.forEach(function (p) {
      if (base.indexOf(p) < 0) {
        if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
        p.mesh.geometry.dispose();
      }
    });
    glbParts = base.slice();
    glbParts.forEach(function (p, i) {
      p.index = i;
      p.mesh.userData.index = i;
      p.mesh.visible = true;
      if (p.mesh.parent !== (partGroup || glbGroup)) (partGroup || glbGroup).add(p.mesh);
    });
    pickables = pickables.filter(function (o) { return !(o.userData && o.userData.kind === 'part'); });
    glbParts.forEach(function (p) { pickables.push(p.mesh); });
    state.selectedPart = null;
    applyPartMode();
    buildPartList();
    applyLabels();
    window.__liverParts = glbParts;
    console.log('[merge] 已还原为 ' + glbParts.length + ' 个独立部件');
  }

  /* 部件显示模式：原贴图 / 按部件着色 / 线框 / 描边 */
  function applyPartMode() {
    glbParts.forEach(function (p) {
      var mat = p.mesh.material;
      if (state.partColor) {
        mat.map = null;
        mat.color.copy(p.color);
      } else {
        mat.map = baseGLBMap;
        /* 碎片合并体不加色差，保持与周围组织一致 */
        if (p.noTint) mat.color.setHex(0xffffff);
        else if (p.tint) mat.color.copy(p.tint);
        else mat.color.setHex(0xffffff);
      }
      if(anatomyColor && window.LiverAnatomy) {
        var sys=window.LiverAnatomy.systems[p.anatomySystem];
        if(sys && sys.color != null && p.anatomySystem!=='unknown') { mat.map=null;mat.color.set(sys.color); }
      }
      mat.wireframe = !!state.partWire;
      /* 任何模式下都保持实心不透明，杜绝半透明排序问题 */
      mat.transparent = false;
      mat.opacity = 1;
      mat.depthWrite = true;
      mat.depthTest = true;
      mat.needsUpdate = true;

      /* 缝隙描边：只在勾选“显示所有部件缝隙”时出现，选中时不再画任何线 */
      if (p.edges) {
        var showSeam = state.partEdges === true;
        p.edges.visible = !state.partWire && showSeam;
        if (p.edges.visible) {
          var em = p.edges.material;
          em.color.setHex(EDGE_SEAM_COLOR);
          em.opacity = EDGE_SEAM_OPACITY;
          em.blending = THREE.NormalBlending;
          em.needsUpdate = true;
        }
      }
    });
    /* 平滑无缝模式：只显示合并后的整体，隐藏全部独立部件 */
    if (state.seamless) {
      glbParts.forEach(function (p) { p.mesh.visible = false; });
      if (seamlessMesh) seamlessMesh.visible = true;
      return;
    }
    if (seamlessMesh) seamlessMesh.visible = false;
    if (state.isolate && state.selectedPart != null && glbParts[state.selectedPart]) {
      glbParts.forEach(function (p, i) { p.mesh.visible = (i === state.selectedPart); });
    } else {
      /* 默认全部显示（隐藏碎片会在血管根部留下空洞）；只有用户手动隐藏的才不显示 */
      glbParts.forEach(function (p) {
        p.mesh.visible = (state.showDebris !== false || !p.isDebris) && !p.hidden;
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * 平滑无缝模式：用 BufferGeometryUtils 把 37 个部件合并回一个整体
   * ------------------------------------------------------------------ */
  function buildSeamlessMesh() {
    if (seamlessMesh) {
      if (seamlessMesh.parent) seamlessMesh.parent.remove(seamlessMesh);
      if (seamlessMesh.geometry) seamlessMesh.geometry.dispose();
      pickables = pickables.filter(function (o) { return o !== seamlessMesh; });
      seamlessMesh = null;
    }
    if (!glbParts.length) return null;

    var BGU = THREE.BufferGeometryUtils || {};
    var merge = BGU.mergeBufferGeometries || BGU.mergeGeometries;
    if (typeof merge !== 'function') {
      console.warn('[seamless] BufferGeometryUtils 不可用，无法合并');
      return null;
    }
    var geos = glbParts.map(function (p) { return p.mesh.geometry; });
    var merged = null;
    try {
      merged = merge(geos, false);
    } catch (e) {
      console.warn('[seamless] 合并失败', e);
    }
    if (!merged) return null;

    var src = glbParts[0].mesh.material;
    var mat = src.clone();
    mat.name = 'seamless_liver';
    mat.color.setHex(0xffffff);      /* 统一颜色，去掉各部件色差 */
    mat.emissive.setHex(0x000000);
    mat.emissiveIntensity = 0;
    mat.roughness = 0.75;
    mat.metalness = 0;
    mat.transparent = false;
    mat.opacity = 1;
    mat.depthWrite = true;
    mat.depthTest = true;
    mat.wireframe = false;
    mat.polygonOffset = false;
    mat.polygonOffsetFactor = 0;
    mat.polygonOffsetUnits = 0;
    mat.side = THREE.DoubleSide;
    mat.needsUpdate = true;

    var mesh = new THREE.Mesh(merged, mat);
    mesh.name = '无缝整体（37 部件合并）';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    mesh.visible = false;
    var triCount = merged.index ? merged.index.count / 3 : merged.attributes.position.count / 3;
    mesh.userData = { kind: 'seamless', tris: triCount };

    (partGroup || glbGroup).add(mesh);
    pickables.push(mesh);
    seamlessMesh = mesh;
    window.__liverSeamless = mesh;
    console.log('[seamless] 已把 ' + geos.length + ' 个部件合并为整体：' +
      Math.round(triCount).toLocaleString() + ' 三角形');
    return mesh;
  }

  function buildPartList() {
    var host = document.getElementById('part-list');
    var panel = document.getElementById('glb-panel');
    if (!host) return;
    if (panel) panel.style.display = '';
    var cnt = document.getElementById('part-count');
    if (cnt) cnt.textContent = String(glbParts.length);
    var keepScroll = host.scrollTop || 0;
    host.innerHTML = '';
    updateAnatomy();
    function makeRow(p, i) {
      var el = document.createElement('div');
      el.className = 'part-item';
      el.dataset.part = i;
      var hex = '#' + p.color.getHexString();
      el.innerHTML = '<span class="sw" style="background:' + hex + '"></span>' +
        '<span class="n">' + esc(partDisplayName(p)) + '</span><span class="t">' + p.tris + '△</span>';
      el.addEventListener('click', function (e) { selectPart(i,e); });
      p._el = el;
      p._nameEl = el.querySelector ? el.querySelector('.n') : null;
      return el;
    }
    if(window.LiverAnatomy) window.LiverAnatomy.buildTree(host,glbParts,function(p){return LABELS[p.id]||{};},makeRow);
    else glbParts.forEach(function(p,i){host.appendChild(makeRow(p,i));});
    if(segmentUI) segmentUI.refresh(glbParts);
    host.scrollTop = keepScroll;
    applyLabels();
    if (state.selectedPart != null) {
      document.querySelectorAll('.part-item').forEach(function (el) {
        el.classList.toggle('active', selectedParts.has(glbParts[Number(el.dataset.part)]));
      });
    }
  }

  /* ================================================================== *
   * 医学标签：手动命名 + 解剖/临床要点 + 持久化
   *   - localStorage（始终）
   *   - POST /api/labels（起 tools/serve.js 时写进 models/liver-labels.json）
   *   - 手动导出 / 导入 JSON
   * ================================================================== */
  var anatomyColor = false, segmentUI = null;
  var segmentNames = {I:'I段 · 尾状叶',II:'II段 · 左外侧区上段',III:'III段 · 左外侧区下段',IV:'IV段 · 左内侧区',V:'V段 · 右前区下段',VI:'VI段 · 右后区下段',VII:'VII段 · 右后区上段',VIII:'VIII段 · 右前区上段'};
  function updateAnatomy() {
    if (!window.LiverAnatomy) return;
    glbParts.forEach(function(p) {
      p.anatomyCandidate = window.LiverAnatomy.classify(p, anatomySourceMap || baseGLBMap);
      p.anatomySystem = window.LiverAnatomy.systemFor(p, LABELS[p.id] || {});
    });
  }
  function initAnatomy() {
    updateAnatomy();
    if (window.LiverSegments && !segmentUI) segmentUI = window.LiverSegments.mount({THREE:THREE,parent:glbGroup,parts:glbParts,host:document.getElementById('segment-controls'),onStatus:setLabelStatus});
    buildPartList();
    var toggle=document.getElementById('chk-anatomy');
    if (toggle) toggle.addEventListener('change',function(){
      anatomyColor=toggle.checked;
      if(anatomyColor){state.seamless=false;document.getElementById('chk-seamless').checked=false;}
      applyPartMode();
    });
  }
  function anatomyEditor(p,L) {
    if(!window.LiverAnatomy)return '';
    var options=Object.keys(window.LiverAnatomy.systems).map(function(k){var def=window.LiverAnatomy.systems[k];return '<option value="'+k+'"'+(L.anatomySystem===k?' selected':'')+'>'+esc(def.label || def.name || k)+'</option>';}).join('');
    var seg='<option value="">未指定（不把整块实质默认为一个肝段）</option>';
    Object.keys(segmentNames).forEach(function(k){seg+='<option value="'+k+'"'+(L.segment===k?' selected':'')+'>'+segmentNames[k]+'</option>';});
    var sys=window.LiverAnatomy.systems[p.anatomySystem] || window.LiverAnatomy.systems.unknown;
    var evidence = L.anatomySystem ? '来源：人工标注（未独立医学审核）' : (p.anatomySystem==='unknown' ? '来源：证据不足，保留未分类' : '来源：贴图颜色启发式，待确认');
    var provenance=p.sourcePartIds ? '<p class="hint">几何合并来源：'+esc(p.sourcePartIds.join('、'))+'。几何相接不证明同属一条解剖血管。</p>' : '';
    return '<div class="i-sec"><h3>解剖归类</h3><p>'+esc(sys.name)+' · '+esc(evidence)+'</p>'+provenance+'<p class="hint">颜色仅为候选；蓝色不能区分门静脉、肝静脉和下腔静脉。人工归类优先。</p><label>系统<select id="anatomy-system"><option value="">自动候选 / 未确认</option>'+options+'</select></label><label>人工肝段标注<select id="anatomy-segment">'+seg+'</select></label><button id="anatomy-save" class="lab-btn">保存解剖归类</button><p class="hint">肝实质不等同于 Glisson 系统。Glisson 鞘包绕门静脉、肝动脉及胆管分支。</p></div>';
  }
  var LABELS = {};
  var LS_KEY = 'liver3d.labels.v1';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* 用「三角形数 + 包围盒中心」生成稳定 ID：即使拆分顺序变化也能对上 */
  function partKey(p) {
    var bb = p.bbox;
    var c = [(bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2];
    return 'p' + p.tris + '_' + c.map(function (v) { return Math.round(v * 1000); }).join('_');
  }

  function partDisplayName(p) {
    var L = LABELS[p.id];
    return (L && L.name) ? L.name : (p.label || ('部件 ' + (p.index + 1)));
  }

  /* ================================================================== *
   * 内置解剖知识库索引：名称 → 解剖要点 / 临床要点 / 文献
   * 匹配顺序：中文全名 → 中文基名（去掉括号）→ 拉丁文 → 英文 → 包含关系
   * ================================================================== */
  var KB = null;

  function normName(s) {
    return String(s || '')
      .replace(/[\s\u3000]+/g, '')
      .replace(/[（）()]/g, '')
      .toLowerCase();
  }

  function buildKBIndex() {
    if (KB) return KB;
    KB = [];
    function push(e) {
      var zh = String(e.zh || '');
      /* 括号里的别名也参与匹配："Ⅰ段（尾状叶）" → 可用「尾状叶」命中 */
      var aliases = [];
      var re = /[（(]([^）)]+)[）)]/g, m;
      while ((m = re.exec(zh))) aliases.push(m[1]);
      KB.push({
        id: e.id || zh,
        zh: zh,
        baseZh: zh.split(/[（(]/)[0],
        aliases: aliases,
        latin: e.latin || '',
        en: e.en || '',
        bullets: (e.bullets || []).slice(),
        clinical: (e.clinical || []).slice(),
        refs: (e.refs || []).slice()
      });
    }
    D.STRUCTURES.forEach(push);
    D.SEGMENTS.forEach(function (s) { push({ id: 'seg' + s.id, zh: s.zh, latin: s.latin, en: s.en, bullets: s.bullets, clinical: s.clinical, refs: s.refs }); });
    D.SURFACE_FEATURES.forEach(function (s) { push({ id: s.id, zh: s.zh, latin: s.latin, en: s.en, bullets: s.bullets, refs: s.refs }); });
    return KB;
  }

  function matchKB(q) {
    var list = buildKBIndex();
    var qn = normName(q);
    if (!qn || qn.length < 2) return null;
    var best = null, bestScore = 0, bestIdx = 1e9;
    list.forEach(function (e, idx) {
      var cands = [
        { v: e.zh, w: 100 }, { v: e.baseZh, w: 100 },
        { v: e.latin, w: 100 }, { v: e.en, w: 100 }
      ];
      (e.aliases || []).forEach(function (a) { cands.push({ v: a, w: 95 }); });
      var score = 0;
      cands.forEach(function (c) {
        var v = normName(c.v);
        if (!v) return;
        var s = 0;
        if (v === qn) s = c.w;
        else if (v.indexOf(qn) === 0) s = c.w - 20 - Math.min(20, v.length - qn.length);
        else if (v.indexOf(qn) >= 0) s = c.w - 40 - Math.min(20, v.length - qn.length);
        else if (qn.indexOf(v) === 0) s = c.w - 50 - Math.min(20, qn.length - v.length);
        if (s > score) score = s;
      });
      if (score > bestScore || (score === bestScore && score > 0 && idx < bestIdx)) {
        bestScore = score; best = e; bestIdx = idx;
      }
    });
    return bestScore >= 50 ? { entry: best, score: bestScore } : null;
  }

  function updateLabMatch() {
    var el = document.getElementById('lab-name');
    var hint = document.getElementById('lab-match');
    var btn = document.getElementById('lab-fill');
    if (!el || !hint) return;
    var q = (el.value || '').trim();
    var m = matchKB(q);
    if (m) {
      hint.innerHTML = '✓ 知识库匹配：<b>' + esc(m.entry.zh) + '</b>' +
        (m.entry.latin ? '（' + esc(m.entry.latin) + '）' : '') +
        ' — 保存时会自动填入要点，也可点「从知识库填入」';
      hint.style.color = '#8fd18f';
      if (btn) btn.disabled = false;
    } else {
      hint.textContent = q ? '知识库里没有匹配项，可手动填写要点。' : '';
      hint.style.color = '';
      if (btn) btn.disabled = true;
    }
  }

  function fillFromKB(force) {
    var el = document.getElementById('lab-name');
    if (!el) return false;
    var m = matchKB((el.value || '').trim());
    if (!m) return false;
    var e = m.entry;
    var latinEl = document.getElementById('lab-latin');
    var bEl = document.getElementById('lab-bullets');
    var cEl = document.getElementById('lab-clinical');
    if (latinEl && (force || !String(latinEl.value || '').trim())) latinEl.value = e.latin || '';
    if (bEl && (force || !String(bEl.value || '').trim())) bEl.value = (e.bullets || []).join('\n');
    if (cEl && (force || !String(cEl.value || '').trim())) cEl.value = (e.clinical || []).join('\n');
    var msg = document.getElementById('lab-msg');
    if (msg) msg.textContent = '已从知识库填入「' + e.zh + '」的要点（可继续修改后保存）';
    return true;
  }

  function readLocalLabels() {
    try {
      var raw = window.localStorage.getItem(LS_KEY);
      if (!raw) return null;
      var j = JSON.parse(raw);
      return (j && j.labels) ? j : null;
    } catch (e) { return null; }
  }

  function loadLabels() {
    var local = readLocalLabels();
    function done(store, src) {
      LABELS = (store && store.labels) ? store.labels : {};
      applyLabels();
      buildPartList();applyPartMode();
      setLabelStatus(src + ' · 已载入 ' + Object.keys(LABELS).length + ' 条标签');
      refreshOpenPartPanel();
    }
    if (typeof fetch !== 'function') { done(local, 'localStorage'); return; }
    fetch('./models/liver-labels.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (fileStore) {
        if (fileStore && fileStore.labels && local && local.labels) {
          var useFile = (fileStore.updatedAt || 0) >= (local.updatedAt || 0);
          done(useFile ? fileStore : local, useFile ? 'models/liver-labels.json' : 'localStorage');
        } else if (fileStore && fileStore.labels) {
          done(fileStore, 'models/liver-labels.json');
        } else {
          done(local, 'localStorage');
        }
      })
      .catch(function () { done(local, 'localStorage'); });
  }

  function setLabelStatus(msg) {
    var el = document.getElementById('label-status');
    if (el) el.textContent = msg;
  }

  function saveLabels() {
    var payload = {
      version: 1, model: 'sm_liver_cross_section.glb',
      updatedAt: Date.now(), labels: LABELS
    };
    try { window.localStorage.setItem(LS_KEY, JSON.stringify(payload)); } catch (e) {}
    var n = Object.keys(LABELS).length;
    if (typeof fetch === 'function' && location.protocol.indexOf('http') === 0) {
      fetch('/api/labels', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (j && j.ok) setLabelStatus('已保存：localStorage + models/liver-labels.json（' + n + ' 条）');
          else setLabelStatus('已保存到浏览器 localStorage（' + n + ' 条）');
        })
        .catch(function () { setLabelStatus('已保存到浏览器 localStorage（' + n + ' 条）'); });
    } else {
      setLabelStatus('已保存到浏览器 localStorage（' + n + ' 条）· file:// 无法写文件，可用「导出 JSON」');
    }
  }

  function exportLabels() {
    var payload = {
      version: 1, model: 'sm_liver_cross_section.glb',
      updatedAt: Date.now(), labels: LABELS
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'liver-labels.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    }, 400);
    setLabelStatus('已导出 liver-labels.json（' + Object.keys(LABELS).length + ' 条）');
  }

  function importLabelsFromFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var j = JSON.parse(reader.result);
        if (!j || !j.labels) throw new Error('缺少 labels 字段');
        LABELS = j.labels;
        applyLabels();
        buildPartList();
        saveLabels();
        setLabelStatus('已导入 ' + Object.keys(LABELS).length + ' 条标签');
      } catch (e) {
        setLabelStatus('导入失败：' + (e.message || e));
      }
    };
    reader.readAsText(file);
  }

  function applyLabels() {
    glbParts.forEach(function (p) {
      p.name = (LABELS[p.id] && LABELS[p.id].name) ? LABELS[p.id].name : null;
      if (p.mesh) {
        p.mesh.userData.displayName = p.name || p.label;
        p.mesh.userData.label = p.mesh.userData.displayName;
      }
      if (p._nameEl) p._nameEl.textContent = partDisplayName(p);
      if (p._el) p._el.classList.toggle('labeled', !!p.name);
    });
    var cnt = document.getElementById('part-count');
    if (cnt && glbParts.length) {
      var labeled = glbParts.filter(function (p) { return !!p.name; }).length;
      cnt.textContent = glbParts.length + (labeled ? ' · 已命名 ' + labeled : '');
    }
  }

  function refreshOpenPartPanel() {
    if (state.selectedPart != null && glbParts[state.selectedPart]) {
      renderPartPanel(state.selectedPart, false);
    }
  }

  /* ---------- 右侧面板：只读视图 / 编辑器 ---------- */
  function renderPartPanel(i, editing) {
    var p = glbParts[i];
    if (!p) return;
    var L = LABELS[p.id] || {};
    var shapeText = {
      flat: '扁平（切面片／薄壁）', tube: '细长（可能是血管或管道）',
      block: '块状（表面片或实质块）', merged: '多片合并'
    }[p.shape] || '—';
    var bb = p.bbox;
    var html = '';
    html += '<span class="i-tag" style="background:' + (p.name ? '#c86a58' : '#8fa0b8') + '">部件 #' + i + '</span>';
    html += '<h2 class="i-title">' + esc(partDisplayName(p)) + '</h2>';
    if (L.latin) html += '<p class="i-sub">' + esc(L.latin) + '</p>';
    html += '<p class="i-en">' + p.tris.toLocaleString() + ' 三角形 · ' + shapeText + '</p>';

    if (!editing && p.name && ((L.bullets && L.bullets.length) || (L.clinical && L.clinical.length))) {
      if (L.bullets && L.bullets.length) {
        html += '<div class="i-sec"><h3>解剖学要点</h3><ul>' +
          L.bullets.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul></div>';
      }
      if (L.clinical && L.clinical.length) {
        html += '<div class="i-sec i-clinic"><h3>临床要点</h3><ul>' +
          L.clinical.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul></div>';
      }
      if (L.refs && L.refs.length) html += refBlock(L.refs);
      if (L.kbId) html += '<p class="hint">要点来自内置解剖知识库（' + esc(L.kbId) + '）</p>';
    }

    html += '<div class="i-sec"><h3>' + (editing || !p.name ? '编辑医学标签' : '标签') + '</h3>';
    if (editing || !p.name) {
      html += '<div class="lab-form">' +
        '<label>名称<input id="lab-name" type="text" placeholder="例如：门静脉" value="' + esc(L.name || '') + '"></label>' +
        '<p class="hint" id="lab-match"></p>' +
        '<label>拉丁文（可选）<input id="lab-latin" type="text" placeholder="vena portae" value="' + esc(L.latin || '') + '"></label>' +
        '<label>解剖学要点（每行一条）<textarea id="lab-bullets" rows="3" placeholder="由肠系膜上静脉与脾静脉汇合而成…">' +
        esc((L.bullets || []).join('\n')) + '</textarea></label>' +
        '<label>临床要点（每行一条）<textarea id="lab-clinical" rows="2" placeholder="门静脉高压时管径增宽…">' +
        esc((L.clinical || []).join('\n')) + '</textarea></label>' +
        '<div class="lab-actions"><button id="lab-save" class="lab-btn primary">保存</button>' +
        '<button id="lab-fill" class="lab-btn">从知识库填入</button>' +
        '<button id="lab-cancel" class="lab-btn">取消</button></div>' +
        '<p class="hint" id="lab-msg"></p>' +
        '</div>';
    } else {
      html += '<div class="lab-actions"><button id="lab-edit" class="lab-btn primary">编辑标签</button>' +
        '<button id="lab-clear" class="lab-btn">清除标签</button></div>';
    }
    html += '</div>';

    html += anatomyEditor(p,L);
    if(p.segmentReadout) html += '<p class="hint">'+esc(p.segmentReadout)+'</p>';
    html += '<div class="i-sec"><h3>几何信息</h3><ul>' +
      '<li>三角形：' + p.tris.toLocaleString() + '；顶点：' + p.verts.toLocaleString() + '</li>' +
      '<li>包围盒（模型坐标，未标定实际尺寸）：' + p.size.map(function (v) { return v.toFixed(4); }).join(' × ') + '</li>' +
      '<li>中心（模型单位）：' + [(bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2]
        .map(function (v) { return v.toFixed(4); }).join(', ') + '</li>' +
      '<li>稳定 ID：<code>' + esc(p.id) + '</code></li></ul>' +
      '<div class="lab-actions" style="margin-top:8px">' +
      '<button id="part-hide" class="lab-btn">' + (p.hidden ? '显示此部件' : '隐藏此部件') + '</button>' +
      '<button id="part-show-all" class="lab-btn">全部显示</button></div></div>';

    document.getElementById('info-body').innerHTML = html;
    document.getElementById('info').classList.remove('hidden');

    var anatomySave=document.getElementById('anatomy-save');
    if(anatomySave) anatomySave.addEventListener('click',function(){
      var rec=Object.assign({},LABELS[p.id]||{});
      rec.anatomySystem=document.getElementById('anatomy-system').value;
      rec.segment=document.getElementById('anatomy-segment').value;
      rec.updatedAt=Date.now();LABELS[p.id]=rec;
      p.segmentReadout=segmentNames[rec.segment] ? '人工标注：'+segmentNames[rec.segment] : '';
      updateAnatomy();saveLabels();buildPartList();applyPartMode();renderPartPanel(p.index,false);
    });
    var save = document.getElementById('lab-save');
    if (save) save.addEventListener('click', function () {
      var name = (document.getElementById('lab-name').value || '').trim();
      if (!name) {
        var m0 = document.getElementById('lab-msg');
        if (m0) m0.textContent = '名称不能为空。';
        return;
      }
      /* 名称能对上内置知识库、且要点为空时，自动填入 */
      fillFromKB(false);
      var bullets = (document.getElementById('lab-bullets').value || '')
        .split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      var clinical = (document.getElementById('lab-clinical').value || '')
        .split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      var kb = matchKB(name);
      var rec = {
        name: name,
        latin: (document.getElementById('lab-latin').value || '').trim(),
        bullets: bullets,
        clinical: clinical,
        partIndex: p.index,
        tris: p.tris,
        updatedAt: Date.now()
      };
      if (kb) {
        rec.kbId = kb.entry.id;
        rec.kbZh = kb.entry.zh;
        rec.refs = kb.entry.refs || [];
        var m1 = document.getElementById('lab-msg');
        if (m1) m1.textContent = '已保存，并关联知识库「' + kb.entry.zh + '」';
      }
      rec.anatomySystem=L.anatomySystem;rec.segment=L.segment;
      if(p.sourcePartIds){rec.sourcePartIds=p.sourcePartIds.slice();rec.mergeMethod=L.mergeMethod||'manual';}
      LABELS[p.id] = rec;
      applyLabels();
      saveLabels();
      buildPartList();          /* 左侧列表同步显示新名字 */
      renderPartPanel(p.index, false);
    });

    var cancel = document.getElementById('lab-cancel');
    if (cancel) cancel.addEventListener('click', function () { renderPartPanel(p.index, false); });
    var nameInput = document.getElementById('lab-name');
    if (nameInput) {
      nameInput.addEventListener('input', updateLabMatch);
      updateLabMatch();
    }
    var fillBtn = document.getElementById('lab-fill');
    if (fillBtn) fillBtn.addEventListener('click', function () { fillFromKB(true); updateLabMatch(); });
    var edit = document.getElementById('lab-edit');
    if (edit) edit.addEventListener('click', function () { renderPartPanel(p.index, true); });
    var clear = document.getElementById('lab-clear');
    if (clear) clear.addEventListener('click', function () {
      delete LABELS[p.id];
      applyLabels();
      saveLabels();
      renderPartPanel(p.index, true);
    });
    var hideBtn = document.getElementById('part-hide');
    if (hideBtn) hideBtn.addEventListener('click', function () {
      p.hidden = !p.hidden;
      applyPartMode();
      renderPartPanel(p.index, false);
    });
    var showAllBtn = document.getElementById('part-show-all');
    if (showAllBtn) showAllBtn.addEventListener('click', function () {
      glbParts.forEach(function (q) { q.hidden = false; });
      applyPartMode();
    });
  }

  function selectPart(i, event) {
    var p = glbParts[i];
    if (!p) return;
    if(multiSelect && event && (event.ctrlKey || event.shiftKey || event.metaKey)) {
      if(selectedParts.has(p))selectedParts.delete(p);else selectedParts.add(p);
    } else { selectedParts.clear();selectedParts.add(p); }
    state.selectedPart = selectedParts.has(p) ? i : null;
    updateMultiSelection();
    glbParts.forEach(function (q, k) {
      var on = selectedParts.has(q);
      var mm = q.mesh.material;
      /* 只用极暗的暖色自发光 + 略微更光滑来提示“被选中”，不画任何轮廓线 */
      mm.emissive.setHex(on ? EMISSIVE_SEL : 0x000000);
      mm.emissiveIntensity = on ? EMISSIVE_I : 0;
      mm.roughness = on ? Math.max(0.55, (q.baseRoughness || 0.75) * 0.85) : (q.baseRoughness || 0.75);
      mm.needsUpdate = true;
    });
    applyPartMode();
    document.querySelectorAll('.part-item').forEach(function (el) {
      el.classList.toggle('active', selectedParts.has(glbParts[Number(el.dataset.part)]));
    });
    renderPartPanel(i, !p.name);
  }

  function updateMultiSelection() {
    var box=document.getElementById('manual-merge-controls');
    if(box)box.style.display=multiSelect?'':'none';
    var count=document.getElementById('multi-count');
    if(count)count.textContent='已选 '+selectedParts.size+' 个部件';
    var button=document.getElementById('btn-force-merge');
    if(button){button.disabled=selectedParts.size<2;button.style.display=selectedParts.size>=2?'':'none';}
    glbParts.forEach(function(p){if(p._el)p._el.classList.toggle('active',selectedParts.has(p));});
  }

  function forceMergeSelected() {
    var members=glbParts.filter(function(p){return selectedParts.has(p);});
    if(members.length<2)return;
    var BGU=THREE.BufferGeometryUtils||{}, merge=BGU.mergeGeometries||BGU.mergeBufferGeometries;
    var parent=partGroup||glbGroup, geometries=[], merged=null;
    try {
      if(!merge)throw new Error('缺少几何合并工具');
      parent.updateWorldMatrix(true,false);
      var inverse=parent.matrixWorld.clone().invert();
      members.forEach(function(p){
        p.mesh.updateWorldMatrix(true,false);
        var g=p.mesh.geometry.clone();
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,p.mesh.matrixWorld));
        geometries.push(g);
      });
      merged=merge(geometries,false);
      if(!merged)throw new Error('几何属性不兼容，原部件已保留');
      var tris=geometries.reduce(function(n,g){return n+(g.index?g.index.count:g.attributes.position.count)/3;},0);
      if((merged.index?merged.index.count:merged.attributes.position.count)/3!==tris)throw new Error('三角形数量校验失败');
      Object.keys(merged.attributes).forEach(function(k){var arr=merged.attributes[k].array;for(var i=0;i<arr.length;i++)if(!Number.isFinite(arr[i]))throw new Error('属性含非有限值');});
      if(merged.index)for(var j=0;j<merged.index.count;j++)if(merged.index.getX(j)>=merged.attributes.position.count)throw new Error('顶点索引越界');
      merged.computeBoundingBox();merged.computeBoundingSphere();
      var first=members[0],mat=first.mesh.material.clone();
      mat.map=baseGLBMap;mat.color.setHex(0xffffff);mat.emissive.setHex(0);mat.emissiveIntensity=0;
      mat.transparent=false;mat.opacity=1;mat.depthWrite=true;mat.depthTest=true;mat.wireframe=false;mat.polygonOffset=false;
      var mesh=new THREE.Mesh(merged,mat);mesh.castShadow=true;mesh.receiveShadow=true;
      var bb=merged.boundingBox, size=bb.getSize(new THREE.Vector3()).toArray(),sorted=size.slice().sort(function(a,b){return a-b;});
      var ids=members.reduce(function(a,p){return a.concat(p.sourcePartIds||[p.id]);},[]).sort();
      var p={kind:'part',label:'手动合并部件',id:'manual:'+ids.join('|'),tris:tris,verts:merged.attributes.position.count,bbox:bb.clone(),size:size,merged:true,noTint:true,tint:null,color:first.color.clone(),shape:'merged',elong:sorted[2]/Math.max(sorted[1],1e-9),baseRoughness:first.baseRoughness||0.75,isDebris:false,sourcePartIds:ids,mesh:mesh};
      mesh.userData=p;mesh.name=p.label;
      // 原标签继续保留在原ID下；新对象不猜测、不继承可能冲突的医学归属。
      if(!LABELS[p.id])LABELS[p.id]={sourcePartIds:ids,mergeMethod:'manual',updatedAt:Date.now()};
      clearSelection();
      members.forEach(function(m){m.mesh.visible=false;});
      var insert=glbParts.indexOf(members[0]);
      glbParts=glbParts.filter(function(q){return members.indexOf(q)<0;});glbParts.splice(insert,0,p);
      parent.add(mesh);
      glbParts.forEach(function(q,i){q.index=i;q.mesh.userData.index=i;});
      pickables=pickables.filter(function(o){return !(o.userData&&o.userData.kind==='part');});
      glbParts.forEach(function(q){pickables.push(q.mesh);});
      state.seamless=false;document.getElementById('chk-seamless').checked=false;
      window.__liverParts=glbParts;
      buildPartList();applyPartMode();saveLabels();selectPart(p.index);
      setLabelStatus('已按你的选择合并 '+members.length+' 个部件。请在右侧命名并指定解剖系统；原标签保留，尚未进行医学确认。');
    } catch(e) {
      if(merged)merged.dispose();
      setLabelStatus('强制合并失败：'+e.message);
    } finally { geometries.forEach(function(g){g.dispose();}); }
  }

  /* 取消选中：恢复纯净外观 */
  function clearSelection() {
    selectedParts.clear();updateMultiSelection();
    if (glbParts.length) {
      glbParts.forEach(function (q) {
        var mm = q.mesh.material;
        mm.emissive.setHex(0x000000);
        mm.emissiveIntensity = 0;
        mm.roughness = q.baseRoughness || 0.75;
        mm.needsUpdate = true;
      });
      state.selectedPart = null;
      applyPartMode();
    }
    document.querySelectorAll('.part-item').forEach(function (el) { el.classList.remove('active'); });
    var info = document.getElementById('info');
    if (info) info.classList.add('hidden');
    state.selected = null;
    applyHighlight();
  }

  /* 切换模型来源：'glb' 外部模型 / 'builtin' 内置解剖模型 */
  function setSource(src, noFit) {
    state.source = src;
    var isGLB = (src === 'glb') && !!glbModel;
    glbGroup.visible = isGLB;
    liverGroup.visible = !isGLB;
    vesselGroup.visible = !isGLB;
    ligGroup.visible = !isGLB;
    capGroup.visible = !isGLB;
    if (sectionMesh) sectionMesh.visible = !isGLB;

    document.querySelectorAll('#source-buttons button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.source === src);
    });
    /* 只有内置模型才适用的控件 */
    var builtinOnly = ['#cut', '#chk-segments', '#chk-explode', '#chk-translucent', '#chk-labels'];
    builtinOnly.forEach(function (sel) {
      var el = document.querySelector(sel);
      if (el) { el.disabled = isGLB; if (isGLB && el.checked) el.checked = false; }
    });
    document.querySelectorAll('#layers input').forEach(function (el) { el.disabled = isGLB; });
    document.querySelectorAll('#seg-list .seg-item').forEach(function (el) {
      el.style.opacity = isGLB ? '0.35' : '';
      el.style.pointerEvents = isGLB ? 'none' : '';
    });
    /* GLB 部件面板只在外部模型下显示 */
    var gp = document.getElementById('glb-panel');
    if (gp) gp.style.display = (isGLB && glbParts.length) ? '' : 'none';

    /* 状态栏跟着当前模型走 */
    var st = document.getElementById('status');
    if (st) {
      if (isGLB && glbInfo) {
        st.innerHTML = '外部模型 · sm_liver_cross_section.glb · 网格 <b>' + glbInfo.stats.meshes +
          '</b> 个 · 顶点 <b>' + glbInfo.stats.verts.toLocaleString() + '</b> · 三角 <b>' +
          glbInfo.stats.tris.toLocaleString() + '</b> · 节点树已打印到 Console（F12）';
      } else if (builtinBox) {
        st.innerHTML = '内置解剖模型 · <b>' + (baseGeometry ? baseGeometry.attributes.position.count.toLocaleString() : '?') +
          '</b> 顶点 · <b>' + D.STRUCTURES.length + '</b> 条管道 · 点击结构查看解剖要点';
      }
    }

    if (!noFit) {
      if (isGLB && glbInfo) fitCameraToBox(glbInfo.box, new THREE.Vector3(0.45, 0.3, 0.85), 1.35);
      else if (builtinBox) fitCameraToBox(builtinBox, new THREE.Vector3(0.45, 0.3, 0.85), 1.2);
    }
  }

  /* ------------------------------------------------------------------ *
   * labels
   * ------------------------------------------------------------------ */
  var LABEL_DEFS = [
    { t: '肝右静脉', p: [5.9, 2.4, -1.0], g: 'hepatic-vein' },
    { t: '肝中静脉', p: [0.9, 0.6, 0.8], g: 'hepatic-vein' },
    { t: '肝左静脉', p: [-2.7, 2.1, 0.2], g: 'hepatic-vein' },
    { t: '下腔静脉', p: [2.6, -1.6, -4.4], g: 'vein' },
    { t: '门静脉主干', p: [1.4, -6.2, -1.6], g: 'portal' },
    { t: '门静脉右支', p: [3.2, -2.8, -2.4], g: 'portal' },
    { t: '门静脉左支', p: [-0.9, -2.7, -1.9], g: 'portal' },
    { t: '肝固有动脉', p: [1.1, -5.6, -3.0], g: 'artery' },
    { t: '肝总管', p: [1.7, -4.6, -2.0], g: 'bile' },
    { t: '胆总管', p: [1.3, -8.6, -2.2], g: 'bile' },
    { t: '胆囊', p: [0.55, -4.0, 1.3], g: 'gallbladder' },
    { t: '胆囊管', p: [1.15, -4.9, -0.4], g: 'bile' },
    { t: '肝圆韧带', p: [-3.05, -2.6, 1.6], g: 'ligament' },
    { t: '静脉韧带', p: [-0.9, 1.2, -3.8], g: 'ligament' },
    { t: '镰状韧带', p: [-3.3, 2.9, 4.2], g: 'ligament' },
    { t: '肝门', p: [1.3, -3.2, -2.2], g: 'parenchyma' }
  ];

  function buildLabels() {
    var host = document.getElementById('labels');
    LABEL_DEFS.forEach(function (d) {
      var el = document.createElement('div');
      el.className = 'lbl';
      el.style.display = 'none';
      el.innerHTML = '<b>' + d.t + '</b>';
      host.appendChild(el);
      labels.push({ el: el, pos: new THREE.Vector3(d.p[0], d.p[1], d.p[2]), group: d.g });
    });
  }

  /* ------------------------------------------------------------------ *
   * appearance / clipping / section
   * ------------------------------------------------------------------ */
  function cutZ() { return 6.6 - state.cut * 8.4; }

  function refreshAppearance() {
    var clipping = [];
    if (state.cutOn) { clipPlane.constant = cutZ(); clipping = [clipPlane]; }

    segMeshes.forEach(function (m) {
      var def = m.userData.data;
      var mat = m.material;
      mat.clippingPlanes = clipping;
      mat.needsUpdate = true;
      if (state.segmentColors) {
        mat.vertexColors = false;
        mat.color.set(def.color);
        mat.needsUpdate = true;
      } else {
        mat.vertexColors = true;
        mat.color.set(0xffffff);
        mat.needsUpdate = true;
      }
      mat.transparent = state.translucent;
      mat.opacity = state.translucent ? 0.38 : 1;
      mat.depthWrite = !state.translucent;
      /* explode offset */
      var dir = segCentroids[def.id] ? segCentroids[def.id].clone().sub(new THREE.Vector3(0, 0.5, 0)).normalize() : new THREE.Vector3();
      m.position.copy(dir.multiplyScalar(state.explode * 7.0));
    });

    vesselGroup.traverse(function (o) {
      if (o.isMesh) {
        o.material.clippingPlanes = state.cutOn ? [clipPlane] : [];
        o.material.needsUpdate = true;
        o.material.transparent = state.translucent;
        o.material.opacity = state.translucent ? 0.55 : 1;
        o.material.depthWrite = !state.translucent;
      }
    });
    ligGroup.traverse(function (o) { if (o.isMesh) { o.material.clippingPlanes = state.cutOn ? [clipPlane] : []; } });

    ligGroup.visible = state.groups.ligament;
    vesselGroup.children.forEach(function (m) { m.visible = !!state.groups[m.userData.group]; });

    updateSection();
    updateVesselCaps();
    applyHighlight();
  }

  var sectionTimer = null;
  function updateSection() {
    if (sectionMesh) {
      scene.remove(sectionMesh);
      pickables = pickables.filter(function (o) { return o !== sectionMesh; });
      sectionMesh.geometry.dispose(); sectionMesh.material.dispose(); sectionMesh = null;
    }
    if (!state.cutOn || state.explode > 0.01 || state.translucent) return;
    if (sectionTimer) clearTimeout(sectionTimer);
    sectionTimer = setTimeout(function () {
      if (!state.cutOn) return;
      var z0 = cutZ();
      var sec = G.buildSection([0, 0, z0], [0, 0, -1], { step: 0.30 });
      var n = sec.segments.length;
      var pos = new Float32Array(n * 6 * 3);
      var col = new Float32Array(n * 6 * 3);
      var S = sec.indices;
      var palette = {};
      D.SEGMENTS.forEach(function (s) { palette[s.id] = new THREE.Color(s.color); });
      for (var q = 0; q < n; q++) {
        var c = palette[sec.segments[q]] || new THREE.Color('#c86a58');
        var vids = [S[q * 6], S[q * 6 + 1], S[q * 6 + 2], S[q * 6], S[q * 6 + 2], S[q * 6 + 5]];
        for (var k = 0; k < 6; k++) {
          var vi = vids[k];
          pos[(q * 6 + k) * 3] = sec.positions[vi * 3];
          pos[(q * 6 + k) * 3 + 1] = sec.positions[vi * 3 + 1];
          pos[(q * 6 + k) * 3 + 2] = sec.positions[vi * 3 + 2] - 0.01;
          col[(q * 6 + k) * 3] = c.r; col[(q * 6 + k) * 3 + 1] = c.g; col[(q * 6 + k) * 3 + 2] = c.b;
        }
      }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.computeVertexNormals();
      var mat = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide
      });
      sectionMesh = new THREE.Mesh(geo, mat);
      sectionMesh.renderOrder = 1;
      sectionMesh.userData = { kind: 'section' };
      scene.add(sectionMesh);
      pickables.push(sectionMesh);
    }, 60);
  }

  /* little discs so cut vessels read as open tubes with a wall */
  function updateVesselCaps() {
    while (capGroup.children.length) {
      var c = capGroup.children.pop();
      c.geometry.dispose(); c.material.dispose();
    }
    if (!state.cutOn) return;
    var z0 = cutZ();
    var up = new THREE.Vector3(0, 0, 1);
    D.STRUCTURES.forEach(function (def) {
      if (!state.groups[def.group]) return;
      var pts = def.points, rad = def.radius;
      for (var i = 0; i < pts.length - 1; i++) {
        var a = pts[i], b = pts[i + 1];
        var da = a[2] - z0, db = b[2] - z0;
        if (da * db > 0 || da === db) continue;
        var t = da / (da - db);
        var px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t;
        var r = (typeof rad === 'number') ? rad : (rad[i] + (rad[i + 1] - rad[i]) * t);
        if (r <= 0.02) continue;
        var geo = new THREE.CircleGeometry(r * 1.02, 16);
        var mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(def.color).multiplyScalar(0.55), side: THREE.DoubleSide });
        var disc = new THREE.Mesh(geo, mat);
        disc.position.set(px, py, z0 + 0.03);
        var dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
        var q = new THREE.Quaternion().setFromUnitVectors(up, dir);
        disc.quaternion.copy(q);
        capGroup.add(disc);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * highlight & selection
   * ------------------------------------------------------------------ */
  function applyHighlight() {
    segMeshes.forEach(function (m) {
      var sel = state.selected && state.selected.kind === 'segment' && state.selected.segId === m.userData.segId;
      m.material.emissive = new THREE.Color(sel ? 0x552018 : 0x000000);
      m.material.emissiveIntensity = sel ? 1.0 : 0;
    });
    vesselGroup.traverse(function (o) {
      if (!o.isMesh) return;
      var d = o.userData.data;
      var sel = state.selected && state.selected.kind === 'structure' && d && state.selected.id === d.id;
      o.material.emissive = new THREE.Color(sel ? 0x442a12 : 0x000000);
      o.material.emissiveIntensity = sel ? 0.9 : 0;
    });
    ligGroup.traverse(function (o) {
      if (!o.isMesh) return;
      var d = o.userData.data;
      var sel = state.selected && state.selected.kind === 'structure' && d && state.selected.id === d.id;
      o.material.emissive = new THREE.Color(sel ? 0x442a12 : 0x000000);
    });
  }

  /* ------------------------------------------------------------------ *
   * info panel
   * ------------------------------------------------------------------ */
  var REF_ORDER = Object.keys(D.REFS);

  function refBlock(keys) {
    if (!keys || !keys.length) return '';
    var nums = keys.map(function (k) { return REF_ORDER.indexOf(k) + 1; }).filter(function (n) { return n > 0; });
    var rows = keys.map(function (k) {
      var n = REF_ORDER.indexOf(k) + 1;
      return '<span>[' + n + '] ' + (D.REFS[k] || '') + '</span>';
    }).join('');
    return '<div class="i-sec"><h3>依据文献</h3><div class="i-refs">' + rows + '</div></div>';
  }

  function panelHTML(o) {
    var tag = GROUP_LABEL[o.group] || '结构';
    var tagColor = GROUP_COLOR[o.group] || '#8fa0b8';
    var html = '';
    html += '<span class="i-tag" style="background:' + tagColor + '">' + tag + '</span>';
    html += '<h2 class="i-title">' + o.zh + '</h2>';
    if (o.latin) html += '<p class="i-sub">' + o.latin + '</p>';
    if (o.en) html += '<p class="i-en">' + o.en + '</p>';
    if (o.note) html += '<p class="hint">' + o.note + '</p>';
    if (o.bullets && o.bullets.length) {
      html += '<div class="i-sec"><h3>解剖要点</h3><ul>' +
        o.bullets.map(function (b) { return '<li>' + b + '</li>'; }).join('') + '</ul></div>';
    }
    if (o.clinical && o.clinical.length) {
      html += '<div class="i-sec i-clinic"><h3>临床要点</h3><ul>' +
        o.clinical.map(function (b) { return '<li>' + b + '</li>'; }).join('') + '</ul></div>';
    }
    html += refBlock(o.refs);
    return html;
  }

  function showInfo(obj) {
    var panel = document.getElementById('info');
    document.getElementById('info-body').innerHTML = panelHTML(obj);
    panel.classList.remove('hidden');
  }

  function selectSegment(id, silent) {
    var def = null;
    D.SEGMENTS.forEach(function (s) { if (s.id === id) def = s; });
    if (!def) return;
    state.selected = { kind: 'segment', segId: id };
    applyHighlight();
    if (!silent) {
      showInfo({
        group: 'parenchyma', zh: def.zh, latin: def.latin, en: def.en,
        bullets: def.bullets, clinical: def.clinical, refs: def.refs
      });
    }
    document.querySelectorAll('.seg-item').forEach(function (el) {
      el.classList.toggle('active', Number(el.dataset.seg) === id);
    });
  }

  /* ------------------------------------------------------------------ *
   * picking
   * ------------------------------------------------------------------ */
  function bindPointer() {
    var el = renderer.domElement;
    var down = null;

    /* 旋转 / 缩放 / 平移全部交给 OrbitControls，这里只负责“点选”。
       用位移阈值区分“拖动”和“单击”。 */
    el.addEventListener('pointerdown', function (e) {
      down = { x: e.clientX, y: e.clientY };
    });

    el.addEventListener('pointermove', function (e) {
      if (!down) hover(e);
    });

    el.addEventListener('pointerup', function (e) {
      if (!down) return;
      var moved = Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y);
      down = null;
      if (moved < 5) pick(e);
    });

    el.addEventListener('pointerleave', function () { down = null; });

    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  function toNDC(e) {
    pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
    return pointerNDC;
  }

  function visibleChain(o) {
    var p = o;
    while (p) { if (p.visible === false) return false; p = p.parent; }
    return true;
  }

  function hitsAt(e) {
    raycaster.setFromCamera(toNDC(e), camera);
    var objs = pickables.filter(visibleChain);
    return raycaster.intersectObjects(objs, false);
  }

  function nearestSurfaceFeature(pt) {
    var best = null, bd = 1e9;
    D.SURFACE_FEATURES.forEach(function (f) {
      var d = Math.hypot(pt.x - f.point[0], pt.y - f.point[1], pt.z - f.point[2]) / (f.radius || 2);
      if (d < bd) { bd = d; best = f; }
    });
    return { f: best, rel: bd };
  }

  var hoverTimer = null;
  function hover(e) {
    var hits = hitsAt(e), tip = document.getElementById('tooltip');
    if (!hits.length) { tip.classList.add('hidden'); renderer.domElement.style.cursor = 'default'; return; }
    var h = hits[0], name = '';
    if (h.object.userData.kind === 'structure') name = h.object.userData.data.zh;
    else if (h.object.userData.kind === 'glb') name = h.object.userData.name || '网格';
    else if (h.object.userData.kind === 'part') name = h.object.userData.label + ' · ' + h.object.userData.tris + ' △';
    else if (h.object.userData.kind === 'segment') {
      var seg = h.object.userData.data;
      name = seg.zh + (h.point ? ' · ' + featureNameAt(h.point) : '');
    } else if (h.object.userData.kind === 'section') name = '肝剖面（Couinaud 分段）';
    if (!name) { tip.classList.add('hidden'); return; }
    tip.textContent = name;
    tip.style.left = e.clientX + 'px';
    tip.style.top = e.clientY + 'px';
    tip.classList.remove('hidden');
    renderer.domElement.style.cursor = 'pointer';
  }

  function featureNameAt(pt) {
    var r = nearestSurfaceFeature(pt);
    return (r.f && r.rel < 0.95) ? r.f.zh : '';
  }

  function pick(e) {
    var hits = hitsAt(e);
    if (!hits.length) { clearSelection(); return; }   /* 点空白处 → 取消选中 */
    var h = hits[0], ud = h.object.userData;
    if (ud.kind === 'part') {
      var part=glbParts[ud.index], record=LABELS[part.id]||{};
      part.segmentReadout=segmentNames[record.segment] ? '人工标注：'+segmentNames[record.segment] : (segmentUI ? segmentUI.pick(part,h.point) : '');
      selectPart(ud.index,e); return;
    }
    if (ud.kind === 'seamless') {
      showInfo({
        group: 'parenchyma', zh: '无缝整体模型', latin: 'corpus hepatis (seamless)', en: 'merged whole',
        bullets: [
          '当前处于「平滑无缝模式」：37 个部件已在底层合并为 1 个整体网格（' +
            Math.round(ud.tris).toLocaleString() + ' 个三角形）。',
          '此模式统一显示材质；不焊接顶点、不补洞，也不改变原模型的解剖完整性。',
          '想点击单个部件：在左侧关闭「平滑无缝模式」即可恢复 37 个独立部件。'
        ],
        clinical: []
      });
      return;
    }
    if (ud.kind === 'glb') {
      /* 外部 GLB：显示这个网格的信息 + 命中点的世界坐标（方便做区域判定） */
      var p = h.point;
      showInfo({
        group: 'parenchyma', zh: ud.name || '未命名网格',
        latin: 'glTF mesh', en: 'external model mesh',
        bullets: [
          '顶点数：' + ud.verts.toLocaleString() + '；三角形：' + ud.tris.toLocaleString(),
          '材质：' + (ud.material || '—'),
          '命中点世界坐标：(' + p.x.toFixed(2) + ', ' + p.y.toFixed(2) + ', ' + p.z.toFixed(2) + ')',
          '该模型为单一网格，血管与肝实质未分件；可按命中点坐标做区域判定，或改用分件模型。'
        ],
        clinical: ['后续要分部位点击：可用命中点的局部坐标做空间分区，或把网格按材质/UV/几何连通分量拆分。'],
        refs: []
      });
      return;
    }
    if (ud.kind === 'structure') {
      var def = ud.data;
      state.selected = { kind: 'structure', id: def.id };
      applyHighlight();
      showInfo({
        group: ud.group, zh: def.zh, latin: def.latin, en: def.en,
        bullets: def.bullets, clinical: def.clinical, refs: def.refs
      });
      document.querySelectorAll('.seg-item').forEach(function (el) { el.classList.remove('active'); });
    } else if (ud.kind === 'segment') {
      var seg = ud.data;
      var nf = nearestSurfaceFeature(h.point);
      state.selected = { kind: 'segment', segId: seg.id };
      applyHighlight();
      document.querySelectorAll('.seg-item').forEach(function (el) {
        el.classList.toggle('active', Number(el.dataset.seg) === seg.id);
      });
      if (nf.f && nf.rel < 0.85) {
        /* a named surface feature was hit: show it, with its segment as context */
        showInfo({
          group: 'parenchyma', zh: nf.f.zh, latin: nf.f.latin, en: nf.f.en,
          bullets: nf.f.bullets,
          note: '该处属于 <b>' + seg.zh + '</b>（' + seg.latin + '）',
          refs: nf.f.refs || ['grays43', 'ta2', 'kostov2023']
        });
      } else {
        showInfo({
          group: 'parenchyma', zh: seg.zh, latin: seg.latin, en: seg.en,
          bullets: seg.bullets, clinical: seg.clinical, refs: seg.refs
        });
      }
    } else if (ud.kind === 'section') {
      showInfo({
        group: 'section', zh: '肝剖面（Couinaud 分段）',
        en: 'section through the liver with Couinaud segments',
        bullets: [
          '剖面颜色表示该处所属的 Couinaud 肝段。段间界面由三条肝静脉（右、中、左）与门静脉横裂平面界定。',
          '肝中静脉平面（Cantlie 线）分左右半肝；肝右静脉平面分右前叶与右后叶；肝左静脉平面分左内叶与左外叶。',
          '沿门静脉横裂平面（约相当于肝门水平）再分出上、下段，共 8 段（尾状叶为Ⅰ段）。'
        ],
        clinical: ['段间界面内几乎无粗大血管穿行，是解剖性肝切除的分离平面。'],
        refs: ['couinaud1957', 'strasberg2005', 'brisbane2013']
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * UI
   * ------------------------------------------------------------------ */
  function bindUI() {
    /* ---- 模型来源切换 ---- */
    document.querySelectorAll('#source-buttons button').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.source === 'glb' && !glbModel) {
          var hint = document.getElementById('glb-hint');
          if (hint) hint.innerHTML = '外部模型还没加载成功（见上方提示）。';
          return;
        }
        setSource(b.dataset.source);
      });
    });

    /* ---- 视图预设：按当前模型包围盒的方向摆放相机 ---- */
    document.querySelectorAll('#view-buttons button').forEach(function (b) {
      b.addEventListener('click', function () {
        var dirs = {
          anterior: [0, 0, 1], posterior: [0, 0, -1], inferior: [0, -1, 0.001],
          superior: [0, 1, 0.001], right: [1, 0, 0.05], left: [-1, 0, 0.05]
        }[b.dataset.view];
        if (!dirs) return;
        var box = (state.source === 'glb' && glbInfo) ? glbInfo.box : builtinBox;
        if (!box) box = new THREE.Box3(new THREE.Vector3(-12, -4, -5), new THREE.Vector3(12, 8, 5));
        fitCameraToBox(box, new THREE.Vector3(dirs[0], dirs[1], dirs[2]), 1.3);
        document.querySelectorAll('#view-buttons button').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
      });
    });

    document.getElementById('chk-rotate').addEventListener('change', function (e) { state.rotate = e.target.checked; });
    document.getElementById('chk-translucent').addEventListener('change', function (e) {
      state.translucent = e.target.checked; refreshAppearance();
    });
    document.getElementById('chk-segments').addEventListener('change', function (e) {
      state.segmentColors = e.target.checked; refreshAppearance();
    });
    document.getElementById('chk-explode').addEventListener('change', function (e) {
      state.explode = e.target.checked ? 1 : 0; refreshAppearance();
    });
    document.getElementById('chk-labels').addEventListener('change', function (e) {
      state.labels = e.target.checked;
      labels.forEach(function (l) { l.el.style.display = state.labels ? '' : 'none'; });
    });

    /* ---- GLB 部件显示模式 ---- */
    var pc = document.getElementById('chk-partcolor');
    if (pc) pc.addEventListener('change', function (e) { state.partColor = e.target.checked; applyPartMode(); });
    var pw = document.getElementById('chk-parts-wire');
    if (pw) pw.addEventListener('change', function (e) { state.partWire = e.target.checked; applyPartMode(); });
    var iso = document.getElementById('chk-isolate');
    if (iso) iso.addEventListener('change', function (e) { state.isolate = e.target.checked; applyPartMode(); });
    var ed = document.getElementById('chk-edges');
    if (ed) ed.addEventListener('change', function (e) { state.partEdges = e.target.checked; applyPartMode(); });
    var db = document.getElementById('chk-debris');
    if (db) db.addEventListener('change', function (e) { state.showDebris = e.target.checked; applyPartMode(); });
    var sl = document.getElementById('chk-seamless');
    if (sl) sl.addEventListener('change', function (e) {
      state.seamless = e.target.checked;
      if(state.seamless){anatomyColor=false;document.getElementById('chk-anatomy').checked=false;}
      if (state.seamless && !seamlessMesh) buildSeamlessMesh();
      if (state.seamless) clearSelection();
      applyPartMode();
      setLabelStatus(state.seamless
        ? '平滑无缝模式：37 个部件已合并为整体，关闭该开关即可重新点击单个部件'
        : '零件模式：可点击 37 个独立部件打标签');
    });

    var multi=document.getElementById('chk-multiselect');
    if(multi)multi.addEventListener('change',function(){
      multiSelect=multi.checked;clearSelection();
      if(multiSelect){state.seamless=false;state.isolate=false;document.getElementById('chk-seamless').checked=false;document.getElementById('chk-isolate').checked=false;applyPartMode();}
    });
    var force=document.getElementById('btn-force-merge');
    if(force)force.addEventListener('click',forceMergeSelected);
    /* ---- 智能合并血管 ---- */
    var mb = document.getElementById('btn-merge');
    if (mb) mb.addEventListener('click', function () {
      var r = autoMergeVessels();
      setLabelStatus(r ? ('几何候选整理后 ' + r.length + ' 个部件；缺少证据或已有人工标注的部件保留，结果不代表解剖确认')
        : '合并不可用：缺少 BufferGeometryUtils 或已处于合并状态');
    });
    var rbtn = document.getElementById('btn-restore');
    if (rbtn) rbtn.addEventListener('click', function () {
      restoreVesselParts();
      setLabelStatus('已还原为 37 个独立部件');
    });

    /* ---- 标签 JSON 导入 / 导出 ---- */
    var exBtn = document.getElementById('btn-export-labels');
    if (exBtn) exBtn.addEventListener('click', exportLabels);
    var imBtn = document.getElementById('btn-import-labels');
    if (imBtn) imBtn.addEventListener('click', function () {
      var f = document.getElementById('labels-file');
      if (f && f.click) f.click();
    });
    var fileInput = document.getElementById('labels-file');
    if (fileInput) fileInput.addEventListener('change', function (e) {
      if (e.target && e.target.files && e.target.files[0]) importLabelsFromFile(e.target.files[0]);
    });

    var cut = document.getElementById('cut');
    cut.addEventListener('input', function () {
      state.cut = Number(cut.value) / 100;
      state.cutOn = state.cut > 0.001;
      refreshAppearance();
      document.getElementById('cut-hint').textContent = state.cutOn
        ? ('剖切平面深度：距肝前缘 ' + (state.cut * 8.4).toFixed(1) + ' cm（剖面显示分段归属）')
        : '左端 = 完整肝脏；向右拖动可从前方剖开肝实质，剖面按 Couinaud 分段显示。';
    });

    document.querySelectorAll('#layers input[data-group]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        state.groups[cb.dataset.group] = cb.checked;
        refreshAppearance();
      });
    });

    /* segment list */
    var segHost = document.getElementById('seg-list');
    D.SEGMENTS.forEach(function (s) {
      var el = document.createElement('div');
      el.className = 'seg-item';
      el.dataset.seg = s.id;
      el.innerHTML = '<span class="seg-swatch" style="background:' + s.color + '"></span>' + s.short + ' 段';
      el.addEventListener('click', function () { selectSegment(s.id); });
      segHost.appendChild(el);
    });

    document.getElementById('info-close').addEventListener('click', function () {
      clearSelection();
      document.querySelectorAll('.seg-item').forEach(function (el) { el.classList.remove('active'); });
    });

    document.getElementById('btn-refs').addEventListener('click', function () {
      var html = '<h2>参考文献</h2><p class="hint">本模型的解剖学表述依据下列文献与术语标准；点击结构时面板中标注的编号与此对应。</p><ol>';
      REF_ORDER.forEach(function (k) { html += '<li>' + D.REFS[k] + '</li>'; });
      html += '</ol><h3>说明</h3><ul>' +
        '<li>肝段划分依据 Couinaud 命名体系（8 段）与 Brisbane 2000 命名。</li>' +
        '<li>肝内血管分支的显示为教学示意，走行与分支层级依据上述文献，但个体变异（尤其肝动脉与门静脉分支）常见，不能替代影像学。</li>' +
        '<li>比例：肝脏横径约 24 cm、上下径约 13 cm、前后径约 10 cm，接近成人平均值。</li></ul>';
      showModal(html);
    });

    document.getElementById('btn-help').addEventListener('click', function () {
      showModal('<h2>操作说明</h2><ul>' +
        '<li><b>旋转</b>：左键拖动（OrbitControls）；<b>缩放</b>：滚轮或双指捏合；<b>平移</b>：右键拖动。</li>' +
        '<li><b>模型来源</b>：左上角可在「外部模型 · GLB」（models/sm_liver_cross_section.glb）与「内置解剖模型」之间切换；' +
        '加载外部模型时会自动按包围盒缩放居中并取景。</li>' +
        '<li><b>看节点树</b>：按 F12 打开控制台，外部模型加载完成后会打印整棵节点树、网格清单与材质统计（也挂到了 window.__liver）。</li>' +
        '<li><b>剖开肝脏</b>（仅内置模型）：拖动"剖切深度"滑块，肝实质自前向后被剖开，剖面按 Couinaud 分段着色。</li>' +
        '<li><b>分段展开</b>（仅内置模型）：勾选后 8 个肝段沿各自方向分离，便于看清段间界面。</li>' +
        '<li><b>查看解剖要点</b>（仅内置模型）：单击肝段、血管、胆管、胆囊或韧带，右侧面板显示名称、解剖要点、临床要点与依据文献。</li></ul>');
    });

    document.getElementById('modal-close').addEventListener('click', hideModal);
    document.getElementById('modal').addEventListener('click', function (e) {
      if (e.target.id === 'modal') hideModal();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideModal(); });
  }

  function showModal(html) {
    document.getElementById('modal-body').innerHTML = html;
    document.getElementById('modal').classList.remove('hidden');
  }
  function hideModal() { document.getElementById('modal').classList.add('hidden'); }

  /* ------------------------------------------------------------------ *
   * loop
   * ------------------------------------------------------------------ */
  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /* ------------------------------------------------------------------ *
   * camera: OrbitControls + 预设视角补间
   * ------------------------------------------------------------------ */
  var camTween = null;

  function flyTo(targetPoint, endPos, dur) {
    camTween = {
      t: 0, dur: dur || 0.65,
      p0: camera.position.clone(), p1: endPos.clone(),
      t0: controls.target.clone(), t1: targetPoint.clone()
    };
  }

  /* 把视角放到包围盒的某个方向，距离按 fov 与画布比例算出，保证完整可见 */
  function fitCameraToBox(box, dirVec, padding) {
    var size = box.getSize(new THREE.Vector3());
    var center = box.getCenter(new THREE.Vector3());
    var vFov = camera.fov * Math.PI / 180;
    var distV = (size.y / 2) / Math.tan(vFov / 2);
    var hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(0.2, camera.aspect));
    var distH = (size.x / 2) / Math.tan(hFov / 2);
    var dist = Math.max(distV, distH, size.z * 0.5) * (padding || 1.45);
    if (!isFinite(dist) || dist <= 0) dist = 60;
    var dir = (dirVec || new THREE.Vector3(0.55, 0.35, 0.75)).clone().normalize();
    var pos = center.clone().addScaledVector(dir, dist);
    flyTo(center, pos, 0.01);
    return { center: center, dist: dist };
  }

  function updateCamera(dt) {
    if (!isFinite(dt)) dt = 0.016;
    if (camTween) {
      camTween.t += dt / camTween.dur;
      var k = Math.min(1, camTween.t);
      var e = k < 0.5 ? 2 * k * k : -1 + (4 - 2 * k) * k;   /* easeInOutQuad */
      camera.position.lerpVectors(camTween.p0, camTween.p1, e);
      controls.target.lerpVectors(camTween.t0, camTween.t1, e);
      if (k >= 1) camTween = null;
    }
    /* 兜底：相机任何一环出现非有限值就复位，避免“全黑但仍有绘制” */
    if (!isFinite(camera.position.x) || !isFinite(camera.position.y) || !isFinite(camera.position.z) ||
        !isFinite(controls.target.x) || !isFinite(controls.target.y) || !isFinite(controls.target.z)) {
      controls.target.set(0, 1.2, 0);
      camera.position.set(26, 14, 36);
    }
    controls.autoRotate = !!state.rotate;
    controls.autoRotateSpeed = 1.1;
    controls.update();
  }

  var last = 0;
  var frameNo = 0, selfChecked = false, maxCalls = 0;

  function animate() {
    requestAnimationFrame(animate);
    var now = performance.now();
    /* 注意：animate() 可能在模块顶层赋值之前就被 init() 调用，
       所以 last 必须是 0 而不是 undefined，并且 dt 要兜底。 */
    var dt = last ? (now - last) / 1000 : 0.016;
    if (!isFinite(dt) || dt < 0) dt = 0.016;
    dt = Math.min(0.05, dt);
    last = now;
    updateCamera(dt);
    updateLabelPositions();
    renderer.render(scene, camera);
    frameNo++;
    if (renderer && renderer.info) maxCalls = Math.max(maxCalls, renderer.info.render.calls);
    if (frameNo === 40 && !selfChecked) { selfChecked = true; selfCheck(); }
  }

  /* ------------------------------------------------------------------ *
   * 出图自检：把 GPU / 上下文 / 绘制调用数写进状态栏，并在没有任何绘制
   * 调用时给出明确提示（这是“界面正常但画面全黑”的典型情形）。
   * ------------------------------------------------------------------ */
  function selfCheck() {
    var gl = null, lost = false, gpu = 'unknown', vendor = '';
    try {
      gl = renderer.getContext();
      lost = !!(gl && gl.isContextLost && gl.isContextLost());
      var dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) {
        gpu = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
        vendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
      } else if (gl) {
        gpu = gl.getParameter(gl.RENDERER);
        vendor = gl.getParameter(gl.VENDOR);
      }
    } catch (e) { gpu = 'n/a (' + (e && e.message) + ')'; }

    var info = renderer.info.render;
    var calls = info.calls, tris = info.triangles;

    /* 主体中心投影到屏幕，用来判断“到底画到哪去了” */
    var ndc = 'n/a';
    try {
      var c = new THREE.Vector3();
      if (segMeshes.length) {
        var bs = segMeshes[0].geometry.boundingSphere;
        var box = new THREE.Box3().setFromBufferAttribute(segMeshes[0].geometry.attributes.position);
        box.getCenter(c);
      }
      c.project(camera);
      ndc = '(' + c.x.toFixed(2) + ', ' + c.y.toFixed(2) + ')';
    } catch (e) { ndc = 'err'; }

    var st = document.getElementById('status');
    var camStr = 'NaN';
    var camOk = false;
    try {
      camStr = camera.position.toArray().map(function (v) { return v.toFixed(1); }).join(', ');
      camOk = isFinite(camera.position.x) && isFinite(camera.position.y) && isFinite(camera.position.z);
    } catch (e) {}
    if (st && !(state.source === 'glb' && glbInfo)) {
      st.innerHTML = '渲染就绪 · <b>' + (baseGeometry ? baseGeometry.attributes.position.count.toLocaleString() : '?') +
        '</b> 顶点 · <b>' + D.STRUCTURES.length + '</b> 条管道 · 每帧 <b>' + calls + '</b> 次绘制 / <b>' +
        tris.toLocaleString() + '</b> 三角形 · 相机 (' + camStr + ') · 主体 NDC ' + ndc;
    }
    window.__liverDiag = { gpu: gpu, vendor: vendor, lost: lost, calls: calls, triangles: tris,
                           ndc: ndc, cam: camStr, camOk: camOk, segments: segMeshes.length,
                           objects: liverGroup.children.length + vesselGroup.children.length + ligGroup.children.length };

    if (!camOk) {
      showWarn('相机矩阵出现非有限值（NaN/Inf），这会导致画面全黑但绘制调用依然存在：' + camStr);
    }

    /* 只在“确实一直没画出来”时才报警：用 40 帧内的最大绘制次数判断，
       避免加载初期几帧的空场景造成误报。 */
    var reallyDead = (maxCalls === 0) && !glbReady;
    if (lost || reallyDead) {
      var why = lost
        ? '检测到 WebGL 上下文丢失（GPU 进程崩溃或被系统回收）'
        : 'WebGL 始终没有绘制调用（0 draw calls）——显卡被浏览器禁用或驱动异常';
      showWarn(why + ' · GPU: ' + gpu);
    }
  }

  function showWarn(msg) {
    var bar = document.getElementById('diagbar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'diagbar';
      document.getElementById('app').appendChild(bar);
    }
    var logHtml = LOGS.length
      ? '<pre class="diaglog">' + LOGS.map(function (l) {
          return l.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        }).join('\n') + '</pre>'
      : '';
    bar.innerHTML = '<button id="diag-close" title="关闭">×</button>⚠ ' + msg +
      '<br><span>可打开 <code>edge://gpu</code>／<code>chrome://gpu</code> 查看 WebGL 状态；' +
      '或在浏览器设置里开启“使用硬件加速”。下方为同一模型的离线渲染结果。</span>' +
      logHtml +
      '<br><img src="' + ((window.LIVER_IMAGES && window.LIVER_IMAGES.whole) || 'images/liver-whole.png') + '">';
    bar.style.display = 'block';
    var btn = document.getElementById('diag-close');
    if (btn) btn.addEventListener('click', function () { bar.style.display = 'none'; });
  }

  function updateLabelPositions() {
    if (!state.labels || state.source === 'glb') return;
    var w = window.innerWidth, h = window.innerHeight;
    var v = new THREE.Vector3();
    labels.forEach(function (l) {
      var visible = state.groups[l.group] !== false;
      if (!visible) { l.el.style.display = 'none'; return; }
      v.copy(l.pos).project(camera);
      var onScreen = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      if (!onScreen) { l.el.style.display = 'none'; return; }
      l.el.style.display = '';
      l.el.style.left = ((v.x * 0.5 + 0.5) * w).toFixed(1) + 'px';
      l.el.style.top = ((-v.y * 0.5 + 0.5) * h).toFixed(1) + 'px';
    });
  }
})();
