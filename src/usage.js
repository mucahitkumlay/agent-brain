// How someone uses Claude Code, turn by turn, and what would make it go better.
// Pure functions, no state: main.js records one small entry per finished turn and asks for a report.
// Every suggestion carries the numbers it rests on, and nothing here guesses beyond them.

const DAY = 86400000;

// commands that should never be allowed without asking, whatever the numbers say
const NEVER_ALLOW = /\b(rm|rmdir|del|sudo|su|chmod|chown|dd|mkfs|kill|pkill|shutdown|reboot|curl|wget|ssh|scp|rsync|git\s+(push|reset|clean|rebase|checkout|branch\s+-D)|npm\s+publish|docker|kubectl|terraform|deploy|psql|mysql|DROP|DELETE|Remove-Item|Invoke-WebRequest|iwr|irm)\b/i;

// a permission rule for what was approved again and again: "npm test" -> Bash(npm test:*). Only plain, harmless commands.
export function approvalRule(tool, input) {
  const t = String(tool || '');
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(t)) return { key: 'edits', rule: '', label: 'file edits' };
  if (t !== 'Bash') return null;
  const cmd = String(input || '').trim();
  if (!cmd || /[;&|`$<>(){}\n]/.test(cmd) || NEVER_ALLOW.test(cmd)) return null;
  const words = cmd.split(/\s+/), keep = [];
  for (const w of words) {
    if (keep.length >= 2 || /^-/.test(w) || /[\\/'"=*?]/.test(w) || /\.\w{1,5}$/.test(w)) break;
    keep.push(w);
  }
  if (!keep.length || !/^[\w.@+-]+$/.test(keep[0])) return null;
  const pre = keep.join(' ');
  return { key: 'bash:' + pre, rule: `Bash(${pre}:*)`, label: pre };
}

const sum = (a, f) => a.reduce((n, x) => n + (f(x) || 0), 0);
const pct = (a, b) => (b > 0 ? a / b : 0);
const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// the numbers for one stretch of turns
export function usageStats(turns) {
  const n = turns.length, calls = sum(turns, x => x.c), dur = sum(turns, x => x.d);
  const coded = turns.filter(x => x.e > 0);
  return {
    turns: n,
    medianTurn: median(turns.map(x => x.d)),
    waitShare: pct(sum(turns, x => x.w), dur),
    failRate: pct(sum(turns, x => x.f), calls),
    warnPer10: n ? 10 * sum(turns, x => x.n) / n : 0,
    costPerTurn: n ? sum(turns, x => x.$) / n : 0,
    cost: sum(turns, x => x.$),
    testedShare: coded.length ? pct(coded.filter(x => x.ts != null).length, coded.length) : null,
    stuck: turns.filter(x => x.st).length,
  };
}

// which way is better for each number (lower or higher)
export const BETTER = { medianTurn: -1, waitShare: -1, failRate: -1, warnPer10: -1, costPerTurn: -1, testedShare: 1 };

const fmtMin = (ms) => { const m = Math.round(ms / 60000); return m < 1 ? 'under a minute' : m === 1 ? '1 minute' : `${m} minutes`; };

// the report: this week against the week before, and suggestions with their evidence
export function usageReport(list, now, opts) {
  const o = opts || {};
  const all = (list || []).filter(x => x && x.t && now - x.t < 28 * DAY);
  const cur = all.filter(x => now - x.t < 7 * DAY), prev = all.filter(x => now - x.t >= 7 * DAY && now - x.t < 14 * DAY);
  const last14 = all.filter(x => now - x.t < 14 * DAY);
  const tips = [];
  const S = usageStats(last14);

  // 1. the same harmless command approved again and again
  const ap = new Map();
  for (const x of last14) for (const a of x.ap || []) {
    if (a.o !== 'a') continue;
    const e = ap.get(a.k) || { k: a.k, rule: a.r, label: a.l, n: 0, wait: 0, proj: new Set() };
    e.n++; e.wait += a.w || 0; if (x.p) e.proj.add(x.p); ap.set(a.k, e);
  }
  const top = [...ap.values()].filter(e => e.n >= 5).sort((a, b) => b.n - a.n);
  const bash = top.filter(e => e.k.startsWith('bash:')).slice(0, 4);
  if (bash.length) tips.push({
    id: 'allow', weight: sum(bash, e => e.n) * 2,
    title: 'Stop approving the same commands',
    text: `In the last two weeks you approved ${bash.map(e => `\`${e.label}\` ${e.n} times`).join(', ')}. Claude waited ${fmtMin(sum(bash, e => e.wait))} for those clicks.`,
    how: 'Add these rules to the project\'s .claude/settings.local.json (only for you) or .claude/settings.json (for the team), under "permissions" → "allow". Risky commands are never suggested.',
    copy: JSON.stringify({ permissions: { allow: bash.map(e => e.rule) } }, null, 2), copyLabel: 'Copy the rules',
  });
  const edits = top.find(e => e.k === 'edits');
  if (edits) tips.push({
    id: 'edits', weight: edits.n,
    title: 'Let it edit files without asking',
    text: `You approved ${edits.n} file edits one by one in the last two weeks.`,
    how: 'Press Shift+Tab in Claude Code until it says "accept edits on". Edits are still shown and can be undone with git.',
  });

  // 2. "done" without proof
  const claims = sum(last14, x => (x.k || []).filter(k => k === 'unproven' || k === 'contradicted').length);
  if (claims >= 2) {
    const cmd = o.testCmd || 'the tests';
    tips.push({
      id: 'proof', weight: claims * 4,
      title: 'Ask for proof before "it works"',
      text: `${claims} times Claude said the tests pass or it is fixed when the last run had failed or no test ran.`,
      how: 'Put this line in the project\'s CLAUDE.md, so every session starts with it.',
      copy: `- Before you say something works or is fixed, run ${o.testCmd ? '`' + cmd + '`' : 'the tests'} and quote the result.`, copyLabel: 'Copy for CLAUDE.md',
    });
  }

  // 3. code changed, nothing tested
  const coded = last14.filter(x => x.e > 0);
  if (coded.length >= 5 && S.testedShare !== null && S.testedShare < 0.5) tips.push({
    id: 'tests', weight: Math.round(coded.length * (1 - S.testedShare)),
    title: 'Most changes are never tested',
    text: `Claude changed files in ${coded.length} turns; ${Math.round(100 * (1 - S.testedShare))}% of them ended without running any test.`,
    how: 'Add the test command to CLAUDE.md, or say "and run the tests" in the prompt.',
    copy: `- After changing code, run ${o.testCmd ? '`' + o.testCmd + '`' : 'the tests'} and fix what fails before you stop.`, copyLabel: 'Copy for CLAUDE.md',
  });

  // 4. the same wrong guesses again and again: lessons exist for that
  const miss = sum(last14, x => (x.k || []).filter(k => /^(missing|nomodule|nocommand|nopackage|noscript|nopath|mismatch|unread)$/.test(k)).length);
  if (miss >= 3 && o.lessons) tips.push({
    id: 'lessons', weight: miss * 2,
    title: 'Teach it what it keeps getting wrong',
    text: `${miss} times it reached for a file, module, command or text that was not there.`,
    how: `Agent Brain wrote ${o.lessons} lesson${o.lessons === 1 ? '' : 's'} from that. Copy them into CLAUDE.md so the next session knows.`,
    action: 'lessons', actionLabel: 'Open the lessons',
  });

  // 5. loops
  const stuck = last14.filter(x => x.st);
  if (stuck.length >= 2) tips.push({
    id: 'stuck', weight: stuck.length * 3,
    title: 'Step in sooner when it loops',
    text: `${stuck.length} turns got stuck: the same command failing again and again. Those turns took ${fmtMin(sum(stuck, x => x.d))} in all.`,
    how: 'When the Stuck watcher fires, press Esc in Claude Code and give it the missing piece (the right command, a file, an error). Turn on Stuck notifications in the settings to hear about it.',
  });

  // 6. a full head
  const full = last14.filter(x => x.cx >= 0.75);
  if (full.length >= 3) tips.push({
    id: 'context', weight: full.length * 2,
    title: 'Start fresh between unrelated tasks',
    text: `In ${full.length} turns the context was over three quarters full. A full context is slower, costs more per call and forgets more.`,
    how: 'Use /clear when you switch to something unrelated, or /compact with a short note on what to keep.',
  });

  // 7. answers that rest on nothing
  const ung = sum(last14, x => (x.k || []).filter(k => k === 'ungrounded').length);
  if (ung >= 2) tips.push({
    id: 'grounded', weight: ung * 2,
    title: 'Ask it to look before it answers',
    text: `${ung} long answers talked about specific files without reading, searching or running anything in that turn.`,
    how: 'Start such questions with "Read … first" or "Check in the code". The turn report shows what each answer rests on.',
  });

  // 8. where the money went
  const pricey = last14.filter(x => x.$ > 0).sort((a, b) => b.$ - a.$).slice(0, 3);
  if (pricey.length && S.cost >= 1 && pricey[0].$ >= S.cost * 0.15) tips.push({
    id: 'cost', weight: 3,
    title: 'A few turns cost the most',
    text: `The most expensive turns: ${pricey.map(x => `$${x.$.toFixed(2)} in ${x.p || 'a project'} (${x.c} tool calls)`).join(', ')}; $${S.cost.toFixed(2)} in two weeks.`,
    how: 'Big turns are usually broad prompts ("fix everything") or a long context. Splitting the task or starting fresh often costs less.',
  });

  tips.sort((a, b) => b.weight - a.weight);
  return { cur: usageStats(cur), prev: usageStats(prev), tips, turns: last14.length, since: all.length ? Math.min(...all.map(x => x.t)) : now };
}

/* ---------- prompts: a few yes/no features, worked out when the prompt arrives; the text itself is never kept ---------- */

const FILEISH_P = /(?:^|[\s`'"(])(?:[\w.-]+\/)+[\w.-]+|\b[\w-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|cpp|c|h|md|json|ya?ml|toml|sql|sh|css|scss|html|vue|svelte)\b|`[^`]{2,60}`/i;
const DONE_P = /\b(should|must|expect(?:ed|s)?|so that|until|make sure|ensure|acceptance|criteria)\b|\b(?:npm|yarn|pnpm|bun) (?:run )?test\b|\b(?:pytest|go test|cargo test|mvn test|gradle test)\b|\btests? (?:pass|passes|green|succeed)|\bpass(?:es)?\b|\b(olmal[ıi]|ge[cç]meli|d[oö]nmeli|emin ol)\b/i;
const VAGUE_P = /^(fix (it|this|that)|make it work|(it|this) (does ?n[o']t|doesnt) work|still (broken|not working)|not working|again|try again|continue|go on|do it|same|d[uü]zelt|[cç]al[ıi]şm[ıi]yor|yine|tekrar|devam)\b/i;
const CORR_P = /^(no\b|nope|wrong|that'?s (not|wrong)|not what|you (broke|deleted|removed|forgot|missed)|undo|revert|roll ?back|stop\b|don'?t\b|why did you|hay[ıi]r|yanl[ıi]ş|geri al|bozdun|sildin|unuttun|olmad[ıi]|neden)/i;
const NEG_P = /\b(don'?t|do not|without|no need to|skip)\s+(\w+\s+){0,3}(tests?|check|run)\b|\b(test|testleri)\s+(\w+\s+){0,2}(çalıştırma|yapma)\b/gi;
const LIMIT_P = /\b(only|don'?t|do not|without|never|keep|just|sadece|yapma|dokunma|olmadan)\b/i;

export function promptFeatures(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const words = t.split(/\s+/).length;
  return {
    w: words < 8 ? 0 : words <= 40 ? 1 : 2,       // short, medium, long
    f: FILEISH_P.test(t) ? 1 : 0,                  // names a file, path or symbol
    d: DONE_P.test(t.replace(NEG_P, ' ')) ? 1 : 0, // says what "done" looks like ("don't run the tests" does not count)
    v: VAGUE_P.test(t) && words < 12 ? 1 : 0,      // "fix it", "still not working"
    r: CORR_P.test(t) ? 1 : 0,                     // corrects the previous answer
    x: LIMIT_P.test(t) ? 1 : 0,                    // sets a limit ("only", "don't")
  };
}

/* ---------- weeks: entries older than four weeks are folded into one line per week ---------- */

export function weekOf(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return +d; }

const blank = () => ({ turns: 0, d: 0, w: 0, c: 0, f: 0, n: 0, $: 0, coded: 0, tested: 0, st: 0, full: 0, rx: 0, pr: 0, pf: {} });
// add one turn to a week's sums (and to the prompt-feature buckets)
export function addToWeek(W, x) {
  W.turns++; W.d += x.d || 0; W.w += x.w || 0; W.c += x.c || 0; W.f += x.f || 0; W.n += x.n || 0; W.$ += x.$ || 0;
  if (x.e > 0) { W.coded++; if (x.ts != null) W.tested++; }
  if (x.st) W.st++; if (x.cx >= 0.75) W.full++; if (x.rx) W.rx++;
  if (x.pf) {
    W.pr++;
    for (const [k, v] of Object.entries(x.pf)) {
      const b = W.pf[k + v] || (W.pf[k + v] = { n: 0, c: 0, f: 0, fn: 0, rx: 0 });
      b.n++; b.c += x.c || 0; b.f += x.f || 0; b.fn += x.n || 0; b.rx += x.rx ? 1 : 0;
    }
  }
  return W;
}
// move entries older than `keepDays` into the weekly sums; returns the entries that stay
export function foldOld(entries, weeks, now, keepDays) {
  const lim = now - (keepDays || 28) * DAY, keep = [];
  for (const x of entries) {
    if (x.t >= lim) { keep.push(x); continue; }
    const k = weekOf(x.t);
    addToWeek(weeks[k] || (weeks[k] = blank()), x);
  }
  // a year of weeks at most
  const ks = Object.keys(weeks).map(Number).sort((a, b) => a - b);
  while (ks.length > 53) delete weeks[ks.shift()];
  return keep;
}

// every week there is, old (folded) and recent (still in detail), oldest first
export function weekSeries(entries, weeks) {
  const all = {};
  for (const [k, W] of Object.entries(weeks || {})) all[k] = JSON.parse(JSON.stringify(W));
  for (const x of entries || []) { const k = weekOf(x.t); addToWeek(all[k] || (all[k] = blank()), x); }
  return Object.keys(all).map(Number).sort((a, b) => a - b).map(k => {
    const W = all[k];
    return { week: k, turns: W.turns, W,
      waitShare: W.d ? W.w / W.d : 0, failRate: W.c ? W.f / W.c : 0, warnPer10: W.turns ? 10 * W.n / W.turns : 0,
      costPerTurn: W.turns ? W.$ / W.turns : 0, testedShare: W.coded ? W.tested / W.coded : null, correctedShare: W.pr ? W.rx / W.pr : 0,
      medianTurn: W.turns ? W.d / W.turns : 0 };
  });
}

/* ---------- what the prompts show, over everything recorded ---------- */

export function promptTips(series) {
  const pf = {}; let prompts = 0, corrected = 0;
  for (const s of series) {
    prompts += s.W.pr; corrected += s.W.rx;
    for (const [k, b] of Object.entries(s.W.pf)) { const a = pf[k] || (pf[k] = { n: 0, c: 0, f: 0, fn: 0, rx: 0 }); a.n += b.n; a.c += b.c; a.f += b.f; a.fn += b.fn; a.rx += b.rx; }
  }
  const tips = [];
  if (prompts < 15) return { tips, prompts, corrected };
  const rate = (b) => (b && b.n ? b.rx / b.n : 0), per = (b) => (b && b.n ? b.c / b.n : 0);
  const cmp = (yes, no, min) => yes && no && yes.n >= (min || 8) && no.n >= (min || 8);
  const P = (v) => Math.round(v * 100) + '%';
  // naming the file
  if (cmp(pf.f1, pf.f0) && (rate(pf.f0) > rate(pf.f1) * 1.3 || per(pf.f0) > per(pf.f1) * 1.3)) tips.push({
    id: 'p-file', weight: Math.round(100 * (rate(pf.f0) - rate(pf.f1))) + 5,
    title: 'Name the file or function you mean',
    text: `When your prompt named a file, path or symbol, you had to correct the answer ${P(rate(pf.f1))} of the time and it took ${per(pf.f1).toFixed(1)} tool calls; without one, ${P(rate(pf.f0))} and ${per(pf.f0).toFixed(1)} (${pf.f1.n} and ${pf.f0.n} prompts).`,
    how: 'Point at it: "in src/api/retry.ts, the backoff in retryRequest()". Claude searches less and guesses less.',
  });
  // saying what done looks like
  if (cmp(pf.d1, pf.d0) && rate(pf.d0) > rate(pf.d1) * 1.3) tips.push({
    id: 'p-done', weight: Math.round(100 * (rate(pf.d0) - rate(pf.d1))) + 5,
    title: 'Say what "done" looks like',
    text: `Prompts that said how to check the result (a test, an expected output, "should …") were corrected ${P(rate(pf.d1))} of the time; the others ${P(rate(pf.d0))} (${pf.d1.n} and ${pf.d0.n} prompts).`,
    how: 'End with the check: "… and `npm test` passes", "it should return 404 for a missing id".',
  });
  // very short prompts
  if (cmp(pf.w0, pf.w1) && rate(pf.w0) > rate(pf.w1) * 1.3) tips.push({
    id: 'p-short', weight: Math.round(100 * (rate(pf.w0) - rate(pf.w1))),
    title: 'Very short prompts get corrected more',
    text: `Prompts under eight words were corrected ${P(rate(pf.w0))} of the time, prompts of 8 to 40 words ${P(rate(pf.w1))} (${pf.w0.n} and ${pf.w1.n} prompts).`,
    how: 'One more sentence of context (what, where, why) is usually enough.',
  });
  // "fix it" / "still not working"
  if (pf.v1 && pf.v1.n >= 5 && pf.v0 && pf.v0.n >= 8 && (per(pf.v1) > per(pf.v0) * 1.2 || rate(pf.v1) > rate(pf.v0) * 1.3)) tips.push({
    id: 'p-vague', weight: pf.v1.n,
    title: 'Give the error, not "still not working"',
    text: `${pf.v1.n} prompts were like "fix it" or "still not working"; they took ${per(pf.v1).toFixed(1)} tool calls on average and were corrected ${P(rate(pf.v1))} of the time; other prompts ${per(pf.v0).toFixed(1)} and ${P(rate(pf.v0))}.`,
    how: 'Paste the error or say what you saw: "the build fails with TS2304 in checkout.ts". Claude does not have to rediscover it.',
  });
  // how often answers needed correcting at all
  if (prompts >= 20 && corrected / prompts >= 0.15) tips.push({
    id: 'p-corr', weight: Math.round(100 * corrected / prompts),
    title: `${P(corrected / prompts)} of answers needed a correction`,
    text: `${corrected} of ${prompts} prompts were followed by one that corrected it ("no", "that's wrong", "revert", "geri al" …).`,
    how: 'For bigger changes, ask for a plan first ("plan it, don\'t change anything yet") and agree on it before any edit.',
  });
  return { tips, prompts, corrected };
}

// suggested additions to a project's CLAUDE.md, from what was seen in that project only
export function claudeMdDraft(proj, entries, lessons, hasClaudeMd) {
  const E = entries.filter(x => x.p === proj);
  if (!E.length && !(lessons || []).length) return null;
  const lines = [], why = [];
  const test = (lessons || []).find(l => l.kind === 'testcmd');
  const cmd = test ? (String(test.text).match(/`([^`]+)`/) || [])[1] : '';
  const claims = E.reduce((n, x) => n + (x.k || []).filter(k => k === 'unproven' || k === 'contradicted').length, 0);
  const coded = E.filter(x => x.e > 0), untested = coded.filter(x => x.ts == null).length;
  if (cmd) { lines.push(`- Run the tests with \`${cmd}\`.`); why.push('the test command that worked'); }
  if (claims >= 1) { lines.push(`- Before you say something works or is fixed, run ${cmd ? '`' + cmd + '`' : 'the tests'} and quote the result.`); why.push(`${claims} claim${claims > 1 ? 's' : ''} without proof`); }
  if (coded.length >= 5 && untested / coded.length >= 0.5) { lines.push('- After changing code, run the tests and fix what fails before you stop.'); why.push(`${untested} of ${coded.length} changes untested`); }
  for (const l of (lessons || []).filter(l => l.kind !== 'testcmd').sort((a, b) => b.n - a.n).slice(0, 8)) lines.push('- ' + l.text);
  if ((lessons || []).length > (cmd ? 1 : 0)) why.push('what it got wrong before (lessons)');
  const stuck = E.filter(x => x.st).length;
  if (stuck >= 2) { lines.push('- If the same command fails twice, stop and tell me what you tried instead of trying again.'); why.push(`${stuck} turns stuck in a loop`); }
  if (!lines.length) return null;
  return { proj, has: !!hasClaudeMd, text: `## Notes from past sessions (Agent Brain)\n\n${lines.join('\n')}\n`, why, turns: E.length };
}
