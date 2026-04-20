import * as THREE from 'three';
import { makeRng, hashString } from '../kernel/index.js';
import { getGlowTexture } from '../engine/renderer.js';

export class BlackHoleScene {
  constructor({ universe, camera, flyCamera }) {
    this.universe = universe;
    this.camera = camera;
    this.flyCamera = flyCamera;
    this.disk = null;
    this.photonRing = null;
  }

  build(mgr) {
    const u = this.universe;
    const sr = 8 * Math.pow(u.constants.G, 0.7);
    const diskInner = sr * 1.5;
    const diskOuter = sr * 8;

    const eh = new THREE.Mesh(
      new THREE.SphereGeometry(sr, 64, 64),
      new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    mgr.threeScene.add(mgr.track(eh, 'Event Horizon'));

    const N = 30000;
    const positions = new Float32Array(N * 3);
    const colors    = new Float32Array(N * 3);
    const rng = makeRng(hashString('blackhole|' + u.id));

    for (let i = 0; i < N; i++) {
      const r = diskInner + Math.pow(rng(), 0.6) * (diskOuter - diskInner);
      const angle = rng() * Math.PI * 2;
      const t = (r - diskInner) / (diskOuter - diskInner);
      const thickness = (rng() - 0.5) * 0.4 * (1 - t);

      positions[i*3]   = Math.cos(angle) * r;
      positions[i*3+1] = thickness;
      positions[i*3+2] = Math.sin(angle) * r;

      const heat = 1 - t;
      if (heat > 0.7)      { colors[i*3]=1; colors[i*3+1]=1;        colors[i*3+2]=1; }
      else if (heat > 0.4) { colors[i*3]=1; colors[i*3+1]=0.9;      colors[i*3+2]=0.5; }
      else                 { colors[i*3]=1; colors[i*3+1]=0.4+heat; colors[i*3+2]=0.1; }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('color',    new THREE.Float32BufferAttribute(colors, 3));

    this.disk = new THREE.Points(geom, new THREE.PointsMaterial({
      size: 2,
      map: getGlowTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    mgr.threeScene.add(mgr.track(this.disk, 'Accretion Disk'));

    this.photonRing = new THREE.Mesh(
      new THREE.RingGeometry(sr * 1.05, sr * 1.3, 64),
      new THREE.MeshBasicMaterial({
        color: 0xffeecc,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    mgr.threeScene.add(mgr.track(this.photonRing));

    const lens = new THREE.Mesh(
      new THREE.SphereGeometry(sr * 2.5, 32, 32),
      new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0.4, side: THREE.BackSide,
      })
    );
    mgr.threeScene.add(mgr.track(lens));

    this.camera.position.set(0, sr * 2, sr * 6);
    this.flyCamera.syncFromCameraPosition(new THREE.Vector3(0, 0, 0));
    this.flyCamera.setScale(2);
  }

  update(dt) {
    if (this.disk) this.disk.rotation.y += dt * 0.4;
    if (this.photonRing) this.photonRing.lookAt(this.camera.position);
  }
}
