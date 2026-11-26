/* volcano.js — Volcano environment: lava lake (non-flat, shaded), crust plates,
   rock plates, rising embers, glowing vent. Fades in on "Enter Volcano". */
(function (global) {
  'use strict';

  const VENT = new THREE.Vector3(0, 0, -12);   // volcano center on the ground
  const LAKE_R = 22;

  const VERT = `
    uniform float uTime;
    varying vec2 vUv;
    varying float vH;
    void main(){
      vUv = uv;
      vec3 pos = position;
      // non-flat lava surface: slow waves
      float w = sin(pos.x*0.35 + uTime*0.8)*0.16 + cos(pos.z*0.3 + uTime*0.6)*0.14
              + sin((pos.x+pos.z)*0.21 + uTime*1.3)*0.07;
      pos.y += w;
      vH = w;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }`;

  const FRAG = `
    precision highp float;
    uniform float uTime;
    varying vec2 vUv;
    varying float vH;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){
      vec2 i = floor(p), f = fract(p);
      f = f*f*(3.0-2.0*f);
      float a = hash(i), b = hash(i+vec2(1.0,0.0)), c = hash(i+vec2(0.0,1.0)), d = hash(i+vec2(1.0,1.0));
      return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
    }
    float fbm(vec2 p){
      float s = 0.0, a = 0.5;
      for(int i=0;i<5;i++){ s += a*noise(p); p = p*2.0 + 17.0; a *= 0.5; }
      return s;
    }
    void main(){
      vec2 q = vUv*3.2;
      q += vec2(uTime*0.045, -uTime*0.03);
      float n = fbm(q + fbm(q*1.8 + uTime*0.02));
      float cracks = fbm(q*3.0 - uTime*0.06);
      float lavaMask = smoothstep(0.40, 0.78, n);
      vec3 crust = vec3(0.05, 0.03, 0.025);
      vec3 hot = mix(vec3(1.0, 0.28, 0.02), vec3(1.0, 0.72, 0.18), cracks);
      vec3 cool = vec3(0.95, 0.16, 0.01);
      vec3 lava = mix(cool, hot, smoothstep(0.5, 1.0, cracks));
      float glow = lavaMask * (0.85 + 0.45*sin(uTime*2.0 + n*12.0));
      float edge = smoothstep(0.94, 1.0, 1.0 - length(vUv-0.5)*1.15); // darker rim
      vec3 col = mix(crust, lava, lavaMask*glow);
      col += vec3(0.10, 0.02, 0.0)*edge;
      gl_FragColor = vec4(col, 1.0);
    }`;

  function glowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,180,80,0.75)');
    grad.addColorStop(1, 'rgba(255,90,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  class Volcano {
    constructor(scene) {
      this.scene = scene;
      this.active = false;
      this.visible = 0;          // 0 hidden → 1 shown
      this.time = 0;
      this.group = new THREE.Group();
      this.group.scale.setScalar(0.001);
      scene.add(this.group);
      this._build();
    }

    _build() {
      const g = this.group;

      /* ---- lava lake ---- */
      const lavaGeo = new THREE.PlaneGeometry(LAKE_R * 2, LAKE_R * 2, 64, 64);
      lavaGeo.rotateX(-Math.PI / 2);
      this.lavaMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: VERT, fragmentShader: FRAG,
        toneMapped: false
      });
      this.lava = new THREE.Mesh(lavaGeo, this.lavaMat);
      this.lava.position.copy(VENT);
      this.lava.position.y = 0.02;
      g.add(this.lava);

      /* ---- crust plates (instanced flat disks) ---- */
      const crustGeo = new THREE.CircleGeometry(1, 10);
      crustGeo.rotateX(-Math.PI / 2);
      this.crustMat = new THREE.MeshStandardMaterial({ color: 0x241510, roughness: 0.9, metalness: 0.1 });
      const N = 70;
      this.crust = new THREE.InstancedMesh(crustGeo, this.crustMat, N);
      const m = new THREE.Matrix4();
      this.crustDummy = new THREE.Object3D();
      this.crustState = [];
      for (let i = 0; i < N; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * (LAKE_R - 1.5);
        const s = 0.8 + Math.random() * 2.2;
        this.crustDummy.position.set(VENT.x + Math.cos(a) * r, 0.055, VENT.z + Math.sin(a) * r);
        this.crustDummy.rotation.y = Math.random() * Math.PI;
        this.crustDummy.scale.set(s, s, 1);
        this.crustDummy.updateMatrix();
        m.copy(this.crustDummy.matrix);
        this.crust.setMatrixAt(i, m);
        this.crustState.push({
          x: this.crustDummy.position.x, z: this.crustDummy.position.z,
          rot: this.crustDummy.rotation.y, s, phase: Math.random() * Math.PI * 2, speed: 0.5 + Math.random()
        });
      }
      this.crust.instanceMatrix.needsUpdate = true;
      g.add(this.crust);

      /* ---- rock plates ---- */
      const rockMat = new THREE.MeshStandardMaterial({ color: 0x3a2b24, roughness: 0.95, metalness: 0.05, flatShading: true });
      this.rocks = [];
      for (let i = 0; i < 16; i++) {
        const s = 0.35 + Math.random() * 0.9;
        const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), rockMat);
        const a = Math.random() * Math.PI * 2;
        const r = 4 + Math.sqrt(Math.random()) * (LAKE_R - 5);
        rock.position.set(VENT.x + Math.cos(a) * r, s * 0.4, VENT.z + Math.sin(a) * r);
        rock.rotation.set(Math.random(), Math.random(), Math.random());
        rock.castShadow = true; rock.receiveShadow = true;
        g.add(rock);
        this.rocks.push(rock);
      }

      /* ---- glowing vent ---- */
      const vent = new THREE.Group();
      vent.position.copy(VENT);
      g.add(vent);
      const crater = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.6, 24),
        new THREE.MeshStandardMaterial({ color: 0x1c0d08, roughness: 1, side: THREE.DoubleSide }));
      crater.rotation.x = -Math.PI / 2; crater.position.y = 0.06;
      vent.add(crater);
      const core = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 12),
        new THREE.MeshStandardMaterial({ color: 0xff4400, emissive: 0xff6a00, emissiveIntensity: 2.2, roughness: 0.4 }));
      core.scale.y = 0.28; core.position.y = 0.2;
      vent.add(core);
      this.ventCore = core;
      const ventLight = new THREE.PointLight(0xff5a10, 3, 40, 2);
      ventLight.position.y = 2.5;
      vent.add(ventLight);
      this.ventLight = ventLight;

      /* ---- embers (rising particles) ---- */
      const EM = 450;
      const emberGeo = new THREE.BufferGeometry();
      const pos = new Float32Array(EM * 3);
      const col = new Float32Array(EM * 3);
      this.emberState = [];
      const c1 = new THREE.Color(0xff8c1a), c2 = new THREE.Color(0xffd34d), c3 = new THREE.Color(0xff3b00);
      for (let i = 0; i < EM; i++) {
        this.emberState.push({
          x: U.rand(-1, 1), z: U.rand(-1, 1), y: U.rand(0, 8),
          vy: U.rand(0.5, 1.8), sway: U.rand(0, Math.PI * 2), vx: U.rand(-0.2, 0.2)
        });
        pos[i * 3] = VENT.x; pos[i * 3 + 1] = 0; pos[i * 3 + 2] = VENT.z;
        const c = [c1, c2, c3][(Math.random() * 3) | 0];
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      emberGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      emberGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const emberMat = new THREE.PointsMaterial({
        size: 0.22, map: glowTexture(), vertexColors: true,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.95
      });
      this.embers = new THREE.Points(emberGeo, emberMat);
      g.add(this.embers);

      this.emberPos = pos;
    }

    /* external temperature field at ground position (x,z) */
    exteriorTemp(x, z) {
      if (!this.active) return 28 + 4 * Math.exp(-Math.hypot(x, z - 8) / 60);
      const dVent = Math.hypot(x - VENT.x, z - VENT.z);
      const dCore = Math.hypot(x - VENT.x, z - VENT.z - 0);
      let t = 45;
      t += 800 * Math.exp(-dVent / 13);          // main vent
      t += 260 * Math.exp(-dCore / 8);           // hot core near crater
      // hot patches on the lake
      t += 180 * Math.exp(-Math.hypot(x - 6, z - VENT.z + 5) / 7);
      t += 150 * Math.exp(-Math.hypot(x + 7, z - VENT.z - 4) / 7);
      if (dVent < LAKE_R) t += 40;
      return t;
    }

    enter() { this.active = true; }
    exit() { this.active = false; }

    update(dt) {
      this.time += dt;
      // fade-in / fade-out of the whole volcano group
      const target = this.active ? 1 : 0;
      this.visible = U.damp(this.visible, target, 3.5, dt);
      const s = Math.max(0.0001, this.visible);
      this.group.scale.setScalar(s);
      if (s < 0.01) return;

      // lava shader time
      this.lavaMat.uniforms.uTime.value = this.time;

      // crust plates: subtle crack pulses
      const m = new THREE.Matrix4();
      for (let i = 0; i < this.crustState.length; i++) {
        const st = this.crustState[i];
        const pulse = 1 + 0.06 * Math.sin(this.time * st.speed + st.phase);
        this.crustDummy.position.set(st.x, 0.055, st.z);
        this.crustDummy.rotation.y = st.rot;
        this.crustDummy.scale.set(st.s * pulse, st.s * pulse, 1);
        this.crustDummy.updateMatrix();
        m.copy(this.crustDummy.matrix);
        this.crust.setMatrixAt(i, m);
      }
      this.crust.instanceMatrix.needsUpdate = true;

      // vent pulse
      const vPulse = 1 + 0.12 * Math.sin(this.time * 2.3);
      this.ventCore.scale.set(vPulse, 0.28 * vPulse, vPulse);
      this.ventLight.intensity = 2.6 + 1.2 * Math.sin(this.time * 3.1) + 0.6 * Math.sin(this.time * 7.3);

      // embers
      const pos = this.emberPos;
      for (let i = 0; i < this.emberState.length; i++) {
        const e = this.emberState[i];
        e.y += e.vy * dt;
        e.sway += dt * 1.2;
        if (e.y > 9) { e.y = 0; e.x = U.rand(-1.6, 1.6); e.z = U.rand(-1.6, 1.6); e.vy = U.rand(0.5, 1.8); }
        pos[i * 3] = VENT.x + e.x + Math.sin(e.sway) * 0.5;
        pos[i * 3 + 1] = e.y;
        pos[i * 3 + 2] = VENT.z + e.z + Math.cos(e.sway) * 0.5;
      }
      this.embers.geometry.attributes.position.needsUpdate = true;
      this.embers.rotation.y = Math.sin(this.time * 0.05) * 0.05;
    }
  }

  Volcano.VENT = VENT;
  Volcano.LAKE_R = LAKE_R;
  global.Volcano = Volcano;
})(window);
