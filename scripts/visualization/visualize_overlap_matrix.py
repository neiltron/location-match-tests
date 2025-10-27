#!/usr/bin/env python3
"""
Create a matrix/heatmap visualization of image overlaps to identify clusters.
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from pathlib import Path
import argparse
from scipy.cluster.hierarchy import dendrogram, linkage, fcluster
from scipy.spatial.distance import squareform

def create_overlap_matrix(pairs_df: pd.DataFrame, min_confidence: float = 50) -> tuple:
    """Create a symmetric matrix of overlap confidences."""

    # Filter by minimum confidence
    filtered_df = pairs_df[pairs_df['overlap_conf'] >= min_confidence].copy()

    # Get unique images
    all_images = set(filtered_df['img_a'].unique()) | set(filtered_df['img_b'].unique())
    all_images = sorted(list(all_images))
    n_images = len(all_images)

    print(f"Building overlap matrix for {n_images} images with {len(filtered_df)} connections...")

    # Create image index mapping
    img_to_idx = {img: idx for idx, img in enumerate(all_images)}

    # Initialize matrix
    overlap_matrix = np.zeros((n_images, n_images))

    # Fill matrix with overlap confidences
    for _, row in filtered_df.iterrows():
        idx1 = img_to_idx[row['img_a']]
        idx2 = img_to_idx[row['img_b']]
        conf = row['overlap_conf']

        # Make symmetric
        overlap_matrix[idx1, idx2] = conf
        overlap_matrix[idx2, idx1] = conf

    # Set diagonal to max confidence for each image
    np.fill_diagonal(overlap_matrix, np.max(overlap_matrix, axis=1))

    return overlap_matrix, all_images

def create_clustered_heatmap(overlap_matrix: np.ndarray, image_names: list,
                            output_file: Path, max_display: int = 100):
    """Create a clustered heatmap of image overlaps."""

    n_images = len(image_names)

    # Limit display size for readability
    if n_images > max_display:
        print(f"Limiting display to top {max_display} most connected images...")
        # Find most connected images
        connections = np.sum(overlap_matrix > 0, axis=1)
        top_indices = np.argsort(connections)[-max_display:]
        overlap_matrix = overlap_matrix[top_indices][:, top_indices]
        image_names = [image_names[i] for i in top_indices]
        n_images = max_display

    # Create distance matrix (inverse of overlap)
    max_overlap = np.max(overlap_matrix)
    distance_matrix = max_overlap - overlap_matrix
    np.fill_diagonal(distance_matrix, 0)

    # Perform hierarchical clustering
    condensed_dist = squareform(distance_matrix)
    linkage_matrix = linkage(condensed_dist, method='ward')

    # Create figure with dendrogram and heatmap
    fig = plt.figure(figsize=(20, 16))

    # Dendrogram
    ax1 = plt.subplot2grid((8, 8), (0, 1), rowspan=1, colspan=6)
    dendro = dendrogram(linkage_matrix, no_labels=True, ax=ax1)
    ax1.set_title('Hierarchical Clustering of Images')

    # Get reordered indices from dendrogram
    reordered_idx = dendro['leaves']

    # Reorder matrix and labels
    overlap_matrix_reordered = overlap_matrix[reordered_idx][:, reordered_idx]
    image_names_reordered = [image_names[i] for i in reordered_idx]

    # Heatmap
    ax2 = plt.subplot2grid((8, 8), (1, 1), rowspan=6, colspan=6)

    # Use log scale for better visualization
    overlap_matrix_log = np.log1p(overlap_matrix_reordered)

    im = ax2.imshow(overlap_matrix_log, cmap='YlOrRd', aspect='auto')

    # Add labels if not too many
    if n_images <= 50:
        ax2.set_xticks(range(n_images))
        ax2.set_yticks(range(n_images))
        ax2.set_xticklabels([name[:15] for name in image_names_reordered], rotation=90, fontsize=8)
        ax2.set_yticklabels([name[:15] for name in image_names_reordered], fontsize=8)
    else:
        ax2.set_xticks([])
        ax2.set_yticks([])

    ax2.set_title(f'Overlap Matrix (log scale)\n{n_images} images clustered by similarity')

    # Colorbar
    ax3 = plt.subplot2grid((8, 8), (1, 7), rowspan=6, colspan=1)
    plt.colorbar(im, cax=ax3, label='Log(Overlap Confidence + 1)')

    # Statistics
    ax4 = plt.subplot2grid((8, 8), (7, 1), rowspan=1, colspan=6)
    ax4.axis('off')

    # Find clusters
    clusters = fcluster(linkage_matrix, t=0.3*max_overlap, criterion='distance')
    n_clusters = len(np.unique(clusters))

    stats_text = f"Images: {n_images} | Clusters found: {n_clusters} | "
    stats_text += f"Min overlap: {np.min(overlap_matrix[overlap_matrix > 0]):.1f} | "
    stats_text += f"Max overlap: {np.max(overlap_matrix[overlap_matrix < np.inf]):.1f}"
    ax4.text(0.5, 0.5, stats_text, ha='center', va='center', fontsize=12)

    plt.suptitle('Image Overlap Analysis - Clustered View', fontsize=16, fontweight='bold')
    plt.tight_layout()
    plt.savefig(output_file, dpi=150, bbox_inches='tight')
    print(f"Saved clustered heatmap to: {output_file}")

    return clusters, image_names_reordered

def create_cluster_report(pairs_df: pd.DataFrame, min_confidence: float = 100,
                          output_file: Path = None):
    """Analyze and report clusters based on overlap connections."""

    # Build graph from high-confidence pairs
    filtered_df = pairs_df[pairs_df['overlap_conf'] >= min_confidence].copy()

    # Create adjacency list
    from collections import defaultdict
    graph = defaultdict(set)

    for _, row in filtered_df.iterrows():
        graph[row['img_a']].add(row['img_b'])
        graph[row['img_b']].add(row['img_a'])

    # Find connected components (clusters)
    visited = set()
    clusters = []

    def dfs(node, cluster):
        if node in visited:
            return
        visited.add(node)
        cluster.append(node)
        for neighbor in graph[node]:
            dfs(neighbor, cluster)

    all_images = set(graph.keys())
    for image in all_images:
        if image not in visited:
            cluster = []
            dfs(image, cluster)
            if len(cluster) > 1:  # Only keep clusters with 2+ images
                clusters.append(sorted(cluster))

    # Sort clusters by size
    clusters.sort(key=len, reverse=True)

    # Create report
    report = []
    report.append("=" * 80)
    report.append(f"CLUSTER ANALYSIS (min confidence: {min_confidence})")
    report.append("=" * 80)
    report.append("")
    report.append(f"Total clusters found: {len(clusters)}")
    report.append(f"Total images in clusters: {sum(len(c) for c in clusters)}")
    report.append(f"Largest cluster size: {len(clusters[0]) if clusters else 0}")
    report.append("")

    # Cluster size distribution
    report.append("CLUSTER SIZE DISTRIBUTION:")
    report.append("-" * 40)
    size_counts = {}
    for cluster in clusters:
        size = len(cluster)
        size_counts[size] = size_counts.get(size, 0) + 1

    for size in sorted(size_counts.keys()):
        report.append(f"  Size {size:3d}: {size_counts[size]:3d} clusters")

    report.append("")
    report.append("TOP 10 LARGEST CLUSTERS:")
    report.append("-" * 40)

    for idx, cluster in enumerate(clusters[:10], 1):
        report.append(f"\nCluster {idx}: {len(cluster)} images")
        # Show first 5 images in cluster
        for img in cluster[:5]:
            report.append(f"  - {img}")
        if len(cluster) > 5:
            report.append(f"  ... and {len(cluster) - 5} more")

    # Save or print report
    report_text = "\n".join(report)
    if output_file:
        with open(output_file, 'w') as f:
            f.write(report_text)
        print(f"Saved cluster report to: {output_file}")
    else:
        print(report_text)

    return clusters

def main():
    parser = argparse.ArgumentParser(description="Create matrix visualization of overlaps")
    parser.add_argument("--input", default="out/overlap_pairs_sorted.tsv",
                       help="Input sorted TSV file")
    parser.add_argument("--output-dir", default="out/visualizations",
                       help="Output directory")
    parser.add_argument("--min-confidence", type=float, default=50,
                       help="Minimum confidence for matrix")
    parser.add_argument("--max-display", type=int, default=100,
                       help="Maximum images to display in heatmap")
    parser.add_argument("--max-ratio", type=float, default=0.95,
                       help="Maximum inlier ratio to include (filter out near-duplicates)")
    parser.add_argument("--min-ratio", type=float, default=0.0,
                       help="Minimum inlier ratio to include")

    args = parser.parse_args()

    # Load data
    input_file = Path(args.input)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(exist_ok=True, parents=True)

    print(f"Loading pairs from: {input_file}")
    pairs_df = pd.read_csv(input_file, sep='\t')

    # Apply ratio filters
    original_count = len(pairs_df)
    if args.max_ratio < 1.0:
        pairs_df = pairs_df[pairs_df['inlier_ratio'] <= args.max_ratio]
        print(f"Filtered out {original_count - len(pairs_df)} near-duplicates (ratio > {args.max_ratio})")

    if args.min_ratio > 0.0:
        pairs_df = pairs_df[pairs_df['inlier_ratio'] >= args.min_ratio]
        print(f"Filtered to {len(pairs_df)} pairs with ratio >= {args.min_ratio}")

    if len(pairs_df) == 0:
        print("No pairs left after filtering! Adjust your filter parameters.")
        return

    print(f"Processing {len(pairs_df)} pairs after filtering")

    # Create overlap matrix
    overlap_matrix, image_names = create_overlap_matrix(
        pairs_df, min_confidence=args.min_confidence
    )

    # Create clustered heatmap
    clusters, reordered_names = create_clustered_heatmap(
        overlap_matrix, image_names,
        output_dir / "overlap_matrix_clustered.png",
        max_display=args.max_display
    )

    # Create cluster report
    create_cluster_report(
        pairs_df,
        min_confidence=100,
        output_file=output_dir / "cluster_analysis.txt"
    )

    print(f"\n✅ Matrix visualizations saved to: {output_dir}")

if __name__ == "__main__":
    main()