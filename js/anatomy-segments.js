/* Couinaud teaching coordinates; classic script, THREE r150+.
 * mount({THREE,parent,parts,host,onStatus}) -> {pick,refresh,dispose}.
 * parts: [{anatomySystem:'parenchyma',mesh:THREE.Mesh}].
 * parent defines calibration coordinates; worldPoint is a world-space Vector3.
 * Manual part.segment always belongs to the caller, not this estimator.
 */
(function (global) {
  'use strict';
  function mount(options) {
    options = options || {};
    var T = options.THREE, parent = options.parent, host = options.host;
    if (!T || !parent || !parent.isObject3D || !host || !host.appendChild) {
      throw new TypeError('肝段示意需要 THREE、parent 三维对象及 host 容器。');
    }
    var doc = host.ownerDocument, disposed = false, enabled = false, calibrated = false;
    var parts = [], entries = [], lines = [], bounds = new T.Box3(), size = new T.Vector3();
    var config = { axes: ['x', 'y', 'z'], reverse: [false, false, false], lateral: 0.30, middle: 0.50, anterior: 0.50, height: 0.50 };
    var panel = doc.createElement('section');
    panel.className = 'liver-segments-panel';
    panel.style.cssText = 'padding:12px 0;font-size:12px;line-height:1.65;';
    host.appendChild(panel);
    function el(tag, text, container) {
      var node = doc.createElement(tag);
      if (text) node.textContent = text;
      (container || panel).appendChild(node);
      return node;
    }
    el('strong', 'Couinaud 肝段 · 教学坐标示意');
    var toggleLabel = el('label');
    toggleLabel.style.display = 'block';
    var toggle = el('input', '', toggleLabel); toggle.type = 'checkbox';
    el('span', ' 开启教学分区线与点击估计（默认关闭）', toggleLabel);
    el('p', 'Couinaud 的 8 段是基于门静脉供血及肝静脉分界的三维功能区域，不是 8 条线。本模型没有临床分割，以下仅为坐标教学示意，不能声称真实解剖分段，也不能用于诊疗。');
    var details = el('details'); el('summary', '方向与归一化平面校准', details);
    el('p', '以 parent 局部坐标及全部肝实质包围盒归一化至 0–1。方向必须互不重复；勾选反向后该轴坐标变为 1−坐标。请结合可靠解剖标志人工确认方向。', details);
    var selects = [], flips = [];
    ['左右轴（0 左 → 1 右）', '上下轴（0 下 → 1 上）', '前后轴（0 后 → 1 前）'].forEach(function (name, i) {
      var row = el('label', name + ' ', details); row.style.display = 'block';
      var select = el('select', '', row);
      ['x', 'y', 'z'].forEach(function (axis) { var option = el('option', axis.toUpperCase(), select); option.value = axis; });
      select.value = config.axes[i]; select.setAttribute('aria-label', name);
      var flip = el('input', '', row); flip.type = 'checkbox';
      el('span', ' 反向', row); selects.push(select); flips.push(flip);
    });
    var fields = {};
    [['lateral', '左外侧 / 左内侧平面'], ['middle', '左 / 右半肝平面'], ['anterior', '右后 / 右前平面'], ['height', '下 / 上横向高度']].forEach(function (item) {
      var row = el('label', item[1] + ' ', details); row.style.display = 'block';
      var input = el('input', '', row); input.type = 'number'; input.min = '0.01'; input.max = '0.99'; input.step = '0.01';
      input.value = String(config[item[0]]); input.style.width = '76px'; input.setAttribute('aria-label', item[1]);
      fields[item[0]] = input;
    });
    var apply = el('button', '应用并确认教学坐标', details); apply.type = 'button';
    var reset = el('button', '重置为未校准', details); reset.type = 'button';
    el('p', '三条纵向分区：左外侧/内侧、左右半肝、仅右半肝的前后分区；另加一条横向高度线。线是校准平面与表面三角形的交线，不代表真实肝静脉或门静脉分界。', details);
    el('p', '映射：左外侧上 II、下 III；左内侧 IV（此处不细分 IVa/IVb）；右前上 VIII、下 V；右后上 VII、下 VI。I 段（尾状叶）独立：需可靠解剖或人工部件标注，本模块不以简单坐标认定，尾状叶所在位置仍可能被误估到其他区域。', details);
    el('p', '校准仅确认用户选择的方向和阈值，并不产生临床分割。轴对齐平面不能表达个体血管走行、弯曲边界、尾状叶及变异；切面、缺损、碎片和爆炸视图也可能影响估计。手动部件肝段标签由主模块优先处理。', details);
    var status = el('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    function report(text) { status.textContent = text; if (typeof options.onStatus === 'function') options.onStatus(text); }
    function clearLines() {
      lines.forEach(function (line) { if (line.parent) line.parent.remove(line); line.geometry.dispose(); line.material.dispose(); });
      lines = [];
    }
    function normalized(point, axisIndex) {
      var axis = config.axes[axisIndex], value = (point[axis] - bounds.min[axis]) / size[axis];
      return config.reverse[axisIndex] ? 1 - value : value;
    }
    function validBounds() { return !bounds.isEmpty() && ['x', 'y', 'z'].every(function (axis) { return Number.isFinite(size[axis]) && size[axis] > 1e-10; }); }
    function updateEntries() {
      entries = []; bounds.makeEmpty(); parent.updateWorldMatrix(true, true);
      var inverse = new T.Matrix4().copy(parent.matrixWorld);
      if (Math.abs(inverse.determinant()) < 1e-15) { size.set(0, 0, 0); return; }
      inverse.invert();
      parts.forEach(function (part) {
        if (!part || part.anatomySystem !== 'parenchyma') return;
        var mesh = part.mesh, geometry = mesh && mesh.geometry;
        if (!mesh || !mesh.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh || !geometry || !geometry.getAttribute('position')) return;
        if (mesh.morphTargetInfluences && mesh.morphTargetInfluences.some(function (v) { return v !== 0; })) return;
        mesh.updateWorldMatrix(true, false);
        var matrix = new T.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
        if (Math.abs(matrix.determinant()) < 1e-15) return;
        var position = geometry.getAttribute('position'), vertices = [], valid = true;
        for (var i = 0; i < position.count; i++) {
          var p = new T.Vector3().fromBufferAttribute(position, i).applyMatrix4(matrix);
          if (![p.x, p.y, p.z].every(Number.isFinite)) { valid = false; break; }
          vertices.push(p);
        }
        if (!valid || !vertices.length) return;
        vertices.forEach(function (p) { bounds.expandByPoint(p); });
        entries.push({ part: part, mesh: mesh, geometry: geometry, vertices: vertices, inverse: matrix.clone().invert() });
      });
      bounds.getSize(size);
    }
    function buildLines() {
      clearLines();
      if (!enabled || !validBounds()) return;
      var planes = [{ axis: 0, value: config.lateral }, { axis: 0, value: config.middle }, { axis: 2, value: config.anterior, rightOnly: true }, { axis: 1, value: config.height }];
      var epsilon = Math.max(size.x, size.y, size.z) * 1e-8;
      entries.forEach(function (entry) {
        var output = [], index = entry.geometry.index, count = index ? index.count : entry.vertices.length;
        var range = entry.geometry.drawRange || { start: 0, count: Infinity };
        var start = Math.max(0, range.start || 0), end = Math.min(count, start + range.count);
        function emit(a, b, plane) {
          if (plane.rightOnly) {
            var da = normalized(a, 0) - config.middle, db = normalized(b, 0) - config.middle;
            if (da < 0 && db < 0) return;
            if (da < 0) a = a.clone().lerp(b, da / (da - db));
            else if (db < 0) b = b.clone().lerp(a, db / (db - da));
          }
          if (a.distanceToSquared(b) <= epsilon * epsilon) return;
          a = a.clone().applyMatrix4(entry.inverse); b = b.clone().applyMatrix4(entry.inverse);
          output.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
        for (var i = start; i + 2 < end; i += 3) {
          var triangle = [0, 1, 2].map(function (offset) { return entry.vertices[index ? index.getX(i + offset) : i + offset]; });
          if (triangle.some(function (p) { return !p; })) continue;
          planes.forEach(function (plane) {
            var distances = triangle.map(function (p) { return normalized(p, plane.axis) - plane.value; });
            // Fully coplanar faces have no unique contour; skip rather than draw a triangulation grid.
            if (distances.every(function (d) { return Math.abs(d) < 1e-9; })) return;
            var hits = [];
            function add(p) { if (!hits.some(function (q) { return q.distanceToSquared(p) < epsilon * epsilon; })) hits.push(p); }
            for (var edge = 0; edge < 3; edge++) {
              var next = (edge + 1) % 3, d1 = distances[edge], d2 = distances[next];
              if (Math.abs(d1) < 1e-9) add(triangle[edge].clone());
              if (d1 * d2 < 0) add(triangle[edge].clone().lerp(triangle[next], d1 / (d1 - d2)));
            }
            if (hits.length >= 2) emit(hits[0], hits[1], plane);
          });
        }
        if (!output.length) return;
        var geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute(output, 3));
        var material = new T.LineBasicMaterial({ color: 0xffe29b, depthTest: true, depthWrite: false, transparent: true, opacity: 0.95 });
        // No positional lift: every endpoint remains on its source triangle.
        var line = new T.LineSegments(geometry, material); line.name = '教学坐标表面交线';
        line.userData.liverSegmentsOverlay = true; line.raycast = function () {};
        entry.mesh.add(line); lines.push(line);
      });
    }
    function announce() {
      report(!enabled ? '教学分段已关闭。I 段仅接受独立人工 / 解剖标注。' : !validBounds() ? '没有可用肝实质三角网格，或坐标范围退化；无法估计。' : (calibrated ? '已人工确认教学坐标；仍非真实解剖分割。' : '未校准：当前使用默认教学坐标，方向可能错误。') + ' 表面交线已更新；I 段不推定。');
    }
    var refreshKey = '';
    function refresh(nextParts) {
      if (disposed) return;
      var next = Array.isArray(nextParts) ? nextParts.slice() : [];
      parent.updateWorldMatrix(true, true);
      var key = next.map(function (part) {
        var mesh = part && part.mesh, geo = mesh && mesh.geometry;
        if (mesh) mesh.updateWorldMatrix(true, false);
        var pos = geo && geo.getAttribute('position');
        return [part && part.anatomySystem, mesh && mesh.uuid, geo && geo.uuid,
          pos && pos.version, pos && pos.count, geo && geo.index && geo.index.version,
          geo && geo.drawRange.start, geo && geo.drawRange.count,
          mesh && mesh.matrixWorld.elements.join(','), mesh && mesh.morphTargetInfluences && mesh.morphTargetInfluences.join(',')].join('|');
      }).join(';') + '/' + parent.matrixWorld.elements.join(',');
      if (key === refreshKey && next.length === parts.length && next.every(function (part, i) { return part === parts[i]; })) return;
      refreshKey = key; parts = next;
      calibrated = false; clearLines(); updateEntries(); buildLines(); announce();
    }
    function changeToggle() { enabled = toggle.checked; if (enabled) updateEntries(); buildLines(); announce(); }
    function applyConfig() {
      var axes = selects.map(function (select) { return select.value; });
      if (new Set(axes).size !== 3 || axes.some(function (axis) { return !/^[xyz]$/.test(axis); })) { report('输入错误：左右、上下、前后必须选择互不重复的 X / Y / Z 轴。'); return; }
      var values = {}, error = false;
      Object.keys(fields).forEach(function (key) { var raw = fields[key].value.trim(); values[key] = Number(raw); if (!raw || !Number.isFinite(values[key]) || values[key] < 0.01 || values[key] > 0.99) error = true; });
      if (error) { report('输入错误：所有平面阈值必须是 0.01–0.99 的有限数字。'); return; }
      if (values.lateral >= values.middle) { report('输入错误：左外侧 / 内侧阈值必须小于左右半肝阈值。'); return; }
      config.axes = axes; config.reverse = flips.map(function (flip) { return flip.checked; });
      Object.keys(values).forEach(function (key) { config[key] = values[key]; });
      calibrated = true; updateEntries(); buildLines(); announce();
    }
    function pendingConfig() {
      calibrated = false;
      report('校准输入尚未应用；当前交线及点击仍使用上次应用的坐标（未校准）。请点击“应用并确认教学坐标”。');
    }
    function resetConfig() {
      selects.forEach(function (select, i) { select.value = ['x', 'y', 'z'][i]; flips[i].checked = false; });
      Object.keys(fields).forEach(function (key) { fields[key].value = key === 'lateral' ? '0.30' : '0.50'; });
      applyConfig(); calibrated = false; announce();
    }
    toggle.addEventListener('change', changeToggle); apply.addEventListener('click', applyConfig); reset.addEventListener('click', resetConfig);
    var inputs = selects.concat(flips, Object.keys(fields).map(function (key) { return fields[key]; }));
    inputs.forEach(function (input) { input.addEventListener('input', pendingConfig); input.addEventListener('change', pendingConfig); });
    refresh(options.parts);
    return {
      pick: function (part, worldPoint) {
        if (disposed || !enabled || !part || part.anatomySystem !== 'parenchyma' || !validBounds() || !entries.some(function (entry) { return entry.part === part; })) return '';
        if (!worldPoint || ![worldPoint.x, worldPoint.y, worldPoint.z].every(Number.isFinite)) return '';
        parent.updateWorldMatrix(true, false);
        if (Math.abs(parent.matrixWorld.determinant()) < 1e-15) return '';
        var point = parent.worldToLocal(new T.Vector3(worldPoint.x, worldPoint.y, worldPoint.z));
        var x = normalized(point, 0), y = normalized(point, 1), z = normalized(point, 2);
        if ([x, y, z].some(function (v) { return !Number.isFinite(v) || v < -1e-6 || v > 1 + 1e-6; })) return '';
        var upper = y >= config.height, segment, region;
        if (x < config.lateral) { segment = upper ? 'II' : 'III'; region = '左外侧'; }
        else if (x < config.middle) { segment = 'IV'; region = '左内侧'; }
        else if (z >= config.anterior) { segment = upper ? 'VIII' : 'V'; region = '右前'; }
        else { segment = upper ? 'VII' : 'VI'; region = '右后'; }
        var boundary = Math.abs(x - config.lateral) < 0.01 || Math.abs(x - config.middle) < 0.01 || Math.abs(y - config.height) < 0.01 || (x >= config.middle && Math.abs(z - config.anterior) < 0.01);
        return segment + ' 段 · ' + region + '（' + (calibrated ? '已人工确认坐标，教学估计' : '未校准，教学估计') + (boundary ? '；邻近示意边界' : '') + '；非临床分割，不能排除 I 段）';
      },
      refresh: refresh,
      dispose: function () {
        if (disposed) return;
        disposed = true; clearLines(); entries = []; parts = [];
        toggle.removeEventListener('change', changeToggle); apply.removeEventListener('click', applyConfig); reset.removeEventListener('click', resetConfig);
        inputs.forEach(function (input) { input.removeEventListener('input', pendingConfig); input.removeEventListener('change', pendingConfig); });
        if (panel.parentNode) panel.parentNode.removeChild(panel);
      }
    };
  }
  global.LiverSegments = { mount: mount };
})(window);
