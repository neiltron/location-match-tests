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

def extract_features_cuda_batch(extractor, device, image_paths, batch_size=16):
    """Extract features using larger CUDA batches."""
    from lightglue.utils import load_image
    
    all_features = {}
    
    print(f"Extracting features in CUDA batches of {batch_size}...")
    
    for i in tqdm(range(0, len(image_paths), batch_size), desc="Feature extraction"):
        batch_paths = image_paths[i:i+batch_size]
        
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
                    
                    # Keep features on GPU initially, move to CPU for storage
                    all_features[img_path.name] = {
                        'keypoints': feats['keypoints'].cpu(),
                        'keypoint_scores': feats['keypoint_scores'].cpu(),
                        'descriptors': feats['descriptors'].cpu(),
                        'image_size': feats['image_size'].cpu() if 'image_size' in feats else None
                    }
                    
                    # Clear GPU refs immediately
                    del feats
            
            # Clear batch from GPU
            del images
            torch.cuda.empty_cache()
            
        except torch.cuda.OutOfMemoryError:
            print(f"⚠️  GPU OOM in batch {i//batch_size}, reducing batch size")
            torch.cuda.empty_cache()
            # Retry with smaller batch
            for img_path in batch_paths:
                try:
                    img = load_image(img_path).to(device)
                    with torch.no_grad():
                        feats = extractor.extract(img)
                        all_features[img_path.name] = {
                            'keypoints': feats['keypoints'].cpu(),
                            'keypoint_scores': feats['keypoint_scores'].cpu(),
                            'descriptors': feats['descriptors'].cpu(),
                            'image_size': feats['image_size'].cpu() if 'image_size' in feats else None
                        }
                        del feats, img
                        torch.cuda.empty_cache()
                except Exception as e:
                    print(f"Failed to process {img_path}: {e}")
                    continue
        except Exception as e:
            print(f"Error in batch {i//batch_size}: {e}")
            continue
    
    print(f"Extracted features for {len(all_features)} images")
    return all_features

def generate_all_pairs(image_names, max_pairs=None):
    """Generate all possible pairs with progress estimation."""
    n = len(image_names)
    total_pairs = n * (n - 1) // 2
    
    print(f"Generating all pairs for {n} images...")
    print(f"Total possible pairs: {total_pairs:,}")
    
    if max_pairs and total_pairs > max_pairs:
        print(f"⚠️  Limiting to {max_pairs:,} pairs (out of {total_pairs:,})")
        
    pairs = []
    for i in range(n):
        for j in range(i + 1, n):
            pairs.append((image_names[i], image_names[j]))
            if max_pairs and len(pairs) >= max_pairs:
                return pairs
    
    return pairs

def match_all_pairs_cuda(matcher, device, features_dict, pairs, batch_size=32):
    """CUDA-optimized batch matching with memory management."""
    
    all_matches = []
    
    print(f"CUDA matching {len(pairs):,} pairs in batches of {batch_size}...")
    
    for i in tqdm(range(0, len(pairs), batch_size), desc="Matching pairs"):
        batch_pairs = pairs[i:i+batch_size]
        
        try:
            with torch.no_grad():
                for img1_name, img2_name in batch_pairs:
                    if img1_name not in features_dict or img2_name not in features_dict:
                        all_matches.append({
                            'image1': img1_name,
                            'image2': img2_name,
                            'matches': 0,
                            'confidence': 0.0,
                            'valid': False
                        })
                        continue
                    
                    # Move features to GPU for matching
                    feats0 = {k: v.to(device, non_blocking=True) if v is not None else None 
                             for k, v in features_dict[img1_name].items()}
                    feats1 = {k: v.to(device, non_blocking=True) if v is not None else None 
                             for k, v in features_dict[img2_name].items()}
                    
                    # Match features
                    matches01 = matcher({'image0': feats0, 'image1': feats1})
                    
                    # Extract results
                    matches = matches01['matches'][0]
                    confidence = matches01['matching_scores'][0]
                    
                    # Count valid matches
                    valid_matches = matches > -1
                    num_matches = valid_matches.sum().item()
                    avg_confidence = confidence[valid_matches].mean().item() if num_matches > 0 else 0
                    
                    all_matches.append({
                        'image1': img1_name,
                        'image2': img2_name,
                        'matches': num_matches,
                        'confidence': avg_confidence,
                        'valid': True
                    })
                    
                    # Clear GPU memory immediately
                    del matches01, matches, confidence, feats0, feats1
            
            # Periodic GPU cleanup
            if i % (batch_size * 10) == 0:
                torch.cuda.empty_cache()
                
        except torch.cuda.OutOfMemoryError:
            print(f"⚠️  GPU OOM in matching batch {i//batch_size}")
            torch.cuda.empty_cache()
            # Continue with error entries for this batch
            for img1_name, img2_name in batch_pairs:
                all_matches.append({
                    'image1': img1_name,
                    'image2': img2_name,
                    'matches': 0,
                    'confidence': 0.0,
                    'valid': False
                })
        except Exception as e:
            print(f"Error in matching batch {i//batch_size}: {e}")
            for img1_name, img2_name in batch_pairs:
                all_matches.append({
                    'image1': img1_name,
                    'image2': img2_name,
                    'matches': 0,
                    'confidence': 0.0,
                    'valid': False
                })
    
    return all_matches

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
    
    print("🚀 LightGlue CUDA Full N×N Pipeline")
    print("=" * 60)
    
    # Setup
    extractor, matcher, device = setup_lightglue()
    if extractor is None:
        return
    
    # Get images
    image_dir = Path(args.image_dir)
    image_paths = list(image_dir.glob('*.jpg'))
    
    if args.max_images:
        image_paths = image_paths[:args.max_images]
        print(f"📊 Processing first {args.max_images} images")
    
    print(f"📁 Found {len(image_paths)} images")
    
    start_time = time.time()
    
    # Pipeline
    print("\n🔧 Step 1: Feature Extraction")
    features = extract_features_cuda_batch(extractor, device, image_paths, args.feature_batch_size)
    
    print("\n🔧 Step 2: Pair Generation")
    image_names = [p.name for p in image_paths]
    pairs = generate_all_pairs(image_names, args.max_pairs)
    
    print("\n🔧 Step 3: CUDA Matching")
    all_matches = match_all_pairs_cuda(matcher, device, features, pairs, args.match_batch_size)
    
    elapsed_time = time.time() - start_time
    
    print("\n🔧 Step 4: Filtering & Clustering")
    filtered_matches = filter_matches(all_matches, args.min_matches, args.min_confidence)
    clusters = build_scene_clusters(filtered_matches)
    
    print("\n🔧 Step 5: Saving Results")
    save_results_cuda(all_matches, filtered_matches, clusters, args, elapsed_time, args.output_dir)
    
    # Final summary
    print(f"\n🎯 CUDA Processing Complete!")
    print(f"   ⏱️  Total time: {elapsed_time:.1f}s")
    print(f"   🚀 Speed: {len(pairs) / elapsed_time:.1f} pairs/second")
    print(f"   🎭 Scene matches: {len(filtered_matches)}")
    print(f"   🗂️  Scene clusters: {len(clusters)}")
    
    if clusters:
        cluster_sizes = [len(c) for c in clusters]
        print(f"   📈 Largest cluster: {max(cluster_sizes)} images")

if __name__ == "__main__":
    main()