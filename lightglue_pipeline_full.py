#!/usr/bin/env python3
"""
Full N×N LightGlue pipeline that stores all match results for flexible filtering.
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

os.environ['KMP_DUPLICATE_LIB_OK'] = 'TRUE'

def setup_lightglue():
    """Setup LightGlue with MPS."""
    try:
        from lightglue import LightGlue, SuperPoint
        from lightglue.utils import load_image
        
        device = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
        print(f"Using device: {device}")
        
        # Initialize feature extractor and matcher
        extractor = SuperPoint(max_num_keypoints=1024).eval().to(device)
        matcher = LightGlue(features='superpoint').eval().to(device)
        
        print("✓ LightGlue setup successful")
        return extractor, matcher, device
        
    except Exception as e:
        print(f"✗ LightGlue setup failed: {e}")
        return None, None, None

def extract_features_batch(extractor, device, image_paths, batch_size=8):
    """Extract features for all images in batches."""
    from lightglue.utils import load_image
    
    all_features = {}
    
    print(f"Extracting features in batches of {batch_size}...")
    for i in tqdm(range(0, len(image_paths), batch_size), desc="Feature extraction"):
        batch_paths = image_paths[i:i+batch_size]
        
        try:
            # Load batch of images
            images = []
            for img_path in batch_paths:
                img = load_image(img_path).to(device)
                images.append(img)
            
            # Extract features for batch
            for img_path, img in zip(batch_paths, images):
                feats = extractor.extract(img)
                # Store features in CPU memory to save GPU memory
                all_features[img_path.name] = {
                    'keypoints': feats['keypoints'].cpu(),
                    'keypoint_scores': feats['keypoint_scores'].cpu(),
                    'descriptors': feats['descriptors'].cpu(),
                    'image_size': feats['image_size'].cpu() if 'image_size' in feats else None
                }
                del feats
            
            # Clear GPU memory after batch
            del images
            torch.mps.empty_cache() if device.type == 'mps' else None
            
        except Exception as e:
            print(f"Error in batch {i//batch_size}: {e}")
            continue
    
    print(f"Extracted features for {len(all_features)} images")
    return all_features

def generate_all_pairs(image_names, max_pairs=None):
    """Generate all possible pairs (N×N - N) / 2."""
    pairs = []
    n = len(image_names)
    
    print(f"Generating all pairs for {n} images...")
    total_pairs = n * (n - 1) // 2
    
    if max_pairs and total_pairs > max_pairs:
        print(f"WARNING: Total pairs ({total_pairs}) exceeds max_pairs ({max_pairs})")
        print(f"         Consider increasing max_pairs or reducing image count")
    
    for i in range(n):
        for j in range(i + 1, n):
            pairs.append((image_names[i], image_names[j]))
            if max_pairs and len(pairs) >= max_pairs:
                print(f"Limiting to {max_pairs} pairs (out of {total_pairs} possible)")
                return pairs
    
    print(f"Generated all {len(pairs)} possible pairs")
    return pairs

def match_all_pairs_batch(matcher, device, features_dict, pairs, batch_size=16):
    """Match ALL pairs and store ALL results, regardless of match quality."""
    
    all_matches = []
    
    print(f"Matching {len(pairs)} pairs in batches of {batch_size}...")
    for i in tqdm(range(0, len(pairs), batch_size), desc="Matching pairs"):
        batch_pairs = pairs[i:i+batch_size]
        
        try:
            for img1_name, img2_name in batch_pairs:
                if img1_name not in features_dict or img2_name not in features_dict:
                    # Store zero matches for missing features
                    all_matches.append({
                        'image1': img1_name,
                        'image2': img2_name,
                        'matches': 0,
                        'confidence': 0.0,
                        'valid': False
                    })
                    continue
                
                # Move features to device for matching
                feats0 = {k: v.to(device) if v is not None else None 
                         for k, v in features_dict[img1_name].items()}
                feats1 = {k: v.to(device) if v is not None else None 
                         for k, v in features_dict[img2_name].items()}
                
                # Match features
                matches01 = matcher({'image0': feats0, 'image1': feats1})
                
                # Get match info
                matches = matches01['matches'][0]
                confidence = matches01['matching_scores'][0]
                
                # Count valid matches
                valid_matches = matches > -1
                num_matches = valid_matches.sum().item()
                avg_confidence = confidence[valid_matches].mean().item() if num_matches > 0 else 0
                
                # Store ALL results, even zero matches
                all_matches.append({
                    'image1': img1_name,
                    'image2': img2_name,
                    'matches': num_matches,
                    'confidence': avg_confidence,
                    'valid': True
                })
                
                # Clear intermediate results
                del matches01, matches, confidence
            
            # Clear GPU memory after batch
            torch.mps.empty_cache() if device.type == 'mps' else None
            
        except Exception as e:
            print(f"Error in matching batch {i//batch_size}: {e}")
            # Store error results
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

def save_all_results(all_matches, filtered_matches, clusters, output_dir="outputs/lightglue_full"):
    """Save complete results including all matches for future filtering."""
    
    output_dir = Path(output_dir)
    output_dir.mkdir(exist_ok=True, parents=True)
    
    # Save ALL matches (for future filtering in UI)
    print("Saving all match data...")
    with open(output_dir / "all_matches.csv", "w", newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['image1', 'image2', 'matches', 'confidence', 'valid'])
        writer.writeheader()
        writer.writerows(all_matches)
    
    # Save filtered matches (current threshold)
    with open(output_dir / "filtered_matches.csv", "w", newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['image1', 'image2', 'matches', 'confidence'])
        writer.writeheader()
        for match in filtered_matches:
            writer.writerow({k: match[k] for k in ['image1', 'image2', 'matches', 'confidence']})
    
    # Save match statistics
    match_counts = [m['matches'] for m in all_matches if m['valid']]
    if match_counts:
        stats = {
            'total_pairs': len(all_matches),
            'valid_pairs': sum(1 for m in all_matches if m['valid']),
            'pairs_with_matches': sum(1 for m in all_matches if m['valid'] and m['matches'] > 0),
            'max_matches': max(match_counts),
            'min_matches': min(match_counts),
            'avg_matches': sum(match_counts) / len(match_counts),
            'percentiles': {
                '25%': np.percentile(match_counts, 25),
                '50%': np.percentile(match_counts, 50),
                '75%': np.percentile(match_counts, 75),
                '90%': np.percentile(match_counts, 90),
                '95%': np.percentile(match_counts, 95),
                '99%': np.percentile(match_counts, 99),
            }
        }
        
        with open(output_dir / "match_statistics.json", "w") as f:
            json.dump(stats, f, indent=2)
    
    # Save clusters
    for i, cluster in enumerate(clusters):
        with open(output_dir / f"scene_cluster_{i:03d}.txt", "w") as f:
            for img in sorted(cluster):
                f.write(f"{img}\n")
    
    # Save summary
    with open(output_dir / "summary.txt", "w") as f:
        f.write(f"LightGlue Full N×N Matching Results\n")
        f.write(f"====================================\n")
        f.write(f"Total pairs processed: {len(all_matches)}\n")
        f.write(f"Valid pairs: {sum(1 for m in all_matches if m['valid'])}\n")
        f.write(f"Pairs with >0 matches: {sum(1 for m in all_matches if m['valid'] and m['matches'] > 0)}\n")
        f.write(f"\nCurrent filter settings:\n")
        f.write(f"  Min matches: {min_matches}\n")
        f.write(f"  Min confidence: {min_confidence}\n")
        f.write(f"\nFiltered results:\n")
        f.write(f"  Geometric matches: {len(filtered_matches)}\n")
        f.write(f"  Scene clusters: {len(clusters)}\n")
        f.write(f"\nCluster sizes:\n")
        for i, cluster in enumerate(clusters):
            f.write(f"  Cluster {i}: {len(cluster)} images\n")
        f.write(f"\nMatch distribution:\n")
        if match_counts:
            f.write(f"  25th percentile: {stats['percentiles']['25%']:.0f} matches\n")
            f.write(f"  50th percentile: {stats['percentiles']['50%']:.0f} matches\n")
            f.write(f"  75th percentile: {stats['percentiles']['75%']:.0f} matches\n")
            f.write(f"  90th percentile: {stats['percentiles']['90%']:.0f} matches\n")
    
    print(f"Results saved to {output_dir}")
    print(f"  - all_matches.csv: Complete match data for all pairs")
    print(f"  - filtered_matches.csv: Matches above threshold")
    print(f"  - match_statistics.json: Statistical summary")
    print(f"  - scene_cluster_*.txt: Individual cluster files")

def main():
    parser = argparse.ArgumentParser(description="Full N×N LightGlue matching with complete results storage")
    parser.add_argument("--image_dir", default="images", help="Image directory")
    parser.add_argument("--output_dir", default="outputs/lightglue_full", help="Output directory")
    parser.add_argument("--min_matches", type=int, default=50, help="Minimum matches for scene clustering")
    parser.add_argument("--min_confidence", type=float, default=0.5, help="Minimum confidence for scene clustering")
    parser.add_argument("--max_pairs", type=int, default=None, help="Maximum pairs to process (None for all)")
    parser.add_argument("--feature_batch_size", type=int, default=8, help="Batch size for feature extraction")
    parser.add_argument("--match_batch_size", type=int, default=16, help="Batch size for matching")
    parser.add_argument("--max_images", type=int, default=None, help="Limit number of images to process")
    
    args = parser.parse_args()
    
    print("LightGlue Full N×N Matching Pipeline")
    print("=" * 50)
    print(f"Feature batch size: {args.feature_batch_size}")
    print(f"Matching batch size: {args.match_batch_size}")
    print(f"Filter thresholds - Min matches: {args.min_matches}, Min confidence: {args.min_confidence}")
    
    # Setup
    extractor, matcher, device = setup_lightglue()
    if extractor is None:
        return
    
    # Get images
    image_dir = Path(args.image_dir)
    image_paths = list(image_dir.glob('*.jpg'))
    
    if args.max_images:
        image_paths = image_paths[:args.max_images]
        print(f"Limiting to first {args.max_images} images")
    
    print(f"\nFound {len(image_paths)} images")
    
    start_time = time.time()
    
    # Step 1: Extract features in batches
    features = extract_features_batch(extractor, device, image_paths, args.feature_batch_size)
    
    # Step 2: Generate ALL pairs
    image_names = [p.name for p in image_paths]
    pairs = generate_all_pairs(image_names, args.max_pairs)
    
    # Step 3: Match ALL pairs in batches
    all_matches = match_all_pairs_batch(
        matcher, device, features, pairs, args.match_batch_size
    )
    
    elapsed_time = time.time() - start_time
    print(f"\nProcessing completed in {elapsed_time:.1f} seconds")
    print(f"Average speed: {len(pairs) / elapsed_time:.1f} pairs/second")
    
    # Step 4: Filter matches based on current thresholds
    filtered_matches = filter_matches(all_matches, args.min_matches, args.min_confidence)
    print(f"\nFound {len(filtered_matches)} matches above threshold (out of {len(all_matches)} total pairs)")
    
    # Step 5: Build clusters from filtered matches
    clusters = build_scene_clusters(filtered_matches)
    
    # Step 6: Save everything
    save_all_results(all_matches, filtered_matches, clusters, args.output_dir)
    
    # Show summary
    print(f"\n🎯 Results Summary:")
    print(f"   Total pairs processed: {len(all_matches)}")
    print(f"   Pairs with >0 matches: {sum(1 for m in all_matches if m['valid'] and m['matches'] > 0)}")
    print(f"   Scene matches (above threshold): {len(filtered_matches)}")
    print(f"   Scene clusters formed: {len(clusters)}")
    
    if clusters:
        cluster_sizes = [len(c) for c in clusters]
        print(f"   Largest cluster: {max(cluster_sizes)} images")
        print(f"   Total images in clusters: {sum(cluster_sizes)}")

if __name__ == "__main__":
    main()