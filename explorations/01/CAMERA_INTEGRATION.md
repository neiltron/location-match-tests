# VGGT Camera Data Integration

## Overview

This document describes the integration of real VGGT camera data into the 3D viewer, replacing the mock camera transforms with actual camera poses from `predictions.npz`.

## Architecture

### Data Flow

```
predictions.npz (VGGT output)
    ↓
parse_npz.py (Python script)
    ↓
/api/runs/:runId/cameras (REST endpoint)
    ↓
app.ts → loadRunCameras()
    ↓
CameraTransforms.extrinsicToThreeMatrix() (coordinate conversion)
    ↓
SceneViewer.setCameraFrustums() (visualization)
    ↓
ImageUploader (thumbnail hover → camera animation)
```

### Components

#### 1. NPZ Parser (`server/utils/parse_npz.py`)

Python script that:
- Loads `predictions.npz` using NumPy
- Extracts camera extrinsics (3×4 matrices) and intrinsics (3×3 matrices)
- Converts NumPy arrays to JSON format
- Outputs structured camera data

**Input:** Path to `predictions.npz`

**Output:** JSON with structure:
```json
{
  "numFrames": 10,
  "cameras": [
    {
      "index": 0,
      "extrinsic": [[...], [...], [...]],  // 3×4 matrix
      "intrinsic": [[...], [...], [...]]   // 3×3 matrix
    },
    ...
  ]
}
```

#### 2. NPZ Parser Service (`server/services/npz-parser.ts`)

TypeScript wrapper that:
- Spawns Python process to parse NPZ files
- Handles errors (file not found, parse failures)
- Validates NPZ format (checks ZIP magic bytes)
- Returns typed camera data

**Methods:**
- `parsePredictions(npzPath: string): Promise<ParsedCameras>`
- `isValidNPZ(filePath: string): Promise<boolean>`

#### 3. API Endpoint (`/api/runs/:runId/cameras`)

REST endpoint that:
- Checks if `predictions.npz` exists for the run
- Calls NPZ parser service
- Returns camera data as JSON
- Handles errors (404 if no predictions, 500 on parse errors)

#### 4. App Integration (`public/app.ts`)

Main application updates:
- **`loadRunCameras(runId)`**: Fetches camera data from API
- **`updateThumbnailCameraMapping()`**: Maps images to camera indices
- **Coordinate conversion**: Uses `CameraTransforms.extrinsicToThreeMatrix()` to convert OpenCV to Three.js
- **Viewer update**: Calls `viewer.setCameraFrustums()` with real transforms

#### 5. Coordinate Transform (`public/viewer/CameraTransforms.ts`)

Handles coordinate system conversion:
- OpenCV convention (right-handed, +Z forward, +Y down)
- Three.js convention (right-handed, +Z backward, +Y up)

**Transform pipeline:**
1. Convert 3×4 extrinsic to 4×4 homogeneous matrix
2. Invert to get camera→world transform
3. Apply OpenGL fix (flip Y and Z axes)
4. Optional: Apply 180° Y rotation for VGGT viewer alignment
5. Extract position and quaternion for Three.js

## Key Implementation Details

### Image-to-Camera Mapping

**Critical assumption:** Images are uploaded in sorted filename order, and VGGT preserves this order when processing.

```typescript
// In uploadImages():
metadata.images = savedImages.sort(); // Alphabetical sort

// In loadRunCameras():
// Camera[i] corresponds to image[i]
this.cameraTransforms = data.cameras.map((cam, index) => {
  // Convert cam.extrinsic to Three.js transform
});

// In updateThumbnailCameraMapping():
images.forEach((img, index) => {
  indices.set(img.id, index); // Map image ID → camera index
});
```

### Loading States

The integration includes comprehensive status feedback:

1. **"Loading camera data..."** - Fetching from API
2. **"Loaded N cameras"** - Success message with count
3. **404 handling** - Gracefully handles missing predictions file
4. **Error handling** - Shows parse errors to user

### Error Handling

```typescript
try {
  const response = await fetch(`/api/runs/${runId}/cameras`);

  // Handle missing predictions gracefully
  if (response.status === 404) {
    console.warn('No camera data available');
    this.cameraTransforms = [];
    return;
  }

  // Parse response
  const data = await response.json();

  // Convert to viewer format...
} catch (error) {
  this.setStatus('error', `Failed to load cameras: ${error}`);
  this.cameraTransforms = [];
}
```

## Testing Recommendations

### Unit Testing

1. **NPZ Parser**
   ```bash
   # Test with sample NPZ file
   python3 server/utils/parse_npz.py /path/to/predictions.npz

   # Should output valid JSON with cameras array
   ```

2. **NPZ Parser Service**
   ```typescript
   const result = await npzParser.parsePredictions(npzPath);
   expect(result.cameras).toHaveLength(10);
   expect(result.cameras[0].extrinsic).toHaveLength(3);
   ```

3. **Coordinate Transforms**
   ```typescript
   const matrix = CameraTransforms.extrinsicToThreeMatrix(extrinsic);
   const { position, quaternion } = CameraTransforms.getPositionAndRotation(matrix);
   expect(position).toBeInstanceOf(THREE.Vector3);
   expect(quaternion).toBeInstanceOf(THREE.Quaternion);
   ```

### Integration Testing

**Full workflow:**

1. **Upload images**
   - Upload 5-10 test images
   - Verify sorted order in metadata

2. **Process with VGGT**
   - Wait for processing to complete
   - Check that `predictions.npz` is downloaded

3. **Load completed run**
   - Select run from history
   - Verify GLB loads
   - Verify cameras load (check console for "Loaded N cameras")
   - Verify camera frustums appear in 3D viewer

4. **Test hover interactions**
   - Hover over image thumbnails
   - Verify camera animations to corresponding positions
   - Verify hover leave returns to default view

5. **Test camera visibility toggle**
   - Toggle "Show Cameras" setting
   - Verify frustums appear/disappear

### Manual Testing Checklist

- [ ] Server starts without errors
- [ ] `/api/runs/:runId/cameras` returns valid JSON for completed run
- [ ] Camera count matches image count
- [ ] Camera frustums visible in 3D scene
- [ ] Thumbnail hover triggers camera animation
- [ ] Camera positions appear reasonable (not at origin)
- [ ] Multiple runs can be loaded without issues
- [ ] Missing predictions.npz handled gracefully (no crash)
- [ ] Parse errors shown to user

## Demo Workflow

### Setup
```bash
cd /Users/neil/projects/unsplash-clustering/explorations/01
bun install
bun run server/index.ts
```

### Demo Steps

1. **Open browser** → `http://localhost:3000`

2. **Upload images**
   - Drag & drop 5-10 images
   - Note: Images should be of the same scene from different angles

3. **Configure settings**
   - Set confidence threshold (default: 45%)
   - Enable "Show Cameras"
   - Select prediction mode (Pointmap or Depth+Camera)

4. **Process**
   - Click "Process with VGGT"
   - Wait for completion (check server logs)

5. **Load results**
   - Select completed run from history
   - 3D model loads in viewer
   - Camera frustums appear in scene

6. **Interact**
   - Hover over image thumbnails
   - Camera view animates to that camera's position
   - Rotate/pan in 3D viewer to explore scene

## Dependencies

### Server-side
- **Python 3** with NumPy (for NPZ parsing)
- **@gradio/client** (for VGGT API)
- **Elysia** (web framework)

### Client-side
- **Three.js** (3D rendering)
- **CameraTransforms utility** (coordinate conversion)

## Files Modified

### Created
- `server/utils/parse_npz.py` - NPZ parser script
- `server/services/npz-parser.ts` - NPZ parser service
- `CAMERA_INTEGRATION.md` - This documentation

### Modified
- `server/index.ts` - Added `/api/runs/:runId/cameras` endpoint
- `public/app.ts` - Added camera loading and mapping logic
  - `loadRunCameras()` - Fetch and convert camera data
  - `updateThumbnailCameraMapping()` - Map images to cameras
  - Removed `loadMockCameraTransforms()` - No longer needed
  - Updated `loadRun()` - Calls camera loading

## Troubleshooting

### "No camera data available"
- Check that VGGT processing completed successfully
- Verify `predictions.npz` was downloaded
- Check server logs for download errors

### Parse errors
- Ensure Python 3 with NumPy is installed
- Check NPZ file is not corrupted (try loading in Python)
- Verify file permissions on `predictions.npz`

### Cameras at wrong positions
- Check coordinate transform pipeline
- Verify `applyYRotation` parameter matches VGGT convention
- Check that extrinsic matrices are 3×4 format

### Thumbnail hover not working
- Verify image indices are set correctly
- Check that camera transforms array has same length as images
- Ensure `onThumbnailHover` callback is registered

### Camera frustums not visible
- Check "Show Cameras" setting is enabled
- Verify `setCameraFrustums()` was called
- Check camera positions aren't at origin (all zeros)
- Try zooming out in viewer

## Future Enhancements

1. **Cache parsed NPZ data** - Avoid re-parsing on every request
2. **Download predictions.npz** - VGGT client should fetch this file
3. **Camera FOV visualization** - Use intrinsic matrix for accurate frustum
4. **Camera path animation** - Animate through all camera positions
5. **Image preview in 3D** - Show image thumbnails at camera positions
6. **Error recovery** - Retry failed NPZ downloads

## References

- VGGT Integration Notes: `_DOCS/vggt_integration_notes.md`
- Camera Transforms: `public/viewer/CameraTransforms.ts`
- VGGT Client: `server/services/vggt-client.ts`
- Example usage: `public/viewer/CameraTransforms.test.ts`
