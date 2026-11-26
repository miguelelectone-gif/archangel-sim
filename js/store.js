/* store.js — THE single shared data store for the Humanoid robot and the Suit.
   Both subsystems read/write this one object. No persistence, no network.
   Also holds the multi-body sync state: one SOUL, many BODIES, one store. */
(function (global) {
  'use strict';
  const store = {
    xp: { wings: 0, shield: 0, knowledge: 0 },
    limits: { wings: 60, shield: 80, knowledge: 200 },
    actions: 0,
    cycles: 0,          // autonomous loop cycles
    gaitCycles: 0,      // completed walk cycles
    saved: 0,           // suit data saves
    events: [],
    bodies: [],         // [{id, status, ready, joints, thermalSensor, capacity, syncedKnowledge, syncedEpoch}]
    syncEpoch: 0,       // increments on every sync broadcast
    // evolution: Archangel changes itself per environment (0-100%)
    evolution: { water: 0, heat: 0, air: 0, ice: 0 },
    // knowledge store: open env data collected while online, carried offline
    knowledgeStore: { water: 0, heat: 0, air: 0, ice: 0 },
    envActive: null,   // current active environment: water | heat | air | ice | null
    // ===== body / Nano Tech synced systems (one body, one suit, one energy) =====
    energy: 100,        // unified body + Nano Tech energy pool (0-100)
    fatigue: 0,         // body fatigue (0 low, 100 high) — high slows flight, saves energy
    integrity: { wings: 100, shield: 100 },  // suit integrity (100 = perfect)
    solar: 'standby',   // 'charging' | 'standby'
    selfHeal: true,     // autonomous self-healing (environment as supply)
    bodySync: true,     // Nano Tech is part of the body, not a separate object
    flightMode: 'auto', // 'auto' | 'stay' | 'land'  (flight duration control)
    flightTime: 0,      // seconds spent in flight
    knowledgeUncapped: true  // knowledge grows without a cap (like a brain)
  };
  store.addXp = function (skill, amount) {
    if (!Object.prototype.hasOwnProperty.call(store.xp, skill)) return 0;
    // knowledge is uncapped — it grows like a brain, no ceiling
    if (skill === 'knowledge') {
      store.xp[skill] += amount;
    } else {
      store.xp[skill] = Math.min(store.limits[skill], store.xp[skill] + amount);
    }
    store.actions++;
    return store.xp[skill];
  };
  store.pct = function (skill) {
    return Math.min(100, (store.xp[skill] / store.limits[skill]) * 100);
  };
  store.overall = function () {
    const t = store.limits.wings + store.limits.shield + store.limits.knowledge;
    const g = store.xp.wings + store.xp.shield + store.xp.knowledge;
    return (g / t) * 100;
  };
  // ---- multi-body sync (one store, many bodies learn from the SOUL) ----
  store.addBody = function (body) { store.bodies.push(body); return body; };
  store.syncBroadcast = function () {
    store.syncEpoch++;
    const know = store.xp.knowledge;
    store.bodies.forEach(function (b) {
      if (b.ready) { b.syncedKnowledge = know; b.syncedEpoch = store.syncEpoch;
        b.syncedEvolution = Object.assign({}, store.evolution); }
    });
    return store.syncEpoch;
  };
  // ---- evolution: grows when the Archangel is repeatedly in an environment ----
  store.addEvolution = function (env, amount) {
    if (!store.evolution.hasOwnProperty(env)) return;
    store.evolution[env] = Math.min(100, store.evolution[env] + amount);
    // evolution also feeds the knowledge store (offline carry)
    if (store.knowledgeStore.hasOwnProperty(env)) {
      store.knowledgeStore[env] = Math.min(100, store.knowledgeStore[env] + amount * 0.5);
    }
    return store.evolution[env];
  };
  // ---- knowledge store: collect open env data while online ----
  store.collectKnowledge = function (env, amount) {
    if (!store.knowledgeStore.hasOwnProperty(env)) return;
    store.knowledgeStore[env] = Math.min(100, store.knowledgeStore[env] + amount);
    return store.knowledgeStore[env];
  };
  // ---- body / suit unified systems ----
  store.addEnergy = function (amt) {
    store.energy = U.clamp(store.energy + amt, 0, 100);
    return store.energy;
  };
  store.addFatigue = function (amt) {
    store.fatigue = U.clamp(store.fatigue + amt, 0, 100);
    return store.fatigue;
  };
  store.drainEnergy = function (amt) { return store.addEnergy(-amt); };
  store.heal = function (part, amt) {
    if (!store.integrity.hasOwnProperty(part)) return;
    store.integrity[part] = U.clamp(store.integrity[part] + amt, 0, 100);
    return store.integrity[part];
  };
  store.damage = function (part, amt) { return store.heal(part, -amt); };
  store.reset = function () {
    store.xp.wings = 0; store.xp.shield = 0; store.xp.knowledge = 0;
    store.actions = 0; store.cycles = 0; store.gaitCycles = 0; store.saved = 0;
  };
  global.STORE = store;
})(window);
