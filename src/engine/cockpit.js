// Cockpit overlay. Strategy: the cockpit geometry lives in a Group that's
// parented to the main scene but has its transform copied from the camera
// every frame. This way the cockpit moves with you, blocks the world
// naturally (depth testing works), and gets proper lighting.
//
// The cockpit has two pieces:
//   - rootVisible: added to scene, visible when in ship
//   - instrument panels: CanvasTexture-backed so we can redraw HUD data

import * as THREE from 'three';

export class Cockpit {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'Cockpit';
    this.group.renderOrder = 999; // draw after world so nothing shows through the frame

    this.build();
    this._shakeAmp = 0;
    this._shakeTime = 0;
  }

  build() {
    const frame = new THREE.MeshStandardMaterial({
      color: 0x15181c, roughness: 0.6, metalness: 0.6, flatShading: true,
    });
    const panel = new THREE.MeshStandardMaterial({
      color: 0x0a0c0f, roughness: 0.9, metalness: 0.2, flatShading: true,
    });

    // Cockpit geometry is rendered in camera-local space. A position of
    // (0, 0, -1) means "1 unit in front of the camera".

    // ── Dashboard ────────────────────────────────────────────────
    const dash = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.35, 0.9), panel);
    dash.position.set(0, -0.62, -0.85);
    dash.rotation.x = -0.38;
    this.group.add(dash);

    // Dashboard lip/edge
    const dashLip = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.06, 0.08), frame);
    dashLip.position.set(0, -0.43, -1.25);
    dashLip.rotation.x = -0.38;
    this.group.add(dashLip);

    // Dashboard under-glow strip
    const underGlow = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.02, 0.02),
      new THREE.MeshBasicMaterial({ color: 0x66aaff })
    );
    underGlow.position.set(0, -0.58, -0.52);
    underGlow.rotation.x = -0.38;
    this.group.add(underGlow);

    // ── Canopy struts ────────────────────────────────────────────
    for (const side of [-1, 1]) {
      const strut = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 1.8, 0.14),
        frame
      );
      strut.position.set(side * 1.1, 0.1, -1.15);
      strut.rotation.z = side * 0.14;
      strut.rotation.x = 0.08;
      this.group.add(strut);

      // Angular pillar flare that joins strut to dashboard
      const flare = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.5, 0.3),
        frame
      );
      flare.position.set(side * 1.18, -0.5, -1.1);
      flare.rotation.z = side * 0.2;
      this.group.add(flare);
    }

    // ── Top canopy frame ─────────────────────────────────────────
    const topFrame = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.08, 0.1), frame);
    topFrame.position.set(0, 0.88, -1.1);
    topFrame.rotation.x = 0.1;
    this.group.add(topFrame);

    // Small antenna detail (tiny silhouette at top of view)
    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.4, 6),
      frame
    );
    antenna.position.set(0, 1.15, -1.05);
    this.group.add(antenna);

    // ── Instrument panels (canvas-backed for live HUD) ───────────
    // Positioned on the sloped dashboard surface
    this.velocityPanel = this.makePanel(0.75, 0.32);
    this.velocityPanel.mesh.position.set(-0.7, -0.5, -0.95);
    this.velocityPanel.mesh.rotation.x = -0.38;
    this.group.add(this.velocityPanel.mesh);

    this.positionPanel = this.makePanel(0.75, 0.32);
    this.positionPanel.mesh.position.set(0, -0.46, -0.87);
    this.positionPanel.mesh.rotation.x = -0.38;
    this.group.add(this.positionPanel.mesh);

    this.targetPanel = this.makePanel(0.75, 0.32);
    this.targetPanel.mesh.position.set(0.7, -0.5, -0.95);
    this.targetPanel.mesh.rotation.x = -0.38;
    this.group.add(this.targetPanel.mesh);

    // ── Status LEDs above the panels ─────────────────────────────
    this.statusLeds = [];
    const ledColors = [0x66ccff, 0x66ccff, 0xffa040, 0x66ff88];
    for (let i = 0; i < 4; i++) {
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.022, 6, 6),
        new THREE.MeshBasicMaterial({ color: ledColors[i] })
      );
      lamp.position.set(-0.45 + i * 0.3, -0.32, -0.75);
      this.group.add(lamp);
      this.statusLeds.push(lamp);
    }

    // Reticle in the center — small crosshair on the "glass"
    const reticleMat = new THREE.LineBasicMaterial({
      color: 0x66ccff, transparent: true, opacity: 0.75,
    });
    const reticleGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.04, 0, -1), new THREE.Vector3(-0.012, 0, -1),
      new THREE.Vector3( 0.012, 0, -1), new THREE.Vector3( 0.04, 0, -1),
      new THREE.Vector3(0, -0.04, -1), new THREE.Vector3(0, -0.012, -1),
      new THREE.Vector3(0,  0.012, -1), new THREE.Vector3(0,  0.04, -1),
    ]);
    const reticle = new THREE.LineSegments(reticleGeom, reticleMat);
    this.group.add(reticle);

    // Soft cockpit interior lighting
    this.rimLight = new THREE.PointLight(0x66aaff, 1.2, 3);
    this.rimLight.position.set(0, -0.4, -0.6);
    this.group.add(this.rimLight);
  }

  makePanel(worldW, worldH) {
    const pxW = 256, pxH = 110;
    const cv = document.createElement('canvas');
    cv.width = pxW; cv.height = pxH;
    const ctx = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(worldW, worldH), mat);
    return {
      mesh, ctx, tex, pxW, pxH,
      draw(fn) {
        ctx.clearRect(0, 0, pxW, pxH);
        fn(ctx, pxW, pxH);
        tex.needsUpdate = true;
      },
    };
  }

  /**
   * Each frame: sync group to camera transform, update shake, redraw panels.
   */
  update(dt, { camera, speed, maxSpeed, position, sceneName, target, throttle }) {
    this._shakeTime += dt;
    // Engine vibration proportional to throttle
    const targetAmp = throttle > 0.5 ? 0.006 : 0;
    this._shakeAmp += (targetAmp - this._shakeAmp) * dt * 4;

    const shakeX = Math.sin(this._shakeTime * 60) * this._shakeAmp;
    const shakeY = Math.cos(this._shakeTime * 55) * this._shakeAmp * 0.7;

    // Lock cockpit to camera
    this.group.position.copy(camera.position);
    this.group.quaternion.copy(camera.quaternion);
    // Apply shake in camera-local space
    this.group.translateX(shakeX);
    this.group.translateY(shakeY);

    // NAV LED pulse
    const t = (Math.sin(this._shakeTime * 2) + 1) * 0.5;
    this.statusLeds[0].material.color.setRGB(0.3 + t * 0.5, 0.7 + t * 0.3, 1);

    this.drawVelocityPanel(speed, maxSpeed);
    this.drawPositionPanel(position);
    this.drawTargetPanel(sceneName, target);
  }

  drawVelocityPanel(speed, maxSpeed) {
    this.velocityPanel.draw((ctx, w, h) => {
      ctx.fillStyle = 'rgba(8, 16, 28, 0.92)';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#66aaff';
      ctx.lineWidth = 2;
      ctx.strokeRect(3, 3, w - 6, h - 6);

      ctx.fillStyle = '#66aaff';
      ctx.font = '11px monospace';
      ctx.fillText('VELOCITY', 12, 20);

      ctx.fillStyle = '#e0f0ff';
      ctx.font = 'bold 32px monospace';
      ctx.fillText(speed.toFixed(1), 12, 60);
      ctx.fillStyle = '#66aaff';
      ctx.font = '11px monospace';
      ctx.fillText('u/s', 130, 60);

      const barX = 12, barY = 78, barW = w - 24, barH = 14;
      ctx.strokeStyle = '#66aaff';
      ctx.strokeRect(barX, barY, barW, barH);
      const pct = Math.min(1, speed / maxSpeed);
      const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
      grad.addColorStop(0, '#66aaff');
      grad.addColorStop(0.7, '#88ccff');
      grad.addColorStop(1, '#ff8844');
      ctx.fillStyle = grad;
      ctx.fillRect(barX + 1, barY + 1, (barW - 2) * pct, barH - 2);
    });
  }

  drawPositionPanel(position) {
    this.positionPanel.draw((ctx, w, h) => {
      ctx.fillStyle = 'rgba(8, 16, 28, 0.92)';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#66aaff';
      ctx.lineWidth = 2;
      ctx.strokeRect(3, 3, w - 6, h - 6);

      ctx.fillStyle = '#66aaff';
      ctx.font = '11px monospace';
      ctx.fillText('POSITION', 12, 20);

      ctx.fillStyle = '#e0f0ff';
      ctx.font = '14px monospace';
      ctx.fillText(`X ${position.x.toFixed(0).padStart(8)}`, 12, 44);
      ctx.fillText(`Y ${position.y.toFixed(0).padStart(8)}`, 12, 64);
      ctx.fillText(`Z ${position.z.toFixed(0).padStart(8)}`, 12, 84);
    });
  }

  drawTargetPanel(sceneName, target) {
    this.targetPanel.draw((ctx, w, h) => {
      ctx.fillStyle = 'rgba(8, 16, 28, 0.92)';
      ctx.fillRect(0, 0, w, h);
      const accent = target ? '#ffaa44' : '#66aaff';
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(3, 3, w - 6, h - 6);

      ctx.fillStyle = accent;
      ctx.font = '11px monospace';
      ctx.fillText(target ? 'TARGET' : 'SECTOR', 12, 20);

      if (target) {
        ctx.fillStyle = '#ffe0a8';
        ctx.font = 'bold 13px monospace';
        const name = target.name.length > 22 ? target.name.slice(0, 21) + '…' : target.name;
        ctx.fillText(name, 12, 44);
        ctx.fillStyle = '#ffaa44';
        ctx.font = '12px monospace';
        ctx.fillText(`${target.dist.toFixed(0)} u`, 12, 64);
        if (target.hint) {
          ctx.fillStyle = '#88ccff';
          ctx.font = '10px monospace';
          ctx.fillText(target.hint, 12, 84);
        }
      } else {
        ctx.fillStyle = '#e0f0ff';
        ctx.font = '14px monospace';
        ctx.fillText(sceneName.toUpperCase(), 12, 50);
        ctx.fillStyle = '#66aaff';
        ctx.font = '11px monospace';
        ctx.fillText('no target in reticle', 12, 74);
      }
    });
  }

  addToScene(threeScene) { threeScene.add(this.group); }
  removeFromScene(threeScene) { threeScene.remove(this.group); }
  setVisible(v) { this.group.visible = v; }
}
