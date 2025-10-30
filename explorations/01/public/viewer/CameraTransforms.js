/**
 * CameraTransforms.ts
 *
 * Converts VGGT camera data (OpenCV convention) to Three.js coordinate system
 * and creates visualization meshes for camera frustums.
 *
 * Transform pipeline (from vggt_integration_notes.md lines 45-75):
 * 1. Start with 3×4 extrinsic matrix (world→camera, OpenCV convention)
 * 2. Convert to 4×4 homogeneous matrix (add [0,0,0,1] row)
 * 3. Invert to get camera→world (camera position in world space)
 * 4. Apply OpenGL fix: diagonal [1, -1, -1, 1] to flip Y and Z axes
 * 5. Optional: 180° rotation around Y axis for VGGT viewer alignment
 * 6. Extract position (column 4) and rotation matrix (3×3 upper-left)
 */
import * as THREE from 'three';
/**
 * Camera transform conversion and frustum visualization utilities
 */
export class CameraTransforms {
    /**
     * Convert OpenCV extrinsic matrix (3×4, world→camera) to Three.js transform matrix
     *
     * Steps:
     * 1. Construct 4×4 homogeneous matrix from 3×4 extrinsic
     * 2. Invert to get camera→world transform
     * 3. Apply OpenGL coordinate fix (flip Y and Z)
     * 4. Apply 180° Y rotation for VGGT alignment
     *
     * @param extrinsic - 3×4 OpenCV extrinsic matrix (world→camera)
     * @param applyYRotation - Apply 180° Y rotation for VGGT viewer alignment
     * @returns Three.js 4×4 transform matrix
     */
    static extrinsicToThreeMatrix(extrinsic, applyYRotation = true) {
        // Step 1: Build 4×4 homogeneous matrix (world→camera)
        const worldToCam = new THREE.Matrix4();
        worldToCam.set(extrinsic[0][0], extrinsic[0][1], extrinsic[0][2], extrinsic[0][3], extrinsic[1][0], extrinsic[1][1], extrinsic[1][2], extrinsic[1][3], extrinsic[2][0], extrinsic[2][1], extrinsic[2][2], extrinsic[2][3], 0, 0, 0, 1);
        // Step 2: Invert to get camera→world
        const camToWorld = new THREE.Matrix4().copy(worldToCam).invert();
        // Step 3: Apply OpenGL coordinate fix (flip Y and Z axes)
        // This diagonal matrix converts from OpenCV to OpenGL convention
        const openglFix = new THREE.Matrix4().set(1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1);
        // Step 4: Optional 180° rotation around Y axis
        // Aligns with VGGT's viewer convention (cameras point down -Z)
        const alignY180 = new THREE.Matrix4().set(-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1);
        // Combine transforms: cam_to_world * opengl_fix * align_y180
        const threeMatrix = new THREE.Matrix4()
            .copy(camToWorld)
            .multiply(openglFix);
        if (applyYRotation) {
            threeMatrix.multiply(alignY180);
        }
        return threeMatrix;
    }
    /**
     * Extract position and rotation from a transform matrix
     *
     * @param matrix - 4×4 transform matrix
     * @returns Position vector and rotation quaternion
     */
    static getPositionAndRotation(matrix) {
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        matrix.decompose(position, quaternion, scale);
        return {
            position,
            quaternion,
            matrix: matrix.clone()
        };
    }
    /**
     * Extract field of view from intrinsic matrix
     *
     * Intrinsic matrix format:
     * [fx,  0, cx]
     * [ 0, fy, cy]
     * [ 0,  0,  1]
     *
     * FOV = 2 * atan(height / (2 * fy))
     *
     * @param intrinsic - 3×3 intrinsic matrix
     * @param imageHeight - Image height in pixels (default 518 per VGGT)
     * @returns Vertical FOV in degrees
     */
    static getFOVFromIntrinsic(intrinsic, imageHeight = 518) {
        const fy = intrinsic[1][1]; // Focal length in Y
        const fovRadians = 2 * Math.atan(imageHeight / (2 * fy));
        const fovDegrees = THREE.MathUtils.radToDeg(fovRadians);
        return fovDegrees;
    }
    /**
     * Create a camera frustum mesh for visualization
     *
     * The frustum is a wireframe pyramid showing the camera's field of view.
     * It includes:
     * - Wireframe lines showing the frustum edges
     * - A small sphere at the camera position
     * - Optional text label with camera index
     *
     * @param cameraData - Camera extrinsic/intrinsic data
     * @param color - Frustum color (default 0x00ff00)
     * @param label - Text label (default "Cam {imageIndex}")
     * @param frustumScale - Scale of frustum visualization (default 1.0)
     * @returns Group containing frustum geometry and label
     */
    static createFrustumMesh(cameraData, color = 0x00ff00, label, frustumScale = 1.0) {
        const group = new THREE.Group();
        group.name = `camera_${cameraData.imageIndex}`;
        // Get camera transform
        const matrix = this.extrinsicToThreeMatrix(cameraData.extrinsic);
        const { position, quaternion } = this.getPositionAndRotation(matrix);
        // Create camera position marker (small sphere)
        const markerGeometry = new THREE.SphereGeometry(0.05 * frustumScale, 8, 8);
        const markerMaterial = new THREE.MeshBasicMaterial({ color });
        const marker = new THREE.Mesh(markerGeometry, markerMaterial);
        marker.position.copy(position);
        group.add(marker);
        // Calculate FOV and create frustum geometry
        const fov = this.getFOVFromIntrinsic(cameraData.intrinsic);
        const aspect = cameraData.intrinsic[0][0] / cameraData.intrinsic[1][1]; // fx/fy
        const near = 0.1 * frustumScale;
        const far = 2.0 * frustumScale;
        // Create frustum lines
        const frustum = this.createFrustumGeometry(fov, aspect, near, far);
        const frustumMaterial = new THREE.LineBasicMaterial({
            color,
            linewidth: 2,
            transparent: true,
            opacity: 0.8
        });
        const frustumLines = new THREE.LineSegments(frustum, frustumMaterial);
        // Position and orient the frustum
        frustumLines.position.copy(position);
        frustumLines.quaternion.copy(quaternion);
        group.add(frustumLines);
        // Add text label (sprite-based for simplicity)
        const labelText = label || `Cam ${cameraData.imageIndex}`;
        const sprite = this.createTextSprite(labelText, color);
        sprite.position.copy(position);
        sprite.position.y += 0.2 * frustumScale; // Offset above camera
        group.add(sprite);
        // Store metadata
        group.userData = {
            imageIndex: cameraData.imageIndex,
            position: position.toArray(),
            rotation: quaternion.toArray(),
            fov,
            aspect
        };
        return group;
    }
    /**
     * Create frustum wireframe geometry
     *
     * Frustum is a truncated pyramid defined by:
     * - Near plane at distance 'near'
     * - Far plane at distance 'far'
     * - Field of view angle 'fov'
     *
     * @param fov - Vertical field of view in degrees
     * @param aspect - Aspect ratio (width/height)
     * @param near - Near plane distance
     * @param far - Far plane distance
     * @returns BufferGeometry with frustum line segments
     */
    static createFrustumGeometry(fov, aspect, near, far) {
        const geometry = new THREE.BufferGeometry();
        // Calculate frustum dimensions
        const fovRad = THREE.MathUtils.degToRad(fov);
        const nearHeight = 2 * Math.tan(fovRad / 2) * near;
        const nearWidth = nearHeight * aspect;
        const farHeight = 2 * Math.tan(fovRad / 2) * far;
        const farWidth = farHeight * aspect;
        // Near plane corners (in camera space, looking down -Z)
        const nw2 = nearWidth / 2;
        const nh2 = nearHeight / 2;
        const nearTL = [-nw2, nh2, -near];
        const nearTR = [nw2, nh2, -near];
        const nearBL = [-nw2, -nh2, -near];
        const nearBR = [nw2, -nh2, -near];
        // Far plane corners
        const fw2 = farWidth / 2;
        const fh2 = farHeight / 2;
        const farTL = [-fw2, fh2, -far];
        const farTR = [fw2, fh2, -far];
        const farBL = [-fw2, -fh2, -far];
        const farBR = [fw2, -fh2, -far];
        // Camera origin
        const origin = [0, 0, 0];
        // Define line segments
        const vertices = new Float32Array([
            // Near plane rectangle
            ...nearTL, ...nearTR,
            ...nearTR, ...nearBR,
            ...nearBR, ...nearBL,
            ...nearBL, ...nearTL,
            // Far plane rectangle
            ...farTL, ...farTR,
            ...farTR, ...farBR,
            ...farBR, ...farBL,
            ...farBL, ...farTL,
            // Connecting lines from origin to near plane
            ...origin, ...nearTL,
            ...origin, ...nearTR,
            ...origin, ...nearBL,
            ...origin, ...nearBR,
            // Connecting lines from near to far plane
            ...nearTL, ...farTL,
            ...nearTR, ...farTR,
            ...nearBL, ...farBL,
            ...nearBR, ...farBR
        ]);
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        return geometry;
    }
    /**
     * Create a text sprite for camera labels
     *
     * Uses canvas-based sprite for simple text rendering
     *
     * @param text - Label text
     * @param color - Text color
     * @returns Sprite with text texture
     */
    static createTextSprite(text, color) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        // Set canvas size
        canvas.width = 256;
        canvas.height = 64;
        // Draw text
        context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
        context.font = 'Bold 32px Arial';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, 128, 32);
        // Create sprite
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true
        });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(0.5, 0.125, 1);
        return sprite;
    }
    /**
     * Parse camera data from VGGT predictions.npz structure
     *
     * Expected structure:
     * - predictions.extrinsic: S×3×4 array
     * - predictions.intrinsic: S×3×3 array
     *
     * @param predictions - Parsed NPZ data object
     * @returns Array of camera data with indices
     */
    static parseNPZCameras(predictions) {
        const extrinsics = predictions.extrinsic; // Shape: [S, 3, 4]
        const intrinsics = predictions.intrinsic; // Shape: [S, 3, 3]
        if (!extrinsics || !intrinsics) {
            throw new Error('Missing extrinsic or intrinsic data in predictions');
        }
        const numFrames = extrinsics.length;
        const cameras = [];
        for (let i = 0; i < numFrames; i++) {
            cameras.push({
                extrinsic: extrinsics[i], // 3×4 matrix
                intrinsic: intrinsics[i], // 3×3 matrix
                imageIndex: i
            });
        }
        return { cameras, numFrames };
    }
    /**
     * Create frustum meshes for all cameras
     *
     * Applies different colors to cameras for visual distinction
     *
     * @param cameras - Array of camera data
     * @param frustumScale - Scale factor for frustum size (default 1.0)
     * @returns Array of frustum groups
     */
    static createAllFrustums(cameras, frustumScale = 1.0) {
        const frustums = [];
        // Generate colors using HSL for good distribution
        const colors = cameras.map((_, i) => {
            const hue = (i / cameras.length) * 360;
            return new THREE.Color().setHSL(hue / 360, 0.8, 0.5).getHex();
        });
        for (let i = 0; i < cameras.length; i++) {
            const frustum = this.createFrustumMesh(cameras[i], colors[i], `Cam ${i}`, frustumScale);
            frustums.push(frustum);
        }
        return frustums;
    }
    /**
     * Calculate scene bounding box from camera positions
     *
     * Useful for centering the view and setting camera controls
     *
     * @param cameras - Array of camera data
     * @returns Three.js Box3 bounding box
     */
    static calculateSceneBounds(cameras) {
        const box = new THREE.Box3();
        for (const camera of cameras) {
            const matrix = this.extrinsicToThreeMatrix(camera.extrinsic);
            const { position } = this.getPositionAndRotation(matrix);
            box.expandByPoint(position);
        }
        return box;
    }
    /**
     * Create a Three.js PerspectiveCamera from camera data
     *
     * @param cameraData - Camera extrinsic/intrinsic data
     * @param aspect - Viewport aspect ratio (overrides intrinsic aspect)
     * @returns Configured PerspectiveCamera
     */
    static createThreeCamera(cameraData, aspect) {
        const fov = this.getFOVFromIntrinsic(cameraData.intrinsic);
        const intrinsicAspect = cameraData.intrinsic[0][0] / cameraData.intrinsic[1][1];
        const camera = new THREE.PerspectiveCamera(fov, aspect || intrinsicAspect, 0.1, 1000);
        // Apply transform
        const matrix = this.extrinsicToThreeMatrix(cameraData.extrinsic);
        camera.matrixAutoUpdate = false;
        camera.matrix.copy(matrix);
        camera.updateMatrixWorld(true);
        return camera;
    }
}
/**
 * Helper function to convert Python-style nested arrays to TypeScript
 *
 * When loading from JSON, ensure arrays are properly structured:
 * - extrinsic: number[][] (3×4)
 * - intrinsic: number[][] (3×3)
 */
export function validateCameraData(data) {
    return (data &&
        Array.isArray(data.extrinsic) &&
        data.extrinsic.length === 3 &&
        data.extrinsic[0].length === 4 &&
        Array.isArray(data.intrinsic) &&
        data.intrinsic.length === 3 &&
        data.intrinsic[0].length === 3 &&
        typeof data.imageIndex === 'number');
}
