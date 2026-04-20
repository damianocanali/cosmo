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
