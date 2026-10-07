// how a signal is drawn: realistic (calcium-imaging style) or illustrated
global.window = { setTimeout: () => 0, setInterval, clearInterval, clearTimeout, Notification: null };
global.document = { hasFocus: () => true };
const Module = require('module'); const orig = Module._load;
Module._load = function (r, ...a) {
  if (r === 'obsidian') return { Plugin: class {}, ItemView: class {}, Notice: class {}, PluginSettingTab: class {}, Setting: class {} };
  return orig.call(this, r, ...a);
};
const P = require('../dist/main.js');
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const { signalLook, decayAct } = P;

const R = signalLook('real'), S = signalLook('story');
ok(signalLook(undefined) === R && signalLook('nonsense') === R, 'realistic is the default, also for an unknown value');
ok(signalLook('story') === S && S !== R, 'illustrated is its own look');
ok(R.tail < S.tail && R.head < S.head && R.k < S.k && R.headGlow < S.headGlow && R.tract < S.tract, 'realistic: shorter, dimmer, smaller than the illustration at every part of the signal');
ok(R.tau > 0 && S.tau === 0, 'realistic cell bodies fade exponentially, illustrated ones in a straight line');

// a cell body after a flash of 1.2
const after = (look, secs) => { let a = 1.2; for (let t = 0; t < secs; t += 0.016) a = decayAct(a, 0.016, look.tau); return a; };
ok(after(R, 0.1) > 1.0, 'realistic: still bright 0.1 s after the flash (it rises at once, then fades)');
ok(after(R, 1.0) > 0.25 && after(R, 1.0) < 0.5, 'realistic: about a third left after one second (' + after(R, 1.0).toFixed(2) + ')');
ok(after(R, 4) === 0, 'realistic: gone after a few seconds, exactly zero (no endless tail)');
ok(Math.abs(after(S, 1.0) - 0.6) < 0.05 && after(S, 2.2) === 0, 'illustrated: the old straight fade (' + after(S, 1.0).toFixed(2) + ' after one second)');
ok(decayAct(0, 1, 0.8) === 0 && decayAct(-1, 1, 0.8) === 0 && decayAct(NaN, 1, 0) === 0, 'nothing to fade, nothing happens, never negative, no NaN');
let monotone = true, a = 1.2; for (let i = 0; i < 400; i++) { const b = decayAct(a, 0.02, R.tau); if (b > a) monotone = false; a = b; }
ok(monotone, 'a flash only ever fades');
