// Smoke test: a whole session, subagents, a workflow, failures, approvals and a queued batch run through without errors.
const notices = [];
global.window = { setTimeout, setInterval, clearTimeout, Notification: null };
global.document = { hasFocus: () => true };
global.performance = performance;
const Module = require('module'); const orig = Module._load;
class C { registerDomEvent() {} registerInterval() {} registerEvent() {} }
Module._load = function (r, ...a) {
  if (r === 'obsidian') return { Plugin: class extends C { constructor(app, m) { super(); this.app = app; this.manifest = m; } async loadData() { return null; } async saveData() {} registerView() {} addRibbonIcon() {} addCommand() {} addSettingTab() {} addStatusBarItem() { return { addClass() {}, setText(t) { this.t = t; }, toggleClass() {}, setAttr() {} }; } },
    ItemView: class {}, Notice: class { constructor(m) { notices.push(m); } }, PluginSettingTab: class {}, Setting: class {} };
  return orig.call(this, r, ...a);
};
const Cls = require('../dist/main.js');
const app = { vault: { adapter: { basePath: 'C:\\v' } }, workspace: { getLeavesOfType: () => [] } };
(async () => {
  const p = new (Cls.default || Cls)(app, {});
  p.settings = { notifyApproval: true, notifyReply: true, desktopNotify: true };
  p.sessions = new Map(); p.sessionSeq = 0; p.eventTimes = []; p.memory = { at: Date.now(), day: '', trace: Array(8).fill(0), today: Array(8).fill(0) }; p.serverOk = true;
  p.statusBar = { setText(t) { this.t = t; }, toggleClass() {}, setAttr() {} };
  p.history = []; p.vitals = new Map(); p.engram = { t0: Date.now(), a: {}, n: {}, f: {} }; p.sources = new Map(); p.learned = { neurons: {}, synapses: {} }; p.daily = null; p.settings.learning = true;
  app.vault.getName = () => 'notes'; app.workspace.getLeavesOfType = () => [];
  const E = (o) => p.handleEvent(Object.assign({ session_id: 's1', cwd: '/root/proj' }, o));
  const s = () => p.sessions.get('s1');
  E({ hook_event_name: 'UserPromptSubmit' });
  E({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'x' } });
  E({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash' });
  console.log('after failure:', s().phase, s().inflight);
  E({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'Explore', description: 'look around' } });
  E({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'Explore' });
  E({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, agent_id: 'a1', agent_type: 'Explore' });
  E({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash', agent_id: 'a1', agent_type: 'Explore' });
  console.log('wait:', s().wait && s().wait.kind, s().wait && s().wait.agent, p.statusBar.t);
  E({ hook_event_name: 'PostToolUse', tool_name: 'Bash', agent_id: 'a1', agent_type: 'Explore' });
  console.log('after approve:', s().wait, s().phase, 'agent desc:', s().agents.get('a1').desc);
  E({ hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'Explore' });
  E({ hook_event_name: 'PostToolUse', tool_name: 'Agent' });
  E({ hook_event_name: 'PreToolUse', tool_name: 'Workflow', tool_input: { name: 'audit-routes' } });
  E({ hook_event_name: 'PostToolUse', tool_name: 'Workflow' });
  E({ hook_event_name: 'Stop' });
  for (let i = 0; i < 3; i++) E({ hook_event_name: 'SubagentStart', agent_id: 'w' + i, agent_type: 'general-purpose' });
  E({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/root/proj/a.ts' }, agent_id: 'w1', agent_type: 'general-purpose' });
  E({ hook_event_name: 'SubagentStop', agent_id: 'w0' });
  console.log('workflow:', JSON.stringify(s().workflow), 'running:', p.runningAgents(s()).length, 'wait:', s().wait && s().wait.kind, 'sb:', p.statusBar.t);
  E({ hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'Claude is waiting for your input' });
  E({ hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'Claude is waiting for your input' });
  E({ hook_event_name: 'PreToolUse', tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'in_progress', activeForm: 'Doing B' }, { content: 'C', status: 'pending' }] } });
  console.log('plan:', JSON.stringify(p.plan(s())));
  console.log('notices:', notices.length, notices.map(n => n.split('\n')[0]));
  console.log('label dup:', (() => { p.handleEvent({ session_id: 's2', cwd: '/x/proj', hook_event_name: 'SessionStart' }); return p.sessionLabel(p.sessions.get('s2')); })());
  console.log('memory today:', p.memory.today.join(' '));
  console.log('history:', p.history.length, 'sources:', JSON.stringify([...p.sources.values()]));
  console.log('learned:', Object.keys(p.learned.neurons), Object.keys(p.learned.synapses));
  console.log('daily:', JSON.stringify(p.daily.sessions.s1.tools), p.daily.sessions.s1.busyMs >= 0);
  p.handleBatch([Date.now()-60000 + '\t' + JSON.stringify({session_id:'q',hook_event_name:'UserPromptSubmit',cwd:'/r/x'}), 'garbage', Date.now()-30000 + '\t' + JSON.stringify({session_id:'q',hook_event_name:'Stop',cwd:'/r/x'})].join('\n'), 'server1');
  console.log('after batch:', p.sessions.get('q').state, notices.length, p.sources.get('server1').queued);
  process.exit(0);
})();
