// Security invariants (see CONTRIBUTING.md). If one of these fails, the change needs a maintainer's review, not a test edit.
const fs = require('fs'), path = require('path');
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const dist = read('dist/main.js');
const src = ['src/main.js', 'src/anatomy.js', 'src/intent.js', 'src/insight.js'].map(read).join('\n');
const code = src.replace(/(^|\s)\/\/.*$/gm, '$1');   // ignore comments

ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(dist), 'no HTML injection sinks: everything shown is set as text');
ok(!/\beval\s*\(|new Function\s*\(/.test(dist), 'no eval or new Function');
ok(!/child_process|\bexecSync\b|\bspawn\s*\(/.test(code), 'never runs programs');
ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|https?\.request\s*\(/.test(code), 'no network calls besides the one below');
const reqs = code.match(/requestUrl\s*\(/g) || [];
ok(reqs.length === 1 && /https:\/\/github\.com\/\$\{REPO\}\/releases\/download\/\$\{ASSET_RELEASE\}\//.test(code), 'one outgoing request: the anatomy files from this repository\'s anatomy release');
ok(/sha256/.test(code) && /did not match its checksum/.test(code), 'downloaded files are checked against built-in SHA-256 sums');
ok(/listen\(port, '127\.0\.0\.1'/.test(code), 'the listener binds to 127.0.0.1 only');
ok(/if \(!fromThisMachine\(req\.headers\)\)/.test(code), 'requests a web page could send are refused');
ok(!/res\.end\(\s*JSON\.stringify|"decision"|\bdecision\s*:|permissionDecision|continue\s*:\s*false|stopReason/.test(code), 'hook answers never carry a decision: it only watches');
ok(/coach: false/.test(code) && (code.match(/additionalContext/g) || []).length === 2 && /coachReply\(ev\) \{\n\s*if \(this\.settings\.coach !== true\) return '';/.test(code), 'the one exception, coach mode, is off by default and only ever adds context');
ok((code.match(/require\('fs'\)/g) || []).length === 1 && /function claudeSettings\(\) \{\n\s*const fs = require\('fs'\)/.test(code), 'Node\'s fs is required in exactly one place: the helper for Claude Code\'s settings file');
ok((code.match(/writeFileSync\(/g) || []).length === 1 && (code.match(/\b(readFileSync|readdirSync|readdir|createReadStream|createWriteStream|unlinkSync|rmSync|rmdirSync|renameSync|appendFileSync|statSync|lstatSync)\(/g) || []).length === 1 && /readFileSync\(file, 'utf8'\)/.test(code), 'that helper reads and writes one file (the settings, plus its backup); no listing, no deleting');
ok(/const file = path\.join\(process\.env\.CLAUDE_CONFIG_DIR \|\| path\.join\(os\.homedir\(\), '\.claude'\), 'settings\.json'\)/.test(code), 'the path is fixed: Claude Code\'s settings.json');
ok(!/clipboard\.(read|readText)\b/.test(code) && (code.match(/clipboard\.writeText\(/g) || []).length >= 1, 'the clipboard is only ever written to, never read');
ok(!/getFiles\(|getAllLoadedFiles\(|getAllFolders\(/.test(code) && (code.match(/getMarkdownFiles\(/g) || []).length === 2, 'the vault is listed for the notes only (the map\'s neurons), by path; file contents are never read in bulk');
ok(!/cachedRead\(/.test(code) && (code.match(/vault\.read\(/g) || []).length === 2, 'note contents are read in two places only: the plugin\'s own notes (daily and per session, one helper, to keep your "My notes" part) and the replay file you pick');
ok(!/saveData\([^)]*details/.test(code) && /saveData\(Object\.assign\(\{\}, this\.settings, \{ memory: this\.memory, learned: this\.learned, daily: this\.daily, engram: eng, regions: this\.regionMem, lessonsData: this\.lessons \|\| \{\}, usageData: this\.usage \|\| \[\], usageWeeks: this\.usageWeeks \|\| \{\} \}\)\)/.test(code) && /const entry = \{ t: rep\.t1, p: s\.project \|\| '', d: rep\.dur, w: rep\.wait, c: rep\.calls, f: rep\.fails, n: rep\.findings, k: kinds\.slice\(0, 12\), \$: [^,]+, ts: rep\.tests, e: rep\.files\.length, st: !!T\.stuck, cx: [^,]+, ap: ap\.slice\(0, 20\), pf: T\.pf \|\| null, cm: s\.hasCm \? 1 : 0, rt: rep\.retries, ch \};/.test(code) && /const ch = all > 0 \? Math\.round\(100 \* \(k1\.read - k0\.read\) \/ all\) \/ 100 : null;/.test(code) && !/pf = promptFeatures\(ev\.prompt\)[\s\S]{0,200}ev\.prompt\b(?!\))/.test(code), 'call details are never saved to data.json (lessons keep program names and file names only; usage keeps numbers, warning kinds and the first words of approved commands)');
ok(/out\.needsSwap = false/.test(code) && /this\.sceneRT = this\.composer\.readBuffer/.test(code), 'the scene is always drawn into the same multisampled buffer (no flicker between frames)');
