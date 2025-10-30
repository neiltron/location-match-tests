/**
 * CameraAnimator
 * Handles smooth GSAP-based camera animations triggered by thumbnail hover
 */

import gsap from 'gsap';
import * as THREE from 'three';

export interface CameraTarget {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  lookAt?: THREE.Vector3;
}

export class CameraAnimator {
  private camera: THREE.Camera;
  private controls: any; // OrbitControls type
  private currentAnimation?: gsap.core.Timeline;
  private defaultCamera: CameraTarget;
  private isUserControlling: boolean = false;

  // Animation settings
  private readonly defaultDuration: number = 1.0;
  private readonly defaultEase: string = 'power2.inOut';

  constructor(camera: THREE.Camera, controls: any) {
    this.camera = camera;
    this.controls = controls;

    // Store the initial camera state as default
    this.defaultCamera = this.getCurrentCameraState();

    // Track when user is manually controlling the camera
    if (controls) {
      controls.addEventListener?.('start', () => {
        this.isUserControlling = true;
      });
      controls.addEventListener?.('end', () => {
        this.isUserControlling = false;
      });
    }
  }

  /**
   * Get the current camera state
   */
  private getCurrentCameraState(): CameraTarget {
    return {
      position: this.camera.position.clone(),
      quaternion: this.camera.quaternion.clone(),
    };
  }

  /**
   * Animate camera to a specific target transform
   * @param target - Target camera position and rotation
   * @param duration - Animation duration in seconds (default: 1.0)
   */
  public animateToCamera(target: CameraTarget, duration: number = this.defaultDuration): void {
    // Kill any existing animation
    this.stop();

    // Store current state
    const startPosition = this.camera.position.clone();
    const startQuaternion = this.camera.quaternion.clone();

    // Create animation timeline
    this.currentAnimation = gsap.timeline({
      onUpdate: () => {
        // Update OrbitControls target if provided and controls exist
        if (this.controls && target.lookAt) {
          this.controls.target.copy(target.lookAt);
        }
        // Update controls
        if (this.controls?.update) {
          this.controls.update();
        }
      },
      onComplete: () => {
        this.currentAnimation = undefined;
        // Final update to ensure controls are in sync
        if (this.controls?.update) {
          this.controls.update();
        }
      },
      onInterrupt: () => {
        this.currentAnimation = undefined;
      }
    });

    // Animate position
    this.currentAnimation.to(this.camera.position, {
      x: target.position.x,
      y: target.position.y,
      z: target.position.z,
      duration: duration,
      ease: this.defaultEase,
    }, 0); // Start at time 0

    // Animate rotation using quaternion
    // We need to animate the quaternion components directly
    const targetQuat = {
      x: target.quaternion.x,
      y: target.quaternion.y,
      z: target.quaternion.z,
      w: target.quaternion.w,
    };

    this.currentAnimation.to(this.camera.quaternion, {
      x: targetQuat.x,
      y: targetQuat.y,
      z: targetQuat.z,
      w: targetQuat.w,
      duration: duration,
      ease: this.defaultEase,
      onUpdate: () => {
        // Normalize quaternion to prevent drift
        this.camera.quaternion.normalize();
      }
    }, 0); // Start at time 0 (parallel with position)

    // If lookAt is provided, animate the controls target as well
    if (target.lookAt && this.controls?.target) {
      this.currentAnimation.to(this.controls.target, {
        x: target.lookAt.x,
        y: target.lookAt.y,
        z: target.lookAt.z,
        duration: duration,
        ease: this.defaultEase,
      }, 0);
    }
  }

  /**
   * Animate to the default/initial camera position
   * @param duration - Animation duration in seconds
   */
  public animateToDefault(duration: number = this.defaultDuration): void {
    this.animateToCamera(this.defaultCamera, duration);
  }

  /**
   * Stop the current animation
   */
  public stop(): void {
    if (this.currentAnimation) {
      this.currentAnimation.kill();
      this.currentAnimation = undefined;
    }
  }

  /**
   * Check if an animation is currently running
   */
  public isAnimating(): boolean {
    return this.currentAnimation !== undefined && this.currentAnimation.isActive();
  }

  /**
   * Update the default camera state (useful when user finds a good view)
   */
  public setDefaultCamera(target?: CameraTarget): void {
    if (target) {
      this.defaultCamera = target;
    } else {
      this.defaultCamera = this.getCurrentCameraState();
    }
  }

  /**
   * Get the default camera state
   */
  public getDefaultCamera(): CameraTarget {
    return {
      position: this.defaultCamera.position.clone(),
      quaternion: this.defaultCamera.quaternion.clone(),
    };
  }

  /**
   * Check if user is currently controlling the camera
   */
  public isUserActive(): boolean {
    return this.isUserControlling;
  }

  /**
   * Cleanup resources
   */
  public dispose(): void {
    this.stop();
  }
}
