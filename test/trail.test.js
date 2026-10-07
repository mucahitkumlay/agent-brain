// where signals go: along the path the work really took, and nowhere at random
global.window = { setTimeout: () => 0, setInterval, clearInterval, clearTimeout, Notification: null };
global.document = { hasFocus: () => true };
const Module = require('module'); const orig = Module._load;
Module._load = function (r, ...a) {
  if (r === 'obsidian') return { Plugin: class {}, ItemView: class {}, Notice: class {}, PluginSettingTab: class {}, Setting: class {} };
  return orig.call(this, r, ...a);
};
const P = require('../dist/main.js');
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const V = P.BrainView.prototype;

const node = (path) => ({ path, name: path, lobe: 'frontal', adj: [], act: 0, deg: 0, hub: false, labelT: 0, x: 0, y: 0, z: 0 });
const A = node('a.md'), B = node('b.md'), C = node('c.md'), D = node('d.md'), E = node('e.md');
const link = (x, y, w) => { const l = { a: x, b: y, w, len: 40, pts: new Float32Array(78) }; x.adj.push({ n: y, l }); y.adj.push({ n: x, l }); return l; };
const lAB = link(A, B, 3), lAC = link(A, C, undefined), lAD = link(A, D, 0.1), lAE = link(A, E, 2);
const mk = () => {
  for (const n of [A, B, C, D, E]) n.act = 0;
  const v = { spikes: [], pulses: [], waves: [], pings: [], labeled: [], nodes: [A, B, C, D, E], byPath: new Map([A, B, C, D, E].map(n => [n.path, n])), _k: null, _src: null, frozen: false,
    learnedLinks: new Map([['n:a.md|n:b.md', lAB]]), plugin: { settings: {}, toVaultRel: (p) => typeof p === 'string' ? p : null, learnKey: () => null }, tractSpikes: [], flashed: [],
    pulse() { }, eegFeed() { }, innerAct() { }, requestHud() { }, wave() { }, attend() { } };
  for (const f of ['fire', 'spark', 'learnedTargets', 'lobeBurst', 'resolveTargets', 'ping', 'hubs']) v[f] = V[f];
  return v;
};
for (const n of [A, B, C, D, E]) n.act = 0;

// a note's glow spreads only along connections that work has really used, strongest first
{
  const v = mk(); v.fire(A, '#fff', 1, 0, null, '#0f0', null);
  const to = v.spikes.map(s => s.b.path).sort();
  ok(to.join() === 'b.md,e.md', 'the glow follows the used connections only (' + to.join(',') + ')');
  ok(v.spikes[0].b === B, 'strongest first');
  ok(!v.spikes.some(s => s.b === C || s.b === D), 'an unused link and a faded one carry nothing');
  const runs = new Set(); for (let i = 0; i < 20; i++) { const w = mk(); w.fire(A, '#fff', 1, 0); runs.add(w.spikes.map(s => s.b.path + ':' + s.speed).join()); }
  ok(runs.size === 1, 'same note, same signals every time: nothing random');
  const v3 = mk(); v3.fire(B, '#fff', 1, 0, null, '#0f0'); ok(v3.spikes.length === 1 && v3.spikes[0].b === A, 'and it can go back along the same connection');
  const v4 = mk(); v4.fire(C, '#fff', 1, 0); ok(v4.spikes.length === 0, 'a note with only unused links sends nothing');
}

// the trail: the file used before sends a signal to this one, and this one lights when it arrives
{
  const v = mk(), ev = { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'b.md' } };
  const out = v.learnedTargets(ev, { id: 's' }, { key: 'n:b.md', syn: { a: 'n:a.md', b: 'n:b.md', isNew: false } }, '#0f0');
  const sp = v.spikes[0];
  ok(v.spikes.length === 1 && sp.a === A && sp.b === B, 'the signal runs from the file used before (a) to this one (b)');
  ok(v._held === B && B.act === 0, 'this one is held back: it has not lit up yet');
  ok(sp.arrive && sp.arrive.str > 0.9 && sp.depth === 0, 'and the signal carries the full strength that lights it on arrival');
  ok(Array.isArray(out), 'targets still come back as a list');
  // the other way round: the key is the first of the pair
  const w = mk(); w.learnedTargets(ev, { id: 's' }, { key: 'n:a.md', syn: { a: 'n:a.md', b: 'n:b.md' } }, '#0f0');
  ok(w.spikes.length === 1 && w.spikes[0].a === B && w.spikes[0].b === A, 'direction follows the order of use, not the order of the names');
  // arrival
  const u = mk(); u.spikes.push(sp); sp.t = 0.99;
  u.plugin.settings = {}; u.focusSid = null;
  const fired = []; u.fire = function (n, hex, str, depth) { fired.push([n.path, str, depth]); }; u.ping = function (n) { fired.push(['ping', n.path]); };
  u.update = V.update; u.hubs = V.hubs; u.calm = () => true; u.attend = () => { }; u.eegFeed = () => { };
  try { u.update(0.5); } catch (e) { fired.push(['threw', String(e.message).slice(0, 60)]); }
  ok(fired.some(f => f[0] === 'b.md' && f[1] > 0.9 && f[2] === 0) && fired.some(f => f[0] === 'ping'), 'on arrival the note lights at full strength and is named (' + JSON.stringify(fired.slice(0, 3)) + ')');
  // no link between the two yet (a rebuild is pending): nothing is held, the note lights at once
  const x = mk(); x.learnedLinks = new Map(); x.learnedTargets(ev, { id: 's' }, { key: 'n:b.md', syn: { a: 'n:a.md', b: 'n:b.md' } }, '#0f0');
  ok(x.spikes.length === 0 && !x._held, 'no connection drawn yet: no held note, no signal');
  // the first file of a session has no "before"
  const y = mk(); y.learnedTargets(ev, { id: 's' }, { key: 'n:b.md', syn: null }, '#0f0'); ok(y.spikes.length === 0 && !y._held, 'the first file of a run: nothing to travel from');
}

// work that touches no note lights no note
{
  const v = mk(); v.regions = { frontalL: { x: 1, y: 2, z: 3 }, frontalR: { x: -1, y: 2, z: 3 } }; let pulses = 0; v.pulse = () => pulses++;
  v.lobeBurst('frontal', '#fff', 0.5, 3, '#0f0');
  ok(pulses === 2 && [A, B, C, D, E].every(n => n.act === 0) && v.spikes.length === 0, 'a region pulse, but no note and no spike at random');
}
// a folder search lights the same notes every time
{
  const v = mk(); const many = Array.from({ length: 20 }, (_, i) => node('dir/n' + i + '.md')); v.nodes = many;
  const pick = () => v.resolveTargets({ tool_input: { path: 'dir' } }).map(n => n.path).join();
  const first = pick(); let same = true; for (let i = 0; i < 10; i++) if (pick() !== first) same = false;
  ok(same && first.split(',').length === 5, 'a folder search lights the same five notes every time');
}
