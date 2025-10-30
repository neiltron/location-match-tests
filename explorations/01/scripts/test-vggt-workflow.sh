#!/bin/bash

#
# VGGT Workflow Test Script
#
# Full integration test workflow:
# 1. Create run
# 2. Upload test images
# 3. Process with VGGT
# 4. Poll status
# 5. Download artifacts
#

set -e  # Exit on error

BASE_URL="http://localhost:3000/api"
TEST_IMAGES_DIR="./storage/test_images"
POLL_INTERVAL=5
MAX_POLLS=120

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# Check if server is running
check_server() {
    log_info "Checking if server is running..."
    if ! curl -s "$BASE_URL/health" > /dev/null; then
        log_error "Server is not running at $BASE_URL"
        log_info "Please start the server with: bun run server/index.ts"
        exit 1
    fi
    log_success "Server is running"
}

# Test connection to HuggingFace
test_connection() {
    log_info "Testing HuggingFace connection..."

    response=$(curl -s "$BASE_URL/test/vggt-connection")
    connected=$(echo "$response" | jq -r '.connected')

    if [ "$connected" == "true" ]; then
        log_success "Connected to facebook/vggt space"
        endpoints=$(echo "$response" | jq -r '.endpoints | length')
        log_info "Available endpoints: $endpoints"
    else
        log_error "Failed to connect to HuggingFace space"
        echo "$response" | jq '.'
        exit 1
    fi
}

# Create a new run
create_run() {
    log_info "Creating new run..."

    response=$(curl -s -X POST "$BASE_URL/runs" \
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

    RUN_ID=$(echo "$response" | jq -r '.runId')

    if [ "$RUN_ID" == "null" ] || [ -z "$RUN_ID" ]; then
        log_error "Failed to create run"
        echo "$response" | jq '.'
        exit 1
    fi

    log_success "Created run: $RUN_ID"
}

# Upload test images
upload_images() {
    log_info "Uploading test images..."

    if [ ! -d "$TEST_IMAGES_DIR" ]; then
        log_error "Test images directory not found: $TEST_IMAGES_DIR"
        exit 1
    fi

    # Count images
    image_count=$(find "$TEST_IMAGES_DIR" -type f \( -name "*.jpg" -o -name "*.jpeg" -o -name "*.png" \) | wc -l | tr -d ' ')

    if [ "$image_count" -eq 0 ]; then
        log_error "No images found in $TEST_IMAGES_DIR"
        exit 1
    fi

    log_info "Found $image_count images"

    # Build form data for curl
    curl_args=()
    for img in "$TEST_IMAGES_DIR"/*.{jpg,jpeg,png} 2>/dev/null; do
        if [ -f "$img" ]; then
            curl_args+=(-F "$(basename "$img")=@$img")
        fi
    done

    response=$(curl -s -X POST "$BASE_URL/runs/$RUN_ID/images" \
        "${curl_args[@]}")

    uploaded=$(echo "$response" | jq -r '.imagesUploaded')

    if [ "$uploaded" == "null" ] || [ "$uploaded" -eq 0 ]; then
        log_error "Failed to upload images"
        echo "$response" | jq '.'
        exit 1
    fi

    log_success "Uploaded $uploaded images"
}

# Process with VGGT
process_vggt() {
    log_info "Starting VGGT processing..."
    log_warn "This will submit to HuggingFace and use GPU quota"

    response=$(curl -s -X POST "$BASE_URL/runs/$RUN_ID/process")

    status=$(echo "$response" | jq -r '.status')

    if [ "$status" != "processing" ]; then
        log_error "Failed to start processing"
        echo "$response" | jq '.'
        exit 1
    fi

    log_success "Processing started"
}

# Poll run status
poll_status() {
    log_info "Polling run status (max $MAX_POLLS attempts)..."

    attempts=0
    while [ $attempts -lt $MAX_POLLS ]; do
        attempts=$((attempts + 1))

        response=$(curl -s "$BASE_URL/runs/$RUN_ID")
        current_status=$(echo "$response" | jq -r '.status')

        echo -ne "\r  Attempt $attempts/$MAX_POLLS - Status: $current_status"

        if [ "$current_status" == "completed" ]; then
            echo ""
            log_success "Run completed!"
            return 0
        elif [ "$current_status" == "failed" ]; then
            echo ""
            log_error "Run failed"
            error=$(echo "$response" | jq -r '.error // "Unknown error"')
            log_error "Error: $error"
            exit 1
        fi

        sleep $POLL_INTERVAL
    done

    echo ""
    log_error "Polling timeout after $MAX_POLLS attempts"
    exit 1
}

# Download and verify artifacts
download_artifacts() {
    log_info "Checking artifacts..."

    response=$(curl -s "$BASE_URL/runs/$RUN_ID")

    glb_path=$(echo "$response" | jq -r '.artifacts.glb // empty')
    predictions_path=$(echo "$response" | jq -r '.artifacts.predictions // empty')

    if [ -n "$glb_path" ]; then
        log_info "Downloading GLB file..."
        glb_file="./test_output_${RUN_ID}.glb"
        curl -s "$BASE_URL$glb_path" -o "$glb_file"

        file_size=$(stat -f%z "$glb_file" 2>/dev/null || stat -c%s "$glb_file" 2>/dev/null || echo "0")

        if [ "$file_size" -gt 100 ]; then
            log_success "GLB file downloaded: $glb_file (${file_size} bytes)"

            # Verify GLB magic number
            if command -v xxd &> /dev/null; then
                magic=$(xxd -l 4 -p "$glb_file")
                if [ "$magic" == "676c5446" ]; then
                    log_success "GLB file is valid (magic: glTF)"
                else
                    log_warn "GLB magic number unexpected: $magic"
                fi
            fi
        else
            log_error "GLB file is too small or empty"
        fi
    else
        log_warn "No GLB artifact available"
    fi

    if [ -n "$predictions_path" ]; then
        log_info "Predictions.npz available at: $predictions_path"
    else
        log_warn "No predictions artifact available"
    fi
}

# Print summary
print_summary() {
    echo ""
    echo "═══════════════════════════════════════════════════════"
    echo "  VGGT Workflow Test Complete"
    echo "═══════════════════════════════════════════════════════"
    echo ""
    echo "Run ID: $RUN_ID"
    echo "View results: http://localhost:3000/?run=$RUN_ID"
    echo ""
    echo "To clean up: rm -rf ./storage/runs/$RUN_ID"
    echo "═══════════════════════════════════════════════════════"
}

# Main workflow
main() {
    echo "╔═══════════════════════════════════════════════════════╗"
    echo "║        VGGT Workflow Test                             ║"
    echo "╚═══════════════════════════════════════════════════════╝"
    echo ""

    # Step 1: Check server
    check_server

    # Step 2: Test connection
    test_connection

    # Step 3: Create run
    create_run

    # Step 4: Upload images
    upload_images

    # Step 5: Ask for confirmation before processing
    echo ""
    log_warn "About to submit to HuggingFace VGGT space"
    log_warn "This will use GPU quota on the free tier"
    echo ""
    read -p "Continue? (y/N) " -n 1 -r
    echo ""

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Workflow cancelled by user"
        log_info "Run created: $RUN_ID (images uploaded, not processed)"
        exit 0
    fi

    # Step 6: Process with VGGT
    process_vggt

    # Step 7: Poll status
    poll_status

    # Step 8: Download artifacts
    download_artifacts

    # Step 9: Summary
    print_summary
}

# Run main workflow
main
