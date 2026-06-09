import * as THREE from 'three';
import { setupScene, loadPLY, renderGaussianSplatting, renderObjectMode, renderEllipseMode, exportImage, saveImageToServer, updateObjectSorting, disposePointCloud } from './renderer.js';
import { setupSocket } from './socket.js';
import { RobotController, CameraController, createRobotMarker, createGaussianMaterial } from './utils.js';
import { KeyboardControls } from './controls.js';
import { MaskManager } from './mask.js';
import { MaskEditor } from './mask_editor.js';

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('canvas');
  const plyLoader = document.getElementById('plyLoader');
  const exportBtn = document.getElementById('exportImage');
  const saveBtn = document.getElementById('saveToServer');
  const resetBtn = document.getElementById('resetRobot');
  const materialSelector = document.getElementById('materialSelector');
  const harmonicDegree = document.getElementById('harmonicDegree');
  const pointScale = document.getElementById('pointScale');
  const chiScale = document.getElementById('chiScale');
  const fileInfo = document.getElementById('fileInfo');
  const sceneSelector = document.getElementById('sceneSelector');
  
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

  // ── Obstacle mask system ─────────────────────────────────────────────────
  const maskManager = new MaskManager();
  const maskEditor  = new MaskEditor(maskManager, robot);

  document.getElementById('toggleMaskEditor').addEventListener('click', () => {
    maskEditor.toggle();
  });
  
  // FPS monitoring variables
  let frameCount = 0;
  let windowStartTime = performance.now();
  let prevFrameTime = performance.now();

  // FPS monitoring function
  function updateFPS() {
    const currentTime = performance.now();
    const dt = currentTime - prevFrameTime;
    prevFrameTime = currentTime;
    frameCount++;

    // Update display every 10 frames using the true elapsed window time
    if (frameCount >= 10) {
      const elapsed = currentTime - windowStartTime;
      fpsCounter.textContent = Math.round(frameCount * 1000 / elapsed);
      frameTime.textContent = dt.toFixed(2);
      frameCount = 0;
      windowStartTime = currentTime;
    }
  }
  
  // Setup controls
  const keyboardControls = new KeyboardControls(robot, cameraController, renderer, scene, updateDisplay, maskManager);
  
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
    if (maskEditor.visible) maskEditor.render();
  }
  
  // Initial display update
  updateDisplay();
  
  // Setup socket communication
  console.log('Setting up socket communication...');
  const socket = setupSocket(robot, scene, camera, renderer, cameraController, maskManager, updateDisplay);
  if (socket) {
    console.log('Socket setup completed successfully');
  } else {
    console.error('Socket setup failed');
  }

  plyLoader.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        fileInfo.textContent = `Loading ${file.name}...`;
        
        const pointCloud = await loadPLY(file);
        // Dispose old point cloud GPU resources before replacing
        disposePointCloud(currentPointCloud);
        currentPointCloud = pointCloud;
        console.log('currentPointCloud set to loaded point cloud');
        const { center, distance } = renderGaussianSplatting(scene, currentPointCloud);
        console.log('Point cloud loaded and rendered');

        // Apply Gaussian splat shader immediately with the current UI settings,
        // so the user doesn't have to touch any selector after loading.
        if (currentPointCloud.userData.type !== 'standard_ply') {
          const loader = currentPointCloud.userData.loader;
          const mode   = materialSelector.value;
          const degree = parseInt(harmonicDegree.value);
          const scale  = parseFloat(pointScale.value);
          const chi    = parseFloat(chiScale.value);
          if (mode === 'gaussian') {
            currentPointCloud.material = loader.createGaussianSplatMaterial_ellipso(degree, scale, chi);
          } else if (mode === 'points') {
            currentPointCloud.material = loader.createSimplePointMaterial();
          }
        }

        // Place robot at scene centre and let cameraController position the
        // camera — keeps them in sync without a manual reset.
        robot.setPosition(center.x, 0.50, center.z);
        robot.setRotation(0);
        controls.center.copy(center);
        controls.distance = distance;
        robot.updateRobotMarker(robotMarker);
        cameraController.update();

        // Update displays
        updateDisplay();

        // Feed scene geometry to mask editor for top-down background preview
        const positions = pointCloud.geometry.attributes.position.array;
        maskEditor.setScenePoints(positions);
        if (maskEditor.visible) maskEditor.render();

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
    exportImage(renderer, scene, camera);
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
      
      if (mode === 'gaussian') {
        currentPointCloud.material = loader.createGaussianSplatMaterial_ellipso(degree, scale, chi);
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
      
      // Update the material with the new harmonic degree
      if (currentMode === 'gaussian') {
        currentPointCloud.material = loader.createGaussianSplatMaterial_ellipso(degree, scale, chi);
      }
      
      console.log('Harmonic degree changed to:', degree);
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
      
      // Update the material with the new point scale
      if (currentMode === 'gaussian') {
        currentPointCloud.material = loader.createGaussianSplatMaterial_ellipso(degree, scale, chi);
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
        
        currentPointCloud.material = loader.createGaussianSplatMaterial_ellipso(degree, scale, chi);
        console.log('Chi scale changed to:', chi);
      }
    }
  });

  // ── Scene selector ─────────────────────────────────────────────────────────

  async function loadSceneFromServer(sceneId) {
    fileInfo.textContent = `Loading scene ${sceneId}...`;
    try {
      // Fetch PLY as a Blob and wrap in a File so loadPLY can use FileReader
      const plyResp = await fetch(`/api/scenes/${encodeURIComponent(sceneId)}/ply`);
      if (!plyResp.ok) throw new Error(`PLY not found for scene ${sceneId}`);
      const plyBlob = await plyResp.blob();
      const plyFile = new File([plyBlob], `${sceneId}.ply`, { type: 'application/octet-stream' });

      const pointCloud = await loadPLY(plyFile);
      // Dispose old point cloud GPU resources before replacing
      disposePointCloud(currentPointCloud);
      currentPointCloud = pointCloud;
      const { center, distance } = renderGaussianSplatting(scene, currentPointCloud);

      if (currentPointCloud.userData.type !== 'standard_ply') {
        const loader = currentPointCloud.userData.loader;
        const mode   = materialSelector.value;
        const degree = parseInt(harmonicDegree.value);
        const scale  = parseFloat(pointScale.value);
        const chi    = parseFloat(chiScale.value);
        if (mode === 'gaussian') {
          currentPointCloud.material = loader.createGaussianSplatMaterial_ellipso(degree, scale, chi);
        } else if (mode === 'points') {
          currentPointCloud.material = loader.createSimplePointMaterial();
        }
      }

      robot.setPosition(center.x, 0.50, center.z);
      robot.setRotation(0);
      controls.center.copy(center);
      controls.distance = distance;
      robot.updateRobotMarker(robotMarker);
      cameraController.update();
      updateDisplay();

      const positions = pointCloud.geometry.attributes.position.array;
      maskEditor.setScenePoints(positions);
      maskEditor.setSceneId(sceneId);

      // Load occupancy from occupancy.json + occupancy.png
      const occResp = await fetch(`/api/scenes/${encodeURIComponent(sceneId)}/occupancy`);
      if (occResp.ok) {
        const occJson = await occResp.json();
        const pngUrl  = `/api/scenes/${encodeURIComponent(sceneId)}/occupancy.png`;
        await maskManager.fromOccupancyPNG(occJson, pngUrl);
        console.log(`Occupancy loaded: ${maskManager.gridW}×${maskManager.gridH} cells, ${maskManager.blockedCount} blocked`);
        maskEditor.resetView();
        if (maskEditor.visible) maskEditor.render();
      } else {
        console.warn('No occupancy data found for scene', sceneId);
      }

      const userData = pointCloud.userData;
      if (userData.type === 'standard_ply') {
        fileInfo.textContent = `${sceneId} (Standard PLY) - ${pointCloud.geometry.attributes.position.count} points`;
      } else {
        fileInfo.textContent = `${sceneId} (Gaussian Splat) - ${userData.vertexCount} splats`;
      }
    } catch (err) {
      console.error('Error loading scene:', err);
      fileInfo.textContent = `Error loading scene: ${err.message}`;
    }
  }

  // Populate scene dropdown on startup
  fetch('/api/scenes')
    .then(r => r.json())
    .then(data => {
      if (data.success && data.scenes.length > 0) {
        data.scenes.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = s.id;
          sceneSelector.appendChild(opt);
        });
      }
    })
    .catch(err => console.warn('Could not fetch scene list:', err));

  document.getElementById('loadScene').addEventListener('click', () => {
    const sceneId = sceneSelector.value;
    if (!sceneId) return;
    loadSceneFromServer(sceneId);
  });
});
