# Unsplash Scene Clustering

Identifies groups of images depicting the same physical scene using computer vision feature matching and geometric verification.

## What It Does

1. **Extracts features** from images using SuperPoint
2. **Matches features** across all image pairs using LightGlue
3. **Filters matches** based on geometric confidence thresholds
4. **Clusters images** into scene groups using graph connectivity

## Quick Start

### Setup (CUDA/Linux)

```bash
# Install dependencies
uv sync
source .venv/bin/activate
uv pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
uv pip install -r requirements_cuda.txt

# Install LightGlue
git clone https://github.com/cvg/LightGlue.git && uv pip install -e ./LightGlue
```

### Setup (macOS/MPS)

```bash
uv sync
# Uses kornia_pipeline.py instead
```

## Usage

### CUDA Pipeline (Production)

```bash
# Quick test (100 images)
./run_cuda_pipeline.sh test

# Small dataset (1000 images, ~30 min)
./run_cuda_pipeline.sh small

# Medium dataset (5000 images, ~4 hours)
./run_cuda_pipeline.sh medium

# Full dataset (all images)
./run_cuda_pipeline.sh large
```

### macOS/MPS Pipeline

```bash
python3 kornia_pipeline.py \
  --feature_type disk \
  --max_images 100 \
  --min_matches 30 \
  --min_confidence 0.3
```

### Direct Execution

```bash
python3 lightglue_pipeline_cuda.py \
  --image_dir images \
  --output_dir outputs/lightglue_cuda \
  --max_images 100 \
  --min_matches 30 \
  --min_confidence 0.4 \
  --feature_batch_size 16 \
  --match_batch_size 32
```

## Outputs

Results saved to `outputs/lightglue_cuda/`:

- `all_matches.csv` - Complete match database
- `filtered_matches.csv` - Matches above threshold
- `scene_cluster_NNN.txt` - Individual scene cluster files (one image per line)
- `processing_stats.json` - Performance metrics and statistics

## Key Parameters

- `--min_matches`: Minimum feature matches required (default: 30)
- `--min_confidence`: Geometric confidence threshold 0-1 (default: 0.5)
- `--feature_batch_size`: GPU batch size for feature extraction (default: 16)
- `--match_batch_size`: GPU batch size for matching (default: 32)
- `--max_images`: Limit number of images processed
- `--max_pairs`: Limit number of pairs to match

## Performance

**RTX 3080:**
- Feature extraction: ~50-100 images/sec
- Matching: ~500-1000 pairs/sec
- 10K images: ~12-24 hours full N×N matching

**Apple Silicon (MPS):**
- Feature extraction: ~10-30 images/sec
- Matching: ~50-200 pairs/sec

## Monitoring

```bash
# GPU utilization
watch -n 1 nvidia-smi

# Processing logs
tail -f cuda_processing_*.log

# Background job status
ps aux | grep lightglue
```

## Troubleshooting

**GPU Out of Memory:**
- Reduce `--feature_batch_size` and `--match_batch_size`
- Use `--max_images` or `--max_pairs` to limit scope

**CUDA Not Available:**
- Check drivers: `nvidia-smi`
- Verify PyTorch: `python3 -c "import torch; print(torch.cuda.is_available())"`
- Reinstall: `uv pip install torch --index-url https://download.pytorch.org/whl/cu121`

## Additional Tools

- `scripts/postprocessing/` - Cluster analysis and organization utilities
- `scripts/visualization/` - Result visualization tools
- `scripts/analysis/` - Match quality diagnostics
- `scripts/legacy/` - Earlier pipeline implementations

## Documentation

- `CLAUDE.md` - Detailed architecture and implementation notes
- `SETUP_LINUX_GPU.md` - Complete Linux GPU setup guide
