#!/usr/bin/env python3
"""
Diagnose matching quality by visualizing specific matched pairs.
"""

import argparse
import csv
from pathlib import Path
import matplotlib.pyplot as plt
from PIL import Image

def visualize_specific_match(image1, image2, image_dir, match_info=None):
    """Show two images side by side."""

    image_dir = Path(image_dir)

    fig, axes = plt.subplots(1, 2, figsize=(12, 6))

    # Load images
    img1_path = image_dir / image1
    img2_path = image_dir / image2

    if img1_path.exists():
        img1 = Image.open(img1_path)
        axes[0].imshow(img1)
        axes[0].set_title(f"{image1}\n({img1.size[0]}x{img1.size[1]})", fontsize=10)
    else:
        axes[0].text(0.5, 0.5, 'Not found', ha='center', va='center')
    axes[0].axis('off')

    if img2_path.exists():
        img2 = Image.open(img2_path)
        axes[1].imshow(img2)
        title = f"{image2}\n({img2.size[0]}x{img2.size[1]})"
        if match_info:
            title += f"\n{match_info['matches']} matches, conf={match_info['confidence']:.3f}"
        axes[1].set_title(title, fontsize=10)
    else:
        axes[1].text(0.5, 0.5, 'Not found', ha='center', va='center')
    axes[1].axis('off')

    plt.tight_layout()
    plt.show()

def analyze_match_distribution(csv_file):
    """Analyze which images are matching with many others."""

    matches = []
    with open(csv_file, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            matches.append({
                'image1': row['image1'],
                'image2': row['image2'],
                'matches': int(row['matches']),
                'confidence': float(row['confidence'])
            })

    # Count how many times each image appears
    image_counts = {}
    for match in matches:
        image_counts[match['image1']] = image_counts.get(match['image1'], 0) + 1
        image_counts[match['image2']] = image_counts.get(match['image2'], 0) + 1

    # Sort by count
    sorted_images = sorted(image_counts.items(), key=lambda x: x[1], reverse=True)

    print(f"\n📊 Match Distribution Analysis")
    print(f"=" * 60)
    print(f"Total matches: {len(matches)}")
    print(f"Unique images involved: {len(image_counts)}")
    print(f"\nTop 10 most-connected images:")
    for img, count in sorted_images[:10]:
        print(f"  {img}: {count} connections")

    print(f"\nMatch count statistics:")
    match_counts = [m['matches'] for m in matches]
    print(f"  Min: {min(match_counts)}")
    print(f"  Max: {max(match_counts)}")
    print(f"  Avg: {sum(match_counts) / len(match_counts):.1f}")

    print(f"\nConfidence statistics:")
    confidences = [m['confidence'] for m in matches]
    print(f"  Min: {min(confidences):.3f}")
    print(f"  Max: {max(confidences):.3f}")
    print(f"  Avg: {sum(confidences) / len(confidences):.3f}")

    # Check if one image dominates
    most_connected = sorted_images[0]
    if most_connected[1] > len(matches) * 0.5:
        print(f"\n⚠️  WARNING: {most_connected[0]} appears in {most_connected[1]} matches")
        print(f"   This suggests it may be matching spuriously with many images!")

    return matches, sorted_images

def main():
    parser = argparse.ArgumentParser(description="Diagnose match quality")
    parser.add_argument("--matches_csv", default="outputs/kornia_results/filtered_matches.csv",
                       help="Path to matches CSV")
    parser.add_argument("--image_dir", default="images", help="Image directory")
    parser.add_argument("--show_top", type=int, default=5,
                       help="Show top N matches visually")
    parser.add_argument("--image1", help="Specific image to check matches for")

    args = parser.parse_args()

    matches, sorted_images = analyze_match_distribution(args.matches_csv)

    # If specific image requested
    if args.image1:
        print(f"\n🔍 Checking matches for {args.image1}:")
        relevant_matches = [m for m in matches if m['image1'] == args.image1 or m['image2'] == args.image1]
        print(f"Found {len(relevant_matches)} matches")

        for i, match in enumerate(relevant_matches[:args.show_top]):
            other_img = match['image2'] if match['image1'] == args.image1 else match['image1']
            print(f"\n{i+1}. vs {other_img}: {match['matches']} matches, conf={match['confidence']:.3f}")
            visualize_specific_match(args.image1, other_img, args.image_dir, match)
    else:
        # Show some top matches
        print(f"\n🔍 Showing top {args.show_top} matches by match count:")
        sorted_matches = sorted(matches, key=lambda x: x['matches'], reverse=True)

        for i, match in enumerate(sorted_matches[:args.show_top]):
            print(f"\n{i+1}. {match['image1']} <-> {match['image2']}")
            print(f"   {match['matches']} matches, confidence={match['confidence']:.3f}")
            visualize_specific_match(match['image1'], match['image2'], args.image_dir, match)

if __name__ == "__main__":
    main()
