// Prepares dev/www/: a browser page that runs the plugin outside Obsidian (Obsidian is mocked), for working on
// the visuals. Build first (npm run build), then:  node dev/prepare.mjs && cd dev/www && python3 -m http.server 8799
// and open http://127.0.0.1:8799, then run  __cbStart()  in the console (plugin.runDemo() plays the demo).
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
const root = new URL('../', import.meta.url), out = new URL('www/', import.meta.url);
mkdirSync(out, { recursive: true });
copyFileSync(new URL('dist/main.js', root), new URL('main.js', out));
copyFileSync(new URL('src/styles.css', root), new URL('styles.css', out));
copyFileSync(new URL('index.html', import.meta.url), new URL('index.html', out));
for (const f of readdirSync(new URL('assets/', root)).filter(n => n.endsWith('.bin.gz')))
  writeFileSync(new URL(f.replace(/\.gz$/, ''), out), gunzipSync(readFileSync(new URL('assets/' + f, root))));
console.log('dev/www ready');
