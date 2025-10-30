#!/bin/bash
# Frontend Build Script
# Compiles all TypeScript files to JavaScript for browser

set -e

echo "🔨 Building frontend TypeScript files..."

# Build main app
echo "  → app.ts"
bun build public/app.ts --outdir public --target browser --format esm

# Build components
echo "  → ImageUploader.ts"
bun build public/components/ImageUploader.ts --outdir public/components --target browser --format esm

echo "  → VGGTSettings.ts"
bun build public/components/VGGTSettings.ts --outdir public/components --target browser --format esm

echo "  → RunHistory.ts"
bun build public/components/RunHistory.ts --outdir public/components --target browser --format esm

echo "✅ Build complete!"
echo ""
echo "Files generated:"
echo "  - public/app.js"
echo "  - public/components/ImageUploader.js"
echo "  - public/components/VGGTSettings.js"
echo "  - public/components/RunHistory.js"
echo ""
echo "Start server with: bun run dev"
