// new in 0.9: full call details for the inspector (memory only), agent lineage, what Claude said before a call
global.window = { setTimeout: (f) => 0, setInterval, clearInterval, clearTimeout, Notification: null };
global.document = { hasFocus: () => true };
global.performance = performance;
const Module = require('module'); const orig = Module._load;
class C { registerDomEvent() {} registerInterval() {} registerEvent() {} }
Module._load = function (r, ...a) {
  if (r === 'obsidian') return { Plugin: class extends C { constructor(app, m) { super(); this.app = app; this.manifest = m; } async loadData() { return null; } async saveData(d) { global.saved = d; } registerView() {} addRibbonIcon() {} addCommand() {} addSettingTab() {} addStatusBarItem() { return { addClass() {}, setText(t) { this.t = t; }, toggleClass() {}, setAttr() {} }; } },
    ItemView: class {}, Notice: class {}, PluginSettingTab: class {}, Setting: class {} };
  return orig.call(this, r, ...a);
};
const Cls = require('../dist/main.js');
const app = { vault: { adapter: { basePath: '/v' }, getName: () => 'notes' }, workspace: { getLeavesOfType: () => [] } };
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
(async () => {
  const p = new (Cls.default || Cls)(app, {});
  p.settings = { learning: false, traceMinutes: 90, port: 27182, speechHook: true, callDetails: true };
  p.sessions = new Map(); p.sessionSeq = 0; p.eventTimes = []; p.memory = { at: Date.now(), day: '', trace: Array(8).fill(0), today: Array(8).fill(0) }; p.serverOk = true;
  p.statusBar = { setText() {}, toggleClass() {}, setAttr() {} };
  p.history = []; p.vitals = new Map(); p.engram = { t0: Date.now(), a: {}, n: {}, f: {} }; p.sources = new Map(); p.learned = { neurons: {}, synapses: {} }; p.daily = null;
  p.forEachView = () => {};
  const E = (o) => p.handleEvent(Object.assign({ session_id: 's1', cwd: '/home/dev/app', permission_mode: 'default' }, o));
  const last = (e) => { for (let i = p.history.length - 1; i >= 0; i--) if (!e || p.history[i].e === e) return p.history[i]; return null; };

  E({ hook_event_name: 'UserPromptSubmit', prompt: 'Find out why the build fails and fix it' });
  ok(p.detailOf(last('UserPromptSubmit')).ev.prompt === 'Find out why the build fails and fix it', 'prompt text kept for the inspector');
  E({ hook_event_name: 'MessageDisplay', display_content: 'Let me look at the build log ', is_final_chunk: false });
  E({ hook_event_name: 'MessageDisplay', display_content: 'first.', is_final_chunk: true });
  ok(p.detailOf(last('Message')).ev.text === 'Let me look at the build log first.', 'reply text kept on the Message record');
  const cmd = 'cd /srv/app && npm run build 2>&1 | tee build.log && ssh -p 2222 deploy@build.example.com "tail -n 50 /var/log/ci.log" && curl -s https://ci.example.com/api/status > status.json';
  E({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: cmd, description: 'Run the build and fetch the CI log', timeout: 120000 } });
  const pre = last('PreToolUse'), dp = p.detailOf(pre);
  ok(dp && dp.ev.tool_input.command === cmd, 'full command line kept');
  ok(dp.ev.tool_input.timeout === 120000 && dp.ev.tool_input.description, 'every parameter kept');
  ok(dp.said === 'Let me look at the build log first.', 'what Claude said before the call: ' + dp.said);
  ok(dp.mode === 'default', 'permission mode');
  E({ hook_event_name: 'PreToolUse', tool_name: 'Glob', tool_use_id: 'g0', tool_input: { pattern: '**/*.log' } });
  ok(p.detailOf(last('PreToolUse')).said === dp.said, 'calls made together share the words');
  E({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: cmd }, tool_response: { stdout: 'ok\n'.repeat(20000), stderr: 'warn', interrupted: false } });
  const post = last('PostToolUse'), dq = p.detailOf(post);
  E({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'r1', tool_input: { file_path: '/srv/app/build.log' } });
  ok(!p.detailOf(last('PreToolUse')).said, 'a later call without new words gets none');
  E({ hook_event_name: 'MessageDisplay', display_content: 'The log shows a type error.', is_final_chunk: true });
  E({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'r1b', tool_input: { file_path: '/srv/app/src/index.ts' } });
  ok(p.detailOf(last('PreToolUse')).said === 'The log shows a type error.', 'new words start fresh: ' + p.detailOf(last('PreToolUse')).said);
  ok(dq && /more characters not kept/.test(dq.ev.tool_response.stdout) && dq.ev.tool_response.stdout.length < 21000, 'long output capped');
  ok(dq.ev.tool_response.stderr === 'warn', 'stderr kept');

  // subagents: lineage and the task they were given
  E({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'a1', tool_input: { subagent_type: 'Explore', description: 'Find the CI config', prompt: 'Look through the repo for the CI configuration and report which job runs the build.' } });
  E({ hook_event_name: 'SubagentStart', agent_id: 'ag1', agent_type: 'Explore' });
  E({ hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_use_id: 'g1', agent_id: 'ag1', agent_type: 'Explore', tool_input: { pattern: 'npm run build', path: '/srv/app/.ci' } });
  const sub = last('PreToolUse'), ds = p.detailOf(sub);
  ok(ds.agent && ds.agent.type === 'Explore' && ds.agent.spawn === 'a1', 'subagent call knows the Agent call that started it: ' + JSON.stringify(ds.agent));
  ok(!ds.said, 'subagent calls do not take the main thread\'s words');
  // a subagent starting its own agent
  E({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'a2', agent_id: 'ag1', agent_type: 'Explore', tool_input: { subagent_type: 'general-purpose', description: 'Read the workflow', prompt: 'Read .ci/build.yml' } });
  E({ hook_event_name: 'SubagentStart', agent_id: 'ag2', agent_type: 'general-purpose' });
  E({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'r2', agent_id: 'ag2', agent_type: 'general-purpose', tool_input: { file_path: '/srv/app/.ci/build.yml' } });
  const d2 = p.detailOf(last('PreToolUse'));
  ok(d2.agent.spawn === 'a2' && d2.agent.parent === 'ag1', 'nested agent: spawned by a2, parent ag1');
  E({ hook_event_name: 'SubagentStop', agent_id: 'ag2', agent_type: 'general-purpose', last_assistant_message: 'The build job is "test-and-build".' });
  ok(p.detailOf(last('SubagentStop')).ev.last_assistant_message === 'The build job is "test-and-build".', 'agent\'s final report kept');

  // plan step
  E({ hook_event_name: 'PreToolUse', tool_name: 'TodoWrite', tool_use_id: 't1', tool_input: { todos: [{ content: 'Fix the build', activeForm: 'Fixing the build', status: 'in_progress' }] } });
  E({ hook_event_name: 'PostToolUse', tool_name: 'TodoWrite', tool_use_id: 't1', tool_input: {}, tool_response: {} });
  E({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: 'e1', tool_input: { file_path: '/srv/app/package.json', old_string: '"build": "tsc"', new_string: '"build": "tsc -p ."' } });
  ok(p.detailOf(last('PreToolUse')).step === 'Fixing the build', 'plan step at the time of the call');

  // memory only: nothing of it reaches the saved data
  await p.saveAll();
  const saved = JSON.stringify(global.saved || {});
  ok(!/build\.example\.com|Find out why the build fails|tee build\.log/.test(saved), 'details never written to data.json');

  // off: nothing kept, and clearing forgets everything
  p.clearDetails();
  ok(!p.detailOf(pre), 'clearDetails forgets');
  p.settings.callDetails = false;
  E({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'b9', tool_input: { command: 'ls' } });
  ok(!p.detailOf(last('PreToolUse')), 'turned off: not kept');
  p.settings.callDetails = true;

  // budget: big payloads push the oldest out
  const big = 'y'.repeat(30000);
  for (let i = 0; i < 300; i++) E({ hook_event_name: 'PreToolUse', tool_name: 'MultiEdit', tool_use_id: 'w' + i, tool_input: { file_path: '/tmp/f' + i, a: big, b: big, c: big, d: big, e: big, f: big } });
  ok(p.detailN <= 24e6 + 200000, 'memory budget held: ' + p.detailN);
  const first = p.history.find(r => r.id === 'w0');
  ok(!p.detailOf(first) && p.detailOf(last('PreToolUse')), 'oldest dropped, newest kept');
})();
