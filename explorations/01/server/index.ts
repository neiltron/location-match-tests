import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { storage } from './services/storage';
import { vggtClient } from './services/vggt-client';
import { npzParser } from './services/npz-parser';
import type { CreateRunRequest, CreateRunResponse, VGGTRun, VGGTSettings } from './types';
import { defaultSettings } from './types';

// Initialize storage
await storage.init();

const app = new Elysia()
  .use(cors())
  // Serve static files manually to avoid transpilation
  .get('/', () => Bun.file('public/index.html'))
  .get('/:file', ({ params: { file } }) => {
    // Serve files from public directory
    return Bun.file(`public/${file}`);
  })
  .get('/components/:file', ({ params: { file } }) => {
    return Bun.file(`public/components/${file}`);
  })
  .get('/viewer/:file', ({ params: { file } }) => {
    return Bun.file(`public/viewer/${file}`);
  })

  // Health check
  .get('/api/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  // Test VGGT connection
  .get('/api/test/vggt-connection', async ({ set }) => {
    try {
      console.log('[TEST] Testing HuggingFace space connection...');
      const { Client } = await import('@gradio/client');
      const client = await Client.connect('facebook/vggt');
      console.log('[TEST] Connected successfully');

      // Get API info
      const apiInfo = await client.view_api();
      const endpoints = apiInfo.named_endpoints
        ? Array.isArray(apiInfo.named_endpoints)
          ? apiInfo.named_endpoints.map((ep: any) => ep.name)
          : Object.keys(apiInfo.named_endpoints)
        : [];

      return {
        status: 'ok',
        connected: true,
        space: 'facebook/vggt',
        endpoints,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('[TEST] Connection failed:', error);
      set.status = 503;
      return {
        status: 'error',
        connected: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      };
    }
  })

  // Create new run
  .post('/api/runs', async ({ body, set }) => {
    try {
      const { settings } = body as CreateRunRequest;

      // Merge with defaults
      const finalSettings = { ...defaultSettings, ...settings };

      // Create run
      const runId = storage.generateRunId();
      await storage.createRun(runId);

      // Initialize metadata
      const metadata: VGGTRun = {
        runId,
        status: 'queued',
        settings: finalSettings,
        images: [],
        requestedAt: new Date().toISOString(),
      };

      await storage.saveMetadata(runId, metadata);

      const response: CreateRunResponse = {
        runId,
        status: 'queued',
      };

      return response;
    } catch (error) {
      set.status = 500;
      return { error: 'Failed to create run', details: String(error) };
    }
  })

  // Upload images for a run
  .post('/api/runs/:runId/images', async ({ params, body, set }) => {
    try {
      const { runId } = params;
      const metadata = await storage.loadMetadata(runId);

      if (!metadata) {
        set.status = 404;
        return { error: 'Run not found' };
      }

      // Handle multipart form data
      const formData = body as Record<string, File>;
      const imageFiles = Object.values(formData).filter(f => f instanceof File);

      // Save images
      const savedImages: string[] = [];
      for (const file of imageFiles) {
        const buffer = Buffer.from(await file.arrayBuffer());
        await storage.saveImage(runId, file.name, buffer);
        savedImages.push(file.name);
      }

      // Update metadata
      metadata.images = savedImages.sort(); // Sort to maintain order
      metadata.status = 'uploading';
      await storage.saveMetadata(runId, metadata);

      return {
        runId,
        imagesUploaded: savedImages.length,
        images: savedImages
      };
    } catch (error) {
      set.status = 500;
      return { error: 'Failed to upload images', details: String(error) };
    }
  })

  // Get run status
  .get('/api/runs/:runId', async ({ params, set }) => {
    const { runId } = params;
    const metadata = await storage.loadMetadata(runId);

    if (!metadata) {
      set.status = 404;
      return { error: 'Run not found' };
    }

    // Check for artifacts
    metadata.artifacts = {
      glb: storage.artifactExists(runId, 'glb') ? `/api/runs/${runId}/artifacts/glb` : undefined,
      predictions: storage.artifactExists(runId, 'predictions') ? `/api/runs/${runId}/artifacts/predictions` : undefined,
    };

    return metadata;
  })

  // List all runs
  .get('/api/runs', async () => {
    const runs = await storage.listRuns();

    const runsWithArtifacts = runs.map(run => ({
      ...run,
      artifacts: {
        glb: storage.artifactExists(run.runId, 'glb')
          ? `/api/runs/${run.runId}/artifacts/glb`
          : undefined,
        predictions: storage.artifactExists(run.runId, 'predictions')
          ? `/api/runs/${run.runId}/artifacts/predictions`
          : undefined,
      }
    }));

    return {
      runs: runsWithArtifacts,
      total: runsWithArtifacts.length
    };
  })

  // Download artifact
  .get('/api/runs/:runId/artifacts/:type', async ({ params, set }) => {
    const { runId, type } = params;

    if (type !== 'glb' && type !== 'predictions') {
      set.status = 400;
      return { error: 'Invalid artifact type' };
    }

    const paths = storage.getRunPaths(runId);
    const filepath = type === 'glb' ? paths.glbPath : paths.predictionsPath;

    if (!storage.artifactExists(runId, type)) {
      set.status = 404;
      return { error: 'Artifact not found' };
    }

    // Return file
    const file = Bun.file(filepath);
    return new Response(file);
  })

  // Get camera data from predictions.npz
  .get('/api/runs/:runId/cameras', async ({ params, set }) => {
    try {
      const { runId } = params;

      // Check if predictions.npz exists
      if (!storage.artifactExists(runId, 'predictions')) {
        set.status = 404;
        return { error: 'Predictions file not found for this run' };
      }

      // Get predictions path
      const paths = storage.getRunPaths(runId);

      // Parse NPZ file
      const cameraData = await npzParser.parsePredictions(paths.predictionsPath);

      return cameraData;
    } catch (error) {
      console.error(`[API] Failed to parse camera data:`, error);
      set.status = 500;
      return {
        error: 'Failed to parse camera data',
        details: error instanceof Error ? error.message : String(error)
      };
    }
  })

  // Re-run an existing job with updated settings
  .post('/api/runs/:runId/rerun', async ({ params, body, set }) => {
    try {
      const { runId: sourceRunId } = params;
      const sourceMetadata = await storage.loadMetadata(sourceRunId);

      if (!sourceMetadata) {
        set.status = 404;
        return { error: 'Source run not found' };
      }

      if (!sourceMetadata.images || sourceMetadata.images.length === 0) {
        set.status = 400;
        return { error: 'Source run has no images to reprocess' };
      }

      const providedSettings = (body as { settings?: Partial<VGGTSettings> }).settings;
      const finalSettings: VGGTSettings = {
        ...defaultSettings,
        ...sourceMetadata.settings,
        ...providedSettings,
      };

      const newRunId = storage.generateRunId();
      await storage.createRun(newRunId);

      const imageFilenames = await storage.copyRunImages(sourceRunId, newRunId);

      const metadata: VGGTRun = {
        runId: newRunId,
        status: 'queued',
        settings: finalSettings,
        images: imageFilenames,
        requestedAt: new Date().toISOString(),
        parentRunId: sourceRunId,
      };

      await storage.saveMetadata(newRunId, metadata);

      const imagePaths = await vggtClient.getRunImagePaths(newRunId);

      vggtClient.submitRun(newRunId, imagePaths, finalSettings).catch(error => {
        console.error(`[API] Background rerun failed for run ${newRunId}:`, error);
      });

      return {
        runId: newRunId,
        status: 'processing',
        parentRunId: sourceRunId,
        images: imageFilenames.length,
      };
    } catch (error) {
      set.status = 500;
      return { error: 'Failed to re-run job', details: String(error) };
    }
  })

  // Process a run with VGGT
  .post('/api/runs/:runId/process', async ({ params, set }) => {
    try {
      const { runId } = params;
      const metadata = await storage.loadMetadata(runId);

      if (!metadata) {
        set.status = 404;
        return { error: 'Run not found' };
      }

      if (metadata.images.length === 0) {
        set.status = 400;
        return { error: 'No images uploaded for this run' };
      }

      if (metadata.status !== 'uploading' && metadata.status !== 'queued') {
        set.status = 400;
        return { error: `Run is already ${metadata.status}` };
      }

      // Get image paths (sorted)
      const imagePaths = await vggtClient.getRunImagePaths(runId);

      // Start processing asynchronously
      // Don't await - return immediately and let it run in background
      vggtClient.submitRun(runId, imagePaths, metadata.settings).catch(error => {
        console.error(`[API] Background processing failed for run ${runId}:`, error);
      });

      return {
        runId,
        status: 'processing',
        message: 'Processing started',
      };
    } catch (error) {
      set.status = 500;
      return { error: 'Failed to start processing', details: String(error) };
    }
  })

  .listen(3000);

console.log(`🚀 VGGT Explorer running at http://localhost:${app.server?.port}`);
console.log(`   API: http://localhost:${app.server?.port}/api`);
console.log(`   Static files: http://localhost:${app.server?.port}/`);
