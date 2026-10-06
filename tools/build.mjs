// Build: dist/main.js (bundled with esbuild, minified, with a licence banner since the minifier drops the notices of
// what it bundles), plus manifest.json and styles.css next to it.  node tools/build.mjs [--watch]
// The full licence texts are in LICENSE and THIRD_PARTY_NOTICES.md.
import * as esbuild from 'esbuild';
import { readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url), at = (p) => fileURLToPath(new URL(p, root));
const pkg = JSON.parse(readFileSync(at('package.json'), 'utf8'));
const repo = String((pkg.repository && pkg.repository.url) || '').replace(/^.*github\.com[/:]/, '').replace(/\.git$/, '');
const watch = process.argv.includes('--watch');
const banner = `/*! Agent Brain ${pkg.version} | MIT licence | https://github.com/${repo}
 * Bundles three.js (MIT licence, Copyright 2010-2026 three.js authors).
 * Anatomy data (downloaded separately) has its own terms: ICBM152 2009 (MNI), AAL (GIN-IMN), HCP-1065 (CC BY-SA 4.0);
 * see THIRD_PARTY_NOTICES.md. Not affiliated with or endorsed by Anthropic or Obsidian. */`;
mkdirSync(at('dist'), { recursive: true });
const copy = () => { copyFileSync(at('manifest.json'), at('dist/manifest.json')); copyFileSync(at('src/styles.css'), at('dist/styles.css')); };
const options = {
  entryPoints: [at('src/main.js')],
  outfile: at('dist/main.js'),
  bundle: true,
  format: 'cjs',
  platform: 'node',          // Node built-ins (http, zlib, fs, os) stay external; Obsidian provides them on desktop
  target: 'es2021',
  external: ['obsidian', 'electron'],
  loader: { '.sh': 'text' }, // the server scripts are served by the plugin as text
  minify: !watch,
  legalComments: 'none',
  banner: { js: banner },
  logLevel: 'info',
};
if (watch) {
  const ctx = await esbuild.context({ ...options, plugins: [{ name: 'copy', setup(b) { b.onEnd(copy); } }] });
  await ctx.watch();
} else {
  await esbuild.build(options);
  copy();
}
