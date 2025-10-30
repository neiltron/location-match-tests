# Future Enhancements

Roadmap for extending the VGGT client integration.

## Priority 1: Critical Features

### 1.1 Complete predictions.npz Download

**Status:** Partial implementation
**Effort:** Medium
**Impact:** High

**Current state:**
- GLB download works perfectly
- predictions.npz path is returned but not downloaded
- Space returns directory path as string

**Implementation approach:**

```typescript
// Option 1: Use HuggingFace API directly
private async downloadPredictionsFromSpace(
  spaceId: string,
  targetDir: string
): Promise<Buffer> {
  const url = `https://huggingface.co/spaces/${spaceId}/resolve/main/${targetDir}/predictions.npz`;
  const response = await fetch(url);
  return Buffer.from(await response.arrayBuffer());
}

// Option 2: Request space to return as FileData
// Modify VGGT space app.py to return both files:
return [glb_file, predictions_file]  // instead of [glb_file, dir_path]

// Option 3: Use Gradio client file access
const files = await client.list_files(targetDir);
const predictionsFile = files.find(f => f.name === 'predictions.npz');
const buffer = await client.download_file(predictionsFile.url);
```

**Testing:**
- Verify .npz file integrity
- Test with numpy (can it load?)
- Validate array shapes match expected format

### 1.2 Progress Streaming

**Status:** Not implemented
**Effort:** Medium
**Impact:** High

**Current state:**
- Client must poll for status
- No real-time progress updates
- Can't see detailed processing steps

**Implementation approach:**

```typescript
// server/index.ts
import { Elysia } from 'elysia';
import { stream } from '@elysiajs/stream';

app.get('/api/runs/:runId/stream', ({ params }) =>
  stream(async (send) => {
    const runId = params.runId;

    // Send initial status
    send({ type: 'status', status: 'connecting' });

    // Stream progress updates
    vggtClient.on('progress', (event) => {
      send({ type: 'progress', data: event });
    });

    // Stream status changes
    vggtClient.on('status', (status) => {
      send({ type: 'status', status });
    });
  })
);

// vggt-client.ts
import { EventEmitter } from 'events';

class VGGTClient extends EventEmitter {
  async submitRun(...) {
    this.emit('status', 'uploading');
    for (let i = 0; i < images.length; i++) {
      await uploadImage(images[i]);
      this.emit('progress', {
        step: 'upload',
        current: i + 1,
        total: images.length,
        percentage: ((i + 1) / images.length) * 100
      });
    }
    this.emit('status', 'processing');
    // ...
  }
}
```

**Client usage:**

```javascript
const eventSource = new EventSource(`/api/runs/${runId}/stream`);
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'progress') {
    updateProgressBar(data.percentage);
  }
};
```

### 1.3 Retry Mechanism

**Status:** Not implemented
**Effort:** Low
**Impact:** Medium

**Implementation:**

```typescript
class VGGTClient {
  private async submitWithRetry(
    runId: string,
    imagePaths: string[],
    settings: VGGTSettings,
    maxRetries = 3
  ): Promise<void> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.submitRun(runId, imagePaths, settings);
        return; // Success
      } catch (error) {
        lastError = error;
        console.warn(`Attempt ${attempt}/${maxRetries} failed:`, error);

        if (this.isRetryable(error) && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          await this.sleep(delay);
          continue;
        }
        break;
      }
    }

    throw lastError;
  }

  private isRetryable(error: Error): boolean {
    // Retry on network errors, timeouts, rate limits
    return (
      error.message.includes('timeout') ||
      error.message.includes('rate limit') ||
      error.message.includes('ECONNRESET')
    );
  }
}
```

## Priority 2: Scalability

### 2.1 Job Queue System

**Status:** Not implemented
**Effort:** High
**Impact:** High

**Why needed:**
- Control concurrent HF space usage
- Better resource management
- Job prioritization
- Rate limiting

**Implementation with BullMQ:**

```typescript
// server/services/queue.ts
import { Queue, Worker } from 'bullmq';

const vggtQueue = new Queue('vggt-processing', {
  connection: { host: 'localhost', port: 6379 }
});

// Add job to queue
export async function enqueueRun(
  runId: string,
  imagePaths: string[],
  settings: VGGTSettings
) {
  await vggtQueue.add('process', { runId, imagePaths, settings });
}

// Worker processes jobs
const worker = new Worker('vggt-processing', async (job) => {
  const { runId, imagePaths, settings } = job.data;
  await vggtClient.submitRun(runId, imagePaths, settings);
}, {
  connection: { host: 'localhost', port: 6379 },
  concurrency: 2, // Max 2 concurrent VGGT jobs
});

// Monitor progress
worker.on('progress', (job) => {
  console.log(`Job ${job.id} is ${job.progress}% complete`);
});
```

**API changes:**

```typescript
// POST /api/runs/:runId/process
.post('/api/runs/:runId/process', async ({ params }) => {
  await enqueueRun(runId, imagePaths, settings);
  return { runId, status: 'queued', position: queuePosition };
});
```

### 2.2 Rate Limiting

**Status:** Not implemented
**Effort:** Low
**Impact:** Medium

**Implementation:**

```typescript
import { rateLimit } from '@elysiajs/rate-limit';

app.use(rateLimit({
  duration: 60000,      // 1 minute
  max: 10,              // 10 requests per minute
  errorResponse: 'Too many requests, please try again later'
}));

// Per-endpoint limits
app.post('/api/runs', {
  beforeHandle: [
    rateLimit({
      duration: 3600000,  // 1 hour
      max: 5,             // 5 runs per hour
    })
  ]
});
```

### 2.3 Resource Limits

**Status:** Not implemented
**Effort:** Low
**Impact:** Medium

**Implementation:**

```typescript
// server/middleware/validation.ts
export function validateRunRequest(body: any) {
  const MAX_IMAGES = 50;
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  if (body.images?.length > MAX_IMAGES) {
    throw new Error(`Maximum ${MAX_IMAGES} images allowed`);
  }

  for (const file of body.images) {
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`Image ${file.name} exceeds ${MAX_FILE_SIZE} bytes`);
    }
  }
}
```

## Priority 3: Local Runner

### 3.1 Local VGGT Instance Support

**Status:** Not implemented
**Effort:** High
**Impact:** High

**Why needed:**
- No HuggingFace GPU quota limits
- Faster processing (no network overhead)
- Private/offline processing
- Better control over resources

**Implementation:**

```typescript
// server/services/local-vggt.ts
import { spawn } from 'child_process';
import { join } from 'path';

class LocalVGGTRunner {
  private vggtPath: string;

  async submitRun(
    runId: string,
    imagePaths: string[],
    settings: VGGTSettings
  ): Promise<void> {
    const outputDir = storage.getRunPaths(runId).runDir;

    // Run VGGT Python script
    const process = spawn('python3', [
      join(this.vggtPath, 'run_inference.py'),
      '--input', imagePaths.join(','),
      '--output', outputDir,
      '--conf_threshold', String(settings.confThreshold),
      '--prediction_mode', settings.predictionMode,
    ]);

    // Stream output
    process.stdout.on('data', (data) => {
      console.log(`[VGGT] ${data}`);
    });

    await new Promise((resolve, reject) => {
      process.on('exit', (code) => {
        code === 0 ? resolve(null) : reject(new Error(`Exit ${code}`));
      });
    });
  }
}

// Auto-detect runner
class VGGTClientFactory {
  static async create(): Promise<VGGTClient | LocalVGGTRunner> {
    if (process.env.VGGT_LOCAL_PATH) {
      return new LocalVGGTRunner(process.env.VGGT_LOCAL_PATH);
    }
    return new VGGTClient();
  }
}
```

**Configuration:**

```bash
# .env
VGGT_LOCAL_PATH=/path/to/vggt
VGGT_USE_LOCAL=true
```

## Priority 4: Advanced Features

### 4.1 Batch Operations

**Status:** Not implemented
**Effort:** Medium
**Impact:** Low

**Use case:**
Process multiple clusters at once

**Implementation:**

```typescript
// POST /api/batch/runs
interface BatchRunRequest {
  runs: Array<{
    settings: VGGTSettings;
    images: File[];
  }>;
}

.post('/api/batch/runs', async ({ body }) => {
  const runIds = [];
  for (const runConfig of body.runs) {
    const runId = await createRun(runConfig.settings);
    await uploadImages(runId, runConfig.images);
    await enqueueRun(runId);
    runIds.push(runId);
  }
  return { runIds, status: 'queued' };
});

// GET /api/batch/runs/:batchId/status
.get('/api/batch/runs/:batchId/status', async ({ params }) => {
  const statuses = await Promise.all(
    runIds.map(id => getRunStatus(id))
  );
  return {
    total: statuses.length,
    completed: statuses.filter(s => s.status === 'completed').length,
    failed: statuses.filter(s => s.status === 'failed').length,
    processing: statuses.filter(s => s.status === 'processing').length,
  };
});
```

### 4.2 Webhook Notifications

**Status:** Not implemented
**Effort:** Low
**Impact:** Low

**Use case:**
Notify external systems when processing completes

**Implementation:**

```typescript
// server/types.ts
interface VGGTRun {
  // ...existing fields
  webhookUrl?: string;
}

// vggt-client.ts
private async notifyWebhook(runId: string, status: RunStatus) {
  const metadata = await storage.loadMetadata(runId);
  if (!metadata.webhookUrl) return;

  try {
    await fetch(metadata.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId,
        status,
        finishedAt: new Date().toISOString(),
        artifacts: metadata.artifacts,
      }),
    });
  } catch (error) {
    console.error(`Webhook notification failed: ${error}`);
  }
}
```

**Usage:**

```bash
curl -X POST /api/runs \
  -H "Content-Type: application/json" \
  -d '{
    "settings": {...},
    "webhookUrl": "https://myapp.com/vggt-callback"
  }'
```

### 4.3 Artifact Post-Processing

**Status:** Not implemented
**Effort:** Medium
**Impact:** Medium

**Features:**
- Generate preview images
- Extract metadata
- Compress GLB files
- Create thumbnails

**Implementation:**

```typescript
// server/services/post-processor.ts
import sharp from 'sharp';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

class ArtifactPostProcessor {
  async processGLB(runId: string): Promise<void> {
    const { glbPath } = storage.getRunPaths(runId);
    const glb = await readFile(glbPath);

    // Extract preview image
    const preview = await this.renderPreview(glb);
    await writeFile(
      join(dirname(glbPath), 'preview.jpg'),
      preview
    );

    // Extract metadata
    const metadata = await this.extractGLBMetadata(glb);
    await writeFile(
      join(dirname(glbPath), 'glb-metadata.json'),
      JSON.stringify(metadata, null, 2)
    );

    // Compress if large
    if (glb.length > 50 * 1024 * 1024) {
      const compressed = await this.compressGLB(glb);
      await writeFile(glbPath, compressed);
    }
  }

  private async renderPreview(glb: Buffer): Promise<Buffer> {
    // Use headless Three.js to render preview
    // Return JPEG buffer
  }

  private async extractGLBMetadata(glb: Buffer) {
    const loader = new GLTFLoader();
    const gltf = await loader.parseAsync(glb);
    return {
      nodes: gltf.scene.children.length,
      vertices: this.countVertices(gltf.scene),
      materials: gltf.materials.length,
    };
  }
}
```

### 4.4 Predictions.npz Parsing

**Status:** Not implemented
**Effort:** Medium
**Impact:** Medium

**Use case:**
Extract camera matrices and point clouds without Python

**Implementation:**

```typescript
// server/services/npz-parser.ts
import { readFile } from 'fs/promises';

interface PredictionsData {
  extrinsic: Float32Array[];    // Nx3x4 camera matrices
  intrinsic: Float32Array[];     // Nx3x3 camera matrices
  depth: Float32Array[];         // NxHxW depth maps
  depth_conf: Float32Array[];    // NxHxW confidence maps
  world_points: Float32Array[];  // NxHxWx3 point maps
}

class NPZParser {
  async parse(filepath: string): Promise<PredictionsData> {
    // Use @stdlib/fs to read NPZ (ZIP with .npy files)
    const buffer = await readFile(filepath);
    const zip = await this.parseZip(buffer);

    const data: PredictionsData = {
      extrinsic: this.parseNPY(zip['extrinsic.npy']),
      intrinsic: this.parseNPY(zip['intrinsic.npy']),
      depth: this.parseNPY(zip['depth.npy']),
      depth_conf: this.parseNPY(zip['depth_conf.npy']),
      world_points: this.parseNPY(zip['world_points.npy']),
    };

    return data;
  }

  private parseNPY(buffer: Buffer): Float32Array {
    // Parse NumPy .npy format
    // Header: magic + version + header_len + dict
    // Data: raw bytes in specified dtype
  }
}

// API endpoint
.get('/api/runs/:runId/predictions/metadata', async ({ params }) => {
  const { predictionsPath } = storage.getRunPaths(params.runId);
  const parser = new NPZParser();
  const data = await parser.parse(predictionsPath);

  return {
    numCameras: data.extrinsic.length,
    imageShape: [data.depth[0].length, data.depth[0][0].length],
    totalPoints: data.world_points.reduce((sum, p) => sum + p.length, 0),
  };
});
```

## Priority 5: Monitoring & Analytics

### 5.1 Metrics & Logging

**Status:** Not implemented
**Effort:** Medium
**Impact:** Medium

**Implementation:**

```typescript
// server/services/metrics.ts
import { Counter, Histogram, Registry } from 'prom-client';

const registry = new Registry();

const runsTotal = new Counter({
  name: 'vggt_runs_total',
  help: 'Total number of VGGT runs',
  labelNames: ['status'],
  registers: [registry],
});

const processingDuration = new Histogram({
  name: 'vggt_processing_duration_seconds',
  help: 'VGGT processing duration',
  buckets: [10, 30, 60, 120, 300, 600],
  registers: [registry],
});

const imageCount = new Histogram({
  name: 'vggt_images_per_run',
  help: 'Number of images per run',
  buckets: [1, 5, 10, 20, 50, 100],
  registers: [registry],
});

// Track metrics
class MetricsCollector {
  onRunComplete(run: VGGTRun) {
    runsTotal.inc({ status: run.status });

    if (run.startedAt && run.finishedAt) {
      const duration =
        (new Date(run.finishedAt).getTime() -
         new Date(run.startedAt).getTime()) / 1000;
      processingDuration.observe(duration);
    }

    imageCount.observe(run.images.length);
  }
}

// Expose metrics
app.get('/metrics', () => {
  return registry.metrics();
});
```

### 5.2 Run Analytics

**Status:** Not implemented
**Effort:** Low
**Impact:** Low

**Implementation:**

```typescript
// GET /api/analytics/summary
.get('/api/analytics/summary', async () => {
  const runs = await storage.listRuns();

  const stats = {
    total: runs.length,
    byStatus: {
      completed: runs.filter(r => r.status === 'completed').length,
      failed: runs.filter(r => r.status === 'failed').length,
      processing: runs.filter(r => r.status === 'processing').length,
    },
    avgProcessingTime: this.calculateAvgTime(runs),
    avgImagesPerRun: runs.reduce((sum, r) => sum + r.images.length, 0) / runs.length,
    mostCommonSettings: this.analyzeSettings(runs),
  };

  return stats;
});
```

## Implementation Roadmap

### Phase 1: Core Stability (Week 1-2)
- ✅ Basic VGGT integration
- ✅ GLB download
- 🔲 Complete predictions.npz download
- 🔲 Retry mechanism
- 🔲 Better error messages

### Phase 2: User Experience (Week 3-4)
- 🔲 Progress streaming
- 🔲 Preview generation
- 🔲 Better status updates
- 🔲 Artifact metadata

### Phase 3: Scalability (Week 5-6)
- 🔲 Job queue system
- 🔲 Rate limiting
- 🔲 Resource limits
- 🔲 Batch operations

### Phase 4: Advanced Features (Week 7-8)
- 🔲 Local runner support
- 🔲 Webhook notifications
- 🔲 NPZ parsing
- 🔲 Metrics & monitoring

## Testing Strategy

Each enhancement should include:

1. **Unit tests** - Test individual components
2. **Integration tests** - Test full workflows
3. **Load tests** - Verify performance
4. **Documentation** - Update README and examples

## Notes

- Prioritize features based on user feedback
- Start with quick wins (retry, rate limiting)
- Complex features (queue, local runner) need more planning
- Keep backward compatibility
- Document breaking changes

## Resources

- [BullMQ Docs](https://docs.bullmq.io/)
- [Prometheus Client](https://github.com/siimon/prom-client)
- [NumPy File Format](https://numpy.org/doc/stable/reference/generated/numpy.lib.format.html)
- [GLTFLoader Three.js](https://threejs.org/docs/#examples/en/loaders/GLTFLoader)
