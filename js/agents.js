/* agents.js — Multi-agent system: Controller, Perception, Planner, Suit Developer.
   Autonomous Mode: a local state machine that walks to the volcano, explores,
   opens wings, raises shield — loop Perception → Planner → Controller →
   Suit Developer → Data Store → back to Perception. No external AI, no keys. */
(function (global) {
  'use strict';

  const AGENTS = ['controller', 'perception', 'planner', 'suit'];

  class AgentConsole {
    constructor(el, dotEls) {
      this.el = el;
      this.dots = {};
      ['dotCtrl', 'dotPerc', 'dotPlan', 'dotSuit'].forEach((id, i) => { this.dots[AGENTS[i]] = dotEls[id]; });
      this.busyUntil = { controller: 0, perception: 0, planner: 0, suit: 0 };
    }
    setDot(name, cls) {
      const d = this.dots[name];
      if (d) d.className = 'agentdot ' + cls;
    }
    say(name, text) {
      const line = document.createElement('div');
      line.className = 'lg';
      line.innerHTML = `<span class="t">${U.now()}</span><span class="ag ${name}">[${name.toUpperCase()}]</span>${escapeHtml(text)}`;
      this.el.appendChild(line);
      this.el.scrollTop = this.el.scrollHeight;
      while (this.el.childElementCount > 120) this.el.removeChild(this.el.firstChild);
      this.busyUntil[name] = performance.now() + 900;
    }
    tick(now) {
      AGENTS.forEach((a) => this.setDot(a, now < this.busyUntil[a] ? 'busy' : 'on'));
    }
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------------- Autonomous brain ---------------- */
  class AutonomousBrain {
    constructor(deps) {
      // deps: { robot, volcano, thermal, console, log, store, cmd, onXp }
      this.robot = deps.robot;
      this.volcano = deps.volcano;
      this.thermal = deps.thermal;
      this.console = deps.console;
      this.log = deps.log;
      this.store = deps.store;
      this.cmd = deps.cmd;
      this.onXp = deps.onXp || function () {};

      this.on = false;
      this.state = 'APPROACH';
      this.timer = 0;
      this.patrolIdx = 0;
      this.wingsOpen = false;
      this.shieldUp = false;
      this.loopCounter = 0;
    }

    setOn(on) {
      if (this.on === on) return;
      this.on = on;
      if (on) {
        this.state = 'APPROACH';
        this.timer = 0;
        this.console.say('planner', 'Autonomous mode engaged — mission: explore volcano, protect suit integrity');
        this.log('Autonomous Mode ON — full agent loop active (Perception → Planner → Controller → Suit Developer)');
      } else {
        this.cmd.stop();
        this.cmd.stand();
        this.cmd.setWings(false);
        this.cmd.setShield(false);
        this.console.say('controller', 'Autonomous mode OFF — manual control restored');
        this.log('Autonomous Mode OFF — agent loop halted, manual control restored');
      }
    }

    _perception() {
      const r = this.robot.group.position;
      const vent = this.volcano.active ? Volcano.VENT : null;
      const tOut = this.thermal.tOut;
      const dist = vent ? Math.hypot(r.x - vent.x, r.z - vent.z) : Math.hypot(r.x, r.z - 8);
      return { dist, tOut, locked: this.thermal.locked, pos: r };
    }

    tick(dt) {
      if (!this.on) return;
      this.timer += dt;
      const perc = this._perception();

      // Perception → Planner
      if (this.timer >= 0.8) {
        this.timer = 0;
        this.loopCounter++;
        this.store.cycles++;
        this.console.say('perception',
          `Sensed: vent ${U.fmt(perc.dist, 1)}m · LABAS ${U.fmt(perc.tOut, 0)}°C · LOOB ${U.fmt(this.thermal.tIn)}°C` +
          (perc.locked ? ' · EMERGENCY LOCK' : ''));

        // Suit Developer: save simulation data to the shared store
        this.store.saved++;
        const w = this.store.addXp('shield', 1);
        this.store.addXp('knowledge', 2);
        this.onXp();
        this.console.say('suit', `simulation data saved to Nano Tech Archangel Suit · shield XP ${w}`);
        this.log(`simulation data saved to Nano Tech Archangel Suit (cycle ${this.store.cycles})`);
      }

      if (perc.locked) {
        this.console.say('controller', 'Motion locked by fail-closed thermal — awaiting cooldown');
        return;
      }

      // ---- behavior state machine ----
      switch (this.state) {
        case 'APPROACH': {
          if (this.timer < 0.1) {
            this.console.say('planner', `Plan: approach volcano vent (current ${U.fmt(perc.dist, 1)}m)`);
            this.cmd.walkTo(Volcano.VENT, 15);
            this.console.say('controller', 'Walking toward volcano vent');
          }
          if (perc.dist < 16) {
            this.cmd.stop();
            this.state = 'OBSERVE';
            this.timer = 0;
            this.console.say('planner', `Reached observation point ${U.fmt(perc.dist, 1)}m from vent — deploying systems`);
          }
          break;
        }
        case 'OBSERVE': {
          // open wings + raise shield toward the heat
          if (!this.wingsOpen) {
            this.wingsOpen = true;
            this.cmd.setWings(true);
            this.store.addXp('wings', 5); this.onXp();
            this.console.say('controller', 'Open Wings — full feathered spread deployed for thermal deflection');
            this.log('Autonomous: wings deployed (+5 Wings XP)');
          }
          if (!this.shieldUp) {
            this.shieldUp = true;
            this.cmd.setShield(true);
            this.store.addXp('shield', 5); this.onXp();
            this.console.say('controller', 'Raise Shield — facing the heat source');
            this.log('Autonomous: shield raised (+5 Shield XP)');
          }
          this.state = 'PATROL';
          this.timer = 0;
          break;
        }
        case 'PATROL': {
          // patrol waypoints around the vent
          if (this.timer >= 4) {
            this.timer = 0;
            this.patrolIdx = (this.patrolIdx + 1) % 4;
            const ang = this.patrolIdx * (Math.PI / 2) + 0.4;
            const wp = { x: Volcano.VENT.x + Math.cos(ang) * 16, z: Volcano.VENT.z + Math.sin(ang) * 16 };
            this.cmd.walkTo(wp, 2.0);
            this.console.say('planner', `Patrol waypoint ${this.patrolIdx + 1}/4 — repositioning`);
            this.console.say('controller', 'Executing patrol walk — 4-phase gait engaged');
            this.store.addXp('knowledge', 2); this.onXp();
          }
          break;
        }
        case 'RETREAT': {
          if (this.timer < 0.1) {
            this.cmd.walkTo({ x: 0, z: 8 }, 2);
            this.console.say('controller', 'Thermal margin low — retreating to cool zone');
          }
          if (this.thermal.tIn < 38.5) { this.state = 'APPROACH'; this.timer = 0; }
          break;
        }
      }
      // thermal margin check → planner intervention
      if (this.thermal.tIn > 41.5 && this.state !== 'RETREAT') {
        this.state = 'RETREAT';
        this.console.say('planner', `LOOB ${U.fmt(this.thermal.tIn)}°C above comfort — plan changed to RETREAT`);
        this.log('Autonomous: thermal margin low — retreat planned', 'amber');
      }
    }
  }

  global.AgentConsole = AgentConsole;
  global.AutonomousBrain = AutonomousBrain;
})(window);
