// Procedural ship geometry. Low-poly, clean lines, emissive accents.
// All primitives — no external models. Easy to restyle by tweaking colors.

import * as THREE from 'three';

export function buildShipModel() {
  const root = new THREE.Group();
  root.name = 'Ship';

  // Shared materials — keep palette tight
  const hull = new THREE.MeshStandardMaterial({
    color: 0x2a2a30,
    roughness: 0.6,
    metalness: 0.7,
    flatShading: true,
  });
  const hullAccent = new THREE.MeshStandardMaterial({
    color: 0x5a5a68,
    roughness: 0.4,
    metalness: 0.8,
    flatShading: true,
  });
  const cockpitGlass = new THREE.MeshStandardMaterial({
    color: 0x88a8c8,
    roughness: 0.1,
    metalness: 0.6,
    transparent: true,
    opacity: 0.55,
    envMapIntensity: 1.2,
  });
  const emissiveCyan = new THREE.MeshStandardMaterial({
    color: 0x88d0ff,
    emissive: 0x66aaff,
    emissiveIntensity: 2.5,
    roughness: 0.3,
  });
  const emissiveAmber = new THREE.MeshStandardMaterial({
    color: 0xffb060,
    emissive: 0xff8030,
    emissiveIntensity: 1.8,
    roughness: 0.3,
  });
  const engineGlow = new THREE.MeshBasicMaterial({
    color: 0x66aaff,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
  });

  // ── Main fuselage ─────────────────────────────────────────────
  // An elongated octahedral wedge — sleek from the front, flared at the back.
  const fuselageShape = new THREE.BufferGeometry();
  const fuselageVerts = new Float32Array([
    // front point
     0,   0,  -6,
    // mid ring (4 verts) at z = 0
     2,   0.6, 0,
    -2,   0.6, 0,
    -2,  -0.6, 0,
     2,  -0.6, 0,
    // back ring (4 verts) at z = 4
     2.5, 1.2, 4,
    -2.5, 1.2, 4,
    -2.5,-1.2, 4,
     2.5,-1.2, 4,
  ]);
  const fuselageIdx = new Uint16Array([
    // front cone (front point to mid ring)
    0, 2, 1,
    0, 3, 2,
    0, 4, 3,
    0, 1, 4,
    // mid → back (two tris per side)
    1, 2, 6,  1, 6, 5,
    2, 3, 7,  2, 7, 6,
    3, 4, 8,  3, 8, 7,
    4, 1, 5,  4, 5, 8,
    // back cap (the thruster plate)
    5, 6, 7,
    5, 7, 8,
  ]);
  fuselageShape.setAttribute('position', new THREE.BufferAttribute(fuselageVerts, 3));
  fuselageShape.setIndex(new THREE.BufferAttribute(fuselageIdx, 1));
  fuselageShape.computeVertexNormals();
  const fuselage = new THREE.Mesh(fuselageShape, hull);
  root.add(fuselage);

  // ── Wings ─────────────────────────────────────────────────────
  // Swept-back triangular wings
  const wingGeom = new THREE.BufferGeometry();
  const wingVerts = new Float32Array([
    0, 0, 0,    // root front
    0, 0, 3,    // root back
    4, 0, 3.5,  // tip
  ]);
  const wingIdx = new Uint16Array([0, 1, 2,  0, 2, 1]); // both sides
  wingGeom.setAttribute('position', new THREE.BufferAttribute(wingVerts, 3));
  wingGeom.setIndex(new THREE.BufferAttribute(wingIdx, 1));
  wingGeom.computeVertexNormals();

  const wingR = new THREE.Mesh(wingGeom, hullAccent);
  wingR.position.set(1.8, -0.3, 0.2);
  root.add(wingR);

  const wingL = new THREE.Mesh(wingGeom, hullAccent);
  wingL.scale.x = -1;
  wingL.position.set(-1.8, -0.3, 0.2);
  root.add(wingL);

  // Wingtip running lights
  const lightR = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 8, 8),
    emissiveAmber
  );
  lightR.position.set(5.6, -0.3, 3.5);
  root.add(lightR);

  const lightL = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 8, 8),
    emissiveCyan
  );
  lightL.position.set(-5.6, -0.3, 3.5);
  root.add(lightL);

  // ── Cockpit canopy ────────────────────────────────────────────
  // A half-ellipsoid on top, glazed
  const canopyGeom = new THREE.SphereGeometry(
    1.4, 16, 12,
    0, Math.PI * 2, 0, Math.PI / 2
  );
  canopyGeom.scale(1.0, 0.7, 1.8);
  const canopy = new THREE.Mesh(canopyGeom, cockpitGlass);
  canopy.position.set(0, 0.55, -1.3);
  root.add(canopy);

  // ── Engines ───────────────────────────────────────────────────
  // Twin engine nacelles at the back with glowing cores
  for (const side of [-1, 1]) {
    const nacelle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.9, 2.4, 8),
      hullAccent
    );
    nacelle.rotation.x = Math.PI / 2;
    nacelle.position.set(side * 1.6, 0, 4.4);
    root.add(nacelle);

    // Glowing engine nozzle
    const nozzle = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 16),
      engineGlow
    );
    nozzle.position.set(side * 1.6, 0, 5.6);
    nozzle.rotation.y = Math.PI; // face backward
    root.add(nozzle);
  }

  // Point lights for engine glow (cheap — max 2)
  const engineLight = new THREE.PointLight(0x66aaff, 2, 20);
  engineLight.position.set(0, 0, 5.5);
  root.add(engineLight);
  root.userData.engineLight = engineLight;

  // ── Engine flame trails ──────────────────────────────────────
  // Cone points along +Z (backward from the ship) — wide at the engine
  // exhaust, narrow at the tip. Additive blending makes it read as light.
  // Scale.z is driven by throttle every frame.
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0xaaddff,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const flameCoreMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const engineFlames = [];
  for (const side of [-1, 1]) {
    // Outer bluish cone
    const outer = new THREE.Mesh(
      new THREE.ConeGeometry(0.55, 3.5, 10, 1, true),
      flameMat.clone()
    );
    outer.rotation.x = Math.PI / 2; // flip so apex points +Z (backward)
    outer.position.set(side * 1.6, 0, 5.9 + 1.75);
    root.add(outer);
    // Inner white-hot core, shorter and narrower
    const core = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 2.0, 8, 1, true),
      flameCoreMat.clone()
    );
    core.rotation.x = Math.PI / 2;
    core.position.set(side * 1.6, 0, 5.9 + 1.0);
    root.add(core);
    engineFlames.push({ outer, core });
  }
  root.userData.engineFlames = engineFlames;

  // Store references for animation
  root.userData.wingLightR = lightR;
  root.userData.wingLightL = lightL;

  return root;
}
