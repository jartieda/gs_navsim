const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;
const WS_PORT = 8081;

// Directory for saved obstacle masks
const MASKS_DIR = path.join(__dirname, 'masks');
if (!fs.existsSync(MASKS_DIR)) fs.mkdirSync(MASKS_DIR);

// Directory containing scene data (occupancy + PLY files)
const DATA_DIR = '/mnt/c/data';

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Serve test page
app.get('/test', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/test-ellipses.html'));
});

// API endpoint to save images
app.post('/api/save-image', (req, res) => {
  try {
    const { image, timestamp } = req.body;
    const imageData = image.replace(/^data:image\/png;base64,/, '');
    const filename = `manual_export_${timestamp.replace(/[:.]/g, '-')}.png`;
    
    fs.writeFileSync(path.join(__dirname, filename), imageData, 'base64');
    console.log(`Saved manual export: ${filename}`);
    
    res.json({ success: true, filename });
  } catch (error) {
    console.error('Error saving image:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── Obstacle mask API ──────────────────────────────────────────────────────

/** POST /api/save-mask  { name: string, mask: object } */
app.post('/api/save-mask', (req, res) => {
  try {
    const { name, mask } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ success: false, error: 'name is required' });
    }
    // Sanitise filename to prevent path traversal
    const safeName = name.replace(/[^a-zA-Z0-9_\-]/g, '_').substring(0, 64);
    if (!safeName) {
      return res.status(400).json({ success: false, error: 'invalid name' });
    }
    const filename = `${safeName}.json`;
    const filepath = path.join(MASKS_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(mask, null, 2), 'utf8');
    console.log(`Saved mask: ${filename}`);
    res.json({ success: true, filename });
  } catch (error) {
    console.error('Error saving mask:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/masks  → [{ name, filename, mtime }] */
app.get('/api/masks', (req, res) => {
  try {
    const files = fs.readdirSync(MASKS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const stat = fs.statSync(path.join(MASKS_DIR, f));
        return { name: f.replace(/\.json$/, ''), filename: f, mtime: stat.mtime };
      });
    res.json({ success: true, masks: files });
  } catch (error) {
    console.error('Error listing masks:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/save-mask-v2
 * Body: { name: string, png: string (data-URL), occupancy: object }
 *
 * Saves <MASKS_DIR>/<name>/occupancy.png  +  occupancy.json.
 * If those files already exist they are rotated to .bak1 / .bak2 … before
 * writing the new version.
 */
app.post('/api/save-mask-v2', (req, res) => {
  try {
    const { name, png, occupancy } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ success: false, error: 'name is required' });
    }
    const safeName = name.replace(/[^a-zA-Z0-9_\-]/g, '_').substring(0, 64);
    if (!safeName) {
      return res.status(400).json({ success: false, error: 'invalid name' });
    }

    const sceneDir = path.resolve(MASKS_DIR, safeName);
    // Defence-in-depth: ensure the resolved path stays inside MASKS_DIR
    if (!sceneDir.startsWith(path.resolve(MASKS_DIR) + path.sep)) {
      return res.status(400).json({ success: false, error: 'invalid name' });
    }

    if (!fs.existsSync(sceneDir)) fs.mkdirSync(sceneDir, { recursive: true });

    const pngPath  = path.join(sceneDir, 'occupancy.png');
    const jsonPath = path.join(sceneDir, 'occupancy.json');

    // If either file already exists, rotate existing files to the next .bakN slot
    if (fs.existsSync(pngPath) || fs.existsSync(jsonPath)) {
      let bakN = 1;
      while (
        fs.existsSync(`${pngPath}.bak${bakN}`) ||
        fs.existsSync(`${jsonPath}.bak${bakN}`)
      ) {
        bakN++;
      }
      if (fs.existsSync(pngPath))  fs.renameSync(pngPath,  `${pngPath}.bak${bakN}`);
      if (fs.existsSync(jsonPath)) fs.renameSync(jsonPath, `${jsonPath}.bak${bakN}`);
      console.log(`Backed up existing mask '${safeName}' → .bak${bakN}`);
    }

    // Write PNG (strip data-URL prefix if present)
    const pngData = png.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(pngPath, pngData, 'base64');

    // Write occupancy.json
    fs.writeFileSync(jsonPath, JSON.stringify(occupancy, null, 2), 'utf8');

    console.log(`Saved mask v2: ${safeName}`);
    res.json({ success: true, dir: safeName });
  } catch (error) {
    console.error('Error saving mask v2:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/masks/:name  → mask JSON */
app.get('/api/masks/:name', (req, res) => {
  try {
    const safeName = req.params.name.replace(/[^a-zA-Z0-9_\-]/g, '_').substring(0, 64);
    const filepath = path.join(MASKS_DIR, `${safeName}.json`);
    // Ensure resolved path stays inside MASKS_DIR (defence-in-depth)
    const resolved = path.resolve(filepath);
    if (!resolved.startsWith(path.resolve(MASKS_DIR) + path.sep)) {
      return res.status(400).json({ success: false, error: 'invalid name' });
    }
    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ success: false, error: 'mask not found' });
    }
    const data = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    res.json({ success: true, mask: data });
  } catch (error) {
    console.error('Error loading mask:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── Scene data API (serves from DATA_DIR) ────────────────────────────────────

/** GET /api/scenes → [{ id }] */
app.get('/api/scenes', (req, res) => {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      return res.json({ success: true, scenes: [] });
    }
    const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => ({ id: d.name }));
    res.json({ success: true, scenes: entries });
  } catch (error) {
    console.error('Error listing scenes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/scenes/:id/occupancy → occupancy.json metadata */
app.get('/api/scenes/:id/occupancy', (req, res) => {
  try {
    const sceneId = req.params.id.replace(/[^a-zA-Z0-9_\-]/g, '');
    const jsonPath = path.resolve(DATA_DIR, sceneId, 'occupancy.json');
    if (!jsonPath.startsWith(path.resolve(DATA_DIR) + path.sep)) {
      return res.status(400).json({ success: false, error: 'invalid scene id' });
    }
    if (!fs.existsSync(jsonPath)) {
      return res.status(404).json({ success: false, error: 'occupancy.json not found' });
    }
    res.sendFile(jsonPath);
  } catch (error) {
    console.error('Error serving occupancy JSON:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/scenes/:id/occupancy.png → occupancy PNG image */
app.get('/api/scenes/:id/occupancy.png', (req, res) => {
  try {
    const sceneId = req.params.id.replace(/[^a-zA-Z0-9_\-]/g, '');
    const pngPath = path.resolve(DATA_DIR, sceneId, 'occupancy.png');
    if (!pngPath.startsWith(path.resolve(DATA_DIR) + path.sep)) {
      return res.status(400).end();
    }
    if (!fs.existsSync(pngPath)) {
      return res.status(404).end();
    }
    res.sendFile(pngPath);
  } catch (error) {
    console.error('Error serving occupancy PNG:', error);
    res.status(500).end();
  }
});

/** GET /api/scenes/:id/ply → 3DGS PLY file (compressed preferred) */
app.get('/api/scenes/:id/ply', (req, res) => {
  try {
    const sceneId = req.params.id.replace(/[^a-zA-Z0-9_\-]/g, '');
    const sceneDir = path.resolve(DATA_DIR, sceneId);
    if (!sceneDir.startsWith(path.resolve(DATA_DIR) + path.sep)) {
      return res.status(400).end();
    }
    const uncompressed = path.join(sceneDir, '3dgs_uncompressed.ply');
    const compressed = path.join(sceneDir, '3dgs_compressed.ply');
    const plyPath = fs.existsSync(uncompressed) ? uncompressed : compressed;
    if (!fs.existsSync(plyPath)) {
      return res.status(404).json({ success: false, error: 'PLY file not found' });
    }
    res.sendFile(plyPath);
  } catch (error) {
    console.error('Error serving PLY:', error);
    res.status(500).end();
  }
});

/**
 * POST /api/scenes/:id/save-mask
 * Body: { png: string (data-URL), occupancy: object }
 *
 * Overwrites occupancy.png + occupancy.json inside DATA_DIR/<id>/.
 * Existing files are backed up to .bak1 / .bak2 … before writing.
 */
app.post('/api/scenes/:id/save-mask', (req, res) => {
  try {
    const sceneId = req.params.id.replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!sceneId) return res.status(400).json({ success: false, error: 'invalid scene id' });

    const sceneDir = path.resolve(DATA_DIR, sceneId);
    if (!sceneDir.startsWith(path.resolve(DATA_DIR) + path.sep)) {
      return res.status(400).json({ success: false, error: 'invalid scene id' });
    }
    if (!fs.existsSync(sceneDir)) {
      return res.status(404).json({ success: false, error: 'scene not found' });
    }

    const { png, occupancy } = req.body;
    if (!png || !occupancy) {
      return res.status(400).json({ success: false, error: 'png and occupancy are required' });
    }

    const pngPath  = path.join(sceneDir, 'occupancy.png');
    const jsonPath = path.join(sceneDir, 'occupancy.json');

    // Rotate existing files to the next free .bakN slot
    let bakN = null;
    if (fs.existsSync(pngPath) || fs.existsSync(jsonPath)) {
      let n = 1;
      while (
        fs.existsSync(`${pngPath}.bak${n}`) ||
        fs.existsSync(`${jsonPath}.bak${n}`)
      ) { n++; }
      if (fs.existsSync(pngPath))  fs.renameSync(pngPath,  `${pngPath}.bak${n}`);
      if (fs.existsSync(jsonPath)) fs.renameSync(jsonPath, `${jsonPath}.bak${n}`);
      bakN = n;
      console.log(`Backed up mask for scene '${sceneId}' → .bak${n}`);
    }

    const pngData = png.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(pngPath, pngData, 'base64');
    fs.writeFileSync(jsonPath, JSON.stringify(occupancy, null, 2), 'utf8');

    console.log(`Saved mask for scene '${sceneId}'`);
    res.json({ success: true, sceneId, bakN });
  } catch (error) {
    console.error('Error saving scene mask:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start HTTP server
app.listen(PORT, () => {
  console.log(`HTTP server running on http://localhost:${PORT}`);
});

// WebSocket server for robot commands
const wss = new WebSocket.Server({ port: WS_PORT });

// Store connected clients (simulator frontend and robot controller)
let frontendClient = null;
let robotClient = null;

wss.on('connection', (ws, req) => {
  console.log('New client connected');
  
  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);
      console.log(`Received message from client: ${msg.type}`);
      
      // Handle client identification
      if (msg.type === 'identify') {
        if (msg.client === 'frontend') {
          frontendClient = ws;
          console.log('Frontend client identified');
        } else if (msg.client === 'robot') {
          robotClient = ws;
          console.log('Robot client identified');
        }
        return;
      }
      
      // Handle robot commands from robot client → forward to frontend
      if (msg.type === 'robot_command' && frontendClient) {
        frontendClient.send(JSON.stringify({
          type: 'movement_command',
          command: msg.command,
          value: msg.value
        }));
        console.log(`Forwarded robot command: ${msg.command}`);
      }

      // Handle reset_robot from robot client → forward to frontend (with optional pose)
      if (msg.type === 'reset_robot' && frontendClient) {
        frontendClient.send(JSON.stringify({
          type: 'reset_robot',
          x:        msg.x        ?? 0,
          y:        msg.y        ?? 0.50,
          z:        msg.z        ?? 0,
          rotation: msg.rotation ?? 0,
        }));
        console.log('Forwarded reset_robot to frontend');
      }

      // Handle reset_robot_random from robot client → forward to frontend
      if (msg.type === 'reset_robot_random' && frontendClient) {
        frontendClient.send(JSON.stringify({
          type:         'reset_robot_random',
          y:            msg.y            ?? 0.50,
          robot_radius: msg.robot_radius ?? 0.35,
        }));
        console.log('Forwarded reset_robot_random to frontend');
      }

      // Handle robot_pose from frontend → forward to robot client
      if (msg.type === 'robot_pose' && robotClient) {
        robotClient.send(JSON.stringify(msg));
        console.log(`Forwarded robot_pose to robot client: x=${msg.x?.toFixed(2)} z=${msg.z?.toFixed(2)} rot=${msg.rotation?.toFixed(2)}`);
      }
      
      // Handle rendered images from frontend → forward to robot client
      if (msg.type === 'rendered_image' && robotClient) {
        console.log('Received image from frontend, forwarding to robot...');
        robotClient.send(JSON.stringify({
          type: 'image_data',
          data: msg.data,
          timestamp: msg.timestamp
        }));
        console.log('Forwarded rendered image to robot client');
      }
      
      // Handle image requests from robot → ask frontend to capture
      if (msg.type === 'request_image' && frontendClient) {
        console.log('Robot requested image, forwarding to frontend...');
        frontendClient.send(JSON.stringify({ type: 'capture_image' }));
      }

      // ── Collision event: frontend detected a blocked move → tell robot ──
      if (msg.type === 'collision_event' && robotClient) {
        console.log('Collision detected, notifying robot client');
        robotClient.send(JSON.stringify({
          type: 'collision',
          position: msg.position,
        }));
      }

      // ── Scene loading: robot requests scene change → frontend, result back ──
      if (msg.type === 'load_scene' && frontendClient) {
        frontendClient.send(JSON.stringify({ type: 'load_scene', scene_id: msg.scene_id }));
        console.log(`Forwarded load_scene: ${msg.scene_id}`);
      }

      if (msg.type === 'scene_loaded' && robotClient) {
        robotClient.send(JSON.stringify(msg));
        console.log(`Forwarded scene_loaded: ${msg.scene_id}`);
      }

      if (msg.type === 'scene_load_error' && robotClient) {
        robotClient.send(JSON.stringify(msg));
        console.log(`Forwarded scene_load_error: ${msg.scene_id}`);
      }
      
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  ws.on('close', () => {
    if (ws === frontendClient) {
      frontendClient = null;
      console.log('Frontend client disconnected');
    } else if (ws === robotClient) {
      robotClient = null;
      console.log('Robot client disconnected');
    }
  });
});

console.log(`WebSocket server running on ws://localhost:${WS_PORT}`);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down servers...');
  wss.close();
  process.exit(0);
});
