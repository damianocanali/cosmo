// Stage 3: Stellar Physics Kernel
// Pure function. (constants) → universe properties.
// No imports, no side effects. Portable to Java/Python.

export const VANILLA_CONSTANTS = Object.freeze({
  G: 1,
  S: 1,
  Lambda: 1,
  cLight: 1,
  rho: 1,
  dm: 0.27,
});

export const CONSTANT_RANGES = Object.freeze({
  G:      { min: 0.1, max: 10,   step: 0.05, label: 'Gravity',         symbol: 'G' },
  S:      { min: 0.5, max: 2,    step: 0.01, label: 'Strong force',    symbol: 'α𝒮' },
  Lambda: { min: 0,   max: 5,    step: 0.05, label: 'Cosmological Λ',  symbol: 'Λ' },
  cLight: { min: 0.1, max: 10,   step: 0.05, label: 'Speed of light',  symbol: 'c' },
  rho:    { min: 0.1, max: 10,   step: 0.05, label: 'Matter density',  symbol: 'ρ₀' },
  dm:     { min: 0,   max: 0.95, step: 0.01, label: 'Dark matter',     symbol: 'Ω𝒹' },
});

export function stellarPhysics(c) {
  const { G, S, Lambda, rho, dm } = c;

  const atomsStable     = S > 0.7 && S < 1.4;
  const gravityViable   = G > 0.05;
  const expansionViable = Lambda < 4.5;
  const matterViable    = rho > 0.05;
  const viable = atomsStable && gravityViable && expansionViable && matterViable;

  return {
    viable,
    failureReasons: [
      !atomsStable     && 'atoms unstable',
      !gravityViable   && 'gravity too weak',
      !expansionViable && 'expansion too rapid',
      !matterViable    && 'insufficient matter',
    ].filter(Boolean),

    // Mass thresholds (solar masses)
    minFusionMass:    0.08 / Math.pow(G, 1.5),
    maxStableMass:    150 / G,
    typicalStarMass:  0.4 / Math.pow(G, 0.7),

    // Lifetime of a sun-equivalent star (years)
    sunLifetime: (1e10 / Math.pow(G, 2.5)) * Math.pow(S, 0.5),

    // Stellar density (relative units)
    stellarDensity: rho * (1 + dm * 5) * Math.exp(-Lambda / 2),

    // Habitable zone distance (AU equivalent)
    habitableZoneAU: Math.pow(G, 0.5),
  };
}

export function cosmology(c) {
  const { G, Lambda, rho, dm, cLight } = c;
  const ageGyr      = (13.8 / (1 + Lambda * 0.3)) * Math.pow(G, -0.1);
  const horizonGly  = ageGyr * cLight * 3.26;
  const matterBudget = rho * (1 + dm * 3);
  return { ageGyr, horizonGly, matterBudget };
}

// The full kernel — a universe is constants + derived properties + a seed.
export function generateUniverse(constants, seedString = 'ROOT') {
  return {
    id: seedString,
    constants: { ...constants },
    stellar: stellarPhysics(constants),
    cosmology: cosmology(constants),
  };
}

// Star color from lifetime ratio. Short-lived stars are hot/blue.
// Returns {r, g, b} in [0, 1].
export function starColorFromLifetime(lifetimeRatio) {
  const heat = Math.max(0, Math.min(1, 0.5 - Math.log10(lifetimeRatio) * 0.2));
  if (heat < 0.25) {
    const t = heat / 0.25;
    return { r: 1, g: 0.3 + t * 0.4, b: 0.15 + t * 0.25 };
  }
  if (heat < 0.5) {
    const t = (heat - 0.25) / 0.25;
    return { r: 1, g: 0.7 + t * 0.25, b: 0.4 + t * 0.4 };
  }
  if (heat < 0.75) {
    const t = (heat - 0.5) / 0.25;
    return { r: 1 - t * 0.1, g: 0.95 - t * 0.05, b: 0.8 + t * 0.2 };
  }
  const t = (heat - 0.75) / 0.25;
  return { r: 0.85 - t * 0.25, g: 0.85 - t * 0.15, b: 1 };
}
