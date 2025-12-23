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

wss.on('connection', (ws) => {
  console.log('Robot client connected');
  
  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);
      if (msg.type === 'image') {
        // Save rendered image with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const imageData = msg.data.replace(/^data:image\/png;base64,/, '');
        const filename = `rendered_image_${timestamp}.png`;
        
        fs.writeFileSync(path.join(__dirname, filename), imageData, 'base64');
        console.log(`Saved rendered image: ${filename}`);
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  ws.on('close', () => {
    console.log('Robot client disconnected');
  });

  // Example robot command sender
  let commandInterval;
  
  // Send initial test commands after a delay
  setTimeout(() => {
    console.log('Starting robot command sequence...');
    
    // Send forward command
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'forward' }));
      console.log('Sent: forward command');
    }
    
    // Send periodic turn commands
    commandInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        const commands = [
          { type: 'forward' },
          { type: 'turn', value: Math.PI / 8 }, // 22.5 degrees
          { type: 'turn', value: -Math.PI / 8 }
        ];
        
        const command = commands[Math.floor(Math.random() * commands.length)];
        ws.send(JSON.stringify(command));
        console.log(`Sent: ${command.type} command`);
      }
    }, 30000);
  }, 2000);

  ws.on('close', () => {
    if (commandInterval) {
      clearInterval(commandInterval);
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
