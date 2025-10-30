/**
 * example-scene.ts
 *
 * Complete example of integrating CameraTransforms into a Three.js scene
 * Shows realistic usage with NPZ data loading, visualization, and interaction
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CameraTransforms, CameraData } from './CameraTransforms';

/**
 * Main viewer class for VGGT camera visualization
 */
export class VGGTCameraViewer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;

  private frustums: THREE.Group[] = [];
  private cameras: CameraData[] = [];
  private selectedFrustum: THREE.Group | null = null;

  constructor(container: HTMLElement) {
    // Initialize Three.js scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    // Setup camera
    this.camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(10, 10, 10);

    // Setup renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    // Setup controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    // Setup raycaster for interaction
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Add scene helpers
    this.addSceneHelpers();

    // Event listeners
    this.setupEventListeners();

    // Start render loop
    this.animate();
  }

  /**
   * Add grid, axes, and lighting to scene
   */
  private addSceneHelpers(): void {
    // Grid helper (ground plane)
    const gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x222222);
    this.scene.add(gridHelper);

    // Axis helper (X=red, Y=green, Z=blue)
    const axisHelper = new THREE.AxesHelper(5);
    this.scene.add(axisHelper);

    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    // Directional light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(5, 10, 5);
    this.scene.add(directionalLight);
  }

  /**
   * Setup mouse and keyboard event listeners
   */
  private setupEventListeners(): void {
    // Mouse move for raycasting
    this.renderer.domElement.addEventListener('mousemove', (event) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    });

    // Click to select frustum
    this.renderer.domElement.addEventListener('click', () => {
      this.handleFrustumClick();
    });

    // Window resize
    window.addEventListener('resize', () => {
      this.handleResize();
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', (event) => {
      this.handleKeyPress(event);
    });
  }

  /**
   * Load and visualize VGGT predictions
   */
  async loadPredictions(predictions: any): Promise<void> {
    console.log('Loading VGGT predictions...');

    // Parse camera data
    const { cameras, numFrames } = CameraTransforms.parseNPZCameras(predictions);
    this.cameras = cameras;
    console.log(`Loaded ${numFrames} cameras`);

    // Create frustums
    this.frustums = CameraTransforms.createAllFrustums(cameras, 1.0);
    this.frustums.forEach(frustum => {
      this.scene.add(frustum);
    });
    console.log(`Created ${this.frustums.length} frustum meshes`);

    // Calculate scene bounds and frame view
    this.frameCameras();

    // Log camera statistics
    this.logCameraStats();
  }

  /**
   * Frame the camera to view all frustums
   */
  private frameCameras(): void {
    if (this.cameras.length === 0) return;

    const bounds = CameraTransforms.calculateSceneBounds(this.cameras);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    // Position camera to see entire scene
    const distance = maxDim * 2;
    this.camera.position.set(
      center.x + distance * 0.6,
      center.y + distance * 0.6,
      center.z + distance * 0.6
    );

    // Point controls at scene center
    this.controls.target.copy(center);
    this.controls.update();

    console.log('Scene bounds:', {
      min: bounds.min.toArray(),
      max: bounds.max.toArray(),
      center: center.toArray(),
      size: size.toArray()
    });
  }

  /**
   * Log camera statistics for debugging
   */
  private logCameraStats(): void {
    if (this.cameras.length === 0) return;

    console.log('Camera Statistics:');

    // Position range
    const positions = this.cameras.map(cam => {
      const matrix = CameraTransforms.extrinsicToThreeMatrix(cam.extrinsic);
      const { position } = CameraTransforms.getPositionAndRotation(matrix);
      return position;
    });

    const minPos = new THREE.Vector3(
      Math.min(...positions.map(p => p.x)),
      Math.min(...positions.map(p => p.y)),
      Math.min(...positions.map(p => p.z))
    );
    const maxPos = new THREE.Vector3(
      Math.max(...positions.map(p => p.x)),
      Math.max(...positions.map(p => p.y)),
      Math.max(...positions.map(p => p.z))
    );

    console.log('  Position range:');
    console.log('    Min:', minPos.toArray());
    console.log('    Max:', maxPos.toArray());

    // Average FOV
    const fovs = this.cameras.map(cam =>
      CameraTransforms.getFOVFromIntrinsic(cam.intrinsic)
    );
    const avgFOV = fovs.reduce((a, b) => a + b, 0) / fovs.length;
    console.log(`  Average FOV: ${avgFOV.toFixed(2)}°`);
    console.log(`  FOV range: ${Math.min(...fovs).toFixed(2)}° - ${Math.max(...fovs).toFixed(2)}°`);
  }

  /**
   * Handle frustum click for inspection
   */
  private handleFrustumClick(): void {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(
      this.frustums.flatMap(f => f.children),
      true
    );

    // Deselect previous
    if (this.selectedFrustum) {
      this.highlightFrustum(this.selectedFrustum, false);
    }

    if (intersects.length > 0) {
      // Find parent frustum group
      let object: THREE.Object3D | null = intersects[0].object;
      while (object && !object.name.startsWith('camera_')) {
        object = object.parent;
      }

      if (object) {
        this.selectedFrustum = object as THREE.Group;
        this.highlightFrustum(this.selectedFrustum, true);
        this.displayCameraInfo(this.selectedFrustum);
      }
    } else {
      this.selectedFrustum = null;
      this.clearCameraInfo();
    }
  }

  /**
   * Highlight or unhighlight a frustum
   */
  private highlightFrustum(frustum: THREE.Group, highlight: boolean): void {
    frustum.children.forEach(child => {
      if (child instanceof THREE.LineSegments) {
        const material = child.material as THREE.LineBasicMaterial;
        material.linewidth = highlight ? 4 : 2;
        material.opacity = highlight ? 1.0 : 0.8;
      } else if (child instanceof THREE.Mesh) {
        const material = child.material as THREE.MeshBasicMaterial;
        material.emissive.setHex(highlight ? 0xffffff : 0x000000);
        material.emissiveIntensity = highlight ? 0.3 : 0;
      }
    });
  }

  /**
   * Display camera info in console (could be UI overlay)
   */
  private displayCameraInfo(frustum: THREE.Group): void {
    const data = frustum.userData;
    console.log('Selected Camera:', {
      index: data.imageIndex,
      position: data.position,
      rotation: data.rotation,
      fov: data.fov,
      aspect: data.aspect
    });
  }

  /**
   * Clear camera info display
   */
  private clearCameraInfo(): void {
    console.log('Deselected camera');
  }

  /**
   * Handle keyboard shortcuts
   */
  private handleKeyPress(event: KeyboardEvent): void {
    switch (event.key) {
      case 'f':
        // Frame cameras
        this.frameCameras();
        break;

      case 'g':
        // Toggle grid
        const grid = this.scene.children.find(
          c => c instanceof THREE.GridHelper
        );
        if (grid) grid.visible = !grid.visible;
        break;

      case 'a':
        // Toggle axes
        const axes = this.scene.children.find(
          c => c instanceof THREE.AxesHelper
        );
        if (axes) axes.visible = !axes.visible;
        break;

      case 'c':
        // Cycle through camera views
        if (this.cameras.length > 0) {
          this.cycleCameraView();
        }
        break;

      case 'Escape':
        // Deselect
        if (this.selectedFrustum) {
          this.highlightFrustum(this.selectedFrustum, false);
          this.selectedFrustum = null;
          this.clearCameraInfo();
        }
        break;
    }
  }

  /**
   * Cycle through camera viewpoints
   */
  private currentCameraIndex = -1;
  private cycleCameraView(): void {
    if (this.cameras.length === 0) return;

    this.currentCameraIndex = (this.currentCameraIndex + 1) % this.cameras.length;
    const cameraData = this.cameras[this.currentCameraIndex];

    const matrix = CameraTransforms.extrinsicToThreeMatrix(cameraData.extrinsic);
    const { position, quaternion } = CameraTransforms.getPositionAndRotation(matrix);

    // Animate camera to this position
    this.animateCameraTo(position, quaternion);

    console.log(`Viewing from Camera ${this.currentCameraIndex}`);
  }

  /**
   * Animate camera to new position (simple lerp)
   */
  private animateCameraTo(
    targetPos: THREE.Vector3,
    targetQuat: THREE.Quaternion
  ): void {
    const duration = 1000; // 1 second
    const startTime = Date.now();
    const startPos = this.camera.position.clone();
    const startQuat = this.camera.quaternion.clone();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / duration, 1);

      // Ease in-out
      const easedT = t < 0.5
        ? 2 * t * t
        : -1 + (4 - 2 * t) * t;

      this.camera.position.lerpVectors(startPos, targetPos, easedT);
      this.camera.quaternion.slerpQuaternions(startQuat, targetQuat, easedT);
      this.camera.updateMatrixWorld();

      if (t < 1) {
        requestAnimationFrame(animate);
      }
    };

    animate();
  }

  /**
   * Handle window resize
   */
  private handleResize(): void {
    const container = this.renderer.domElement.parentElement;
    if (!container) return;

    this.camera.aspect = container.clientWidth / container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(container.clientWidth, container.clientHeight);
  }

  /**
   * Animation loop
   */
  private animate = (): void => {
    requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  /**
   * Add a point cloud to the scene
   */
  addPointCloud(points: THREE.Vector3[], color: number = 0xffffff): void {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.PointsMaterial({
      size: 0.02,
      color,
      sizeAttenuation: true
    });
    const pointCloud = new THREE.Points(geometry, material);
    pointCloud.name = 'point_cloud';
    this.scene.add(pointCloud);

    console.log(`Added point cloud with ${points.length} points`);
  }

  /**
   * Remove point cloud from scene
   */
  removePointCloud(): void {
    const pointCloud = this.scene.getObjectByName('point_cloud');
    if (pointCloud) {
      this.scene.remove(pointCloud);
      console.log('Removed point cloud');
    }
  }

  /**
   * Toggle frustum visibility
   */
  toggleFrustums(visible: boolean): void {
    this.frustums.forEach(frustum => {
      frustum.visible = visible;
    });
  }

  /**
   * Update frustum scale
   */
  setFrustumScale(scale: number): void {
    // Remove old frustums
    this.frustums.forEach(frustum => this.scene.remove(frustum));

    // Create new frustums with updated scale
    this.frustums = CameraTransforms.createAllFrustums(this.cameras, scale);
    this.frustums.forEach(frustum => this.scene.add(frustum));

    console.log(`Updated frustum scale to ${scale}`);
  }

  /**
   * Export camera positions as JSON
   */
  exportCameraPositions(): any {
    return this.cameras.map(cam => {
      const matrix = CameraTransforms.extrinsicToThreeMatrix(cam.extrinsic);
      const { position, quaternion } = CameraTransforms.getPositionAndRotation(matrix);
      const fov = CameraTransforms.getFOVFromIntrinsic(cam.intrinsic);

      return {
        index: cam.imageIndex,
        position: position.toArray(),
        rotation: quaternion.toArray(),
        fov,
        intrinsic: cam.intrinsic,
        extrinsic: cam.extrinsic
      };
    });
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.renderer.dispose();
    this.controls.dispose();
    this.scene.clear();
  }
}

/**
 * Initialize viewer and load predictions
 */
export async function initializeViewer(
  container: HTMLElement,
  predictions: any
): Promise<VGGTCameraViewer> {
  const viewer = new VGGTCameraViewer(container);
  await viewer.loadPredictions(predictions);

  // Add keyboard shortcuts help
  console.log('Keyboard shortcuts:');
  console.log('  F - Frame cameras');
  console.log('  G - Toggle grid');
  console.log('  A - Toggle axes');
  console.log('  C - Cycle camera views');
  console.log('  ESC - Deselect camera');

  return viewer;
}

/**
 * Example usage in HTML page
 *
 * <div id="viewer-container" style="width: 100vw; height: 100vh;"></div>
 *
 * <script type="module">
 *   import { initializeViewer } from './viewer/example-scene.js';
 *
 *   // Load predictions.npz (using npyjs or similar)
 *   const predictions = await loadNPZ('/outputs/predictions.npz');
 *
 *   // Initialize viewer
 *   const container = document.getElementById('viewer-container');
 *   const viewer = await initializeViewer(container, predictions);
 *
 *   // Optional: Add point cloud
 *   const points = extractPointsFromPredictions(predictions);
 *   viewer.addPointCloud(points);
 * </script>
 */
