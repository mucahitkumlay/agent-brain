// What a tool call actually does, so the brain lights the matching region:
// read (temporal) · write (motor) · web (occipital) · ops (cerebellum) · exec (frontal).
// Bash and PowerShell are classified from the command text; MCP tools from their verb.

const READ_CMDS = new Set(('cat bat less more head tail ls ll la dir tree find fd locate grep egrep fgrep rg ag ack wc sort uniq cut tr column ' +
  'diff cmp comm jq yq xmllint md5sum sha1sum sha256sum base64 hexdump xxd od strings readlink realpath basename dirname pwd stat file ' +
  'du df free uptime w who whoami id groups last uname hostname date cal env printenv which whereis type history ' +
  'ps pgrep top htop btop atop iotop vmstat iostat mpstat sar lsof ss netstat ifconfig ip route arp lsblk blkid findmnt lscpu lsmod lspci lsusb ' +
  'nproc getent journalctl dmesg nvidia-smi sensors tldr man help echo printf').split(' '));
const WRITE_CMDS = new Set(('rm rmdir mv cp mkdir touch ln chmod chown chgrp install truncate dd shred patch unzip gunzip gzip zip bzip2 xz ' +
  'vim vi nvim nano emacs code tee').split(' '));
const WEB_CMDS = new Set(('curl wget http https httpie xh ssh scp sftp ftp ping ping6 traceroute tracepath mtr dig nslookup host whois ' +
  'nc ncat netcat telnet nmap aria2c gh openssl').split(' '));
const OPS_CMDS = new Set(('kill pkill killall reboot shutdown poweroff halt useradd userdel usermod groupadd groupdel passwd chpasswd visudo ' +
  'ufw iptables ip6tables nft firewall-cmd certbot nginx apachectl apache2ctl a2enmod a2dismod a2ensite a2dissite pm2 supervisorctl ' +
  'umount swapon swapoff modprobe rmmod update-alternatives ldconfig systemd-run at launchctl chkconfig update-rc.d flatpak snap ' +
  'ansible ansible-playbook vagrant virsh qm pct lxc incus').split(' '));
const PKG = new Set('apt apt-get aptitude dnf yum zypper pacman apk brew port'.split(' '));
const JS_PM = new Set('npm pnpm yarn bun'.split(' '));
const RUN_CMDS = new Set(('node python python3 py ruby perl php java go cargo rustc gcc g++ clang make cmake ninja mvn gradle dotnet deno ' +
  'tsc npx jest vitest pytest mocha tox nox playwright cypress psql mysql sqlite3 redis-cli mongosh bash sh zsh fish source').split(' '));
const IGNORE = new Set('cd pushd popd export unset set true false sleep clear wait read test [ [[ : exit return alias local declare shopt trap'.split(' '));

const RANK = { read: 1, exec: 2, web: 3, ops: 4, write: 5 };

// options that take a value (so "git -C /srv/app pull" finds "pull", "npm --prefix dir ci" finds "ci")
const VALUE_OPTS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--prefix', '--dir', '--cwd', '--filter', '-F', '-w', '--workspace',
  '-f', '--file', '-n', '--namespace', '--context', '-p', '--project-name', '--env-file', '-H', '--host', '--kubeconfig']);
function firstArg(words, i) {
  for (; i < words.length; i++) {
    const x = words[i];
    if (VALUE_OPTS.has(x)) { i++; continue; }
    if (!x.startsWith('-')) return x;
  }
  return '';
}

function simpleCategory(seg) {
  let w = seg.trim().split(/\s+/).filter(Boolean);
  // wrappers: env assignments, sudo, time, nohup, timeout N, xargs, watch …
  for (let guard = 0; guard < 8 && w.length; guard++) {
    const h = w[0];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(h)) { w.shift(); continue; }
    if (h === 'sudo' || h === 'doas') { w.shift(); while (w.length && w[0].startsWith('-')) { const f = w.shift(); if (/^-[ugCh]$/.test(f)) w.shift(); } continue; }
    if (/^(time|nohup|nice|ionice|exec|command|builtin|env|stdbuf|xargs|watch|unbuffer|caffeinate)$/.test(h)) { w.shift(); while (w.length && w[0].startsWith('-')) w.shift(); continue; }
    if (h === 'timeout') { w.shift(); while (w.length && (w[0].startsWith('-') || /^\d/.test(w[0]))) w.shift(); continue; }
    break;
  }
  if (!w.length) return null;
  const c = w[0].replace(/^.*\//, '').toLowerCase();
  const sub = firstArg(w, 1).toLowerCase();
  const has = (re) => w.slice(1).some(x => re.test(x));
  if (!c || IGNORE.has(c)) return null;
  if (c.startsWith('./') || w[0].startsWith('./') || /\.(sh|py|js|ts|rb|pl)$/.test(c)) return 'exec';
  if (c === 'git') {
    if (/^(clone|pull|push|fetch|ls-remote)$/.test(sub)) return 'web';
    if (/^(status|log|diff|show|branch|blame|grep|ls-files|ls-tree|rev-parse|describe|shortlog|reflog|remote|config|whatchanged|cat-file|for-each-ref|worktree|help|version|)$/.test(sub)) return 'read';
    return 'write';
  }
  if (c === 'sed' || c === 'perl') return has(/^-[a-zA-Z]*i/) ? 'write' : c === 'perl' ? 'exec' : 'read';
  if (c === 'awk' || c === 'gawk') return has(/^inplace$/) ? 'write' : 'read';
  if (c === 'tar') { const m = (w[1] || '').replace(/^-/, ''); return (/^[a-zA-Z]*t[a-zA-Z]*$/.test(m) && !/[xc]/.test(m)) || has(/^--list$/) ? 'read' : 'write'; }
  if (c === 'rsync') return w.slice(1).some(x => /^[^-][^/]*:/.test(x)) ? 'web' : 'write';
  if (c === 'prettier' || c === 'eslint' || c === 'ruff' || c === 'black' || c === 'gofmt' || c === 'rustfmt' || c === 'isort') return has(/^(--write|-w|--fix|format)$/) || c === 'black' || c === 'isort' ? 'write' : 'exec';
  if (c === 'echo' || c === 'printf') return null;           // only matters with a redirect, handled below
  if (c === 'crontab') return has(/^-l$/) ? 'read' : 'ops';
  if (c === 'mount') return w.length > 1 ? 'ops' : 'read';
  if (c === 'sysctl') return has(/^-w$/) || w.slice(1).some(x => x.includes('=')) ? 'ops' : 'read';
  if (c === 'systemctl') return /^(status|is-active|is-enabled|is-failed|list-units|list-unit-files|list-timers|show|cat|--version|)$/.test(sub) ? 'read' : 'ops';
  if (c === 'service') return /status/.test(w.slice(1).join(' ')) ? 'read' : 'ops';
  if (c === 'timedatectl' || c === 'hostnamectl' || c === 'resolvectl' || c === 'loginctl') return /^set-/.test(sub) ? 'ops' : 'read';
  if (PKG.has(c)) return /^(list|search|show|info|policy|madison|depends|rdepends|query|provides|--version)$/.test(sub) ? 'read' : 'ops';
  if (c === 'pip' || c === 'pip3' || c === 'pipx' || c === 'uv' || c === 'poetry' || c === 'conda') {
    if (/^(run|exec)$/.test(sub)) return 'exec';
    return /^(list|show|freeze|search|info|check|tree|--version)$/.test(sub) ? 'read' : 'ops';
  }
  if (JS_PM.has(c)) {
    if (!sub || /^(install|i|ci|add|remove|rm|uninstall|un|update|up|upgrade|link|unlink|prune|dedupe|rebuild)$/.test(sub)) return c === 'bun' && !sub ? 'exec' : 'ops';
    if (/^(ls|list|outdated|view|info|why|explain|audit|whoami|config)$/.test(sub)) return 'read';
    return 'exec';
  }
  if (c === 'docker' || c === 'podman' || c === 'nerdctl') {
    let s2 = sub;
    if (s2 === 'compose') s2 = firstArg(w, w.indexOf('compose') + 1).toLowerCase();
    if (/^(ps|images|image|logs|inspect|stats|top|version|info|history|events|port|diff|config|ls)$/.test(s2)) return 'read';
    if (/^(exec|run)$/.test(s2) && s2 === 'exec') return 'exec';
    return 'ops';
  }
  if (c === 'kubectl' || c === 'oc' || c === 'helm' || c === 'k9s') {
    if (/^(get|describe|logs|top|explain|version|status|list|history|api-resources|cluster-info|show|template|diff)$/.test(sub)) return 'read';
    if (/^(exec|port-forward|proxy|cp|attach|debug|run)$/.test(sub)) return 'exec';
    return 'ops';
  }
  if (c === 'terraform' || c === 'tofu' || c === 'pulumi') return /^(plan|validate|show|output|state|fmt|version|graph|providers|preview)$/.test(sub) ? 'read' : 'ops';
  if (READ_CMDS.has(c)) return 'read';
  if (WRITE_CMDS.has(c)) return c === 'tee' ? 'tee' : 'write';
  if (WEB_CMDS.has(c)) return 'web';
  if (OPS_CMDS.has(c)) return 'ops';
  if (RUN_CMDS.has(c)) return 'exec';
  return 'exec';
}

export function bashCategory(cmd) {
  if (!cmd || typeof cmd !== 'string') return 'exec';
  const text = cmd.replace(/\\\n/g, ' ').replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\1\b/g, (m) => m.split('\n')[0]);   // drop heredoc bodies
  const plain = text.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, '""');   // quoted strings can't contain commands we care about
  let best = null, tee = false;
  for (const seg of plain.split(/\|\||&&|;|\n|\||\$\(|`|\(|\)/)) {
    const c = simpleCategory(seg);
    if (!c) continue;
    if (c === 'tee') { tee = true; continue; }
    if (!best || RANK[c] > RANK[best]) best = c;
  }
  // writing to a real file (">", ">>", tee) turns a read into a write; it doesn't outrank running, ops or network
  const redirect = /(^|[^0-9&<>])>>?\s*(?!&|\/dev\/(null|stderr|stdout|tty))[^\s|;&<>]/.test(plain);
  if ((redirect || tee) && (!best || best === 'read')) best = 'write';
  return best || 'exec';
}

// every command in a pipeline or chain, in order: [{ cat, cmd }] (cmd is the program name).
// Lets the brain show each step of "git pull && npm ci && npm test" instead of one blended signal.
export function bashParts(cmd, max) {
  max = max || 6;
  if (!cmd || typeof cmd !== 'string') return [];
  const text = cmd.replace(/\\\n/g, ' ').replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\1\b/g, (m) => m.split('\n')[0]);
  const plain = text.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, '""');
  const out = [];
  for (const seg of plain.split(/\|\||&&|;|\n|\||\$\(|`|\(|\)/)) {
    let c = simpleCategory(seg);
    if (!c) continue;
    if (c === 'tee') c = 'write';
    const w = seg.trim().split(/\s+/).filter(x => x && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(x) && !/^(sudo|doas|time|nohup|nice|timeout|env|xargs|exec|command)$/.test(x) && !/^-/.test(x) && !/^\d/.test(x));
    out.push({ cat: c, cmd: (w[0] || '').replace(/^.*\//, '') });
    if (out.length >= max) break;
  }
  const redirect = /(^|[^0-9&<>])>>?\s*(?!&|\/dev\/(null|stderr|stdout|tty))[^\s|;&<>]/.test(plain);
  if (redirect && out.length < max && !out.some(p => p.cat === 'write')) out.push({ cat: 'write', cmd: '>' });
  return out;
}

export function psCategory(cmd) {
  if (!cmd || typeof cmd !== 'string') return 'exec';
  const t = cmd.trim().toLowerCase();
  const v = (t.match(/^([a-z]+)-/) || [])[1] || t.split(/\s+/)[0];
  if (/^(set-content|add-content|out-file|new-item|remove-item|copy-item|move-item|rename-item|set-itemproperty|expand-archive|compress-archive)\b/.test(t)) return 'write';
  if (/^(invoke-webrequest|invoke-restmethod|test-connection|test-netconnection|resolve-dnsname|iwr|irm|curl|wget|ssh|scp)\b/.test(t)) return 'web';
  if (/^(start-service|stop-service|restart-service|set-service|install-|uninstall-|winget|choco|scoop|stop-process|restart-computer|enable-|disable-)/.test(t)) return 'ops';
  if (/^(get|select|where|measure|test|resolve|find|show|compare|read|format|sort|group)$/.test(v) || /^(dir|ls|cat|type|gc|gci|findstr|where)\b/.test(t)) return 'read';
  if (/^(set|new|remove|copy|move|rename|clear|add|update)$/.test(v)) return 'write';
  return bashCategory(cmd);
}

export function mcpCategory(name) {
  const parts = String(name).split('__');
  const server = (parts[1] || '').toLowerCase();
  const tool = parts.slice(2).join('_').toLowerCase().replace(/^[a-z]+_(?=(get|list|read|search|create|update|delete|write))/, '');
  const webServer = /(browser|chrome|playwright|puppeteer|selenium|firecrawl|brave|tavily|exa|search|fetch|web)/.test(server);
  if (/^(navigate|click|screenshot|computer|find|read_page|get_page|tabs?_|form_|scroll|type|hover|snapshot)/.test(tool) && webServer) return 'web';
  if (/^(get|list|read|search|find|fetch|query|describe|show|view|lookup|retrieve|download|count|inspect|check|whoami)/.test(tool)) return webServer && /^(fetch|search)/.test(tool) ? 'web' : 'read';
  if (/^(create|update|write|edit|delete|remove|add|set|put|patch|move|rename|upload|send|post|commit|merge|insert|append|replace|str_replace|apply|save|archive|close|assign)/.test(tool)) return 'write';
  if (webServer) return 'web';
  return 'mcp';
}
