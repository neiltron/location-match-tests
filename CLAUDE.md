# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an image scene matching and clustering project for Unsplash photos. The goal is to identify groups of images that depict the same physical scene using computer vision techniques (feature detection, matching, and geometric verification).

## Core Architecture

### Directory Structure

```
.
├── lightglue_pipeline_cuda.py    # Production CUDA pipeline
├── kornia_pipeline.py             # macOS/MPS compatible pipeline
├── run_cuda_pipeline.sh           # Main entry point script
├── scripts/
│   ├── postprocessing/            # Cluster analysis and organization
│   │   ├── cluster_images.py
│   │   ├── build_clusters_from_matches.py
│   │   └── organize_clusters.py
│   ├── visualization/             # Result visualization tools
│   │   ├── visualize_results.py
│   │   ├── visualize_overlaps.py
│   │   └── visualize_overlap_matrix.py
│   ├── analysis/                  # Diagnostic and analysis tools
│   │   └── diagnose_matches.py
│   └── legacy/                    # Earlier pipeline implementations
│       ├── lightglue_pipeline.py
│       ├── lightglue_pipeline_full.py
│       ├── run_full_pipeline.py
│       ├── simple_scene_matching.py
│       └── match_features_cpu.py
├── outputs/                       # Pipeline outputs
├── images/                        # Input images
└── tools/                         # Additional utilities
```

### Pipeline Approaches

The project implements multiple feature matching pipelines:

1. **LightGlue CUDA Pipeline** (`lightglue_pipeline_cuda.py`) - Production pipeline for GPU processing
   - Uses LightGlue with SuperPoint features for high-quality matching
   - Optimized for NVIDIA CUDA GPUs
   - Performs N×N exhaustive matching across all image pairs
   - Outputs complete match database + scene clusters

2. **Kornia Pipeline** (`kornia_pipeline.py`) - macOS/MPS compatible alternative
   - Uses Kornia's integrated LightGlue implementation
   - Supports multiple feature types: DISK, DeDoDe, SuperPoint
   - Compatible with MPS (Apple Silicon), CUDA, and CPU

3. **Legacy Pipelines** (`scripts/legacy/`) - Earlier explorations
   - Simple global features approach (NetVLAD, color histograms)
   - CPU-based matching implementations
   - Kept for reference and experimentation

### Processing Flow

All pipelines follow a similar structure:

1. **Feature Extraction**: Extract local or global features from images
2. **Pair Generation**: Generate candidate pairs (all N×N or top-K similar)
3. **Matching**: Match features between pairs
4. **Filtering**: Apply thresholds (min_matches, min_confidence)
5. **Clustering**: Build connected components via graph DFS
6. **Output**: Save match database, filtered matches, and scene cluster files

### Key Data Structures

- **Match Record**: `{image1, image2, matches, confidence, valid}`
- **Scene Cluster**: Connected component of images with high geometric overlap
- **Features Dict**: `{image_name: {keypoints, descriptors, scores, ...}}`

### Dependencies

The project uses two package management approaches:

1. **UV + pyproject.toml** (primary):
   - Core dependencies: kornia, opencv-python, scikit-learn, matplotlib, pillow
   - Python version locked to 3.11.11
   - Install: `uv sync` or `uv pip install -e .`

2. **CUDA-specific** (`requirements_cuda.txt`):
   - PyTorch with CUDA support
   - LightGlue (installed separately from GitHub)
   - hloc (optional, for comparison)

### External Dependencies

- **LightGlue**: Cloned from https://github.com/cvg/LightGlue.git
- **Hierarchical-Localization (hloc)**: Cloned from https://github.com/cvg/Hierarchical-Localization/

Both are installed via `pip install -e ./LightGlue` and `pip install -e ./Hierarchical-Localization`.

## Common Commands

### Setup

```bash
# Primary setup (CPU/MPS)
uv sync

# CUDA setup (Linux GPU)
uv venv
source .venv/bin/activate
uv pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
uv pip install -r requirements_cuda.txt
git clone https://github.com/cvg/LightGlue.git && uv pip install -e ./LightGlue
git clone --recursive https://github.com/cvg/Hierarchical-Localization/ && uv pip install -e ./Hierarchical-Localization
```

### Running Pipelines

```bash
# CUDA pipeline (Linux GPU) - recommended for production
./run_cuda_pipeline.sh test              # 100 images, quick test
./run_cuda_pipeline.sh small             # 1000 images
./run_cuda_pipeline.sh medium            # 5000 images
./run_cuda_pipeline.sh large             # All images

# Or run directly:
python3 lightglue_pipeline_cuda.py \
  --max_images 100 \
  --min_matches 30 \
  --min_confidence 0.4 \
  --feature_batch_size 16 \
  --match_batch_size 32

# Kornia pipeline (macOS/MPS)
python3 kornia_pipeline.py \
  --feature_type disk \
  --max_images 100 \
  --min_matches 30 \
  --min_confidence 0.3

# Post-processing: Clustering from global features
python3 scripts/postprocessing/cluster_images.py \
  --features outputs/global-feats-netvlad.h5 \
  --method kmeans \
  --n_clusters 20 \
  --visualize

# Legacy: Global features approach
python3 scripts/legacy/run_full_pipeline.py \
  --threshold 0.75 \
  --num_pairs 60
```

### Testing CUDA Setup

```bash
# Verify CUDA availability
python3 -c "import torch; print(f'CUDA: {torch.cuda.is_available()}'); print(f'GPU: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else \"None\"}')"

# Test LightGlue CUDA
python3 -c "from lightglue import LightGlue, SuperPoint; import torch; device = torch.device('cuda'); extractor = SuperPoint().eval().to(device); matcher = LightGlue(features='superpoint').eval().to(device); print('✅ LightGlue CUDA OK')"
```

### Monitoring GPU Jobs

```bash
# GPU utilization
watch -n 1 nvidia-smi

# Processing logs
tail -f cuda_processing.log

# Background processing
nohup python3 lightglue_pipeline_cuda.py [...args...] > cuda_processing.log 2>&1 &
```

## Output Structure

All pipelines produce similar outputs in `outputs/[pipeline_name]/`:

- `all_matches.csv` - Complete match database (all pairs tested)
- `filtered_matches.csv` - Matches above threshold
- `scene_cluster_NNN.txt` - Individual cluster files (one image per line)
- `processing_stats.json` - Performance metrics and match statistics
- `cluster_assignments.txt` - Overall cluster assignments (for clustering methods)

## Important Implementation Details

### GPU Memory Management

The CUDA pipeline uses careful memory management to handle large datasets:

- Features extracted in batches, moved to CPU for storage
- Matching done in batches with periodic `torch.cuda.empty_cache()`
- Fallback to smaller batches on OOM errors
- See `lightglue_pipeline_cuda.py:75-138` and `lightglue_pipeline_cuda.py:160-239`

### Scene Clustering Algorithm

Uses DFS to find connected components in the match graph:

```python
def build_scene_clusters(matches):
    graph = defaultdict(set)
    for match in matches:
        graph[img1].add(img2)
        graph[img2].add(img1)

    # DFS to find connected components
    # See scripts/postprocessing/cluster_images.py:286-316
```

### Configuration Presets

The `run_cuda_pipeline.sh` script provides mode presets:

- **test**: 100 images, 5K pairs, loose thresholds - quick validation
- **small**: 1K images, 50K pairs - ~30 min on RTX 3080
- **medium**: 5K images, 500K pairs - ~4 hours on RTX 3080
- **large**: All images, unlimited pairs - production run

## Performance Expectations

### RTX 3080 (Linux CUDA)
- Feature extraction: ~50-100 images/second
- Matching: ~500-1000 pairs/second
- 10K images: ~12-24 hours for full N×N matching
- Memory: 6-8GB GPU memory

### MPS (Apple Silicon)
- Feature extraction: ~10-30 images/second
- Matching: ~50-200 pairs/second
- Significantly slower than CUDA

## Troubleshooting

### GPU Out of Memory
- Reduce `--feature_batch_size` and `--match_batch_size`
- Limit images with `--max_images`
- Limit pairs with `--max_pairs`

### CUDA Not Detected
- Verify NVIDIA drivers: `nvidia-smi`
- Check PyTorch CUDA: `python3 -c "import torch; print(torch.cuda.is_available())"`
- Reinstall PyTorch with CUDA: `uv pip install torch --index-url https://download.pytorch.org/whl/cu121`

### Kornia Import Errors (macOS)
- Ensure kornia and kornia-rs are installed: `uv pip install kornia kornia-rs`
- Set environment: `export KMP_DUPLICATE_LIB_OK=TRUE`
