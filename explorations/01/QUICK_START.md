# VGGT Client Quick Start

Get started with the VGGT integration in 5 minutes.

## Installation

```bash
cd /Users/neil/projects/unsplash-clustering/explorations/01
bun install
```

## Start Server

```bash
bun run dev
```

Server will start at: http://localhost:3000

## Basic Usage

### 1. Create a Run

```bash
curl -X POST http://localhost:3000/api/runs \
  -H "Content-Type: application/json" \
  -d '{"settings": {"confThreshold": 45, "predictionMode": "pointmap"}}'
```

Save the `runId` from the response.

### 2. Upload Images

```bash
curl -X POST http://localhost:3000/api/runs/YOUR_RUN_ID/images \
  -F "img1=@/path/to/image1.jpg" \
  -F "img2=@/path/to/image2.jpg" \
  -F "img3=@/path/to/image3.jpg"
```

### 3. Start Processing

```bash
curl -X POST http://localhost:3000/api/runs/YOUR_RUN_ID/process
```

### 4. Check Status

```bash
curl http://localhost:3000/api/runs/YOUR_RUN_ID
```

Poll this endpoint until `status` is `"completed"`.

### 5. Download Results

```bash
# Download GLB scene
curl -O http://localhost:3000/api/runs/YOUR_RUN_ID/artifacts/glb

# Download predictions.npz
curl -O http://localhost:3000/api/runs/YOUR_RUN_ID/artifacts/predictions
```

## Settings Reference

```typescript
{
  confThreshold: 45,           // 0-100: confidence percentile for point filtering
  predictionMode: 'pointmap',  // 'pointmap' or 'depth'
  maskBlackBg: false,          // Filter black backgrounds
  maskWhiteBg: false,          // Filter white backgrounds
  maskSky: false,              // Filter sky regions
  showCameras: true,           // Show camera meshes in GLB
}
```

## Status Values

- `queued` - Run created, waiting for images
- `uploading` - Images being uploaded to HuggingFace
- `processing` - VGGT processing images
- `fetching` - Downloading results
- `completed` - Success, artifacts ready
- `failed` - Error occurred

## Testing

```bash
# Unit tests
bun run test-vggt-client.ts

# Integration tests (requires server running)
./test-integration.sh
```

## Troubleshooting

**Server won't start:**
- Check port 3000 is not in use: `lsof -i :3000`
- Install dependencies: `bun install`

**Processing stuck:**
- HuggingFace space may be sleeping (first request takes longer)
- Check space status: https://huggingface.co/spaces/facebook/vggt
- Wait a few minutes and retry

**Upload fails:**
- Check image format (JPG, PNG supported)
- Verify file exists and is readable
- Check file size isn't too large

## Next Steps

- Read [VGGT_CLIENT_README.md](./VGGT_CLIENT_README.md) for complete documentation
- Review [IMPLEMENTATION_REPORT.md](./IMPLEMENTATION_REPORT.md) for architecture details
- Check [vggt_integration_notes.md](../_DOCS/vggt_integration_notes.md) for VGGT API details

## Example Workflow (JavaScript)

```javascript
// 1. Create run
const createResponse = await fetch('http://localhost:3000/api/runs', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    settings: {
      confThreshold: 45,
      predictionMode: 'pointmap',
      maskBlackBg: false,
      maskWhiteBg: false,
      maskSky: false,
      showCameras: true,
    }
  })
});
const { runId } = await createResponse.json();

// 2. Upload images
const formData = new FormData();
formData.append('img1', imageFile1);
formData.append('img2', imageFile2);
await fetch(`http://localhost:3000/api/runs/${runId}/images`, {
  method: 'POST',
  body: formData,
});

// 3. Start processing
await fetch(`http://localhost:3000/api/runs/${runId}/process`, {
  method: 'POST',
});

// 4. Poll until complete
let status = 'processing';
while (status === 'processing' || status === 'uploading' || status === 'fetching') {
  await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s
  const response = await fetch(`http://localhost:3000/api/runs/${runId}`);
  const data = await response.json();
  status = data.status;
  console.log('Status:', status);
}

// 5. Download GLB
if (status === 'completed') {
  const glbResponse = await fetch(`http://localhost:3000/api/runs/${runId}/artifacts/glb`);
  const glbBlob = await glbResponse.blob();
  // Use glbBlob in Three.js viewer
}
```

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review server logs
3. Verify HuggingFace space is accessible
4. Test with the provided test scripts
