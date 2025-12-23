# Gaussian Splatting PLY Format Example

Here's an example of what a Gaussian Splatting PLY file looks like:

```
ply
format binary_little_endian 1.0
element vertex 1000000
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
property float opacity
property float scale_0
property float scale_1
property float scale_2
property float rot_0
property float rot_1
property float rot_2
property float rot_3
property float f_dc_0
property float f_dc_1
property float f_dc_2
property float f_rest_0
property float f_rest_1
property float f_rest_2
...
end_header
[binary data follows]
```

## Key Attributes for Gaussian Splatting:

### Required:
- **x, y, z**: 3D position
- **scale_0, scale_1, scale_2**: Ellipsoid scales for each axis
- **rot_0, rot_1, rot_2, rot_3**: Quaternion rotation (x, y, z, w)
- **opacity**: Transparency value

### Optional:
- **red, green, blue**: Color values (0-255)
- **f_dc_***: Spherical harmonics DC components
- **f_rest_***: Additional spherical harmonics coefficients

## Creating Test Data

You can create a simple Gaussian splat PLY file for testing:

```python
import numpy as np
import struct

# Generate test data
n_points = 1000
positions = np.random.randn(n_points, 3) * 2
colors = np.random.randint(0, 255, (n_points, 3), dtype=np.uint8)
scales = np.random.rand(n_points, 3) * 0.1 + 0.01
rotations = np.random.randn(n_points, 4)
rotations = rotations / np.linalg.norm(rotations, axis=1, keepdims=True)  # normalize
opacities = np.random.rand(n_points) * 0.8 + 0.2

# Write PLY file
with open('test_splat.ply', 'wb') as f:
    # Header
    header = f"""ply
format binary_little_endian 1.0
element vertex {n_points}
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
property float opacity
property float scale_0
property float scale_1
property float scale_2
property float rot_0
property float rot_1
property float rot_2
property float rot_3
end_header
"""
    f.write(header.encode('ascii'))
    
    # Binary data
    for i in range(n_points):
        # Position
        f.write(struct.pack('<fff', *positions[i]))
        # Color
        f.write(struct.pack('<BBB', *colors[i]))
        # Opacity
        f.write(struct.pack('<f', opacities[i]))
        # Scale
        f.write(struct.pack('<fff', *scales[i]))
        # Rotation
        f.write(struct.pack('<ffff', *rotations[i]))
```

This creates a test file you can use to verify the Gaussian splatting loader works correctly.