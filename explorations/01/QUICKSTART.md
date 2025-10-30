# VGGT Explorer - Quick Start Guide

## 🚀 Getting Started (30 seconds)

```bash
cd /Users/neil/projects/unsplash-clustering/explorations/01/

# Build frontend (if TypeScript was modified)
./build-frontend.sh

# Start server
bun run dev

# Open in browser
open http://localhost:3000
```

## 📁 Project Structure

```
explorations/01/
├── public/                    # Frontend (all you need to edit)
│   ├── index.html            # Main HTML shell
│   ├── style.css             # Global styles (dark theme)
│   ├── app.ts                # Main application coordinator
│   └── components/           # UI components
│       ├── ImageUploader.ts  # Drag & drop uploader
│       ├── VGGTSettings.ts   # Settings form
│       └── RunHistory.ts     # Past runs sidebar
│
├── server/                    # Backend (Elysia + Bun)
│   ├── index.ts              # API server
│   ├── types.ts              # Shared types
│   └── services/             # Storage, Gradio client
│
├── storage/                   # Local file storage
│   └── runs/                 # Run directories
│
├── FRONTEND.md               # 📖 Complete frontend docs
├── TEST_RESULTS.md           # ✅ Test report
├── IMPLEMENTATION_SUMMARY.md # 📝 Implementation details
└── build-frontend.sh         # 🔨 Build script
```

## 🎨 Frontend Components

### ImageUploader
- Drag & drop images
- Thumbnail preview grid
- Remove individual images
- Memory-safe cleanup

### VGGTSettings
- Confidence threshold slider (0-100)
- Prediction mode (pointmap/depth)
- Masking options (black bg, white bg, sky)
- Show cameras toggle
- Auto-save to localStorage

### RunHistory
- List all past runs
- Status badges (queued, processing, completed, failed)
- Click to load run
- Auto-refresh support

### Main App (app.ts)
- Coordinates all components
- Handles API calls
- Updates status bar
- Manages workflow

## 🔧 Development Workflow

### Making Changes

1. **Edit TypeScript files**
   ```bash
   vim public/app.ts
   # or
   vim public/components/ImageUploader.ts
   ```

2. **Rebuild JavaScript**
   ```bash
   ./build-frontend.sh
   ```

3. **Refresh browser** (server auto-reloads in --hot mode)

### Testing

```bash
# API health
curl http://localhost:3000/api/health

# List runs
curl http://localhost:3000/api/runs

# Check static files
curl http://localhost:3000/
```

## 🎯 Usage Flow

1. **Upload Images**
   - Drag & drop or click to browse
   - Thumbnails appear in grid
   - Submit button enables

2. **Configure Settings**
   - Adjust confidence threshold
   - Select prediction mode
   - Toggle masking options
   - Settings auto-save

3. **Process**
   - Click "Process Images"
   - Status bar shows progress:
     - "Creating run..."
     - "Uploading images..."
     - "Processing complete"
   - Run appears in history

4. **View Results**
   - Click run in history sidebar
   - Settings load automatically
   - 3D model loads (when ready)

## 📋 API Endpoints

```
GET  /api/health                      Health check
GET  /api/runs                        List all runs
GET  /api/runs/:runId                 Get run details
POST /api/runs                        Create new run
POST /api/runs/:runId/images          Upload images
GET  /api/runs/:runId/artifacts/:type Download artifact
```

## 🎨 Design System

### Colors (Dark Theme)
- **Background**: `#0f1419`, `#1a1f2e`, `#252c3c`
- **Text**: `#e8eaed`, `#9aa0a6`, `#6b7280`
- **Accent**: `#3b82f6` (blue)
- **Success**: `#10b981` (green)
- **Warning**: `#f59e0b` (orange)
- **Error**: `#ef4444` (red)

### Layout
- **Desktop**: 3-column grid (280px | flex | 400px)
- **Tablet**: Narrower sidebars
- **Mobile**: Stacked single column

## 📦 Dependencies

### Backend
- Bun (runtime)
- Elysia (server)
- @elysiajs/static (file serving)
- @elysiajs/cors (CORS)
- @gradio/client (HuggingFace API)

### Frontend
- Three.js (from CDN)
- Vanilla TypeScript (no frameworks!)

## 🐛 Troubleshooting

### TypeScript changes not showing?
```bash
./build-frontend.sh
```

### Server not starting?
```bash
# Check if port 3000 is in use
lsof -i :3000

# Kill process if needed
kill -9 <PID>
```

### Images not uploading?
- Check browser console for errors
- Verify API is running (`curl http://localhost:3000/api/health`)
- Check network tab for failed requests

### Styles not loading?
- Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
- Check `/style.css` loads: `curl http://localhost:3000/style.css`

## 📚 Documentation

- **FRONTEND.md** - Complete technical documentation
- **TEST_RESULTS.md** - Test report and metrics
- **IMPLEMENTATION_SUMMARY.md** - Detailed implementation notes
- **README.md** - Project overview

## ✅ Quick Tests

### Test Upload
1. Open http://localhost:3000
2. Drag & drop an image
3. Verify thumbnail appears
4. Click remove button
5. Verify thumbnail disappears

### Test Settings
1. Move confidence slider
2. Verify value updates
3. Toggle prediction mode
4. Check localStorage in DevTools

### Test Run Creation
1. Upload images
2. Configure settings
3. Click "Process Images"
4. Watch status bar
5. Verify run in history

### Test Run History
1. Click refresh button
2. Verify runs load
3. Click a run
4. Verify settings populate

## 🚀 Next Steps

1. **Implement 3D Viewer**
   - Create `public/viewer/Viewer3D.ts`
   - Load GLB models from API
   - Add camera controls
   - Show camera frustums

2. **Add WebSocket**
   - Real-time status updates
   - Progress indicators
   - Live model streaming

3. **Polish UI**
   - Toast notifications
   - Loading animations
   - Keyboard shortcuts
   - Help tooltips

## 💡 Tips

- Use browser DevTools Network tab to debug API calls
- Check browser Console for JavaScript errors
- Use `(window as any).app.getState()` in console to inspect state
- localStorage is used for settings - clear if needed
- Server runs in hot-reload mode for backend changes

## 🎓 Learn More

- **Three.js**: https://threejs.org/docs/
- **Elysia**: https://elysiajs.com/
- **Bun**: https://bun.sh/docs
- **TypeScript**: https://www.typescriptlang.org/docs/

---

**Questions?** Check the full documentation in FRONTEND.md or TEST_RESULTS.md.

**Issues?** Enable verbose logging in browser DevTools Console.

**Ready to code?** Start with `public/viewer/Viewer3D.ts` for 3D integration! 🎮
