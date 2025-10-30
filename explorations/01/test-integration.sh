#!/bin/bash

# VGGT Client Integration Test
# This script demonstrates the full API workflow

set -e

API_BASE="http://localhost:3000/api"

echo "=== VGGT Client Integration Test ==="
echo ""

# Test 1: Health check
echo "Test 1: Health Check"
HEALTH=$(curl -s ${API_BASE}/health)
echo "Response: $HEALTH"
echo "✓ Passed"
echo ""

# Test 2: Create a run
echo "Test 2: Create Run"
CREATE_RESPONSE=$(curl -s -X POST ${API_BASE}/runs \
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
  }')
echo "Response: $CREATE_RESPONSE"
RUN_ID=$(echo $CREATE_RESPONSE | grep -o '"runId":"[^"]*"' | cut -d'"' -f4)
echo "Run ID: $RUN_ID"
echo "✓ Passed"
echo ""

# Test 3: Get run status
echo "Test 3: Get Run Status"
STATUS=$(curl -s ${API_BASE}/runs/${RUN_ID})
echo "Response: $STATUS"
echo "✓ Passed"
echo ""

# Test 4: List all runs
echo "Test 4: List All Runs"
LIST=$(curl -s ${API_BASE}/runs)
echo "Response: $LIST"
echo "✓ Passed"
echo ""

echo "=== Manual Testing Required ==="
echo ""
echo "To test the full VGGT processing workflow:"
echo ""
echo "1. Upload images:"
echo "   curl -X POST ${API_BASE}/runs/${RUN_ID}/images \\"
echo "     -F 'image1=@path/to/photo1.jpg' \\"
echo "     -F 'image2=@path/to/photo2.jpg' \\"
echo "     -F 'image3=@path/to/photo3.jpg'"
echo ""
echo "2. Start processing:"
echo "   curl -X POST ${API_BASE}/runs/${RUN_ID}/process"
echo ""
echo "3. Poll status (repeat until completed):"
echo "   curl ${API_BASE}/runs/${RUN_ID}"
echo ""
echo "4. Download artifacts:"
echo "   curl -O ${API_BASE}/runs/${RUN_ID}/artifacts/glb"
echo "   curl -O ${API_BASE}/runs/${RUN_ID}/artifacts/predictions"
echo ""
echo "Note: Processing requires images to be uploaded first"
echo "      and may take several minutes depending on the"
echo "      HuggingFace space GPU availability."
