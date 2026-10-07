// where links run, and what neurons look like: geometry only
import { makeSurfaceIndex, makeEndIndex, routeLink, linkPoint, twigs, dendrites, LINK_SEGMENTS } from '../src/fibre.js';
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const strHash = (s) => { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };

// a brain-sized ball for a cortex: 60k vertices on a sphere of radius 70 (normals point out)
const NV = 60000, P = new Float32Array(NV * 3), Nn = new Float32Array(NV * 3);
for (let i = 0; i < NV; i++) { const u = (i + 0.5) / NV * 2 - 1, a = i * 2.399963, r = Math.sqrt(1 - u * u); const x = Math.cos(a) * r, y = u, z = Math.sin(a) * r; P.set([x * 70, y * 70, z * 70], i * 3); Nn.set([x, y, z], i * 3); }
const surface = makeSurfaceIndex(P, Nn);
const o = {}; ok(surface.nearest(0, 70.5, 0, o) && Math.abs(o.y - 70) < 1.5 && o.ny > 0.95, 'nearest surface point and which way is out');
ok(!makeSurfaceIndex(new Float32Array(0), null), 'no surface, no index');
// brute force agrees
let agree = 0; for (let i = 0; i < 40; i++) { const rr = 52 + (i * 7) % 24, th = i * 0.7, ph = i * 1.3, x = rr * Math.sin(th) * Math.cos(ph), y = rr * Math.cos(th), z = rr * Math.sin(th) * Math.sin(ph); surface.nearest(x, y, z, o); let b = -1, bd = Infinity; for (let v = 0; v < NV; v++) { const d = (P[v * 3] - x) ** 2 + (P[v * 3 + 1] - y) ** 2 + (P[v * 3 + 2] - z) ** 2; if (d < bd) { bd = d; b = v; } } if (Math.abs(o.x - P[b * 3]) + Math.abs(o.y - P[b * 3 + 1]) + Math.abs(o.z - P[b * 3 + 2]) < 1e-4) agree++; }
ok(agree === 40, 'the grid finds the same nearest vertex as brute force (' + agree + '/40)');

// a neuron sits 2-6 mm under the surface
const under = (i, depth) => { const v = (i * 7919) % NV; return { path: 'n' + i, x: P[v * 3] - Nn[v * 3] * depth, y: P[v * 3 + 1] - Nn[v * 3 + 1] * depth, z: P[v * 3 + 2] - Nn[v * 3 + 2] * depth, nx: Nn[v * 3], ny: Nn[v * 3 + 1], nz: Nn[v * 3 + 2] }; };
// a few real-looking bundles: arcs from one side of the ball to the other
const T = [], ends = [];
for (let i = 0; i < 400; i++) { const a = under(i * 13, 3), b = under(i * 13 + 5000, 3), pts = []; for (let k = 0; k <= 12; k++) { const t = k / 12; pts.push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t + 14 * Math.sin(Math.PI * t), a.z + (b.z - a.z) * t); } T.push({ pts: new Float32Array(pts) }); ends.push(pts[0], pts[1], pts[2], pts[36], pts[37], pts[38]); }
const E = new Float32Array(ends), endIdx = makeEndIndex(E);
let hit = 0; endIdx.near({ x: E[0], y: E[1], z: E[2] }, 5, (f) => { if (f === 0) hit++; }); ok(hit === 1, 'fibre ends are found near their own position');
const ctx = (seed) => ({ seed, surface, endIdx, ends: E, tracts: T, centre: { x: 0, y: -4, z: 2 } });

// short link: an association fibre, which dips under the surface and follows it
const a = under(1, 3), b = { ...under(1, 3) }; b.x += 18; { surface.nearest(b.x, b.y, b.z, o); b.x = o.x - o.nx * 3; b.y = o.y - o.ny * 3; b.z = o.z - o.nz * 3; }
const r1 = routeLink(a, b, ctx(11));
ok(r1.kind === 'u' && r1.pts.length === (LINK_SEGMENTS + 1) * 3, 'short link: an association fibre with ' + (LINK_SEGMENTS + 1) + ' points');
ok(dist({ x: r1.pts[0], y: r1.pts[1], z: r1.pts[2] }, a) < 1e-4 && dist({ x: r1.pts[LINK_SEGMENTS * 3], y: r1.pts[LINK_SEGMENTS * 3 + 1], z: r1.pts[LINK_SEGMENTS * 3 + 2] }, b) < 1e-4, 'it starts and ends exactly at its two neurons');
let inside = true, maxDepth = 0; const tmp = {}; for (let t = 0.05; t < 1; t += 0.05) { linkPoint(r1.pts, t, tmp); const rr = Math.hypot(tmp.x, tmp.y, tmp.z); if (rr > 70.5) inside = false; maxDepth = Math.max(maxDepth, 70 - rr); }
ok(inside && maxDepth > 2.5 && maxDepth < 16, 'it stays inside the cortex and dips into the white matter (deepest ' + maxDepth.toFixed(1) + ' mm)');
ok(r1.len > dist(a, b) * 1.02, 'and it is not a straight line (' + r1.len.toFixed(1) + ' mm for a chord of ' + dist(a, b).toFixed(1) + ')');

// long link whose two ends sit near the two ends of a bundle: it takes the bundle
const f0 = T[7], A = { x: f0.pts[0] * 0.97, y: f0.pts[1] * 0.97, z: f0.pts[2] * 0.97 }, B = { x: f0.pts[36] * 0.97, y: f0.pts[37] * 0.97, z: f0.pts[38] * 0.97 };
const r2 = routeLink(A, B, ctx(5));
ok(r2.kind === 'tract', 'long link between the ends of a bundle: takes the bundle');
let near = 0; for (let t = 0.2; t <= 0.8; t += 0.1) { linkPoint(r2.pts, t, tmp); let best = Infinity; for (let k = 0; k < 13; k++) best = Math.min(best, Math.hypot(tmp.x - f0.pts[k * 3], tmp.y - f0.pts[k * 3 + 1], tmp.z - f0.pts[k * 3 + 2])); if (best < 12) near++; }
ok(near >= 6, 'and runs along it (' + near + '/7 samples within 12 mm of the fibre)');
// same link, same route; the other direction is the same fibre
ok(JSON.stringify([...routeLink(A, B, ctx(5)).pts]) === JSON.stringify([...r2.pts]), 'always the same route for the same link');
// no fitting bundle: a free curve, and never a straight line
const C = under(900, 3), D = under(31000, 3), r3 = routeLink(C, D, { seed: 3, surface, centre: { x: 0, y: -4, z: 2 } });
ok(r3.kind === 'free' && r3.len > dist(C, D) * 1.03, 'no bundle fits: a free curve through the white matter, not a straight line');
// links to different places bend differently
const bends = new Set(); for (let s = 0; s < 12; s++) { const r = routeLink(C, D, { seed: s * 977, surface, centre: { x: 0, y: -4, z: 2 } }); linkPoint(r.pts, 0.5, tmp); bends.add(tmp.x.toFixed(0) + ',' + tmp.y.toFixed(0) + ',' + tmp.z.toFixed(0)); }
ok(bends.size >= 6, 'every link bends its own way (' + bends.size + ' different midpoints in 12)');
// a bundle that detours or runs the wrong way is not used
const wrong = [{ pts: new Float32Array([A.x, A.y, A.z, A.x + 150, A.y + 150, A.z, B.x, B.y, B.z]) }], we = new Float32Array([A.x, A.y, A.z, B.x, B.y, B.z]);
ok(routeLink(A, B, { seed: 1, surface, endIdx: makeEndIndex(we), ends: we, tracts: wrong, centre: { x: 0, y: 0, z: 0 } }).kind === 'free', 'a fibre that takes a huge detour is not used');
// degenerate input
const same = routeLink(A, A, ctx(1)); ok(same.pts.every(Number.isFinite) && same.len === 0, 'two neurons at the same spot: no NaN');
ok(routeLink(A, B, {}).pts.every(Number.isFinite) && routeLink({ x: 0, y: 0, z: 0 }, { x: 1e-9, y: 0, z: 0 }, ctx(2)).pts.every(Number.isFinite), 'no surface, no fibres, tiny distances: still finite');
ok(linkPoint(r1.pts, -1, tmp).x === r1.pts[0] && linkPoint(r1.pts, 2, tmp).x === r1.pts[LINK_SEGMENTS * 3], 'positions along a path are clamped to its ends');

// neurons and their terminals
const w = twigs(r2.pts, 4);
ok(w.seg.length >= 3 * 12 && w.tips.length >= 9 && w.seg.length % 6 === 0 && w.tips.length % 3 === 0 && [...w.seg, ...w.tips].every(Number.isFinite), 'terminal twigs: segments and boutons, all finite');
let farOk = true; for (let i = 0; i < w.tips.length; i += 3) if (dist({ x: w.tips[i], y: w.tips[i + 1], z: w.tips[i + 2] }, B) > 9) farOk = false;
ok(farOk, 'the boutons are at the receiving neuron, not along the axon');
const n0 = under(4, 3);
const full = dendrites(n0, 9, 100), few = dendrites(n0, 9, 30), tiny = dendrites(n0, 9, 10);
ok(full.pos.length / 6 > few.pos.length / 6 && few.pos.length / 6 > tiny.pos.length / 6 && tiny.pos.length > 0, 'more budget, more branches: ' + [full, few, tiny].map(x => x.pos.length / 6).join(' > '));
ok(full.pos.length / 6 <= 100 + 8 && full.inten.length === full.pos.length / 3 && full.inten.every(v => v > 0 && v <= 1), 'within its budget, one brightness per vertex');
ok(JSON.stringify([...dendrites(n0, 9, 100).pos.slice(0, 30)]) === JSON.stringify([...full.pos.slice(0, 30)]), 'the same neuron always grows the same tree');
let tip = 0, base = 0; { const first = full.inten[0], lastI = Math.min(...full.inten); tip = lastI; base = first; } ok(base > tip + 0.3, 'bright at the cell body, fading outwards');
// the apical dendrite points to the surface
let outward = 0; for (let k = 0; k < 20; k++) { const nn = under(100 + k, 3), d = dendrites(nn, 50 + k, 100); let best = 0; for (let i = 0; i < d.pos.length; i += 6) { const L = dist({ x: d.pos[i], y: d.pos[i + 1], z: d.pos[i + 2] }, nn); if (L > 0.1) continue; } const tipv = { x: d.pos[3] - nn.x, y: d.pos[4] - nn.y, z: d.pos[5] - nn.z }; if (tipv.x * nn.nx + tipv.y * nn.ny + tipv.z * nn.nz > 0) outward++; }
ok(outward >= 17, 'the first (apical) dendrite grows towards the surface (' + outward + '/20)');
ok(dendrites({ x: 0, y: 0, z: 0 }, 1, 50).pos.every(Number.isFinite), 'a neuron with no known surface direction: still a tree');

// big vault: 4000 neurons and 12000 links, in a fair time
const t0 = Date.now(); let routed = 0;
for (let i = 0; i < 12000; i++) { const x = under(i % 4000, 3), y = under((i * 31 + 7) % 4000, 3); if (x === y) continue; const r = routeLink(x, y, ctx(strHash(x.path + '>' + y.path))); twigs(r.pts, i); routed++; }
const t1 = Date.now(); for (let i = 0; i < 4000; i++) dendrites(under(i, 3), i, 37);
const t2 = Date.now();
ok(t1 - t0 < 4000 && t2 - t1 < 1500, `${routed} links routed in ${t1 - t0} ms, 4000 neurons grown in ${t2 - t1} ms`);
