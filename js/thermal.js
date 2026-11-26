/* thermal.js — Thermal Adaptive Agent (local, in-browser, no API key).
   Controls: insulation + coolant pump. Target interior 36.5°C.
   Fail-closed: if the agent is OFF in the volcano, interior rises; at 45°C
   the robot STOPS and all movement commands are locked until it cools. */
(function (global) {
  'use strict';

  const TARGET = 36.5;
  const EMERGENCY = 45;
  const WARN = 43;
  const UNLOCK = 43.4;
  const U_HEAT = 0.010;     // heat transfer coefficient (1/s) at zero insulation
  const Q_INT = 0.14;       // internal suit heat generation (°C/s)
  const P_COOL_MAX = 2.0;   // max coolant cooling (°C/s) at 100%
  const BAR_RATE = 9;       // bar adjustment rate (%/s)

  class ThermalAgent {
    constructor() {
      this.on = false;
      this.ins = 0;          // insulation bar 0-100
      this.cool = 0;         // coolant bar 0-100
      this.tIn = 36.5;
      this.tOut = 28;
      this.locked = false;
      this.history = [];     // {t, out, in}
      this._histT = 0;
      this._logCb = null;
      this._msgCb = null;
      this.adjustLog = [];
      this._warned = false;
    }

    onLog(cb) { this._logCb = cb; }
    onMessage(cb) { this._msgCb = cb; }

    setEnvironment(tOut) { this.tOut = tOut; }

    setOn(on) {
      if (this.on === on) return;
      this.on = on;
      if (on) {
        if (this._msgCb) this._msgCb('suit', `Thermal Agent ON — target ${TARGET}°C, insulation & coolant loop engaged`);
        if (this._logCb) this._logCb('Thermal Agent ON — adaptive control loop engaged (local agent)');
      } else {
        if (this._msgCb) this._msgCb('suit', 'Thermal Agent OFF — passive mode, insulation & coolant released');
        if (this._logCb) this._logCb('Thermal Agent OFF — passive mode (no control)', 'amber');
      }
    }

    _log(text, kind) { if (this._logCb) this._logCb(text, kind); }

    update(dt, tOut) {
      this.tOut = tOut;
      const insFrac = (this.ins / 100) * 0.98;
      const flux = U_HEAT * (tOut - this.tIn) * (1 - insFrac);
      const coolRate = this.on ? (this.cool / 100) * P_COOL_MAX : 0;
      this.tIn += (Q_INT + flux - coolRate) * dt;

      // ---- adaptive control loop (runs whenever agent is ON; lockout only blocks motion) ----
      if (this.on) {
        const err = this.tIn - TARGET;
        // faster response when further from target (heat shock handling)
        const rate = U.clamp(Math.abs(err) * 2.5, 1, 3.5) * BAR_RATE * dt;
        let changed = '';
        if (err > 0.35) {
          // overheating: raise insulation first, then coolant
          const before = this.ins;
          this.ins = Math.min(100, this.ins + rate);
          if (this.ins >= 100 && before < 100) changed = `Insulation → ${Math.round(this.ins)}% (heat flux reduced)`;
          if (this.tIn - TARGET > 1.2 || this.ins >= 99) {
            const cb = this.cool;
            this.cool = Math.min(100, this.cool + rate * 1.4);
            if (Math.abs(this.cool - cb) > 1.5) changed = changed || `Coolant pump → ${Math.round(this.cool)}%`;
          }
        } else if (err < -0.35) {
          // too cold: ease coolant first, then insulation
          const cb = this.cool;
          this.cool = Math.max(0, this.cool - rate * 1.4);
          if (Math.abs(this.cool - cb) > 1.5) changed = `Coolant pump → ${Math.round(this.cool)}%`;
          if (this.cool <= 1 && this.ins > 30) {
            const before = this.ins;
            this.ins = Math.max(28, this.ins - rate);
            if (Math.abs(this.ins - before) > 1) changed = changed || `Insulation → ${Math.round(this.ins)}%`;
          }
        } else {
          // holding: trim coolant to hold target
          const cb = this.cool;
          this.cool = U.clamp(this.cool + (err * 22) * dt, 0, 100);
          if (Math.abs(this.cool - cb) > 1.5) changed = `Coolant trimmed → ${Math.round(this.cool)}% (holding ${TARGET}°C)`;
        }
        if (changed) {
          this.adjustLog.push(changed);
          if (this._msgCb) this._msgCb('suit', changed);
          this._log(`Adjust: ${changed} · LOOB ${U.fmt(this.tIn)}°C / LABAS ${U.fmt(this.tOut)}°C`);
        }
      } else if (!this.on) {
        // passive: bars release
        this.ins = Math.max(0, this.ins - BAR_RATE * dt * 0.5);
        this.cool = Math.max(0, this.cool - BAR_RATE * dt);
      }

      // ---- warnings / fail-closed emergency ----
      if (this.tIn >= EMERGENCY && !this.locked) {
        this.locked = true;
        this._log(`FAIL-CLOSED TRIGGERED — interior ${U.fmt(this.tIn)}°C ≥ 45°C — motion STOPPED, command lockout`, 'red');
        if (this._msgCb) this._msgCb('controller', `EMERGENCY — thermal fail-closed: motion locked at ${U.fmt(this.tIn)}°C`);
      } else if (this.locked && this.on && this.tIn <= UNLOCK) {
        this.locked = false;
        this._log(`Thermal recovered — interior ${U.fmt(this.tIn)}°C < ${UNLOCK}°C — control restored`, 'sys');
        if (this._msgCb) this._msgCb('controller', `Thermal lock released at ${U.fmt(this.tIn)}°C — control restored`);
      }
      const watching = this.tIn >= WARN && this.tIn < EMERGENCY;
      if (!this.locked && watching && !this._warned) {
        this._warned = true;
        this._log(`Watch — interior climbing: ${U.fmt(this.tIn)}°C (limit 45°C)`, 'amber');
      } else if (!watching && this._warned) {
        this._warned = false;
      }

      // history for chart (~2 Hz)
      this._histT += dt;
      if (this._histT >= 0.5) {
        this._histT = 0;
        this.history.push({ t: this.tOut, i: this.tIn });
        if (this.history.length > 150) this.history.shift();
      }
    }
  }

  /* ---- chart: orange = LABAS (outside), cyan = LOOB (inside),
         dashed red = 45°C limit, dashed green = 36.5°C target ---- */
  function drawChart(canvas, agent) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const padL = 30, padR = 8, padT = 8, padB = 16;
    const w = W - padL - padR, h = H - padT - padB;
    const YMAX = 100, YMIN = 0;
    const yOf = (v) => padT + h - ((U.clamp(v, YMIN, YMAX) - YMIN) / (YMAX - YMIN)) * h;
    // grid
    ctx.strokeStyle = 'rgba(120,150,180,.18)'; ctx.fillStyle = '#55657a';
    ctx.font = '9px ui-monospace,monospace'; ctx.lineWidth = 1;
    [0, 25, 45, 60, 100].forEach((v) => {
      const y = yOf(v);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.fillText(v + '°', 2, y + 3);
    });
    // limit + target lines
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#ef4444'; ctx.beginPath();
    ctx.moveTo(padL, yOf(45)); ctx.lineTo(W - padR, yOf(45)); ctx.stroke();
    ctx.strokeStyle = '#34d399'; ctx.beginPath();
    ctx.moveTo(padL, yOf(36.5)); ctx.lineTo(W - padR, yOf(36.5)); ctx.stroke();
    ctx.setLineDash([]);
    // history
    const hist = agent.history;
    if (hist.length > 1) {
      const n = hist.length;
      const xOf = (i) => padL + (i / (150 - 1)) * w;
      const line = (key, color) => {
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const x = xOf(i + (150 - n)), y = yOf(hist[i][key]);
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      };
      line('t', '#ff7a18');
      line('i', '#22d3ee');
    }
    ctx.fillStyle = '#7d8fa6';
    ctx.fillText('LABAS', W - 46, 12);
  }

  global.ThermalAgent = ThermalAgent;
  global.drawThermalChart = drawChart;
})(window);
