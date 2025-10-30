/**
 * SceneViewer
 * Main 3D scene viewer with Three.js integration
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CameraAnimator, CameraTarget } from './CameraAnimator.js';

export interface CameraTransform {
  position: [number, number, number];
  rotation: [number, number, number, number]; // quaternion [x, y, z, w]
  lookAt?: [number, number, number];
}

export class SceneViewer {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private animator: CameraAnimator;

  private loadedModel?: THREE.Group;
  private cameraFrustums: THREE.Group;
  private animationFrameId?: number;

  constructor(containerId: string) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Container element '${containerId}' not found`);
    }
    this.container = container;

    // Initialize scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f1419);

    // Initialize camera
    this.camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 2, 5);

    // Initialize renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Clear any placeholder content and add canvas
    container.innerHTML = '';
    container.appendChild(this.renderer.domElement);

    // Initialize controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.target.set(0, 0, 0);

    // Initialize camera animator
    this.animator = new CameraAnimator(this.camera, this.controls);

    // Camera frustums group
    this.cameraFrustums = new THREE.Group();
    this.scene.add(this.cameraFrustums);

    // Add basic lighting
    this.setupLighting();

    // Add grid helper
    const gridHelper = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
    this.scene.add(gridHelper);

    // Handle window resize
    window.addEventListener('resize', this.handleResize);

    // Start animation loop
    this.animate();
  }

  private setupLighting(): void {
    // Ambient light for overall illumination
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    // Directional light for shadows and depth
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 5);
    this.scene.add(directionalLight);

    // Hemisphere light for outdoor feel
    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x444444, 0.4);
    this.scene.add(hemiLight);
  }

  private handleResize = (): void => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
  };

  private animate = (): void => {
    this.animationFrameId = requestAnimationFrame(this.animate);

    // Update controls
    this.controls.update();

    // Render scene
    this.renderer.render(this.scene, this.camera);
  };

  /**
   * Load a GLB model into the scene
   */
  public async loadModel(url: string): Promise<void> {
    const loader = new GLTFLoader();

    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (gltf: any) => {
          // Remove previous model if exists
          if (this.loadedModel) {
            this.scene.remove(this.loadedModel);
          }

          this.loadedModel = gltf.scene;
          this.scene.add(this.loadedModel);

          // Center and scale the model
          this.fitModelToView(this.loadedModel);

          resolve();
        },
        undefined,
        (error: any) => {
          console.error('Error loading model:', error);
          reject(error);
        }
      );
    });
  }

  /**
   * Center and scale a model to fit in view
   */
  private fitModelToView(model: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Center the model
    model.position.sub(center);

    // Scale to fit
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 5 / maxDim;
    model.scale.multiplyScalar(scale);

    // Update controls target to model center
    this.controls.target.copy(new THREE.Vector3(0, 0, 0));
  }

  /**
   * Add camera frustums to the scene
   */
  public setCameraFrustums(transforms: CameraTransform[], showFrustums: boolean = true): void {
    // Clear existing frustums
    this.cameraFrustums.clear();

    if (!showFrustums || transforms.length === 0) {
      return;
    }

    transforms.forEach((transform, index) => {
      const frustum = this.createCameraFrustum(index);

      // Set position
      frustum.position.set(
        transform.position[0],
        transform.position[1],
        transform.position[2]
      );

      // Set rotation (quaternion)
      frustum.quaternion.set(
        transform.rotation[0],
        transform.rotation[1],
        transform.rotation[2],
        transform.rotation[3]
      );

      this.cameraFrustums.add(frustum);
    });
  }

  /**
   * Create a visual representation of a camera frustum
   */
  private createCameraFrustum(index: number): THREE.Group {
    const group = new THREE.Group();

    // Camera body (small box)
    const bodyGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.15);
    const bodyMaterial = new THREE.MeshBasicMaterial({
      color: 0x3b82f6,
      transparent: true,
      opacity: 0.7
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    group.add(body);

    // Frustum lines
    const frustumGeometry = new THREE.BufferGeometry();
    const vertices = new Float32Array([
      // From camera center to frustum corners
      0, 0, 0,  -0.15, -0.15, -0.3,
      0, 0, 0,   0.15, -0.15, -0.3,
      0, 0, 0,   0.15,  0.15, -0.3,
      0, 0, 0,  -0.15,  0.15, -0.3,
      // Frustum rectangle
      -0.15, -0.15, -0.3,  0.15, -0.15, -0.3,
       0.15, -0.15, -0.3,  0.15,  0.15, -0.3,
       0.15,  0.15, -0.3, -0.15,  0.15, -0.3,
      -0.15,  0.15, -0.3, -0.15, -0.15, -0.3,
    ]);
    frustumGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

    const frustumMaterial = new THREE.LineBasicMaterial({
      color: 0x60a5fa,
      transparent: true,
      opacity: 0.5
    });
    const frustumLines = new THREE.LineSegments(frustumGeometry, frustumMaterial);
    group.add(frustumLines);

    // Add index label (sprite with text)
    // For simplicity, we'll skip text rendering for now

    group.userData.cameraIndex = index;
    return group;
  }

  /**
   * Animate camera to a specific transform
   */
  public animateToCamera(transform: CameraTransform, duration: number = 1.0): void {
    const target: CameraTarget = {
      position: new THREE.Vector3(...transform.position),
      quaternion: new THREE.Quaternion(...transform.rotation),
    };

    if (transform.lookAt) {
      target.lookAt = new THREE.Vector3(...transform.lookAt);
    }

    this.animator.animateToCamera(target, duration);
  }

  /**
   * Reset camera to default view
   */
  public resetCamera(): void {
    this.animator.animateToDefault(1.0);
  }

  /**
   * Get the camera animator instance
   */
  public getAnimator(): CameraAnimator {
    return this.animator;
  }

  /**
   * Get the camera instance
   */
  public getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  /**
   * Get the controls instance
   */
  public getControls(): OrbitControls {
    return this.controls;
  }

  /**
   * Cleanup and dispose of resources
   */
  public dispose(): void {
    // Stop animation loop
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    // Remove event listeners
    window.removeEventListener('resize', this.handleResize);

    // Dispose of animator
    this.animator.dispose();

    // Dispose of controls
    this.controls.dispose();

    // Dispose of renderer
    this.renderer.dispose();

    // Clear scene
    this.scene.clear();
  }
}
