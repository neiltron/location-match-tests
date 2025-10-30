// public/viewer/SceneViewer.ts
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// public/viewer/CameraAnimator.js
import gsap from "gsap";

class CameraAnimator {
  camera;
  controls;
  currentAnimation;
  defaultCamera;
  isUserControlling = false;
  defaultDuration = 1;
  defaultEase = "power2.inOut";
  constructor(camera, controls) {
    this.camera = camera;
    this.controls = controls;
    this.defaultCamera = this.getCurrentCameraState();
    if (controls) {
      controls.addEventListener?.("start", () => {
        this.isUserControlling = true;
      });
      controls.addEventListener?.("end", () => {
        this.isUserControlling = false;
      });
    }
  }
  getCurrentCameraState() {
    return {
      position: this.camera.position.clone(),
      quaternion: this.camera.quaternion.clone()
    };
  }
  animateToCamera(target, duration = this.defaultDuration) {
    this.stop();
    const startPosition = this.camera.position.clone();
    const startQuaternion = this.camera.quaternion.clone();
    this.currentAnimation = gsap.timeline({
      onUpdate: () => {
        if (this.controls && target.lookAt) {
          this.controls.target.copy(target.lookAt);
        }
        if (this.controls?.update) {
          this.controls.update();
        }
      },
      onComplete: () => {
        this.currentAnimation = undefined;
        if (this.controls?.update) {
          this.controls.update();
        }
      },
      onInterrupt: () => {
        this.currentAnimation = undefined;
      }
    });
    this.currentAnimation.to(this.camera.position, {
      x: target.position.x,
      y: target.position.y,
      z: target.position.z,
      duration,
      ease: this.defaultEase
    }, 0);
    const targetQuat = {
      x: target.quaternion.x,
      y: target.quaternion.y,
      z: target.quaternion.z,
      w: target.quaternion.w
    };
    this.currentAnimation.to(this.camera.quaternion, {
      x: targetQuat.x,
      y: targetQuat.y,
      z: targetQuat.z,
      w: targetQuat.w,
      duration,
      ease: this.defaultEase,
      onUpdate: () => {
        this.camera.quaternion.normalize();
      }
    }, 0);
    if (target.lookAt && this.controls?.target) {
      this.currentAnimation.to(this.controls.target, {
        x: target.lookAt.x,
        y: target.lookAt.y,
        z: target.lookAt.z,
        duration,
        ease: this.defaultEase
      }, 0);
    }
  }
  animateToDefault(duration = this.defaultDuration) {
    this.animateToCamera(this.defaultCamera, duration);
  }
  stop() {
    if (this.currentAnimation) {
      this.currentAnimation.kill();
      this.currentAnimation = undefined;
    }
  }
  isAnimating() {
    return this.currentAnimation !== undefined && this.currentAnimation.isActive();
  }
  setDefaultCamera(target) {
    if (target) {
      this.defaultCamera = target;
    } else {
      this.defaultCamera = this.getCurrentCameraState();
    }
  }
  getDefaultCamera() {
    return {
      position: this.defaultCamera.position.clone(),
      quaternion: this.defaultCamera.quaternion.clone()
    };
  }
  isUserActive() {
    return this.isUserControlling;
  }
  dispose() {
    this.stop();
  }
}

// public/viewer/SceneViewer.ts
class SceneViewer {
  container;
  scene;
  camera;
  renderer;
  controls;
  animator;
  loadedModel;
  cameraFrustums;
  animationFrameId;
  constructor(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Container element '${containerId}' not found`);
    }
    this.container = container;
    this.scene = new THREE.Scene;
    this.scene.background = new THREE.Color(988185);
    this.camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
    this.camera.position.set(0, 2, 5);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.innerHTML = "";
    container.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.target.set(0, 0, 0);
    this.animator = new CameraAnimator(this.camera, this.controls);
    this.cameraFrustums = new THREE.Group;
    this.scene.add(this.cameraFrustums);
    this.setupLighting();
    const gridHelper = new THREE.GridHelper(10, 10, 4473924, 2236962);
    this.scene.add(gridHelper);
    window.addEventListener("resize", this.handleResize);
    this.animate();
  }
  setupLighting() {
    const ambientLight = new THREE.AmbientLight(16777215, 0.6);
    this.scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(16777215, 0.8);
    directionalLight.position.set(5, 10, 5);
    this.scene.add(directionalLight);
    const hemiLight = new THREE.HemisphereLight(8900331, 4473924, 0.4);
    this.scene.add(hemiLight);
  }
  handleResize = () => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };
  animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
  async loadModel(url) {
    const loader = new GLTFLoader;
    return new Promise((resolve, reject) => {
      loader.load(url, (gltf) => {
        if (this.loadedModel) {
          this.scene.remove(this.loadedModel);
        }
        this.loadedModel = gltf.scene;
        this.scene.add(this.loadedModel);
        this.fitModelToView(this.loadedModel);
        resolve();
      }, undefined, (error) => {
        console.error("Error loading model:", error);
        reject(error);
      });
    });
  }
  fitModelToView(model) {
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3);
    const size = box.getSize(new THREE.Vector3);
    model.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 5 / maxDim;
    model.scale.multiplyScalar(scale);
    this.controls.target.copy(new THREE.Vector3(0, 0, 0));
  }
  setCameraFrustums(transforms, showFrustums = true) {
    this.cameraFrustums.clear();
    if (!showFrustums || transforms.length === 0) {
      return;
    }
    transforms.forEach((transform, index) => {
      const frustum = this.createCameraFrustum(index);
      frustum.position.set(transform.position[0], transform.position[1], transform.position[2]);
      frustum.quaternion.set(transform.rotation[0], transform.rotation[1], transform.rotation[2], transform.rotation[3]);
      this.cameraFrustums.add(frustum);
    });
  }
  createCameraFrustum(index) {
    const group = new THREE.Group;
    const bodyGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.15);
    const bodyMaterial = new THREE.MeshBasicMaterial({
      color: 3900150,
      transparent: true,
      opacity: 0.7
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    group.add(body);
    const frustumGeometry = new THREE.BufferGeometry;
    const vertices = new Float32Array([
      0,
      0,
      0,
      -0.15,
      -0.15,
      -0.3,
      0,
      0,
      0,
      0.15,
      -0.15,
      -0.3,
      0,
      0,
      0,
      0.15,
      0.15,
      -0.3,
      0,
      0,
      0,
      -0.15,
      0.15,
      -0.3,
      -0.15,
      -0.15,
      -0.3,
      0.15,
      -0.15,
      -0.3,
      0.15,
      -0.15,
      -0.3,
      0.15,
      0.15,
      -0.3,
      0.15,
      0.15,
      -0.3,
      -0.15,
      0.15,
      -0.3,
      -0.15,
      0.15,
      -0.3,
      -0.15,
      -0.15,
      -0.3
    ]);
    frustumGeometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    const frustumMaterial = new THREE.LineBasicMaterial({
      color: 6333946,
      transparent: true,
      opacity: 0.5
    });
    const frustumLines = new THREE.LineSegments(frustumGeometry, frustumMaterial);
    group.add(frustumLines);
    group.userData.cameraIndex = index;
    return group;
  }
  animateToCamera(transform, duration = 1) {
    const target = {
      position: new THREE.Vector3(...transform.position),
      quaternion: new THREE.Quaternion(...transform.rotation)
    };
    if (transform.lookAt) {
      target.lookAt = new THREE.Vector3(...transform.lookAt);
    }
    this.animator.animateToCamera(target, duration);
  }
  resetCamera() {
    this.animator.animateToDefault(1);
  }
  getAnimator() {
    return this.animator;
  }
  getCamera() {
    return this.camera;
  }
  getControls() {
    return this.controls;
  }
  dispose() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    window.removeEventListener("resize", this.handleResize);
    this.animator.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.scene.clear();
  }
}
export {
  SceneViewer
};
