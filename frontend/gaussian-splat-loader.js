// gaussian-splat-loader.js
// Custom PLY loader for Gaussian Splatting format

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
    // Standard position
    const processed = {
      position: [
        vertex.x || 0,
        (vertex.y || 0), 
        (vertex.z || 0)
      ]
    };
    
    // Gaussian splatting specific attributes 
    processed.scale = [
      vertex.scale_0 || vertex.scale_x || 0.01,
      vertex.scale_1 || vertex.scale_y || 0.01,
      vertex.scale_2 || vertex.scale_z || 0.01
    ];
    //scale = exp(scale)
    processed.scale = processed.scale.map(s => Math.exp(s));
    
    // Rotation (quaternion)
    processed.rotation = [
      vertex.rot_0 ,
      vertex.rot_1 ,
      vertex.rot_2 ,
      vertex.rot_3 
    ];
    
    // Opacity
    processed.opacity = 1.0 / (1.0 + Math.exp(-vertex.opacity));
    processed.opacity = Math.max(0, Math.min(1, processed.opacity || vertex.alpha || 0.8));
    
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
    
    // Create geometry
    const geometry = new THREE.BufferGeometry();
    
    // Position attribute
    const positions = new Float32Array(vertices.length * 3);
    const scales = new Float32Array(vertices.length * 3);
    const rotations = new Float32Array(vertices.length * 4);
    const opacities = new Float32Array(vertices.length);
    
    // Spherical harmonics coefficients (grouped into vec3 attributes)
    const sh_dc = new Float32Array(vertices.length * 3);          // DC coefficients
    const sh_rest_0_2 = new Float32Array(vertices.length * 3);    // f_rest_0, f_rest_1, f_rest_2
    const sh_rest_3_5 = new Float32Array(vertices.length * 3);    // f_rest_3, f_rest_4, f_rest_5
    const sh_rest_6_8 = new Float32Array(vertices.length * 3);    // f_rest_6, f_rest_7, f_rest_8
    const sh_rest_9_11 = new Float32Array(vertices.length * 3);   // f_rest_9, f_rest_10, f_rest_11
    const sh_rest_12_14 = new Float32Array(vertices.length * 3);  // f_rest_12, f_rest_13, f_rest_14
    const sh_rest_15_17 = new Float32Array(vertices.length * 3);  // f_rest_15, f_rest_16, f_rest_17
    const sh_rest_18_20 = new Float32Array(vertices.length * 3);  // f_rest_18, f_rest_19, f_rest_20
    const sh_rest_21_23 = new Float32Array(vertices.length * 3);  // f_rest_21, f_rest_22, f_rest_23
    const sh_rest_24_26 = new Float32Array(vertices.length * 3);  // f_rest_24, f_rest_25, f_rest_26
    
    
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
      
      // SH rest coefficients (grouped into vec3 attributes)
      sh_rest_0_2[i3] = vertex.sh_rest[0] || 0.0;
      sh_rest_0_2[i3 + 1] = vertex.sh_rest[1] || 0.0;
      sh_rest_0_2[i3 + 2] = vertex.sh_rest[2] || 0.0;
      
      sh_rest_3_5[i3] = vertex.sh_rest[3] || 0.0;
      sh_rest_3_5[i3 + 1] = vertex.sh_rest[4] || 0.0;
      sh_rest_3_5[i3 + 2] = vertex.sh_rest[5] || 0.0;
      
      sh_rest_6_8[i3] = vertex.sh_rest[6] || 0.0;
      sh_rest_6_8[i3 + 1] = vertex.sh_rest[7] || 0.0;
      sh_rest_6_8[i3 + 2] = vertex.sh_rest[8] || 0.0;
      
      sh_rest_9_11[i3] = vertex.sh_rest[9] || 0.0;
      sh_rest_9_11[i3 + 1] = vertex.sh_rest[10] || 0.0;
      sh_rest_9_11[i3 + 2] = vertex.sh_rest[11] || 0.0;
      
      sh_rest_12_14[i3] = vertex.sh_rest[12] || 0.0;
      sh_rest_12_14[i3 + 1] = vertex.sh_rest[13] || 0.0;
      sh_rest_12_14[i3 + 2] = vertex.sh_rest[14] || 0.0;

      sh_rest_15_17[i3] = vertex.sh_rest[15] || 0.0;
      sh_rest_15_17[i3 + 1] = vertex.sh_rest[16] || 0.0;
      sh_rest_15_17[i3 + 2] = vertex.sh_rest[17] || 0.0;

      sh_rest_18_20[i3] = vertex.sh_rest[18] || 0.0;
      sh_rest_18_20[i3 + 1] = vertex.sh_rest[19] || 0.0;
      sh_rest_18_20[i3 + 2] = vertex.sh_rest[20] || 0.0;

      sh_rest_21_23[i3] = vertex.sh_rest[21] || 0.0;
      sh_rest_21_23[i3 + 1] = vertex.sh_rest[22] || 0.0;
      sh_rest_21_23[i3 + 2] = vertex.sh_rest[23] || 0.0;

      sh_rest_24_26[i3] = vertex.sh_rest[24] || 0.0;
      sh_rest_24_26[i3 + 1] = vertex.sh_rest[25] || 0.0;
      sh_rest_24_26[i3 + 2] = vertex.sh_rest[26] || 0.0;
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
    geometry.setAttribute('sh_rest_0_2', new THREE.BufferAttribute(sh_rest_0_2, 3));
    geometry.setAttribute('sh_rest_3_5', new THREE.BufferAttribute(sh_rest_3_5, 3));
    geometry.setAttribute('sh_rest_6_8', new THREE.BufferAttribute(sh_rest_6_8, 3));
    geometry.setAttribute('sh_rest_9_11', new THREE.BufferAttribute(sh_rest_9_11, 3));
    geometry.setAttribute('sh_rest_12_14', new THREE.BufferAttribute(sh_rest_12_14, 3));
    geometry.setAttribute('sh_rest_15_17', new THREE.BufferAttribute(sh_rest_15_17, 3));
    geometry.setAttribute('sh_rest_18_20', new THREE.BufferAttribute(sh_rest_18_20, 3));
    geometry.setAttribute('sh_rest_21_23', new THREE.BufferAttribute(sh_rest_21_23, 3));
    geometry.setAttribute('sh_rest_24_26', new THREE.BufferAttribute(sh_rest_24_26, 3));
    // Create custom material for Gaussian splatting
    const material = this.createGaussianSplatMaterial();
    
    // Create points mesh
    const mesh = new THREE.Points(geometry, material);
    mesh.userData = {
      vertexCount: vertices.length,
      format: header.format,
      properties: header.properties,
      loader: this // Store reference to loader for material switching
    };
    
    return mesh;
  }
  
createGaussianSplatMaterial_ellipso(harmonicDegree = 2, pointScale = 1000, chiScale = 32.0, redCircleEnabled = false) {
  // Custom shader material for Gaussian splatting with spherical harmonics
  const vertexShader = `
    uniform int harmonicDegree;
    uniform float pointScale;
    
    attribute vec3 scale;
    attribute vec4 rotation;
    attribute float opacity;
    attribute vec3 sh_dc;

    // Pass SH rest coefficients as individual attributes (first 15 for degree 1 & 2)
    attribute vec3 sh_rest_0_2;   // f_rest_0, f_rest_1, f_rest_2
    attribute vec3 sh_rest_3_5;   // f_rest_3, f_rest_4, f_rest_5
    attribute vec3 sh_rest_6_8;   // f_rest_6, f_rest_7, f_rest_8
    attribute vec3 sh_rest_9_11;  // f_rest_9, f_rest_10, f_rest_11
    attribute vec3 sh_rest_12_14; // f_rest_12, f_rest_13, f_rest_14
    attribute vec3 sh_rest_15_17; // f_rest_15, f_rest_16, f_rest_17
    attribute vec3 sh_rest_18_20; // f_rest_18, f_rest_19, f_rest_20
    attribute vec3 sh_rest_21_23; // f_rest_21, f_rest_22, f_rest_23
    attribute vec3 sh_rest_24_26; // f_rest_24, f_rest_25, f_rest_26

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
        color.r += -0.48860251190291987 * dir.y * sh_rest_0_2.x;
        color.r += 0.48860251190291987 * dir.z * sh_rest_3_5.x;
        color.r += -0.48860251190291987 * dir.x * sh_rest_6_8.x;
        
        // Green: 1, 4, 7
        color.g += -0.48860251190291987 * dir.y * sh_rest_0_2.y;
        color.g += 0.48860251190291987 * dir.z * sh_rest_3_5.y;
        color.g += -0.48860251190291987 * dir.x * sh_rest_6_8.y;

        // Blue: 2, 5, 8
        color.b += -0.48860251190291987 * dir.y * sh_rest_0_2.z;
        color.b += 0.48860251190291987 * dir.z * sh_rest_3_5.z;
        color.b += -0.48860251190291987 * dir.x * sh_rest_6_8.z;
        
        if (degree < 2) return clamp(color, 0.0, 1.0);
        
        // Degree 2 (5 coefficients per channel = 15 total)
        float xx = dir.x * dir.x;
        float yy = dir.y * dir.y;
        float zz = dir.z * dir.z;
        float xy = dir.x * dir.y;
        float yz = dir.y * dir.z;
        float xz = dir.x * dir.z;
        
        // Red: 9, 12, 15, 18, 21
        color.r += 1.0925484305920792 * xy * sh_rest_9_11.x;
        color.r += -1.0925484305920792 * yz * sh_rest_12_14.x;
        color.r += 0.94617469575755997 * (2.0 * zz - xx - yy) * sh_rest_15_17.x;
        color.r += -1.0925484305920792 * xz * sh_rest_18_20.x;
        color.r += 0.54627421529603959 * (xx - yy) * sh_rest_21_23.x;

        // Green: 10, 13, 16, 19, 22
        color.g += 1.0925484305920792 * xy * sh_rest_9_11.y;
        color.g += -1.0925484305920792 * yz * sh_rest_12_14.y;
        color.g += 0.94617469575755997 * (2.0 * zz - xx - yy) * sh_rest_15_17.y;
        color.g += -1.0925484305920792 * xz * sh_rest_18_20.y;
        color.g += 0.54627421529603959 * (xx - yy) * sh_rest_21_23.y;

        // Blue: 11, 14, 17, 20, 23
        color.b += 1.0925484305920792 * xy * sh_rest_9_11.z;
        color.b += -1.0925484305920792 * yz * sh_rest_12_14.z;
        color.b += 0.94617469575755997 * (2.0 * zz - xx - yy) * sh_rest_15_17.z;
        color.b += -1.0925484305920792 * xz * sh_rest_18_20.z;
        color.b += 0.54627421529603959 * (xx - yy) * sh_rest_21_23.z;
        
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
        float z_view = p_view.z; // La distancia al plano near es -z_view (asumiendo View Space estándar)


        // 2. Calcular la Matriz de Covarianza 3D (Sigma)
        mat3 Sigma = get_covariance_3D(scale, rotation);

        // 3. Obtener la Covarianza en el Espacio de la Cámara (View Space)
        // Solo se usa la submatriz 3x3 (rotación y escala) de modelViewMatrix.
        // Esto es correcto si la 4ta columna/fila de Sigma4D es solo para padding/compatibilidad.
        mat3 R_view = mat3(modelViewMatrix); // R_view es la parte 3x3 de rot/escala/shear de ModelView
        mat3 Sigma_view = R_view * Sigma * transpose(R_view);

        // 4. Calcular el Jacobiano de la Proyección Perspectiva 3D -> 2D
        // La función de proyección es f(x, y, z) = (x/z, y/z) para el espacio de la cámara.
        // La matriz del Jacobiano J (2x3) en p_view = (x, y, z) es:
        // J = [ dfx/dx dfx/dy dfx/dz ]
        //     [ dfy/dx dfy/dy dfy/dz ]
        // Con fx = x/z y fy = y/z, el Jacobiano es:
        // J = [ 1/z  0   -x/z^2 ]
        //     [ 0   1/z  -y/z^2 ]

        float z_inv = 1.0 / p_view.z;
        float z_inv_sq = z_inv * z_inv;
        float x = p_view.x;
        float y = p_view.y;

        mat3x2 J = mat3x2(
            z_inv, 0.0,        // First column: [1/z, 0]
            0.0, z_inv,        // Second column: [0, 1/z]  
            -x * z_inv_sq, -y * z_inv_sq  // Third column: [-x/z^2, -y/z^2]
        );

        // 5. Proyectar la covarianza 3D a 2D usando el Jacobiano
        // vCovariance2D = J * Sigma_view * J^T
        vCovariance2D = J * Sigma_view * transpose(J);

        
    
        // 6. Determinar el tamaño del quad 2D
        // El tamaño del quad debe ser proporcional al tamaño de la elipse 2D (ej. 3 sigma)
        // El radio máximo al cuadrado de la elipse 2D es el autovalor más grande de Sigma'.
        
        // Usamos el trazo (suma de diagonales) para estimar el tamaño del BB
        // Mejor aún, se calcula directamente el radio máximo:
        float det_cov_2d = vCovariance2D[0][0] * vCovariance2D[1][1] - vCovariance2D[0][1] * vCovariance2D[1][0];
        float trace_cov_2d = vCovariance2D[0][0] + vCovariance2D[1][1];
        float discriminant = trace_cov_2d * trace_cov_2d - 4.0 * det_cov_2d;
        float max_eigenvalue = (trace_cov_2d + sqrt(max(0.0, discriminant))) / 2.0;
        // Usar 3 veces la desviación estándar (sqrt(autovalor)) para el tamaño del quad
        float radius = 3.0 * sqrt(max(0.0001, max_eigenvalue)); // Ensure positive value
      
        // Calculate camera direction for spherical harmonics
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        // Calculate camera direction for spherical harmonics
        vec3 cameraPos = cameraPosition;
        vCameraDir = normalize(cameraPos - vWorldPos);
        // Evaluate spherical harmonics for view-dependent color
        vColor = evaluateSphericalHarmonics(vCameraDir, sh_dc, harmonicDegree);
        
        gl_PointSize = 10.0 * pointScale;
        gl_PointSize = clamp(gl_PointSize, 4.0, 200000.0);
    }
  `;
  
  const fragmentShader = `
    uniform float chiScale;
    uniform bool redCircleEnabled;
    
    varying vec3 vColor;
    varying float vOpacity;
    varying mat2 vCovariance2D; // Matriz de Covarianza 2D (Sigma')
    
    
    void main() {
        // Get normalized coordinates from center of point
        vec2 d = gl_PointCoord - 0.5;
        
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
          chi2 = chi2 * chiScale;
          
          // Per-pixel alpha
          float alpha_total = exp(-chi2 * 0.5) * vOpacity;
          
          // Debug: draw colored circle for specific chi2 range
          if (chi2 > 0.1 && chi2 < 0.2 && redCircleEnabled) {
            gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
          } else {
            // Early discard for efficiency
            if (alpha_total < 0.01) {
                discard;
            }
            gl_FragColor = vec4(vColor, alpha_total);
          }
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
      cameraPosition: { value: new THREE.Vector3() },
      harmonicDegree: { value: harmonicDegree },
      pointScale: { value: pointScale },
      chiScale: { value: chiScale },
      redCircleEnabled: { value: redCircleEnabled }
    }
  });
}

  createGaussianSplatMaterial(harmonicDegree = 2, pointScale = 1000) {
    // Custom shader material for Gaussian splatting with spherical harmonics
    const vertexShader = `
      uniform int harmonicDegree;
      uniform float pointScale;
      
      attribute vec3 scale;
      attribute vec4 rotation;
      attribute float opacity;
      attribute vec3 sh_dc;
      
      // Pass SH rest coefficients as individual attributes (first 15 for degree 1 & 2)
      attribute vec3 sh_rest_0_2;   // f_rest_0, f_rest_1, f_rest_2
      attribute vec3 sh_rest_3_5;   // f_rest_3, f_rest_4, f_rest_5
      attribute vec3 sh_rest_6_8;   // f_rest_6, f_rest_7, f_rest_8
      attribute vec3 sh_rest_9_11;  // f_rest_9, f_rest_10, f_rest_11
      attribute vec3 sh_rest_12_14; // f_rest_12, f_rest_13, f_rest_14
      attribute vec3 sh_rest_15_17; // f_rest_15, f_rest_16, f_rest_17
      attribute vec3 sh_rest_18_20; // f_rest_18, f_rest_19, f_rest_20
      attribute vec3 sh_rest_21_23; // f_rest_21, f_rest_22, f_rest_23
      attribute vec3 sh_rest_24_26; // f_rest_24, f_rest_25, f_rest_26
      
      varying vec3 vColor;
      varying float vOpacity;
      varying vec3 vWorldPos;
      varying vec3 vCameraDir;
      varying vec3 vScale;
      varying vec4 vRotation;
      
      vec3 rotateByQuaternion(vec3 v, vec4 q) {
        vec3 qvec = q.xyz;
        vec3 uv = cross(qvec, v);
        vec3 uuv = cross(qvec, uv);
        uv *= (2.0 * q.w);
        uuv *= 2.0;
        return v + uv + uuv;
      }
      
      // Spherical harmonics evaluation (conditional based on degree)
      vec3 evaluateSphericalHarmonics(vec3 dir, vec3 sh_dc, int degree) {
        // Start with DC component (degree 0)
        vec3 color = 0.5 + 0.28209479177387814 * sh_dc;
        
        if (degree < 1) return clamp(color, 0.0, 1.0);
        
        // Degree 1 (3 coefficients per color channel = 9 total)
        // Red: 0, 3, 6
        color.r += -0.48860251190291987 * dir.y * sh_rest_0_2.x;
        color.r += 0.48860251190291987 * dir.z * sh_rest_3_5.x;
        color.r += -0.48860251190291987 * dir.x * sh_rest_6_8.x;
        
        // Green: 1, 4, 7
        color.g += -0.48860251190291987 * dir.y * sh_rest_0_2.y;
        color.g += 0.48860251190291987 * dir.z * sh_rest_3_5.y;
        color.g += -0.48860251190291987 * dir.x * sh_rest_6_8.y;

        // Blue: 2, 5, 8
        color.b += -0.48860251190291987 * dir.y * sh_rest_0_2.z;
        color.b += 0.48860251190291987 * dir.z * sh_rest_3_5.z;
        color.b += -0.48860251190291987 * dir.x * sh_rest_6_8.z;
        
        if (degree < 2) return clamp(color, 0.0, 1.0);
        
        // Degree 2 (5 coefficients per channel = 15 total)
        float xx = dir.x * dir.x;
        float yy = dir.y * dir.y;
        float zz = dir.z * dir.z;
        float xy = dir.x * dir.y;
        float yz = dir.y * dir.z;
        float xz = dir.x * dir.z;
        
        // Red: 9, 12, 15, 18, 21
        color.r += 1.0925484305920792 * xy * sh_rest_9_11.x;
        color.r += -1.0925484305920792 * yz * sh_rest_12_14.x;
        color.r += 0.94617469575755997 * (2.0 * zz - xx - yy) * sh_rest_15_17.x;
        color.r += -1.0925484305920792 * xz * sh_rest_18_20.x;
        color.r += 0.54627421529603959 * (xx - yy) * sh_rest_21_23.x;

        // Green: 10, 13, 16, 19, 22
        color.g += 1.0925484305920792 * xy * sh_rest_9_11.y;
        color.g += -1.0925484305920792 * yz * sh_rest_12_14.y;
        color.g += 0.94617469575755997 * (2.0 * zz - xx - yy) * sh_rest_15_17.y;
        color.g += -1.0925484305920792 * xz * sh_rest_18_20.y;
        color.g += 0.54627421529603959 * (xx - yy) * sh_rest_21_23.y;

        // Blue: 11, 14, 17, 20, 23
        color.b += 1.0925484305920792 * xy * sh_rest_9_11.z;
        color.b += -1.0925484305920792 * yz * sh_rest_12_14.z;
        color.b += 0.94617469575755997 * (2.0 * zz - xx - yy) * sh_rest_15_17.z;
        color.b += -1.0925484305920792 * xz * sh_rest_18_20.z;
        color.b += 0.54627421529603959 * (xx - yy) * sh_rest_21_23.z;
        
        // Clamp color to [0,1] range to avoid overly bright colors
        //color = clamp(color, 0.0, 1.0);
        return color;
      }
      
      void main() {
        vOpacity = opacity;
        vScale = scale;
        vRotation = rotation;
            
        // Calculate camera direction for spherical harmonics
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;        
        // Calculate camera direction for spherical harmonics
        vec3 cameraPos = cameraPosition;
        vCameraDir = normalize(cameraPos - vWorldPos);
        // Evaluate spherical harmonics for view-dependent color
        vColor = evaluateSphericalHarmonics(vCameraDir, sh_dc, harmonicDegree);

        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
                
        float maxScale = max(max(scale.x, scale.y), scale.z);
        float distance = length(mvPosition.xyz);
        gl_PointSize = maxScale * pointScale / distance;
        gl_PointSize = clamp(gl_PointSize, 4.0, 200000000.0);

      }
    `;
    
    const fragmentShader = `
      varying vec3 vColor;
      varying float vOpacity;
      varying vec3 vWorldPos;
      varying vec3 vCameraDir;
      varying vec3 vScale;
      varying vec4 vRotation;
      
      // Rotate a 2D vector by a quaternion's Z rotation component
      vec2 rotatePoint2D(vec2 point, vec4 quat) {
        // Extract rotation angle from quaternion (simplified for 2D rotation)
        // For a proper 2D rotation, we need to project the quaternion rotation to screen space
        float angle = 2.0 * atan(quat.z, quat.w);
        float cosA = cos(angle);
        float sinA = sin(angle);
        
        return vec2(
          point.x * cosA - point.y * sinA,
          point.x * sinA + point.y * cosA
        );
      }
      
      void main() {
        // Transform point coordinates to create ellipse based on scale
        vec2 center = gl_PointCoord - 0.5;
        
        // Apply rotation to the point coordinates
        vec2 rotatedCenter = rotatePoint2D(center, vRotation);
        
        // Create elliptical shape using scale ratios
        float scaleX = vScale.x;
        float scaleY = vScale.y;
        float avgScale = (scaleX + scaleY) * 0.5;
        
        // Normalize scales to prevent division by zero
        scaleX = max(scaleX, 0.001);
        scaleY = max(scaleY, 0.001);
        
        // Transform coordinates for ellipse
        vec2 ellipseCoord = rotatedCenter;
        ellipseCoord.x *= avgScale / scaleX;
        ellipseCoord.y *= avgScale / scaleY;
        
        float dist = length(ellipseCoord);
        
        if (dist > 2.0) discard;
        
        // Gaussian falloff
        float alpha = exp(-dist * dist * 8.0) * vOpacity;
        
        gl_FragColor = vec4(vColor, alpha);
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
        cameraPosition: { value: new THREE.Vector3() },
        harmonicDegree: { value: harmonicDegree },
        pointScale: { value: pointScale }
      }
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
}