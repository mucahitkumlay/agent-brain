// Anatomy files missing from the plugin folder are fetched from the GitHub release once, checked and cached.
const fs = require('fs'), path = require('path');
global.window = { setTimeout: () => 0, setInterval: () => 0, clearInterval() {}, clearTimeout() {} };
global.document = { hasFocus: () => true };
const urls = [], written = {};
let tamper = false;
const Module = require('module'); const orig = Module._load;
Module._load = function (r, ...a) {
  if (r === 'obsidian') return {
    Plugin: class { constructor(app, m) { this.app = app; this.manifest = m; } }, ItemView: class {}, Notice: class {}, PluginSettingTab: class {}, Setting: class {}, setIcon() {},
    requestUrl: async ({ url }) => {
      urls.push(url);
      const buf = fs.readFileSync(path.join(__dirname, '../assets', url.split('/').pop()));
      if (tamper) buf[100] ^= 1;
      return { status: 200, arrayBuffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    },
  };
  return orig.call(this, r, ...a);
};
const Cls = require('../dist/main.js');
const app = { vault: { configDir: '.obsidian', adapter: { readBinary: async () => { throw new Error('missing'); }, writeBinary: async (p, ab) => { written[p] = ab.byteLength; } } } };
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
(async () => {
  const p = new (Cls.default || Cls)(app, { dir: '.obsidian/plugins/agent-brain', version: '0.8.0' });
  const mesh = await p.loadBrainMesh();
  ok(mesh && mesh.nv > 50000, 'brain mesh fetched and parsed: ' + (mesh && mesh.nv) + ' vertices');
  ok(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/download\/anatomy-\d+\/brain\.bin\.gz$/.test(urls[0]), 'from the anatomy release: ' + urls[0]);
  ok(written['.obsidian/plugins/agent-brain/brain.bin.gz'] > 0, 'cached in the plugin folder');
  const A = await p.loadAnatomy();
  ok(A.aal && A.inner && A.t1 && A.tracts, 'all anatomy layers fetched');
  tamper = true;
  let err = '';
  try { await p.fetchAsset('t1.bin.gz'); } catch (e) { err = String(e.message); }
  ok(/checksum/.test(err), 'a damaged download is refused: ' + err);
})();
