import * as THREE from 'three';
import { setupScene, loadPLY, renderGaussianSplatting, renderObjectMode, renderEllipseMode, exportImage, saveImageToServer, updateObjectSorting } from './renderer.js';
import { setupSocket } from './socket.js';
import { RobotController, CameraController, createRobotMarker, createGaussianMaterial } from './utils.js';
import { KeyboardControls } from './controls.js';

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('canvas');
  const plyLoader = document.getElementById('plyLoader');
  const exportBtn = document.getElementById('exportImage');
  const saveBtn = document.getElementById('saveToServer');
  const resetBtn = document.getElementById('resetRobot');
  const materialSelector = document.getElementById('materialSelector');
  const harmonicDegree = document.getElementById('harmonicDegree');
  const shDirMode = document.getElementById('shDirMode');
  const pointScale = document.getElementById('pointScale');
  const chiScale = document.getElementById('chiScale');
  const fileInfo = document.getElementById('fileInfo');
  
  // Robot position display elements
  const robotX = document.getElementById('robotX');
  const robotY = document.getElementById('robotY');
  const robotZ = document.getElementById('robotZ');
  const robotRotation = document.getElementById('robotRotation');
  
  // Camera position display elements
  const cameraX = document.getElementById('cameraX');
  const cameraY = document.getElementById('cameraY');
  const cameraZ = document.getElementById('cameraZ');
  const cameraTarget = document.getElementById('cameraTarget');
  
  // FPS monitoring elements
  const fpsCounter = document.getElementById('fpsCounter');
  const frameTime = document.getElementById('frameTime');

  const { scene, camera, renderer, controls } = setupScene(canvas);
  
  // Create robot and camera controllers
  const robot = new RobotController();
  const cameraController = new CameraController(camera, robot, updateDisplay);
  
  // Create and add robot marker to scene
  const robotMarker = createRobotMarker();
  scene.add(robotMarker);
  
  // Store reference to current point cloud for material switching
  let currentPointCloud = null;
  
  // FPS monitoring variables
  let frameCount = 0;
  let lastTime = performance.now();
  let fps = 0;
  let lastFrameTime = 0;
  
  // FPS monitoring function
  function updateFPS() {
    const currentTime = performance.now();
    const deltaTime = currentTime - lastTime;
    lastFrameTime = deltaTime;
    
    frameCount++;
    
    // Update FPS every 10 frames for smoother display
    if (frameCount >= 10) {
      fps = Math.round(frameCount * 1000 / (currentTime - (lastTime - deltaTime * 9)));
      frameCount = 0;
      
      // Update display
      fpsCounter.textContent = fps;
      frameTime.textContent = lastFrameTime.toFixed(2);
    }
    
    lastTime = currentTime;
  }
  
  // Setup controls
  const keyboardControls = new KeyboardControls(robot, cameraController, renderer, scene, updateDisplay);
  
  // Main render loop with FPS monitoring
  function animate() {
    requestAnimationFrame(animate);
    
    // Update FPS counter
    updateFPS();
    
    // Update sorting for current render mode
    if (currentPointCloud) {
      updateObjectSorting(scene, camera);
    }
    
    // Render the scene
    renderer.render(scene, camera);
  }
  
  // Start the render loop
  animate();
  
  // Function to update robot position display
  function updateRobotDisplay() {
    const pos = robot.getPosition();
    const rot = robot.getRotation();
    
    robotX.textContent = pos.x.toFixed(2);
    robotY.textContent = pos.y.toFixed(2);
    robotZ.textContent = pos.z.toFixed(2);
    robotRotation.textContent = (rot * 180 / Math.PI).toFixed(1);
    
    // Update robot marker position
    robot.updateRobotMarker(robotMarker);
  }
  
  // Function to update camera position display
  function updateCameraDisplay() {
    const pos = camera.position;
    
    cameraX.textContent = pos.x.toFixed(2);
    cameraY.textContent = pos.y.toFixed(2);
    cameraZ.textContent = pos.z.toFixed(2);
    
    // Calculate what the camera is looking at
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    const lookAt = camera.position.clone().add(direction.multiplyScalar(5));
    cameraTarget.textContent = `(${lookAt.x.toFixed(1)}, ${lookAt.y.toFixed(1)}, ${lookAt.z.toFixed(1)})`;
  }
  
  // Combined update function
  function updateDisplay() {
    updateRobotDisplay();
    updateCameraDisplay();
  }
  
  // Initial display update
  updateDisplay();
  
  // Setup socket communication
  setupSocket(robot, scene, camera, renderer, cameraController, updateDisplay);

  plyLoader.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        fileInfo.textContent = `Loading ${file.name}...`;
        
        const pointCloud = await loadPLY(file);
        currentPointCloud = pointCloud; // Store reference
        console.log('currentPointCloud set to loaded point cloud');
        const { center, distance } = renderGaussianSplatting(scene, currentPointCloud);
        console.log('Point cloud loaded and rendered');
        // Update robot   position and camera to center on the loaded scene
        robot.setPosition(center.x, center.y, center.z);
        controls.center.copy(center);
        controls.distance = distance;
        
        // Update robot marker
        robot.updateRobotMarker(robotMarker);
        
        // Position camera relative to scene center
        camera.position.set(
          center.x,
          center.y + distance * 0.3,
          center.z + distance * 0.8
        );
        camera.lookAt(center);
        
        // Update displays
        updateDisplay();
        
        // Update file info
        const userData = pointCloud.userData;
        if (userData.type === 'standard_ply') {
          fileInfo.textContent = `${file.name} (Standard PLY) - ${pointCloud.geometry.attributes.position.count} points`;
        } else {
          fileInfo.textContent = `${file.name} (Gaussian Splat) - ${userData.vertexCount} splats`;
        }
        
      } catch (error) {
        console.error('Error loading PLY file:', error);
        fileInfo.textContent = 'Error loading file';
        alert('Error loading PLY file. Please check the file format.');
      }
    }
  });

  exportBtn.addEventListener('click', () => {
    exportImage(renderer);
  });

  saveBtn.addEventListener('click', () => {
    const imageData = renderer.domElement.toDataURL('image/png');
    saveImageToServer(imageData);
  });

  resetBtn.addEventListener('click', () => {
    // Reset robot to origin
    robot.setPosition(0, 0.3, 0);
    robot.setRotation(0);
    
    // Update camera to follow robot
    cameraController.update();
    
    // Update displays
    updateDisplay();
    
    console.log('Robot position reset to origin');
  });

  materialSelector.addEventListener('change', (e) => {
    if (!currentPointCloud) {
      console.warn('No point cloud loaded');
      return;
    }

    const mode = e.target.value;
    console.log('Switching to render mode:', mode);
    
    const scale = parseFloat(pointScale.value);
      
    if (mode === 'ellipseGradient') {
      console.log('Switching to ellipse gradient mode');
      // Use ellipse mode rendering with gradient ellipses
      renderEllipseMode(scene, currentPointCloud, scale);
    } else if (mode === 'object') {
      // Use object mode rendering with 3D ellipsoid meshes
      renderObjectMode(scene, currentPointCloud, scale);
    } else {
      // For Gaussian splat files, switch between shader and simple materials
      // First make sure we're back to point cloud rendering
      renderGaussianSplatting(scene, currentPointCloud);
      
      const loader = currentPointCloud.userData.loader;
      const degree = parseInt(harmonicDegree.value);
      const chi = parseFloat(chiScale.value);
      const shMode = parseInt(shDirMode.value);
      
      if (mode === 'gaussian') {
        currentPointCloud.material = loader.createGaussianSplatMaterial_ellipso(degree, scale, chi, shMode);
      } else {
        currentPointCloud.material = loader.createSimplePointMaterial();
      }
    }

    console.log('Render mode changed to:', mode);
  });

  harmonicDegree.addEventListener('change', (e) => {
    if (!currentPointCloud) {
      console.warn('No point cloud loaded');
      return;
    }

    const degree = parseInt(e.target.value);
    console.log('Switching to harmonic degree:', degree);

    // Only update if we have a Gaussian splat material
    if (currentPointCloud.userData.type !== 'standard_ply') {
      const loader = currentPointCloud.userData.loader;
      const currentMode = materialSelector.value;
      const scale = parseFloat(pointScale.value);
      const chi = parseFloat(chiScale.value);
      const shMode = parseInt(shDirMode.value);
      
      // Update the material with the new harmonic degree
      if (currentMode === 'gaussian') {
        currentPointCloud.material = loader.createGaussianSplatMaterial_ellipso(degree, scale, chi, shMode);
      }
      
      console.log('Harmonic degree changed to:', degree);
    }
  });

  shDirMode.addEventListener('change', (e) => {
    if (!currentPointCloud) {
      console.warn('No point cloud loaded');
      return;
    }

    const shMode = parseInt(e.target.value);
    console.log('Switching to SH direction mode:', shMode);

    // Only update if we have a Gaussian splat material
    if (currentPointCloud.userData.type !== 'standard_ply') {
      const loader = currentPointCloud.userData.loader;
      const currentMode = materialSelector.value;
      const degree = parseInt(harmonicDegree.value);
      const scale = parseFloat(pointScale.value);
      const chi = parseFloat(chiScale.value);
      
      // Update the material with the new SH direction mode
      if (currentMode === 'gaussian') {
        currentPointCloud.material = loader.createGaussianSplatMaterial_ellipso(degree, scale, chi, shMode);
      }
      
      console.log('SH direction mode changed to:', shMode);
    }
  });

  pointScale.addEventListener('input', (e) => {
    if (!currentPointCloud) {
      console.warn('No point cloud loaded');
      return;
    }

    const scale = parseFloat(e.target.value);
    console.log('Switching to point scale:', scale);

    // Only update if we have a Gaussian splat material
    if (currentPointCloud.userData.type !== 'standard_ply') {
      const loader = currentPointCloud.userData.loader;
      const currentMode = materialSelector.value;
      const degree = parseInt(harmonicDegree.value);
      const chi = parseFloat(chiScale.value);
      const shMode = parseInt(shDirMode.value);
      
      // Update the material with the new point scale
      if (currentMode === 'gaussian') {
        currentPointCloud.material = loader.createGaussianSplatMaterial_ellipso(degree, scale, chi, shMode);
      }
      console.log('Point scale changed to:', scale);
    }
  });

  // Chi Scale control
  chiScale.addEventListener('input', (e) => {
    if (!currentPointCloud) {
      console.warn('No point cloud loaded');
      return;
    }

    const chi = parseFloat(e.target.value);
    console.log('Changing chi scale to:', chi);

    // Only update if we have a Gaussian splat material and ellipse mode
    if (currentPointCloud.userData.type !== 'standard_ply') {
      const loader = currentPointCloud.userData.loader;
      const currentMode = materialSelector.value;
      
      if (currentMode === 'gaussian') {
        const degree = parseInt(harmonicDegree.value);
        const scale = parseFloat(pointScale.value);
        const shMode = parseInt(shDirMode.value);
        
        currentPointCloud.material = loader.createGaussianSplatMaterial_ellipso(degree, scale, chi, shMode);
        console.log('Chi scale changed to:', chi);
      }
    }
  });
});
