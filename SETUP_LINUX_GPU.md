# Linux GPU Setup for LightGlue Scene Matching

This guide will set up the unsplash-clustering pipeline on a fresh Linux machine with NVIDIA GPU.

## Hardware Requirements

- **GPU**: NVIDIA RTX 3080 or better (8GB+ VRAM recommended)
- **RAM**: 32GB+ recommended for large datasets
- **Storage**: Fast SSD with sufficient space for images

## 1. System Setup

### Update system and install basic tools
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl wget build-essential python3-dev python3-pip
```

### Install NVIDIA drivers and CUDA
```bash
# Check if GPU is detected
lspci | grep -i nvidia

# Install NVIDIA drivers (if not already installed)
sudo apt install -y nvidia-driver-535

# Install CUDA Toolkit
wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.0-1_all.deb
sudo dpkg -i cuda-keyring_1.0-1_all.deb
sudo apt update
sudo apt install -y cuda-toolkit-12-2

# Add CUDA to PATH
echo 'export PATH=/usr/local/cuda/bin:$PATH' >> ~/.bashrc
echo 'export LD_LIBRARY_PATH=/usr/local/cuda/lib64:$LD_LIBRARY_PATH' >> ~/.bashrc
source ~/.bashrc

# Verify CUDA installation
nvidia-smi
nvcc --version
```

## 2. Python Environment Setup

### Install uv (modern Python package manager)
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
source $HOME/.cargo/env
```

### Clone the repository
```bash
cd ~
git clone <YOUR_REPO_URL> unsplash-clustering
cd unsplash-clustering
```

### Create Python environment with CUDA PyTorch
```bash
# Create virtual environment
uv venv

# Activate environment
source .venv/bin/activate

# Install PyTorch with CUDA support
uv pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

# Install other dependencies
uv pip install numpy scikit-learn matplotlib pillow opencv-python h5py tqdm

# Clone and install LightGlue
git clone https://github.com/cvg/LightGlue.git
uv pip install -e ./LightGlue

# Install hloc (optional, for comparison)
git clone --recursive https://github.com/cvg/Hierarchical-Localization/
uv pip install -e ./Hierarchical-Localization
```

## 3. Verify GPU Setup

### Test CUDA PyTorch installation
```bash
python3 -c "
import torch
print(f'PyTorch version: {torch.__version__}')
print(f'CUDA available: {torch.cuda.is_available()}')
print(f'CUDA version: {torch.version.cuda}')
print(f'GPU count: {torch.cuda.device_count()}')
if torch.cuda.is_available():
    print(f'GPU name: {torch.cuda.get_device_name(0)}')
    print(f'GPU memory: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f}GB')
"
```

### Test LightGlue
```bash
python3 -c "
from lightglue import LightGlue, SuperPoint
import torch

device = torch.device('cuda')
print(f'Using device: {device}')

extractor = SuperPoint().eval().to(device)
matcher = LightGlue(features='superpoint').eval().to(device)
print('✅ LightGlue CUDA setup successful')
"
```

## 4. Prepare Your Dataset

### Upload images to the server
```bash
# Create images directory
mkdir -p ~/unsplash-clustering/images

# Option 1: SCP from local machine
scp -r /path/to/local/images/* user@server:~/unsplash-clustering/images/

# Option 2: Download from cloud storage
# Example for AWS S3:
# aws s3 sync s3://your-bucket/images/ ~/unsplash-clustering/images/

# Option 3: Rsync for efficient transfer
# rsync -avP /path/to/local/images/ user@server:~/unsplash-clustering/images/
```

### Verify image count
```bash
cd ~/unsplash-clustering
find images -name "*.jpg" | wc -l
ls -la images | head -10
```

## 5. Run the Pipeline

### Small test run (recommended first)
```bash
cd ~/unsplash-clustering
source .venv/bin/activate

# Test with 100 images
python3 lightglue_pipeline_cuda.py \
    --max_images 100 \
    --min_matches 30 \
    --min_confidence 0.4 \
    --feature_batch_size 16 \
    --match_batch_size 32
```

### Full dataset run
```bash
# For large datasets (adjust batch sizes based on GPU memory)
python3 lightglue_pipeline_cuda.py \
    --min_matches 50 \
    --min_confidence 0.5 \
    --feature_batch_size 32 \
    --match_batch_size 64 \
    --max_pairs 1000000
```

### Memory-optimized run for very large datasets
```bash
# If you get GPU OOM errors
python3 lightglue_pipeline_cuda.py \
    --feature_batch_size 8 \
    --match_batch_size 16 \
    --min_matches 40
```

## 6. Monitor Performance

### GPU monitoring during processing
```bash
# In another terminal
watch -n 1 nvidia-smi
```

### Check processing logs
```bash
# Follow processing in real-time
tail -f nohup.out

# Or run with explicit logging
python3 lightglue_pipeline_cuda.py [...args...] 2>&1 | tee processing.log
```

### Background processing for large datasets
```bash
# Run in background with nohup
nohup python3 lightglue_pipeline_cuda.py \
    --min_matches 50 \
    --feature_batch_size 16 \
    --match_batch_size 32 > cuda_processing.log 2>&1 &

# Check progress
tail -f cuda_processing.log
```

## 7. Expected Performance

### RTX 3080 Performance Estimates
- **Feature extraction**: ~50-100 images/second
- **Matching**: ~500-1000 pairs/second
- **10,000 images**: ~12-24 hours for full N×N matching
- **Memory usage**: 6-8GB GPU memory

### Optimization Tips
- Increase `feature_batch_size` and `match_batch_size` until you hit GPU memory limits
- Use `--max_pairs` to limit processing for testing
- Monitor `nvidia-smi` to optimize memory usage
- Save intermediate results frequently for large runs

## 8. Output Files

The pipeline will create:
```
outputs/lightglue_cuda/
├── all_matches.csv           # Complete match database
├── filtered_matches.csv      # Matches above threshold
├── processing_stats.json     # Performance metrics
├── scene_cluster_000.txt     # Individual cluster files
├── scene_cluster_001.txt
└── ...
```

## 9. Troubleshooting

### CUDA not detected
```bash
# Reinstall NVIDIA drivers
sudo apt purge nvidia-*
sudo apt install nvidia-driver-535
sudo reboot
```

### GPU out of memory
- Reduce `feature_batch_size` and `match_batch_size`
- Process fewer images at once with `--max_images`
- Clear GPU cache: `torch.cuda.empty_cache()`

### Slow performance
- Verify GPU is being used: `nvidia-smi` should show GPU activity
- Check GPU utilization is high (>80%)
- Increase batch sizes if memory allows

### Large dataset optimization
```bash
# Process in chunks for very large datasets
for i in {0..9}; do
    start=$((i * 2500))
    python3 lightglue_pipeline_cuda.py \
        --max_images 2500 \
        --output_dir "outputs/chunk_$i" \
        --image_dir "images_chunk_$i"
done
```

## 10. Next Steps

After processing completes:
1. Analyze `processing_stats.json` for performance metrics
2. Examine `all_matches.csv` for match distribution
3. Review scene clusters in individual `.txt` files
4. Use the complete match database for UI development
5. Adjust thresholds based on results and re-filter as needed

The CUDA pipeline should provide 10-20x speedup over CPU/MPS processing!