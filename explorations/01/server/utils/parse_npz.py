#!/usr/bin/env python3
"""
Parse VGGT predictions.npz file and extract camera data as JSON.

predictions.npz structure:
- extrinsic: Shape [S, 3, 4] - Camera extrinsic matrices (world→camera, OpenCV convention)
- intrinsic: Shape [S, 3, 3] - Camera intrinsic matrices
- S: Number of frames/images

Usage:
    python3 parse_npz.py <path_to_predictions.npz>
"""

import sys
import json
import numpy as np
from pathlib import Path


def parse_npz(npz_path: str) -> dict:
    """
    Parse NPZ file and extract camera data.

    Args:
        npz_path: Path to predictions.npz file

    Returns:
        Dictionary with camera data
    """
    try:
        # Load NPZ file
        data = np.load(npz_path)

        # Extract arrays
        extrinsics = data['extrinsic']  # Shape: [S, 3, 4]
        intrinsics = data['intrinsic']   # Shape: [S, 3, 3]

        num_frames = extrinsics.shape[0]

        # Build camera array
        cameras = []
        for i in range(num_frames):
            camera = {
                'index': int(i),
                'extrinsic': extrinsics[i].tolist(),  # Convert to nested list
                'intrinsic': intrinsics[i].tolist(),
            }
            cameras.append(camera)

        result = {
            'numFrames': int(num_frames),
            'cameras': cameras,
        }

        return result

    except Exception as e:
        return {
            'error': str(e),
            'type': type(e).__name__
        }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({
            'error': 'Missing NPZ file path argument',
            'usage': 'python3 parse_npz.py <path_to_predictions.npz>'
        }))
        sys.exit(1)

    npz_path = sys.argv[1]

    # Check file exists
    if not Path(npz_path).exists():
        print(json.dumps({
            'error': f'File not found: {npz_path}'
        }))
        sys.exit(1)

    # Parse and output JSON
    result = parse_npz(npz_path)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
