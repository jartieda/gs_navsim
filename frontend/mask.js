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
    const row = Math.floor((this.bounds.maxZ - z) / this.resolution); // row 0 = maxZ (matches PNG + display)
    return { col, row };
  }

  cellToWorldCenter(col, row) {
    return {
      x: this.bounds.minX + (col + 0.5) * this.resolution,
      z: this.bounds.maxZ - (row + 0.5) * this.resolution, // row 0 = maxZ
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
    // Outside mask bounds → free space (not an obstacle)
    const b = this.bounds;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return true;
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
    // Centre outside mask bounds → blocked (treat out-of-bounds as solid wall)
    const b = this.bounds;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return true;
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

  /**
   * Load occupancy from the occupancy.json + occupancy.png format used in
   * /mnt/c/data/<scene>/.
   *
   * occupancy.json fields:
   *   scale  – metres per pixel
   *   min    – [minX, minY, minZ] world lower bound
   *   max    – [maxX, maxY, maxZ] world upper bound
   *
   * The PNG is a grayscale image where dark pixels (< 128) are occupied.
   * Row 0 of the image corresponds to maxZ (top of the map), so we flip
   * vertically when filling the grid (row 0 → minZ side).
   *
   * @param {object} jsonData   Parsed occupancy.json object.
   * @param {string} pngUrl     URL of the occupancy.png to fetch.
   * @returns {Promise<void>}
   */
  async fromOccupancyPNG(jsonData, pngUrl) {
    const scale = jsonData.scale;
    const minX  = jsonData.min[0];
    const maxX  = jsonData.max[0];
    const minZ  = jsonData.min[1];   // ROS Y → simulator Z
    const maxZ  = jsonData.max[1];

    // Load image via a hidden canvas so we can read pixel data.
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = pngUrl;
    });

    const w = img.width;
    const h = img.height;

    const offCanvas = document.createElement('canvas');
    offCanvas.width  = w;
    offCanvas.height = h;
    const ctx = offCanvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, w, h);

    this.resolution = scale;
    this.bounds     = { minX, maxX, minZ, maxZ };
    this.gridW      = w;
    this.gridH      = h;
    this.data       = new Uint8Array(w * h);

    // PNG row 0 = top of map = maxZ; grid row 0 = minZ → flip vertically.
    for (let row = 0; row < h; row++) {
      //const imgRow = h - 1 - row;          // flipped row in PNG
      const imgRow = row;                    // no flip 
      for (let col = 0; col < w; col++) {
        const pixelIdx  = (imgRow * w + col) * 4;
        const r         = imageData.data[pixelIdx]; // grayscale value
        this.data[row * w + col] = r < 128 ? 1 : 0;
      }
    }
  }

  /** How many cells are marked as blocked. */
  get blockedCount() {
    let n = 0;
    for (let i = 0; i < this.data.length; i++) if (this.data[i]) n++;
    return n;
  }

  /**
   * Return a random position (in Three.js world space) whose robot footprint
   * is entirely free of obstacles.
   *
   * The mask stores z in "mask space" where z_mask = −z_threejs.
   * This method returns {x, z} already converted to Three.js coordinates so
   * the caller can pass them directly to robot.setPosition(x, y, z).
   *
   * @param {number} [robotRadius=0.35]  Footprint radius in world units.
   * @returns {{ x: number, z: number }}
   */
  randomFreePosition(robotRadius = 0.35) {
    // Collect all free cells
    const free = [];
    for (let row = 0; row < this.gridH; row++) {
      for (let col = 0; col < this.gridW; col++) {
        if (!this.data[row * this.gridW + col]) free.push([row, col]);
      }
    }
    if (free.length === 0) return { x: 0, z: 0 };

    // Fisher-Yates shuffle for O(n) random order without replacement
    for (let i = free.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = free[i]; free[i] = free[j]; free[j] = tmp;
    }

    for (const [row, col] of free) {
      // Convert cell → display-world Z (same convention as worldToCell: row 0 = maxZ)
      const xm = this.bounds.minX + (col + 0.5) * this.resolution;
      const zm = this.bounds.maxZ - (row + 0.5) * this.resolution;
      if (!this.isBlockedCircle(xm, zm, robotRadius)) {
        return { x: xm, z: -zm }; // convert display-z → Three.js z
      }
    }

    // Fallback: return first free cell centre even if footprint overlaps
    const [row, col] = free[0];
    const xm = this.bounds.minX + (col + 0.5) * this.resolution;
    const zm = this.bounds.maxZ - (row + 0.5) * this.resolution;
    return { x: xm, z: -zm };
  }
}
