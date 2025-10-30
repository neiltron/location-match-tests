/**
 * CameraTransforms.test.ts
 *
 * Example usage and test cases for camera transform conversion
 */

import * as THREE from 'three';
import { CameraTransforms, CameraData } from './CameraTransforms';

/**
 * Example 1: Basic transform conversion
 *
 * Shows how to convert a single camera's extrinsic matrix to Three.js
 */
export function example_basicTransform() {
  console.log('=== Example 1: Basic Transform Conversion ===');

  // Example extrinsic matrix (3×4, world→camera, OpenCV convention)
  // This is a camera looking at origin from position [2, 1, 3]
  const extrinsic = [
    [0.866, -0.289, 0.408, -2.0],
    [0.000,  0.816, 0.577, -1.0],
    [-0.500, -0.500, 0.707, -3.0]
  ];

  // Convert to Three.js matrix
  const threeMatrix = CameraTransforms.extrinsicToThreeMatrix(extrinsic);

  // Extract position and rotation
  const { position, quaternion } = CameraTransforms.getPositionAndRotation(threeMatrix);

  console.log('Camera position:', position.toArray());
  console.log('Camera quaternion:', quaternion.toArray());
  console.log('Transform matrix:');
  console.log(threeMatrix.toArray());

  return { position, quaternion, threeMatrix };
}

/**
 * Example 2: FOV extraction from intrinsic matrix
 *
 * Shows how to compute field of view from camera intrinsics
 */
export function example_extractFOV() {
  console.log('\n=== Example 2: FOV Extraction ===');

  // Example intrinsic matrix (3×3)
  // fx, fy = focal lengths, cx, cy = principal point
  const intrinsic = [
    [400, 0, 259],  // fx, 0, cx
    [0, 400, 259],  // 0, fy, cy
    [0, 0, 1]       // 0, 0, 1
  ];

  const imageHeight = 518; // VGGT default
  const fov = CameraTransforms.getFOVFromIntrinsic(intrinsic, imageHeight);

  console.log(`Focal length (fy): ${intrinsic[1][1]}`);
  console.log(`Image height: ${imageHeight}`);
  console.log(`Computed FOV: ${fov.toFixed(2)}°`);

  return fov;
}

/**
 * Example 3: Create a single frustum mesh
 *
 * Shows how to create a visualization mesh for one camera
 */
export function example_createFrustum() {
  console.log('\n=== Example 3: Create Frustum Mesh ===');

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

  const frustum = CameraTransforms.createFrustumMesh(
    cameraData,
    0x00ff00,    // Green color
    'Camera 0',
    1.0          // Scale
  );

  console.log(`Created frustum: ${frustum.name}`);
  console.log(`Children: ${frustum.children.length}`);
  console.log(`Metadata:`, frustum.userData);

  return frustum;
}

/**
 * Example 4: Parse NPZ predictions and create all frustums
 *
 * Shows the full workflow from predictions.npz to scene visualization
 */
export function example_fullPipeline() {
  console.log('\n=== Example 4: Full Pipeline (Mock NPZ Data) ===');

  // Mock predictions.npz structure (normally loaded from file)
  const mockPredictions = {
    extrinsic: [
      // Camera 0: origin, identity rotation
      [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0]
      ],
      // Camera 1: offset in X
      [
        [1, 0, 0, 3],
        [0, 1, 0, 0],
        [0, 0, 1, 0]
      ],
      // Camera 2: offset in Y and Z
      [
        [1, 0, 0, 0],
        [0, 1, 0, 2],
        [0, 0, 1, 4]
      ]
    ],
    intrinsic: [
      [
        [400, 0, 259],
        [0, 400, 259],
        [0, 0, 1]
      ],
      [
        [400, 0, 259],
        [0, 400, 259],
        [0, 0, 1]
      ],
      [
        [400, 0, 259],
        [0, 400, 259],
        [0, 0, 1]
      ]
    ]
  };

  // Parse cameras
  const { cameras, numFrames } = CameraTransforms.parseNPZCameras(mockPredictions);
  console.log(`Parsed ${numFrames} cameras`);

  // Create all frustums
  const frustums = CameraTransforms.createAllFrustums(cameras, 1.0);
  console.log(`Created ${frustums.length} frustum meshes`);

  // Calculate scene bounds
  const bounds = CameraTransforms.calculateSceneBounds(cameras);
  console.log('Scene bounds:');
  console.log('  Min:', bounds.min.toArray());
  console.log('  Max:', bounds.max.toArray());
  console.log('  Center:', bounds.getCenter(new THREE.Vector3()).toArray());
  console.log('  Size:', bounds.getSize(new THREE.Vector3()).toArray());

  return { cameras, frustums, bounds };
}

/**
 * Example 5: Create Three.js camera from camera data
 *
 * Shows how to create a renderable camera that matches the reconstructed camera
 */
export function example_createRenderCamera() {
  console.log('\n=== Example 5: Create Three.js Camera ===');

  const cameraData: CameraData = {
    extrinsic: [
      [0.866, 0.500, 0.000, -2.0],
      [-0.500, 0.866, 0.000, -1.0],
      [0.000, 0.000, 1.000, -5.0]
    ],
    intrinsic: [
      [400, 0, 259],
      [0, 400, 259],
      [0, 0, 1]
    ],
    imageIndex: 0
  };

  const camera = CameraTransforms.createThreeCamera(cameraData, 16/9);

  console.log('Camera FOV:', camera.fov);
  console.log('Camera aspect:', camera.aspect);
  console.log('Camera position:', camera.position.toArray());
  console.log('Camera rotation (euler):', camera.rotation.toArray().slice(0, 3));

  return camera;
}

/**
 * Example 6: Matrix math validation
 *
 * Validates the transform pipeline step by step
 */
export function example_matrixMathValidation() {
  console.log('\n=== Example 6: Matrix Math Validation ===');

  // Simple test case: camera at [0, 0, 5] looking at origin
  const extrinsic = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, -5]  // Translation in camera space (camera is at +5 in world space)
  ];

  // Step 1: Build 4×4 homogeneous matrix
  const worldToCam = new THREE.Matrix4();
  worldToCam.set(
    extrinsic[0][0], extrinsic[0][1], extrinsic[0][2], extrinsic[0][3],
    extrinsic[1][0], extrinsic[1][1], extrinsic[1][2], extrinsic[1][3],
    extrinsic[2][0], extrinsic[2][1], extrinsic[2][2], extrinsic[2][3],
    0, 0, 0, 1
  );
  console.log('Step 1 - World→Camera matrix:');
  console.log(worldToCam.toArray());

  // Step 2: Invert to get camera→world
  const camToWorld = worldToCam.clone().invert();
  console.log('\nStep 2 - Camera→World matrix (inverted):');
  console.log(camToWorld.toArray());

  // Extract position from inverted matrix
  const position = new THREE.Vector3();
  position.setFromMatrixPosition(camToWorld);
  console.log('Extracted position:', position.toArray());
  console.log('Expected: [0, 0, 5]');

  // Step 3: Apply OpenGL fix
  const openglFix = new THREE.Matrix4().set(
    1,  0,  0, 0,
    0, -1,  0, 0,
    0,  0, -1, 0,
    0,  0,  0, 1
  );
  const withOpenGL = camToWorld.clone().multiply(openglFix);
  console.log('\nStep 3 - With OpenGL fix (flip Y, Z):');
  console.log(withOpenGL.toArray());

  // Step 4: Apply 180° Y rotation
  const alignY180 = new THREE.Matrix4().set(
    -1, 0,  0, 0,
     0, 1,  0, 0,
     0, 0, -1, 0,
     0, 0,  0, 1
  );
  const final = withOpenGL.clone().multiply(alignY180);
  console.log('\nStep 4 - Final matrix (with Y180):');
  console.log(final.toArray());

  // Final position
  const finalPos = new THREE.Vector3();
  finalPos.setFromMatrixPosition(final);
  console.log('Final position:', finalPos.toArray());

  return { worldToCam, camToWorld, withOpenGL, final };
}

/**
 * Example 7: Color distribution for multiple cameras
 *
 * Shows how colors are distributed across cameras for visual distinction
 */
export function example_colorDistribution() {
  console.log('\n=== Example 7: Color Distribution ===');

  const numCameras = 10;
  const colors: string[] = [];

  for (let i = 0; i < numCameras; i++) {
    const hue = (i / numCameras) * 360;
    const color = new THREE.Color().setHSL(hue / 360, 0.8, 0.5);
    colors.push(`#${color.getHexString()}`);
  }

  console.log('Color palette for 10 cameras:');
  colors.forEach((color, i) => {
    console.log(`  Camera ${i}: ${color}`);
  });

  return colors;
}

/**
 * Run all examples
 */
export function runAllExamples() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     CameraTransforms.ts - Usage Examples & Validation     ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  example_basicTransform();
  example_extractFOV();
  example_createFrustum();
  example_fullPipeline();
  example_createRenderCamera();
  example_matrixMathValidation();
  example_colorDistribution();

  console.log('\n✅ All examples completed successfully!');
}

// Run examples if executed directly
if (typeof window === 'undefined') {
  // Node.js environment
  runAllExamples();
}
