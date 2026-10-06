// What the plugin reads into an agent's actions: risky commands, secrets, prompt-injection chains, grounding, lessons.
// Pure functions, no state: main.js keeps the state per session.

// commands that destroy, overwrite history or reach production-like targets
const RISKY = [
  [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive\s+--force|-r\s+-f|-f\s+-r)\b[^|;&\n]*(\s\/(\s|$)|\s~\/?(\s|$)|\s\*|\s\.\.?\/?(\s|$)|\s\/(home|etc|usr|var|root)\b)/, 'deletes a whole tree (rm -rf on /, ~, * or ..)'],
  [/\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/, 'deletes files recursively without asking (rm -rf)'],
  [/\bgit\s+push\b[^|;&\n]*(\s--force(?!-with-lease)\b|\s-f\b)/, 'rewrites the remote branch (git push --force)'],
  [/\bgit\s+reset\s+--hard\b/, 'throws away uncommitted work (git reset --hard)'],
  [/\bgit\s+clean\s+-[a-z]*f[a-z]*d|\bgit\s+clean\s+-[a-z]*d[a-z]*f/, 'deletes untracked files (git clean -fd)'],
  [/\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/, 'discards all local changes (git checkout .)'],
  [/\b(drop\s+(table|database|schema)|truncate\s+table)\b/i, 'drops or empties database data'],
  [/\bdelete\s+from\s+\w+\s*(;|$)(?![\s\S]*\bwhere\b)/i, 'deletes every row of a table (DELETE without WHERE)'],
  [/\bmkfs(\.\w+)?\b|\bdd\b[^|;&\n]*\bof=\/dev\//, 'writes to a disk device'],
  [/\bchmod\s+(-R\s+)?777\b/, 'makes files writable by everyone (chmod 777)'],
  [/\b(curl|wget)\b[^|;&\n]*\|\s*(sudo\s+)?(ba|z)?sh\b/, 'runs a script straight from the internet (curl | sh)'],
  [/\b(kubectl|oc)\s+delete\b/, 'deletes cluster resources (kubectl delete)'],
  [/\bterraform\s+(destroy|apply\b[^|;&\n]*-auto-approve)/, 'changes infrastructure without review (terraform)'],
  [/\bdocker\s+(system\s+prune\s+-a|volume\s+rm|rm\s+-f)/, 'removes containers or volumes'],
  [/\b(shutdown|reboot|halt|poweroff)\b(\s|$)/, 'shuts down or restarts the machine'],
  [/\bRemove-Item\b[^|;&\n]*-Recurse[^|;&\n]*-Force|\bformat\s+[a-z]:/i, 'deletes recursively (Remove-Item -Recurse -Force)'],
  [/>\s*\/etc\/|\btee\s+\/etc\//, 'overwrites a system file under /etc'],
  [/\bnpm\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b|\bgh\s+release\s+delete\b/, 'publishes or deletes a public release'],
];
// build output and caches: deleting them is routine, not a risk
const SCRATCH = /^["']?(\.\/)?([\w.-]+\/)*(node_modules|dist|build|out|\.next|\.nuxt|target|coverage|tmp|\.cache|__pycache__|\.pytest_cache|\.turbo|\.parcel-cache|bin|obj)\/?["']?$/;
export function riskyCommand(cmd) {
  const c = String(cmd || '');
  for (const [re, why] of RISKY) {
    if (!re.test(c)) continue;
    if (why.startsWith('deletes files recursively')) {
      const parts = c.split(/&&|\|\||;|\n/).filter(p => /\brm\s+-[a-z]*(rf|fr)/.test(p));
      const targets = parts.flatMap(p => p.replace(/^.*?\brm\s+/, '').split(/\s+/).filter(x => x && !x.startsWith('-')));
      if (targets.length && targets.every(x => SCRATCH.test(x))) continue;
    }
    return why;
  }
  return '';
}

// secrets that should never sit in a command line or a file the agent writes
const SECRETS = [
  ['AWS access key', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['GitHub token', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/g],
  ['API key', /\bsk-(?:ant-|proj-|live-)?[A-Za-z0-9_-]{24,}\b/g],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['Stripe key', /\b(sk|rk)_(live|test)_[A-Za-z0-9]{20,}\b/g],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g],
  ['JSON web token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
  ['password', /\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[=:]\s*["']?(?!\$|<|\{|\*{3}|x{3}|your|changeme|example)([^\s"'&;]{8,})/gi],
  ['bearer token', /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/g],
];
export function findSecrets(text) {
  const t = String(text || ''), out = [];
  for (const [kind, re] of SECRETS) { re.lastIndex = 0; if (re.test(t)) out.push(kind); }
  return out;
}
// shows enough to recognise the secret, never the secret itself
export function maskSecrets(text) {
  let t = String(text == null ? '' : text);
  for (const [, re] of SECRETS) {
    re.lastIndex = 0;
    t = t.replace(re, (m, ...g) => {
      const v = typeof g[1] === 'string' && /(password|passwd|pwd|secret|key|token)/i.test(String(g[0] || '')) ? g[1] : m;
      const keep = v.length > 12 ? v.slice(0, 4) : v.slice(0, 2);
      return m.replace(v, keep + '…' + '•'.repeat(6));
    });
  }
  // what is left of a key that an earlier step cut short ("ghp_A1b2C3…")
  return t.replace(/\b(gh[pousr]_|github_pat_|sk-ant-|sk-proj-|sk-live-|[sr]k_(?:live|test)_|xox[abprs]-|AKIA|ASIA|AIza)[A-Za-z0-9_-]{3,}/g, '$1…' + '•'.repeat(6));
}

// prompt injection: untrusted content followed by something an attacker would want
export const UNTRUSTED_TOOLS = /^(WebFetch|WebSearch)$|^mcp__.*(fetch|browse|navigate|read_page|get_page|search|scrape|crawl|email|mail|message|slack|issue|comment)/i;
const SENSITIVE_PATH = /(^|[\/\\])(\.ssh|\.aws|\.gnupg|\.kube|\.docker[\/\\]config\.json|\.netrc|\.npmrc|\.pypirc|\.git-credentials|id_(rsa|ed25519|ecdsa)|credentials(\.json)?|\.env(\.[\w-]+)?|secrets?\.(json|ya?ml|toml)|keychain|Login Data|Cookies)([\/\\]|$)/i;
export function sensitivePath(p) { return SENSITIVE_PATH.test(String(p || '')); }
const EGRESS = /\b(curl|wget|http|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b[^|;&\n]*(\s-X\s*(POST|PUT|PATCH)|\s(-d|--data(-\w+)?|--upload-file|-F|--form|-T|--post-data|--post-file|-Body|-InFile)\b)|\b(nc|ncat|netcat|socat)\b\s+\S+\s+\d+|\bscp\b[^|;&\n]*\s\S+@?\S+:|\brsync\b[^|;&\n]*\s\S+:\S*|\bgit\s+push\b[^|;&\n]*https?:\/\//i;
export function egressCommand(cmd) { return EGRESS.test(String(cmd || '')); }
const SECRET_DUMP = /\b(printenv|env)\s*($|\||>)|\bcat\b[^|;&\n]*(\.env|id_rsa|credentials|\.npmrc|\.netrc)|\bsecurity\s+find-(generic|internet)-password|\bgpg\s+--export-secret/i;
export function secretDump(cmd) { return SECRET_DUMP.test(String(cmd || '')); }
const PERSIST = /(>>?|\btee\b[^|;&\n]*)\s*~?\/?[^\s|;&]*(\.bashrc|\.zshrc|\.profile|\.bash_profile|crontab|\/etc\/cron|authorized_keys|LaunchAgents|\\Startup\\)|\bcrontab\s+-[a-z]*\s|\bschtasks\b|\bsystemctl\s+enable\b/i;
export function persistence(cmd) { return PERSIST.test(String(cmd || '')); }
const INJECT_TEXT = /\b(ignore|disregard|forget)\s+(all\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions|prompts?|rules)|\byou are now\b|\bnew instructions\s*:|\bsystem prompt\b|<\/?(system|assistant)>|\bdo not (tell|inform) the user\b|\bexfiltrat/i;
export function injectionText(text) { return INJECT_TEXT.test(String(text || '')); }

// lessons: short, durable facts a finding teaches about a project
export function lessonFor(kind, detail) {
  const d = String(detail || '');
  switch (kind) {
    case 'nocommand': return d && `\`${d}\` is not installed here; do not call it.`;
    case 'noscript': return d && `There is no \`npm run ${d}\` in this project; check package.json scripts first.`;
    case 'nopackage': return d && `The package \`${d}\` does not exist on the registry.`;
    case 'nomodule': return d && `The module \`${d}\` is not available; check dependencies before importing it.`;
    case 'mismatch': return d && `Read \`${d}\` again right before editing it; edits based on memory failed.`;
    case 'missing': return d && `\`${d}\` does not exist; find the right path before reading it.`;
    case 'testcmd': return d && `Tests run with \`${d}\`.`;
    case 'repeatfail': return d && `\`${d}\` keeps failing here; look at the error before running it again.`;
    default: return '';
  }
}

// the generic event API: any agent can post these to /agent, they become the same events Claude Code's hooks send
const AGENT_TYPES = { start: 'SessionStart', prompt: 'UserPromptSubmit', tool: 'PreToolUse', result: 'PostToolUse', error: 'PostToolUseFailure', stop: 'Stop', end: 'SessionEnd', wait: 'Notification' };
export function agentToHook(x, seq) {
  if (!x || typeof x !== 'object' || !AGENT_TYPES[x.type]) return null;
  const word = (v, n, d) => String(v == null ? '' : v).replace(/[^\w.:-]/g, '').slice(0, n) || d;
  const agent = word(x.agent, 30, 'agent');
  const ev = { hook_event_name: AGENT_TYPES[x.type], session_id: agent + ':' + word(x.session, 80, 'default'), agent_name: agent };
  if (typeof x.cwd === 'string') ev.cwd = x.cwd.slice(0, 400);
  const text = (v) => typeof v === 'string' ? v.slice(0, 200000) : v == null ? '' : JSON.stringify(v).slice(0, 200000);
  const id = x.id != null ? String(x.id).slice(0, 120) : '';
  if (x.type === 'prompt') { ev.prompt = text(x.text); ev.prompt_id = id || 'p' + (seq || Date.now()); }
  if (x.type === 'tool' || x.type === 'result' || x.type === 'error') {
    ev.tool_name = String(x.tool || 'Tool').slice(0, 80);
    ev.tool_input = x.input && typeof x.input === 'object' ? x.input : x.input != null ? { value: text(x.input) } : {};
    ev.tool_use_id = id || undefined;
  }
  if (x.type === 'result') ev.tool_response = typeof x.output === 'object' && x.output ? x.output : text(x.output);
  if (x.type === 'error') ev.error = text(x.output != null ? x.output : x.text);
  if (x.type === 'stop') { ev.last_assistant_message = text(x.text); ev.prompt_id = id || undefined; }
  if (x.type === 'wait') { ev.notification_type = 'permission_prompt'; ev.message = text(x.text).slice(0, 200) || `${agent} needs your approval`; }
  return ev;
}

// a recording you can share: what happened and when, with every name, path, prompt, address and secret taken out
export function scrubText(t) {
  return maskSecrets(String(t || ''))
    .replace(/https?:\/\/([^\/\s'"`]+)[^\s'"`]*/g, 'https://$1/…')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/(^|[\s'"`=(])((?:[A-Za-z]:)?(?:[\\/][^\s\\/'"`:]+){2,})/g, (m, pre, p) => pre + p.split(/[\\/]/).pop())
    .slice(0, 160);
}
const SAY = new Set(['UserPromptSubmit', 'UserPromptExpansion', 'Message', 'MessageDisplay', 'Stop', 'Elicitation', 'ElicitationResult']);
export function scrubReplay(recs, project) {
  const t0 = recs.length ? recs[0].t : 0, ids = new Map(), agents = new Map();
  const map = (m, k, p) => { if (!k) return ''; if (!m.has(k)) m.set(k, p + (m.size + 1)); return m.get(k); };
  const base = (p) => String(p || '').split(/[\\/]/).pop();
  return {
    format: 'agent-brain-replay', version: 1, project: scrubText(project || 'session').slice(0, 40),
    events: recs.map(r => ({
      dt: r.t - t0, e: r.e, tool: /^mcp__/.test(r.tool || '') ? 'mcp' : r.tool || '', cat: r.cat || '', file: base(r.file),
      text: SAY.has(r.e) ? '' : scrubText(r.text), id: map(ids, r.id, 'c'), aid: map(agents, r.aid, 'a'), agent: r.agent || '',
      kind: r.kind || '', group: r.group || '', ntype: r.ntype || '',
    })),
  };
}

// colour themes: the brain surface, its rim, the background and (for colour-blind readability) the lobe colours
export const THEMES = {
  night: { label: 'Night', base: 0x5d6a82, rim: 0x5b8dff, bg: [0x030407, 0x0a0b10] },
  fmri: { label: 'fMRI', base: 0x7a7a7a, rim: 0xb9c0c8, bg: [0x000000, 0x050505],
    lobes: { frontal: '#ff3b1f', motor: '#ffe14d', parietal: '#ff8c1a', temporal: '#2f80ff', occipital: '#5fd3ff', cerebellum: '#ffb347', thalamus: '#f2f2f2', stem: '#bdbdbd' } },
  obsidian: { label: 'Match Obsidian', base: 0x5d6a82, rim: null, bg: null },
  contrast: { label: 'High contrast (colour-blind safe)', base: 0x8a90a0, rim: 0xffffff, bg: [0x000000, 0x000000],
    lobes: { frontal: '#D55E00', motor: '#009E73', parietal: '#E69F00', temporal: '#CC79A7', occipital: '#56B4E9', cerebellum: '#F0E442', thalamus: '#ffffff', stem: '#bbbbbb' } },
};
