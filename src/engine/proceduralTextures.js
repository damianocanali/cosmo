import * as THREE from 'three';
import { makeRng } from '../kernel/index.js';

// Builds an albedo + normal map pair for a given biome, deterministically
// seeded by `seed` (any uint). Output canvas is `width × width/2` for an
// equirectangular-ish UV mapping onto a sphere. width=512 is a good balance
// of detail vs. generation cost.
export function buildPlanetMaps(biome, seed, width = 512) {
  const height = width / 2;
  const rng = makeRng(seed);
  const noise = makeValueNoise2D(rng);

  const cfg = BIOME_CONFIG[biome] ?? BIOME_CONFIG.temperate;

  // Sample a normalized height field h(x, y) ∈ [0, 1] over the canvas.
  const field = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const v = y / height;
      // Wrap horizontally by sampling on a cylinder: (cos, sin, v).
      const angle = u * Math.PI * 2;
      const sx = Math.cos(angle);
      const sz = Math.sin(angle);
      let h = cfg.field(noise, sx * cfg.scale, v * cfg.scale, sz * cfg.scale);
      h = Math.max(0, Math.min(1, h));
      field[y * width + x] = h;
    }
  }

  return {
    albedo: makeAlbedoTexture(field, width, height, cfg),
    normal: makeNormalTexture(field, width, height, cfg.normalStrength),
  };
}

// ── Per-biome configuration ───────────────────────────────────────────────
const BIOME_CONFIG = {
  temperate: {
    scale: 4,
    field: (n, x, y, z) => fbm(n, x, y, z, 6, 2.0, 0.5),
    palette: [
      [0.05, [10, 30, 70]],     // deep ocean
      [0.45, [40, 80, 130]],    // shallow ocean
      [0.50, [180, 160, 110]],  // beach
      [0.65, [70, 110, 50]],    // grass
      [0.80, [90, 80, 60]],     // mountain rock
      [0.95, [240, 240, 245]],  // snow caps
    ],
    normalStrength: 1.2,
  },
  ocean: {
    scale: 3,
    field: (n, x, y, z) => fbm(n, x, y, z, 4, 2.0, 0.55) * 0.6 + 0.2,
    palette: [
      [0.0,  [10, 30, 80]],
      [0.55, [30, 80, 150]],
      [0.85, [80, 160, 200]],
    ],
    normalStrength: 0.4,
  },
  desert: {
    scale: 5,
    field: (n, x, y, z) => ridged(n, x, y, z, 5, 2.1, 0.5),
    palette: [
      [0.0,  [120, 70, 40]],
      [0.5,  [200, 140, 80]],
      [0.9,  [230, 200, 140]],
    ],
    normalStrength: 1.6,
  },
  molten: {
    scale: 6,
    field: (n, x, y, z) => Math.pow(fbm(n, x, y, z, 5, 2.4, 0.55), 1.4),
    palette: [
      [0.0,  [10, 5, 5]],        // basalt black
      [0.45, [60, 20, 10]],
      [0.55, [220, 80, 20]],     // magma crack
      [0.85, [255, 200, 60]],
    ],
    normalStrength: 2.0,
  },
  ice: {
    scale: 4,
    field: (n, x, y, z) => 0.6 + 0.4 * fbm(n, x, y, z, 5, 2.0, 0.5),
    palette: [
      [0.0,  [180, 200, 220]],
      [0.7,  [220, 235, 245]],
      [1.0,  [255, 255, 255]],
    ],
    normalStrength: 1.4,
  },
  gas_giant: {
    scale: 2,
    // Strong horizontal banding — y dominates the noise; x adds turbulence.
    field: (n, x, y, z) => {
      const band = Math.sin(y * 8.0) * 0.5 + 0.5;
      const turb = fbm(n, x * 0.3, y * 12.0, z * 0.3, 4, 2.0, 0.5) * 0.3;
      return Math.max(0, Math.min(1, band * 0.7 + turb + 0.15));
    },
    palette: [
      [0.0,  [120, 90, 60]],
      [0.4,  [200, 170, 130]],
      [0.7,  [230, 200, 160]],
      [1.0,  [180, 130, 90]],
    ],
    normalStrength: 0.3,
  },
};

// ── Value noise — deterministic, seeded RNG hash table ────────────────────
function makeValueNoise2D(rng) {
  const SIZE = 256;
  const table = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < table.length; i++) table[i] = rng();
  const wrap = (n) => ((n % SIZE) + SIZE) % SIZE;
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  return function noise3(x, y, z) {
    // Project (x,y,z) into 2D by mixing — cheap pseudo-3D so wrap-around
    // doesn't visibly seam.
    const u = x + z * 0.7;
    const v = y + z * 0.3;
    const xi = Math.floor(u);
    const yi = Math.floor(v);
    const xf = u - xi;
    const yf = v - yi;
    const a = table[wrap(xi)     * SIZE + wrap(yi)];
    const b = table[wrap(xi + 1) * SIZE + wrap(yi)];
    const c = table[wrap(xi)     * SIZE + wrap(yi + 1)];
    const d = table[wrap(xi + 1) * SIZE + wrap(yi + 1)];
    const u2 = smooth(xf);
    const v2 = smooth(yf);
    return lerp(lerp(a, b, u2), lerp(c, d, u2), v2);
  };
}

function fbm(noise, x, y, z, octaves, lacunarity, gain) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum  += amp * noise(x * freq, y * freq, z * freq);
    norm += amp;
    amp  *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

function ridged(noise, x, y, z, octaves, lacunarity, gain) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise(x * freq, y * freq, z * freq) * 2 - 1);
    sum  += amp * n * n;
    norm += amp;
    amp  *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

// ── Canvas writers ────────────────────────────────────────────────────────
function makeAlbedoTexture(field, w, h, cfg) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < field.length; i++) {
    const [r, g, b] = sampleGradient(field[i], cfg.palette);
    const j = i * 4;
    img.data[j] = r;
    img.data[j + 1] = g;
    img.data[j + 2] = b;
    img.data[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function makeNormalTexture(field, w, h, strength) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  const sample = (x, y) => {
    const xx = ((x % w) + w) % w;
    const yy = Math.max(0, Math.min(h - 1, y));
    return field[yy * w + xx];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel-like gradient
      const gx = (sample(x + 1, y) - sample(x - 1, y)) * strength;
      const gy = (sample(x, y + 1) - sample(x, y - 1)) * strength;
      // Reconstruct normal: (-gx, -gy, 1), normalized, then mapped to 0..255.
      const nx = -gx;
      const ny = -gy;
      const nz = 1.0;
      const len = Math.hypot(nx, ny, nz);
      const j = (y * w + x) * 4;
      img.data[j]     = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[j + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[j + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[j + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function sampleGradient(t, palette) {
  for (let i = 1; i < palette.length; i++) {
    const [t1, c1] = palette[i];
    const [t0, c0] = palette[i - 1];
    if (t <= t1) {
      const a = (t - t0) / Math.max(0.0001, (t1 - t0));
      return [
        c0[0] + (c1[0] - c0[0]) * a,
        c0[1] + (c1[1] - c0[1]) * a,
        c0[2] + (c1[2] - c0[2]) * a,
      ];
    }
  }
  return palette[palette.length - 1][1];
}
