/**
 * Viewer3D.ts
 *
 * Core Three.js viewer for displaying 3D point cloud models from VGGT.
 * Handles scene setup, lighting, camera controls, and GLB model loading.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
export class Viewer3D {
    // Core Three.js components
    container;
    renderer;
    scene;
    camera;
    controls;
    // Loaders
    gltfLoader;
    // Helpers
    gridHelper = null;
    axesHelper = null;
    // Model management
    currentModel = null;
    animationFrameId = null;
    // State
    isDisposed = false;
    constructor(container, options = {}) {
        this.container = container;
        // Default options
        const { showGrid = true, showAxes = true, backgroundColor = 0x1a1a1a, enableShadows = true } = options;
        // Initialize scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(backgroundColor);
        // Initialize camera
        this.camera = new THREE.PerspectiveCamera(60, // FOV
        container.clientWidth / container.clientHeight, 0.1, // Near plane
        1000 // Far plane
        );
        this.camera.position.set(5, 5, 5);
        this.camera.lookAt(0, 0, 0);
        // Initialize renderer
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: false
        });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        if (enableShadows) {
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        }
        container.appendChild(this.renderer.domElement);
        // Initialize controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.screenSpacePanning = false;
        this.controls.minDistance = 1;
        this.controls.maxDistance = 100;
        this.controls.maxPolarAngle = Math.PI / 2 + 0.1; // Slightly below horizon
        // Initialize loader
        this.gltfLoader = new GLTFLoader();
        // Setup lighting
        this.setupLights();
        // Add helpers
        if (showGrid) {
            this.gridHelper = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
            this.scene.add(this.gridHelper);
        }
        if (showAxes) {
            this.axesHelper = new THREE.AxesHelper(5);
            this.scene.add(this.axesHelper);
        }
        // Setup resize handler
        this.setupResizeHandler();
        // Start animation loop
        this.animate();
    }
    /**
     * Setup scene lighting for optimal point cloud visibility
     */
    setupLights() {
        // Ambient light for overall illumination
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        // Key directional light (main light source)
        const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
        keyLight.position.set(5, 10, 5);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.width = 2048;
        keyLight.shadow.mapSize.height = 2048;
        keyLight.shadow.camera.near = 0.5;
        keyLight.shadow.camera.far = 50;
        keyLight.shadow.camera.left = -10;
        keyLight.shadow.camera.right = 10;
        keyLight.shadow.camera.top = 10;
        keyLight.shadow.camera.bottom = -10;
        this.scene.add(keyLight);
        // Fill directional light (softer, from opposite side)
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
        fillLight.position.set(-5, 5, -5);
        this.scene.add(fillLight);
    }
    /**
     * Setup window resize handler
     */
    setupResizeHandler() {
        const resizeObserver = new ResizeObserver((entries) => {
            if (this.isDisposed)
                return;
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                this.camera.aspect = width / height;
                this.camera.updateProjectionMatrix();
                this.renderer.setSize(width, height);
            }
        });
        resizeObserver.observe(this.container);
    }
    /**
     * Load a GLB/GLTF model from a URL
     * @param url URL to the GLB/GLTF file
     * @returns Promise that resolves when the model is loaded
     */
    async loadGLB(url) {
        return new Promise((resolve, reject) => {
            // Clear existing model
            this.clearScene();
            this.gltfLoader.load(url, (gltf) => {
                try {
                    this.currentModel = gltf.scene;
                    this.scene.add(this.currentModel);
                    // Center and fit the model
                    this.centerModel(this.currentModel);
                    this.fitCameraToModel(this.currentModel);
                    // Enable shadows on all meshes
                    this.currentModel.traverse((child) => {
                        if (child instanceof THREE.Mesh) {
                            child.castShadow = true;
                            child.receiveShadow = true;
                        }
                    });
                    console.log('GLB model loaded successfully:', url);
                    resolve();
                }
                catch (error) {
                    reject(error);
                }
            }, (progress) => {
                const percentComplete = (progress.loaded / progress.total) * 100;
                console.log(`Loading model: ${percentComplete.toFixed(2)}%`);
            }, (error) => {
                console.error('Error loading GLB model:', error);
                reject(error);
            });
        });
    }
    /**
     * Center a model at the origin
     */
    centerModel(model) {
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.x -= center.x;
        model.position.y -= center.y;
        model.position.z -= center.z;
    }
    /**
     * Fit camera to view the entire model
     */
    fitCameraToModel(model) {
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        // Calculate the maximum dimension
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = this.camera.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
        // Add some padding (multiply by 1.5 for better framing)
        cameraZ *= 1.5;
        // Position camera
        const direction = this.camera.position.clone().normalize();
        this.camera.position.copy(direction.multiplyScalar(cameraZ).add(center));
        // Update controls target
        this.controls.target.copy(center);
        // Update camera near/far planes based on model size
        this.camera.near = cameraZ / 100;
        this.camera.far = cameraZ * 100;
        this.camera.updateProjectionMatrix();
        // Update controls distance limits
        this.controls.minDistance = cameraZ / 10;
        this.controls.maxDistance = cameraZ * 10;
        this.controls.update();
    }
    /**
     * Clear the current model from the scene
     */
    clearScene() {
        if (this.currentModel) {
            // Dispose of geometries and materials
            this.currentModel.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    if (child.geometry) {
                        child.geometry.dispose();
                    }
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach((material) => material.dispose());
                        }
                        else {
                            child.material.dispose();
                        }
                    }
                }
            });
            this.scene.remove(this.currentModel);
            this.currentModel = null;
        }
    }
    /**
     * Animation loop
     */
    animate = () => {
        if (this.isDisposed)
            return;
        this.animationFrameId = requestAnimationFrame(this.animate);
        // Update controls
        this.controls.update();
        // Render scene
        this.renderer.render(this.scene, this.camera);
    };
    /**
     * Manually trigger a render (useful when animation loop is stopped)
     */
    render() {
        this.renderer.render(this.scene, this.camera);
    }
    /**
     * Get the camera instance (for external animations with GSAP)
     */
    getCamera() {
        return this.camera;
    }
    /**
     * Get the controls instance
     */
    getControls() {
        return this.controls;
    }
    /**
     * Get the current model
     */
    getCurrentModel() {
        return this.currentModel;
    }
    /**
     * Reset camera to default position
     */
    resetCamera() {
        if (this.currentModel) {
            this.fitCameraToModel(this.currentModel);
        }
        else {
            this.camera.position.set(5, 5, 5);
            this.camera.lookAt(0, 0, 0);
            this.controls.target.set(0, 0, 0);
            this.controls.update();
        }
    }
    /**
     * Toggle grid visibility
     */
    toggleGrid(visible) {
        if (this.gridHelper) {
            this.gridHelper.visible = visible;
        }
    }
    /**
     * Toggle axes visibility
     */
    toggleAxes(visible) {
        if (this.axesHelper) {
            this.axesHelper.visible = visible;
        }
    }
    /**
     * Clean up resources
     */
    dispose() {
        if (this.isDisposed)
            return;
        this.isDisposed = true;
        // Stop animation loop
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        // Clear scene
        this.clearScene();
        // Dispose of helpers
        if (this.gridHelper) {
            this.gridHelper.geometry.dispose();
            if (this.gridHelper.material instanceof THREE.Material) {
                this.gridHelper.material.dispose();
            }
            this.scene.remove(this.gridHelper);
        }
        if (this.axesHelper) {
            this.axesHelper.geometry.dispose();
            if (this.axesHelper.material instanceof THREE.Material) {
                this.axesHelper.material.dispose();
            }
            this.scene.remove(this.axesHelper);
        }
        // Dispose of controls
        this.controls.dispose();
        // Dispose of renderer
        this.renderer.dispose();
        // Remove canvas from DOM
        if (this.renderer.domElement.parentElement) {
            this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
        }
        console.log('Viewer3D disposed');
    }
}
