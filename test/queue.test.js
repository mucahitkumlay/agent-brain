// the offline queue (scripts/brain-hook.sh): kept private to you, no prompt or reply text, no secrets, nothing whole beyond 2000 characters
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
if (process.platform === 'win32' || spawnSync('python3', ['-V']).status !== 0) { console.log('ok   skipped: needs sh and python3'); process.exit(0); }
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-q-')), bin = path.join(T, 'bin'), home = path.join(T, 'home');
fs.mkdirSync(bin); fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
fs.writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\necho 000\n', { mode: 0o755 });   // the listener is "down"
const ev = { hook_event_name: 'PreToolUse', session_id: 's', prompt: 'my private prompt', last_assistant_message: 'a private reply', tool_input: { command: 'mysql -pSuperSecret123 -e x; export DB_PASSWORD=hunter2hunter2; curl -H "Authorization: Bearer ' + 'a'.repeat(30) + '" https://x', file_path: '/a/b', content: 'x'.repeat(5000) }, tool_response: 'y'.repeat(900) };
const r = spawnSync('sh', [path.join(__dirname, '..', 'scripts', 'brain-hook.sh')], { input: JSON.stringify(ev), env: Object.assign({}, process.env, { HOME: home, PATH: bin + path.delimiter + process.env.PATH }), encoding: 'utf8' });
const q = path.join(home, '.claude', 'brain-queue.ndjson');
ok(r.status === 0 && fs.existsSync(q), 'an event is kept when the listener is down');
const line = fs.readFileSync(q, 'utf8'), d = JSON.parse(line.split('\t')[1]);
ok(!/private prompt|private reply/.test(line) && d.prompt === undefined && d.last_assistant_message === undefined, 'prompt and reply text are dropped');
ok(!/SuperSecret123|hunter2hunter2|aaaaaaaaaaaaaaaa/.test(line), 'passwords and tokens in the command are redacted');
ok(d.tool_input.content.length <= 2000 && d.tool_response.length <= 300 && d.tool_input.file_path === '/a/b', 'values are cut short, file names stay');
ok((fs.statSync(q).mode & 0o077) === 0, 'the queue file can be read by you only');
fs.rmSync(T, { recursive: true, force: true });
