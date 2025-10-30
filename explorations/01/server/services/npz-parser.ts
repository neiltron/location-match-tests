/**
 * NPZ Parser Service
 *
 * Pure TypeScript implementation to parse VGGT predictions.npz files
 * No Python dependencies required!
 */

import { unzipSync } from 'fflate';
import { readFile } from 'fs/promises';

/**
 * VGGT predictions.npz structure
 * Based on VGGT documentation and actual output format
 */
export interface VGGTPredictions {
  /** Camera extrinsic matrices (world→camera, OpenCV convention): S x 3 x 4 */
  extrinsic: number[][][];

  /** Camera intrinsic matrices: S x 3 x 3 */
  intrinsic: number[][][];

  /** Depth maps (optional): S x H x W */
  depth?: number[][][];

  /** Depth confidence maps (optional): S x H x W */
  depth_conf?: number[][][];

  /** World point cloud (pointmap branch): S x H x W x 3 */
  world_points?: number[][][][];

  /** Point cloud confidence: S x H x W */
  world_points_conf?: number[][][];

  /** Original images tensor (optional): S x H x W x C */
  images?: number[][][][];

  /** Pose encoding (optional): S x D */
  pose_enc?: number[][];

  /** Tracking data (optional) */
  track?: number[][][];
  vis?: number[][][];
  conf?: number[][][];
}

/**
 * Parsed NumPy array metadata and data
 */
export interface NPYArray {
  dtype: string;
  shape: number[];
  data: Float32Array | Float64Array | Int32Array | Uint8Array;
  fortranOrder: boolean;
}

/**
 * Camera data for API consumption
 */
export interface CameraData {
  index: number;
  extrinsic: number[][];  // 3×4 matrix (world→camera, OpenCV)
  intrinsic: number[][];  // 3×3 matrix (camera intrinsics)
  position?: [number, number, number];
  threeMatrix?: number[]; // 4x4 in column-major for Three.js
}

/**
 * Parsed camera data with metadata
 */
export interface ParsedCameras {
  numFrames: number;
  cameras: CameraData[];
  hasDepth: boolean;
  hasWorldPoints: boolean;
  imageShape?: number[];
  depthShape?: number[];
  worldPointsShape?: number[];
}

export class NPZParserError extends Error {
  constructor(
    message: string,
    public readonly code: 'FILE_NOT_FOUND' | 'PARSE_FAILED' | 'INVALID_FORMAT'
  ) {
    super(message);
    this.name = 'NPZParserError';
  }
}

/**
 * NumPy .npy file format parser
 * Supports magic bytes 0x93 'NUMPY' v1.0, v2.0, and v3.0
 */
export class NPZParser {
  /**
   * Parse a complete .npz file from path
   */
  async parseFile(filePath: string): Promise<VGGTPredictions> {
    try {
      const buffer = await readFile(filePath);
      return this.parse(buffer);
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        throw new NPZParserError(`File not found: ${filePath}`, 'FILE_NOT_FOUND');
      }
      throw new NPZParserError(
        `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
        'PARSE_FAILED'
      );
    }
  }

  /**
   * Parse a complete .npz file (ZIP archive of .npy files) from buffer
   */
  parse(buffer: Buffer): VGGTPredictions {
    try {
      // Decompress ZIP archive
      const uint8Buffer = new Uint8Array(buffer);
      const unzipped = unzipSync(uint8Buffer);

      const predictions: Partial<VGGTPredictions> = {};

      // Parse each .npy file in the archive
      for (const [filename, data] of Object.entries(unzipped)) {
        if (!filename.endsWith('.npy')) continue;

        const arrayName = filename.replace('.npy', '');
        const npyArray = this.parseNPY(Buffer.from(data));

        // Convert flat array to multi-dimensional structure
        const shaped = this.reshapeArray(npyArray.data, npyArray.shape);

        // Map to predictions structure
        predictions[arrayName as keyof VGGTPredictions] = shaped as any;
      }

      // Validate required fields
      if (!predictions.extrinsic || !predictions.intrinsic) {
        throw new NPZParserError(
          'Missing required camera matrices: extrinsic and intrinsic',
          'INVALID_FORMAT'
        );
      }

      return predictions as VGGTPredictions;
    } catch (error) {
      if (error instanceof NPZParserError) throw error;
      throw new NPZParserError(
        `Failed to parse NPZ: ${error instanceof Error ? error.message : String(error)}`,
        'PARSE_FAILED'
      );
    }
  }

  /**
   * Parse predictions and extract camera data for API
   */
  async parsePredictions(npzPath: string): Promise<ParsedCameras> {
    const predictions = await this.parseFile(npzPath);

    const cameras: CameraData[] = predictions.extrinsic.map((ext, i) => {
      const camera: CameraData = {
        index: i,
        extrinsic: ext,
        intrinsic: predictions.intrinsic[i],
      };

      // Compute Three.js transform
      try {
        const transform = CameraTransform.extrinsicToThreeJS(ext, { alignY180: true });
        camera.position = transform.position;
        camera.threeMatrix = transform.matrix;
      } catch (error) {
        console.warn(`Failed to compute Three.js transform for camera ${i}:`, error);
      }

      return camera;
    });

    const summary = NPZParser.getSummary(predictions);

    return {
      numFrames: cameras.length,
      cameras,
      ...summary,
    };
  }

  /**
   * Parse a single .npy file
   * Format: Magic (6) + Version (2) + Header Len (2/4) + Header (dict) + Data
   */
  parseNPY(buffer: Buffer): NPYArray {
    let offset = 0;

    // Check magic bytes: 0x93 'NUMPY'
    const magic = buffer.subarray(0, 6);
    if (magic[0] !== 0x93 || magic.toString('ascii', 1, 6) !== 'NUMPY') {
      throw new NPZParserError('Invalid NPY magic bytes', 'INVALID_FORMAT');
    }
    offset += 6;

    // Version (major, minor)
    const major = buffer[offset++];
    const minor = buffer[offset++];

    if (major > 3) {
      throw new NPZParserError(`Unsupported NPY version: ${major}.${minor}`, 'INVALID_FORMAT');
    }

    // Header length (little-endian)
    let headerLen: number;
    if (major === 1) {
      headerLen = buffer.readUInt16LE(offset);
      offset += 2;
    } else {
      headerLen = buffer.readUInt32LE(offset);
      offset += 4;
    }

    // Parse header (Python dict literal as string)
    const headerBytes = buffer.subarray(offset, offset + headerLen);
    const headerStr = headerBytes.toString('ascii').trim();
    offset += headerLen;

    const header = this.parseNPYHeader(headerStr);

    // Read data
    const dataBuffer = buffer.subarray(offset);
    const data = this.readNPYData(dataBuffer, header.dtype, header.shape);

    return {
      dtype: header.dtype,
      shape: header.shape,
      data,
      fortranOrder: header.fortran_order,
    };
  }

  /**
   * Parse NPY header (Python dict literal)
   * Example: "{'descr': '<f4', 'fortran_order': False, 'shape': (10, 3, 4)}"
   */
  private parseNPYHeader(headerStr: string): {
    dtype: string;
    fortran_order: boolean;
    shape: number[];
  } {
    // Extract descr (dtype)
    const descrMatch = headerStr.match(/'descr':\s*'([^']+)'/);
    if (!descrMatch) {
      throw new NPZParserError('NPY header missing descr field', 'INVALID_FORMAT');
    }
    const dtype = descrMatch[1];

    // Extract fortran_order
    const fortranMatch = headerStr.match(/'fortran_order':\s*(True|False)/);
    const fortran_order = fortranMatch ? fortranMatch[1] === 'True' : false;

    // Extract shape
    const shapeMatch = headerStr.match(/'shape':\s*\(([^)]*)\)/);
    if (!shapeMatch) {
      throw new NPZParserError('NPY header missing shape field', 'INVALID_FORMAT');
    }

    const shapeStr = shapeMatch[1].trim();
    const shape = shapeStr
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(s => parseInt(s, 10));

    return { dtype, fortran_order, shape };
  }

  /**
   * Read NPY data based on dtype
   */
  private readNPYData(
    buffer: Buffer,
    dtype: string,
    shape: number[]
  ): Float32Array | Float64Array | Int32Array | Uint8Array {
    // Calculate total elements
    const totalElements = shape.reduce((acc, dim) => acc * dim, 1);

    // Parse dtype: '<f4' = little-endian float32, '<f8' = float64, etc.
    const endian = dtype[0]; // '<' = little, '>' = big, '|' = not applicable
    const typeChar = dtype[1]; // 'f' = float, 'i' = int, 'u' = uint
    const bytes = parseInt(dtype.slice(2), 10);

    if (endian === '>' && bytes > 1) {
      throw new NPZParserError('Big-endian format not yet supported', 'INVALID_FORMAT');
    }

    // Map dtype to TypedArray
    if (typeChar === 'f') {
      if (bytes === 4) {
        return new Float32Array(buffer.buffer, buffer.byteOffset, totalElements);
      } else if (bytes === 8) {
        return new Float64Array(buffer.buffer, buffer.byteOffset, totalElements);
      }
    } else if (typeChar === 'i') {
      if (bytes === 4) {
        return new Int32Array(buffer.buffer, buffer.byteOffset, totalElements);
      }
    } else if (typeChar === 'u') {
      if (bytes === 1) {
        return new Uint8Array(buffer.buffer, buffer.byteOffset, totalElements);
      }
    }

    throw new NPZParserError(`Unsupported dtype: ${dtype}`, 'INVALID_FORMAT');
  }

  /**
   * Reshape flat array into multi-dimensional structure
   */
  private reshapeArray(
    data: Float32Array | Float64Array | Int32Array | Uint8Array,
    shape: number[]
  ): any {
    if (shape.length === 0) {
      return data[0];
    }

    if (shape.length === 1) {
      return Array.from(data);
    }

    // Recursively build nested arrays
    const size = shape[0];
    const innerSize = data.length / size;
    const result: any[] = [];

    for (let i = 0; i < size; i++) {
      const start = i * innerSize;
      const end = start + innerSize;
      const slice = data.slice(start, end);

      if (shape.length === 2) {
        result.push(Array.from(slice));
      } else {
        result.push(this.reshapeArray(slice, shape.slice(1)));
      }
    }

    return result;
  }

  /**
   * Get summary statistics for predictions
   */
  static getSummary(predictions: VGGTPredictions): {
    hasDepth: boolean;
    hasWorldPoints: boolean;
    imageShape?: number[];
    depthShape?: number[];
    worldPointsShape?: number[];
  } {
    return {
      hasDepth: !!predictions.depth,
      hasWorldPoints: !!predictions.world_points,
      imageShape: predictions.images ? this.getArrayShape(predictions.images) : undefined,
      depthShape: predictions.depth ? this.getArrayShape(predictions.depth) : undefined,
      worldPointsShape: predictions.world_points ? this.getArrayShape(predictions.world_points) : undefined,
    };
  }

  /**
   * Get shape of a multi-dimensional array
   */
  private static getArrayShape(arr: any): number[] {
    const shape: number[] = [];
    let current = arr;

    while (Array.isArray(current)) {
      shape.push(current.length);
      current = current[0];
    }

    return shape;
  }

  /**
   * Check if a file is a valid NPZ file
   *
   * @param filePath - Path to file
   * @returns True if file appears to be NPZ format
   */
  async isValidNPZ(filePath: string): Promise<boolean> {
    try {
      // NPZ files are ZIP archives, check magic bytes
      const buffer = await readFile(filePath);

      // Check for ZIP magic bytes (PK)
      if (buffer.length < 4) return false;
      return buffer[0] === 0x50 && buffer[1] === 0x4B;
    } catch {
      return false;
    }
  }
}

/**
 * Camera transform utilities for Three.js conversion
 */
export class CameraTransform {
  /**
   * Convert VGGT extrinsic matrix (OpenCV world→camera) to Three.js matrix
   *
   * Steps:
   * 1. Extrinsic is 3x4 world→camera (OpenCV)
   * 2. Augment to 4x4 and invert to get camera→world
   * 3. Apply OpenGL conversion (flip Y and Z)
   * 4. Optional: Rotate 180° around Y for alignment
   */
  static extrinsicToThreeJS(
    extrinsic: number[][],
    options: { alignY180?: boolean } = {}
  ): {
    position: [number, number, number];
    matrix: number[]; // 4x4 in column-major order for Three.js
  } {
    // Augment 3x4 to 4x4
    const worldToCam = [
      [...extrinsic[0], 0],
      [...extrinsic[1], 0],
      [...extrinsic[2], 0],
      [0, 0, 0, 1],
    ];

    // Invert to get camera→world
    const camToWorld = this.invert4x4(worldToCam);

    // OpenGL conversion: flip Y and Z
    const openglFix = [
      [1, 0, 0, 0],
      [0, -1, 0, 0],
      [0, 0, -1, 0],
      [0, 0, 0, 1],
    ];

    let threeMatrix = this.multiply4x4(camToWorld, openglFix);

    // Optional Y-180 alignment
    if (options.alignY180) {
      const alignY180 = [
        [-1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, -1, 0],
        [0, 0, 0, 1],
      ];
      threeMatrix = this.multiply4x4(threeMatrix, alignY180);
    }

    // Extract position
    const position: [number, number, number] = [
      threeMatrix[0][3],
      threeMatrix[1][3],
      threeMatrix[2][3],
    ];

    // Convert to column-major for Three.js
    const matrix = this.toColumnMajor(threeMatrix);

    return { position, matrix };
  }

  /**
   * Invert a 4x4 matrix using adjugate method
   */
  private static invert4x4(m: number[][]): number[][] {
    const inv = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];

    inv[0][0] = m[1][1] * m[2][2] * m[3][3] - m[1][1] * m[2][3] * m[3][2] - m[2][1] * m[1][2] * m[3][3] + m[2][1] * m[1][3] * m[3][2] + m[3][1] * m[1][2] * m[2][3] - m[3][1] * m[1][3] * m[2][2];
    inv[1][0] = -m[1][0] * m[2][2] * m[3][3] + m[1][0] * m[2][3] * m[3][2] + m[2][0] * m[1][2] * m[3][3] - m[2][0] * m[1][3] * m[3][2] - m[3][0] * m[1][2] * m[2][3] + m[3][0] * m[1][3] * m[2][2];
    inv[2][0] = m[1][0] * m[2][1] * m[3][3] - m[1][0] * m[2][3] * m[3][1] - m[2][0] * m[1][1] * m[3][3] + m[2][0] * m[1][3] * m[3][1] + m[3][0] * m[1][1] * m[2][3] - m[3][0] * m[1][3] * m[2][1];
    inv[3][0] = -m[1][0] * m[2][1] * m[3][2] + m[1][0] * m[2][2] * m[3][1] + m[2][0] * m[1][1] * m[3][2] - m[2][0] * m[1][2] * m[3][1] - m[3][0] * m[1][1] * m[2][2] + m[3][0] * m[1][2] * m[2][1];

    inv[0][1] = -m[0][1] * m[2][2] * m[3][3] + m[0][1] * m[2][3] * m[3][2] + m[2][1] * m[0][2] * m[3][3] - m[2][1] * m[0][3] * m[3][2] - m[3][1] * m[0][2] * m[2][3] + m[3][1] * m[0][3] * m[2][2];
    inv[1][1] = m[0][0] * m[2][2] * m[3][3] - m[0][0] * m[2][3] * m[3][2] - m[2][0] * m[0][2] * m[3][3] + m[2][0] * m[0][3] * m[3][2] + m[3][0] * m[0][2] * m[2][3] - m[3][0] * m[0][3] * m[2][2];
    inv[2][1] = -m[0][0] * m[2][1] * m[3][3] + m[0][0] * m[2][3] * m[3][1] + m[2][0] * m[0][1] * m[3][3] - m[2][0] * m[0][3] * m[3][1] - m[3][0] * m[0][1] * m[2][3] + m[3][0] * m[0][3] * m[2][1];
    inv[3][1] = m[0][0] * m[2][1] * m[3][2] - m[0][0] * m[2][2] * m[3][1] - m[2][0] * m[0][1] * m[3][2] + m[2][0] * m[0][2] * m[3][1] + m[3][0] * m[0][1] * m[2][2] - m[3][0] * m[0][2] * m[2][1];

    inv[0][2] = m[0][1] * m[1][2] * m[3][3] - m[0][1] * m[1][3] * m[3][2] - m[1][1] * m[0][2] * m[3][3] + m[1][1] * m[0][3] * m[3][2] + m[3][1] * m[0][2] * m[1][3] - m[3][1] * m[0][3] * m[1][2];
    inv[1][2] = -m[0][0] * m[1][2] * m[3][3] + m[0][0] * m[1][3] * m[3][2] + m[1][0] * m[0][2] * m[3][3] - m[1][0] * m[0][3] * m[3][2] - m[3][0] * m[0][2] * m[1][3] + m[3][0] * m[0][3] * m[1][2];
    inv[2][2] = m[0][0] * m[1][1] * m[3][3] - m[0][0] * m[1][3] * m[3][1] - m[1][0] * m[0][1] * m[3][3] + m[1][0] * m[0][3] * m[3][1] + m[3][0] * m[0][1] * m[1][3] - m[3][0] * m[0][3] * m[1][1];
    inv[3][2] = -m[0][0] * m[1][1] * m[3][2] + m[0][0] * m[1][2] * m[3][1] + m[1][0] * m[0][1] * m[3][2] - m[1][0] * m[0][2] * m[3][1] - m[3][0] * m[0][1] * m[1][2] + m[3][0] * m[0][2] * m[1][1];

    inv[0][3] = -m[0][1] * m[1][2] * m[2][3] + m[0][1] * m[1][3] * m[2][2] + m[1][1] * m[0][2] * m[2][3] - m[1][1] * m[0][3] * m[2][2] - m[2][1] * m[0][2] * m[1][3] + m[2][1] * m[0][3] * m[1][2];
    inv[1][3] = m[0][0] * m[1][2] * m[2][3] - m[0][0] * m[1][3] * m[2][2] - m[1][0] * m[0][2] * m[2][3] + m[1][0] * m[0][3] * m[2][2] + m[2][0] * m[0][2] * m[1][3] - m[2][0] * m[0][3] * m[1][2];
    inv[2][3] = -m[0][0] * m[1][1] * m[2][3] + m[0][0] * m[1][3] * m[2][1] + m[1][0] * m[0][1] * m[2][3] - m[1][0] * m[0][3] * m[2][1] - m[2][0] * m[0][1] * m[1][3] + m[2][0] * m[0][3] * m[1][1];
    inv[3][3] = m[0][0] * m[1][1] * m[2][2] - m[0][0] * m[1][2] * m[2][1] - m[1][0] * m[0][1] * m[2][2] + m[1][0] * m[0][2] * m[2][1] + m[2][0] * m[0][1] * m[1][2] - m[2][0] * m[0][2] * m[1][1];

    const det = m[0][0] * inv[0][0] + m[0][1] * inv[1][0] + m[0][2] * inv[2][0] + m[0][3] * inv[3][0];

    if (Math.abs(det) < 1e-10) {
      throw new Error('Matrix is singular and cannot be inverted');
    }

    const invDet = 1.0 / det;

    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        inv[i][j] *= invDet;
      }
    }

    return inv;
  }

  /**
   * Multiply two 4x4 matrices
   */
  private static multiply4x4(a: number[][], b: number[][]): number[][] {
    const result = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];

    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        for (let k = 0; k < 4; k++) {
          result[i][j] += a[i][k] * b[k][j];
        }
      }
    }

    return result;
  }

  /**
   * Convert row-major 4x4 to column-major for Three.js
   */
  private static toColumnMajor(m: number[][]): number[] {
    return [
      m[0][0], m[1][0], m[2][0], m[3][0],
      m[0][1], m[1][1], m[2][1], m[3][1],
      m[0][2], m[1][2], m[2][2], m[3][2],
      m[0][3], m[1][3], m[2][3], m[3][3],
    ];
  }
}

// Singleton instance
export const npzParser = new NPZParser();
