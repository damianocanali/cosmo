import * as THREE from 'three';
import {
  makeRng,
  hashString,
  derivePlanet,
  planetCount,
  starColorFromLifetime,
} from '../kernel/index.js';
import { getGlowTexture } from '../engine/renderer.js';

// Visual scale multipliers — kernel radii stay pure (used for gravity,
// determinism). Renderer blows them up so planets read as massive bodies
// instead of pebbles. Keep PLANET_SCALE and ORBIT_SCALE in lock-step so
// the system fits the same camera framing.
const PLANET_SCALE = 3;
const ORBIT_SCALE = 3;

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

    const light = new THREE.PointLight(starColor, 2, 0, 0);
    star.add(light);
    mgr.threeScene.add(mgr.track(new THREE.AmbientLight(0x202028, 0.3)));

    // Planets — derived from kernel. Display radius is the kernel radius
    // blown up by PLANET_SCALE; orbit radii scale in lock-step. Store both
    // on the tracked record so landing/radar/orbit logic uses the display
    // values consistently.
    const N = planetCount(u, rng);
    for (let i = 0; i < N; i++) {
      const pData = derivePlanet(u, i);
      const displayR = pData.radius * PLANET_SCALE;
      const displayOrbit = pData.orbitRadius * ORBIT_SCALE;
      const mesh = this.makePlanetMesh(pData, displayR);
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

    // Position camera — pulled back only ~1.5× of original despite the 3×
    // planet scale, so planets visually dominate the frame instead of just
    // filling the same proportion as before.
    this.camera.position.set(0, 45, 150);
    this.flyCamera.syncFromCameraPosition(new THREE.Vector3(0, 0, 0));
    this.flyCamera.setScale(1);
  }

  makePlanetMesh(pData, displayR) {
    const colorMap = {
      molten:    new THREE.Color().setHSL(0.04, 0.7, 0.35),
      desert:    new THREE.Color().setHSL(0.08, 0.5, 0.5),
      temperate: new THREE.Color().setHSL(0.32, 0.5, 0.45),
      ocean:     new THREE.Color().setHSL(0.58, 0.5, 0.4),
      gas_giant: new THREE.Color().setHSL(0.55, 0.4, 0.55),
      ice:       new THREE.Color().setHSL(0.55, 0.15, 0.8),
    };
    const mat = new THREE.MeshStandardMaterial({
      color: colorMap[pData.biome] || colorMap.temperate,
      roughness: 0.85,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(displayR, 48, 48), mat);

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
    return mesh;
  }

  attachMoon(planetMesh, displayR) {
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(displayR * 0.3, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0xaaa090, roughness: 0.95 })
    );
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

    // Proximity slowdown: ramps up as the ship approaches a planet so it
    // doesn't fly past at boost speed. Influence zone scales with planet size
    // (well-of-influence ~= 4 planet radii), capping at 4× drag at the surface.
    if (this.flyCamera?.setProximitySlowdown) {
      const refRange = 60; // units — distance at which slowdown starts
      const t01 = Math.max(0, 1 - nearestSurfaceDist / refRange);
      this.flyCamera.setProximitySlowdown(1 + t01 * 3);
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
