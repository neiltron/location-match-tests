#!/usr/bin/env python3
"""
Build scene clusters from match pairs using connected components.
Filters out duplicate pairs (inlier_ratio > 0.95) and groups images into clusters.
"""

import argparse
import json
from pathlib import Path
from collections import defaultdict
from typing import Dict, Set, List


def load_matches(tsv_path: str, max_inlier_ratio: float = 0.95) -> List[tuple]:
    """
    Load match pairs from TSV, filtering out duplicates.

    Args:
        tsv_path: Path to overlap_pairs.tsv
        max_inlier_ratio: Maximum inlier ratio (excludes pairs above this)

    Returns:
        List of (img_a, img_b) tuples
    """
    matches = []
    with open(tsv_path, 'r') as f:
        header = f.readline().strip().split('\t')

        # Find column indices
        img_a_idx = header.index('img_a')
        img_b_idx = header.index('img_b')
        inlier_ratio_idx = header.index('inlier_ratio')

        for line in f:
            parts = line.strip().split('\t')
            inlier_ratio = float(parts[inlier_ratio_idx])

            # Filter: keep only non-duplicate pairs
            if inlier_ratio <= max_inlier_ratio:
                img_a = parts[img_a_idx]
                img_b = parts[img_b_idx]
                matches.append((img_a, img_b))

    return matches


def build_graph(matches: List[tuple]) -> Dict[str, Set[str]]:
    """
    Build adjacency graph from match pairs.

    Args:
        matches: List of (img_a, img_b) tuples

    Returns:
        Adjacency list as dict of sets
    """
    graph = defaultdict(set)
    for img_a, img_b in matches:
        graph[img_a].add(img_b)
        graph[img_b].add(img_a)
    return graph


def find_connected_components(graph: Dict[str, Set[str]]) -> List[Set[str]]:
    """
    Find all connected components using DFS.

    Args:
        graph: Adjacency list

    Returns:
        List of clusters (each cluster is a set of image names)
    """
    visited = set()
    clusters = []

    def dfs(node: str, cluster: Set[str]):
        """Depth-first search to find all nodes in component."""
        visited.add(node)
        cluster.add(node)
        for neighbor in graph[node]:
            if neighbor not in visited:
                dfs(neighbor, cluster)

    # Process all nodes
    for node in graph:
        if node not in visited:
            cluster = set()
            dfs(node, cluster)
            clusters.append(cluster)

    # Sort clusters by size (largest first)
    clusters.sort(key=len, reverse=True)
    return clusters


def save_clusters(clusters: List[Set[str]], output_dir: str):
    """
    Save clusters to individual text files.

    Args:
        clusters: List of image sets
        output_dir: Output directory path
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    # Save individual cluster files
    for i, cluster in enumerate(clusters):
        filename = f"scene_cluster_{i+1:03d}.txt"
        with open(output_path / filename, 'w') as f:
            for img in sorted(cluster):
                f.write(f"{img}\n")

    print(f"Saved {len(clusters)} cluster files to {output_dir}/")


def save_assignments(clusters: List[Set[str]], output_dir: str):
    """
    Save cluster assignments (image → cluster_id mapping).

    Args:
        clusters: List of image sets
        output_dir: Output directory path
    """
    output_path = Path(output_dir)
    assignments_file = output_path / "cluster_assignments.txt"

    with open(assignments_file, 'w') as f:
        f.write("image_name\tcluster_id\n")
        for i, cluster in enumerate(clusters):
            for img in sorted(cluster):
                f.write(f"{img}\t{i+1}\n")

    print(f"Saved cluster assignments to {assignments_file}")


def save_stats(clusters: List[Set[str]], matches: List[tuple],
               total_pairs: int, output_dir: str):
    """
    Save clustering statistics as JSON.

    Args:
        clusters: List of image sets
        matches: Filtered match pairs
        total_pairs: Total pairs in original TSV
        output_dir: Output directory path
    """
    output_path = Path(output_dir)
    stats_file = output_path / "cluster_stats.json"

    stats = {
        "num_clusters": len(clusters),
        "total_images": sum(len(c) for c in clusters),
        "total_pairs_original": total_pairs,
        "total_pairs_filtered": len(matches),
        "pairs_excluded_as_duplicates": total_pairs - len(matches),
        "cluster_sizes": {
            "min": min(len(c) for c in clusters) if clusters else 0,
            "max": max(len(c) for c in clusters) if clusters else 0,
            "mean": sum(len(c) for c in clusters) / len(clusters) if clusters else 0
        },
        "size_distribution": [len(c) for c in clusters]
    }

    with open(stats_file, 'w') as f:
        json.dump(stats, f, indent=2)

    print(f"Saved statistics to {stats_file}")


def main():
    parser = argparse.ArgumentParser(
        description="Build scene clusters from match pairs using connected components"
    )
    parser.add_argument(
        "--input",
        default="out/overlap_pairs.tsv",
        help="Path to overlap pairs TSV file"
    )
    parser.add_argument(
        "--max_inlier_ratio",
        type=float,
        default=0.95,
        help="Maximum inlier ratio (pairs above this are excluded as duplicates)"
    )
    parser.add_argument(
        "--output_dir",
        default="out/clusters",
        help="Output directory for cluster files"
    )

    args = parser.parse_args()

    # Count total pairs (for stats)
    with open(args.input, 'r') as f:
        total_pairs = sum(1 for _ in f) - 1  # -1 for header

    print(f"Loading matches from {args.input}...")
    print(f"Filtering: inlier_ratio <= {args.max_inlier_ratio}")
    matches = load_matches(args.input, args.max_inlier_ratio)

    print(f"\nLoaded {len(matches)} pairs (excluded {total_pairs - len(matches)} duplicates)")

    print("Building graph...")
    graph = build_graph(matches)
    print(f"Graph has {len(graph)} nodes")

    print("Finding connected components...")
    clusters = find_connected_components(graph)

    print(f"\nFound {len(clusters)} clusters")
    print(f"Largest cluster: {max(len(c) for c in clusters) if clusters else 0} images")
    print(f"Smallest cluster: {min(len(c) for c in clusters) if clusters else 0} images")

    print(f"\nSaving results to {args.output_dir}...")
    save_clusters(clusters, args.output_dir)
    save_assignments(clusters, args.output_dir)
    save_stats(clusters, matches, total_pairs, args.output_dir)

    print("\nDone!")


if __name__ == "__main__":
    main()
