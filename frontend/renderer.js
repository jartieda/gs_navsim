// renderer.js
// Handles Three.js scene setup, PLY loading, Gaussian splatting, and image export

import { createGaussianMaterial, generateRandomColors, centerGeometry } from './utils.js';
import { GaussianSplatLoader } from './gaussian-splat-loader.js';

export function setupScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xcccccc); // Light grey background
  
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 1, 5);
  
  // Add basic lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(5, 10, 7.5);
  scene.add(dirLight);
  
  // Add grid floor
  const gridHelper = new THREE.GridHelper(20, 20, 0x888888, 0x444444);
  gridHelper.position.y = 0;
  scene.add(gridHelper);
  
  // Add axis gizmo at origin
  const axisHelper = createAxisGizmo();
  scene.add(axisHelper);
  
  // Add orbit controls for better navigation
  const controls = {
    center: new THREE.Vector3(0, 0, 0),
    distance: 10
  };
  
  // Handle window resize
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  
  return { scene, camera, renderer, controls };
}

function createAxisGizmo() {
  const group = new THREE.Group();
  
  // Create axis lines
  const axisLength = 2;
  const lineWidth = 0.05;
  
  // X-axis (Red)
  const xGeometry = new THREE.CylinderGeometry(lineWidth, lineWidth, axisLength, 8);
  const xMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const xAxis = new THREE.Mesh(xGeometry, xMaterial);
  xAxis.rotation.z = -Math.PI / 2;
  xAxis.position.x = axisLength / 2;
  group.add(xAxis);
  
  // X-axis arrow
  const xArrowGeometry = new THREE.ConeGeometry(lineWidth * 2, lineWidth * 4, 8);
  const xArrow = new THREE.Mesh(xArrowGeometry, xMaterial);
  xArrow.rotation.z = -Math.PI / 2;
  xArrow.position.x = axisLength + lineWidth * 2;
  group.add(xArrow);
  
  // Y-axis (Green)
  const yGeometry = new THREE.CylinderGeometry(lineWidth, lineWidth, axisLength, 8);
  const yMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  const yAxis = new THREE.Mesh(yGeometry, yMaterial);
  yAxis.position.y = axisLength / 2;
  group.add(yAxis);
  
  // Y-axis arrow
  const yArrowGeometry = new THREE.ConeGeometry(lineWidth * 2, lineWidth * 4, 8);
  const yArrow = new THREE.Mesh(yArrowGeometry, yMaterial);
  yArrow.position.y = axisLength + lineWidth * 2;
  group.add(yArrow);
  
  // Z-axis (Blue)
  const zGeometry = new THREE.CylinderGeometry(lineWidth, lineWidth, axisLength, 8);
  const zMaterial = new THREE.MeshBasicMaterial({ color: 0x0000ff });
  const zAxis = new THREE.Mesh(zGeometry, zMaterial);
  zAxis.rotation.x = Math.PI / 2;
  zAxis.position.z = axisLength / 2;
  group.add(zAxis);
  
  // Z-axis arrow
  const zArrowGeometry = new THREE.ConeGeometry(lineWidth * 2, lineWidth * 4, 8);
  const zArrow = new THREE.Mesh(zArrowGeometry, zMaterial);
  zArrow.rotation.x = Math.PI / 2;
  zArrow.position.z = axisLength + lineWidth * 2;
  group.add(zArrow);
  
  // Add labels using simple text geometry (if available) or small cubes as placeholders
  const labelSize = 0.1;
  
  // X label (small red cube)
  const xLabelGeometry = new THREE.BoxGeometry(labelSize, labelSize, labelSize);
  const xLabel = new THREE.Mesh(xLabelGeometry, xMaterial);
  xLabel.position.set(axisLength + 0.3, 0.2, 0);
  group.add(xLabel);
  
  // Y label (small green cube)
  const yLabelGeometry = new THREE.BoxGeometry(labelSize, labelSize, labelSize);
  const yLabel = new THREE.Mesh(yLabelGeometry, yMaterial);
  yLabel.position.set(0.2, axisLength + 0.3, 0);
  group.add(yLabel);
  
  // Z label (small blue cube)
  const zLabelGeometry = new THREE.BoxGeometry(labelSize, labelSize, labelSize);
  const zLabel = new THREE.Mesh(zLabelGeometry, zMaterial);
  zLabel.position.set(0, 0.2, axisLength + 0.3);
  group.add(zLabel);
  
  return group;
}

export async function loadPLY(file) {
  try {
    console.log('Loading PLY file:', file.name);
    
    // Use custom Gaussian splat loader
    const loader = new GaussianSplatLoader();
    const gaussianSplatMesh = await loader.load(file);
    
    console.log('Gaussian splat mesh loaded:', gaussianSplatMesh);
    return gaussianSplatMesh;
    
  } catch (error) {
    console.warn('Failed to load as Gaussian splat, trying fallback:', error);
    
    // Fallback to standard PLY loading
    return new Promise((resolve, reject) => {
      const loader = new THREE.PLYLoader();
      const reader = new FileReader();
      
      reader.onload = function(e) {
        try {
          const geometry = loader.parse(e.target.result);
          
          // Center the geometry
          const originalCenter = centerGeometry(geometry);
          
          // Create material for standard point cloud
          const material = createGaussianMaterial({
            size: 0.02,
            opacity: 0.8,
            blending: THREE.AdditiveBlending
          });
          
          // If geometry has colors, use them; otherwise add default colors
          if (!geometry.attributes.color) {
            const colors = generateRandomColors(geometry.attributes.position.count);
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
          }
          
          const points = new THREE.Points(geometry, material);
          points.userData = { type: 'standard_ply' };
          resolve(points);
        } catch (error) {
          reject(error);
        }
      };
      
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }
}

export function renderGaussianSplatting(scene, pointCloud) {
  // Clear existing point clouds
  const existingPoints = scene.children.filter(child => child.type === 'Points');
  existingPoints.forEach(points => scene.remove(points));
  
  // Clear existing object mode meshes (Group with ellipsoids)
  const existingObjects = scene.children.filter(child => child.userData && child.userData.type === 'object_mode');
  existingObjects.forEach(obj => scene.remove(obj));
  
  // Add new point cloud to scene
  scene.add(pointCloud);
  
  // Center the camera on the point cloud
  const box = new THREE.Box3().setFromObject(pointCloud);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  
  // Position camera to view the entire point cloud
  const maxDim = Math.max(size.x, size.y, size.z);
  const distance = maxDim * 2;
  
  return { center, distance };
}

export function renderObjectMode(scene, pointCloud) {
  // Clear existing point clouds
  const existingPoints = scene.children.filter(child => child.type === 'Points');
  existingPoints.forEach(points => scene.remove(points));
  
  // Clear existing object mode meshes
  const existingObjects = scene.children.filter(child => child.userData && child.userData.type === 'object_mode');
  existingObjects.forEach(obj => scene.remove(obj));
  
  const geometry = pointCloud.geometry;
  const positions = geometry.attributes.position.array;
  const scales = geometry.attributes.scale ? geometry.attributes.scale.array : null;
  const rotations = geometry.attributes.rotation ? geometry.attributes.rotation.array : null;
  const colors = geometry.attributes.color ? geometry.attributes.color.array : null;
  
  const vertexCount = positions.length / 3;
  
  // For performance, use different approaches based on vertex count
  if (vertexCount > 10000) {
    console.log(`Large dataset detected (${vertexCount} points). Using instanced rendering for performance.`);
    return renderObjectModeInstanced(scene, positions, scales, rotations, colors, vertexCount);
  } else {
    console.log(`Creating ${vertexCount} individual ellipsoid meshes.`);
    return renderObjectModeIndividual(scene, positions, scales, rotations, colors, vertexCount);
  }
}

function renderObjectModeIndividual(scene, positions, scales, rotations, colors, vertexCount) {
  // Create a group to hold all ellipsoid meshes
  const objectGroup = new THREE.Group();
  objectGroup.userData = { type: 'object_mode' };
  
  // Create ellipsoid geometry (we'll reuse this for all instances)
  const ellipsoidGeometry = new THREE.SphereGeometry(1, 16, 12);
  
  // Create instances for each Gaussian point
  for (let i = 0; i < vertexCount; i++) {
    const i3 = i * 3;
    const i4 = i * 4;
    
    // Create material with the point's color
    const material = new THREE.MeshLambertMaterial({
      color: colors ? new THREE.Color(colors[i3], colors[i3 + 1], colors[i3 + 2]) : 0xff6600,
      transparent: true,
      opacity: 0.7
    });
    
    // Create mesh
    const mesh = new THREE.Mesh(ellipsoidGeometry, material);
    
    // Set position
    mesh.position.set(positions[i3], positions[i3 + 1], positions[i3 + 2]);
    
    // Set scale from Gaussian scale parameters
    if (scales) {
      mesh.scale.set(scales[i3], scales[i3 + 1], scales[i3 + 2]);
    } else {
      mesh.scale.set(0.1, 0.1, 0.1); // Default scale
    }
    
    // Set rotation from quaternion
    if (rotations) {
      const quaternion = new THREE.Quaternion(
        rotations[i4],     // x
        rotations[i4 + 1], // y
        rotations[i4 + 2], // z
        rotations[i4 + 3]  // w
      );
      mesh.setRotationFromQuaternion(quaternion);
    }
    
    objectGroup.add(mesh);
  }
  
  // Add the group to the scene
  scene.add(objectGroup);
  
  // Calculate bounding box for camera positioning
  const box = new THREE.Box3().setFromObject(objectGroup);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  
  // Position camera to view the entire object collection
  const maxDim = Math.max(size.x, size.y, size.z);
  const distance = maxDim * 2;
  
  return { center, distance };
}

function renderObjectModeInstanced(scene, positions, scales, rotations, colors, vertexCount) {
  // Create a group to hold the instanced mesh
  const objectGroup = new THREE.Group();
  objectGroup.userData = { type: 'object_mode' };
  
  // Create ellipsoid geometry
  const ellipsoidGeometry = new THREE.SphereGeometry(1, 12, 8); // Lower resolution for performance
  
  // Create instanced mesh
  const material = new THREE.MeshLambertMaterial({
    transparent: true,
    opacity: 0.7
  });
  
  const instancedMesh = new THREE.InstancedMesh(ellipsoidGeometry, material, vertexCount);
  
  // Set up instance matrices and colors
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  
  for (let i = 0; i < vertexCount; i++) {
    const i3 = i * 3;
    const i4 = i * 4;
    
    // Set position
    position.set(positions[i3], positions[i3 + 1], positions[i3 + 2]);
    
    // Set scale from Gaussian scale parameters
    if (scales) {
      scale.set(scales[i3], scales[i3 + 1], scales[i3 + 2]);
    } else {
      scale.set(0.1, 0.1, 0.1); // Default scale
    }
    
    // Set rotation from quaternion
    if (rotations) {
      quaternion.set(
        rotations[i4],     // x
        rotations[i4 + 1], // y
        rotations[i4 + 2], // z
        rotations[i4 + 3]  // w
      );
    } else {
      quaternion.set(0, 0, 0, 1); // Default quaternion
    }
    
    // Compose matrix from position, quaternion, and scale
    matrix.compose(position, quaternion, scale);
    instancedMesh.setMatrixAt(i, matrix);
    
    // Set color if available
    if (colors) {
      instancedMesh.setColorAt(i, new THREE.Color(colors[i3], colors[i3 + 1], colors[i3 + 2]));
    } else {
      instancedMesh.setColorAt(i, new THREE.Color(0xff6600));
    }
  }
  
  // Update instance matrix and colors
  instancedMesh.instanceMatrix.needsUpdate = true;
  if (instancedMesh.instanceColor) {
    instancedMesh.instanceColor.needsUpdate = true;
  }
  
  objectGroup.add(instancedMesh);
  
  // Add the group to the scene
  scene.add(objectGroup);
  
  // Calculate bounding box for camera positioning
  const box = new THREE.Box3().setFromObject(objectGroup);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  
  // Position camera to view the entire object collection
  const maxDim = Math.max(size.x, size.y, size.z);
  const distance = maxDim * 2;
  
  return { center, distance };
}

export function handleNavigation(e, robot, camera, renderer, scene) {
  // This function is now deprecated - use KeyboardControls class instead
  console.warn('handleNavigation is deprecated. Use KeyboardControls class instead.');
}

export function exportImage(renderer, filename = null) {
  // Ensure we have a clean render
  const canvas = renderer.domElement;
  
  // Create high-resolution render for export
  const originalSize = renderer.getSize(new THREE.Vector2());
  const exportScale = 2; // 2x resolution for better quality
  
  renderer.setSize(originalSize.x * exportScale, originalSize.y * exportScale);
  
  // Re-render at higher resolution
  const scene = renderer.info.render.frame > 0 ? renderer.getRenderTarget() : null;
  
  // Get image data
  const dataURL = canvas.toDataURL('image/png');
  
  // Restore original size
  renderer.setSize(originalSize.x, originalSize.y);
  
  // Create download
  const link = document.createElement('a');
  link.href = dataURL;
  link.download = filename || `scene_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  console.log('Image exported:', link.download);
  return dataURL;
}

export function saveImageToServer(imageData) {
  // Send image to server for storage
  fetch('/api/save-image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ 
      image: imageData,
      timestamp: new Date().toISOString()
    })
  })
  .then(response => response.json())
  .then(data => {
    console.log('Image saved to server:', data.filename);
  })
  .catch(error => {
    console.error('Error saving image to server:', error);
  });
}
