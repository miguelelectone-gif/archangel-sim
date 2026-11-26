/* util.js — shared math helpers */
(function (global) {
  'use strict';
  const U = {};
  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.rand = (a, b) => a + Math.random() * (b - a);
  // exponential smoothing toward target (frame-rate independent)
  U.damp = (cur, target, rate, dt) => U.lerp(cur, target, 1 - Math.exp(-rate * dt));
  U.fmt = (v, d = 2) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(d));
  U.pad = (s, n) => (s.length < n ? s + ' '.repeat(n - s.length) : s);
  U.now = () => {
    const d = new Date();
    return U.pad(String(d.getHours()), 2) + ':' + U.pad(String(d.getMinutes()), 2) + ':' + U.pad(String(d.getSeconds()), 2);
  };
  global.U = U;
})(window);
