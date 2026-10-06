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
ok(/writeFileSync\(file, JSON\.stringify\(cfg/.test(code) && (code.match(/writeFileSync\(/g) || []).length === 2, 'files written outside Obsidian\'s API: only Claude Code\'s settings, on Install');
ok(!/saveData\([^)]*details/.test(code) && /saveData\(Object\.assign\(\{\}, this\.settings, \{ memory: this\.memory, learned: this\.learned, daily: this\.daily, engram: eng, regions: this\.regionMem, lessons: this\.lessons \|\| \{\} \}\)\)/.test(code), 'call details are never saved to data.json (lessons keep program names and file names only)');
ok(/out\.needsSwap = false/.test(code) && /this\.sceneRT = this\.composer\.readBuffer/.test(code), 'the scene is always drawn into the same multisampled buffer (no flicker between frames)');
