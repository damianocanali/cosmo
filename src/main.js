// Main entry — wires the kernel, engine, scenes, and UI together.
//
// Flow:
//   constants change → regenerate universe → rebuild active scene
//   scene button     → instantiate new scene → SceneManager.setScene()
//   land request     → swap to PlanetSurfaceScene with chosen planet
//   esc on surface   → return to SolarSystemScene with same constants
//
// Ship & cockpit:
//   - In all space scenes, the ship controller drives the camera with inertia
//     and a cockpit overlay surrounds the view.
//   - Press C to toggle between cockpit (1st person) and external (3rd person).
//   - On a planet surface, the cockpit hides and movement drag is higher
//     (atmospheric drag analog). Actual character disembark is a future step.

import * as THREE from 'three';
import {
  generateUniverse,
  hashString,
  VANILLA_CONSTANTS,
} from './kernel/index.js';

import { createRenderer, createCamera, attachResize } from './engine/renderer.js';
import { ShipController } from './engine/shipController.js';
import { Cockpit } from './engine/cockpit.js';
import { createSkybox } from './engine/skybox.js';
import { SceneManager } from './engine/sceneManager.js';

import { SolarSystemScene } from './scenes/SolarSystemScene.js';
import { GalaxyScene } from './scenes/GalaxyScene.js';
import { BlackHoleScene } from './scenes/BlackHoleScene.js';
import { PlanetSurfaceScene } from './scenes/PlanetSurfaceScene.js';

import { Hud } from './ui/hud.js';
import { Panel } from './ui/panel.js';

// ─── Engine setup ─────────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const renderer = createRenderer(canvas);
const DEFAULT_FOG = new THREE.FogExp2(0x000005, 0.0008);

const threeScene = new THREE.Scene();
threeScene.fog = DEFAULT_FOG;
const camera = createCamera();
attachResize(renderer, camera);

// Ship controller replaces FlyCamera. It exposes the same speedNow() / vel API
// so the HUD keeps working unchanged.
const ship = new ShipController(camera, canvas, threeScene);

// Cockpit is its own Group added to the scene; visible only in space scenes.
const cockpit = new Cockpit();
cockpit.addToScene(threeScene);

// Skybox persists across scenes
const skybox = createSkybox(hashString('GLOBAL_SKYBOX'));
threeScene.add(skybox);

const sceneManager = new SceneManager(threeScene);
const hud = new Hud();

// ─── App state ────────────────────────────────────────────────────
const state = {
  constants: { ...VANILLA_CONSTANTS },
  universe: generateUniverse(VANILLA_CONSTANTS, 'ROOT'),
  universeName: 'Vanilla',
  sceneName: 'solar',
  prevSpaceScene: 'solar',
};

function isSpaceScene(name) {
  return name === 'solar' || name === 'galaxy' || name === 'blackhole';
}

function rebuildActiveScene() {
  threeScene.fog = DEFAULT_FOG;
  const scene = createSceneByName(state.sceneName);
  sceneManager.setScene(scene);

  // Cockpit visibility follows scene type; ship model follows view mode.
  const inSpace = isSpaceScene(state.sceneName);
  cockpit.setVisible(inSpace);

  if (inSpace) {
    // Return to cockpit view by default when entering a space scene
    if (ship.viewMode === 'external' && state.sceneName === 'planet') {
      ship.toggleView();
    }
    ship.shipModel.visible = ship.viewMode === 'external';
  } else {
    // On planet surface: hide cockpit AND the external ship (you're "outside")
    ship.shipModel.visible = false;
  }
}

function createSceneByName(name) {
  const ctx = {
    universe: state.universe,
    camera,
    flyCamera: ship, // name kept for scene compatibility
  };
  switch (name) {
    case 'solar':
      return new SolarSystemScene({
        ...ctx,
        onLandRequest: (planet, starColor) => landOnPlanet(planet, starColor),
      });
    case 'galaxy':     return new GalaxyScene(ctx);
    case 'blackhole':  return new BlackHoleScene(ctx);
    default:
      return new SolarSystemScene(ctx);
  }
}

function landOnPlanet(planet, starColor) {
  state.prevSpaceScene = state.sceneName;
  state.sceneName = 'planet';
  panel.setActiveScene('solar');
  const scene = new PlanetSurfaceScene({
    planet,
    starColor,
    camera,
    flyCamera: ship,
    onLeave: () => {
      state.sceneName = state.prevSpaceScene;
      rebuildActiveScene();
    },
  });
  sceneManager.setScene(scene);
  cockpit.setVisible(false);
  ship.shipModel.visible = false;
}

// ─── UI wiring ────────────────────────────────────────────────────
const panel = new Panel({
  onConstantsChange: (c, name) => {
    state.constants = { ...c };
    state.universeName = name;
    state.universe = generateUniverse(
      state.constants,
      hashString(JSON.stringify(state.constants)).toString()
    );
    if (state.sceneName === 'planet') {
      state.sceneName = state.prevSpaceScene;
    }
    rebuildActiveScene();
  },
  onSceneChange: (name) => {
    state.sceneName = name;
    rebuildActiveScene();
  },
});

// ─── Loop ─────────────────────────────────────────────────────────
let lastT = performance.now();
let totalT = 0;

function loop(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  totalT += dt;

  ship.update(dt);
  sceneManager.update(dt, totalT);
  skybox.rotation.y += dt * 0.001;

  const target = sceneManager.findCrosshairTarget(camera);

  // Update cockpit overlay (runs whether visible or not — cheap)
  if (cockpit.group.visible) {
    cockpit.update(dt, {
      camera,
      speed: ship.speedNow(),
      maxSpeed: ship.maxSpeed * ship.scaleFactor * 3.5, // match the boost cap
      position: camera.position,
      sceneName: state.sceneName,
      target,
      throttle: ship.throttle,
    });
  }

  hud.update({
    camera,
    flyCamera: ship,
    universe: state.universe,
    universeName: state.universeName,
    sceneName: state.sceneName,
    target,
  });

  renderer.render(threeScene, camera);
  requestAnimationFrame(loop);
}

// ─── Boot ─────────────────────────────────────────────────────────
rebuildActiveScene();
setTimeout(() => hud.hideLoading(), 400);
requestAnimationFrame(loop);
