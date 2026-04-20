import * as THREE from 'three';

export class FlyCamera {
  constructor(camera, canvas) {
    this.camera = camera;
    this.canvas = canvas;
    this.yaw = 0;
    this.pitch = 0;
    this.vel = new THREE.Vector3();
    this.keys = {};
    this.mouseLook = false;
    this.scaleFactor = 1; // scenes adjust this
    this.speed = 80;
    this.bindEvents();
  }

  bindEvents() {
    window.addEventListener('keydown', (e) => { this.keys[e.code] = true; });
    window.addEventListener('keyup',   (e) => { this.keys[e.code] = false; });

    this.canvas.addEventListener('mousedown', () => {
      this.mouseLook = true;
      this.canvas.style.cursor = 'none';
    });
    window.addEventListener('mouseup', () => {
      this.mouseLook = false;
      this.canvas.style.cursor = 'crosshair';
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.mouseLook) return;
      this.yaw   -= e.movementX * 0.003;
      this.pitch -= e.movementY * 0.003;
      this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));
    });
  }

  syncFromCameraPosition(target = new THREE.Vector3(0, 0, 0)) {
    const lookDir = target.clone().sub(this.camera.position).normalize();
    this.yaw = Math.atan2(lookDir.x, lookDir.z);
    this.pitch = Math.asin(lookDir.y);
  }

  setScale(factor) { this.scaleFactor = factor; }

  update(dt) {
    const q = new THREE.Quaternion();
    q.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    this.camera.quaternion.copy(q);

    const boost = (this.keys['ShiftLeft'] || this.keys['ShiftRight']) ? 5 : 1;
    const accel = this.speed * this.scaleFactor * boost;

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const right   = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up      = new THREE.Vector3(0, 1, 0);

    if (this.keys['KeyW']) this.vel.addScaledVector(forward, accel * dt);
    if (this.keys['KeyS']) this.vel.addScaledVector(forward, -accel * dt);
    if (this.keys['KeyD']) this.vel.addScaledVector(right,    accel * dt);
    if (this.keys['KeyA']) this.vel.addScaledVector(right,   -accel * dt);
    if (this.keys['Space']) this.vel.addScaledVector(up,      accel * dt);
    if (this.keys['ControlLeft'] || this.keys['ControlRight']) {
      this.vel.addScaledVector(up, -accel * dt);
    }

    this.camera.position.addScaledVector(this.vel, dt);
    this.vel.multiplyScalar(0.92);
  }

  isKeyDown(code) { return !!this.keys[code]; }
  speedNow() { return this.vel.length(); }
}
