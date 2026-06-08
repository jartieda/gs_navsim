// renderer.js
// Handles Three.js scene setup, PLY loading, Gaussian splatting, and image export
import * as THREE from 'three';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';

import { createGaussianMaterial, generateRandomColors, centerGeometry } from './utils.js';
import { GaussianSplatLoader } from './gaussian-splat-loader.js';

let currentPointCloud = null;

// Cached ellipse texture — created once, reused across scene loads
let _ellipseTexture = null;
function getEllipseTexture() {
  if (_ellipseTexture) return _ellipseTexture;
  _ellipseTexture = createEllipseTexture();
  return _ellipseTexture;
}

// Camera state tracking to avoid sorting every frame
let _lastSortCamPos = new THREE.Vector3(Infinity, Infinity, Infinity);
let _lastSortCamQuat = new THREE.Quaternion(0, 0, 0, 0);

export function setupScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000); // Black background
  
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

function clearExistingRenderObjects(scene) {
  // Remove raw point clouds from scene (do NOT dispose — they are the source data
  // reused across render modes; caller is responsible for disposing when done).
  const existingPoints = scene.children.filter(child => child.type === 'Points');
  existingPoints.forEach(points => scene.remove(points));

  // Remove and DISPOSE derived render objects (object_mode / ellipse_mode groups).
  // These are rebuilt from the source point cloud on every mode switch, so it is
  // safe — and necessary — to free their GPU resources here.
  const existingObjects = scene.children.filter(child => child.userData &&
    (child.userData.type === 'object_mode' || child.userData.type === 'ellipse_mode'));
  existingObjects.forEach(obj => {
    scene.remove(obj);
    _disposeObject(obj);
  });
}

/**
 * Recursively dispose all GPU resources (geometry, materials, textures) held
 * by an Object3D and all its descendants.
 */
function _disposeObject(obj) {
  obj.traverse(child => {
    if (child.geometry) {
      child.geometry.dispose();
    }
    if (child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach(mat => {
        const texProps = [
          'map', 'lightMap', 'bumpMap', 'normalMap', 'displacementMap',
          'roughnessMap', 'metalnessMap', 'alphaMap', 'aoMap', 'emissiveMap',
          'specularMap', 'envMap', 'gradientMap', 'matcap',
        ];
        texProps.forEach(prop => { if (mat[prop]) mat[prop].dispose(); });
        mat.dispose();
      });
    }
  });
}

/**
 * Dispose all GPU resources owned by a source point cloud object (geometry +
 * material).  Call this BEFORE replacing currentPointCloud with a new scene.
 */
export function disposePointCloud(pointCloud) {
  if (!pointCloud) return;
  _disposeObject(pointCloud);
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
      const loader = new PLYLoader();
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
function updateSorting(scene, camera) {
    const existingObjects = scene.children.filter(child => child.userData &&
        (child.userData.type === 'object_mode' || child.userData.type === 'ellipse_mode'));

    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;

    existingObjects.forEach(objectGroup => {
        const cache = objectGroup.userData.sortCache;
        if (!cache) return; // group has no sort cache (e.g. ellipse Points mode)

        const instancedMesh = objectGroup.children[0];
        if (!instancedMesh || !instancedMesh.isInstancedMesh) return;

        const numSplats = instancedMesh.count;
        const { origPositions, origMatData, origColorData, origOpacityData, depthData, indices } = cache;

        // 1. Calculate depths using pre-cached original positions — no allocation
        for (let i = 0; i < numSplats; i++) {
            const i3 = i * 3;
            const dx = origPositions[i3]     - cx;
            const dy = origPositions[i3 + 1] - cy;
            const dz = origPositions[i3 + 2] - cz;
            depthData[i] = dx * dx + dy * dy + dz * dz;
        }

        // 2. Sort pre-allocated indices far-to-near (Back-to-Front)
        indices.sort((a, b) => depthData[b] - depthData[a]);

        // 3. Write matrices in sorted order directly from snapshot — no Matrix4 allocation
        const matDst = instancedMesh.instanceMatrix.array;
        for (let j = 0; j < numSplats; j++) {
            const src = indices[j] * 16;
            const dst = j * 16;
            matDst.set(origMatData.subarray(src, src + 16), dst);
        }
        instancedMesh.instanceMatrix.needsUpdate = true;

        // 4. Write colors in sorted order — no Color allocation
        if (origColorData && instancedMesh.instanceColor) {
            const colDst = instancedMesh.instanceColor.array;
            for (let j = 0; j < numSplats; j++) {
                const src = indices[j] * 3;
                colDst.set(origColorData.subarray(src, src + 3), j * 3);
            }
            instancedMesh.instanceColor.needsUpdate = true;
        }

        // 5. Write opacities in sorted order — no allocation
        if (origOpacityData && instancedMesh.geometry.attributes.instanceOpacity) {
            const opacDst = instancedMesh.geometry.attributes.instanceOpacity.array;
            for (let j = 0; j < numSplats; j++) {
                opacDst[j] = origOpacityData[indices[j]];
            }
            instancedMesh.geometry.attributes.instanceOpacity.needsUpdate = true;
        }
    });
}

function updateSplatUniforms(camera) {

  const width = window.innerWidth;
  const height = window.innerHeight;
  const fovRad = THREE.MathUtils.degToRad(camera.fov);
  
  // Distancia focal en píxeles
  const fy = height / (2 * Math.tan(fovRad / 2));
  const fx = fy; // Three.js asume píxeles cuadrados generalmente

  if (!currentPointCloud.material || !currentPointCloud.material.uniforms){
    console.warn("currentPointCloud.material or its uniforms are not defined.");
    return;
  } else{

    // Inside your render loop
    const worldCamPos = new THREE.Vector3();
    camera.getWorldPosition(worldCamPos);
    currentPointCloud.material.uniforms.cameraPosition.value.copy(worldCamPos);

    // other uniforms...
    

    if (!currentPointCloud.material.uniforms.focal || !currentPointCloud.material.uniforms.viewport) {
      console.warn("currentPointCloud.material.uniforms.focal or viewport are not defined.");
      return;
    }
      currentPointCloud.material.uniforms.focal.value.set(fx, fy);
      currentPointCloud.material.uniforms.viewport.value.set(width, height);
  }
}

function updatePointCloudSorting(scene, camera) {
  // Find point clouds in the scene that have Gaussian splat loaders
  const pointClouds = scene.children.filter(child => 
    child.type === 'Points' && 
    child.userData && 
    child.userData.loader && 
    typeof child.userData.loader.updatePointCloudSorting === 'function'
  );
  
  pointClouds.forEach(pointCloud => {
    // Call the sorting method from the loader
    pointCloud.userData.loader.updatePointCloudSorting(pointCloud, camera);
  });
}

// Export the sorting function for use in main render loop
export function updateObjectSorting(scene, camera) {
  // Uniforms must update every frame (cameraPosition, focal, viewport)
  updateSplatUniforms(camera);

  // Only re-sort when the camera has actually moved or rotated
  const posDeltaSq = _lastSortCamPos.distanceToSquared(camera.position);
  const quatDot = Math.abs(_lastSortCamQuat.dot(camera.quaternion));
  const cameraMoved = posDeltaSq > 1e-6 || quatDot < 0.9999995;

  if (cameraMoved) {
    _lastSortCamPos.copy(camera.position);
    _lastSortCamQuat.copy(camera.quaternion);
    updateSorting(scene, camera);
    updatePointCloudSorting(scene, camera);
  }
}

export function renderGaussianSplatting(scene, pointCloud) {
  // this creates the point cloud that will be rendered with different shaders
  // Clear existing render objects
  clearExistingRenderObjects(scene);
  currentPointCloud = pointCloud;
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

export function renderEllipseMode(scene, pointCloud, scale = 100) {
  // Clear existing render objects
  clearExistingRenderObjects(scene);
  
  const geometry = pointCloud.geometry;
  const positions = geometry.attributes.position.array;
  const scales = geometry.attributes.scale ? geometry.attributes.scale.array : null;
  const rotations = geometry.attributes.rotation ? geometry.attributes.rotation.array : null;
  const colors = geometry.attributes.color ? geometry.attributes.color.array : null;
  const opacities = geometry.attributes.opacity ? geometry.attributes.opacity.array : null;
  
  const vertexCount = positions.length / 3;
  
  // Create a group to hold all ellipse sprites
  const ellipseGroup = new THREE.Group();
  ellipseGroup.userData = { type: 'ellipse_mode' };
  
  // Create custom shader material for gradient ellipses
  const ellipseMaterial = createGradientEllipseMaterial();
  
  // Always use instanced rendering for better performance
  console.log(`Creating ${vertexCount} instanced ellipse points with gradient texture at ${scale}% scale.`);
  return renderEllipseModeInstanced(scene, positions, scales, rotations, colors, opacities, vertexCount, ellipseMaterial, scale);
}

function createGradientEllipseMaterial() {
  // Create a custom shader material for radial gradient ellipses
  const vertexShader = `
    attribute float scale;
    attribute vec3 color;
    
    varying vec3 vColor;
    varying vec2 vUv;
    
    void main() {
      vColor = color;
      vUv = uv;
      
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      
      // Improved point size calculation with clamping
      float distance = max(abs(mvPosition.z), 1.0); // Prevent division by zero
      gl_PointSize = (scale * 10000.0) / distance; // Reduced from 1000.0 to 100.0
      gl_PointSize = clamp(gl_PointSize, 8.0, 20000.0); // Better size limits
    }
  `;
  
  const fragmentShader = `
    varying vec3 vColor;
    varying vec2 vUv;
    
    void main() {
      vec2 center = vec2(0.5, 0.5);
      float dist = distance(gl_PointCoord, center);
      
      // Create elliptical falloff instead of circular
      vec2 ellipseUv = (gl_PointCoord - center) * 2.0;
      float ellipticalDist = length(vec2(ellipseUv.x * 1.2, ellipseUv.y * 0.8));
      
      // Create smooth gradient from center to edge
      float alpha = 1.0 - smoothstep(0.0, 0.5, ellipticalDist);
      alpha = alpha * alpha; // Square for more solid center
      
      if (alpha < 0.01) discard;
      
      // Improved color calculation - prevent overly dark colors
      vec3 finalColor = vColor * (0.7 + 0.3 * alpha); // Brighter base color
      finalColor = clamp(finalColor, 0.1, 0.9); // Prevent pure black/white
      
      gl_FragColor = vec4(finalColor, alpha * 0.8);
    }
  `;
  
  return new THREE.ShaderMaterial({
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending // Changed from AdditiveBlending to prevent white saturation
  });
}

function renderEllipseModeInstanced(scene, positions, scales, rotations, colors, opacities, vertexCount, baseMaterial, globalScale = 100) {
  // For large datasets, use a more optimized approach with Points and custom shader
  const ellipseGroup = new THREE.Group();
  ellipseGroup.userData = { type: 'ellipse_mode' };
  
  // Convert percentage to multiplier
  const scaleMultiplierGlobal = globalScale / 100;
  
  // Create geometry for all points
  const geometry = new THREE.BufferGeometry();
  const positionBuffer = new THREE.Float32BufferAttribute(positions, 3);
  const colorBuffer = colors ? new THREE.Float32BufferAttribute(colors, 3) : null;
  const scaleBuffer = new THREE.Float32BufferAttribute(vertexCount, 1);
  
  // Set up scale buffer with global scale applied
  for (let i = 0; i < vertexCount; i++) {
    const i3 = i * 3;
    const avgScale = scales ? (Math.abs(scales[i3]) + Math.abs(scales[i3 + 1]) + Math.abs(scales[i3 + 2])) / 3 : 0.1;
    scaleBuffer.setX(i, avgScale * 0.5 * scaleMultiplierGlobal); // Reduced from 50 to 0.5 for proper visibility
  }
  
  geometry.setAttribute('position', positionBuffer);
  if (colorBuffer) geometry.setAttribute('color', colorBuffer);
  geometry.setAttribute('scale', scaleBuffer);
  
  // Add individual opacity attribute if available
  if (opacities) {
    geometry.setAttribute('instanceOpacity', new THREE.InstancedBufferAttribute(opacities, 1));
  }
  
  // Use Points with custom material for performance
  const pointsMaterial = new THREE.PointsMaterial({
    size: 2, // Reduced from 20 to 2 for proper size
    transparent: true,
    opacity: 0.8,
    vertexColors: !!colors,
    map: getEllipseTexture(),
    alphaTest: 0.01,
    blending: THREE.NormalBlending, // Changed from AdditiveBlending to fix white rendering
    depthWrite: false
  });
  
  // Add shader modification for individual opacity
  if (opacities) {
    pointsMaterial.onBeforeCompile = (shader) => {
      // 1. Declare attribute in Vertex Shader
      shader.vertexShader = `
        attribute float instanceOpacity;
        varying float vInstanceOpacity;
        ${shader.vertexShader}
      `.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        vInstanceOpacity = instanceOpacity;
        `
      );
      
      // 2. Apply opacity in Fragment Shader
      shader.fragmentShader = `
        varying float vInstanceOpacity;
        ${shader.fragmentShader}
      `.replace(
        '#include <alphamap_fragment>',
        `
        #include <alphamap_fragment>
        diffuseColor.a = vInstanceOpacity; // Use individual opacity directly
        `
      );
    };
  }
  
  const points = new THREE.Points(geometry, baseMaterial);
  ellipseGroup.add(points);
  scene.add(ellipseGroup);
  
  // Calculate bounding box
  const box = new THREE.Box3().setFromObject(ellipseGroup);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  
  const maxDim = Math.max(size.x, size.y, size.z);
  const distance = maxDim * 2;
  
  return { center, distance };
}

function createEllipseTexture() {
  // Create a texture for the elliptical gradient
  const canvas = document.createElement('canvas');
  const size = 64;
  canvas.width = size;
  canvas.height = size;
  
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(
    size / 2, size / 2, 0,    // Inner circle (center, no radius)
    size / 2, size / 2, size / 2  // Outer circle (center, full radius)
  );
  
  // Create gradient with better color multiplier (not pure white)
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');    // Full opacity center
  gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.8)');  // Still strong
  gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.3)');  // Fading
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0.0)');    // Transparent edge
  
  context.fillStyle = gradient;
  
  // Create elliptical shape by scaling
  context.save();
  context.scale(1.2, 0.8); // Make it elliptical
  context.fillRect(0, 0, size / 1.2, size / 0.8);
  context.restore();
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}



export function renderObjectMode(scene, pointCloud, scale = 100) {
  // Clear existing render objects
  clearExistingRenderObjects(scene);
  
  const geometry = pointCloud.geometry;
  const positions = geometry.attributes.position.array;
  const scales = geometry.attributes.scale ? geometry.attributes.scale.array : null;
  const rotations = geometry.attributes.rotation ? geometry.attributes.rotation.array : null;
  const colors = geometry.attributes.color ? geometry.attributes.color.array : null;
  const opacities = geometry.attributes.opacity ? geometry.attributes.opacity.array : null;
  
  const vertexCount = positions.length / 3;
  
  // For performance, use different approaches based on vertex count
  if (vertexCount > 10000) {
    console.log(`Large dataset detected (${vertexCount} points). Using instanced rendering for performance at ${scale}% scale.`);
    return renderObjectModeInstanced(scene, positions, scales, rotations, colors, opacities, vertexCount, scale);
  } else {
    console.log(`Creating ${vertexCount} individual ellipsoid meshes at ${scale}% scale.`);
    return renderObjectModeIndividual(scene, positions, scales, rotations, colors, opacities, vertexCount, scale);
  }
}

function renderObjectModeIndividual(scene, positions, scales, rotations, colors, opacities, vertexCount, globalScale = 100) {
  // Create a group to hold all ellipsoid meshes
  const objectGroup = new THREE.Group();
  objectGroup.userData = { type: 'object_mode' };
  
  // Convert percentage to multiplier
  const scaleMultiplierGlobal = globalScale / 100;
  
  // Create ellipsoid geometry (we'll reuse this for all instances)
  const ellipsoidGeometry = new THREE.SphereGeometry(1, 16, 12);
  
  // Create instances for each Gaussian point
  for (let i = 0; i < vertexCount; i++) {
    const i3 = i * 3;
    const i4 = i * 4;
    
    // Get individual opacity
    const pointOpacity = opacities ? opacities[i] : 0.7;
    
    // Create material with the point's color and opacity
    const material = new THREE.MeshLambertMaterial({
      color: colors ? new THREE.Color(colors[i3], colors[i3 + 1], colors[i3 + 2]) : 0xff6600,
      transparent: true,
      opacity: pointOpacity
    });
    
    // Create mesh
    const mesh = new THREE.Mesh(ellipsoidGeometry, material);
    
    // Set position
    mesh.position.set(positions[i3], positions[i3 + 1], positions[i3 + 2]);
    
    // Set scale from Gaussian scale parameters with global scale applied
    if (scales) {
      mesh.scale.set(
        scales[i3] * scaleMultiplierGlobal, 
        scales[i3 + 1] * scaleMultiplierGlobal, 
        scales[i3 + 2] * scaleMultiplierGlobal
      );
    } else {
      const defaultScale = 0.1 * scaleMultiplierGlobal;
      mesh.scale.set(defaultScale, defaultScale, defaultScale);
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

function renderObjectModeInstanced(scene, positions, scales, rotations, colors, opacities, vertexCount, globalScale = 100) {
  // Create a group to hold the instanced mesh
  const objectGroup = new THREE.Group();
  objectGroup.userData = { type: 'object_mode' };
  
  // Convert percentage to multiplier
  const scaleMultiplierGlobal = globalScale / 100;
  
  // Create ellipsoid geometry
  const ellipsoidGeometry = new THREE.SphereGeometry(1, 12, 8); // Lower resolution for performance
  
  // Add individual opacity attribute if available
  if (opacities) {
    ellipsoidGeometry.setAttribute('instanceOpacity', new THREE.InstancedBufferAttribute(opacities, 1));
  }
  
  // Create instanced mesh
  const material = new THREE.MeshLambertMaterial({
    transparent: true,
    opacity: 0.7
  });
  
  // Add shader modification for individual opacity
  if (opacities) {
    material.onBeforeCompile = (shader) => {
      // 1. Declarar el atributo en el Vertex Shader
      shader.vertexShader = `
        attribute float instanceOpacity;
        varying float vInstanceOpacity;
        ${shader.vertexShader}
      `.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        vInstanceOpacity = instanceOpacity;
        `
      );
      
      // 2. Aplicar la opacidad en el Fragment Shader
      shader.fragmentShader = `
        varying float vInstanceOpacity;
        ${shader.fragmentShader}
      `.replace(
        '#include <alphamap_fragment>',
        `
        #include <alphamap_fragment>
        diffuseColor.a = vInstanceOpacity; // Use individual opacity directly
        `
      );
    };
  }
  
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
    
    // Set scale from Gaussian scale parameters with global scale applied
    if (scales) {
      scale.set(
        scales[i3] * scaleMultiplierGlobal, 
        scales[i3 + 1] * scaleMultiplierGlobal, 
        scales[i3 + 2] * scaleMultiplierGlobal
      );
    } else {
      const defaultScale = 0.1 * scaleMultiplierGlobal;
      scale.set(defaultScale, defaultScale, defaultScale);
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

  // Pre-allocate sort cache once — avoids all per-frame allocations during sorting
  const _sortIndices = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) _sortIndices[i] = i;
  objectGroup.userData.sortCache = {
    origPositions:  positions.slice(0, vertexCount * 3),
    origMatData:    instancedMesh.instanceMatrix.array.slice(),
    origColorData:  instancedMesh.instanceColor ? instancedMesh.instanceColor.array.slice() : null,
    origOpacityData: opacities ? new Float32Array(opacities) : null,
    depthData: new Float32Array(vertexCount),
    indices:   _sortIndices,
  };

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

export function exportImage(renderer, scene, camera, filename = null) {
  const originalSize = renderer.getSize(new THREE.Vector2());
  const exportScale = 2; // 2x resolution for better quality
  const expW = Math.round(originalSize.x * exportScale);
  const expH = Math.round(originalSize.y * exportScale);

  // Update Gaussian splat viewport uniforms for the target size
  function setSplatUniforms(w, h) {
    if (currentPointCloud?.material?.uniforms?.focal) {
      const fovRad = THREE.MathUtils.degToRad(camera.fov);
      const fy = h / (2 * Math.tan(fovRad / 2));
      currentPointCloud.material.uniforms.focal.value.set(fy, fy);
      currentPointCloud.material.uniforms.viewport.value.set(w, h);
    }
  }

  // Render at 2x resolution
  renderer.setSize(expW, expH);
  setSplatUniforms(expW, expH);
  renderer.render(scene, camera);

  const dataURL = renderer.domElement.toDataURL('image/png');

  // Restore original size and re-render to avoid a stale canvas
  renderer.setSize(originalSize.x, originalSize.y);
  setSplatUniforms(originalSize.x, originalSize.y);
  renderer.render(scene, camera);

  // Trigger download
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
