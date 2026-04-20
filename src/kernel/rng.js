// Deterministic seeded RNG (mulberry32) and string hashing.
// Pure functions. No side effects. Portable to any language.

export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Convenience helpers built on top of an rng.
export function rngRange(rng, min, max) {
  return min + rng() * (max - min);
}

export function rngInt(rng, minInclusive, maxExclusive) {
  return Math.floor(rngRange(rng, minInclusive, maxExclusive));
}

export function rngPick(rng, array) {
  return array[Math.floor(rng() * array.length)];
}
