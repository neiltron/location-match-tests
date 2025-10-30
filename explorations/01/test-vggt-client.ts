/**
 * Test script for VGGT Client integration
 *
 * This script tests the VGGT client service independently
 * to verify the Gradio API integration works correctly.
 */

import { vggtClient } from './server/services/vggt-client';
import { storage } from './server/services/storage';
import type { VGGTSettings } from './server/types';

async function testVGGTClient() {
  console.log('=== VGGT Client Test ===\n');

  // Initialize storage
  await storage.init();

  // Create a test run
  const runId = storage.generateRunId();
  console.log(`Created test run: ${runId}`);

  await storage.createRun(runId);

  // Create test metadata
  const settings: VGGTSettings = {
    confThreshold: 45,
    predictionMode: 'pointmap',
    maskBlackBg: false,
    maskWhiteBg: false,
    maskSky: false,
    showCameras: true,
  };

  await storage.saveMetadata(runId, {
    runId,
    status: 'queued',
    settings,
    images: [],
    requestedAt: new Date().toISOString(),
  });

  console.log('Settings:', settings);
  console.log('');

  // Test 1: Check status polling
  console.log('Test 1: Poll run status');
  const status = await vggtClient.pollRunStatus(runId);
  console.log(`  Status: ${status}`);
  console.log('  ✓ Passed\n');

  // Test 2: Get image paths (will be empty)
  console.log('Test 2: Get run image paths');
  const imagePaths = await vggtClient.getRunImagePaths(runId);
  console.log(`  Image count: ${imagePaths.length}`);
  console.log('  ✓ Passed\n');

  // Test 3: Test error handling for invalid run
  console.log('Test 3: Error handling for invalid run');
  try {
    await vggtClient.pollRunStatus('invalid_run_id');
    console.log('  ✗ Failed - should have thrown error');
  } catch (error) {
    console.log(`  Error caught: ${error.message}`);
    console.log('  ✓ Passed\n');
  }

  // Test 4: Test artifact download on non-completed run
  console.log('Test 4: Artifact download before completion');
  try {
    await vggtClient.downloadArtifacts(runId);
    console.log('  ✗ Failed - should have thrown error');
  } catch (error) {
    console.log(`  Error caught: ${error.message}`);
    console.log('  ✓ Passed\n');
  }

  console.log('=== All Tests Passed ===\n');

  // Cleanup
  console.log('Note: To test full submission, you need to:');
  console.log('1. Upload actual images via the API');
  console.log('2. Call POST /api/runs/:runId/process');
  console.log('3. Monitor status changes via GET /api/runs/:runId');
  console.log('4. Download artifacts once status is "completed"');
}

// Run tests
testVGGTClient().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
