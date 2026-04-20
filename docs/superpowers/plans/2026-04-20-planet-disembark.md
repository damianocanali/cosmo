# Planet Disembark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the player disembark from the ship on a planet surface, walk around under per-planet gravity, and re-enter the ship. First-person shows hands; third-person shows full body. The ship stays parked with a radar beacon.

**Architecture:** A pure kernel function `surfaceGravity(universe, planet)` produces a scalar. A new `CharacterController` owns the camera while on foot, integrating gravity, clamping to terrain height (via existing kernel `sampleTerrainHeight`). `PlanetSurfaceScene` runs a small state machine (`in_ship` / `on_foot`) that delegates input between `ShipController` and `CharacterController`. The ship model stays parked and is drawn as a beacon on a new surface-mode radar chart.

**Tech Stack:** Three.js (engine-only — no new libs), Vitest (kernel tests), Vite (dev server).

**File Structure:**

| File | Change | Responsibility |
|---|---|---|
| `src/kernel/physics.js` | Modify | Add `surfaceGravity`, `BIOME_DENSITY` (pure) |
| `tests/kernel.test.js` | Modify | Add gravity tests |
| `src/engine/astronautModel.js` | Create | `buildAstronautBody`, `buildAstronautHands` — procedural geometry |
| `src/engine/characterController.js` | Create | On-foot camera + WASD/jump + view toggle |
| `src/engine/shipController.js` | Modify | Add `setGrounded`, `setControlsEnabled` |
| `src/scenes/PlanetSurfaceScene.js` | Modify | State machine, disembark/reenter, `getMapData` |
| `src/scenes/SolarSystemScene.js` | Modify | Altitude-gated landing |
| `src/ui/radar.js` | Modify | Optional `shipBeacon` marker, surface-mode chart |
| `src/ui/hud.js` | Modify | Ephemeral prompt line ("F: disembark"/"F: board ship") |
| `src/main.js` | Modify | Wire up F key, prompt, ship-beacon params |
| `index.html` | Modify | Add `#prompt` div, update controls legend |
| `src/ui/styles.css` | Modify | Style `#prompt` |

---

## Task 1: Kernel — Surface Gravity

**Files:**
- Modify: `src/kernel/physics.js`
- Test: `tests/kernel.test.js`

**Formula:** `g = G * BIOME_DENSITY[biome] * planet.radius`

This is `g = G M / r²` with `M = (4/3)π r³ ρ`, simplified to `g ∝ G ρ r`, with the `(4/3)π` absorbed into the density constants so the tuned numbers stay small.

Density values are chosen so vanilla temperate (r ≈ 3) yields `g ≈ 20` game-units/sec² — a light-gravity feel that's still grounded, rather than matching real Earth units.

- [ ] **Step 1: Write the failing test**

Add to `tests/kernel.test.js`, right before the final closing paren of the planet/terrain describe block or in a new describe:

```js
describe('kernel · surface gravity', () => {
  it('surfaceGravity is within a playable range for a vanilla temperate planet', () => {
    const u = generateUniverse(VANILLA_CONSTANTS);
    const planet = { biome: BIOMES.TEMPERATE, radius: 3 };
    const g = surfaceGravity(u, planet);
    expect(g).toBeGreaterThan(10);
    expect(g).toBeLessThan(40);
  });

  it('surfaceGravity scales linearly with G', () => {
    const planet = { biome: BIOMES.TEMPERATE, radius: 3 };
    const u1 = generateUniverse({ ...VANILLA_CONSTANTS, G: 1 });
    const u2 = generateUniverse({ ...VANILLA_CONSTANTS, G: 2 });
    expect(surfaceGravity(u2, planet)).toBeCloseTo(surfaceGravity(u1, planet) * 2, 5);
  });

  it('surfaceGravity scales linearly with planet radius', () => {
    const u = generateUniverse(VANILLA_CONSTANTS);
    const small = { biome: BIOMES.TEMPERATE, radius: 2 };
    const big   = { biome: BIOMES.TEMPERATE, radius: 4 };
    expect(surfaceGravity(u, big)).toBeCloseTo(surfaceGravity(u, small) * 2, 5);
  });

  it('gas giant has lower gravity than temperate at equal radius', () => {
    const u = generateUniverse(VANILLA_CONSTANTS);
    const gg = { biome: BIOMES.GAS_GIANT, radius: 3 };
    const tp = { biome: BIOMES.TEMPERATE, radius: 3 };
    expect(surfaceGravity(u, gg)).toBeLessThan(surfaceGravity(u, tp));
  });

  it('surfaceGravity is deterministic', () => {
    const u = generateUniverse(VANILLA_CONSTANTS);
    const planet = derivePlanet(u, 2);
    expect(surfaceGravity(u, planet)).toBe(surfaceGravity(u, planet));
  });
});
```

Also add `surfaceGravity` to the import line at the top of the test file:

```js
import {
  hashString,
  makeRng,
  stellarPhysics,
  generateUniverse,
  branchUniverse,
  derivePlanet,
  sampleTerrainHeight,
  surfaceGravity,
  VANILLA_CONSTANTS,
  BIOMES,
} from '../src/kernel/index.js';
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm test`
Expected: FAIL — `surfaceGravity is not a function` or similar.

- [ ] **Step 3: Implement `surfaceGravity` in `src/kernel/physics.js`**

Append to `src/kernel/physics.js` (after `starColorFromLifetime`):

```js
// Density (game units) per biome. Tuned so vanilla temperate r≈3 → g≈20.
// Not SI kg/m³ — absorbs (4/3)π and a unit-scale constant so values
// stay small and the physics formula reads cleanly.
export const BIOME_DENSITY = Object.freeze({
  molten:    6.7,
  desert:    5.2,
  temperate: 6.7,
  ocean:     5.0,
  gas_giant: 1.8,
  ice:       2.2,
});

// Surface gravity for a planet in this universe.
//   g = G * ρ * r   (simplified from GM/r² with M ∝ ρr³)
// Output units: game-units per second squared. At vanilla G=1,
// temperate r=3 yields ~20. Tune via BIOME_DENSITY.
export function surfaceGravity(universe, planet) {
  const rho = BIOME_DENSITY[planet.biome] ?? BIOME_DENSITY.temperate;
  return universe.constants.G * rho * planet.radius;
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS. All prior tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/kernel/physics.js tests/kernel.test.js
git commit -m "feat(kernel): surfaceGravity derivation per planet"
```

---

## Task 2: Astronaut procedural models

**Files:**
- Create: `src/engine/astronautModel.js`

No test — procedural geometry is verified by eye, consistent with `shipModel.js`. The model uses the same palette (cyan + amber emissive) to tie it to the ship.

- [ ] **Step 1: Create `src/engine/astronautModel.js`**

```js
// Procedural astronaut geometry — primitives only, flat-shaded.
// Two builders:
//   - buildAstronautBody(): full figure for 3rd-person view
//   - buildAstronautHands(): two gloved hands for 1st-person view (parented to camera)
//
// Palette mirrors the ship (cyan accents, amber visor glow) so the avatar
// reads as "crew of this vessel" rather than a separate prop.

import * as THREE from 'three';

const SUIT = new THREE.MeshStandardMaterial({
  color: 0xc8c0b0, roughness: 0.6, metalness: 0.1, flatShading: true,
});
const SUIT_DARK = new THREE.MeshStandardMaterial({
  color: 0x2a2a30, roughness: 0.7, metalness: 0.2, flatShading: true,
});
const VISOR = new THREE.MeshStandardMaterial({
  color: 0x202830, roughness: 0.15, metalness: 0.9,
  emissive: 0xffb060, emissiveIntensity: 0.3,
});
const ACCENT = new THREE.MeshStandardMaterial({
  color: 0x88d0ff, emissive: 0x66aaff, emissiveIntensity: 1.4, roughness: 0.3,
});

export function buildAstronautBody() {
  const root = new THREE.Group();
  root.name = 'Astronaut';

  // Torso — capsule (cylinder + hemispheres) roughly 0.8 wide × 1.0 tall
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.38, 0.6, 4, 8),
    SUIT
  );
  torso.position.y = 1.0;
  root.add(torso);

  // Helmet — sphere with visor strip
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 16, 12),
    SUIT
  );
  helmet.position.y = 1.7;
  root.add(helmet);

  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.305, 16, 12, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.25),
    VISOR
  );
  visor.position.y = 1.7;
  root.add(visor);

  // Chest accent light
  const chestLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 8),
    ACCENT
  );
  chestLight.position.set(0, 1.2, 0.34);
  root.add(chestLight);

  // Arms — cylinders
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.09, 0.8, 8),
      SUIT
    );
    arm.position.set(side * 0.45, 0.95, 0);
    arm.rotation.z = side * 0.12;
    root.add(arm);

    const glove = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 8, 8),
      SUIT_DARK
    );
    glove.position.set(side * 0.52, 0.55, 0);
    root.add(glove);
  }

  // Legs — cylinders
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.11, 0.9, 8),
      SUIT_DARK
    );
    leg.position.set(side * 0.2, 0.25, 0);
    root.add(leg);
  }

  // Backpack (simple box) — reads as jetpack/life support
  const pack = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.6, 0.22),
    SUIT_DARK
  );
  pack.position.set(0, 1.1, -0.38);
  root.add(pack);

  root.userData.chestLight = chestLight;
  return root;
}

export function buildAstronautHands() {
  const root = new THREE.Group();
  root.name = 'AstronautHands';

  // Hands sit slightly forward and below the camera, in the corners of view.
  // Each hand is a wedge (box) + thumb (small box). No articulated fingers —
  // the silhouette reads as a gloved hand.
  for (const side of [-1, 1]) {
    const hand = new THREE.Group();

    const palm = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.1, 0.22),
      SUIT_DARK
    );
    hand.add(palm);

    const thumb = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.04, 0.12),
      SUIT_DARK
    );
    thumb.position.set(side * 0.1, 0, 0.02);
    hand.add(thumb);

    // Wrist band — cyan accent, like the ship's running lights
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(0.19, 0.11, 0.03),
      ACCENT
    );
    band.position.z = -0.11;
    hand.add(band);

    hand.position.set(side * 0.35, -0.28, -0.55);
    hand.rotation.set(-0.2, side * 0.15, 0);
    root.add(hand);
  }

  return root;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/engine/astronautModel.js
git commit -m "feat(engine): procedural astronaut body and hand models"
```

---

## Task 3: CharacterController

**Files:**
- Create: `src/engine/characterController.js`

Owns the camera when on foot. Integrates horizontal velocity (WASD, camera-yaw-relative, pitch ignored), vertical velocity under gravity, clamps to ground via a caller-provided `groundHeight` function.

- [ ] **Step 1: Create `src/engine/characterController.js`**

```js
// CharacterController — on-foot movement on a planet surface.
// Camera stays at eye height above the character's feet. In 1st person
// the camera has a hands rig parented to it; in 3rd person the camera
// trails behind the body and the hands rig is hidden.
//
// Movement is horizontal-only from WASD (camera yaw-relative, pitch ignored —
// looking up doesn't lift you off the ground). Vertical motion comes from
// gravity + jump impulse.
//
// Jump impulse scales with gravity so the *apparent* hop height stays
// roughly constant regardless of planet: v = sqrt(2*g*hop). Low-g feels
// floaty (longer airtime) but doesn't send you to orbit.

import * as THREE from 'three';
import { buildAstronautBody, buildAstronautHands } from './astronautModel.js';

const EYE_HEIGHT    = 1.7;   // camera y above ground (feet level)
const WALK_SPEED    = 8;     // units/sec
const SPRINT_SPEED  = 16;
const HOP_HEIGHT    = 1.6;   // target apparent jump height in units
const EXTERNAL_OFFSET = new THREE.Vector3(0, 1.2, 3.5);

export class CharacterController {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLCanvasElement} canvas
   * @param {THREE.Scene} threeScene
   */
  constructor(camera, canvas, threeScene, { onViewChange } = {}) {
    this.camera = camera;
    this.canvas = canvas;
    this.threeScene = threeScene;
    this.onViewChange = onViewChange;

    this.cameraYaw = 0;
    this.cameraPitch = 0;
    this.bodyYaw = 0;     // body orientation lerps toward movement direction
    this.velocity = new THREE.Vector3();
    this.position = new THREE.Vector3(); // feet position
    this.grounded = true;

    this.viewMode = 'first'; // 'first' | 'third'
    this.active = false;     // when false, input and update are no-ops

    this.keys = {};
    this.mouseLook = false;

    this.body = buildAstronautBody();
    this.body.visible = false;
    this.threeScene.add(this.body);

    this.hands = buildAstronautHands();
    this.hands.visible = false;
    this.camera.add(this.hands);

    this._bindEvents();
  }

  _bindEvents() {
    this._keydown = (e) => {
      if (!this.active) return;
      this.keys[e.code] = true;
      if (e.code === 'KeyC') this.toggleView();
    };
    this._keyup = (e) => { this.keys[e.code] = false; };
    this._mousedown = () => {
      if (!this.active) return;
      this.mouseLook = true;
      this.canvas.style.cursor = 'none';
    };
    this._mouseup = () => {
      this.mouseLook = false;
      this.canvas.style.cursor = 'crosshair';
    };
    this._mousemove = (e) => {
      if (!this.active || !this.mouseLook) return;
      this.cameraYaw   -= e.movementX * 0.003;
      this.cameraPitch -= e.movementY * 0.003;
      this.cameraPitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.cameraPitch));
    };

    window.addEventListener('keydown',   this._keydown);
    window.addEventListener('keyup',     this._keyup);
    this.canvas.addEventListener('mousedown', this._mousedown);
    window.addEventListener('mouseup',   this._mouseup);
    window.addEventListener('mousemove', this._mousemove);
  }

  dispose() {
    window.removeEventListener('keydown',   this._keydown);
    window.removeEventListener('keyup',     this._keyup);
    this.canvas.removeEventListener('mousedown', this._mousedown);
    window.removeEventListener('mouseup',   this._mouseup);
    window.removeEventListener('mousemove', this._mousemove);
    this.threeScene.remove(this.body);
    this.camera.remove(this.hands);
  }

  setActive(flag) {
    this.active = flag;
    this.body.visible  = flag && this.viewMode === 'third';
    this.hands.visible = flag && this.viewMode === 'first';
    if (!flag) this.keys = {};
  }

  toggleView() {
    this.viewMode = this.viewMode === 'first' ? 'third' : 'first';
    this.body.visible  = this.active && this.viewMode === 'third';
    this.hands.visible = this.active && this.viewMode === 'first';
    if (this.onViewChange) this.onViewChange(this.viewMode);
  }

  /**
   * Place the character at a world position and initial yaw.
   * Used when disembarking the ship.
   */
  enterAt(worldPos, yaw, groundY) {
    this.position.copy(worldPos);
    this.position.y = groundY; // feet on ground
    this.cameraYaw = yaw;
    this.bodyYaw = yaw;
    this.cameraPitch = 0;
    this.velocity.set(0, 0, 0);
    this.grounded = true;
  }

  /**
   * @param {number} dt
   * @param {{ gravity: number, groundHeight: (x:number,z:number)=>number }} env
   */
  update(dt, { gravity, groundHeight }) {
    if (!this.active) return;

    const sprint = (this.keys['ShiftLeft'] || this.keys['ShiftRight']) ? 1 : 0;
    const speed = sprint ? SPRINT_SPEED : WALK_SPEED;

    // Horizontal movement — camera yaw only (pitch ignored so looking up
    // doesn't fly you off the ground).
    const forward = new THREE.Vector3(-Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw));
    const right   = new THREE.Vector3( Math.cos(this.cameraYaw), 0, -Math.sin(this.cameraYaw));

    const wantFwd = (this.keys['KeyW'] ? 1 : 0) - (this.keys['KeyS'] ? 1 : 0);
    const wantRt  = (this.keys['KeyD'] ? 1 : 0) - (this.keys['KeyA'] ? 1 : 0);

    this.velocity.x = forward.x * wantFwd * speed + right.x * wantRt * speed;
    this.velocity.z = forward.z * wantFwd * speed + right.z * wantRt * speed;

    // Jump: impulse sized so apparent hop height stays constant across gravities.
    if (this.keys['Space'] && this.grounded) {
      this.velocity.y = Math.sqrt(2 * gravity * HOP_HEIGHT);
      this.grounded = false;
    }

    // Gravity
    this.velocity.y -= gravity * dt;

    // Integrate position
    this.position.addScaledVector(this.velocity, dt);

    // Ground clamp
    const gy = groundHeight(this.position.x, this.position.z);
    if (this.position.y <= gy) {
      this.position.y = gy;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    // Body yaw lerps toward movement direction when walking
    if (Math.abs(wantFwd) + Math.abs(wantRt) > 0) {
      const moveYaw = Math.atan2(this.velocity.x, this.velocity.z) + Math.PI;
      const k = 1 - Math.exp(-8 * dt);
      this.bodyYaw = lerpAngle(this.bodyYaw, moveYaw, k);
    }

    // Place body mesh
    this.body.position.copy(this.position);
    this.body.rotation.y = this.bodyYaw;

    // Place camera
    const qCam = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(this.cameraPitch, this.cameraYaw, 0, 'YXZ')
    );
    if (this.viewMode === 'first') {
      this.camera.position.set(
        this.position.x,
        this.position.y + EYE_HEIGHT,
        this.position.z
      );
    } else {
      const offset = EXTERNAL_OFFSET.clone().applyQuaternion(qCam);
      this.camera.position.set(
        this.position.x + offset.x,
        this.position.y + EYE_HEIGHT + offset.y,
        this.position.z + offset.z
      );
    }
    this.camera.quaternion.copy(qCam);
  }

  // HUD compatibility — same shape as ShipController
  speedNow() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }
  get vel() { return this.velocity; }
  isKeyDown(code) { return !!this.keys[code]; }
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/engine/characterController.js
git commit -m "feat(engine): character controller with WASD/jump and 1st/3rd person"
```

---

## Task 4: ShipController — grounded and disabled states

**Files:**
- Modify: `src/engine/shipController.js`

When the ship is landed, vertical input is damped and y is clamped to a surface clearance. When the pilot is on foot, all input is ignored.

- [ ] **Step 1: Add fields in `constructor` after `this.viewMode = 'cockpit';`**

Locate line `this.viewMode = 'cockpit';` in `src/engine/shipController.js` and add right after it:

```js
    // Surface state — set by PlanetSurfaceScene when grounded.
    this.grounded = false;
    this.groundClearance = 2.5; // ship sits this far above the ground
    this.groundY = 0;
    this.controlsEnabled = true;
```

- [ ] **Step 2: Add two setter methods right before `update(dt) {`**

```js
  setGrounded(flag, groundY = 0) {
    this.grounded = flag;
    this.groundY = groundY;
    if (flag) {
      this.shipPosition.y = groundY + this.groundClearance;
      this.velocity.set(0, 0, 0);
      this.throttle = 0;
    }
  }

  setControlsEnabled(flag) {
    this.controlsEnabled = flag;
    if (!flag) this.keys = {};
  }

```

- [ ] **Step 3: Gate input at the top of `update(dt)`**

In `src/engine/shipController.js`, find `update(dt) {` — the first line after is a comment. Replace the block that reads the keys to run only when controls are enabled. Add right after the `qCamera` construction and `forward`/`right`/`worldUp` definitions:

Change the block that starts with:
```js
    const boost = (this.keys['ShiftLeft'] || this.keys['ShiftRight']) ? 1 : 0;
```

… and ends with the `.multiplyScalar(this.drag)` line. Wrap the thrust/strafe/vertical portion in a `controlsEnabled` guard. Concretely, modify the input block:

```js
    let boost = 0;
    let wantForward = 0;
    let throttleTarget = 0;
    if (this.controlsEnabled) {
      boost = (this.keys['ShiftLeft'] || this.keys['ShiftRight']) ? 1 : 0;
      wantForward = this.keys['KeyW'] ? 1 : (this.keys['KeyS'] ? -0.6 : 0);
      throttleTarget = Math.abs(wantForward) * (1 + boost * 1.5);
    }
    this.throttle += (throttleTarget - this.throttle) * Math.min(1, dt * 2.5);

    const effectiveAccel = this.accel * this.scaleFactor * (1 + boost * 2.5);

    if (this.controlsEnabled) {
      if (wantForward !== 0) {
        this.velocity.addScaledVector(
          forward,
          Math.sign(wantForward) * this.throttle * effectiveAccel * dt
        );
      }
      if (this.keys['KeyA']) this.velocity.addScaledVector(right, -effectiveAccel * 0.5 * dt);
      if (this.keys['KeyD']) this.velocity.addScaledVector(right,  effectiveAccel * 0.5 * dt);
      if (!this.grounded) {
        if (this.keys['Space']) this.velocity.addScaledVector(worldUp,  effectiveAccel * 0.5 * dt);
        if (this.keys['ControlLeft'] || this.keys['ControlRight']) {
          this.velocity.addScaledVector(worldUp, -effectiveAccel * 0.5 * dt);
        }
      }
    }
```

- [ ] **Step 4: Clamp to ground after integrating position**

Right after `this.shipPosition.addScaledVector(this.velocity, dt);`, insert:

```js
    if (this.grounded) {
      const minY = this.groundY + this.groundClearance;
      if (this.shipPosition.y < minY) {
        this.shipPosition.y = minY;
        if (this.velocity.y < 0) this.velocity.y = 0;
      }
    }
```

- [ ] **Step 5: Run tests and verify nothing regressed**

Run: `npm test`
Expected: PASS. No new test here — this is an engine change verified in-game.

- [ ] **Step 6: Commit**

```bash
git add src/engine/shipController.js
git commit -m "feat(ship): grounded clamp and controls-enabled gate"
```

---

## Task 5: PlanetSurfaceScene — state machine + character integration

**Files:**
- Modify: `src/scenes/PlanetSurfaceScene.js`

Scene now tracks `'in_ship'` (default on landing) and `'on_foot'`. On land, the ship is grounded at the landing spot. Pressing F swaps state. The scene computes `groundHeight` per frame for whichever controller needs it.

- [ ] **Step 1: Update imports and constructor**

At the top of `src/scenes/PlanetSurfaceScene.js`, add to the kernel import:

```js
import {
  sampleTerrainHeight,
  seaLevelFor,
  colorAtHeight,
  atmosphereColor,
  surfaceGravity,
  BIOMES,
} from '../kernel/index.js';
import { buildSurfaceScatter } from '../engine/scatterRenderer.js';
import { CharacterController } from '../engine/characterController.js';
```

Modify the constructor signature to accept `universe` and `characterController` (passed from main.js):

```js
  constructor({ planet, starColor, universe, camera, flyCamera, characterController, onLeave }) {
    this.planet = planet;
    this.starColor = starColor || new THREE.Color(1, 0.95, 0.8);
    this.universe = universe;
    this.camera = camera;
    this.flyCamera = flyCamera;            // ShipController
    this.character = characterController;  // CharacterController
    this.onLeave = onLeave;
    this.escListener = null;
    this.fKeyListener = null;
    this.cloudMesh = null;
    this.atmosphere = null;

    this.mode = 'in_ship';       // 'in_ship' | 'on_foot'
    this.gravity = 0;            // computed in build()
    this.landingSpot = new THREE.Vector3(); // where the ship touched down
    this.landingYaw = 0;
  }
```

- [ ] **Step 2: Replace the "Position camera above terrain" block and add the state-machine listeners**

Find the section in `build(mgr)` that starts with `// ── Position camera above terrain ──` and the `this.escListener` block after it. Replace them with:

```js
    // ── Surface gravity (from the kernel) ──────────────────────────
    this.gravity = surfaceGravity(this.universe, p);

    // ── Land the ship at origin ────────────────────────────────────
    const startX = 0, startZ = 0;
    const groundY = sampleTerrainHeight(p, startX, startZ);
    this.landingSpot.set(startX, groundY, startZ);
    this.landingYaw = 0;

    // Put the ship on the ground, auto-3rd-person so the player sees they've landed.
    this.flyCamera.syncFromCameraPosition(new THREE.Vector3(startX, groundY, startZ));
    this.flyCamera.setScale(0.5);
    this.flyCamera.shipPosition.set(startX, groundY + this.flyCamera.groundClearance, startZ);
    this.flyCamera.setGrounded(true, groundY);
    if (this.flyCamera.viewMode !== 'external') this.flyCamera.toggleView();

    // Ship controls active; character dormant.
    this.flyCamera.setControlsEnabled(true);
    this.character.setActive(false);

    // ── Esc to leave to space ──────────────────────────────────────
    this.escListener = (e) => {
      if (e.code === 'Escape' && this.mode === 'in_ship' && this.onLeave) {
        this.onLeave();
      }
    };
    window.addEventListener('keydown', this.escListener);

    // ── F to disembark / re-enter ──────────────────────────────────
    this.fKeyListener = (e) => {
      if (e.code !== 'KeyF') return;
      if (this.mode === 'in_ship' && this.canDisembark()) this.disembark();
      else if (this.mode === 'on_foot' && this.canReenter()) this.reenter();
    };
    window.addEventListener('keydown', this.fKeyListener);
```

- [ ] **Step 3: Add the state-transition methods and queries**

Add these methods on the class, right before `update(dt)`:

```js
  canDisembark() {
    // Only from the ground, with the ship resting on the landing pad.
    return this.flyCamera.grounded;
  }

  canReenter() {
    const d = this.character.position.distanceTo(this.flyCamera.shipPosition);
    return d < 12; // ~ ship length
  }

  disembark() {
    this.mode = 'on_foot';
    // Drop the astronaut 4 units to the side of the ship, facing it.
    const sideOffset = new THREE.Vector3(4, 0, 0);
    const worldDrop = new THREE.Vector3().copy(this.flyCamera.shipPosition).add(sideOffset);
    const groundY = sampleTerrainHeight(this.planet, worldDrop.x, worldDrop.z);
    const faceShip = Math.atan2(
      this.flyCamera.shipPosition.x - worldDrop.x,
      this.flyCamera.shipPosition.z - worldDrop.z
    );
    this.character.enterAt(worldDrop, faceShip, groundY);
    this.character.setActive(true);
    this.flyCamera.setControlsEnabled(false);
  }

  reenter() {
    this.mode = 'in_ship';
    this.character.setActive(false);
    this.flyCamera.setControlsEnabled(true);
    // Snap camera back to the ship
    if (this.flyCamera.viewMode === 'cockpit') {
      this.camera.position.copy(this.flyCamera.shipPosition);
    }
  }

  getPromptForHud() {
    if (this.mode === 'in_ship' && this.canDisembark()) return 'F · disembark';
    if (this.mode === 'on_foot' && this.canReenter())  return 'F · board ship';
    return null;
  }
```

- [ ] **Step 4: Replace `update(dt)` so it drives whichever controller is active**

Replace the existing `update(dt)` method with:

```js
  update(dt) {
    const p = this.planet;

    if (this.mode === 'in_ship') {
      // Ship is grounded; update groundY under it each frame so hills work.
      const sy = sampleTerrainHeight(p, this.flyCamera.shipPosition.x, this.flyCamera.shipPosition.z);
      this.flyCamera.groundY = sy;
      // Gentle clamp — the setGrounded clamp in ShipController handles the rest.
    } else {
      // On foot — drive the character.
      this.character.update(dt, {
        gravity: this.gravity,
        groundHeight: (x, z) => sampleTerrainHeight(p, x, z),
      });
    }

    if (this.cloudMesh) this.cloudMesh.rotation.y += dt * 0.008;
  }
```

- [ ] **Step 5: Update `dispose`**

Replace the `dispose()` method with:

```js
  dispose() {
    if (this.escListener)  window.removeEventListener('keydown', this.escListener);
    if (this.fKeyListener) window.removeEventListener('keydown', this.fKeyListener);
    // Release ship from grounded state so it flies normally in space again.
    this.flyCamera.setGrounded(false);
    this.flyCamera.setControlsEnabled(true);
    this.character.setActive(false);
  }
```

- [ ] **Step 6: Add `getMapData()` method for the radar (surface chart)**

Add right before `dispose()`:

```js
  getMapData() {
    // Surface chart: local 200-unit radius centered on the character.
    // Draws the ship as a beacon.
    const focus = this.mode === 'on_foot'
      ? this.character.position
      : this.flyCamera.shipPosition;
    return {
      title: 'Surface Chart',
      surface: true,
      focus: { x: focus.x, z: focus.z },
      range: 200,
      shipBeacon: {
        x: this.flyCamera.shipPosition.x,
        z: this.flyCamera.shipPosition.z,
      },
    };
  }
```

- [ ] **Step 7: Run tests**

Run: `npm test`
Expected: PASS (no new kernel tests, existing ones still green).

- [ ] **Step 8: Commit**

```bash
git add src/scenes/PlanetSurfaceScene.js
git commit -m "feat(scene): planet surface disembark/reenter state machine"
```

---

## Task 6: Altitude-gated landing

**Files:**
- Modify: `src/scenes/SolarSystemScene.js`

`L` should only fire when the player is near a planet. Outside the corridor, show a brief "too far" notice via the existing target hint overlay.

- [ ] **Step 1: Replace `tryLand()` in `src/scenes/SolarSystemScene.js`**

Replace the existing `tryLand()` method with:

```js
  tryLand() {
    // Landing corridor: center distance between planet.radius + 1 and + 20.
    // Outside that band, flash a hint.
    const hud = document.getElementById('target');
    const hint = document.getElementById('targetHint');
    const flash = (msg) => {
      if (!hud || !hint) return;
      hint.textContent = msg;
      hud.classList.add('show');
      clearTimeout(this._flashT);
      this._flashT = setTimeout(() => { hint.textContent = ''; }, 900);
    };

    // Find the closest planet first.
    let best = null;
    let bestDist = Infinity;
    for (const p of this.planets) {
      const d = this.camera.position.distanceTo(p.mesh.position);
      if (d < bestDist) { bestDist = d; best = p; }
    }
    if (!best) return;

    const r = best.planetData.radius;
    const surfaceDist = bestDist - r;

    if (best.planetData.biome === 'gas_giant') {
      flash('atmosphere too deep — cannot land');
      return;
    }
    if (surfaceDist > 20) {
      flash('too far — approach the planet');
      return;
    }
    if (surfaceDist < 1) {
      flash('too close — pull up');
      return;
    }

    if (this.onLandRequest) {
      this.onLandRequest(best.planetData, this.starColor);
    }
  }
```

- [ ] **Step 2: Run tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/scenes/SolarSystemScene.js
git commit -m "feat(solar): altitude-gated landing with corridor feedback"
```

---

## Task 7: Radar — ship beacon + surface chart

**Files:**
- Modify: `src/ui/radar.js`
- Modify: `src/main.js` (caller)

Surface mode needs a different chart: no star/planets, just the character at origin and the ship as a beacon, with a local range.

- [ ] **Step 1: Split draw into `drawSystem` / `drawSurface` in `src/ui/radar.js`**

Replace the existing `draw({ mapData, ship })` method with:

```js
  draw({ mapData, ship }) {
    if (!mapData) {
      this.setVisible(false);
      return;
    }
    this.setVisible(true);
    if (mapData.title) this.title.textContent = mapData.title;

    if (mapData.surface) {
      this._drawSurface(mapData, ship);
    } else {
      this._drawSystem(mapData, ship);
    }
  }

  _drawSystem(mapData, ship) {
    const { ctx, size } = this;
    const cx = size / 2, cy = size / 2;
    ctx.clearRect(0, 0, size, size);

    const { star, planets = [] } = mapData;

    let maxR = 40;
    for (const p of planets) maxR = Math.max(maxR, dist2d(star.pos, p.pos));
    maxR *= 1.3;
    const halfSize = size / 2 - 14;
    const scale = halfSize / maxR;

    ctx.save();
    ctx.translate(cx, cy);

    // Orbit rings
    ctx.strokeStyle = 'rgba(200, 184, 144, 0.14)';
    ctx.lineWidth = 1;
    for (const p of planets) {
      const r = dist2d(star.pos, p.pos);
      ctx.beginPath();
      ctx.arc(0, 0, r * scale, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Star glow + core
    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 18);
    glow.addColorStop(0, 'rgba(255, 220, 150, 0.55)');
    glow.addColorStop(1, 'rgba(255, 220, 150, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffe0a0';
    ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, Math.PI * 2); ctx.fill();

    // Planet pips
    for (const p of planets) {
      const px = (p.pos.x - star.pos.x) * scale;
      const pz = (p.pos.z - star.pos.z) * scale;
      ctx.fillStyle = BIOME_COLORS[p.biome] || '#c8b890';
      ctx.beginPath(); ctx.arc(px, pz, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(10, 12, 18, 0.8)';
      ctx.lineWidth = 0.8; ctx.stroke();
    }

    // Ship triangle (with edge-clamp)
    let sx = (ship.pos.x - star.pos.x) * scale;
    let sz = (ship.pos.z - star.pos.z) * scale;
    const shipDist = Math.sqrt(sx * sx + sz * sz);
    const clamped = shipDist > halfSize - 4;
    if (clamped) {
      const k = (halfSize - 4) / shipDist;
      sx *= k; sz *= k;
    }
    ctx.save();
    ctx.translate(sx, sz);
    ctx.rotate(-ship.heading);
    ctx.fillStyle = clamped ? '#ffaa44' : '#e8dfc8';
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(-4.5, 5); ctx.lineTo(4.5, 5);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#1a1612'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();

    ctx.restore();
    this.scaleEl.textContent = `${maxR.toFixed(0)} u`;
  }

  _drawSurface(mapData, ship) {
    const { ctx, size } = this;
    const cx = size / 2, cy = size / 2;
    ctx.clearRect(0, 0, size, size);

    const { focus, range, shipBeacon } = mapData;
    const halfSize = size / 2 - 14;
    const scale = halfSize / range;

    ctx.save();
    ctx.translate(cx, cy);

    // Compass ring
    ctx.strokeStyle = 'rgba(200, 184, 144, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, halfSize, 0, Math.PI * 2);
    ctx.stroke();

    // Ship beacon — amber cross, centered at its world position relative to focus.
    if (shipBeacon) {
      let bx = (shipBeacon.x - focus.x) * scale;
      let bz = (shipBeacon.z - focus.z) * scale;
      const d = Math.sqrt(bx * bx + bz * bz);
      const clamped = d > halfSize - 6;
      if (clamped) {
        const k = (halfSize - 6) / d;
        bx *= k; bz *= k;
      }
      ctx.strokeStyle = '#ffaa44';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx - 6, bz); ctx.lineTo(bx + 6, bz);
      ctx.moveTo(bx, bz - 6); ctx.lineTo(bx, bz + 6);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 170, 68, 0.35)';
      ctx.beginPath(); ctx.arc(bx, bz, 4, 0, Math.PI * 2); ctx.fill();
    }

    // Player arrow — always at center, rotated with heading
    ctx.save();
    ctx.rotate(-ship.heading);
    ctx.fillStyle = '#e8dfc8';
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(-4.5, 5); ctx.lineTo(4.5, 5);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#1a1612'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();

    ctx.restore();
    this.scaleEl.textContent = `${range.toFixed(0)} u`;
  }
```

Note: the `dist2d` helper at the bottom of the file is still used by `_drawSystem` — leave it.

- [ ] **Step 2: Commit**

```bash
git add src/ui/radar.js
git commit -m "feat(radar): surface chart mode with ship beacon"
```

---

## Task 8: HUD prompt element

**Files:**
- Modify: `index.html`
- Modify: `src/ui/styles.css`
- Modify: `src/ui/hud.js`

Add a small centered prompt line that displays "F · disembark" or "F · board ship" when applicable.

- [ ] **Step 1: Add the prompt div in `index.html`**

Right after the `<div id="target" ...>` closing `</div>` (the target cluster ends after `<div class="hint" id="targetHint"></div></div></div>`), before the `#physics` div, insert:

```html
  <div class="hud" id="prompt"></div>
```

Also update the `#controls` legend to include F and distinguish space/surface. Replace the existing `#controls` div contents with:

```html
  <div class="hud" id="controls">
    <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Move</div>
    <div><kbd>Space</kbd> Up/Jump · <kbd>Ctrl</kbd> Down</div>
    <div>Mouse drag · Look · <kbd>Shift</kbd> Boost/Sprint</div>
    <div><kbd>C</kbd> View · <kbd>L</kbd> Land · <kbd>F</kbd> Board/Leave ship</div>
    <div><kbd>Tab</kbd> Panel · <kbd>Esc</kbd> Lift off</div>
  </div>
```

- [ ] **Step 2: Add styling in `src/ui/styles.css`**

Append at end of `src/ui/styles.css`:

```css
#prompt {
  position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
  font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.25em;
  text-transform: uppercase; color: #c8b890;
  padding: 6px 14px; border: 1px solid rgba(200, 184, 144, 0.25);
  background: rgba(10, 8, 6, 0.65); backdrop-filter: blur(6px);
  opacity: 0; transition: opacity 0.25s; z-index: 12;
}
#prompt.show { opacity: 1; }
```

- [ ] **Step 3: Wire the prompt into `src/ui/hud.js`**

In the `Hud` constructor's `this.els = { ... }` object, add:

```js
      prompt: document.getElementById('prompt'),
```

In the `update({ ... })` signature, add `prompt`:

```js
  update({ camera, flyCamera, universe, universeName, sceneName, target, prompt }) {
```

At the end of `update(...)` (after the `target` branch), add:

```js
    if (prompt) {
      this.els.prompt.textContent = prompt;
      this.els.prompt.classList.add('show');
    } else {
      this.els.prompt.classList.remove('show');
    }
```

- [ ] **Step 4: Commit**

```bash
git add index.html src/ui/styles.css src/ui/hud.js
git commit -m "feat(ui): board/leave prompt and updated controls legend"
```

---

## Task 9: Wire up main.js — create character, pass to scene, pipe prompt

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: Import and construct the CharacterController after the ship**

In `src/main.js`, add after `import { ShipController } ...`:

```js
import { CharacterController } from './engine/characterController.js';
```

After the `const ship = new ShipController(...)` block, add:

```js
const character = new CharacterController(camera, canvas, threeScene);
```

- [ ] **Step 2: Pass `universe` and `characterController` to `landOnPlanet`**

Find `function landOnPlanet(planet, starColor) {` and replace the `new PlanetSurfaceScene({ ... })` construction with:

```js
  const scene = new PlanetSurfaceScene({
    planet,
    starColor,
    universe: state.universe,
    camera,
    flyCamera: ship,
    characterController: character,
    onLeave: () => {
      state.sceneName = state.prevSpaceScene;
      rebuildActiveScene();
    },
  });
```

- [ ] **Step 3: In `rebuildActiveScene`, deactivate character on scene switch**

After the block that sets `cockpit.setVisible` and `ship.shipModel.visible`, add:

```js
  character.setActive(false);
```

- [ ] **Step 4: Update the main loop to drive the right controller and collect the prompt**

Replace the existing `ship.update(dt)` call in `loop(t)` with:

```js
  // Drive whichever controller is active. PlanetSurfaceScene.update() handles
  // character updates when on foot; ship still updates in cockpit for animation
  // state (flame flicker etc) even when grounded.
  ship.update(dt);
  sceneManager.update(dt, totalT);
```

Then update the `hud.update({ ... })` call to include the prompt and speed source:

```js
  const activeScene = sceneManager.activeScene;
  const promptText = activeScene?.getPromptForHud?.() ?? null;
  const onFoot = character.active;

  hud.update({
    camera,
    flyCamera: onFoot ? character : ship,
    universe: state.universe,
    universeName: state.universeName,
    sceneName: state.sceneName,
    target,
    prompt: promptText,
  });
```

And update the radar block to read from whichever is active:

```js
  const mapData = sceneManager.activeScene?.getMapData?.() ?? null;
  const radarShip = onFoot
    ? { pos: character.position, heading: character.cameraYaw }
    : { pos: ship.shipPosition, heading: ship.heading };
  radar.draw({ mapData, ship: radarShip });
```

- [ ] **Step 5: Hide cockpit on foot**

In the existing `onViewChange` callback given to `ShipController`:

```js
const ship = new ShipController(camera, canvas, threeScene, {
  onViewChange: (mode) => {
    const inSpace = isSpaceScene(state.sceneName);
    const onFoot = character.active;
    cockpit.setVisible(inSpace && mode === 'cockpit' && !onFoot);
  },
});
```

And in `rebuildActiveScene`, also account for on-foot:

```js
  const inSpace = isSpaceScene(state.sceneName);
  const onFoot = character.active;
  cockpit.setVisible(inSpace && ship.viewMode === 'cockpit' && !onFoot);
  ship.shipModel.visible = (inSpace && ship.viewMode === 'external') || state.sceneName === 'planet';
  character.setActive(false); // any scene change exits on-foot state
```

Note: on the planet, `ship.shipModel.visible = true` always (you want to see the parked ship). In space it follows view mode.

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: PASS (no new tests, all existing still green).

- [ ] **Step 7: Commit**

```bash
git add src/main.js
git commit -m "feat(main): wire character controller, prompt, surface radar"
```

---

## Task 10: Manual verification

Not a test — a checklist to walk through in-browser with `npm run dev`.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Open the URL (usually `http://localhost:5173`).

- [ ] **Step 2: Land sequence**

- Fly toward a planet. Before you're close, press `L` — expect the target hint to flash "too far — approach the planet".
- Get closer, press `L`. Expect to arrive on the surface in external/3rd-person view. Ship should be visible on the ground.
- Press `L` on a gas giant — expect "atmosphere too deep".

- [ ] **Step 3: Disembark**

- HUD shows "F · disembark". Press `F`. Camera snaps to astronaut at eye height next to the ship.
- Press `C` — switch between 1st person (hands visible in corners) and 3rd person (full body visible).
- Walk with WASD. Space jumps. Shift sprints. Gravity feels lighter on ice planets, heavier on molten.
- Look at radar: player arrow at center, amber cross beacon for ship. Walk far from ship → beacon stays (clamps to edge when out of range).

- [ ] **Step 4: Re-enter**

- Walk back to within ~12u of the ship. HUD shows "F · board ship". Press `F`.
- Camera returns to the ship. Ship flies again (but is still grounded — press Space to lift or just WASD).

- [ ] **Step 5: Escape to space**

- In ship, on the surface, press `Esc`. Returns to whatever space scene you came from.
- In ship, back in space: scroll/fly normally, no residual ground clamp.

---

## Self-Review Checklist

**Spec coverage:**

- ✅ State machine SPACE → LANDING → SURFACE_IN_SHIP → SURFACE_ON_FOOT — Task 5 / Task 6 (simplified: no explicit LANDING animation; corridor check + immediate scene swap per spec's "Kept simple" note)
- ✅ Controls table (W/A/S/D/Space/Ctrl/Shift/Mouse/C/L/F/Esc) — Tasks 3, 4, 5, 6, 8
- ✅ Altitude-gated landing with HUD feedback — Task 6
- ✅ Surface re-entry within `shipRadius * 2` — Task 5 (`canReenter` uses 12u ≈ ship length)
- ✅ `surfaceGravity` in kernel, deterministic, biome density table — Task 1
- ✅ CharacterController with 1st/3rd toggle, camera-yaw-relative motion, gravity integration, ground clamp, jump-height preservation across g — Task 3
- ✅ ShipController gains setGrounded / setControlsEnabled — Task 4
- ✅ Ship stays parked + radar beacon — Task 5 + Task 7
- ✅ Procedural astronaut body + hands — Task 2
- ✅ Gas-giant landing rejected — Task 6
- ✅ Kernel tests covering gravity — Task 1

**Placeholder scan:** No "TBD", no "add validation", no "similar to task N".

**Type / name consistency:**
- `CharacterController.position` (Vector3, feet) — used in Task 5 disembark/reenter and Task 9 radar
- `ShipController.shipPosition` — referenced consistently in Tasks 5, 9
- `ShipController.setGrounded(flag, groundY)` — Task 4 defines, Task 5 calls
- `ShipController.groundClearance` — Task 4 defines, Task 5 reads
- `ShipController.heading` (getter) — pre-existing, used in Task 9
- `CharacterController.cameraYaw` — Task 3 defines, Task 9 reads
- `PlanetSurfaceScene.getPromptForHud()` — Task 5 defines, Task 9 reads
- `PlanetSurfaceScene.getMapData()` with `surface: true, focus, range, shipBeacon` — Task 5 produces, Task 7 consumes
- `BIOMES.GAS_GIANT` — string `'gas_giant'`, used in Task 6 (via `'gas_giant'` literal) and Task 1 density table

All consistent.

**Scope:** Single focused feature. Does not bleed into NPCs, inventory, or day/night — all deferred per spec.
