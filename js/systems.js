/* systems.js — Body/Nano Tech unified systems. Additive on top of Soul,
   Adapt, Flight, Environment, Knowledge, Evolution. Nothing removed.

   1. Flight Duration — adjustable, not auto-land only.
      AUTO   : fly, orbit, land (the original demo).
      STAY   : hold in the air, hover, glide in strong wind; does not land
               until the Director commands LAND or energy runs out.
      LAND   : lands only when told.
      Shows: FLIGHT TIME, ENERGY, WIND. Glide in strong wind to stay airborne longer.

   2. Autonomous Self Healing — no command needed.
      When Wings/Shield integrity drops (100% → 60%), it heals itself using
      the environment as supply (water/heat/wind/ice — whatever is around).
      Shows: SELF-HEAL: ON, Wings 60% → 100%.

   3. Autonomous Solar — charges by itself, no command.
      When there is sun, it charges. When no sun, it switches to another
      supply — wind, volcano heat, or body motion. Never waits for the Director.
      Shows: SOLAR: CHARGING / STANDBY, ENERGY rising with sun, falling in
      flight but recharging on its own.

   4. Body Sync — the Nano Tech is ONE with the body, not a separate suit.
      When the body tires, the Nano Tech adjusts — flight slows, energy is
      saved, healing happens while resting. When the body rests, the Nano Tech
      recharges and heals there too. When human knowledge grows, the Nano Tech
      knowledge grows. One brain, one body.
      Shows: BODY SYNC: ON, FATIGUE, ENERGY (body + Nano Tech, unified).

   5. Unlimited Knowledge — no cap (handled in store.js).
   6. Self Learning + Evolution — everything syncs to all agents, one store.

   Local only, no API key, no cloud. */
(function (global) {
  'use strict';

  class BodySystems {
    constructor(deps) {
      this.robot = deps.robot;
      this.env = deps.env;
      this.volcano = deps.volcano;
      this.thermal = deps.thermal;
      this.console = deps.console;
      this.log = deps.log;
      this.store = deps.store;
      this.multiAgent = deps.multiAgent;
      this.onSync = deps.onSync || function () {};
      this.onXp = deps.onXp || function () {};

      this._sunAvailable = true;       // daytime sun (toggled by volcano/darkness)
      this._solarTimer = 0;
      this._healTimer = 0;
      this._flightTimer = 0;
      this._lastFlightState = false;

      // integrity degradation triggers
      this._degradeTimer = 0;
    }

    /* ---------------- Flight Duration control ---------------- */
    setFlightMode(mode) {
      if (['auto', 'stay', 'land'].indexOf(mode) < 0) return;
      this.store.flightMode = mode;
      if (mode === 'land' && this.env.flight) {
        this.env.setFlight(false);
        this.console.say('controller', 'FLIGHT: LAND command — descending now');
        this.log('FLIGHT DURATION: LAND — descending', 'sys');
      } else if (mode === 'stay') {
        this.console.say('controller', 'FLIGHT DURATION: STAY — will hold in the air, hover & glide, no auto-land');
        this.log('FLIGHT DURATION: STAY — hovering, glide in wind, no auto-land', 'sys');
      } else if (mode === 'auto') {
        this.console.say('controller', 'FLIGHT DURATION: AUTO — fly, orbit, land (auto sequence)');
        this.log('FLIGHT DURATION: AUTO — auto fly/orbit/land', 'sys');
      }
    }

    _flightDuration(dt) {
      // track flight time
      if (this.env.flight) {
        this._flightTimer += dt;
        this.store.flightTime = this._flightTimer;
        // energy drains in flight
        this.store.drainEnergy(2.2 * dt);
        // fatigue builds in flight
        this.store.addFatigue(1.0 * dt);
      } else {
        this._flightTimer = 0;
        this.store.flightTime = 0;
      }

      // STAY mode: never auto-land; hover & glide in wind
      if (this.store.flightMode === 'stay' && this.env.flight) {
        // override the env's auto-descend: force cruise/hover
        if (this.env.flightPhase === 'DESCEND') {
          this.env.flightPhase = 'CRUISE';
        }
        // glide in strong wind — stay airborne longer, drift
        const wind = this.env.windStrength;
        if (wind > 0.5) {
          // glide: extend, ride the wind
          this.env.flightTimer += dt * 0.5;
          this.console.say('controller', 'FLIGHT: gliding in strong wind — staying airborne');
        }
        // land only if energy runs out
        if (this.store.energy <= 5) {
          this.env.setFlight(false);
          this.store.flightMode = 'auto';
          this.console.say('controller', 'FLIGHT: energy depleted in STAY — forced landing');
          this.log('FLIGHT: energy depleted, forced landing', 'amber');
        }
      }

      // AUTO mode: let the env's normal ascend/orbit/descend run
      // (env handles the auto sequence)
    }

    /* ---------------- Autonomous Self Healing ---------------- */
    _selfHeal(dt) {
      if (!this.store.selfHeal) return;
      this._healTimer += dt;
      if (this._healTimer < 0.5) return;
      this._healTimer = 0;

      const env = this.store.envActive;
      // healing uses the environment as supply — different envs heal differently
      const healRates = { water: 1.2, heat: 1.0, air: 0.8, ice: 1.1 };
      const rate = env ? (healRates[env] || 0.6) : 0.3;

      let healed = false;
      ['wings', 'shield'].forEach(function (part) {
        const int = this.store.integrity[part];
        if (int < 100) {
          const before = int;
          this.store.heal(part, rate);
          if (this.store.integrity[part] > before) healed = true;
        }
      }, this);

      if (healed) {
        const w = this.store.integrity.wings, s = this.store.integrity.shield;
        this.console.say('suit', 'SELF-HEAL: ON — rebuilding from environment supply · Wings ' +
          U.fmt(w, 0) + '% · Shield ' + U.fmt(s, 0) + '%');
        this.log('SELF-HEAL: rebuilding Wings ' + U.fmt(w, 0) + '% / Shield ' + U.fmt(s, 0) +
          '% using ' + (env || 'base') + ' as supply', 'ready');
        // healing is learning — sync to all agents
        this.store.addXp('knowledge', 1);
        this.store.syncBroadcast();
        this.onXp();
        this.onSync();
      }
    }

    /* ---------------- Autonomous Solar ---------------- */
    _solar(dt) {
      this._solarTimer += dt;
      if (this._solarTimer < 0.5) return;
      this._solarTimer = 0;

      const volcanoActive = this.volcano.active;
      // sun available: daytime OR volcano heat as alternate supply
      const hasSun = this._sunAvailable;
      // alternate supplies when no sun
      const hasWind = this.store.envActive === 'air';
      const hasHeat = volcanoActive || this.store.envActive === 'heat';
      const moving = this.robot.moving || this.env.flight; // body motion as supply

      const charging = hasSun || hasWind || hasHeat || moving;
      this.store.solar = charging ? 'charging' : 'standby';

      if (charging) {
        // charge rate depends on supply
        let rate = 0;
        if (hasSun) rate = 4.0;
        else if (hasHeat) rate = 2.5;
        else if (hasWind) rate = 2.0;
        else if (moving) rate = 1.0;
        const before = this.store.energy;
        this.store.addEnergy(rate * 0.5); // per 0.5s tick
        if (this.store.energy > before) {
          this.console.say('suit', 'SOLAR: CHARGING — ' +
            (hasSun ? 'sun' : hasHeat ? 'volcano heat' : hasWind ? 'wind' : 'body motion') +
            ' supply · ENERGY ' + U.fmt(this.store.energy, 0) + '%');
        }
      } else {
        this.console.say('suit', 'SOLAR: STANDBY — no sun or alternate supply, conserving energy');
      }

      // solar charging is learning — sync
      this.store.addXp('knowledge', charging ? 1 : 0);
      if (charging) { this.store.syncBroadcast(); this.onXp(); this.onSync(); }
    }

    /* ---------------- Body Sync (fatigue / rest / recharge) ---------------- */
    _bodySync(dt) {
      if (!this.store.bodySync) return;

      const flying = this.env.flight;
      const walking = this.robot.moving && !flying;
      const resting = !flying && !walking;

      // fatigue: builds with activity, drains with rest
      if (flying) this.store.addFatigue(1.2 * dt);
      else if (walking) this.store.addFatigue(0.4 * dt);
      else this.store.addFatigue(-2.0 * dt); // rest recovers

      // when fatigued, the Nano Tech adjusts: slow flight, save energy, heal while resting
      const fatigue = this.store.fatigue;
      if (fatigue > 60 && flying) {
        // body tired → Nano Tech slows flight, saves energy
        this.env.maxAlt = U.lerp(this.env.maxAlt, 4.5, 1 - Math.exp(-1 * dt));
        this.store.drainEnergy(0.5 * dt); // save energy
        if (this._bodySyncTimer === undefined) this._bodySyncTimer = 0;
        this._bodySyncTimer += dt;
        if (this._bodySyncTimer > 3) {
          this._bodySyncTimer = 0;
          this.console.say('suit', 'BODY SYNC: body fatigued — Nano Tech slowing flight, saving energy, healing while flying');
          this.log('BODY SYNC: fatigue ' + U.fmt(fatigue, 0) + '% — flight slowed, energy conserved', 'amber');
        }
      } else {
        this.env.maxAlt = U.lerp(this.env.maxAlt, 7, 1 - Math.exp(-1 * dt));
        this._bodySyncTimer = 0;
      }

      // resting: Nano Tech recharges + heals faster (body and suit are one)
      if (resting) {
        this.store.addEnergy(3.0 * dt);
        // rest heals faster — body and Nano Tech share the recovery
        this.store.heal('wings', 1.5 * dt);
        this.store.heal('shield', 1.5 * dt);
        if (this._restTimer === undefined) this._restTimer = 0;
        this._restTimer += dt;
        if (this._restTimer > 4) {
          this._restTimer = 0;
          this.console.say('suit', 'BODY SYNC: resting — Nano Tech recharging & healing with the body (unified)');
          this.log('BODY SYNC: resting — energy ' + U.fmt(this.store.energy, 0) +
            '%, Wings ' + U.fmt(this.store.integrity.wings, 0) + '%, Shield ' +
            U.fmt(this.store.integrity.shield, 0) + '%', 'ready');
          this.store.addXp('knowledge', 1);
          this.store.syncBroadcast();
          this.onXp();
          this.onSync();
        }
      }

      // knowledge grows with body experience (syncs to all agents via store)
      if (flying || walking) {
        this.store.addXp('knowledge', 0.1);
      }
    }

    /* ---------------- integrity degradation (so healing is needed) ---------------- */
    _degrade(dt) {
      this._degradeTimer += dt;
      if (this._degradeTimer < 2) return;
      this._degradeTimer = 0;
      // harsh environments slowly degrade integrity; flight degrades wings
      if (this.store.envActive === 'heat') {
        this.store.damage('shield', 0.6);
      }
      if (this.store.envActive === 'ice') {
        this.store.damage('wings', 0.3);
      }
      if (this.env.flight) {
        this.store.damage('wings', 0.4);
      }
    }

    /* ---------------- main tick ---------------- */
    tick(dt) {
      this._degrade(dt);
      this._flightDuration(dt);
      this._selfHeal(dt);
      this._solar(dt);
      this._bodySync(dt);
      // periodic sync to all agents (one store)
      this.store.syncBroadcast();
      this.onSync();
    }

    state() {
      return {
        flightMode: this.store.flightMode,
        flightTime: this.store.flightTime,
        energy: this.store.energy,
        fatigue: this.store.fatigue,
        solar: this.store.solar,
        selfHeal: this.store.selfHeal,
        bodySync: this.store.bodySync,
        integrity: Object.assign({}, this.store.integrity),
        wind: this.env.windStrength,
        knowledge: this.store.xp.knowledge
      };
    }
  }

  global.BodySystems = BodySystems;
})(window);
