// Procedural astronaut geometry — primitives only, flat-shaded.
// Two builders:
//   - buildAstronautBody(): full figure for 3rd-person view
//   - buildAstronautHands(): two gloved hands for 1st-person view (parented to camera)
//
// Palette mirrors the ship (cyan accents, amber visor glow) so the avatar
// reads as "crew of this vessel" rather than a separate prop.

import * as THREE from 'three';

const SUIT = new THREE.MeshStandardMaterial({
  color: 0xc8c0b0, roughness: 0.6, metalness: 0.1, flatShading: true,
});
const SUIT_DARK = new THREE.MeshStandardMaterial({
  color: 0x2a2a30, roughness: 0.7, metalness: 0.2, flatShading: true,
});
const VISOR = new THREE.MeshStandardMaterial({
  color: 0x202830, roughness: 0.15, metalness: 0.9,
  emissive: 0xffb060, emissiveIntensity: 0.3,
});
const ACCENT = new THREE.MeshStandardMaterial({
  color: 0x88d0ff, emissive: 0x66aaff, emissiveIntensity: 1.4, roughness: 0.3,
});

export function buildAstronautBody() {
  const root = new THREE.Group();
  root.name = 'Astronaut';

  // Torso — capsule (cylinder + hemispheres) roughly 0.8 wide × 1.0 tall
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.38, 0.6, 4, 8),
    SUIT
  );
  torso.position.y = 1.0;
  root.add(torso);

  // Helmet — sphere with visor strip
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 16, 12),
    SUIT
  );
  helmet.position.y = 1.7;
  root.add(helmet);

  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.305, 16, 12, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.25),
    VISOR
  );
  visor.position.y = 1.7;
  root.add(visor);

  // Chest accent light
  const chestLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 8),
    ACCENT
  );
  chestLight.position.set(0, 1.2, 0.34);
  root.add(chestLight);

  // Arms — cylinders
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.09, 0.8, 8),
      SUIT
    );
    arm.position.set(side * 0.45, 0.95, 0);
    arm.rotation.z = side * 0.12;
    root.add(arm);

    const glove = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 8, 8),
      SUIT_DARK
    );
    glove.position.set(side * 0.52, 0.55, 0);
    root.add(glove);
  }

  // Legs — cylinders
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.11, 0.9, 8),
      SUIT_DARK
    );
    leg.position.set(side * 0.2, 0.25, 0);
    root.add(leg);
  }

  // Backpack (simple box) — reads as jetpack/life support
  const pack = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.6, 0.22),
    SUIT_DARK
  );
  pack.position.set(0, 1.1, -0.38);
  root.add(pack);

  root.userData.chestLight = chestLight;
  return root;
}

export function buildAstronautHands() {
  const root = new THREE.Group();
  root.name = 'AstronautHands';

  // Hands sit slightly forward and below the camera, in the corners of view.
  // Each hand is a wedge (box) + thumb (small box). No articulated fingers —
  // the silhouette reads as a gloved hand.
  for (const side of [-1, 1]) {
    const hand = new THREE.Group();

    const palm = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.1, 0.22),
      SUIT_DARK
    );
    hand.add(palm);

    const thumb = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.04, 0.12),
      SUIT_DARK
    );
    thumb.position.set(side * 0.1, 0, 0.02);
    hand.add(thumb);

    // Wrist band — cyan accent, like the ship's running lights
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(0.19, 0.11, 0.03),
      ACCENT
    );
    band.position.z = -0.11;
    hand.add(band);

    hand.position.set(side * 0.35, -0.28, -0.55);
    hand.rotation.set(-0.2, side * 0.15, 0);
    root.add(hand);
  }

  return root;
}
