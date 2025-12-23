/**
 * Node.js script to generate a .ply file containing 12 3D Gaussians.
 *
 * This file uses the standard 3D Gaussian Splatting format (binary_little_endian)
 * with 17 properties per vertex:
 * x, y, z (position)
 * nx, ny, nz (dummy normals, usually ignored for Gaussians, set to 0,0,1)
 * f_dc_0, f_dc_1, f_dc_2 (DC color component, R, G, B)
 * opacity
 * scale_0, scale_1, scale_2 (scale factors)
 * rot_0, rot_1, rot_2, rot_3 (rotation quaternion, w, x, y, z)
 */

const fs = require('fs');
const path = require('path');

// --- Configuration ---
const NUM_GAUSSIANS = 12;
const FILE_PATH = path.join(__dirname, 'test_gaussians.ply');
// 17 properties * 4 bytes/float = 68 bytes per Gaussian
const BYTES_PER_VERTEX = 17 * 4;

// --- Gaussian Data Generation ---

/**
 * Creates an array of 12 Gaussian data points.
 * @returns {Array<Array<number>>} Array of 17-element arrays (floats).
 */
function createGaussianData() {
    const data = [];

    // Helper to generate 6 points in a ring (hexagon)
    const generateRing = (radius, z, baseColor, count, offsetAngle = 0) => {
        for (let i = 0; i < count; i++) {
            const angle = (i * (2 * Math.PI) / count) + offsetAngle;
            const x = radius * Math.cos(angle);
            const y = radius * Math.sin(angle);

            // [R, G, B] for the DC color component (SH degree 0)
            const [r, g, b] = baseColor;

            // Define the 17 properties:
            const gaussian = [
                // 1-3. Position (x, y, z)
                x, y, z,

                // 4-6. Normals (nx, ny, nz) - set to a standard direction (0,0,1)
                0.0, 0.0, 1.0,

                // 7-9. DC Color (f_dc_0, f_dc_1, f_dc_2) - R, G, B
                r, g, b,

                // 10. Opacity - High visibility
                0.9,

                // 11-13. Scale (scale_0, scale_1, scale_2) - Uniform, moderate size
                0.1, 0.1, 0.1,

                // 14-17. Rotation Quaternion (rot_0, rot_1, rot_2, rot_3) - Identity (no rotation)
                1.0, 0.0, 0.0, 0.0
            ];
            data.push(gaussian);
        }
    };

    // 1. First Ring (Red, z=1.0, larger radius)
    // R, G, B components (set to a bright red)
    generateRing(1.5, 1.0, [0.8, 0.1, 0.1], 6, 0);

    // 2. Second Ring (Blue, z=-1.0, smaller radius, slightly rotated)
    // R, G, B components (set to a bright blue)
    generateRing(0.8, -1.0, [0.1, 0.1, 0.8], 6, Math.PI / 6);

    return data;
}

/**
 * Constructs the PLY file header.
 * @param {number} vertexCount - The number of Gaussians.
 * @returns {string} The complete PLY header string.
 */
function createPlyHeader(vertexCount) {
    return `ply
format binary_little_endian 1.0
element vertex ${vertexCount}
property float x
property float y
property float z
property float nx
property float ny
property float nz
property float f_dc_0
property float f_dc_1
property float f_dc_2
property float opacity
property float scale_0
property float scale_1
property float scale_2
property float rot_0
property float rot_1
property float rot_2
property float rot_3
end_header
`;
}

/**
 * Main function to generate the PLY file.
 */
function generatePlyFile() {
    console.log('Generating PLY file...');
    const gaussianData = createGaussianData();
    const header = createPlyHeader(NUM_GAUSSIANS);
    const totalBinarySize = NUM_GAUSSIANS * BYTES_PER_VERTEX;
    const buffer = Buffer.alloc(totalBinarySize);

    let offset = 0;
    for (const gaussian of gaussianData) {
        for (const value of gaussian) {
            // Write each value as a 4-byte float in little-endian format
            buffer.writeFloatLE(value, offset);
            offset += 4;
        }
    }

    // Combine header and binary data
    const fileContent = Buffer.concat([Buffer.from(header, 'utf8'), buffer]);

    try {
        fs.writeFileSync(FILE_PATH, fileContent);
        console.log(`Successfully generated ${NUM_GAUSSIANS} Gaussians.`);
        console.log(`File saved to: ${FILE_PATH}`);
    } catch (err) {
        console.error('Failed to write PLY file:', err);
    }
}

// Execute the generation
generatePlyFile();
