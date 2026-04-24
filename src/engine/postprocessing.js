import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

// Radial blur masked at the star's screen position — cheap god-rays.
// Anchored at uniforms.uCenter (NDC space, -1..1). uStrength fades the
// effect to zero when the star is offscreen or hidden.
const GodRaysShader = {
  uniforms: {
    tDiffuse: { value: null },
    uCenter:   { value: new THREE.Vector2(0.5, 0.5) },
    uStrength: { value: 0.0 },
    uDecay:    { value: 0.96 },
    uDensity:  { value: 0.95 },
    uWeight:   { value: 0.5 },
    uExposure: { value: 0.45 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2  uCenter;
    uniform float uStrength;
    uniform float uDecay;
    uniform float uDensity;
    uniform float uWeight;
    uniform float uExposure;
    varying vec2 vUv;
    const int SAMPLES = 48;
    void main() {
      vec2 texCoord = vUv;
      vec2 deltaTexCoord = (vUv - uCenter) * (uDensity / float(SAMPLES));
      vec4 color = texture2D(tDiffuse, vUv);
      float illum = 1.0;
      vec4 godrays = vec4(0.0);
      for (int i = 0; i < SAMPLES; i++) {
        texCoord -= deltaTexCoord;
        vec4 sampled = texture2D(tDiffuse, texCoord);
        // bias toward bright pixels so only the star contributes
        float lum = dot(sampled.rgb, vec3(0.299, 0.587, 0.114));
        sampled *= smoothstep(0.6, 1.2, lum);
        sampled *= illum * uWeight;
        godrays += sampled;
        illum *= uDecay;
      }
      gl_FragColor = color + godrays * uExposure * uStrength;
    }
  `,
};

// Subtle corner darkening — keeps focus toward the center of the frame.
const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    uStrength: { value: 0.12 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uStrength;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 uv = vUv - 0.5;
      float vig = smoothstep(0.8, 0.3, length(uv));
      gl_FragColor = vec4(c.rgb * mix(1.0 - uStrength, 1.0, vig), c.a);
    }
  `,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const w = renderer.domElement.width;
    const h = renderer.domElement.height;

    this.composer = new EffectComposer(renderer);
    this.composer.setSize(w, h);

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // UnrealBloomPass(resolution, strength, radius, threshold)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.8, 0.4, 0.6);
    this.composer.addPass(this.bloom);

    this.godRays = new ShaderPass(GodRaysShader);
    this.composer.addPass(this.godRays);

    this.vignette = new ShaderPass(VignetteShader);
    this.composer.addPass(this.vignette);

    this.fxaa = new ShaderPass(FXAAShader);
    this.fxaa.material.uniforms.resolution.value.set(1 / w, 1 / h);
    this.composer.addPass(this.fxaa);

    // OutputPass converts the linear HDR composer buffer to sRGB display.
    this.output = new OutputPass();
    this.composer.addPass(this.output);

    this._tmpVec = new THREE.Vector3();
  }

  setScene(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
  }

  // Pass a world-space Vector3 (or null to disable god-rays for this scene).
  setStarPosition(vec3OrNull) {
    if (!vec3OrNull) {
      this.godRays.material.uniforms.uStrength.value = 0;
      return;
    }
    this._tmpVec.copy(vec3OrNull).project(this.camera);
    // NDC → 0..1 UV space
    const cx = this._tmpVec.x * 0.5 + 0.5;
    const cy = this._tmpVec.y * 0.5 + 0.5;
    this.godRays.material.uniforms.uCenter.value.set(cx, cy);
    // Fade out when star is behind camera (z > 1) or far off-screen.
    const onScreen = this._tmpVec.z < 1
      && cx > -0.2 && cx < 1.2 && cy > -0.2 && cy < 1.2;
    this.godRays.material.uniforms.uStrength.value = onScreen ? 1.0 : 0.0;
  }

  setExposure(x) {
    this.renderer.toneMappingExposure = x;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.fxaa.material.uniforms.resolution.value.set(1 / w, 1 / h);
  }

  render(dt) {
    this.composer.render(dt);
  }
}
