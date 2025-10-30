# NPZ Parser - Quick Reference

## Installation

```bash
cd /Users/neil/projects/unsplash-clustering/explorations/01
bun add fflate  # Already installed ✅
```

## Basic Usage

### Parse NPZ File

```typescript
import { npzParser } from './server/services/npz-parser';

// Parse predictions.npz
const predictions = await npzParser.parseFile('path/to/predictions.npz');

console.log(`Cameras: ${predictions.extrinsic.length}`);
console.log(`Has depth: ${predictions.depth ? 'yes' : 'no'}`);
console.log(`Has world points: ${predictions.world_points ? 'yes' : 'no'}`);
```

### Get Camera Data (API Format)

```typescript
// Parse with Three.js transforms included
const cameraData = await npzParser.parsePredictions('path/to/predictions.npz');

console.log(`Frames: ${cameraData.numFrames}`);

cameraData.cameras.forEach(cam => {
  console.log(`Camera ${cam.index}:`);
  console.log(`  Position: ${cam.position}`);
  console.log(`  Matrix: ${cam.threeMatrix?.length} elements`);
});
```

### Transform Individual Camera

```typescript
import { CameraTransform } from './server/services/npz-parser';

// Convert OpenCV extrinsic to Three.js
const transform = CameraTransform.extrinsicToThreeJS(
  extrinsic,  // 3×4 matrix
  { alignY180: true }  // Optional alignment
);

console.log(`Position: ${transform.position}`);
console.log(`Matrix: ${transform.matrix}`);  // 16 floats, column-major
```

### Three.js Integration

```typescript
import * as THREE from 'three';
import { npzParser } from './server/services/npz-parser';

// Parse cameras
const { cameras } = await npzParser.parsePredictions('predictions.npz');

// Create Three.js camera
const camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);

// Apply transform from VGGT
const cam0 = cameras[0];
if (cam0.threeMatrix) {
  const matrix = new THREE.Matrix4().fromArray(cam0.threeMatrix);
  camera.matrix = matrix;
  camera.matrixAutoUpdate = false;
  camera.updateMatrixWorld(true);
}

// Camera is now positioned and oriented correctly!
```

## API Endpoint

```bash
# Get camera data for a run
GET /api/runs/:runId/cameras
```

**Response:**

```json
{
  "numFrames": 10,
  "cameras": [
    {
      "index": 0,
      "extrinsic": [[...], [...], [...]],
      "intrinsic": [[...], [...], [...]],
      "position": [1.2, -0.5, 3.4],
      "threeMatrix": [1, 0, 0, 0, ...]
    }
  ],
  "hasDepth": true,
  "hasWorldPoints": true,
  "imageShape": [10, 518, 518, 3]
}
```

## Error Handling

```typescript
import { NPZParserError } from './server/services/npz-parser';

try {
  const predictions = await npzParser.parseFile('predictions.npz');
} catch (error) {
  if (error instanceof NPZParserError) {
    switch (error.code) {
      case 'FILE_NOT_FOUND':
        console.error('NPZ file not found');
        break;
      case 'INVALID_FORMAT':
        console.error('Invalid NPZ format');
        break;
      case 'PARSE_FAILED':
        console.error('Failed to parse NPZ');
        break;
    }
  }
}
```

## Testing

```bash
# Test with mock data
bun run test-npz-parser.ts

# Comprehensive test suite
bun run test-npz-full.ts

# Test with actual NPZ file
bun run test-npz-parser.ts path/to/predictions.npz
```

## Data Structures

### VGGTPredictions

```typescript
interface VGGTPredictions {
  extrinsic: number[][][];        // S × 3 × 4
  intrinsic: number[][][];        // S × 3 × 3
  depth?: number[][][];           // S × H × W
  depth_conf?: number[][][];      // S × H × W
  world_points?: number[][][][];  // S × H × W × 3
  world_points_conf?: number[][][]; // S × H × W
  images?: number[][][][];        // S × H × W × C
  pose_enc?: number[][];          // S × D
}
```

### CameraData

```typescript
interface CameraData {
  index: number;
  extrinsic: number[][];     // 3×4 matrix
  intrinsic: number[][];     // 3×3 matrix
  position?: [number, number, number];
  threeMatrix?: number[];    // 16 floats, column-major
}
```

## Performance

| Operation | Time |
|-----------|------|
| Parse NPZ (8 cameras) | <1ms |
| Parse + Transforms | 0.1ms |
| File Validation | <5ms |

## Supported Data Types

| dtype | TypeScript | Status |
|-------|------------|--------|
| `<f4` | Float32Array | ✅ |
| `<f8` | Float64Array | ✅ |
| `<i4` | Int32Array | ✅ |
| `\|u1` | Uint8Array | ✅ |
| `>f4` | (big-endian) | ❌ |

## Common Patterns

### Validate NPZ File

```typescript
const isValid = await npzParser.isValidNPZ('file.npz');
if (!isValid) {
  console.error('Not a valid NPZ file');
}
```

### Extract Camera Positions

```typescript
const { cameras } = await npzParser.parsePredictions('predictions.npz');
const positions = cameras.map(cam => cam.position);
console.log(`Camera positions:`, positions);
```

### Get Camera Frustum

```typescript
// Extract FOV from intrinsic matrix
function getFOV(intrinsic: number[][], imageHeight: number): number {
  const fy = intrinsic[1][1];  // Focal length Y
  const fovRadians = 2 * Math.atan(imageHeight / (2 * fy));
  return fovRadians * (180 / Math.PI);  // Convert to degrees
}

const fov = getFOV(cameras[0].intrinsic, 518);
console.log(`FOV: ${fov}°`);
```

### Create Camera Visualization

```typescript
import * as THREE from 'three';

function createCameraHelper(camera: CameraData): THREE.CameraHelper {
  const fov = 75;  // Or calculate from intrinsic
  const aspect = 1.0;
  const near = 0.1;
  const far = 1000;

  const threeCamera = new THREE.PerspectiveCamera(fov, aspect, near, far);

  if (camera.threeMatrix) {
    const matrix = new THREE.Matrix4().fromArray(camera.threeMatrix);
    threeCamera.matrix = matrix;
    threeCamera.matrixAutoUpdate = false;
    threeCamera.updateMatrixWorld(true);
  }

  return new THREE.CameraHelper(threeCamera);
}

// Add all cameras to scene
cameras.forEach(cam => {
  const helper = createCameraHelper(cam);
  scene.add(helper);
});
```

## Files

| File | Purpose |
|------|---------|
| `server/services/npz-parser.ts` | Core implementation |
| `test-npz-parser.ts` | Basic tests |
| `test-npz-full.ts` | Comprehensive tests |
| `NPZ_PARSER_README.md` | Full documentation |
| `NPZ_PARSER_IMPLEMENTATION_REPORT.md` | Implementation details |

## References

- [NumPy .npy format](https://numpy.org/devdocs/reference/generated/numpy.lib.format.html)
- [VGGT integration notes](/Users/neil/projects/unsplash-clustering/_DOCS/vggt_integration_notes.md)
- [Three.js camera docs](https://threejs.org/docs/#api/en/cameras/Camera)

---

**Quick Start:** `bun run test-npz-full.ts` to verify installation
