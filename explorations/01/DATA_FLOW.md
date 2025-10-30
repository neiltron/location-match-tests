# VGGT Client Data Flow

Visual representation of data flow through the VGGT integration.

## Overview

```
┌──────────┐       ┌──────────┐       ┌──────────┐       ┌──────────┐
│  Client  │──────▶│   API    │──────▶│  VGGT    │──────▶│ Storage  │
│ (Browser)│◀──────│  Server  │◀──────│  Client  │◀──────│ Service  │
└──────────┘       └──────────┘       └──────────┘       └──────────┘
                         │                   │
                         │                   │
                         ▼                   ▼
                   ┌──────────┐       ┌──────────┐
                   │  Elysia  │       │  Gradio  │
                   │   REST   │       │  Client  │
                   └──────────┘       └──────────┘
                                            │
                                            ▼
                                      ┌──────────┐
                                      │    HF    │
                                      │  Space   │
                                      └──────────┘
```

## Detailed Flow

### 1. Run Creation

```
POST /api/runs
{settings: {...}}
    │
    ▼
Storage.generateRunId()
    │
    ▼
Storage.createRun()
    │  Creates:
    │  - storage/runs/run_XXX/
    │  - storage/runs/run_XXX/images/
    │  - storage/runs/run_XXX/metadata.json
    │
    ▼
Return {runId, status: "queued"}
```

**Data stored:**
```json
{
  "runId": "run_1234567890_abc123",
  "status": "queued",
  "settings": {
    "confThreshold": 45,
    "predictionMode": "pointmap",
    "maskBlackBg": false,
    "maskWhiteBg": false,
    "maskSky": false,
    "showCameras": true
  },
  "images": [],
  "requestedAt": "2025-10-27T17:00:00.000Z"
}
```

### 2. Image Upload

```
POST /api/runs/:runId/images
FormData: {img1, img2, img3}
    │
    ▼
For each file:
  │
  ├─▶ Read file.arrayBuffer()
  │
  ├─▶ Convert to Buffer
  │
  └─▶ Storage.saveImage(runId, filename, buffer)
        │
        └─▶ Write to: storage/runs/run_XXX/images/filename.jpg
    │
    ▼
Update metadata.json
  │ Add filenames (sorted)
  │ Set status: "uploading"
    │
    ▼
Return {runId, imagesUploaded, images: [...]}
```

**File structure after upload:**
```
storage/runs/run_1234567890_abc123/
├── images/
│   ├── image1.jpg
│   ├── image2.jpg
│   └── image3.jpg
└── metadata.json (updated)
```

### 3. Processing Start

```
POST /api/runs/:runId/process
    │
    ▼
Load metadata
    │
    ▼
Validate status == "uploading" or "queued"
    │
    ▼
Get image paths (sorted)
    │
    ▼
VGGTClient.submitRun() [ASYNC]
    │ (returns immediately)
    │
    ▼
Return {runId, status: "processing"}
```

### 4. VGGT Processing (Background)

```
VGGTClient.submitRun()
    │
    ├─▶ Update status: "uploading"
    │
    ├─▶ Client.connect("facebook/vggt")
    │     │
    │     └─▶ WebSocket connection to HuggingFace
    │
    ├─▶ For each image:
    │     │
    │     ├─▶ readFile(path)
    │     │
    │     ├─▶ Create Blob
    │     │
    │     └─▶ client.upload_files([blob])
    │           │
    │           └─▶ Upload to HuggingFace CDN
    │
    ├─▶ Update status: "processing"
    │
    ├─▶ client.predict("/predict", [
    │     null,                    // video
    │     "3",                     // num_images
    │     [file1, file2, file3],  // images
    │     45,                      // conf_thres
    │     false,                   // mask_black_bg
    │     false,                   // mask_white_bg
    │     true,                    // show_cam
    │     false,                   // mask_sky
    │     "Pointmap Branch",       // prediction_mode
    │     false                    // is_example
    │   ])
    │     │
    │     └─▶ VGGT processes on GPU
    │           │ - Extract SuperPoint features
    │           │ - Run VGGT-1B model
    │           │ - Reconstruct 3D scene
    │           │ - Filter point cloud
    │           │ - Generate GLB
    │           │ - Save predictions.npz
    │           │
    │           └─▶ Return [glbData, targetDirPath]
    │
    ├─▶ Update status: "fetching"
    │
    ├─▶ Download GLB:
    │     │
    │     ├─▶ fetch(glbData.url)
    │     │
    │     ├─▶ Convert to Buffer
    │     │
    │     └─▶ Storage.saveArtifact(runId, 'glb', buffer)
    │           │
    │           └─▶ Write to: storage/runs/run_XXX/scene.glb
    │
    ├─▶ Download predictions.npz (TODO)
    │
    ├─▶ Update status: "completed"
    │
    └─▶ Save final metadata
```

**Metadata after completion:**
```json
{
  "runId": "run_1234567890_abc123",
  "status": "completed",
  "settings": {...},
  "images": ["image1.jpg", "image2.jpg", "image3.jpg"],
  "requestedAt": "2025-10-27T17:00:00.000Z",
  "startedAt": "2025-10-27T17:00:30.000Z",
  "finishedAt": "2025-10-27T17:05:00.000Z",
  "artifacts": {
    "glb": "/api/runs/run_1234567890_abc123/artifacts/glb"
  }
}
```

### 5. Status Polling

```
GET /api/runs/:runId
    │
    ▼
Storage.loadMetadata(runId)
    │
    ▼
Check artifact existence:
  │
  ├─▶ Storage.artifactExists(runId, 'glb')
  │     │
  │     └─▶ Set artifacts.glb URL
  │
  └─▶ Storage.artifactExists(runId, 'predictions')
        │
        └─▶ Set artifacts.predictions URL
    │
    ▼
Return metadata with artifact URLs
```

### 6. Artifact Download

```
GET /api/runs/:runId/artifacts/glb
    │
    ▼
Validate artifact type
    │
    ▼
Get file path:
  │ storage/runs/run_XXX/scene.glb
    │
    ▼
Check file exists
    │
    ▼
Bun.file(filepath)
    │
    ▼
Return Response(file)
    │
    ▼
Client receives binary GLB data
```

## Error Flow

### Error During Processing

```
VGGTClient.submitRun()
    │
    │ [Error occurs]
    │
    ▼
catch (error)
    │
    ├─▶ Log error
    │
    ├─▶ Update metadata:
    │     │ status: "failed"
    │     │ error: error.message
    │     │ finishedAt: timestamp
    │
    └─▶ Save metadata
```

**Failed metadata:**
```json
{
  "runId": "run_1234567890_abc123",
  "status": "failed",
  "error": "Failed to upload image image1.jpg: Connection timeout",
  "finishedAt": "2025-10-27T17:02:00.000Z"
}
```

## Data Types

### VGGTSettings

```typescript
interface VGGTSettings {
  confThreshold: number;        // 0-100
  predictionMode: 'pointmap' | 'depth';
  maskBlackBg: boolean;
  maskWhiteBg: boolean;
  maskSky: boolean;
  showCameras: boolean;
}
```

### VGGTRun

```typescript
interface VGGTRun {
  runId: string;
  status: RunStatus;
  settings: VGGTSettings;
  images: string[];
  requestedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  artifacts?: {
    glb?: string;
    predictions?: string;
  };
}
```

### RunStatus

```typescript
type RunStatus =
  | 'queued'      // Initial state
  | 'uploading'   // Uploading to HF
  | 'processing'  // VGGT processing
  | 'fetching'    // Downloading artifacts
  | 'completed'   // Success
  | 'failed';     // Error
```

## Storage Layout

```
storage/
└── runs/
    ├── run_1234567890_abc123/
    │   ├── images/
    │   │   ├── image1.jpg
    │   │   ├── image2.jpg
    │   │   └── image3.jpg
    │   ├── metadata.json
    │   ├── scene.glb
    │   └── predictions.npz
    │
    └── run_9876543210_xyz789/
        ├── images/
        │   └── photo.jpg
        ├── metadata.json
        └── scene.glb
```

## API Response Format

### Success Response

```json
{
  "runId": "run_1234567890_abc123",
  "status": "completed",
  "settings": {
    "confThreshold": 45,
    "predictionMode": "pointmap",
    "maskBlackBg": false,
    "maskWhiteBg": false,
    "maskSky": false,
    "showCameras": true
  },
  "images": ["image1.jpg", "image2.jpg", "image3.jpg"],
  "requestedAt": "2025-10-27T17:00:00.000Z",
  "startedAt": "2025-10-27T17:00:30.000Z",
  "finishedAt": "2025-10-27T17:05:00.000Z",
  "artifacts": {
    "glb": "/api/runs/run_1234567890_abc123/artifacts/glb",
    "predictions": "/api/runs/run_1234567890_abc123/artifacts/predictions"
  }
}
```

### Error Response

```json
{
  "error": "Failed to start processing",
  "details": "Run is already processing"
}
```

## Timing

Typical processing timeline:

```
t=0s     POST /api/runs              → Run created
t=1s     POST /api/runs/:id/images   → Images uploaded
t=2s     POST /api/runs/:id/process  → Processing started
         ├─ Status: uploading         (2s-10s)
         ├─ Status: processing        (10s-300s)
         ├─ Status: fetching          (300s-310s)
         └─ Status: completed         (310s)
t=310s   GET /api/runs/:id/artifacts → Download GLB
```

Processing time varies based on:
- Number of images (more = longer)
- Image resolution (higher = longer)
- HuggingFace GPU availability
- Space cold start time (first request)

## Concurrency

Multiple runs can process concurrently:

```
Run A: queued → uploading → processing → fetching → completed
Run B:             queued → uploading → processing → fetching → completed
Run C:                         queued → uploading → processing → fetching → completed
```

Each run is independent:
- Separate directory
- Separate metadata
- Separate HF connection
- No shared state

## Summary

The VGGT client implements a clean async processing pipeline:

1. **Create** - Generate run ID and directory structure
2. **Upload** - Store images locally in sorted order
3. **Submit** - Upload to HF and start VGGT processing
4. **Poll** - Client checks status periodically
5. **Download** - Retrieve artifacts when complete

All state is persisted in `metadata.json`, allowing:
- Server restarts without losing state
- Multiple concurrent runs
- Historical run tracking
- Error recovery
