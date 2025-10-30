/**
 * Comprehensive VGGT Integration Test
 *
 * Prerequisites:
 * - .env file with HF_TOKEN set (Bun auto-loads .env)
 * - HF_TOKEN must have access to neiltron/vggt private space
 *
 * Tests the complete VGGT workflow:
 * 1. Check HuggingFace space availability
 * 2. Upload test images
 * 3. Submit to VGGT
 * 4. Poll for completion
 * 5. Download artifacts
 * 6. Verify GLB file
 */

import { vggtClient, VGGTClientError } from "./server/services/vggt-client";
import { storage } from "./server/services/storage";
import type { VGGTSettings, RunStatus } from "./server/types";
import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { Client } from "@gradio/client";

// Configuration
const TEST_IMAGES_DIR = "./storage/test_images";
const MAX_POLL_ATTEMPTS = 120; // 10 minutes at 5s intervals
const POLL_INTERVAL_MS = 5000;

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: any;
}

const results: TestResult[] = [];

function log(
  message: string,
  level: "info" | "success" | "error" | "warn" = "info",
) {
  const symbols = {
    info: "ℹ",
    success: "✓",
    error: "✗",
    warn: "⚠",
  };
  console.log(`${symbols[level]} ${message}`);
}

async function runTest(
  name: string,
  fn: () => Promise<any>,
): Promise<TestResult> {
  log(`\nTest: ${name}`, "info");
  const startTime = Date.now();

  try {
    const details = await fn();
    const duration = Date.now() - startTime;

    log(`Passed in ${duration}ms`, "success");

    const result: TestResult = { name, passed: true, duration, details };
    results.push(result);
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    log(`Failed: ${errorMessage}`, "error");

    const result: TestResult = {
      name,
      passed: false,
      duration,
      error: errorMessage,
    };
    results.push(result);
    return result;
  }
}

async function testHuggingFaceConnection(): Promise<any> {
  log("Attempting to connect to neiltron/vggt space...", "info");

  const hfToken = process.env.HF_TOKEN;
  if (!hfToken) {
    throw new Error("HF_TOKEN environment variable not set");
  }

  const client = await Client.connect("neiltron/vggt", {
    token: hfToken,
  });

  log("Connected to HuggingFace space", "success");

  // Get API info
  const apiInfo = await client.view_api();
  const endpoints = apiInfo.named_endpoints
    ? Array.isArray(apiInfo.named_endpoints)
      ? apiInfo.named_endpoints.map((ep: any) => ep.name)
      : Object.keys(apiInfo.named_endpoints)
    : [];

  log(`API endpoints available: ${endpoints.length}`, "info");

  return {
    connected: true,
    endpoints,
  };
}

async function testStorageSetup(): Promise<any> {
  await storage.init();
  log("Storage initialized", "success");

  // Check test images
  const files = await readdir(TEST_IMAGES_DIR);
  const imageFiles = files.filter((f) => /\.(jpg|jpeg|png)$/i.test(f));

  if (imageFiles.length === 0) {
    throw new Error("No test images found in " + TEST_IMAGES_DIR);
  }

  log(`Found ${imageFiles.length} test images`, "info");

  return {
    imageCount: imageFiles.length,
    images: imageFiles,
  };
}

async function testCreateRun(): Promise<string> {
  const runId = storage.generateRunId();
  await storage.createRun(runId);

  log(`Created run: ${runId}`, "success");

  const settings: VGGTSettings = {
    confThreshold: 45,
    predictionMode: "pointmap",
    maskBlackBg: false,
    maskWhiteBg: false,
    maskSky: false,
    showCameras: true,
  };

  await storage.saveMetadata(runId, {
    runId,
    status: "queued",
    settings,
    images: [],
    requestedAt: new Date().toISOString(),
  });

  return runId;
}

async function testUploadImages(runId: string): Promise<any> {
  // Read test images
  const files = await readdir(TEST_IMAGES_DIR);
  const imageFiles = files.filter((f) => /\.(jpg|jpeg|png)$/i.test(f)).sort();

  log(`Uploading ${imageFiles.length} images...`, "info");

  const uploaded: string[] = [];

  for (const filename of imageFiles) {
    const filepath = join(TEST_IMAGES_DIR, filename);
    const buffer = await readFile(filepath);

    await storage.saveImage(runId, filename, buffer);
    uploaded.push(filename);

    log(`  Uploaded: ${filename}`, "info");
  }

  // Update metadata
  const metadata = await storage.loadMetadata(runId);
  if (!metadata) {
    throw new Error("Metadata not found after upload");
  }

  metadata.images = uploaded;
  metadata.status = "uploading";
  await storage.saveMetadata(runId, metadata);

  return {
    uploaded: uploaded.length,
    images: uploaded,
  };
}

async function testSubmitToVGGT(runId: string): Promise<any> {
  log("Submitting to VGGT space...", "info");

  const metadata = await storage.loadMetadata(runId);
  if (!metadata) {
    throw new Error("Run metadata not found");
  }

  // Get image paths
  const imagePaths = await vggtClient.getRunImagePaths(runId);

  if (imagePaths.length === 0) {
    throw new Error("No images found for run");
  }

  log(`Submitting ${imagePaths.length} images`, "info");

  // Start submission (this will run async)
  const submitPromise = vggtClient.submitRun(
    runId,
    imagePaths,
    metadata.settings,
  );

  return {
    runId,
    imageCount: imagePaths.length,
    submitPromise, // Return promise for polling
  };
}

async function testPollStatus(runId: string): Promise<any> {
  log("Polling run status...", "info");

  let attempts = 0;
  let currentStatus: RunStatus = "queued";
  const statusHistory: Array<{ status: RunStatus; timestamp: number }> = [];

  while (attempts < MAX_POLL_ATTEMPTS) {
    attempts++;

    const metadata = await storage.loadMetadata(runId);
    if (!metadata) {
      throw new Error("Run metadata disappeared during polling");
    }

    if (metadata.status !== currentStatus) {
      currentStatus = metadata.status;
      statusHistory.push({
        status: currentStatus,
        timestamp: Date.now(),
      });
      log(`  Status changed to: ${currentStatus}`, "info");
    }

    if (currentStatus === "completed") {
      log("Run completed successfully!", "success");
      return {
        attempts,
        duration: (Date.now() - statusHistory[0].timestamp) / 1000,
        statusHistory,
      };
    }

    if (currentStatus === "failed") {
      throw new Error(`Run failed: ${metadata.error || "Unknown error"}`);
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`Polling timeout after ${MAX_POLL_ATTEMPTS} attempts`);
}

async function testDownloadArtifacts(runId: string): Promise<any> {
  log("Downloading artifacts...", "info");

  const artifacts = await vggtClient.downloadArtifacts(runId);

  const results: any = {};

  if (artifacts.glb) {
    log(`  GLB file: ${artifacts.glb.length} bytes`, "info");
    results.glb = {
      size: artifacts.glb.length,
      isValid: artifacts.glb.length > 100, // Basic validation
    };
  } else {
    log("  GLB file not found", "warn");
  }

  if (artifacts.predictions) {
    log(`  Predictions file: ${artifacts.predictions.length} bytes`, "info");
    results.predictions = {
      size: artifacts.predictions.length,
      isValid: artifacts.predictions.length > 100,
    };
  } else {
    log("  Predictions file not found", "warn");
  }

  return results;
}

async function testVerifyGLB(runId: string): Promise<any> {
  log("Verifying GLB file...", "info");

  const paths = storage.getRunPaths(runId);

  if (!storage.artifactExists(runId, "glb")) {
    throw new Error("GLB artifact does not exist");
  }

  const stats = await stat(paths.glbPath);

  log(`  File size: ${stats.size} bytes`, "info");

  // Read first few bytes to verify it's a GLB file
  // GLB files start with magic number: glTF (0x676C5446)
  const buffer = await readFile(paths.glbPath);
  const magic = buffer.readUInt32LE(0);
  const expectedMagic = 0x46546c67; // 'glTF' in little endian

  if (magic !== expectedMagic) {
    throw new Error(`Invalid GLB magic number: 0x${magic.toString(16)}`);
  }

  log("  GLB file is valid", "success");

  // Read version
  const version = buffer.readUInt32LE(4);
  const length = buffer.readUInt32LE(8);

  return {
    fileSize: stats.size,
    version,
    length,
    isValid: true,
  };
}

async function testErrorHandling(): Promise<any> {
  log("Testing error handling scenarios...", "info");

  const scenarios = [];

  // Test 1: Invalid run ID
  try {
    await vggtClient.pollRunStatus("invalid_run_id_12345");
    scenarios.push({ scenario: "invalid_run_id", passed: false });
  } catch (error) {
    scenarios.push({
      scenario: "invalid_run_id",
      passed: error instanceof VGGTClientError,
      errorType: error.constructor.name,
    });
    log("  Invalid run ID error caught correctly", "success");
  }

  // Test 2: Download artifacts before completion
  const testRunId = storage.generateRunId();
  await storage.createRun(testRunId);
  await storage.saveMetadata(testRunId, {
    runId: testRunId,
    status: "queued",
    settings: {
      confThreshold: 45,
      predictionMode: "pointmap",
      maskBlackBg: false,
      maskWhiteBg: false,
      maskSky: false,
      showCameras: true,
    },
    images: [],
    requestedAt: new Date().toISOString(),
  });

  try {
    await vggtClient.downloadArtifacts(testRunId);
    scenarios.push({ scenario: "premature_download", passed: false });
  } catch (error) {
    scenarios.push({
      scenario: "premature_download",
      passed: error instanceof VGGTClientError,
      errorType: error.constructor.name,
    });
    log("  Premature download error caught correctly", "success");
  }

  return { scenarios };
}

async function printSummary() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST SUMMARY");
  console.log("=".repeat(60));

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;

  console.log(`\nTotal: ${total} | Passed: ${passed} | Failed: ${failed}`);
  console.log("");

  results.forEach((result) => {
    const symbol = result.passed ? "✓" : "✗";
    const duration = `${result.duration}ms`;
    console.log(`${symbol} ${result.name.padEnd(40)} ${duration.padStart(10)}`);

    if (result.error) {
      console.log(`  Error: ${result.error}`);
    }
  });

  console.log("\n" + "=".repeat(60));

  if (failed > 0) {
    console.log("⚠ Some tests failed. Check errors above.");
    return false;
  } else {
    console.log("✓ All tests passed!");
    return true;
  }
}

// Main test execution
async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║        VGGT Integration Test Suite                        ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log("");

  log("Starting comprehensive VGGT integration tests...", "info");
  console.log("");

  // Phase 1: Connection Tests
  console.log("━━━ Phase 1: Connection & Setup ━━━");
  await runTest("HuggingFace Connection", testHuggingFaceConnection);
  await runTest("Storage Setup", testStorageSetup);
  await runTest("Error Handling", testErrorHandling);

  // Phase 2: Full Workflow Test (optional - requires HF quota)
  console.log("\n━━━ Phase 2: Full Workflow Test ━━━");

  const shouldRunFullTest = process.argv.includes("--full");

  if (!shouldRunFullTest) {
    log("Skipping full workflow test (use --full flag to run)", "warn");
    log(
      "Full test submits images to HuggingFace and may use GPU quota",
      "warn",
    );
  } else {
    log("Running full workflow test...", "info");

    let runId: string | null = null;

    const createResult = await runTest("Create Run", testCreateRun);
    if (createResult.passed) {
      runId = createResult.details as string;
    }

    if (runId) {
      await runTest("Upload Images", () => testUploadImages(runId!));

      const submitResult = await runTest("Submit to VGGT", () =>
        testSubmitToVGGT(runId!),
      );

      if (submitResult.passed) {
        // Wait for submission promise to complete
        try {
          await submitResult.details.submitPromise;
        } catch (error) {
          log("Submission failed, but continuing to test polling", "warn");
        }

        // Now poll for completion
        const pollResult = await runTest("Poll Status", () =>
          testPollStatus(runId!),
        );

        if (pollResult.passed) {
          await runTest("Download Artifacts", () =>
            testDownloadArtifacts(runId!),
          );
          await runTest("Verify GLB", () => testVerifyGLB(runId!));
        }
      }
    }
  }

  // Print summary
  console.log("");
  const allPassed = await printSummary();

  // Cleanup
  await vggtClient.disconnect();

  process.exit(allPassed ? 0 : 1);
}

// Run the test suite
main().catch((error) => {
  console.error("\n✗ Fatal error:", error);
  process.exit(1);
});
