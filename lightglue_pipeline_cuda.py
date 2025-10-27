#!/usr/bin/env python3
"""
CUDA-optimized LightGlue pipeline for high-performance GPU processing.
"""

import os
import torch
import numpy as np
from pathlib import Path
import argparse
from collections import defaultdict
from tqdm import tqdm
import time
import json
import csv
import h5py
import logging
import gc
import traceback
import psutil
from typing import Generator, Tuple, List, Dict, Optional

def setup_logging(output_dir: Path) -> logging.Logger:
    """Setup logging with both file and console output."""
    output_dir.mkdir(exist_ok=True, parents=True)

    # Configure logging
    log_file = output_dir / f'cuda_processing_{time.strftime("%Y%m%d_%H%M%S")}.log'

    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler(log_file),
            logging.StreamHandler()
        ]
    )

    logger = logging.getLogger(__name__)
    logger.info(f"Logging initialized. Log file: {log_file}")
    return logger

def log_memory_status(logger: logging.Logger, stage: str):
    """Log current memory status (RAM and GPU)."""
    # RAM status
    ram = psutil.virtual_memory()
    logger.info(f"[{stage}] RAM: {ram.used / 1024**3:.1f}GB / {ram.total / 1024**3:.1f}GB ({ram.percent:.1f}%)")

    # GPU status
    if torch.cuda.is_available():
        gpu_mem_allocated = torch.cuda.memory_allocated() / 1024**3
        gpu_mem_reserved = torch.cuda.memory_reserved() / 1024**3
        logger.info(f"[{stage}] GPU: Allocated {gpu_mem_allocated:.1f}GB, Reserved {gpu_mem_reserved:.1f}GB")

def setup_cuda_environment():
    """Setup CUDA environment for optimal performance."""
    if not torch.cuda.is_available():
        print("❌ CUDA not available!")
        print("Please ensure you have:")
        print("1. NVIDIA GPU with CUDA capability")
        print("2. CUDA toolkit installed")
        print("3. PyTorch with CUDA support")
        return False
    
    # Set CUDA device and memory settings
    torch.backends.cudnn.benchmark = True
    torch.backends.cudnn.deterministic = False
    
    device_count = torch.cuda.device_count()
    print(f"✅ CUDA available with {device_count} GPU(s)")
    
    for i in range(device_count):
        props = torch.cuda.get_device_properties(i)
        print(f"   GPU {i}: {props.name} ({props.total_memory // 1024**3}GB)")
    
    return True

def setup_lightglue():
    """Setup LightGlue with CUDA optimization."""
    try:
        from lightglue import LightGlue, SuperPoint
        from lightglue.utils import load_image
        
        if not setup_cuda_environment():
            return None, None, None
        
        device = torch.device('cuda:0')
        print(f"Using device: {device}")
        
        # Initialize with CUDA optimization
        extractor = SuperPoint(
            max_num_keypoints=2048,  # Higher for better matching on GPU
        ).eval().to(device)
        
        matcher = LightGlue(
            features='superpoint',
            depth_confidence=0.95,
            width_confidence=0.95,
        ).eval().to(device)
        
        # Warm up GPU
        dummy_img = torch.randn(1, 1, 480, 640, device=device)
        with torch.no_grad():
            _ = extractor.extract(dummy_img)
        
        print("✅ LightGlue CUDA setup successful")
        return extractor, matcher, device
        
    except Exception as e:
        print(f"❌ LightGlue setup failed: {e}")
        return None, None, None

def extract_features_cuda_batch(extractor, device, image_paths, batch_size=16, output_dir=None,
                               logger: Optional[logging.Logger] = None):
    """Extract features with checkpoint/resume capability and better memory management."""
    from lightglue.utils import load_image

    # Create HDF5 file for feature storage
    features_path = None
    if output_dir:
        features_path = Path(output_dir) / 'features.h5'
        features_path.parent.mkdir(parents=True, exist_ok=True)

    # Check for existing checkpoint and HDF5 file
    checkpoint_file = None
    processed_images = []
    if output_dir:
        checkpoint_file = Path(output_dir) / 'feature_extraction_checkpoint.txt'

        # First check what's already in the HDF5 file
        if features_path and features_path.exists():
            try:
                with h5py.File(features_path, 'r') as f:
                    existing_in_h5 = list(f.keys())
                    if logger:
                        logger.info(f"Found {len(existing_in_h5)} images already in HDF5 file")
                    else:
                        print(f"📊 Found {len(existing_in_h5)} images already in HDF5 file")
                    processed_images.extend(existing_in_h5)
            except Exception as e:
                if logger:
                    logger.warning(f"Could not read existing HDF5 file: {e}")

        # Also check checkpoint file
        if checkpoint_file.exists():
            with open(checkpoint_file, 'r') as f:
                checkpoint_images = [line.strip() for line in f.readlines()]
            # Merge with HDF5 contents (avoid duplicates)
            for img in checkpoint_images:
                if img not in processed_images:
                    processed_images.append(img)
            if logger:
                logger.info(f"Total processed images (HDF5 + checkpoint): {len(processed_images)}")
            else:
                print(f"📌 Total processed images: {len(processed_images)}")

    # Filter out already processed images
    remaining_paths = [p for p in image_paths if p.name not in processed_images]

    if not remaining_paths:
        if logger:
            logger.info("All images already processed!")
        else:
            print("✅ All images already processed!")
        return features_path, processed_images

    if logger:
        logger.info(f"Extracting features in CUDA batches of {batch_size}...")
        if features_path:
            logger.info(f"Saving features to {features_path}")
    else:
        print(f"Extracting features in CUDA batches of {batch_size}...")
        if features_path:
            print(f"💾 Saving features to {features_path} (reduces RAM usage)")

    chunk_size = 500  # Process 500 images then close/reopen HDF5 to flush RAM

    for chunk_start in range(0, len(remaining_paths), chunk_size):
        chunk_end = min(chunk_start + chunk_size, len(remaining_paths))
        chunk_paths = remaining_paths[chunk_start:chunk_end]

        # Open HDF5 in append mode (always append when resuming)
        mode = 'a' if features_path.exists() else 'w'
        with h5py.File(features_path, mode) as f:
            for i in tqdm(range(0, len(chunk_paths), batch_size),
                         desc=f"Feature extraction (chunk {chunk_start//chunk_size + 1})"):
                batch_paths = chunk_paths[i:i+batch_size]

                try:
                    # Pre-allocate GPU memory for batch
                    images = []
                    for img_path in batch_paths:
                        img = load_image(img_path).to(device, non_blocking=True)
                        images.append(img)

                    # Process batch
                    with torch.no_grad():
                        for img_path, img in zip(batch_paths, images):
                            feats = extractor.extract(img)

                            # Save to HDF5 immediately instead of RAM
                            img_name = img_path.name

                            # Check if group already exists (from previous run)
                            if img_name not in f:
                                grp = f.create_group(img_name)
                                grp.create_dataset('keypoints', data=feats['keypoints'].cpu().numpy())
                                grp.create_dataset('keypoint_scores', data=feats['keypoint_scores'].cpu().numpy())
                                grp.create_dataset('descriptors', data=feats['descriptors'].cpu().numpy())
                                if 'image_size' in feats and feats['image_size'] is not None:
                                    grp.create_dataset('image_size', data=feats['image_size'].cpu().numpy())

                            if img_name not in processed_images:
                                processed_images.append(img_name)

                            # Clear GPU refs immediately
                            del feats

                    # Clear batch from GPU
                    del images
                    torch.cuda.empty_cache()

                    # Save checkpoint periodically
                    if checkpoint_file and len(processed_images) % 100 == 0:
                        with open(checkpoint_file, 'w') as cf:
                            for img in processed_images:
                                cf.write(f"{img}\n")

                except torch.cuda.OutOfMemoryError:
                    if logger:
                        logger.warning(f"GPU OOM in batch {i//batch_size}, reducing batch size")
                    else:
                        print(f"⚠️  GPU OOM in batch {i//batch_size}, reducing batch size")
                    torch.cuda.empty_cache()
                    # Retry with smaller batch
                    for img_path in batch_paths:
                        try:
                            img = load_image(img_path).to(device)
                            with torch.no_grad():
                                feats = extractor.extract(img)

                                img_name = img_path.name
                                if img_name not in f:  # Check if not already processed
                                    grp = f.create_group(img_name)
                                    grp.create_dataset('keypoints', data=feats['keypoints'].cpu().numpy())
                                    grp.create_dataset('keypoint_scores', data=feats['keypoint_scores'].cpu().numpy())
                                    grp.create_dataset('descriptors', data=feats['descriptors'].cpu().numpy())
                                    if 'image_size' in feats and feats['image_size'] is not None:
                                        grp.create_dataset('image_size', data=feats['image_size'].cpu().numpy())

                                    processed_images.append(img_name)
                                del feats, img
                                torch.cuda.empty_cache()
                        except Exception as e:
                            if logger:
                                logger.error(f"Failed to process {img_path}: {e}")
                            else:
                                print(f"Failed to process {img_path}: {e}")
                            continue
                except Exception as e:
                    if logger:
                        logger.error(f"Error in batch {i//batch_size}: {e}")
                    else:
                        print(f"Error in batch {i//batch_size}: {e}")
                    continue
        # HDF5 file automatically closes and flushes here

        # Save checkpoint after each chunk
        if checkpoint_file:
            with open(checkpoint_file, 'w') as cf:
                for img in processed_images:
                    cf.write(f"{img}\n")

            # Force garbage collection after chunk
            gc.collect()

    # Final checkpoint save
    if checkpoint_file:
        with open(checkpoint_file, 'w') as cf:
            for img in processed_images:
                cf.write(f"{img}\n")

    if logger:
        logger.info(f"✅ Extracted features for {len(processed_images)} images (saved to {features_path})")
    else:
        print(f"✅ Extracted features for {len(processed_images)} images (saved to {features_path})")
    return features_path, processed_images

def generate_pairs_generator(image_names: List[str], max_pairs: Optional[int] = None,
                           logger: Optional[logging.Logger] = None) -> Generator[Tuple[str, str], None, None]:
    """Memory-efficient pair generation using generator (doesn't load all pairs into memory)."""
    n = len(image_names)
    total_pairs = n * (n - 1) // 2

    if logger:
        logger.info(f"Generating pairs for {n} images (total possible: {total_pairs:,})")
        if max_pairs and total_pairs > max_pairs:
            logger.warning(f"Limiting to {max_pairs:,} pairs (out of {total_pairs:,})")
    else:
        print(f"Generating pairs for {n} images (total possible: {total_pairs:,})")
        if max_pairs and total_pairs > max_pairs:
            print(f"⚠️  Limiting to {max_pairs:,} pairs (out of {total_pairs:,})")

    pair_count = 0
    for i in range(n):
        for j in range(i + 1, n):
            yield (image_names[i], image_names[j])
            pair_count += 1
            if max_pairs and pair_count >= max_pairs:
                return

def count_total_pairs(n_images: int, max_pairs: Optional[int] = None) -> int:
    """Calculate total number of pairs that will be processed."""
    total = n_images * (n_images - 1) // 2
    if max_pairs:
        return min(total, max_pairs)
    return total

def match_pairs_streaming(matcher, device, features_path: Path, pairs_generator: Generator,
                          batch_size: int = 32, total_pairs: Optional[int] = None,
                          output_dir: Optional[Path] = None,
                          logger: Optional[logging.Logger] = None) -> List[Dict]:
    """Stream-based matching that processes pairs in chunks and saves incrementally."""

    if logger:
        logger.info(f"Starting streaming match with batch size {batch_size}")
        logger.info(f"Loading features from {features_path}")
    else:
        print(f"CUDA matching pairs in batches of {batch_size}...")
        print(f"📂 Loading features from {features_path} on-demand")

    # Setup checkpoint file if output_dir provided
    checkpoint_file = None
    checkpoint_interval = 10000  # Save every 10k pairs
    if output_dir:
        checkpoint_file = output_dir / "matching_checkpoint.csv"
        if checkpoint_file.exists():
            if logger:
                logger.info(f"Found existing checkpoint at {checkpoint_file}")

    all_matches = []
    batch_pairs = []
    pairs_processed = 0

    with h5py.File(features_path, 'r') as f:
        # Create progress bar
        pbar = tqdm(total=total_pairs, desc="Matching pairs") if total_pairs else tqdm(desc="Matching pairs")

        for pair in pairs_generator:
            batch_pairs.append(pair)

            # Process when batch is full
            if len(batch_pairs) >= batch_size:
                batch_matches = process_match_batch(
                    matcher, device, f, batch_pairs, logger
                )
                all_matches.extend(batch_matches)
                pairs_processed += len(batch_pairs)

                # Save checkpoint
                if checkpoint_file and pairs_processed % checkpoint_interval == 0:
                    save_checkpoint(all_matches, checkpoint_file, logger)
                    if logger:
                        logger.info(f"Checkpoint saved at {pairs_processed} pairs")

                # Update progress
                pbar.update(len(batch_pairs))

                # Clear batch
                batch_pairs = []

                # Periodic memory cleanup
                if pairs_processed % (batch_size * 100) == 0:
                    torch.cuda.empty_cache()
                    gc.collect()
                    if logger:
                        log_memory_status(logger, f"After {pairs_processed} pairs")

        # Process remaining pairs
        if batch_pairs:
            batch_matches = process_match_batch(
                matcher, device, f, batch_pairs, logger
            )
            all_matches.extend(batch_matches)
            pbar.update(len(batch_pairs))

        pbar.close()

    # Final checkpoint save
    if checkpoint_file:
        save_checkpoint(all_matches, checkpoint_file, logger)

    return all_matches

def process_match_batch(matcher, device, h5file, batch_pairs: List[Tuple[str, str]],
                        logger: Optional[logging.Logger] = None) -> List[Dict]:
    """Process a single batch of pairs for matching."""
    batch_matches = []

    try:
        with torch.no_grad():
            for img1_name, img2_name in batch_pairs:
                if img1_name not in h5file or img2_name not in h5file:
                    batch_matches.append({
                        'image1': img1_name,
                        'image2': img2_name,
                        'matches': 0,
                        'confidence': 0.0,
                        'valid': False
                    })
                    continue

                # Load features from HDF5 and move to GPU
                grp0 = h5file[img1_name]
                grp1 = h5file[img2_name]

                feats0 = {
                    'keypoints': torch.from_numpy(grp0['keypoints'][:]).to(device, non_blocking=True),
                    'descriptors': torch.from_numpy(grp0['descriptors'][:]).to(device, non_blocking=True),
                }
                feats1 = {
                    'keypoints': torch.from_numpy(grp1['keypoints'][:]).to(device, non_blocking=True),
                    'descriptors': torch.from_numpy(grp1['descriptors'][:]).to(device, non_blocking=True),
                }

                # Add image_size if available
                if 'image_size' in grp0:
                    feats0['image_size'] = torch.from_numpy(grp0['image_size'][:]).to(device, non_blocking=True)
                if 'image_size' in grp1:
                    feats1['image_size'] = torch.from_numpy(grp1['image_size'][:]).to(device, non_blocking=True)

                # Match features
                matches01 = matcher({'image0': feats0, 'image1': feats1})

                # Extract results - use the compact format
                matches = matches01['matches'][0]  # Tensor of shape [N x 2] matched pairs
                confidence = matches01['scores'][0]  # Tensor of shape [N] confidence scores

                # Count valid matches
                num_matches = matches.shape[0]
                avg_confidence = confidence.mean().item() if num_matches > 0 else 0.0

                batch_matches.append({
                    'image1': img1_name,
                    'image2': img2_name,
                    'matches': num_matches,
                    'confidence': avg_confidence,
                    'valid': True
                })

                # Clear GPU memory immediately
                del matches01, matches, confidence, feats0, feats1

    except torch.cuda.OutOfMemoryError as e:
        if logger:
            logger.error(f"GPU OOM in matching batch: {e}")
        else:
            print(f"⚠️  GPU OOM in matching batch: {e}")
        torch.cuda.empty_cache()
        # Continue with error entries for this batch
        for img1_name, img2_name in batch_pairs:
            batch_matches.append({
                'image1': img1_name,
                'image2': img2_name,
                'matches': 0,
                'confidence': 0.0,
                'valid': False
            })
    except Exception as e:
        if logger:
            logger.error(f"Error in matching batch: {e}\n{traceback.format_exc()}")
        else:
            print(f"❌ Error in matching batch: {e}")
            print(f"   Traceback: {traceback.format_exc()}")
        for img1_name, img2_name in batch_pairs:
            batch_matches.append({
                'image1': img1_name,
                'image2': img2_name,
                'matches': 0,
                'confidence': 0.0,
                'valid': False
            })

    return batch_matches

def save_checkpoint(matches: List[Dict], checkpoint_file: Path, logger: Optional[logging.Logger] = None):
    """Save matching progress to checkpoint file."""
    try:
        with open(checkpoint_file, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=['image1', 'image2', 'matches', 'confidence', 'valid'])
            writer.writeheader()
            writer.writerows(matches)
        if logger:
            logger.debug(f"Checkpoint saved: {len(matches)} matches")
    except Exception as e:
        if logger:
            logger.error(f"Failed to save checkpoint: {e}")
        else:
            print(f"Failed to save checkpoint: {e}")

def filter_matches(all_matches, min_matches=50, min_confidence=0.5):
    """Filter matches based on thresholds."""
    filtered = [
        m for m in all_matches 
        if m['valid'] and m['matches'] >= min_matches and m['confidence'] >= min_confidence
    ]
    return filtered

def build_scene_clusters(matches):
    """Build connected components from geometric matches."""
    
    graph = defaultdict(set)
    all_images = set()
    
    for match in matches:
        img1, img2 = match['image1'], match['image2']
        graph[img1].add(img2)
        graph[img2].add(img1)
        all_images.add(img1)
        all_images.add(img2)
    
    visited = set()
    clusters = []
    
    def dfs(node, cluster):
        if node in visited:
            return
        visited.add(node)
        cluster.append(node)
        for neighbor in graph[node]:
            dfs(neighbor, cluster)
    
    for image in all_images:
        if image not in visited:
            cluster = []
            dfs(image, cluster)
            if len(cluster) > 1:
                clusters.append(cluster)
    
    return clusters

def save_results_cuda(all_matches, filtered_matches, clusters, args, elapsed_time, output_dir="outputs/lightglue_cuda"):
    """Save results with CUDA performance metrics."""
    
    output_dir = Path(output_dir)
    output_dir.mkdir(exist_ok=True, parents=True)
    
    # Save ALL matches
    print("Saving complete match database...")
    with open(output_dir / "all_matches.csv", "w", newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['image1', 'image2', 'matches', 'confidence', 'valid'])
        writer.writeheader()
        writer.writerows(all_matches)
    
    # Save filtered matches
    with open(output_dir / "filtered_matches.csv", "w", newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['image1', 'image2', 'matches', 'confidence'])
        writer.writeheader()
        for match in filtered_matches:
            writer.writerow({k: match[k] for k in ['image1', 'image2', 'matches', 'confidence']})
    
    # Enhanced statistics with GPU info
    match_counts = [m['matches'] for m in all_matches if m['valid']]
    if match_counts:
        gpu_props = torch.cuda.get_device_properties(0)
        stats = {
            'processing_info': {
                'gpu_name': gpu_props.name,
                'gpu_memory_gb': gpu_props.total_memory // 1024**3,
                'processing_time_seconds': elapsed_time,
                'pairs_per_second': len(all_matches) / elapsed_time,
                'feature_batch_size': args.feature_batch_size,
                'match_batch_size': args.match_batch_size,
            },
            'match_statistics': {
                'total_pairs': len(all_matches),
                'valid_pairs': sum(1 for m in all_matches if m['valid']),
                'pairs_with_matches': sum(1 for m in all_matches if m['valid'] and m['matches'] > 0),
                'max_matches': max(match_counts),
                'min_matches': min(match_counts),
                'avg_matches': sum(match_counts) / len(match_counts),
                'percentiles': {
                    '25%': float(np.percentile(match_counts, 25)),
                    '50%': float(np.percentile(match_counts, 50)),
                    '75%': float(np.percentile(match_counts, 75)),
                    '90%': float(np.percentile(match_counts, 90)),
                    '95%': float(np.percentile(match_counts, 95)),
                    '99%': float(np.percentile(match_counts, 99)),
                }
            },
            'filter_settings': {
                'min_matches': args.min_matches,
                'min_confidence': args.min_confidence,
                'filtered_pairs': len(filtered_matches),
                'clusters_found': len(clusters)
            }
        }
        
        with open(output_dir / "processing_stats.json", "w") as f:
            json.dump(stats, f, indent=2)
    
    # Save clusters
    for i, cluster in enumerate(clusters):
        with open(output_dir / f"scene_cluster_{i:03d}.txt", "w") as f:
            for img in sorted(cluster):
                f.write(f"{img}\n")
    
    print(f"🚀 CUDA results saved to {output_dir}")
    print(f"   📊 Performance: {len(all_matches) / elapsed_time:.1f} pairs/second")

def main():
    parser = argparse.ArgumentParser(description="CUDA-optimized LightGlue full N×N matching")
    parser.add_argument("--image_dir", default="images", help="Image directory")
    parser.add_argument("--output_dir", default="outputs/lightglue_cuda", help="Output directory")
    parser.add_argument("--min_matches", type=int, default=50, help="Minimum matches for clustering")
    parser.add_argument("--min_confidence", type=float, default=0.5, help="Minimum confidence for clustering")
    parser.add_argument("--max_pairs", type=int, default=None, help="Maximum pairs to process")
    parser.add_argument("--feature_batch_size", type=int, default=16, help="Feature extraction batch size")
    parser.add_argument("--match_batch_size", type=int, default=32, help="Matching batch size")
    parser.add_argument("--max_images", type=int, default=None, help="Limit number of images")

    args = parser.parse_args()

    # Setup output directory and logging
    output_dir = Path(args.output_dir)
    logger = setup_logging(output_dir)

    logger.info("🚀 LightGlue CUDA Full N×N Pipeline")
    logger.info("=" * 60)

    # Log initial memory status
    log_memory_status(logger, "Start")

    # Setup
    extractor, matcher, device = setup_lightglue()
    if extractor is None:
        logger.error("Failed to setup LightGlue")
        return

    # Get images
    image_dir = Path(args.image_dir)
    image_paths = list(image_dir.glob('*.jpg'))

    if args.max_images:
        image_paths = image_paths[:args.max_images]
        logger.info(f"📊 Processing first {args.max_images} images")

    logger.info(f"📁 Found {len(image_paths)} images")

    start_time = time.time()

    try:
        # Pipeline
        logger.info("\n🔧 Step 1: Feature Extraction")
        features_path, processed_images = extract_features_cuda_batch(
            extractor, device, image_paths, args.feature_batch_size, args.output_dir, logger
        )

        # Log memory after features
        log_memory_status(logger, "After feature extraction")

        logger.info("\n🔧 Step 2: Pair Generation (Memory-Efficient)")

        # Calculate total pairs for progress tracking
        total_pairs = count_total_pairs(len(processed_images), args.max_pairs)
        logger.info(f"Total pairs to process: {total_pairs:,}")

        # Create generator for memory-efficient pair generation
        pairs_generator = generate_pairs_generator(processed_images, args.max_pairs, logger)

        logger.info("\n🔧 Step 3: CUDA Matching (Streaming)")
        all_matches = match_pairs_streaming(
            matcher, device, features_path, pairs_generator,
            args.match_batch_size, total_pairs, output_dir, logger
        )

        # Log memory after matching
        log_memory_status(logger, "After matching")

        elapsed_time = time.time() - start_time

        logger.info("\n🔧 Step 4: Filtering & Clustering")
        filtered_matches = filter_matches(all_matches, args.min_matches, args.min_confidence)
        clusters = build_scene_clusters(filtered_matches)

        logger.info("\n🔧 Step 5: Saving Results")
        save_results_cuda(all_matches, filtered_matches, clusters, args, elapsed_time, args.output_dir)

        # Final summary
        logger.info(f"\n🎯 CUDA Processing Complete!")
        logger.info(f"   ⏱️  Total time: {elapsed_time:.1f}s")
        logger.info(f"   🚀 Speed: {total_pairs / elapsed_time:.1f} pairs/second")
        logger.info(f"   🎭 Scene matches: {len(filtered_matches)}")
        logger.info(f"   🗂️  Scene clusters: {len(clusters)}")

        if clusters:
            cluster_sizes = [len(c) for c in clusters]
            logger.info(f"   📈 Largest cluster: {max(cluster_sizes)} images")

        # Final memory status
        log_memory_status(logger, "End")

    except Exception as e:
        logger.error(f"Pipeline failed: {e}")
        logger.error(traceback.format_exc())
        raise

if __name__ == "__main__":
    main()