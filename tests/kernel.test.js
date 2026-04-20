import { describe, it, expect } from 'vitest';
import {
  hashString,
  makeRng,
  stellarPhysics,
  generateUniverse,
  branchUniverse,
  derivePlanet,
  sampleTerrainHeight,
  VANILLA_CONSTANTS,
  BIOMES,
} from '../src/kernel/index.js';

describe('kernel · determinism', () => {
  it('hashString is stable', () => {
    expect(hashString('ROOT')).toBe(hashString('ROOT'));
    expect(hashString('a')).not.toBe(hashString('b'));
  });

  it('makeRng produces the same sequence for the same seed', () => {
    const a = makeRng(42), b = makeRng(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('generateUniverse is referentially transparent', () => {
    const u1 = generateUniverse(VANILLA_CONSTANTS, 'X');
    const u2 = generateUniverse(VANILLA_CONSTANTS, 'X');
    expect(u1).toEqual(u2);
  });
});

describe('kernel · physics', () => {
  it('vanilla universe is viable', () => {
    expect(stellarPhysics(VANILLA_CONSTANTS).viable).toBe(true);
  });

  it('extreme Lambda makes universe sterile', () => {
    const result = stellarPhysics({ ...VANILLA_CONSTANTS, Lambda: 5 });
    expect(result.viable).toBe(false);
    expect(result.failureReasons).toContain('expansion too rapid');
  });

  it('high gravity shortens sun lifetime', () => {
    const low  = stellarPhysics({ ...VANILLA_CONSTANTS, G: 0.5 });
    const high = stellarPhysics({ ...VANILLA_CONSTANTS, G: 4 });
    expect(high.sunLifetime).toBeLessThan(low.sunLifetime);
  });

  it('strong force outside [0.7, 1.4] breaks atoms', () => {
    expect(stellarPhysics({ ...VANILLA_CONSTANTS, S: 0.6 }).viable).toBe(false);
    expect(stellarPhysics({ ...VANILLA_CONSTANTS, S: 1.5 }).viable).toBe(false);
  });
});

describe('kernel · branching', () => {
  it('branch produces a child with one constant changed', () => {
    const root = generateUniverse(VANILLA_CONSTANTS, 'ROOT');
    const child = branchUniverse(root, 'G', 2);
    expect(child.constants.G).toBe(2);
    expect(child.constants.S).toBe(VANILLA_CONSTANTS.S);
    expect(child.id).toContain('G=2');
  });

  it('same branch from same parent yields same child', () => {
    const root = generateUniverse(VANILLA_CONSTANTS);
    expect(branchUniverse(root, 'G', 2)).toEqual(branchUniverse(root, 'G', 2));
  });
});

describe('kernel · planets and terrain', () => {
  it('derivePlanet is deterministic', () => {
    const u = generateUniverse(VANILLA_CONSTANTS);
    const a = derivePlanet(u, 2);
    const b = derivePlanet(u, 2);
    expect(a).toEqual(b);
  });

  it('biome assignment respects orbit distance', () => {
    const u = generateUniverse(VANILLA_CONSTANTS);
    // Inner orbits should be hot, outer should be cold.
    const inner = derivePlanet(u, 0);
    const outer = derivePlanet(u, 8);
    const hotBiomes  = [BIOMES.MOLTEN, BIOMES.DESERT];
    const coldBiomes = [BIOMES.GAS_GIANT, BIOMES.ICE];
    expect(hotBiomes).toContain(inner.biome);
    expect(coldBiomes).toContain(outer.biome);
    // And the innermost orbit must be closer than the outermost.
    expect(inner.orbitRadius).toBeLessThan(outer.orbitRadius);
  });

  it('terrain height is deterministic and bounded', () => {
    const u = generateUniverse(VANILLA_CONSTANTS);
    const planet = derivePlanet(u, 3);
    const h1 = sampleTerrainHeight(planet, 100, 200);
    const h2 = sampleTerrainHeight(planet, 100, 200);
    expect(h1).toBe(h2);
    // sanity bounds
    expect(Math.abs(h1)).toBeLessThan(200);
  });
});
