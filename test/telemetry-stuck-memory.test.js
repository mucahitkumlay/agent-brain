// 0.8: telemetry (metabolism), stuck detection, region memory, telemetry env merge
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
  p.settings = { notifyApproval: true, notifyReply: true, notifyStuck: true, desktopNotify: true, learning: false, traceMinutes: 90, vitals: true, telemetry: true, port: 27182, speechHook: true, dailyNote: true };
  p.sessions = new Map(); p.sessionSeq = 0; p.eventTimes = []; p.memory = { at: Date.now(), day: '', trace: Array(8).fill(0), today: Array(8).fill(0) }; p.serverOk = true;
  p.statusBar = { setText(t) { this.t = t; }, toggleClass() {}, setAttr() {} };
  p.history = []; p.vitals = new Map(); p.metab = new Map(); p.regionMem = {}; p.engram = { t0: Date.now(), a: {}, n: {}, f: {} }; p.sources = new Map(); p.learned = { neurons: {}, synapses: {} }; p.daily = null;
  const views = []; const got = { metab: [], alarm: 0, err: 0 };
  p.forEachView = (fn) => views.forEach(fn);
  views.push({ onEngram() {}, onSpeech() {}, pushLog() {}, loadEngram() {}, requestHud() {}, onMetabolism: (s, m) => got.metab.push(m), onAlarm: () => got.alarm++, onApiError: () => got.err++ });
  const E = (o) => p.handleEvent(Object.assign({ session_id: 's1', cwd: '/root/proj' }, o));
  const s = () => p.sessions.get('s1');
  E({ hook_event_name: 'SessionStart' }); E({ hook_event_name: 'UserPromptSubmit' });

  // telemetry in OTLP/HTTP JSON, the way Claude Code sends it
  const rec = (name, attrs) => ({ timeUnixNano: String(Date.now()) + '000000', attributes: [{ key: 'event.name', value: { stringValue: 'claude_code.' + name } }, { key: 'session.id', value: { stringValue: 's1' } }].concat(Object.entries(attrs).map(([k, v]) => ({ key: k, value: typeof v === 'number' ? (Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v }) : { stringValue: v } }))) });
  p.handleOtelLogs({ resourceLogs: [{ resource: { attributes: [] }, scopeLogs: [{ logRecords: [
    rec('api_request', { model: 'claude-opus-5-5', input_tokens: 1200, output_tokens: 800, cache_read_tokens: 90000, cache_creation_tokens: 3000, cost_usd: 0.31, duration_ms: 9000 }),
    rec('api_request', { model: 'claude-opus-5-5', input_tokens: 300, output_tokens: 120, cache_read_tokens: 5000, cache_creation_tokens: 0, cost_usd: 0.02, duration_ms: 2000, 'agent.name': 'Explore' }),
    rec('tool_result', { tool_name: 'Read', success: 'true' }),
  ] }] }] }, 'local');
  const M = p.metab.get('s1');
  ok(M && M.calls === 2 && M.outTok === 920 && Math.abs(M.cost - 0.33) < 1e-9, 'metabolism: ' + JSON.stringify({ calls: M.calls, out: M.outTok, cost: M.cost }));
  ok(M.ctx === 94200, 'working memory from the main-thread call only: ' + M.ctx);
  ok(got.metab.length === 2 && got.metab[1].agent === 'Explore', 'views told, with the agent');
  ok(p.daily && p.daily.sessions.s1.calls === 2 && p.daily.sessions.s1.tokOut === 920, 'daily counts tokens');
  ok(Object.values(p.regionMem).some(L => L.some(x => x[1] === 'think')), 'thinking remembered in prefrontal cortex');
  ok(p.renderDailyNote(p.daily, '').includes('Model calls'), 'daily note shows model calls');

  // stuck: the same command failing three times
  for (let i = 0; i < 3; i++) {
    E({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'b' + i, tool_input: { command: 'npm  run build' } });
    E({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: 'b' + i, tool_input: { command: 'npm  run build' } });
  }
  ok(s().alarm && /npm failed 3 times/.test(s().alarm.text), 'loop alarm: ' + (s().alarm && s().alarm.text));
  ok(notices.filter(n => /may be stuck/.test(n)).length === 1, 'one alert');
  E({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'b9', tool_input: { command: 'npm  run build' } });
  E({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'b9', tool_input: { command: 'npm  run build' } });
  ok(!s().alarm, 'cleared when it finally works');
  // edit thrash
  for (let i = 0; i < 12; i++) E({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: 'e' + i, tool_input: { file_path: '/root/proj/src/a.ts' } });
  ok(s().alarm && /Edited a.ts 12 times/.test(s().alarm.text), 'edit alarm: ' + (s().alarm && s().alarm.text));
  E({ hook_event_name: 'UserPromptSubmit', prompt_id: 'p2' });
  ok(!s().alarm, 'new prompt clears');
  // re-running a command after edits is normal; the same command with nothing changed is not
  for (let i = 0; i < 4; i++) { E({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 't' + i, tool_input: { command: 'npm test' } }); E({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: 'te' + i, tool_input: { file_path: '/root/proj/src/f' + i + '.ts' } }); }
  ok(!s().alarm, 'test, edit, test, edit: no alarm');
  for (let i = 0; i < 4; i++) E({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'u' + i, tool_input: { command: 'npm test' } });
  ok(s().alarm && /without changing/.test(s().alarm.text), 'same command 4x unchanged: ' + (s().alarm && s().alarm.text));
  E({ hook_event_name: 'UserPromptSubmit', prompt_id: 'p3' });
  // a command that never ends
  E({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'long', tool_input: { command: 'sleep 9999' } });
  s().since = Date.now() - 21 * 60000;
  p.tickStuck();
  ok(s().alarm && /running for/.test(s().alarm.text), 'hang alarm: ' + (s().alarm && s().alarm.text));
  // api errors
  E({ hook_event_name: 'UserPromptSubmit', prompt_id: 'p4' });
  for (let i = 0; i < 3; i++) p.handleOtelLogs({ resourceLogs: [{ scopeLogs: [{ logRecords: [rec('api_error', { error: 'overloaded', status_code: '529' })] }] }] }, 'local');
  ok(s().alarm && /API errors/.test(s().alarm.text) && got.err === 3, 'api alarm: ' + (s().alarm && s().alarm.text));

  // region memory: short labels, never command lines
  const all = JSON.stringify(p.regionMem);
  ok(!all.includes('run build') && all.includes('"npm"'), 'only program names kept');
  ok(all.includes('a.ts'), 'file names kept');
  await p.saveAll();
  ok(global.saved.regions && Object.keys(global.saved.regions).length > 3, 'region memory saved');

  // telemetry env for ~/.claude/settings.json
  const cfg = {};
  // the merge is internal; drive it through the installer's config object the same way
  const tm = require('fs').readFileSync(require('path').join(__dirname, '../dist/main.js'), 'utf8').includes('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT');
  ok(tm, 'telemetry env present in the bundle');
  console.log('notices', notices.length);
})();
