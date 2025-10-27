#!/usr/bin/env python3
"""
Organize images into cluster directories based on scene_cluster_*.txt files.
Copies images from source directory into organized cluster subdirectories.
"""

import argparse
import shutil
from pathlib import Path
from typing import List


def find_cluster_files(cluster_dir: str) -> List[Path]:
    """
    Find all scene_cluster_*.txt files.

    Args:
        cluster_dir: Directory containing cluster files

    Returns:
        List of cluster file paths, sorted by cluster number
    """
    cluster_path = Path(cluster_dir)
    cluster_files = sorted(cluster_path.glob("scene_cluster_*.txt"))
    return cluster_files


def copy_cluster_images(cluster_file: Path, source_dir: str, output_dir: str,
                       min_size: int = 2, dry_run: bool = False):
    """
    Copy images for a single cluster into its own directory.

    Args:
        cluster_file: Path to scene_cluster_XXX.txt
        source_dir: Source directory containing images
        output_dir: Base output directory for organized clusters
        min_size: Minimum cluster size to process
        dry_run: If True, only print actions without copying
    """
    source_path = Path(source_dir)
    output_path = Path(output_dir)

    # Read image names from cluster file
    with open(cluster_file, 'r') as f:
        images = [line.strip() for line in f if line.strip()]

    # Skip small clusters if requested
    if len(images) < min_size:
        return 0

    # Create cluster subdirectory (e.g., cluster_001, cluster_002)
    cluster_name = cluster_file.stem  # e.g., "scene_cluster_001"
    cluster_num = cluster_name.replace("scene_cluster_", "cluster_")
    cluster_output = output_path / cluster_num

    if not dry_run:
        cluster_output.mkdir(parents=True, exist_ok=True)

    # Copy each image
    copied = 0
    missing = 0
    for img in images:
        src_file = source_path / img
        dst_file = cluster_output / img

        if not src_file.exists():
            missing += 1
            continue

        if dry_run:
            print(f"  Would copy: {img} -> {cluster_num}/")
        else:
            shutil.copy2(src_file, dst_file)
        copied += 1

    if missing > 0:
        print(f"  Warning: {missing} images not found in source directory")

    return copied


def main():
    parser = argparse.ArgumentParser(
        description="Organize images into cluster directories"
    )
    parser.add_argument(
        "--cluster_dir",
        default="out/clusters",
        help="Directory containing scene_cluster_*.txt files"
    )
    parser.add_argument(
        "--source_dir",
        default="images",
        help="Source directory containing original images"
    )
    parser.add_argument(
        "--output_dir",
        default="out/organized_clusters",
        help="Output directory for organized cluster subdirectories"
    )
    parser.add_argument(
        "--min_size",
        type=int,
        default=2,
        help="Minimum cluster size to process (skip smaller clusters)"
    )
    parser.add_argument(
        "--dry_run",
        action="store_true",
        help="Show what would be copied without actually copying"
    )

    args = parser.parse_args()

    print(f"Finding cluster files in {args.cluster_dir}...")
    cluster_files = find_cluster_files(args.cluster_dir)

    if not cluster_files:
        print(f"No scene_cluster_*.txt files found in {args.cluster_dir}")
        return

    print(f"Found {len(cluster_files)} cluster files")
    print(f"Source images: {args.source_dir}")
    print(f"Output directory: {args.output_dir}")
    print(f"Minimum cluster size: {args.min_size}")

    if args.dry_run:
        print("\n*** DRY RUN MODE - No files will be copied ***\n")

    # Create output directory
    if not args.dry_run:
        Path(args.output_dir).mkdir(parents=True, exist_ok=True)

    # Process each cluster
    total_copied = 0
    processed_clusters = 0

    for cluster_file in cluster_files:
        cluster_name = cluster_file.stem
        print(f"\nProcessing {cluster_name}...")

        copied = copy_cluster_images(
            cluster_file,
            args.source_dir,
            args.output_dir,
            args.min_size,
            args.dry_run
        )

        if copied > 0:
            print(f"  Copied {copied} images")
            total_copied += copied
            processed_clusters += 1
        else:
            print(f"  Skipped (size < {args.min_size} or no images found)")

    print("\n" + "=" * 50)
    print(f"Summary:")
    print(f"  Processed clusters: {processed_clusters}")
    print(f"  Total images copied: {total_copied}")
    if args.dry_run:
        print(f"\n  Run without --dry_run to actually copy files")
    else:
        print(f"  Output directory: {args.output_dir}")


if __name__ == "__main__":
    main()
