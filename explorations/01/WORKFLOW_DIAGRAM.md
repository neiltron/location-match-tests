# VGGT Client Workflow Diagram

## Before (Broken)

```
┌─────────────────┐
│  Upload Images  │
│  via client     │
│  .upload_files()│
└────────┬────────┘
         │
         v
    ┌────────────────────────┐
    │  Get FileData handles  │
    └────────┬───────────────┘
             │
             v
       ┌─────────────────┐
       │  Call /predict  │  ← ❌ DOESN'T EXIST!
       │  with handles   │
       └─────────────────┘
             │
             v
         ❌ ERROR
```

## After (Fixed)

```
┌─────────────────┐
│  Upload Images  │
│  via client     │
│  .upload_files()│
└────────┬────────┘
         │
         v
    ┌────────────────────────┐
    │  Get FileData handles  │
    └────────┬───────────────┘
             │
             v
    ┌─────────────────────────────────┐
    │  STEP 1: Call upload handler    │
    │  /update_gallery_on_upload      │
    │                                 │
    │  Input:                         │
    │    - null (video)               │
    │    - FileData[] (images)        │
    │                                 │
    │  Output:                        │
    │    - null                       │
    │    - target_dir (STRING) ←──────┼── ✅ Key!
    │    - gallery_data               │
    │    - message                    │
    └─────────────┬───────────────────┘
                  │
                  v
         ┌─────────────────────┐
         │  Extract target_dir │
         │  from response[1]   │
         └─────────┬───────────┘
                   │
                   v
    ┌──────────────────────────────────┐
    │  STEP 2: Call reconstruction     │
    │  /gradio_demo                    │
    │                                  │
    │  Input:                          │
    │    - target_dir (string)         │
    │    - conf_thres (number)         │
    │    - frame_filter ("All")        │
    │    - mask_black_bg (boolean)     │
    │    - mask_white_bg (boolean)     │
    │    - show_cam (boolean)          │
    │    - mask_sky (boolean)          │
    │    - prediction_mode (string)    │
    │                                  │
    │  Output:                         │
    │    - GLB file (with URL) ────────┼── ✅ Download this
    │    - status message              │
    │    - frame_filter state          │
    └──────────────┬───────────────────┘
                   │
                   v
            ┌──────────────┐
            │  Download    │
            │  GLB from    │
            │  response[0] │
            │  .url        │
            └──────────────┘
                   │
                   v
               ✅ SUCCESS
```

## Key Differences

### Wrong Approach (Before)
```typescript
// ❌ Single call to non-existent endpoint
client.predict('/predict', [
  null,
  num_images,
  fileHandles,
  ...params
])
```

### Correct Approach (After)
```typescript
// ✅ Step 1: Organize files
const upload = await client.predict('/update_gallery_on_upload', [
  null,
  fileHandles
]);

const targetDir = upload.data[1];  // Extract directory name

// ✅ Step 2: Run reconstruction
const result = await client.predict('/gradio_demo', [
  targetDir,
  ...params
]);

const glbUrl = result.data[0].url;  // Extract GLB URL
```

## Data Flow

```
Local Files          HuggingFace Server           Client
─────────           ──────────────────           ──────

image1.jpg ──────►  /tmp/gradio/xxx/image1.jpg
image2.jpg ──────►  /tmp/gradio/yyy/image2.jpg
image3.jpg ──────►  /tmp/gradio/zzz/image3.jpg
                            │
                            │ /update_gallery_on_upload
                            v
                    input_images_20251028_060706/
                    ├── image1.jpg (copied)
                    ├── image2.jpg (copied)
                    └── image3.jpg (copied)
                            │
                            │ directory name returned
                            v
                    "input_images_20251028_060706" ──►  targetDir
                            │
                            │ /gradio_demo(targetDir)
                            v
                    [3D Reconstruction Processing]
                            │
                            v
                    output.glb (generated)
                            │
                            │ URL returned
                            v
                    https://.../.../output.glb  ──────►  Download
                                                          │
                                                          v
                                                    local/output.glb
```

## Error Handling

### Before
```
Upload files ──► Call /predict ──X─► Error: endpoint not found
                                     (Dead end, no recovery)
```

### After
```
Upload files ──► /update_gallery_on_upload ──► Get target_dir ──► /gradio_demo ──► Success
       │                    │                        │                   │
       │                    │                        │                   │
       v                    v                        v                   v
   Retry on          Validate                 Validate            Handle GPU
   failure           response                 directory           quota errors
                     format                   exists
```

## Response Structure Comparison

### Upload Handler Response
```javascript
{
  type: "data",
  data: [
    null,                                    // [0] video result
    "input_images_20251028_060706_077487",   // [1] ← USE THIS!
    [ /* gallery preview data */ ],          // [2] gallery
    "Upload complete. Click 'Reconstruct'"   // [3] message
  ]
}
```

### Reconstruction Response
```javascript
{
  type: "data",
  data: [
    {                                        // [0] ← DOWNLOAD THIS!
      path: "/path/to/output.glb",
      url: "https://facebook-vggt.hf.space/file=/path/to/output.glb"
    },
    "Processing complete",                   // [1] status
    "All"                                    // [2] frame filter
  ]
}
```

## Testing Verification

```
Test Script                     Result
───────────                     ──────

diagnose-vggt-api.ts     ──►   ✅ Found correct endpoints
test-upload-handler.ts   ──►   ✅ Upload handler works
test-complete-workflow.ts ──►  ✅ End-to-end workflow works
test-fixed-client.ts     ──►   ✅ Client implementation works
```

## Success Criteria

- [x] Files upload successfully
- [x] Upload handler returns target directory
- [x] Target directory is valid string
- [x] Reconstruction endpoint accepts target_dir
- [x] GLB file is returned with URL
- [x] Error handling for each step
- [x] Logging shows correct workflow
- [ ] Full test with GPU quota (pending)

---

**Status:** ✅ Bug fixed, workflow verified, ready for production testing
