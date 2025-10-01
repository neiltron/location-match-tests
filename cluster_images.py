#!/usr/bin/env python3
"""
Direct image clustering using NetVLAD global features.
This bypasses the need for local feature matching and provides more stable clustering.
"""

import h5py
import numpy as np
import matplotlib.pyplot as plt
from sklearn.cluster import KMeans, DBSCAN
from sklearn.decomposition import PCA
from sklearn.metrics import silhouette_score
import argparse
from pathlib import Path

def load_global_features(features_path):
    """Load NetVLAD global features from h5 file."""
    features = {}
    with h5py.File(features_path, 'r') as f:
        for key in f.keys():
            features[key] = f[key]['global_descriptor'][...]
    return features

def features_to_matrix(features_dict):
    """Convert features dict to matrix and image list."""
    image_names = list(features_dict.keys())
    feature_matrix = np.stack([features_dict[name] for name in image_names])
    return feature_matrix, image_names

def perform_clustering(features, method='kmeans', n_clusters=20, **kwargs):
    """Perform clustering on feature matrix."""
    if method == 'kmeans':
        clusterer = KMeans(n_clusters=n_clusters, random_state=42, **kwargs)
    elif method == 'dbscan':
        clusterer = DBSCAN(**kwargs)
    else:
        raise ValueError(f"Unknown clustering method: {method}")
    
    labels = clusterer.fit_predict(features)
    return labels, clusterer

def analyze_clusters(features, labels, image_names):
    """Analyze clustering results."""
    n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    n_noise = list(labels).count(-1) if -1 in labels else 0
    
    print(f"Number of clusters: {n_clusters}")
    print(f"Number of noise points: {n_noise}")
    print(f"Total images: {len(image_names)}")
    
    # Calculate silhouette score (if not too many clusters)
    if n_clusters > 1 and n_clusters < len(image_names) - 1:
        try:
            silhouette = silhouette_score(features, labels)
            print(f"Silhouette score: {silhouette:.3f}")
        except Exception as e:
            print(f"Could not calculate silhouette score: {e}")
    
    # Show cluster sizes
    unique_labels, counts = np.unique(labels, return_counts=True)
    print("\nCluster sizes:")
    for label, count in zip(unique_labels, counts):
        if label == -1:
            print(f"  Noise: {count} images")
        else:
            print(f"  Cluster {label}: {count} images")
    
    return n_clusters, n_noise

def visualize_clusters(features, labels, image_names, output_dir="outputs/clusters"):
    """Visualize clusters using PCA."""
    output_dir = Path(output_dir)
    output_dir.mkdir(exist_ok=True)
    
    # Reduce dimensionality for visualization
    pca = PCA(n_components=2, random_state=42)
    features_2d = pca.fit_transform(features)
    
    # Plot clusters
    plt.figure(figsize=(12, 8))
    unique_labels = set(labels)
    colors = plt.cm.Spectral(np.linspace(0, 1, len(unique_labels)))
    
    for label, color in zip(unique_labels, colors):
        if label == -1:
            # Noise points
            mask = labels == label
            plt.scatter(features_2d[mask, 0], features_2d[mask, 1], 
                       c='black', marker='x', s=50, alpha=0.6, label='Noise')
        else:
            mask = labels == label
            plt.scatter(features_2d[mask, 0], features_2d[mask, 1], 
                       c=[color], s=50, alpha=0.7, label=f'Cluster {label}')
    
    plt.title('Image Clusters (PCA Visualization)')
    plt.xlabel(f'PC1 ({pca.explained_variance_ratio_[0]:.1%} variance)')
    plt.ylabel(f'PC2 ({pca.explained_variance_ratio_[1]:.1%} variance)')
    plt.legend(bbox_to_anchor=(1.05, 1), loc='upper left')
    plt.tight_layout()
    plt.savefig(output_dir / "clusters_pca.png", dpi=300, bbox_inches='tight')
    plt.close()
    
    print(f"Cluster visualization saved to {output_dir / 'clusters_pca.png'}")

def save_cluster_results(labels, image_names, output_dir="outputs/clusters"):
    """Save clustering results to files."""
    output_dir = Path(output_dir)
    output_dir.mkdir(exist_ok=True)
    
    # Save overall results
    with open(output_dir / "cluster_assignments.txt", "w") as f:
        f.write("image_name,cluster_label\n")
        for name, label in zip(image_names, labels):
            f.write(f"{name},{label}\n")
    
    # Save individual cluster files
    unique_labels = set(labels)
    for label in unique_labels:
        if label == -1:
            filename = "noise_images.txt"
        else:
            filename = f"cluster_{label:03d}.txt"
        
        mask = labels == label
        cluster_images = [image_names[i] for i in range(len(image_names)) if mask[i]]
        
        with open(output_dir / filename, "w") as f:
            for img in cluster_images:
                f.write(f"{img}\n")
    
    print(f"Cluster results saved to {output_dir}")

def main():
    parser = argparse.ArgumentParser(description="Cluster images using global features")
    parser.add_argument("--features", default="outputs/global-feats-netvlad.h5",
                       help="Path to global features h5 file")
    parser.add_argument("--method", choices=['kmeans', 'dbscan'], default='kmeans',
                       help="Clustering method")
    parser.add_argument("--n_clusters", type=int, default=20,
                       help="Number of clusters (for k-means)")
    parser.add_argument("--eps", type=float, default=0.5,
                       help="DBSCAN epsilon parameter")
    parser.add_argument("--min_samples", type=int, default=5,
                       help="DBSCAN min_samples parameter")
    parser.add_argument("--output_dir", default="outputs/clusters",
                       help="Output directory for results")
    parser.add_argument("--visualize", action="store_true",
                       help="Generate cluster visualization")
    
    args = parser.parse_args()
    
    print("Loading global features...")
    features_dict = load_global_features(args.features)
    features_matrix, image_names = features_to_matrix(features_dict)
    
    print(f"Loaded {len(image_names)} images with {features_matrix.shape[1]}D features")
    
    # Perform clustering
    print(f"\nPerforming {args.method} clustering...")
    if args.method == 'kmeans':
        labels, clusterer = perform_clustering(features_matrix, 'kmeans', 
                                             n_clusters=args.n_clusters)
    else:
        labels, clusterer = perform_clustering(features_matrix, 'dbscan',
                                             eps=args.eps, min_samples=args.min_samples)
    
    # Analyze results
    print("\nClustering Results:")
    print("=" * 40)
    n_clusters, n_noise = analyze_clusters(features_matrix, labels, image_names)
    
    # Save results
    save_cluster_results(labels, image_names, args.output_dir)
    
    # Visualize if requested
    if args.visualize:
        print("\nGenerating visualization...")
        visualize_clusters(features_matrix, labels, image_names, args.output_dir)
    
    print(f"\nClustering complete! Results saved to {args.output_dir}")

if __name__ == "__main__":
    main()