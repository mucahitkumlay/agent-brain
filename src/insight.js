// What the plugin reads into an agent's actions: risky commands, secrets, prompt-injection chains, grounding, lessons.
// Pure functions, no state: main.js keeps the state per session.

// commands that destroy, overwrite history or reach production-like targets
// (a command is split into its parts on && || ; | and newlines, and checked part by part)
const RISKY = [
  [/\bgit\s+push\b(?![^|;&\n]{0,200}--dry-run)[^|;&\n]{0,200}(\s--force(?!-)\b|\s-[a-z]*f[a-z]*(\s|$)|\s\+[\w\/.-]+|\s--mirror\b|\s--delete\b|\s:[\w\/.-]+(\s|$))/, 'rewrites or deletes on the remote (git push --force, +ref, :ref)'],
  [/\bgit\s+reset\s+--hard\b/, 'throws away uncommitted work (git reset --hard)'],
  [/\bgit\s+clean\s+(?!-[a-z]*n)(-[a-z]*f|--force)/, 'deletes untracked files (git clean -f)'],
  [/\bgit\s+(checkout|restore)\s+(-f\s+)?(--\s+)?\.(\s|$)|\bgit\s+(checkout\s+-f|switch\s+(-f|--discard-changes))\b/, 'discards all local changes (git checkout .)'],
  [/\bgit\s+(branch\s+(-[a-z]*D\b|--delete\s+--force)|tag\s+-d\b|stash\s+(drop|clear)\b|reflog\s+(expire|delete)\b|gc\s+--prune=now|filter-branch\b|filter-repo\b|update-ref\s+-d\b)/, 'erases git history or branches (git branch -D, filter-branch, reflog expire)'],
  [/(?:^\s*|;\s*)(?:drop\s+(?:table|database|schema)|truncate\s+table)\b|\b(?:psql|mysql|mariadb|sqlite3|sqlcmd|duckdb|usql|mongosh|clickhouse-client|cockroach|prisma|rails|alembic|python3?|node|php)\b[\s\S]{0,300}\b(?:drop\s+(?:table|database|schema)|truncate\s+table)\b/i, 'drops or empties database data'],
  [/\bdelete\s+from\s+[\w."`\[\]]+\s*(;|$|["'])(?![\s\S]*\bwhere\b)/i, 'deletes every row of a table (DELETE without WHERE)'],
  [/\b(psql|mysql|mariadb|sqlite3|sqlcmd|duckdb|usql|clickhouse-client)\b[\s\S]{0,2000}\bupdate\s+[\w."`\[\]]+\s+set\s+\w+\s*=(?![^;]{0,500}?\bwhere\b)/i, 'changes every row of a table (UPDATE without WHERE)'],
  [/\b(?:redis|valkey)-cli\b[^|;&\n]{0,200}\b(flushall|flushdb)\b|\bdropDatabase\s*\(|\.dropCollection\s*\(|\.deleteMany\s*\(\s*\{\s*\}\s*\)/i, 'wipes a Redis or MongoDB database'],
  [/\bmkfs(\.\w+)?\b|\bdd\b[^|;&\n]{0,200}\bof=\/dev\/|(?:^|[;&|]\s{0,3}|\bsudo\s+)(?:wipefs|shred)\s|>\s*\/dev\/(sd|nvme|hd)\w*|\b(Clear-Disk|Format-Volume|diskpart)\b/i, 'writes to or wipes a disk (mkfs, dd, shred, diskpart)'],
  [/\btruncate\s+(?![^|;&\n]{0,200}\.log\b)(-s\s*0|--size[= ]0)\b/, 'empties a file (truncate -s 0)'],
  [/\bchmod\s+(-\w+\s+)*(0?777|a\+rwx)\b|\bchown\s+-R\b[^|;&\n]{0,200}\s\/(\s|$)/, 'opens up permissions or changes the owner of everything (chmod 777, chown -R /)'],
  [/\b(curl|wget)\b[^|;&\n]{0,200}\|\s*(sudo\s+(?:-\S+\s+)*)?(ba|z|da)?sh\b|\b(ba|z)?sh\s+<\(\s*(curl|wget)\b|\b(irm|iwr|Invoke-RestMethod|Invoke-WebRequest)\b[^;&\n]{0,200}\|\s*(iex|Invoke-Expression)\b|\b(iex|Invoke-Expression)\s*\(?\s*(\(?\s*New-Object[^|;&\n]{0,80}DownloadString|irm|iwr|Invoke-RestMethod|Invoke-WebRequest)\b|\beval\s+["']?\$\(\s*(curl|wget)\b/i, 'runs a script straight from the internet (curl | sh, irm | iex)'],
  [/\b(base64\s+(-d|--decode)|openssl\s+(enc|base64)\s+-d|xxd\s+-r)\b[^;&\n]{0,200}\|\s*(sudo\s+)?(ba|z|da)?sh\b|(?:^|\s)-(enc|encodedcommand)\s+[A-Za-z0-9+\/=]{24,}/i, 'runs hidden (encoded) code'],
  [/\b(kubectl|oc)\s+delete\b|\bhelm\s+(uninstall|delete)\b/, 'deletes cluster resources (kubectl delete)'],
  [/\b(terraform|tofu)\s+(destroy|apply\b[^|;&\n]{0,200}-auto-approve)|\bpulumi\s+destroy\b/, 'changes infrastructure without review (terraform)'],
  [/\bdocker(-compose|\s+compose)?\s+(system\s+prune\s+(-a|--all)|volume\s+(rm|prune)|rm\s+-f|rmi\s+-f|container\s+prune|image\s+prune\s+-a|network\s+prune|down\b[^|;&\n]{0,200}(\s-v\b|\s--volumes\b))/, 'removes containers, images or volumes'],
  [/\baws\s+s3\s+(rb|rm\b[^|;&\n]{0,200}--recursive|sync\b[^|;&\n]{0,200}--delete)|\baws\s+s3api\s+delete-bucket|\baws\s+(ec2\s+terminate-instances|rds\s+delete-\S+|dynamodb\s+delete-table|cloudformation\s+delete-stack|iam\s+delete-\S+|lambda\s+delete-function|eks\s+delete-\S+)|\bgcloud\b[^|;&\n]{0,200}\sdelete\b|\bgsutil\s+(-m\s+)?rm\s+-r|\baz\s+(group|vm|storage\s+account|resource|aks|sql\s+\S+)\s+delete\b|\bdoctl\b[^|;&\n]{0,200}\sdelete\b|\bheroku\s+(apps:destroy|pg:reset)\b|\bfly(ctl)?\s+(apps\s+destroy|volumes?\s+destroy)\b/, 'deletes cloud resources (aws, gcloud, az, heroku)'],
  [/\bgh\s+(repo\s+(delete|archive)|release\s+delete|secret\s+delete|workflow\s+disable|run\s+delete)\b/, 'deletes or disables something on GitHub (gh repo delete)'],
  [/\bnpm\s+(publish|unpublish|deprecate|dist-tag\s+rm)\b|\b(pnpm|yarn)\s+(npm\s+)?publish\b|\bcargo\s+(publish|yank)\b|\btwine\s+upload\b|\bgem\s+(push|yank)\b/, 'publishes or retracts a public package'],
  [/(?:^|[;&|(]\s{0,3}|\bsudo\s+)(?:shutdown|reboot|halt|poweroff)(?:\s|$)|\b(Stop-Computer|Restart-Computer)\b/i, 'shuts down or restarts the machine'],
  [/\bformat\s+[a-z]:|\breg\s+delete\b|\bbcdedit\b|\bcipher\s+\/w\b/i, 'formats a drive or edits boot and registry settings'],
  [/>\s*\/etc\/|\btee\s+(-a\s+)?\/etc\//, 'overwrites a system file under /etc'],
  [/\bcrontab\s+-r\b/, 'removes all scheduled jobs (crontab -r)'],
  [/\b(ufw\s+disable|setenforce\s+0|iptables\s+-F|Set-MpPreference\s+-Disable\w+|netsh\s+advfirewall\s+set\s+\w+\s+state\s+off|Set-ExecutionPolicy\s+(Unrestricted|Bypass))\b/i, 'turns off a protection (firewall, antivirus, execution policy)'],
  [/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, 'a fork bomb'],
];
// build output and caches: deleting them is routine, not a risk
const SCRATCH_DIR = /(^|[\/\\])(node_modules|dist|build|out|\.next|\.nuxt|target|coverage|tmp|\.cache|__pycache__|\.pytest_cache|\.turbo|\.parcel-cache|\.vite|\.gradle|bin|obj)([\/\\][^\s]*)?$/i;
const SCRATCH_TMP = /^(\/tmp\/|\/var\/tmp\/|\$\{?TMP(DIR)?\}?[\/\\]|%TEMP%|%TMP%|\$env:TEMP)/i;
const SCRATCH = { test: (x) => { const t = String(x).replace(/^["']|["']$/g, ''); return !/(^|[\/\\])\.\.([\/\\]|$)/.test(t) && (SCRATCH_DIR.test(t) || SCRATCH_TMP.test(t) || /\.lock$/.test(t)); } };
const SCRATCH_WORD = /\b(node_modules|dist|build|coverage|__pycache__|\.cache|\.next|tmp)\b/;
const WHOLE = /^["']?(\/|~|~\/|\$HOME|\$\{HOME\}|\*|\.|\.\.|\.\/|\.\/\*|\.\.\/|\/\*|[A-Za-z]:[\\\/]?|\/(home|etc|usr|var|root|boot|bin|lib|opt)(\/\*)?)["']?$/;
const words = (s) => (s.match(/"[^"]*"|'[^']*'|\S+/g) || []);
// rm, rmdir /s, del /s, Remove-Item -Recurse, find -delete: what is deleted, and is it more than a cache
function deletion(part) {
  const p = part.trim().replace(/^[({!\s]+/, '');
  let m, flags, targets;
  const classify = (t) => t.some(x => WHOLE.test(x)) ? 'deletes a whole tree (rm -rf on /, ~, * or ..)' : t.length && t.every(x => SCRATCH.test(x)) ? '' : 'deletes files recursively without asking (rm -rf)';
  // rm -r / -R / -rf / -fr / --recursive / PowerShell rm -Recurse, in command position (also after sudo, xargs, -exec)
  if ((m = p.match(/^(?:(?:sudo|doas|time|nohup|exec|command|xargs|env)\s+(?:-\S+\s+)*|\w+=\S*\s+)*(?:rm|ri|del|erase)\s+(.*)$/i) || p.match(/(?:-exec|-execdir|\|\s*xargs)(?:\s+-\S+)*\s+(?:rm|ri)\s+(.*)$/i))) {
    const w = words(m[1].replace(/\;.*$/, '').replace(/\s\{\}.*$/, ' {}'));
    flags = w.filter(x => /^-/.test(x)); targets = w.filter(x => !/^-|^\{\}$/.test(x)).map(x => x.replace(/^["']|["']$/g, ''));
    if (flags.some(f => /^--recursive$/.test(f) || /^-[a-zA-Z]*[rR]/.test(f) && !/^--/.test(f))) return classify(targets.length ? targets : ['{}']);
  }
  if ((m = p.match(/^(?:sudo\s+)?(rmdir|rd)\s+(.*)$/i)) && /(^|\s)\/s\b/i.test(m[2])) return classify(words(m[2]).filter(x => !/^\/[a-z]$/i.test(x)));
  if ((m = p.match(/^del(ete)?\s+(.*)$/i)) && /(^|\s)\/[sq]\b/i.test(m[2])) return classify(words(m[2]).filter(x => !/^\/[a-z]$/i.test(x)));
  if ((m = p.match(/^(?:Remove-Item|ri)\s+(.*)$/i)) && /(^|\s)-r(ecurse)?\b/i.test(m[1])) return classify(words(m[1]).filter(x => !/^-/.test(x)));
  if ((m = p.match(/\bfind\s+(\S+)([^|;&\n]{0,200})\s-delete\b/))) {
    const filtered = /\s-(i?name|i?path|regex|type|mtime|mmin|newer|size|empty|user)\b/.test(m[2]);
    return !filtered || /^["']?(\/|~|\$HOME|\.\.)/.test(m[1]) ? 'deletes files in bulk (find -delete)' : '';
  }
  // one-liners in a scripting language
  if (/\b(shutil\.)?rmtree\s*\(|\.(rmSync|rmdirSync)\s*\([^)]*recursive\s*:\s*true|\bFileUtils\.rm_rf|\bos\.removedirs\s*\(|\bRemove-Item\b[^|;&\n]{0,200}-Recurse/.test(p) && !SCRATCH_WORD.test(p)) return 'deletes a whole folder from a script (rmtree, rmSync)';
  return '';
}
const WRAPPER = /(?:^|[;&|(]\s{0,3})(?:sudo\s+(?:-\S+\s+)*)?(?:bash|sh|zsh|dash|ksh|ssh|eval|su|pwsh|powershell|cmd(?:\.exe)?|wsl|(?:docker|podman|kubectl)\s+exec)\b/i;
const clipLong = (c) => c.length > 20000 ? c.slice(0, 10000) + '\n' + c.slice(-10000) : c;
export function riskyCommand(cmd, depth = 0) {
  const c = clipLong(String(cmd || '')).replace(/(^|[\s"'(;&|])(?:\\|\/(?:usr\/)?s?bin\/)(rm|del|find|shred)\b/g, '$1$2');
  for (const part of c.split(/&&|\|\||;|\n/)) { const d = deletion(part); if (d) return d; }
  // a command handed to another shell ("bash -c '…'", "ssh host '…'") is read as well
  if (depth < 2 && WRAPPER.test(c)) for (const m of c.matchAll(/"([^"]{3,2000})"|'([^']{3,2000})'/g)) { const d = riskyCommand(m[1] || m[2], depth + 1); if (d) return d; }
  const flat = c.replace(/\\\r?\n/g, ' ');
  for (const [re, why] of RISKY) if (re.test(flat)) return why;
  return '';
}
// a shell script the agent writes: the same check, line by line
export function riskyScript(text) {
  const lines = String(text || '').split('\n', 600);
  for (const l of lines) { if (/^\s*(#|\/\/|rem\b|::)/i.test(l)) continue; const w = riskyCommand(l); if (w && !/^deletes (files recursively|a whole folder from a script)/.test(w)) return w; }   // a build script that cleans its own folders is routine
  return '';
}

// secrets that should never sit in a command line or a file the agent writes.
// every pattern ends in the secret itself (its tail may be a lookahead), so masking is: keep what comes before it, shorten it
const KEYS = '(?:password|passwd|passphrase|pwd|secret|secret[_-]?key|api[_-]?key|apikey|access[_-]?key|private[_-]?key|[_-]token)';
// case-insensitive words without the i flag (the camelCase test below needs to tell upper from lower case)
const ci = (src) => src.replace(/\\.|[a-z]/g, (c) => c.length > 1 ? c : '[' + c + c.toUpperCase() + ']');
const PLACEHOLDER = ci(String.raw`(?!(?:pass(?:word|w0rd)?|admin|root|secret|test|user|example|changeme|letmein|qwerty|hunter2|12345)\w{0,4}(?![^\s"'&;,@]))`);
const NOT_A_TEMPLATE = ci(String.raw`(?!\$|<|\{|\*{3}|x{3}|your|changeme|example)`);
const NOT_CODE = ci(String.raw`(?!\$|<|\{|\*{3}|x{3}|your|changeme|example|process\.|os\.environ|getenv|env\[|null|none|true|false|undefined|\[)`) + String.raw`(?!(?:[A-Za-z_]\w*(?:\.\w+)+|[a-z]+[A-Z][A-Za-z]*|[A-Za-z]+_[A-Za-z_]*)(?![^\s"'&;,]))`;
// a quoted value, or an unquoted one that is not just a variable or a call (req.body.password, getpass())
const PASSWORD_RE = new RegExp(ci(KEYS) + String.raw`["']?\s{0,3}[=:]\s{0,3}(?:"` + NOT_A_TEMPLATE + PLACEHOLDER + String.raw`([^"\s]{8,})|'` + NOT_A_TEMPLATE + PLACEHOLDER + String.raw`([^'\s]{8,})|` + NOT_CODE + PLACEHOLDER + String.raw`([^\s"'&;,()\[\]{}<>]{8,})(?=[\s"'&;,)\]}]|$))`, 'g');
const SECRETS = [
  ['AWS access key', /\b(?:AKIA|ASIA)(?![0-9A-Z]{0,16}EXAMPLE)[0-9A-Z]{16}\b/g],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/g],
  ['GitLab token', /\bglpat-[A-Za-z0-9_-]{20,}/g],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/g],
  ['Hugging Face token', /\bhf_[A-Za-z0-9]{30,}\b/g],
  ['PyPI token', /\bpypi-[A-Za-z0-9_-]{50,}/g],
  ['Docker token', /\bdckr_pat_[A-Za-z0-9_-]{20,}/g],
  ['SendGrid key', /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g],
  ['API key', /\b(?!sk-(?:ant-|proj-|live-)?[xX*.-]{8,})sk-(?:ant-|proj-|live-)?[A-Za-z0-9_-]{24,}\b/g],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g],
  ['Slack webhook', /\bhooks\.slack\.com\/services\/[A-Z0-9]{6,}\/[A-Z0-9]{6,}\/[A-Za-z0-9]{16,}/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['Google OAuth token', /\b(?:ya29\.|GOCSPX-)[A-Za-z0-9_-]{20,}/g],
  ['Stripe key', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----[A-Za-z0-9+\/=\s\\]{0,6000}(?:-----END [A-Z ]{0,30}PRIVATE KEY(?: BLOCK)?-----)?/g],
  ['JSON web token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
  ['storage account key', /\b(?:AccountKey|SharedAccessKey)=[A-Za-z0-9+\/]{40,}={0,2}/g],
  ['password', PASSWORD_RE],
  ['password in a web address', /\b[a-z][a-z0-9+.-]{1,15}:\/\/[^\s:@\/'"]{0,64}:(?!\$|\{|<)(?!(?:pass(?:word|w0rd)?|admin|root|secret|test|user|example|changeme|12345\w{0,4})@)((?:[^\s\/'"@]|@(?=[^\s\/'"@]{0,128}@)){3,128})(?=@)/gi],
  ['password on a command line', /\b(?:mysql|mysqldump|mysqladmin|mariadb)\b[^|;&\n]{0,200}?\s-p["']?(?!(?:pass(?:word)?|admin|root|secret|test|example|changeme|1234\w{0,4})(?![^\s"'|;&]))([^\s"'|;&]{3,})|\bsshpass\s+-p\s*["']?([^\s"'|;&]{3,})|\bcurl\b[^|;&\n]{0,200}?\s(?:-u|--user)\s+["']?[^\s:"']{1,64}:(?!\$|\{|<)(?!(?:pass(?:word)?|admin|root|secret|test|example|changeme|1234\w{0,4})(?![^\s"'|;&]))([^\s"'|;&]{3,})|--(?:password|passwd|token|api-key|secret|client-secret|access-token)(?:=|\s+)(?!-|\$|<|\{)([^\s"'|;&]{6,})/gi],
  ['bearer token', /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]{24,}=*/g],
];
export function findSecrets(text) {
  const t = String(text || '').slice(0, 400000), out = [];
  for (const [kind, re] of SECRETS) { re.lastIndex = 0; if (re.test(t)) out.push(kind); }
  return out;
}
// shows enough to recognise the secret, never the secret itself
export function maskSecrets(text) {
  let t = String(text == null ? '' : text);
  for (const [kind, re] of SECRETS) {
    re.lastIndex = 0;
    t = t.replace(re, (m, ...g) => {
      const caps = g.slice(0, g.findIndex(x => typeof x === 'number')).filter(x => typeof x === 'string' && x);
      const v = caps.length ? caps[caps.length - 1] : m, i = m.lastIndexOf(v);
      if (v.includes('…')) return m;   // already masked
      return m.slice(0, i) + (v.length > 12 ? v.slice(0, 4) : v.slice(0, 2)) + '…' + '•'.repeat(6) + m.slice(i + v.length);
    });
  }
  // what is left of a key that an earlier step cut short ("ghp_A1b2C3…")
  return t.replace(/\b(gh[pousr]_|github_pat_|glpat-|npm_|hf_|sk-ant-|sk-proj-|sk-live-|[sr]k_(?:live|test)_|xox[abprs]-|AKIA|ASIA|AIza)[A-Za-z0-9_-]{3,}(?=…)/g, '$1…' + '•'.repeat(6));
}

// prompt injection: untrusted content followed by something an attacker would want
export const UNTRUSTED_TOOLS = /^(WebFetch|WebSearch)$|^mcp__(?!memory__)[\w-]*?(fetch|browse|navigate|read_page|get_page|search|scrape|crawl|e?mail|message|slack|issue|comment|pull_request|get_pr\b|review|retrieve|ticket|thread|channel|inbox|document|download|http|web|rss|feed|url|page|notion|jira|confluence|discord|telegram|whatsapp)/i;
const SENSITIVE_PATH = /(^|[\/\\])(\.ssh|\.aws|\.gnupg|\.kube|\.docker[\/\\]config\.json|\.netrc|\.npmrc|\.pypirc|\.pgpass|\.git-credentials|id_(rsa|ed25519|ecdsa|dsa)|credentials(\.json)?|\.env(\.[\w-]+)?|secrets?\.(json|ya?ml|toml)|keychain|Login Data|Cookies|\.azure|\.config[\/\\]gcloud|\.config[\/\\]gh|wallet\.dat|\.vault-token|\.terraformrc|terraform\.tfstate|\.kdbx?)([\/\\]|$)/i;
export function sensitivePath(p) { return SENSITIVE_PATH.test(String(p || '')); }
const SINKS = /\b(webhook\.site|pastebin\.com|transfer\.sh|requestbin\.\w+|pipedream\.net|ngrok(-free)?\.(io|app|dev)|interact\.sh|oast\.\w+|burpcollaborator|0x0\.st|file\.io|paste\.rs|hastebin|ix\.io|termbin\.com)\b/i;
const EGRESS = /\b(curl|wget|http|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b[^|;&\n]{0,200}(\s-X\s*(POST|PUT|PATCH)|\s(-d|--data(-\w+)?|--upload-file|-F|--form|-T|--post-data|--post-file|-Body|-InFile)\b)|\b(curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^;&\n]{0,200}(\$\(|`)\s*(cat|type|gc|Get-Content|base64|env|printenv)\b|\b(nc|ncat|netcat|socat)\b\s+\S+\s+\d+|\bscp\b[^|;&\n]{0,200}\s\S+@?\S+:|\brsync\b[^|;&\n]{0,200}\s\S+:\S*|\bsftp\b|\bgit\s+push\b[^|;&\n]{0,200}(https?:\/\/|git@|ssh:\/\/)|\bgit\s+remote\s+(add|set-url)\s+\S+\s+(https?:|git@|ssh:)|\b(python3?|node|ruby|perl|php|pwsh|powershell)\b[^\n]{0,200}(requests\.(post|put|patch)|urllib\.request|urlopen\s*\(|http\.client|\bfetch\s*\(|axios\.(post|put)|https?\.request|Net::HTTP|Invoke-RestMethod|Invoke-WebRequest|WebClient|UploadString|UploadFile|socket\.connect|net\.connect)|\bgh\s+(gist\s+create|issue\s+(create|comment)|pr\s+(create|comment))\b[^|;&\n]{0,200}(--body-file|-F\b|\.env|\bgist\b)|\baws\s+s3\s+(cp|mv|sync)\b[^|;&\n]{0,200}\ss3:\/\/|\bgsutil\s+(-m\s+)?(cp|rsync|mv)\b[^|;&\n]{0,200}\sgs:\/\/|\baz\s+storage\s+blob\s+upload|\brclone\s+(copy|sync|move)\b|\b(Send-MailMessage|sendmail|mutt|mailx?)\b|\b(nslookup|dig|host)\b[^;&\n]{0,200}\$\(/i;
export function egressCommand(cmd) { const c = clipLong(String(cmd || '')); return EGRESS.test(c) || SINKS.test(c); }
const DUMP_NAME = '(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL)';
const SECRET_DUMP = new RegExp('\\b(printenv|env)\\s*($|\\||>)|^\\s*set\\s*($|\\||>)|\\b(Get-ChildItem|gci|ls|dir)\\s+(\\$?env:|Env:)|\\b(cat|type|gc|Get-Content|more|less|head|tail|bat|strings|xxd)\\b[^|;&\\n]*(\\.env\\b|id_rsa|id_ed25519|credentials|\\.npmrc|\\.netrc|\\.pgpass|\\.git-credentials|\\.aws[\\\\/]|\\.ssh[\\\\/]|\\.kube[\\\\/]config|\\.vault-token)|\\.envrc\\b|\\/proc\\/(?:self|\\d+)\\/environ|\\bprintenv\\s+\\w{0,40}(?:SECRET|TOKEN|PASSWORD|KEY)|\\bsecurity\\s+(find-(generic|internet)-password|dump-keychain)|\\bgpg\\s+--export-secret|\\b(echo|printf|Write-Output|Write-Host|print)\\b[^;&\\n]*(\\$\\{?\\w{0,40}' + DUMP_NAME + '|\\$env:\\w{0,40}' + DUMP_NAME + ')|\\b(grep|rg|egrep|findstr|Select-String|ag)\\b[^;&\\n]*\\b\\w{0,40}' + DUMP_NAME + '\\b|\\bcmdkey\\s+/list|\\bvaultcmd\\b|\\b(mimikatz|lazagne)\\b|\\bkubectl\\s+get\\s+secrets?\\b|\\baws\\s+secretsmanager\\s+get-secret-value|\\baws\\s+ssm\\s+get-parameters?\\b[^|;&\\n]*--with-decryption|\\bvault\\s+(kv\\s+get|read)\\b|\\bgh\\s+auth\\s+token\\b|\\baz\\s+account\\s+get-access-token|\\bgcloud\\s+auth\\b[^|;&\\n]*print-(access-)?token', 'im');
export function secretDump(cmd) { return SECRET_DUMP.test(clipLong(String(cmd || ''))); }
const PERSIST = /(>>?|\btee\b[^|;&\n]{0,200}|Add-Content\b[^|;&\n]{0,200}|Set-Content\b[^|;&\n]{0,200}|Out-File\b[^|;&\n]{0,200})\s*"?~?\/?[^\s|;&"]*(\.bashrc|\.zshrc|\.profile|\.bash_profile|\.zprofile|\.bash_login|crontab|\/etc\/cron|\/etc\/systemd|authorized_keys|LaunchAgents|LaunchDaemons|[\\\/]Startup[\\\/]|\.git[\\\/]hooks[\\\/]|PowerShell_profile\.ps1|[\\\/]profile\.ps1|\$PROFILE|\.config\/autostart|\.config\/systemd)|\bcrontab\s+(-[a-z]*(\s|$)|[^\s-])|config\.fish|\b(cp|mv|install|ln|rsync)\b[^|;&\n]{0,200}(authorized_keys|\.bashrc|\.zshrc|\.profile|LaunchAgents|\/etc\/cron)|\bschtasks\b|\bsystemctl\s+(--user\s+)?enable\b|\blaunchctl\s+(load|bootstrap)\b|\bRegister-ScheduledTask\b|\bNew-Service\b|\bsc(\.exe)?\s+create\b|\b(reg\s+add|Set-ItemProperty|New-ItemProperty)\b[^\n]*[\\\/]Run(Once)?\b|\bAdd-Content\s+\$PROFILE/i;
export function persistence(cmd) { return PERSIST.test(clipLong(String(cmd || ''))); }
// text that talks to the agent instead of to a reader
const INJECT_TEXT = /\b(ignore|disregard|forget|override)\s+(all\s+)?(of\s+)?(the\s+|your\s+|any\s+)?(previous|prior|above|earlier|preceding|system)\s+(instructions?|prompts?|rules|messages)|\bdisregard (the )?(above|everything)\b|\bforget (everything|all) (you|that)\b|\[\/?INST\]|<\|im_start\|>|###\s*(instruction|system)\s*:|\byou are now\s+(?:an?\s+)?(?:\w+\s+){0,2}(?:ai|assistant|agent|bot|dan|unrestricted|jailbroken|root|admin|in developer mode)\b|\bnew (system\s+)?(instructions|prompt)\s*:\s*(you|ignore|from now|disregard|forget|your)|\b(reveal|print|show|repeat|output|leak|ignore|override|replace|reset|disregard)\b[^.\n]{0,30}\bsystem prompt\b|<\/?(system|assistant|instructions?)>|\bdo not (tell|inform|mention|reveal|show|let)\b[^.\n]{0,40}\b(user|human|operator|owner)\b|\bwithout (telling|informing|asking|notifying|alerting) (the )?(user|human)\b|\bfrom now on\b[^.\n]{0,50}\b(you\s+(must|will|shall|should|are|have to|need to|only|never|always)|ignore|disregard|obey|respond|answer|act|behave)\b|\bnote to (the )?(ai|llm|assistant|agent|claude|model)\b|\binstructions? (for|to) (the )?(ai|llm|assistant|agent|claude|model)\b|\b(ai|llm|claude|gpt|copilot)\s*(assistants?|agents?|models?|systems?)?\s+(that are\s+|who are\s+|which are\s+)?(is\s+|are\s+)?(reading|processing|summari[sz]ing|browsing|analy[sz]ing)\b[^.\n]{0,60}\b(must|should|need to|now|please|are (required|instructed|ordered) to|will)\b|\b(ai|llm)\s+(assistants?|agents?|models?|bots?|systems?)\s+(must|should|need to|are (required|instructed|ordered) to|will|reading|processing|visiting|browsing|summari[sz]ing|analy[sz]ing)\b|\bif you are (an? )?(ai|llm|language model|ai assistant|bot)\b(?!\s+(?:model\s+)?(?:provider|vendor|company|researcher|developer))|(^|\n)\s*(important|attention|urgent)\s*[:!-]\s*(ai|llm|assistant|agents?|claude)\b|\b(bypass|disable|turn off|override)\b[^.\n]{0,30}\b(your|all|any)\s+(safety|guardrails?|restrictions?|safeguards|content filters?)\b|\bexfiltrat\w*\b[^.\n]{0,40}\bto\b/i;
const INJECT_TR = /(önceki|yukarıdaki|bütün|tüm|şimdiye kadarki)\s+(talimatları|komutları|kuralları|yönergeleri|mesajları)\s+(yok say|unut|görmezden gel|geçersiz say)|yapay zek[aâ]\w*\s[^.\n]{0,50}(yapmalı|gerekir|zorunda|mutlaka)|kullanıcıya\s+(söyleme|belli etme|bildirme|haber verme)|artık sen\b|yeni talimat(lar)?\s*[:：]|sistem (istemi|talimatı)/iu;
export function injectionText(text) { const t = String(text || '').slice(0, 60000); return INJECT_TEXT.test(t) || INJECT_TR.test(t); }

// how this turn's cost compares with the project's recent turns (needs three earlier turns that cost something)
export function costCompare(cost, reports, self) {
  const prev = (reports || []).filter(x => x !== self && x && x.cost > 0).slice(-12);
  if (!(cost > 0) || prev.length < 3) return null;
  const avg = prev.reduce((n, x) => n + x.cost, 0) / prev.length;
  return { avg, n: prev.length, ratio: cost / avg };
}
// "this is normal here": what a finding is, without the details that change from one time to the next
export function muteKey(f) { return [f && f.group || 'reality', f && f.kind || '', f && f.sig || ''].join('/'); }

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

// ---------- what a command line is: tests, builds ----------
// test and build commands (what "ran the tests" means). Bounded quantifiers only: these run on every command line.
export const TEST_CMD = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|t|tst|build|lint|typecheck|check|ci|verify|validate)\b|\bnpx\s+(-\w+\s+)*(playwright|vitest|jest|cypress|mocha|tsc|eslint|ava|tap)\b|\bnode\s+(--test\b|[^\s|;&]{0,80}\btests?[\/\\.][^\s|;&]{0,80}|[^\s|;&]{0,80}[\/\\]?(run-tests?|tests?)\.m?[jt]s\b)|\b(pytest|py\.test|jest|vitest|mocha|phpunit|pest|rspec|tsc|eslint|ruff|mypy|pyright|flake8|pylint|tox|nox|ctest|cypress\s+run|phpstan|golangci-lint|rubocop|bats)\b|\bpython3?\s+-m\s+(pytest|unittest|tox|mypy|ruff)\b|\bpython3?\s+(?:[^\s|;&]{0,80}[\/\\])?(test_?\w{0,40}|\w{0,40}_test|tests?)\.py\b|\bgo\s+(test|build|vet)\b|\bcargo\s+(test|build|check|clippy|nextest)\b|\bdotnet\s+(test|build)\b|\b(deno|zig|swift|flutter|dart)\s+(test|build|check|lint|analyze)\b|\bphp\s+artisan\s+test\b|\b(\.[\/\\])?(gradlew?|mvnw?|mvn|gradle)(\.bat)?\s+\S{0,30}\b(test|build|check|verify|assemble|package)\b|\b(mvn|gradle|make)\b|\b(rake|mix|bundle\s+exec\s+rake|bundle\s+exec)\s+(test|spec|rspec)\b|\bbazel\s+(test|build)\b|\bInvoke-Pester\b|\b(pwsh|powershell)(\.exe)?\b[^|;&\n]{0,120}\btests?\w{0,20}\.ps1\b|\bansible-playbook\b[^|;&\n]{0,80}--(check|syntax-check)\b|\bansible-lint\b|\b(yamllint|shellcheck|hadolint|tflint|terraform\s+(validate|fmt\s+-check))\b/i;
export const TESTS_ONLY = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|t)\b|\bnpx\s+(-\w+\s+)*(playwright|vitest|jest|cypress|mocha|ava|tap)\s+(test|run)?\b|\bnode\s+(--test\b|[^\s|;&]{0,80}\btests?[\/\\.][^\s|;&]{0,80})|\b(pytest|py\.test|jest|vitest|mocha|phpunit|pest|rspec|ctest|tox|nox)\b|\bpython3?\s+-m\s+(pytest|unittest)\b|\bgo\s+test\b|\bcargo\s+(test|nextest)\b|\bdotnet\s+test\b|\b(deno|swift|flutter|dart|zig)\s+test\b|\bphp\s+artisan\s+test\b|\b(gradlew?|mvnw?)(\.bat)?\s+\S{0,30}\btest\b|\bInvoke-Pester\b|\b(rake|mix)\s+test\b/i;

// ---------- what Claude says it achieved ----------
// Turkish letters are not \w in JavaScript, so those patterns use lookarounds instead of \b
const B = '(?<![\\p{L}\\p{N}_])', E = '(?![\\p{L}\\p{N}_])';
const rx = (src) => new RegExp(src.replace(/<B>/g, B).replace(/<E>/g, E), 'iu');
const OK = '(?:pass(?:es|ed|ing)?|green|succeed(?:s|ed)?|work(?:s|ed|ing)?|clean|fine|ok(?:ay)?)';
const CLAIM_TESTS = [
  rx('<B>(?:tests?|test suite|test-suite|specs?|unit tests?|e2e tests?|checks?|ci)\\s+(?:(?:(?:are|is|now|all|also|both|again|have|has|been|finally|successfully)\\s+)*(?:pass(?:es|ed)?|green|succeed(?:s|ed)?)|(?:(?:are|is|now|all|also|still|again)\\s+)+passing)<E>'),
  rx('<B>(?:all|everything)\\s+(?:(?:is|are|now|tests?|checks?)\\s+)*(?:pass(?:es|ed|ing)?|green)<E>'),
  rx('<B>(?:no|zero|0)\\s+(?:test\\s+)?(?:failures?|failed(?:\\s+tests?)?|failing\\s+tests?)(?=\\s*(?:[.,;:!)]|$|remain|detected|found|reported))'),
  rx('<B>(\\d{1,5})\\s*(?:/|of|out of)\\s*\\1\\s+(?:tests?\\s+)?(?:pass(?:es|ed|ing)?|green)<E>'),
  rx('<B>tests?\\s+(?:suite\\s+)?(?:run\\s+)?(?:is|are)\\s+green<E>'),
  rx('<B>(?:tüm\\s+|bütün\\s+)?testler(?:in\\s+(?:hepsi|tamamı))?\\s+(?:(?:artık|şimdi|hepsi|başarıyla|sorunsuz)\\s+)*(?:geçiyor|geçti|geçiyorlar|başarılı|yeşil|sorunsuz)<E>'),
  rx('<B>test(?:ler)?\\s+(?:başarıyla\\s+)?(?:geçti|geçiyor)<E>'),
  rx('<B>(?:hiç|sıfır)\\s+(?:test\\s+)?(?:hata|başarısızlık)\\s*(?:yok|kalmadı)?<E>'),
];
const CLAIM_BUILD = [
  rx('<B>(?:the\\s+)?(?:build|compile|compilation|typecheck|type-check|type check|lint(?:ing)?)\\s+(?:now\\s+|also\\s+)?(?:succeeds|succeeded|passes|passed|is green|is clean|works|is fine|completes|completed|compiles)<E>'),
  rx('<B>(?:it\\s+)?(?:builds|compiles)\\s+(?:cleanly|successfully|fine|without errors)<E>'),
  rx('<B>(?:derleme|build|tip kontrolü)\\s+(?:artık\\s+)?(?:başarılı|geçti|geçiyor|sorunsuz|hatasız)<E>'),
];
const CLAIM_FIXED = [
  rx('<B>(?:i(?:\'ve| have)\\s+|we(?:\'ve| have)\\s+)?(?:fixed|resolved)\\s+(?:the|this|that|it|both|all|those|these|your)<E>'),
  rx('<B>(?:the\\s+)?(?:bug|issue|error|problem|failure|failures|crash)\\s+(?:is|are|has been|have been)\\s+(?:now\\s+)?(?:fixed|resolved|gone)<E>'),
  rx('<B>(?:(?:it\\s+)?now\\s+works|it\\s+works\\s+now|is\\s+now\\s+working)(?=\\s*(?:[.,;:!]|$|again|fine|correctly|as expected))'),
  rx('<B>(?:düzelttim|düzeltildi|çözüldü|çözdüm|giderildi|artık\\s+çalışıyor)<E>'),
];
// a sentence that doubts, conditions or reports a failure is not a claim of success
const NOT_A_CLAIM = rx('<B>(?:not|no longer|never|isn\'t|aren\'t|wasn\'t|weren\'t|doesn\'t|don\'t|didn\'t|won\'t|can\'t|couldn\'t|cannot|hasn\'t|haven\'t|fail(?:s|ed|ing|ure|ures)?|broken|errors?|still|except|unless|unable|if|whether|should|would|could|might|may|will|until|once|when|before|ensure|make sure|to see|want|need|needs|expect|expected|expects|hope|todo|yet|but|however|although|though|maybe|probably|apparently|require|requires|required|must|have to|has to|hopefully|neither|nor|goal|previously|formerly|used to|so far)<E>|n\'t<E>|\'ll<E>|<B>gonna<E>|<B>(?:başarısız|geçmiyor|geçmedi|geçmez|değil|hata(?:lar)?|kırık|çalışmıyor|maalesef|henüz|hâlâ|hala|ama|fakat|ancak|eğer|olursa|gerek(?:ir|li)?|lazım|yapmalı|sanırım|umarım|belki)<E>');
// an instruction or a request ("check that the build succeeds") says what should happen, not what did
const ASKING = /^\W*(check|verify|confirm|see|ensure|run|try|test|make sure|please|next step)\b|\b(to|will|you can|can you|please|then)\s+(check|verify|confirm|see|make sure|ensure)\b|\b(check|verify|confirm|ensure|make sure)\s+(that\s+)?(the|all|your)\b|\b(make|makes|making|get|gets|getting|keep|keeps)\s+(the\s+|all\s+|your\s+|these\s+|those\s+)?(\w+\s+){0,2}(tests?|specs?|suite|checks?|ci|build)\b[^.]{0,30}\b(pass|passing|green|succeed|work)/i;
const FAILWORD = /\b(fail(s|ed|ing|ure|ures)?|broken|errors?|red)\b/i;
function said(text, list, strict) {
  const t = String(text || '').slice(-4000).replace(/[\u2019\u2018]/g, "'"), sentences = t.split(/(?<=[.!?…])\s+|\n+/);
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    if (/\?\s*$/.test(sentence)) continue;   // a question is not a claim
    for (const re of list) {
      const m = re.exec(sentence);
      if (!m || ASKING.test(sentence) || NOT_A_CLAIM.test(sentence.slice(0, m.index) + ' ' + sentence.slice(m.index + m[0].length))) continue;
      // "tests pass for A. B fails." (a message that also reports a failure) is not an unqualified claim
      if (strict && sentences.some((o, j) => j !== i && FAILWORD.test(o))) continue;
      return true;
    }
  }
  return false;
}
// what the last message claims: tests pass, the build works, the problem is fixed
export function claimsOf(text) { return { tests: said(text, CLAIM_TESTS, true), build: said(text, CLAIM_BUILD, true), fixed: said(text, CLAIM_FIXED, false) }; }

// a recording you can share: what happened and when, with every name, path, prompt, address and secret taken out
// the program a command runs ("npm install", "git"), never its arguments
export function programOf(cmd) {
  const w = String(cmd || '').replace(/^\s*(sudo\s+|cd\s+\S+\s*(&&|;)\s*)+/, '').trim().split(/\s+/);
  const prog = (w[0] || '').split(/[\\/]/).pop();
  return /^[a-z][\w.-]*$/i.test(prog) ? prog + (w[1] && /^[a-z][\w:-]*$/.test(w[1]) && w[1].length < 16 ? ' ' + w[1] : '') : '';
}
// the same for a recording that leaves your machine: only well-known programs and their well-known verbs, nothing you named yourself
const VERBS = {
  npm: 'install|i|ci|run|test|build|start|publish|add|remove|exec|lint|dev|init|update|audit|pack|version',
  pnpm: 'install|i|run|test|build|start|add|remove|exec|lint|dev|update|dlx', yarn: 'install|run|test|build|start|add|remove|lint|dev|upgrade', bun: 'install|run|test|build|add|remove|x|dev',
  git: 'status|diff|add|commit|push|pull|fetch|checkout|switch|branch|merge|rebase|reset|stash|log|show|clone|tag|restore|clean|init|remote|cherry-pick|bisect|blame|mv|rm|config',
  docker: 'build|run|ps|images|pull|push|compose|exec|logs|stop|start|rm|rmi|system|volume|network|cp|inspect', podman: 'build|run|ps|images|pull|push|exec|logs|stop|rm',
  kubectl: 'get|apply|delete|describe|logs|exec|rollout|config|port-forward|top', pip: 'install|uninstall|list|freeze|show', pip3: 'install|uninstall|list|freeze|show',
  cargo: 'build|test|run|check|clippy|fmt|publish|add|doc', go: 'build|test|run|mod|vet|fmt|get|generate', dotnet: 'build|test|run|restore|publish|new|add',
  gh: 'pr|issue|repo|release|run|workflow|api|auth|gist', terraform: 'plan|apply|destroy|init|validate|fmt|output|state', make: '', brew: 'install|uninstall|update|upgrade|list',
  apt: 'install|remove|update|upgrade|search', 'apt-get': 'install|remove|update|upgrade', winget: 'install|uninstall|upgrade|list|search',
};
const PROGRAMS = new Set(('ls cat grep rg find sed awk curl wget mkdir rm cp mv chmod chown echo cd pwd make tsc eslint prettier pytest jest vitest mocha ruff mypy ansible ansible-playbook pwsh powershell cmd bash sh zsh python python3 py node deno ssh scp rsync tar unzip zip head tail wc sort uniq which where touch tree diff patch sudo test true false export set type dir copy move del rmdir rd ren more less sleep ping tsx npx pnpx uv uvx poetry pipx java javac mvn gradle gradlew ruby gem bundle rake php composer perl swift flutter dart lua psql mysql sqlite3 redis-cli aws gcloud az helm jq yq xargs tee date env printenv open xdg-open code cursor claude codex gemini aider ' +
  'Get-ChildItem Get-Content Set-Content Select-String Remove-Item Copy-Item Move-Item New-Item Test-Path Write-Host Write-Output Invoke-WebRequest Invoke-RestMethod Start-Process Get-Process Stop-Process Invoke-Pester ForEach-Object Where-Object').split(/\s+/));
export function sharedProgram(cmd) {
  const w = String(cmd || '').replace(/^\s*(sudo\s+|cd\s+\S+\s*(&&|;)\s*)+/, '').trim().split(/\s+/);
  const prog = (w[0] || '').split(/[\\/]/).pop().replace(/\.(exe|cmd|bat)$/i, '');
  if (!/^[A-Za-z][\w.-]*$/.test(prog)) return '';
  const key = PROGRAMS.has(prog) || PROGRAMS.has(prog.toLowerCase()) ? prog.toLowerCase() : Object.prototype.hasOwnProperty.call(VERBS, prog) ? prog : '';
  if (!key) return 'program';
  const v = VERBS[key];
  return v && w[1] && new RegExp('^(' + v + ')$').test(w[1]) ? key + ' ' + w[1] : key;
}
const TOOLS = new Set('Bash PowerShell Read Write Edit MultiEdit NotebookEdit NotebookRead Grep Glob WebFetch WebSearch Task Agent TodoWrite ExitPlanMode EnterPlanMode Skill SlashCommand BashOutput KillShell ToolSearch AskUserQuestion'.split(' '));
const AGENTS = new Set('claude claude-code aider codex gemini cursor cline goose opencode continue copilot amp windsurf roo kilo qwen'.split(' '));
const EXTS = /^\.(js|mjs|cjs|jsx|ts|tsx|py|go|rs|java|kt|rb|php|cs|c|cc|cpp|h|hpp|swift|json|ya?ml|toml|md|txt|css|scss|html|vue|svelte|sql|sh|ps1|bat|cmd|xml|csv|ini|lock|log|env|png|jpg|svg|pdf|docx?|xlsx?|pptx?)$/i;
const EVENTS = new Set('SessionStart SessionEnd UserPromptSubmit UserPromptExpansion PreToolUse PostToolUse PostToolUseFailure PermissionRequest PermissionDenied Notification Stop StopFailure SubagentStart SubagentStop PreCompact PostCompact Doubt MessageDisplay Message Elicitation ElicitationResult TaskCreated TaskCompleted TeammateIdle InstructionsLoaded ConfigChange CwdChanged FileChanged WorktreeCreate WorktreeRemove Setup'.split(' '));
const CATS = new Set('read write exec ops plan web agent mcp other'.split(' '));
const KINDS = new Set('nocommand noscript nopackage nomodule mismatch missing unread nopath nourl unfound ungrounded contradicted unproven risky secret chain injection alarm'.split(' '));
const NTYPES = new Set('permission_prompt idle_prompt auth_success elicitation_dialog'.split(' '));
// what a shared replay keeps: when, which tool and kind of work, a numbered file with its extension, and the kind of program a
// command ran. No project, file or folder names, no prompts, replies, queries, addresses, command arguments or names you chose.
export function scrubReplay(recs) {
  const t0 = recs.length ? recs[0].t : 0, ids = new Map(), agents = new Map(), files = new Map();
  const map = (m, k, p) => { if (!k) return ''; if (!m.has(k)) m.set(k, p + (m.size + 1)); return m.get(k); };
  const file = (p) => { const b = String(p || '').split(/[\\/]/).pop(); if (!b) return ''; const ext = (b.match(/\.[A-Za-z0-9]{1,6}$/) || [''])[0], keep = EXTS.test(ext) ? ext : ''; return map(files, p, 'file-') + keep; };
  const text = (r) => r.e === 'PreToolUse' && /^(Bash|PowerShell)$/.test(r.tool) ? sharedProgram(r.key) : '';
  return {
    format: 'agent-brain-replay', version: 2, project: 'project',
    events: recs.map(r => ({
      dt: r.t - t0, e: EVENTS.has(r.e) ? r.e : 'Event', tool: /^mcp__/.test(r.tool || '') ? 'mcp' : TOOLS.has(r.tool) ? r.tool : r.tool ? 'tool' : '', cat: CATS.has(r.cat) ? r.cat : r.cat ? 'other' : '', file: file(r.file),
      text: text(r), id: map(ids, r.id, 'c'), aid: map(agents, r.aid, 'a'), agent: AGENTS.has(String(r.agent || '').toLowerCase()) ? String(r.agent).toLowerCase() : r.agent ? 'agent' : '',
      kind: KINDS.has(r.kind) ? r.kind : '', group: /^(reality|guard|shield)$/.test(r.group || '') ? r.group : '', ntype: NTYPES.has(r.ntype) ? r.ntype : '',
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
