// The page a shared replay opens in: one self-contained HTML file. No requests, no libraries, no cookies; it reads only the
// data inside it, which already went through scrubReplay (timing, tools and program names, nothing else). Everything is
// put on the page as text, never as markup. Written without template placeholders so it stays plain.
export const REPLAY_PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>Agent Brain replay</title>
<style>
:root { color-scheme: light dark; --bg: #f6f7f9; --ink: #1c2230; --mute: #5d667a; --hair: #d9dde6; --card: #ffffff; --accent: #2a62d9; }
@media (prefers-color-scheme: dark) { :root { --bg: #0b0d12; --ink: #e6eaf2; --mute: #98a2b8; --hair: #252b3a; --card: #12151d; --accent: #7aa2ff; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 960px; margin: 0 auto; padding: 24px 16px 40px; }
h1 { font-size: 20px; margin: 0 0 4px; }
.sub { color: var(--mute); margin: 0 0 18px; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin-bottom: 16px; }
.stat { background: var(--card); border: 1px solid var(--hair); border-radius: 10px; padding: 10px 12px; }
.stat b { display: block; font-size: 20px; font-variant-numeric: tabular-nums; }
.stat span { color: var(--mute); font-size: 12px; }
.card { background: var(--card); border: 1px solid var(--hair); border-radius: 12px; padding: 12px; margin-bottom: 14px; }
svg { width: 100%; height: auto; display: block; }
.controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 10px; }
button, select { font: inherit; color: var(--ink); background: var(--card); border: 1px solid var(--hair); border-radius: 8px; padding: 6px 12px; cursor: pointer; }
button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
input[type=range] { flex: 1 1 200px; accent-color: var(--accent); }
.clock { font-variant-numeric: tabular-nums; color: var(--mute); min-width: 7.5em; text-align: right; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: var(--mute); margin-top: 8px; }
.legend i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; vertical-align: baseline; }
ol { list-style: none; margin: 0; padding: 0; font-size: 13px; }
li { display: grid; grid-template-columns: 4.5em 5.5em 1fr; gap: 8px; padding: 3px 0; border-top: 1px solid var(--hair); }
li:first-child { border-top: 0; }
li .t { color: var(--mute); font-variant-numeric: tabular-nums; }
li .k { font-weight: 600; }
li .w { overflow-wrap: anywhere; }
li.bad .k, li.bad .w { color: #d55e00; }
footer { color: var(--mute); font-size: 12px; margin-top: 18px; }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
</style>
</head>
<body>
<main>
<h1>Agent Brain replay</h1>
<p class="sub" id="sub"></p>
<div class="stats" id="stats"></div>
<div class="card">
  <svg id="chart" role="img" aria-label="Timeline of the session: one row for each kind of work, one dot for each action" viewBox="0 0 900 260" preserveAspectRatio="xMidYMid meet"></svg>
  <div class="legend" id="legend"></div>
  <div class="controls">
    <button id="play" type="button">Play</button>
    <label>Speed <select id="speed"><option value="1">1x</option><option value="10">10x</option><option value="60" selected>60x</option><option value="300">300x</option></select></label>
    <input id="seek" type="range" min="0" max="1000" value="0" aria-label="Position in the session">
    <span class="clock" id="clock">0:00</span>
  </div>
</div>
<div class="card"><ol id="feed" aria-label="What happened, latest first"></ol></div>
<footer>It shows timing, kinds of work and program names only: no project, file or folder names, prompts, replies or arguments. Made with the Agent Brain plugin for Obsidian.</footer>
</main>
<script type="application/json" id="data">__DATA__</script>
<script>
(function () {
  var NS = 'http://www.w3.org/2000/svg';
  var data; try { data = JSON.parse(document.getElementById('data').textContent); } catch (e) { data = null; }
  var evs = (data && Array.isArray(data.events) ? data.events : []).slice(0, 20000).map(function (x) {
    x = x || {}; var n = Number(x.dt); return { dt: isFinite(n) ? Math.max(0, n) : 0, e: String(x.e || '').slice(0, 40), tool: String(x.tool || '').slice(0, 60), cat: String(x.cat || '').slice(0, 20), text: String(x.text || '').slice(0, 200), agent: String(x.agent || '').slice(0, 40), aid: String(x.aid || '').slice(0, 20), kind: String(x.kind || '').slice(0, 20) };
  }).sort(function (a, b) { return a.dt - b.dt; });
  var LANES = [['prompt', 'Prompts', '#8a93a6'], ['read', 'Read', '#56B4E9'], ['write', 'Write', '#009E73'], ['exec', 'Run', '#D55E00'], ['web', 'Web', '#CC79A7'], ['agent', 'Agents', '#E69F00'], ['mcp', 'Tools (MCP)', '#0072B2'], ['other', 'Other', '#999999'], ['alert', 'Alerts', '#d62728']];
  var LANE_OF = {}; LANES.forEach(function (l, i) { LANE_OF[l[0]] = i; });
  function laneFor(r) {
    if (r.e === 'Doubt' || r.e === 'PostToolUseFailure' || r.e === 'PermissionRequest' || r.e === 'StopFailure') return LANE_OF.alert;
    if (r.e === 'UserPromptSubmit' || r.e === 'Stop') return LANE_OF.prompt;
    if (r.e === 'SubagentStart' || r.e === 'SubagentStop') return LANE_OF.agent;
    if (r.e !== 'PreToolUse') return -1;
    if (r.cat === 'read' || r.cat === 'write' || r.cat === 'exec' || r.cat === 'web' || r.cat === 'agent' || r.cat === 'mcp') return LANE_OF[r.cat];
    return LANE_OF.other;
  }
  function label(r) {
    var tags = { UserPromptSubmit: 'PROMPT', Stop: 'DONE', SubagentStart: 'AGENT', SubagentStop: 'AGENT', PostToolUseFailure: 'FAILED', PermissionRequest: 'ASKED', StopFailure: 'ERROR', Doubt: 'DOUBT' };
    var words = { UserPromptSubmit: 'a prompt', Stop: 'turn finished', SubagentStart: 'subagent started', SubagentStop: 'subagent finished', PostToolUseFailure: r.tool || 'a tool call', PermissionRequest: 'approval requested', StopFailure: 'the turn ended with an error', Doubt: r.kind || 'a finding' };
    var tag = tags[r.e] || (r.cat ? r.cat.toUpperCase() : 'TOOL');
    var what = words[r.e] || r.text || r.tool || r.e;
    if (r.e === 'PreToolUse' && r.text && r.tool) what = r.tool + ': ' + r.text;
    return { tag: tag, what: what, bad: r.e === 'Doubt' || r.e === 'PostToolUseFailure' || r.e === 'StopFailure' };
  }
  var rows = evs.map(function (r) { return { r: r, lane: laneFor(r) }; }).filter(function (x) { return x.lane >= 0; });
  var total = evs.length ? evs[evs.length - 1].dt : 0;
  function clock(ms) { var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), q = s % 60; return (h ? h + ':' + (m < 10 ? '0' : '') + m : m) + ':' + (q < 10 ? '0' : '') + q; }
  function el(tag, attrs, text) { var n = document.createElementNS(tag === 'svg' || NS_TAGS[tag] ? NS : 'http://www.w3.org/1999/xhtml', tag); for (var k in (attrs || {})) n.setAttribute(k, attrs[k]); if (text != null) n.textContent = text; return n; }
  var NS_TAGS = { line: 1, circle: 1, text: 1, rect: 1 };
  function html(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  var calls = 0, agents = {}, fails = 0, doubts = 0;
  evs.forEach(function (r) { if (r.e === 'PreToolUse') calls++; if (r.e === 'SubagentStart' && r.aid) agents[r.aid] = 1; if (r.e === 'PostToolUseFailure') fails++; if (r.e === 'Doubt') doubts++; });
  document.getElementById('sub').textContent = evs.length ? 'A recorded coding session, replayed in your browser. Nothing leaves this page.' : 'This file has no events in it.';
  var stats = document.getElementById('stats');
  [['Length', clock(total)], ['Tool calls', String(calls)], ['Subagents', String(Object.keys(agents).length)], ['Failed calls', String(fails)], ['Findings', String(doubts)]].forEach(function (s) { var d = html('div', 'stat'); d.appendChild(html('b', '', s[1])); d.appendChild(html('span', '', s[0])); stats.appendChild(d); });
  var leg = document.getElementById('legend'); LANES.forEach(function (l) { var s = html('span'); var i = html('i'); i.style.background = l[2]; s.appendChild(i); s.appendChild(document.createTextNode(l[1])); leg.appendChild(s); });

  var W = 900, H = 260, L = 96, R = 14, T = 12, B = 22, rowH = (H - T - B) / LANES.length;
  var svg = document.getElementById('chart');
  function X(ms) { return L + (total ? ms / total : 0) * (W - L - R); }
  LANES.forEach(function (l, i) { var y = T + rowH * i + rowH / 2; svg.appendChild(el('line', { x1: L, x2: W - R, y1: y, y2: y, stroke: 'currentColor', 'stroke-opacity': '0.12' })); svg.appendChild(el('text', { x: L - 8, y: y + 4, 'text-anchor': 'end', 'font-size': '11', fill: 'currentColor', 'fill-opacity': '0.7' }, l[1])); });
  rows.forEach(function (x) { var c = el('circle', { cx: X(x.r.dt), cy: T + rowH * x.lane + rowH / 2, r: 3.2, fill: LANES[x.lane][2], 'fill-opacity': '0.85' }); svg.appendChild(c); x.dot = c; });
  [0, 0.25, 0.5, 0.75, 1].forEach(function (f) { svg.appendChild(el('text', { x: X(total * f), y: H - 6, 'text-anchor': f === 0 ? 'start' : f === 1 ? 'end' : 'middle', 'font-size': '10', fill: 'currentColor', 'fill-opacity': '0.6' }, clock(total * f))); });
  var head = el('line', { x1: L, x2: L, y1: T, y2: H - B, stroke: 'currentColor', 'stroke-width': '1.5' }); svg.appendChild(head);

  var feed = document.getElementById('feed'), seek = document.getElementById('seek'), clk = document.getElementById('clock'), play = document.getElementById('play'), speed = document.getElementById('speed');
  var pos = 0, timer = 0, last = 0;
  function draw() {
    head.setAttribute('x1', X(pos)); head.setAttribute('x2', X(pos));
    rows.forEach(function (x) { x.dot.setAttribute('fill-opacity', x.r.dt <= pos ? '0.95' : '0.18'); });
    var shown = rows.filter(function (x) { return x.r.dt <= pos; }).slice(-30).reverse();
    while (feed.firstChild) feed.removeChild(feed.firstChild);
    shown.forEach(function (x) { var l = label(x.r), li = html('li', l.bad ? 'bad' : ''); li.appendChild(html('span', 't', clock(x.r.dt))); li.appendChild(html('span', 'k', l.tag)); li.appendChild(html('span', 'w', l.what)); feed.appendChild(li); });
    clk.textContent = clock(pos) + ' / ' + clock(total);
    seek.value = total ? Math.round(pos / total * 1000) : 0;
  }
  function stop() { if (timer) cancelAnimationFrame(timer); timer = 0; play.textContent = 'Play'; }
  function tick(t) { var dt = last ? t - last : 0; last = t; pos = Math.min(total, pos + dt * Number(speed.value)); draw(); if (pos >= total) { stop(); return; } timer = requestAnimationFrame(tick); }
  play.addEventListener('click', function () { if (timer) { stop(); return; } if (pos >= total) pos = 0; last = 0; play.textContent = 'Pause'; timer = requestAnimationFrame(tick); });
  seek.addEventListener('input', function () { pos = total * Number(seek.value) / 1000; draw(); });
  pos = total; draw();
})();
</script>
</body>
</html>
`;
