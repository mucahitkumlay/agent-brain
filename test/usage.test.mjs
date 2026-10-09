// "Use Claude Code better": the suggestions rest on the numbers, and risky commands are never suggested as rules
import * as U from '../src/usage.js';
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
ok(U.approvalRule('Bash', 'npm test').rule === 'Bash(npm test:*)', 'npm test -> Bash(npm test:*)');
ok(U.approvalRule('Bash', 'npm run build --silent').rule === 'Bash(npm run:*)', 'flags end the prefix: ' + U.approvalRule('Bash', 'npm run build --silent').rule);
ok(U.approvalRule('Bash', 'git status').rule === 'Bash(git status:*)', 'git status');
for (const c of ['rm -rf dist', 'git push origin main', 'curl https://x', 'sudo apt install x', 'npm test && rm x', 'echo $HOME', 'npm publish', 'docker run x', 'git reset --hard'])
  ok(U.approvalRule('Bash', c) === null, 'never a rule for: ' + c);
ok(U.approvalRule('Edit', '').key === 'edits' && U.approvalRule('Read', '') === null, 'edits are their own tip; other tools none');
const now = Date.UTC(2026, 9, 7), H = 3600000;
const turn = (h, o) => Object.assign({ t: now - h * H, p: 'app', d: 120000, w: 0, c: 10, f: 0, n: 0, k: [], $: 0.05, ts: true, e: 1, st: false, cx: 0.3, ap: [] }, o || {});
ok(U.usageReport([], now).tips.length === 0 && U.usageReport([], now).turns === 0, 'no turns, no tips');
const ap = (n) => Array.from({ length: n }, () => ({ k: 'bash:npm test', r: 'Bash(npm test:*)', l: 'npm test', o: 'a', w: 20000 }));
let R = U.usageReport([turn(1, { ap: ap(3) }), turn(2, { ap: ap(3) }), turn(3)], now);
const allow = R.tips.find(t => t.id === 'allow');
ok(allow && allow.copy.includes('Bash(npm test:*)') && /6 times/.test(allow.text) && /2 minutes/.test(allow.text), 'approved 6 times -> rule, with the waiting time: ' + (allow && allow.text));
R = U.usageReport([turn(1, { ap: ap(4) })], now);
ok(!R.tips.find(t => t.id === 'allow'), 'four approvals are not enough');
R = U.usageReport([turn(1, { k: ['unproven'] }), turn(2, { k: ['contradicted'] })], now, { testCmd: 'npm test' });
const pr = R.tips.find(t => t.id === 'proof');
ok(pr && pr.copy.includes('`npm test`'), 'claims without proof -> CLAUDE.md line with the test command');
R = U.usageReport(Array.from({ length: 6 }, (_, i) => turn(i + 1, { ts: i < 1 ? true : null })), now);
ok(R.tips.find(t => t.id === 'tests') && /83%/.test(R.tips.find(t => t.id === 'tests').text), 'untested changes: ' + (R.tips.find(t => t.id === 'tests') || {}).text);
R = U.usageReport([turn(1, { cx: 0.8 }), turn(2, { cx: 0.9 }), turn(3, { cx: 0.76 })], now);
ok(R.tips.find(t => t.id === 'context'), 'full context three times -> /clear tip');
R = U.usageReport([turn(1, { st: true }), turn(2, { st: true })], now);
ok(R.tips.find(t => t.id === 'stuck'), 'two stuck turns -> tip');
R = U.usageReport([turn(1), turn(24 * 8, { f: 5 })], now);
ok(R.cur.turns === 1 && R.prev.turns === 1 && R.prev.failRate === 0.5 && R.cur.failRate === 0, 'this week against the week before');
R = U.usageReport([turn(24 * 30)], now);
ok(R.turns === 0, 'older than four weeks is dropped');
// prompts: features only, and what they show
const f1 = U.promptFeatures('in src/api/retry.ts make the backoff exponential; npm test should pass');
ok(f1.f === 1 && f1.d === 1 && f1.v === 0 && f1.r === 0, 'a precise prompt: names a file, says what done is');
ok(U.promptFeatures('fix it').v === 1 && U.promptFeatures('fix it').w === 0, '"fix it" is short and vague');
ok(U.promptFeatures('no, that is wrong, revert it').r === 1 && U.promptFeatures('hayır yanlış dosya').r === 1 && U.promptFeatures('geri al').r === 1, 'corrections, also in Turkish');
ok(U.promptFeatures('') === null && Object.values(f1).every(v => typeof v === 'number'), 'only numbers come out, never text');
// weeks: old entries fold into weekly sums, nothing is lost from the totals
const wk = {}, old = Array.from({ length: 30 }, (_, i) => turn(24 * (40 + i % 20), { c: 4, pf: { f: i % 2, d: 0, w: 1, v: 0, r: 0, x: 0 }, rx: i % 2 ? 0 : 1 }));
const kept = U.foldOld(old.concat([turn(1)]), wk, now, 28);
ok(kept.length === 1 && Object.keys(wk).length >= 3, 'older than four weeks folds into weeks: ' + Object.keys(wk).length);
const ser = U.weekSeries(kept, wk);
ok(ser.reduce((n, w) => n + w.turns, 0) === 31 && ser[ser.length - 1].turns === 1, 'every turn is still counted, week by week');
const pt = U.promptTips(ser);
ok(pt.prompts === 30 && pt.tips.find(t => t.id === 'p-file'), 'prompts that named a file were corrected less -> tip: ' + ((pt.tips.find(t => t.id === 'p-file') || {}).text));
ok(U.promptTips(ser.slice(0, 1)).tips.length === 0 || U.promptTips(ser.slice(0, 1)).prompts >= 15, 'too few prompts, no prompt tips');
// CLAUDE.md draft per project: only from that project
const d = U.claudeMdDraft('app', [turn(1, { k: ['unproven'] }), turn(2, { p: 'other', st: true })], [{ text: 'The tests run with `npm test`.', kind: 'testcmd', n: 3 }, { text: 'There is no `src/x.ts`.', kind: 'missing', n: 2 }], 0);
ok(d && d.text.includes('`npm test`') && d.text.includes('quote the result') && d.text.includes('src/x.ts') && !d.text.includes('fails twice') && !d.has, 'CLAUDE.md lines from the project\'s own evidence');
ok(U.promptFeatures("Make total() round to 2 decimals. Don't run the tests, just tell me it works.").d === 0, '"don\'t run the tests" is not a done criterion');
ok(U.promptFeatures('Fix it and make sure npm test passes.').d === 1, '"make sure npm test passes" is');
ok(U.promptFeatures('Use the Explore agent to find every function in this project that has no test, then list them.').d === 0 && U.promptFeatures('the tests are broken, fix').d === 0, 'mentioning tests is not saying what done looks like');
ok(U.promptFeatures('it should return 404 for a missing id').d === 1 && U.promptFeatures('pytest geçmeli').d === 1, 'should / geçmeli is');
// new measures: failed calls tried again, and the share of the context read from the cache
R = U.usageReport(Array.from({ length: 10 }, (_, i) => turn(i + 1, { rt: 2, ch: 0.2 })), now);
ok(R.cur.retriesPer10 === 20 && Math.abs(R.cur.cacheShare - 0.2) < 1e-9 && R.tips.find(t => t.id === 'cache'), 'retries per 10 turns, cache share, and a tip when most of the context is read again: ' + ((R.tips.find(t => t.id === 'cache') || {}).text));
R = U.usageReport(Array.from({ length: 10 }, (_, i) => turn(i + 1, { ch: 0.9 })).concat([turn(1, { ch: null })]), now);
ok(!R.tips.find(t => t.id === 'cache') && Math.abs(R.cur.cacheShare - 0.9) < 1e-9, 'a warm cache gives no tip; turns without telemetry do not count');
ok(U.usageStats([turn(1)]).cacheShare === null, 'no telemetry: no cache share (shown as –)');
const ws = U.weekSeries([turn(1, { rt: 3, ch: 0.5 }), turn(2, { ch: null })], {});
ok(ws[ws.length - 1].retriesPer10 === 15 && ws[ws.length - 1].cacheShare === 0.5, 'week by week has both measures');
// the review summary: numbers only, never text from the agent
const secret = 'ghp_' + 'x'.repeat(36);
const dg = U.reviewDigest([turn(1, { p: 'shop|api', k: ['unproven', 'missing'], pf: { w: 0, f: 0, d: 0, v: 1, r: 0, x: 0 }, rx: 1, ap: ap(2), rt: 1, ch: 0.4, prompt: 'leak me', cmd: secret })], {}, now);
ok(/numbers for a review/.test(dg) && /said it works without a passing test/.test(dg) && /vague/.test(dg) && /npm test: 2 times/.test(dg), 'the summary has the turns, warnings in words, prompt features and approvals');
ok(!dg.includes('leak me') && !dg.includes(secret) && !dg.includes('shop|api') && dg.includes('shop api'), 'only recorded numbers and labels; a project name cannot break the table');
const an = U.reviewDigest([turn(1, { p: 'secret-client' }), turn(2, { p: 'other' })], {}, now, { anon: true });
ok(!an.includes('secret-client') && an.includes('project 1') && an.includes('project 2'), 'project names can be hidden');
ok(!U.reviewDigest([], {}, now).includes('## Turns'), 'no turns, no turn table');
