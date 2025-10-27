#!/usr/bin/env python3
"""
Simple scene matching using global features and geometric constraints.
This approach uses the similarity pairs you already have and applies stricter
thresholds to identify likely exact scene matches.
"""

import h5py
import numpy as np
from pathlib import Path
import argparse
from collections import defaultdict

def load_global_features(features_path):
    """Load global features and compute similarity matrix."""
    features = {}
    with h5py.File(features_path, 'r') as f:
        for key in f.keys():
            features[key] = f[key]['global_descriptor'][...]
    return features

def compute_similarity(feat1, feat2):
    """Compute cosine similarity between two feature vectors."""
    dot_product = np.dot(feat1, feat2)
    norm1 = np.linalg.norm(feat1)
    norm2 = np.linalg.norm(feat2)
    if norm1 == 0 or norm2 == 0:
        return 0
    return dot_product / (norm1 * norm2)

def find_high_similarity_matches(pairs_file, features_dict, threshold=0.85):
    """Find pairs with very high similarity (likely same scene)."""
    
    high_sim_pairs = []
    
    print(f"Analyzing pairs for high similarity matches (threshold: {threshold})")
    
    with open(pairs_file, 'r') as f:
        for line_num, line in enumerate(f):
            if line_num % 10000 == 0:
                print(f"Processed {line_num} pairs, found {len(high_sim_pairs)} high-sim pairs")
            
            parts = line.strip().split()
            if len(parts) != 2:
                continue
                
            img1, img2 = parts
            
            if img1 in features_dict and img2 in features_dict:
                feat1 = features_dict[img1]
                feat2 = features_dict[img2]
                
                similarity = compute_similarity(feat1, feat2)
                
                if similarity >= threshold:
                    high_sim_pairs.append({
                        'image1': img1,
                        'image2': img2,
                        'similarity': similarity
                    })
    
    return high_sim_pairs

def build_connected_components(pairs):
    """Build connected components from high-similarity pairs."""
    # Build adjacency list
    graph = defaultdict(set)
    all_images = set()
    
    for pair in pairs:
        img1, img2 = pair['image1'], pair['image2']
        graph[img1].add(img2)
        graph[img2].add(img1)
        all_images.add(img1)
        all_images.add(img2)
    
    # Find connected components using DFS
    visited = set()
    components = []
    
    def dfs(node, component):
        if node in visited:
            return
        visited.add(node)
        component.append(node)
        for neighbor in graph[node]:
            dfs(neighbor, component)
    
    for image in all_images:
        if image not in visited:
            component = []
            dfs(image, component)
            if len(component) > 1:  # Only keep clusters with multiple images
                components.append(component)
    
    return components

def save_scene_clusters(components, output_dir="outputs/scene_clusters"):
    """Save scene clusters to files."""
    output_dir = Path(output_dir)
    output_dir.mkdir(exist_ok=True)
    
    # Save cluster summary
    with open(output_dir / "scene_clusters_summary.txt", "w") as f:
        f.write(f"Found {len(components)} scene clusters\n\n")
        for i, cluster in enumerate(components):
            f.write(f"Cluster {i}: {len(cluster)} images\n")
    
    # Save individual cluster files
    for i, cluster in enumerate(components):
        with open(output_dir / f"scene_cluster_{i:03d}.txt", "w") as f:
            for img in sorted(cluster):
                f.write(f"{img}\n")
    
    # Save all matches in one file
    with open(output_dir / "all_scene_matches.txt", "w") as f:
        f.write("cluster_id,image_count,images\n")
        for i, cluster in enumerate(components):
            images_str = ",".join(sorted(cluster))
            f.write(f"{i},{len(cluster)},\"{images_str}\"\n")
    
    print(f"Scene clusters saved to {output_dir}")
    return components

def analyze_clusters(components):
    """Analyze and display cluster statistics."""
    if not components:
        print("No scene clusters found!")
        return
    
    cluster_sizes = [len(c) for c in components]
    total_images = sum(cluster_sizes)
    
    print(f"\nScene Clustering Results:")
    print(f"========================")
    print(f"Total clusters found: {len(components)}")
    print(f"Total images in clusters: {total_images}")
    print(f"Average cluster size: {np.mean(cluster_sizes):.1f}")
    print(f"Largest cluster: {max(cluster_sizes)} images")
    print(f"Smallest cluster: {min(cluster_sizes)} images")
    
    # Show size distribution
    size_counts = defaultdict(int)
    for size in cluster_sizes:
        size_counts[size] += 1
    
    print(f"\nCluster size distribution:")
    for size in sorted(size_counts.keys()):
        print(f"  {size} images: {size_counts[size]} clusters")
    
    # Show largest clusters
    components.sort(key=len, reverse=True)
    print(f"\nLargest clusters:")
    for i, cluster in enumerate(components[:5]):
        print(f"  Cluster {i}: {len(cluster)} images")
        print(f"    Sample images: {', '.join(cluster[:3])}")

def main():
    parser = argparse.ArgumentParser(description="Find scene matches using high similarity threshold")
    parser.add_argument("--pairs", default="outputs/pairs-sift.txt", help="Pairs file")
    parser.add_argument("--features", default="outputs/global-feats-netvlad.h5", help="Global features")
    parser.add_argument("--threshold", type=float, default=0.85, help="Similarity threshold for scene matching")
    parser.add_argument("--output_dir", default="outputs/scene_clusters", help="Output directory")
    
    args = parser.parse_args()
    
    print("Loading global features...")
    features_dict = load_global_features(args.features)
    print(f"Loaded features for {len(features_dict)} images")
    
    print(f"Finding high-similarity pairs (threshold: {args.threshold})...")
    high_sim_pairs = find_high_similarity_matches(args.pairs, features_dict, args.threshold)
    print(f"Found {len(high_sim_pairs)} high-similarity pairs")
    
    if not high_sim_pairs:
        print("No high-similarity pairs found. Try lowering the threshold.")
        return
    
    print("Building connected components...")
    components = build_connected_components(high_sim_pairs)
    
    # Analyze results
    analyze_clusters(components)
    
    # Save results
    save_scene_clusters(components, args.output_dir)
    
    print(f"\nDone! Results saved to {args.output_dir}")

if __name__ == "__main__":
    main()