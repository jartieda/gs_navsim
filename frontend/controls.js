// controls.js
// Keyboard and input controls for the simulator

import { updateObjectSorting } from './renderer.js';

export class KeyboardControls {
  constructor(robot, camera, renderer, scene, onMovementCallback = null, maskManager = null) {
    this.robot = robot;
    this.camera = camera;
    this.renderer = renderer;
    this.scene = scene;
    this.keys = new Set();
    this.isEnabled = true;
    this.onMovementCallback = onMovementCallback;
    this.maskManager = maskManager;
    
    this.bindEvents();
  }

  bindEvents() {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => this.keys.clear());
  }

  onKeyDown(e) {
    if (!this.isEnabled) return;
    
    this.keys.add(e.code);
    
    // Prevent default for arrow keys to avoid page scrolling
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
    
    this.handleMovement();
  }

  onKeyUp(e) {
    this.keys.delete(e.code);
  }

  /** Check projected position against mask; show flash and return true if blocked. */
  _checkCollision(command) {
    if (!this.maskManager) return false;
    const projected = this.robot.getProjectedPosition(command, null);
    // mask stores z in mask-space (z_mask = -z_threejs)
    if (this.maskManager.isBlockedCircle(projected.x, -projected.z, 0.3)) {
      _showCollisionFlash();
      return true;
    }
    return false;
  }

  handleMovement() {
    let moved = false;
    
    if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) {
      this._checkCollision('forward');
      this.robot.moveForward();
      moved = true;
    }
    
    if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) {
      this._checkCollision('backward');
      this.robot.moveBackward();
      moved = true;
    }
    
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) {
      this.robot.turnLeft();
      moved = true;
    }
    
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) {
      this.robot.turnRight();
      moved = true;
    }
    
    if (moved) {
      this.camera.update();
      updateObjectSorting(this.scene, this.camera.camera);
      this.renderer.render(this.scene, this.camera.camera);
      
      // Call movement callback if provided
      if (this.onMovementCallback) {
        this.onMovementCallback();
      }
    }
  }

  enable() {
    this.isEnabled = true;
  }

  disable() {
    this.isEnabled = false;
    this.keys.clear();
  }

  destroy() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', () => this.keys.clear());
  }
}

function _showCollisionFlash() {
  const el = document.getElementById('maskCollisionIndicator');
  if (!el) return;
  el.style.display = 'block';
  clearTimeout(el._flashTimer);
  el._flashTimer = setTimeout(() => { el.style.display = 'none'; }, 600);
}