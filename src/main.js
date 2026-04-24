// Main entry — wires the kernel, engine, scenes, and UI together.
//
// Flow:
//   constants change → regenerate universe → rebuild active scene
//   scene button     → instantiate new scene → SceneManager.setScene()
//   land request     → swap to PlanetSurfaceScene with chosen planet
//   esc on surface   → return to SolarSystemScene with same constants
//
// Ship & character:
//   - In space scenes, ShipController drives the camera (cockpit or external).
//   - On a planet, PlanetSurfaceScene runs a small state machine and swaps
//     input ownership between ShipController (parked, for liftoff) and
//     CharacterController (on-foot, WASD + gravity-aware jump).
//   - Press C to toggle 1st/3rd person in whichever controller is active.
//   - Press F on the surface to disembark / re-enter the ship.

import * as THREE from 'three';
import {
  generateUniverse,
  hashString,
  VANILLA_CONSTANTS,
} from './kernel/index.js';

import { createRenderer, createCamera, attachResize } from './engine/renderer.js';
import { ShipController } from './engine/shipController.js';
import { PostFX } from './engine/postprocessing.js';
import { CharacterController } from './engine/characterController.js';
import { Cockpit } from './engine/cockpit.js';
import { createSkybox } from './engine/skybox.js';
import { SceneManager } from './engine/sceneManager.js';

import { SolarSystemScene } from './scenes/SolarSystemScene.js';
import { GalaxyScene } from './scenes/GalaxyScene.js';
import { BlackHoleScene } from './scenes/BlackHoleScene.js';
import { PlanetSurfaceScene } from './scenes/PlanetSurfaceScene.js';

import { Hud } from './ui/hud.js';
import { Panel } from './ui/panel.js';
import { Radar } from './ui/radar.js';

// ─── Engine setup ─────────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const renderer = createRenderer(canvas);
const DEFAULT_FOG = new THREE.FogExp2(0x000005, 0.0008);

const threeScene = new THREE.Scene();
threeScene.fog = DEFAULT_FOG;
const camera = createCamera();
attachResize(renderer, camera);

const postfx = new PostFX(renderer, threeScene, camera);
window.addEventListener('resize', () => {
  postfx.setSize(window.innerWidth, window.innerHeight);
});

// Ship controller replaces FlyCamera. It exposes the same speedNow() / vel API
// so the HUD keeps working unchanged.
const ship = new ShipController(camera, canvas, threeScene, {
  onViewChange: (mode) => {
    // Cockpit is only visible in space scenes AND when in 1st-person view.
    // Without this, flipping to external leaves the cockpit hovering in front
    // of the camera and you can't see the ship.
    const inSpace = isSpaceScene(state.sceneName);
    const onFoot = character.active;
    cockpit.setVisible(inSpace && mode === 'cockpit' && !onFoot);
  },
});

// Cockpit is its own Group added to the scene; visible only in space scenes.
const cockpit = new Cockpit();
cockpit.addToScene(threeScene);

const character = new CharacterController(camera, canvas, threeScene);

// Skybox persists across scenes
const skybox = createSkybox(hashString('GLOBAL_SKYBOX'));
threeScene.add(skybox);

const sceneManager = new SceneManager(threeScene);
const hud = new Hud();
const radar = new Radar();

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

  // Cockpit visibility follows scene type AND view mode; ship model follows view mode.
  const inSpace = isSpaceScene(state.sceneName);
  const onFoot = character.active;
  cockpit.setVisible(inSpace && ship.viewMode === 'cockpit' && !onFoot);
  ship.shipModel.visible = (inSpace && ship.viewMode === 'external') || state.sceneName === 'planet';
  character.setActive(false);
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
    universe: state.universe,
    camera,
    flyCamera: ship,
    characterController: character,
    onLeave: () => {
      state.sceneName = state.prevSpaceScene;
      rebuildActiveScene();
    },
  });
  sceneManager.setScene(scene);
  cockpit.setVisible(false);
  ship.shipModel.visible = true;
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
  // Parallax — each layer rotates at a slightly different rate so distant
  // and near stars don't move in lockstep. Sells depth as the camera turns.
  const layers = skybox.userData.layers || [];
  const rates = [0.0004, 0.0008, 0.0014];
  for (let i = 0; i < layers.length; i++) {
    layers[i].rotation.y += dt * (rates[i] || 0.001);
  }

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

  const mapData = sceneManager.activeScene?.getMapData?.() ?? null;
  const radarShip = onFoot
    ? { pos: character.position, heading: character.cameraYaw }
    : { pos: ship.shipPosition, heading: ship.heading };
  radar.draw({ mapData, ship: radarShip });

  // Pipe the active scene's star (if any) to god-rays. Galaxy / black hole /
  // surface scenes return null so god-rays disables itself for that frame.
  const starPos = sceneManager.activeScene?.getStarWorldPosition?.() ?? null;
  postfx.setStarPosition(starPos);
  postfx.render(dt);
  requestAnimationFrame(loop);
}

// ─── Boot ─────────────────────────────────────────────────────────
rebuildActiveScene();
setTimeout(() => hud.hideLoading(), 400);
requestAnimationFrame(loop);
