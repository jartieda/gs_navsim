// mask.js
// 2D occupancy grid (top-down XZ plane) for collision detection.
// One cell = `resolution` world units. Default bounds: -10..10 in X and Z.

export class MaskManager {
  /**
   * @param {object} options
   * @param {number} [options.resolution=0.2]  World units per grid cell.
   * @param {object} [options.bounds]          {minX, maxX, minZ, maxZ}
   */
  constructor(options = {}) {
    this.resolution = options.resolution ?? 0.2;
    this.bounds = options.bounds ?? { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
    this._buildGrid();
  }

  // ── Grid lifecycle ─────────────────────────────────────────────────────────

  _buildGrid() {
    this.gridW = Math.max(1, Math.ceil((this.bounds.maxX - this.bounds.minX) / this.resolution));
    this.gridH = Math.max(1, Math.ceil((this.bounds.maxZ - this.bounds.minZ) / this.resolution));
    this.data = new Uint8Array(this.gridW * this.gridH); // 0=free, 1=blocked
  }

  /**
   * Update world bounds and rebuild the grid (clears existing mask data).
   * @param {object} bounds  {minX, maxX, minZ, maxZ}
   */
  setBounds(bounds) {
    this.bounds = { ...bounds };
    this._buildGrid();
  }

  // ── Coordinate conversion ──────────────────────────────────────────────────

  worldToCell(x, z) {
    const col = Math.floor((x - this.bounds.minX) / this.resolution);
    const row = Math.floor((z - this.bounds.minZ) / this.resolution);
    return { col, row };
  }

  cellToWorldCenter(col, row) {
    return {
      x: this.bounds.minX + (col + 0.5) * this.resolution,
      z: this.bounds.minZ + (row + 0.5) * this.resolution,
    };
  }

  _inBounds(col, row) {
    return col >= 0 && col < this.gridW && row >= 0 && row < this.gridH;
  }

  // ── Cell access ────────────────────────────────────────────────────────────

  getCell(col, row) {
    if (!this._inBounds(col, row)) return false;
    return this.data[row * this.gridW + col] === 1;
  }

  setCell(col, row, blocked) {
    if (!this._inBounds(col, row)) return;
    this.data[row * this.gridW + col] = blocked ? 1 : 0;
  }

  // ── Collision queries ──────────────────────────────────────────────────────

  /** True if the point (x, z) falls in a blocked cell. */
  isBlocked(x, z) {
    const { col, row } = this.worldToCell(x, z);
    return this.getCell(col, row);
  }

  /**
   * True if any cell within `radius` world units of (x, z) is blocked.
   * Use this to do robot-footprint collision detection.
   * @param {number} x
   * @param {number} z
   * @param {number} radius  World units — typical robot footprint ~0.3
   */
  isBlockedCircle(x, z, radius) {
    const radiusCells = Math.ceil(radius / this.resolution);
    const { col: cx, row: cz } = this.worldToCell(x, z);
    for (let dr = -radiusCells; dr <= radiusCells; dr++) {
      for (let dc = -radiusCells; dc <= radiusCells; dc++) {
        const dist = Math.sqrt(dc * dc + dr * dr) * this.resolution;
        if (dist <= radius && this.getCell(cx + dc, cz + dr)) return true;
      }
    }
    return false;
  }

  // ── Painting ───────────────────────────────────────────────────────────────

  /**
   * Paint a circular brush centred at (worldX, worldZ).
   * @param {number} worldX
   * @param {number} worldZ
   * @param {number} brushRadiusWorld  Brush radius in world units.
   * @param {boolean} blocked          true = mark as obstacle, false = clear.
   */
  paintBrush(worldX, worldZ, brushRadiusWorld, blocked) {
    const brushCells = Math.ceil(brushRadiusWorld / this.resolution);
    const { col: cx, row: cz } = this.worldToCell(worldX, worldZ);
    for (let dr = -brushCells; dr <= brushCells; dr++) {
      for (let dc = -brushCells; dc <= brushCells; dc++) {
        const dist = Math.sqrt(dc * dc + dr * dr) * this.resolution;
        if (dist <= brushRadiusWorld) {
          this.setCell(cx + dc, cz + dr, blocked);
        }
      }
    }
  }

  /** Mark every cell as free. */
  clear() {
    this.data.fill(0);
  }

  // ── Serialisation ──────────────────────────────────────────────────────────

  toJSON() {
    return {
      resolution: this.resolution,
      bounds: { ...this.bounds },
      gridW: this.gridW,
      gridH: this.gridH,
      data: Array.from(this.data),
    };
  }

  fromJSON(json) {
    this.resolution = json.resolution;
    this.bounds = { ...json.bounds };
    this.gridW = json.gridW;
    this.gridH = json.gridH;
    this.data = new Uint8Array(json.data);
  }

  /** How many cells are marked as blocked. */
  get blockedCount() {
    let n = 0;
    for (let i = 0; i < this.data.length; i++) if (this.data[i]) n++;
    return n;
  }
}
