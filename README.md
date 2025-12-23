# Robotic Navigation Simulator with Gaussian Splatting

A web-based robotic navigation simulator that uses Three.js for rendering and Gaussian splatting for visualizing 3D scenes from PLY files.

## Features

- **PLY File Loading**: Load and visualize .ply files with Gaussian splatting-like point cloud rendering
- **Navigation**: Use arrow keys (or WASD) to navigate through the scene
- **Socket Communication**: Receive robot commands via WebSocket (forward, turn) 
- **Image Export**: Export scene views as PNG images locally or save to server
- **Real-time Rendering**: Responsive rendering with camera following robot movement

## Project Structure

```
gs_navsim/
├── frontend/
│   ├── index.html          # Main web page
│   ├── main.js             # Application entry point
│   ├── renderer.js         # Three.js scene setup and rendering
│   ├── socket.js           # WebSocket client for robot commands
│   ├── controls.js         # Keyboard input handling
│   ├── utils.js            # Utility classes (RobotController, CameraController)
│   └── README.md           # This file
└── backend/
    ├── server.js           # Express + WebSocket server
    ├── package.json        # Node.js dependencies
    └── [exported images]   # Generated PNG files
```

## Setup and Usage

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Start the Server
```bash
cd backend
npm start
```

### 3. Open the Application
Navigate to `http://localhost:3000` in your web browser.

### 4. Load a PLY File
- Use the file input to load a `.ply` file
- The scene will automatically center and display the point cloud

### 5. Navigation
- **Arrow Keys** or **WASD**: Move the robot through the scene
- The camera automatically follows the robot's movement
- The view direction matches the robot's orientation

### 6. Export Images
- **Export Image**: Download PNG to your local machine
- **Save to Server**: Save PNG to the backend server

### 7. Socket Commands
The server automatically sends robot commands via WebSocket:
- `{ type: 'forward' }`: Move robot forward
- `{ type: 'turn', value: 0.196 }`: Turn robot (value in radians)

## Technical Details

### Gaussian Splatting Rendering
- Uses Three.js `PointsMaterial` with additive blending
- Vertex colors support for colored point clouds
- Automatic color generation for PLY files without color data

### Robot Control System
- `RobotController` class manages position and rotation
- `CameraController` class handles camera following behavior
- `KeyboardControls` class manages input with WASD/arrow key support

### WebSocket Communication
- Server sends robot commands to client
- Client responds with rendered images as base64 PNG data
- Automatic image saving on server with timestamps

## Extending the Simulator

### Adding New Robot Commands
Modify `backend/server.js` to send custom commands:
```javascript
ws.send(JSON.stringify({ 
  type: 'custom_command', 
  params: { speed: 0.5, angle: Math.PI/4 } 
}));
```

Handle in `frontend/socket.js`:
```javascript
if (cmd.type === 'custom_command') {
  // Handle custom command
}
```

### Customizing Gaussian Splatting
Modify `utils.js` `createGaussianMaterial()` function:
```javascript
export function createGaussianMaterial(options = {}) {
  return new THREE.PointsMaterial({
    size: options.size || 0.05,        // Larger points
    transparent: true,
    opacity: 0.9,
    blending: THREE.NormalBlending     // Different blending mode
  });
}
```

## Dependencies

### Frontend
- Three.js (via CDN)
- PLYLoader (Three.js examples)

### Backend
- Node.js
- Express.js
- ws (WebSocket library)

## Browser Compatibility
- Modern browsers with WebGL support
- WebSocket support required
- File API support for PLY loading