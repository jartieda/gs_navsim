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
