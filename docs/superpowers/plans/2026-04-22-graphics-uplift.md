# Graphics Uplift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift Cosmogony's render fidelity to the sci-fi hyper-real register (ACES tonemapping + bloom + god-rays + shadows + atmosphere halos + noise-based planet surfaces + parallax stars) using only post-processing, shaders, and procedural textures — no new asset pipeline.

**Architecture:** Three new engine modules (`postprocessing.js`, `proceduralTextures.js`, `atmosphereShader.js`) plus targeted edits to `renderer.js`, `skybox.js`, `shipModel.js`, `astronautModel.js`, `SolarSystemScene.js`, and `main.js`. Each task produces a self-contained, visually verifiable commit.

**Tech Stack:** Three.js 0.160 (built-in `UnrealBloomPass`, `ShaderPass`, `FXAAShader`, `EffectComposer`), Vite, Vitest. No new npm dependencies.

**File Structure:**

| File | Change | Responsibility |
|---|---|---|
| `src/engine/renderer.js` | Modify | ACES tonemapping, sRGB output, shadows |
| `src/engine/postprocessing.js` | Create | `PostFX` class — composer + bloom + god-rays + vignette + FXAA |
| `src/engine/proceduralTextures.js` | Create | `buildPlanetMaps(biome, seed)` → albedo + normal `CanvasTexture`s |
| `src/engine/atmosphereShader.js` | Create | `buildAtmosphere(radius, tintHex)` → backface fresnel `Mesh` |
| `src/engine/skybox.js` | Modify | 3 parallax star layers + 2 nebula sprites |
| `src/engine/shipModel.js` | Modify | Material tuning (metalness, emissive intensity) |
| `src/engine/astronautModel.js` | Modify | Material tuning (visor emissive, suit metalness) |
| `src/scenes/SolarSystemScene.js` | Modify | 3-light rig with shadows, planet maps + halos, `getStarWorldPosition()` |
| `src/main.js` | Modify | Render through `postfx.render(dt)`, pipe star pos to god-rays |

---

## Task 1: Renderer config — ACES + sRGB + shadows

**Files:**
- Modify: `src/engine/renderer.js`

This flips the renderer from flat LDR to filmic HDR. Scene will appear darker until Task 2 boosts the lights — that's expected.

- [ ] **Step 1: Add tonemapping, color space, and shadows**

In `src/engine/renderer.js`, replace the entire `createRenderer` function with:

```js
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000);
  // Filmic HDR pipeline — ACES compresses bright sources (stars, emissives)
  // back into the display range so bloom looks natural rather than blown.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Soft shadows from the star light. PCFSoftShadowMap is the cheapest
  // option that doesn't look like aliased pixel staircases.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}
```

- [ ] **Step 2: Run kernel tests**

Run: `npm test`
Expected: 17/17 passing (kernel untouched).

- [ ] **Step 3: Manually verify**

Open `http://localhost:5173` (Vite HMR will pick up the change). Scene will look noticeably darker — that's correct. Stars and the central star should still be visible. No errors in the dev console.

- [ ] **Step 4: Commit**

```bash
git add src/engine/renderer.js
git commit -m "feat(render): ACES tonemapping, sRGB output, soft shadows"
```

---

## Task 2: Lighting rig — star key (shadow-caster) + hemispheric fill + rim

**Files:**
- Modify: `src/scenes/SolarSystemScene.js`

Boost the star light to compensate for ACES tonemapping, add a hemispheric fill so dark sides don't go pitch black, and add a low directional rim from the opposite side for silhouette readability.

- [ ] **Step 1: Replace the existing light setup**

In `src/scenes/SolarSystemScene.js`, find the block that creates the point light and ambient light (currently around lines 53–55):

```js
    const light = new THREE.PointLight(starColor, 2, 0, 0);
    star.add(light);
    mgr.threeScene.add(mgr.track(new THREE.AmbientLight(0x202028, 0.3)));
```

Replace with:

```js
    // Key light — the star itself. Boosted to 10 because ACES expects
    // physically-higher light levels; the old intensity 2 reads as flat under
    // the new tonemapping. Casts shadows onto planets and moons.
    const light = new THREE.PointLight(starColor, 10, 0, 0);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.camera.near = 1;
    light.shadow.camera.far = 4000;
    light.shadow.bias = -0.0005;
    star.add(light);

    // Hemispheric fill — replaces the old AmbientLight. Sky color picks up
    // a cool tint of the star color, ground color is a warm rust. Keeps the
    // shadow side of planets visible without looking flat-ambient-lit.
    const skyHex = new THREE.Color(starColor).lerp(new THREE.Color(0x4a5878), 0.5).getHex();
    const fill = new THREE.HemisphereLight(skyHex, 0x2a1810, 0.25);
    mgr.threeScene.add(mgr.track(fill));

    // Rim light — a dim directional from the side opposite the star, so
    // planet/ship silhouettes get a cool edge highlight even in shadow.
    const rim = new THREE.DirectionalLight(0xe0f0ff, 0.3);
    rim.position.set(-100, 40, -100);
    mgr.threeScene.add(mgr.track(rim));
```

- [ ] **Step 2: Enable shadows on planets and moons**

Find `makePlanetMesh(pData, displayR)` in the same file. Right after the line `const mesh = new THREE.Mesh(new THREE.SphereGeometry(displayR, 48, 48), mat);`, add:

```js
    mesh.castShadow = true;
    mesh.receiveShadow = true;
```

Find `attachMoon(planetMesh, displayR)`. Right after the line `const moon = new THREE.Mesh(...);`, add:

```js
    moon.castShadow = true;
    moon.receiveShadow = true;
```

- [ ] **Step 3: Run kernel tests**

Run: `npm test`
Expected: 17/17 passing.

- [ ] **Step 4: Manually verify**

Reload the browser. Scene brightness should be back to roughly previous levels but with much more contrast — bright lit sides, deep but readable shadow sides, visible specular highlights. Look for a visible rim highlight on the side of a planet opposite the star.

- [ ] **Step 5: Commit**

```bash
git add src/scenes/SolarSystemScene.js
git commit -m "feat(solar): 3-light rig with shadows, hemi fill, rim highlight"
```

---

## Task 3: Post-processing pipeline — PostFX module + main.js wiring

**Files:**
- Create: `src/engine/postprocessing.js`
- Modify: `src/main.js`
- Modify: `src/scenes/SolarSystemScene.js` (add `getStarWorldPosition()`)

Owns the `EffectComposer` chain: `RenderPass → UnrealBloomPass → GodRaysPass → VignettePass → FXAAPass`. Wired into `main.js` so `postfx.render(dt)` replaces `renderer.render(...)`.

- [ ] **Step 1: Create the PostFX module**

Create `src/engine/postprocessing.js`:

```js
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

// Radial blur masked at the star's screen position — cheap god-rays.
// Anchored at uniforms.uCenter (NDC space, -1..1). uStrength fades the
// effect to zero when the star is offscreen or hidden.
const GodRaysShader = {
  uniforms: {
    tDiffuse: { value: null },
    uCenter:   { value: new THREE.Vector2(0.5, 0.5) },
    uStrength: { value: 0.0 },
    uDecay:    { value: 0.96 },
    uDensity:  { value: 0.95 },
    uWeight:   { value: 0.5 },
    uExposure: { value: 0.45 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2  uCenter;
    uniform float uStrength;
    uniform float uDecay;
    uniform float uDensity;
    uniform float uWeight;
    uniform float uExposure;
    varying vec2 vUv;
    const int SAMPLES = 48;
    void main() {
      vec2 texCoord = vUv;
      vec2 deltaTexCoord = (vUv - uCenter) * (uDensity / float(SAMPLES));
      vec4 color = texture2D(tDiffuse, vUv);
      float illum = 1.0;
      vec4 godrays = vec4(0.0);
      for (int i = 0; i < SAMPLES; i++) {
        texCoord -= deltaTexCoord;
        vec4 sampled = texture2D(tDiffuse, texCoord);
        // bias toward bright pixels so only the star contributes
        float lum = dot(sampled.rgb, vec3(0.299, 0.587, 0.114));
        sampled *= smoothstep(0.6, 1.2, lum);
        sampled *= illum * uWeight;
        godrays += sampled;
        illum *= uDecay;
      }
      gl_FragColor = color + godrays * uExposure * uStrength;
    }
  `,
};

// Subtle corner darkening — keeps focus toward the center of the frame.
const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    uStrength: { value: 0.12 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uStrength;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 uv = vUv - 0.5;
      float vig = smoothstep(0.8, 0.3, length(uv));
      gl_FragColor = vec4(c.rgb * mix(1.0 - uStrength, 1.0, vig), c.a);
    }
  `,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const w = renderer.domElement.width;
    const h = renderer.domElement.height;

    this.composer = new EffectComposer(renderer);
    this.composer.setSize(w, h);

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // UnrealBloomPass(resolution, strength, radius, threshold)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.8, 0.4, 0.6);
    this.composer.addPass(this.bloom);

    this.godRays = new ShaderPass(GodRaysShader);
    this.composer.addPass(this.godRays);

    this.vignette = new ShaderPass(VignetteShader);
    this.composer.addPass(this.vignette);

    this.fxaa = new ShaderPass(FXAAShader);
    this.fxaa.material.uniforms.resolution.value.set(1 / w, 1 / h);
    this.composer.addPass(this.fxaa);

    // OutputPass converts the linear HDR composer buffer to sRGB display.
    this.output = new OutputPass();
    this.composer.addPass(this.output);

    this._tmpVec = new THREE.Vector3();
  }

  setScene(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
  }

  // Pass a world-space Vector3 (or null to disable god-rays for this scene).
  setStarPosition(vec3OrNull) {
    if (!vec3OrNull) {
      this.godRays.material.uniforms.uStrength.value = 0;
      return;
    }
    this._tmpVec.copy(vec3OrNull).project(this.camera);
    // NDC → 0..1 UV space
    const cx = this._tmpVec.x * 0.5 + 0.5;
    const cy = this._tmpVec.y * 0.5 + 0.5;
    this.godRays.material.uniforms.uCenter.value.set(cx, cy);
    // Fade out when star is behind camera (z > 1) or far off-screen.
    const onScreen = this._tmpVec.z < 1
      && cx > -0.2 && cx < 1.2 && cy > -0.2 && cy < 1.2;
    this.godRays.material.uniforms.uStrength.value = onScreen ? 1.0 : 0.0;
  }

  setExposure(x) {
    this.renderer.toneMappingExposure = x;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.fxaa.material.uniforms.resolution.value.set(1 / w, 1 / h);
  }

  render(dt) {
    this.composer.render(dt);
  }
}
```

- [ ] **Step 2: Add `getStarWorldPosition` to SolarSystemScene**

In `src/scenes/SolarSystemScene.js`, add a method right after `getMapData()`:

```js
  getStarWorldPosition() {
    return this.star ? this.star.position : null;
  }
```

- [ ] **Step 3: Wire PostFX into main.js**

In `src/main.js`, add to the imports near `createRenderer`:

```js
import { PostFX } from './engine/postprocessing.js';
```

After the line `attachResize(renderer, camera);`, add:

```js
const postfx = new PostFX(renderer, threeScene, camera);
window.addEventListener('resize', () => {
  postfx.setSize(window.innerWidth, window.innerHeight);
});
```

In the `loop(t)` function, replace:

```js
  renderer.render(threeScene, camera);
  requestAnimationFrame(loop);
```

with:

```js
  // Pipe the active scene's star (if any) to god-rays. Galaxy / black hole /
  // surface scenes return null so god-rays disables itself for that frame.
  const starPos = sceneManager.activeScene?.getStarWorldPosition?.() ?? null;
  postfx.setStarPosition(starPos);
  postfx.render(dt);
  requestAnimationFrame(loop);
```

- [ ] **Step 4: Run kernel tests**

Run: `npm test`
Expected: 17/17 passing.

- [ ] **Step 5: Manually verify**

Reload. Stars and the central star should now bloom (visible halo of light around bright sources). Pointing the camera at the star should produce visible radial light streaks (god-rays). Subtle corner darkening (vignette). No console errors. FPS should remain at 60.

- [ ] **Step 6: Commit**

```bash
git add src/engine/postprocessing.js src/main.js src/scenes/SolarSystemScene.js
git commit -m "feat(render): post-processing — bloom, god-rays, vignette, FXAA"
```

---

## Task 4: Atmosphere halos — fresnel backface shader

**Files:**
- Create: `src/engine/atmosphereShader.js`
- Modify: `src/scenes/SolarSystemScene.js`

A backface-rendered sphere at `radius × 1.05` with a fresnel-emissive shader, biome-tinted. Reads as "this world has weather."

- [ ] **Step 1: Create the atmosphere module**

Create `src/engine/atmosphereShader.js`:

```js
import * as THREE from 'three';

// Builds a translucent halo around a planet. Renders the inside of a
// slightly-larger sphere with additive blending; the fresnel term makes the
// edge glow brightly while the front (where the planet sits) is invisible.
export function buildAtmosphere(radius, tintHex, intensity = 1.0) {
  const geom = new THREE.SphereGeometry(radius * 1.05, 64, 32);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTint:      { value: new THREE.Color(tintHex) },
      uIntensity: { value: intensity },
    },
    vertexShader: /* glsl */`
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3  uTint;
      uniform float uIntensity;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      void main() {
        // Backface render → vNormalW points inward; flip it so fresnel
        // measures angle to camera correctly.
        float fres = 1.0 - max(dot(-vNormalW, vViewDir), 0.0);
        float halo = pow(fres, 2.0) * uIntensity;
        gl_FragColor = vec4(uTint * halo, halo);
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  return new THREE.Mesh(geom, mat);
}

// Per-biome tint table. Molten and gas_giant skip atmosphere (they read
// better without — molten is its own glow, gas_giant is already gaseous).
const TINT_BY_BIOME = Object.freeze({
  temperate: 0x6aa8ff,
  ocean:     0x6aa8ff,
  ice:       0xdff0ff,
  desert:    0xffb070,
});

export function atmosphereTintForBiome(biome) {
  return TINT_BY_BIOME[biome] ?? null;
}
```

- [ ] **Step 2: Wire halos into planet meshes**

In `src/scenes/SolarSystemScene.js`, add to the imports near the top:

```js
import { buildAtmosphere, atmosphereTintForBiome } from '../engine/atmosphereShader.js';
```

In `makePlanetMesh(pData, displayR)`, right before the closing `return mesh;`, add:

```js
    const tint = atmosphereTintForBiome(pData.biome);
    if (tint !== null) {
      mesh.add(buildAtmosphere(displayR, tint, 1.0));
    }
```

- [ ] **Step 3: Run kernel tests**

Run: `npm test`
Expected: 17/17 passing.

- [ ] **Step 4: Manually verify**

Reload. Temperate, ocean, and ice planets should have a visible cyan/white halo at the limb (edge). Desert planets get a peach halo. Molten and gas giant — no halo. The halo should fade smoothly toward the planet center, not look like a visible second sphere.

- [ ] **Step 5: Commit**

```bash
git add src/engine/atmosphereShader.js src/scenes/SolarSystemScene.js
git commit -m "feat(scene): biome-tinted atmosphere halos via fresnel shader"
```

---

## Task 5: Procedural planet surfaces — noise-based albedo + normal maps

**Files:**
- Create: `src/engine/proceduralTextures.js`
- Modify: `src/scenes/SolarSystemScene.js`

Per-biome `CanvasTexture`s drawn from layered value-noise — gives planets continents, dune ridges, magma cracks, ice veins, gas-giant bands. Deterministic per universe + planet index.

- [ ] **Step 1: Create the procedural textures module**

Create `src/engine/proceduralTextures.js`:

```js
import * as THREE from 'three';
import { makeRng } from '../kernel/index.js';

// Builds an albedo + normal map pair for a given biome, deterministically
// seeded by `seed` (any uint). Output canvas is `width × width/2` for an
// equirectangular-ish UV mapping onto a sphere. width=512 is a good balance
// of detail vs. generation cost.
export function buildPlanetMaps(biome, seed, width = 512) {
  const height = width / 2;
  const rng = makeRng(seed);
  const noise = makeValueNoise2D(rng);

  const cfg = BIOME_CONFIG[biome] ?? BIOME_CONFIG.temperate;

  // Sample a normalized height field h(x, y) ∈ [0, 1] over the canvas.
  const field = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const v = y / height;
      // Wrap horizontally by sampling on a cylinder: (cos, sin, v).
      const angle = u * Math.PI * 2;
      const sx = Math.cos(angle);
      const sz = Math.sin(angle);
      let h = cfg.field(noise, sx * cfg.scale, v * cfg.scale, sz * cfg.scale);
      h = Math.max(0, Math.min(1, h));
      field[y * width + x] = h;
    }
  }

  return {
    albedo: makeAlbedoTexture(field, width, height, cfg),
    normal: makeNormalTexture(field, width, height, cfg.normalStrength),
  };
}

// ── Per-biome configuration ───────────────────────────────────────────────
const BIOME_CONFIG = {
  temperate: {
    scale: 4,
    field: (n, x, y, z) => fbm(n, x, y, z, 6, 2.0, 0.5),
    palette: [
      [0.05, [10, 30, 70]],     // deep ocean
      [0.45, [40, 80, 130]],    // shallow ocean
      [0.50, [180, 160, 110]],  // beach
      [0.65, [70, 110, 50]],    // grass
      [0.80, [90, 80, 60]],     // mountain rock
      [0.95, [240, 240, 245]],  // snow caps
    ],
    normalStrength: 1.2,
  },
  ocean: {
    scale: 3,
    field: (n, x, y, z) => fbm(n, x, y, z, 4, 2.0, 0.55) * 0.6 + 0.2,
    palette: [
      [0.0,  [10, 30, 80]],
      [0.55, [30, 80, 150]],
      [0.85, [80, 160, 200]],
    ],
    normalStrength: 0.4,
  },
  desert: {
    scale: 5,
    field: (n, x, y, z) => ridged(n, x, y, z, 5, 2.1, 0.5),
    palette: [
      [0.0,  [120, 70, 40]],
      [0.5,  [200, 140, 80]],
      [0.9,  [230, 200, 140]],
    ],
    normalStrength: 1.6,
  },
  molten: {
    scale: 6,
    field: (n, x, y, z) => Math.pow(fbm(n, x, y, z, 5, 2.4, 0.55), 1.4),
    palette: [
      [0.0,  [10, 5, 5]],        // basalt black
      [0.45, [60, 20, 10]],
      [0.55, [220, 80, 20]],     // magma crack
      [0.85, [255, 200, 60]],
    ],
    normalStrength: 2.0,
  },
  ice: {
    scale: 4,
    field: (n, x, y, z) => 0.6 + 0.4 * fbm(n, x, y, z, 5, 2.0, 0.5),
    palette: [
      [0.0,  [180, 200, 220]],
      [0.7,  [220, 235, 245]],
      [1.0,  [255, 255, 255]],
    ],
    normalStrength: 1.4,
  },
  gas_giant: {
    scale: 2,
    // Strong horizontal banding — y dominates the noise; x adds turbulence.
    field: (n, x, y, z) => {
      const band = Math.sin(y * 8.0) * 0.5 + 0.5;
      const turb = fbm(n, x * 0.3, y * 12.0, z * 0.3, 4, 2.0, 0.5) * 0.3;
      return Math.max(0, Math.min(1, band * 0.7 + turb + 0.15));
    },
    palette: [
      [0.0,  [120, 90, 60]],
      [0.4,  [200, 170, 130]],
      [0.7,  [230, 200, 160]],
      [1.0,  [180, 130, 90]],
    ],
    normalStrength: 0.3,
  },
};

// ── Value noise — deterministic, seeded RNG hash table ────────────────────
function makeValueNoise2D(rng) {
  const SIZE = 256;
  const table = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < table.length; i++) table[i] = rng();
  const wrap = (n) => ((n % SIZE) + SIZE) % SIZE;
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  return function noise3(x, y, z) {
    // Project (x,y,z) into 2D by mixing — cheap pseudo-3D so wrap-around
    // doesn't visibly seam.
    const u = x + z * 0.7;
    const v = y + z * 0.3;
    const xi = Math.floor(u);
    const yi = Math.floor(v);
    const xf = u - xi;
    const yf = v - yi;
    const a = table[wrap(xi)     * SIZE + wrap(yi)];
    const b = table[wrap(xi + 1) * SIZE + wrap(yi)];
    const c = table[wrap(xi)     * SIZE + wrap(yi + 1)];
    const d = table[wrap(xi + 1) * SIZE + wrap(yi + 1)];
    const u2 = smooth(xf);
    const v2 = smooth(yf);
    return lerp(lerp(a, b, u2), lerp(c, d, u2), v2);
  };
}

function fbm(noise, x, y, z, octaves, lacunarity, gain) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum  += amp * noise(x * freq, y * freq, z * freq);
    norm += amp;
    amp  *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

function ridged(noise, x, y, z, octaves, lacunarity, gain) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise(x * freq, y * freq, z * freq) * 2 - 1);
    sum  += amp * n * n;
    norm += amp;
    amp  *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

// ── Canvas writers ────────────────────────────────────────────────────────
function makeAlbedoTexture(field, w, h, cfg) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < field.length; i++) {
    const [r, g, b] = sampleGradient(field[i], cfg.palette);
    const j = i * 4;
    img.data[j] = r;
    img.data[j + 1] = g;
    img.data[j + 2] = b;
    img.data[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function makeNormalTexture(field, w, h, strength) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  const sample = (x, y) => {
    const xx = ((x % w) + w) % w;
    const yy = Math.max(0, Math.min(h - 1, y));
    return field[yy * w + xx];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel-like gradient
      const gx = (sample(x + 1, y) - sample(x - 1, y)) * strength;
      const gy = (sample(x, y + 1) - sample(x, y - 1)) * strength;
      // Reconstruct normal: (-gx, -gy, 1), normalized, then mapped to 0..255.
      const nx = -gx;
      const ny = -gy;
      const nz = 1.0;
      const len = Math.hypot(nx, ny, nz);
      const j = (y * w + x) * 4;
      img.data[j]     = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[j + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[j + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[j + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function sampleGradient(t, palette) {
  for (let i = 1; i < palette.length; i++) {
    const [t1, c1] = palette[i];
    const [t0, c0] = palette[i - 1];
    if (t <= t1) {
      const a = (t - t0) / Math.max(0.0001, (t1 - t0));
      return [
        c0[0] + (c1[0] - c0[0]) * a,
        c0[1] + (c1[1] - c0[1]) * a,
        c0[2] + (c1[2] - c0[2]) * a,
      ];
    }
  }
  return palette[palette.length - 1][1];
}
```

- [ ] **Step 2: Apply textures to planets**

In `src/scenes/SolarSystemScene.js`, add to the imports:

```js
import { buildPlanetMaps } from '../engine/proceduralTextures.js';
```

In `build(mgr)`, find the planet loop and modify the call to `makePlanetMesh` to pass an additional seed argument. Replace:

```js
    for (let i = 0; i < N; i++) {
      const pData = derivePlanet(u, i);
      const displayR = pData.radius * PLANET_SCALE;
      const displayOrbit = pData.orbitRadius * ORBIT_SCALE;
      const mesh = this.makePlanetMesh(pData, displayR);
```

with:

```js
    for (let i = 0; i < N; i++) {
      const pData = derivePlanet(u, i);
      const displayR = pData.radius * PLANET_SCALE;
      const displayOrbit = pData.orbitRadius * ORBIT_SCALE;
      const planetSeed = hashString(u.id + '|planet|' + i);
      const mesh = this.makePlanetMesh(pData, displayR, planetSeed);
```

Replace the `makePlanetMesh` method signature and material setup. Find:

```js
  makePlanetMesh(pData, displayR) {
    const colorMap = {
      molten:    new THREE.Color().setHSL(0.04, 0.7, 0.35),
      desert:    new THREE.Color().setHSL(0.08, 0.5, 0.5),
      temperate: new THREE.Color().setHSL(0.32, 0.5, 0.45),
      ocean:     new THREE.Color().setHSL(0.58, 0.5, 0.4),
      gas_giant: new THREE.Color().setHSL(0.55, 0.4, 0.55),
      ice:       new THREE.Color().setHSL(0.55, 0.15, 0.8),
    };
    const mat = new THREE.MeshStandardMaterial({
      color: colorMap[pData.biome] || colorMap.temperate,
      roughness: 0.85,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(displayR, 48, 48), mat);
```

Replace with:

```js
  makePlanetMesh(pData, displayR, seed) {
    const { albedo, normal } = buildPlanetMaps(pData.biome, seed);
    const mat = new THREE.MeshStandardMaterial({
      map: albedo,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.85,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(displayR, 64, 64), mat);
```

Note the geometry resolution bumped from 48 to 64 — normal maps need slightly more vertices to sell the silhouette.

- [ ] **Step 3: Run kernel tests**

Run: `npm test`
Expected: 17/17 passing.

- [ ] **Step 4: Manually verify**

Reload. Each planet should now have visible surface detail — temperate planets show continents in green/tan with snow caps, deserts show ridged dunes, molten worlds have glowing magma cracks, ice worlds have subtle vein patterns, ocean worlds show shallow shelves, gas giants show horizontal cloud bands. Detail should hold up at the new 1.5× camera distance.

- [ ] **Step 5: Commit**

```bash
git add src/engine/proceduralTextures.js src/scenes/SolarSystemScene.js
git commit -m "feat(scene): per-biome procedural planet surfaces with normal maps"
```

---

## Task 6: Parallax starfield — 3 layers + nebula sprites

**Files:**
- Modify: `src/engine/skybox.js`
- Modify: `src/main.js`

Add depth to the void with multiple star layers rotating at different rates plus 2 large faint nebula sprites.

- [ ] **Step 1: Replace `createSkybox` with the multi-layer version**

Replace the entire contents of `src/engine/skybox.js` with:

```js
import * as THREE from 'three';
import { makeRng } from '../kernel/index.js';

// Builds a layered starfield with parallax. Returns a Group that should be
// added to the scene. Caller can rotate the group itself for global drift;
// the layers also rotate at different speeds inside `update(dt)` to give
// near/far parallax.
export function createSkybox(seed = 42) {
  const group = new THREE.Group();
  group.name = 'Skybox';

  // Three star layers — far/mid/near. Far is dim and slow, near is bright
  // and fast, mid splits the difference. Star counts intentionally taper
  // (more far stars, fewer near stars) so depth doesn't feel like clutter.
  const farLayer  = makeStarLayer(seed * 11 + 1, 12000, 5800, 0.7, [1.0, 0.95, 0.8]);
  const midLayer  = makeStarLayer(seed * 11 + 2,  4500, 5400, 0.85, [0.7, 0.8, 1.0]);
  const nearLayer = makeStarLayer(seed * 11 + 3,  1200, 4800, 1.0, [1.0, 0.7, 0.5]);

  group.add(farLayer);
  group.add(midLayer);
  group.add(nearLayer);

  // Two nebula sprites at deterministic positions — large, faint, additive.
  const nebulaA = makeNebulaSprite(seed * 7 + 1, 0x6644aa);
  const nebulaB = makeNebulaSprite(seed * 7 + 2, 0x44aaaa);
  // Place them at far radii, deterministic angles.
  const rng = makeRng(seed * 13);
  placeOnSphere(nebulaA, 6000, rng() * Math.PI * 2, (rng() - 0.5) * Math.PI);
  placeOnSphere(nebulaB, 6000, rng() * Math.PI * 2, (rng() - 0.5) * Math.PI);
  nebulaA.scale.set(2400, 2400, 1);
  nebulaB.scale.set(2000, 2000, 1);
  group.add(nebulaA);
  group.add(nebulaB);

  // Expose the layers on userData so main.js can rotate them at different
  // rates each frame for the parallax effect.
  group.userData.layers = [farLayer, midLayer, nearLayer];

  return group;
}

function makeStarLayer(seed, count, radius, opacity, baseColor) {
  const geom = new THREE.BufferGeometry();
  const positions = [];
  const colors = [];
  const rng = makeRng(seed);
  for (let i = 0; i < count; i++) {
    const theta = rng() * Math.PI * 2;
    const phi   = Math.acos(2 * rng() - 1);
    positions.push(
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi)
    );
    // Most stars are baseColor; ~15% get a saturated variant for visual interest.
    const t = rng();
    if (t < 0.85) {
      colors.push(baseColor[0], baseColor[1], baseColor[2]);
    } else if (t < 0.93) {
      colors.push(0.6, 0.8, 1.0); // blue
    } else {
      colors.push(1.0, 0.55, 0.4); // red giant
    }
  }
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('color',    new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 6 * (radius / 5400), // closer layer → bigger pixels
    vertexColors: true,
    transparent: true,
    opacity,
    sizeAttenuation: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geom, mat);
}

function makeNebulaSprite(seed, hex) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d');
  // Multiple radial gradients piled on top — soft, irregular cloud shape.
  const rng = makeRng(seed);
  const c = new THREE.Color(hex);
  for (let i = 0; i < 6; i++) {
    const cx = 64 + rng() * 128;
    const cy = 64 + rng() * 128;
    const r  = 40 + rng() * 80;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    const a = 0.12 + rng() * 0.18;
    g.addColorStop(0, `rgba(${(c.r*255)|0},${(c.g*255)|0},${(c.b*255)|0},${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  }
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  return new THREE.Sprite(mat);
}

function placeOnSphere(obj, radius, theta, phi) {
  obj.position.set(
    radius * Math.cos(phi) * Math.cos(theta),
    radius * Math.sin(phi),
    radius * Math.cos(phi) * Math.sin(theta)
  );
}
```

- [ ] **Step 2: Drive parallax rotation in main.js**

In `src/main.js`, find the line in `loop(t)`:

```js
  skybox.rotation.y += dt * 0.001;
```

Replace with:

```js
  // Parallax — each layer rotates at a slightly different rate so distant
  // and near stars don't move in lockstep. Sells depth as the camera turns.
  const layers = skybox.userData.layers || [];
  const rates = [0.0004, 0.0008, 0.0014];
  for (let i = 0; i < layers.length; i++) {
    layers[i].rotation.y += dt * (rates[i] || 0.001);
  }
```

- [ ] **Step 3: Run kernel tests**

Run: `npm test`
Expected: 17/17 passing.

- [ ] **Step 4: Manually verify**

Reload. Starfield should look denser. Two faint colored cloud patches (purple and teal) should be visible somewhere in the sky. As you slowly pan the camera, you can perceive that closer (sparser, brighter) stars drift faster than the dense backdrop — the parallax cue.

- [ ] **Step 5: Commit**

```bash
git add src/engine/skybox.js src/main.js
git commit -m "feat(skybox): 3-layer parallax starfield with nebula sprites"
```

---

## Task 7: Material micro-detail — ship + astronaut

**Files:**
- Modify: `src/engine/shipModel.js`
- Modify: `src/engine/astronautModel.js`

Bumps metalness, roughness contrast, and emissive intensity so materials read as "real metal lit by a real star with bloom" instead of "tinted plastic." No new textures.

- [ ] **Step 1: Update ship materials**

In `src/engine/shipModel.js`, find the four material declarations near the top of `buildShipModel()` and update their values:

For `hull`:
```js
  const hull = new THREE.MeshStandardMaterial({
    color: 0x2a2a30,
    roughness: 0.45,
    metalness: 0.85,
    flatShading: true,
  });
```

For `hullAccent`:
```js
  const hullAccent = new THREE.MeshStandardMaterial({
    color: 0x5a5a68,
    roughness: 0.3,
    metalness: 0.95,
    flatShading: true,
  });
```

For `emissiveCyan`:
```js
  const emissiveCyan = new THREE.MeshStandardMaterial({
    color: 0x88d0ff,
    emissive: 0x66aaff,
    emissiveIntensity: 4.0,
    roughness: 0.3,
  });
```

For `emissiveAmber`:
```js
  const emissiveAmber = new THREE.MeshStandardMaterial({
    color: 0xffb060,
    emissive: 0xff8030,
    emissiveIntensity: 3.2,
    roughness: 0.3,
  });
```

- [ ] **Step 2: Update astronaut materials**

In `src/engine/astronautModel.js`, locate the materials. Find the suit body material (looks like `MeshStandardMaterial` for the torso/limbs) and update its metalness/roughness:

Search for `metalness: 0.1` and `roughness: 0.7` in astronaut materials and replace with:

```js
    metalness: 0.25,
    roughness: 0.55,
```

Find the visor material (the amber emissive on the helmet) and bump its `emissiveIntensity` to `2.5`. If currently `emissiveIntensity: 1.5`, change to `2.5`. If different, replace whatever number is there with `2.5`.

Find the chest cyan accent (the `emissiveCyan`-like material) and bump its `emissiveIntensity` to `3.0`.

(If the actual structure differs from the spec — e.g. helmets use a different material name — apply the spirit of the change: bump the suit body's metalness from low to ~0.25, the visor and chest accents to bloom-registering emissive intensities.)

- [ ] **Step 3: Run kernel tests**

Run: `npm test`
Expected: 17/17 passing.

- [ ] **Step 4: Manually verify**

Reload. In external view, the ship hull should now show stronger specular highlights where the star hits it. The cyan and amber accents should produce visible bloom halos. Disembark and look at the astronaut — the visor should glow amber, the chest cyan accent should bloom. Suit body should look more like a treated metal surface than rubber.

- [ ] **Step 5: Commit**

```bash
git add src/engine/shipModel.js src/engine/astronautModel.js
git commit -m "feat(materials): tune ship + astronaut for bloom + ACES lighting"
```

---

## Self-Review Checklist

**Spec coverage:**

- ✅ Renderer config (ACES, sRGB, shadows) — Task 1
- ✅ Post-processing pipeline (bloom, god-rays, vignette, FXAA) — Task 3
- ✅ 3-light rig (key/fill/rim) with shadows — Task 2
- ✅ Procedural planet surfaces (albedo + normal per biome) — Task 5
- ✅ Atmosphere halos (fresnel backface, biome-tinted) — Task 4
- ✅ Parallax starfield (3 layers + nebula sprites) — Task 6
- ✅ Material micro-detail (ship + astronaut) — Task 7
- ✅ `getStarWorldPosition()` helper — Task 3
- ✅ Per-scene god-rays gating via `setStarPosition(null)` — Task 3 (galaxy/blackhole/surface scenes don't define `getStarWorldPosition`, so the optional-chain falls through to `null`)

**Placeholder scan:** No "TBD", no "fill in details", no "similar to task N". Task 7 acknowledges astronaut material structure may differ from spec and gives a fallback ("apply the spirit") — this is necessary because the astronaut model file isn't fully visible in the spec; the implementer reads the file and applies the values.

**Type / name consistency:**
- `PostFX` class — defined Task 3, used Task 3 only
- `buildPlanetMaps(biome, seed, width = 512)` — Task 5 defines, Task 5 uses
- `buildAtmosphere(radius, tintHex, intensity)` — Task 4 defines, Task 4 uses
- `atmosphereTintForBiome(biome)` — Task 4 defines, Task 4 uses
- `getStarWorldPosition()` — Task 3 defines, Task 3 reads via optional chain
- `setStarPosition(vec3OrNull)` — Task 3 defines + uses
- `skybox.userData.layers` — Task 6 sets + reads
- `hashString` already imported in `SolarSystemScene.js` (verified at top of existing file via the `import { ... } from '../kernel/index.js'` block) — no new import needed for Task 5

**Scope:** Single coordinated graphics pass. Each task ships independently and the scene improves incrementally — no two-task dependencies that would block partial completion.

**Risk reminders for the implementer:**
- After Task 1, scene will be visibly darker. **Do not panic and revert** — Task 2 boosts lights to compensate. The two are paired by design.
- Bloom threshold of 0.6 means raising emissive intensities (Task 7) is what makes accents glow. If accents don't bloom after Task 7, check that Task 3 is in place.
- God-rays only render when looking near the star. If you don't see them, point the camera at the central star.

---

## Execution Handoff

Plan is ready for execution via Subagent-Driven Development.
