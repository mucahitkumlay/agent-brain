// reality check: signs that what the agent believed and what was really there differ
global.window = { setTimeout: () => 0, setInterval, clearInterval, clearTimeout, Notification: null };
global.document = { hasFocus: () => true };
global.performance = performance;
const notices = [];
const Module = require('module'); const orig = Module._load;
class C { registerDomEvent() {} registerInterval() {} registerEvent() {} }
Module._load = function (r, ...a) {
  if (r === 'obsidian') return { Plugin: class extends C { constructor(app, m) { super(); this.app = app; this.manifest = m; } async loadData() { return null; } async saveData() {} registerView() {} addRibbonIcon() {} addCommand() {} addSettingTab() {} addStatusBarItem() { return { addClass() {}, setText() {}, toggleClass() {}, setAttr() {} }; } },
    ItemView: class {}, Notice: class { constructor(m) { notices.push(m); } }, PluginSettingTab: class {}, Setting: class {} };
  return orig.call(this, r, ...a);
};
const P = require('../dist/main.js');
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const app = { vault: { adapter: { basePath: '/v' }, getName: () => 'notes' }, workspace: { getLeavesOfType: () => [] } };
const p = new P(app, {});
p.settings = { learning: false, traceMinutes: 90, realityCheck: true, notifyReality: true, desktopNotify: false, callDetails: true };
p.sessions = new Map(); p.sessionSeq = 0; p.eventTimes = []; p.memory = { at: Date.now(), day: '', trace: Array(8).fill(0), today: Array(8).fill(0) };
p.statusBar = { setText() {}, toggleClass() {}, setAttr() {} };
p.history = []; p.vitals = new Map(); p.engram = { t0: Date.now(), a: {}, n: {}, f: {} }; p.sources = new Map(); p.learned = { neurons: {}, synapses: {} }; p.daily = null;
p.forEachView = () => {};
let n = 0;
const E = (o) => p.handleEvent(Object.assign({ session_id: 's1', cwd: '/w' }, o));
const call = (tool, input, post) => { const id = 't' + (++n); E({ hook_event_name: 'PreToolUse', tool_name: tool, tool_use_id: id, tool_input: input }); E(Object.assign({ tool_name: tool, tool_use_id: id, tool_input: input }, post)); };
const R = () => (p.sessions.get('s1').reality || []);
const last = () => R()[R().length - 1] || {};

E({ hook_event_name: 'UserPromptSubmit', prompt: 'fix it', prompt_id: 'p1' });
call('Read', { file_path: '/w/src/helpers.ts' }, { hook_event_name: 'PostToolUseFailure', error: 'File does not exist.' });
ok(last().kind === 'missing' && /helpers\.ts/.test(last().text), 'missing file: ' + last().text);
call('Edit', { file_path: '/w/a.ts', old_string: 'x', new_string: 'y' }, { hook_event_name: 'PostToolUseFailure', error: 'String to replace not found in file.' });
ok(last().kind === 'mismatch', 'edit of text that is not there: ' + last().text);
call('Bash', { command: 'fooctl status' }, { hook_event_name: 'PostToolUseFailure', error: 'bash: fooctl: command not found' });
ok(last().kind === 'nocommand' && /fooctl/.test(last().text), 'command that does not exist: ' + last().text);
call('Bash', { command: 'npm i left-padx' }, { hook_event_name: 'PostToolUseFailure', error: "npm error 404 Not Found - GET https://registry.npmjs.org/left-padx - Not found\nnpm error 404  'left-padx@*' is not in this registry." });
ok(last().kind === 'nopackage' && /left-padx/.test(last().text), 'package that does not exist: ' + last().text);
call('Bash', { command: 'node x.js' }, { hook_event_name: 'PostToolUseFailure', error: "Error: Cannot find module 'fastify-magic'" });
ok(last().kind === 'nomodule', 'module that does not exist: ' + last().text);
call('Grep', { pattern: 'retryWithJitter', path: '/w' }, { hook_event_name: 'PostToolUse', tool_response: { mode: 'files_with_matches', filenames: [], numFiles: 0 } });
call('Edit', { file_path: '/w/b.ts', old_string: 'a', new_string: 'return retryWithJitter(fn)' }, { hook_event_name: 'PostToolUse', tool_response: {} });
ok(last().kind === 'unfound' && /retryWithJitter/.test(last().text), 'uses what its search found nowhere: ' + last().text);
call('Bash', { command: 'npm test' }, { hook_event_name: 'PostToolUse', tool_response: { stdout: 'Tests: 2 failed, 40 passed', stderr: '' } });
const before = notices.length;
E({ hook_event_name: 'Stop', last_assistant_message: 'Done. All tests pass now.' });
ok(last().kind === 'contradicted' && /npm test/.test(last().text), 'claim against the last run: ' + last().text);
ok(notices.length > before, 'you are told');
ok(p.history.some(r => r.e === 'Doubt' && r.strikes && r.strikes[0].kind === 'doubt'), 'a doubt signal lights the brain');

// a clean turn: no findings
const k = R().length;
E({ hook_event_name: 'UserPromptSubmit', prompt: 'again', prompt_id: 'p2' });
call('Bash', { command: 'npm test' }, { hook_event_name: 'PostToolUse', tool_response: { stdout: 'Tests: 0 failed, 42 passed', stderr: '' } });
E({ hook_event_name: 'Stop', prompt_id: 'p2', last_assistant_message: 'All tests pass now.' });
ok(R().length === k, 'a claim the last run backs up raises nothing');
E({ hook_event_name: 'UserPromptSubmit', prompt: 'and?', prompt_id: 'p3' });
E({ hook_event_name: 'Stop', prompt_id: 'p3', last_assistant_message: 'The tests pass.' });
ok(last().kind === 'unproven', 'a claim with no run behind it: ' + last().text);
// a message that says the tests FAIL is not a claim that they pass (this used to be accused as "ran no tests")
E({ hook_event_name: 'UserPromptSubmit', prompt: 'status?', prompt_id: 'p3b' });
const k2 = R().length;
E({ hook_event_name: 'Stop', prompt_id: 'p3b', last_assistant_message: 'Tüm testler başarısız oldu, düzeltmem gerekiyor.' });
E({ hook_event_name: 'Stop', prompt_id: 'p3b', last_assistant_message: 'The tests are failing. I could not get the tests to pass.' });
ok(R().length === k2, 'a failure report raises nothing');
E({ hook_event_name: 'UserPromptSubmit', prompt: 'tr', prompt_id: 'p3c' });
call('Bash', { command: 'node test/run.mjs' }, { hook_event_name: 'PostToolUse', tool_response: { stdout: '3 failed, 40 passed', stderr: '' } });
E({ hook_event_name: 'Stop', prompt_id: 'p3c', last_assistant_message: 'Düzelttim. Testler artık geçiyor.' });
ok(last().kind === 'contradicted' && /node test\/run\.mjs/.test(last().text), 'a Turkish claim against a custom test command: ' + last().text);
p.settings.realityCheck = false;
E({ hook_event_name: 'UserPromptSubmit', prompt: 'x', prompt_id: 'p4' });
call('Read', { file_path: '/w/nope.ts' }, { hook_event_name: 'PostToolUseFailure', error: 'File does not exist.' });
ok(!/nope\.ts/.test(last().text), 'off: nothing');
