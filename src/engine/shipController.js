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
  constructor(camera, canvas, threeScene, { onViewChange } = {}) {
    this.camera = camera;
    this.canvas = canvas;
    this.threeScene = threeScene;
    this.onViewChange = onViewChange;

    // Mouse rotates the CAMERA view, not the ship directly.
    // The ship's own heading (shipYaw/shipPitch) lerps toward the camera
    // so the ship visibly turns to face where you're thrusting — mouse
    // feels like "look around", ship feels like "go where I'm pointing".
    this.cameraYaw = 0;
    this.cameraPitch = 0;
    this.shipYaw = 0;
    this.shipPitch = 0;
    this.roll = 0; // auto-banking angle — not directly controlled
    this.velocity = new THREE.Vector3();
    // Ship anchor — source of truth for where the ship is in the world.
    // In cockpit view the camera sits ON it; in external view the camera
    // sits behind it. Using camera.position as the anchor would feed the
    // external offset back in every frame and the ship would drift.
    this.shipPosition = new THREE.Vector3();

    this.throttle = 0; // 0..1 — ramps up as you hold W
    // Tuned for "easy to stop at a planet" rather than realistic space coast.
    // maxSpeed cut roughly in half from earlier values so boost doesn't blow
    // past landing corridors; drag bumped so releasing W naturally settles.
    this.maxSpeed = 180; // units/s at base; boost multiplies up to ~2.6×
    this.cruiseSpeed = 90;
    this.accel = 110;
    this.drag = 0.985; // moderate drag — coasts but settles in ~2 seconds

    // View
    this.viewMode = 'cockpit'; // 'cockpit' | 'external'

    // Surface state — set by PlanetSurfaceScene when grounded.
    this.grounded = false;
    this.groundClearance = 2.5; // ship sits this far above the ground
    this.groundY = 0;
    this.controlsEnabled = true;

    // Drag multiplier driven by SolarSystemScene when close to a planet, so
    // the ship "feels" gravity wells and is easier to settle into orbit / land.
    // 1.0 = normal coast, higher = more aggressive damping. Applied as
    // velocity *= drag^proximitySlowdown each frame.
    this.proximitySlowdown = 1.0;

    this.scaleFactor = 1;

    // Input
    this.keys = {};
    this.mouseLook = false;

    // External ship model (visible in external cam)
    this.shipModel = buildShipModel();
    this.shipModel.visible = false; // off by default (cockpit view)
    this.threeScene.add(this.shipModel);

    // A camera rig: in external mode the camera orbits behind the ship.
    // Ship bounding box is ~12 long × 11 wide — offset needs to sit well
    // behind the engines (~z=5.6) to keep the whole hero in frame at 70°
    // vertical FOV.
    this.externalOffset = new THREE.Vector3(0, 4, 22);

    this.bindEvents();
  }

  bindEvents() {
    // Guarded by controlsEnabled so on-foot key/mouse input doesn't leak into
    // the ship (would silently drift its camera, and a C press would toggle
    // the ship's view mode and hide the parked model).
    this._keydown = (e) => {
      if (!this.controlsEnabled) return;
      this.keys[e.code] = true;
      if (e.code === 'KeyC') this.toggleView();
    };
    this._keyup = (e) => { this.keys[e.code] = false; };
    window.addEventListener('keydown', this._keydown);
    window.addEventListener('keyup', this._keyup);

    // Pointer-lock-style look: click the canvas once to lock the cursor,
    // then mouse movement rotates the camera until Esc (browser-default
    // release) or the canvas loses focus. No click-and-hold.
    this._mousedown = () => {
      if (!this.controlsEnabled) return;
      if (document.pointerLockElement !== this.canvas) {
        this.canvas.requestPointerLock?.();
      }
    };
    this._pointerlockchange = () => {
      this.mouseLook = document.pointerLockElement === this.canvas;
      this.canvas.style.cursor = this.mouseLook ? 'none' : 'crosshair';
    };
    this._mousemove = (e) => {
      if (!this.controlsEnabled || !this.mouseLook) return;
      this.cameraYaw   -= e.movementX * 0.003;
      this.cameraPitch -= e.movementY * 0.003;
      this.cameraPitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.cameraPitch));
    };
    this.canvas.addEventListener('mousedown', this._mousedown);
    document.addEventListener('pointerlockchange', this._pointerlockchange);
    window.addEventListener('mousemove', this._mousemove);
  }

  dispose() {
    window.removeEventListener('keydown', this._keydown);
    window.removeEventListener('keyup', this._keyup);
    this.canvas.removeEventListener('mousedown', this._mousedown);
    document.removeEventListener('pointerlockchange', this._pointerlockchange);
    window.removeEventListener('mousemove', this._mousemove);
    this.threeScene.remove(this.shipModel);
  }

  syncFromCameraPosition(target = new THREE.Vector3(0, 0, 0)) {
    const lookDir = target.clone().sub(this.camera.position).normalize();
    const y = Math.atan2(lookDir.x, lookDir.z);
    const p = Math.asin(lookDir.y);
    this.cameraYaw = y;
    this.cameraPitch = p;
    // Snap ship orientation to camera on sync — otherwise the ship would
    // spin to catch up every time you change scenes.
    this.shipYaw = y;
    this.shipPitch = p;
    this.velocity.set(0, 0, 0);
    this.throttle = 0;
    // Anchor the ship wherever the scene placed the camera.
    this.shipPosition.copy(this.camera.position);
  }

  toggleView() {
    this.viewMode = this.viewMode === 'cockpit' ? 'external' : 'cockpit';
    this.shipModel.visible = this.viewMode === 'external';
    if (this.onViewChange) this.onViewChange(this.viewMode);
  }

  setScale(factor) { this.scaleFactor = factor; }

  setThirdPersonOnly(flag) {
    // Used when scene has no cockpit (e.g. planet surface when we add it later)
    if (flag) {
      this.viewMode = 'external';
      this.shipModel.visible = true;
    }
  }

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

  setProximitySlowdown(factor) {
    this.proximitySlowdown = Math.max(1, factor);
  }

  update(dt) {
    // ── Camera orientation (mouse-driven) ───────────────────────────
    const qCamera = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(this.cameraPitch, this.cameraYaw, 0, 'YXZ')
    );

    // Thrust is CAMERA-relative — W goes where you're looking.
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(qCamera);
    const right   = new THREE.Vector3(1, 0, 0).applyQuaternion(qCamera);
    const worldUp = new THREE.Vector3(0, 1, 0);

    let boost = 0;
    let wantForward = 0;
    let throttleTarget = 0;
    let braking = false;
    if (this.controlsEnabled) {
      boost = (this.keys['ShiftLeft'] || this.keys['ShiftRight']) ? 1 : 0;
      wantForward = this.keys['KeyW'] ? 1 : 0;
      braking = !!this.keys['KeyS']; // S is a decisive brake, not reverse thrust
      throttleTarget = Math.abs(wantForward) * (1 + boost * 1.5);
    }
    this.throttle += (throttleTarget - this.throttle) * Math.min(1, dt * 2.5);

    const effectiveAccel = this.accel * this.scaleFactor * (1 + boost * 1.6);

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

    const maxV = this.maxSpeed * this.scaleFactor * (1 + boost * 1.6);
    if (this.velocity.length() > maxV) this.velocity.setLength(maxV);

    // Drag is amplified near planets via proximitySlowdown — gives the ship
    // a sense that it's pushing against gravity when approaching.
    this.velocity.multiplyScalar(Math.pow(this.drag, this.proximitySlowdown));

    // Hard brake — S kills velocity decisively (drops to ~2% in ~1 second).
    // Frame-rate-aware via Math.pow(rate, dt). Also bleeds throttle so the
    // engines visibly stop pulling.
    if (braking) {
      const brakeDecay = Math.pow(0.02, dt);
      this.velocity.multiplyScalar(brakeDecay);
      this.throttle *= brakeDecay;
    }

    // Integrate ship position
    this.shipPosition.addScaledVector(this.velocity, dt);

    if (this.grounded) {
      const minY = this.groundY + this.groundClearance;
      if (this.shipPosition.y < minY) {
        this.shipPosition.y = minY;
        if (this.velocity.y < 0) this.velocity.y = 0;
      }
    }

    // ── Ship heading lerps toward camera view ──────────────────────
    // So the ship visibly turns to match where you're thrusting, but
    // mouse itself doesn't snap the ship — it glides. Angle-wrap so
    // yaw going from 179° to -179° takes the short way.
    const turnK = 1 - Math.exp(-5.5 * dt);
    this.shipYaw   = lerpAngle(this.shipYaw,   this.cameraYaw,   turnK);
    this.shipPitch = this.shipPitch + (this.cameraPitch - this.shipPitch) * turnK;

    // Auto-bank on strafe for visual flair
    const strafe = (this.keys['KeyD'] ? 1 : 0) - (this.keys['KeyA'] ? 1 : 0);
    const rollTarget = -strafe * 0.25;
    this.roll += (rollTarget - this.roll) * Math.min(1, dt * 4);

    const qShipOrient = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(this.shipPitch, this.shipYaw, 0, 'YXZ')
    );
    const qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.roll);
    const qShipFinal = qShipOrient.clone().multiply(qRoll);

    // ── Ship model ──────────────────────────────────────────────────
    this.shipModel.position.copy(this.shipPosition);
    this.shipModel.quaternion.copy(qShipFinal);

    // ── Camera ──────────────────────────────────────────────────────
    // Camera orientation always follows mouse (qCamera). In external view
    // the camera orbits behind the ship at externalOffset rotated into the
    // camera frame — so looking up/down/around in 3rd person circles the
    // ship, rather than yanking it along.
    if (this.viewMode === 'external') {
      const offset = this.externalOffset.clone().applyQuaternion(qCamera);
      this.camera.position.copy(this.shipPosition).add(offset);
      this.camera.quaternion.copy(qCamera);
    } else {
      this.camera.position.copy(this.shipPosition);
      this.camera.quaternion.copy(qCamera);
    }

    // ── Ship lights & flames ────────────────────────────────────────
    if (this.shipModel.userData.wingLightL) {
      const blink = ((Math.sin(performance.now() * 0.002) + 1) * 0.5) > 0.5 ? 1 : 0.1;
      this.shipModel.userData.wingLightL.material.emissiveIntensity = 1 + blink;
      this.shipModel.userData.wingLightR.material.emissiveIntensity = 1 + blink;
    }
    if (this.shipModel.userData.engineLight) {
      this.shipModel.userData.engineLight.intensity = 1.5 + this.throttle * 3;
    }
    // Engine flames scale with throttle. Only on forward thrust (W), not
    // reverse — reversing shouldn't look like you're accelerating forward.
    const flames = this.shipModel.userData.engineFlames;
    if (flames) {
      const forwardThrottle = this.keys['KeyW'] ? this.throttle : 0;
      const flicker = 0.9 + 0.1 * Math.sin(performance.now() * 0.04);
      for (const { outer, core } of flames) {
        outer.scale.z = (0.3 + forwardThrottle * 1.6) * flicker;
        outer.material.opacity = Math.min(0.9, forwardThrottle * 0.9);
        core.scale.z = (0.2 + forwardThrottle * 1.2) * flicker;
        core.material.opacity = Math.min(0.95, forwardThrottle * 1.1);
      }
    }
  }

  // Compatibility with old FlyCamera API — HUD reads these
  speedNow() { return this.velocity.length(); }
  get vel() { return this.velocity; }
  // Ship's visible heading (what the radar triangle should match)
  get heading() { return this.shipYaw; }
  isKeyDown(code) { return !!this.keys[code]; }
}

// Shortest-path angular interpolation. Needed because raw lerp on angles
// would take the long way around when wrapping past ±π.
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
