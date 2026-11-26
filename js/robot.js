/* robot.js — The Humanoid Robot, which IS the Nano Tech Archangel Suit.
   White & gold, large layered feathered wings, gold trim, wide shield-like
   shoulder armor, chest crystal, halo, long skirt plates.
   4-phase gait: Double Support → Single Support & Swing → Heel-Strike → Push-Off. */
(function (global) {
  'use strict';

  function featherTexture() {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.00, '#ffffff');
    grad.addColorStop(0.45, '#f6f1e2');
    grad.addColorStop(0.78, '#e8c96a');
    grad.addColorStop(1.00, '#c9a227');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 256);
    // feather shaft
    g.strokeStyle = 'rgba(120,90,20,.55)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(64, 4); g.lineTo(64, 252); g.stroke();
    // barb texture
    g.strokeStyle = 'rgba(140,110,40,.22)'; g.lineWidth = 1.5;
    for (let i = 0; i < 26; i++) {
      const y = 8 + i * 9.5;
      g.beginPath(); g.moveTo(30, y); g.lineTo(98, y); g.stroke();
    }
    // subtle shading at edges
    const sh = g.createLinearGradient(0, 0, 128, 0);
    sh.addColorStop(0, 'rgba(0,0,0,.28)'); sh.addColorStop(0.5, 'rgba(0,0,0,0)');
    sh.addColorStop(1, 'rgba(0,0,0,.28)');
    g.fillStyle = sh; g.fillRect(0, 0, 128, 256);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  }

  function featherGeometry(len, wid, droop) {
    // Broad feather: length runs along the wing span (X), width front-to-back (Z),
    // thin vertically (Y). The tip droops down (negative Y) for a curved wing.
    const w = wid, h = len;
    const shape = new THREE.Shape();
    shape.moveTo(0, -w / 2);
    shape.quadraticCurveTo(h * 0.25, -w / 2 - w * 0.08, h * 0.88, -w * 0.18);
    shape.quadraticCurveTo(h, 0, h * 0.88, w * 0.18);
    shape.quadraticCurveTo(h * 0.25, w / 2 + w * 0.08, 0, w / 2);
    shape.quadraticCurveTo(0, 0, 0, -w / 2);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.014, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1
    });
    geo.translate(0, 0, -0.007);
    geo.rotateX(-Math.PI / 2);          // length -> X (span), width -> Z, thin -> Y
    // droop the tip downward
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = Math.max(0, pos.getX(i));
      pos.setY(i, pos.getY(i) - droop * Math.pow(x / h, 2));
    }
    geo.computeVertexNormals();
    return geo;
  }

  function shieldShapeGeometry() {
    // broad, wide shield (heater-style but wide)
    const s = new THREE.Shape();
    s.moveTo(-0.42, 0.52);
    s.lineTo(0.42, 0.52);
    s.quadraticCurveTo(0.56, 0.18, 0.50, -0.20);
    s.lineTo(0.28, -0.66);
    s.quadraticCurveTo(0.08, -0.86, -0.08, -0.66);
    s.lineTo(-0.50, -0.20);
    s.quadraticCurveTo(-0.56, 0.18, -0.42, 0.52);
    return new THREE.ExtrudeGeometry(s, {
      depth: 0.06, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.014, bevelSegments: 2
    });
  }

  class Robot {
    constructor(scene) {
      this.scene = scene;
      this.group = new THREE.Group();
      this.group.position.set(0, 0, 8);

      this.phase = 0;          // gait phase [0, 2π)
      this.cadence = 6.4;      // rad/s (~2 steps/s)
      this.speed = 1.5;        // m/s walking

      this.heading = 0;        // facing +Z when 0
      this.headingTarget = 0;

      this.moving = false;
      this.pose = 'stand';     // stand | walk | squat | wave | shield
      this.wingSpread = 0;     // 0 folded, 1 fully open
      this.wingTarget = 0;
      this.shieldUp = 0;       // 0 down, 1 raised
      this.shieldTarget = 0;
      this.waveT = 0;

      // additive: flight / environment-adaptive gait state (set by EnvironmentManager)
      this.flightMode = false; // wings as lift — flying pose
      this.swimMode = false;   // water — sculling leg motion
      this.iceMode = false;    // ice — high-friction, stable gait
      this._windFold = 0;      // wind — partial wing fold under gusts
      this._flightLift = 0;    // current lift from wings in flight

      this.actual = {};        // smoothed joint angles

      this._build();
      scene.add(this.group);
    }

    /* ---------------- one wing: 3 rows of broad overlapping feathers ---------------- */
    _buildWing(side, root) {
      const wing = new THREE.Group();
      wing.position.set(side * 0.30, 0.44, -0.14);
      root.add(wing);

      const matFeather = new THREE.MeshStandardMaterial({
        map: this.featherTex, roughness: 0.5, metalness: 0.22, side: THREE.DoubleSide
      });

      // 3 rows: inner (short, high), middle, outer (longest, drooping down)
      const rows = [
        { len: 1.05, y: 0.26, droop: 0.10, fan: 0.10 },
        { len: 1.50, y: 0.03, droop: 0.24, fan: 0.17 },
        { len: 1.95, y: -0.22, droop: 0.46, fan: 0.23 }
      ];

      rows.forEach((row) => {
        const geo = featherGeometry(row.len, 0.60, row.droop);
        const count = 3;   // broad overlapping feathers per row
        for (let i = 0; i < count; i++) {
          const t = i / (count - 1);
          const feather = new THREE.Mesh(geo, matFeather);
          feather.castShadow = true;
          // overlap along the span; each feather is `row.len` long
          const along = side * (0.02 + t * row.len * 0.80);
          feather.position.set(along, row.y, 0);
          // slight outward twist along the span so the row curves naturally
          feather.rotation.y = -row.fan * side * (0.45 + t * 0.55);
          wing.add(feather);
        }
        // gold trim along the outer tip of the row
        const trim = new THREE.Mesh(new THREE.BoxGeometry(row.len * 0.82, 0.05, 0.07), this.matGold);
        trim.position.set(side * (row.len * 0.92), row.y - row.droop * 0.55, 0.03);
        trim.rotation.y = -row.fan * side * 0.7;
        wing.add(trim);
      });

      // gold root strut where the wing meets the back
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.5, 0.07), this.matGold);
      strut.position.set(0, 0.14, 0);
      wing.add(strut);

      // folded: lies along the back like a cape; open: spread wide & flat
      wing.rotation.y = side * 1.7;
      wing.rotation.z = side * 0.10;
      return wing;
    }

    /* ---------------- model ---------------- */
    _build() {
      const matWhite = new THREE.MeshStandardMaterial({ color: 0xeef2f7, roughness: 0.34, metalness: 0.28 });
      const matWhiteSoft = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.45, metalness: 0.2 });
      const matGold = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.28, metalness: 0.85, emissive: 0x2e2400, emissiveIntensity: 0.55 });
      const matDark = new THREE.MeshStandardMaterial({ color: 0x232833, roughness: 0.45, metalness: 0.65 });
      const matCyan = new THREE.MeshStandardMaterial({ color: 0x082830, emissive: 0x22d3ee, emissiveIntensity: 1.8, roughness: 0.2, metalness: 0.3 });
      this.matWhite = matWhite; this.matGold = matGold; this.matDark = matDark; this.matCyan = matCyan;

      const g = this.group;
      const root = new THREE.Group();          // pelvis root
      root.position.y = 0.95;
      g.add(root);
      this.root = root;

      /* ---- LEGS ---- */
      this.legs = {};
      [-1, 1].forEach((s, i) => {
        const hip = new THREE.Group();
        hip.position.set(s * 0.145, 0, 0);
        root.add(hip);
        const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.42, 0.18), matWhite);
        thigh.position.y = -0.21; thigh.castShadow = true;
        hip.add(thigh);
        const kneeCap = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 8), matGold);
        kneeCap.position.y = -0.42; kneeCap.castShadow = true;
        hip.add(kneeCap);

        const knee = new THREE.Group();
        knee.position.y = -0.42;
        hip.add(knee);
        const shin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.4, 0.16), matWhiteSoft);
        shin.position.y = -0.2; shin.castShadow = true;
        knee.add(shin);
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.09, 0.3), matDark);
        foot.position.set(0, -0.44, 0.05); foot.castShadow = true;
        knee.add(foot);
        const toe = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.05, 0.07), matGold);
        toe.position.set(0, -0.44, 0.2);
        knee.add(toe);

        this.legs[s > 0 ? 'R' : 'L'] = { hip, knee, foot, toe };
      });

      /* ---- TORSO ---- */
      const torso = new THREE.Group();
      torso.position.y = 0.16;
      root.add(torso);
      this.torso = torso;

      const chest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.3), matWhite);
      chest.position.y = 0.26; chest.castShadow = true;
      torso.add(chest);
      // gold trim on chest
      const trimTop = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.035, 0.32), matGold);
      trimTop.position.y = 0.5; torso.add(trimTop);
      const trimMid = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.02, 0.32), matGold);
      trimMid.position.y = 0.1; torso.add(trimMid);

      // chest crystal
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.115, 0), matCyan);
      crystal.position.set(0, 0.26, 0.175);
      torso.add(crystal);
      this.crystal = crystal;
      const crystalRing = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.014, 8, 24), matGold);
      crystalRing.position.set(0, 0.26, 0.17);
      torso.add(crystalRing);

      // waist belt + skirt mount
      const belt = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.09, 0.34), matGold);
      belt.position.y = -0.08; torso.add(belt);

      /* ---- SKIRT PLATES (long, below waist) ---- */
      this.skirtSway = 0;
      const skirt = new THREE.Group();
      skirt.position.set(0, -0.18, -0.02);
      root.add(skirt);
      this.skirt = skirt;
      const plateLen = 0.42;
      for (let i = 0; i < 5; i++) {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.1, plateLen, 0.03), matWhite);
        plate.position.set(-0.18 + i * 0.09, -plateLen / 2, 0);
        plate.castShadow = true;
        const edge = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.03, 0.035), matGold);
        edge.position.set(-0.18 + i * 0.09, -plateLen + 0.03, 0);
        skirt.add(plate, edge);
      }

      /* ---- HEAD + HALO ---- */
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.09, 10), matDark);
      neck.position.y = 0.62; torso.add(neck);
      const head = new THREE.Group();
      head.position.y = 0.68;
      torso.add(head);
      this.head = head;
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.145, 16, 14), matWhite);
      helmet.scale.set(0.95, 1.05, 1); helmet.castShadow = true;
      head.add(helmet);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.045, 0.02), matCyan);
      visor.position.set(0, 0.02, 0.138); head.add(visor);
      const crest = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.16), matGold);
      crest.position.set(0, 0.13, 0); head.add(crest);
      // halo
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.016, 10, 32), matGold);
      halo.position.y = 0.3; halo.rotation.x = 0.12;
      head.add(halo);
      this.halo = halo;

      /* ---- ARMS + SHIELDS ---- */
      this.arms = {};
      [-1, 1].forEach((s) => {
        const shoulder = new THREE.Group();
        shoulder.position.set(s * 0.31, 0.44, 0);
        torso.add(shoulder);

        // pauldron (wide, shield-like shoulder armor base)
        const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.20, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), matWhite);
        pauldron.scale.set(1.35, 0.78, 0.98);
        pauldron.castShadow = true;
        shoulder.add(pauldron);
        const pauldronRim = new THREE.Mesh(new THREE.TorusGeometry(0.20, 0.024, 8, 22), matGold);
        pauldronRim.rotation.x = Math.PI / 2; pauldronRim.scale.set(1.35, 0.98, 1);
        pauldronRim.position.y = 0.02;
        shoulder.add(pauldronRim);

        const upper = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.34, 0.14), matWhite);
        upper.position.y = -0.2; upper.castShadow = true;
        shoulder.add(upper);
        const elbow = new THREE.Group();
        elbow.position.y = -0.34;
        shoulder.add(elbow);
        const fore = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.13), matWhiteSoft);
        fore.position.y = -0.15; fore.castShadow = true;
        elbow.add(fore);
        const hand = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 0.12), matDark);
        hand.position.y = -0.3; hand.castShadow = true;
        elbow.add(hand);

        // shield — large, wide shoulder shield (gold rim, white face)
        const shield = new THREE.Group();
        const shieldBase = new THREE.Mesh(shieldShapeGeometry(), matGold);
        shieldBase.scale.setScalar(1.25);
        shield.add(shieldBase);
        const shieldFace = new THREE.Mesh(shieldShapeGeometry(), matWhite);
        shieldFace.scale.setScalar(1.21);
        shieldFace.position.z = 0.014;
        shield.add(shieldFace);
        const shieldBoss = new THREE.Mesh(new THREE.CircleGeometry(0.10, 14), matGold);
        shieldBoss.position.z = 0.05; shieldBoss.position.y = 0.12;
        shield.add(shieldBoss);
        shield.rotation.x = -0.12;
        shield.position.set(0, -0.08, 0.16);
        elbow.add(shield);

        this.arms[s > 0 ? 'R' : 'L'] = { shoulder, elbow, hand, shield };
      });

      /* ---- WINGS — exactly 2 wings (left + right), each 3 rows of broad
             overlapping feathers with gold trim at the tips, curving down. ---- */
      this.featherTex = featherTexture();
      this.wings = {};
      [-1, 1].forEach((s) => {
        const wing = this._buildWing(s, root);
        this.wings[s > 0 ? 'R' : 'L'] = wing;
      });

      /* ---- anchors for metrics ---- */
      this.footL = this.legs.L.foot; this.footR = this.legs.R.foot;
      this.handL = this.arms.L.hand; this.handR = this.arms.R.hand;

      // metrics accumulators (avoid NaN on first frame)
      this._lastComX = 0; this._lastComZ = 0; this._lastDt = 0.016;
      this._vel = new THREE.Vector2();
    }

    /* ---------------- public commands ---------------- */
    setMove(on) { this.moving = !!on; if (!on) this.pose = 'stand'; }
    setHeadingTarget(h) { this.headingTarget = h; }
    turnBy(rad) { this.headingTarget = this.heading + rad; }
    setPose(p) {
      this.pose = p;
      if (p !== 'walk') this.moving = false;
    }
    setWings(open) { this.wingTarget = open ? 1 : 0; }
    toggleWings() { this.wingTarget = this.wingTarget > 0.5 ? 0 : 1; }
    setShield(up) { this.shieldTarget = up ? 1 : 0; }
    toggleShield() { this.shieldTarget = this.shieldTarget > 0.5 ? 0 : 1; }
    startWave() { this.waveT = 2.4; }

    get forward() { return new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.heading); }

    /* ---------------- per-frame update ---------------- */
    update(dt, time) {
      // --- heading (smooth turn) ---
      let dh = this.headingTarget - this.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const turnRate = this.moving ? 3.2 : 2.4;
      this.heading += U.clamp(dh, -turnRate * dt, turnRate * dt);
      this.group.rotation.y = this.heading;

      // --- gait phase advances only while walking ---
      if (this.moving && this.pose === 'walk') {
        const prev = this.phase;
        this.phase = (this.phase + this.cadence * dt) % (Math.PI * 2);
        if (this.phase < prev) { this.gaitCycleDone = true; }
      }

      // --- target pose angles ---
      const p = this.phase;
      let pelvisY = 0.95, torsoX = 0, torsoZ = 0, torsoRoll = 0;
      let hipL = 0, kneeL = 0, footL = 0, hipR = 0, kneeR = 0, footR = 0;
      let armSwingL = 0.12, armSwingR = 0.12, armZL = 0, armZR = 0, elbowBend = 0;
      let waveAng = 0, waveFore = 0;

      if (this.pose === 'walk' && this.moving) {
        // 4-phase gait driven by phase p
        const sL = Math.sin(p), sR = Math.sin(p + Math.PI);
        const swingL = Math.max(0, sL), swingR = Math.max(0, sR);
        hipL = 0.42 * sL;  hipR = 0.42 * sR;
        kneeL = 0.1 + 0.75 * swingL * swingL;
        kneeR = 0.1 + 0.75 * swingR * swingR;
        footL = -0.28 * swingL + 0.3 * Math.max(0, -Math.sin(p + 0.5));
        footR = -0.28 * swingR + 0.3 * Math.max(0, -Math.sin(p + Math.PI + 0.5));
        pelvisY = 0.95 + 0.022 * Math.cos(2 * p);
        torsoRoll = 0.035 * Math.sin(p);
        armSwingL = 0.12 - 0.42 * sR;   // arms counter-swing legs
        armSwingR = 0.12 - 0.42 * sL;
        this.skirtSway = 0.05 * Math.sin(p);
      } else {
        this.skirtSway *= Math.exp(-3 * dt);
      }

      // squat override
      if (this.pose === 'squat') {
        pelvisY = 0.62;
        kneeL = 1.15; kneeR = 1.15;
        hipL = 0.28; hipR = 0.28;
        torsoX = 0.22;
        armSwingL = 0.5; armSwingR = 0.5;
        elbowBend = 0.3;
      }
      // shield raise override
      if (this.shieldUp > 0.02) {
        armSwingL = -1.25; armSwingR = -1.25;
        armZL = 0.35; armZR = -0.35;
        elbowBend = 0.15;
      }
      // wave override (right arm)
      if (this.waveT > 0) {
        this.waveT -= dt;
        waveAng = -2.3 + 0.55 * Math.sin(time * 9);
        waveFore = 0.5 * Math.sin(time * 14);
        armSwingR = -0.2;
      }

      // ===== additive: flight pose (wings as lift) =====
      if (this.flightMode) {
        pelvisY = 1.05;
        torsoX = 0.12;
        // legs tucked slightly for flight
        hipL = -0.2; hipR = -0.2;
        kneeL = 0.35; kneeR = 0.35;
        footL = 0.1; footR = 0.1;
        // arms forward, wings carry the lift
        armSwingL = -0.5; armSwingR = -0.5;
        elbowBend = 0.2;
        this.skirtSway = 0.04 * Math.sin(time * 3);
      }
      // ===== additive: water / swimming pose =====
      if (this.swimMode) {
        pelvisY = 0.85 + 0.04 * Math.sin(time * 2.2);
        torsoX = 0.18;
        // sculling leg motion: wide, slow kick
        hipL = 0.35 * Math.sin(time * 2.2); hipR = 0.35 * Math.sin(time * 2.2 + Math.PI);
        kneeL = 0.6 + 0.3 * Math.max(0, Math.sin(time * 2.2));
        kneeR = 0.6 + 0.3 * Math.max(0, Math.sin(time * 2.2 + Math.PI));
        footL = 0.4; footR = 0.4;
        armSwingL = -0.6 + 0.3 * Math.sin(time * 2.2);
        armSwingR = -0.6 + 0.3 * Math.sin(time * 2.2 + Math.PI);
        elbowBend = 0.5;
        this.skirtSway = 0.06 * Math.sin(time * 2.2);
      }
      // ===== additive: ice / high-friction stable gait =====
      if (this.iceMode && this.pose === 'walk' && this.moving) {
        // smaller, more deliberate steps — less slip
        torsoX = 0.06;
        armSwingL *= 0.7; armSwingR *= 0.7;
        torsoRoll *= 0.5;
      }

      // --- smooth joints ---
      const R = 14;
      const sm = (k, v) => { this.actual[k] = U.damp(this.actual[k] === undefined ? v : this.actual[k], v, R, dt); };
      sm('pelvisY', pelvisY); sm('torsoX', torsoX); sm('torsoZ', torsoZ); sm('torsoRoll', torsoRoll);
      this.root.position.y = this.actual.pelvisY;
      this.torso.rotation.x = this.actual.torsoX;
      this.torso.rotation.z = this.actual.torsoRoll;
      this.skirt.rotation.z = this.skirtSway * 0.6;
      this.skirt.position.y = -0.18 + Math.abs(this.skirtSway) * 0.1;

      const legs = this.legs;
      sm('hipL', hipL); sm('kneeL', kneeL); sm('footL', footL);
      sm('hipR', hipR); sm('kneeR', kneeR); sm('footR', footR);
      legs.L.hip.rotation.x = this.actual.hipL;
      legs.L.knee.rotation.x = Math.max(0, this.actual.kneeL);
      legs.L.foot.rotation.x = this.actual.footL;
      legs.R.hip.rotation.x = this.actual.hipR;
      legs.R.knee.rotation.x = Math.max(0, this.actual.kneeR);
      legs.R.foot.rotation.x = this.actual.footR;

      // arms (swing about X = forward/back)
      sm('armL', armSwingL); sm('armR', armSwingR);
      sm('armZL', armZL); sm('armZR', armZR);
      sm('elbow', elbowBend);
      sm('wave', waveAng); sm('waveFore', waveFore);
      const arms = this.arms;
      arms.L.shoulder.rotation.x = this.actual.armL;
      arms.L.shoulder.rotation.z = this.actual.armZL;
      arms.R.shoulder.rotation.x = this.actual.armR;
      arms.R.shoulder.rotation.z = this.actual.armZR;
      arms.L.elbow.rotation.x = -Math.max(0, this.actual.elbow);
      arms.R.elbow.rotation.x = -Math.max(0, this.actual.elbow);
      if (this.waveT > 0) {
        arms.R.shoulder.rotation.z = this.actual.wave;
        arms.R.elbow.rotation.x = -1.1 - this.actual.waveFore;
      }

      // --- wings: full spread with smooth open/close + idle sway ---
      this.wingSpread = U.damp(this.wingSpread, this.wingTarget, 5, dt);
      // flight: strong lift-driven flap; wind: partial fold under gusts
      const baseFlap = this.wingSpread > 0.02 ? Math.sin(time * 1.6) * 0.05 * this.wingSpread : 0;
      const flightFlap = this.flightMode ? Math.sin(time * 5) * 0.12 * this._flightLift : 0;
      const windFold = this._windFold || 0; // fraction to fold under wind gusts
      [-1, 1].forEach((s) => {
        const w = this.wings[s > 0 ? 'R' : 'L'];
        const foldY = s * 1.7, openY = s * 0.05;
        const spread = Math.max(0, this.wingSpread - windFold);
        w.rotation.y = U.lerp(foldY, openY, spread);
        w.rotation.z = U.lerp(s * 0.10, s * -0.22, spread) + (baseFlap + flightFlap) * s;
      });

      // --- shield raise ---
      this.shieldUp = U.damp(this.shieldUp, this.shieldTarget, 6, dt);
      this.arms.L.shield.rotation.x = U.lerp(-0.15, -0.9, this.shieldUp);
      this.arms.R.shield.rotation.x = U.lerp(-0.15, -0.9, this.shieldUp);

      // --- crystal pulse + halo spin ---
      const pulse = 1 + 0.08 * Math.sin(time * 3.2);
      this.crystal.scale.setScalar(pulse);
      this.crystal.rotation.y = time * 0.7;
      this.crystal.position.z = 0.175 + 0.012 * Math.sin(time * 3.2);
      this.halo.rotation.z = time * 0.9;
      this.halo.rotation.y = Math.sin(time * 0.6) * 0.15;
    }

    /* ---------------- dynamics metrics (simulated estimates) ---------------- */
    getMetrics() {
      // segment world positions + mass weights
      const w = this.group.localToWorld;
      const pts = {
        pelvis: [this.root.position.clone().add(this.group.position), 0.24],
        chest: [new THREE.Vector3(0, this.actual.pelvisY + 0.42, 0).applyMatrix4(this.torso.matrixWorld), 0.22],
        head: [new THREE.Vector3(0, this.actual.pelvisY + 0.68 + 0.14, 0).applyMatrix4(this.head.matrixWorld), 0.05],
        armL: [new THREE.Vector3(-0.31, this.actual.pelvisY + 0.2, 0).applyMatrix4(this.arms.L.shoulder.matrixWorld), 0.05],
        armR: [new THREE.Vector3(0.31, this.actual.pelvisY + 0.2, 0).applyMatrix4(this.arms.R.shoulder.matrixWorld), 0.05],
        handL: [this._world(this.arms.L.hand), 0.02],
        handR: [this._world(this.arms.R.hand), 0.02],
        footL: [this._world(this.legs.L.foot), 0.065],
        footR: [this._world(this.legs.R.foot), 0.065],
        legL: [this._world(this.legs.L.knee), 0.10],
        legR: [this._world(this.legs.R.knee), 0.10]
      };
      const com = new THREE.Vector3();
      let massSum = 0;
      for (const k in pts) { com.addScaledVector(pts[k][0], pts[k][1]); massSum += pts[k][1]; }
      com.divideScalar(massSum);

      // ZMP via linear inverted pendulum approximation: zmp = com - (h/g)*a
      this._vel = this._vel || new THREE.Vector2();
      const v = new THREE.Vector2(com.x - this._lastComX, com.z - this._lastComZ);
      const dt = Math.max(1e-3, this._lastDt || 0.016);
      const a = v.multiplyScalar(1 / dt);
      this._lastComX = com.x; this._lastComZ = com.z; this._lastDt = dt;
      const h = Math.max(com.y, 0.25), g = 9.81;
      let zmpX = com.x - (h * a.x) / g;
      let zmpZ = com.z - (h * a.y) / g;
      zmpX = U.clamp(zmpX, -14, 14); zmpZ = U.clamp(zmpZ, -14, 14);

      // support polygon from stance feet (foot rectangles)
      const footHalfW = 0.085, footHalfL = 0.15;
      const inSwing = (ph, off) => Math.sin(ph + off) > 0.12; // foot off ground in swing
      const feet = [];
      [['L', 0], ['R', Math.PI]].forEach(([k, off]) => {
        const wp = this._world(this.legs[k].foot);
        const swinging = this.pose === 'walk' && this.moving && inSwing(this.phase, off);
        feet.push({ wp, swinging, halfW: footHalfW, halfL: footHalfL });
      });
      const stance = feet.filter((f) => !f.swinging);
      let poly = [];
      if (stance.length === 2) {
        // rectangle spanning both feet
        const a0 = stance[0].wp, a1 = stance[1].wp;
        const cx = (a0.x + a1.x) / 2, cz = (a0.z + a1.z) / 2;
        const dx = Math.abs(a0.x - a1.x), dz = Math.abs(a0.z - a1.z);
        poly = [
          new THREE.Vector3(cx - dx / 2 - footHalfW, 0, cz - dz / 2 - footHalfL),
          new THREE.Vector3(cx - dx / 2 - footHalfW, 0, cz + dz / 2 + footHalfL),
          new THREE.Vector3(cx + dx / 2 + footHalfW, 0, cz + dz / 2 + footHalfL),
          new THREE.Vector3(cx + dx / 2 + footHalfW, 0, cz - dz / 2 - footHalfL)
        ];
      } else if (stance.length === 1) {
        const f = stance[0].wp;
        poly = [
          new THREE.Vector3(f.x - footHalfW, 0, f.z - footHalfL),
          new THREE.Vector3(f.x - footHalfW, 0, f.z + footHalfL),
          new THREE.Vector3(f.x + footHalfW, 0, f.z + footHalfL),
          new THREE.Vector3(f.x + footHalfW, 0, f.z - footHalfL)
        ];
      }
      // stability margin = min distance from zmp to polygon edges (negative if outside)
      let margin = 0;
      if (poly.length === 4) {
        const zmp = new THREE.Vector2(zmpX, zmpZ);
        let m = Infinity;
        for (let i = 0; i < 4; i++) {
          const a = new THREE.Vector2(poly[i].x, poly[i].z);
          const b = new THREE.Vector2(poly[(i + 1) % 4].x, poly[(i + 1) % 4].z);
          const ab = b.clone().sub(a), ap = zmp.clone().sub(a);
          const t = U.clamp(ap.dot(ab) / ab.lengthSq(), 0, 1);
          m = Math.min(m, zmp.distanceTo(a.addScaledVector(ab, t)));
        }
        margin = m;
      }
      return { com, zmp: new THREE.Vector2(zmpX, zmpZ), poly, margin };
    }

    _world(obj) {
      const v = new THREE.Vector3();
      obj.getWorldPosition(v);
      return v;
    }
  }

  Robot.phaseName = function (p) {
    // 4-phase gait mapping
    if (p < Math.PI / 2) return 0;
    if (p < Math.PI) return 1;
    if (p < Math.PI * 1.5) return 2;
    return 3;
  };

  global.Robot = Robot;
})(window);
