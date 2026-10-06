// Runs every test file in this folder against dist/main.js (build first: bun run build).
import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const dir = new URL('.', import.meta.url).pathname;
if (!existsSync(new URL('../dist/main.js', import.meta.url))) { console.error('dist/main.js is missing: run the build first'); process.exit(1); }
let failed = 0;
for (const f of readdirSync(dir).filter(n => /\.test\.m?js$/.test(n)).sort()) {
  const r = spawnSync(process.execPath, [dir + f], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const bad = r.status !== 0 || /^FAIL/m.test(out);
  if (bad) failed++;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${f}`);
  if (bad || process.env.VERBOSE) console.log(out.split('\n').map(l => '     ' + l).join('\n'));
}
process.exit(failed ? 1 : 0);
