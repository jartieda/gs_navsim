// mask_editor.js
// Top-down 2D overlay editor for drawing obstacle masks.
//
// Layout (all elements expected in index.html):
//   #maskPanel         — the floating panel container
//   #maskCanvas        — 400×400 <canvas> for drawing
//   #maskToolBlock     — button: activate "block" brush
//   #maskToolClear     — button: activate "clear" brush
//   #maskClearAll      — button: wipe entire mask
//   #maskBrushSize     — <input type="range"> for brush radius
//   #maskBrushSizeValue — <span> showing current radius value
//   #maskSave          — button: save mask to server
//   #maskLoad          — button: trigger file input
//   #maskLoadFile      — hidden <input type="file" accept=".json">
//   #maskFitBounds     — button: fit bounds to loaded PLY scene
//   #maskBoundsText    — <span> showing current bounds
//   #maskClose         — button: hide panel
//   #maskBlockedCount  — <span> blocked cell count

export class MaskEditor {
  /**
   * @param {import('./mask.js').MaskManager} maskManager
   * @param {import('./utils.js').RobotController} robot
   */
  constructor(maskManager, robot) {
    this.mask = maskManager;
    this.robot = robot;

    this.visible = false;
    this.painting = false;
    this.paintBlocked = true;   // true = block, false = clear
    this.brushRadius = 0.5;     // world units
    this.scenePoints = null;    // Float32Array [x,y,z, x,y,z, …] — PLY positions
    this.sceneBounds = null;    // {minX, maxX, minZ, maxZ} — PLY XZ extent for viewport
    this.sceneId = null;        // active scene id (from server), used when saving

    // Zoom & viewport state
    this.zoom = 1.0;          // 1 = full bounds visible; >1 = zoomed in
    this.viewCX = 0;          // world X at canvas centre
    this.viewCZ = 0;          // world Z at canvas centre
    this._panning = false;
    this._panAnchor = null;

    this.panel = document.getElementById('maskPanel');
    this.canvas = document.getElementById('maskCanvas');
    this.ctx = this.canvas.getContext('2d');

    this._bindControls();
    this._bindCanvasEvents();
    this._updateToolButtons();
    this._updateBoundsText();
  }

  // ── Control wiring ─────────────────────────────────────────────────────────

  _bindControls() {
    document.getElementById('maskToolBlock').addEventListener('click', () => {
      this.paintBlocked = true;
      this._updateToolButtons();
    });
    document.getElementById('maskToolClear').addEventListener('click', () => {
      this.paintBlocked = false;
      this._updateToolButtons();
    });
    document.getElementById('maskClearAll').addEventListener('click', () => {
      if (confirm('¿Borrar toda la máscara?')) {
        this.mask.clear();
        this.render();
        this._updateStats();
      }
    });

    const brushSlider = document.getElementById('maskBrushSize');
    brushSlider.addEventListener('input', (e) => {
      this.brushRadius = parseFloat(e.target.value);
      document.getElementById('maskBrushSizeValue').textContent = this.brushRadius.toFixed(1);
    });

    document.getElementById('maskSave').addEventListener('click', () => this._saveMask());
    document.getElementById('maskLoad').addEventListener('click', () => {
      document.getElementById('maskLoadFile').click();
    });
    document.getElementById('maskLoadFile').addEventListener('change', (e) => this._loadFromFile(e));
    document.getElementById('maskFitBounds').addEventListener('click', () => {
      if (!this.scenePoints) {
        alert('Carga primero un archivo PLY para ajustar los límites a la escena.');
        return;
      }
      this._fitBoundsToScene();
    });
    document.getElementById('maskClose').addEventListener('click', () => this.hide());
    document.getElementById('maskResetView').addEventListener('click', () => {
      this._resetView();
      this.render();
    });

    // Grid params (live preview on input, rebuild on button click)
    ['maskParamScale', 'maskParamMinX', 'maskParamMaxZ', 'maskParamCols', 'maskParamRows']
      .forEach(id => document.getElementById(id)
        .addEventListener('input', () => this._applyParamPreview()));
    document.getElementById('maskApplyParams').addEventListener('click', () => this._applyParamsFinal());
  }

  _bindCanvasEvents() {
    const c = this.canvas;

    c.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (e.button === 1) {
        // Middle mouse → start pan
        this._panning = true;
        const rect = c.getBoundingClientRect();
        this._panAnchor = {
          mx: e.clientX - rect.left,
          my: e.clientY - rect.top,
          viewCX: this.viewCX,
          viewCZ: this.viewCZ,
        };
        c.style.cursor = 'grab';
        return;
      }
      if (e.button === 0) this.paintBlocked = true;   // LMB → block
      if (e.button === 2) this.paintBlocked = false;  // RMB → clear
      this._updateToolButtons();
      this.painting = true;
      this._paintAt(e);
    });

    c.addEventListener('mousemove', (e) => {
      const rect = c.getBoundingClientRect();
      this._lastMousePx = e.clientX - rect.left;
      this._lastMousePy = e.clientY - rect.top;

      if (this._panning && this._panAnchor) {
        const b = this._getViewBounds();
        const visSpanX = (b.maxX - b.minX) / this.zoom;
        const visSpanZ = (b.maxZ - b.minZ) / this.zoom;
        const dx = (this._lastMousePx - this._panAnchor.mx) / c.width  * visSpanX;
        const dz = (this._lastMousePy - this._panAnchor.my) / c.height * visSpanZ;
        this.viewCX = this._panAnchor.viewCX - dx;
        this.viewCZ = this._panAnchor.viewCZ + dz;  // flip: drag down → view moves toward -Z
        this._clampView();
        if (this.visible) this.render();
        return;
      }
      if (this.painting) this._paintAt(e);
      else if (this.visible) this.render(); // repaint brush preview
    });

    c.addEventListener('mouseup', (e) => {
      if (e.button === 1) {
        this._panning = false;
        this._panAnchor = null;
        c.style.cursor = 'crosshair';
        return;
      }
      this.painting = false;
    });

    c.addEventListener('mouseleave', () => {
      this.painting = false;
      this._panning = false;
      this._panAnchor = null;
      this._lastMousePx = undefined;
      c.style.cursor = 'crosshair';
      if (this.visible) this.render();
    });

    c.addEventListener('contextmenu', (e) => e.preventDefault());

    // plain wheel → zoom toward cursor  |  Ctrl+wheel → resize brush
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Resize brush
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        const next = Math.max(0.1, Math.min(5.0, this.brushRadius + delta));
        this.brushRadius = parseFloat(next.toFixed(1));
        const slider = document.getElementById('maskBrushSize');
        slider.value = this.brushRadius;
        document.getElementById('maskBrushSizeValue').textContent = this.brushRadius.toFixed(1);
      } else {
        // Capture world position under cursor BEFORE changing zoom
        const rect = c.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const { x: wx, z: wz } = this._canvasToWorld(mx, my);
        // Apply zoom
        const factor = e.deltaY > 0 ? 0.8 : 1.25;
        this.zoom = Math.max(0.25, Math.min(16, this.zoom * factor));
        // Recompute viewCenter so the world point under cursor stays fixed
        const b = this._getViewBounds();
        const visSpanX = (b.maxX - b.minX) / this.zoom;
        const visSpanZ = (b.maxZ - b.minZ) / this.zoom;
        this.viewCX = wx - (mx / c.width  - 0.5) * visSpanX;
        this.viewCZ = wz + (my / c.height - 0.5) * visSpanZ;  // flip
        this._clampView();
        this._updateZoomText();
        if (this.visible) this.render();
      }
    }, { passive: false });
  }

  // ── Painting ───────────────────────────────────────────────────────────────

  _paintAt(mouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const px = mouseEvent.clientX - rect.left;
    const py = mouseEvent.clientY - rect.top;
    const { x, z } = this._canvasToWorld(px, py);
    this.mask.paintBrush(x, z, this.brushRadius, this.paintBlocked);
    this.render();
    this._updateStats();
  }

  // ── Coordinate conversion ──────────────────────────────────────────────────

  _canvasToWorld(px, py) {
    const b = this._getViewBounds();
    const visSpanX = (b.maxX - b.minX) / this.zoom;
    const visSpanZ = (b.maxZ - b.minZ) / this.zoom;
    return {
      x: this.viewCX + (px / this.canvas.width  - 0.5) * visSpanX,
      z: this.viewCZ - (py / this.canvas.height - 0.5) * visSpanZ,  // flip: top = +Z
    };
  }

  _worldToCanvas(wx, wz) {
    const b = this._getViewBounds();
    const visSpanX = (b.maxX - b.minX) / this.zoom;
    const visSpanZ = (b.maxZ - b.minZ) / this.zoom;
    return {
      px: (0.5 + (wx - this.viewCX) / visSpanX) * this.canvas.width,
      py: (0.5 - (wz - this.viewCZ) / visSpanZ) * this.canvas.height,  // flip: top = +Z
    };
  }

  /** Returns the bounds used for viewport/coordinate calculations — scene PLY extent if available, else mask bounds. */
  _getViewBounds() {
    return this.sceneBounds; // ?? this.mask.bounds;
  }

  // ── Scene point cloud ──────────────────────────────────────────────────────

  /**
   * Provide the 3D point positions of the loaded PLY (Float32Array [x,y,z,…]).
   * They will be projected top-down (XZ) in the editor background.
   * Also computes and stores sceneBounds for use as the viewport extent.
   */
  setScenePoints(positions) {
    this.scenePoints = positions;
    if (positions && positions.length >= 3) {
      let minX = Infinity, maxX = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < positions.length; i += 3) {
        if (positions[i]     < minX) minX = positions[i];
        if (positions[i]     > maxX) maxX = positions[i];
        if (positions[i + 2] < minZ) minZ = positions[i + 2];
        if (positions[i + 2] > maxZ) maxZ = positions[i + 2];
      }
      const padX = Math.max(0.5, (maxX - minX) * 0.05);
      const padZ = Math.max(0.5, (maxZ - minZ) * 0.05);
      this.sceneBounds = { minX: minX - padX, maxX: maxX + padX, minZ: minZ - padZ, maxZ: maxZ + padZ };
    } else {
      this.sceneBounds = null;
    }
  }

  /**
   * Fit the viewport to the scene PLY extent (sceneBounds).
   * Does NOT modify mask bounds or grid data.
   */
  _fitBoundsToScene() {
    if (!this.sceneBounds) return;
    this._resetView();
    this.render();
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  render() {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const vb = this._getViewBounds();  // viewport extent (scene PLY bounds or mask bounds)
    const b  = this.mask.bounds;       // mask grid bounds (for cell indexing)
    const visSpanX = (vb.maxX - vb.minX) / this.zoom;
    const visSpanZ = (vb.maxZ - vb.minZ) / this.zoom;
    const viewMinX = this.viewCX - visSpanX / 2;
    const viewMaxX = this.viewCX + visSpanX / 2;
    const viewMinZ = this.viewCZ - visSpanZ / 2;
    const viewMaxZ = this.viewCZ + visSpanZ / 2;

    // — Background —
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, W, H);

    // — Scene point cloud (top-down XZ projection, viewport-aware) —
    if (this.scenePoints) this._drawScenePoints(ctx, W, H);

    // — Blocked cells (only those visible in the current viewport) —
    const res = this.mask.resolution;
    const colMax = this.mask.gridW - 1;
    const rowMax = this.mask.gridH - 1;
    const cellPxW = (res / visSpanX) * W;
    const cellPxH = (res / visSpanZ) * H;
    ctx.fillStyle = 'rgba(220, 50, 50, 0.72)';
    for (let row = 0; row <= rowMax; row++) {
      for (let col = 0; col <= colMax; col++) {
        if (this.mask.data[row * this.mask.gridW + col]) {
          // mask to world 
          //const res2 = (b.maxX - b.minX) / this.mask.gridW;
          const wx = b.minX + col * res;
          const wz = b.maxZ - row * res;
          const { px, py } = this._worldToCanvas(wx, wz);
          ctx.fillRect(Math.floor(px), Math.floor(py), Math.ceil(cellPxW) + 1, Math.ceil(cellPxH) + 1);
        }
      }
    }

    // — Mask bounds rectangle (dashed yellow outline) —
    const { px: mbMinPx, py: mbMaxPy } = this._worldToCanvas(b.minX, b.minZ);
    const { px: mbMaxPx, py: mbMinPy } = this._worldToCanvas(b.maxX, b.maxZ);
    ctx.strokeStyle = 'rgba(255, 200, 0, 0.75)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(Math.round(mbMinPx), Math.round(mbMinPy), Math.round(mbMaxPx - mbMinPx), Math.round(mbMaxPy - mbMinPy));
    ctx.setLineDash([]);

    // — Unit grid lines (only those in the visible range) —
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 0.5;
    for (let x = Math.ceil(viewMinX); x <= Math.floor(viewMaxX); x++) {
      const { px } = this._worldToCanvas(x, 0);
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
    }
    for (let z = Math.ceil(viewMinZ); z <= Math.floor(viewMaxZ); z++) {
      const { py } = this._worldToCanvas(0, z);
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke();
    }

    // — Origin cross —
    const { px: ox, py: oy } = this._worldToCanvas(0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ox - 8, oy); ctx.lineTo(ox + 8, oy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox, oy - 8); ctx.lineTo(ox, oy + 8); ctx.stroke();

    // — Robot position — (negate Z to compensate for -Z forward convention)
    const rpos = this.robot.getPosition();
    const rot  = this.robot.getRotation();
    const { px: rpx, py: rpy } = this._worldToCanvas(rpos.x, -rpos.z);

    const arrowLen = 18;
    ctx.beginPath();
    ctx.moveTo(rpx, rpy);
    ctx.lineTo(rpx - Math.sin(rot) * arrowLen, rpy - Math.cos(rot) * arrowLen);
    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(rpx, rpy, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#00ff88';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // — Brush size preview —
    if (this._lastMousePx !== undefined) {
      const brushPx = (this.brushRadius / visSpanX) * W;
      ctx.beginPath();
      ctx.arc(this._lastMousePx, this._lastMousePy, Math.max(1, brushPx), 0, Math.PI * 2);
      ctx.strokeStyle = this.paintBlocked ? 'rgba(255,80,80,0.8)' : 'rgba(80,255,120,0.8)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /** Draw scene point cloud projected top-down (XZ), respecting current viewport. */
  _drawScenePoints(ctx, W, H) {
    const pts = this.scenePoints;
    const stride = Math.max(1, Math.floor(pts.length / 3 / 15000));
    ctx.fillStyle = 'rgba(100, 149, 237, 0.6)';
    for (let i = 0; i < pts.length; i += 3 * stride) {
      const { px, py } = this._worldToCanvas(pts[i], pts[i + 2]);
      if (px < 0 || px >= W || py < 0 || py >= H) continue;
      ctx.fillRect(Math.round(px), Math.round(py), 2, 2);
    }
  }

  /** Update the active scene id so saves go to the right directory. */
  setSceneId(id) {
    this.sceneId = id || null;
  }

  /** Reset viewport to show the full mask bounds at zoom 1. */
  resetView() { this._resetView(); }
  _resetView() {
    const b = this._getViewBounds();
    this.viewCX = (b.minX + b.maxX) / 2;
    this.viewCZ = (b.minZ + b.maxZ) / 2;
    this.zoom = 1.0;
    this._updateZoomText();
  }

  /** Prevent panning beyond the outer mask bounds. */
  _clampView() {
    const b = this._getViewBounds();
    const visSpanX = (b.maxX - b.minX) / this.zoom;
    const visSpanZ = (b.maxZ - b.minZ) / this.zoom;
    this.viewCX = Math.max(b.minX + visSpanX / 2, Math.min(b.maxX - visSpanX / 2, this.viewCX));
    this.viewCZ = Math.max(b.minZ + visSpanZ / 2, Math.min(b.maxZ - visSpanZ / 2, this.viewCZ));
  }

  // ── Visibility ─────────────────────────────────────────────────────────────

  show() {
    this.visible = true;
    this.panel.style.display = 'flex';
    this._syncParamForm();
    this.render();
    this._updateStats();
  }

  hide() {
    this.visible = false;
    this.panel.style.display = 'none';
  }

  toggle() {
    if (this.visible) this.hide(); else this.show();
  }

  // ── UI helpers ─────────────────────────────────────────────────────────────

  _updateToolButtons() {
    document.getElementById('maskToolBlock').classList.toggle('mask-active', this.paintBlocked);
    document.getElementById('maskToolClear').classList.toggle('mask-active', !this.paintBlocked);
  }

  _updateBoundsText() {
    const b = this.mask.bounds;
    const el = document.getElementById('maskBoundsText');
    if (el) {
      el.textContent =
        `X: ${b.minX.toFixed(1)}…${b.maxX.toFixed(1)}  Z: ${b.minZ.toFixed(1)}…${b.maxZ.toFixed(1)}`;
    }
  }

  _updateZoomText() {
    const el = document.getElementById('maskZoomLevel');
    if (el) el.textContent = `${(this.zoom * 100).toFixed(0)}%`;
  }

  _updateStats() {
    const el = document.getElementById('maskBlockedCount');
    if (el) el.textContent = `${this.mask.blockedCount} celdas`;
  }

  // ── Grid params ────────────────────────────────────────────────────────────

  /** Sync form inputs to current mask.bounds / mask.resolution. */
  _syncParamForm() {
    const { resolution: scale, bounds: b, gridW, gridH } = this.mask;
    document.getElementById('maskParamScale').value = scale;
    document.getElementById('maskParamMinX').value  = b.minX;
    document.getElementById('maskParamMaxZ').value  = b.maxZ;
    document.getElementById('maskParamCols').value  = gridW;
    document.getElementById('maskParamRows').value  = gridH;
    this._updateParamComputed(b.minX, b.maxZ, scale, gridW, gridH);
  }

  /** Update the readonly maxX / minZ computed displays. */
  _updateParamComputed(minX, maxZ, scale, cols, rows) {
    const maxX = minX + cols * scale;
    const minZ = maxZ - rows * scale;
    document.getElementById('maskParamMaxXDisplay').textContent = maxX.toFixed(3);
    document.getElementById('maskParamMinZDisplay').textContent = minZ.toFixed(3);
  }

  /**
   * Live preview: mutate mask.bounds and mask.resolution WITHOUT rebuilding
   * the grid.  The existing cells stay in the Uint8Array but their visual
   * world positions stretch/shift to match the new bounds — good enough as a
   * preview before the user hits "Aplicar".
   */
  _applyParamPreview() {
    const scale = parseFloat(document.getElementById('maskParamScale').value);
    const minX  = parseFloat(document.getElementById('maskParamMinX').value);
    const maxZ  = parseFloat(document.getElementById('maskParamMaxZ').value);
    const cols  = parseInt(document.getElementById('maskParamCols').value, 10);
    const rows  = parseInt(document.getElementById('maskParamRows').value, 10);
    if ([scale, minX, maxZ, cols, rows].some(v => isNaN(v))) return;
    if (scale <= 0 || cols < 1 || rows < 1) return;
    const maxX = minX + cols * scale;
    const minZ = maxZ - rows * scale;
    this._updateParamComputed(minX, maxZ, scale, cols, rows);
    // Direct mutation — no grid rebuild
    this.mask.bounds.minX = minX;
    this.mask.bounds.maxX = maxX;
    this.mask.bounds.minZ = minZ;
    this.mask.bounds.maxZ = maxZ;
    this.mask.resolution  = scale;
    this._updateBoundsText();
    this._clampView();
    if (this.visible) this.render();
  }

  /**
   * Fully apply new params: rebuilds the grid (clears mask data).
   * Asks for confirmation if there is existing mask data.
   */
  _applyParamsFinal() {
    const scale = parseFloat(document.getElementById('maskParamScale').value);
    const minX  = parseFloat(document.getElementById('maskParamMinX').value);
    const maxZ  = parseFloat(document.getElementById('maskParamMaxZ').value);
    const cols  = parseInt(document.getElementById('maskParamCols').value, 10);
    const rows  = parseInt(document.getElementById('maskParamRows').value, 10);
    if ([scale, minX, maxZ, cols, rows].some(v => isNaN(v))) return;
    if (scale <= 0) { alert('La resolución debe ser mayor que 0.'); return; }
    if (cols < 1 || rows < 1) { alert('Las columnas y filas deben ser ≥ 1.'); return; }
    const maxX = minX + cols * scale;
    const minZ = maxZ - rows * scale;
    this._updateParamComputed(minX, maxZ, scale, cols, rows);
    if (this.mask.blockedCount > 0 &&
        !confirm('Aplicar nuevos parámetros reconstruirá el grid y borrará la máscara actual. ¿Continuar?')) return;
    this.mask.resolution = scale;
    this.mask.setBounds({ minX, maxX, minZ, maxZ }); // calls _buildGrid → clears data
    this._updateBoundsText();
    this._resetView();
    this.render();
    this._updateStats();
  }

  // ── Save / Load ────────────────────────────────────────────────────────────

  async _saveMask() {
    // ── Render mask to PNG ──────────────────────────────────────────────────
    const offCanvas = document.createElement('canvas');
    offCanvas.width  = this.mask.gridW;
    offCanvas.height = this.mask.gridH;
    const octx    = offCanvas.getContext('2d');
    const imgData = octx.createImageData(this.mask.gridW, this.mask.gridH);
    for (let i = 0; i < this.mask.data.length; i++) {
      const v = this.mask.data[i] === 1 ? 0 : 255; // blocked → black, free → white
      imgData.data[i * 4 + 0] = v;
      imgData.data[i * 4 + 1] = v;
      imgData.data[i * 4 + 2] = v;
      imgData.data[i * 4 + 3] = 255;
    }
    octx.putImageData(imgData, 0, 0);
    const pngDataUrl = offCanvas.toDataURL('image/png');

    // ── Build occupancy.json metadata ───────────────────────────────────────
    const occupancy = {
      scale: this.mask.resolution,
      min:   [this.mask.bounds.minX, this.mask.bounds.minZ],
      max:   [this.mask.bounds.maxX, this.mask.bounds.maxZ],
    };

    // ── POST to server ──────────────────────────────────────────────────────
    try {
      let url, body, successMsg;
      if (this.sceneId) {
        // Save directly into the scene's data directory
        url = `/api/scenes/${encodeURIComponent(this.sceneId)}/save-mask`;
        body = JSON.stringify({ png: pngDataUrl, occupancy });
        successMsg = (r) => `Máscara guardada en la escena '${this.sceneId}'` +
                            (r.bakN ? ` (backup .bak${r.bakN})` : '');
      } else {
        // No scene loaded — ask for a name and save to the masks folder
        const rawName = prompt('Nombre del escenario:', 'escenario_1');
        if (!rawName) return;
        const name = rawName.trim();
        if (!name) return;
        url = '/api/save-mask-v2';
        body = JSON.stringify({ name, png: pngDataUrl, occupancy });
        successMsg = (r) => `Máscara guardada en masks/${r.dir}/`;
      }

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const result = await resp.json();
      if (result.success) {
        alert(successMsg(result));
      } else {
        alert(`Error al guardar: ${result.error}`);
      }
    } catch (err) {
      alert(`Error al guardar: ${err.message}`);
    }
  }

  _loadFromFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target.result);
        this.mask.fromJSON(json);
        this._syncParamForm();
        this._updateBoundsText();
        this._resetView();
        this.render();
        this._updateStats();
      } catch (err) {
        alert(`Error al cargar la máscara: ${err.message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // allow re-loading same file
  }
}
