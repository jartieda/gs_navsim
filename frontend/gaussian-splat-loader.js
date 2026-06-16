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
    // Find the exact byte offset of the end of the header by searching the raw
    // bytes for "end_header" followed by a newline.  This correctly handles
    // both LF and CRLF line endings and avoids any re-encoding mismatch.
    const MARKER = 'end_header';
    const raw = new Uint8Array(buffer);
    let headerLength = -1;
    for (let i = 0; i <= raw.length - MARKER.length; i++) {
      let match = true;
      for (let j = 0; j < MARKER.length; j++) {
        if (raw[i + j] !== MARKER.charCodeAt(j)) { match = false; break; }
      }
      if (match) {
        // Skip past the marker and the following newline (LF or CRLF)
        let end = i + MARKER.length;
        if (raw[end] === 0x0D) end++; // CR
        if (raw[end] === 0x0A) end++; // LF
        headerLength = end;
        break;
      }
    }

    const text = new TextDecoder().decode(buffer.slice(0, headerLength > 0 ? headerLength : 4096));
    const lines = text.split('\n');

    const header = {
      format: 'ascii',
      vertexCount: 0,
      properties: [],
      headerLength: headerLength > 0 ? headerLength : 0
    };

    let inHeader = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line === 'ply') {
        inHeader = true;
        continue;
      }

      if (line === 'end_header') {
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
    // inverted
    const processed = {
      position: [
         vertex.x || 0,
        (vertex.y || 0), 
        (vertex.z || 0)
      ]
    };
    
    // inverted scale 
    // Aplicamos exp() porque en el PLY están en espacio logarítmico
    processed.scale = [
        Math.exp(vertex.scale_0 ?? -5),
        Math.exp(vertex.scale_1 ?? -5),
        Math.exp(vertex.scale_2 ?? -5)
    ];

    // Rotation (quaternion)
    processed.rotation = [
      vertex.rot_1 || 0, // x
      vertex.rot_2 || 0, // y 
      vertex.rot_3 || 0, // z
      vertex.rot_0 || 1  // w
    ];
    // quaterinon regularization
    const norm = Math.sqrt(
      processed.rotation[0] * processed.rotation[0] +
      processed.rotation[1] * processed.rotation[1] +
      processed.rotation[2] * processed.rotation[2] +
      processed.rotation[3] * processed.rotation[3]
    );
    processed.rotation[0] /= norm;
    processed.rotation[1] /= norm;
    processed.rotation[2] /= norm;
    processed.rotation[3] /= norm;

    // Opacity
    // 1. Obtener el valor crudo (raw) del objeto verte x
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
    
    // Texture coordinates for SH data lookup
    const texCoords = new Float32Array(vertices.length * 2);
    
    // Calculate texture dimensions (power of 2 for better performance)
    // Ensure texture can fit all vertices
    const minTextureSize = Math.ceil(Math.sqrt(vertices.length));
    const textureSize = Math.pow(2, Math.ceil(Math.log2(minTextureSize)));
    const totalTexels = textureSize * textureSize;
    
    console.log(`Texture sizing calculation:`);
    console.log(`- Vertices: ${vertices.length}`);
    console.log(`- Min texture size needed: ${minTextureSize}`);
    console.log(`- Actual texture size: ${textureSize}x${textureSize}`);
    console.log(`- Total texels: ${totalTexels}`);
    console.log(`- Vertices fit: ${vertices.length <= totalTexels ? 'YES' : 'NO'}`);
    
    if (vertices.length > totalTexels) {
      throw new Error(`Not enough texels: need ${vertices.length}, have ${totalTexels}`);
    }
    
    // SH DC texture data (RGB format) - initialize all pixels to zero
    const shDcTextureData = new Float32Array(totalTexels * 4);
    shDcTextureData.fill(0.0); // Explicitly zero-initialize
    
    // SH rest texture data (RGB format, we'll use multiple textures for up to 48 coefficients)
    const shRestTextureData1 = new Float32Array(totalTexels * 4); // coefficients 0-2
    const shRestTextureData2 = new Float32Array(totalTexels * 4); // coefficients 3-5
    const shRestTextureData3 = new Float32Array(totalTexels * 4); // coefficients 6-8
    const shRestTextureData4 = new Float32Array(totalTexels * 4); // coefficients 9-11 (degree 2)
    const shRestTextureData5 = new Float32Array(totalTexels * 4); // coefficients 12-14
    const shRestTextureData6 = new Float32Array(totalTexels * 4); // coefficients 15-17
    const shRestTextureData7 = new Float32Array(totalTexels * 4); // coefficients 18-20
    const shRestTextureData8 = new Float32Array(totalTexels * 4); // coefficients 21-23
    const shRestTextureData9 = new Float32Array(totalTexels * 4); // coefficients 24-26 (degree 3)
    const shRestTextureData10 = new Float32Array(totalTexels * 4); // coefficients 27-29
    const shRestTextureData11 = new Float32Array(totalTexels * 4); // coefficients 30-32
    const shRestTextureData12 = new Float32Array(totalTexels * 4); // coefficients 33-35
    const shRestTextureData13 = new Float32Array(totalTexels * 4); // coefficients 36-38
    const shRestTextureData14 = new Float32Array(totalTexels * 4); // coefficients 39-41
    const shRestTextureData15 = new Float32Array(totalTexels * 4); // coefficients 42-44
    
    // Explicitly zero-initialize all texture data
    shRestTextureData1.fill(0.0);
    shRestTextureData2.fill(0.0);
    shRestTextureData3.fill(0.0);
    shRestTextureData4.fill(0.0);
    shRestTextureData5.fill(0.0);
    shRestTextureData6.fill(0.0);
    shRestTextureData7.fill(0.0);
    shRestTextureData8.fill(0.0);
    shRestTextureData9.fill(0.0);
    shRestTextureData10.fill(0.0);
    shRestTextureData11.fill(0.0);
    shRestTextureData12.fill(0.0);
    shRestTextureData13.fill(0.0);
    shRestTextureData14.fill(0.0);
    shRestTextureData15.fill(0.0);
    
    console.log(`Texture data arrays created:`);
    console.log(`- DC: ${shDcTextureData.length} floats (${shDcTextureData.length * 4} bytes)`);
    console.log(`- Rest1: ${shRestTextureData1.length} floats (${shRestTextureData1.length * 4} bytes)`);
    console.log(`- Rest2: ${shRestTextureData2.length} floats (${shRestTextureData2.length * 4} bytes)`);
    console.log(`- Rest3: ${shRestTextureData3.length} floats (${shRestTextureData3.length * 4} bytes)`);
    
    
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
      
      // Calculate texture coordinates for this vertex
      const texX = i % textureSize;
      const texY = Math.floor(i / textureSize);
      const texIndex = texY * textureSize + texX;
      
      // Comprehensive bounds checking
      if (texX >= textureSize || texY >= textureSize) {
        console.error(`Texture coordinates out of bounds: (${texX}, ${texY}) >= ${textureSize}`);
        throw new Error('Texture coordinates out of bounds');
      }
      
      if (texIndex >= totalTexels) {
        console.error(`Texture index out of bounds: ${texIndex} >= ${totalTexels}`);
        throw new Error('Texture index out of bounds');
      }
      
      // Calculate array indices
      const dcBaseIdx = texIndex * 4;
      const restBaseIdx = texIndex * 4;
      
      // Check array bounds
      if (dcBaseIdx + 2 >= shDcTextureData.length) {
        console.error(`DC array index out of bounds: ${dcBaseIdx + 2} >= ${shDcTextureData.length}`);
        throw new Error('DC array index out of bounds');
      }
      
      if (restBaseIdx + 2 >= shRestTextureData1.length) {
        console.error(`Rest array index out of bounds: ${restBaseIdx + 2} >= ${shRestTextureData1.length}`);
        throw new Error('Rest array index out of bounds');
      }
      
      // Store texture coordinates for vertex shader
      texCoords[i * 2] = (texX + 0.5) / textureSize;     // u coordinate
      texCoords[i * 2 + 1] = (texY + 0.5) / textureSize;  // v coordinate
      
      // Store SH DC coefficients in RGB texture
      shDcTextureData[dcBaseIdx] = vertex.sh_dc[0];
      shDcTextureData[dcBaseIdx + 1] = vertex.sh_dc[1];
      shDcTextureData[dcBaseIdx + 2] = vertex.sh_dc[2];
      
      // Store SH rest coefficients in RGB textures (3 coefficients per texture)
      // Texture 1: coefficients 0-2 (RGB)
      shRestTextureData1[restBaseIdx] = vertex.sh_rest[0] || 0.0;
      shRestTextureData1[restBaseIdx + 1] = vertex.sh_rest[15] || 0.0;
      shRestTextureData1[restBaseIdx + 2] = vertex.sh_rest[30] || 0.0;
      shRestTextureData1[restBaseIdx + 3] = 0.0; // Padding
      
      // Texture 2: coefficients 3-5 (RGB)
      shRestTextureData2[restBaseIdx] = vertex.sh_rest[1] || 0.0;
      shRestTextureData2[restBaseIdx + 1] = vertex.sh_rest[16] || 0.0;
      shRestTextureData2[restBaseIdx + 2] = vertex.sh_rest[31] || 0.0;
      shRestTextureData2[restBaseIdx + 3] = 0.0; // Padding
      
      // Texture 3: coefficients 6-8 (RGB)
      shRestTextureData3[restBaseIdx] = vertex.sh_rest[2] || 0.0;
      shRestTextureData3[restBaseIdx + 1] = vertex.sh_rest[17] || 0.0;
      shRestTextureData3[restBaseIdx + 2] = vertex.sh_rest[32] || 0.0;
      shRestTextureData3[restBaseIdx + 3] = 0.0; // Padding

      // Texture 4: coefficients 9-11 (degree 2, RGB)
      shRestTextureData4[restBaseIdx] = vertex.sh_rest[3] || 0.0;
      shRestTextureData4[restBaseIdx + 1] = vertex.sh_rest[18] || 0.0;
      shRestTextureData4[restBaseIdx + 2] = vertex.sh_rest[33] || 0.0;
      shRestTextureData4[restBaseIdx + 3] = 0.0; // Padding

      // Texture 5: coefficients 12-14 (degree 2, RGB)
      shRestTextureData5[restBaseIdx] = vertex.sh_rest[4] || 0.0;
      shRestTextureData5[restBaseIdx + 1] = vertex.sh_rest[19] || 0.0;
      shRestTextureData5[restBaseIdx + 2] = vertex.sh_rest[34] || 0.0;
      shRestTextureData5[restBaseIdx + 3] = 0.0; // Padding

      // Texture 6: coefficients 15-17 (degree 2, RGB)
      shRestTextureData6[restBaseIdx] = vertex.sh_rest[5] || 0.0;
      shRestTextureData6[restBaseIdx + 1] = vertex.sh_rest[20] || 0.0;
      shRestTextureData6[restBaseIdx + 2] = vertex.sh_rest[35] || 0.0;
      shRestTextureData6[restBaseIdx + 3] = 0.0; // Padding

      // Texture 7: coefficients 18-20 (degree 2, RGB)
      shRestTextureData7[restBaseIdx] = vertex.sh_rest[6] || 0.0;
      shRestTextureData7[restBaseIdx + 1] = vertex.sh_rest[21] || 0.0;
      shRestTextureData7[restBaseIdx + 2] = vertex.sh_rest[36] || 0.0;
      shRestTextureData7[restBaseIdx + 3] = 0.0; // Padding

      // Texture 8: coefficients 21-23 (degree 2, RGB)
      shRestTextureData8[restBaseIdx] = vertex.sh_rest[7] || 0.0;
      shRestTextureData8[restBaseIdx + 1] = vertex.sh_rest[22] || 0.0;
      shRestTextureData8[restBaseIdx + 2] = vertex.sh_rest[37] || 0.0;
      shRestTextureData8[restBaseIdx + 3] = 0.0; // Padding

      // Texture 9: coefficients 24-26 (degree 3, RGB)
      shRestTextureData9[restBaseIdx] = vertex.sh_rest[8] || 0.0;
      shRestTextureData9[restBaseIdx + 1] = vertex.sh_rest[23] || 0.0;
      shRestTextureData9[restBaseIdx + 2] = vertex.sh_rest[38] || 0.0;
      shRestTextureData9[restBaseIdx + 3] = 0.0; // Padding

      // Texture 10: coefficients 27-29 (degree 3, RGB)
      shRestTextureData10[restBaseIdx] = vertex.sh_rest[9] || 0.0;
      shRestTextureData10[restBaseIdx + 1] = vertex.sh_rest[24] || 0.0;
      shRestTextureData10[restBaseIdx + 2] = vertex.sh_rest[39] || 0.0;
      shRestTextureData10[restBaseIdx + 3] = 0.0; // Padding

      // Texture 11: coefficients 30-32 (degree 3, RGB)
      shRestTextureData11[restBaseIdx] = vertex.sh_rest[10] || 0.0;
      shRestTextureData11[restBaseIdx + 1] = vertex.sh_rest[25] || 0.0;
      shRestTextureData11[restBaseIdx + 2] = vertex.sh_rest[40] || 0.0;
      shRestTextureData11[restBaseIdx + 3] = 0.0; // Padding

      // Texture 12: coefficients 33-35 (degree 3, RGB)
      shRestTextureData12[restBaseIdx] = vertex.sh_rest[11] || 0.0;
      shRestTextureData12[restBaseIdx + 1] = vertex.sh_rest[26] || 0.0;
      shRestTextureData12[restBaseIdx + 2] = vertex.sh_rest[41] || 0.0;
      shRestTextureData12[restBaseIdx + 3] = 0.0; // Padding

      // Texture 13: coefficients 36-38 (degree 3, RGB)
      shRestTextureData13[restBaseIdx] = vertex.sh_rest[12] || 0.0;
      shRestTextureData13[restBaseIdx + 1] = vertex.sh_rest[27] || 0.0;
      shRestTextureData13[restBaseIdx + 2] = vertex.sh_rest[42] || 0.0;
      shRestTextureData13[restBaseIdx + 3] = 0.0; // Padding

      // Texture 14: coefficients 39-41 (degree 3, RGB)
      shRestTextureData14[restBaseIdx] = vertex.sh_rest[13] || 0.0;
      shRestTextureData14[restBaseIdx + 1] = vertex.sh_rest[28] || 0.0;
      shRestTextureData14[restBaseIdx + 2] = vertex.sh_rest[43] || 0.0;
      shRestTextureData14[restBaseIdx + 3] = 0.0; // Padding

      // Texture 15: coefficients 42-44 (degree 3, RGB)
      shRestTextureData15[restBaseIdx] = vertex.sh_rest[14] || 0.0;
      shRestTextureData15[restBaseIdx + 1] = vertex.sh_rest[29] || 0.0;
      shRestTextureData15[restBaseIdx + 2] = vertex.sh_rest[44] || 0.0;
      shRestTextureData15[restBaseIdx + 3] = 0.0; // Padding
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
    // Set texture coordinates attribute
    geometry.setAttribute('shTexCoord', new THREE.BufferAttribute(texCoords, 2));
    
    // Validate texture data sizes before creating textures
    const expectedDcSize = totalTexels * 4;
    const expectedRestSize = totalTexels * 4; // RGBA format
    
    console.log(`Texture validation:`);
    console.log(`- Texture size: ${textureSize}x${textureSize} = ${totalTexels} texels`);
    console.log(`- Vertices: ${vertices.length}`);
    console.log(`- DC array: ${shDcTextureData.length} (expected: ${expectedDcSize})`);
    console.log(`- Rest1 array: ${shRestTextureData1.length} (expected: ${expectedRestSize})`);
    console.log(`- Rest2 array: ${shRestTextureData2.length} (expected: ${expectedRestSize})`);
    console.log(`- Rest3 array: ${shRestTextureData3.length} (expected: ${expectedRestSize})`);
    console.log(`- Rest4-15 arrays: ${shRestTextureData4.length} each (expected: ${expectedRestSize})`);
    
    // Ensure arrays are exactly the right size
    if (shDcTextureData.length !== expectedDcSize) {
      console.error(`DC texture data size mismatch: ${shDcTextureData.length} !== ${expectedDcSize}`);
      throw new Error('DC texture data size mismatch');
    }
    
    if (shRestTextureData1.length !== expectedRestSize || 
        shRestTextureData2.length !== expectedRestSize || 
        shRestTextureData3.length !== expectedRestSize ||
        shRestTextureData4.length !== expectedRestSize ||
        shRestTextureData5.length !== expectedRestSize ||
        shRestTextureData6.length !== expectedRestSize ||
        shRestTextureData7.length !== expectedRestSize ||
        shRestTextureData8.length !== expectedRestSize ||
        shRestTextureData9.length !== expectedRestSize ||
        shRestTextureData10.length !== expectedRestSize ||
        shRestTextureData11.length !== expectedRestSize ||
        shRestTextureData12.length !== expectedRestSize ||
        shRestTextureData13.length !== expectedRestSize ||
        shRestTextureData14.length !== expectedRestSize ||
        shRestTextureData15.length !== expectedRestSize) {
      console.error(`Rest texture data size mismatch`);
      throw new Error('Rest texture data size mismatch');
    }
    
    // Create SH textures with comprehensive validation
    let shDcTexture, shRestTexture1, shRestTexture2, shRestTexture3, shRestTexture4, shRestTexture5, shRestTexture6, shRestTexture7, shRestTexture8, shRestTexture9, shRestTexture10, shRestTexture11, shRestTexture12, shRestTexture13, shRestTexture14, shRestTexture15;
    
    try {
      // Check WebGL float texture support
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      
      if (!gl) {
        throw new Error('WebGL not supported');
      }
      
      const floatExtension = gl.getExtension('OES_texture_float') || gl.getExtension('EXT_color_buffer_float');
      console.log('Float texture support:', !!floatExtension);
      
      // Create textures with extra validation
      console.log('Creating DC texture with dimensions:', textureSize, 'x', textureSize, 'format: RGB, type: Float');
      
      // DC texture (RGB) - create with explicit image object
      const dcCanvas = document.createElement('canvas');
      dcCanvas.width = textureSize;
      dcCanvas.height = textureSize;
      
      shDcTexture = new THREE.DataTexture(shDcTextureData, textureSize, textureSize, THREE.RGBFormat, THREE.FloatType);
      shDcTexture.needsUpdate = true;
      shDcTexture.minFilter = THREE.NearestFilter;
      shDcTexture.magFilter = THREE.NearestFilter;
      shDcTexture.wrapS = THREE.ClampToEdgeWrapping;
      shDcTexture.wrapT = THREE.ClampToEdgeWrapping;
      shDcTexture.flipY = false;
      shDcTexture.generateMipmaps = false;
      shDcTexture.unpackAlignment = 1; // Prevent alignment issues
      
      // Force immediate texture binding to prevent later issues
      shDcTexture.version = 1;
      shDcTexture.isDataTexture = true;
      
      // Validate texture properties
      console.log('DC texture properties:');
      console.log('- Width:', shDcTexture.image.width);
      console.log('- Height:', shDcTexture.image.height);
      console.log('- Data length:', shDcTexture.image.data.length);
      console.log('- Expected data length:', textureSize * textureSize * 3);
      
      // Force immediate upload to prevent repeated uploads
      shDcTexture.needsUpdate = true;
      console.log('DC texture created successfully - Size:', textureSize, 'x', textureSize, 'Data length:', shDcTextureData.length);
      
      // Rest texture 1 (RGB)
      shRestTexture1 = new THREE.DataTexture(shRestTextureData1, textureSize, textureSize, THREE.RGBAFormat, THREE.FloatType);
      shRestTexture1.needsUpdate = true;
      shRestTexture1.minFilter = THREE.NearestFilter;
      shRestTexture1.magFilter = THREE.NearestFilter;
      shRestTexture1.wrapS = THREE.ClampToEdgeWrapping;
      shRestTexture1.wrapT = THREE.ClampToEdgeWrapping;
      shRestTexture1.flipY = false;
      shRestTexture1.generateMipmaps = false;
      shRestTexture1.unpackAlignment = 1;
      shRestTexture1.version = 1;
      shRestTexture1.isDataTexture = true;
      console.log('Rest texture 1 created successfully - Data length:', shRestTextureData1.length);
      
      // Rest texture 2 (RGB)
      shRestTexture2 = new THREE.DataTexture(shRestTextureData2, textureSize, textureSize, THREE.RGBAFormat, THREE.FloatType);
      shRestTexture2.needsUpdate = true;
      shRestTexture2.minFilter = THREE.NearestFilter;
      shRestTexture2.magFilter = THREE.NearestFilter;
      shRestTexture2.wrapS = THREE.ClampToEdgeWrapping;
      shRestTexture2.wrapT = THREE.ClampToEdgeWrapping;
      shRestTexture2.flipY = false;
      shRestTexture2.generateMipmaps = false;
      shRestTexture2.unpackAlignment = 1;
      shRestTexture2.version = 1;
      shRestTexture2.isDataTexture = true;
      console.log('Rest texture 2 created successfully - Data length:', shRestTextureData2.length);
      
      // Rest texture 3 (RGB)
      shRestTexture3 = new THREE.DataTexture(shRestTextureData3, textureSize, textureSize, THREE.RGBAFormat, THREE.FloatType);
      shRestTexture3.needsUpdate = true;
      shRestTexture3.minFilter = THREE.NearestFilter;
      shRestTexture3.magFilter = THREE.NearestFilter;
      shRestTexture3.wrapS = THREE.ClampToEdgeWrapping;
      shRestTexture3.wrapT = THREE.ClampToEdgeWrapping;
      shRestTexture3.flipY = false;
      shRestTexture3.generateMipmaps = false;
      shRestTexture3.unpackAlignment = 1;
      shRestTexture3.version = 1;
      shRestTexture3.isDataTexture = true;
      console.log('Rest texture 3 created successfully - Data length:', shRestTextureData3.length);
      
      // Rest texture 4 (degree 2)
      shRestTexture4 = new THREE.DataTexture(shRestTextureData4, textureSize, textureSize, THREE.RGBAFormat, THREE.FloatType);
      shRestTexture4.needsUpdate = true;
      shRestTexture4.minFilter = THREE.NearestFilter;
      shRestTexture4.magFilter = THREE.NearestFilter;
      shRestTexture4.wrapS = THREE.ClampToEdgeWrapping;
      shRestTexture4.wrapT = THREE.ClampToEdgeWrapping;
      shRestTexture4.flipY = false;
      shRestTexture4.generateMipmaps = false;
      shRestTexture4.unpackAlignment = 1;
      shRestTexture4.version = 1;
      shRestTexture4.isDataTexture = true;
      console.log('Rest texture 4 created successfully - Data length:', shRestTextureData4.length);
      
      // Rest texture 5 (degree 2)
      shRestTexture5 = new THREE.DataTexture(shRestTextureData5, textureSize, textureSize, THREE.RGBAFormat, THREE.FloatType);
      shRestTexture5.needsUpdate = true;
      shRestTexture5.minFilter = THREE.NearestFilter;
      shRestTexture5.magFilter = THREE.NearestFilter;
      shRestTexture5.wrapS = THREE.ClampToEdgeWrapping;
      shRestTexture5.wrapT = THREE.ClampToEdgeWrapping;
      shRestTexture5.flipY = false;
      shRestTexture5.generateMipmaps = false;
      shRestTexture5.unpackAlignment = 1;
      shRestTexture5.version = 1;
      shRestTexture5.isDataTexture = true;
      console.log('Rest texture 5 created successfully - Data length:', shRestTextureData5.length);
      
      // Rest texture 6 (degree 2)
      shRestTexture6 = new THREE.DataTexture(shRestTextureData6, textureSize, textureSize, THREE.RGBAFormat, THREE.FloatType);
      shRestTexture6.needsUpdate = true;
      shRestTexture6.minFilter = THREE.NearestFilter;
      shRestTexture6.magFilter = THREE.NearestFilter;
      shRestTexture6.wrapS = THREE.ClampToEdgeWrapping;
      shRestTexture6.wrapT = THREE.ClampToEdgeWrapping;
      shRestTexture6.flipY = false;
      shRestTexture6.generateMipmaps = false;
      shRestTexture6.unpackAlignment = 1;
      shRestTexture6.version = 1;
      shRestTexture6.isDataTexture = true;
      console.log('Rest texture 6 created successfully - Data length:', shRestTextureData6.length);
      
      // Rest texture 7 (degree 2)
      shRestTexture7 = new THREE.DataTexture(shRestTextureData7, textureSize, textureSize, THREE.RGBAFormat, THREE.FloatType);
      shRestTexture7.needsUpdate = true;
      shRestTexture7.minFilter = THREE.NearestFilter;
      shRestTexture7.magFilter = THREE.NearestFilter;
      shRestTexture7.wrapS = THREE.ClampToEdgeWrapping;
      shRestTexture7.wrapT = THREE.ClampToEdgeWrapping;
      shRestTexture7.flipY = false;
      shRestTexture7.generateMipmaps = false;
      shRestTexture7.unpackAlignment = 1;
      shRestTexture7.version = 1;
      shRestTexture7.isDataTexture = true;
      console.log('Rest texture 7 created successfully - Data length:', shRestTextureData7.length);
      
      // Rest texture 8 (degree 2)
      shRestTexture8 = new THREE.DataTexture(shRestTextureData8, textureSize, textureSize, THREE.RGBAFormat, THREE.FloatType);
      shRestTexture8.needsUpdate = true;
      shRestTexture8.minFilter = THREE.NearestFilter;
      shRestTexture8.magFilter = THREE.NearestFilter;
      shRestTexture8.wrapS = THREE.ClampToEdgeWrapping;
      shRestTexture8.wrapT = THREE.ClampToEdgeWrapping;
      shRestTexture8.flipY = false;
      shRestTexture8.generateMipmaps = false;
      shRestTexture8.unpackAlignment = 1;
      shRestTexture8.version = 1;
      shRestTexture8.isDataTexture = true;
      console.log('Rest texture 8 created successfully - Data length:', shRestTextureData8.length);
      
      // Rest texture 9 (degree 3)
      shRestTexture9 = new THREE.DataTexture(shRestTextureData9, textureSize, textureSize, THREE.RGBAFormat, THREE.FloatType);
      shRestTexture9.needsUpdate = true;
      shRestTexture9.minFilter = THREE.NearestFilter;
      shRestTexture9.magFilter = THREE.NearestFilter;
      shRestTexture9.wrapS = THREE.ClampToEdgeWrapping;
      shRestTexture9.wrapT = THREE.ClampToEdgeWrapping;
      shRestTexture9.flipY = false;
      shRestTexture9.generateMipmaps = false;
      shRestTexture9.unpackAlignment = 1;
      shRestTexture9.version = 1;
      shRestTexture9.isDataTexture = true;
      console.log('Rest texture 9 created successfully - Data length:', shRestTextureData9.length);
      
      // Rest texture 10 (degree 3)
      shRestTexture10 = new THREE.DataTexture(shRestTextureData10, textureSize, textureSize, THREE.RGBAFormat, THREE.FloatType);
      shRestTexture10.needsUpdate = true;
      shRestTexture10.minFilter = THREE.NearestFilter;
      shRestTexture10.magFilter = THREE.NearestFilter;
      shRestTexture10.wrapS = THREE.ClampToEdgeWrapping;
      shRestTexture10.wrapT = THREE.ClampToEdgeWrapping;
      shRestTexture10.flipY = false;
      shRestTexture10.generateMipmaps = false;
      shRestTexture10.unpackAlignment = 1;
      shRestTexture10.version = 1;
      shRestTexture10.isDataTexture = true;
      console.log('Rest texture 10 created successfully - Data length:', shRestTextureData10.length);
      
      // Rest texture 11 (degree 3)
      shRestTexture11 = new THREE.DataTexture(shRestTextureData11, textureSize, textureSize, THREE.RGBAFormat, THREE.FloatType);
      shRestTexture11.needsUpdate = true;
      shRestTexture11.minFilter = THREE.NearestFilter;
      shRestTexture11.magFilter = THREE.NearestFilter;
      shRestTexture11.wrapS = THREE.ClampToEdgeWrapping;
      shRestTexture11.wrapT = THREE.ClampToEdgeWrapping;
      shRestTexture11.flipY = false;
      shRestTexture11.generateMipmaps = false;
      shRestTexture11.unpackAlignment = 1;
      shRestTexture11.version = 1;
      shRestTexture11.isDataTexture = true;
      console.log('Rest texture 11 created successfully - Data length:', shRestTextureData11.length);
      
      // Rest texture 12 (degree 3)
      shRestTexture12 = new THREE.DataTexture(shRestTextureData12, textureSize, textureSize, THREE.RGBAFormat, THREE.FloatType);
      shRestTexture12.needsUpdate = true;
      shRestTexture12.minFilter = THREE.NearestFilter;
      shRestTexture12.magFilter = THREE.NearestFilter;
      shRestTexture12.wrapS = THREE.ClampToEdgeWrapping;
      shRestTexture12.wrapT = THREE.ClampToEdgeWrapping;
      shRestTexture12.flipY = false;
      shRestTexture12.generateMipmaps = false;
      shRestTexture12.unpackAlignment = 1;
      shRestTexture12.version = 1;
      shRestTexture12.isDataTexture = true;
      console.log('Rest texture 12 created successfully - Data length:', shRestTextureData12.length);
      
      // Rest texture 13 (degree 3)
      shRestTexture13 = new THREE.DataTexture(shRestTextureData13, textureSize, textureSize, THREE.RGBAFormat, THREE.FloatType);
      shRestTexture13.needsUpdate = true;
      shRestTexture13.minFilter = THREE.NearestFilter;
      shRestTexture13.magFilter = THREE.NearestFilter;
      shRestTexture13.wrapS = THREE.ClampToEdgeWrapping;
      shRestTexture13.wrapT = THREE.ClampToEdgeWrapping;
      shRestTexture13.flipY = false;
      shRestTexture13.generateMipmaps = false;
      shRestTexture13.unpackAlignment = 1;
      shRestTexture13.version = 1;
      shRestTexture13.isDataTexture = true;
      console.log('Rest texture 13 created successfully - Data length:', shRestTextureData13.length);
      
      // Rest texture 14 (degree 3)
      shRestTexture14 = new THREE.DataTexture(shRestTextureData14, textureSize, textureSize, THREE.RGBAFormat, THREE.FloatType);
      shRestTexture14.needsUpdate = true;
      shRestTexture14.minFilter = THREE.NearestFilter;
      shRestTexture14.magFilter = THREE.NearestFilter;
      shRestTexture14.wrapS = THREE.ClampToEdgeWrapping;
      shRestTexture14.wrapT = THREE.ClampToEdgeWrapping;
      shRestTexture14.flipY = false;
      shRestTexture14.generateMipmaps = false;
      shRestTexture14.unpackAlignment = 1;
      shRestTexture14.version = 1;
      shRestTexture14.isDataTexture = true;
      console.log('Rest texture 14 created successfully - Data length:', shRestTextureData14.length);
      
      // Rest texture 15 (degree 3)
      shRestTexture15 = new THREE.DataTexture(shRestTextureData15, textureSize, textureSize, THREE.RGBAFormat, THREE.FloatType);
      shRestTexture15.needsUpdate = true;
      shRestTexture15.minFilter = THREE.NearestFilter;
      shRestTexture15.magFilter = THREE.NearestFilter;
      shRestTexture15.wrapS = THREE.ClampToEdgeWrapping;
      shRestTexture15.wrapT = THREE.ClampToEdgeWrapping;
      shRestTexture15.flipY = false;
      shRestTexture15.generateMipmaps = false;
      shRestTexture15.unpackAlignment = 1;
      shRestTexture15.version = 1;
      shRestTexture15.isDataTexture = true;
      console.log('Rest texture 15 created successfully - Data length:', shRestTextureData15.length);
      
      console.log('All textures created successfully (15 rest textures + 1 DC texture)');
      
    } catch (error) {
      console.error('Failed to create SH textures:', error);
      throw error;
    }
    
    // Store textures for material creation
    this.shTextures = {
      shDcTexture,
      shRestTexture1,
      shRestTexture2,
      shRestTexture3,
      shRestTexture4,
      shRestTexture5,
      shRestTexture6,
      shRestTexture7,
      shRestTexture8,
      shRestTexture9,
      shRestTexture10,
      shRestTexture11,
      shRestTexture12,
      shRestTexture13,
      shRestTexture14,
      shRestTexture15
    };
    geometry.scale(1, 1, 1);
    // Create custom material for Gaussian splatting with textures
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
    
  createGaussianSplatMaterial_ellipso(harmonicDegree = 3, pointScale = 1000, chiScale = 1.0) {
    // Check if textures exist and are valid
    if (!this.shTextures || !this.shTextures.shDcTexture) {
      console.warn('SH textures not available, creating fallback material');
      return this.createSimplePointMaterial();
    }
    
    console.log('Creating material with textures:', {
      shDcTexture: !!this.shTextures.shDcTexture,
      shRestTexture1: !!this.shTextures.shRestTexture1,
      shRestTexture2: !!this.shTextures.shRestTexture2,
      shRestTexture3: !!this.shTextures.shRestTexture3,
      shRestTexture4: !!this.shTextures.shRestTexture4,
      shRestTexture5: !!this.shTextures.shRestTexture5,
      shRestTexture6: !!this.shTextures.shRestTexture6,
      shRestTexture7: !!this.shTextures.shRestTexture7,
      shRestTexture8: !!this.shTextures.shRestTexture8,
      shRestTexture9: !!this.shTextures.shRestTexture9,
      shRestTexture10: !!this.shTextures.shRestTexture10,
      shRestTexture11: !!this.shTextures.shRestTexture11,
      shRestTexture12: !!this.shTextures.shRestTexture12,
      shRestTexture13: !!this.shTextures.shRestTexture13,
      shRestTexture14: !!this.shTextures.shRestTexture14,
      shRestTexture15: !!this.shTextures.shRestTexture15
    });
    // Custom shader material for Gaussian splatting with spherical harmonics
    const vertexShader = `
      uniform int harmonicDegree;
      uniform float pointScale;
      uniform vec2 focal;
      uniform vec2 viewport;
      
      // SH coefficient textures
      uniform sampler2D shDcTexture;
      uniform sampler2D shRestTexture1;
      uniform sampler2D shRestTexture2;
      uniform sampler2D shRestTexture3;
      uniform sampler2D shRestTexture4;
      uniform sampler2D shRestTexture5;
      uniform sampler2D shRestTexture6;
      uniform sampler2D shRestTexture7;
      uniform sampler2D shRestTexture8;
      uniform sampler2D shRestTexture9;
      uniform sampler2D shRestTexture10;
      uniform sampler2D shRestTexture11;
      uniform sampler2D shRestTexture12;
      uniform sampler2D shRestTexture13;
      uniform sampler2D shRestTexture14;
      uniform sampler2D shRestTexture15;
      
      attribute vec3 scale;
      attribute vec4 rotation;
      attribute float opacity;
      attribute vec2 shTexCoord;

      varying vec3 vColor;
      varying float vOpacity;
      varying vec3 vWorldPos;
      varying vec3 vCameraDir;
      varying vec3 vScale;
      varying vec4 vRotation;
      varying float vDistance;
      varying mat2 vCovariance2D;
      varying mat4 vCovariance4D;
      vec3 evaluateSphericalHarmonics(vec3 dir, vec2 texCoord, int degree) {
          // Grado 0 (DC) - lookup from texture
          vec3 sh_dc = texture2D(shDcTexture, texCoord).rgb;
          vec3 color = 0.5 + 0.28209479177387814 * sh_dc;
          if (degree < 1) return max(vec3(0.0), color);

          float x = dir.x;
          float y = dir.y;
          float z = dir.z;

          // Lookup SH rest coefficients from RGB textures (Degree 1)
          vec3 sh_rest_0_2 = texture2D(shRestTexture1, texCoord).rgb;  // coefficients 0-2
          vec3 sh_rest_3_5 = texture2D(shRestTexture2, texCoord).rgb;  // coefficients 3-5
          vec3 sh_rest_6_8 = texture2D(shRestTexture3, texCoord).rgb;  // coefficients 6-8

          // Grado 1 - Signos corregidos según implementación Inria
          color += -0.4886025 * y * sh_rest_0_2;  // -Y
          color +=  0.4886025 * z * sh_rest_3_5;  // +Z
          color += -0.4886025 * x * sh_rest_6_8;  // -X

          if (degree < 2) return max(vec3(0.0), color);

          // Degree 2 - Additional texture lookups
          vec3 sh_rest_9_11 = texture2D(shRestTexture4, texCoord).rgb;
          vec3 sh_rest_12_14 = texture2D(shRestTexture5, texCoord).rgb;
          vec3 sh_rest_15_17 = texture2D(shRestTexture6, texCoord).rgb;
          vec3 sh_rest_18_20 = texture2D(shRestTexture7, texCoord).rgb;
          vec3 sh_rest_21_23 = texture2D(shRestTexture8, texCoord).rgb;

          // Grado 2 - 5 basis functions
          float xx = x * x, yy = y * y, zz = z * z;
          float xy = x * y, yz = y * z, xz = x * z;

          color += 1.092548 * xy * sh_rest_9_11;                                    // XY
          color += -1.092548 * yz * sh_rest_12_14;                                  // YZ
          color += 0.315391 * (2.0 * zz - xx - yy) * sh_rest_15_17;               // 2Z²-X²-Y²
          color += -1.092548 * xz * sh_rest_18_20;                                 // XZ
          color += 0.546274 * (xx - yy) * sh_rest_21_23;                          // X²-Y²

          if (degree < 3) return max(vec3(0.0), color);

          // Degree 3 - Additional texture lookups
          vec3 sh_rest_24_26 = texture2D(shRestTexture9, texCoord).rgb;
          vec3 sh_rest_27_29 = texture2D(shRestTexture10, texCoord).rgb;
          vec3 sh_rest_30_32 = texture2D(shRestTexture11, texCoord).rgb;
          vec3 sh_rest_33_35 = texture2D(shRestTexture12, texCoord).rgb;
          vec3 sh_rest_36_38 = texture2D(shRestTexture13, texCoord).rgb;
          vec3 sh_rest_39_41 = texture2D(shRestTexture14, texCoord).rgb;
          vec3 sh_rest_42_44 = texture2D(shRestTexture15, texCoord).rgb;

          // Grado 3 - 7 basis functions  
          float xxx = xx * x, yyy = yy * y, zzz = zz * z;
          float xxy = xx * y, xxz = xx * z, xyy = x * yy;
          float xzz = x * zz, yyz = yy * z, yzz = y * zz;
          float xyz = x * y * z;

          color += -0.590043 * y * (3.0 * xx - yy) * sh_rest_24_26;               // Y(3X²-Y²)
          color += 2.890611 * xyz * sh_rest_27_29;                                 // XYZ
          color += -0.457045 * y * (4.0 * zz - xx - yy) * sh_rest_30_32;         // Y(4Z²-X²-Y²)
          color += 0.373176 * z * (2.0 * zz - 3.0 * xx - 3.0 * yy) * sh_rest_33_35; // Z(2Z²-3X²-3Y²)
          color += -0.457045 * x * (4.0 * zz - xx - yy) * sh_rest_36_38;         // X(4Z²-X²-Y²)
          color += 1.445305 * z * (xx - yy) * sh_rest_39_41;                     // Z(X²-Y²)
          color += -0.590043 * x * (xx - 3.0 * yy) * sh_rest_42_44;              // X(X²-3Y²)

          return max(vec3(0.0), color);
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

          // p_view.x y p_view.y ya están en espacio de cámara (antes de la división de proyección)
          mat3x2 J = mat3x2(
              focal.x * z_inv, 0.0,                          // Columna 1
              0.0, focal.y * z_inv,                          // Columna 2
              (focal.x * p_view.x) * z_inv_sq, (focal.y * p_view.y) * z_inv_sq // Columna 3 (SIN MINUS)
          );

          // 5. Proyectar la covarianza 3D a 2D usando el Jacobiano
          // vCovariance2D = J * Sigma_view * J^T
          vCovariance2D = J * Sigma_view * transpose(J);

          // Standard 3DGS low-pass filter: add a small bias to the diagonal
          vCovariance2D[0][0] += 0.3;
          vCovariance2D[1][1] += 0.3;
          
          // 6. Determinar el tamaño del quad 2D
          // El tamaño del quad debe ser proporcional al tamaño de la elipse 2D (ej. 3 sigma)
          // El radio máximo al cuadrado de la elipse 2D es el autovalor más grande de Sigma'.
          float det = vCovariance2D[0][0] * vCovariance2D[1][1] - vCovariance2D[0][1] * vCovariance2D[1][0];
          float mid = 0.5 * (vCovariance2D[0][0] + vCovariance2D[1][1]);
          float lambda = mid + sqrt(max(0.1, mid * mid - det));
          float radius_pixels = ceil(3.0 * sqrt(lambda));
          
          gl_PointSize = (pointScale / 100.0) * radius_pixels * 2.0;
          
          // Guardamos el radio para escalar gl_PointCoord en el fragment
          vDistance = radius_pixels;
          
          // 1. Calcular dirección de cámara en World Space
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vec3 viewDir = normalize(cameraPosition - worldPos.xyz);

          // 2. Convertir dirección de cámara a sistema de coordenadas LOCAL del punto
          //vec3 shDir = vec3(viewDir.x, viewDir.z, -viewDir.y); // estandar in som exporters
          //vec3 shDir = vec3(viewDir.x, -viewDir.y, viewDir.z);
          //vec3 shDir = vec3(-viewDir.x, -viewDir.y, -viewDir.z);
          vec3 shDir = vec3(viewDir.x, -viewDir.y, -viewDir.z);// Three.js Y-up to COLMAP Y-down conversion
          //vec3 shDir = viewDir;
          // 3. Evaluar SH con la dirección LOCAL usando coordenadas de textura
          //vColor = vec3(shDir.x, shDir.y, shDir.z);
          vColor = evaluateSphericalHarmonics(shDir , shTexCoord, harmonicDegree);
          
          
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
        chiScale: { value: chiScale },
        shDcTexture: { value: this.shTextures?.shDcTexture || null },
        shRestTexture1: { value: this.shTextures?.shRestTexture1 || null },
        shRestTexture2: { value: this.shTextures?.shRestTexture2 || null },
        shRestTexture3: { value: this.shTextures?.shRestTexture3 || null },
        shRestTexture4: { value: this.shTextures?.shRestTexture4 || null },
        shRestTexture5: { value: this.shTextures?.shRestTexture5 || null },
        shRestTexture6: { value: this.shTextures?.shRestTexture6 || null },
        shRestTexture7: { value: this.shTextures?.shRestTexture7 || null },
        shRestTexture8: { value: this.shTextures?.shRestTexture8 || null },
        shRestTexture9: { value: this.shTextures?.shRestTexture9 || null },
        shRestTexture10: { value: this.shTextures?.shRestTexture10 || null },
        shRestTexture11: { value: this.shTextures?.shRestTexture11 || null },
        shRestTexture12: { value: this.shTextures?.shRestTexture12 || null },
        shRestTexture13: { value: this.shTextures?.shRestTexture13 || null },
        shRestTexture14: { value: this.shTextures?.shRestTexture14 || null },
        shRestTexture15: { value: this.shTextures?.shRestTexture15 || null }
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

    // Ensure matrices reflect the current robot/camera pose even when capture
    // is requested outside the continuous render loop.
    camera.updateMatrixWorld(true);
    pointCloudMesh.updateMatrixWorld(true);
    if (!this._mvMatrix) this._mvMatrix = new THREE.Matrix4();
    this._mvMatrix.multiplyMatrices(camera.matrixWorldInverse, pointCloudMesh.matrixWorld);
    const mv = this._mvMatrix.elements;
    
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