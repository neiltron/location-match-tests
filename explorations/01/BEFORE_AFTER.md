# VGGT Client: Before & After Comparison

## The Bug

**Error Message:**
```
error: There is no endpoint matching that name of fn_index matching that number.
```

## Before (Broken Code)

### Constants
```typescript
const PREDICT_ENDPOINT = '/predict';  // ❌ This endpoint doesn't exist!
```

### Submission Code (lines 195-208)
```typescript
// Submit prediction
// Parameter order matches VGGT space signature
const result = await client.predict(PREDICT_ENDPOINT, [
  null,                          // input_video
  String(fileHandles.length),    // num_images (hidden textbox)
  fileHandles,                   // input_images
  params.conf_thres,             // conf_thres
  params.mask_black_bg,          // mask_black_bg
  params.mask_white_bg,          // mask_white_bg
  params.show_cam,               // show_cam
  params.mask_sky,               // mask_sky
  params.prediction_mode,        // prediction_mode
  false,                         // is_example
]);
```

## After (Fixed Code)

### Constants
```typescript
const UPLOAD_ENDPOINT = '/update_gallery_on_upload';  // ✅ Organizes files
const GRADIO_DEMO_ENDPOINT = '/gradio_demo';          // ✅ Runs reconstruction
```

### Submission Code (lines 196-237)
```typescript
// Step 1: Call upload handler to organize files on the server
console.log('[VGGT] Step 1: Calling upload handler...');
const uploadResult = await client.predict(UPLOAD_ENDPOINT, [
  null,         // input_video (we use images, not video)
  fileHandles,  // input_images (list of FileData objects)
]);

console.log('[VGGT] Upload handler completed:', uploadResult);

// Extract target directory from upload result
// The upload handler returns: [null, target_dir, gallery_data, message]
if (!uploadResult.data || !Array.isArray(uploadResult.data) || uploadResult.data.length < 2) {
  throw new VGGTClientError(
    'Invalid response from upload handler',
    'UPLOAD_FAILED'
  );
}

const targetDir = uploadResult.data[1];
if (typeof targetDir !== 'string') {
  throw new VGGTClientError(
    'Target directory not returned by upload handler',
    'UPLOAD_FAILED'
  );
}

console.log(`[VGGT] Target directory created: ${targetDir}`);

// Step 2: Submit to VGGT processing with target directory
console.log('[VGGT] Step 2: Starting 3D reconstruction...');
const result = await client.predict(GRADIO_DEMO_ENDPOINT, [
  targetDir,                  // target_dir (string)
  params.conf_thres,          // conf_thres (number)
  'All',                      // frame_filter (string - default "All")
  params.mask_black_bg,       // mask_black_bg (boolean)
  params.mask_white_bg,       // mask_white_bg (boolean)
  params.show_cam,            // show_cam (boolean)
  params.mask_sky,            // mask_sky (boolean)
  params.prediction_mode,     // prediction_mode (string)
]);

console.log('[VGGT] 3D reconstruction completed:', result);
```

## Key Differences

| Aspect | Before | After |
|--------|--------|-------|
| **Endpoints** | 1 endpoint (`/predict`) | 2 endpoints (`/update_gallery_on_upload` + `/gradio_demo`) |
| **Workflow** | Single call with file handles | Two-step: organize files → process |
| **First param** | `null` (video) | `targetDir` (string path) |
| **File handling** | Passed directly to prediction | Organized on server first |
| **num_images** | Explicitly passed as string | Not needed (implicit in directory) |
| **frame_filter** | Not included | Added with default "All" |
| **is_example** | Explicitly `false` | Not needed |

## Result Format Changes

### Before
Expected but never received:
```typescript
[
  glbData,        // [0] GLB file
  targetDirPath   // [1] Target directory
]
```

### After
**From /update_gallery_on_upload:**
```typescript
[
  null,                          // [0] video result
  "input_images_20251028_...",   // [1] target directory name
  [...gallery_data],             // [2] image preview gallery
  "Upload complete. Click..."    // [3] status message
]
```

**From /gradio_demo:**
```typescript
[
  {path: "...", url: "..."},  // [0] GLB file (FileData)
  "Processing complete...",   // [1] status message
  "All"                       // [2] frame filter state
]
```

## Test Results

### Before
```
❌ Error: There is no endpoint matching that name of fn_index matching that number.
```

### After
```
✅ [VGGT] Step 1: Calling upload handler...
✅ [VGGT] Target directory created: input_images_20251028_060706_077487
✅ [VGGT] Step 2: Starting 3D reconstruction...
⚠️  GPU quota exceeded (confirms API calls work!)
```

## How to Verify the Fix

Run the test script:
```bash
cd /Users/neil/projects/unsplash-clustering/explorations/01
bun run test-fixed-client.ts
```

Expected output:
- ✅ Files upload successfully
- ✅ Upload handler creates target directory
- ✅ Reconstruction endpoint is called
- ⚠️  May fail with GPU quota error (this is good - means it reached processing!)
