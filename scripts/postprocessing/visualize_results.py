#!/usr/bin/env python3
"""
Simple visualization tool for scene matching results.
"""

import argparse
import csv
from pathlib import Path
import matplotlib.pyplot as plt
from PIL import Image
import random

def visualize_cluster(cluster_file, image_dir, output_file=None, max_images=16):
    """Visualize a single cluster as a grid of images."""

    # Read cluster images
    with open(cluster_file, 'r') as f:
        image_names = [line.strip() for line in f if line.strip()]

    if not image_names:
        print(f"No images in cluster {cluster_file}")
        return

    # Limit number of images to display
    if len(image_names) > max_images:
        print(f"Cluster has {len(image_names)} images, showing random sample of {max_images}")
        image_names = random.sample(image_names, max_images)

    # Calculate grid size
    n_images = len(image_names)
    cols = min(4, n_images)
    rows = (n_images + cols - 1) // cols

    # Create figure
    fig, axes = plt.subplots(rows, cols, figsize=(cols * 3, rows * 3))
    if rows == 1 and cols == 1:
        axes = [[axes]]
    elif rows == 1:
        axes = [axes]
    elif cols == 1:
        axes = [[ax] for ax in axes]

    # Load and display images
    image_dir = Path(image_dir)
    for idx, img_name in enumerate(image_names):
        row = idx // cols
        col = idx % cols
        ax = axes[row][col]

        img_path = image_dir / img_name
        if img_path.exists():
            try:
                img = Image.open(img_path)
                ax.imshow(img)
                ax.set_title(img_name[:20], fontsize=8)
                ax.axis('off')
            except Exception as e:
                ax.text(0.5, 0.5, f'Error loading\n{img_name[:20]}',
                       ha='center', va='center', fontsize=8)
                ax.axis('off')
        else:
            ax.text(0.5, 0.5, f'Not found\n{img_name[:20]}',
                   ha='center', va='center', fontsize=8)
            ax.axis('off')

    # Hide empty subplots
    for idx in range(n_images, rows * cols):
        row = idx // cols
        col = idx % cols
        axes[row][col].axis('off')

    cluster_name = Path(cluster_file).stem
    plt.suptitle(f'{cluster_name}: {len(image_names)} images', fontsize=14, fontweight='bold')
    plt.tight_layout()

    if output_file:
        plt.savefig(output_file, dpi=150, bbox_inches='tight')
        print(f"Saved visualization to {output_file}")
    else:
        plt.show()

    plt.close()

def visualize_matches(matches_csv, image_dir, output_file=None, max_pairs=16):
    """Visualize top matches as side-by-side image pairs."""

    # Read matches
    matches = []
    with open(matches_csv, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            matches.append({
                'image1': row['image1'],
                'image2': row['image2'],
                'matches': int(row['matches']),
                'confidence': float(row['confidence'])
            })

    # Sort by number of matches
    matches.sort(key=lambda x: x['matches'], reverse=True)
    matches = matches[:max_pairs]

    if not matches:
        print("No matches found")
        return

    # Calculate grid size
    n_pairs = len(matches)
    rows = min(n_pairs, 8)

    # Create figure
    fig, axes = plt.subplots(rows, 2, figsize=(8, rows * 2))
    if rows == 1:
        axes = [axes]

    image_dir = Path(image_dir)

    for idx, match in enumerate(matches[:rows]):
        # Left image
        img1_path = image_dir / match['image1']
        if img1_path.exists():
            try:
                img1 = Image.open(img1_path)
                axes[idx][0].imshow(img1)
                axes[idx][0].set_title(f"{match['image1'][:20]}", fontsize=8)
            except:
                axes[idx][0].text(0.5, 0.5, 'Error', ha='center', va='center')
        axes[idx][0].axis('off')

        # Right image
        img2_path = image_dir / match['image2']
        if img2_path.exists():
            try:
                img2 = Image.open(img2_path)
                axes[idx][1].imshow(img2)
                axes[idx][1].set_title(f"{match['image2'][:20]}\n{match['matches']} matches ({match['confidence']:.2f})",
                                     fontsize=8)
            except:
                axes[idx][1].text(0.5, 0.5, 'Error', ha='center', va='center')
        axes[idx][1].axis('off')

    plt.suptitle(f'Top {len(matches)} Image Matches', fontsize=14, fontweight='bold')
    plt.tight_layout()

    if output_file:
        plt.savefig(output_file, dpi=150, bbox_inches='tight')
        print(f"Saved visualization to {output_file}")
    else:
        plt.show()

    plt.close()

def visualize_all_clusters(results_dir, image_dir, output_dir=None, max_images_per_cluster=16):
    """Visualize all clusters in the results directory."""

    results_dir = Path(results_dir)
    cluster_files = sorted(results_dir.glob('scene_cluster_*.txt'))

    if not cluster_files:
        print(f"No cluster files found in {results_dir}")
        return

    print(f"Found {len(cluster_files)} clusters")

    if output_dir:
        output_dir = Path(output_dir)
        output_dir.mkdir(exist_ok=True, parents=True)

    for cluster_file in cluster_files:
        print(f"Visualizing {cluster_file.name}...")
        output_file = None
        if output_dir:
            output_file = output_dir / f"{cluster_file.stem}_viz.png"

        visualize_cluster(cluster_file, image_dir, output_file, max_images_per_cluster)

def main():
    parser = argparse.ArgumentParser(description="Visualize scene matching results")
    parser.add_argument("--results_dir", default="outputs/kornia_results",
                       help="Results directory")
    parser.add_argument("--image_dir", default="images", help="Image directory")
    parser.add_argument("--output_dir", default="outputs/visualizations",
                       help="Output directory for visualizations")
    parser.add_argument("--mode", choices=['clusters', 'matches', 'both'],
                       default='both', help="What to visualize")
    parser.add_argument("--max_images_per_cluster", type=int, default=16,
                       help="Max images to show per cluster")
    parser.add_argument("--max_pairs", type=int, default=16,
                       help="Max image pairs to show")
    parser.add_argument("--cluster_file", help="Visualize a specific cluster file")

    args = parser.parse_args()

    results_dir = Path(args.results_dir)
    image_dir = Path(args.image_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(exist_ok=True, parents=True)

    print(f"🎨 Visualizing results from {results_dir}")
    print(f"📁 Using images from {image_dir}")
    print(f"💾 Saving to {output_dir}")

    if args.cluster_file:
        # Visualize specific cluster
        output_file = output_dir / f"{Path(args.cluster_file).stem}_viz.png"
        visualize_cluster(args.cluster_file, image_dir, output_file, args.max_images_per_cluster)
    else:
        # Visualize all
        if args.mode in ['clusters', 'both']:
            print("\n📊 Visualizing clusters...")
            visualize_all_clusters(results_dir, image_dir, output_dir, args.max_images_per_cluster)

        if args.mode in ['matches', 'both']:
            print("\n🔗 Visualizing top matches...")
            matches_file = results_dir / "filtered_matches.csv"
            if matches_file.exists():
                output_file = output_dir / "top_matches.png"
                visualize_matches(matches_file, image_dir, output_file, args.max_pairs)
            else:
                print(f"⚠️  No filtered_matches.csv found in {results_dir}")

    print(f"\n✅ Visualizations saved to {output_dir}")

if __name__ == "__main__":
    main()
