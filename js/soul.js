/* soul.js — The Archangel SOUL: a strong, local, offline agent.
   Layered ON TOP of the working simulation (thermal, fail-closed, volcano, goal,
   autonomous all stay intact). Adds:
     1. Intent Layer  — "nais ni Director" (labas pakpak / shield / tago) takes
        priority; autonomous danger-response still fires when no override.
     2. Archangel as Nano — the SOUL itself decides when to Wings / Shield /
        explore the Volcano. Loop: Perception → Planner → Controller →
        Suit Developer → Data Store.
     3. Multi-Sync — one data store; what one body learns syncs to all bodies.
     4. Body Discovery — new bodies are capability-checked (joints, thermal
        sensor, load capacity); if not ready, logs "Body not ready, waiting".
     5. Memory — remembers its last action / movement.
   All decisions are in-browser, no API key, no cloud, works offline. */
(function (global) {
  'use strict';

  /* capability thresholds for a body to be "ready" */
  const MIN_JOINTS = 20;
  const MIN_CAPACITY = 45;

  class Soul {
    constructor(deps) {
      this.robot = deps.robot;
      this.volcano = deps.volcano;
      this.thermal = deps.thermal;
      this.env = deps.env || null;
      this.console = deps.console;
      this.log = deps.log;
      this.store = deps.store;
      this.cmd = deps.cmd;
      this.onXp = deps.onXp || function () {};
      this.onSync = deps.onSync || function () {};

      this.autonomous = false;

      // memory: remembers last action / movement
      this.memory = { lastAction: 'idle', lastMovement: 'stand', history: [] };

      // Intent Layer (Director override)
      this.directorIntent = null;   // {action, until}
      this.directorOverride = false;

      // bodies
      this.bodies = [];
      this.bodySeq = 0;
      this.discoverTimer = 0;
      this.nextDiscoverIn = 8;

      // autonomous state machine
      this.state = 'IDLE';
      this.timer = 0;
      this.wingsOpen = false;
      this.shieldUp = false;
      this.patrolIdx = 0;
      this.loopCounter = 0;

      // Body 1 is the active physical body (always ready).
      // Capability check deferred to first tick so onSync callbacks don't
      // fire before the Soul instance is fully assigned.
      this._addBody({ joints: 24, thermalSensor: true, capacity: 55, active: true });
      this._firstTick = true;
    }

    /* ---------------- Body Discovery ---------------- */
    _addBody(caps) {
      this.bodySeq++;
      const body = {
        id: this.bodySeq,
        status: 'discovering',
        ready: false,
        active: !!caps.active,
        joints: caps.joints,
        thermalSensor: caps.thermalSensor,
        capacity: caps.capacity,
        syncedKnowledge: this.store.xp.knowledge,
        syncedEpoch: this.store.syncEpoch
      };
      this.bodies.push(body);
      this.store.addBody(body);
      return body;
    }

    _checkBody(body) {
      const reasons = [];
      if (body.joints < MIN_JOINTS) reasons.push(body.joints + ' joints');
      if (!body.thermalSensor) reasons.push('no thermal sensor');
      if (body.capacity < MIN_CAPACITY) reasons.push('capacity ' + body.capacity + 'kg');
      const ready = reasons.length === 0;
      body.ready = ready;
      body.status = ready ? 'ready' : 'waiting';
      if (ready) {
        this.console.say('suit', 'Body ' + body.id + ' ready — ' + body.joints + ' joints, thermal sensor, capacity ' + body.capacity + 'kg — synced');
        this.log('Body ' + body.id + ' ready — capability check passed, synced to data store');
        this._sync();
      } else {
        this.console.say('perception', 'Body ' + body.id + ' not ready — ' + reasons.join(', ') + ' — waiting');
        this.log('Body ' + body.id + ' not ready, waiting (' + reasons.join(', ') + ')', 'amber');
      }
      return ready;
    }

    _discovery(dt) {
      this.discoverTimer += dt;
      if (this.discoverTimer >= this.nextDiscoverIn) {
        this.discoverTimer = 0;
        this.nextDiscoverIn = U.rand(7, 12);
        // attempt to discover a new body with random capabilities
        const caps = {
          joints: Math.floor(U.rand(16, 27)),
          thermalSensor: Math.random() < 0.7,
          capacity: Math.floor(U.rand(30, 60)),
          active: false
        };
        const body = this._addBody(caps);
        this.console.say('perception', 'Body discovery: found Body ' + body.id + ' — checking capabilities');
        this.log('Body discovery: Body ' + body.id + ' detected, running capability check', 'sys');
        this._checkBody(body);
      }
    }

    /* ---------------- Multi-Sync ---------------- */
    _sync() {
      this.store.syncBroadcast();
      this.onSync();
    }

    /* ---------------- Memory ---------------- */
    _remember(action, movement) {
      this.memory.lastAction = action;
      if (movement) this.memory.lastMovement = movement;
      this.memory.history.push({ t: U.now(), action: action });
      if (this.memory.history.length > 40) this.memory.history.shift();
    }

    /* ---------------- Intent Layer ---------------- */
    _parseIntent(text) {
      const t = text.toLowerCase();
      if (/(lipad|fly|lumipad|aviation|sa- hangin)/.test(t)) return 'flight';
      if (/(labas|bukas|open|i-?open|parong|pakpak|wing)/.test(t)) return 'wings';
      if (/(shield|itaas|raise|guard|kalasag)/.test(t)) return 'shield';
      if (/(tago|hide|retreat|urong|sanhi)/.test(t)) return 'retreat';
      if (/(explore|i-?explore|bulakan|bulkan| exploration)/.test(t)) return 'explore';
      if (/(stop|hinto|tigil)/.test(t)) return 'stop';
      if (/(stand|tayo|tayu|tumayo)/.test(t)) return 'stand';
      if (/(walk|lakad|lumakad|galaw)/.test(t)) return 'walk';
      if (/(squat|upo|umupo)/.test(t)) return 'squat';
      if (/(wave|kumaway|kumaway)/.test(t)) return 'wave';
      return null;
    }

    _intentDuration(action) {
      // movement intents hold the override longer; toggles are brief
      return (action === 'retreat' || action === 'explore' || action === 'walk' || action === 'flight') ? 6000 : 3500;
    }

    setIntent(text) {
      const action = this._parseIntent(text);
      if (!action) {
        this.console.say('planner', 'Intent not recognized: "' + text + '"');
        this.log('Intent not recognized: "' + text + '" — try: labas pakpak / shield / tago', 'amber');
        return false;
      }
      this.directorIntent = { action: action, until: performance.now() + this._intentDuration(action) };
      this.directorOverride = true;
      this._executeIntent(action, text);
      return true;
    }

    _executeIntent(action, text) {
      let label = action;
      switch (action) {
        case 'wings':
          if (this.robot.wingTarget < 0.5) this.cmd.wings();
          label = 'Open Wings — Director: "' + text + '"';
          break;
        case 'flight':
          if (this.env) this.env.setFlight(true);
          label = 'Flight — Director: "' + text + '" — wings open, lifting off';
          break;
        case 'shield':
          if (this.robot.shieldTarget < 0.5) this.cmd.raiseShield();
          label = 'Raise Shield — Director: "' + text + '"';
          break;
        case 'retreat':
          this.cmd.walkTo({ x: 0, z: 8 }, 2);
          label = 'Retreat to safe zone — Director: "' + text + '"';
          break;
        case 'explore':
          this.cmd.enterVolcano();
          label = 'Explore Volcano — Director: "' + text + '"';
          break;
        case 'stop': this.cmd.stop(); label = 'Stop — Director: "' + text + '"'; break;
        case 'stand': this.cmd.stand(); label = 'Stand — Director: "' + text + '"'; break;
        case 'walk': this.cmd.walk(); label = 'Walk — Director: "' + text + '"'; break;
        case 'squat': this.cmd.squat(); label = 'Squat — Director: "' + text + '"'; break;
        case 'wave': this.cmd.wave(); label = 'Wave — Director: "' + text + '"'; break;
      }
      this._remember(label, action);
      this.console.say('controller', label + ' — Director override active');
      this.log('DIRECTOR INTENT: "' + text + '" → ' + action, 'sys');
    }

    /* ---------------- perception / danger ---------------- */
    _perception() {
      const r = this.robot.group.position;
      const vent = this.volcano.active ? Volcano.VENT : null;
      const dist = vent ? Math.hypot(r.x - vent.x, r.z - vent.z) : Math.hypot(r.x, r.z - 8);
      return { dist: dist, tOut: this.thermal.tOut, locked: this.thermal.locked, pos: r };
    }

    _danger(perc) {
      return this.thermal.tIn > 41 || perc.dist < 13;
    }

    /* ---------------- autonomous decision loop ---------------- */
    setAutonomous(on) {
      if (this.autonomous === on) return;
      this.autonomous = on;
      if (on) {
        this.state = 'APPROACH';
        this.timer = 0;
        this.console.say('planner', 'SOUL autonomous ON — the Archangel decides: Wings, Shield, explore');
        this.log('SOUL autonomous ON — full decision loop active (Perception → Planner → Controller → Suit Developer → Data Store)');
      } else {
        this.cmd.stop(); this.cmd.stand();
        this.robot.setWings(false); this.robot.setShield(false);
        this.console.say('controller', 'SOUL autonomous OFF — manual / Director control');
        this.log('SOUL autonomous OFF — decision loop halted');
      }
    }

    _autonomous(dt, perc) {
      this.timer += dt;
      // loop heartbeat: Perception → Planner → Controller → Suit Developer → Data Store
      if (this.timer >= 0.9) {
        this.timer = 0;
        this.loopCounter++;
        this.store.cycles++;
        this.console.say('perception', 'Sensed: vent ' + U.fmt(perc.dist, 1) + 'm · LABAS ' + U.fmt(perc.tOut, 0) + '°C · LOOB ' + U.fmt(this.thermal.tIn) + '°C' + (perc.locked ? ' · EMERGENCY' : ''));
        // Suit Developer: save + learn, then sync to all bodies
        this.store.saved++;
        this.store.addXp('shield', 1);
        this.store.addXp('knowledge', 2);
        this.onXp();
        this._sync();
        this.console.say('suit', 'simulation data saved to Nano Tech Archangel Suit · synced to ' + this._readyCount() + ' bodies');
        this.log('SOUL loop ' + this.loopCounter + ' — data saved & synced to ' + this._readyCount() + ' bodies');
      }

      if (perc.locked) { this.console.say('controller', 'Motion locked by fail-closed thermal — SOUL awaiting cooldown'); return; }

      switch (this.state) {
        case 'APPROACH': {
          if (this.timer < 0.1) {
            this.console.say('planner', 'SOUL plan: approach volcano vent (' + U.fmt(perc.dist, 1) + 'm)');
            this.cmd.walkTo(Volcano.VENT, 15);
            this.console.say('controller', 'SOUL: walking toward vent');
            this._remember('Approach vent', 'walk');
          }
          if (perc.dist < 16) {
            this.cmd.stop();
            this.state = 'OBSERVE'; this.timer = 0;
            this.console.say('planner', 'SOUL reached observation point — deploying Wings & Shield');
          }
          break;
        }
        case 'OBSERVE': {
          if (!this.wingsOpen) {
            this.wingsOpen = true;
            this.robot.setWings(true);
            this.store.addXp('wings', 5); this.onXp(); this._sync();
            this.console.say('controller', 'SOUL: Open Wings — full feathered spread');
            this.log('SOUL: wings deployed (+5 Wings XP, synced)');
            this._remember('Open Wings (autonomous)', 'wings');
          }
          if (!this.shieldUp) {
            this.shieldUp = true;
            this.robot.setShield(true);
            this.store.addXp('shield', 5); this.onXp(); this._sync();
            this.console.say('controller', 'SOUL: Raise Shield — facing the heat');
            this.log('SOUL: shield raised (+5 Shield XP, synced)');
            this._remember('Raise Shield (autonomous)', 'shield');
          }
          this.state = 'PATROL'; this.timer = 0;
          break;
        }
        case 'PATROL': {
          // autonomous flight decision: occasionally the Soul decides to fly
          // to survey the volcano from above (wings as lift)
          if (this._flightDecision === undefined) this._flightDecision = 0;
          this._flightDecision += dt;
          if (this._flightDecision >= 14 && !this.env.flight && Math.random() < 0.5) {
            this._flightDecision = 0;
            this.state = 'FLIGHT'; this.timer = 0;
            this.console.say('planner', 'SOUL: deciding to fly — surveying the volcano from above');
            break;
          }
          if (this.timer >= 4) {
            this.timer = 0;
            this.patrolIdx = (this.patrolIdx + 1) % 4;
            const ang = this.patrolIdx * (Math.PI / 2) + 0.4;
            const wp = { x: Volcano.VENT.x + Math.cos(ang) * 16, z: Volcano.VENT.z + Math.sin(ang) * 16 };
            this.cmd.walkTo(wp, 2.0);
            this.console.say('planner', 'SOUL patrol waypoint ' + (this.patrolIdx + 1) + '/4');
            this.console.say('controller', 'SOUL: patrol walk — 4-phase gait');
            this.store.addXp('knowledge', 2); this.onXp(); this._sync();
            this._remember('Patrol waypoint ' + (this.patrolIdx + 1), 'walk');
          }
          break;
        }
        case 'RETREAT': {
          if (this.timer < 0.1) {
            this.cmd.walkTo({ x: 0, z: 8 }, 2);
            this.console.say('controller', 'SOUL: thermal margin low — retreating');
            this._remember('Retreat (autonomous)', 'walk');
          }
          if (this.thermal.tIn < 38.5) { this.state = 'APPROACH'; this.timer = 0; }
          break;
        }
        case 'FLIGHT': {
          // the Soul itself decides to fly — wings as lift, survey from above
          if (!this.env.flight) {
            this.env.setFlight(true);
            this.console.say('planner', 'SOUL: deciding to fly — wings as lift, ascending over the volcano');
            this.console.say('controller', 'SOUL: FLIGHT — wings open full, lifting off');
            this._remember('Flight (autonomous)', 'flight');
          }
          // once landed, return to patrol
          if (!this.env.flight && this.env.flightPhase === 'IDLE') {
            this.state = 'PATROL'; this.timer = 0;
            this.console.say('planner', 'SOUL: flight complete — back to patrol');
          }
          break;
        }
      }
      // thermal margin → planner intervention
      if (this.thermal.tIn > 41.5 && this.state !== 'RETREAT') {
        this.state = 'RETREAT';
        this.console.say('planner', 'SOUL: LOOB ' + U.fmt(this.thermal.tIn) + '°C — plan changed to RETREAT');
        this.log('SOUL: thermal margin low — retreat', 'amber');
      }
    }

    _readyCount() {
      return this.bodies.filter(function (b) { return b.ready; }).length;
    }

    tick(dt) {
      // first-tick body capability check (deferred to avoid callback during construction)
      if (this._firstTick) {
        this._firstTick = false;
        this._checkBody(this.bodies[0]);
      }

      // director override expiry
      if (this.directorOverride && performance.now() > this.directorIntent.until) {
        this.directorOverride = false;
        this.directorIntent = null;
        this.console.say('planner', 'Director override ended — SOUL autonomous resumes');
      }

      this._discovery(dt);

      const perc = this._perception();

      // danger auto-Shield — fires when NO Director override (director wins)
      if (!this.directorOverride && !this.thermal.locked && this._danger(perc) && !this.shieldUp) {
        this.robot.setShield(true);
        this.shieldUp = true;
        this._remember('Auto-Shield (danger)', 'shield');
        this.console.say('controller', 'DANGER — SOUL auto-Shield deployed (no command)');
        this.log('SOUL: danger detected (thermal/proximity) — auto-Shield', 'amber');
      }

      if (this.autonomous && !this.directorOverride) {
        this._autonomous(dt, perc);
      }
    }
  }

  global.Soul = Soul;
})(window);
