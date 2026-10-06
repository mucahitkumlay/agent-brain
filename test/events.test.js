// new in 0.7: every hook event, strikes and the engram, speech, dedupe, vitals, hook config
const notices = [];
global.window = { setTimeout: (f) => 0, setInterval, clearInterval, clearTimeout, Notification: null };
global.document = { hasFocus: () => true };
global.performance = performance;
const Module = require('module'); const orig = Module._load;
class C { registerDomEvent() {} registerInterval() {} registerEvent() {} }
Module._load = function (r, ...a) {
  if (r === 'obsidian') return { Plugin: class extends C { constructor(app, m) { super(); this.app = app; this.manifest = m; } async loadData() { return null; } async saveData(d) { global.saved = d; } registerView() {} addRibbonIcon() {} addCommand() {} addSettingTab() {} addStatusBarItem() { return { addClass() {}, setText(t) { this.t = t; }, toggleClass() {}, setAttr() {} }; } },
    ItemView: class {}, Notice: class { constructor(m) { notices.push(m); } }, PluginSettingTab: class {}, Setting: class {} };
  return orig.call(this, r, ...a);
};
const Cls = require('../dist/main.js');
const app = { vault: { adapter: { basePath: '/v' }, getName: () => 'notes' }, workspace: { getLeavesOfType: () => [] } };
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
(async () => {
  const p = new (Cls.default || Cls)(app, {});
  p.settings = { notifyApproval: true, notifyReply: true, desktopNotify: true, learning: false, traceMinutes: 90, vitals: true, port: 27182, speechHook: true };
  p.sessions = new Map(); p.sessionSeq = 0; p.eventTimes = []; p.memory = { at: Date.now(), day: '', trace: Array(8).fill(0), today: Array(8).fill(0) }; p.serverOk = true;
  p.statusBar = { setText(t) { this.t = t; }, toggleClass() {}, setAttr() {} };
  p.history = []; p.vitals = new Map(); p.engram = { t0: Date.now(), a: {}, n: {}, f: {} }; p.sources = new Map(); p.learned = { neurons: {}, synapses: {} }; p.daily = null;
  const views = [];
  p.forEachView = (fn) => views.forEach(fn);
  const calls = { strike: 0, speech: 0, eng: 0 };
  views.push({ onEngram: (st) => { calls.eng += st.length; }, onSpeech: () => calls.speech++, pushLog: () => {}, loadEngram() {} });
  const E = (o) => p.handleEvent(Object.assign({ session_id: 's1', cwd: '/root/proj' }, o));
  const s = () => p.sessions.get('s1');

  E({ hook_event_name: 'SessionStart' });
  E({ hook_event_name: 'InstructionsLoaded', file_path: '/root/proj/CLAUDE.md', load_reason: 'session_start' });
  E({ hook_event_name: 'UserPromptSubmit' });
  ok(s().phase === 'thinking', 'prompt -> thinking');
  E({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'git pull && npm ci && npm test | tee out.log' } });
  const pre = p.history[p.history.length - 1];
  ok(pre.parts && pre.parts.length >= 3, 'pipeline parts: ' + JSON.stringify(pre.parts));
  ok(pre.strikes.length === pre.parts.length, 'one strike per command: ' + pre.strikes.map(x => x.kind).join(','));
  E({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'git pull && npm ci && npm test | tee out.log' } });
  ok(p.history.length === 4 + 0 && p.history.filter(r => r.e === 'PreToolUse').length === 1, 'duplicate event dropped');
  E({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'git pull' }, tool_response: { stdout: 'x'.repeat(5000) } });
  const post = p.history[p.history.length - 1];
  ok(post.strikes === pre.strikes, 'post reuses the pre strikes (result travels back)');
  ok(post.size === 5000, 'response size ' + post.size);
  ok(s().phase === 'thinking', 'post -> thinking');
  E({ hook_event_name: 'PostToolBatch', tool_calls: [{ tool_name: 'Read' }, { tool_name: 'Grep' }] });
  ok(p.history[p.history.length - 1].text === '2 results together', 'batch text');

  // permission: request + notification = one wait, one alert
  const n0 = notices.length;
  E({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_use_id: 't2', tool_input: { command: 'rm -rf build' } });
  ok(s().wait && s().wait.kind === 'approval', 'permission request -> waiting');
  E({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  ok(notices.length - n0 === 1, 'one alert for request+notification (' + (notices.length - n0) + ')');
  E({ hook_event_name: 'PermissionDenied', tool_name: 'Bash', tool_use_id: 't2' });
  ok(!s().wait && /denied/.test(s().state), 'denied -> ' + s().state);
  const den = p.history[p.history.length - 1];
  ok(den.strikes[0].kind === 'alarm' && den.pre && den.pre.length, 'denied: alarm strike + pre');

  // speech
  E({ hook_event_name: 'MessageDisplay', display_content: 'Hello there, ', is_final_chunk: false });
  E({ hook_event_name: 'MessageDisplay', display_content: 'this is the answer.', is_final_chunk: true });
  const msg = p.history[p.history.length - 1];
  ok(msg.e === 'Message' && msg.n === 32, 'message record ' + msg.e + ' ' + msg.n);
  ok(calls.speech === 2, 'views got speech ' + calls.speech);
  ok(!JSON.stringify(p.history).includes('Hello there'), 'reply text never stored');
  ok(s().state === 'writing', 'state writing');

  // tasks, compaction, failure
  E({ hook_event_name: 'TaskCreated', task_name: 'Fix it', tool_use_id: 't3' });
  E({ hook_event_name: 'TaskCompleted', task_name: 'Fix it', tool_use_id: 't4' });
  ok(p.history[p.history.length - 1].strikes[0].hex === '#ffd27a', 'task completed is gold');
  E({ hook_event_name: 'PreCompact' }); ok(s().phase === 'compacting' && p.isLive(s()), 'compacting is live');
  E({ hook_event_name: 'PostCompact', tokens_before: 150000, tokens_after: 30000 }); ok(s().phase === 'thinking', 'post compact -> thinking');
  E({ hook_event_name: 'StopFailure', error_type: 'rate_limit', error_message: 'Rate limit' });
  ok(/rate limit/.test(s().state) && s().wait && s().wait.kind === 'input', 'stop failure -> ' + s().state);

  // engram
  const A = Object.keys(p.engram.a).length, N = Object.keys(p.engram.n);
  ok(A >= 6, 'engram gyri: ' + A);
  ok(N.includes('Hippocampus') && N.includes('Amygdala'), 'engram nuclei: ' + N.join(','));
  ok(calls.eng > 8, 'views told about engram ' + calls.eng);
  const labelA = p.labelFor('read', '/root/proj/a.ts'), labelB = p.labelFor('read', '/root/proj/a.ts');
  ok(labelA === labelB, 'same target, same gyrus');
  // rebase keeps the visible value
  const k1 = p.engK(), v1 = p.engram.a[Object.keys(p.engram.a)[0]][0] * k1;
  p.engram.t0 -= 3600000; p.engRebase(true);
  const v2 = p.engram.a[Object.keys(p.engram.a)[0]][0] * p.engK();
  ok(Math.abs(v2 - v1 * Math.exp(-3600000 / p.engTau())) < 1e-6, 'rebase keeps value (decayed by 1h) ' + v1.toFixed(4) + ' -> ' + v2.toFixed(4));
  await p.saveAll();
  ok(global.saved.engram && Object.keys(global.saved.engram.a).length >= 6, 'engram saved');

  // vitals
  p.noteVitals('server1', { cpu: 0.4, mem: 0.6, rx: 50000, tx: 1000 });
  p.noteVitals('local', { cpu: 0.1, mem: 0.5 });
  ok(p.vitalsNow().name === 'server1', 'busiest machine drives the brain stem');
  p.sessions.get('s1').src = 'local'; p.sessions.get('s1').busy = true; p.sessions.get('s1').phase = 'thinking'; p.sessions.get('s1').wait = null;
  ok(p.vitalsNow().name === 'local', 'machine with a working session wins');

  // hooks
  const hc = p.hooksConfig();
  ok(hc.MessageDisplay[0].hooks[0].type === 'http' && hc.PermissionRequest[0].matcher === '*' && !hc.WorktreeCreate, 'hook config: ' + Object.keys(hc).length + ' events');
  console.log('notices', notices.length);
})();
