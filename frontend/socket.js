// socket.js
// Handles socket communication for robot commands.
// Supports optional collision detection via a MaskManager instance.

// Robot footprint radius used for collision checks (world units).
const ROBOT_RADIUS = 0.3;

/**
 * @param {import('./utils.js').RobotController} robot
 * @param {THREE.Scene}   scene
 * @param {THREE.Camera}  camera
 * @param {THREE.WebGLRenderer} renderer
 * @param {import('./utils.js').CameraController} cameraController
 * @param {import('./mask.js').MaskManager|null} maskManager   Optional obstacle mask.
 * @param {Function|null} onMovementCallback  Called after every successful move.
 */
export function setupSocket(
  robot, scene, camera, renderer, cameraController,
  maskManager = null, onMovementCallback = null,
) {
  const socket = new WebSocket('ws://localhost:8081');

  socket.onopen = () => {
    console.log('Connected to robot command server');
    socket.send(JSON.stringify({ type: 'identify', client: 'frontend' }));
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      console.log('Frontend received message:', msg);

      if (msg.type === 'movement_command') {
        console.log('Processing movement command:', msg.command);

        // ── Collision pre-check ──────────────────────────────────────────────
        if (maskManager) {
          const projected = robot.getProjectedPosition(msg.command, msg.value);
          if (maskManager.isBlockedCircle(projected.x, -projected.z, ROBOT_RADIUS)) {
            console.warn('Collision detected — movement blocked');
            // Notify robot client of collision
            socket.send(JSON.stringify({
              type: 'collision_event',
              position: { x: robot.position.x, z: robot.position.z },
            }));
            // Flash visual indicator in the browser
            _showCollisionFlash();
            // Still render current view and send image so robot gets an observation
            renderer.render(scene, camera);
            captureAndSendImage(socket, renderer);
            return; // skip movement application
          }
        }

        // ── Apply movement ───────────────────────────────────────────────────
        if (msg.command === 'forward') {
          robot.moveForward(msg.value != null ? msg.value : undefined);
        } else if (msg.command === 'backward') {
          robot.moveBackward(msg.value != null ? msg.value : undefined);
        } else if (msg.command === 'turn_left') {
          robot.turnLeft(msg.value || Math.PI / 8);
        } else if (msg.command === 'turn_right') {
          robot.turnRight(msg.value || Math.PI / 8);
        } else if (msg.command === 'turn') {
          if (msg.value > 0) {
            robot.turnLeft(Math.abs(msg.value));
          } else {
            robot.turnRight(Math.abs(msg.value));
          }
        } else if (msg.command === 'set_velocity') {
          console.log(`Setting velocity: v=${msg.value[0]}, w=${msg.value[1]}`);
          const v = msg.value[0] || 0;
          const w = msg.value[1] || 0;
          if (Math.abs(v) > 0.01) {
            if (v > 0) robot.moveForward(Math.abs(v));
            else robot.moveBackward(Math.abs(v));
          }
          if (Math.abs(w) > 0.01) {
            if (w > 0) robot.turnLeft(Math.abs(w));
            else robot.turnRight(Math.abs(w));
          }
        }


        if (cameraController) cameraController.update();
        renderer.render(scene, camera);
        if (onMovementCallback) onMovementCallback();

        captureAndSendImage(socket, renderer);

      } else if (msg.type === 'capture_image') {
        console.log('Frontend: Received capture_image request');
        captureAndSendImage(socket, renderer);

      } else if (msg.type === 'reset_robot') {
        const x   = msg.x        ?? 0;
        const y   = msg.y        ?? 0.3;
        const z   = msg.z        ?? 0;
        const rot = msg.rotation ?? 0;
        robot.setPosition(x, y, z);
        robot.setRotation(rot);
        if (cameraController) cameraController.update();
        renderer.render(scene, camera);
        if (onMovementCallback) onMovementCallback();
        captureAndSendImage(socket, renderer);
        console.log(`Robot reset to (${x}, ${y}, ${z}) rot=${rot}`);
      }

    } catch (error) {
      console.error('Error processing robot command:', error);
    }
  };

  socket.onclose = () => { console.log('Disconnected from robot command server'); };
  socket.onerror = (error) => { console.error('WebSocket error:', error); };

  return socket;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function captureAndSendImage(socket, renderer) {
  console.log('Frontend: Capturing and sending image...');
  const image = renderer.domElement.toDataURL('image/png');
  const timestamp = new Date().toISOString();
  socket.send(JSON.stringify({ type: 'rendered_image', data: image, timestamp }));
  console.log('Frontend: Sent rendered image, size:', image.length);
}

/** Briefly shows the on-screen collision indicator overlay. */
function _showCollisionFlash() {
  const el = document.getElementById('maskCollisionIndicator');
  if (!el) return;
  el.style.display = 'block';
  clearTimeout(el._flashTimer);
  el._flashTimer = setTimeout(() => { el.style.display = 'none'; }, 600);
}
