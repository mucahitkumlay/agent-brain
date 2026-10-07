// Where a link between two notes runs inside the brain. Pure geometry (no three.js, no state), so it can be tested alone.
//
// A neuron sits just beneath the cortex. A link between two of them is routed the way real fibres are:
//   short  : an association ("U") fibre. It leaves the neuron, dips into the white matter beneath the cortex and follows
//            the folds of the surface to the other neuron.
//   long   : it joins a real white-matter bundle (HCP-1065 fibres from the anatomy files): a short climb down from the
//            neuron to the nearest end of a fibre that connects both places, the fibre itself, and a climb up again.
//   other  : when no fibre fits (or the anatomy has not loaded), a free curve through the white matter, bent a different
//            way for every link so they do not all arc alike.
// Every path gets the small, smooth wobble of a living fibre, and a few twigs near each end (the terminal arbour).
// Everything depends only on the two ends and a seed, so a link always looks the same.

const N_SEG = 14;                       // segments per link: N_SEG + 1 points, evenly spaced along the path
export const LINK_SEGMENTS = N_SEG;
const U_MAX = 34;                       // mm: links shorter than this are association fibres
const TRACT_REACH = 38;                 // mm: how far a neuron may be from the end of a fibre it uses
const TRACT_BUDGET = 84;                // mm: both ends together

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function rng(seed) { let s = (seed >>> 0) || 0x9e3779b9; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

// ---- the cortical surface, as a grid of its vertices: "the surface point nearest to here, and which way is out"
export function makeSurfaceIndex(P, N, cell = 6) {
  const nv = (P.length / 3) | 0;
  if (!nv) return null;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < nv; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell) + 1), ny = Math.max(1, Math.ceil((y1 - y0) / cell) + 1), nz = Math.max(1, Math.ceil((z1 - z0) / cell) + 1);
  const cellOf = (x, y, z) => (Math.min(nx - 1, Math.max(0, Math.floor((x - x0) / cell))) * ny + Math.min(ny - 1, Math.max(0, Math.floor((y - y0) / cell)))) * nz + Math.min(nz - 1, Math.max(0, Math.floor((z - z0) / cell)));
  const start = new Int32Array(nx * ny * nz + 1), cellIdx = new Int32Array(nv);
  for (let i = 0; i < nv; i++) { const c = cellOf(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); cellIdx[i] = c; start[c + 1]++; }
  for (let c = 0; c < start.length - 1; c++) start[c + 1] += start[c];
  const fill = start.slice(0, -1), order = new Int32Array(nv);
  for (let i = 0; i < nv; i++) order[fill[cellIdx[i]]++] = i;
  return {
    // writes { x, y, z, nx, ny, nz } of the nearest vertex into out; false when nothing is within ~4 cells
    nearest(x, y, z, out, maxR = 4) {
      const cx = Math.min(nx - 1, Math.max(0, Math.floor((x - x0) / cell))), cy = Math.min(ny - 1, Math.max(0, Math.floor((y - y0) / cell))), cz = Math.min(nz - 1, Math.max(0, Math.floor((z - z0) / cell)));
      let best = -1, bd = Infinity;
      for (let r = 0; r <= maxR; r++) {
        for (let ix = cx - r; ix <= cx + r; ix++) {
          if (ix < 0 || ix >= nx) continue;
          for (let iy = cy - r; iy <= cy + r; iy++) {
            if (iy < 0 || iy >= ny) continue;
            for (let iz = cz - r; iz <= cz + r; iz++) {
              if (iz < 0 || iz >= nz) continue;
              if (Math.max(Math.abs(ix - cx), Math.abs(iy - cy), Math.abs(iz - cz)) < r) continue;   // inner cells were done
              const c = (ix * ny + iy) * nz + iz;
              for (let k = start[c]; k < start[c + 1]; k++) {
                const v = order[k], d = (P[v * 3] - x) ** 2 + (P[v * 3 + 1] - y) ** 2 + (P[v * 3 + 2] - z) ** 2;
                if (d < bd) { bd = d; best = v; }
              }
            }
          }
        }
        if (best >= 0 && bd <= (r * cell) ** 2) break;
      }
      if (best < 0) return false;
      out.x = P[best * 3]; out.y = P[best * 3 + 1]; out.z = P[best * 3 + 2];
      out.nx = N ? N[best * 3] : 0; out.ny = N ? N[best * 3 + 1] : 0; out.nz = N ? N[best * 3 + 2] : 0;
      return true;
    },
  };
}

// keep a point inside the cortex: when it is outside the surface (or closer than `margin` mm to it) it is moved inwards,
// and the way it is heading (d, a unit vector, optional) loses its outward part, so a branch that reaches the surface runs along
// just beneath it instead of leaving the brain. Returns true when the point was moved.
const _near = {};
const SKIN = 1.0;   // mm under the surface
export function keepIn(surface, p, d, margin = SKIN) {
  if (!surface || !surface.nearest(p.x, p.y, p.z, _near, 2)) return false;   // looks 12 mm around: further than that is deep inside
  const nl = Math.hypot(_near.nx, _near.ny, _near.nz); if (!(nl > 1e-6)) return false;
  const nx = _near.nx / nl, ny = _near.ny / nl, nz = _near.nz / nl, depth = (_near.x - p.x) * nx + (_near.y - p.y) * ny + (_near.z - p.z) * nz;
  if (depth >= margin) return false;
  const k = Math.min(margin - depth, 10);
  p.x -= nx * k; p.y -= ny * k; p.z -= nz * k;
  if (d) {
    const dn = d.x * nx + d.y * ny + d.z * nz;
    if (dn > 0) { d.x -= nx * dn; d.y -= ny * dn; d.z -= nz * dn; const m = Math.hypot(d.x, d.y, d.z) || 1; d.x /= m; d.y /= m; d.z /= m; }
  }
  return true;
}

// ---- the two ends of every real fibre, on a grid: "which fibres end near here"
export function makeEndIndex(ends, cell = 14) {
  const n = (ends.length / 6) | 0, map = new Map();
  const key = (ix, iy, iz) => (ix + 512) * 1048576 + (iy + 512) * 1024 + (iz + 512);
  for (let i = 0; i < n; i++) for (let s = 0; s < 2; s++) {
    const k = key(Math.floor(ends[i * 6 + s * 3] / cell), Math.floor(ends[i * 6 + s * 3 + 1] / cell), Math.floor(ends[i * 6 + s * 3 + 2] / cell));
    let l = map.get(k); if (!l) map.set(k, l = []); l.push(i * 2 + s);
  }
  return {
    // calls fn(fibre, end, squaredDistance) for every fibre end within R of the point
    near(p, R, fn) {
      const r = Math.ceil(R / cell), cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell), cz = Math.floor(p.z / cell), R2 = R * R;
      for (let ix = cx - r; ix <= cx + r; ix++) for (let iy = cy - r; iy <= cy + r; iy++) for (let iz = cz - r; iz <= cz + r; iz++) {
        const l = map.get(key(ix, iy, iz)); if (!l) continue;
        for (const e of l) {
          const f = e >> 1, s = e & 1, d = (ends[f * 6 + s * 3] - p.x) ** 2 + (ends[f * 6 + s * 3 + 1] - p.y) ** 2 + (ends[f * 6 + s * 3 + 2] - p.z) ** 2;
          if (d <= R2) fn(f, s, d);
        }
      }
    },
  };
}

// ---- smooth curves through control points, evenly spaced by length
function catmull(c, steps) {   // c: [{x,y,z}], returns a dense polyline
  const out = [];
  for (let i = 0; i < c.length - 1; i++) {
    const p0 = c[Math.max(0, i - 1)], p1 = c[i], p2 = c[i + 1], p3 = c[Math.min(c.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t, f = (a, b, cc, d) => 0.5 * ((2 * b) + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  out.push({ x: c[c.length - 1].x, y: c[c.length - 1].y, z: c[c.length - 1].z });
  return out;
}
function resample(poly, n) {   // n + 1 points, equal arc length
  const cum = [0];
  for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + dist(poly[i], poly[i - 1]));
  const L = cum[cum.length - 1], out = new Float32Array((n + 1) * 3);
  if (!(L > 1e-9)) { for (let i = 0; i <= n; i++) { out[i * 3] = poly[0].x; out[i * 3 + 1] = poly[0].y; out[i * 3 + 2] = poly[0].z; } return { pts: out, len: 0 }; }
  let j = 0;
  for (let i = 0; i <= n; i++) {
    const target = L * i / n;
    while (j < cum.length - 2 && cum[j + 1] < target) j++;
    const f = cum[j + 1] > cum[j] ? clamp((target - cum[j]) / (cum[j + 1] - cum[j]), 0, 1) : 0, a = poly[j], b = poly[j + 1];
    out[i * 3] = a.x + (b.x - a.x) * f; out[i * 3 + 1] = a.y + (b.y - a.y) * f; out[i * 3 + 2] = a.z + (b.z - a.z) * f;
  }
  return { pts: out, len: L };
}

// the point at t (0..1) of a routed path
export function linkPoint(pts, t, out) {
  const n = pts.length / 3 - 1, f = clamp(t, 0, 1) * n, i = Math.min(n - 1, Math.floor(f)), u = f - i;
  out.x = pts[i * 3] + (pts[i * 3 + 3] - pts[i * 3]) * u; out.y = pts[i * 3 + 1] + (pts[i * 3 + 4] - pts[i * 3 + 1]) * u; out.z = pts[i * 3 + 2] + (pts[i * 3 + 5] - pts[i * 3 + 2]) * u;
  return out;
}

// ---- the route of one link
// a, b: { x, y, z }; o: { seed, surface, endIdx, ends, tracts, centre }
//   tracts: [{ pts }] indexed like `ends` (fibre i, its points as x y z, z y z ...)
// returns { pts: Float32Array, len, kind: 'u' | 'tract' | 'free' }
export function routeLink(a, b, o) {
  const rand = rng(o.seed), d = dist(a, b), centre = o.centre || { x: 0, y: 0, z: 0 };
  const lerp = (t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
  const pull = (p, k) => ({ x: p.x + (centre.x - p.x) * k, y: p.y + (centre.y - p.y) * k, z: p.z + (centre.z - p.z) * k });
  // a unit vector across the chord, and one across both
  const chord = { x: (b.x - a.x) / (d || 1), y: (b.y - a.y) / (d || 1), z: (b.z - a.z) / (d || 1) };
  const cross = (u, v) => ({ x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x });
  const unit = (v) => { const m = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / m, y: v.y / m, z: v.z / m }; };
  let e1 = cross(chord, { x: 0, y: 1, z: 0 }); if (Math.hypot(e1.x, e1.y, e1.z) < 0.2) e1 = cross(chord, { x: 1, y: 0, z: 0 });
  e1 = unit(e1); const e2 = unit(cross(chord, e1));
  const side = () => { const th = rand() * Math.PI * 2; return { x: e1.x * Math.cos(th) + e2.x * Math.sin(th), y: e1.y * Math.cos(th) + e2.y * Math.sin(th), z: e1.z * Math.cos(th) + e2.z * Math.sin(th) }; };
  let poly = null, kind = 'free';

  if (d < 1e-6) { poly = [a, b]; }
  else {
    // 1. association fibre along the folds
    if (d <= U_MAX && o.surface) {
      const s = {}, pts = [{ x: a.x, y: a.y, z: a.z }];
      const depthAt = (p) => (o.surface.nearest(p.x, p.y, p.z, s) ? clamp((s.x - p.x) * s.nx + (s.y - p.y) * s.ny + (s.z - p.z) * s.nz, 0.8, 14) : 3);
      const dA = depthAt(a), dB = depthAt(b), lift = 2 + 0.14 * d + rand() * 1.5, M = 12;
      let ok = true;
      for (let i = 1; i < M; i++) {
        const t = i / M, p = lerp(t);
        if (!o.surface.nearest(p.x, p.y, p.z, s)) { ok = false; break; }
        const depth = dA + (dB - dA) * t + lift * Math.sin(Math.PI * t);
        pts.push({ x: s.x - s.nx * depth, y: s.y - s.ny * depth, z: s.z - s.nz * depth });
      }
      if (ok) {
        pts.push({ x: b.x, y: b.y, z: b.z });
        for (let pass = 0; pass < 3; pass++) for (let i = 1; i < pts.length - 1; i++) { const p = pts[i - 1], q = pts[i], r = pts[i + 1]; q.x = 0.25 * p.x + 0.5 * q.x + 0.25 * r.x; q.y = 0.25 * p.y + 0.5 * q.y + 0.25 * r.y; q.z = 0.25 * p.z + 0.5 * q.z + 0.25 * r.z; }
        poly = catmull(pts, 3); kind = 'u';
      }
    }
    // 2. a real bundle
    if (!poly && d > U_MAX * 0.6 && o.endIdx && o.ends && o.tracts) {
      const E = o.ends, near = [];
      o.endIdx.near(a, TRACT_REACH, (f, s, d2) => {
        const bx = E[f * 6 + (1 - s) * 3] - b.x, by = E[f * 6 + (1 - s) * 3 + 1] - b.y, bz = E[f * 6 + (1 - s) * 3 + 2] - b.z, db = Math.hypot(bx, by, bz);
        if (db <= TRACT_REACH && Math.sqrt(d2) + db <= TRACT_BUDGET) near.push([Math.sqrt(d2) + db, f, s]);
      });
      // a fibre only helps when it runs the way the link goes and does not wander: no detours, no doubling back
      const lenOf = (T) => { if (!T || !T.pts) return Infinity; if (T.len > 0) return T.len; let L = 0; for (let i = 3; i < T.pts.length; i += 3) L += Math.hypot(T.pts[i] - T.pts[i - 3], T.pts[i + 1] - T.pts[i - 2], T.pts[i + 2] - T.pts[i - 1]); return L; };
      const fits = near.filter(c => {
        const f = c[1], s = c[2], ox = E[f * 6 + (1 - s) * 3] - E[f * 6 + s * 3], oy = E[f * 6 + (1 - s) * 3 + 1] - E[f * 6 + s * 3 + 1], oz = E[f * 6 + (1 - s) * 3 + 2] - E[f * 6 + s * 3 + 2], m = Math.hypot(ox, oy, oz) || 1;
        return (ox * chord.x + oy * chord.y + oz * chord.z) / m >= 0.45 && lenOf(o.tracts[f]) <= d * 1.7 + 24;
      });
      if (fits.length) {
        fits.sort((p, q) => p[0] - q[0]);
        const top = fits.filter(c => c[0] < fits[0][0] + 10).slice(0, 8), pick = top[Math.floor(rand() * top.length)], T = o.tracts[pick[1]];
        if (T && T.pts && T.pts.length >= 6) {
          const n = T.pts.length / 3, step = Math.max(1, Math.round(n / 9)), idx = [];
          for (let i = 0; i < n; i += step) idx.push(i); if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
          if (pick[2] === 1) idx.reverse();
          const along = idx.map(i => ({ x: T.pts[i * 3], y: T.pts[i * 3 + 1], z: T.pts[i * 3 + 2] }));
          // one fibre's own offset, so a bundle is a few fibres wide and not one line
          const off = side(), w = 0.4 + rand() * 1.2;
          for (let i = 1; i < along.length - 1; i++) { along[i].x += off.x * w; along[i].y += off.y * w; along[i].z += off.z * w; }
          const first = along[0], last = along[along.length - 1];
          const ja = pull({ x: (a.x + first.x) / 2, y: (a.y + first.y) / 2, z: (a.z + first.z) / 2 }, 0.1), jb = pull({ x: (b.x + last.x) / 2, y: (b.y + last.y) / 2, z: (b.z + last.z) / 2 }, 0.1);
          poly = catmull([{ x: a.x, y: a.y, z: a.z }, ja, ...along, jb, { x: b.x, y: b.y, z: b.z }], 3); kind = 'tract';
        }
      }
    }
    // 3. a free curve through the white matter, bent its own way
    if (!poly) {
      const k = clamp(0.22 + d / 260, 0.22, 0.62), bend = Math.min(16, 0.1 * d + 2);
      const s1 = side(), s2 = rand() < 0.5 ? { x: -s1.x, y: -s1.y, z: -s1.z } : s1, w1 = bend * (0.4 + rand() * 0.8), w2 = bend * (0.4 + rand() * 0.8);
      const c1 = pull(lerp(0.33), k), c2 = pull(lerp(0.67), k * (0.7 + rand() * 0.6));
      c1.x += s1.x * w1; c1.y += s1.y * w1; c1.z += s1.z * w1; c2.x += s2.x * w2; c2.y += s2.y * w2; c2.z += s2.z * w2;
      poly = catmull([{ x: a.x, y: a.y, z: a.z }, c1, c2, { x: b.x, y: b.y, z: b.z }], 6);
    }
  }
  const { pts, len } = resample(poly, N_SEG);
  // the wobble of a living fibre: two slow waves across the path, nothing at the two neurons
  if (d > 1e-6) {
    const A1 = Math.min(1.3, 0.2 + 0.03 * d) * (0.5 + rand() * 0.8), A2 = A1 * 0.45, f1 = 0.8 + rand() * 1.2, f2 = 2.3 + rand() * 1.6, p1 = rand() * 6.283, p2 = rand() * 6.283, th = rand() * 6.283;
    const dir1 = { x: e1.x * Math.cos(th) + e2.x * Math.sin(th), y: e1.y * Math.cos(th) + e2.y * Math.sin(th), z: e1.z * Math.cos(th) + e2.z * Math.sin(th) }, dir2 = cross(chord, dir1);
    for (let i = 1; i < N_SEG; i++) {
      const t = i / N_SEG, env = Math.pow(Math.sin(Math.PI * t), 0.7), u = env * A1 * Math.sin(6.283 * f1 * t + p1), v = env * A2 * Math.sin(6.283 * f2 * t + p2);
      pts[i * 3] += dir1.x * u + dir2.x * v; pts[i * 3 + 1] += dir1.y * u + dir2.y * v; pts[i * 3 + 2] += dir1.z * u + dir2.z * v;
    }
  }
  // nothing leaves the cortex: points that came out outside are pulled in, and the kinks that makes are smoothed
  if (o.surface && d > 1e-6) {
    const q = { x: 0, y: 0, z: 0 }; let moved = false;
    for (let i = 1; i < N_SEG; i++) { q.x = pts[i * 3]; q.y = pts[i * 3 + 1]; q.z = pts[i * 3 + 2]; if (keepIn(o.surface, q)) { pts[i * 3] = q.x; pts[i * 3 + 1] = q.y; pts[i * 3 + 2] = q.z; moved = true; } }
    if (moved) {
      for (let pass = 0; pass < 2; pass++) for (let i = 1; i < N_SEG; i++) for (let c = 0; c < 3; c++) pts[i * 3 + c] = 0.25 * pts[(i - 1) * 3 + c] + 0.5 * pts[i * 3 + c] + 0.25 * pts[(i + 1) * 3 + c];
      for (let i = 1; i < N_SEG; i++) { q.x = pts[i * 3]; q.y = pts[i * 3 + 1]; q.z = pts[i * 3 + 2]; if (keepIn(o.surface, q)) { pts[i * 3] = q.x; pts[i * 3 + 1] = q.y; pts[i * 3 + 2] = q.z; } }
    }
  }
  pts[0] = a.x; pts[1] = a.y; pts[2] = a.z; pts[N_SEG * 3] = b.x; pts[N_SEG * 3 + 1] = b.y; pts[N_SEG * 3 + 2] = b.z;
  return { pts, len, kind };
}

// the terminal arbour at the receiving end (the last part of the axon splits into a few twigs, each ending in a small
// swelling, a bouton, where it meets the other neuron). seg: segment pairs x y z x y z; tips: x y z of every bouton.
export function twigs(pts, seed, per = 3, surface = null) {
  const rand = rng(seed ^ 0x5bd1e995), n = pts.length / 3 - 1, seg = [], tips = [];
  const at = (i) => ({ x: pts[i * 3], y: pts[i * 3 + 1], z: pts[i * 3 + 2] });
  const end = at(n);
  // the arbour starts a few millimetres before the neuron, wherever that is along the path
  let walked = 0, bi = n - 1; const reach = 4;
  for (; bi > 0 && walked < reach; bi--) { const p = at(bi), q = at(bi + 1); walked += Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z); }
  const base = at(Math.min(n - 1, bi + 1));
  let dx = end.x - base.x, dy = end.y - base.y, dz = end.z - base.z; const m = Math.hypot(dx, dy, dz) || 1; dx /= m; dy /= m; dz /= m;
  const arm = (p, dir, L, level) => {
    // dir: unit; one twig, bending a little, and sometimes forking once
    const bend = () => ({ x: (rand() - 0.5) * 0.7, y: (rand() - 0.5) * 0.7, z: (rand() - 0.5) * 0.7 });
    let d = dir, q = p;
    for (let k = 0; k < 2; k++) {
      const b = bend(); let ex = d.x + b.x, ey = d.y + b.y, ez = d.z + b.z; const mm = Math.hypot(ex, ey, ez) || 1; d = { x: ex / mm, y: ey / mm, z: ez / mm };
      const r = { x: q.x + d.x * L / 2, y: q.y + d.y * L / 2, z: q.z + d.z * L / 2 };
      keepIn(surface, r, d);
      seg.push(q.x, q.y, q.z, r.x, r.y, r.z); q = r;
    }
    if (level === 0 && rand() < 0.55) {
      const b = bend(); let ex = d.x + b.x * 1.6, ey = d.y + b.y * 1.6, ez = d.z + b.z * 1.6; const mm = Math.hypot(ex, ey, ez) || 1;
      arm(q, { x: ex / mm, y: ey / mm, z: ez / mm }, L * 0.6, 1);
    }
    tips.push(q.x, q.y, q.z);
  };
  for (let k = 0; k < per; k++) {
    let rx = rand() - 0.5, ry = rand() - 0.5, rz = rand() - 0.5;
    const dot = rx * dx + ry * dy + rz * dz; rx -= dot * dx; ry -= dot * dy; rz -= dot * dz;
    const rm = Math.hypot(rx, ry, rz) || 1; rx /= rm; ry /= rm; rz /= rm;
    const sp = 0.3 + rand() * 0.5, ex = dx * 1.2 + rx * sp, ey = dy * 1.2 + ry * sp, ez = dz * 1.2 + rz * sp, mm = Math.hypot(ex, ey, ez) || 1;
    arm(base, { x: ex / mm, y: ey / mm, z: ez / mm }, 2.8 + rand() * 2, 0);
  }
  return { seg: new Float32Array(seg), tips: new Float32Array(tips) };
}

// the dendrites of a neuron: one apical dendrite towards the cortical surface, several basal ones spreading sideways and
// down, each branching up to twice. n: { x, y, z, nx, ny, nz } (nx.. = which way is out); budget = most segments allowed.
// Returns segment pairs and one 0..1 brightness per vertex (strong near the cell body, fading along each branch).
export function dendrites(n, seed, budget, scale = 1, surface = null) {
  const rand = rng(seed ^ 0x27d4eb2f), pos = [], inten = [];
  const unit = (v) => { const m = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / m, y: v.y / m, z: v.z / m }; };
  const rv = () => unit({ x: rand() - 0.5, y: rand() - 0.5, z: rand() - 0.5 });
  const out = (n.nx || n.ny || n.nz) ? unit({ x: n.nx, y: n.ny, z: n.nz }) : rv();
  const maxLevel = budget >= 70 ? 2 : budget >= 32 ? 1 : 0, basal = budget >= 70 ? 5 : budget >= 32 ? 4 : 3;
  const grow = (p, dir, len, level, from, total) => {
    let q = p, d = dir;
    for (let s = 0; s < 3; s++) {
      const j = rv(); d = unit({ x: d.x + j.x * 0.45, y: d.y + j.y * 0.45, z: d.z + j.z * 0.45 });
      const e = { x: q.x + d.x * len / 3, y: q.y + d.y * len / 3, z: q.z + d.z * len / 3 };
      keepIn(surface, e, d);
      pos.push(q.x, q.y, q.z, e.x, e.y, e.z);
      inten.push(0.95 - 0.7 * Math.min(1, (from + s * len / 3) / total), 0.95 - 0.7 * Math.min(1, (from + (s + 1) * len / 3) / total));
      q = e;
    }
    if (level < maxLevel && pos.length / 6 + 6 < budget) {
      const side = unit({ x: d.y * 0.3 - d.z * 0.7 + rand() - 0.5, y: d.z * 0.3 - d.x * 0.7 + rand() - 0.5, z: d.x * 0.3 - d.y * 0.7 + rand() - 0.5 });
      for (const sg of [1, -1]) grow(q, unit({ x: d.x + side.x * 0.85 * sg, y: d.y + side.y * 0.85 * sg, z: d.z + side.z * 0.85 * sg }), len * 0.68, level + 1, from + len, total);
    }
  };
  const apical = (7 + rand() * 4) * scale;
  grow(n, unit({ x: out.x + (rand() - 0.5) * 0.4, y: out.y + (rand() - 0.5) * 0.4, z: out.z + (rand() - 0.5) * 0.4 }), apical, 0, 0, apical * 2.1);
  for (let k = 0; k < basal && pos.length / 6 + 3 < budget; k++) {
    let v = rv(); const dot = v.x * out.x + v.y * out.y + v.z * out.z;
    if (dot > 0.15) v = unit({ x: v.x - out.x * dot * 1.6, y: v.y - out.y * dot * 1.6, z: v.z - out.z * dot * 1.6 });   // sideways and down, not out
    const L = (4 + rand() * 3.5) * scale;
    grow(n, v, L, 0, 0, L * 2.1);
  }
  return { pos: new Float32Array(pos), inten: new Float32Array(inten) };
}
