# Planet Disembark — Design

Date: 2026-04-20
Status: Approved, ready for implementation plan

## Summary

Let the player leave the ship on a planet's surface and walk around with gravity
that varies per planet. First-person shows the astronaut's hands (for future
interaction with objects, people, aliens). Third-person shows the full body.
The ship stays parked where you landed and appears as a beacon on the radar
so you can walk back and re-enter.

## Goals

- Disembark → walk → re-enter loop that feels complete by itself.
- Surface gravity is deterministic per planet and derived in the kernel.
- No new asset pipeline — procedural geometry only.
- Aesthetic unchanged (observatory logbook + clean sci-fi).
- All kernel physics covered by tests.

## Non-goals (deliberately deferred)

- Object pickup, NPCs, aliens, dialogue — the hands are placeholders that
  animate on interact but interact with nothing yet.
- Inventory, suit damage, oxygen, day/night cycle.
- Vehicle dismount on asteroids, moons, or gas giants (gas giants remain
  unlandable; moons are visual only for now).

---

## User flow

```
In orbit  ─ press L near planet ─►  Land sequence (ship tilts, altitude drops)
  │                                  │
  │  (altitude check: within         ▼
  │   landing corridor)             On surface, in cockpit (3rd-person auto)
  │                                  │
  │                                  │ press F
  │                                  ▼
  │                               On foot, near parked ship
  │                                  │
  │  press Esc (lift off)            │ walk, look around
  │  or walk to ship + F             │
  │                                  │ press F near ship
  └──────────────────────────────────┘
```

States: `SPACE` → `LANDING` → `SURFACE_IN_SHIP` → `SURFACE_ON_FOOT` → (back up
the chain).

### Controls

| Key | In ship (space) | In ship (surface) | On foot |
|---|---|---|---|
| W/A/S/D | Thrust | Drive/hover | Walk |
| Space | Up | Up | Jump |
| Ctrl | Down | Down | Crouch |
| Shift | Boost | Boost | Sprint |
| Mouse | Look | Look | Look |
| C | Toggle 1st/3rd | Toggle 1st/3rd | Toggle 1st/3rd |
| L | Land (when close to a planet) | — | — |
| F | — | Disembark (if grounded) | Re-enter (if near ship) |
| Esc | — | Lift off → space | Lift off if inside ship, else unused |

### Altitude-gated landing

Current behavior: `L` immediately teleports to `PlanetSurfaceScene`.

New behavior:
- `L` is only valid when the camera's distance to the planet's surface is
  within a landing corridor (`planet.radius * 1.05 .. planet.radius * 1.5`).
- Outside the corridor, the HUD prints "too far" or "too close" briefly.
- Inside, we commit to the land sequence: the ship pitches toward the
  surface normal and descends for ~1.5s before the scene swap, so you see
  yourself arrive. Kept simple — just an interpolated transform, not a
  physics-driven landing.

### Surface re-entry

- When on foot, the ship's position is shown on the radar as a distinct
  beacon (amber cross, larger than planet pips).
- Walk within `shipRadius * 2` (≈ 12 units) of the ship, prompt appears,
  `F` re-enters.
- On re-entry, camera reattaches to the ship's anchor and control returns
  to `ShipController`.

---

## Architecture

### Kernel additions (pure, no Three)

`src/kernel/physics.js`:
- `surfaceGravity(universe, planet) → number`
  - Formula: `g = G * (planet.mass / planet.radius²)` where
    `planet.mass = (4/3) π r³ ρ`, with `ρ` derived from biome.
  - Simplifies to `g = (4/3) π G ρ r`.
  - Density table by biome (kg/m³ in made-up units, kept tight):
    - molten: 5.5, desert: 3.9, temperate: 5.5, ocean: 4.2,
      gas_giant: 1.3 (unused — unlandable), ice: 1.5.
  - Output is in the same unit system as existing physics (dimensionless
    "g-units" where Earth-equivalent ≈ 1 at vanilla constants). We verify
    this with a vanilla-constants assertion in tests.

`src/kernel/planets.js`:
- `derivePlanet` already returns `radius`, `biome`. No schema change — the
  gravity function is a pure derivation, called on demand.

### Engine — new module

`src/engine/characterController.js`:
- Owns camera + first-person hand model + third-person body model.
- `update(dt, { gravity, groundHeight })`:
  - Horizontal velocity from WASD (camera-yaw-relative, pitch ignored).
  - Vertical velocity integrates under `gravity`; jump sets a positive
    impulse (scaled to produce consistent ~1.2m apparent hop regardless
    of `gravity`, so low-g planets feel floaty but don't break).
  - Ground clamp: if `y < groundHeight`, snap and zero vertical velocity.
  - Head bob in 1st person; arm sway in 1st person; full-body animation
    cycle driven by horizontal speed in 3rd person.
- `setViewMode('first' | 'third')`.
- `enterAt(position, yaw)` / `dispose()`.

### Engine — ship state

`ShipController` gets:
- `setGrounded(flag)` — when true, damps vertical input and clamps `y` to
  `groundHeight + shipClearance`.
- `setControlsEnabled(flag)` — when false, ignores input but still
  animates (used while the character is out of the ship).

### Scene — PlanetSurfaceScene

Gains an internal state machine:
- `'in_ship'` (default on landing) — ship is active, character hidden.
- `'on_foot'` — ship is idle, character is active.
- `disembark()`: puts the character at `ship.shipPosition + sideOffset`,
  disables ship controls, enables character controller.
- `reenter()`: inverse. Only callable when character is within re-entry
  radius.

Surface gravity is read once on scene build via
`surfaceGravity(universe, planet)` and passed to the character controller
every frame. Ship drag on surface is amplified (atmospheric analog) — a
single scalar, not derived from atmosphere composition.

### UI

- `Radar`: gains an optional `shipBeacon` marker drawn when provided.
- `Cockpit`: already hidden in 3rd-person / on-foot — no change.
- HUD: adds a small prompt line when `F` is actionable ("disembark" /
  "board ship").
- Landing corridor feedback: reuses HUD `#target` ephemeral line, not a
  new element.

---

## Character models (procedural)

Same spirit as `shipModel.js` — primitives only, flat-shaded, tight palette.

- **Body** (3rd person): Capsule torso + sphere helmet with visor decal +
  two cylinder arms + two cylinder legs. Group named `Astronaut`. Scales
  so the helmet top sits at ~1.8 units — reads as "human" next to the
  ship's 12-unit length.
- **Hands** (1st person): two low-poly gloved hand groups parented to the
  camera with slight sway driven by movement speed. No fingers
  articulated — just a wedge + thumb. Emissive wrist-band matches the
  ship's cyan/amber accents.

Both live in `src/engine/astronautModel.js` with a `buildAstronautBody()`
and `buildAstronautHands()` export. No textures — all vertex colors /
materials.

---

## Data flow

```
generateUniverse  ─►  universe (deterministic)
                           │
planet (derived)  ─► surfaceGravity(universe, planet) ─► g
                                                         │
PlanetSurfaceScene.build() ──────────────────────────────┤
                                                         ▼
             CharacterController.update(dt, { gravity: g, groundHeight })
                           │
                           └─► camera.position / orientation
```

The kernel remains pure: `surfaceGravity` takes data and returns a number.
Three lives only in `characterController.js` and `astronautModel.js`.

---

## Error handling

- Landing attempted outside corridor: HUD flash, no scene swap. No error
  state, not fatal.
- Disembark attempted mid-landing or mid-liftoff: ignored (state machine
  guards).
- Re-entry attempted out of range: ignored, no message (prompt already
  absent).
- Gas-giant `L` press: explicit "atmosphere too deep" flash, no land.
- If the planet's `groundHeight` cannot be sampled (shouldn't happen, but
  if the terrain lookup fails), character controller falls back to y=0 —
  not silent, logs once.

---

## Testing

### Kernel tests (required — kernel discipline)

`tests/kernel.test.js` adds:
- `surfaceGravity` returns Earth-ish value (~0.9..1.1) for a
  temperate planet with vanilla constants and unit radius.
- `surfaceGravity` scales with `G`: doubling `G` doubles `g`.
- `surfaceGravity` scales with `radius`: doubling radius doubles `g` at
  constant density.
- Gas-giant biome returns low gravity (< temperate) — sanity check on the
  density table.
- Deterministic: same universe, same planet index → same `g`.

### Engine / UI (manual)

Not unit-tested — verified in-game:
- Land on a molten planet → fall fast, short jumps.
- Land on an ice planet → drift down, long jumps.
- Walk away from ship → beacon visible on radar, reappears when walking
  back.
- Toggle C on foot → camera snaps between hands-view and body-view.

---

## Open risks

- **Ship beacon on radar in surface scene**: the radar currently draws a
  system-level map. On surface, we need a different zoom/scale. Simplest
  fix: radar's `getMapData()` returns surface data (local terrain-centered)
  when on a planet, and the radar scales accordingly. Already half-built —
  `SolarSystemScene.getMapData` exists; `PlanetSurfaceScene` will add its
  own.
- **Character controller vs. terrain height**: existing surface uses a
  multi-octave displacement. We sample `groundHeight` by reading the
  terrain's underlying height function (already a pure JS function —
  `terrainHeight(x, z)` — extracted during refactor).
- **Aesthetic drift**: the astronaut must look like it belongs to the
  ship. Shared emissive palette (cyan + amber) enforces this. If it looks
  toy-like, add a faint visor reflection and slight hull segmentation
  before iterating.

---

## Decisions log

| Decision | Chosen | Rejected |
|---|---|---|
| Disembark trigger | Manual (F) | Auto-on-land |
| Camera modes | Both (hands in 1st, body in 3rd) | 1st only |
| Gravity source | Per-planet kernel derivation | Fixed / biome LUT |
| Landing gate | Altitude corridor | Anywhere / instant |
| Ship on foot | Parked + radar beacon | Follows / disappears |
