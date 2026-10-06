// Install writes the hooks into Claude Code's settings (with a backup), keeps your own hooks, and tidies this vault's copy through Obsidian's file API
global.window = { setTimeout: () => 0, setInterval, clearInterval, clearTimeout, Notification: null };
global.document = { hasFocus: () => true };
global.performance = performance;
const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-install-'));
process.env.CLAUDE_CONFIG_DIR = path.join(dir, 'cfg');
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
(async () => {
  const mem = new Map();   // the vault's own files, as Obsidian's adapter sees them
  const ours = JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:27182/event' }] }] }, permissions: { allow: ['Bash(ls)'] } });
  mem.set('.claude/settings.local.json', ours);
  const adapter = { exists: async (f) => mem.has(f), read: async (f) => mem.get(f), write: async (f, t) => { mem.set(f, t); } };
  const p = new P({ vault: { adapter, getName: () => 'v' }, workspace: { getLeavesOfType: () => [] } }, {});
  p.settings = { port: 27182, telemetry: true }; p.sources = new Map();
  const file = path.join(dir, 'cfg', 'settings.json');
  const mine = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] }, model: 'x' };
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(mine));
  const st = p.setupStatus();
  ok(st.file === file && st.hooks === false, 'the setup check looks at the settings file in the configured folder, and sees no hooks yet');
  await p.installLocalHooks();
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  ok(Object.keys(cfg.hooks).length >= 10 && cfg.hooks.Stop.some(g => g.hooks.some(h => h.command === 'echo mine')) && cfg.model === 'x', 'our hooks are in, yours and your other settings are kept');
  ok(JSON.parse(fs.readFileSync(file + '.agent-brain.bak', 'utf8')).model === 'x' && !JSON.stringify(JSON.parse(fs.readFileSync(file + '.agent-brain.bak', 'utf8'))).includes('27182'), 'a backup of the old file sits next to it');
  const local = JSON.parse(mem.get('.claude/settings.local.json'));
  ok(!local.hooks && local.permissions.allow[0] === 'Bash(ls)' && mem.has('.claude/settings.local.json.agent-brain.bak'), 'the older copy in this vault\'s .claude settings is taken out through the vault adapter, with a backup');
  ok(p.setupStatus().hooks === true && p.setupStatus().hookEvents >= 10, 'the setup check now sees them');
  await p.installLocalHooks();
  const again = JSON.parse(fs.readFileSync(file, 'utf8'));
  ok(JSON.stringify(again.hooks.Stop) === JSON.stringify(cfg.hooks.Stop) && again.hooks.PreToolUse.length === cfg.hooks.PreToolUse.length, 'installing twice does not duplicate anything');
  fs.writeFileSync(file, '{ broken');
  const before = fs.readFileSync(file, 'utf8');
  await p.installLocalHooks();
  ok(fs.readFileSync(file, 'utf8') === before && notices.some(m => /could not read/.test(m)), 'a settings file that cannot be parsed is left alone');
  fs.rmSync(dir, { recursive: true, force: true });
})();
