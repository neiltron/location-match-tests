#!/usr/bin/env python3
"""
LightGlue pipeline for finding exact scene matches based on geometric correspondence.
"""

import os
import torch
import numpy as np
from pathlib import Path
import argparse
from collections import defaultdict
from tqdm import tqdm
import h5py

# Force CPU mode to avoid GPU crashes
os.environ['CUDA_VISIBLE_DEVICES'] = ''
os.environ['KMP_DUPLICATE_LIB_OK'] = 'TRUE'

def setup_lightglue():
    """Setup LightGlue with CPU mode."""
    try:
        from lightglue import LightGlue, SuperPoint
        from lightglue.utils import load_image
        
        device = torch.device('mps')
        print(f"Using device: {device}")
        
        # Initialize feature extractor and matcher
        extractor = SuperPoint(max_num_keypoints=1024).eval().to(device)
        matcher = LightGlue(features='superpoint').eval().to(device)
        
        print("✓ LightGlue setup successful")
        return extractor, matcher, device
        
    except Exception as e:
        print(f"✗ LightGlue setup failed: {e}")
        return None, None, None

def load_and_match_pair(extractor, matcher, device, img1_path, img2_path):
    """Load and match a pair of images."""
    try:
        from lightglue.utils import load_image
        
        # Load images
        image0 = load_image(img1_path).to(device)
        image1 = load_image(img2_path).to(device)
        
        # Extract features
        feats0 = extractor.extract(image0)
        feats1 = extractor.extract(image1)
        
        # Match features
        matches01 = matcher({'image0': feats0, 'image1': feats1})
        
        # Get match info
        matches = matches01['matches'][0]
        confidence = matches01['matching_scores'][0]
        
        # Count valid matches
        valid_matches = matches > -1
        num_matches = valid_matches.sum().item()
        avg_confidence = confidence[valid_matches].mean().item() if num_matches > 0 else 0
        
        return num_matches, avg_confidence
        
    except Exception as e:
        print(f"Error matching {img1_path.name} - {img2_path.name}: {e}")
        return 0, 0

def find_scene_matches(image_dir, min_matches=50, min_confidence=0.5, max_pairs=10000):
    """Find scene matches using LightGlue geometric matching."""
    
    extractor, matcher, device = setup_lightglue()
    if extractor is None:
        return []
    
    image_dir = Path(image_dir)
    image_paths = list(image_dir.glob('*.jpg'))
    
    print(f"Processing {len(image_paths)} images...")
    print(f"Will test up to {max_pairs} pairs (limited for performance)")
    
    scene_matches = []
    pairs_tested = 0
    
    # Test pairs (limit to prevent excessive computation)
    for i, img1_path in enumerate(tqdm(image_paths)):
        if pairs_tested >= max_pairs:
            break
            
        # Test against next few images (sliding window approach)
        for j in range(i + 1, min(i + 20, len(image_paths))):
            if pairs_tested >= max_pairs:
                break
                
            img2_path = image_paths[j]
            pairs_tested += 1
            
            num_matches, avg_confidence = load_and_match_pair(
                extractor, matcher, device, img1_path, img2_path
            )
            
            # Check if this is a scene match
            if num_matches >= min_matches and avg_confidence >= min_confidence:
                scene_matches.append({
                    'image1': img1_path.name,
                    'image2': img2_path.name,
                    'matches': num_matches,
                    'confidence': avg_confidence
                })
                print(f"✓ Scene match: {img1_path.name} - {img2_path.name} "
                      f"({num_matches} matches, {avg_confidence:.3f} confidence)")
    
    print(f"Tested {pairs_tested} pairs, found {len(scene_matches)} scene matches")
    return scene_matches

def build_scene_clusters(matches):
    """Build connected components from geometric matches."""
    
    # Build graph
    graph = defaultdict(set)
    all_images = set()
    
    for match in matches:
        img1, img2 = match['image1'], match['image2']
        graph[img1].add(img2)
        graph[img2].add(img1)
        all_images.add(img1)
        all_images.add(img2)
    
    # Find connected components
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

def save_results(matches, clusters, output_dir="outputs/lightglue_clusters"):
    """Save LightGlue results."""
    
    output_dir = Path(output_dir)
    output_dir.mkdir(exist_ok=True)
    
    # Save matches
    with open(output_dir / "geometric_matches.txt", "w") as f:
        f.write("image1,image2,matches,confidence\n")
        for match in matches:
            f.write(f"{match['image1']},{match['image2']},{match['matches']},{match['confidence']:.4f}\n")
    
    # Save clusters
    for i, cluster in enumerate(clusters):
        with open(output_dir / f"scene_cluster_{i:03d}.txt", "w") as f:
            for img in sorted(cluster):
                f.write(f"{img}\n")
    
    # Save summary
    with open(output_dir / "summary.txt", "w") as f:
        f.write(f"LightGlue Scene Matching Results\n")
        f.write(f"===============================\n")
        f.write(f"Total geometric matches: {len(matches)}\n")
        f.write(f"Scene clusters found: {len(clusters)}\n")
        f.write(f"\nCluster sizes:\n")
        for i, cluster in enumerate(clusters):
            f.write(f"  Cluster {i}: {len(cluster)} images\n")
    
    print(f"Results saved to {output_dir}")

def main():
    parser = argparse.ArgumentParser(description="LightGlue scene matching pipeline")
    parser.add_argument("--image_dir", default="images", help="Image directory")
    parser.add_argument("--output_dir", default="outputs/lightglue_clusters", help="Output directory")
    parser.add_argument("--min_matches", type=int, default=50, help="Minimum geometric matches")
    parser.add_argument("--min_confidence", type=float, default=0.5, help="Minimum match confidence")
    parser.add_argument("--max_pairs", type=int, default=10000, help="Maximum pairs to test")
    
    args = parser.parse_args()
    
    print("Starting LightGlue scene matching pipeline...")
    print(f"Min matches: {args.min_matches}, Min confidence: {args.min_confidence}")
    
    # Find geometric matches
    matches = find_scene_matches(
        args.image_dir, 
        args.min_matches, 
        args.min_confidence,
        args.max_pairs
    )
    
    if not matches:
        print("No geometric matches found. Try lowering thresholds.")
        return
    
    # Build clusters
    clusters = build_scene_clusters(matches)
    
    # Save results
    save_results(matches, clusters, args.output_dir)
    
    # Show summary
    if clusters:
        cluster_sizes = [len(c) for c in clusters]
        print(f"\n🎯 Found {len(clusters)} scene clusters!")
        print(f"   Largest cluster: {max(cluster_sizes)} images")
        print(f"   Total images in clusters: {sum(cluster_sizes)}")
    else:
        print("No scene clusters formed from the matches.")

if __name__ == "__main__":
    main()
