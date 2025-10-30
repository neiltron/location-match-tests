/**
 * Test script for NPZ parser
 * Tests the pure TypeScript NPZ parser implementation
 */

import { npzParser, NPZParserError, CameraTransform } from './server/services/npz-parser';
import { writeFile } from 'fs/promises';

async function testNPZParser() {
  console.log('🧪 NPZ Parser Test Suite\n');
  console.log('=' .repeat(60));

  // Test 1: Parse a predictions.npz file (if available)
  console.log('\n📦 Test 1: Parse predictions.npz file');
  console.log('-'.repeat(60));

  const testFile = process.argv[2];

  if (!testFile) {
    console.log('ℹ️  No NPZ file provided');
    console.log('Usage: bun test-npz-parser.ts <path-to-predictions.npz>');
    console.log('\n💡 Creating mock NPY data for testing...');
    await testMockNPY();
    return;
  }

  try {
    console.log(`📂 Loading: ${testFile}`);

    // Check if file is valid NPZ
    const isValid = await npzParser.isValidNPZ(testFile);
    console.log(`✅ Valid NPZ format: ${isValid}`);

    if (!isValid) {
      console.log('❌ File is not a valid NPZ archive');
      return;
    }

    // Parse the file
    console.log('\n🔍 Parsing predictions...');
    const startTime = Date.now();
    const predictions = await npzParser.parseFile(testFile);
    const parseTime = Date.now() - startTime;

    console.log(`✅ Parsed in ${parseTime}ms`);

    // Display structure
    console.log('\n📊 NPZ Structure:');
    console.log(`  - extrinsic: ${predictions.extrinsic.length} cameras × 3 × 4`);
    console.log(`  - intrinsic: ${predictions.intrinsic.length} cameras × 3 × 3`);
    console.log(`  - depth: ${predictions.depth ? 'present' : 'absent'}`);
    console.log(`  - world_points: ${predictions.world_points ? 'present' : 'absent'}`);
    console.log(`  - images: ${predictions.images ? 'present' : 'absent'}`);

    // Sample extrinsic matrix
    console.log('\n📷 Sample Camera 0:');
    console.log('  Extrinsic (3×4):');
    predictions.extrinsic[0].forEach((row, i) => {
      console.log(`    [${row.map(n => n.toFixed(6).padStart(12)).join(', ')}]`);
    });

    console.log('\n  Intrinsic (3×3):');
    predictions.intrinsic[0].forEach((row, i) => {
      console.log(`    [${row.map(n => n.toFixed(6).padStart(12)).join(', ')}]`);
    });

    // Test camera transform
    console.log('\n🔄 Testing Three.js Transform:');
    try {
      const transform = CameraTransform.extrinsicToThreeJS(
        predictions.extrinsic[0],
        { alignY180: true }
      );

      console.log(`  Position: [${transform.position.map(n => n.toFixed(4)).join(', ')}]`);
      console.log(`  Matrix (4×4 column-major):`);
      for (let i = 0; i < 4; i++) {
        const row = [];
        for (let j = 0; j < 4; j++) {
          row.push(transform.matrix[j * 4 + i]); // Convert column-major to row-major for display
        }
        console.log(`    [${row.map(n => n.toFixed(6).padStart(12)).join(', ')}]`);
      }
    } catch (error) {
      console.log(`  ⚠️  Transform failed: ${error}`);
    }

    // Test parsePredictions (with Three.js transforms)
    console.log('\n🎯 Testing parsePredictions (API format):');
    const cameraData = await npzParser.parsePredictions(testFile);

    console.log(`  Num frames: ${cameraData.numFrames}`);
    console.log(`  Has depth: ${cameraData.hasDepth}`);
    console.log(`  Has world points: ${cameraData.hasWorldPoints}`);

    if (cameraData.cameras.length > 0) {
      const cam0 = cameraData.cameras[0];
      console.log('\n  Camera 0:');
      console.log(`    Index: ${cam0.index}`);
      console.log(`    Extrinsic shape: ${cam0.extrinsic.length}×${cam0.extrinsic[0].length}`);
      console.log(`    Intrinsic shape: ${cam0.intrinsic.length}×${cam0.intrinsic[0].length}`);
      if (cam0.position) {
        console.log(`    Position: [${cam0.position.map(n => n.toFixed(4)).join(', ')}]`);
      }
      if (cam0.threeMatrix) {
        console.log(`    Three.js matrix: ${cam0.threeMatrix.length} elements`);
      }
    }

    // Save summary
    const summary = {
      parseTime,
      numFrames: predictions.extrinsic.length,
      structure: {
        extrinsic: `${predictions.extrinsic.length} × 3 × 4`,
        intrinsic: `${predictions.intrinsic.length} × 3 × 3`,
        hasDepth: !!predictions.depth,
        hasWorldPoints: !!predictions.world_points,
        hasImages: !!predictions.images,
      },
      sampleCamera: {
        extrinsic: predictions.extrinsic[0],
        intrinsic: predictions.intrinsic[0],
      },
    };

    const summaryPath = testFile.replace('.npz', '_summary.json');
    await writeFile(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`\n💾 Summary saved to: ${summaryPath}`);

    console.log('\n✅ All tests passed!');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    if (error instanceof NPZParserError) {
      console.error(`   Code: ${error.code}`);
    }
    process.exit(1);
  }
}

/**
 * Test with mock NPY data
 */
async function testMockNPY() {
  console.log('\n🔬 Testing NPY parser with mock data...');

  // Create a mock .npy file (3x4 matrix of float32)
  const shape = [3, 4];
  const dtype = '<f4'; // little-endian float32
  const data = new Float32Array([
    1.0, 2.0, 3.0, 4.0,
    5.0, 6.0, 7.0, 8.0,
    9.0, 10.0, 11.0, 12.0,
  ]);

  // Build NPY header
  const header = `{'descr': '${dtype}', 'fortran_order': False, 'shape': (${shape.join(', ')}), }`;
  const headerPadding = 64 - ((header.length + 10) % 64); // Align to 64 bytes
  const headerStr = header + ' '.repeat(headerPadding);
  const headerLen = headerStr.length;

  // Build NPY file
  const magic = Buffer.from([0x93, 0x4E, 0x55, 0x4D, 0x50, 0x59]); // \x93NUMPY
  const version = Buffer.from([0x01, 0x00]); // v1.0
  const headerLenBuf = Buffer.allocUnsafe(2);
  headerLenBuf.writeUInt16LE(headerLen, 0);
  const headerBuf = Buffer.from(headerStr, 'ascii');
  const dataBuf = Buffer.from(data.buffer);

  const npyBuffer = Buffer.concat([magic, version, headerLenBuf, headerBuf, dataBuf]);

  console.log(`📝 Mock NPY: ${shape[0]}×${shape[1]} ${dtype}`);
  console.log(`   Total size: ${npyBuffer.length} bytes`);

  // Parse it
  try {
    const result = npzParser.parseNPY(npyBuffer);
    console.log(`✅ Parsed successfully`);
    console.log(`   Shape: [${result.shape.join(', ')}]`);
    console.log(`   Dtype: ${result.dtype}`);
    console.log(`   Data length: ${result.data.length}`);
    console.log(`   Fortran order: ${result.fortranOrder}`);

    // Display data
    console.log(`\n   Data (first 12 elements):`);
    for (let i = 0; i < Math.min(12, result.data.length); i++) {
      if (i % 4 === 0) process.stdout.write('\n    ');
      process.stdout.write(result.data[i].toFixed(2).padStart(8));
    }
    console.log('\n');

    console.log('✅ Mock NPY test passed!');
  } catch (error) {
    console.error('❌ Mock NPY test failed:', error);
    throw error;
  }
}

// Run tests
testNPZParser().catch(console.error);
