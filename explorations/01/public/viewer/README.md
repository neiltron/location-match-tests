# Camera Transforms & Frustum Visualization

This module provides utilities for converting VGGT camera data (OpenCV convention) to Three.js coordinate system and creating visualization meshes for camera frustums.

## Overview

VGGT's `predictions.npz` contains camera extrinsics and intrinsics in OpenCV convention (world→camera). This module handles:

1. **Transform Conversion**: OpenCV → Three.js coordinate systems
2. **Frustum Visualization**: Create wireframe camera pyramids
3. **Camera Creation**: Generate Three.js PerspectiveCamera objects
4. **Scene Analysis**: Calculate bounds, positions, and orientations

## Core Files

- **`CameraTransforms.ts`**: Main implementation
- **`CameraTransforms.test.ts`**: Usage examples and validation tests
- **`README.md`**: This documentation

## Transform Pipeline

The conversion follows the math from `_DOCS/vggt_integration_notes.md` (lines 45-75):

```typescript
// Input: 3×4 OpenCV extrinsic matrix (world→camera)
const extrinsic = [
  [r11, r12, r13, tx],
  [r21, r22, r23, ty],
  [r31, r32, r33, tz]
];

// Step 1: Convert to 4×4 homogeneous matrix (add [0,0,0,1] row)
// Step 2: Invert to get camera→world (camera position in world space)
// Step 3: Apply OpenGL fix: diagonal [1, -1, -1, 1] to flip Y and Z
// Step 4: Apply 180° Y rotation for VGGT viewer alignment
// Step 5: Extract position (column 4) and rotation (3×3 upper-left)

const matrix = CameraTransforms.extrinsicToThreeMatrix(extrinsic);
const { position, quaternion } = CameraTransforms.getPositionAndRotation(matrix);
```

### Why These Transforms?

1. **Homogeneous Coordinates**: Enables matrix inversion and composition
2. **Inversion**: OpenCV stores world→camera, Three.js needs camera→world
3. **OpenGL Fix**: OpenCV uses Y-down, Z-forward; OpenGL uses Y-up, Z-back
4. **Y-180 Rotation**: Aligns with VGGT's viewer convention (cameras point down -Z)

## Usage Examples

### 1. Basic Transform Conversion

```typescript
import { CameraTransforms, CameraData } from './CameraTransforms';

const cameraData: CameraData = {
  extrinsic: [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 5]
  ],
  intrinsic: [
    [400, 0, 259],
    [0, 400, 259],
    [0, 0, 1]
  ],
  imageIndex: 0
};

const matrix = CameraTransforms.extrinsicToThreeMatrix(cameraData.extrinsic);
const { position, quaternion } = CameraTransforms.getPositionAndRotation(matrix);

console.log('Position:', position);
console.log('Rotation:', quaternion);
```

### 2. Create Frustum Visualization

```typescript
// Create a single frustum
const frustum = CameraTransforms.createFrustumMesh(
  cameraData,
  0x00ff00,    // Green color
  'Camera 0',
  1.0          // Scale factor
);

scene.add(frustum);
```

### 3. Full Pipeline from NPZ Data

```typescript
// Load and parse predictions.npz (using npyjs or similar)
const predictions = loadNPZ('predictions.npz');

// Parse all cameras
const { cameras, numFrames } = CameraTransforms.parseNPZCameras(predictions);

// Create frustums for all cameras
const frustums = CameraTransforms.createAllFrustums(cameras, 1.0);
frustums.forEach(frustum => scene.add(frustum));

// Calculate scene bounds for camera framing
const bounds = CameraTransforms.calculateSceneBounds(cameras);
const center = bounds.getCenter(new THREE.Vector3());
const size = bounds.getSize(new THREE.Vector3());

// Position orbit controls to view entire scene
controls.target.copy(center);
camera.position.copy(center).add(new THREE.Vector3(size.x, size.y, size.z));
```

### 4. Create Renderable Camera

```typescript
// Create a Three.js camera that matches the reconstructed camera
const threeCamera = CameraTransforms.createThreeCamera(
  cameraData,
  window.innerWidth / window.innerHeight  // Viewport aspect ratio
);

// Use for rendering or switching viewpoints
renderer.render(scene, threeCamera);
```

## API Reference

### `CameraTransforms` Class

#### Static Methods

##### `extrinsicToThreeMatrix(extrinsic, applyYRotation?)`
Converts OpenCV extrinsic matrix to Three.js transform.

- **Parameters:**
  - `extrinsic: number[][]` - 3×4 OpenCV extrinsic matrix
  - `applyYRotation?: boolean` - Apply 180° Y rotation (default: true)
- **Returns:** `THREE.Matrix4` - Transform matrix

##### `getPositionAndRotation(matrix)`
Extracts position and rotation from transform matrix.

- **Parameters:**
  - `matrix: THREE.Matrix4` - Transform matrix
- **Returns:** `{ position: Vector3, quaternion: Quaternion, matrix: Matrix4 }`

##### `getFOVFromIntrinsic(intrinsic, imageHeight?)`
Calculates vertical FOV from intrinsic matrix.

- **Parameters:**
  - `intrinsic: number[][]` - 3×3 intrinsic matrix
  - `imageHeight?: number` - Image height in pixels (default: 518)
- **Returns:** `number` - FOV in degrees

##### `createFrustumMesh(cameraData, color?, label?, frustumScale?)`
Creates a wireframe frustum visualization.

- **Parameters:**
  - `cameraData: CameraData` - Camera extrinsic/intrinsic data
  - `color?: number` - Hex color (default: 0x00ff00)
  - `label?: string` - Text label (default: "Cam {index}")
  - `frustumScale?: number` - Scale factor (default: 1.0)
- **Returns:** `THREE.Group` - Frustum group with geometry and label

##### `parseNPZCameras(predictions)`
Parses camera data from predictions.npz structure.

- **Parameters:**
  - `predictions: any` - Parsed NPZ data object
- **Returns:** `{ cameras: CameraData[], numFrames: number }`

##### `createAllFrustums(cameras, frustumScale?)`
Creates frustum meshes for all cameras with color coding.

- **Parameters:**
  - `cameras: CameraData[]` - Array of camera data
  - `frustumScale?: number` - Scale factor (default: 1.0)
- **Returns:** `THREE.Group[]` - Array of frustum groups

##### `calculateSceneBounds(cameras)`
Calculates bounding box of all camera positions.

- **Parameters:**
  - `cameras: CameraData[]` - Array of camera data
- **Returns:** `THREE.Box3` - Bounding box

##### `createThreeCamera(cameraData, aspect?)`
Creates a Three.js PerspectiveCamera from camera data.

- **Parameters:**
  - `cameraData: CameraData` - Camera extrinsic/intrinsic data
  - `aspect?: number` - Viewport aspect ratio
- **Returns:** `THREE.PerspectiveCamera` - Configured camera

### Interfaces

#### `CameraData`
```typescript
interface CameraData {
  extrinsic: number[][];  // 3×4 matrix (world→camera, OpenCV)
  intrinsic: number[][];  // 3×3 matrix (camera intrinsics)
  imageIndex: number;     // Frame/image index
}
```

#### `CameraTransform`
```typescript
interface CameraTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  matrix: THREE.Matrix4;
}
```

## Matrix Math Details

### Extrinsic Matrix Format (OpenCV)

The 3×4 extrinsic matrix represents world→camera transform:

```
[R | t]  where R is 3×3 rotation, t is 3×1 translation

[r11 r12 r13 | tx]
[r21 r22 r23 | ty]
[r31 r32 r33 | tz]
```

To get camera position in world space:
```
camera_pos_world = -R^T * t
```

Or equivalently, invert the 4×4 homogeneous matrix and extract column 4.

### Intrinsic Matrix Format

The 3×3 intrinsic matrix contains camera parameters:

```
[fx  0  cx]
[ 0 fy  cy]
[ 0  0   1]

fx, fy = focal length in pixels (X and Y)
cx, cy = principal point (image center)
```

FOV calculation:
```
fov_vertical = 2 * atan(image_height / (2 * fy))
aspect_ratio = fx / fy
```

### Coordinate System Conventions

| System | X-Right | Y-Up/Down | Z-Forward/Back |
|--------|---------|-----------|----------------|
| OpenCV | Right   | Down      | Forward        |
| OpenGL | Right   | Up        | Back           |
| Three.js | Right | Up        | Back           |

The OpenGL fix diagonal `[1, -1, -1, 1]` flips Y (down→up) and Z (forward→back).

## Frustum Visualization

Each frustum consists of:

1. **Wireframe pyramid**: Shows camera FOV and orientation
   - Near plane at 0.1 units
   - Far plane at 2.0 units
   - Scaled by `frustumScale` parameter

2. **Position marker**: Small sphere at camera position
   - Radius: 0.05 units (scaled)

3. **Text label**: Canvas-based sprite showing camera index
   - Positioned above camera (offset +0.2 units)

### Frustum Components

```
        far plane
          /|\
         / | \
        /  |  \
       /   |   \
      /    |    \
     /_____|_____\
    near plane
         |
      camera
```

## Visual Testing Recommendations

### 1. Matrix Math Validation

Run the test examples to validate transform correctness:

```bash
npm run test:transforms
# or
node --loader ts-node/esm CameraTransforms.test.ts
```

Expected outputs:
- Camera positions match inverted extrinsics
- FOV values are reasonable (30-90 degrees typical)
- Frustums point in expected directions

### 2. Three.js Scene Setup

```typescript
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

// Create scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);

// Add grid for spatial reference
const gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x222222);
scene.add(gridHelper);

// Add axis helper (X=red, Y=green, Z=blue)
const axisHelper = new THREE.AxesHelper(5);
scene.add(axisHelper);

// Add frustums
frustums.forEach(frustum => scene.add(frustum));

// Position camera to view scene
const bounds = CameraTransforms.calculateSceneBounds(cameras);
const center = bounds.getCenter(new THREE.Vector3());
const size = bounds.getSize(new THREE.Vector3());
const maxDim = Math.max(size.x, size.y, size.z);

camera.position.set(
  center.x + maxDim,
  center.y + maxDim,
  center.z + maxDim
);
controls.target.copy(center);
```

### 3. Visual Checks

**Test frustum orientation:**
- All frustums should point roughly toward a common region (the scene)
- Frustum pyramids should spread outward from camera positions
- No frustums should be inverted or wildly misaligned

**Test color distribution:**
- Each camera should have a distinct color
- Colors should smoothly transition through hue spectrum
- Labels should be readable and positioned above cameras

**Test scale:**
- Frustums should be visible but not overwhelming
- Adjust `frustumScale` parameter if needed (try 0.5 to 2.0)
- Camera markers should be small relative to scene size

### 4. Interactive Testing

```typescript
// Click frustum to inspect camera data
raycaster.setFromCamera(mouse, camera);
const intersects = raycaster.intersectObjects(frustums, true);

if (intersects.length > 0) {
  const frustum = intersects[0].object.parent;
  console.log('Camera data:', frustum.userData);
}

// Switch to camera view
function switchToCameraView(cameraData: CameraData) {
  const threeCamera = CameraTransforms.createThreeCamera(cameraData);
  renderer.render(scene, threeCamera);
}
```

### 5. Known Issues to Check

**Issue**: Frustums are too large/small
- **Fix**: Adjust `frustumScale` parameter
- **Typical range**: 0.5 to 2.0

**Issue**: Frustums point in wrong direction
- **Fix**: Toggle `applyYRotation` parameter in `extrinsicToThreeMatrix`
- **Check**: Compare with VGGT's GLB viewer

**Issue**: Cameras are clustered at origin
- **Fix**: Verify extrinsic matrices are correct (not identity)
- **Check**: Print camera positions before and after conversion

**Issue**: Colors are hard to distinguish
- **Fix**: Adjust HSL saturation/lightness in `createAllFrustums`
- **Try**: Different color schemes (rainbow, gradient, categorical)

## Integration with VGGT Pipeline

### Loading NPZ Data

```typescript
// Using npyjs library (install: npm install npyjs)
import * as npyjs from 'npyjs';

async function loadPredictions(path: string) {
  const response = await fetch(path);
  const buffer = await response.arrayBuffer();

  // Parse NPZ (ZIP of NPY files)
  const loader = new npyjs.NpyLoader();
  const predictions = await loader.loadZip(buffer);

  return predictions;
}

// Usage
const predictions = await loadPredictions('/outputs/predictions.npz');
const { cameras } = CameraTransforms.parseNPZCameras(predictions);
```

### Combining with Point Clouds

```typescript
// Load point cloud from world_points
const worldPoints = predictions.world_points;  // S×H×W×3
const worldPointsConf = predictions.world_points_conf;  // S×H×W

// Filter by confidence threshold
const confThreshold = 0.45;
const points: THREE.Vector3[] = [];

for (let s = 0; s < worldPoints.shape[0]; s++) {
  for (let h = 0; h < worldPoints.shape[1]; h++) {
    for (let w = 0; w < worldPoints.shape[2]; w++) {
      const conf = worldPointsConf.get(s, h, w);
      if (conf >= confThreshold) {
        const x = worldPoints.get(s, h, w, 0);
        const y = worldPoints.get(s, h, w, 1);
        const z = worldPoints.get(s, h, w, 2);
        points.push(new THREE.Vector3(x, y, z));
      }
    }
  }
}

// Create point cloud geometry
const geometry = new THREE.BufferGeometry().setFromPoints(points);
const material = new THREE.PointsMaterial({ size: 0.02, color: 0xffffff });
const pointCloud = new THREE.Points(geometry, material);
scene.add(pointCloud);
```

## Performance Considerations

- **Frustum count**: 10-50 cameras is typical, 100+ may need LOD
- **Point cloud size**: Filter heavily (percentile 45+), subsample if needed
- **Memory**: Keep NPZ data on server, stream/paginate if >100MB
- **Rendering**: Use `frustumCulled: true` for off-screen objects

## References

- **VGGT Integration Notes**: `_DOCS/vggt_integration_notes.md`
- **VGGT Space**: https://huggingface.co/spaces/facebook/vggt
- **Three.js Docs**: https://threejs.org/docs/
- **OpenCV Convention**: https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html

## Future Enhancements

1. **LOD for frustums**: Simplify geometry for distant cameras
2. **Image textures**: Display captured images on frustum near planes
3. **Animation**: Interpolate between camera positions
4. **Export**: Save frustums as GLB for external viewers
5. **AR overlay**: Project frustums onto live camera feed
