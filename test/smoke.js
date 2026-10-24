// Minimal fake DOM: enough to run every handler and a few hundred frames of the page script.
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/../dist/human-mode.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const errors = [];
const ctxStub = new Proxy({}, { get: (t, k) => k === 'createImageData' ? (a, b) => ({ data: new Uint8ClampedArray(a * b * 4) }) : () => {}, set: () => true });
function makeEl(id) {
  const listeners = {}, kids = [];
  const el = {
    id, value: '', textContent: '', innerHTML: '', disabled: false, style: {}, dataset: {}, children: kids, width: 0, height: 0,
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    dispatch(t, ev) { (listeners[t] || []).forEach(fn => fn(Object.assign({ preventDefault() {}, pointerId: 1, clientX: 100, clientY: 100 }, ev))); },
    getContext: () => ctxStub, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 260 }),
    insertBefore(n, ref) { kids.unshift(n); }, remove() {}, outerHTML: '<li></li>', appendChild(n) { kids.push(n); }, firstChild: null,
    setAttribute() {},
  };
  Object.defineProperty(el, 'textContent', { get() { return this._t || ''; }, set(v) { this._t = v; if (v === '') kids.length = 0; } });
  return el;
}
const els = {};
const document = {
  getElementById: id => els[id] || (els[id] = makeEl(id)),
  createElement: () => makeEl('x'), documentElement: {}, hidden: false,
  addEventListener() {},
};
els.salt = makeEl('salt'); els.salt.value = '14'; els.code = makeEl('code');
const intervals = [], timeouts = [];
let rafCb = null, clock = 0;
const win = {
  document, devicePixelRatio: 2, performance: { now: () => clock },
  getComputedStyle: () => ({ getPropertyValue: () => '#c9d4cf' }),
  requestAnimationFrame: cb => { rafCb = cb; }, setInterval: (f) => { intervals.push(f); }, setTimeout: (f, ms) => { timeouts.push([f, ms]); },
  TextEncoder,
};
const names = Object.keys(win);
const run = scripts.map(s => `with(__w){ ${s} }`).join('\n');
try { new Function('__w', 'window', 'document', 'performance', 'getComputedStyle', 'requestAnimationFrame', 'setInterval', 'setTimeout', 'TextEncoder', run)
  (win, win, document, win.performance, win.getComputedStyle, win.requestAnimationFrame, win.setInterval, win.setTimeout, TextEncoder); }
catch (e) { errors.push(e.stack); }
function frames(n) { for (let i = 0; i < n; i++) { clock += 16; const cb = rafCb; rafCb = null; if (cb) { try { cb(clock); } catch (e) { errors.push(e.stack); break; } } } }
function flush() { while (timeouts.length) { const [f] = timeouts.shift(); try { f(); } catch (e) { errors.push(e.stack); } } }
const click = id => { try { els[id].dispatch('click', {}); } catch (e) { errors.push(id + ': ' + e.stack); } };
frames(60);
els.floor.dispatch('pointerdown', { clientX: 220, clientY: 200 }); frames(120);
els.floor.dispatch('pointermove', { clientX: 210, clientY: 230 }); els.floor.dispatch('pointerup', {}); frames(200);
click('b-phone'); click('b-cough'); click('b-next'); frames(30); click('b-arrive');
els.code.value = 'heron'; els.codeform.dispatch('submit', {}); frames(30);
els.code.value = 'heron'; els.codeform.dispatch('submit', {}); frames(60);   // second time: match and gesture
click('b-leave'); frames(200);
intervals.forEach(f => f()); click('b-audit');
console.log('audit:', els['audit-out'].textContent);
click('b-day'); flush(); frames(10);
console.log('lastday:', els.lastday.textContent);
click('b-end'); for (let i = 0; i < 60 && timeouts.length; i++) flush();
frames(10);
console.log('end:', els['s-day'].textContent, els['s-charge'].textContent, els['s-mood'].textContent, '|', els.lastday.textContent);
console.log('spark has path:', els.spark.innerHTML.includes('polyline'), '| stats rows:', (els.stats.innerHTML.match(/<dt>/g) || []).length);
click('b-audit'); console.log('audit:', els['audit-out'].textContent);
click('b-reset'); flush(); frames(5); console.log('reset ->', els['s-day'].textContent, els['s-charge'].textContent);
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no runtime errors');
process.exit(errors.length ? 1 : 0);
