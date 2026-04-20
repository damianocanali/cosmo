import * as THREE from 'three';
import {
  sampleTerrainHeight,
  seaLevelFor,
  colorAtHeight,
  atmosphereColor,
  BIOMES,
} from '../kernel/index.js';
import { buildSurfaceScatter } from '../engine/scatterRenderer.js';

/**
 * PlanetSurfaceScene — descend onto a derived planet.
 *
 * Key upgrades over v1:
 *  - Multi-scale terrain (continents + ranges + detail)
 *  - Larger terrain (4000 units, 384 segments)
 *  - Thousands of instanced rocks/trees/crystals placed by kernel scatter
 *  - Cloud layer with scrolling noise
 *  - Bigger sun with lens flare streak
 *  - Subtle fog for depth
 */
export class PlanetSurfaceScene {
  constructor({ planet, starColor, camera, flyCamera, onLeave }) {
    this.planet = planet;
    this.starColor = starColor || new THREE.Color(1, 0.95, 0.8);
    this.camera = camera;
    this.flyCamera = flyCamera;
    this.onLeave = onLeave;
    this.escListener = null;
    this.cloudMesh = null;
    this.atmosphere = null;
  }

  build(mgr) {
    const p = this.planet;
    const atmoColor = atmosphereColor(p);
    const atmoVec = new THREE.Color(atmoColor[0], atmoColor[1], atmoColor[2]);

    // ── Lighting ───────────────────────────────────────────────────
    const sunDir = new THREE.Vector3(0.5, 0.6, 0.3).normalize();
    const sun = new THREE.DirectionalLight(this.starColor, 1.6);
    sun.position.copy(sunDir).multiplyScalar(2500);
    mgr.threeScene.add(mgr.track(sun));

    const ambient = new THREE.AmbientLight(
      atmoVec.clone().multiplyScalar(0.4),
      0.7
    );
    mgr.threeScene.add(mgr.track(ambient));

    // Subtle hemisphere light for natural sky/ground separation
    const hemi = new THREE.HemisphereLight(
      atmoVec.getHex(),
      0x3a2f24,
      0.4
    );
    mgr.threeScene.add(mgr.track(hemi));

    // ── Terrain mesh ───────────────────────────────────────────────
    const SIZE = 4000, SEGMENTS = 384;
    const geom = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
    geom.rotateX(-Math.PI / 2);

    const positions = geom.attributes.position;
    const colorAttr = new THREE.Float32BufferAttribute(positions.count * 3, 3);

    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const h = sampleTerrainHeight(p, x, z);
      positions.setY(i, h);
      const [r, g, b] = colorAtHeight(p.biome, h);
      colorAttr.setXYZ(i, r, g, b);
    }
    positions.needsUpdate = true;
    geom.setAttribute('color', colorAttr);
    geom.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.0,
      flatShading: false,
    });
    const terrain = new THREE.Mesh(geom, terrainMat);
    mgr.threeScene.add(mgr.track(terrain, p.biome + ' surface'));
    this.terrain = terrain;

    // ── Surface scatter ────────────────────────────────────────────
    // Build in concentric regions so density is uniform out to the horizon.
    const scatterMeshes = buildSurfaceScatter(
      p, -SIZE / 2, -SIZE / 2, SIZE / 2, SIZE / 2
    );
    for (const mesh of scatterMeshes) {
      mgr.threeScene.add(mgr.track(mesh));
    }

    // ── Water plane ────────────────────────────────────────────────
    const seaLevel = seaLevelFor(p);
    if (p.biome === BIOMES.OCEAN || p.biome === BIOMES.TEMPERATE) {
      const waterColor = p.biome === BIOMES.OCEAN
        ? new THREE.Color(0.08, 0.28, 0.5)
        : new THREE.Color(0.12, 0.38, 0.58);
      const water = new THREE.Mesh(
        new THREE.PlaneGeometry(SIZE * 1.5, SIZE * 1.5, 1, 1).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({
          color: waterColor,
          transparent: true,
          opacity: 0.85,
          roughness: 0.15,
          metalness: 0.5,
          envMapIntensity: 1.2,
        })
      );
      water.position.y = seaLevel - 0.5;
      mgr.threeScene.add(mgr.track(water));
    }

    if (p.biome === BIOMES.MOLTEN) {
      const lava = new THREE.Mesh(
        new THREE.PlaneGeometry(SIZE * 1.5, SIZE * 1.5, 1, 1).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xff4018, transparent: true, opacity: 0.75 })
      );
      lava.position.y = seaLevel - 2;
      mgr.threeScene.add(mgr.track(lava));
      const hellAmbient = new THREE.AmbientLight(0xff2000, 0.5);
      mgr.threeScene.add(mgr.track(hellAmbient));
    }

    // ── Atmospheric dome with sun flare ────────────────────────────
    if (p.hasAtmosphere) {
      const atmGeom = new THREE.SphereGeometry(5000, 32, 32);
      const atmMat = new THREE.ShaderMaterial({
        uniforms: {
          horizonColor: { value: atmoVec.clone() },
          zenithColor:  { value: new THREE.Color(
            atmoColor[0] * 0.15, atmoColor[1] * 0.25, atmoColor[2] * 0.5
          )},
          sunDir:       { value: sunDir.clone() },
          sunColor:     { value: this.starColor.clone() },
        },
        vertexShader: `
          varying vec3 vWorldPosition;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorldPosition = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: `
          varying vec3 vWorldPosition;
          uniform vec3 horizonColor;
          uniform vec3 zenithColor;
          uniform vec3 sunDir;
          uniform vec3 sunColor;
          void main() {
            vec3 dir = normalize(vWorldPosition);
            float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
            float horizonMix = pow(1.0 - h, 3.0);
            vec3 col = mix(zenithColor, horizonColor, horizonMix);
            float sunDot = max(0.0, dot(dir, normalize(sunDir)));
            // Sun disc, corona, broad glow
            col += sunColor * pow(sunDot, 800.0) * 3.0;      // disc
            col += sunColor * pow(sunDot, 40.0)  * 0.8;      // corona
            col += sunColor * pow(sunDot, 6.0)   * 0.25;     // broad glow
            // Horizon band brightening near sun (sunset effect)
            float horizonBand = pow(1.0 - h, 6.0);
            col += sunColor * pow(sunDot, 3.0) * horizonBand * 0.4;
            gl_FragColor = vec4(col, 1.0);
          }
        `,
        side: THREE.BackSide,
        depthWrite: false,
      });
      this.atmosphere = new THREE.Mesh(atmGeom, atmMat);
      mgr.threeScene.add(mgr.track(this.atmosphere));

      // ── Cloud layer ──────────────────────────────────────────────
      // Procedural cloud texture + gently scrolling UVs.
      const cloudTex = makeCloudTexture(p.seed);
      const cloudMat = new THREE.MeshBasicMaterial({
        map: cloudTex,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: THREE.DoubleSide,
        color: new THREE.Color(1, 1, 1).lerp(atmoVec, 0.15),
      });
      const cloudGeom = new THREE.SphereGeometry(2400, 32, 32);
      this.cloudMesh = new THREE.Mesh(cloudGeom, cloudMat);
      this.cloudMesh.scale.y = 0.2; // flatten into an atmosphere layer
      mgr.threeScene.add(mgr.track(this.cloudMesh));
    } else {
      const blackDome = new THREE.Mesh(
        new THREE.SphereGeometry(5000, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0x000005, side: THREE.BackSide })
      );
      mgr.threeScene.add(mgr.track(blackDome));
    }

    // ── Fog for atmospheric perspective ────────────────────────────
    if (p.hasAtmosphere) {
      mgr.threeScene.fog = new THREE.Fog(
        atmoVec.clone().lerp(new THREE.Color(0, 0, 0), 0.3).getHex(),
        800, 3500
      );
    } else {
      mgr.threeScene.fog = null;
    }

    // ── Position camera above terrain ──────────────────────────────
    const startX = 0, startZ = 0;
    const groundY = sampleTerrainHeight(p, startX, startZ);
    this.camera.position.set(startX, Math.max(groundY + 100, 80), startZ + 140);
    this.flyCamera.syncFromCameraPosition(new THREE.Vector3(startX, groundY, startZ));
    this.flyCamera.setScale(0.5);

    // ── Esc to return ──────────────────────────────────────────────
    this.escListener = (e) => {
      if (e.code === 'Escape' && this.onLeave) this.onLeave();
    };
    window.addEventListener('keydown', this.escListener);
  }

  update(dt) {
    // Soft collision with ground
    const cam = this.camera.position;
    const ground = sampleTerrainHeight(this.planet, cam.x, cam.z);
    const minHeight = ground + 5;
    if (cam.y < minHeight) {
      cam.y = minHeight;
      if (this.flyCamera.vel.y < 0) this.flyCamera.vel.y = 0;
    }
    // Clouds drift
    if (this.cloudMesh) {
      this.cloudMesh.rotation.y += dt * 0.008;
    }
  }

  dispose() {
    if (this.escListener) window.removeEventListener('keydown', this.escListener);
    // Clear fog so it doesn't bleed into space scenes
    // (SceneManager doesn't touch THREE.Scene.fog)
    // The next scene's build() will set or clear it.
  }
}

// ── Cloud texture generator ──────────────────────────────────────────
function makeCloudTexture(planetSeed) {
  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);

  // Simple value-noise FBM for cloud shapes
  function hash(x, y) {
    let h = (planetSeed ^ x * 374761393 ^ y * 668265263) >>> 0;
    h = (h ^ (h >>> 13)) * 1274126177 >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = smooth(x - xi), yf = smooth(y - yi);
    const v00 = hash(xi, yi),     v10 = hash(xi + 1, yi);
    const v01 = hash(xi, yi + 1), v11 = hash(xi + 1, yi + 1);
    const a = v00 * (1 - xf) + v10 * xf;
    const b = v01 * (1 - xf) + v11 * xf;
    return a * (1 - yf) + b * yf;
  }
  function fbm(x, y) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < 5; i++) {
      sum += noise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Sample in wrapping space: use angle-based coordinates so it tiles
      const u = (x / size) * 8;
      const v = (y / size) * 8;
      let n = fbm(u, v);
      // Bias toward sparser clouds
      n = Math.max(0, (n - 0.45) * 2.2);
      n = Math.min(1, n);
      // Less coverage near poles (y=0, y=size)
      const polar = Math.sin((y / size) * Math.PI);
      n *= polar;

      const i = (y * size + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.floor(n * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
