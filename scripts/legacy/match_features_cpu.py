#!/usr/bin/env python3
"""
CPU-only feature matching with smaller batches to avoid crashes.
"""

import h5py
import numpy as np
import cv2
from pathlib import Path
import argparse
from tqdm import tqdm

def load_sift_features(features_path, image_name):
    """Load SIFT features for a specific image."""
    with h5py.File(features_path, 'r') as f:
        if image_name in f:
            keypoints = f[image_name]['keypoints'][...]
            descriptors = f[image_name]['descriptors'][...]
            return keypoints, descriptors
    return None, None

def match_features_cpu(desc1, desc2, ratio_threshold=0.8):
    """Match features using CPU-based nearest neighbor search."""
    if desc1 is None or desc2 is None or len(desc1) == 0 or len(desc2) == 0:
        return []
    
    # Use FLANN matcher
    FLANN_INDEX_KDTREE = 1
    index_params = dict(algorithm=FLANN_INDEX_KDTREE, trees=5)
    search_params = dict(checks=50)
    flann = cv2.FlannBasedMatcher(index_params, search_params)
    
    try:
        matches = flann.knnMatch(desc1.astype(np.float32), desc2.astype(np.float32), k=2)
        
        # Apply ratio test
        good_matches = []
        for match_pair in matches:
            if len(match_pair) == 2:
                m, n = match_pair
                if m.distance < ratio_threshold * n.distance:
                    good_matches.append(m)
        
        return good_matches
    except Exception as e:
        print(f"Matching failed: {e}")
        return []

def geometric_verification(kp1, kp2, matches, min_matches=10, ransac_threshold=4.0):
    """Verify matches using geometric constraints (homography)."""
    if len(matches) < min_matches:
        return False, 0
    
    # Extract matched keypoints
    src_pts = np.float32([kp1[m.queryIdx] for m in matches]).reshape(-1, 1, 2)
    dst_pts = np.float32([kp2[m.trainIdx] for m in matches]).reshape(-1, 1, 2)
    
    try:
        # Find homography
        homography, mask = cv2.findHomography(
            src_pts, dst_pts, cv2.RANSAC, ransac_threshold
        )
        
        if homography is not None:
            inlier_count = np.sum(mask)
            inlier_ratio = inlier_count / len(matches)
            
            # Consider it a match if we have enough inliers
            is_match = inlier_count >= min_matches and inlier_ratio >= 0.2
            return is_match, int(inlier_count)
        
    except Exception as e:
        print(f"Geometric verification failed: {e}")
    
    return False, 0

def process_pairs_batch(pairs_batch, features_path, results):
    """Process a batch of image pairs."""
    for img1, img2 in pairs_batch:
        # Load features
        kp1, desc1 = load_sift_features(features_path, img1)
        kp2, desc2 = load_sift_features(features_path, img2)
        
        if desc1 is None or desc2 is None:
            continue
        
        # Match features
        matches = match_features_cpu(desc1, desc2)
        
        if len(matches) >= 10:  # Minimum threshold
            # Geometric verification
            is_match, inlier_count = geometric_verification(kp1, kp2, matches)
            
            if is_match:
                results.append({
                    'image1': img1,
                    'image2': img2,
                    'matches': len(matches),
                    'inliers': inlier_count
                })

def find_geometric_matches(pairs_file, features_path, output_file, batch_size=100):
    """Find geometrically verified matches between image pairs."""
    
    # Load pairs
    pairs = []
    with open(pairs_file, 'r') as f:
        for line in f:
            img1, img2 = line.strip().split()
            pairs.append((img1, img2))
    
    print(f"Processing {len(pairs)} image pairs in batches of {batch_size}")
    
    results = []
    
    # Process in batches
    for i in tqdm(range(0, len(pairs), batch_size), desc="Processing batches"):
        batch = pairs[i:i+batch_size]
        process_pairs_batch(batch, features_path, results)
        
        # Save intermediate results periodically
        if i % (batch_size * 10) == 0 and results:
            print(f"Found {len(results)} matches so far...")
    
    # Save results
    with open(output_file, 'w') as f:
        f.write("image1,image2,matches,inliers\n")
        for result in results:
            f.write(f"{result['image1']},{result['image2']},{result['matches']},{result['inliers']}\n")
    
    print(f"Found {len(results)} geometric matches")
    print(f"Results saved to {output_file}")
    
    return results

def main():
    parser = argparse.ArgumentParser(description="CPU-based geometric feature matching")
    parser.add_argument("--pairs", default="outputs/pairs-sift.txt", help="Pairs file")
    parser.add_argument("--features", default="outputs/feats-sift.h5", help="SIFT features")
    parser.add_argument("--output", default="outputs/geometric_matches.txt", help="Output file")
    parser.add_argument("--batch_size", type=int, default=100, help="Batch size")
    
    args = parser.parse_args()
    
    results = find_geometric_matches(args.pairs, args.features, args.output, args.batch_size)
    
    if results:
        # Show some statistics
        inlier_counts = [r['inliers'] for r in results]
        print(f"\nStatistics:")
        print(f"Total geometric matches: {len(results)}")
        print(f"Average inliers: {np.mean(inlier_counts):.1f}")
        print(f"Max inliers: {max(inlier_counts)}")
        print(f"Min inliers: {min(inlier_counts)}")

if __name__ == "__main__":
    main()