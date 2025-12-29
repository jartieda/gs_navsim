// gaussian-splat-loader.js
// Custom PLY loader for Gaussian Splatting format

import * as THREE from 'three';

export class GaussianSplatLoader {
  constructor() {
    this.littleEndian = true;
  }

  async load(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (event) => {
        try {
          const buffer = event.target.result;
          const result = this.parse(buffer);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };
      
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  parse(buffer) {
    const dataView = new DataView(buffer);
    let offset = 0;
    
    // Parse PLY header
    const header = this.parseHeader(buffer);
    offset = header.headerLength;
    
    console.log('PLY Header:', header);
    
    // Parse vertex data
    const vertices = this.parseVertices(dataView, offset, header);
    
    return this.createGaussianSplatMesh(vertices, header);
  }

  parseHeader(buffer) {
    const text = new TextDecoder().decode(buffer);
    const lines = text.split('\n');
    
    const header = {
      format: 'ascii',
      vertexCount: 0,
      properties: [],
      headerLength: 0
    };
    
    let inHeader = false;
    let headerText = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      headerText += line + '\n';
      
      if (line === 'ply') {
        inHeader = true;
        continue;
      }
      
      if (line === 'end_header') {
        header.headerLength = new TextEncoder().encode(headerText).length;
        break;
      }
      
      if (!inHeader) continue;
      
      const parts = line.split(' ');
      
      if (parts[0] === 'format') {
        header.format = parts[1];
        this.littleEndian = parts[1] === 'binary_little_endian';
      } else if (parts[0] === 'element' && parts[1] === 'vertex') {
        header.vertexCount = parseInt(parts[2]);
      } else if (parts[0] === 'property') {
        const property = {
          type: parts[1],
          name: parts[2]
        };
        header.properties.push(property);
      }
    }
    
    return header;
  }

  parseVertices(dataView, offset, header) {
    const vertices = [];
    const propertyMap = this.createPropertyMap(header.properties);
    
    if (header.format === 'ascii') {
      return this.parseAsciiVertices(dataView.buffer, offset, header, propertyMap);
    } else {
      return this.parseBinaryVertices(dataView, offset, header, propertyMap);
    }
  }

  createPropertyMap(properties) {
    const map = {};
    let offset = 0;
    
    for (const prop of properties) {
      map[prop.name] = {
        offset: offset,
        type: prop.type,
        size: this.getTypeSize(prop.type)
      };
      offset += this.getTypeSize(prop.type);
    }
    
    map.vertexSize = offset;
    return map;
  }

  getTypeSize(type) {
    switch (type) {
      case 'float': return 4;
      case 'double': return 8;
      case 'int': case 'uint': return 4;
      case 'short': case 'ushort': return 2;
      case 'char': case 'uchar': return 1;
      default: return 4;
    }
  }

  parseAsciiVertices(buffer, offset, header, propertyMap) {
    const text = new TextDecoder().decode(buffer.slice(offset));
    const lines = text.split('\n').filter(line => line.trim());
    const vertices = [];
    
    for (let i = 0; i < Math.min(lines.length, header.vertexCount); i++) {
      const values = lines[i].trim().split(/\s+/).map(v => parseFloat(v));
      if (values.length >= 3) {
        const vertex = this.createVertex(values, header.properties);
        vertices.push(vertex);
      }
    }
    
    return vertices;
  }

  parseBinaryVertices(dataView, offset, header, propertyMap) {
    const vertices = [];
    
    for (let i = 0; i < header.vertexCount; i++) {
      const vertex = {};
      let vertexOffset = offset + i * propertyMap.vertexSize;
      
      for (const [name, prop] of Object.entries(propertyMap)) {
        if (name === 'vertexSize') continue;
        
        vertex[name] = this.readBinaryValue(dataView, vertexOffset + prop.offset, prop.type);
      }
      
      vertices.push(this.processVertex(vertex));
    }
    
    return vertices;
  }

  readBinaryValue(dataView, offset, type) {
    switch (type) {
      case 'float':
        return dataView.getFloat32(offset, this.littleEndian);
      case 'double':
        return dataView.getFloat64(offset, this.littleEndian);
      case 'int':
        return dataView.getInt32(offset, this.littleEndian);
      case 'uint':
        return dataView.getUint32(offset, this.littleEndian);
      case 'short':
        return dataView.getInt16(offset, this.littleEndian);
      case 'ushort':
        return dataView.getUint16(offset, this.littleEndian);
      case 'char':
        return dataView.getInt8(offset);
      case 'uchar':
        return dataView.getUint8(offset);
      default:
        return dataView.getFloat32(offset, this.littleEndian);
    }
  }

  createVertex(values, properties) {
    const vertex = {};
    
    for (let i = 0; i < properties.length && i < values.length; i++) {
      vertex[properties[i].name] = values[i];
    }
    
    return this.processVertex(vertex);
  }

  processVertex(vertex) {
    // Standard position - rotate 180 degrees around X axis
    /*const processed = {
      position: [
        vertex.x || 0,
        -(vertex.y || 0), 
        -(vertex.z || 0)
      ]
    };*/
    // inverted
    const processed = {
      position: [
         vertex.x || 0,
        (vertex.y || 0), 
        (vertex.z || 0)
      ]
    };
    // Gaussian splatting specific attributes - rotate 180 degrees around X axis
    //processed.scale = [
    //  vertex.scale_0 || vertex.scale_x || 0.01,
    //  vertex.scale_2 || vertex.scale_z || 0.01, // Y and Z swapped for X rotation
    //  vertex.scale_1 || vertex.scale_y || 0.01
    //];
    //processed.scale = processed.scale.map(s => Math.exp(s));
    // inverted scale 
    // Aplicamos exp() porque en el PLY están en espacio logarítmico
    processed.scale = [
        Math.exp(vertex.scale_0 ?? -5),
        Math.exp(vertex.scale_1 ?? -5),
        Math.exp(vertex.scale_2 ?? -5)
    ];

    // Rotation (quaternion) - apply 180 degree X rotation
    processed.rotation = [
      vertex.rot_1 || 0, // x
      vertex.rot_2 || 0, // y 
      vertex.rot_3 || 0, // z
      vertex.rot_0 || 1  // w
    ];
    
    // 180 degree rotation around X axis quaternion: (1, 0, 0, 0)
    // Compose with original quaternion: q_result = q_rotation * q_original
    /*const qx = 1, qy = 0, qz = 0, qw = 0; // X rotation quaternion
    const ox = originalQuat[0], oy = originalQuat[1], oz = originalQuat[2], ow = originalQuat[3];
    
    processed.rotation = [
      qw * ox + qx * ow + qy * oz - qz * oy, // x
      qw * oy - qx * oz + qy * ow + qz * ox, // y
      qw * oz + qx * oy - qy * ox + qz * ow, // z
      qw * ow - qx * ox - qy * oy - qz * oz  // w
    ];*/
    
    // Opacity
    // 1. Obtener el valor crudo (raw) del objeto vertex
    const rawOpacity = vertex.opacity !== undefined ? vertex.opacity : (vertex.alpha ?? 0);
    // 2. Aplicar la sigmoide
    let opacity = 1.0 / (1.0 + Math.exp(-rawOpacity));
    // 3. Clamping (opcional, la sigmoide ya garantiza 0-1, pero por seguridad ante NaN)
    processed.opacity = isNaN(opacity) ? 0.0 : Math.min(1.0, Math.max(0.0, opacity));
    
    // Spherical harmonics coefficients
    // DC (degree 0) - fundamental color (3 coefficients)
    processed.sh_dc = [
      vertex.f_dc_0 || 0.0,
      vertex.f_dc_1 || 0.0,
      vertex.f_dc_2 || 0.0
    ];
    
    // Rest coefficients (degree 1, 2, 3) - 45 coefficients
    processed.sh_rest = [];
    for (let i = 0; i < 45; i++) {
      const shValue = vertex[`f_rest_${i}`] || 0.0;
      processed.sh_rest.push(shValue);
    }
    
    // Fallback to simple color if no SH data
    if (processed.sh_dc[0] === 0 && processed.sh_dc[1] === 0 && processed.sh_dc[2] === 0) {
      if (vertex.red !== undefined && vertex.green !== undefined && vertex.blue !== undefined) {
        // Convert RGB to SH DC coefficients
        processed.sh_dc = [
          (vertex.red / 255.0 - 0.5) / 0.28209479177387814,
          (vertex.green / 255.0 - 0.5) / 0.28209479177387814,
          (vertex.blue / 255.0 - 0.5) / 0.28209479177387814
        ];
      } else if (vertex.r !== undefined && vertex.g !== undefined && vertex.b !== undefined) {
        processed.sh_dc = [
          (vertex.r - 0.5) / 0.28209479177387814,
          (vertex.g - 0.5) / 0.28209479177387814,
          (vertex.b - 0.5) / 0.28209479177387814
        ];
      } else {
        // Default orange color for debugging
        processed.sh_dc = [0.5, 0.0, -0.5];
      }
    }
    
    return processed;
  }

  createGaussianSplatMesh(vertices, header) {
    console.log(`Creating Gaussian splat mesh with ${vertices.length} vertices`);
    
    // Debug: Check first few vertices for color data
    if (vertices.length > 0) {
      for (let i = 0; i < Math.min(3, vertices.length); i++) {
        console.log('First vertex color:', vertices[i].color);
        console.log('Sample vertex data:', vertices[i]);
        console.log('First vertex scale:', vertices[i].scale);
      }
    }
    
    // Store original vertices for reordering
    this.originalVertices = vertices.slice(); // Create a copy
    
    // Create geometry
    const geometry = new THREE.BufferGeometry();
    
    // Position attribute
    const positions = new Float32Array(vertices.length * 3);
    const scales = new Float32Array(vertices.length * 3);
    const rotations = new Float32Array(vertices.length * 4);
    const opacities = new Float32Array(vertices.length);
    
    // Spherical harmonics coefficients (grouped into vec4 attributes)
    const sh_dc = new Float32Array(vertices.length * 3);          // DC coefficients
    const sh_rest_0_3 = new Float32Array(vertices.length * 4);    // f_rest_0, f_rest_1, f_rest_2, f_rest_3
    const sh_rest_4_7 = new Float32Array(vertices.length * 4);    // f_rest_4, f_rest_5, f_rest_6, f_rest_7
    const sh_rest_8_11 = new Float32Array(vertices.length * 4);   // f_rest_8, f_rest_9, f_rest_10, f_rest_11
    const sh_rest_12_15 = new Float32Array(vertices.length * 4);  // f_rest_12, f_rest_13, f_rest_14, f_rest_15
    const sh_rest_16_19 = new Float32Array(vertices.length * 4);  // f_rest_16, f_rest_17, f_rest_18, f_rest_19
    const sh_rest_20_23 = new Float32Array(vertices.length * 4);  // f_rest_20, f_rest_21, f_rest_22, f_rest_23
    const sh_rest_24_27 = new Float32Array(vertices.length * 4);  // f_rest_24, f_rest_25, f_rest_26, f_rest_27
    
    
    for (let i = 0; i < vertices.length; i++) {
      const vertex = vertices[i];
      const i3 = i * 3;
      const i4 = i * 4;
      
      // Position
      positions[i3] = vertex.position[0];
      positions[i3 + 1] = vertex.position[1];
      positions[i3 + 2] = vertex.position[2];
      
      // Scale
      scales[i3] = vertex.scale[0];
      scales[i3 + 1] = vertex.scale[1];
      scales[i3 + 2] = vertex.scale[2];
      
      // Rotation (quaternion)
      rotations[i4] = vertex.rotation[0];
      rotations[i4 + 1] = vertex.rotation[1];
      rotations[i4 + 2] = vertex.rotation[2];
      rotations[i4 + 3] = vertex.rotation[3];
      
      // Opacity
      opacities[i] = vertex.opacity;
      
      // SH DC coefficients (fundamental color)
      sh_dc[i3] = vertex.sh_dc[0];
      sh_dc[i3 + 1] = vertex.sh_dc[1];
      sh_dc[i3 + 2] = vertex.sh_dc[2];
      
      // SH rest coefficients (grouped into vec4 attributes)
      sh_rest_0_3[i4] = vertex.sh_rest[0] || 0.0;
      sh_rest_0_3[i4 + 1] = vertex.sh_rest[1] || 0.0;
      sh_rest_0_3[i4 + 2] = vertex.sh_rest[2] || 0.0;
      sh_rest_0_3[i4 + 3] = vertex.sh_rest[3] || 0.0;
      
      sh_rest_4_7[i4] = vertex.sh_rest[4] || 0.0;
      sh_rest_4_7[i4 + 1] = vertex.sh_rest[5] || 0.0;
      sh_rest_4_7[i4 + 2] = vertex.sh_rest[6] || 0.0;
      sh_rest_4_7[i4 + 3] = vertex.sh_rest[7] || 0.0;
      
      sh_rest_8_11[i4] = vertex.sh_rest[8] || 0.0;
      sh_rest_8_11[i4 + 1] = vertex.sh_rest[9] || 0.0;
      sh_rest_8_11[i4 + 2] = vertex.sh_rest[10] || 0.0;
      sh_rest_8_11[i4 + 3] = vertex.sh_rest[11] || 0.0;
      
      sh_rest_12_15[i4] = vertex.sh_rest[12] || 0.0;
      sh_rest_12_15[i4 + 1] = vertex.sh_rest[13] || 0.0;
      sh_rest_12_15[i4 + 2] = vertex.sh_rest[14] || 0.0;
      sh_rest_12_15[i4 + 3] = vertex.sh_rest[15] || 0.0;

      sh_rest_16_19[i4] = vertex.sh_rest[16] || 0.0;
      sh_rest_16_19[i4 + 1] = vertex.sh_rest[17] || 0.0;
      sh_rest_16_19[i4 + 2] = vertex.sh_rest[18] || 0.0;
      sh_rest_16_19[i4 + 3] = vertex.sh_rest[19] || 0.0;

      sh_rest_20_23[i4] = vertex.sh_rest[20] || 0.0;
      sh_rest_20_23[i4 + 1] = vertex.sh_rest[21] || 0.0;
      sh_rest_20_23[i4 + 2] = vertex.sh_rest[22] || 0.0;
      sh_rest_20_23[i4 + 3] = vertex.sh_rest[23] || 0.0;

      sh_rest_24_27[i4] = vertex.sh_rest[24] || 0.0;
      sh_rest_24_27[i4 + 1] = vertex.sh_rest[25] || 0.0;
      sh_rest_24_27[i4 + 2] = vertex.sh_rest[26] || 0.0;
      sh_rest_24_27[i4 + 3] = vertex.sh_rest[27] || 0.0;
    }
    
    // Calculate rgbcolor from sh_dc coefficients (convert SH DC to RGB in [0,1] range)
    const rgbcolor = new Float32Array(vertices.length * 3);
    for (let i = 0; i < vertices.length; i++) {
      // SH DC to RGB: reverse the encoding in processVertex
      rgbcolor[i * 3]     = 0.5 + 0.28209479177387814 * vertices[i].sh_dc[0];
      rgbcolor[i * 3 + 1] = 0.5 + 0.28209479177387814 * vertices[i].sh_dc[1];
      rgbcolor[i * 3 + 2] = 0.5 + 0.28209479177387814 * vertices[i].sh_dc[2];
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(rgbcolor, 3));
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('scale', new THREE.BufferAttribute(scales, 3));
    geometry.setAttribute('rotation', new THREE.BufferAttribute(rotations, 4));
    geometry.setAttribute('opacity', new THREE.BufferAttribute(opacities, 1));
    geometry.setAttribute('sh_dc', new THREE.BufferAttribute(sh_dc, 3));
    geometry.setAttribute('sh_rest_0_3', new THREE.BufferAttribute(sh_rest_0_3, 4));
    geometry.setAttribute('sh_rest_4_7', new THREE.BufferAttribute(sh_rest_4_7, 4));
    geometry.setAttribute('sh_rest_8_11', new THREE.BufferAttribute(sh_rest_8_11, 4));
    geometry.setAttribute('sh_rest_12_15', new THREE.BufferAttribute(sh_rest_12_15, 4));
    geometry.setAttribute('sh_rest_16_19', new THREE.BufferAttribute(sh_rest_16_19, 4));
    geometry.setAttribute('sh_rest_20_23', new THREE.BufferAttribute(sh_rest_20_23, 4));
    geometry.setAttribute('sh_rest_24_27', new THREE.BufferAttribute(sh_rest_24_27, 4));
    geometry.scale(1, 1, 1);
    // Create custom material for Gaussian splatting
    this.material = this.createGaussianSplatMaterial_ellipso();
    const material = this.material;
    
    // Create points mesh
    const mesh = new THREE.Points(geometry, material);
    mesh.userData = {
      vertexCount: vertices.length,
      format: header.format,
      properties: header.properties,
      loader: this // Store reference to loader for material switching
    };
    mesh.rotation.x = Math.PI;
    return mesh;
  }
    
  createGaussianSplatMaterial_ellipso(harmonicDegree = 2, pointScale = 1000, chiScale = 1.0) {
    // Custom shader material for Gaussian splatting with spherical harmonics
    const vertexShader = `
      uniform int harmonicDegree;
      uniform float pointScale;
      uniform vec2 focal;
      uniform vec2 viewport;
      
      attribute vec3 scale;
      attribute vec4 rotation;
      attribute float opacity;
      attribute vec3 sh_dc;

      // Pass SH rest coefficients as individual attributes (first 15 for degree 1 & 2)
      attribute vec4 sh_rest_0_3;   // f_rest_0, f_rest_1, f_rest_2, f_rest_3
      attribute vec4 sh_rest_4_7;   // f_rest_4, f_rest_5, f_rest_6, f_rest_7
      attribute vec4 sh_rest_8_11;  // f_rest_8, f_rest_9, f_rest_10, f_rest_11
      attribute vec4 sh_rest_12_15; // f_rest_12, f_rest_13, f_rest_14, f_rest_15
      attribute vec4 sh_rest_16_19; // f_rest_16, f_rest_17, f_rest_18, f_rest_19
      attribute vec4 sh_rest_20_23; // f_rest_20, f_rest_21, f_rest_22, f_rest_23
      attribute vec4 sh_rest_24_27; // f_rest_24, f_rest_25, f_rest_26, f_rest_27

      varying vec3 vColor;
      varying float vOpacity;
      varying vec3 vWorldPos;
      varying vec3 vCameraDir;
      varying vec3 vScale;
      varying vec4 vRotation;
      varying float vDistance;
      varying mat2 vCovariance2D;
      varying mat4 vCovariance4D;

      // Spherical harmonics evaluation (conditional based on degree)
      vec3 evaluateSphericalHarmonics(vec3 dir, vec3 sh_dc, int degree) {
          // Start with DC component (degree 0)
          vec3 color = 0.5 + 0.28209479177387814 * sh_dc;
          
          if (degree < 1) return clamp(color, 0.0, 1.0);
          
          // Degree 1 (3 coefficients per color channel = 9 total)
          // Red: 0, 3, 6
          color.r += -0.48860251190291987 * dir.y * sh_rest_0_3.x;
          color.r += 0.48860251190291987 * dir.z * sh_rest_0_3.w;
          color.r += -0.48860251190291987 * dir.x * sh_rest_4_7.z;
          
          // Green: 1, 4, 7
          color.g += -0.48860251190291987 * dir.y * sh_rest_0_3.y;
          color.g += 0.48860251190291987 * dir.z * sh_rest_4_7.x;
          color.g += -0.48860251190291987 * dir.x * sh_rest_4_7.w;

          // Blue: 2, 5, 8
          color.b += -0.48860251190291987 * dir.y * sh_rest_0_3.z;
          color.b += 0.48860251190291987 * dir.z * sh_rest_4_7.y;
          color.b += -0.48860251190291987 * dir.x * sh_rest_8_11.x;
          
          if (degree < 2) return clamp(color, 0.0, 1.0);
          
          // Degree 2 (5 coefficients per channel = 15 total)
          float xx = dir.x * dir.x;
          float yy = dir.y * dir.y;
          float zz = dir.z * dir.z;
          float xy = dir.x * dir.y;
          float yz = dir.y * dir.z;
          float xz = dir.x * dir.z;
          
          // Red: 9, 12, 15, 18, 21
          color.r += 1.0925484305920792 * xy * sh_rest_8_11.y;
          color.r += -1.0925484305920792 * yz * sh_rest_12_15.x;
          color.r += 0.94617469575755997 * (2.0 * zz - xx - yy) * sh_rest_12_15.w;
          color.r += -1.0925484305920792 * xz * sh_rest_16_19.z;
          color.r += 0.54627421529603959 * (xx - yy) * sh_rest_20_23.y;

          // Green: 10, 13, 16, 19, 22
          color.g += 1.0925484305920792 * xy * sh_rest_8_11.z;
          color.g += -1.0925484305920792 * yz * sh_rest_12_15.y;
          color.g += 0.94617469575755997 * (2.0 * zz - xx - yy) * sh_rest_16_19.x;
          color.g += -1.0925484305920792 * xz * sh_rest_16_19.w;
          color.g += 0.54627421529603959 * (xx - yy) * sh_rest_20_23.z;

          // Blue: 11, 14, 17, 20, 23
          color.b += 1.0925484305920792 * xy * sh_rest_8_11.w;
          color.b += -1.0925484305920792 * yz * sh_rest_12_15.z;
          color.b += 0.94617469575755997 * (2.0 * zz - xx - yy) * sh_rest_16_19.y;
          color.b += -1.0925484305920792 * xz * sh_rest_20_23.x;
          color.b += 0.54627421529603959 * (xx - yy) * sh_rest_20_23.w;
          
          // Clamp color to [0,1] range to avoid overly bright colors
          //color = clamp(color, 0.0, 1.0);
          return color;
      }

      // Función de conversión Cuaternio a Matriz de Rotación 3x3
      mat3 quaternion_to_mat3(vec4 q) {
          float x = q.x, y = q.y, z = q.z, w = q.w;
          return mat3(
              1. - 2. * (y * y + z * z),
              2. * (x * y + w * z),
              2. * (x * z - w * y),
              2. * (x * y - w * z),
              1. - 2. * (x * x + z * z),
              2. * (y * z + w * x),
              2. * (x * z + w * y),
              2. * (y * z - w * x),
              1. - 2. * (x * x + y * y)
          );
      }

      // Función para obtener la Matriz de Covarianza 3D (Sigma)
      mat3 get_covariance_3D(vec3 scale, vec4 rot) {
          mat3 R = quaternion_to_mat3(rot);
          mat3 S = mat3(
              scale.x, 0.0, 0.0,
              0.0, scale.y, 0.0,
              0.0, 0.0, scale.z
          );
          return R * S * S * transpose(R);
          
      }
      void main() {
          vOpacity = opacity;
          vScale = scale;
          vRotation = rotation;
      
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          // Extraer la posición 3D en el espacio de la cámara (View Space)
          // Asumiendo que mvPosition.w = 1.0 en este punto (o es el z en el espacio de la cámara para la perspectiva)
          vec3 p_view = mvPosition.xyz;
          if (abs(mvPosition.w - 1.0) > 0.0001) {
              p_view /= mvPosition.w;
          }

          // 2. Calcular la Matriz de Covarianza 3D (Sigma)
          mat3 Sigma = get_covariance_3D(vScale, vRotation);

          // 3. Obtener la Covarianza en el Espacio de la Cámara (View Space)
          // Solo se usa la submatriz 3x3 (rotación y escala) de modelViewMatrix.
          // Esto es correcto si la 4ta columna/fila de Sigma4D es solo para padding/compatibilidad.
          // Extraer solo la rotación de la modelViewMatrix normalizando las columnas
          mat3 mv = mat3(modelViewMatrix);
          vec3 col1 = normalize(mv[0]);
          vec3 col2 = normalize(mv[1]);
          vec3 col3 = normalize(mv[2]);
          mat3 R_view = mat3(col1, col2, col3);

          mat3 Sigma_view = R_view * Sigma * transpose(R_view);

          // 4. Calcular el Jacobiano de la Proyección Perspectiva 3D -> 2D
          // La función de proyección es f(x, y, z) = (x/z, y/z) para el espacio de la cámara.
          // La matriz del Jacobiano J (2x3) en p_view = (x, y, z) es:
          // J = [ dfx/dx dfx/dy dfx/dz ]
          //     [ dfy/dx dfy/dy dfy/dz ]
          // Con fx = x/z y fy = y/z, el Jacobiano es:
          // J = [ 1/z  0   -x/z^2 ]
          //     [ 0   1/z  -y/z^2 ]

          float z_inv = 1.0 / (-p_view.z);
          float z_inv_sq = z_inv * z_inv;
          float x = p_view.x;
          float y = p_view.y;

          //mat3x2 J = mat3x2(
          //    z_inv, 0.0,        // First column: [1/z, 0]
          //    0.0, z_inv,        // Second column: [0, 1/z]  
          //    -x * z_inv_sq, -y * z_inv_sq  // Third column: [-x/z^2, -y/z^2]
          //);
          
          // version con focal positivo
          //mat3x2 J = mat3x2(
          //  focal.x * z_inv, 0.0,
          //  0.0, focal.y * z_inv,
          //  -(focal.x * mvPosition.x) * z_inv_sq, -(focal.y * mvPosition.y) * z_inv_sq
          //);

          // p_view.x y p_view.y ya están en espacio de cámara (antes de la división de proyección)
          mat3x2 J = mat3x2(
              focal.x * z_inv, 0.0,                          // Columna 1
              0.0, focal.y * z_inv,                          // Columna 2
              (focal.x * p_view.x) * z_inv_sq, (focal.y * p_view.y) * z_inv_sq // Columna 3 (SIN MINUS)
          );

          // 5. Proyectar la covarianza 3D a 2D usando el Jacobiano
          // vCovariance2D = J * Sigma_view * J^T
          vCovariance2D = J * Sigma_view * transpose(J);

          
      
          // 6. Determinar el tamaño del quad 2D
          // El tamaño del quad debe ser proporcional al tamaño de la elipse 2D (ej. 3 sigma)
          // El radio máximo al cuadrado de la elipse 2D es el autovalor más grande de Sigma'.
          
          // Usamos el trazo (suma de diagonales) para estimar el tamaño del BB
          // Mejor aún, se calcula directamente el radio máximo:
          //float det_cov_2d = vCovariance2D[0][0] * vCovariance2D[1][1] - vCovariance2D[0][1] * vCovariance2D[1][0];
          //float trace_cov_2d = vCovariance2D[0][0] + vCovariance2D[1][1];
          //float discriminant = trace_cov_2d * trace_cov_2d - 4.0 * det_cov_2d;
          //float max_eigenvalue = (trace_cov_2d + sqrt(max(0.0, discriminant))) / 2.0;
          // Usar 3 veces la desviación estándar (sqrt(autovalor)) para el tamaño del quad
          //float radius = 3.0 * sqrt(max(0.0001, max_eigenvalue)); // Ensure positive value
        
          // 6. Tamaño del punto dinámico
          float det = vCovariance2D[0][0] * vCovariance2D[1][1] - vCovariance2D[0][1] * vCovariance2D[1][0];
          float mid = 0.5 * (vCovariance2D[0][0] + vCovariance2D[1][1]);
          float lambda = mid + sqrt(max(0.1, mid * mid - det));
          float radius_pixels = ceil(3.0 * sqrt(lambda));
          
          gl_PointSize = (pointScale / 100.0) * radius_pixels * 2.0;
          
          // Guardamos el radio para escalar gl_PointCoord en el fragment
          vDistance = radius_pixels;
          // Calculate camera direction for spherical harmonics
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          // Calculate camera direction for spherical harmonics
          vec3 cameraPos = cameraPosition;
          vCameraDir = normalize(cameraPos - vWorldPos);
          // Evaluate spherical harmonics for view-dependent color
          vColor = evaluateSphericalHarmonics(vCameraDir, sh_dc, harmonicDegree);
          
          //gl_PointSize = 10.0 * pointScale;
          gl_PointSize = clamp(gl_PointSize, 2.0, 200000.0);
      }
    `;
    
    const fragmentShader = `
      uniform float chiScale;
      
      varying vec3 vColor;
      varying float vOpacity;
      varying mat2 vCovariance2D; // Matriz de Covarianza 2D (Sigma')
      varying float vDistance; // Radio del punto en píxeles
      
      void main() {
          // Get normalized coordinates from center of point
          vec2 d = (gl_PointCoord - 0.5) * vDistance * 2.0;
          d.y = -d.y; // <--- CORRECCIÓN CRÍTICA
          // Project 3D covariance to 2D (screen space)
          float det = vCovariance2D[0][0] * vCovariance2D[1][1] - vCovariance2D[0][1] * vCovariance2D[1][0];
          if (abs(det)>=0.000000001){
            // Inverse of 2x2 matrix
            mat2 inv_cov_2d = mat2(
                vCovariance2D[1][1], -vCovariance2D[1][0],
                -vCovariance2D[0][1], vCovariance2D[0][0]
            ) / det;
            // Mahalanobis distance squared: d^T * inv(Sigma') * d
            float chi2 = dot(d, inv_cov_2d * d);
            if (chi2 > 7.0) discard; // Optimización: 3-sigma cutoff

            chi2 = chi2 * chiScale;
            
            // Per-pixel alpha
            float alpha_total = exp(-chi2 * 0.5) * vOpacity;
            
            // Early discard for efficiency
            if (alpha_total < 0.01) {
                discard;
            }
            gl_FragColor = vec4(vColor, alpha_total);
          }else{
            discard;
          }
        
      }
    `;
    
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      blending: THREE.NormalBlending,
      depthTest: true,
      depthWrite: false,
      uniforms: {
        focal: { value: new THREE.Vector2() },
        viewport: { value: new THREE.Vector2() },
        cameraPosition: { value: new THREE.Vector3() },
        harmonicDegree: { value: harmonicDegree },
        pointScale: { value: pointScale },
        chiScale: { value: chiScale }
      },
      vertexColors: true
    });
  }



  createSimplePointMaterial() {
    // Simple point material for comparison
    return new THREE.PointsMaterial({
      size: 0.02,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.8
    });
  }
  /**
   * Versión optimizada: Solo ordena índices y usa profundidad de vista.
   */
  updatePointCloudSorting(pointCloudMesh, camera) {
    const geometry = pointCloudMesh.geometry;
    const numVertices = this.originalVertices.length;

    // 1. Obtener la matriz de vista de la cámara
    // Necesitamos el eje Z de la cámara en el espacio del objeto
    //const viewMatrix = camera.matrixWorldInverse;
    //const m = viewMatrix.elements;
    
    if (!this.indexArray) {
        this.indexArray = new Uint32Array(numVertices);
        for (let i = 0; i < numVertices; i++) this.indexArray[i] = i;
        this.depthData = new Float32Array(numVertices);
    }

    const mv = pointCloudMesh.modelViewMatrix.elements;
    
    // 2. Calcular profundidad relativa al plano de la cámara (Z-depth)
    // En Three.js, la cámara mira hacia -Z. Buscamos los valores más negativos.
    for (let i = 0; i < numVertices; i++) {
        const v = this.originalVertices[i].position;
        // Z_camera = mv2*x + mv6*y + mv10*z + mv14
        // En Three.js, los objetos están delante de la cámara en el eje -Z
        this.depthData[i] = mv[2] * v[0] + mv[6] * v[1] + mv[10] * v[2] + mv[14];
    }

    // 3. Ordenar índices: Pintar de atrás (Z más negativo) hacia adelante (Z más positivo)
    // Nota: Como Three.js usa NormalBlending, necesitamos Back-to-Front.
    this.indexArray.sort((a, b) => this.depthData[a] - this.depthData[b]);

    // 4. Actualizar SOLO el índice de la geometría
    if (!geometry.index) {
        geometry.setIndex(new THREE.BufferAttribute(this.indexArray, 1));
    } else {
        geometry.index.array.set(this.indexArray);
        geometry.index.needsUpdate = true;
    }
  }
}