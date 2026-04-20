// HUD: reads from the live state and writes to DOM elements.
// No business logic — just formatting + element updates.

function fmtSci(n, d = 2) {
  if (!isFinite(n)) return '—';
  if (n === 0) return '0';
  const exp = Math.floor(Math.log10(Math.abs(n)));
  if (exp >= -2 && exp <= 3) return n.toFixed(d);
  const mantissa = n / Math.pow(10, exp);
  const sup = String(exp).split('').map(c =>
    ({'-':'⁻','0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹'}[c] || c)
  ).join('');
  return mantissa.toFixed(d) + '×10' + sup;
}

function fmtYears(y) {
  if (!isFinite(y)) return '—';
  if (y < 1e6)  return (y / 1e3).toFixed(1) + ' Kyr';
  if (y < 1e9)  return (y / 1e6).toFixed(1) + ' Myr';
  if (y < 1e12) return (y / 1e9).toFixed(2) + ' Gyr';
  return fmtSci(y, 1) + ' yr';
}

const SCENE_LABELS = {
  solar:     'solar system',
  galaxy:    'galaxy',
  blackhole: 'black hole',
  planet:    'planet surface',
};

export class Hud {
  constructor() {
    this.els = {
      posX: document.getElementById('posX'),
      posY: document.getElementById('posY'),
      posZ: document.getElementById('posZ'),
      velocity: document.getElementById('velocity'),

      phMin:  document.getElementById('phMin'),
      phMax:  document.getElementById('phMax'),
      phLife: document.getElementById('phLife'),
      phDens: document.getElementById('phDens'),
      phType: document.getElementById('phType'),

      universeName: document.getElementById('universeName'),
      universeSeed: document.getElementById('universeSeed'),

      target:     document.getElementById('target'),
      targetName: document.getElementById('targetName'),
      targetDist: document.getElementById('targetDist'),
      targetHint: document.getElementById('targetHint'),

      prompt: document.getElementById('prompt'),

      sterile:       document.getElementById('sterile'),
      sterileReason: document.getElementById('sterileReason'),
    };
  }

  update({ camera, flyCamera, universe, universeName, sceneName, target, prompt }) {
    this.els.posX.textContent = camera.position.x.toFixed(0);
    this.els.posY.textContent = camera.position.y.toFixed(0);
    this.els.posZ.textContent = camera.position.z.toFixed(0);
    this.els.velocity.textContent = flyCamera.speedNow().toFixed(1);

    const s = universe.stellar;
    this.els.phMin.textContent  = fmtSci(s.minFusionMass, 3) + ' M☉';
    this.els.phMax.textContent  = fmtSci(s.maxStableMass, 1) + ' M☉';
    this.els.phLife.textContent = fmtYears(s.sunLifetime);
    this.els.phDens.textContent = s.stellarDensity.toFixed(2);
    this.els.phType.textContent = s.typicalStarMass.toFixed(2) + ' M☉';

    this.els.universeName.textContent = universeName;
    this.els.universeSeed.textContent = 'scene · ' + (SCENE_LABELS[sceneName] || sceneName);

    if (!s.viable) {
      this.els.sterile.classList.add('show');
      this.els.sterileReason.textContent = s.failureReasons.join(' · ');
    } else {
      this.els.sterile.classList.remove('show');
    }

    if (target) {
      this.els.target.classList.add('show');
      this.els.targetName.textContent = target.name;
      this.els.targetDist.textContent = target.dist.toFixed(0) + ' units';
      this.els.targetHint.textContent = target.hint || '';
    } else {
      this.els.target.classList.remove('show');
    }

    if (prompt) {
      this.els.prompt.textContent = prompt;
      this.els.prompt.classList.add('show');
    } else {
      this.els.prompt.classList.remove('show');
    }
  }

  hideLoading() {
    document.getElementById('loading').classList.add('hide');
  }
}
