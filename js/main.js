/* main.js — bootstraps the full simulation: scene, robot, volcano, thermal agent,
   multi-agent console, autonomous brain, click-to-walk, dynamics overlays. */
(function () {
  'use strict';

  /* ================= renderer / scene / camera ================= */
  const canvas = document.getElementById('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(5.5, 3.6, 13.5);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.5, 8);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 3.5;
  controls.maxDistance = 34;
  controls.maxPolarAngle = 1.45;

  /* ================= lighting & environment ================= */
  const hemi = new THREE.HemisphereLight(0x9fb8d8, 0x2a2218, 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dc, 1.15);
  sun.position.set(8, 14, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -22; sun.shadow.camera.right = 22;
  sun.shadow.camera.top = 22; sun.shadow.camera.bottom = -22;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 45;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  const ambient = new THREE.AmbientLight(0x3a4a5e, 0.5);
  scene.add(ambient);

  const SKY_DAY = new THREE.Color(0x1c2b3e);
  const SKY_VOLC = new THREE.Color(0x2a0f0a);
  scene.background = SKY_DAY.clone();
  scene.fog = new THREE.Fog(0x1c2b3e, 30, 80);

  /* ================= ground ================= */
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(60, 48),
    new THREE.MeshStandardMaterial({ color: 0x2b3340, roughness: 0.92, metalness: 0.05 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(60, 30, 0x3a5066, 0x22303f);
  grid.position.y = 0.01;
  grid.material.opacity = 0.35; grid.material.transparent = true;
  scene.add(grid);

  /* ================= subsystems ================= */
  const robot = new Robot(scene);
  const volcano = new Volcano(scene);
  const thermal = new ThermalAgent();

  const agentConsole = new AgentConsole(
    document.getElementById('agentConsole'),
    { dotCtrl: document.getElementById('dotCtrl'), dotPerc: document.getElementById('dotPerc'),
      dotPlan: document.getElementById('dotPlan'), dotSuit: document.getElementById('dotSuit') }
  );

  const sysLogEl = document.getElementById('sysLog');
  function sysLog(text, kind) {
    const line = document.createElement('div');
    line.className = 'lg' + (kind ? ' ' + kind : '');
    line.innerHTML = `<span class="t">${U.now()}</span>${text}`;
    sysLogEl.appendChild(line);
    sysLogEl.scrollTop = sysLogEl.scrollHeight;
    while (sysLogEl.childElementCount > 200) sysLogEl.removeChild(sysLogEl.firstChild);
  }
  thermal.onLog((text, kind) => sysLog(text, kind));
  thermal.onMessage((agent, text) => agentConsole.say(agent, text));

  /* ================= dynamics overlays ================= */
  const polyFill = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false })
  );
  polyFill.rotation.x = -Math.PI / 2;
  scene.add(polyFill);
  const polyLine = new THREE.LineLoop(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.8 })
  );
  scene.add(polyLine);
  const zmpMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd166 })
  );
  scene.add(zmpMarker);
  const comLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]),
    new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.55 })
  );
  scene.add(comLine);
  const comMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0x22d3ee })
  );
  scene.add(comMarker);

  // click-to-walk overlays
  const targetRing = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.62, 32),
    new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
  );
  targetRing.rotation.x = -Math.PI / 2;
  targetRing.visible = false;
  scene.add(targetRing);
  const targetLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineDashedMaterial({ color: 0x22d3ee, dashSize: 0.35, gapSize: 0.22, transparent: true, opacity: 0.8 })
  );
  targetLine.visible = false;
  scene.add(targetLine);

  /* ================= commands ================= */
  let volcanoMode = false;

  const cmd = {
    walk() {
      if (thermal.locked) { agentConsole.say('controller', 'Command rejected — thermal fail-closed lockout active'); return; }
      robot.setMove(true); robot.setPose('walk');
      agentConsole.say('controller', 'Walk — 4-phase gait engaged (Double Support → Swing → Heel-Strike → Push-Off)');
      addXp('knowledge', 2, 'Controller: walk command');
    },
    walkTo(point, stopAt) {
      if (thermal.locked) { agentConsole.say('controller', 'Command rejected — thermal fail-closed lockout active'); return; }
      const sameTarget = clickTarget && Math.hypot(clickTarget.x - point.x, clickTarget.z - point.z) < 0.5;
      clickTarget = { x: point.x, z: point.z, stopAt: stopAt || 1.2 };
      robot.setMove(true); robot.setPose('walk');
      if (!sameTarget) agentConsole.say('controller', `Walk-to target (${U.fmt(point.x, 1)}, ${U.fmt(point.z, 1)}) — cyan ring engaged`);
    },
    stop() {
      robot.setMove(false);
      clickTarget = null;
      agentConsole.say('controller', 'Stop — gait halted, standing balance');
    },
    stand() {
      robot.setMove(false); robot.setPose('stand');
      agentConsole.say('controller', 'Stand — neutral posture restored');
    },
    turn(dir) {
      if (thermal.locked) { agentConsole.say('controller', 'Command rejected — thermal fail-closed lockout active'); return; }
      robot.turnBy(dir * Math.PI / 4);
      agentConsole.say('controller', dir > 0 ? 'Turn Right +45°' : 'Turn Left −45°');
      addXp('knowledge', 1, 'Controller: turn');
    },
    squat() {
      robot.setMove(false); robot.setPose('squat');
      agentConsole.say('controller', 'Squat — posture lowered, balance maintained');
      addXp('knowledge', 1, 'Controller: squat');
    },
    wave() {
      robot.startWave();
      agentConsole.say('controller', 'Wave — greeting gesture executed');
      addXp('knowledge', 1, 'Controller: wave');
    },
    raiseShield() {
      robot.toggleShield();
      if (robot.shieldTarget > 0.5) {
        agentConsole.say('controller', 'Raise Shield — shield wall deployed');
        addXp('shield', 5, 'Suit: shield deployed');
      } else {
        agentConsole.say('controller', 'Shield lowered');
      }
    },
    wings() {
      robot.toggleWings();
      if (robot.wingTarget > 0.5) {
        agentConsole.say('controller', 'Open Wings — full feathered spread');
        addXp('wings', 5, 'Suit: wings deployed');
      } else {
        agentConsole.say('controller', 'Wings folding');
      }
    },
    enterVolcano() {
      volcanoMode = !volcanoMode;
      if (volcanoMode) {
        volcano.enter();
        agentConsole.say('perception', 'Environment change detected — lava lake environment engaged');
        agentConsole.say('planner', 'Volcano zone entered — Thermal Agent must stay ON for suit integrity');
        sysLog('Entered Volcano — lava lake environment active (crust, rocks, embers, vent)', 'sys');
        addXp('knowledge', 3, 'Exploration: volcano zone');
      } else {
        volcano.exit();
        agentConsole.say('perception', 'Environment change — returning to test range');
        sysLog('Exited Volcano — test range restored', 'sys');
      }
      updateChips();
    },
    thermalOn() { thermal.setOn(true); updateChips(); },
    thermalOff() { thermal.setOn(false); updateChips(); },
    autonomous(on) { soul.setAutonomous(on); updateChips(); }
  };

  function addXp(skill, amt, note) {
    STORE.addXp(skill, amt);
    updateGoalUI();
    if (note) sysLog(`+${amt} XP ${skill.toUpperCase()} — ${note}`, 'sys');
  }

  /* ================= SOUL (autonomous agent + intent + multi-body) ================= */
  const soulLogEl = document.getElementById('soulLog');
  function soulLog(text, kind) {
    const line = document.createElement('div');
    line.className = 'lg' + (kind ? ' ' + kind : '');
    line.innerHTML = `<span class="t">${U.now()}</span>${text}`;
    soulLogEl.appendChild(line);
    soulLogEl.scrollTop = soulLogEl.scrollHeight;
    while (soulLogEl.childElementCount > 40) soulLogEl.removeChild(soulLogEl.firstChild);
  }
  const soul = new Soul({
    robot, volcano, thermal, console: agentConsole, log: sysLog,
    store: STORE, cmd,
    onXp: updateGoalUI,
    onSync: updateSoulUI
  });

  /* ================= Adapt Layer + Multi-Agent ================= */
  const adapter = new AdapterLayer({
    console: agentConsole, log: sysLog, store: STORE
  });
  const multiAgent = new MultiAgentManager({
    scene, store: STORE, console: agentConsole, log: sysLog,
    volcano, adapter,
    onSync: updateSoulUI,
    onXp: updateGoalUI
  });
  // adapt scan runs on boot; multi-agent count set by user buttons

  /* ================= Environment Manager (Flight + 4 Environments + Evolution) ================= */
  const env = new EnvironmentManager({
    robot, volcano, thermal, console: agentConsole, log: sysLog,
    store: STORE, multiAgent,
    onSync: updateSoulUI,
    onXp: updateGoalUI,
    onEnvChange: updateEnvUI
  });
  soul.env = env;   // Soul can issue flight commands

  /* ================= Body / Nano Tech Systems (Flight Duration, Self-Heal, Solar, Body Sync) ================= */
  const systems = new BodySystems({
    robot, env, volcano, thermal, console: agentConsole, log: sysLog,
    store: STORE, multiAgent,
    onSync: updateSoulUI,
    onXp: updateGoalUI
  });

  /* ================= click-to-walk ================= */
  let clickTarget = null;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  function onPointerUp(e) {
    const start = pointerStart;
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    pointerStart = null;
    if (Math.hypot(dx, dy) > 6) return;               // that was an orbit drag
    if (e.target !== renderer.domElement) return;
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(groundPlane, hit)) {
      clickTarget = { x: hit.x, z: hit.z, stopAt: 1.0 };
      robot.setMove(true); robot.setPose('walk');
      agentConsole.say('controller', `Walk-to (${U.fmt(hit.x, 1)}, ${U.fmt(hit.z, 1)}) — click target set`);
      addXp('knowledge', 2, 'Controller: click-to-walk');
    }
  }
  let pointerStart = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { pointerStart = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener('pointerup', onPointerUp);

  /* ================= keyboard ================= */
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    switch (e.key.toLowerCase()) {
      case 'w': case 'arrowup': cmd.walk(); break;
      case 's': case 'arrowdown': robot.setMove(false); robot.setPose('walk'); robot.turnBy(0); break;
      case 'a': case 'arrowleft': cmd.turn(-1); break;
      case 'd': case 'arrowright': cmd.turn(1); break;
      case ' ': cmd.stop(); break;
      case 'q': cmd.wave(); break;
      case 'e': cmd.enterVolcano(); break;
    }
  });

  /* ================= button wiring ================= */
  function holdWalk(btn, on, off) {
    const start = (e) => { e.preventDefault(); btn.classList.add('held'); cmd.walk(); };
    const end = (e) => { e.preventDefault(); btn.classList.remove('held'); off && off(); };
    btn.addEventListener('pointerdown', start);
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointerleave', end);
    btn.addEventListener('pointercancel', end);
  }
  holdWalk(document.getElementById('btnWalk'));
  document.getElementById('btnStop').addEventListener('click', () => cmd.stop());
  document.getElementById('btnStand').addEventListener('click', () => cmd.stand());
  document.getElementById('btnTurnL').addEventListener('click', () => cmd.turn(-1));
  document.getElementById('btnTurnR').addEventListener('click', () => cmd.turn(1));
  document.getElementById('btnSquat').addEventListener('click', () => cmd.squat());
  document.getElementById('btnWave').addEventListener('click', () => cmd.wave());
  document.getElementById('btnShield').addEventListener('click', () => cmd.raiseShield());
  document.getElementById('btnWings').addEventListener('click', () => cmd.wings());
  document.getElementById('btnVolcano').addEventListener('click', () => cmd.enterVolcano());
  document.getElementById('btnThermOn').addEventListener('click', () => cmd.thermalOn());
  document.getElementById('btnThermOff').addEventListener('click', () => cmd.thermalOff());
  document.getElementById('btnAutoOn').addEventListener('click', () => cmd.autonomous(true));
  document.getElementById('btnAutoOff').addEventListener('click', () => cmd.autonomous(false));

  // Adapt Layer: spawn multi-agent virtual humanoids
  function setAgents(n) {
    multiAgent.setCount(n);
    updateSoulUI();
  }
  document.getElementById('btnAgent3').addEventListener('click', () => setAgents(3));
  document.getElementById('btnAgent5').addEventListener('click', () => setAgents(5));
  document.getElementById('btnAgent10').addEventListener('click', () => setAgents(10));

  // Flight + Environment Adaptation buttons
  document.getElementById('btnFlight').addEventListener('click', () => {
    env.toggleFlight();
    updateEnvUI();
  });
  document.getElementById('btnEnvWater').addEventListener('click', () => {
    env.setEnv(env.env === 'water' ? null : 'water');
  });
  document.getElementById('btnEnvHeat').addEventListener('click', () => {
    env.setEnv(env.env === 'heat' ? null : 'heat');
  });
  document.getElementById('btnEnvAir').addEventListener('click', () => {
    env.setEnv(env.env === 'air' ? null : 'air');
  });
  document.getElementById('btnEnvIce').addEventListener('click', () => {
    env.setEnv(env.env === 'ice' ? null : 'ice');
  });

  // Flight Duration control
  document.getElementById('btnFlightAuto').addEventListener('click', () => { systems.setFlightMode('auto'); updateSystemsUI(); });
  document.getElementById('btnFlightStay').addEventListener('click', () => { systems.setFlightMode('stay'); updateSystemsUI(); });
  document.getElementById('btnFlightLand').addEventListener('click', () => { systems.setFlightMode('land'); updateSystemsUI(); });

  // Director Intent Layer — send a command to the SOUL
  function sendIntent() {
    const inp = document.getElementById('intentInput');
    const text = inp.value.trim();
    if (!text) return;
    soul.setIntent(text);
    updateSoulUI();
    inp.value = '';
  }
  document.getElementById('btnIntent').addEventListener('click', sendIntent);
  document.getElementById('intentInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendIntent();
  });

  /* ================= UI updates ================= */
  const $ = (id) => document.getElementById(id);
  const ui = {
    phase: $('mPhase'), zmp: $('mZmp'), com: $('mCom'), margin: $('mMargin'),
    poly: $('mPoly'), mode: $('mMode'), gait: $('gaitSub'),
    tOut: $('tOut'), tIn: $('tIn'), ins: $('insFill'), insVal: $('insVal'),
    cool: $('coolFill'), coolVal: $('coolVal'),
    wVal: $('xpWVal'), sVal: $('xpSVal'), kVal: $('xpKVal'),
    wFill: $('xpWings'), sFill: $('xpShield'), kFill: $('xpKnow'), goalSub: $('goalSub'),
    sim: $('simStatus'), simChip: $('chipSim'),
    volc: $('chipVolc'), therm: $('chipTherm'), auto: $('chipAuto'), emer: $('chipEmer'),
    banner: $('emergency'), btnVolcano: $('btnVolcano'),
    soulStatus: $('soulStatus'), soulBodies: $('soulBodies'),
    soulSync: $('soulSync'), soulMemory: $('soulMemory'),
    adaptBodies: $('adaptBodies'), agentRow: $('agentRow'),
    flightRow: $('flightRow'), flightAlt: $('flightAlt'), flightLift: $('flightLift'),
    envWater: $('envWater'), envHeat: $('envHeat'), envAir: $('envAir'), envIce: $('envIce'),
    evoWater: $('evoWater'), evoHeat: $('evoHeat'), evoAir: $('evoAir'), evoIce: $('evoIce'),
    evoWaterVal: $('evoWaterVal'), evoHeatVal: $('evoHeatVal'),
    evoAirVal: $('evoAirVal'), evoIceVal: $('evoIceVal'),
    evoSub: $('evoSub'), evoTotal: $('evoTotal'),
    sysFlightTime: $('sysFlightTime'), sysEnergy: $('sysEnergy'), sysWind: $('sysWind'),
    sysHeal: $('sysHeal'), sysIntW: $('sysIntW'), sysIntS: $('sysIntS'),
    sysSolar: $('sysSolar'), sysBodySync: $('sysBodySync'), sysFatigue: $('sysFatigue'),
    sysKnowledge: $('sysKnowledge')
  };
  const phaseEls = [$('ph0'), $('ph1'), $('ph2'), $('ph3')];

  function updateChips() {
    ui.volc.classList.toggle('on', volcanoMode);
    ui.therm.classList.toggle('on', thermal.on);
    ui.therm.querySelector('.lbl').textContent = thermal.on ? 'THERMAL ON' : 'THERMAL OFF';
    ui.auto.classList.toggle('on', soul.autonomous);
    ui.auto.querySelector('.lbl').textContent = soul.autonomous ? 'AUTONOMOUS ON' : 'AUTONOMOUS OFF';
  }

  function updateSoulUI() {
    const ready = soul.bodies.filter(function (b) { return b.ready; });
    ui.soulStatus.textContent = '1 · ' + (soul.autonomous ? 'ACTIVE' : 'IDLE');
    ui.soulStatus.style.color = soul.autonomous ? 'var(--green)' : 'var(--cyan)';
    ui.soulBodies.textContent = ready.length + ' ready of ' + soul.bodies.length;
    ui.soulSync.textContent = '1 -> store · epoch ' + STORE.syncEpoch;
    ui.soulMemory.textContent = 'last: ' + soul.memory.lastAction;

    // Adapt Layer display
    const adapted = adapter.adapted;
    if (adapted.length) {
      ui.adaptBodies.textContent = adapted.map(function (b) { return b.id; }).join(', ') + ' — SYNCED';
      ui.adaptBodies.style.color = 'var(--green)';
    } else {
      ui.adaptBodies.textContent = 'scanning…';
      ui.adaptBodies.style.color = 'var(--cyan)';
    }
    const ag = multiAgent.stateSummary();
    ui.agentRow.textContent = ag.count + ' live · ' + ag.wings + 'W ' + ag.shield + 'S';
  }

  function updateEnvUI() {
    const st = env.state();
    // flight display
    ui.flightRow.textContent = st.flight ? 'FLIGHT: ON' : 'FLIGHT: OFF';
    ui.flightRow.style.color = st.flight ? 'var(--green)' : 'var(--dim)';
    ui.flightAlt.textContent = st.flight ? U.fmt(st.altitude, 1) + ' m' : '0.0 m';
    ui.flightLift.textContent = st.flight ? (U.fmt(st.lift * 100, 0) + '% lift') : '—';

    // environment adapt indicators
    const envs = ['water', 'heat', 'air', 'ice'];
    const labels = { water: 'WATER ADAPT', heat: 'HEAT ADAPT', air: 'WIND ADAPT', ice: 'ICE ADAPT' };
    const refs = { water: ui.envWater, heat: ui.envHeat, air: ui.envAir, ice: ui.envIce };
    envs.forEach(function (e) {
      const on = st.env === e;
      refs[e].textContent = (on ? 'ON' : 'OFF');
      refs[e].style.color = on ? 'var(--green)' : 'var(--dim)';
    });

    // evolution display (bar fills + value spans)
    const ev = st.evolution;
    ui.evoWater.style.width = ev.water + '%';
    ui.evoHeat.style.width = ev.heat + '%';
    ui.evoAir.style.width = ev.air + '%';
    ui.evoIce.style.width = ev.ice + '%';
    ui.evoWaterVal.textContent = ev.water.toFixed(0) + '%';
    ui.evoHeatVal.textContent = ev.heat.toFixed(0) + '%';
    ui.evoAirVal.textContent = ev.air.toFixed(0) + '%';
    ui.evoIceVal.textContent = ev.ice.toFixed(0) + '%';
    const total = ev.water + ev.heat + ev.air + ev.ice;
    ui.evoSub.textContent = 'Water ' + ev.water.toFixed(0) + '% · Heat ' + ev.heat.toFixed(0) +
      '% · Air ' + ev.air.toFixed(0) + '% · Ice ' + ev.ice.toFixed(0) + '%';
    ui.evoTotal.textContent = total.toFixed(0) + '% evolved';
  }

  function updateSystemsUI() {
    const st = systems.state();
    ui.sysFlightTime.textContent = U.fmt(st.flightTime, 1) + ' s';
    ui.sysEnergy.textContent = U.fmt(st.energy, 0) + '%';
    ui.sysEnergy.style.color = st.energy < 25 ? 'var(--red)' : st.energy < 50 ? '#ffc24a' : 'var(--green)';
    ui.sysWind.textContent = U.fmt(st.wind, 2);
    ui.sysHeal.textContent = st.selfHeal ? 'ON' : 'OFF';
    ui.sysHeal.style.color = st.selfHeal ? 'var(--green)' : 'var(--dim)';
    ui.sysIntW.textContent = U.fmt(st.integrity.wings, 0) + '%';
    ui.sysIntW.style.color = st.integrity.wings < 40 ? 'var(--red)' : st.integrity.wings < 70 ? '#ffc24a' : 'var(--green)';
    ui.sysIntS.textContent = U.fmt(st.integrity.shield, 0) + '%';
    ui.sysIntS.style.color = st.integrity.shield < 40 ? 'var(--red)' : st.integrity.shield < 70 ? '#ffc24a' : 'var(--green)';
    ui.sysSolar.textContent = st.solar === 'charging' ? 'CHARGING' : 'STANDBY';
    ui.sysSolar.style.color = st.solar === 'charging' ? 'var(--green)' : 'var(--dim)';
    ui.sysBodySync.textContent = st.bodySync ? 'ON' : 'OFF';
    ui.sysBodySync.style.color = st.bodySync ? 'var(--green)' : 'var(--dim)';
    ui.sysFatigue.textContent = U.fmt(st.fatigue, 0) + '%';
    ui.sysFatigue.style.color = st.fatigue > 60 ? 'var(--red)' : st.fatigue > 30 ? '#ffc24a' : 'var(--green)';
    ui.sysKnowledge.textContent = Math.floor(st.knowledge) + ' · no cap';
  }

  function updateGoalUI() {
    const x = STORE.xp;
    ui.wFill.style.width = STORE.pct('wings') + '%';
    ui.sFill.style.width = STORE.pct('shield') + '%';
    // knowledge is uncapped — bar shows relative growth, value shows no ceiling
    ui.kFill.style.width = Math.min(100, (x.knowledge / 200) * 100) + '%';
    ui.wVal.textContent = `${x.wings} / ${STORE.limits.wings}`;
    ui.sVal.textContent = `${x.shield} / ${STORE.limits.shield}`;
    ui.kVal.textContent = `${Math.floor(x.knowledge)} · no cap`;
    ui.goalSub.textContent = STORE.overall().toFixed(0) + '%';
  }

  function setEmergency(on) {
    ui.emer.style.display = on ? 'flex' : 'none';
    ui.banner.classList.toggle('show', on);
    ['btnWalk', 'btnStand', 'btnTurnL', 'btnTurnR', 'btnSquat', 'btnWave',
     'btnShield', 'btnWings', 'btnVolcano', 'btnAutoOn'].forEach((id) => { $(id).disabled = on; });
    if (on) { cmd.stop(); }
  }

  let uiTimer = 0;
  function updateUI(dt, m) {
    // gait phases
    const ph = Robot.phaseName(robot.phase);
    phaseEls.forEach((el, i) => el.classList.toggle('act', i === ph));
    ui.phase.textContent = ((robot.phase / Math.PI / 2) % 4).toFixed(2) + ' / 4';
    ui.gait.textContent = robot.moving && robot.pose === 'walk' ? 'walking' : robot.pose;

    ui.zmp.textContent = `(${U.fmt(m.zmp.x, 2)}, ${U.fmt(m.zmp.y, 2)})`;
    ui.com.textContent = `(${U.fmt(m.com.x, 2)}, ${U.fmt(m.com.y, 2)}, ${U.fmt(m.com.z, 2)})`;
    ui.margin.textContent = U.fmt(m.margin * 100, 1) + ' cm';
    ui.poly.textContent = m.poly.length === 4 ? (m.poly[0].distanceTo(m.poly[2]) > 0.4 ? '2-FOOT' : '1-FOOT') : '—';
    ui.mode.textContent = robot.pose.toUpperCase() + (robot.wingSpread > 0.5 ? ' · WINGS' : '') + (robot.shieldUp > 0.5 ? ' · SHIELD' : '');

    // thermal
    ui.tOut.textContent = U.fmt(thermal.tOut, 1) + '°C';
    ui.tIn.textContent = U.fmt(thermal.tIn, 1) + '°C';
    ui.ins.style.width = thermal.ins + '%'; ui.insVal.textContent = Math.round(thermal.ins) + '%';
    ui.cool.style.width = thermal.cool + '%'; ui.coolVal.textContent = Math.round(thermal.cool) + '%';
    if (thermal.locked !== ui._locked) { ui._locked = thermal.locked; setEmergency(thermal.locked); }

    updateChips();
    updateGoalUI();
    agentConsole.tick(performance.now());
  }

  /* ================= overlays update ================= */
  function updateOverlays(m) {
    // support polygon
    if (m.poly.length === 4) {
      const arr = new Float32Array(m.poly.length * 3);
      m.poly.forEach((v, i) => { arr[i * 3] = v.x; arr[i * 3 + 1] = v.y + 0.012; arr[i * 3 + 2] = v.z; });
      polyLine.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      polyLine.geometry.computeBoundingSphere();
      polyLine.visible = true;
      polyFill.geometry.setAttribute('position', new THREE.BufferAttribute(arr.slice(), 3));
      const idx = [];
      for (let i = 1; i < 4; i++) idx.push(0, i, i + 1 === 4 ? 0 : i + 1);
      polyFill.geometry.setIndex(idx);
      polyFill.geometry.computeBoundingSphere();
      polyFill.visible = true;
    } else { polyLine.visible = false; polyFill.visible = false; }

    zmpMarker.position.set(m.zmp.x, 0.03, m.zmp.y);
    zmpMarker.visible = true;
    comLine.geometry.setFromPoints([
      new THREE.Vector3(m.com.x, 0.02, m.com.z),
      new THREE.Vector3(m.com.x, m.com.y, m.com.z)
    ]);
    comLine.geometry.computeBoundingSphere();
    comMarker.position.copy(m.com);

    // click target
    if (clickTarget) {
      targetRing.visible = true;
      targetRing.position.set(clickTarget.x, 0.03, clickTarget.z);
      const rp = robot.group.position;
      targetLine.geometry.setFromPoints([
        new THREE.Vector3(rp.x, 0.05, rp.z),
        new THREE.Vector3(clickTarget.x, 0.05, clickTarget.z)
      ]);
      targetLine.geometry.computeBoundingSphere();
      targetLine.computeLineDistances();
      targetLine.visible = true;
    } else {
      targetRing.visible = false;
      targetLine.visible = false;
    }
  }

  /* ================= navigation steering ================= */
  function steer(dt) {
    if (thermal.locked) { if (robot.moving) cmd.stop(); return; }
    if (!clickTarget) return;
    const rp = robot.group.position;
    const dx = clickTarget.x - rp.x, dz = clickTarget.z - rp.z;
    const dist = Math.hypot(dx, dz);
    if (dist < clickTarget.stopAt) {
      clickTarget = null;
      cmd.stop();
      agentConsole.say('controller', 'Arrived at click target — halting');
      addXp('knowledge', 2, 'Controller: arrival');
      return;
    }
    const desired = Math.atan2(dx, dz);
    let dh = desired - robot.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    if (Math.abs(dh) > 0.06) {
      // turn toward target instead of walking
      robot.setMove(false); robot.setPose('walk');
      robot.setHeadingTarget(robot.heading + Math.sign(dh) * Math.min(Math.abs(dh), 3.2 * dt));
    } else {
      robot.setMove(true); robot.setPose('walk');
      robot.setHeadingTarget(desired);
      // move forward
      const f = robot.forward;
      rp.x += f.x * robot.speed * dt;
      rp.z += f.z * robot.speed * dt;
    }
  }

  /* ================= render loop ================= */
  const clock = new THREE.Clock();
  let frame = 0;
  let lastPhaseWrap = 0;

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(0.05, clock.getDelta());
    const time = clock.elapsedTime;
    frame++;

    // environment transition colors
    const t = volcano.visible;
    scene.background.copy(SKY_DAY).lerp(SKY_VOLC, t);
    scene.fog.color.copy(SKY_DAY).lerp(SKY_VOLC, t);
    hemi.color.copy(new THREE.Color(0x9fb8d8)).lerp(new THREE.Color(0xff8a4a), t * 0.6);

    volcano.update(dt);
    robot.update(dt, time);
    steer(dt);

    // robot position physics (only when walking manually with no click target)
    if (robot.moving && !clickTarget) {
      const f = robot.forward;
      const rp = robot.group.position;
      rp.x += f.x * robot.speed * dt;
      rp.z += f.z * robot.speed * dt;
      rp.x = U.clamp(rp.x, -40, 40); rp.z = U.clamp(rp.z, -40, 40);
    }

    // gait cycle XP
    if (robot.gaitCycleDone) {
      robot.gaitCycleDone = false;
      STORE.gaitCycles++;
      if (robot.pose === 'walk') { STORE.addXp('knowledge', 1); updateGoalUI(); }
    }

    const m = robot.getMetrics();
    updateOverlays(m);

    thermal.update(dt, volcano.exteriorTemp(robot.group.position.x, robot.group.position.z));

    // sync robot's additive adaptive modes from the environment manager
    robot.flightMode = env.flight;
    robot.swimMode = env.env === 'water';
    robot.iceMode = env.env === 'ice';

    soul.tick(dt);
    multiAgent.update(dt);
    env.tick(dt, clock.elapsedTime);
    systems.tick(dt);

    controls.update();
    renderer.render(scene, camera);

    // UI throttled
    uiTimer += dt;
    if (uiTimer > 0.1) { uiTimer = 0; updateUI(dt, m); updateSoulUI(); updateEnvUI(); updateSystemsUI(); }
    if (frame % 30 === 0) { ui.sim.textContent = `SIM: RUNNING · ${renderer.info.render.triangles} tri`; }
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  /* ================= boot ================= */
  sysLog('Simulation booted — WebGL / Three.js, 100% local. No API keys, no hardware.');
  sysLog('Robot and Suit share ONE data store. GOAL: Develop Nano Tech Archangel Suit.');
  agentConsole.say('perception', 'Sensors online — test range clear. Awaiting directive.');
  agentConsole.say('planner', 'Ready. Manual mode: use controls or click the ground to walk.');
  agentConsole.say('controller', 'Standing by — 4-phase gait controller initialized.');
  agentConsole.say('suit', 'Nano Tech Archangel Suit local agent online — insulation & coolant loops ready.');
  thermal.setOn(true);
  updateChips();
  updateGoalUI();
  adapter.scan();
  updateSoulUI();
  animate();
})();
