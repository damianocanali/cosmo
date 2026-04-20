// Procedural terrain heightmap generation.
// Pure functions — given a seed and a 2D coordinate, return a height.
// Uses fractal Brownian motion of value noise. No external deps.

import { makeRng, hashString } from './rng.js';
import { BIOMES } from './planets.js';

// Hash a 2D integer coordinate to a value in [0, 1)
function hash2D(seed, x, y) {
  let h = seed >>> 0;
  h = Math.imul(h ^ x, 2246822519) >>> 0;
  h = Math.imul(h ^ y, 3266489917) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

// 2D value noise with smooth interpolation
function valueNoise2D(seed, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = x0 + 1, y1 = y0 + 1;
  const fx = smoothstep(x - x0), fy = smoothstep(y - y0);

  const v00 = hash2D(seed, x0, y0);
  const v10 = hash2D(seed, x1, y0);
  const v01 = hash2D(seed, x0, y1);
  const v11 = hash2D(seed, x1, y1);

  const a = v00 * (1 - fx) + v10 * fx;
  const b = v01 * (1 - fx) + v11 * fx;
  return a * (1 - fy) + b * fy;
}

// Fractal Brownian motion — sum noise at multiple scales
export function fbm2D(seed, x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum  += valueNoise2D(seed + i * 1013, x * freq, y * freq) * amp;
    norm += amp;
    amp  *= gain;
    freq *= lacunarity;
  }
  return sum / norm; // normalized to [0, 1]
}

// Per-biome terrain shape parameters
const BIOME_TERRAIN = {
  [BIOMES.MOLTEN]:    { amplitude: 0.6, octaves: 4, ridged: true,  baseLevel: 0.3 },
  [BIOMES.DESERT]:    { amplitude: 0.4, octaves: 5, ridged: false, baseLevel: 0.4 },
  [BIOMES.TEMPERATE]: { amplitude: 0.5, octaves: 6, ridged: false, baseLevel: 0.5 },
  [BIOMES.OCEAN]:     { amplitude: 0.7, octaves: 6, ridged: false, baseLevel: 0.3 },
  [BIOMES.GAS_GIANT]: { amplitude: 0.2, octaves: 3, ridged: false, baseLevel: 0.5 },
  [BIOMES.ICE]:       { amplitude: 0.5, octaves: 5, ridged: true,  baseLevel: 0.6 },
};

// Sample terrain height at world coordinate (x, z) for a given planet
export function sampleTerrainHeight(planet, x, z) {
  const params = BIOME_TERRAIN[planet.biome] || BIOME_TERRAIN[BIOMES.TEMPERATE];
  const scale = 0.008;
  let n = fbm2D(planet.seed, x * scale, z * scale, params.octaves);
  if (params.ridged) {
    n = 1 - Math.abs(n * 2 - 1); // ridged turbulence
  }
  return (n - params.baseLevel) * params.amplitude * 60;
}

// Color palettes per biome — height-based
const BIOME_COLORS = {
  [BIOMES.MOLTEN]: [
    { h: -50, color: [0.15, 0.05, 0.05] },  // cooled crust
    { h:  0,  color: [0.4,  0.1,  0.05] },  // dark rock
    { h:  10, color: [0.8,  0.3,  0.1] },   // glowing magma
    { h:  25, color: [1.0,  0.6,  0.2] },   // hot peaks
  ],
  [BIOMES.DESERT]: [
    { h: -50, color: [0.5, 0.35, 0.2] },
    { h:  0,  color: [0.75, 0.55, 0.3] },
    { h:  15, color: [0.85, 0.7,  0.4] },
    { h:  30, color: [0.6, 0.4,  0.25] },
  ],
  [BIOMES.TEMPERATE]: [
    { h: -10, color: [0.1,  0.25, 0.5] },   // shallow water
    { h:  0,  color: [0.7,  0.65, 0.4] },   // beach
    { h:  5,  color: [0.25, 0.45, 0.15] },  // lowland green
    { h:  20, color: [0.35, 0.3,  0.2] },   // foothills
    { h:  35, color: [0.9,  0.9,  0.95] },  // snow peaks
  ],
  [BIOMES.OCEAN]: [
    { h: -50, color: [0.05, 0.1,  0.3] },
    { h: -10, color: [0.1,  0.3,  0.55] },
    { h:  0,  color: [0.3,  0.55, 0.7] },
    { h:  5,  color: [0.7,  0.7,  0.5] },
    { h:  20, color: [0.4,  0.5,  0.3] },
  ],
  [BIOMES.GAS_GIANT]: [
    { h: -20, color: [0.7, 0.5,  0.3] },
    { h:  0,  color: [0.85, 0.7,  0.45] },
    { h:  10, color: [0.95, 0.85, 0.7] },
  ],
  [BIOMES.ICE]: [
    { h: -50, color: [0.3, 0.4,  0.55] },
    { h:  0,  color: [0.7, 0.8,  0.9] },
    { h:  15, color: [0.95, 0.97, 1.0] },
  ],
};

export function colorAtHeight(biome, height) {
  const palette = BIOME_COLORS[biome] || BIOME_COLORS[BIOMES.TEMPERATE];
  // Find the two stops bracketing this height
  for (let i = 0; i < palette.length - 1; i++) {
    const a = palette[i], b = palette[i + 1];
    if (height >= a.h && height <= b.h) {
      const t = (height - a.h) / (b.h - a.h);
      return [
        a.color[0] + (b.color[0] - a.color[0]) * t,
        a.color[1] + (b.color[1] - a.color[1]) * t,
        a.color[2] + (b.color[2] - a.color[2]) * t,
      ];
    }
  }
  if (height < palette[0].h) return palette[0].color;
  return palette[palette.length - 1].color;
}

// Atmosphere color based on biome and parent star color
export function atmosphereColor(planet) {
  switch (planet.biome) {
    case BIOMES.TEMPERATE: return [0.4, 0.6, 0.95];
    case BIOMES.OCEAN:     return [0.3, 0.55, 0.9];
    case BIOMES.DESERT:    return [0.85, 0.65, 0.4];
    case BIOMES.MOLTEN:    return [0.7, 0.2, 0.1];
    case BIOMES.GAS_GIANT: return [0.85, 0.7, 0.5];
    case BIOMES.ICE:       return [0.6, 0.75, 0.9];
    default:               return [0.5, 0.6, 0.8];
  }
}
