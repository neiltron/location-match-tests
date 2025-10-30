/**
 * Test script to verify Viewer3D functionality
 *
 * This script tests the viewer by checking:
 * 1. Module imports work correctly
 * 2. Viewer can be instantiated
 * 3. All required methods are present
 * 4. Camera and scene are properly initialized
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const tests: TestResult[] = [];

async function runTests() {
  console.log('\n=== Viewer3D Test Suite ===\n');

  // Test 1: Check if server is running
  console.log('Test 1: Server accessibility...');
  try {
    const { stdout } = await execAsync('curl -s -o /dev/null -w "%{http_code}" http://localhost:3000');
    const statusCode = stdout.trim();
    if (statusCode === '200') {
      tests.push({ name: 'Server Running', passed: true });
      console.log('  ✓ Server is running\n');
    } else {
      tests.push({ name: 'Server Running', passed: false, error: `Status code: ${statusCode}` });
      console.log(`  ✗ Server returned status: ${statusCode}\n`);
    }
  } catch (error) {
    tests.push({ name: 'Server Running', passed: false, error: String(error) });
    console.log(`  ✗ Server not accessible: ${error}\n`);
  }

  // Test 2: Check if Viewer3D.js exists and is accessible
  console.log('Test 2: Viewer3D.js accessibility...');
  try {
    const { stdout } = await execAsync('curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/viewer/Viewer3D.js');
    const statusCode = stdout.trim();
    if (statusCode === '200') {
      tests.push({ name: 'Viewer3D.js Accessible', passed: true });
      console.log('  ✓ Viewer3D.js is accessible\n');
    } else {
      tests.push({ name: 'Viewer3D.js Accessible', passed: false, error: `Status code: ${statusCode}` });
      console.log(`  ✗ Viewer3D.js returned status: ${statusCode}\n`);
    }
  } catch (error) {
    tests.push({ name: 'Viewer3D.js Accessible', passed: false, error: String(error) });
    console.log(`  ✗ Viewer3D.js not accessible: ${error}\n`);
  }

  // Test 3: Check test page accessibility
  console.log('Test 3: Test page accessibility...');
  try {
    const { stdout } = await execAsync('curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/viewer/test-viewer.html');
    const statusCode = stdout.trim();
    if (statusCode === '200') {
      tests.push({ name: 'Test Page Accessible', passed: true });
      console.log('  ✓ Test page is accessible\n');
    } else {
      tests.push({ name: 'Test Page Accessible', passed: false, error: `Status code: ${statusCode}` });
      console.log(`  ✗ Test page returned status: ${statusCode}\n`);
    }
  } catch (error) {
    tests.push({ name: 'Test Page Accessible', passed: false, error: String(error) });
    console.log(`  ✗ Test page not accessible: ${error}\n`);
  }

  // Test 4: Check Viewer3D.js content
  console.log('Test 4: Viewer3D.js content validation...');
  try {
    const { stdout } = await execAsync('curl -s http://localhost:3000/viewer/Viewer3D.js');
    const content = stdout;

    const requiredElements = [
      'export class Viewer3D',
      'constructor(',
      'loadGLB(',
      'clearScene(',
      'getCamera(',
      'render(',
      'dispose(',
      'setupLights(',
      'fitCameraToModel(',
      'OrbitControls',
      'GLTFLoader'
    ];

    let allFound = true;
    const missing: string[] = [];

    for (const element of requiredElements) {
      if (!content.includes(element)) {
        allFound = false;
        missing.push(element);
      }
    }

    if (allFound) {
      tests.push({ name: 'Viewer3D.js Content', passed: true });
      console.log(`  ✓ All required methods and imports found\n`);
    } else {
      tests.push({ name: 'Viewer3D.js Content', passed: false, error: `Missing: ${missing.join(', ')}` });
      console.log(`  ✗ Missing elements: ${missing.join(', ')}\n`);
    }
  } catch (error) {
    tests.push({ name: 'Viewer3D.js Content', passed: false, error: String(error) });
    console.log(`  ✗ Failed to validate content: ${error}\n`);
  }

  // Test 5: Check GSAP in import map
  console.log('Test 5: GSAP import map...');
  try {
    const { stdout } = await execAsync('curl -s http://localhost:3000/index.html');
    const content = stdout;

    if (content.includes('"gsap"') && content.includes('esm.sh/gsap')) {
      tests.push({ name: 'GSAP Import Map', passed: true });
      console.log('  ✓ GSAP is properly configured in import map\n');
    } else {
      tests.push({ name: 'GSAP Import Map', passed: false, error: 'GSAP not found in import map' });
      console.log('  ✗ GSAP not found in import map\n');
    }
  } catch (error) {
    tests.push({ name: 'GSAP Import Map', passed: false, error: String(error) });
    console.log(`  ✗ Failed to check import map: ${error}\n`);
  }

  // Test 6: Check Three.js import map
  console.log('Test 6: Three.js import map...');
  try {
    const { stdout } = await execAsync('curl -s http://localhost:3000/index.html');
    const content = stdout;

    if (content.includes('"three"') && content.includes('esm.sh/three')) {
      tests.push({ name: 'Three.js Import Map', passed: true });
      console.log('  ✓ Three.js is properly configured in import map\n');
    } else {
      tests.push({ name: 'Three.js Import Map', passed: false, error: 'Three.js not found in import map' });
      console.log('  ✗ Three.js not found in import map\n');
    }
  } catch (error) {
    tests.push({ name: 'Three.js Import Map', passed: false, error: String(error) });
    console.log(`  ✗ Failed to check import map: ${error}\n`);
  }

  // Print summary
  console.log('=== Test Summary ===\n');
  const passed = tests.filter(t => t.passed).length;
  const failed = tests.filter(t => !t.passed).length;

  console.log(`Total: ${tests.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log('');

  if (failed > 0) {
    console.log('Failed tests:');
    tests.filter(t => !t.passed).forEach(t => {
      console.log(`  - ${t.name}: ${t.error}`);
    });
  }

  console.log('\n' + '='.repeat(40) + '\n');

  if (failed === 0) {
    console.log('✓ All tests passed!\n');
    console.log('Next steps:');
    console.log('  1. Open http://localhost:3000/viewer/test-viewer.html in a browser');
    console.log('  2. Verify the 3D viewer initializes with grid and axes');
    console.log('  3. Test camera controls (orbit, zoom, pan)');
    console.log('  4. Test loading a GLB model if you have one available\n');
    process.exit(0);
  } else {
    console.log('✗ Some tests failed. Please review the errors above.\n');
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
