/* =========================================================================
 * liver-geometry.js  —  pure-JS (no three.js) procedural anatomy of the liver
 * -------------------------------------------------------------------------
 * Coordinate convention (right-handed, 1 unit = 1 cm):
 *    +X = towards the patient's RIGHT
 *    +Y = SUPERIOR
 *    +Z = ANTERIOR
 * Origin ≈ portal / hilar region of the liver.
 *
 * The parenchymal surface is an implicit surface (signed distance field)
 * built from smooth-unioned ellipsoids, then carved by the flat visceral
 * surface, the principal fissures, the gallbladder fossa, the IVC groove and
 * the visceral impressions.  A Surface-Nets mesher turns it into triangles.
 *
 * Couinaud segmentation is computed from the four standard scissurae
 * (planes of the right / middle / left hepatic veins + the transverse
 * portal plane) plus an ellipsoidal caudate region.
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LiverGeom = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var clamp = function (x, a, b) { return x < a ? a : (x > b ? b : x); };
  var PI2 = Math.PI * 2;

  /* ------------------------------------------------------------------ *
   * 1.  Signed-distance primitives
   * ------------------------------------------------------------------ */
  function sdSphere(px, py, pz, cx, cy, cz, r) {
    var dx = px - cx, dy = py - cy, dz = pz - cz;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
  }

  function sdEllipRaw(dx, dy, dz, rx, ry, rz) {
    var qx = dx / rx, qy = dy / ry, qz = dz / rz;
    var k0 = Math.sqrt(qx * qx + qy * qy + qz * qz);
    if (k0 < 1e-9) return -Math.min(rx, ry, rz);
    var k1 = Math.sqrt((qx / rx) * (qx / rx) + (qy / ry) * (qy / ry) + (qz / rz) * (qz / rz));
    return (k0 * (k0 - 1)) / k1;
  }

  function sdEllip(px, py, pz, cx, cy, cz, rx, ry, rz) {
    return sdEllipRaw(px - cx, py - cy, pz - cz, rx, ry, rz);
  }

  /* ellipsoid rotated about Z (angZ) then about X (angX) */
  function sdEllipR(px, py, pz, cx, cy, cz, rx, ry, rz, angZ, angX) {
    var dx = px - cx, dy = py - cy, dz = pz - cz, t;
    if (angZ) {
      var cz_ = Math.cos(angZ), sz_ = Math.sin(angZ);
      t = cz_ * dx + sz_ * dy; dy = -sz_ * dx + cz_ * dy; dx = t;
    }
    if (angX) {
      var cx_ = Math.cos(angX), sx_ = Math.sin(angX);
      t = cx_ * dy + sx_ * dz; dz = -sx_ * dy + cx_ * dz; dy = t;
    }
    return sdEllipRaw(dx, dy, dz, rx, ry, rz);
  }

  function sdCapsule(px, py, pz, ax, ay, az, bx, by, bz, ra, rb) {
    var pax = px - ax, pay = py - ay, paz = pz - az;
    var bax = bx - ax, bay = by - ay, baz = bz - az;
    var h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
    var dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * h);
  }

  function sdBox(px, py, pz, cx, cy, cz, hx, hy, hz) {
    var qx = Math.abs(px - cx) - hx, qy = Math.abs(py - cy) - hy, qz = Math.abs(pz - cz) - hz;
    var ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
    return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0);
  }

  /* rotated box: rotation about Z then X (same convention as sdEllipR) */
  function sdBoxR(px, py, pz, cx, cy, cz, hx, hy, hz, angZ, angX) {
    var dx = px - cx, dy = py - cy, dz = pz - cz, t;
    if (angZ) {
      var c1 = Math.cos(angZ), s1 = Math.sin(angZ);
      t = c1 * dx + s1 * dy; dy = -s1 * dx + c1 * dy; dx = t;
    }
    if (angX) {
      var c2 = Math.cos(angX), s2 = Math.sin(angX);
      t = c2 * dy + s2 * dz; dz = -s2 * dy + c2 * dz; dy = t;
    }
    return sdBox(dx, dy, dz, 0, 0, 0, hx, hy, hz);
  }

  /* ------------------------------------------------------------------ *
   * 2.  Smooth boolean operators
   * ------------------------------------------------------------------ */
  function smin(a, b, k) {
    if (k <= 0) return Math.min(a, b);
    var h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
    return b * (1 - h) + a * h - k * h * (1 - h);
  }
  function smax(a, b, k) {
    if (k <= 0) return Math.max(a, b);
    var h = clamp(0.5 - 0.5 * (b - a) / k, 0, 1);
    return b * (1 - h) + a * h + k * h * (1 - h);
  }
  function ssub(base, cutter, k) { return smax(base, -cutter, k); }

  /* ------------------------------------------------------------------ *
   * 3.  Landmark geometry (shared by the SDF, the vessels and the labels)
   * ------------------------------------------------------------------ */
  var LM = {
    ivcAxis: [2.62, -4.30],          /* x , z of the IVC / IVC groove      */
    ivcRadius: 1.45,
    portaBar: [1.25, -2.55, -2.35],  /* porta hepatis                      */
    gbFossaAnt: [0.15, -4.05, 3.10], /* anterior end of gallbladder fossa  */
    gbFossaPost: [0.80, -2.85, 0.10],/* posterior end (neck)               */
    teresFissureX: -3.15,            /* sagittal plane of lig. teres fissure */
    venosumPlane: { x0: 0.75, tilt: 0.32 },
    domeTop: [4.6, 7.30, 0.4]
  };

  /* the four scissurae, as f(p) = signed horizontal distance (cm) */
  function planes(px, py, pz) {
    /* main portal scissura = Cantlie's plane: gallbladder fossa -> IVC */
    var fm = 0.952 * (px - 0.15) + 0.305 * (pz - 3.30);
    /* left scissura: umbilical (teres) fissure -> IVC */
    var fl = 0.742 * (px + 3.15) + 0.669 * (pz - 1.60);
    /* right scissura: IVC -> right inferior border */
    var fr = 0.672 * (px - 2.62) - 0.741 * (pz + 4.30);
    /* transverse (portal) plane.
       Right hemiliver: plane through the portal bifurcation, running
       laterally so that the inferior segments stay inferior.
       Left hemiliver: the plane of the left portal pedicles, oblique — the
       superior-posterior part is segment II, the anterior-inferior part III. */
    var yPortalR = -0.35 + 0.02 * (px - 2.0) - 0.10 * (pz + 2.4);
    var yPortalL = 0.72 * (py - 0.10) - 0.69 * (pz + 0.20);
    return { fm: fm, fl: fl, fr: fr, yPortalR: yPortalR, tLeft: yPortalL };
  }

  /* ------------------------------------------------------------------ *
   * 4.  The liver SDF
   * ------------------------------------------------------------------ */
  /* Surface-attached hollows (visceral impressions + hilum + gallbladder
     fossa).  Each sphere/ellipsoid is positioned from the *actual*
     parenchymal surface found by ray marching, so the hollow is always
     ~1 cm deep no matter how the parent masses are tuned.              */
  var HOLLOW_SPEC = [
    { key: 'renal',       from: [7.80, -30, -1.10], dir: [0, 1, 0], r: [6.50, 6.50, 6.50], depth: 1.10, k: 2.00 },
    { key: 'suprarenal',  from: [5.30, -30, -3.30], dir: [0, 1, 0], r: [4.20, 4.20, 4.20], depth: 0.85, k: 1.50 },
    { key: 'colic',       from: [8.30, -30,  1.90], dir: [0, 1, 0], r: [5.00, 5.00, 5.00], depth: 0.80, k: 1.60 },
    { key: 'duodenal',    from: [3.40, -30,  1.10], dir: [0, 1, 0], r: [4.00, 4.00, 4.00], depth: 0.85, k: 1.50 },
    { key: 'gastric',     from: [-4.60, -30, 0.80], dir: [0, 1, 0], r: [4.60, 4.60, 4.60], depth: 1.15, k: 2.10 },
    { key: 'oesophageal', from: [-5.40, 2.30, -30], dir: [0, 0, 1], r: [2.30, 2.30, 2.30], depth: 0.70, k: 1.50 },
    /* porta hepatis: shallow pit + a transverse groove that carries the
       hilar plate (the two together read as the transverse fissure)     */
    { key: 'hilum',       from: [1.20, -30, -2.20], dir: [0, 1, 0], r: [6.50, 6.50, 6.50], depth: 1.15, k: 0.90 },
    { key: 'hilumGroove', from: [1.20, -30, -2.20], dir: [0, 1, 0], r: [2.60, 3.00, 1.80], depth: 1.60, k: 0.45 },
    { key: 'gbFossa',     from: [0.50, -30,  1.70], dir: [0, 1, 0], r: [1.40, 1.40, 1.40], depth: 0.95, k: 0.80 }
  ];
  var hollows = null;

  function ensureHollows() {
    if (hollows) return hollows;
    hollows = [];
    for (var i = 0; i < HOLLOW_SPEC.length; i++) {
      var o = HOLLOW_SPEC[i];
      var px = o.from[0], py = o.from[1], pz = o.from[2];
      var t = 0, hit = null;
      for (var s = 0; s < 600; s++) {
        var dd = liverSDF(px + o.dir[0] * t, py + o.dir[1] * t, pz + o.dir[2] * t);
        if (dd < 0.01) { hit = t; break; }
        t += Math.max(dd * 0.85, 0.02);
        if (t > 60) break;
      }
      if (hit === null) continue;
      var hx = px + o.dir[0] * hit, hy = py + o.dir[1] * hit, hz = pz + o.dir[2] * hit;
      hollows.push({
        key: o.key, k: o.k, r: o.r,
        cx: hx - o.dir[0] * (o.r[0] - o.depth),
        cy: hy - o.dir[1] * (o.r[1] - o.depth),
        cz: hz - o.dir[2] * (o.r[2] - o.depth),
        surf: [hx, hy, hz]
      });
    }
    return hollows;
  }

  function liverSDF(x, y, z) {
    /* ---- parenchymal masses -------------------------------------- */
    var right = sdEllip(x, y, z, 5.20, 2.00, 0.20, 6.50, 6.70, 5.05);
    var rightDown = sdEllip(x, y, z, 4.20, -1.90, -1.20, 5.60, 3.70, 4.30);
    var d = smin(right, rightDown, 2.10);

    var leftMain = sdEllipR(x, y, z, -3.60, 0.85, 0.55, 5.60, 3.30, 2.55, 0.080, 0.02);
    d = smin(d, leftMain, 2.40);

    var leftTip = sdEllipR(x, y, z, -8.60, 1.60, 0.45, 4.20, 2.00, 1.70, 0.150, 0.0);
    d = smin(d, leftTip, 1.80);

    /* caudate lobe (segment I) — posterior, between IVC groove and
       the fissure for the ligamentum venosum */
    var caudate = sdEllip(x, y, z, 0.50, 0.20, -4.40, 2.00, 2.90, 1.90);
    d = smin(d, caudate, 1.05);

    /* ---- flat visceral (inferior) surface ------------------------ */
    var floor = -4.10 - 0.115 * x - 0.040 * z;
    d = smax(d, floor - y, 0.34);

    /* posterior surface: gently flattened over the bare area */
    d = smax(d, -5.85 - z, 4.00);

    /* ---- fissure for the ligamentum teres (umbilical fissure) ----
       a narrow, deep cleft with rounded ends — not a rectangular slot */
    d = ssub(d, sdEllipR(x, y, z, LM.teresFissureX, -2.55, 2.05, 0.50, 2.60, 2.90, 0.06, 0.0), 0.30);

    /* ---- fissure for the ligamentum venosum ----------------------
       lies between the caudate lobe (right) and the left lobe (left),
       running from the porta up to the hepatic venous confluence      */
    d = ssub(d, sdEllipR(x, y, z, -1.35, 0.90, -4.40, 0.48, 2.95, 1.85, 0.0, -0.30), 0.30);

    /* ---- groove for the inferior vena cava -----------------------
       a channel on the posterior surface, leaning backwards as it rises
       so that it never breaks through the diaphragmatic surface        */
    d = ssub(d, sdCapsule(x, y, z, 2.62, -7.4, -4.25, 2.62, 4.30, -4.75, 1.50, 1.20), 0.50);

    /* ---- surface-attached hollows -------------------------------- */
    var hl = hollows || ensureHollows();
    for (var i = 0; i < hl.length; i++) {
      var h = hl[i];
      d = ssub(d, sdEllip(x, y, z, h.cx, h.cy, h.cz, h.r[0], h.r[1], h.r[2]), h.k);
    }

    return d;
  }

  /* ------------------------------------------------------------------ *
   * 5.  Gradient, projection, ray marching
   * ------------------------------------------------------------------ */
  var H = 0.06;
  function grad(x, y, z, out) {
    var gx = liverSDF(x + H, y, z) - liverSDF(x - H, y, z);
    var gy = liverSDF(x, y + H, z) - liverSDF(x, y - H, z);
    var gz = liverSDF(x, y, z + H) - liverSDF(x, y, z - H);
    var l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    out[0] = gx / l; out[1] = gy / l; out[2] = gz / l;
    return out;
  }

  function projectToSurface(p) {
    var g = [0, 0, 0];
    for (var i = 0; i < 4; i++) {
      var d = liverSDF(p[0], p[1], p[2]);
      grad(p[0], p[1], p[2], g);
      p[0] -= g[0] * d; p[1] -= g[1] * d; p[2] -= g[2] * d;
      if (Math.abs(d) < 0.002) break;
    }
    return p;
  }

  /* march along a ray, return the first surface hit (from outside) */
  function rayMarch(ox, oy, oz, dx, dy, dz, maxT) {
    var t = 0.0, d = 0;
    for (var i = 0; i < 400; i++) {
      var px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
      d = liverSDF(px, py, pz);
      if (d < 0.01) return [px, py, pz];
      t += Math.max(d * 0.8, 0.03);
      if (t > (maxT || 60)) break;
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * 6.  Couinaud segment classification
   * ------------------------------------------------------------------ */
  var SEG = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };

  function segmentOf(x, y, z) {
    /* caudate lobe: posterior paracaval mass, medial to the venosum fissure
       and anterior to the IVC groove */
    var cx = (x - 0.55) / 2.55, cy = (y - 0.35) / 3.55, cz = (z + 4.05) / 2.15;
    if (cx * cx + cy * cy + cz * cz < 1.0) return 1;

    var P = planes(x, y, z);
    var superior = (P.fm < 0) ? (P.tLeft > 0) : (y > P.yPortalR);

    if (P.fm < 0) {                    /* left hemiliver */
      if (P.fl < 0) return superior ? 2 : 3;   /* lateral section  */
      return 4;                                 /* medial / quadrate */
    }
    if (P.fr > 0) return superior ? 7 : 6;      /* posterior section */
    return superior ? 8 : 5;                    /* anterior section  */
  }

  /* ------------------------------------------------------------------ *
   * 7.  Surface-Nets mesher
   * ------------------------------------------------------------------ */
  function buildSurface(opts) {
    opts = opts || {};
    var res = opts.res || 0.30;
    var bmin = opts.min || [-13.6, -6.2, -7.0];
    var bmax = opts.max || [13.0, 8.4, 6.6];
    var nx = Math.ceil((bmax[0] - bmin[0]) / res);
    var ny = Math.ceil((bmax[1] - bmin[1]) / res);
    var nz = Math.ceil((bmax[2] - bmin[2]) / res);
    var hx = (bmax[0] - bmin[0]) / nx, hy = (bmax[1] - bmin[1]) / ny, hz = (bmax[2] - bmin[2]) / nz;

    var field = new Float32Array((nx + 1) * (ny + 1) * (nz + 1));
    var idx = function (i, j, k) { return (k * (ny + 1) + j) * (nx + 1) + i; };

    for (var k = 0; k <= nz; k++) {
      var pz = bmin[2] + k * hz;
      for (var j = 0; j <= ny; j++) {
        var py = bmin[1] + j * hy;
        for (var i = 0; i <= nx; i++) {
          var px = bmin[0] + i * hx;
          field[idx(i, j, k)] = liverSDF(px, py, pz);
        }
      }
    }

    var cellVerts = new Int32Array(nx * ny * nz).fill(-1);
    var pos = [];
    var cidx = function (i, j, k) { return (k * ny + j) * nx + i; };

    /* the 12 cell edges as pairs of corner bits */
    var E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    var CX = [0, 1, 0, 1, 0, 1, 0, 1], CY = [0, 0, 1, 1, 0, 0, 1, 1], CZ = [0, 0, 0, 0, 1, 1, 1, 1];

    for (k = 0; k < nz; k++) {
      for (j = 0; j < ny; j++) {
        for (i = 0; i < nx; i++) {
          var v = new Float32Array(8), neg = 0;
          for (var c = 0; c < 8; c++) {
            v[c] = field[idx(i + CX[c], j + CY[c], k + CZ[c])];
            if (v[c] < 0) neg++;
          }
          if (neg === 0 || neg === 8) continue;
          var sx = 0, sy = 0, sz = 0, cnt = 0;
          for (var e = 0; e < 12; e++) {
            var a = E[e][0], b = E[e][1];
            if ((v[a] < 0) === (v[b] < 0)) continue;
            var t = v[a] / (v[a] - v[b]);
            sx += CX[a] + (CX[b] - CX[a]) * t;
            sy += CY[a] + (CY[b] - CY[a]) * t;
            sz += CZ[a] + (CZ[b] - CZ[a]) * t;
            cnt++;
          }
          var vid = pos.length / 3;
          pos.push(bmin[0] + (i + sx / cnt) * hx,
                   bmin[1] + (j + sy / cnt) * hy,
                   bmin[2] + (k + sz / cnt) * hz);
          cellVerts[cidx(i, j, k)] = vid;
        }
      }
    }

    var tris = [];
    function quad(ia, ib, ic, id, flip) {
      if (ia < 0 || ib < 0 || ic < 0 || id < 0) return;
      if (!flip) { tris.push(ia, ib, ic, ia, ic, id); }
      else { tris.push(ia, ic, ib, ia, id, ic); }
    }

    for (k = 1; k < nz; k++) {
      for (j = 1; j < ny; j++) {
        for (i = 0; i < nx; i++) {                     /* x edges */
          var s0 = field[idx(i, j, k)], s1 = field[idx(i + 1, j, k)];
          if ((s0 < 0) === (s1 < 0)) continue;
          quad(cellVerts[cidx(i, j - 1, k - 1)], cellVerts[cidx(i, j, k - 1)],
               cellVerts[cidx(i, j, k)], cellVerts[cidx(i, j - 1, k)], s0 < 0);
        }
      }
    }
    for (k = 1; k < nz; k++) {
      for (i = 1; i < nx; i++) {
        for (j = 0; j < ny; j++) {                     /* y edges */
          var t0 = field[idx(i, j, k)], t1 = field[idx(i, j + 1, k)];
          if ((t0 < 0) === (t1 < 0)) continue;
          quad(cellVerts[cidx(i - 1, j, k - 1)], cellVerts[cidx(i - 1, j, k)],
               cellVerts[cidx(i, j, k)], cellVerts[cidx(i, j, k - 1)], t0 >= 0);
        }
      }
    }
    for (j = 1; j < ny; j++) {
      for (i = 1; i < nx; i++) {
        for (k = 0; k < nz; k++) {                     /* z edges */
          var u0 = field[idx(i, j, k)], u1 = field[idx(i, j, k + 1)];
          if ((u0 < 0) === (u1 < 0)) continue;
          quad(cellVerts[cidx(i - 1, j - 1, k)], cellVerts[cidx(i, j - 1, k)],
               cellVerts[cidx(i, j, k)], cellVerts[cidx(i - 1, j, k)], u0 >= 0);
        }
      }
    }

    var P = new Float32Array(pos);
    var T = new Uint32Array(tris);

    /* ---- light Laplacian smoothing (preserves the fissures because
       the vertices are afterwards projected back onto the true surface) */
    if (opts.smooth !== 0) {
      var nb = new Array(P.length / 3);
      for (var n = 0; n < T.length; n += 3) {
        var a2 = T[n], b2 = T[n + 1], c2 = T[n + 2];
        (nb[a2] || (nb[a2] = [])).push(b2, c2);
        (nb[b2] || (nb[b2] = [])).push(c2, a2);
        (nb[c2] || (nb[c2] = [])).push(a2, b2);
      }
      var passes = opts.smoothPasses || 2, lambda = opts.lambda || 0.45;
      for (var pass = 0; pass < passes; pass++) {
        var Q = new Float32Array(P);
        for (var mi = 0; mi < P.length / 3; mi++) {
          var lst = nb[mi]; if (!lst || !lst.length) continue;
          var ax = 0, ay = 0, az = 0, seen = 0;
          for (var q = 0; q < lst.length; q++) {
            ax += P[lst[q] * 3]; ay += P[lst[q] * 3 + 1]; az += P[lst[q] * 3 + 2]; seen++;
          }
          ax /= seen; ay /= seen; az /= seen;
          Q[mi * 3] += (ax - P[mi * 3]) * lambda;
          Q[mi * 3 + 1] += (ay - P[mi * 3 + 1]) * lambda;
          Q[mi * 3 + 2] += (az - P[mi * 3 + 2]) * lambda;
        }
        P = Q;
      }
      for (var rp = 0; rp < P.length; rp += 3) {
        var pp = [P[rp], P[rp + 1], P[rp + 2]];
        projectToSurface(pp);
        P[rp] = pp[0]; P[rp + 1] = pp[1]; P[rp + 2] = pp[2];
      }
    }

    /* ---- normals + segment ids ---------------------------------- */
    var N = new Float32Array(P.length);
    var S = new Uint8Array(P.length / 3);
    var g3 = [0, 0, 0];
    for (var vi = 0; vi < P.length / 3; vi++) {
      var vx = P[vi * 3], vy = P[vi * 3 + 1], vz = P[vi * 3 + 2];
      grad(vx, vy, vz, g3);
      N[vi * 3] = g3[0]; N[vi * 3 + 1] = g3[1]; N[vi * 3 + 2] = g3[2];
      S[vi] = segmentOf(vx, vy, vz);
    }

    /* ---- make sure the winding follows the gradient --------------- */
    var agree = 0;
    for (var ti = 0; ti < T.length; ti += 3) {
      var i0 = T[ti], i1 = T[ti + 1], i2 = T[ti + 2];
      var e1x = P[i1 * 3] - P[i0 * 3], e1y = P[i1 * 3 + 1] - P[i0 * 3 + 1], e1z = P[i1 * 3 + 2] - P[i0 * 3 + 2];
      var e2x = P[i2 * 3] - P[i0 * 3], e2y = P[i2 * 3 + 1] - P[i0 * 3 + 1], e2z = P[i2 * 3 + 2] - P[i0 * 3 + 2];
      var fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
      var nx_ = N[i0 * 3], ny_ = N[i0 * 3 + 1], nz_ = N[i0 * 3 + 2];
      agree += (fx * nx_ + fy * ny_ + fz * nz_) > 0 ? 1 : -1;
    }
    if (agree < 0) {
      for (var f = 0; f < T.length; f += 3) { var tmp = T[f + 1]; T[f + 1] = T[f + 2]; T[f + 2] = tmp; }
    }

    return { positions: P, normals: N, indices: T, segments: S, res: res };
  }

  /* ------------------------------------------------------------------ *
   * 8.  Tubes (vessels, ducts, ligaments as cords)
   * ------------------------------------------------------------------ */
  function catmull(P, samples) {
    var out = [];
    var n = P.length;
    if (n < 2) return P.slice();
    for (var i = 0; i < n - 1; i++) {
      var p0 = P[Math.max(i - 1, 0)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(i + 2, n - 1)];
      var m = (i === n - 2) ? samples : samples;
      for (var s = 0; s < m; s++) {
        var t = s / m, t2 = t * t, t3 = t2 * t;
        out.push([
          0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
          0.5 * ((2 * p1[2]) + (-p0[2] + p2[2]) * t + (2 * p0[2] - 5 * p1[2] + 4 * p2[2] - p3[2]) * t2 + (-p0[2] + 3 * p1[2] - 3 * p2[2] + p3[2]) * t3)
        ]);
      }
    }
    out.push(P[n - 1].slice());
    return out;
  }

  function buildTube(pts, radii, opt) {
    opt = opt || {};
    var radial = opt.radial || 12;
    var samples = opt.samples || 7;
    var curves = catmull(pts, samples);
    var n = curves.length;
    /* 半径数组容错：数量不足时用最后一个值补齐，出现非有限值时回退 */
    var segCount = pts.length - 1;
    var radArr = [];
    if (typeof radii === 'number') {
      for (var r0 = 0; r0 < segCount; r0++) radArr.push(radii);
    } else if (radii && radii.length) {
      for (var r1 = 0; r1 < segCount; r1++) {
        var v0 = radii[Math.min(r1, radii.length - 1)];
        radArr.push(isFinite(v0) ? v0 : (isFinite(radii[0]) ? radii[0] : 0.2));
      }
    } else {
      for (var r2 = 0; r2 < segCount; r2++) radArr.push(0.2);
    }
    /* interpolate radii along the same parameterisation */
    var rr = [];
    for (var i = 0; i < n; i++) {
      var u = (i / (n - 1)) * segCount;
      var i0 = Math.min(Math.floor(u), segCount - 1), f = u - i0;
      var a0 = radArr[i0], a1 = radArr[Math.min(i0 + 1, segCount - 1)];
      rr.push(a0 * (1 - f) + a1 * f);
    }

    var positions = [], normals = [], indices = [];
    var prevN = null, prevT = null;

    for (var i2 = 0; i2 < n; i2++) {
      var p = curves[i2];
      var pa = curves[Math.max(i2 - 1, 0)], pb = curves[Math.min(i2 + 1, n - 1)];
      var tx = pb[0] - pa[0], ty = pb[1] - pa[1], tz = pb[2] - pa[2];
      var tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;

      var nvec;
      if (!prevN) {
        /* pick any vector perpendicular to the tangent */
        var ax = Math.abs(tx), ay = Math.abs(ty), az = Math.abs(tz);
        var tmp = (ax < ay && ax < az) ? [1, 0, 0] : (ay < az ? [0, 1, 0] : [0, 0, 1]);
        nvec = [tmp[1] * tz - tmp[2] * ty, tmp[2] * tx - tmp[0] * tz, tmp[0] * ty - tmp[1] * tx];
      } else {
        /* parallel transport: rotate the previous normal by the rotation
           that maps prevT onto the current tangent */
        var crx = prevT[1] * tz - prevT[2] * ty, cry = prevT[2] * tx - prevT[0] * tz, crz = prevT[0] * ty - prevT[1] * tx;
        var s = Math.sqrt(crx * crx + cry * cry + crz * crz);
        var c = prevT[0] * tx + prevT[1] * ty + prevT[2] * tz;
        if (s < 1e-6) { nvec = prevN.slice(); }
        else {
          var kx = crx / s, ky = cry / s, kz = crz / s;
          var ang = Math.atan2(s, c), ca = Math.cos(ang), sa = Math.sin(ang);
          var dot = kx * prevN[0] + ky * prevN[1] + kz * prevN[2];
          nvec = [
            prevN[0] * ca + (ky * prevN[2] - kz * prevN[1]) * sa + kx * dot * (1 - ca),
            prevN[1] * ca + (kz * prevN[0] - kx * prevN[2]) * sa + ky * dot * (1 - ca),
            prevN[2] * ca + (kx * prevN[1] - ky * prevN[0]) * sa + kz * dot * (1 - ca)
          ];
        }
      }
      var nl = Math.sqrt(nvec[0] * nvec[0] + nvec[1] * nvec[1] + nvec[2] * nvec[2]) || 1;
      nvec = [nvec[0] / nl, nvec[1] / nl, nvec[2] / nl];
      var bvec = [ty * nvec[2] - tz * nvec[1], tz * nvec[0] - tx * nvec[2], tx * nvec[1] - ty * nvec[0]];
      prevN = nvec; prevT = [tx, ty, tz];

      for (var k2 = 0; k2 < radial; k2++) {
        var a2 = (k2 / radial) * PI2, ca2 = Math.cos(a2), sa2 = Math.sin(a2);
        var dx = nvec[0] * ca2 + bvec[0] * sa2, dy = nvec[1] * ca2 + bvec[1] * sa2, dz = nvec[2] * ca2 + bvec[2] * sa2;
        positions.push(p[0] + dx * rr[i2], p[1] + dy * rr[i2], p[2] + dz * rr[i2]);
        normals.push(dx, dy, dz);
      }
    }
    for (var s2 = 0; s2 < n - 1; s2++) {
      for (var k3 = 0; k3 < radial; k3++) {
        var k4 = (k3 + 1) % radial;
        var A = s2 * radial + k3, B = s2 * radial + k4, C = (s2 + 1) * radial + k4, D = (s2 + 1) * radial + k3;
        indices.push(A, B, C, A, C, D);
      }
    }
    if (opt.capEnds !== false) {
      [0, n - 1].forEach(function (end, which) {
        var cIdx = positions.length / 3;
        positions.push(curves[end][0], curves[end][1], curves[end][2]);
        var tsign = which === 0 ? -1 : 1;
        var ta = curves[Math.min(end + 1, n - 1)], tb = curves[Math.max(end - 1, 0)];
        var ux = ta[0] - tb[0], uy = ta[1] - tb[1], uz = ta[2] - tb[2];
        var ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
        normals.push(tsign * ux / ul, tsign * uy / ul, tsign * uz / ul);
        for (var k5 = 0; k5 < radial; k5++) {
          var A2 = end * radial + k5, B2 = end * radial + (k5 + 1) % radial;
          if (which === 0) indices.push(cIdx, B2, A2); else indices.push(cIdx, A2, B2);
        }
      });
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices) };
  }

  /* a thin ribbon between two polylines (ligaments / peritoneal folds) */
  function buildRibbon(baseA, baseB, opt) {
    opt = opt || {};
    var samples = opt.samples || 10;
    var A = catmull(baseA, samples), B = catmull(baseB, samples);
    var n = Math.min(A.length, B.length);
    var positions = [], normals = [], indices = [];
    for (var i = 0; i < n; i++) {
      positions.push(A[i][0], A[i][1], A[i][2]);
      positions.push(B[i][0], B[i][1], B[i][2]);
      var ux = B[i][0] - A[i][0], uy = B[i][1] - A[i][1], uz = B[i][2] - A[i][2];
      var vx = (i < n - 1 ? A[i + 1][0] - A[i][0] : A[i][0] - A[i - 1][0]);
      var vy = (i < n - 1 ? A[i + 1][1] - A[i][1] : A[i][1] - A[i - 1][1]);
      var vz = (i < n - 1 ? A[i + 1][2] - A[i][2] : A[i][2] - A[i - 1][2]);
      var nx1 = uy * vz - uz * vy, ny1 = uz * vx - ux * vz, nz1 = ux * vy - uy * vx;
      var nl1 = Math.sqrt(nx1 * nx1 + ny1 * ny1 + nz1 * nz1) || 1;
      normals.push(nx1 / nl1, ny1 / nl1, nz1 / nl1, nx1 / nl1, ny1 / nl1, nz1 / nl1);
    }
    for (var s = 0; s < n - 1; s++) {
      var a0 = s * 2, b0 = s * 2 + 1, a1 = (s + 1) * 2, b1 = (s + 1) * 2 + 1;
      indices.push(a0, b0, b1, a0, b1, a1);
      indices.push(a0, b1, b0, a0, a1, b1);
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices) };
  }

  /* ------------------------------------------------------------------ *
   * 9.  Cut-face (section) mesh: a coloured Couinaud map on the plane
   * ------------------------------------------------------------------ */
  function buildSection(planePoint, planeNormal, opt) {
    opt = opt || {};
    var step = opt.step || 0.28;
    var n = planeNormal.slice();
    var nl = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]) || 1;
    n = [n[0] / nl, n[1] / nl, n[2] / nl];
    /* in-plane basis */
    var up = Math.abs(n[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
    var u = [up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]];
    var ul = Math.sqrt(u[0] * u[0] + u[1] * u[1] + u[2] * u[2]) || 1;
    u = [u[0] / ul, u[1] / ul, u[2] / ul];
    var v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];

    var UMIN = -16, UMAX = 16, VMIN = -12, VMAX = 12;
    var nu = Math.ceil((UMAX - UMIN) / step), nv = Math.ceil((VMAX - VMIN) / step);
    var positions = [], segs = [], indices = [];
    var map = {};
    function P(a, b) {
      return [planePoint[0] + u[0] * a + v[0] * b,
              planePoint[1] + u[1] * a + v[1] * b,
              planePoint[2] + u[2] * a + v[2] * b];
    }
    for (var iv = 0; iv < nv; iv++) {
      for (var iu = 0; iu < nu; iu++) {
        var a0 = UMIN + iu * step, b0 = VMIN + iv * step;
        var c = P(a0 + step * 0.5, b0 + step * 0.5);
        if (liverSDF(c[0], c[1], c[2]) > 0) continue;
        var s = segmentOf(c[0], c[1], c[2]);
        var quad = [];
        var corners = [[a0, b0], [a0 + step, b0], [a0 + step, b0 + step], [a0, b0 + step]];
        for (var q = 0; q < 4; q++) {
          var key = iu + '_' + iv + '_' + q;
          var pc = P(corners[q][0], corners[q][1]);
          var vid = positions.length / 3;
          positions.push(pc[0] + n[0] * 0.02, pc[1] + n[1] * 0.02, pc[2] + n[2] * 0.02);
          quad.push(vid);
        }
        segs.push(s);
        indices.push(quad[0], quad[1], quad[2], quad[0], quad[2], quad[3]);
      }
    }
    return { positions: new Float32Array(positions), indices: new Uint32Array(indices),
             segments: new Uint8Array(segs), normal: n };
  }

  /* ------------------------------------------------------------------ *
   * 10.  Helpers used by the viewer
   * ------------------------------------------------------------------ */
  function surfaceProfile(angleY, count, radius) {
    /* points on the surface around a horizontal circle -> used for ribbons */
    var out = [];
    for (var i = 0; i < count; i++) {
      var a = (i / (count - 1)) * Math.PI * 2;
    }
    return out;
  }

  return {
    liverSDF: liverSDF,
    segmentOf: segmentOf,
    planes: planes,
    buildSurface: buildSurface,
    buildTube: buildTube,
    buildRibbon: buildRibbon,
    buildSection: buildSection,
    grad: grad,
    projectToSurface: projectToSurface,
    rayMarch: rayMarch,
    LM: LM,
    smin: smin, smax: smax, ssub: ssub,
    sdSphere: sdSphere, sdEllip: sdEllip, sdCapsule: sdCapsule, sdBox: sdBox
  };
});
