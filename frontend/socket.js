// socket.js
// Handles socket communication for robot commands.
// Supports optional collision detection via a MaskManager instance.

import { updateObjectSorting } from './renderer.js';

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
  maskManager = null, onMovementCallback = null, onLoadSceneCallback = null,
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

        const sendCollisionEvent = () => {
          console.warn('Collision detected — linear movement blocked');
          socket.send(JSON.stringify({
            type: 'collision_event',
            position: { x: robot.position.x, z: robot.position.z },
          }));
          _showCollisionFlash();
        };

        // ── Apply movement ───────────────────────────────────────────────────
        if (msg.command === 'forward') {
          if (maskManager) {
            const projected = robot.getProjectedPosition('forward', msg.value);
            if (maskManager.isBlockedCircle(projected.x, -projected.z, ROBOT_RADIUS)) {
              sendCollisionEvent();
              renderForCapture(scene, camera, renderer);
              captureAndSendImage(socket, renderer, robot);
              return;
            }
          }
          robot.moveForward(msg.value != null ? msg.value : undefined);
        } else if (msg.command === 'backward') {
          if (maskManager) {
            const projected = robot.getProjectedPosition('backward', msg.value);
            if (maskManager.isBlockedCircle(projected.x, -projected.z, ROBOT_RADIUS)) {
              sendCollisionEvent();
              renderForCapture(scene, camera, renderer);
              captureAndSendImage(socket, renderer, robot);
              return;
            }
          }
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
          let v = msg.value[0] || 0;
          const w = msg.value[1] || 0;

          // For combined velocity commands, only block linear component.
          // Keep rotation enabled so the robot can recover near obstacles.
          if (maskManager && Math.abs(v) > 0.01) {
            const linearCmd = v > 0 ? 'forward' : 'backward';
            const projected = robot.getProjectedPosition(linearCmd, Math.abs(v));
            if (maskManager.isBlockedCircle(projected.x, -projected.z, ROBOT_RADIUS)) {
              sendCollisionEvent();
              v = 0;
            }
          }

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
        renderForCapture(scene, camera, renderer);
        if (onMovementCallback) onMovementCallback();

        captureAndSendImage(socket, renderer, robot);

      } else if (msg.type === 'capture_image') {
        console.log('Frontend: Received capture_image request');
        renderForCapture(scene, camera, renderer);
        captureAndSendImage(socket, renderer, robot);

      } else if (msg.type === 'reset_robot') {
        const x   = msg.x        ?? 0;
        const y   = msg.y        ?? 0.50;
        const z   = msg.z        ?? 0;
        const rot = msg.rotation ?? 0;
        robot.setPosition(x, y, z);
        robot.setRotation(rot);
        if (cameraController) cameraController.update();
        renderForCapture(scene, camera, renderer);
        if (onMovementCallback) onMovementCallback();
        captureAndSendImage(socket, renderer, robot);
        console.log(`Robot reset to (${x}, ${y}, ${z}) rot=${rot}`);

      } else if (msg.type === 'reset_robot_random') {
        // The simulator picks a random collision-free spawn using the loaded mask.
        const y           = msg.y           ?? 0.50;
        const robotRadius = msg.robot_radius ?? 0.35;
        let x, z, rot;
        if (maskManager && maskManager.blockedCount > 0) {
          const pos = maskManager.randomFreePosition(robotRadius);
          x   = pos.x;
          z   = pos.z;
        } else {
          x = 0;
          z = 0;
        }
        rot = Math.random() * 2 * Math.PI;
        robot.setPosition(x, y, z);
        robot.setRotation(rot);
        if (cameraController) cameraController.update();
        renderForCapture(scene, camera, renderer);
        if (onMovementCallback) onMovementCallback();
        // Send pose back to robot client so it can initialise dead-reckoning
        socket.send(JSON.stringify({ type: 'robot_pose', x, y, z, rotation: rot }));
        captureAndSendImage(socket, renderer, robot);
        console.log(`Random reset to (${x.toFixed(2)}, ${z.toFixed(2)}) rot=${rot.toFixed(2)}`);

      } else if (msg.type === 'load_scene') {
        if (onLoadSceneCallback) {
          onLoadSceneCallback(msg.scene_id)
            .then(() => {
              socket.send(JSON.stringify({ type: 'scene_loaded', scene_id: msg.scene_id }));
              console.log(`Scene loaded: ${msg.scene_id}`);
            })
            .catch(err => {
              socket.send(JSON.stringify({ type: 'scene_load_error', scene_id: msg.scene_id, error: String(err) }));
              console.error(`Scene load error: ${msg.scene_id}`, err);
            });
        }
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

// Reusable capture canvas — created once, never recreated.
// Default matches NOMAD input size, but can be overridden via URL params:
//   ?capture_w=240&capture_h=240
const DEFAULT_CAPTURE_SIZE = 96;
const _params = new URLSearchParams(window.location.search);
const CAPTURE_W = Math.max(
  16,
  parseInt(_params.get('capture_w') || String(DEFAULT_CAPTURE_SIZE), 10) || DEFAULT_CAPTURE_SIZE,
);
const CAPTURE_H = Math.max(
  16,
  parseInt(_params.get('capture_h') || String(CAPTURE_W), 10) || CAPTURE_W,
);
let _captureCanvas = null;
let _captureCtx    = null;

function renderForCapture(scene, camera, renderer) {
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);

  // Double pass helps avoid first-frame artifacts after reset/spawn.
  updateObjectSorting(scene, camera, true);
  renderer.render(scene, camera);
  updateObjectSorting(scene, camera, true);
  renderer.render(scene, camera);
}

function captureAndSendImage(socket, renderer) {
  if (!_captureCanvas) {
    _captureCanvas = document.createElement('canvas');
    _captureCanvas.width  = CAPTURE_W;
    _captureCanvas.height = CAPTURE_H;
    _captureCtx = _captureCanvas.getContext('2d');
  }
  // Resample the full renderer canvas to configured size in one blit.
  _captureCtx.drawImage(renderer.domElement, 0, 0, CAPTURE_W, CAPTURE_H);
  // JPEG is ~5-10× smaller than PNG and much faster to encode
  const image = _captureCanvas.toDataURL('image/jpeg', 0.8);
  const timestamp = new Date().toISOString();
  socket.send(JSON.stringify({ type: 'rendered_image', data: image, timestamp }));
  console.log(`Frontend: Sent rendered image (JPEG ${CAPTURE_W}x${CAPTURE_H}), size:`, image.length);
}

/** Briefly shows the on-screen collision indicator overlay. */
function _showCollisionFlash() {
  const el = document.getElementById('maskCollisionIndicator');
  if (!el) return;
  el.style.display = 'block';
  clearTimeout(el._flashTimer);
  el._flashTimer = setTimeout(() => { el.style.display = 'none'; }, 600);
}
