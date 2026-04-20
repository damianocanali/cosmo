// Procedural terrain heightmap generation — multi-scale.
// The trick: layer several FBM samples at vastly different frequencies so the
// world has continents, mountain ranges, foothills, AND surface detail.
// Pure functions. Portable.

import { makeRng, hashString } from './rng.js';
import { BIOMES } from './planets.js';

function hash2D(seed, x, y) {
  let h = seed >>> 0;
  h = Math.imul(h ^ x, 2246822519) >>> 0;
  h = Math.imul(h ^ y, 3266489917) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function smoothstep(t) { return t * t * (3 - 2 * t); }

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

export function fbm2D(seed, x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum  += valueNoise2D(seed + i * 1013, x * freq, y * freq) * amp;
    norm += amp;
    amp  *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

// Ridged noise — good for mountain spines and ice cracks.
function ridgedFbm(seed, x, y, octaves = 5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = valueNoise2D(seed + i * 1013, x * freq, y * freq);
    sum  += (1 - Math.abs(n * 2 - 1)) * amp;
    norm += amp;
    amp  *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// Per-biome terrain tuning.
// continent: huge slow features that define land vs sea
// range:     mid-scale ridged mountains
// detail:    high-frequency surface bumpiness
const BIOME_TERRAIN = {
  [BIOMES.MOLTEN]: {
    continentScale: 0.0008, continentAmp: 40,
    rangeScale:     0.004,  rangeAmp:     55,
    detailScale:    0.03,   detailAmp:    4,
    ridgedRanges: true, seaLevel: 5,
  },
  [BIOMES.DESERT]: {
    continentScale: 0.0006, continentAmp: 45,
    rangeScale:     0.003,  rangeAmp:     35,
    detailScale:    0.02,   detailAmp:    3,
    ridgedRanges: false, seaLevel: -999,
  },
  [BIOMES.TEMPERATE]: {
    continentScale: 0.0005, continentAmp: 70,
    rangeScale:     0.003,  rangeAmp:     55,
    detailScale:    0.025,  detailAmp:    5,
    ridgedRanges: true, seaLevel: 0,
  },
  [BIOMES.OCEAN]: {
    continentScale: 0.0004, continentAmp: 85,
    rangeScale:     0.0025, rangeAmp:     30,
    detailScale:    0.02,   detailAmp:    3,
    ridgedRanges: false, seaLevel: 8,
  },
  [BIOMES.GAS_GIANT]: {
    continentScale: 0.0005, continentAmp: 15,
    rangeScale:     0.002,  rangeAmp:     10,
    detailScale:    0.015,  detailAmp:    2,
    ridgedRanges: false, seaLevel: -999,
  },
  [BIOMES.ICE]: {
    continentScale: 0.0007, continentAmp: 50,
    rangeScale:     0.0035, rangeAmp:     45,
    detailScale:    0.03,   detailAmp:    6,
    ridgedRanges: true, seaLevel: -999,
  },
};

export function sampleTerrainHeight(planet, x, z) {
  const p = BIOME_TERRAIN[planet.biome] || BIOME_TERRAIN[BIOMES.TEMPERATE];
  const s = planet.seed;

  // Continent shape (centered so most land has continent > 0)
  const continent = (fbm2D(s, x * p.continentScale, z * p.continentScale, 3) - 0.45) * 2;
  const continentH = continent * p.continentAmp;

  // Mountain ranges — only where continents are elevated
  const rangeMask = Math.max(0, continent);
  const rangeRaw = p.ridgedRanges
    ? ridgedFbm(s + 101, x * p.rangeScale, z * p.rangeScale, 5)
    : fbm2D(s + 101, x * p.rangeScale, z * p.rangeScale, 4);
  const rangeH = rangeRaw * p.rangeAmp * rangeMask;

  const detailH = (fbm2D(s + 202, x * p.detailScale, z * p.detailScale, 3) - 0.5) * 2 * p.detailAmp;

  return continentH + rangeH + detailH;
}

export function seaLevelFor(planet) {
  const p = BIOME_TERRAIN[planet.biome] || BIOME_TERRAIN[BIOMES.TEMPERATE];
  return p.seaLevel;
}

const BIOME_COLORS = {
  [BIOMES.MOLTEN]: [
    { h: -60, color: [0.12, 0.04, 0.04] },
    { h: -10, color: [0.3,  0.08, 0.05] },
    { h:  0,  color: [0.5,  0.12, 0.06] },
    { h:  15, color: [0.85, 0.35, 0.1] },
    { h:  40, color: [1.0,  0.7,  0.25] },
    { h:  80, color: [0.4,  0.15, 0.08] },
  ],
  [BIOMES.DESERT]: [
    { h: -30, color: [0.45, 0.3,  0.15] },
    { h:  0,  color: [0.7,  0.5,  0.25] },
    { h:  20, color: [0.85, 0.7,  0.4] },
    { h:  45, color: [0.65, 0.48, 0.28] },
    { h:  80, color: [0.5,  0.3,  0.2] },
  ],
  [BIOMES.TEMPERATE]: [
    { h: -30, color: [0.08, 0.2,  0.45] },
    { h:  -2, color: [0.15, 0.35, 0.55] },
    { h:   1, color: [0.75, 0.65, 0.4] },
    { h:   8, color: [0.22, 0.45, 0.15] },
    { h:  25, color: [0.3,  0.38, 0.18] },
    { h:  50, color: [0.38, 0.3,  0.22] },
    { h:  70, color: [0.6,  0.55, 0.5] },
    { h:  95, color: [0.95, 0.96, 0.98] },
  ],
  [BIOMES.OCEAN]: [
    { h: -80, color: [0.03, 0.08, 0.25] },
    { h: -20, color: [0.08, 0.25, 0.5] },
    { h:   5, color: [0.3,  0.55, 0.7] },
    { h:  12, color: [0.75, 0.75, 0.55] },
    { h:  35, color: [0.38, 0.48, 0.3] },
    { h:  70, color: [0.85, 0.9,  0.95] },
  ],
  [BIOMES.GAS_GIANT]: [
    { h: -20, color: [0.6, 0.4,  0.25] },
    { h:  -5, color: [0.8, 0.6,  0.4] },
    { h:   5, color: [0.9, 0.8,  0.55] },
    { h:  15, color: [1.0, 0.92, 0.75] },
  ],
  [BIOMES.ICE]: [
    { h: -40, color: [0.2,  0.3,  0.5] },
    { h:   0, color: [0.6,  0.72, 0.85] },
    { h:  20, color: [0.82, 0.9,  0.98] },
    { h:  50, color: [0.95, 0.97, 1.0] },
  ],
};

export function colorAtHeight(biome, height) {
  const palette = BIOME_COLORS[biome] || BIOME_COLORS[BIOMES.TEMPERATE];
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

export function atmosphereColor(planet) {
  switch (planet.biome) {
    case BIOMES.TEMPERATE: return [0.45, 0.65, 0.95];
    case BIOMES.OCEAN:     return [0.35, 0.6,  0.9];
    case BIOMES.DESERT:    return [0.9,  0.7,  0.45];
    case BIOMES.MOLTEN:    return [0.8,  0.25, 0.1];
    case BIOMES.GAS_GIANT: return [0.9,  0.75, 0.5];
    case BIOMES.ICE:       return [0.65, 0.8,  0.95];
    default:               return [0.5,  0.6,  0.8];
  }
}
