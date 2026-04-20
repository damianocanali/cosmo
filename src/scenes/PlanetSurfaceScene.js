import * as THREE from 'three';
import {
  sampleTerrainHeight,
  colorAtHeight,
  atmosphereColor,
  BIOMES,
} from '../kernel/index.js';

/**
 * PlanetSurfaceScene — descend onto a derived planet.
 * Generates a 256x256 heightmap mesh from the kernel's terrain functions,
 * an atmospheric dome with horizon scattering, and a sun in the sky.
 *
 * Controls inherited from FlyCamera; Esc returns to solar system.
 */
export class PlanetSurfaceScene {
  constructor({ planet, starColor, camera, flyCamera, onLeave }) {
    this.planet = planet;
    this.starColor = starColor || new THREE.Color(1, 0.95, 0.8);
    this.camera = camera;
    this.flyCamera = flyCamera;
    this.onLeave = onLeave;
    this.terrain = null;
    this.water = null;
    this.atmosphere = null;
    this.sun = null;
    this.escListener = null;
  }

  build(mgr) {
    const p = this.planet;

    // ── Lighting ───────────────────────────────────────────────────
    const sunDir = new THREE.Vector3(0.5, 0.6, 0.3).normalize();
    const sun = new THREE.DirectionalLight(this.starColor, 1.4);
    sun.position.copy(sunDir).multiplyScalar(2000);
    mgr.threeScene.add(mgr.track(sun));

    // Ambient tinted by atmosphere
    const atmoColor = atmosphereColor(p);
    const ambient = new THREE.AmbientLight(
      new THREE.Color(atmoColor[0], atmoColor[1], atmoColor[2]).multiplyScalar(0.35),
      0.6
    );
    mgr.threeScene.add(mgr.track(ambient));

    // ── Terrain mesh ───────────────────────────────────────────────
    const SIZE = 2000, SEGMENTS = 256;
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
    this.terrain = new THREE.Mesh(geom, terrainMat);
    mgr.threeScene.add(mgr.track(this.terrain, p.biome + ' surface'));

    // ── Water plane (only where it makes sense) ────────────────────
    if (p.biome === BIOMES.OCEAN || p.biome === BIOMES.TEMPERATE) {
      const waterColor = p.biome === BIOMES.OCEAN
        ? new THREE.Color(0.1, 0.3, 0.55)
        : new THREE.Color(0.15, 0.4, 0.6);
      this.water = new THREE.Mesh(
        new THREE.PlaneGeometry(SIZE, SIZE, 1, 1).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({
          color: waterColor,
          transparent: true,
          opacity: 0.75,
          roughness: 0.2,
          metalness: 0.4,
        })
      );
      this.water.position.y = -2;
      mgr.threeScene.add(mgr.track(this.water));
    }

    // ── Lava glow for molten worlds ────────────────────────────────
    if (p.biome === BIOMES.MOLTEN) {
      const lava = new THREE.Mesh(
        new THREE.PlaneGeometry(SIZE, SIZE, 1, 1).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          color: 0xff5020,
          transparent: true,
          opacity: 0.55,
        })
      );
      lava.position.y = -8;
      mgr.threeScene.add(mgr.track(lava));
      // Tinted hellish ambient
      const hell = new THREE.AmbientLight(0xff3010, 0.4);
      mgr.threeScene.add(mgr.track(hell));
    }

    // ── Atmospheric dome (Rayleigh-ish horizon glow) ───────────────
    if (p.hasAtmosphere) {
      const atmGeom = new THREE.SphereGeometry(3000, 32, 32);
      const atmMat = new THREE.ShaderMaterial({
        uniforms: {
          horizonColor: { value: new THREE.Color(atmoColor[0], atmoColor[1], atmoColor[2]) },
          zenithColor:  { value: new THREE.Color(atmoColor[0]*0.2, atmoColor[1]*0.3, atmoColor[2]*0.55) },
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
            // Power curve weights horizon higher
            float horizonMix = pow(1.0 - h, 3.0);
            vec3 col = mix(zenithColor, horizonColor, horizonMix);
            // Sun glow
            float sunDot = max(0.0, dot(dir, normalize(sunDir)));
            col += sunColor * pow(sunDot, 32.0) * 1.5;
            col += sunColor * pow(sunDot, 6.0) * 0.25;
            gl_FragColor = vec4(col, 1.0);
          }
        `,
        side: THREE.BackSide,
        depthWrite: false,
      });
      this.atmosphere = new THREE.Mesh(atmGeom, atmMat);
      mgr.threeScene.add(mgr.track(this.atmosphere));
    } else {
      // Airless — show stars, dim horizon
      const blackDome = new THREE.Mesh(
        new THREE.SphereGeometry(3000, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0x000005, side: THREE.BackSide })
      );
      mgr.threeScene.add(mgr.track(blackDome));
    }

    // ── The sun in the sky (visible disc) ──────────────────────────
    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      color: this.starColor,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    sunSprite.scale.set(120, 120, 1);
    sunSprite.position.copy(sunDir).multiplyScalar(2500);
    mgr.threeScene.add(mgr.track(sunSprite));
    this.sun = sunSprite;

    // ── Position camera above terrain ──────────────────────────────
    const startX = 0, startZ = 0;
    const groundY = sampleTerrainHeight(p, startX, startZ);
    this.camera.position.set(startX, Math.max(groundY + 80, 60), startZ + 100);
    this.flyCamera.syncFromCameraPosition(new THREE.Vector3(startX, groundY, startZ));
    this.flyCamera.setScale(0.5); // slower on planet surface

    // ── Esc to return to space ─────────────────────────────────────
    this.escListener = (e) => {
      if (e.code === 'Escape' && this.onLeave) this.onLeave();
    };
    window.addEventListener('keydown', this.escListener);
  }

  update(dt) {
    // Soft collision: prevent flying through ground
    const cam = this.camera.position;
    const ground = sampleTerrainHeight(this.planet, cam.x, cam.z);
    const minHeight = ground + 5;
    if (cam.y < minHeight) {
      cam.y = minHeight;
      // dampen downward velocity
      if (this.flyCamera.vel.y < 0) this.flyCamera.vel.y = 0;
    }
  }

  dispose() {
    if (this.escListener) {
      window.removeEventListener('keydown', this.escListener);
    }
  }
}
