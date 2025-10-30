import { mkdir, writeFile, readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
const STORAGE_ROOT = join(process.cwd(), 'storage');
const UPLOADS_DIR = join(STORAGE_ROOT, 'uploads');
const RUNS_DIR = join(STORAGE_ROOT, 'runs');
export class StorageService {
    async init() {
        // Ensure directories exist
        await mkdir(UPLOADS_DIR, { recursive: true });
        await mkdir(RUNS_DIR, { recursive: true });
    }
    // Generate unique run ID
    generateRunId() {
        return `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    }
    // Get directory paths for a run
    getRunPaths(runId) {
        const runDir = join(RUNS_DIR, runId);
        return {
            runDir,
            imagesDir: join(runDir, 'images'),
            metadataPath: join(runDir, 'metadata.json'),
            predictionsPath: join(runDir, 'predictions.npz'),
            glbPath: join(runDir, 'scene.glb'),
        };
    }
    // Create run directory structure
    async createRun(runId) {
        const { runDir, imagesDir } = this.getRunPaths(runId);
        await mkdir(imagesDir, { recursive: true });
    }
    // Save uploaded image
    async saveImage(runId, filename, data) {
        const { imagesDir } = this.getRunPaths(runId);
        const filepath = join(imagesDir, filename);
        await writeFile(filepath, data);
        return filepath;
    }
    // Save run metadata
    async saveMetadata(runId, metadata) {
        const { metadataPath } = this.getRunPaths(runId);
        await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    }
    // Load run metadata
    async loadMetadata(runId) {
        const { metadataPath } = this.getRunPaths(runId);
        if (!existsSync(metadataPath))
            return null;
        const data = await readFile(metadataPath, 'utf-8');
        return JSON.parse(data);
    }
    // List all runs
    async listRuns() {
        const dirs = await readdir(RUNS_DIR);
        const runs = [];
        for (const dir of dirs) {
            if (!dir.startsWith('run_'))
                continue;
            const metadata = await this.loadMetadata(dir);
            if (metadata)
                runs.push(metadata);
        }
        // Sort by requestedAt descending
        return runs.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
    }
    // Save artifact (GLB or NPZ)
    async saveArtifact(runId, type, data) {
        const paths = this.getRunPaths(runId);
        const filepath = type === 'glb' ? paths.glbPath : paths.predictionsPath;
        await writeFile(filepath, data);
        return filepath;
    }
    // Check if artifact exists
    artifactExists(runId, type) {
        const paths = this.getRunPaths(runId);
        const filepath = type === 'glb' ? paths.glbPath : paths.predictionsPath;
        return existsSync(filepath);
    }
}
export const storage = new StorageService();
