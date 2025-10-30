import { Client, FileData } from '@gradio/client';
import { readFile, readdir } from 'fs/promises';
import { join, basename } from 'path';
import type { VGGTSettings, RunStatus, VGGTRun } from '../types';
import { storage } from './storage';

/**
 * VGGT Gradio Client Service
 *
 * Wraps @gradio/client for the facebook/vggt HuggingFace space.
 *
 * WORKFLOW:
 * 1. Upload files via client.upload_files() to get FileData handles
 * 2. Call /update_gallery_on_upload with [video, images] to organize files on server
 *    - Returns: [null, target_dir, gallery_data, message]
 * 3. Call /gradio_demo with [target_dir, ...params] to run 3D reconstruction
 *    - Returns: [glb_file, status_message, frame_filter_state]
 *
 * /gradio_demo Parameters:
 * 1. target_dir: string (directory path on server)
 * 2. conf_thres: number (confidence threshold 0-100)
 * 3. frame_filter: string (default "All")
 * 4. mask_black_bg: boolean
 * 5. mask_white_bg: boolean
 * 6. show_cam: boolean (camera visualization)
 * 7. mask_sky: boolean
 * 8. prediction_mode: "Pointmap Branch" | "Depthmap and Camera Branch"
 */

const SPACE_NAME = 'neiltron/vggt';
const UPLOAD_ENDPOINT = '/update_gallery_on_upload';
const GRADIO_DEMO_ENDPOINT = '/gradio_demo';

// Timeout for Gradio API calls (10 minutes)
const API_TIMEOUT_MS = 600_000;

export class VGGTClientError extends Error {
  constructor(
    message: string,
    public readonly code: 'UPLOAD_FAILED' | 'SUBMIT_FAILED' | 'POLLING_FAILED' | 'DOWNLOAD_FAILED' | 'INVALID_STATE'
  ) {
    super(message);
    this.name = 'VGGTClientError';
  }
}

export class VGGTClient {
  private client: Client | null = null;

  /**
   * Initialize Gradio client connection
   */
  private async getClient(): Promise<Client> {
    if (this.client) return this.client;

    try {
      const token = process.env.HF_TOKEN;
      if (!token) {
        throw new VGGTClientError(
          'HF_TOKEN environment variable not set. Private space requires authentication.',
          'SUBMIT_FAILED'
        );
      }

      // Ensure token has the 'hf_' prefix as required by ClientOptions type
      const validToken = token.startsWith('hf_') ? token : `hf_${token}`;

      console.log(`[VGGT] Connecting to ${SPACE_NAME}...`);
      this.client = await Client.connect(SPACE_NAME, {
        token: validToken as `hf_${string}`,  // Use 'token' not 'hf_token'
      });
      console.log('[VGGT] Connected successfully');
      return this.client;
    } catch (error) {
      throw new VGGTClientError(
        `Failed to connect to VGGT space: ${error}`,
        'SUBMIT_FAILED'
      );
    }
  }

  /**
   * Map internal settings to VGGT API parameters
   */
  private mapSettingsToParams(settings: VGGTSettings): {
    conf_thres: number;
    mask_black_bg: boolean;
    mask_white_bg: boolean;
    show_cam: boolean;
    mask_sky: boolean;
    prediction_mode: string;
  } {
    return {
      conf_thres: settings.confThreshold,
      mask_black_bg: settings.maskBlackBg,
      mask_white_bg: settings.maskWhiteBg,
      show_cam: settings.showCameras,
      mask_sky: settings.maskSky,
      prediction_mode: settings.predictionMode === 'pointmap'
        ? 'Pointmap Branch'
        : 'Depthmap and Camera Branch',
    };
  }

  /**
   * Upload images to HuggingFace and prepare file handles
   */
  private async prepareImageUploads(
    client: Client,
    imagePaths: string[]
  ): Promise<FileData[]> {
    console.log(`[VGGT] Preparing ${imagePaths.length} images for upload...`);

    // Get root URL from client config
    if (!client.config?.root) {
      throw new VGGTClientError(
        'Client config root URL not available',
        'UPLOAD_FAILED'
      );
    }

    const rootUrl = client.config.root;
    const fileHandles: FileData[] = [];

    for (const path of imagePaths) {
      try {
        // Read file and create proper File object with name
        const buffer = await readFile(path);
        const filename = basename(path);
        const file = new File([buffer], filename, { type: 'image/jpeg' });

        console.log(`[VGGT] Uploading file: ${filename}, size: ${file.size} bytes`);

        // upload_files(root_url, files[], upload_id?) returns { files?: string[] }
        const uploadResponse = await client.upload_files(rootUrl, [file]);

        console.log('[VGGT] Upload response:', uploadResponse);

        if (uploadResponse.error) {
          throw new Error(uploadResponse.error);
        }

        if (!uploadResponse.files || uploadResponse.files.length === 0) {
          throw new Error('No file path returned from upload');
        }

        // Create FileData object with the server path
        const fileData = new FileData({
          path: uploadResponse.files[0],
          orig_name: filename,
          size: file.size,
          mime_type: file.type,
        });

        fileHandles.push(fileData);

        console.log(`[VGGT] Uploaded: ${filename} -> ${uploadResponse.files[0]}`);
      } catch (error) {
        console.error(`[VGGT] Upload error for ${path}:`, error);
        throw new VGGTClientError(
          `Failed to upload image ${path}: ${error}`,
          'UPLOAD_FAILED'
        );
      }
    }

    console.log(`[VGGT] All uploads complete. File handles:`, fileHandles.length);
    return fileHandles;
  }

  /**
   * Submit a VGGT processing run
   *
   * @param runId - Unique run identifier
   * @param imagePaths - Array of absolute paths to images (must be sorted)
   * @param settings - VGGT processing settings
   */
  async submitRun(
    runId: string,
    imagePaths: string[],
    settings: VGGTSettings
  ): Promise<void> {
    console.log(`[VGGT] Starting submission for run ${runId}`);

    // Load current metadata
    const metadata = await storage.loadMetadata(runId);
    if (!metadata) {
      throw new VGGTClientError(`Run ${runId} not found`, 'INVALID_STATE');
    }

    try {
      // Update status to uploading
      await this.updateRunStatus(runId, 'uploading');

      // Connect to Gradio client
      const client = await this.getClient();

      // Upload images
      const fileHandles = await this.prepareImageUploads(client, imagePaths);

      // Update status to processing
      await this.updateRunStatus(runId, 'processing', {
        startedAt: new Date().toISOString(),
      });

      // Map settings to VGGT parameters
      const params = this.mapSettingsToParams(settings);

      console.log('[VGGT] Submitting to VGGT space with parameters:', {
        numImages: fileHandles.length,
        ...params,
      });

      // Step 1: Call upload handler to organize files on the server
      console.log('[VGGT] Step 1: Calling upload handler...');
      const uploadResult = await client.predict(UPLOAD_ENDPOINT, [
        null,         // input_video (we use images, not video)
        fileHandles,  // input_images (list of FileData objects)
      ]);

      console.log('[VGGT] Upload handler completed:', uploadResult);

      // Extract target directory from upload result
      // The upload handler returns: [null, target_dir, gallery_data, message]
      if (!uploadResult.data || !Array.isArray(uploadResult.data) || uploadResult.data.length < 2) {
        throw new VGGTClientError(
          'Invalid response from upload handler',
          'UPLOAD_FAILED'
        );
      }

      const targetDir = uploadResult.data[1];
      if (typeof targetDir !== 'string') {
        throw new VGGTClientError(
          'Target directory not returned by upload handler',
          'UPLOAD_FAILED'
        );
      }

      console.log(`[VGGT] Target directory created: ${targetDir}`);

      // Step 2: Submit to VGGT processing with target directory
      console.log('[VGGT] Step 2: Starting 3D reconstruction...');
      const result = await client.predict(GRADIO_DEMO_ENDPOINT, [
        targetDir,                  // target_dir (string)
        params.conf_thres,          // conf_thres (number)
        'All',                      // frame_filter (string - default "All")
        params.mask_black_bg,       // mask_black_bg (boolean)
        params.mask_white_bg,       // mask_white_bg (boolean)
        params.show_cam,            // show_cam (boolean)
        params.mask_sky,            // mask_sky (boolean)
        params.prediction_mode,     // prediction_mode (string)
      ]);

      console.log('[VGGT] 3D reconstruction completed:', result);

      // Update status to fetching
      await this.updateRunStatus(runId, 'fetching');

      // Extract results
      await this.processResults(runId, result.data);

      // Update status to completed
      await this.updateRunStatus(runId, 'completed', {
        finishedAt: new Date().toISOString(),
      });

      console.log(`[VGGT] Run ${runId} completed successfully`);
    } catch (error) {
      console.error(`[VGGT] Run ${runId} failed:`, error);

      await this.updateRunStatus(runId, 'failed', {
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  /**
   * Process results from VGGT space
   *
   * VGGT returns: [glbPath, targetDir, predictionsPath]
   */
  private async processResults(runId: string, resultData: any): Promise<void> {
    console.log('[VGGT] Processing results:', resultData);

    // VGGT returns: [glbPath, targetDir, predictionsPath]
    if (!Array.isArray(resultData) || resultData.length < 1) {
      console.warn('[VGGT] No results returned from VGGT');
      return;
    }

    // Download GLB (index 0)
    if (resultData[0]) {
      try {
        console.log('[VGGT] Downloading GLB from:', resultData[0]);

        // Handle both FileData objects with URL and plain path strings
        let glbUrl: string;
        if (typeof resultData[0] === 'object' && 'url' in resultData[0]) {
          glbUrl = resultData[0].url;
        } else if (typeof resultData[0] === 'string') {
          const client = await this.getClient();
          const rootUrl = client.config?.root;
          if (!rootUrl) {
            throw new Error('Client root URL not available');
          }
          glbUrl = `${rootUrl}/file=${resultData[0]}`;
        } else {
          throw new Error('Invalid GLB data format');
        }

        const glbBuffer = await this.downloadFile(glbUrl);
        await storage.saveArtifact(runId, 'glb', glbBuffer);
        console.log(`[VGGT] GLB saved: ${glbBuffer.length} bytes`);
      } catch (error) {
        console.error('[VGGT] Failed to download GLB:', error);
        throw new VGGTClientError(
          `Failed to download GLB: ${error}`,
          'DOWNLOAD_FAILED'
        );
      }
    }

    // Download predictions.npz (index 2)
    if (resultData[2]) {
      try {
        console.log('[VGGT] Downloading predictions.npz from:', resultData[2]);

        // Handle both FileData objects with URL and plain path strings
        let npzUrl: string;
        if (typeof resultData[2] === 'object' && 'url' in resultData[2]) {
          npzUrl = resultData[2].url;
        } else if (typeof resultData[2] === 'string') {
          const client = await this.getClient();
          const rootUrl = client.config?.root;
          if (!rootUrl) {
            throw new Error('Client root URL not available');
          }
          npzUrl = `${rootUrl}/file=${resultData[2]}`;
        } else {
          throw new Error('Invalid predictions data format');
        }

        const npzBuffer = await this.downloadFile(npzUrl);
        await storage.saveArtifact(runId, 'predictions', npzBuffer);
        console.log(`[VGGT] Predictions saved: ${npzBuffer.length} bytes`);
      } catch (error) {
        console.warn('[VGGT] Failed to download predictions.npz:', error);
        // Don't fail the run if predictions aren't available
      }
    } else {
      console.log('[VGGT] No predictions.npz path in results');
    }
  }

  /**
   * Download a file from a URL
   */
  private async downloadFile(url: string): Promise<Buffer> {
    try {
      const hfToken = process.env.HF_TOKEN;
      const headers: Record<string, string> = {};

      // Add authorization for private spaces
      if (hfToken) {
        headers.Authorization = `Bearer ${hfToken}`;
      }

      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      throw new VGGTClientError(
        `Failed to download file from ${url}: ${error}`,
        'DOWNLOAD_FAILED'
      );
    }
  }

  /**
   * Poll run status
   *
   * @param runId - Run identifier
   * @returns Current run status
   */
  async pollRunStatus(runId: string): Promise<RunStatus> {
    const metadata = await storage.loadMetadata(runId);
    if (!metadata) {
      throw new VGGTClientError(`Run ${runId} not found`, 'INVALID_STATE');
    }
    return metadata.status;
  }

  /**
   * Download artifacts for a completed run
   *
   * @param runId - Run identifier
   * @returns GLB and predictions buffers
   */
  async downloadArtifacts(runId: string): Promise<{
    glb?: Buffer;
    predictions?: Buffer;
  }> {
    const metadata = await storage.loadMetadata(runId);
    if (!metadata) {
      throw new VGGTClientError(`Run ${runId} not found`, 'INVALID_STATE');
    }

    if (metadata.status !== 'completed') {
      throw new VGGTClientError(
        `Run ${runId} is not completed (status: ${metadata.status})`,
        'INVALID_STATE'
      );
    }

    const paths = storage.getRunPaths(runId);
    const artifacts: { glb?: Buffer; predictions?: Buffer } = {};

    // Read GLB if exists
    if (storage.artifactExists(runId, 'glb')) {
      artifacts.glb = await readFile(paths.glbPath);
    }

    // Read predictions if exists
    if (storage.artifactExists(runId, 'predictions')) {
      artifacts.predictions = await readFile(paths.predictionsPath);
    }

    return artifacts;
  }

  /**
   * Update run status and metadata
   */
  private async updateRunStatus(
    runId: string,
    status: RunStatus,
    updates: Partial<VGGTRun> = {}
  ): Promise<void> {
    const metadata = await storage.loadMetadata(runId);
    if (!metadata) {
      throw new VGGTClientError(`Run ${runId} not found`, 'INVALID_STATE');
    }

    metadata.status = status;
    Object.assign(metadata, updates);

    await storage.saveMetadata(runId, metadata);
    console.log(`[VGGT] Run ${runId} status updated to: ${status}`);
  }

  /**
   * Get list of image paths for a run (sorted)
   */
  async getRunImagePaths(runId: string): Promise<string[]> {
    const { imagesDir } = storage.getRunPaths(runId);
    const files = await readdir(imagesDir);

    // Filter image files and sort
    const imageFiles = files
      .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
      .sort();

    return imageFiles.map(f => join(imagesDir, f));
  }

  /**
   * Disconnect from Gradio client
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      console.log('[VGGT] Disconnecting from space...');
      this.client = null;
    }
  }
}

// Singleton instance
export const vggtClient = new VGGTClient();
