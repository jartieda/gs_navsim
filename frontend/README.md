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
1. Start the backend server: `cd backend && npm start` or `node backend/server.js`
2. Open your browser and go to: `http://localhost:3000`
3. Load a `.ply` file and use arrow keys or socket commands to navigate
4. Export images using the button

## Robot Camera Capture Size

The WebSocket image sent to robot clients is configurable via URL parameters.

- Default: `96x96`
- Example for larger image: `http://localhost:3000/?capture_w=240&capture_h=240`

If only `capture_w` is provided, height defaults to the same value.

**Note**: The frontend is now served directly from the backend server, no need to open HTML files separately.
