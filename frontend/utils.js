// utils.js
// Utility functions for the robotic navigation simulator

export class RobotController {
  constructor(position = { x: 0, y: 0, z: 0 }, rotation = 0) {
    this.position = new THREE.Vector3(position.x, position.y, position.z);
    this.rotation = rotation;
    this.moveSpeed = 0.3;
    this.turnSpeed = Math.PI / 16;
  }

  moveForward(distance = this.moveSpeed) {
    this.position.z -= distance * Math.cos(this.rotation);
    this.position.x -= distance * Math.sin(this.rotation);
  }

  moveBackward(distance = this.moveSpeed) {
    this.position.z += distance * Math.cos(this.rotation);
    this.position.x += distance * Math.sin(this.rotation);
  }

  turnLeft(angle = this.turnSpeed) {
    this.rotation += angle;
  }

  turnRight(angle = this.turnSpeed) {
    this.rotation -= angle;
  }

  getPosition() {
    return this.position.clone();
  }

  getRotation() {
    return this.rotation;
  }

  setPosition(x, y, z) {
    this.position.set(x, y, z);
  }

  setRotation(rotation) {
    this.rotation = rotation;
  }

  updateRobotMarker(marker) {
    if (marker) {
      marker.position.copy(this.position);
      marker.rotation.y = this.rotation;
    }
  }
}

export class CameraController {
  constructor(camera, robot, onUpdateCallback = null) {
    this.camera = camera;
    this.robot = robot;
    this.offset = new THREE.Vector3(0, 1.5, 3);
    this.lookAhead = 1.0;
    this.onUpdateCallback = onUpdateCallback;
  }

  update() {
    // Position camera behind and above the robot
    const cameraOffset = this.offset.clone();
    cameraOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.robot.rotation);
    this.camera.position.copy(this.robot.position).add(cameraOffset);
    
    // Look in the direction the robot is facing
    const lookTarget = this.robot.position.clone();
    lookTarget.z -= this.lookAhead * Math.cos(this.robot.rotation);
    lookTarget.x -= this.lookAhead * Math.sin(this.robot.rotation);
    this.camera.lookAt(lookTarget);
    
    // Call update callback if provided
    if (this.onUpdateCallback) {
      this.onUpdateCallback();
    }
  }

  setOffset(x, y, z) {
    this.offset.set(x, y, z);
  }

  setLookAhead(distance) {
    this.lookAhead = distance;
  }
}

export function createGaussianMaterial(options = {}) {
  return new THREE.PointsMaterial({
    size: options.size || 0.02,
    vertexColors: true,
    sizeAttenuation: options.sizeAttenuation !== false,
    transparent: options.transparent !== false,
    opacity: options.opacity || 0.8,
    blending: options.blending || THREE.AdditiveBlending
  });
}

export function generateRandomColors(count) {
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = Math.random() * 0.5 + 0.5;     // R
    colors[i + 1] = Math.random() * 0.5 + 0.5; // G
    colors[i + 2] = Math.random() * 0.5 + 0.5; // B
  }
  return colors;
}

export function centerGeometry(geometry) {
  geometry.computeBoundingBox();
  const center = new THREE.Vector3();
  geometry.boundingBox.getCenter(center);
  geometry.translate(-center.x, -center.y, -center.z);
  return center;
}

export function createRobotMarker() {
  // Create a simple robot marker to show current position
  const group = new THREE.Group();
  
  // Robot body (small cylinder)
  const bodyGeometry = new THREE.CylinderGeometry(0.15, 0.15, 0.3, 8);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x00aaff });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = 0.15;
  group.add(body);
  
  // Direction indicator (cone pointing forward)
  const directionGeometry = new THREE.ConeGeometry(0.08, 0.2, 8);
  const directionMaterial = new THREE.MeshStandardMaterial({ color: 0xff6600 });
  const direction = new THREE.Mesh(directionGeometry, directionMaterial);
  direction.rotation.x = Math.PI / 2;
  direction.position.set(0, 0.15, 0.2);
  group.add(direction);
  
  // Base (flat cylinder)
  const baseGeometry = new THREE.CylinderGeometry(0.2, 0.2, 0.05, 16);
  const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x666666 });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.position.y = 0.025;
  group.add(base);
  
  return group;
}