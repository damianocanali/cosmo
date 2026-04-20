// ShipController — flight dynamics for first- and third-person views.
//
// Key differences from FlyCamera:
//   - True inertia (no instant drag-to-stop)
//   - Gradual throttle ramp — tapping W doesn't teleport you
//   - Roll nudge when turning (the world tilts slightly as you bank)
//   - Third-person camera that trails the ship
//   - External ship model visible in 3rd person, hidden in 1st person
//   - Exposes speed, throttle, camera for HUD/cockpit/external use

import * as THREE from 'three';
import { buildShipModel } from './shipModel.js';

export class ShipController {
  /**
   * @param {THREE.PerspectiveCamera} camera  The main camera
   * @param {HTMLCanvasElement} canvas
   * @param {THREE.Scene} threeScene           Scene to add the external ship to
   */
  constructor(camera, canvas, threeScene) {
    this.camera = camera;
    this.canvas = canvas;
    this.threeScene = threeScene;

    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0; // auto-banking angle — not directly controlled
    this.velocity = new THREE.Vector3();

    this.throttle = 0; // 0..1 — ramps up as you hold W
    this.maxSpeed = 400; // units/s at boost
    this.cruiseSpeed = 120;
    this.accel = 180;
    this.drag = 0.995; // very light drag so you coast like space

    // View
    this.viewMode = 'cockpit'; // 'cockpit' | 'external'
    this.scaleFactor = 1;

    // Input
    this.keys = {};
    this.mouseLook = false;

    // External ship model (visible in external cam)
    this.shipModel = buildShipModel();
    this.shipModel.visible = false; // off by default (cockpit view)
    this.threeScene.add(this.shipModel);

    // A camera rig: in external mode the camera orbits behind the ship
    this.externalOffset = new THREE.Vector3(0, 2.5, 12);

    this.bindEvents();
  }

  bindEvents() {
    this._keydown = (e) => {
      this.keys[e.code] = true;
      if (e.code === 'KeyC') this.toggleView();
    };
    this._keyup = (e) => { this.keys[e.code] = false; };
    window.addEventListener('keydown', this._keydown);
    window.addEventListener('keyup', this._keyup);

    this._mousedown = () => { this.mouseLook = true; this.canvas.style.cursor = 'none'; };
    this._mouseup   = () => { this.mouseLook = false; this.canvas.style.cursor = 'crosshair'; };
    this._mousemove = (e) => {
      if (!this.mouseLook) return;
      this.yaw   -= e.movementX * 0.003;
      this.pitch -= e.movementY * 0.003;
      this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));
    };
    this.canvas.addEventListener('mousedown', this._mousedown);
    window.addEventListener('mouseup', this._mouseup);
    window.addEventListener('mousemove', this._mousemove);
  }

  dispose() {
    window.removeEventListener('keydown', this._keydown);
    window.removeEventListener('keyup', this._keyup);
    this.canvas.removeEventListener('mousedown', this._mousedown);
    window.removeEventListener('mouseup', this._mouseup);
    window.removeEventListener('mousemove', this._mousemove);
    this.threeScene.remove(this.shipModel);
  }

  syncFromCameraPosition(target = new THREE.Vector3(0, 0, 0)) {
    const lookDir = target.clone().sub(this.camera.position).normalize();
    this.yaw = Math.atan2(lookDir.x, lookDir.z);
    this.pitch = Math.asin(lookDir.y);
    this.velocity.set(0, 0, 0);
    this.throttle = 0;
  }

  toggleView() {
    this.viewMode = this.viewMode === 'cockpit' ? 'external' : 'cockpit';
    this.shipModel.visible = this.viewMode === 'external';
  }

  setScale(factor) { this.scaleFactor = factor; }

  setThirdPersonOnly(flag) {
    // Used when scene has no cockpit (e.g. planet surface when we add it later)
    if (flag) {
      this.viewMode = 'external';
      this.shipModel.visible = true;
    }
  }

  update(dt) {
    // Build orientation quaternion from yaw/pitch (no roll input;
    // roll is auto-generated for visual feedback).
    const qYawPitch = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ')
    );

    // Ramp throttle based on W/S input
    const boost = (this.keys['ShiftLeft'] || this.keys['ShiftRight']) ? 1 : 0;
    const wantForward = this.keys['KeyW'] ? 1 : (this.keys['KeyS'] ? -0.6 : 0);
    const throttleTarget = Math.abs(wantForward) * (1 + boost * 1.5);
    this.throttle += (throttleTarget - this.throttle) * Math.min(1, dt * 2.5);

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(qYawPitch);
    const right   = new THREE.Vector3(1, 0, 0).applyQuaternion(qYawPitch);
    const up      = new THREE.Vector3(0, 1, 0).applyQuaternion(qYawPitch);

    const effectiveAccel = this.accel * this.scaleFactor * (1 + boost * 2.5);

    // Forward thrust via throttle
    if (wantForward !== 0) {
      this.velocity.addScaledVector(forward, Math.sign(wantForward) * this.throttle * effectiveAccel * dt);
    }
    // Strafe (A/D) — less powerful than forward thrust
    if (this.keys['KeyA']) this.velocity.addScaledVector(right, -effectiveAccel * 0.5 * dt);
    if (this.keys['KeyD']) this.velocity.addScaledVector(right,  effectiveAccel * 0.5 * dt);
    // Vertical
    if (this.keys['Space']) this.velocity.addScaledVector(up,  effectiveAccel * 0.5 * dt);
    if (this.keys['ControlLeft'] || this.keys['ControlRight']) {
      this.velocity.addScaledVector(up, -effectiveAccel * 0.5 * dt);
    }

    // Cap at max speed
    const maxV = this.maxSpeed * this.scaleFactor * (1 + boost * 2);
    if (this.velocity.length() > maxV) {
      this.velocity.setLength(maxV);
    }
    this.velocity.multiplyScalar(this.drag);

    // Visual bank: when the player strafes or looks sharply sideways, tilt
    const strafe = (this.keys['KeyD'] ? 1 : 0) - (this.keys['KeyA'] ? 1 : 0);
    const rollTarget = -strafe * 0.25;
    this.roll += (rollTarget - this.roll) * Math.min(1, dt * 4);

    // Final camera orientation with roll applied
    const qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.roll);
    const qFinal = qYawPitch.clone().multiply(qRoll);

    // ── Apply to external ship model (always updated; just toggled on) ──
    const shipWorldPos = this.camera.position.clone();
    // Position ship slightly below/behind the camera in cockpit view,
    // so the external model aligns with where the player "is" in the ship.
    this.shipModel.position.copy(shipWorldPos);
    this.shipModel.quaternion.copy(qFinal);

    // ── Move the camera based on view mode ──────────────────────────
    if (this.viewMode === 'external') {
      // Orbit camera behind the ship
      const offset = this.externalOffset.clone().applyQuaternion(qFinal);
      const shipPos = shipWorldPos.clone().sub(
        new THREE.Vector3(0, 0, -1).applyQuaternion(qFinal).multiplyScalar(0) // no offset; ship IS at camera pos
      );
      // Move camera to trail position
      this.camera.position.copy(shipPos).add(offset);
      this.camera.quaternion.copy(qFinal);
      // Apply velocity to ship position (which is camera position)
      this.camera.position.addScaledVector(this.velocity, dt);
    } else {
      // Cockpit view: camera IS the ship
      this.camera.quaternion.copy(qFinal);
      this.camera.position.addScaledVector(this.velocity, dt);
    }

    // Animate wing lights (blink)
    if (this.shipModel.userData.wingLightL) {
      const blink = ((Math.sin(performance.now() * 0.002) + 1) * 0.5) > 0.5 ? 1 : 0.1;
      this.shipModel.userData.wingLightL.material.emissiveIntensity = 1 + blink;
      this.shipModel.userData.wingLightR.material.emissiveIntensity = 1 + blink;
    }
    // Engine light pulse with throttle
    if (this.shipModel.userData.engineLight) {
      this.shipModel.userData.engineLight.intensity = 1.5 + this.throttle * 3;
    }
  }

  // Compatibility with old FlyCamera API — HUD reads these
  speedNow() { return this.velocity.length(); }
  get vel() { return this.velocity; }
  isKeyDown(code) { return !!this.keys[code]; }
}
