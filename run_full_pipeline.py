#!/usr/bin/env python3
"""
Complete pipeline using global features only - bypasses hloc stability issues.
"""

import h5py
import numpy as np
from pathlib import Path
import argparse
from collections import defaultdict
from tqdm import tqdm
import os

def extract_simple_features(image_dir, output_file):
    """Extract simple image statistics as features (placeholder for real features)."""
    from PIL import Image
    import numpy as np
    
    image_dir = Path(image_dir)
    features = {}
    
    print(f"Extracting simple features from {len(list(image_dir.glob('*.jpg')))} images...")
    
    for img_path in tqdm(image_dir.glob('*.jpg')):
        try:
            # Placeholder: use image statistics as features
            img = Image.open(img_path).convert('RGB')
            img_array = np.array(img.resize((224, 224)))
            
            # Simple features: color histograms
            hist_r = np.histogram(img_array[:,:,0], bins=32)[0]
            hist_g = np.histogram(img_array[:,:,1], bins=32)[0]
            hist_b = np.histogram(img_array[:,:,2], bins=32)[0]
            feature_vector = np.concatenate([hist_r, hist_g, hist_b]).astype(np.float32)
            feature_vector = feature_vector / (np.linalg.norm(feature_vector) + 1e-8)
            
            features[img_path.name] = feature_vector
            
        except Exception as e:
            print(f"Error processing {img_path}: {e}")
            continue
    
    # Save features
    with h5py.File(output_file, 'w') as f:
        for img_name, feat in features.items():
            grp = f.create_group(img_name)
            grp.create_dataset('global_descriptor', data=feat)
    
    print(f"Saved {len(features)} features to {output_file}")

def generate_pairs_from_features(features_file, output_file, num_pairs=60):
    """Generate image pairs based on feature similarity."""
    
    features = {}
    with h5py.File(features_file, 'r') as f:
        for key in f.keys():
            features[key] = f[key]['global_descriptor'][...]
    
    image_names = list(features.keys())
    n_images = len(image_names)
    
    print(f"Generating pairs from {n_images} images...")
    
    pairs = []
    
    # For each image, find its most similar images
    for i, img1 in enumerate(tqdm(image_names)):
        similarities = []
        feat1 = features[img1]
        
        for j, img2 in enumerate(image_names):
            if i != j:
                feat2 = features[img2]
                # Cosine similarity
                sim = np.dot(feat1, feat2) / (np.linalg.norm(feat1) * np.linalg.norm(feat2) + 1e-8)
                similarities.append((sim, img2))
        
        # Sort by similarity and take top matches
        similarities.sort(reverse=True)
        for _, img2 in similarities[:num_pairs]:
            pairs.append(f"{img1} {img2}")
    
    # Save pairs
    with open(output_file, 'w') as f:
        for pair in pairs:
            f.write(f"{pair}\n")
    
    print(f"Generated {len(pairs)} pairs saved to {output_file}")

def find_scene_matches(pairs_file, features_file, threshold=0.75, output_dir="outputs/scene_clusters"):
    """Find scene matches using high similarity threshold."""
    
    # Load features
    features = {}
    with h5py.File(features_file, 'r') as f:
        for key in f.keys():
            features[key] = f[key]['global_descriptor'][...]
    
    print(f"Finding scene matches with threshold {threshold}...")
    
    high_sim_pairs = []
    
    with open(pairs_file, 'r') as f:
        for line in tqdm(f):
            parts = line.strip().split()
            if len(parts) != 2:
                continue
                
            img1, img2 = parts
            
            if img1 in features and img2 in features:
                feat1 = features[img1]
                feat2 = features[img2]
                
                # Cosine similarity
                similarity = np.dot(feat1, feat2) / (np.linalg.norm(feat1) * np.linalg.norm(feat2) + 1e-8)
                
                if similarity >= threshold:
                    high_sim_pairs.append({
                        'image1': img1,
                        'image2': img2,
                        'similarity': similarity
                    })
    
    print(f"Found {len(high_sim_pairs)} high-similarity pairs")
    
    if not high_sim_pairs:
        print("No high-similarity pairs found. Try lowering the threshold.")
        return []
    
    # Build connected components
    graph = defaultdict(set)
    all_images = set()
    
    for pair in high_sim_pairs:
        img1, img2 = pair['image1'], pair['image2']
        graph[img1].add(img2)
        graph[img2].add(img1)
        all_images.add(img1)
        all_images.add(img2)
    
    # Find connected components
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
            if len(component) > 1:
                components.append(component)
    
    # Save results
    output_dir = Path(output_dir)
    output_dir.mkdir(exist_ok=True)
    
    for i, cluster in enumerate(components):
        with open(output_dir / f"scene_cluster_{i:03d}.txt", "w") as f:
            for img in sorted(cluster):
                f.write(f"{img}\n")
    
    print(f"Found {len(components)} scene clusters saved to {output_dir}")
    return components

def main():
    parser = argparse.ArgumentParser(description="Complete scene matching pipeline")
    parser.add_argument("--image_dir", default="images", help="Image directory")
    parser.add_argument("--output_dir", default="outputs", help="Output directory")
    parser.add_argument("--threshold", type=float, default=0.75, help="Similarity threshold")
    parser.add_argument("--num_pairs", type=int, default=60, help="Number of pairs per image")
    
    args = parser.parse_args()
    
    output_dir = Path(args.output_dir)
    output_dir.mkdir(exist_ok=True)
    
    features_file = output_dir / "simple-global-features.h5"
    pairs_file = output_dir / "pairs-simple.txt"
    
    # Step 1: Extract features for all current images
    current_images = set(img.name for img in Path(args.image_dir).glob('*.jpg'))
    netvlad_file = output_dir / "global-feats-netvlad.h5"
    
    # Check if we have features for all current images
    if netvlad_file.exists():
        with h5py.File(netvlad_file, 'r') as f:
            existing_images = set(f.keys())
        
        if current_images.issubset(existing_images):
            print(f"Using existing NetVLAD features from {netvlad_file} (covers all {len(current_images)} images)")
            features_file = netvlad_file
        else:
            missing_count = len(current_images - existing_images)
            print(f"NetVLAD features missing {missing_count} images. Extracting features for all {len(current_images)} images...")
            extract_simple_features(args.image_dir, features_file)
    else:
        print(f"Extracting simple color histogram features for all {len(current_images)} images...")
        extract_simple_features(args.image_dir, features_file)
    
    # Step 2: Generate pairs
    if not pairs_file.exists():
        generate_pairs_from_features(features_file, pairs_file, args.num_pairs)
    else:
        print(f"Using existing pairs from {pairs_file}")
    
    # Step 3: Find scene matches
    components = find_scene_matches(pairs_file, features_file, args.threshold, args.output_dir + "/scene_clusters")
    
    if components:
        cluster_sizes = [len(c) for c in components]
        print(f"\nResults: {len(components)} clusters, sizes: {min(cluster_sizes)} to {max(cluster_sizes)} images")

if __name__ == "__main__":
    main()