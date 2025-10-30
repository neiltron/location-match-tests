# VGGT Client Integration

This document describes the VGGT Gradio client integration for the HuggingFace `facebook/vggt` space.

## Overview

The `VGGTClient` service wraps the `@gradio/client` library to interact with the VGGT (Visual Geometry Grounded Tracking) model hosted on HuggingFace. It handles:

- Image upload to HuggingFace
- Job submission with configurable settings
- Status polling during processing
- Artifact download (GLB scene and predictions.npz)
- Error handling and status updates

## Architecture

```
Client (Browser)
    ↓
API Endpoints (server/index.ts)
    ↓
VGGTClient (server/services/vggt-client.ts)
    ↓
@gradio/client → facebook/vggt HF Space
    ↓
StorageService (server/services/storage.ts)
```

## Key Components

### VGGTClient Service

Location: `/server/services/vggt-client.ts`

**Main Methods:**

1. `submitRun(runId, imagePaths, settings)` - Submit a VGGT processing job
2. `pollRunStatus(runId)` - Get current status of a run
3. `downloadArtifacts(runId)` - Download GLB and predictions.npz
4. `getRunImagePaths(runId)` - Get sorted list of image paths for a run

**Status Flow:**

```
queued → uploading → processing → fetching → completed
                                            ↘ failed
```

### API Endpoints

**POST /api/runs/:runId/process**
- Starts VGGT processing for an uploaded run
- Runs asynchronously in the background
- Returns immediately with status 'processing'

**GET /api/runs/:runId**
- Poll current run status
- Includes artifact URLs when available

**GET /api/runs/:runId/artifacts/:type**
- Download GLB or predictions artifacts
- Type: 'glb' | 'predictions'

## VGGT API Parameters

The VGGT space expects parameters in this exact order:

1. `input_video`: null (we use images)
2. `num_images`: string (image count)
3. `input_images`: FileData[] (uploaded files)
4. `conf_thres`: number (0-100 percentile)
5. `mask_black_bg`: boolean
6. `mask_white_bg`: boolean
7. `show_cam`: boolean
8. `mask_sky`: boolean
9. `prediction_mode`: "Pointmap Branch" | "Depthmap and Camera Branch"
10. `is_example`: boolean (false for user uploads)

## Settings Mapping

Internal settings are mapped to VGGT parameters:

```typescript
{
  confThreshold: 45,           → conf_thres: 45
  predictionMode: 'pointmap',  → "Pointmap Branch"
  predictionMode: 'depth',     → "Depthmap and Camera Branch"
  maskBlackBg: false,          → mask_black_bg: false
  maskWhiteBg: false,          → mask_white_bg: false
  maskSky: false,              → mask_sky: false
  showCameras: true,           → show_cam: true
}
```

## Usage Example

### 1. Create a Run

```bash
curl -X POST http://localhost:3000/api/runs \
  -H "Content-Type: application/json" \
  -d '{
    "settings": {
      "confThreshold": 45,
      "predictionMode": "pointmap",
      "maskBlackBg": false,
      "maskWhiteBg": false,
      "maskSky": false,
      "showCameras": true
    }
  }'
```

Response:
```json
{
  "runId": "run_1234567890_abc123",
  "status": "queued"
}
```

### 2. Upload Images

```bash
curl -X POST http://localhost:3000/api/runs/run_1234567890_abc123/images \
  -F "image1=@photo1.jpg" \
  -F "image2=@photo2.jpg" \
  -F "image3=@photo3.jpg"
```

Response:
```json
{
  "runId": "run_1234567890_abc123",
  "imagesUploaded": 3,
  "images": ["photo1.jpg", "photo2.jpg", "photo3.jpg"]
}
```

### 3. Start Processing

```bash
curl -X POST http://localhost:3000/api/runs/run_1234567890_abc123/process
```

Response:
```json
{
  "runId": "run_1234567890_abc123",
  "status": "processing",
  "message": "Processing started"
}
```

### 4. Poll Status

```bash
curl http://localhost:3000/api/runs/run_1234567890_abc123
```

Response (during processing):
```json
{
  "runId": "run_1234567890_abc123",
  "status": "processing",
  "settings": { ... },
  "images": ["photo1.jpg", "photo2.jpg", "photo3.jpg"],
  "requestedAt": "2025-10-27T17:00:00.000Z",
  "startedAt": "2025-10-27T17:00:30.000Z"
}
```

Response (completed):
```json
{
  "runId": "run_1234567890_abc123",
  "status": "completed",
  "settings": { ... },
  "images": ["photo1.jpg", "photo2.jpg", "photo3.jpg"],
  "requestedAt": "2025-10-27T17:00:00.000Z",
  "startedAt": "2025-10-27T17:00:30.000Z",
  "finishedAt": "2025-10-27T17:05:00.000Z",
  "artifacts": {
    "glb": "/api/runs/run_1234567890_abc123/artifacts/glb",
    "predictions": "/api/runs/run_1234567890_abc123/artifacts/predictions"
  }
}
```

### 5. Download Artifacts

```bash
# Download GLB scene
curl -O http://localhost:3000/api/runs/run_1234567890_abc123/artifacts/glb

# Download predictions.npz
curl -O http://localhost:3000/api/runs/run_1234567890_abc123/artifacts/predictions
```

## Error Handling

The client includes comprehensive error handling:

```typescript
class VGGTClientError extends Error {
  code: 'UPLOAD_FAILED' | 'SUBMIT_FAILED' | 'POLLING_FAILED' |
        'DOWNLOAD_FAILED' | 'INVALID_STATE'
}
```

Errors are caught and stored in run metadata:

```json
{
  "status": "failed",
  "error": "Failed to upload image photo1.jpg: Connection timeout",
  "finishedAt": "2025-10-27T17:02:00.000Z"
}
```

## Testing

Run the test suite:

```bash
bun run test-vggt-client.ts
```

This validates:
- Status polling
- Image path retrieval
- Error handling
- Invalid run detection

## Implementation Notes

### Image Upload Flow

1. Client uploads images to API server
2. Server stores images in `storage/runs/{runId}/images/`
3. Images are sorted alphabetically (VGGT requirement)
4. When processing starts, images are uploaded to HuggingFace
5. HuggingFace processes them in sorted order

### Gradio Client Details

The `@gradio/client` library:
- Connects to HuggingFace Spaces via WebSocket
- Handles file uploads internally
- Returns FileData objects with download URLs
- Requires proper parameter ordering

### File Upload to HuggingFace

```typescript
// Read local file
const buffer = await readFile(path);
const blob = new Blob([buffer], { type: 'image/jpeg' });

// Upload via Gradio client
const handle = await client.upload_files([blob]);
```

### Predictions.npz Download Challenge

The current implementation successfully downloads the GLB file. The predictions.npz file requires additional handling:

**Current approach:**
- VGGT space returns GLB as FileData (direct download URL)
- Returns target directory path as string
- predictions.npz is in the temp directory on the space

**Future improvement:**
- Use HuggingFace API to access temporary space files
- Or request VGGT space to return predictions.npz as FileData
- Or use the Gradio client's file access methods

For now, the GLB file contains the essential visualization data for most use cases.

## Storage Structure

```
storage/
└── runs/
    └── run_1234567890_abc123/
        ├── images/
        │   ├── photo1.jpg
        │   ├── photo2.jpg
        │   └── photo3.jpg
        ├── metadata.json
        ├── scene.glb
        └── predictions.npz
```

## Performance Considerations

- **Timeout**: API calls timeout after 10 minutes (600,000ms)
- **Async processing**: Runs execute in background, doesn't block API
- **Image sorting**: Critical for matching frame order in predictions.npz
- **Memory**: Large image sets may require chunked uploads

## Future Enhancements

1. **Queue System**: Add job queue (BullMQ, Rabbit) for better control
2. **Webhooks**: Notify external systems when processing completes
3. **Progress Updates**: Stream detailed progress via WebSocket
4. **Predictions.npz**: Complete implementation of .npz download
5. **Retry Logic**: Automatic retry on transient failures
6. **Local Runner**: Support local VGGT instance as alternative to HF Space
7. **Batch Processing**: Submit multiple runs in parallel
8. **Resource Limits**: Enforce image count and size limits

## Troubleshooting

### Connection Issues

```
Error: Failed to connect to VGGT space
```

**Solutions:**
- Check internet connection
- Verify HuggingFace status
- Check if space is running (may be sleeping)
- Wait and retry (space may need to warm up)

### Upload Failures

```
Error: Failed to upload image photo1.jpg: UPLOAD_FAILED
```

**Solutions:**
- Check image file format (JPG, PNG supported)
- Verify file size isn't too large
- Check disk space on server
- Verify file permissions

### Processing Timeout

```
Status: processing (stuck)
```

**Solutions:**
- Check HuggingFace GPU quota
- Reduce image count
- Lower resolution images
- Verify space hasn't crashed
- Check HuggingFace logs

### Missing Artifacts

```
Status: completed, but artifacts missing
```

**Solutions:**
- Check server logs for download errors
- Verify disk space for artifacts
- Check file permissions in storage directory
- Retry the run

## Related Documentation

- [VGGT Integration Notes](/Users/neil/projects/unsplash-clustering/_DOCS/vggt_integration_notes.md)
- [Project README](./README.md)
- [Storage Service](./server/services/storage.ts)
- [API Types](./server/types.ts)

## References

- **VGGT Space**: https://huggingface.co/spaces/facebook/vggt
- **VGGT Model**: https://huggingface.co/facebook/VGGT-1B
- **Gradio Client Docs**: https://www.gradio.app/guides/getting-started-with-the-python-client
- **GitHub**: https://github.com/facebookresearch/vggt
