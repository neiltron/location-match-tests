#!/usr/bin/env python3
"""
Visualize top overlapping image pairs from the sorted TSV file.
Creates multiple visualization types: side-by-side comparisons, match visualizations, and summary grids.
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from PIL import Image
from pathlib import Path
import argparse
from tqdm import tqdm
import cv2
import os

def load_image(img_path: Path, max_size: int = 800) -> np.ndarray:
    """Load and resize image for visualization."""
    img = Image.open(img_path)

    # Resize if too large
    if max(img.size) > max_size:
        ratio = max_size / max(img.size)
        new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
        img = img.resize(new_size, Image.Resampling.LANCZOS)

    return np.array(img)

def create_side_by_side_comparison(img1_path: Path, img2_path: Path,
                                  title: str = "", confidence: float = 0,
                                  inliers: int = 0, ratio: float = 0) -> plt.Figure:
    """Create a side-by-side comparison of two images."""
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(15, 7))

    img1 = load_image(img1_path)
    img2 = load_image(img2_path)

    ax1.imshow(img1)
    ax1.set_title(f"{img1_path.name}")
    ax1.axis('off')

    ax2.imshow(img2)
    ax2.set_title(f"{img2_path.name}")
    ax2.axis('off')

    # Add overall title with metrics
    fig.suptitle(f"{title}\nConfidence: {confidence:.1f} | Inliers: {inliers} | Ratio: {ratio:.3f}",
                 fontsize=12, fontweight='bold')

    plt.tight_layout()
    return fig

def create_grid_visualization(pairs_df: pd.DataFrame, image_dir: Path,
                             output_file: Path, max_pairs: int = 100,
                             grid_cols: int = 10):
    """Create a grid showing thumbnails of top matching pairs."""
    print(f"Creating grid visualization of top {max_pairs} pairs...")

    # Calculate grid dimensions
    n_pairs = min(max_pairs, len(pairs_df))
    grid_rows = (n_pairs * 2 + grid_cols - 1) // grid_cols  # *2 because each pair has 2 images

    fig_width = grid_cols * 2
    fig_height = grid_rows * 2
    fig, axes = plt.subplots(grid_rows, grid_cols, figsize=(fig_width, fig_height))

    # Flatten axes for easier indexing
    axes = axes.flatten() if grid_rows > 1 else axes

    # Hide all axes initially
    for ax in axes:
        ax.axis('off')

    idx = 0
    for pair_idx, row in pairs_df.head(n_pairs).iterrows():
        img1_path = image_dir / row['img_a']
        img2_path = image_dir / row['img_b']

        if not img1_path.exists() or not img2_path.exists():
            continue

        # Load images
        try:
            img1 = load_image(img1_path, max_size=200)
            img2 = load_image(img2_path, max_size=200)

            # Place images in grid
            if idx < len(axes):
                axes[idx].imshow(img1)
                axes[idx].set_title(f"#{pair_idx+1}a\nC:{row['overlap_conf']:.0f}", fontsize=8)
                axes[idx].axis('off')

            if idx + 1 < len(axes):
                axes[idx + 1].imshow(img2)
                axes[idx + 1].set_title(f"#{pair_idx+1}b", fontsize=8)
                axes[idx + 1].axis('off')

                # Add colored border for pairs
                for spine in axes[idx].spines.values():
                    spine.set_edgecolor('green')
                    spine.set_linewidth(2)
                for spine in axes[idx + 1].spines.values():
                    spine.set_edgecolor('green')
                    spine.set_linewidth(2)

            idx += 2
            if idx >= grid_cols * grid_rows:
                break

        except Exception as e:
            print(f"Error loading pair {pair_idx}: {e}")
            continue

    plt.suptitle(f"Top {n_pairs} Overlapping Image Pairs (sorted by confidence)",
                 fontsize=14, fontweight='bold')
    plt.tight_layout()
    plt.savefig(output_file, dpi=150, bbox_inches='tight')
    print(f"Saved grid visualization to: {output_file}")
    return fig

def create_confidence_histogram(pairs_df: pd.DataFrame, output_file: Path):
    """Create histogram of confidence scores."""
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 8))

    # Linear scale histogram
    ax1.hist(pairs_df['overlap_conf'], bins=50, edgecolor='black', alpha=0.7)
    ax1.set_xlabel('Overlap Confidence')
    ax1.set_ylabel('Number of Pairs')
    ax1.set_title('Distribution of Overlap Confidence Scores (Linear Scale)')
    ax1.grid(True, alpha=0.3)

    # Add percentile lines
    percentiles = [50, 75, 90, 95, 99]
    for p in percentiles:
        val = pairs_df['overlap_conf'].quantile(p/100)
        ax1.axvline(val, color='red', linestyle='--', alpha=0.5)
        ax1.text(val, ax1.get_ylim()[1] * 0.9, f'{p}%', rotation=90, va='top')

    # Log scale histogram
    ax2.hist(pairs_df['overlap_conf'], bins=50, edgecolor='black', alpha=0.7)
    ax2.set_xlabel('Overlap Confidence')
    ax2.set_ylabel('Number of Pairs (log scale)')
    ax2.set_title('Distribution of Overlap Confidence Scores (Log Scale)')
    ax2.set_yscale('log')
    ax2.grid(True, alpha=0.3)

    # Add threshold lines
    thresholds = [100, 200, 500, 1000]
    for thresh in thresholds:
        ax2.axvline(thresh, color='green', linestyle=':', alpha=0.5)
        ax2.text(thresh, ax2.get_ylim()[0] * 2, f'{thresh}', rotation=90, va='bottom')

    plt.tight_layout()
    plt.savefig(output_file, dpi=150, bbox_inches='tight')
    print(f"Saved histogram to: {output_file}")
    return fig

def create_scatter_plot(pairs_df: pd.DataFrame, output_file: Path):
    """Create scatter plot of inliers vs confidence."""
    fig, ax = plt.subplots(figsize=(12, 8))

    # Create scatter plot
    scatter = ax.scatter(pairs_df['inliers'], pairs_df['overlap_conf'],
                        c=pairs_df['inlier_ratio'], cmap='viridis',
                        alpha=0.6, s=20)

    ax.set_xlabel('Number of Inliers')
    ax.set_ylabel('Overlap Confidence')
    ax.set_title('Relationship between Inliers and Confidence\n(color = inlier ratio)')
    ax.grid(True, alpha=0.3)

    # Add colorbar
    cbar = plt.colorbar(scatter, ax=ax)
    cbar.set_label('Inlier Ratio')

    # Add trend line
    z = np.polyfit(pairs_df['inliers'], pairs_df['overlap_conf'], 1)
    p = np.poly1d(z)
    x_trend = np.linspace(pairs_df['inliers'].min(), pairs_df['inliers'].max(), 100)
    ax.plot(x_trend, p(x_trend), "r--", alpha=0.5, label=f'Trend: y={z[0]:.2f}x+{z[1]:.2f}')
    ax.legend()

    plt.tight_layout()
    plt.savefig(output_file, dpi=150, bbox_inches='tight')
    print(f"Saved scatter plot to: {output_file}")
    return fig

def create_top_pairs_detailed(pairs_df: pd.DataFrame, image_dir: Path,
                             output_dir: Path, n_pairs: int = 10):
    """Create detailed visualizations for top N pairs."""
    print(f"Creating detailed visualizations for top {n_pairs} pairs...")

    detail_dir = output_dir / "top_pairs_detailed"
    detail_dir.mkdir(exist_ok=True)

    for idx, row in pairs_df.head(n_pairs).iterrows():
        img1_path = image_dir / row['img_a']
        img2_path = image_dir / row['img_b']

        if not img1_path.exists() or not img2_path.exists():
            print(f"Skipping pair {idx}: images not found")
            continue

        # Create side-by-side comparison
        fig = create_side_by_side_comparison(
            img1_path, img2_path,
            title=f"Rank #{idx+1}",
            confidence=row['overlap_conf'],
            inliers=row['inliers'],
            ratio=row['inlier_ratio']
        )

        output_file = detail_dir / f"pair_{idx+1:03d}_{row['img_a'].split('.')[0]}_{row['img_b'].split('.')[0]}.png"
        fig.savefig(output_file, dpi=150, bbox_inches='tight')
        plt.close(fig)

    print(f"Saved detailed visualizations to: {detail_dir}")

def create_summary_report(pairs_df: pd.DataFrame, output_file: Path, filters_applied: dict = None):
    """Create a text summary report."""
    with open(output_file, 'w') as f:
        f.write("=" * 80 + "\n")
        f.write("OVERLAP PAIRS ANALYSIS REPORT\n")
        f.write("=" * 80 + "\n\n")

        if filters_applied:
            f.write("FILTERS APPLIED\n")
            f.write("-" * 40 + "\n")
            for key, value in filters_applied.items():
                f.write(f"{key}: {value}\n")
            f.write("\n")

        f.write("SUMMARY STATISTICS\n")
        f.write("-" * 40 + "\n")
        f.write(f"Total pairs: {len(pairs_df)}\n")
        f.write(f"Confidence range: {pairs_df['overlap_conf'].min():.1f} - {pairs_df['overlap_conf'].max():.1f}\n")
        f.write(f"Mean confidence: {pairs_df['overlap_conf'].mean():.1f}\n")
        f.write(f"Median confidence: {pairs_df['overlap_conf'].median():.1f}\n")
        f.write(f"Std deviation: {pairs_df['overlap_conf'].std():.1f}\n\n")

        f.write("CONFIDENCE THRESHOLDS\n")
        f.write("-" * 40 + "\n")
        thresholds = [50, 100, 200, 500, 1000, 2000]
        for thresh in thresholds:
            count = len(pairs_df[pairs_df['overlap_conf'] >= thresh])
            percentage = 100 * count / len(pairs_df)
            f.write(f"Pairs with confidence >= {thresh:4d}: {count:5d} ({percentage:5.1f}%)\n")
        f.write("\n")

        f.write("TOP 20 OVERLAPPING PAIRS\n")
        f.write("-" * 40 + "\n")
        for idx, row in pairs_df.head(20).iterrows():
            f.write(f"{idx+1:3d}. {row['img_a']:30s} <-> {row['img_b']:30s}\n")
            f.write(f"     Confidence: {row['overlap_conf']:7.1f} | Inliers: {int(row['inliers']):4d} | Ratio: {row['inlier_ratio']:.3f}\n\n")

        f.write("\nPERCENTILES\n")
        f.write("-" * 40 + "\n")
        percentiles = [1, 5, 10, 25, 50, 75, 90, 95, 99]
        for p in percentiles:
            val = pairs_df['overlap_conf'].quantile(p/100)
            f.write(f"{p:3d}th percentile: {val:8.1f}\n")

    print(f"Saved summary report to: {output_file}")

def main():
    parser = argparse.ArgumentParser(description="Visualize overlap pairs")
    parser.add_argument("--input", default="out/overlap_pairs_sorted.tsv",
                       help="Input sorted TSV file")
    parser.add_argument("--image-dir", default="images",
                       help="Directory containing images")
    parser.add_argument("--output-dir", default="out/visualizations",
                       help="Output directory for visualizations")
    parser.add_argument("--top-n", type=int, default=100,
                       help="Number of top pairs to visualize in grid")
    parser.add_argument("--detailed-n", type=int, default=10,
                       help="Number of top pairs for detailed visualization")
    parser.add_argument("--max-ratio", type=float, default=0.95,
                       help="Maximum inlier ratio to include (filter out near-duplicates)")
    parser.add_argument("--min-ratio", type=float, default=0.0,
                       help="Minimum inlier ratio to include")
    parser.add_argument("--min-confidence", type=float, default=0.0,
                       help="Minimum confidence score to include")

    args = parser.parse_args()

    # Setup paths
    input_file = Path(args.input)
    image_dir = Path(args.image_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(exist_ok=True, parents=True)

    if not input_file.exists():
        print(f"Error: Input file not found: {input_file}")
        return

    # Load data
    print(f"Loading overlap pairs from: {input_file}")
    pairs_df = pd.read_csv(input_file, sep='\t')
    print(f"Loaded {len(pairs_df)} pairs")

    # Apply filters
    original_count = len(pairs_df)
    if args.max_ratio < 1.0:
        pairs_df = pairs_df[pairs_df['inlier_ratio'] <= args.max_ratio]
        print(f"Filtered out {original_count - len(pairs_df)} pairs with ratio > {args.max_ratio}")

    if args.min_ratio > 0.0:
        pairs_df = pairs_df[pairs_df['inlier_ratio'] >= args.min_ratio]
        print(f"Filtered to {len(pairs_df)} pairs with ratio >= {args.min_ratio}")

    if args.min_confidence > 0.0:
        pairs_df = pairs_df[pairs_df['overlap_conf'] >= args.min_confidence]
        print(f"Filtered to {len(pairs_df)} pairs with confidence >= {args.min_confidence}")

    if len(pairs_df) == 0:
        print("No pairs left after filtering! Adjust your filter parameters.")
        return

    print(f"Processing {len(pairs_df)} pairs after filtering (removed {original_count - len(pairs_df)} duplicates/poor matches)")

    # Create visualizations
    print("\n📊 Creating visualizations...")

    # 1. Grid visualization of top pairs
    grid_fig = create_grid_visualization(
        pairs_df, image_dir,
        output_dir / "top_pairs_grid.png",
        max_pairs=args.top_n
    )
    plt.close(grid_fig)

    # 2. Confidence histogram
    hist_fig = create_confidence_histogram(
        pairs_df, output_dir / "confidence_histogram.png"
    )
    plt.close(hist_fig)

    # 3. Scatter plot
    scatter_fig = create_scatter_plot(
        pairs_df, output_dir / "inliers_vs_confidence.png"
    )
    plt.close(scatter_fig)

    # 4. Detailed views of top pairs
    create_top_pairs_detailed(
        pairs_df, image_dir, output_dir,
        n_pairs=args.detailed_n
    )

    # 5. Summary report
    filters_applied = {
        "max_ratio": args.max_ratio,
        "min_ratio": args.min_ratio,
        "min_confidence": args.min_confidence,
        "pairs_after_filtering": len(pairs_df),
        "pairs_removed": original_count - len(pairs_df)
    }
    create_summary_report(
        pairs_df, output_dir / "summary_report.txt", filters_applied
    )

    print(f"\n✅ All visualizations saved to: {output_dir}")
    print("\nGenerated files:")
    print("  - top_pairs_grid.png: Grid view of top overlapping pairs")
    print("  - confidence_histogram.png: Distribution of confidence scores")
    print("  - inliers_vs_confidence.png: Scatter plot analysis")
    print("  - top_pairs_detailed/: Individual views of top pairs")
    print("  - summary_report.txt: Text summary of statistics")

if __name__ == "__main__":
    main()