# Camera Animation System - Testing Guide

## Quick Start Test

### 1. Build the System
```bash
cd /Users/neil/projects/unsplash-clustering/explorations/01
./build-viewer.sh
```

### 2. Start the Server
```bash
bun run dev
```

### 3. Open Browser
Navigate to: `http://localhost:3000`

---

## Test Scenarios

### Test 1: Basic Hover Animation
**Steps**:
1. Upload 5 images (any images will work)
2. Wait for thumbnails to appear in the grid
3. Hover over the first thumbnail
4. Observe the 3D view camera smoothly animating

**Expected Result**:
- ✅ Camera smoothly moves to a new position (0.8s)
- ✅ Blue camera frustum visible in scene
- ✅ Grid and lighting visible
- ✅ No console errors

---

### Test 2: Rapid Hover Changes
**Steps**:
1. With 5 images uploaded
2. Quickly move mouse over multiple thumbnails
3. Don't let mouse rest on any single thumbnail

**Expected Result**:
- ✅ Camera smoothly transitions between positions
- ✅ Previous animation is interrupted cleanly
- ✅ No jittery motion or jumps
- ✅ Final position matches last hovered thumbnail

---

### Test 3: Hover Leave Behavior
**Steps**:
1. Upload 5 images
2. Hover over a thumbnail for 1 second
3. Move mouse away from all thumbnails
4. Wait 300ms

**Expected Result**:
- ✅ Camera animates to thumbnail position
- ✅ After leaving, camera returns to default view
- ✅ Return animation takes ~1.0 second
- ✅ Smooth transition back

---

### Test 4: Manual Control Interruption
**Steps**:
1. Upload 5 images
2. Hover over a thumbnail
3. While camera is animating, click and drag in 3D view
4. Manually rotate the camera

**Expected Result**:
- ✅ Animation stops immediately when user clicks
- ✅ Manual control is smooth and responsive
- ✅ No fighting between animation and manual control
- ✅ Camera stays where user positioned it

---

### Test 5: Manual Control + Hover Leave
**Steps**:
1. Upload 5 images
2. Manually drag camera to a custom position
3. Hover over a thumbnail
4. Move mouse away from thumbnails

**Expected Result**:
- ✅ Camera animates to thumbnail position on hover
- ✅ Camera does NOT reset after hover leave (user has control)
- ✅ Camera stays at last animated position
- ✅ User control is respected

---

### Test 6: Reset View Button
**Steps**:
1. Upload 5 images
2. Hover over several thumbnails
3. Manually rotate camera
4. Click "Reset View" button in 3D viewer header

**Expected Result**:
- ✅ Camera smoothly animates back to initial position
- ✅ Takes ~1.0 second
- ✅ Initial view is restored
- ✅ OrbitControls target resets to origin

---

### Test 7: Camera Frustum Visibility Toggle
**Steps**:
1. Upload 5 images
2. Observe blue camera frustums in 3D view
3. Uncheck "Show Camera Frustums" in settings
4. Check the checkbox again

**Expected Result**:
- ✅ Frustums disappear when unchecked
- ✅ Frustums reappear when checked
- ✅ Frustums positioned at mock camera locations
- ✅ Animation still works with frustums hidden

---

## Browser Console Checks

### Expected Console Output
```
3D Viewer initialized
Settings updated: {showCameras: true, ...}
```

### No Errors Expected
Check console (F12) for:
- ❌ No "Cannot read property" errors
- ❌ No "undefined is not a function" errors
- ❌ No GSAP errors
- ❌ No Three.js WebGL errors

---

## Visual Inspection Checklist

### 3D Scene
- [ ] Dark background (#0f1419)
- [ ] Grid helper visible (10x10 gray lines)
- [ ] Blue camera frustums visible (5 total)
- [ ] Camera frustums semi-transparent
- [ ] Smooth 60 FPS rendering

### Thumbnails
- [ ] Images display correctly
- [ ] Hover changes cursor to pointer
- [ ] Remove button appears on hover
- [ ] Thumbnails grid responsive

### Animation Quality
- [ ] No jittery motion
- [ ] Smooth acceleration/deceleration
- [ ] No gimbal lock (rotations work from any angle)
- [ ] Camera doesn't "flip" or "jump"
- [ ] OrbitControls stay in sync

---

## Performance Checks

### CPU Usage
- Idle: <5% CPU
- During animation: <10% CPU
- Manual control: <15% CPU

### Memory
- Initial load: ~50 MB
- With 5 images: ~60 MB
- After 20 animations: <100 MB (no leaks)

### Network
- GSAP CDN: ~50 KB (one-time)
- Three.js CDN: ~600 KB (one-time)
- Images: Varies by upload size

---

## Troubleshooting

### Camera doesn't animate on hover
**Check**:
1. Console for errors
2. Images have been uploaded (thumbnails visible)
3. Viewer initialized (no errors in console)
4. Mock camera transforms loaded (check console)

**Fix**: Rebuild with `./build-viewer.sh`

---

### Animation is jittery
**Check**:
1. GPU acceleration enabled
2. Browser supports WebGL 2
3. No other heavy processes running
4. Dev tools closed (can slow rendering)

**Fix**: Try different browser or reduce complexity

---

### Hover doesn't work
**Check**:
1. Mouse events firing (add console.log in ImageUploader)
2. Image indices set (check imageFile.index)
3. onThumbnailHover callback registered

**Fix**: Check app.ts initialization order

---

### Camera frustums not visible
**Check**:
1. "Show Camera Frustums" checkbox is checked
2. Frustums added to scene (check scene.children in console)
3. Camera position allows viewing frustums

**Fix**: Reset camera view or zoom out

---

## Mock Camera Positions

The system uses 5 hardcoded camera positions for testing:

| Index | Position      | Description |
|-------|---------------|-------------|
| 0     | [2, 1, 3]     | Right       |
| 1     | [-2, 1.5, 2]  | Left        |
| 2     | [0, 3, 4]     | Top         |
| 3     | [3, 0.5, -2]  | Front-right |
| 4     | [-3, 2, -1]   | Back-left   |

All cameras look at origin [0, 0, 0].

---

## Debug Commands

Open browser console and try:

```javascript
// Check app state
app.getState()

// Get viewer instance
const viewer = app.viewer

// Get animator
const animator = viewer.getAnimator()

// Check if animating
animator.isAnimating()

// Manually trigger animation
viewer.animateToCamera({
  position: [5, 5, 5],
  rotation: [0, 0, 0, 1],
  lookAt: [0, 0, 0]
}, 2.0)

// Reset camera
viewer.resetCamera()

// Get camera transforms
app.cameraTransforms
```

---

## Success Criteria

The camera animation system is working correctly if:

✅ All 7 test scenarios pass
✅ No console errors
✅ Smooth 60 FPS animation
✅ Hover interactions feel responsive
✅ Manual control is respected
✅ Memory usage stays under 100 MB
✅ CPU usage stays under 15%

---

## Next Steps

Once testing is complete:

1. **Integrate real camera data** from VGGT predictions.npz
2. **Add server endpoint** to parse and serve camera transforms
3. **Map images to cameras** via filename matching
4. **Test with production datasets** (real 3D reconstructions)
5. **User testing** for feedback on animation timing
6. **Fine-tune** duration and easing based on feedback

---

## Known Issues

None at this time. If issues are found during testing, document here.

---

## Testing Status

- [ ] Test 1: Basic Hover Animation
- [ ] Test 2: Rapid Hover Changes
- [ ] Test 3: Hover Leave Behavior
- [ ] Test 4: Manual Control Interruption
- [ ] Test 5: Manual Control + Hover Leave
- [ ] Test 6: Reset View Button
- [ ] Test 7: Camera Frustum Visibility Toggle

**Tester**: ___________
**Date**: ___________
**Browser**: ___________
**OS**: ___________
**Result**: ⬜ Pass | ⬜ Fail | ⬜ Needs Work
