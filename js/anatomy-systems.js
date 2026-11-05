/*
 * 肝脏解剖系统辅助模块（独立脚本，无材质修改）。
 * classify(part, texture?) -> {system, source, confidence}：读取 part.mesh.geometry
 * 或 part.geometry 的三角形 UV，在贴图真实像素上投票；省略 texture 时取单材质 map。
 * 尊重 transformUv（含矩阵、wrap、flipY），自动矩阵在副本上更新，不改原贴图。
 * 仅明确高饱和红/蓝/绿返回 artery/vein/biliary；无图、不可读、混色等为 unknown。
 * source 是原因/来源字符串；confidence 为 0..0.85 的颜色候选强度，不是医学概率。
 * 颜色不能确认解剖身份，尤其蓝色不能区分门静脉、肝静脉、下腔静脉。
 * classifyRGB(r,g,b,a=255) 与 classifySamples([[r,g,b,a?],...]) 是纯函数，
 * 输入均为 0..255 字节值，不接受 THREE.Color 的 0..1 线性颜色。
 * systemFor(part, record) -> 系统键：合法 record.anatomySystem（含 unknown）优先，
 * 否则使用 part.anatomyCandidate（应由 classify 生成），缺省时取得贴图颜色候选；
 * 不读取显示色、名称、旧 texColor 或推测具体静脉身份。显示模式可移除 map，候选仍保留。
 * systems[key] = {name, color}；color 是 CSS 十六进制颜色。
 * buildTree(host, parts, recordFor, makeRow) -> host：替换 host 内容，创建 details/summary。
 * recordFor(part,index) 返回人工记录；makeRow(part,index) 返回原有可点击 DOM 行，
 * 每个输入部件调用一次并直接挂载该行（不克隆，因此保留事件）；index 是原数组索引。
 * 图像像素由 WeakMap 缓存，图像尺寸或 texture.version 改变时重读；动态图像更新后
 * 应设置 texture.needsUpdate=true。跨域/未加载图像读取失败不缓存，可稍后重试。
 * 这是保守的教学整理辅助，所有自动结果均待人工确认。
 */
(function (root) {
  'use strict';
  var systems = Object.freeze({
    unknown: Object.freeze({ name: '未分类', color: '#8b95a5' }),
    parenchyma: Object.freeze({ name: '肝实质', color: '#a65c52' }),
    portal: Object.freeze({ name: '门静脉系统', color: '#2878d0' }),
    artery: Object.freeze({ name: '肝动脉系统', color: '#ef5350' }),
    biliary: Object.freeze({ name: '胆道系统', color: '#40bb71' }),
    hepatic: Object.freeze({ name: '肝静脉系统', color: '#2878d0' }),
    ivc: Object.freeze({ name: '下腔静脉', color: '#2878d0' }),
    vein: Object.freeze({ name: '待确认静脉', color: '#2878d0' })
  });
  var pixelCache = new WeakMap();
  function result(system, source, confidence) {
    return { system: system, source: source, confidence: confidence };
  }
  function unknown(reason) { return result('unknown', reason, 0); }
  function classifyRGB(r, g, b, a) {
    if (a === undefined) a = 255;
    if (![r, g, b, a].every(function (v) { return Number.isFinite(v) && v >= 0 && v <= 255; }) || a < 240) return 'unknown';
    var hi = Math.max(r, g, b), lo = Math.min(r, g, b), d = hi - lo;
    if (hi < 170 || d / hi < 0.7) return 'unknown';
    var hue = hi === r ? ((g - b) / d) % 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue = (hue * 60 + 360) % 360;
    // 红色门槛刻意严格：拒绝常见棕红肝实质与橙色、粉色。
    if (r >= 195 && g <= 65 && b <= 85 && (hue <= 8 || hue >= 350)) return 'artery';
    if (b >= 170 && r <= 75 && g <= 130 && hue >= 215 && hue <= 250) return 'vein';
    if (g >= 170 && r <= 95 && b <= 100 && hue >= 100 && hue <= 145) return 'biliary';
    return 'unknown';
  }
  function classifySamples(samples) {
    if (!samples || samples.length < 6) return unknown('insufficient-samples');
    var votes = { artery: 0, vein: 0, biliary: 0, unknown: 0 };
    samples.forEach(function (s) { votes[s ? classifyRGB(s[0], s[1], s[2], s[3]) : 'unknown']++; });
    var keys = ['artery', 'vein', 'biliary'].sort(function (a, b) { return votes[b] - votes[a]; });
    var share = votes[keys[0]] / samples.length;
    // 至少九成全部采样支持同色；任何第二明确色超过 3% 则拒绝。
    if (share < 0.9 || (votes[keys[1]] + votes[keys[2]]) / samples.length > 0.03) return unknown('mixed-or-unclear-pixels');
    return result(keys[0], 'texture-uv-candidate', Math.min(0.85, share * 0.85));
  }
  function pixels(texture) {
    var image = texture.image || (texture.source && texture.source.data);
    if (!image || typeof image !== 'object') return null;
    var w = image.naturalWidth || image.videoWidth || image.width;
    var h = image.naturalHeight || image.videoHeight || image.height;
    if (!(w > 0 && h > 0)) return null;
    var cached = pixelCache.get(image);
    if (cached && cached.width === w && cached.height === h && cached.version === texture.version) return cached;
    var data;
    // 支持字节型 RGB/RGBA DataTexture；浮点、压缩等格式保守拒绝。
    if (image.data) {
      if (!(image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray)) return null;
      var channels = image.data.length / (w * h);
      if (channels !== 3 && channels !== 4) return null;
      data = new Uint8Array(image.data);
    } else {
      var canvas = root.document ? root.document.createElement('canvas') : typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : null;
      if (!canvas) return null;
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(image, 0, 0, w, h);
      data = ctx.getImageData(0, 0, w, h).data;
      channels = 4;
    }
    cached = { width: w, height: h, data: data, channels: channels, version: texture.version };
    pixelCache.set(image, cached);
    return cached;
  }
  function vector(x, y) {
    return { x: x, y: y, applyMatrix3: function (m) {
      var e = m.elements, u = this.x, v = this.y;
      this.x = e[0] * u + e[3] * v + e[6];
      this.y = e[1] * u + e[4] * v + e[7];
      return this;
    } };
  }
  function wrap(v, mode) {
    if (mode === 1000) return v - Math.floor(v); // THREE.RepeatWrapping
    if (mode === 1002) { var cell = Math.floor(v); return Math.abs(cell % 2) ? 1 - (v - cell) : v - cell; }
    return Math.max(0, Math.min(1, v));
  }
  function uvTransformer(texture) {
    var proxy = Object.create(texture);
    if (texture.matrixAutoUpdate && texture.matrix && texture.matrix.clone && typeof texture.updateMatrix === 'function') {
      proxy.matrix = texture.matrix.clone();
      texture.updateMatrix.call(proxy);
    }
    return function (u, v) {
      var p = vector(u, v);
      if (typeof texture.transformUv === 'function') {
        texture.transformUv.call(proxy, p);
      } else {
        if (proxy.matrix) p.applyMatrix3(proxy.matrix);
        else {
          var cx = texture.center ? texture.center.x : 0, cy = texture.center ? texture.center.y : 0;
          var sx = texture.repeat ? texture.repeat.x : 1, sy = texture.repeat ? texture.repeat.y : 1;
          var angle = texture.rotation || 0, c = Math.cos(angle), s = Math.sin(angle);
          p.x = sx * (c * (u - cx) + s * (v - cy)) + cx + (texture.offset ? texture.offset.x : 0);
          p.y = sy * (-s * (u - cx) + c * (v - cy)) + cy + (texture.offset ? texture.offset.y : 0);
        }
        p.x = wrap(p.x, texture.wrapS); p.y = wrap(p.y, texture.wrapT);
        if (texture.flipY) p.y = 1 - p.y;
      }
      return p;
    };
  }
  var classificationCache = new WeakMap();
  function classify(part, texture) {
    var mesh = part && (part.mesh || part), mat = mesh && mesh.material;
    var map = texture || (mat && !Array.isArray(mat) && mat.map);
    if (!mesh || typeof mesh !== 'object' || !map) return calculateClassify(part, texture);
    var geo = mesh.geometry, attrs = geo && geo.attributes;
    var uv = attrs && attrs[map.channel ? 'uv' + map.channel : 'uv'];
    var image = map.image || (map.source && map.source.data);
    var signature = JSON.stringify([
      map.version, map.channel, map.mapping, map.flipY, map.wrapS, map.wrapT,
      map.matrixAutoUpdate, map.matrix && map.matrix.elements,
      map.offset && [map.offset.x,map.offset.y], map.repeat && [map.repeat.x,map.repeat.y],
      map.center && [map.center.x,map.center.y], map.rotation,
      uv && uv.version, uv && uv.count, geo && geo.index && geo.index.version,
      geo && geo.index && geo.index.count, geo && geo.drawRange,
      image && [image.width,image.height,image.naturalWidth,image.naturalHeight]
    ]);
    var old = classificationCache.get(mesh);
    if (old && old.map === map && old.image === image && old.geo === geo && old.uv === uv && old.signature === signature && old.transform === map.transformUv) {
      return result(old.value.system, old.value.source, old.value.confidence);
    }
    var value = calculateClassify(part, texture);
    // 读取失败不缓存，以便图像完成加载后自动重试。
    if (value.source === 'texture-uv-candidate' || value.source === 'mixed-or-unclear-pixels') {
      classificationCache.set(mesh, { map: map, image: image, geo: geo, uv: uv, signature: signature, transform: map.transformUv, value: value });
    }
    return result(value.system, value.source, value.confidence);
  }
  function calculateClassify(part, texture) {
    var mesh = part && (part.mesh || part), geo = mesh && mesh.geometry;
    if (!geo || !geo.attributes) return unknown('missing-geometry');
    if (!texture) {
      var mat = mesh.material;
      if (Array.isArray(mat)) return unknown('ambiguous-materials');
      texture = mat && mat.map;
    }
    if (!texture) return unknown('missing-texture');
    // 仅普通 UV 映射；环境映射等不能视为部件表面 UV。
    if (texture.mapping !== undefined && texture.mapping !== 300) return unknown('unsupported-mapping');
    var channel = texture.channel || 0;
    var uv = geo.attributes[channel ? 'uv' + channel : 'uv'];
    if (!uv || !uv.count) return unknown('missing-uv');
    try {
      var image = pixels(texture);
      if (!image) return unknown('unreadable-image');
      var transform = uvTransformer(texture), samples = [];
      var index = geo.index;
      var count = index ? index.count : uv.count;
      var range = geo.drawRange || { start: 0, count: Infinity };
      var start = Math.max(0, range.start || 0), end = Math.min(count, start + range.count);
      var triangles = Math.floor((end - start) / 3);
      if (!triangles) return unknown('missing-triangles');
      // 在每个抽中三角形内部取七点，避免仅采顶点导致 UV 接缝/图集边界误判。
      var weights = [[1/3,1/3,1/3],[0.7,0.15,0.15],[0.15,0.7,0.15],[0.15,0.15,0.7],[0.45,0.45,0.1],[0.45,0.1,0.45],[0.1,0.45,0.45]];
      var take = Math.min(128, triangles);
      for (var i = 0; i < take; i++) {
        var t = start + Math.floor((i + 0.5) * triangles / take) * 3;
        var ids = [t,t+1,t+2].map(function (n) { return index ? (index.getX ? index.getX(n) : index.array[n]) : n; });
        if (ids.some(function (n) { return n < 0 || n >= uv.count; })) return unknown('invalid-uv');
        weights.forEach(function (b) {
          var u = 0, v = 0;
          for (var k = 0; k < 3; k++) { u += uv.getX(ids[k]) * b[k]; v += uv.getY(ids[k]) * b[k]; }
          var p = transform(u, v);
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) { samples.push(null); return; }
          var x = Math.max(0, Math.min(image.width - 1, Math.floor(p.x * image.width)));
          var y = Math.max(0, Math.min(image.height - 1, Math.floor(p.y * image.height)));
          var offset = (y * image.width + x) * image.channels, d = image.data;
          samples.push([d[offset], d[offset+1], d[offset+2], image.channels === 4 ? d[offset+3] : 255]);
        });
      }
      return classifySamples(samples);
    } catch (error) { return unknown('unreadable-texture-or-uv'); }
  }
  function systemFor(part, record) {
    if (record && Object.prototype.hasOwnProperty.call(systems, record.anatomySystem)) return record.anatomySystem;
    var candidate = part && part.anatomyCandidate;
    if (candidate && ['unknown','vein','artery','biliary'].indexOf(candidate.system) >= 0) return candidate.system;
    return classify(part).system;
  }
  function buildTree(host, parts, recordFor, makeRow) {
    var doc = host.ownerDocument || root.document, fragment = doc.createDocumentFragment(), buckets = {};
    function group(parent, key, title) {
      var details = doc.createElement('details'), summary = doc.createElement('summary');
      details.open = true; details.dataset.anatomySystem = key;
      summary.textContent = title; details.appendChild(summary); parent.appendChild(details);
      buckets[key] = details;
      return details;
    }
    group(fragment, 'parenchyma', '肝实质（非 Glisson 系统同义）');
    var first = group(fragment, 'first-porta', '第一肝门');
    ['portal','artery','biliary'].forEach(function (key) { group(first, key, systems[key].name); });
    group(fragment, 'hepatic', '第二肝门 · 肝静脉');
    ['ivc','vein','unknown'].forEach(function (key) { group(fragment, key, systems[key].name); });
    parts.forEach(function (p, index) {
      var key = systemFor(p, recordFor ? recordFor(p, index) : null);
      var row = makeRow(p, index);
      buckets[key].appendChild(row);
    });
    host.replaceChildren(fragment);
    return host;
  }
  root.LiverAnatomy = Object.freeze({ systems: systems, classify: classify, classifyRGB: classifyRGB, classifySamples: classifySamples, systemFor: systemFor, buildTree: buildTree });
})(typeof window !== 'undefined' ? window : globalThis);
