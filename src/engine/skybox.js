import * as THREE from 'three';
import { makeRng } from '../kernel/index.js';

// Builds a layered starfield with parallax. Returns a Group that should be
// added to the scene. Caller can rotate the group itself for global drift;
// the layers also rotate at different speeds inside `update(dt)` to give
// near/far parallax.
export function createSkybox(seed = 42) {
  const group = new THREE.Group();
  group.name = 'Skybox';

  // Three star layers — far/mid/near. Far is dim and slow, near is bright
  // and fast, mid splits the difference. Star counts intentionally taper
  // (more far stars, fewer near stars) so depth doesn't feel like clutter.
  const farLayer  = makeStarLayer(seed * 11 + 1, 12000, 5800, 0.7, [1.0, 0.95, 0.8]);
  const midLayer  = makeStarLayer(seed * 11 + 2,  4500, 5400, 0.85, [0.7, 0.8, 1.0]);
  const nearLayer = makeStarLayer(seed * 11 + 3,  1200, 4800, 1.0, [1.0, 0.7, 0.5]);

  group.add(farLayer);
  group.add(midLayer);
  group.add(nearLayer);

  // Two nebula sprites at deterministic positions — large, faint, additive.
  const nebulaA = makeNebulaSprite(seed * 7 + 1, 0x6644aa);
  const nebulaB = makeNebulaSprite(seed * 7 + 2, 0x44aaaa);
  // Place them at far radii, deterministic angles.
  const rng = makeRng(seed * 13);
  placeOnSphere(nebulaA, 6000, rng() * Math.PI * 2, (rng() - 0.5) * Math.PI);
  placeOnSphere(nebulaB, 6000, rng() * Math.PI * 2, (rng() - 0.5) * Math.PI);
  nebulaA.scale.set(2400, 2400, 1);
  nebulaB.scale.set(2000, 2000, 1);
  group.add(nebulaA);
  group.add(nebulaB);

  // Expose the layers on userData so main.js can rotate them at different
  // rates each frame for the parallax effect.
  group.userData.layers = [farLayer, midLayer, nearLayer];

  return group;
}

function makeStarLayer(seed, count, radius, opacity, baseColor) {
  const geom = new THREE.BufferGeometry();
  const positions = [];
  const colors = [];
  const rng = makeRng(seed);
  for (let i = 0; i < count; i++) {
    const theta = rng() * Math.PI * 2;
    const phi   = Math.acos(2 * rng() - 1);
    positions.push(
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi)
    );
    // Most stars are baseColor; ~15% get a saturated variant for visual interest.
    const t = rng();
    if (t < 0.85) {
      colors.push(baseColor[0], baseColor[1], baseColor[2]);
    } else if (t < 0.93) {
      colors.push(0.6, 0.8, 1.0); // blue
    } else {
      colors.push(1.0, 0.55, 0.4); // red giant
    }
  }
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('color',    new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 6 * (radius / 5400), // closer layer → bigger pixels
    vertexColors: true,
    transparent: true,
    opacity,
    sizeAttenuation: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geom, mat);
}

function makeNebulaSprite(seed, hex) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d');
  // Multiple radial gradients piled on top — soft, irregular cloud shape.
  const rng = makeRng(seed);
  const c = new THREE.Color(hex);
  for (let i = 0; i < 6; i++) {
    const cx = 64 + rng() * 128;
    const cy = 64 + rng() * 128;
    const r  = 40 + rng() * 80;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    const a = 0.12 + rng() * 0.18;
    g.addColorStop(0, `rgba(${(c.r*255)|0},${(c.g*255)|0},${(c.b*255)|0},${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  }
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  return new THREE.Sprite(mat);
}

function placeOnSphere(obj, radius, theta, phi) {
  obj.position.set(
    radius * Math.cos(phi) * Math.cos(theta),
    radius * Math.sin(phi),
    radius * Math.cos(phi) * Math.sin(theta)
  );
}
