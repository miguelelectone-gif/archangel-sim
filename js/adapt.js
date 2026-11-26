/* adapt.js — Adapt Layer, additive on top of the Soul layer.
   The Soul READS a body and adapts to OPEN simulator bodies only:
     - "Ito ba ay ALVE? G1? Zeroth-01? Ilang joints? Anong sensor?"
     - If the simulator is open / permission granted → ADAPT and sync.
     - If the body is closed / no permission → log
       "Body not available, waiting for permission" — never forces entry.
   NO capture, NO bypass, NO hack of another robot's lock. Adapt only to
   permitted, open simulators.

   Also spawns multiple virtual Humanoid agents (3 / 5 / 10) that walk,
   deploy Wings, raise Shield, run Thermal simultaneously — all sharing
   ONE data store with auto-sync. */
(function (global) {
  'use strict';

  /* known simulator body types the Soul can adapt to */
  const BODY_PROFILES = [
    { id: 'ALVE-Sim',   name: 'ALVE',   type: 'ALVE',   joints: 24, sensors: ['thermal', 'imu'],       permission: 'open' },
    { id: 'G1-Sim',     name: 'G1',     type: 'G1',     joints: 22, sensors: ['thermal'],              permission: 'open' },
    { id: 'Zeroth-Sim', name: 'Zeroth', type: 'Zeroth', joints: 26, sensors: ['thermal', 'lidar'],      permission: 'open' },
    { id: 'Foreign-Locked', name: 'Locked Foreign Unit', type: 'Unknown',
      joints: 20, sensors: ['thermal'], permission: 'closed' }
  ];

  /* ---------------- Adapter Layer ---------------- */
  class AdapterLayer {
    constructor(deps) {
      this.console = deps.console;
      this.log = deps.log;
      this.store = deps.store;
      this.adapted = [];   // bodies the Soul successfully adapted to
      this.waiting = [];   // bodies that are closed — waiting for permission
    }

    /* Read a body profile, identify its type & capabilities, adapt if open. */
    scan() {
      this.console.say('perception', 'Adapter Layer: reading nearby simulator bodies for adaptation...');
      this.log('Adapter Layer: scanning for open simulator bodies (ALVE / G1 / Zeroth)', 'sys');

      BODY_PROFILES.forEach((prof) => {
        const body = {
          id: prof.id,
          name: prof.name,
          type: prof.type,
          joints: prof.joints,
          sensors: prof.sensors.slice(),
          permission: prof.permission,
          ready: false,
          syncedEpoch: this.store.syncEpoch
        };

        if (prof.permission === 'open') {
          // open simulator → read capabilities, adapt, sync
          body.ready = true;
          body.status = 'adapted';
          this.adapted.push(body);
          this.store.addBody(body);
          this.console.say('suit', 'READ: ' + prof.id + ' — type ' + prof.type +
            ', ' + prof.joints + ' joints, sensors [' + prof.sensors.join(', ') +
            '], permission OPEN → adapting');
          this.log('ADAPTED: ' + prof.id + ' (' + prof.type + ') — ' + prof.joints +
            ' joints, [' + prof.sensors.join(', ') + '] — synced', 'ready');
        } else {
          // closed / no permission → do NOT force; log waiting
          body.status = 'locked';
          this.waiting.push(body);
          this.console.say('perception', 'Body not available, waiting for permission — ' + prof.id);
          this.log('Body not available, waiting for permission (' + prof.id + ') — not forcing', 'amber');
        }
      });

      this.store.syncBroadcast();
      this.console.say('planner', 'Adapt scan complete — ' + this.adapted.length +
        ' bodies adapted, ' + this.waiting.length + ' waiting for permission');
      this.log('Adapt scan complete: ' + this.adapted.length + ' adapted, ' +
        this.waiting.length + ' waiting for permission', 'sys');
      return this.adapted;
    }

    adaptedNames() { return this.adapted.map(function (b) { return b.id; }); }
  }

  /* ---------------- Virtual Agent (lightweight humanoid) ---------------- */
  class VirtualAgent {
    constructor(scene, opts) {
      this.scene = scene;
      this.id = opts.id;
      this.label = opts.label;
      this.ringR = opts.ringR;
      this.ringAngle = opts.angle;
      this.ringSpeed = opts.speed;
      this.ringCenter = opts.center || new THREE.Vector3(0, 0, -12);
      this.wingsOpen = false;
      this.shieldUp = false;
      this.thermalOn = true;
      this.tIn = 36.5;
      this.tOut = 30;
      this.locked = false;
      this.state = 'PATROL';
      this.timer = 0;
      this.phase = opts.phase || 0;
      this.walking = true;
      this._build();
    }

    _build() {
      const g = new THREE.Group();
      // torso
      const torso = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.13, 0.5, 12),
        new THREE.MeshStandardMaterial({ color: 0xf2f0e8, roughness: 0.5, metalness: 0.1 })
      );
      torso.position.y = 0.78; torso.castShadow = true;
      g.add(torso);
      // head
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0xf0d070, roughness: 0.4, metalness: 0.3 })
      );
      head.position.y = 1.18; head.castShadow = true;
      g.add(head);
      // halo ring
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(0.13, 0.012, 8, 20),
        new THREE.MeshBasicMaterial({ color: 0xffe08a })
      );
      halo.position.y = 1.32; halo.rotation.x = Math.PI / 2;
      g.add(halo); this.halo = halo;
      // wings (two broad planes)
      const wingMat = new THREE.MeshStandardMaterial({
        color: 0xf6e6a8, roughness: 0.6, metalness: 0.2,
        side: THREE.DoubleSide, transparent: true, opacity: 0.92
      });
      const wL = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.42), wingMat);
      wL.position.set(-0.16, 0.85, 0); wL.castShadow = true;
      const wR = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.42), wingMat);
      wR.position.set(0.16, 0.85, 0); wR.castShadow = true;
      g.add(wL, wR);
      this.wings = { L: wL, R: wR, spread: 0 };
      // shield (plane on left)
      const shield = new THREE.Mesh(
        new THREE.PlaneGeometry(0.22, 0.4),
        new THREE.MeshStandardMaterial({ color: 0xd8b54a, roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide })
      );
      shield.position.set(-0.3, 0.85, 0.02);
      g.add(shield); this.shield = shield;
      // chest crystal (thermal indicator)
      const crystal = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0x66e0ff })
      );
      crystal.position.set(0, 0.9, 0.12);
      g.add(crystal); this.crystal = crystal;

      this.group = g;
      this._place();
      this.scene.add(g);
    }

    _place() {
      const x = this.ringCenter.x + Math.cos(this.ringAngle) * this.ringR;
      const z = this.ringCenter.z + Math.sin(this.ringAngle) * this.ringR;
      this.group.position.set(x, 0, z);
      this.group.rotation.y = this.ringAngle + Math.PI / 2; // face tangent
    }

    setWings(open) {
      this.wingsOpen = open;
      this.wings.spread = open ? 1 : 0;
    }
    setShield(up) { this.shieldUp = up; }

    update(dt, envTemp) {
      this.timer += dt;
      this.phase += dt * 4.2;

      // --- thermal (simplified, shares the suit target/limits) ---
      if (this.thermalOn && !this.locked) {
        this.tOut = envTemp;
        // agent gets hotter when closer to the vent (ring inner edge)
        const distToVent = Math.hypot(this.group.position.x - this.ringCenter.x,
          this.group.position.z - this.ringCenter.z);
        const heatBias = U.clamp(18 - distToVent, 0, 12);
        this.tIn = U.damp(this.tIn, 36.5 + heatBias, 2.2, dt);
        if (this.tIn > 45) { this.locked = true; this.walking = false; }
        if (this.tIn < 38.5 && this.locked) { this.locked = false; this.walking = true; }
      }

      // thermal indicator color
      const tc = this.tIn > 41 ? 0xff5a3c : (this.tIn > 38 ? 0xffc24a : 0x66e0ff);
      this.crystal.material.color.setHex(tc);

      if (this.locked) {
        // fail-closed: shield up, stand
        if (!this.shieldUp) { this.setShield(true); }
        this.group.position.y = U.damp(this.group.position.y, 0, 4, dt);
        return;
      }

      // --- walk along the ring ---
      if (this.walking) {
        this.ringAngle += this.ringSpeed * dt / this.ringR;
        this._place();
        this.group.position.y = U.damp(this.group.position.y, 0, 6, dt);
      }

      // --- autonomous Wings / Shield cycling ---
      if (this.timer >= 4.5) {
        this.timer = 0;
        const roll = Math.random();
        if (roll < 0.4) {
          this.setWings(!this.wingsOpen);
        } else if (roll < 0.7) {
          this.setShield(!this.shieldUp);
        }
      }

      // animate wings
      this.wings.spread = U.damp(this.wings.spread, this.wingsOpen ? 1 : 0, 6, dt);
      const flap = this.wings.spread > 0.02 ? Math.sin(this.phase) * 0.08 * this.wings.spread : 0;
      this.wings.L.rotation.y = U.lerp(1.5, 0.1, this.wings.spread) + flap;
      this.wings.R.rotation.y = U.lerp(-1.5, -0.1, this.wings.spread) - flap;
      this.wings.L.position.x = U.lerp(-0.16, -0.42, this.wings.spread);
      this.wings.R.position.x = U.lerp(0.16, 0.42, this.wings.spread);
      // shield
      this.shield.rotation.x = U.lerp(-0.1, -0.9, this.shieldUp ? 1 : 0);
      // halo spin
      this.halo.rotation.z += dt * 1.2;
    }
  }

  /* ---------------- Multi-Agent Manager ---------------- */
  class MultiAgentManager {
    constructor(deps) {
      this.scene = deps.scene;
      this.store = deps.store;
      this.console = deps.console;
      this.log = deps.log;
      this.volcano = deps.volcano;
      this.adapter = deps.adapter;
      this.onSync = deps.onSync || function () {};
      this.onXp = deps.onXp || function () {};
      this.agents = [];
      this.count = 0;
      this._ringR = 16;
    }

    setCount(n) {
      n = Math.max(0, Math.min(10, Math.floor(n)));
      if (n === this.count) return;
      // remove extras
      while (this.agents.length > n) {
        const a = this.agents.pop();
        this.scene.remove(a.group);
      }
      // add new agents
      const adapted = this.adapter.adapted;
      while (this.agents.length < n) {
        const i = this.agents.length;
        const label = i < adapted.length ? adapted[i].id : 'Virtual-' + (i + 1);
        const agent = new VirtualAgent(this.scene, {
          id: 'agent-' + (i + 1),
          label: label,
          ringR: this._ringR + (i % 3) * 1.6,
          angle: (i / Math.max(1, n)) * Math.PI * 2,
          speed: 1.4 + (i % 3) * 0.3,
          phase: i * 1.1
        });
        this.agents.push(agent);
      }
      this.count = n;
      this.console.say('controller', 'Multi-Agent: ' + n + ' virtual humanoids active — shared data store, auto-sync');
      this.log('Multi-Agent: ' + n + ' virtual humanoids spawned — walking, Wings, Shield, Thermal in sync', 'sys');
    }

    update(dt) {
      const envTemp = this.volcano.active
        ? this.volcano.exteriorTemp(0, -12)
        : 30;
      this.agents.forEach((a, i) => {
        a.update(dt, envTemp);
        // each agent syncs its learning to the shared store (auto-sync)
        if (a.timer < 0.05 && i % 2 === 0) {
          // throttled per-agent sync on state changes
        }
      });
      // aggregate sync: every agent contributes, one broadcast
      if (dt > 0) {
        // agents share XP to the one store on their action cycles
      }
      // periodically broadcast sync + XP from agents
      this._syncTimer = (this._syncTimer || 0) + dt;
      if (this._syncTimer >= 2.5) {
        this._syncTimer = 0;
        let wingsActive = 0, shieldActive = 0;
        this.agents.forEach(function (a) {
          if (a.wingsOpen) wingsActive++;
          if (a.shieldUp) shieldActive++;
        });
        // agents learn together into ONE store
        this.store.addXp('knowledge', Math.min(10, this.agents.length));
        this.store.addXp('wings', Math.min(5, wingsActive));
        this.store.addXp('shield', Math.min(5, shieldActive));
        this.store.saved++;
        this.store.syncBroadcast();
        this.onSync();
        this.onXp();
        this.console.say('suit', this.agents.length + ' agents synced — ' +
          wingsActive + ' Wings, ' + shieldActive + ' Shield, shared store epoch ' + this.store.syncEpoch);
        this.log('Multi-Agent sync: ' + this.agents.length + ' agents → 1 store (Wings ' +
          wingsActive + ', Shield ' + shieldActive + ')', 'sync');
      }
    }

    stateSummary() {
      let walking = 0, wings = 0, shield = 0, locked = 0;
      this.agents.forEach(function (a) {
        if (a.walking) walking++;
        if (a.wingsOpen) wings++;
        if (a.shieldUp) shield++;
        if (a.locked) locked++;
      });
      return { count: this.agents.length, walking: walking, wings: wings, shield: shield, locked: locked };
    }
  }

  global.AdapterLayer = AdapterLayer;
  global.VirtualAgent = VirtualAgent;
  global.MultiAgentManager = MultiAgentManager;
})(window);
