# Cosmogony

> An interactive multiverse explorer. Six physics constants → an entire procedural cosmos you can fly through.

A single tweak to gravity changes how stars burn, how planets form, how galaxies cluster, and what colors the sky on a planet's surface turns out to be. The whole thing is driven by a small, pure kernel that derives a universe's properties from its constants — and the rendering layer just visualizes what the kernel says.

## Quick start

```bash
npm install
npm run dev    # opens at http://localhost:5173
npm test       # run the kernel test suite
npm run build  # production bundle in dist/
```

## Controls

| Key | Action |
|---|---|
| `W` `A` `S` `D` | Move |
| `Space` / `Ctrl` | Up / Down |
| Mouse drag | Look around |
| `Shift` | Boost |
| `Tab` | Toggle constants panel |
| `L` | Land on planet (when in solar system, near a planet) |
| `Esc` | Leave planet surface, return to space |

## Architecture

The codebase is layered so the **kernel never touches Three.js**. This means the kernel is portable — you can lift it into a Java backend, a Python data analysis pipeline, or a different rendering engine without changing a line.

```
src/
├── kernel/                 ← pure functions, no DOM, no Three.js
│   ├── rng.js              ← deterministic seeded RNG (mulberry32)
│   ├── physics.js          ← (constants) → stellar physics
│   ├── branching.js        ← multiverse tree (parent + tweak → child)
│   ├── planets.js          ← (universe, orbit slot) → planet properties
│   ├── terrain.js          ← (planet, x, z) → height + biome color
│   └── index.js            ← public barrel export
│
├── engine/                 ← shared Three.js infrastructure
│   ├── renderer.js         ← WebGL setup, glow texture cache
│   ├── flyCamera.js        ← input handling + 6DOF flight
│   ├── skybox.js           ← deep background starfield
│   └── sceneManager.js     ← active scene lifecycle + named-object targeting
│
├── scenes/                 ← each scene is an isolated module
│   ├── SolarSystemScene.js ← star + planets, supports landing
│   ├── GalaxyScene.js      ← procedural spiral
│   ├── BlackHoleScene.js   ← event horizon + accretion disk
│   └── PlanetSurfaceScene.js ← procedural terrain + atmosphere shader
│
├── ui/                     ← DOM-side: panel, HUD, styles
│   ├── styles.css
│   ├── hud.js
│   └── panel.js
│
└── main.js                 ← orchestrator
```

### The kernel contract

Every scene, when built, takes the same inputs:

```js
{ universe, camera, flyCamera, ...sceneSpecific }
```

…and exposes:

```js
class Scene {
  build(sceneManager) { /* add objects via sceneManager.track(...) */ }
  update(dt, totalTime) { /* per-frame */ }
  dispose() { /* optional: cleanup listeners */ }
}
```

The `SceneManager` handles disposal of all tracked objects on scene swap. This is what makes the constant sliders feel snappy — changing a constant rebuilds the whole scene from scratch in a single frame, with no leaks.

### Determinism

Every random thing in this project comes from `makeRng(seed)`. The seed for any object is derived from a known string (the universe ID, the chunk coordinates, the orbit slot). This means:

- Same constants → same universe → same planets → same terrain
- You can hand someone a string of six numbers and they'll see exactly the same cosmos
- The kernel test suite asserts referential transparency

## Adding a new scene

1. Create `src/scenes/MyScene.js` with the scene contract above
2. Import it in `src/main.js` and add to `createSceneByName`
3. Add a button to `index.html` with `data-scene="myScene"`

That's it. The panel and lifecycle work automatically.

## Adding a new physics consequence

Open `src/kernel/physics.js`. Add a derived property:

```js
return {
  // ...existing
  myNewProperty: someFunctionOf(c),
};
```

Add a test in `tests/kernel.test.js`. Then any scene that wants to react to the new property can read `universe.stellar.myNewProperty`. The kernel changes don't require any rendering changes.

## What's deliberately not here yet

These are the natural next steps, each independently buildable:

- **Persistence**: save the universe tree to `localStorage` so sessions survive refresh
- **Multiverse tree UI**: the branching tree from earlier prototypes, integrated as a navigable map
- **Better atmospherics**: real Rayleigh scattering shader, sunset colors, clouds
- **Surface details**: trees, rocks, water normal maps, ambient occlusion
- **Sound**: low ambient drone per scene, harmonic shifts when constants change
- **Walking avatar**: replace fly camera with a character controller on the planet surface
- **Galaxy clustering**: zoom out from a galaxy to see a local group, then a supercluster

## License

Yours to do whatever with.
