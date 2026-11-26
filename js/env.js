/* env.js — Flight, Environment Adaptation, Knowledge + Evolution.
   Additive on top of Soul, Adapt, Thermal, Volcano, Multi-Sync. Nothing
   removed. The environment itself is the SUPPLY: water becomes part of the
   movement, ice becomes part of the gait, the surroundings rebuild the body.

   1. Flight — Wings as lift, not just display. "lipad" command or autonomous
      decision → wings open full, ascend, fly over the Volcano, descend gently.
      UI: FLIGHT ON/OFF, altitude, wings-lift. Landing returns to Walk.
   2. Environment Adaptation — four environments:
      - Water: swimming motion, buoyant, never sinks. WATER ADAPT: ON.
      - Heat / Volcano: existing Thermal + fail-closed 45°C (kept intact).
      - Wind / Air: wings fold a bit or open to ride the wind. WIND ADAPT.
      - Ice / Cold: feet grip harder, friction rises, no slipping. ICE ADAPT: ON.
   3. Knowledge + Evolution — a Knowledge Store collects open env data while
      online and carries it offline. Evolution: repeated exposure makes the
      Archangel better at that environment. GOAL shows EVOLUTION percentages.
   4. Multi-Sync — what one agent learns in an environment syncs to all.

   Local only, no API key, no cloud, no taking what is not ours. */
(function (global) {
  'use strict';

  const ENV_KEYS = ['water', 'heat', 'air', 'ice'];

  class EnvironmentManager {
    constructor(deps) {
      this.robot = deps.robot;
      this.volcano = deps.volcano;
      this.thermal = deps.thermal;
      this.console = deps.console;
      this.log = deps.log;
      this.store = deps.store;
      this.multiAgent = deps.multiAgent;
      this.onSync = deps.onSync || function () {};
      this.onXp = deps.onXp || function () {};
      this.onEnvChange = deps.onEnvChange || function () {};

      // current environment: water | heat | air | ice | null
      this.env = null;
      this.prevEnv = null;

      // flight
      this.flight = false;
      this.flightTarget = false;
      this.altitude = 0;        // current Y of the body
      this.maxAlt = 7;          // cruise altitude over the volcano
      this.flightTimer = 0;
      this.flightPhase = 'IDLE'; // IDLE | ASSEND | CRUISE | DESCEND

      // environment effect params (applied per tick)
      this.buoyancy = 0;
      this.windStrength = 0;
      this.iceFriction = 0;
      this.envTimer = 0;

      this.evoTick = 0;
    }

    /* ---------------- environment switching ---------------- */
    setEnv(env) {
      if (env === this.env) return;
      // leaving previous environment
      if (this.env) {
        this.console.say('perception', 'Leaving ' + this.env + ' environment — suit adapts to base state');
      }
      this.prevEnv = this.env;
      this.env = (ENV_KEYS.indexOf(env) >= 0) ? env : null;
      this.store.envActive = this.env;
      this.envTimer = 0;

      if (this.env) {
        const names = { water: 'Tubig / Water', heat: 'Init / Heat (Volcano)', air: 'Hangin / Wind', ice: 'Ice / Lamig' };
        this.console.say('perception', 'Environment entered: ' + names[this.env] + ' — environment is the supply, suit rebuilds movement from it');
        this.log('ENVIRONMENT: ' + names[this.env] + ' — adapting (environment as supply)', 'sys');
        if (this.env === 'heat') {
          this.console.say('planner', 'Heat environment — Thermal Agent engages, fail-closed 45°C active');
        }
        if (this.env === 'water') {
          this.console.say('controller', 'WATER ADAPT: ON — swimming motion, buoyant, will not sink');
        }
        if (this.env === 'air') {
          this.console.say('controller', 'WIND ADAPT: ON — wings adjust to ride the wind');
        }
        if (this.env === 'ice') {
          this.console.say('controller', 'ICE ADAPT: ON — foot grip raised, friction increased, no slipping');
        }
      } else {
        this.log('ENVIRONMENT: base state — all adaptations released', 'sys');
      }
      this.onEnvChange();
    }

    clearEnv() { this.setEnv(null); }

    /* ---------------- flight ---------------- */
    setFlight(on) {
      this.flightTarget = !!on;
      if (this.flightTarget && !this.flight) {
        this.flight = true;
        this.flightPhase = 'ASSEND';
        this.flightTimer = 0;
        this.robot.setWings(true);
        this.robot.setMove(false);
        this.robot.setPose('stand');
        this.console.say('controller', 'FLIGHT: ON — wings open full, lift engaged, ascending');
        this.log('FLIGHT: ON — wings providing lift, ascending over volcano', 'sys');
      } else if (!this.flightTarget && this.flight) {
        this.flightPhase = 'DESCEND';
        this.console.say('controller', 'FLIGHT: OFF — descending to ground, returning to Walk');
        this.log('FLIGHT: OFF — descending to ground', 'sys');
      }
    }

    toggleFlight() { this.setFlight(!this.flightTarget); }

    _flightTick(dt) {
      const r = this.robot.group.position;
      const vent = this.volcano.active ? Volcano.VENT : new THREE.Vector3(0, 0, -12);

      if (this.flightPhase === 'ASSEND') {
        this.altitude = U.damp(this.altitude, this.maxAlt, 2.2, dt);
        this.flightTimer += dt;
        // drift toward the volcano center while ascending
        r.x = U.damp(r.x, vent.x, 1.2, dt);
        r.z = U.damp(r.z, vent.z, 1.2, dt);
        if (this.altitude > this.maxAlt * 0.92) { this.flightPhase = 'CRUISE'; this.flightTimer = 0; }
      } else if (this.flightPhase === 'CRUISE') {
        // orbit the vent at cruise altitude
        this.flightTimer += dt;
        const ang = this.flightTimer * 0.35;
        r.x = vent.x + Math.cos(ang) * 5;
        r.z = vent.z + Math.sin(ang) * 5;
        this.altitude = this.maxAlt + Math.sin(this.flightTimer * 1.2) * 0.4;
        if (this.flightTimer >= 5) { this.flightPhase = 'DESCEND'; }
      } else if (this.flightPhase === 'DESCEND') {
        this.altitude = U.damp(this.altitude, 0, 2.6, dt);
        this.flightTimer += dt;
        r.x = U.damp(r.x, 0, 1.0, dt);
        r.z = U.damp(r.z, 8, 1.0, dt);
        if (this.altitude < 0.08) {
          this.altitude = 0;
          this.flight = false;
          this.flightTarget = false;
          this.flightPhase = 'IDLE';
          this.robot.setWings(false);
          this.robot.setPose('stand');
          this.robot.setMove(false);
          this.console.say('controller', 'FLIGHT: landed — back to Walk mode');
          this.log('FLIGHT: landed — Walk mode restored', 'sys');
        }
      }

      // lift from wings: full spread + strong flap while airborne
      const lift = this.flight ? (0.7 + 0.3 * Math.abs(Math.sin(this.flightTimer * 4))) : 0;
      this.robot.group.position.y = this.altitude;
      // extra wing flap for flight
      this._flightLift = lift;
    }

    /* ---------------- per-tick environment effects ---------------- */
    _envEffects(dt, time) {
      const r = this.robot.group;
      // reset base params
      this.buoyancy = 0; this.windStrength = 0; this.iceFriction = 0;

      if (this.env === 'water') {
        // buoyant: bob on the surface, never sink below surface
        this.buoyancy = 0.35 * Math.sin(time * 1.8);
        if (r.position.y < 0.1) r.position.y = 0.1 + this.buoyancy;
        else r.position.y += this.buoyancy * dt;
        // swimming motion: switch to a sculling gait
        this._swimming = true;
      } else {
        this._swimming = false;
        if (!this.flight) r.position.y = U.damp(r.position.y, 0, 5, dt);
      }

      if (this.env === 'air') {
        // wind strength varies; wings fold slightly when gusts hit
        this.windStrength = 0.5 + 0.5 * Math.sin(time * 0.9) * Math.sin(time * 0.37);
      }

      if (this.env === 'ice') {
        // high friction: reduce effective slip, slow the gait
        this.iceFriction = 0.8;
        this.robot.speed = U.lerp(this.robot.speed, 1.0, 1 - Math.exp(-1.5 * dt));
      } else {
        this.robot.speed = U.lerp(this.robot.speed, 1.5, 1 - Math.exp(-1.5 * dt));
      }

      // wind wing adjustment (additive to the robot's own wing animation)
      if (this.env === 'air' && !this.flight) {
        // fold a bit under gusts, open to ride lighter wind
        const fold = this.windStrength > 0.6 ? 0.25 : 0.0;
        this.robot._windFold = fold;
      } else {
        this.robot._windFold = 0;
      }
    }

    /* ---------------- evolution + knowledge ---------------- */
    _evolution(dt) {
      this.envTimer += dt;
      this.evoTick += dt;
      if (this.evoTick >= 1.0) {
        this.evoTick = 0;
        if (this.env) {
          // the environment itself is the supply: being in it grows evolution
          this.store.addEvolution(this.env, 0.4);
          this.store.collectKnowledge(this.env, 0.6); // collect open env data
          this.store.addXp('knowledge', 1);
          this.onXp();
          this.onSync();
        }
        // sync evolution to all agents (multi-sync)
        this.store.syncBroadcast();
        this.onSync();
      }
    }

    get evolution() { return this.store.evolution; }
    get knowledge() { return this.store.knowledgeStore; }

    /* ---------------- main tick ---------------- */
    tick(dt, time) {
      if (this.flight) this._flightTick(dt);
      this._envEffects(dt, time);
      this._evolution(dt);
    }

    state() {
      return {
        flight: this.flight,
        flightTarget: this.flightTarget,
        altitude: this.altitude,
        lift: this._flightLift || 0,
        env: this.env,
        buoyancy: this.buoyancy,
        wind: this.windStrength,
        friction: this.iceFriction,
        evolution: Object.assign({}, this.store.evolution),
        knowledge: Object.assign({}, this.store.knowledgeStore)
      };
    }
  }

  global.EnvironmentManager = EnvironmentManager;
})(window);
