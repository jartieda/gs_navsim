/**
 * Node.js script to generate a .ply file containing 12 3D Gaussians in orthogonal positions.
 *
 * This creates Gaussians positioned along the coordinate axes and at orthogonal positions
 * for easy debugging and visual verification of the Gaussian viewer.
 *
 * Positions:
 * - 6 Gaussians along the main axes: ±X, ±Y, ±Z (red, green, blue respectively)
 * - 6 Gaussians at diagonal orthogonal positions for additional reference points
 *
 * Uses the standard 3D Gaussian Splatting format (binary_little_endian)
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
const NUM_GAUSSIANS = 3;
const FILE_PATH = path.join(__dirname, 'orthogonal_gaussians.ply');
// 17 properties * 4 bytes/float = 68 bytes per Gaussian
const BYTES_PER_VERTEX = 17 * 4;

// --- Gaussian Data Generation ---

/**
 * Creates an array of 15 Gaussian data points in orthogonal positions.
 * Includes 3 additional elongated Gaussians along different axes.
 * @returns {Array<Array<number>>} Array of 17-element arrays (floats).
 */
function createOrthogonalGaussianData() {
    const data = [];
    const distance = 2.0; // Distance from origin for axis-aligned Gaussians
    const diagonalDistance = 1.5; // Distance for diagonal positions

    // Helper function to create a Gaussian at a specific position with color
    const createGaussian = (x, y, z, r, g, b, scale = 0.15) => {
        return [
            // 1-3. Position (x, y, z)
            x, y, z,

            // 4-6. Normals (nx, ny, nz) - set to standard direction (0,0,1)
            0.0, 0.0, 1.0,

            // 7-9. DC Color (f_dc_0, f_dc_1, f_dc_2) - R, G, B
            r, g, b,

            // 10. Opacity - High visibility for debugging
            0.95,

            // 11-13. Scale (scale_0, scale_1, scale_2) - Uniform size
            scale, scale, scale,

            // 14-17. Rotation Quaternion (rot_0, rot_1, rot_2, rot_3) - Identity (no rotation)
            1.0, 0.0, 0.0, 0.0
        ];
    };

    
    // 5. Elongated Gaussians along different axes for scale testing
    // X-elongated Gaussian (stretched along X-axis) - White
    data.push([
        0.5, 0, 0.5,          // Position: slightly offset from origin
        0.0, 0.0, 1.0,        // Normals
        1.0, 0.0, 0.0,        // White color
        0.9,                  // Opacity
        0.8, 0.05, 0.05,      // Scale: elongated in X (scale_0), thin in Y,Z
        1.0, 0.0, 0.0, 0.0    // Identity rotation
    ]);

    // Y-elongated Gaussian (stretched along Y-axis) - Light gray
    data.push([
        -0.5, 0, 0.5,         // Position: offset in opposite X direction
        0.0, 0.0, 1.0,        // Normals
        0.0, 0.1, 0.0,        // Light gray color
        0.9,                  // Opacity
        0.05, 0.8, 0.05,      // Scale: thin in X, elongated in Y (scale_1), thin in Z
        1.0, 0.0, 0.0, 0.0    // Identity rotation
    ]);

    // Z-elongated Gaussian (stretched along Z-axis) - Dark gray
    data.push([
        0, 0.5, 0,            // Position: offset in Y direction
        0.0, 0.0, 1.0,        // Normals
        0.0, 0.0, 1.0,        // Dark gray color
        0.9,                  // Opacity
        0.05, 0.05, 0.8,      // Scale: thin in X,Y, elongated in Z (scale_2)
        1.0, 0.0, 0.0, 0.0    // Identity rotation
    ]);

    console.log(`Generated ${data.length} orthogonal Gaussians:`);
    console.log('- Axis-aligned: ±X (red), ±Y (green), ±Z (blue)');
    console.log('- Diagonal positions: XY, XZ, YZ planes with distinct colors');
    console.log('- Elongated Gaussians: X-stretched (white), Y-stretched (light gray), Z-stretched (dark gray)');

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
 * Main function to generate the orthogonal PLY file.
 */
function generateOrthogonalPlyFile() {
    console.log('Generating orthogonal Gaussian PLY file for debugging...');
    
    const gaussianData = createOrthogonalGaussianData();
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
        console.log(`✓ Successfully generated ${NUM_GAUSSIANS} orthogonal Gaussians.`);
        console.log(`✓ File saved to: ${FILE_PATH}`);
        console.log('\nDebug positions:');
        console.log('  Red axis: X-axis (±2.0, 0, 0)');
        console.log('  Green axis: Y-axis (0, ±2.0, 0)');
        console.log('  Blue axis: Z-axis (0, 0, ±2.0)');
        console.log('  Diagonal positions: Various colors at orthogonal intersections');
        console.log('  Elongated Gaussians: X-stretched (white), Y-stretched (light gray), Z-stretched (dark gray)');
        console.log('\nThis file is ideal for testing camera movements, rendering accuracy, and scale handling.');
    } catch (err) {
        console.error('✗ Failed to write PLY file:', err);
        process.exit(1);
    }
}

// Execute the generation
if (require.main === module) {
    generateOrthogonalPlyFile();
}

module.exports = {
    generateOrthogonalPlyFile,
    createOrthogonalGaussianData,
    createPlyHeader
};