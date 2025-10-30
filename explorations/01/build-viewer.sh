#!/bin/bash
# Build script for viewer components

set -e

echo "Building viewer components..."

# Build CameraAnimator
bun build public/viewer/CameraAnimator.ts \
  --outfile public/viewer/CameraAnimator.js \
  --target browser --format esm \
  --external three --external gsap

# Build SceneViewer
bun build public/viewer/SceneViewer.ts \
  --outfile public/viewer/SceneViewer.js \
  --target browser --format esm \
  --external three \
  --external three/addons/controls/OrbitControls.js \
  --external three/addons/loaders/GLTFLoader.js \
  --external gsap \
  --external ./CameraAnimator.js

# Build ImageUploader
bun build public/components/ImageUploader.ts \
  --outfile public/components/ImageUploader.js \
  --target browser --format esm

# Build app
bun build public/app.ts \
  --outfile public/app.js \
  --target browser --format esm \
  --external three --external gsap \
  --external ./viewer/SceneViewer.js \
  --external ./components/ImageUploader.js \
  --external ./components/VGGTSettings.js \
  --external ./components/RunHistory.js

echo "Build complete!"
