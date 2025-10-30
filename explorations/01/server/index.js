import { Elysia } from 'elysia';
import { staticPlugin } from '@elysiajs/static';
import { cors } from '@elysiajs/cors';
import { storage } from './services/storage';
import { vggtClient } from './services/vggt-client';
import { defaultSettings } from './types';
// Initialize storage
await storage.init();
const app = new Elysia()
    .use(cors())
    .use(staticPlugin({
    assets: 'public',
    prefix: '/',
}))
    // Health check
    .get('/api/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }))
    // Create new run
    .post('/api/runs', async ({ body, set }) => {
    try {
        const { settings } = body;
        // Merge with defaults
        const finalSettings = { ...defaultSettings, ...settings };
        // Create run
        const runId = storage.generateRunId();
        await storage.createRun(runId);
        // Initialize metadata
        const metadata = {
            runId,
            status: 'queued',
            settings: finalSettings,
            images: [],
            requestedAt: new Date().toISOString(),
        };
        await storage.saveMetadata(runId, metadata);
        const response = {
            runId,
            status: 'queued',
        };
        return response;
    }
    catch (error) {
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
        const formData = body;
        const imageFiles = Object.values(formData).filter(f => f instanceof File);
        // Save images
        const savedImages = [];
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
    }
    catch (error) {
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
    return { runs, total: runs.length };
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
    }
    catch (error) {
        set.status = 500;
        return { error: 'Failed to start processing', details: String(error) };
    }
})
    .listen(3000);
console.log(`🚀 VGGT Explorer running at http://localhost:${app.server?.port}`);
console.log(`   API: http://localhost:${app.server?.port}/api`);
console.log(`   Static files: http://localhost:${app.server?.port}/`);
