// public/viewer/CameraAnimator.ts
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
export {
  CameraAnimator
};
