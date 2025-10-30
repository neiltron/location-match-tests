/**
 * Main Application
 * Coordinates all components and handles API communication
 */

import { ImageUploader } from './components/ImageUploader.js';
import { VGGTSettings } from './components/VGGTSettings.js';
import { RunHistory, type VGGTRun } from './components/RunHistory.js';
import { SceneViewer, CameraTransform } from './viewer/SceneViewer.js';
import { CameraTransforms } from './viewer/CameraTransforms.js';

class VGGTApp {
  private imageUploader: ImageUploader;
  private settings: VGGTSettings;
  private runHistory: RunHistory;
  private viewer: SceneViewer | null = null;
  private statusBar: {
    indicator: HTMLElement;
    text: HTMLElement;
  };
  private rerunBtn: HTMLButtonElement | null;
  private currentRunId: string | null = null;
  private cameraTransforms: CameraTransform[] = [];
  private statusPollInterval: number | null = null;
  private selectedRun: VGGTRun | null = null;

  constructor() {
    // Initialize components
    this.imageUploader = new ImageUploader(
      'uploadZone',
      'fileInput',
      'thumbnailGrid',
      'imageCounter'
    );

    this.settings = new VGGTSettings('settingsForm', 'submitBtn');

    this.runHistory = new RunHistory('runHistory', 'refreshHistoryBtn');

    this.rerunBtn = document.getElementById('rerunBtn') as HTMLButtonElement | null;
    if (this.rerunBtn) {
      this.rerunBtn.disabled = true;
    }

    // Status bar elements
    this.statusBar = {
      indicator: document.getElementById('statusIndicator')!,
      text: document.getElementById('statusText')!,
    };

    this.initializeEventHandlers();
    this.loadInitialData();
    this.initializeViewer();
  }

  private initializeEventHandlers(): void {
    // Image uploader change handler
    this.imageUploader.setOnImagesChange((images) => {
      const hasImages = images.length > 0;
      this.settings.setSubmitEnabled(hasImages);

      if (hasImages) {
        this.setStatus('ready', `${images.length} image${images.length !== 1 ? 's' : ''} ready`);

        // Update image indices for camera mapping
        const indices = new Map<string, number>();
        images.forEach((img, index) => {
          indices.set(img.id, index);
        });
        this.imageUploader.updateImageIndices(indices);
      } else {
        this.setStatus('idle', 'Ready');
      }
    });

    // Thumbnail hover handler for camera animation
    this.imageUploader.setOnThumbnailHover((index, event) => {
      if (!this.viewer || this.cameraTransforms.length === 0) {
        return;
      }

      if (event === 'enter' && index < this.cameraTransforms.length) {
        // Animate to the camera position for this image
        this.viewer.animateToCamera(this.cameraTransforms[index], 0.8);
      } else if (event === 'leave') {
        // Return to default view after a short delay
        setTimeout(() => {
          if (this.viewer && !this.viewer.getAnimator().isUserActive()) {
            this.viewer.resetCamera();
          }
        }, 300);
      }
    });

    // Settings change handler
    this.settings.setOnSettingsChange((settingsData) => {
      console.log('Settings updated:', settingsData);

      // Update camera frustum visibility if viewer exists
      if (this.viewer && settingsData.showCameras !== undefined) {
        this.viewer.setCameraFrustums(this.cameraTransforms, settingsData.showCameras);
      }
    });

    // Settings submit handler
    this.settings.setOnSubmit(async (settingsData) => {
      await this.handleSubmit(settingsData);
    });

    // Run history select handler
    this.runHistory.setOnRunSelect((run) => {
      if (run) {
        this.loadRun(run);
      } else {
        this.clearSelectedRun();
      }
    });

    if (this.rerunBtn) {
      this.rerunBtn.addEventListener('click', async () => {
        await this.handleRerun();
      });
    }

    // Reset view button
    const resetViewBtn = document.getElementById('resetViewBtn');
    if (resetViewBtn) {
      resetViewBtn.addEventListener('click', () => {
        if (this.viewer) {
          this.viewer.resetCamera();
        }
      });
    }
  }

  private async loadInitialData(): Promise<void> {
    this.setStatus('loading', 'Loading runs...');

    try {
      await this.runHistory.load();
      this.setStatus('idle', 'Ready');
    } catch (error) {
      console.error('Failed to load initial data:', error);
      this.setStatus('error', 'Failed to load runs');
    }
  }

  private async handleSubmit(settingsData: any): Promise<void> {
    const images = this.imageUploader.getImages();

    if (images.length === 0) {
      alert('Please upload at least one image');
      return;
    }

    try {
      this.setStatus('processing', 'Creating run...');
      this.settings.setSubmitLoading(true);

      // Step 1: Create run
      const runId = await this.createRun(settingsData);
      this.currentRunId = runId;
      console.log('[VGGT] Run created:', runId);

      // Step 2: Upload images
      this.setStatus('processing', 'Uploading images...');
      await this.uploadImages(runId);
      console.log('[VGGT] Images uploaded');

      // Step 2.5: Start VGGT processing
      this.setStatus('processing', 'Starting VGGT processing...');
      await this.startProcessing(runId);
      console.log('[VGGT] Processing started');

      // Step 3: Show run details panel
      this.showRunDetailsPanel(runId, images.length, settingsData);

      // Step 4: Start polling for status updates
      this.startStatusPolling(runId);

      // Refresh history to show new run
      await this.runHistory.refresh();

      // Don't clear the form yet - keep images visible with processing overlay
      this.showProcessingOverlay();
      this.settings.setSubmitLoading(false);

    } catch (error) {
      console.error('[VGGT] Submit failed:', error);
      this.setStatus('error', `Failed: ${error}`);
      this.settings.setSubmitLoading(false);

      setTimeout(() => {
        this.setStatus('idle', 'Ready');
      }, 5000);
    }
  }

  private async createRun(settingsData: any): Promise<string> {
    const response = await fetch('/api/runs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        settings: settingsData,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create run');
    }

    const data = await response.json();
    return data.runId;
  }

  private async uploadImages(runId: string): Promise<void> {
    const formData = await this.imageUploader.getFormData();

    const response = await fetch(`/api/runs/${runId}/images`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to upload images');
    }

    const data = await response.json();
    console.log('Images uploaded:', data);
  }

  private async startProcessing(runId: string): Promise<void> {
    const response = await fetch(`/api/runs/${runId}/process`, {
      method: 'POST',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to start processing');
    }

    const data = await response.json();
    console.log('[VGGT] Processing response:', data);
  }

  private clearSelectedRun(): void {
    this.selectedRun = null;
    if (this.rerunBtn) {
      this.rerunBtn.disabled = true;
      this.rerunBtn.innerHTML = '<span>Re-run Selected Run</span>';
    }
  }

  private async loadRun(run: VGGTRun): Promise<void> {
    console.log('Loading run:', run);
    this.currentRunId = run.runId;
    this.selectedRun = run;

    if (this.rerunBtn) {
      this.rerunBtn.disabled = run.images.length === 0;
      this.rerunBtn.innerHTML = '<span>Re-run Selected Run</span>';
    }

    // Update status
    this.setStatus('info', `Loading run ${run.runId.substring(0, 8)}...`);

    // Load settings
    this.settings.setSettings(run.settings);

    // If completed and has artifacts, load them
    if (run.status === 'completed' && run.artifacts?.glb) {
      // Load GLB model
      await this.loadGLBModel(run.artifacts.glb);

      // Load camera data
      await this.loadRunCameras(run.runId);

      // Update thumbnail-camera mapping
      this.updateThumbnailCameraMapping();
    }

    setTimeout(() => {
      this.setStatus('idle', 'Ready');
    }, 2000);
  }

  private async handleRerun(): Promise<void> {
    if (!this.selectedRun || !this.rerunBtn) {
      return;
    }

    const run = this.selectedRun;
    const originalLabel = this.rerunBtn.innerHTML;

    try {
      this.rerunBtn.disabled = true;
      this.rerunBtn.innerHTML = '<span>Re-running...</span>';

      this.setStatus('processing', 'Starting re-run with current settings...');

      const settingsData = this.settings.getSettings();

      const response = await fetch(`/api/runs/${run.runId}/rerun`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ settings: settingsData }),
      });

      let data: any = null;
      try {
        data = await response.json();
      } catch (parseError) {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
      }

      if (!response.ok) {
        const message = data?.error || `HTTP ${response.status}`;
        throw new Error(message);
      }

      const newRunId = data?.runId as string | undefined;
      if (!newRunId) {
        throw new Error('Server did not return a new run ID');
      }

      const imageCount = typeof data?.images === 'number' ? data.images : run.images.length;

      this.currentRunId = newRunId;

      this.showRunDetailsPanel(newRunId, imageCount, settingsData);
      this.showProcessingOverlay();

      this.startStatusPolling(newRunId);

      await this.runHistory.refresh();

      this.setStatus('processing', 'Re-run started. VGGT is processing...');
    } catch (error) {
      console.error('[VGGT] Re-run failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus('error', `Re-run failed: ${message}`);
    } finally {
      if (this.rerunBtn) {
        this.rerunBtn.innerHTML = originalLabel;
        const hasImages = (this.selectedRun?.images.length ?? 0) > 0;
        this.rerunBtn.disabled = !hasImages;
      }
    }
  }

  private async loadRunCameras(runId: string): Promise<void> {
    try {
      this.setStatus('info', 'Loading camera data...');

      const response = await fetch(`/api/runs/${runId}/cameras`);

      if (!response.ok) {
        // Handle missing predictions file gracefully
        if (response.status === 404) {
          console.warn('No camera data available for this run');
          this.cameraTransforms = [];
          return;
        }
        throw new Error(`Failed to load cameras: ${response.statusText}`);
      }

      const data = await response.json();

      // Check for error in response
      if (data.error) {
        throw new Error(data.error);
      }

      console.log(`Loaded ${data.numFrames} cameras from VGGT`);

      // Convert camera data to viewer format
      this.cameraTransforms = data.cameras.map((cam: any) => {
        // Use CameraTransforms utility to convert OpenCV to Three.js
        const matrix = CameraTransforms.extrinsicToThreeMatrix(cam.extrinsic);
        const { position, quaternion } = CameraTransforms.getPositionAndRotation(matrix);

        return {
          position: position.toArray() as [number, number, number],
          rotation: quaternion.toArray() as [number, number, number, number],
          lookAt: [0, 0, 0] as [number, number, number], // Default to origin
        };
      });

      // Update viewer with camera frustums
      if (this.viewer) {
        const showCameras = this.settings.getSettings().showCameras;
        this.viewer.setCameraFrustums(this.cameraTransforms, showCameras);
      }

      this.setStatus('success', `Loaded ${data.numFrames} cameras`);
    } catch (error) {
      console.error('Failed to load camera data:', error);
      this.setStatus('error', `Failed to load cameras: ${error}`);
      this.cameraTransforms = [];
    }
  }

  private updateThumbnailCameraMapping(): void {
    // Images are uploaded in sorted order, VGGT preserves this order
    // So image[i] corresponds to camera[i]
    const images = this.imageUploader.getImages();
    const indices = new Map<string, number>();

    images.forEach((img, index) => {
      indices.set(img.id, index);
    });

    this.imageUploader.updateImageIndices(indices);
  }

  private initializeViewer(): void {
    try {
      this.viewer = new SceneViewer('viewerContainer');
      console.log('3D Viewer initialized');

      // Don't load mock data anymore - will load from run artifacts
    } catch (error) {
      console.error('Failed to initialize viewer:', error);
      this.setStatus('error', 'Failed to initialize 3D viewer');
    }
  }


  private async loadGLBModel(glbPath: string): Promise<void> {
    if (!this.viewer) {
      console.error('Viewer not initialized');
      return;
    }

    console.log('Loading GLB model:', glbPath);
    this.setStatus('info', 'Loading 3D model...');

    try {
      await this.viewer.loadModel(glbPath);
      this.setStatus('success', 'Model loaded');
    } catch (error) {
      console.error('Failed to load model:', error);
      this.setStatus('error', 'Failed to load 3D model');
    }
  }

  private startStatusPolling(runId: string): void {
    console.log('[VGGT] Starting status polling for run:', runId);

    // Clear any existing interval
    if (this.statusPollInterval) {
      clearInterval(this.statusPollInterval);
    }

    // Poll immediately
    this.pollRunStatus(runId);

    // Then poll every 2 seconds
    this.statusPollInterval = window.setInterval(async () => {
      await this.pollRunStatus(runId);
    }, 2000);
  }

  private stopStatusPolling(): void {
    if (this.statusPollInterval) {
      console.log('[VGGT] Stopping status polling');
      clearInterval(this.statusPollInterval);
      this.statusPollInterval = null;
    }
  }

  private async pollRunStatus(runId: string): Promise<void> {
    try {
      const run = await this.fetchRun(runId);
      console.log('[VGGT] Status update:', run.status, run);

      this.updateRunStatus(run);

      // Stop polling when complete or failed
      if (run.status === 'completed' || run.status === 'failed') {
        this.stopStatusPolling();

        if (run.status === 'completed') {
          this.handleRunComplete(run);
        } else {
          this.handleRunFailed(run);
        }
      }
    } catch (error) {
      console.error('[VGGT] Failed to poll run status:', error);
    }
  }

  private async fetchRun(runId: string): Promise<VGGTRun> {
    const response = await fetch(`/api/runs/${runId}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch run: ${response.statusText}`);
    }

    return await response.json();
  }

  private updateRunStatus(run: VGGTRun): void {
    const statusMessages = {
      'queued': 'Waiting to start...',
      'uploading': 'Uploading images to VGGT...',
      'processing': 'VGGT is analyzing images (this may take several minutes)...',
      'fetching': 'Downloading results...',
      'completed': '✓ Processing complete!',
      'failed': '✗ Processing failed'
    };

    // Update status badge
    const statusBadge = document.getElementById('runStatus');
    if (statusBadge) {
      statusBadge.textContent = run.status;
      statusBadge.className = `status-badge ${run.status}`;
    }

    // Update progress text
    const progressText = document.getElementById('progressText');
    if (progressText) {
      progressText.textContent = statusMessages[run.status] || run.status;
    }

    // Update status detail
    const statusDetail = document.getElementById('runStatusDetail');
    if (statusDetail) {
      statusDetail.textContent = statusMessages[run.status] || run.status;
    }

    // Update progress bar
    const progressFill = document.getElementById('progressFill') as HTMLElement;
    if (progressFill) {
      const progressPercent = {
        'queued': 10,
        'uploading': 30,
        'processing': 60,
        'fetching': 90,
        'completed': 100,
        'failed': 100
      }[run.status] || 0;

      progressFill.style.width = `${progressPercent}%`;
    }

    // Update main status bar
    const type = run.status === 'failed' ? 'error' :
                 run.status === 'completed' ? 'success' : 'processing';
    this.setStatus(type, statusMessages[run.status] || run.status);
  }

  private showRunDetailsPanel(runId: string, imageCount: number, settings: any): void {
    const runDetails = document.getElementById('runDetails');
    if (!runDetails) return;

    // Show the panel
    runDetails.classList.remove('hidden');

    // Update run ID
    const runIdElement = document.getElementById('runId');
    if (runIdElement) {
      runIdElement.textContent = runId.substring(0, 8) + '...';
    }

    // Update image count
    const imageCountElement = document.getElementById('imageCount');
    if (imageCountElement) {
      imageCountElement.textContent = imageCount.toString();
    }

    // Update settings
    const settingsElement = document.getElementById('runSettings');
    if (settingsElement) {
      settingsElement.textContent = `${settings.predictionMode}, conf=${settings.confThreshold}`;
    }

    // Update started time
    const startedElement = document.getElementById('runStarted');
    if (startedElement) {
      startedElement.textContent = new Date().toLocaleTimeString();
    }

    // Show progress section
    const progressSection = document.getElementById('runProgress');
    if (progressSection) {
      progressSection.classList.remove('hidden');
    }

    // Copy thumbnails to run details
    this.updateRunDetailsImages();
  }

  private updateRunDetailsImages(): void {
    const sourceGrid = document.getElementById('thumbnailGrid');
    const targetGrid = document.getElementById('runImages');

    if (sourceGrid && targetGrid) {
      targetGrid.innerHTML = sourceGrid.innerHTML;

      // Remove the remove buttons from the copied thumbnails
      targetGrid.querySelectorAll('.thumbnail-remove').forEach(btn => btn.remove());
    }
  }

  private showProcessingOverlay(): void {
    const uploadZone = document.getElementById('uploadZone');
    if (!uploadZone) return;

    // Add a processing overlay to the upload zone
    let overlay = uploadZone.querySelector('.processing-overlay') as HTMLElement;
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'processing-overlay';
      overlay.innerHTML = `
        <div class="processing-message">
          <div class="spinner"></div>
          <p>Processing...</p>
        </div>
      `;
      uploadZone.appendChild(overlay);
    }
    overlay.style.display = 'flex';
  }

  private hideProcessingOverlay(): void {
    const uploadZone = document.getElementById('uploadZone');
    if (!uploadZone) return;

    const overlay = uploadZone.querySelector('.processing-overlay') as HTMLElement;
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  private handleRunComplete(run: VGGTRun): void {
    console.log('[VGGT] Run completed successfully:', run);
    this.hideProcessingOverlay();

    // Clear the upload form
    setTimeout(() => {
      this.imageUploader.clear();
      this.setStatus('success', 'Processing complete! Select the run from history to view.');

      setTimeout(() => {
        this.setStatus('idle', 'Ready');
      }, 5000);
    }, 2000);
  }

  private handleRunFailed(run: VGGTRun): void {
    console.error('[VGGT] Run failed:', run.error);
    this.hideProcessingOverlay();
    this.setStatus('error', `Processing failed: ${run.error || 'Unknown error'}`);

    setTimeout(() => {
      this.setStatus('idle', 'Ready');
    }, 5000);
  }

  private setStatus(
    type: 'idle' | 'ready' | 'loading' | 'processing' | 'success' | 'error' | 'info',
    message: string
  ): void {
    this.statusBar.text.textContent = message;

    // Update indicator color
    const colors = {
      idle: '#6b7280',
      ready: '#10b981',
      loading: '#3b82f6',
      processing: '#f59e0b',
      success: '#10b981',
      error: '#ef4444',
      info: '#3b82f6',
    };

    this.statusBar.indicator.style.background = colors[type];
  }

  // Public API for debugging
  public getState() {
    return {
      images: this.imageUploader.getImages(),
      settings: this.settings.getSettings(),
      currentRunId: this.currentRunId,
      selectedRun: this.runHistory.getSelectedRun(),
    };
  }
}

// Initialize app when DOM is ready
let app: VGGTApp;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    app = new VGGTApp();
    // Expose to window for debugging
    (window as any).app = app;
  });
} else {
  app = new VGGTApp();
  (window as any).app = app;
}

export { VGGTApp };
