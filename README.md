# Nano Tech Archangel Suit — Simulation

Clean static export. **Simulation only** — no API keys, no secrets, no cloud calls,
no hardware, no location data, no placeholder URLs. 100% local, offline, single-page
WebGL simulation built on vendored Three.js.

## Structure
```
index.html        UI + inline CSS (single page, no build step)
js/               11 modules: util, store, robot, volcano, thermal, agents,
                  soul, adapt, env, systems, main
vendor/           three.min.js + OrbitControls.js (vendored locally, offline)
```

## What it runs
Full Archangel humanoid simulation with all layers:
- **Soul** — autonomous agent, auto-Shield on danger, Director intent
- **Adapt** — adapts to open simulator bodies only (ALVE/G1/Zeroth); closed bodies wait, never forced
- **Flight + Environment** — 4 environments (Tubig/Hangin/Init/Ice), flight phases, evolution
- **Flight Duration** — AUTO / STAY / LAND (STAY hovers + glides, no auto-land)
- **Self-Heal** — autonomous, rebuilds Wings/Shield from environment supply
- **Solar** — auto-charge from sun/heat/wind/motion, no command
- **Body Sync** — Nano Tech is one with the body (unified energy, fatigue, healing)
- **Unlimited Knowledge** — no cap
- **Self-Learning + Evolution** — one Data Store, syncs to all agents

## Deploy (Cloudflare Pages) — for 2nd
1. Upload/push this entire folder as the project source.
2. Project name: **archangel-sim**
3. Build settings: **No build** (framework preset: None / static site).
4. Publish directory: the folder root (`/`).
5. No environment variables, no secrets, no API keys needed.
6. The app is fully client-side — it runs as-is on a static host.

## Notes
- No GLB files: the robot, volcano, and environments are procedurally generated
  in Three.js, so the package is self-contained HTML/CSS/JS.
- Camera starts front 3/4 view (chest crystal, halo, face visible).
- Wings: 2 wings x 3 feather rows, gold trim, folded = cape, open = spread.
- Shield: wide shoulder armor (pauldron + wide shield), per reference.
