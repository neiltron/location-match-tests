#!/usr/bin/env python3
"""
Kornia-based LightGlue pipeline for macOS compatibility.
Uses Kornia's integrated LightGlue and DeDoDe for stable feature matching.
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
import kornia as K
import kornia.feature as KF
from PIL import Image

# Set environment for stability
os.environ['KMP_DUPLICATE_LIB_OK'] = 'TRUE'

def setup_kornia_device():
    """Setup the best available device for Kornia."""
    if torch.backends.mps.is_available():
        device = torch.device('mps')
        print(f"✅ Using MPS device: {device}")
    elif torch.cuda.is_available():
        device = torch.device('cuda')
        print(f"✅ Using CUDA device: {device}")
    else:
        device = torch.device('cpu')
        print(f"✅ Using CPU device: {device}")
    
    return device

def setup_kornia_models(device, feature_type='disk'):
    """Setup Kornia feature detection and matching models."""
    try:
        print(f"🔧 Setting up Kornia models with {feature_type} features...")

        if feature_type == 'dedodeb':
            # Use DeDoDe for detection and description
            detector = KF.DeDoDe.from_pretrained(
                detector_weights='L-C4-v2',
                descriptor_weights='B-upright'
            ).to(device).eval()
            matcher = KF.LightGlueMatcher('dedodeb').to(device).eval()
            
        elif feature_type == 'disk':
            # Use DISK features with LightGlue
            detector = KF.DISK.from_pretrained('depth').to(device).eval()
            matcher = KF.LightGlueMatcher('disk').to(device).eval()
            
        elif feature_type == 'superpoint':
            # Use SuperPoint features
            detector = KF.KeyNetAffNetHardNet(
                num_features=2048,
                upright=True
            ).to(device).eval()
            matcher = KF.LightGlueMatcher('superpoint').to(device).eval()

        elif feature_type == 'sift':
            # Use SIFT features with traditional matching
            # SIFT has MPS issues, force CPU for SIFT
            sift_device = torch.device('cpu') if device.type == 'mps' else device
            detector = KF.SIFTFeature(num_features=2048).to(sift_device).eval()
            # For SIFT, we'll use descriptor matching + RANSAC instead of LightGlue
            matcher = None  # Will use custom matching logic
            print(f"⚠️  SIFT using CPU due to MPS limitations")

        else:
            raise ValueError(f"Unknown feature type: {feature_type}")
        
        print(f"✅ Kornia {feature_type} models setup successful")
        return detector, matcher
        
    except Exception as e:
        print(f"❌ Kornia setup failed: {e}")
        return None, None

def load_and_preprocess_image(image_path, device, target_size=640):
    """Load and preprocess image for Kornia."""
    try:
        # Load image and ensure RGB
        img = Image.open(image_path)
        if img.mode != 'RGB':
            img = img.convert('RGB')
        
        # Resize while maintaining aspect ratio
        w, h = img.size
        if max(w, h) > target_size:
            if w > h:
                new_w, new_h = target_size, int(h * target_size / w)
            else:
                new_w, new_h = int(w * target_size / h), target_size
            img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)

        # Convert to tensor and normalize
        img_array = np.array(img)
        img_tensor = K.image_to_tensor(img_array, keepdim=False).float() / 255.0
        img_tensor = img_tensor.to(device)  # Shape: [1, C, H, W] - batch dimension already added by image_to_tensor

        # Pad to make dimensions divisible by 16 (required for DISK and some other models)
        _, _, h, w = img_tensor.shape
        pad_h = (16 - h % 16) % 16
        pad_w = (16 - w % 16) % 16
        if pad_h > 0 or pad_w > 0:
            img_tensor = torch.nn.functional.pad(img_tensor, (0, pad_w, 0, pad_h), mode='constant', value=0)
        
        # ImageNet normalization for some models (manually normalize)
        mean = torch.tensor([0.485, 0.456, 0.406]).to(device).reshape(1, 3, 1, 1)
        std = torch.tensor([0.229, 0.224, 0.225]).to(device).reshape(1, 3, 1, 1)
        img_normalized = (img_tensor - mean) / std
        
        return img_tensor, img_normalized
        
    except Exception as e:
        print(f"Error loading {image_path}: {e}")
        return None, None

def extract_features_kornia(detector, device, image_paths, feature_type='disk', batch_size=4):
    """Extract features using Kornia models."""
    all_features = {}
    
    print(f"🔧 Extracting {feature_type} features from {len(image_paths)} images...")
    
    for i in tqdm(range(0, len(image_paths), batch_size), desc="Feature extraction"):
        batch_paths = image_paths[i:i+batch_size]
        
        try:
            for img_path in batch_paths:
                img_tensor, img_normalized = load_and_preprocess_image(img_path, device)
                
                if img_tensor is None:
                    continue
                
                with torch.no_grad():
                    if feature_type == 'dedodeb':
                        # DeDoDe expects normalized images
                        keypoints, scores, descriptors = detector(img_normalized)
                        
                        # Convert to expected format
                        lafs = torch.stack([
                            keypoints[0, :, :2],  # x, y coordinates
                            torch.ones_like(keypoints[0, :, :1]),  # scale
                        ], dim=-1).unsqueeze(0)  # Add batch dim
                        
                    elif feature_type == 'disk':
                        # DISK detector returns a list with a DISKFeatures object
                        features = detector(img_tensor)
                        if isinstance(features, (tuple, list)) and len(features) >= 1:
                            # Extract the DISKFeatures object from the list
                            feat_obj = features[0]
                            # DISKFeatures has: keypoints, descriptors, detection_scores
                            keypoints = feat_obj.keypoints
                            descriptors = feat_obj.descriptors
                            scores = feat_obj.detection_scores if hasattr(feat_obj, 'detection_scores') else torch.ones(keypoints.shape[0], device=keypoints.device)
                            # Create LAFs from keypoints for compatibility with matcher
                            # LAFs format: [B, N, 2, 3] with affine transformation matrices
                            # keypoints shape: [N, 2] (x, y coordinates)
                            num_kpts = keypoints.shape[0]
                            lafs = torch.zeros(1, num_kpts, 2, 3, device=keypoints.device)
                            lafs[0, :, :, 2] = keypoints  # Set center points
                            lafs[0, :, 0, 0] = 1.0  # Identity scale/rotation
                            lafs[0, :, 1, 1] = 1.0
                        else:
                            raise ValueError(f"Unexpected DISK output format: {type(features)}, len: {len(features) if hasattr(features, '__len__') else 'N/A'}")
                        
                    elif feature_type == 'superpoint':
                        # KeyNetAffNetHardNet
                        lafs, responses, descriptors = detector(img_tensor)
                        keypoints = lafs[0, :, :, :2].reshape(-1, 2)  # Extract x,y
                        scores = responses[0]

                    elif feature_type == 'sift':
                        # SIFT uses CPU on MPS, move tensor appropriately
                        sift_device = torch.device('cpu') if device.type == 'mps' else device
                        img_for_sift = img_tensor.to(sift_device)
                        # SIFT detector returns lafs and descriptors
                        lafs, descriptors = detector(img_for_sift)
                        # Extract keypoints from LAFs - shape is [1, N, 2, 3]
                        keypoints = lafs[0, :, :, 2]  # Center points from LAF, shape [N, 2]
                        # Ensure descriptors match keypoints count
                        num_kpts = keypoints.shape[0]
                        if descriptors.shape[1] > num_kpts:
                            descriptors = descriptors[:, :num_kpts, :]
                        # SIFT doesn't have scores, use ones
                        scores = torch.ones(num_kpts, device=sift_device)
                        # Move back to main device for storage
                        keypoints = keypoints.to(device)
                        scores = scores.to(device)
                        descriptors = descriptors.to(device)
                        lafs = lafs.to(device)
                        
                    # Store features (move to CPU to save GPU memory)
                    all_features[img_path.name] = {
                        'keypoints': keypoints[0].cpu() if keypoints.dim() > 2 else keypoints.cpu(),
                        'scores': scores[0].cpu() if scores.dim() > 1 else scores.cpu(),
                        'descriptors': descriptors[0].cpu() if descriptors.dim() > 2 else descriptors.cpu(),
                        'lafs': lafs[0].cpu() if lafs.dim() > 3 else lafs.cpu()
                    }
                
                # Clear GPU memory
                del img_tensor, img_normalized
                if 'features' in locals():
                    del features
                torch.cuda.empty_cache() if device.type == 'cuda' else None
                
        except Exception as e:
            print(f"Error in batch {i//batch_size}: {e}")
            continue
    
    print(f"✅ Extracted features for {len(all_features)} images")
    return all_features

def match_features_kornia(matcher, device, features_dict, pairs, min_matches=30, batch_size=8, feature_type='disk'):
    """Match features using Kornia matcher or RANSAC."""
    all_matches = []

    if feature_type == 'sift':
        print(f"🔧 Matching {len(pairs)} pairs with SIFT + RANSAC...")
    else:
        print(f"🔧 Matching {len(pairs)} pairs with Kornia LightGlue...")

    for i in tqdm(range(0, len(pairs), batch_size), desc="Matching pairs"):
        batch_pairs = pairs[i:i+batch_size]

        try:
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

                # Get features
                feats1 = features_dict[img1_name]
                feats2 = features_dict[img2_name]

                with torch.no_grad():
                    # SIFT uses traditional matching + RANSAC
                    if feature_type == 'sift':
                        desc1 = feats1['descriptors'].to(device)
                        desc2 = feats2['descriptors'].to(device)
                        kpts1 = feats1['keypoints'].to(device)
                        kpts2 = feats2['keypoints'].to(device)

                        # Mutual nearest neighbor matching
                        # Compute pairwise distances
                        dists = torch.cdist(desc1, desc2, p=2)

                        # Find mutual nearest neighbors
                        nn12 = torch.argmin(dists, dim=1)  # Nearest in desc2 for each in desc1
                        nn21 = torch.argmin(dists, dim=0)  # Nearest in desc1 for each in desc2

                        # Mutual matches: i matches j if nn12[i]=j and nn21[j]=i
                        mutual_matches = []
                        match_dists = []
                        for i_idx in range(len(nn12)):
                            j_idx = nn12[i_idx].item()
                            if nn21[j_idx] == i_idx and dists[i_idx, j_idx] < 0.8:  # Lowe's ratio test threshold
                                mutual_matches.append((i_idx, j_idx))
                                match_dists.append(dists[i_idx, j_idx].item())

                        num_matches = len(mutual_matches)

                        if num_matches >= 4:  # Need at least 4 points for RANSAC
                            # Get matched keypoint coordinates
                            src_pts = torch.stack([kpts1[m[0]] for m in mutual_matches])
                            dst_pts = torch.stack([kpts2[m[1]] for m in mutual_matches])

                            # RANSAC to find geometric inliers
                            try:
                                # Find fundamental matrix with RANSAC
                                F, inliers = K.geometry.find_fundamental(
                                    src_pts.unsqueeze(0),
                                    dst_pts.unsqueeze(0),
                                    method='ransac',
                                    confidence=0.999,
                                    max_iters=2000
                                )

                                # Count inliers
                                num_inliers = inliers.sum().item()
                                # Confidence is ratio of inliers
                                avg_confidence = num_inliers / num_matches if num_matches > 0 else 0.0

                                all_matches.append({
                                    'image1': img1_name,
                                    'image2': img2_name,
                                    'matches': num_inliers,
                                    'confidence': avg_confidence,
                                    'valid': True
                                })
                            except Exception as ransac_error:
                                # RANSAC failed, use descriptor matches
                                avg_confidence = 1.0 - (sum(match_dists) / len(match_dists) if match_dists else 1.0)
                                all_matches.append({
                                    'image1': img1_name,
                                    'image2': img2_name,
                                    'matches': num_matches,
                                    'confidence': avg_confidence,
                                    'valid': True
                                })
                        else:
                            # Too few matches for RANSAC
                            avg_confidence = 1.0 - (sum(match_dists) / len(match_dists) if match_dists else 1.0)
                            all_matches.append({
                                'image1': img1_name,
                                'image2': img2_name,
                                'matches': num_matches,
                                'confidence': avg_confidence,
                                'valid': True
                            })

                        continue  # Skip LightGlue matching below

                    # LightGlue matching for other feature types
                    # Move to device for matching
                    desc1 = feats1['descriptors'].to(device).unsqueeze(0)
                    desc2 = feats2['descriptors'].to(device).unsqueeze(0)
                    lafs1 = feats1['lafs'].to(device).unsqueeze(0)
                    lafs2 = feats2['lafs'].to(device).unsqueeze(0)
                    # LightGlue matching
                    try:
                        matcher_output = matcher(desc1, desc2, lafs1, lafs2)

                        # Kornia LightGlue returns a tuple
                        if isinstance(matcher_output, tuple):
                            # Debug first match to understand format
                            if i == 0 and img1_name == batch_pairs[0][0]:
                                print(f"\n🔍 DEBUG: Tuple length: {len(matcher_output)}")
                                for idx, item in enumerate(matcher_output):
                                    if hasattr(item, 'shape'):
                                        print(f"  [{idx}]: shape {item.shape}, dtype {item.dtype}")
                                    else:
                                        print(f"  [{idx}]: {type(item)}")

                            # Try different tuple formats
                            if len(matcher_output) == 2:
                                # Kornia LightGlue returns: (scores, indices)
                                # scores: [N, 1] where N is number of matches
                                # indices: [N, 2] where each row is [idx0, idx1]
                                scores, indices = matcher_output
                                num_matches = scores.shape[0] if scores.dim() > 0 else 0
                                avg_confidence = scores.mean().item() if num_matches > 0 else 0.0
                            elif len(matcher_output) == 3:
                                kpts0_matched, kpts1_matched, batch_confidences = matcher_output
                                num_matches = kpts0_matched.shape[1] if kpts0_matched.dim() > 1 else kpts0_matched.shape[0]
                                avg_confidence = batch_confidences.mean().item() if num_matches > 0 else 0.0
                            else:
                                if i == 0:
                                    print(f"⚠️ Unexpected tuple length: {len(matcher_output)}")
                                num_matches = 0
                                avg_confidence = 0.0
                        elif isinstance(matcher_output, dict):
                            # Fallback for dict-style output
                            if 'matches' in matcher_output:
                                matches = matcher_output['matches'][0]
                                valid_matches = matches >= 0
                                num_matches = valid_matches.sum().item()
                                if 'matching_scores' in matcher_output:
                                    confidence = matcher_output['matching_scores'][0]
                                    avg_confidence = confidence[valid_matches].mean().item() if num_matches > 0 else 0
                                else:
                                    avg_confidence = float(num_matches) / max(len(desc1[0]), len(desc2[0]))
                            else:
                                num_matches = 0
                                avg_confidence = 0.0
                        else:
                            raise ValueError(f"Unexpected matcher output type: {type(matcher_output)}")
                        
                    except Exception as match_error:
                        print(f"Matching error for {img1_name}-{img2_name}: {match_error}")
                        num_matches = 0
                        avg_confidence = 0.0
                
                all_matches.append({
                    'image1': img1_name,
                    'image2': img2_name,
                    'matches': num_matches,
                    'confidence': avg_confidence,
                    'valid': True
                })
                
                # Clear GPU memory
                del desc1, desc2, lafs1, lafs2
                if 'matches_dict' in locals():
                    del matches_dict
                torch.cuda.empty_cache() if device.type == 'cuda' else None
                
        except Exception as e:
            print(f"Error in batch {i//batch_size}: {e}")
            # Add error entries for this batch
            for img1_name, img2_name in batch_pairs:
                all_matches.append({
                    'image1': img1_name,
                    'image2': img2_name,
                    'matches': 0,
                    'confidence': 0.0,
                    'valid': False
                })
    
    return all_matches

def generate_all_pairs(image_names, max_pairs=None):
    """Generate all possible image pairs."""
    pairs = []
    n = len(image_names)
    total_pairs = n * (n - 1) // 2
    
    print(f"🔧 Generating pairs for {n} images (max: {total_pairs:,})")
    
    for i in range(n):
        for j in range(i + 1, n):
            pairs.append((image_names[i], image_names[j]))
            if max_pairs and len(pairs) >= max_pairs:
                print(f"⚠️  Limited to {max_pairs:,} pairs")
                return pairs
    
    return pairs

def filter_matches(all_matches, min_matches=30, min_confidence=0.3):
    """Filter matches based on thresholds."""
    filtered = [
        m for m in all_matches 
        if m['valid'] and m['matches'] >= min_matches and m['confidence'] >= min_confidence
    ]
    return filtered

def build_scene_clusters(matches):
    """Build connected components from matches."""
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

def save_results(all_matches, filtered_matches, clusters, feature_type, output_dir="outputs/kornia_results"):
    """Save all results."""
    output_dir = Path(output_dir)
    output_dir.mkdir(exist_ok=True, parents=True)
    
    # Save all matches
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
    
    # Save clusters
    for i, cluster in enumerate(clusters):
        with open(output_dir / f"scene_cluster_{i:03d}.txt", "w") as f:
            for img in sorted(cluster):
                f.write(f"{img}\n")
    
    # Save statistics
    match_counts = [m['matches'] for m in all_matches if m['valid']]
    if match_counts:
        stats = {
            'feature_type': feature_type,
            'total_pairs': len(all_matches),
            'valid_pairs': sum(1 for m in all_matches if m['valid']),
            'pairs_with_matches': sum(1 for m in all_matches if m['valid'] and m['matches'] > 0),
            'scene_matches_filtered': len(filtered_matches),
            'scene_clusters': len(clusters),
            'match_statistics': {
                'max_matches': max(match_counts),
                'min_matches': min(match_counts),
                'avg_matches': sum(match_counts) / len(match_counts),
                'percentiles': {
                    '50%': float(np.percentile(match_counts, 50)),
                    '75%': float(np.percentile(match_counts, 75)),
                    '90%': float(np.percentile(match_counts, 90)),
                    '95%': float(np.percentile(match_counts, 95)),
                }
            }
        }
        
        with open(output_dir / "kornia_stats.json", "w") as f:
            json.dump(stats, f, indent=2)
    
    print(f"💾 Results saved to {output_dir}")

def main():
    parser = argparse.ArgumentParser(description="Kornia-based scene matching pipeline")
    parser.add_argument("--image_dir", default="images", help="Image directory")
    parser.add_argument("--output_dir", default="outputs/kornia_results", help="Output directory")
    parser.add_argument("--feature_type", choices=['dedodeb', 'disk', 'superpoint', 'sift'],
                       default='disk', help="Feature type to use")
    parser.add_argument("--min_matches", type=int, default=30, help="Minimum matches for clustering")
    parser.add_argument("--min_confidence", type=float, default=0.3, help="Minimum confidence")
    parser.add_argument("--max_pairs", type=int, default=10000, help="Maximum pairs to test")
    parser.add_argument("--max_images", type=int, default=100, help="Maximum images to process")
    parser.add_argument("--feature_batch_size", type=int, default=4, help="Feature extraction batch size")
    parser.add_argument("--match_batch_size", type=int, default=8, help="Matching batch size")
    
    args = parser.parse_args()
    
    print("🚀 Kornia Scene Matching Pipeline")
    print("=" * 50)
    print(f"Feature type: {args.feature_type}")
    print(f"Device detection: {setup_kornia_device()}")
    
    # Setup
    device = setup_kornia_device()
    detector, matcher = setup_kornia_models(device, args.feature_type)

    if detector is None:
        print("❌ Failed to setup Kornia models")
        return

    # matcher can be None for SIFT (uses RANSAC instead)
    
    # Get images
    image_dir = Path(args.image_dir)
    image_paths = list(image_dir.glob('*.jpg'))[:args.max_images]
    print(f"📁 Processing {len(image_paths)} images")
    
    start_time = time.time()
    
    # Pipeline
    print("\n🔧 Step 1: Feature Extraction")
    features = extract_features_kornia(
        detector, device, image_paths, args.feature_type, args.feature_batch_size
    )
    
    print("\n🔧 Step 2: Pair Generation")
    image_names = [p.name for p in image_paths]
    pairs = generate_all_pairs(image_names, args.max_pairs)
    
    print("\n🔧 Step 3: Feature Matching")
    all_matches = match_features_kornia(
        matcher, device, features, pairs, args.min_matches, args.match_batch_size, args.feature_type
    )
    
    elapsed_time = time.time() - start_time
    
    print("\n🔧 Step 4: Filtering & Clustering")
    filtered_matches = filter_matches(all_matches, args.min_matches, args.min_confidence)
    clusters = build_scene_clusters(filtered_matches)
    
    print("\n🔧 Step 5: Saving Results")
    save_results(all_matches, filtered_matches, clusters, args.feature_type, args.output_dir)
    
    # Summary
    print(f"\n🎯 Kornia Processing Complete!")
    print(f"   ⏱️  Total time: {elapsed_time:.1f}s")
    print(f"   🚀 Speed: {len(pairs) / elapsed_time:.1f} pairs/second")
    print(f"   🎭 Scene matches: {len(filtered_matches)}")
    print(f"   🗂️  Scene clusters: {len(clusters)}")
    
    if clusters:
        cluster_sizes = [len(c) for c in clusters]
        print(f"   📈 Largest cluster: {max(cluster_sizes)} images")

if __name__ == "__main__":
    main()