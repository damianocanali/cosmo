import * as THREE from 'three';
import {
  makeRng,
  hashString,
  derivePlanet,
  planetCount,
  starColorFromLifetime,
} from '../kernel/index.js';
import { getGlowTexture } from '../engine/renderer.js';

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

    // Planets — derived from kernel
    const N = planetCount(u, rng);
    for (let i = 0; i < N; i++) {
      const pData = derivePlanet(u, i);
      const mesh = this.makePlanetMesh(pData);
      mesh.position.set(
        Math.cos(pData.initialAngle) * pData.orbitRadius,
        (rng() - 0.5) * 2,
        Math.sin(pData.initialAngle) * pData.orbitRadius
      );

      if (pData.hasMoon) this.attachMoon(mesh, pData);

      mgr.threeScene.add(mgr.track(
        mesh,
        `Planet ${romanize(i + 1)} · ${pData.biome}`,
        'press L to land'
      ));
      mesh.userData.planetData = pData;

      const orbitSpeed = Math.sqrt(u.constants.G / Math.pow(pData.orbitRadius, 1.5)) * 0.5;
      this.planets.push({ mesh, planetData: pData, orbitSpeed, angle: pData.initialAngle });

      // Faint orbit ring
      const orbit = new THREE.Mesh(
        new THREE.RingGeometry(pData.orbitRadius - 0.1, pData.orbitRadius + 0.1, 128),
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

    // Position camera
    this.camera.position.set(0, 30, 100);
    this.flyCamera.syncFromCameraPosition(new THREE.Vector3(0, 0, 0));
    this.flyCamera.setScale(1);
  }

  makePlanetMesh(pData) {
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
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(pData.radius, 32, 32), mat);

    if (pData.hasRings) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(pData.radius * 1.4, pData.radius * 2.2, 64),
        new THREE.MeshBasicMaterial({
          color: 0xc8b890, side: THREE.DoubleSide, transparent: true, opacity: 0.4,
        })
      );
      ring.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.4;
      mesh.add(ring);
    }
    return mesh;
  }

  attachMoon(planetMesh, pData) {
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(pData.radius * 0.3, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xaaa090, roughness: 0.95 })
    );
    moon.position.set(pData.radius * 3, 0, 0);
    moon.userData.orbitSpeed = 1.5 + Math.random();
    planetMesh.add(moon);
    planetMesh.userData.moon = moon;
  }

  tryLand() {
    // Find planet under crosshair OR closest planet within range
    const target = this.mgr.findCrosshairTarget(this.camera);
    let chosen = null;
    if (target && target.object.userData.planetData) {
      chosen = target.object.userData.planetData;
    } else {
      // Fallback: closest planet within reasonable distance
      let bestDist = Infinity;
      for (const p of this.planets) {
        const d = this.camera.position.distanceTo(p.mesh.position);
        if (d < bestDist && d < p.planetData.radius * 20) {
          bestDist = d;
          chosen = p.planetData;
        }
      }
    }
    if (chosen && this.onLandRequest) {
      this.onLandRequest(chosen, this.starColor);
    }
  }

  update(dt, t) {
    for (const p of this.planets) {
      p.angle += p.orbitSpeed * dt;
      p.mesh.position.x = Math.cos(p.angle) * p.planetData.orbitRadius;
      p.mesh.position.z = Math.sin(p.angle) * p.planetData.orbitRadius;
      p.mesh.rotation.y += dt * p.planetData.rotationPeriod;
      const moon = p.mesh.userData.moon;
      if (moon) {
        const ma = t * moon.userData.orbitSpeed;
        const mr = p.planetData.radius * 3;
        moon.position.x = Math.cos(ma) * mr;
        moon.position.z = Math.sin(ma) * mr;
      }
    }
  }

  dispose() {
    if (this.landListener) {
      window.removeEventListener('keydown', this.landListener);
    }
  }
}

function romanize(n) {
  const r = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  return r[n] || '#' + n;
}
