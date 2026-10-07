// per-session notes and spending limits
global.window = { setTimeout: () => 0, setInterval, clearInterval, clearTimeout, Notification: null };
global.document = { hasFocus: () => true };
const Module = require('module'); const orig = Module._load;
class Notice { constructor(m) { Notice.log.push(m); } } Notice.log = [];
Module._load = function (r, ...a) {
  if (r === 'obsidian') return { Plugin: class {}, ItemView: class {}, Notice, PluginSettingTab: class {}, Setting: class {} };
  return orig.call(this, r, ...a);
};
const P = require('../dist/main.js');
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };

// ---- pure helpers (through a tiny module built from the same source)
const esbuild = require('esbuild');
const I = (() => { const out = esbuild.buildSync({ entryPoints: ['src/insight.js'], bundle: true, format: 'cjs', write: false }); const m = { exports: {} }; new Function('module', 'exports', out.outputFiles[0].text)(m, m.exports); return m.exports; })();
ok(I.budgetHits({ session: 5, day: 5 }, { session: 0, day: 0 }, {}).length === 0, 'limits off: nothing');
ok(I.budgetHits({ session: 2.99, day: 0 }, { session: 3 }, {}).length === 0, 'under the limit: nothing');
const h = I.budgetHits({ session: 3, day: 10 }, { session: 3, day: 8 }, {});
ok(h.length === 2 && h[0].kind === 'session' && h[1].kind === 'day' && /\$3\.00/.test(h[0].text) && /limit is \$8\.00/.test(h[1].text), 'both passed: both named: ' + JSON.stringify(h.map(x => x.text)));
ok(I.budgetHits({ session: 3, day: 10 }, { session: 3, day: 8 }, { session: true }).length === 1, 'already announced: not again');
ok(I.budgetHits({ session: NaN, day: 'x' }, { session: 3, day: 3 }, {}).length === 0, 'garbage costs: nothing, no crash');
ok(I.budgetHits({ session: 9 }, { session: -1 }, {}).length === 0 && I.budgetHits({ session: 9 }, { session: 'abc' }, {}).length === 0, 'garbage limits: off');
for (const [raw, want] of [['shop/api', 'shop api'], ['..\\..\\evil', 'evil'], ['a:b*c?"d"<e>|f', 'a b c d e f'], ['[[x]] #tag ^id', 'x tag id'], ['', 'session'], [null, 'session'], ['   ', 'session'], ['x'.repeat(200), 'x'.repeat(60)], ['.hidden', 'hidden']])
  ok(I.noteName(raw) === want, `noteName(${JSON.stringify(raw).slice(0, 30)}) = ${JSON.stringify(want).slice(0, 30)}`);
ok(!/[\/\\:*?"<>|#^\[\]]/.test(I.noteName('a/b\\c:d#e^f[g]h')), 'no path or link characters survive');

// ---- the plugin side, on a stub vault
const files = new Map(), folders = new Set(); let opened = null;
const vault = {
  getAbstractFileByPath: (p) => files.has(p) ? { path: p } : folders.has(p) ? { path: p } : p === 'Notes/real.md' ? { path: p } : null,
  // createFolder fails when the folder exists, like Obsidian
  createFolder: async (p) => { await new Promise(r => setTimeout(r, 5)); if (folders.has(p)) throw new Error('Folder already exists.'); folders.add(p); }, create: async (p, t) => { files.set(p, t); },
  read: async (f) => files.get(f.path), modify: async (f, t) => { files.set(f.path, t); },
};
const mk = () => {
  const p = Object.create(P.prototype);
  p.app = { vault, workspace: { openLinkText: async (path) => { opened = path; }, getLeavesOfType: () => [] } };
  p.settings = { dailyFolder: 'Claude Activity', sessionNote: true, dailyNote: true, budgetSession: 0, budgetDay: 0, desktopNotify: false };
  p.sessions = new Map(); p.metab = new Map(); p.history = [];
  p.isDemo = () => false; p.sessionLabel = (s) => s.project || 'x';
  return p;
};
const x = () => ({ label: 'shop/api', src: 'local', first: Date.parse('2026-10-07T09:00:00'), last: Date.parse('2026-10-07T10:30:00'), prompts: 4, tools: { read: 5, shell: 3 }, agents: 1, workflows: 0, tasksDone: 2, failures: 1, busyMs: 600000,
  files: { 'Notes/real.md': 3, 'src/app.js': 2, 'Notes/gone.md': 1, 'we`ird.js': 1 }, calls: 7, tokIn: 12000, tokOut: 3400, cost: 1.234 });
(async () => {
  const p = mk(); p.daily = { day: '2026-10-07', sessions: { 'abcdef123456': x() } };
  const path = await p.writeSessionNote('abcdef123456', true);
  ok(/^Claude Activity\/Sessions\/2026-10-07 shop api [0-9a-z]{6}\.md$/.test(path), 'path has the day, a safe project name and a short id: ' + path);
  ok(folders.has('Claude Activity') && folders.has('Claude Activity/Sessions'), 'both folders created, one at a time');
  const t = files.get(path);
  ok(/^---\ntype: claude-session\ndate: 2026-10-07\nproject: "shop\/api"/.test(t), 'frontmatter');
  ok(t.includes('[[Claude Activity/2026-10-07]]'), 'links back to the daily note');
  ok(t.includes('- [[Notes/real]] · 3') && t.includes('- `Notes/gone.md` · 1') && t.includes('- `src/app.js` · 2'), 'links only notes that exist');
  ok(t.includes("`we'ird.js`"), 'a backtick in a file name cannot break the code span');
  ok(/cost_usd: 1\.23/.test(t) && /Tokens in \/ out/.test(t), 'cost and tokens');
  ok(opened === path, 'opened when asked');
  // my notes survive a refresh
  files.set(path, t.replace('## My notes\n', '## My notes\n\nmy own words\n'));
  p.daily.sessions.abcdef123456.prompts = 5;
  await p.writeSessionNote('abcdef123456');
  const t2 = files.get(path);
  ok(/prompts: 5/.test(t2) && t2.includes('my own words') && t2.indexOf('my own words') > t2.indexOf('## My notes'), 'refresh keeps what you wrote under My notes');
  ok(await p.writeSessionNote('nope') === null, 'unknown session: nothing written');

  // refreshing many times: one "My notes" heading, nothing piles up, what you wrote stays put
  const heads = (t) => (t.match(/^## My notes[ \t]*$/gm) || []).length;
  const sizes = [];
  for (let i = 0; i < 5; i++) { await p.writeSessionNote('abcdef123456'); sizes.push(files.get(path).length); }
  ok(heads(files.get(path)) === 1 && sizes.every(n => n === sizes[0]), 'five refreshes: one My notes heading, size stable ' + sizes.join(','));
  ok(files.get(path).endsWith('my own words\n') || /my own words\s*$/.test(files.get(path)), 'and your words are still last');
  p.settings.dailyNote = true;
  const dsizes = [], dpath = p.dailyPath('2026-10-07');
  for (let i = 0; i < 4; i++) { await p.writeDailyNote(); dsizes.push((files.get(dpath) || '').length); }
  ok(dsizes[0] > 0 && heads(files.get(dpath)) === 1 && dsizes.every(n => n === dsizes[0]), 'the daily note does not grow either: ' + dsizes.join(','));
  files.set(dpath, files.get(dpath).replace('## My notes\n', '## My notes\n\ndaily words\n')); await p.writeDailyNote(); await p.writeDailyNote();
  ok(heads(files.get(dpath)) === 1 && (files.get(dpath).match(/daily words/g) || []).length === 1, 'daily words kept once');

  // text from outside cannot start a heading, a callout, a link or a table cell
  const hostile = mk(); const evil = 'proj\n---\n# fake heading\n> [!danger] spoof\n[[Private/secret]]\n## My notes\nzzz | a';
  hostile.daily = { day: '2026-10-07', sessions: { h1: Object.assign(x(), { label: evil, src: evil, files: { ['we\n[[Z]]`ird.js']: 1, 'a|b.md': 2 } }) } };
  const hp = await hostile.writeSessionNote('h1'), ht = files.get(hp);
  ok(heads(ht) === 1 && !/^# fake/m.test(ht) && !/^> \[!danger\]/m.test(ht) && !ht.includes('[[Private/secret]]') && !ht.includes('[[Z]]') && !/^---\n#/m.test(ht.slice(10)), 'a hostile label and file name stay on one plain line');
  ok(/^project: "/m.test(ht) && ht.split('\n').filter(l => /^project:/.test(l)).length === 1 && ht.split('\n')[0] === '---' && ht.split('\n').indexOf('---', 1) < 14, 'frontmatter intact: one project line, closed in place');
  await hostile.writeDailyNote(); const dh = files.get(hostile.dailyPath('2026-10-07'));
  ok(dh && heads(dh) === 1 && !/^# fake/m.test(dh) && !dh.includes('[[Private/secret]]') && !/\|[^\n]*zzz \| a/.test(dh), 'same in the daily note, table cells included');

  // two notes written at once on a fresh vault: both land
  files.clear(); folders.clear();
  const c = mk(); c.daily = { day: '2026-10-07', sessions: { s1: x(), s2: Object.assign(x(), { label: 'other' }) } };
  const both = await Promise.all([c.writeSessionNote('s1'), c.writeSessionNote('s2'), c.writeDailyNote()]);
  ok(both.every(Boolean) && files.size === 3, 'concurrent writes: all three notes written: ' + JSON.stringify(both));

  // sessions of one project on one day never share a note, even when the ids start alike
  const d = mk(); d.daily = { day: '2026-10-07', sessions: { 'agent:run-1': x(), 'agent:run-2': x(), '3f1c9a02-aaaa-bbbb-cccc-111122223333': x(), '3f1c9a02-aaaa-bbbb-cccc-444455556666': x() } };
  const ps = new Set(Object.keys(d.daily.sessions).map(k => d.sessionNotePath(k, d.daily.sessions[k], '2026-10-07')));
  ok(ps.size === 4, 'four sessions, four notes');

  // spending limits (the day totals only count for today's date, so the test uses the real one)
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const today = iso(new Date());
  const q = mk(); const s = { id: 's1', project: 'shop' };
  q.daily = { day: today, sessions: { s1: { cost: 0 } } }; q.metab.set('s1', { cost: 0 });
  q.settings.budgetSession = 2; q.settings.budgetDay = 5;
  const bump = (n) => { q.metab.get('s1').cost += n; q.daily.sessions.s1.cost += n; q.checkBudget(s); };
  bump(1.9); ok(Notice.log.length === 0, 'below both limits: silent');
  bump(0.2); ok(Notice.log.length === 1 && /spending limit/.test(Notice.log[0]) && /\$2\.10/.test(Notice.log[0]), 'session limit: one notice: ' + Notice.log[0].replace(/\n/g, ' | '));
  bump(0.5); ok(Notice.log.length === 1, 'and not again');
  bump(3); ok(Notice.log.length === 2 && /day/.test(Notice.log[1]), 'day limit: its own notice');
  bump(3); ok(Notice.log.length === 2, 'and not again');
  q.settings.budgetDay = 6; q.resetBudgetFlags('day'); bump(0);
  ok(Notice.log.length === 3 && /day/.test(Notice.log[2]) && !/session/.test(Notice.log[2]), 'a new day limit that is already passed: the day speaks again, the session does not');
  bump(0); ok(Notice.log.length === 3, 'once');
  q.settings.budgetSession = 100; q.resetBudgetFlags('session'); bump(0); ok(Notice.log.length === 3, 'a raised session limit that is not passed: silent');
  q.settings.budgetSession = 0; q.settings.budgetDay = 5; q.daily.day = '2020-01-01'; q.resetBudgetFlags(); Notice.log.length = 0; bump(0);
  ok(Notice.log.length === 0, 'yesterday\'s total is not announced as today\'s');
  q.settings.budgetSession = 0; q.settings.budgetDay = 0; q.daily.day = today; bump(50); ok(Notice.log.length === 0, 'limits off: silent');
})();
