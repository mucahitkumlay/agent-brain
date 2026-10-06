// the listener: only this machine's Claude Code, scripts and tunnel; anything a web page could send is refused
global.window = { setTimeout: (f) => 0, setInterval, clearInterval, clearTimeout, Notification: null };
global.document = { hasFocus: () => true };
global.performance = performance;
const http = require('http');
const Module = require('module'); const orig = Module._load;
const notices = [];
class C { registerDomEvent() {} registerInterval() {} registerEvent() {} }
Module._load = function (r, ...a) {
  if (r === 'obsidian') return { Plugin: class extends C { constructor(app, m) { super(); this.app = app; this.manifest = m; } async loadData() { return null; } async saveData() {} registerView() {} addRibbonIcon() {} addCommand() {} addSettingTab() {} addStatusBarItem() { return { addClass() {}, setText() {}, toggleClass() {}, setAttr() {} }; } },
    ItemView: class {}, Notice: class { constructor(m) { notices.push(m); } }, PluginSettingTab: class {}, Setting: class {} };
  return orig.call(this, r, ...a);
};
const Cls = require('../dist/main.js');
const P = Cls.default || Cls;
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const f = P.fromThisMachine;
ok(f({ host: '127.0.0.1:27182', 'content-type': 'application/json' }), 'Claude Code hook (http) accepted');
ok(f({ host: '127.0.0.1:27182', 'sec-fetch-mode': 'cors', 'user-agent': 'node' }), 'Node fetch (sec-fetch-mode only) accepted');
ok(f({ host: 'localhost:27182' }) && f({ host: '[::1]:27182' }) && f({}), 'localhost names accepted');
ok(!f({ host: '127.0.0.1:27182', origin: 'https://evil.example' }), 'cross-origin page refused');
ok(!f({ host: '127.0.0.1:27182', 'sec-fetch-site': 'cross-site' }), 'browser fetch refused');
ok(!f({ host: '127.0.0.1:27182', 'sec-fetch-site': 'none', 'sec-fetch-dest': 'document' }), 'browser navigation refused');
ok(!f({ host: 'rebind.evil.example:27182' }), 'DNS rebinding (foreign Host) refused');
ok(f({ host: '127.0.0.1:27182', origin: 'null' }), 'origin "null" without browser headers accepted');

// end to end on a real socket
const app = { vault: { adapter: { basePath: '/v' }, getName: () => 'notes' }, workspace: { getLeavesOfType: () => [] } };
const p = new P(app, {});
p.settings = { port: 0, telemetry: true, vitals: true, learning: false, traceMinutes: 90, callDetails: true };
p.sessions = new Map(); p.sessionSeq = 0; p.eventTimes = []; p.memory = { at: Date.now(), day: '', trace: Array(8).fill(0), today: Array(8).fill(0) };
p.statusBar = { setText() {}, toggleClass() {}, setAttr() {} };
p.history = []; p.vitals = new Map(); p.engram = { t0: Date.now(), a: {}, n: {}, f: {} }; p.sources = new Map(); p.learned = { neurons: {}, synapses: {} }; p.daily = null;
p.forEachView = () => {};
p.settings.port = 27000 + Math.floor(Math.random() * 900);
p.startServer();
const send = (headers, body) => new Promise((res) => {
  const r = http.request({ host: '127.0.0.1', port: p.settings.port, method: 'POST', path: '/event', headers: Object.assign({ 'content-type': 'application/json' }, headers) }, (x) => { x.resume(); x.on('end', () => res(x.statusCode)); });
  r.on('error', () => res(0)); r.end(body);
});
setTimeout(async () => {
  const ev = (id) => JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Bash', tool_use_id: id, tool_input: { command: 'ls' } });
  ok(await send({}, ev('a')) === 204, 'hook event: 204, no body (the listener can never steer Claude Code)');
  ok(p.history.some(r => r.id === 'a'), 'hook event recorded');
  ok(await send({ origin: 'https://evil.example' }, ev('b')) === 403 && !p.history.some(r => r.id === 'b'), 'web page event refused and not recorded');
  ok(await send({ host: 'evil.example:80' }, ev('c')) === 403 && !p.history.some(r => r.id === 'c'), 'rebinding event refused');
  ok(notices.some(n => /refused/.test(n)), 'you are told once when something is refused');
  p.stopServer();
}, 150);
