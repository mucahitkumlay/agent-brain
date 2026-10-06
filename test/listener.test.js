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
  // the generic event API for other agents
  const post = (path, body) => new Promise((res) => {
    const r = http.request({ host: '127.0.0.1', port: p.settings.port, method: 'POST', path, headers: { 'content-type': 'application/json' } }, (x) => { let b = ''; x.on('data', c => b += c); x.on('end', () => res({ code: x.statusCode, body: b })); });
    r.on('error', () => res({ code: 0, body: '' })); r.end(body);
  });
  const g = await post('/agent', JSON.stringify([{ agent: 'aider', session: 'x1', cwd: '/w/app', type: 'prompt', text: 'hi' }, { agent: 'aider', session: 'x1', type: 'tool', tool: 'Bash', id: 'g1', input: { command: 'ls' } }, { agent: 'aider', session: 'x1', type: 'result', tool: 'Bash', id: 'g1', output: 'a b' }, { agent: 'aider', session: 'x1', type: 'nonsense' }]));
  ok(g.code === 204 && !g.body, '/agent answers 204 with no body');
  ok(p.history.some(r => r.sid === 'aider:x1' && r.e === 'PreToolUse' && r.tool === 'Bash' && r.id === 'g1') && p.history.some(r => r.sid === 'aider:x1' && r.e === 'PostToolUse'), 'another agent\'s events become the same events Claude Code sends');
  ok(p.sessions.get('aider:x1').src === 'aider' && p.sessions.get('aider:x1').project === 'app', 'labelled by agent and project');
  ok(!p.history.some(r => r.sid === 'aider:x1' && /nonsense/.test(r.e)), 'unknown types are ignored');
  // coach mode: off by default, so a finding never goes back
  const risky = (id, command) => [JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'k', tool_name: 'Bash', tool_use_id: id, tool_input: { command } }), JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 'k', tool_name: 'Bash', tool_use_id: id, tool_input: { command }, tool_response: { stdout: 'ok' } })];
  let [a1, b1] = risky('k1', 'git reset --hard HEAD~3');
  await post('/event', a1); const off = await post('/event', b1);
  ok(off.code === 204 && !off.body, 'coach mode off: still 204, nothing goes back to the agent');
  p.settings.coach = true;
  [a1, b1] = risky('k2', 'git push --force origin main');
  await post('/event', a1); const on = await post('/event', b1);
  let j = null; try { j = JSON.parse(on.body); } catch (e) { /* */ }
  ok(on.code === 200 && j && j.hookSpecificOutput && j.hookSpecificOutput.hookEventName === 'PostToolUse' && /\[Agent Brain/.test(j.hookSpecificOutput.additionalContext) && /force/.test(j.hookSpecificOutput.additionalContext), 'coach mode on: the finding goes back as additionalContext');
  ok(j && !('decision' in j) && !('permissionDecision' in (j.hookSpecificOutput || {})), 'coach mode never carries a decision');
  const again = await post('/event', JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 'k', tool_name: 'Read', tool_use_id: 'k3', tool_input: {}, tool_response: {} }));
  ok(again.code === 204, 'a note is sent once');
  ok(p.hookCommand(true) !== p.hookCommand() && /-o \/dev\/null/.test(p.hookCommand()), 'only the coach hook prints the answer');
  p.stopServer();
}, 150);
