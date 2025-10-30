# VGGT Integration Test Suite

Quick reference for testing the VGGT HuggingFace integration.

## Test Files

```
explorations/01/
├── test-vggt-integration.ts       # TypeScript test suite
├── scripts/
│   └── test-vggt-workflow.sh      # Bash workflow script
├── storage/
│   └── test_images/               # 5 test images (~3MB)
└── server/
    └── index.ts                   # API with /api/test/vggt-connection endpoint
```

## Quick Start

### 1. Basic Connection Test (No GPU Usage)

```bash
# Start server if not running
cd /explorations/01
bun run server/index.ts &

# Test via API endpoint
curl http://localhost:3000/api/test/vggt-connection | jq
```

**Expected result:** `"connected": true`

### 2. Run Test Suite (No GPU Usage)

```bash
bun run test-vggt-integration.ts
```

**Tests:**
- ✅ HuggingFace connection (~300ms)
- ✅ Storage setup (<5ms)
- ✅ Error handling (<5ms)

### 3. Full Workflow Test (Uses HuggingFace GPU)

```bash
# Interactive workflow with confirmation
./scripts/test-vggt-workflow.sh

# OR programmatic test
bun run test-vggt-integration.ts --full
```

**Warning:** This uses HuggingFace GPU quota!

## Test Image Setup

5 test images already copied to `storage/test_images/`:
- Total size: ~3.2 MB
- Formats: JPEG
- Small enough to test quickly

To refresh test images:
```bash
rm -rf storage/test_images/*
cd ../../images && find . -maxdepth 1 -name "*.jpg" | head -5 | \
  xargs -I {} cp {} ../explorations/01/storage/test_images/
```

## Test Results

See **VGGT_TEST_REPORT.md** for detailed results and recommendations.

**Summary:**
- ✅ Connection tests: PASSED
- ✅ Storage setup: PASSED
- ✅ Error handling: PASSED
- ⏸️ Full workflow: SKIPPED (requires --full flag)

## API Endpoints

### Test Connection
```bash
GET /api/test/vggt-connection
```

**Response:**
```json
{
  "status": "ok",
  "connected": true,
  "space": "facebook/vggt",
  "endpoints": ["...", "..."],
  "timestamp": "2025-10-28T04:14:42.269Z"
}
```

### Health Check
```bash
GET /api/health
```

## Common Issues

### Server Not Running
```bash
# Check server
curl http://localhost:3000/api/health

# Start if needed
bun run server/index.ts
```

### Connection Timeout
```bash
# Space may be starting up, wait 2-3 minutes
# Check HuggingFace status: https://status.huggingface.co
```

### Test Images Missing
```bash
ls -la storage/test_images/
# Should show 5 .jpg files

# If empty, copy from main images directory
cd ../../images && find . -maxdepth 1 -name "*.jpg" | head -5 | \
  xargs -I {} cp {} ../explorations/01/storage/test_images/
```

## Full Workflow Steps

When you run `./scripts/test-vggt-workflow.sh`:

1. ✅ Check server health
2. ✅ Test HuggingFace connection
3. ✅ Create new run
4. ✅ Upload 5 test images
5. ⏸️ **Ask for confirmation**
6. ⏸️ Submit to VGGT (uses GPU)
7. ⏸️ Poll status (~5-10 min)
8. ⏸️ Download artifacts
9. ⏸️ Verify GLB file
10. ✅ Print summary

## Output Files

After full workflow test completes:

```
storage/runs/{runId}/
├── metadata.json          # Run configuration
├── images/               # 5 uploaded test images
│   ├── image1.jpg
│   └── ...
└── artifacts/
    ├── scene.glb         # 3D scene visualization
    └── predictions.npz   # Camera data and depth maps

test_output_{runId}.glb   # Downloaded GLB (for verification)
```

## Monitoring GPU Jobs

```bash
# Watch server logs
tail -f server.log

# Check run status
curl http://localhost:3000/api/runs/{runId} | jq '.status'

# View all runs
curl http://localhost:3000/api/runs | jq
```

## Debugging

### Enable verbose logging
```bash
# In test-vggt-integration.ts, the log() function shows detailed output
# No additional flags needed
```

### Check Gradio client connection
```bash
bun -e "
import { Client } from '@gradio/client';
const client = await Client.connect('facebook/vggt');
console.log('Connected!');
const info = await client.view_api();
console.log('Endpoints:', Object.keys(info.named_endpoints || {}));
"
```

### Verify GLB file
```bash
# Check magic number (should be 'glTF' = 0x676C5446)
xxd -l 4 -p test_output_{runId}.glb
# Expected: 676c5446
```

## Next Steps

1. Run basic tests to verify setup
2. When ready to use GPU quota, run full workflow
3. Check VGGT_TEST_REPORT.md for recommendations
4. Review error handling improvements needed

## Resources

- **VGGT Space:** https://huggingface.co/spaces/facebook/vggt
- **VGGT Model:** https://huggingface.co/facebook/VGGT-1B
- **Documentation:** See `_DOCS/vggt_integration_notes.md`
- **Test Report:** See `VGGT_TEST_REPORT.md`
