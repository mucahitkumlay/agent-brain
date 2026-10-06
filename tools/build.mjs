// Production build (bun tools/build.mjs): dist/main.js, minified, with a licence banner, since the minifier drops the
// notices of what it bundles. The full texts are in LICENSE and THIRD_PARTY_NOTICES.md.
const pkg = JSON.parse(await Bun.file(new URL('../package.json', import.meta.url)).text());
const repo = String((pkg.repository && pkg.repository.url) || '').replace(/^.*github\.com[/:]/, '').replace(/\.git$/, '');
const banner = `/*! Agent Brain ${pkg.version} | MIT licence | https://github.com/${repo}
 * Bundles three.js (MIT licence, Copyright 2010-2026 three.js authors).
 * Anatomy data (downloaded separately) has its own terms: ICBM152 2009 (MNI), AAL (GIN-IMN), HCP-1065 (CC BY-SA 4.0);
 * see THIRD_PARTY_NOTICES.md. Not affiliated with or endorsed by Anthropic or Obsidian. */`;
const r = await Bun.build({
  entrypoints: [new URL('../src/main.js', import.meta.url).pathname],
  outdir: new URL('../dist/', import.meta.url).pathname,
  target: 'node', format: 'cjs', minify: true, external: ['obsidian', 'http', 'zlib'], banner,
});
if (!r.success) { for (const m of r.logs) console.error(m); process.exit(1); }
for (const o of r.outputs) console.log(o.path.replace(/^.*\/dist\//, 'dist/'), (o.size / 1048576).toFixed(2) + ' MB');
