// controls.js
// Keyboard and input controls for the simulator

export class KeyboardControls {
  constructor(robot, camera, renderer, scene, onMovementCallback = null) {
    this.robot = robot;
    this.camera = camera;
    this.renderer = renderer;
    this.scene = scene;
    this.keys = new Set();
    this.isEnabled = true;
    this.onMovementCallback = onMovementCallback;
    
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

  handleMovement() {
    let moved = false;
    
    if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) {
      this.robot.moveForward();
      moved = true;
    }
    
    if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) {
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