// SceneManager owns the current Three.js scene contents.
// Scenes implement a small interface: build(), update(dt, t), dispose().
// The manager handles disposal between scene switches.

import * as THREE from 'three';

export class SceneManager {
  constructor(threeScene) {
    this.threeScene = threeScene;
    this.activeScene = null;
    this.tracked = [];
    this.named = []; // {object, name, hint?}
  }

  /** Track an object so it gets disposed on the next clear(). */
  track(obj, name = null, hint = null) {
    this.tracked.push(obj);
    if (name) this.named.push({ object: obj, name, hint });
    return obj;
  }

  clear() {
    for (const obj of this.tracked) {
      this.threeScene.remove(obj);
      this.disposeRecursive(obj);
    }
    this.tracked = [];
    this.named = [];
  }

  disposeRecursive(obj) {
    obj.traverse?.((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
        else c.material.dispose();
      }
    });
  }

  setScene(scene) {
    if (this.activeScene && this.activeScene.dispose) this.activeScene.dispose();
    this.clear();
    this.activeScene = scene;
    if (scene && scene.build) scene.build(this);
  }

  update(dt, t) {
    if (this.activeScene && this.activeScene.update) {
      this.activeScene.update(dt, t);
    }
  }

  /** Find object near crosshair for HUD targeting. */
  findCrosshairTarget(camera) {
    if (this.named.length === 0) return null;
    const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const tmp = new THREE.Vector3();
    let best = null;
    let bestDot = 0.985;
    for (const { object, name, hint } of this.named) {
      object.getWorldPosition(tmp);
      const toObj = tmp.clone().sub(camera.position);
      const dist = toObj.length();
      if (dist < 0.5) continue;
      const dot = toObj.normalize().dot(camDir);
      if (dot > bestDot) {
        bestDot = dot;
        best = { name, dist, hint, object };
      }
    }
    return best;
  }
}
