// reduce motion and keyboard access to signals
global.window = { setTimeout: () => 0, setInterval, clearInterval, clearTimeout, Notification: null };
global.document = { hasFocus: () => true };
const Module = require('module'); const orig = Module._load;
Module._load = function (r, ...a) {
  if (r === 'obsidian') return { Plugin: class {}, ItemView: class {}, Notice: class {}, PluginSettingTab: class {}, Setting: class {} };
  return orig.call(this, r, ...a);
};
const P = require('../dist/main.js');
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const V = P.BrainView.prototype;

// calm(): 'on' always, 'off' never, 'auto' follows the system
const calm = (reduceMotion, sys) => { global.window.matchMedia = sys === undefined ? undefined : () => ({ matches: sys }); return V.calm.call({ plugin: { settings: { reduceMotion } } }); };
ok(calm('on', false) === true, 'on: calm even if the system asks for nothing');
ok(calm('off', true) === false, 'off: not calm even if the system asks for less motion');
ok(calm('auto', true) === true, 'auto: follows the system (reduce)');
ok(calm('auto', false) === false, 'auto: follows the system (no preference)');
ok(calm(undefined, true) === true, 'unset counts as auto');
ok(calm('auto', undefined) === false, 'auto without matchMedia: not calm, no crash');

// cycleSpike / openSelectedSpike on a stub view
const mk = (heads, frozen) => {
  const v = { frozen, selSpike: null, needsDraw: false, flashed: [], opened: [], spikeHeads: () => heads, setTimeScale(t) { if (t === 0) this.frozen = true; }, flash(m) { this.flashed.push(m); },
    describeSpike: (h) => ({ tag: 'TOOL', what: h.name, target: '' }), openPanel(p) { this.opened.push(p); } };
  v.cycleSpike = V.cycleSpike; v.openSelectedSpike = V.openSelectedSpike; return v;
};
const A = { sp: { id: 1 }, name: 'a' }, B = { sp: { id: 2 }, name: 'b' }, C = { sp: { id: 3 }, name: 'c' };
let v = mk([A, B, C], false);
ok(v.cycleSpike(1) === A && v.frozen, 'first ] selects the first signal and freezes time');
ok(v.cycleSpike(1) === B && v.cycleSpike(1) === C && v.cycleSpike(1) === A, 'next wraps around');
ok(v.cycleSpike(-1) === C, 'previous wraps backwards');
ok(/3 of 3: TOOL c/.test(v.flashed[v.flashed.length - 1]), 'announced in words: ' + v.flashed[v.flashed.length - 1]);
v = mk([A, B, C], true);
ok(v.cycleSpike(-1) === C, 'first [ starts from the last signal');
ok(v.openSelectedSpike() === true && v.opened.length === 1 && v.opened[0].kind === 'signal' && v.opened[0].h === C, 'Enter opens the selected signal');
v = mk([], true);
ok(v.cycleSpike(1) === null && /No signal/.test(v.flashed[0]), 'nothing travelling: says so');
v = mk([A], true);
ok(v.openSelectedSpike() === false && v.opened.length === 0, 'Enter with nothing selected does nothing');
v.selSpike = A; v.frozen = false;
ok(v.openSelectedSpike() === false, 'Enter only opens while frozen');

// the real keydown handler, with the spike functions replaced by spies
const handlers = {}, calls = [];
const view = { mini: false, contentEl: {}, registerDomEvent: (el, type, fn) => { handlers[type] = fn; }, cycleSpike: (d) => calls.push('cycle' + d), enterKey: V.enterKey, openSelectedSpike() { calls.push('open'); return true; } };
V.bindKeys.call(view);
const press = (key, o = {}) => { calls.length = 0; let prevented = false; handlers.keydown(Object.assign({ key, ctrlKey: false, altKey: false, metaKey: false, target: { tagName: 'DIV' }, preventDefault() { prevented = true; }, stopPropagation() {} }, o)); return { calls: calls.slice(), prevented }; };
ok(press(']').calls[0] === 'cycle1' && press('[').calls[0] === 'cycle-1', '[ and ] step');
ok(press('n').calls[0] === 'cycle1' && press('p').calls[0] === 'cycle-1', 'N and P do the same, for keyboards where [ ] are awkward');
ok(press(']', { ctrlKey: true, altKey: true, getModifierState: (k) => k === 'AltGraph' }).calls[0] === 'cycle1', 'AltGr + key (how [ ] are typed on many layouts) works');
ok(press(']', { ctrlKey: true }).calls.length === 0 && press('n', { ctrlKey: true }).calls.length === 0 && press('n', { metaKey: true }).calls.length === 0, 'Ctrl or Cmd shortcuts are left alone');
ok(press('n', { target: { tagName: 'INPUT' } }).calls.length === 0, 'typing in a field is left alone');
const en = press('Enter'); ok(en.calls[0] === 'open' && en.prevented, 'Enter opens the selected signal');
const eb = press('Enter', { target: { tagName: 'BUTTON' } }); ok(eb.calls.length === 0 && !eb.prevented, 'Enter on a focused button stays the button\'s');
