# Robotic Navigation Simulator

This web-based simulator uses Three.js to visualize robotic navigation with Gaussian splatting. Features:
- Load `.ply` files for scene geometry
- Navigate with arrow keys
- Receive robot commands via socket (forward, turn)
- Render and export scene images

## Structure
- `index.html`: Main web page
- `main.js`: App entry point
- `renderer.js`: Three.js scene, Gaussian splatting, navigation, image export
- `socket.js`: WebSocket client for robot commands
- `backend/server.js`: WebSocket server for robot commands

## Usage
1. Start the backend server: `node backend/server.js`
2. Open `frontend/index.html` in a browser
3. Load a `.ply` file and use arrow keys or socket commands to navigate
4. Export images using the button
