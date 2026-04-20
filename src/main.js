// Main entry — wires the kernel, engine, scenes, and UI together.
//
// Flow:
//   constants change → regenerate universe → rebuild active scene
//   scene button     → instantiate new scene → SceneManager.setScene()
//   land request     → swap to PlanetSurfaceScene with chosen planet
//   esc on surface   → return to SolarSystemScene with same constants

import * as THREE from 'three';
import {
  generateUniverse,
  hashString,
  VANILLA_CONSTANTS,
} from './kernel/index.js';

import { createRenderer, createCamera, attachResize } from './engine/renderer.js';
import { FlyCamera } from './engine/flyCamera.js';
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
const threeScene = new THREE.Scene();
threeScene.fog = new THREE.FogExp2(0x000005, 0.0008);
const camera = createCamera();
attachResize(renderer, camera);

const flyCamera = new FlyCamera(camera, canvas);

// Skybox lives outside the scene manager — it persists across scenes
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
  prevSpaceScene: 'solar',  // remembered when on planet surface
};

function rebuildActiveScene() {
  const scene = createSceneByName(state.sceneName);
  sceneManager.setScene(scene);
}

function createSceneByName(name) {
  const ctx = {
    universe: state.universe,
    camera,
    flyCamera,
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
  panel.setActiveScene('solar'); // panel still shows solar selected; planet is sub-state
  const scene = new PlanetSurfaceScene({
    planet,
    starColor,
    camera,
    flyCamera,
    onLeave: () => {
      state.sceneName = state.prevSpaceScene;
      rebuildActiveScene();
    },
  });
  sceneManager.setScene(scene);
}

// ─── UI wiring ────────────────────────────────────────────────────
const panel = new Panel({
  onConstantsChange: (c, name) => {
    state.constants = { ...c };
    state.universeName = name;
    state.universe = generateUniverse(state.constants, hashString(JSON.stringify(state.constants)).toString());
    // Surface scenes are tied to a specific planet; changing constants
    // here means the planet derivation would change → return to space.
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

  flyCamera.update(dt);
  sceneManager.update(dt, totalT);
  skybox.rotation.y += dt * 0.001;

  const target = sceneManager.findCrosshairTarget(camera);

  hud.update({
    camera,
    flyCamera,
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
