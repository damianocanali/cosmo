# Graphics Uplift — Design

Date: 2026-04-22
Status: Approved, ready for implementation plan

## Summary

Lift Cosmogony's rendered image from "solid-color spheres + one point light" to
sci-fi hyper-real — the Elite Dangerous / Star Citizen visual register. Pure
Three.js + procedural shaders + noise-driven CanvasTextures. No new asset
pipeline. The kernel is untouched.

## Goals

- Broad, simultaneous uplift across lighting, planets, starfield, and materials
  (the user identified all four as equally weak).
- Single-pass implementation, ~4 hours of focused work.
- Keep the observatory-logbook HUD aesthetic intact — this is about the *world*
  looking alive, not the UI.
- All kernel tests continue to pass; nothing kernel-side is touched.
- 60fps on the dev machine. Post-processing cost is bounded and gated per
  scene (god-rays only where a star is present).

## Non-goals (deliberately deferred)

- Screen-space ambient occlusion, depth-of-field, motion blur, film grain,
  color grading LUTs (the "Pass 3 / cinematic mode" set).
- HDR environment maps loaded from disk.
- Volumetric clouds or true fluid simulation.
- Per-planet unique shaders beyond the biome-driven normal/albedo generator.

---

## Aesthetic target

Sci-fi hyper-real. Concrete cues:

- **Dynamic range.** Star and emissive accents blow out into bloom; shadow
  sides of planets stay deep but never crushed black — hemispheric fill keeps
  silhouettes readable.
- **Minimal grading.** ACES filmic tonemapping, no LUT. Color comes from the
  objects, not a post-hoc tint.
- **Atmosphere as presence.** Terran-like planets get a visible halo; airless
  ones don't. The halo reads as "this world has weather."
- **Depth in the void.** Starfield has parallax layers + faint nebula gradients
  so you can *feel* yourself moving through space, not sliding across a
  painted backdrop.
- **Material contrast.** Ship hull reads as real metal. Emissive accents read
  as real light. Astronaut visor catches the star.

---

## Architecture

The uplift breaks into 7 independent pieces, each shippable in isolation. Each
one is a self-contained change that makes the scene better even if the others
aren't built yet.

### 1. Renderer configuration

`src/engine/renderer.js`:

- `renderer.toneMapping = THREE.ACESFilmicToneMapping`
- `renderer.toneMappingExposure = 1.0` (tunable; baseline)
- `renderer.outputColorSpace = THREE.SRGBColorSpace`
- `renderer.shadowMap.enabled = true; shadowMap.type = THREE.PCFSoftShadowMap`

These four lines flip the renderer from flat LDR to filmic HDR — foundational.
No new module needed.

### 2. Post-processing pipeline — new module

`src/engine/postprocessing.js`:

Owns an `EffectComposer` built around the main renderer. Exports a single
class `PostFX` with:

- `PostFX(renderer, scene, camera)` — builds the composer.
- `setScene(scene, camera)` — rebinds the `RenderPass` for scene swaps.
- `setStarPosition(vec3 | null)` — drives god-rays. `null` disables that pass
  (galaxy / black hole / surface scenes).
- `setExposure(x)` — exposure knob for future tuning.
- `setSize(w, h)` — responds to window resize.
- `render(dt)` — called once per frame instead of `renderer.render(...)`.

Pass chain:

1. `RenderPass(scene, camera)` — normal render into the composer's rendertarget.
2. `UnrealBloomPass(size, strength=0.8, radius=0.4, threshold=0.6)` — only the
   star and emissives bloom, not planet surfaces.
3. `GodRaysPass` — custom shader pass. Radial blur mask anchored at the
   star's projected screen position, occluder-aware by reading scene depth.
   Skipped when `setStarPosition(null)`. Implementation uses the standard
   Three.js example pattern (`examples/jsm/postprocessing/EffectComposer.js`
   + a `ShaderPass` wrapping a radial-blur fragment shader).
4. `VignettePass` — tiny `ShaderPass` with a 10-line fragment shader that
   darkens corners by ~12%. Hand-written, not pulled from postprocessing libs
   — keeps the dep surface small.
5. `FXAAPass` — cheap antialiasing to clean up the composited result.

`src/main.js` replaces the `renderer.render(threeScene, camera)` line with
`postfx.render(dt)`. `SolarSystemScene` exposes `getStarWorldPosition()` and
`main.js` pipes it into `postfx.setStarPosition` each frame.

### 3. Lighting rig — SolarSystemScene

The current rig is `PointLight(starColor, 2)` + `AmbientLight(0x202028, 0.3)`.
New rig:

- **Key** — boost `PointLight` intensity to 10, enable shadows
  (`castShadow = true`, `shadow.mapSize = 2048`). ACES tonemapping expects
  physically-higher light levels; the old 2 intensity is what makes everything
  read "flat."
- **Hemispheric fill** — `HemisphereLight(skyHex, groundHex, 0.25)`. Sky
  color leans toward the star's color shifted cooler; ground color a warm
  rust. Prevents the shadow side of planets from being pitch black while
  still reading as "shadow."
- **Rim** — `DirectionalLight(0xe0f0ff, 0.3)` positioned opposite the star
  (at `-starDir`) to give silhouettes a cool edge highlight.
- **Remove** the existing `AmbientLight` — hemispheric fill replaces it.

Planet meshes get `castShadow = true; receiveShadow = true`. Moon meshes
`castShadow = true`. Rings kept as non-shadowcasters (performance).

### 4. Procedural planet surfaces — new module

`src/engine/proceduralTextures.js`:

Exports:
- `buildPlanetMaps(biome, seed, width = 512)` → `{ albedo, normal }`,
  both `THREE.CanvasTexture`s. The canvas is `width × width/2` (2:1 aspect
  for equirectangular-ish UV mapping onto the sphere).

Implementation: a seeded 2D simplex/value-noise routine (or 3D fBm sampled
onto a spherical UV layout — the simpler UV-spherical approach is fine at
this resolution). Per biome, pick a noise regime:

| Biome | Noise regime | Albedo gradient | Normal intensity |
|---|---|---|---|
| temperate | fBm 6 octaves, lacunarity 2.0 | deep green ⇄ tan via elevation, snow above 0.8 | medium |
| ocean | fBm 4 octaves smoothed | deep blue ⇄ cyan shelf | low |
| desert | ridged noise, ridges dominant | ochre ⇄ rust | high |
| molten | turbulence, high contrast | black basalt ⇄ orange magma cracks | very high |
| ice | voronoi + fBm | pale blue-white with vein cracks | medium-high |
| gas_giant | horizontal band warp | biome-tint bands | low (smooth) |

The noise and color math runs into a 512×256 `HTMLCanvasElement`, read into
`CanvasTexture`. Per-planet seeded so the same world looks the same across
reloads — the seed is `hashString(universe.id + '|planet|' + planetIndex)`,
matching the existing deterministic pattern used in `SolarSystemScene.build`.

`SolarSystemScene.makePlanetMesh` wires both textures onto the existing
`MeshStandardMaterial`: `map = albedo`, `normalMap = normal`,
`normalScale = new Vector2(0.8, 0.8)`.

### 5. Atmosphere halos — new module

`src/engine/atmosphereShader.js`:

Exports `buildAtmosphere(radius, tintHex)` returning a `THREE.Mesh` at
`radius × 1.05` with a custom `ShaderMaterial`:

- `side: THREE.BackSide` (renders the inside of the sphere so it doesn't
  occlude the planet).
- `transparent: true`, `blending: THREE.AdditiveBlending`, `depthWrite: false`.
- Vertex shader passes world-space normal and view direction.
- Fragment shader: fresnel term `pow(1.0 - dot(N, V), 2.0)` multiplied by
  a biome tint, scaled by a `uniforms.intensity` slider (default 1.0).

Biome tints:
- temperate, ocean → `0x6aa8ff` (cyan-blue)
- ice → `0xdff0ff` (pale cyan-white)
- desert → `0xffb070` (peach)
- molten, gas_giant → skip (molten reads better without, gas giant is its
  own atmosphere already)

`SolarSystemScene.makePlanetMesh` adds the atmosphere as a child of the
planet mesh so it orbits with it.

### 6. Parallax starfield — skybox extension

`src/engine/skybox.js`:

Current: one InstancedMesh starfield sphere. New: 3 layered sphere meshes at
radii `[4800, 5200, 5600]`, each an instanced small-sphere field. Different
star counts (far=dense, near=sparse), different sizes, and different rotation
speeds in the main loop (far slowest, near fastest — provides parallax cue).

Add two large `Sprite` nebula quads at ~5800 radius in deterministic positions
(seeded), drawn from procedurally-generated radial-gradient canvases (purple
+ teal smudges at low opacity). These live in the same module — exported as
`createSkybox(seed) → Group` so the call site is unchanged.

### 7. Material micro-detail

`src/engine/shipModel.js`:

- `hull.roughness: 0.6 → 0.45`, `metalness: 0.7 → 0.85` (more specular punch).
- `hullAccent.metalness: 0.8 → 0.95`, `roughness: 0.4 → 0.3`.
- `emissiveCyan.emissiveIntensity: 2.5 → 4.0` (so the bloom pass actually
  registers it as a bright source).
- `emissiveAmber.emissiveIntensity: 1.8 → 3.2`.

`src/engine/astronautModel.js`:

- Suit body material: metalness 0.1 → 0.25, roughness 0.7 → 0.55.
- Helmet visor: keep amber, bump `emissiveIntensity` from whatever it is to
  2.5 so the visor reads as lit from within.
- Chest cyan: bump emissive to 3.0.

No new textures — all micro-detail comes from the material values + the
post-processing bloom.

---

## Data flow

```
renderer (ACES + shadows)
    │
    ├──► SolarSystemScene.build()
    │     • 3-light rig (star key shadow-caster, hemi fill, rim)
    │     • per-planet: buildPlanetMaps(biome, seed) → albedo+normal
    │     •             buildAtmosphere(radius, tint) → child mesh
    │     • skybox: 3 parallax layers + 2 nebula sprites
    │
    └──► main.js loop
          • postfx.setStarPosition(scene.getStarWorldPosition?.())
          • postfx.render(dt)   ← replaces renderer.render
                │
                ▼
          RenderPass → BloomPass → GodRays? → Vignette → FXAA → canvas
```

Scene transitions:
- Galaxy scene: `setStarPosition(null)` — god-rays off; bloom still active
  for galaxy core.
- Black hole: same, bloom becomes the dominant effect.
- Planet surface: god-rays off (too expensive at the implied lower altitude).

---

## Error handling

- Shader compilation failure (atmosphere halo, vignette, god-rays): log once,
  fall back to a no-op pass. Scene keeps rendering; only that visual
  contribution is missing. Easier to debug than a white screen.
- Canvas texture generation failure (out of memory on tiny GPUs): fall back
  to solid-color `MeshStandardMaterial` (current behavior). Log once.
- Resize: composer and all passes receive `setSize` calls from the same
  resize listener that the renderer uses. Single call site, no drift.

---

## Testing

### Kernel

No new kernel code. Existing 17 tests stay green; a CI check ensures that
remains true.

### Visual (manual)

Graphics aren't unit-testable; verify in-browser:

1. **Solar system — day side of a temperate planet**: visible continents
   (normal map), blue fresnel halo, specular highlight where star is closest,
   long shadow of ship across planet's face if aligned.
2. **Solar system — looking at the star directly**: strong bloom, god-rays
   visible, ship silhouette rim-lit.
3. **Solar system — panning**: parallax stars move at different rates, nebula
   sprites stay fixed relative to the observer's orientation.
4. **Galaxy scene**: bloom still works, no god-rays, no runtime errors.
5. **Black hole scene**: bloom on accretion disk, no regressions.
6. **Planet surface**: no post-processing artifacts around astronaut; ship
   bloom reads correctly.
7. **FPS**: 60fps stable on dev machine, no dropped frames during scene
   transitions.

---

## Open risks

- **God-rays perf cost.** If it drops below 60fps on any scene, cut it
  (keep bloom) — it's the single most expensive pass. The `setStarPosition`
  hook already makes it disable-able per scene.
- **Atmosphere shader tuning.** Fresnel halos are easy to over-cook into
  "glowing ball" territory. Baseline `intensity = 1.0`; adjust if too strong.
- **Normal map seams at sphere UV poles.** Unavoidable with planar UV
  mapping; typical workaround is to hide the pole behind ring/moon/camera
  framing. Acceptable unless glaring.
- **Exposure tuning.** ACES expects higher light intensities. If the whole
  scene turns dim, raise `toneMappingExposure` before raising light
  intensities — cheaper and less likely to introduce new problems.

---

## Decisions log

| Decision | Chosen | Rejected |
|---|---|---|
| Tonemapping | ACES Filmic | Reinhard / linear |
| Bloom library | `UnrealBloomPass` from Three examples | `postprocessing` npm lib |
| Antialiasing | FXAA pass | TAA, MSAA (MSAA conflicts with render targets) |
| Atmosphere | Fresnel shader on backface sphere | Skybox-style full-screen effect |
| Planet detail | Noise → CanvasTexture (albedo + normal) | Vertex displacement on sphere |
| Starfield depth | 3 parallax instanced layers | Dynamic star generation per-frame |
| God-rays | Custom ShaderPass w/ depth-aware occluder | 3D volumetric light (too expensive) |
| Shadows | Star-only shadow-caster | All lights cast (perf) |

---

## Files touched

**New:**
- `src/engine/postprocessing.js`
- `src/engine/proceduralTextures.js`
- `src/engine/atmosphereShader.js`

**Modified:**
- `src/engine/renderer.js` — tonemapping, color space, shadows
- `src/engine/skybox.js` — 3-layer parallax + nebula sprites
- `src/engine/shipModel.js` — material tuning
- `src/engine/astronautModel.js` — material tuning
- `src/scenes/SolarSystemScene.js` — lighting rig, planet maps, atmosphere,
  `getStarWorldPosition()` helper
- `src/main.js` — render through `postfx.render(dt)` instead of
  `renderer.render`, pipe star position to god-rays

No existing public APIs break. HUD, kernel, ship controller, character
controller, radar are all untouched.
