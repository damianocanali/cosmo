// Deterministic surface scatter: rocks, vegetation, crystals.
// Pure function — given a planet and a world region, return the list of
// objects to place there. The rendering layer turns these into InstancedMeshes.

import { makeRng, hashString } from './rng.js';
import { sampleTerrainHeight, seaLevelFor } from './terrain.js';
import { BIOMES } from './planets.js';

// Scatter types the renderer knows how to draw.
export const SCATTER_TYPES = {
  ROCK_SMALL:   'rock_small',
  ROCK_LARGE:   'rock_large',
  TREE_CONIFER: 'tree_conifer',
  TREE_BROAD:   'tree_broad',
  GRASS_TUFT:   'grass_tuft',
  ICE_SHARD:    'ice_shard',
  LAVA_SPIRE:   'lava_spire',
  CACTUS:       'cactus',
};

// What each biome scatters. Densities are "per 1000 unit² quadrant".
const BIOME_SCATTER = {
  [BIOMES.TEMPERATE]: [
    { type: SCATTER_TYPES.TREE_BROAD,   density: 40, minH: 2,  maxH: 40 },
    { type: SCATTER_TYPES.TREE_CONIFER, density: 25, minH: 25, maxH: 70 },
    { type: SCATTER_TYPES.ROCK_SMALL,   density: 35, minH: 1,  maxH: 80 },
    { type: SCATTER_TYPES.ROCK_LARGE,   density: 6,  minH: 15, maxH: 70 },
    { type: SCATTER_TYPES.GRASS_TUFT,   density: 120, minH: 2, maxH: 35 },
  ],
  [BIOMES.DESERT]: [
    { type: SCATTER_TYPES.ROCK_SMALL,   density: 40, minH: -20, maxH: 80 },
    { type: SCATTER_TYPES.ROCK_LARGE,   density: 10, minH: 0,   maxH: 60 },
    { type: SCATTER_TYPES.CACTUS,       density: 12, minH: -5,  maxH: 30 },
  ],
  [BIOMES.MOLTEN]: [
    { type: SCATTER_TYPES.LAVA_SPIRE,   density: 18, minH: 10, maxH: 70 },
    { type: SCATTER_TYPES.ROCK_LARGE,   density: 15, minH: 0,  maxH: 50 },
    { type: SCATTER_TYPES.ROCK_SMALL,   density: 30, minH: -5, maxH: 80 },
  ],
  [BIOMES.ICE]: [
    { type: SCATTER_TYPES.ICE_SHARD,    density: 25, minH: 0,  maxH: 70 },
    { type: SCATTER_TYPES.ROCK_SMALL,   density: 15, minH: 0,  maxH: 60 },
  ],
  [BIOMES.OCEAN]: [
    // Sparse — mostly water, some rocks on islands
    { type: SCATTER_TYPES.ROCK_SMALL,   density: 20, minH: 10, maxH: 60 },
    { type: SCATTER_TYPES.ROCK_LARGE,   density: 4,  minH: 15, maxH: 50 },
    { type: SCATTER_TYPES.GRASS_TUFT,   density: 30, minH: 12, maxH: 30 },
  ],
  [BIOMES.GAS_GIANT]: [
    // No surface to stand on — leave empty
  ],
};

/**
 * Generate scatter instances for a rectangular world region.
 * Deterministic: same planet + region always produces the same scatter.
 * Returns: Array<{ type, x, y, z, scale, rotation, tint: [r,g,b] }>
 */
export function generateScatter(planet, minX, minZ, maxX, maxZ) {
  const entries = BIOME_SCATTER[planet.biome];
  if (!entries || entries.length === 0) return [];

  const results = [];
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const area = (width * depth) / 1000; // per 1000 unit²
  const seaLevel = seaLevelFor(planet);

  // Each scatter entry gets its own deterministic RNG stream for stability.
  for (const entry of entries) {
    const count = Math.floor(entry.density * area);
    const streamSeed = hashString(`${planet.id}|scatter|${entry.type}|${minX}|${minZ}`);
    const rng = makeRng(streamSeed);

    for (let i = 0; i < count; i++) {
      const x = minX + rng() * width;
      const z = minZ + rng() * depth;
      const y = sampleTerrainHeight(planet, x, z);

      // Don't place on underwater or steep ground
      if (y < seaLevel + 0.5) continue;
      if (y < entry.minH || y > entry.maxH) continue;

      // Quick slope check: how much does height change over a small step?
      const dx = sampleTerrainHeight(planet, x + 2, z) - y;
      const dz = sampleTerrainHeight(planet, x, z + 2) - y;
      const slope = Math.sqrt(dx * dx + dz * dz);
      if (slope > 3) continue; // too steep — skip

      const scale = 0.7 + rng() * 0.8;
      const rotation = rng() * Math.PI * 2;
      const tintVar = 0.85 + rng() * 0.3;

      results.push({
        type: entry.type,
        x, y, z, scale, rotation,
        tint: [tintVar, tintVar, tintVar],
      });
    }
  }
  return results;
}
