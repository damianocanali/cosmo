// Pure function: given the universe's physics and an orbit slot,
// derive a planet's properties. No Three.js. Used by both the
// solar system view (to position planets) and the surface view
// (to drive terrain colors and atmosphere).

import { makeRng, hashString } from './rng.js';

const BIOMES = {
  MOLTEN:    'molten',
  DESERT:    'desert',
  TEMPERATE: 'temperate',
  OCEAN:     'ocean',
  GAS_GIANT: 'gas_giant',
  ICE:       'ice',
};

export function derivePlanet(universe, orbitSlot, parentSeed = 'solar') {
  const seed = hashString(`${universe.id}|${parentSeed}|planet|${orbitSlot}`);
  const rng = makeRng(seed);

  // Habitable distance in game units. Tuned so vanilla (G=1) puts
  // slots 0–1 hot, 2–3 in/near temperate, and outer slots cold.
  const habitableDist = universe.stellar.habitableZoneAU * 60;
  // Orbits start close to the star and spread outward.
  const orbitRadius = 12 + 14 * Math.pow(orbitSlot, 1.5) + rng() * 6;

  // Heavier gravity → smaller, denser planets
  const G = universe.constants.G;
  const radius = (1 + rng() * 4) / Math.pow(G, 0.4);

  const ratio = orbitRadius / habitableDist;
  let biome;
  if (ratio < 0.5)      biome = BIOMES.MOLTEN;
  else if (ratio < 0.8) biome = BIOMES.DESERT;
  else if (ratio < 1.3) biome = rng() < 0.5 ? BIOMES.TEMPERATE : BIOMES.OCEAN;
  else if (ratio < 2.5) biome = BIOMES.GAS_GIANT;
  else                  biome = BIOMES.ICE;

  return {
    id: `${universe.id}|p${orbitSlot}`,
    seed,
    orbitSlot,
    orbitRadius,
    radius,
    biome,
    hasRings: rng() < 0.25 && radius > 2.5,
    hasMoon:  rng() < 0.4,
    hasAtmosphere: biome !== BIOMES.MOLTEN && biome !== BIOMES.ICE && rng() < 0.85,
    rotationPeriod: 0.2 + rng() * 0.5,
    initialAngle: rng() * Math.PI * 2,
  };
}

export function planetCount(universe, rng) {
  const base = 3 + universe.stellar.stellarDensity * 1.5;
  return Math.max(2, Math.min(9, Math.floor(base + rng() * 2)));
}

export { BIOMES };
