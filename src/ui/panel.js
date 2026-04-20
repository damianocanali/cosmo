// Panel: wires the DOM controls (sliders, presets, scene buttons)
// to callbacks. Doesn't know about the kernel — just emits events.

import { VANILLA_CONSTANTS } from '../kernel/index.js';

export const PRESETS = {
  vanilla: { name: 'Vanilla', c: { ...VANILLA_CONSTANTS } },
  heavy:   { name: 'Heavy',   c: { G: 4,   S: 1,   Lambda: 0.5, cLight: 1, rho: 2,   dm: 0.4  } },
  sparse:  { name: 'Sparse',  c: { G: 0.4, S: 1,   Lambda: 0.8, cLight: 1, rho: 0.5, dm: 0.15 } },
  diffuse: { name: 'Diffuse', c: { G: 0.2, S: 1,   Lambda: 3,   cLight: 1, rho: 0.3, dm: 0.1  } },
  primal:  { name: 'Primal',  c: { G: 0.6, S: 1.1, Lambda: 0.2, cLight: 1, rho: 5,   dm: 0.7  } },
};

export class Panel {
  /**
   * @param {object} handlers
   * @param {(c: object, name: string) => void} handlers.onConstantsChange
   * @param {(scene: string) => void} handlers.onSceneChange
   */
  constructor({ onConstantsChange, onSceneChange }) {
    this.onConstantsChange = onConstantsChange;
    this.onSceneChange = onSceneChange;
    this.constants = { ...VANILLA_CONSTANTS };
    this.bind();
  }

  bind() {
    document.querySelectorAll('.ctrl').forEach((div) => {
      const key = div.dataset.key;
      const input = div.querySelector('input');
      const val = div.querySelector('.ctrl-val');
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        val.textContent = v.toFixed(2);
        this.constants[key] = v;
        this.onConstantsChange(this.constants, 'Custom');
      });
    });

    document.querySelectorAll('.preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = PRESETS[btn.dataset.preset];
        this.constants = { ...p.c };
        this.syncSliders();
        this.onConstantsChange(this.constants, p.name);
      });
    });

    document.querySelectorAll('.scene-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.scene-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.onSceneChange(btn.dataset.scene);
      });
    });

    document.getElementById('panelToggle').addEventListener('click', () => {
      document.getElementById('panel').classList.remove('hidden');
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        document.getElementById('panel').classList.toggle('hidden');
      }
    });
  }

  syncSliders() {
    document.querySelectorAll('.ctrl').forEach((div) => {
      const k = div.dataset.key;
      const inp = div.querySelector('input');
      inp.value = this.constants[k];
      div.querySelector('.ctrl-val').textContent = this.constants[k].toFixed(2);
    });
  }

  setActiveScene(name) {
    document.querySelectorAll('.scene-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.scene === name);
    });
  }
}
