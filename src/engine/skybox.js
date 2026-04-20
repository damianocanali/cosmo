import * as THREE from 'three';
import { makeRng } from '../kernel/index.js';

export function createSkybox(seed = 42, count = 8000, radius = 20000) {
  const geom = new THREE.BufferGeometry();
  const positions = [], colors = [];
  const rng = makeRng(seed);
  for (let i = 0; i < count; i++) {
    const theta = rng() * Math.PI * 2;
    const phi   = Math.acos(2 * rng() - 1);
    positions.push(
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi)
    );
    const t = rng();
    if (t < 0.6)      colors.push(1, 0.95, 0.8);
    else if (t < 0.85) colors.push(0.7, 0.8, 1);
    else               colors.push(1, 0.6, 0.4);
  }
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('color',    new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 8,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    sizeAttenuation: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geom, mat);
}
