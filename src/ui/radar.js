// Observatory chart — a star-centered top-down map of the active scene.
// Canvas-backed so we stay in the no-asset-pipeline discipline.
//
// Scenes opt in by implementing getMapData(). Returning null hides the chart.
// Shape:
//   { star: { pos, color? }, planets: [{ pos, biome }], title? }
//
// Drawing convention: top-down. World X → screen right; world Z → screen down.
// Ship is drawn at its world position with a triangle rotated to match yaw.

const BIOME_COLORS = {
  molten:    '#e07048',
  desert:    '#d4a868',
  temperate: '#7aa878',
  ocean:     '#5090b8',
  gas_giant: '#b89080',
  ice:       '#c8d8e8',
};

export class Radar {
  constructor() {
    this.el = document.getElementById('radar');
    this.title = this.el.querySelector('.radar-title');
    this.scaleEl = this.el.querySelector('.radar-scale');
    this.canvas = this.el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    // Upscale canvas for crispness on retina displays.
    const cssSize = 200;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = cssSize * dpr;
    this.canvas.height = cssSize * dpr;
    this.canvas.style.width = cssSize + 'px';
    this.canvas.style.height = cssSize + 'px';
    this.ctx.scale(dpr, dpr);
    this.size = cssSize;
  }

  setVisible(v) {
    this.el.classList.toggle('hidden', !v);
  }

  draw({ mapData, ship }) {
    if (!mapData) {
      this.setVisible(false);
      return;
    }
    this.setVisible(true);
    if (mapData.title) this.title.textContent = mapData.title;

    if (mapData.surface) {
      this._drawSurface(mapData, ship);
    } else {
      this._drawSystem(mapData, ship);
    }
  }

  _drawSystem(mapData, ship) {
    const { ctx, size } = this;
    const cx = size / 2, cy = size / 2;
    ctx.clearRect(0, 0, size, size);

    const { star, planets = [] } = mapData;

    let maxR = 40;
    for (const p of planets) maxR = Math.max(maxR, dist2d(star.pos, p.pos));
    maxR *= 1.3;
    const halfSize = size / 2 - 14;
    const scale = halfSize / maxR;

    ctx.save();
    ctx.translate(cx, cy);

    // Orbit rings
    ctx.strokeStyle = 'rgba(200, 184, 144, 0.14)';
    ctx.lineWidth = 1;
    for (const p of planets) {
      const r = dist2d(star.pos, p.pos);
      ctx.beginPath();
      ctx.arc(0, 0, r * scale, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Star glow + core
    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 18);
    glow.addColorStop(0, 'rgba(255, 220, 150, 0.55)');
    glow.addColorStop(1, 'rgba(255, 220, 150, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffe0a0';
    ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, Math.PI * 2); ctx.fill();

    // Planet pips
    for (const p of planets) {
      const px = (p.pos.x - star.pos.x) * scale;
      const pz = (p.pos.z - star.pos.z) * scale;
      ctx.fillStyle = BIOME_COLORS[p.biome] || '#c8b890';
      ctx.beginPath(); ctx.arc(px, pz, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(10, 12, 18, 0.8)';
      ctx.lineWidth = 0.8; ctx.stroke();
    }

    // Ship triangle (with edge-clamp)
    let sx = (ship.pos.x - star.pos.x) * scale;
    let sz = (ship.pos.z - star.pos.z) * scale;
    const shipDist = Math.sqrt(sx * sx + sz * sz);
    const clamped = shipDist > halfSize - 4;
    if (clamped) {
      const k = (halfSize - 4) / shipDist;
      sx *= k; sz *= k;
    }
    ctx.save();
    ctx.translate(sx, sz);
    ctx.rotate(-ship.heading);
    ctx.fillStyle = clamped ? '#ffaa44' : '#e8dfc8';
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(-4.5, 5); ctx.lineTo(4.5, 5);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#1a1612'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();

    ctx.restore();
    this.scaleEl.textContent = `${maxR.toFixed(0)} u`;
  }

  _drawSurface(mapData, ship) {
    const { ctx, size } = this;
    const cx = size / 2, cy = size / 2;
    ctx.clearRect(0, 0, size, size);

    const { focus, range, shipBeacon } = mapData;
    const halfSize = size / 2 - 14;
    const scale = halfSize / range;

    ctx.save();
    ctx.translate(cx, cy);

    // Compass ring
    ctx.strokeStyle = 'rgba(200, 184, 144, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, halfSize, 0, Math.PI * 2);
    ctx.stroke();

    // Ship beacon — amber cross, centered at its world position relative to focus.
    if (shipBeacon) {
      let bx = (shipBeacon.x - focus.x) * scale;
      let bz = (shipBeacon.z - focus.z) * scale;
      const d = Math.sqrt(bx * bx + bz * bz);
      const clamped = d > halfSize - 6;
      if (clamped) {
        const k = (halfSize - 6) / d;
        bx *= k; bz *= k;
      }
      ctx.strokeStyle = '#ffaa44';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx - 6, bz); ctx.lineTo(bx + 6, bz);
      ctx.moveTo(bx, bz - 6); ctx.lineTo(bx, bz + 6);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 170, 68, 0.35)';
      ctx.beginPath(); ctx.arc(bx, bz, 4, 0, Math.PI * 2); ctx.fill();
    }

    // Player arrow — always at center, rotated with heading
    ctx.save();
    ctx.rotate(-ship.heading);
    ctx.fillStyle = '#e8dfc8';
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(-4.5, 5); ctx.lineTo(4.5, 5);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#1a1612'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();

    ctx.restore();
    this.scaleEl.textContent = `${range.toFixed(0)} u`;
  }
}

function dist2d(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}
