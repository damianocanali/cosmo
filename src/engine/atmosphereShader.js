import * as THREE from 'three';

// Builds a translucent halo around a planet. Renders the inside of a
// slightly-larger sphere with additive blending; the fresnel term makes the
// edge glow brightly while the front (where the planet sits) is invisible.
export function buildAtmosphere(radius, tintHex, intensity = 1.0) {
  const geom = new THREE.SphereGeometry(radius * 1.05, 64, 32);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTint:      { value: new THREE.Color(tintHex) },
      uIntensity: { value: intensity },
    },
    vertexShader: /* glsl */`
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3  uTint;
      uniform float uIntensity;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      void main() {
        // Backface render → vNormalW points inward; flip it so fresnel
        // measures angle to camera correctly.
        float fres = 1.0 - max(dot(-vNormalW, vViewDir), 0.0);
        float halo = pow(fres, 2.0) * uIntensity;
        gl_FragColor = vec4(uTint * halo, halo);
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  return new THREE.Mesh(geom, mat);
}

// Per-biome tint table. Molten and gas_giant skip atmosphere (they read
// better without — molten is its own glow, gas_giant is already gaseous).
const TINT_BY_BIOME = Object.freeze({
  temperate: 0x6aa8ff,
  ocean:     0x6aa8ff,
  ice:       0xdff0ff,
  desert:    0xffb070,
});

export function atmosphereTintForBiome(biome) {
  return TINT_BY_BIOME[biome] ?? null;
}
