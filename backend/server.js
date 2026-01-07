const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;
const WS_PORT = 8081;

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
      
      // Handle robot commands from explore.py
      if (msg.type === 'robot_command' && frontendClient) {
        // Forward command to frontend for execution
        frontendClient.send(JSON.stringify({
          type: 'movement_command',
          command: msg.command,
          value: msg.value
        }));
        console.log(`Forwarded robot command: ${msg.command}`);
      }
      
      // Handle rendered images from frontend
      if (msg.type === 'rendered_image' && robotClient) {
        // Forward image to robot client
        console.log('Received image from frontend, forwarding to robot...');
        robotClient.send(JSON.stringify({
          type: 'image_data',
          data: msg.data,
          timestamp: msg.timestamp
        }));
        console.log('Forwarded rendered image to robot client');
      }
      
      // Handle image requests from robot
      if (msg.type === 'request_image' && frontendClient) {
        // Request image capture from frontend
        console.log('Robot requested image, forwarding to frontend...');
        frontendClient.send(JSON.stringify({
          type: 'capture_image'
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
