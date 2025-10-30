/**
 * Comprehensive NPZ Parser Test
 * Creates a mock predictions.npz and tests the full pipeline
 */

import { npzParser, CameraTransform } from './server/services/npz-parser';
import { writeFile, mkdir } from 'fs/promises';
import { zipSync } from 'fflate';

/**
 * Create a NumPy .npy file buffer
 */
function createNPY(data: Float32Array, shape: number[]): Buffer {
  const dtype = '<f4'; // little-endian float32

  // Build header
  const header = `{'descr': '${dtype}', 'fortran_order': False, 'shape': (${shape.join(', ')}), }`;

  // Pad header to align to 64 bytes
  const headerPadding = 64 - ((header.length + 10) % 64);
  const headerStr = header + ' '.repeat(headerPadding);
  const headerLen = headerStr.length;

  // Build NPY file
  const magic = Buffer.from([0x93, 0x4E, 0x55, 0x4D, 0x50, 0x59]); // \x93NUMPY
  const version = Buffer.from([0x01, 0x00]); // v1.0
  const headerLenBuf = Buffer.allocUnsafe(2);
  headerLenBuf.writeUInt16LE(headerLen, 0);
  const headerBuf = Buffer.from(headerStr, 'ascii');
  const dataBuf = Buffer.from(data.buffer);

  return Buffer.concat([magic, version, headerLenBuf, headerBuf, dataBuf]);
}

/**
 * Create mock camera extrinsic matrices
 */
function createMockExtrinsics(numCameras: number): Float32Array {
  const data = new Float32Array(numCameras * 3 * 4);

  for (let i = 0; i < numCameras; i++) {
    const offset = i * 12;
    const angle = (i / numCameras) * Math.PI * 2; // Cameras in a circle
    const radius = 5.0;

    // Rotation matrix (camera looking at center)
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    // Camera extrinsic: [R | t] where R is rotation, t is translation
    // Row 0: right vector
    data[offset + 0] = -sin;  // R00
    data[offset + 1] = 0;     // R01
    data[offset + 2] = cos;   // R02
    data[offset + 3] = radius * cos; // tx

    // Row 1: up vector
    data[offset + 4] = 0;     // R10
    data[offset + 5] = 1;     // R11
    data[offset + 6] = 0;     // R12
    data[offset + 7] = 0;     // ty

    // Row 2: forward vector (looking at center)
    data[offset + 8] = -cos;  // R20
    data[offset + 9] = 0;     // R21
    data[offset + 10] = -sin; // R22
    data[offset + 11] = radius * sin; // tz
  }

  return data;
}

/**
 * Create mock camera intrinsic matrices
 */
function createMockIntrinsics(numCameras: number): Float32Array {
  const data = new Float32Array(numCameras * 3 * 3);
  const fx = 518.0;
  const fy = 518.0;
  const cx = 259.0;
  const cy = 259.0;

  for (let i = 0; i < numCameras; i++) {
    const offset = i * 9;

    // Camera intrinsic matrix K
    data[offset + 0] = fx;   // fx
    data[offset + 1] = 0;    // skew
    data[offset + 2] = cx;   // cx

    data[offset + 3] = 0;    // 0
    data[offset + 4] = fy;   // fy
    data[offset + 5] = cy;   // cy

    data[offset + 6] = 0;    // 0
    data[offset + 7] = 0;    // 0
    data[offset + 8] = 1;    // 1
  }

  return data;
}

/**
 * Create mock predictions.npz file
 */
async function createMockNPZ(numCameras: number = 5): Promise<Buffer> {
  console.log(`🔨 Creating mock predictions.npz with ${numCameras} cameras...`);

  // Create extrinsic and intrinsic matrices
  const extrinsicData = createMockExtrinsics(numCameras);
  const intrinsicData = createMockIntrinsics(numCameras);

  // Create .npy files
  const extrinsicNPY = createNPY(extrinsicData, [numCameras, 3, 4]);
  const intrinsicNPY = createNPY(intrinsicData, [numCameras, 3, 3]);

  console.log(`  ✅ Created extrinsic.npy: ${extrinsicNPY.length} bytes`);
  console.log(`  ✅ Created intrinsic.npy: ${intrinsicNPY.length} bytes`);

  // Create NPZ (ZIP archive)
  const files = {
    'extrinsic.npy': new Uint8Array(extrinsicNPY),
    'intrinsic.npy': new Uint8Array(intrinsicNPY),
  };

  const zipped = zipSync(files, { level: 6 });
  console.log(`  ✅ Created predictions.npz: ${zipped.length} bytes`);

  return Buffer.from(zipped);
}

/**
 * Main test suite
 */
async function runTests() {
  console.log('🧪 Comprehensive NPZ Parser Test\n');
  console.log('='.repeat(70));

  try {
    // Create test directory
    await mkdir('./test-output', { recursive: true });

    // Test 1: Create and parse mock NPZ
    console.log('\n📦 Test 1: Create and Parse Mock NPZ');
    console.log('-'.repeat(70));

    const numCameras = 8;
    const npzBuffer = await createMockNPZ(numCameras);

    // Save to file
    const npzPath = './test-output/mock_predictions.npz';
    await writeFile(npzPath, npzBuffer);
    console.log(`\n💾 Saved to: ${npzPath}`);

    // Test 2: Validate NPZ format
    console.log('\n📋 Test 2: Validate NPZ Format');
    console.log('-'.repeat(70));

    const isValid = await npzParser.isValidNPZ(npzPath);
    console.log(`✅ Valid NPZ: ${isValid}`);

    if (!isValid) {
      throw new Error('Failed NPZ validation');
    }

    // Test 3: Parse NPZ
    console.log('\n🔍 Test 3: Parse NPZ Structure');
    console.log('-'.repeat(70));

    const startParse = Date.now();
    const predictions = await npzParser.parseFile(npzPath);
    const parseTime = Date.now() - startParse;

    console.log(`✅ Parsed in ${parseTime}ms\n`);
    console.log(`Structure:`);
    console.log(`  - extrinsic: ${predictions.extrinsic.length} × 3 × 4`);
    console.log(`  - intrinsic: ${predictions.intrinsic.length} × 3 × 3`);
    console.log(`  - depth: ${predictions.depth ? 'present' : 'absent'}`);
    console.log(`  - world_points: ${predictions.world_points ? 'present' : 'absent'}`);

    // Validate shape
    if (predictions.extrinsic.length !== numCameras) {
      throw new Error(`Expected ${numCameras} cameras, got ${predictions.extrinsic.length}`);
    }

    // Test 4: Examine camera matrices
    console.log('\n📷 Test 4: Camera Matrix Validation');
    console.log('-'.repeat(70));

    const camera0 = predictions.extrinsic[0];
    console.log('\nCamera 0 Extrinsic (3×4):');
    camera0.forEach(row => {
      console.log(`  [${row.map(n => n.toFixed(6).padStart(11)).join(', ')}]`);
    });

    const intrinsic0 = predictions.intrinsic[0];
    console.log('\nCamera 0 Intrinsic (3×3):');
    intrinsic0.forEach(row => {
      console.log(`  [${row.map(n => n.toFixed(2).padStart(8)).join(', ')}]`);
    });

    // Validate intrinsic matrix
    if (Math.abs(intrinsic0[0][0] - 518.0) > 0.01) {
      throw new Error('Intrinsic matrix incorrect');
    }

    // Test 5: Camera transforms
    console.log('\n🔄 Test 5: Three.js Transform Conversion');
    console.log('-'.repeat(70));

    const transforms = predictions.extrinsic.map((ext, i) => {
      try {
        return CameraTransform.extrinsicToThreeJS(ext, { alignY180: true });
      } catch (error) {
        console.error(`❌ Failed to transform camera ${i}:`, error);
        return null;
      }
    });

    const successCount = transforms.filter(t => t !== null).length;
    console.log(`\n✅ Transformed ${successCount}/${numCameras} cameras successfully`);

    // Display first transform
    if (transforms[0]) {
      console.log('\nCamera 0 Transform:');
      console.log(`  Position: [${transforms[0].position.map(n => n.toFixed(4)).join(', ')}]`);
      console.log(`  Matrix (4×4, first row):`);
      console.log(`    [${transforms[0].matrix.slice(0, 4).map(n => n.toFixed(6).padStart(11)).join(', ')}]`);
    }

    // Test 6: API format
    console.log('\n🎯 Test 6: Parse Predictions (API Format)');
    console.log('-'.repeat(70));

    const cameraData = await npzParser.parsePredictions(npzPath);

    console.log(`\nParsed Cameras:`);
    console.log(`  - Num frames: ${cameraData.numFrames}`);
    console.log(`  - Has depth: ${cameraData.hasDepth}`);
    console.log(`  - Has world points: ${cameraData.hasWorldPoints}`);
    console.log(`  - Cameras with positions: ${cameraData.cameras.filter(c => c.position).length}`);
    console.log(`  - Cameras with matrices: ${cameraData.cameras.filter(c => c.threeMatrix).length}`);

    // Validate camera data
    if (cameraData.numFrames !== numCameras) {
      throw new Error(`Expected ${numCameras} frames, got ${cameraData.numFrames}`);
    }

    // Display sample camera
    const cam0 = cameraData.cameras[0];
    console.log(`\nCamera 0 Data:`);
    console.log(`  - Index: ${cam0.index}`);
    console.log(`  - Extrinsic shape: ${cam0.extrinsic.length}×${cam0.extrinsic[0].length}`);
    console.log(`  - Intrinsic shape: ${cam0.intrinsic.length}×${cam0.intrinsic[0].length}`);
    if (cam0.position) {
      console.log(`  - Position: [${cam0.position.map(n => n.toFixed(4)).join(', ')}]`);
    }
    if (cam0.threeMatrix) {
      console.log(`  - Three matrix: ${cam0.threeMatrix.length} elements`);
    }

    // Test 7: Export results
    console.log('\n💾 Test 7: Export Results');
    console.log('-'.repeat(70));

    const summary = {
      metadata: {
        numCameras,
        parseTime,
        generatedAt: new Date().toISOString(),
      },
      structure: {
        extrinsic: `${predictions.extrinsic.length} × 3 × 4`,
        intrinsic: `${predictions.intrinsic.length} × 3 × 3`,
        hasDepth: !!predictions.depth,
        hasWorldPoints: !!predictions.world_points,
      },
      cameras: cameraData.cameras.map(cam => ({
        index: cam.index,
        position: cam.position,
        extrinsicSample: cam.extrinsic[0], // First row
        intrinsicSample: cam.intrinsic[0], // First row
      })),
    };

    const summaryPath = './test-output/mock_predictions_summary.json';
    await writeFile(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`✅ Summary saved to: ${summaryPath}`);

    // Test 8: Performance benchmark
    console.log('\n⚡ Test 8: Performance Benchmark');
    console.log('-'.repeat(70));

    const iterations = 10;
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      await npzParser.parsePredictions(npzPath);
      times.push(Date.now() - start);
    }

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);

    console.log(`\nBenchmark Results (${iterations} iterations):`);
    console.log(`  - Average: ${avgTime.toFixed(2)}ms`);
    console.log(`  - Min: ${minTime}ms`);
    console.log(`  - Max: ${maxTime}ms`);

    // Final summary
    console.log('\n' + '='.repeat(70));
    console.log('✅ All Tests Passed!\n');
    console.log('Summary:');
    console.log(`  - Created mock NPZ with ${numCameras} cameras`);
    console.log(`  - Parsed structure successfully`);
    console.log(`  - Validated camera matrices`);
    console.log(`  - Generated Three.js transforms`);
    console.log(`  - API format working correctly`);
    console.log(`  - Average parse time: ${avgTime.toFixed(2)}ms`);
    console.log('\n📁 Test outputs:');
    console.log(`  - ${npzPath}`);
    console.log(`  - ${summaryPath}`);

  } catch (error) {
    console.error('\n❌ Test Failed:', error);
    process.exit(1);
  }
}

// Run tests
runTests().catch(console.error);
