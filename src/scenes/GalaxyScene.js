import * as THREE from 'three';
import { makeRng, hashString } from '../kernel/index.js';
import { getGlowTexture } from '../engine/renderer.js';

export class GalaxyScene {
  constructor({ universe, camera, flyCamera }) {
    this.universe = universe;
    this.camera = camera;
    this.flyCamera = flyCamera;
    this.galaxyMesh = null;
  }

  build(mgr) {
    const u = this.universe;
    const rng = makeRng(hashString(u.id + '|galaxy'));

    const numStars     = Math.floor(50000 + u.stellar.stellarDensity * 30000);
    const galaxyRadius = 600;
    const numArms      = 2 + Math.floor(rng() * 3);
    const armTightness = 0.4 + (1 - u.constants.dm) * 0.3;
    const bulgeRatio   = 0.15 + u.constants.dm * 0.2;

    const positions = new Float32Array(numStars * 3);
    const colors    = new Float32Array(numStars * 3);

    for (let i = 0; i < numStars; i++) {
      let r;
      if (rng() < bulgeRatio) {
        r = Math.pow(rng(), 2) * galaxyRadius * 0.3;
      } else {
        r = Math.min(-Math.log(1 - rng() * 0.95) * galaxyRadius * 0.3, galaxyRadius);
      }
      const armOffset = Math.floor(rng() * numArms) * (Math.PI * 2 / numArms);
      const angle = (r / galaxyRadius) * Math.PI * 4 * armTightness + armOffset
                  + (rng() - 0.5) * 0.4;
      const heightScatter = (rng() - 0.5) * (10 + r * 0.05) * Math.exp(-r / galaxyRadius);

      positions[i*3]   = Math.cos(angle) * r;
      positions[i*3+1] = heightScatter;
      positions[i*3+2] = Math.sin(angle) * r;

      if (r < galaxyRadius * 0.2) {
        colors[i*3] = 1;
        colors[i*3+1] = 0.85 - rng() * 0.2;
        colors[i*3+2] = 0.5 - rng() * 0.2;
      } else if (rng() < (1 - r/galaxyRadius) * 0.3 + 0.2 && rng() < 0.3) {
        colors[i*3] = 0.7; colors[i*3+1] = 0.85; colors[i*3+2] = 1;
      } else {
        const t = rng();
        colors[i*3] = 1; colors[i*3+1] = 0.95 - t*0.2; colors[i*3+2] = 0.85 - t*0.3;
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('color',    new THREE.Float32BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 2.5,
      map: getGlowTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.galaxyMesh = new THREE.Points(geom, mat);
    mgr.threeScene.add(mgr.track(this.galaxyMesh, 'Galactic Core'));

    const bulge = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTexture(),
      color: 0xffd9a0,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.6,
    }));
    bulge.scale.set(180, 180, 1);
    mgr.threeScene.add(mgr.track(bulge));

    this.camera.position.set(0, 200, 800);
    this.flyCamera.syncFromCameraPosition(new THREE.Vector3(0, 0, 0));
    this.flyCamera.setScale(8);
  }

  update(dt) {
    if (this.galaxyMesh) this.galaxyMesh.rotation.y += dt * 0.02;
  }
}
