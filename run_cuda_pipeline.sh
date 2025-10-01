#!/bin/bash

# CUDA LightGlue Pipeline Runner
# Usage: ./run_cuda_pipeline.sh [test|small|medium|large|custom]

set -e

# Configuration
IMAGE_DIR="images"
OUTPUT_DIR="outputs/lightglue_cuda"
LOG_FILE="cuda_processing_$(date +%Y%m%d_%H%M%S).log"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 LightGlue CUDA Pipeline Runner${NC}"
echo "======================================"

# Check if virtual environment is activated
if [[ "$VIRTUAL_ENV" == "" ]]; then
    echo -e "${YELLOW}⚠️  Virtual environment not detected. Activating...${NC}"
    source .venv/bin/activate
fi

# Verify CUDA setup
echo -e "${GREEN}🔧 Verifying CUDA setup...${NC}"
python3 -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}'); print(f'GPU: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else \"None\"}')"

if ! python3 -c "import torch; exit(0 if torch.cuda.is_available() else 1)"; then
    echo -e "${RED}❌ CUDA not available! Please check your setup.${NC}"
    exit 1
fi

# Count images
IMAGE_COUNT=$(find $IMAGE_DIR -name "*.jpg" | wc -l)
echo -e "${GREEN}📁 Found $IMAGE_COUNT images in $IMAGE_DIR${NC}"

# Configuration presets
MODE=${1:-"test"}

case $MODE in
    "test")
        echo -e "${YELLOW}🧪 Running TEST mode (100 images)${NC}"
        MAX_IMAGES=100
        MIN_MATCHES=20
        MIN_CONFIDENCE=0.3
        FEATURE_BATCH=16
        MATCH_BATCH=32
        MAX_PAIRS=5000
        ;;
    "small")
        echo -e "${YELLOW}📊 Running SMALL mode (1000 images)${NC}"
        MAX_IMAGES=1000
        MIN_MATCHES=30
        MIN_CONFIDENCE=0.4
        FEATURE_BATCH=32
        MATCH_BATCH=64
        MAX_PAIRS=50000
        ;;
    "medium")
        echo -e "${YELLOW}📈 Running MEDIUM mode (5000 images)${NC}"
        MAX_IMAGES=5000
        MIN_MATCHES=40
        MIN_CONFIDENCE=0.5
        FEATURE_BATCH=32
        MATCH_BATCH=64
        MAX_PAIRS=500000
        ;;
    "large")
        echo -e "${YELLOW}🌟 Running LARGE mode (all images)${NC}"
        MAX_IMAGES=""
        MIN_MATCHES=50
        MIN_CONFIDENCE=0.5
        FEATURE_BATCH=32
        MATCH_BATCH=64
        MAX_PAIRS=""
        ;;
    "custom")
        echo -e "${YELLOW}⚙️  Running CUSTOM mode - set your own parameters${NC}"
        # Use custom parameters or defaults
        MAX_IMAGES=${MAX_IMAGES:-""}
        MIN_MATCHES=${MIN_MATCHES:-50}
        MIN_CONFIDENCE=${MIN_CONFIDENCE:-0.5}
        FEATURE_BATCH=${FEATURE_BATCH:-32}
        MATCH_BATCH=${MATCH_BATCH:-64}
        MAX_PAIRS=${MAX_PAIRS:-""}
        ;;
    *)
        echo -e "${RED}❌ Unknown mode: $MODE${NC}"
        echo "Usage: $0 [test|small|medium|large|custom]"
        echo ""
        echo "Modes:"
        echo "  test   - 100 images, quick test"
        echo "  small  - 1000 images, ~30 min"
        echo "  medium - 5000 images, ~4 hours"
        echo "  large  - all images, full processing"
        echo "  custom - use environment variables"
        exit 1
        ;;
esac

# Build command
CMD="python3 lightglue_pipeline_cuda.py"
CMD="$CMD --image_dir $IMAGE_DIR"
CMD="$CMD --output_dir $OUTPUT_DIR"
CMD="$CMD --min_matches $MIN_MATCHES"
CMD="$CMD --min_confidence $MIN_CONFIDENCE"
CMD="$CMD --feature_batch_size $FEATURE_BATCH"
CMD="$CMD --match_batch_size $MATCH_BATCH"

if [[ -n "$MAX_IMAGES" ]]; then
    CMD="$CMD --max_images $MAX_IMAGES"
fi

if [[ -n "$MAX_PAIRS" ]]; then
    CMD="$CMD --max_pairs $MAX_PAIRS"
fi

# Show configuration
echo ""
echo -e "${GREEN}📋 Configuration:${NC}"
echo "  Images to process: ${MAX_IMAGES:-'all'}"
echo "  Min matches: $MIN_MATCHES"
echo "  Min confidence: $MIN_CONFIDENCE"
echo "  Feature batch size: $FEATURE_BATCH"
echo "  Match batch size: $MATCH_BATCH"
echo "  Max pairs: ${MAX_PAIRS:-'unlimited'}"
echo "  Output directory: $OUTPUT_DIR"
echo "  Log file: $LOG_FILE"
echo ""

# Estimate processing time
if [[ -n "$MAX_IMAGES" ]]; then
    PAIRS=$((MAX_IMAGES * (MAX_IMAGES - 1) / 2))
    if [[ -n "$MAX_PAIRS" ]] && [[ $PAIRS -gt $MAX_PAIRS ]]; then
        PAIRS=$MAX_PAIRS
    fi
else
    PAIRS=$((IMAGE_COUNT * (IMAGE_COUNT - 1) / 2))
    if [[ -n "$MAX_PAIRS" ]]; then
        PAIRS=$MAX_PAIRS
    fi
fi

ESTIMATED_MINUTES=$((PAIRS / 500 / 60))  # Assuming 500 pairs/second
echo -e "${YELLOW}⏱️  Estimated pairs to process: $PAIRS${NC}"
echo -e "${YELLOW}⏱️  Estimated processing time: ${ESTIMATED_MINUTES} minutes${NC}"
echo ""

# Confirm before starting
read -p "Continue? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Cancelled.${NC}"
    exit 0
fi

# Start processing
echo -e "${GREEN}🚀 Starting processing...${NC}"
echo "Command: $CMD"
echo ""

# Run with logging
mkdir -p "$(dirname "$LOG_FILE")"
echo "Started at: $(date)" > "$LOG_FILE"
echo "Command: $CMD" >> "$LOG_FILE"
echo "===================" >> "$LOG_FILE"

# Run in background if it's a large job
if [[ "$MODE" == "large" || "$MODE" == "medium" ]]; then
    echo -e "${YELLOW}📝 Running in background. Monitor with: tail -f $LOG_FILE${NC}"
    nohup $CMD >> "$LOG_FILE" 2>&1 &
    PID=$!
    echo "Process ID: $PID"
    echo "Process ID: $PID" >> "$LOG_FILE"
    
    # Monitor GPU usage
    echo ""
    echo -e "${GREEN}💡 Monitor GPU usage with: watch -n 1 nvidia-smi${NC}"
    echo -e "${GREEN}💡 Monitor progress with: tail -f $LOG_FILE${NC}"
    echo -e "${GREEN}💡 Check if running with: ps -p $PID${NC}"
    echo -e "${GREEN}💡 Kill if needed with: kill $PID${NC}"
    
else
    # Run in foreground for smaller jobs
    $CMD 2>&1 | tee -a "$LOG_FILE"
fi

echo ""
echo -e "${GREEN}✅ Pipeline started! Check $LOG_FILE for progress.${NC}"