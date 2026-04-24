import * as THREE from 'three';
import {
  makeRng,
  hashString,
  derivePlanet,
  planetCount,
  starColorFromLifetime,
} from '../kernel/index.js';
import { getGlowTexture } from '../engine/renderer.js';
import { buildAtmosphere, atmosphereTintForBiome } from '../engine/atmosphereShader.js';
import { buildPlanetMaps } from '../engine/proceduralTextures.js';

// Visual scale multipliers — kernel radii stay pure (used for gravity,
// determinism). Renderer blows them up so planets read as massive bodies.
// PLANET_SCALE is intentionally larger than ORBIT_SCALE so planets visually
// dominate the frame even as they orbit at wider system radii.
const PLANET_SCALE = 6;
const ORBIT_SCALE = 4;

export class SolarSystemScene {
  constructor({ universe, camera, flyCamera, onLandRequest }) {
    this.universe = universe;
    this.camera = camera;
    this.flyCamera = flyCamera;
    this.onLandRequest = onLandRequest; // (planet) => void
    this.planets = []; // {mesh, planetData, orbitRadius, orbitSpeed, angle}
    this.star = null;
  }

  build(mgr) {
    this.mgr = mgr;
    const u = this.universe;
    const rng = makeRng(hashString(u.id + '|solar'));

    // The central star
    const starMass = u.stellar.typicalStarMass * 2;
    const starRadius = Math.pow(starMass, 0.4) * 8;
    const lifetimeRatio = (u.stellar.sunLifetime / 1e10)
      / Math.pow(starMass / u.stellar.typicalStarMass, 2.5);
    const c = starColorFromLifetime(lifetimeRatio);
    const starColor = new THREE.Color(c.r, c.g, c.b);

    const star = new THREE.Mesh(
      new THREE.SphereGeometry(starRadius, 48, 48),
      new THREE.MeshBasicMaterial({ color: starColor })
    );
    mgr.threeScene.add(mgr.track(star, 'Central Star'));
    this.star = star;
    this.starColor = starColor;
    this.starRadius = starRadius;

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTexture(),
      color: starColor,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    glow.scale.set(starRadius * 8, starRadius * 8, 1);
    star.add(glow);

    // Key light — the star itself. Boosted to 10 because ACES expects
    // physically-higher light levels; the old intensity 2 reads as flat under
    // the new tonemapping. Casts shadows onto planets and moons.
    const light = new THREE.PointLight(starColor, 10, 0, 0);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.camera.near = 1;
    light.shadow.camera.far = 4000;
    light.shadow.bias = -0.0005;
    star.add(light);

    // Hemispheric fill — replaces the old AmbientLight. Sky color picks up
    // a cool tint of the star color, ground color is a warm rust. Keeps the
    // shadow side of planets visible without looking flat-ambient-lit.
    const skyHex = new THREE.Color(starColor).lerp(new THREE.Color(0x4a5878), 0.5).getHex();
    const fill = new THREE.HemisphereLight(skyHex, 0x2a1810, 0.25);
    mgr.threeScene.add(mgr.track(fill));

    // Rim light — a dim directional from the side opposite the star, so
    // planet/ship silhouettes get a cool edge highlight even in shadow.
    const rim = new THREE.DirectionalLight(0xe0f0ff, 0.3);
    rim.position.set(-100, 40, -100);
    mgr.threeScene.add(mgr.track(rim));

    // Planets — derived from kernel. Display radius is the kernel radius
    // blown up by PLANET_SCALE; orbit radii scale in lock-step. Store both
    // on the tracked record so landing/radar/orbit logic uses the display
    // values consistently.
    const N = planetCount(u, rng);
    for (let i = 0; i < N; i++) {
      const pData = derivePlanet(u, i);
      const displayR = pData.radius * PLANET_SCALE;
      const displayOrbit = pData.orbitRadius * ORBIT_SCALE;
      const planetSeed = hashString(u.id + '|planet|' + i);
      const mesh = this.makePlanetMesh(pData, displayR, planetSeed);
      mesh.position.set(
        Math.cos(pData.initialAngle) * displayOrbit,
        (rng() - 0.5) * 2 * PLANET_SCALE,
        Math.sin(pData.initialAngle) * displayOrbit
      );

      if (pData.hasMoon) this.attachMoon(mesh, displayR);

      mgr.threeScene.add(mgr.track(
        mesh,
        `Planet ${romanize(i + 1)} · ${pData.biome}`,
        'press L to land'
      ));
      mesh.userData.planetData = pData;
      mesh.userData.displayRadius = displayR;

      const orbitSpeed = Math.sqrt(u.constants.G / Math.pow(pData.orbitRadius, 1.5)) * 0.5;
      this.planets.push({
        mesh, planetData: pData, orbitSpeed, angle: pData.initialAngle,
        displayRadius: displayR, displayOrbit,
      });

      // Faint orbit ring
      const orbit = new THREE.Mesh(
        new THREE.RingGeometry(displayOrbit - 0.2, displayOrbit + 0.2, 160),
        new THREE.MeshBasicMaterial({
          color: 0x3a3024, side: THREE.DoubleSide, transparent: true, opacity: 0.3,
        })
      );
      orbit.rotation.x = Math.PI / 2;
      mgr.threeScene.add(mgr.track(orbit));
    }

    // Land key handler
    this.landListener = (e) => {
      if (e.code === 'KeyL') this.tryLand();
    };
    window.addEventListener('keydown', this.landListener);

    // Position camera close enough that the inner planets visibly dominate
    // the frame on first arrival. With PLANET_SCALE=6, a small (r=3) planet
    // displays as r=18; at this camera distance it fills ~25% of the screen
    // when overhead.
    this.camera.position.set(0, 35, 90);
    this.flyCamera.syncFromCameraPosition(new THREE.Vector3(0, 0, 0));
    this.flyCamera.setScale(1);
  }

  makePlanetMesh(pData, displayR, seed) {
    const { albedo, normal } = buildPlanetMaps(pData.biome, seed);
    const mat = new THREE.MeshStandardMaterial({
      map: albedo,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.85,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(displayR, 64, 64), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    if (pData.hasRings) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(displayR * 1.4, displayR * 2.2, 96),
        new THREE.MeshBasicMaterial({
          color: 0xc8b890, side: THREE.DoubleSide, transparent: true, opacity: 0.4,
        })
      );
      ring.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.4;
      mesh.add(ring);
    }
    const tint = atmosphereTintForBiome(pData.biome);
    if (tint !== null) {
      mesh.add(buildAtmosphere(displayR, tint, 1.0));
    }
    return mesh;
  }

  attachMoon(planetMesh, displayR) {
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(displayR * 0.3, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0xaaa090, roughness: 0.95 })
    );
    moon.castShadow = true;
    moon.receiveShadow = true;
    moon.position.set(displayR * 3, 0, 0);
    moon.userData.orbitSpeed = 1.5 + Math.random();
    moon.userData.orbitRadius = displayR * 3;
    planetMesh.add(moon);
    planetMesh.userData.moon = moon;
  }

  tryLand() {
    // Landing corridor: center distance between planet.radius + 1 and + 20.
    // Outside that band, flash a hint.
    const hud = document.getElementById('target');
    const hint = document.getElementById('targetHint');
    const flash = (msg) => {
      if (!hud || !hint) return;
      hint.textContent = msg;
      hud.classList.add('show');
      clearTimeout(this._flashT);
      this._flashT = setTimeout(() => { hint.textContent = ''; }, 900);
    };

    // Find the closest planet first.
    let best = null;
    let bestDist = Infinity;
    for (const p of this.planets) {
      const d = this.camera.position.distanceTo(p.mesh.position);
      if (d < bestDist) { bestDist = d; best = p; }
    }
    if (!best) return;

    const r = best.displayRadius;
    const surfaceDist = bestDist - r;

    if (best.planetData.biome === 'gas_giant') {
      flash('atmosphere too deep — cannot land');
      return;
    }
    // Corridor scales with planet size so big and small planets feel the same.
    if (surfaceDist > r * 1.5) {
      flash('too far — approach the planet');
      return;
    }
    if (surfaceDist < r * 0.1) {
      flash('too close — pull up');
      return;
    }

    if (this.onLandRequest) {
      this.onLandRequest(best.planetData, this.starColor);
    }
  }

  update(dt, t) {
    let nearestSurfaceDist = Infinity;
    for (const p of this.planets) {
      p.angle += p.orbitSpeed * dt;
      p.mesh.position.x = Math.cos(p.angle) * p.displayOrbit;
      p.mesh.position.z = Math.sin(p.angle) * p.displayOrbit;
      p.mesh.rotation.y += dt * p.planetData.rotationPeriod;
      const moon = p.mesh.userData.moon;
      if (moon) {
        const ma = t * moon.userData.orbitSpeed;
        const mr = moon.userData.orbitRadius;
        moon.position.x = Math.cos(ma) * mr;
        moon.position.z = Math.sin(ma) * mr;
      }
      const d = this.camera.position.distanceTo(p.mesh.position) - p.displayRadius;
      if (d < nearestSurfaceDist) nearestSurfaceDist = d;
    }

    // Proximity slowdown: actively grabs the ship as it nears a planet so
    // you don't fly past landing distance. Range and intensity tuned to feel
    // like real gravity wells — by the time you're at the landing corridor,
    // drag is ~10× normal and you settle into a hover almost on its own.
    if (this.flyCamera?.setProximitySlowdown) {
      const refRange = 120; // units — gravity-well influence radius
      const t01 = Math.max(0, 1 - nearestSurfaceDist / refRange);
      // Quadratic ramp — gentle at the edges, strong near the surface.
      this.flyCamera.setProximitySlowdown(1 + t01 * t01 * 9);
    }
  }

  getMapData() {
    return {
      title: 'Local Chart',
      star: { pos: this.star.position, color: this.starColor },
      planets: this.planets.map((p) => ({
        pos: p.mesh.position,
        biome: p.planetData.biome,
      })),
    };
  }

  getStarWorldPosition() {
    return this.star ? this.star.position : null;
  }

  dispose() {
    if (this.landListener) {
      window.removeEventListener('keydown', this.landListener);
    }
    // Don't bleed gravity-well drag into the next scene (galaxy/blackhole).
    if (this.flyCamera?.setProximitySlowdown) {
      this.flyCamera.setProximitySlowdown(1);
    }
  }
}

function romanize(n) {
  const r = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  return r[n] || '#' + n;
}
