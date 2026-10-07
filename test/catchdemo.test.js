// the "See it catch things" demo must really trigger all four watchers, or it would promise what it cannot show
const timers = [];
global.window = { setTimeout: (f, ms) => { timers.push([ms || 0, f]); return timers.length; }, setInterval, clearInterval, clearTimeout, Notification: null };
global.document = { hasFocus: () => true }; global.performance = performance;
const Module = require('module'); const orig = Module._load; const notices = [];
class C { registerDomEvent() {} registerInterval() {} registerEvent() {} }
Module._load = function (r, ...a) {
  if (r === 'obsidian') return { Plugin: class extends C { constructor(app, m) { super(); this.app = app; this.manifest = m; } async loadData() { return null; } async saveData() {} registerView() {} addRibbonIcon() {} addCommand() {} addSettingTab() {} addStatusBarItem() { return { addClass() {}, setText() {}, toggleClass() {}, setAttr() {} }; } },
    ItemView: class {}, Notice: class { constructor(m) { notices.push(m); } }, PluginSettingTab: class {}, Setting: class {} };
  return orig.call(this, r, ...a);
};
const Cls = require('../dist/main.js'); const P = Cls.default || Cls;
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
(async () => {
  const p = new P({ vault: { adapter: { basePath: '/v' }, getName: () => 'notes' }, workspace: { getLeavesOfType: () => [] } }, {});
  p.settings = { telemetry: true, vitals: true, learning: false, traceMinutes: 90, callDetails: true, notifyStuck: true, guard: true, shield: true, realityCheck: true };
  p.sessions = new Map(); p.sessionSeq = 0; p.eventTimes = []; p.memory = { at: Date.now(), day: '', trace: Array(8).fill(0), today: Array(8).fill(0) };
  p.statusBar = { setText() {}, toggleClass() {}, setAttr() {} };
  p.history = []; p.vitals = new Map(); p.engram = { t0: Date.now(), a: {}, n: {}, f: {} }; p.sources = new Map(); p.learned = { neurons: {}, synapses: {} }; p.daily = null; p.forEachView = () => {};
  p.activateView = async () => {};
  await p.runCatchDemo();
  for (const [, f] of timers.filter(t => t[0] < 100000).sort((a, b) => a[0] - b[0])) f();
  const s = [...p.sessions.values()].find(x => String(x.id).startsWith('demo-e-'));
  ok(!!s, 'demo session exists');
  const groups = new Set((s.reality || []).map(f => f.group || 'reality'));
  ok(groups.has('guard'), 'guard fires: ' + (s.reality || []).filter(f => f.group === 'guard').map(f => f.text.slice(0, 40)).join(' | '));
  ok(groups.has('shield'), 'shield fires');
  ok(groups.has('reality'), 'reality check fires: ' + (s.reality || []).filter(f => (f.group || 'reality') === 'reality').map(f => f.kind).join(','));
  ok(!!s.alarm, 'stuck alarm raised: ' + (s.alarm && s.alarm.text));
  ok(!JSON.stringify(p.history).includes('ghp_a1B2c3D4'), 'the made-up token is masked in what is kept');
  ok(notices.every(x => /\(demo\)/.test(x)), 'alerts in the demo are labelled as a demo (' + notices.length + ')');
})();
