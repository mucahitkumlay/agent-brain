// the shareable replay page: self-contained, safe to open, shows only what the scrubbed data holds
import { replayHtml, scrubReplay } from '../src/insight.js';
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };

const recs = [
  { t: 1000, e: 'SessionStart' }, { t: 2000, e: 'UserPromptSubmit' },
  { t: 3000, e: 'PreToolUse', tool: 'Bash', cat: 'exec', id: 'x1', key: 'npm test', file: '' },
  { t: 4000, e: 'PreToolUse', tool: 'Read', cat: 'read', id: 'x2', file: 'C:\\Users\\me\\secret-project\\src\\billing.js' },
  { t: 5000, e: 'PostToolUseFailure', tool: 'Bash', cat: 'exec', id: 'x1' }, { t: 9000, e: 'Stop' },
];
const html = replayHtml(scrubReplay(recs));
ok(html.startsWith('<!doctype html>') && html.includes('</html>'), 'a whole page');
ok(!/https?:\/\//.test(html.replace(/http:\/\/www\.w3\.org\/(2000\/svg|1999\/xhtml)/g, '')), 'no address in it besides the SVG/XHTML namespaces');
ok(!/<script[^>]+src=|<link[^>]+href=|@import|url\(|fetch\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|document\.cookie|eval\(|new Function|innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'no outside loads, no storage, no way to run text as code');
ok(/Content-Security-Policy" content="default-src 'none'/.test(html), 'a policy that forbids everything but its own inline code');
ok(!html.includes('secret-project') && !html.includes('billing') && !html.includes('C:\\\\Users'), 'file and folder names never get in');
ok(html.includes('"PreToolUse"') && html.includes('"cat":"exec"'), 'the events are in it');

// a hostile data block cannot end the script or add markup
const evil = '</script><img src=x onerror=alert(1)>\u2028&';
const h2 = replayHtml({ events: [{ dt: 1, e: evil, tool: evil, text: evil, kind: evil, aid: evil, agent: evil }, null, 5, 'x', { dt: 'NaN', e: 'Stop' }, { dt: -5, e: 'Stop' }, { dt: 1e30, e: 'Stop' }] });
const block = h2.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/);
ok(block && !/[<>&\u2028\u2029]/.test(block[1]), 'nothing in the data can close the block or be read as markup');
ok((h2.match(/<\/script>/g) || []).length === 2 && !h2.includes('<img'), 'still exactly the page\'s own two script blocks');
const back = JSON.parse(block[1]);
ok(back.events.length === 7 && back.events[0].e === evil.slice(0, 40) && back.events.every(x => Number.isFinite(x.dt) && x.dt >= 0 && x.dt <= 6048e5), 'data round-trips; odd times are clamped');
ok(JSON.stringify(back.events[0]).length < 600, 'fields are cut to length');
ok(replayHtml(null).includes('"events":[]') && replayHtml({ events: 'no' }).includes('"events":[]') && replayHtml(undefined).includes('<title>'), 'empty or odd input still gives a page');
const many = replayHtml({ events: Array.from({ length: 30000 }, (_, i) => ({ dt: i, e: 'Stop' })) });
ok(JSON.parse(many.match(/id="data">([\s\S]*?)<\/script>/)[1]).events.length === 20000, 'at most 20000 events');
// the page's own script must at least compile (a syntax error would leave a dead page)
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
ok(scripts.length === 1, 'one script of its own');
let compiled = true; try { new Function(scripts[0]); } catch (e) { compiled = false; console.log(e.message); }
ok(compiled, 'the page script compiles');
// the replacement is literal: a "$&" in the data stays as it is
const h3 = replayHtml({ events: [{ dt: 0, e: 'Stop', text: '$& $1 $`' }] });
const h4 = replayHtml({ events: [{ dt: 0, e: 'Stop', text: '$` $\' $& $1' }] });
ok((h4.match(/<!doctype html>/g) || []).length === 1 && (h4.match(/<\/html>/g) || []).length === 1 && h4.length === html.length + h4.split('id="data">')[1].split('</script>')[0].length - html.split('id="data">')[1].split('</script>')[0].length, 'dollar patterns in the data are not expanded: the page is not duplicated');
ok(h3.length > 0 && h3.includes('$\\u0026'), 'and the data keeps them (as text)');
