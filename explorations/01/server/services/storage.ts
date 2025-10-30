import { mkdir, writeFile, readFile, readdir, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { VGGTRun } from '../types';

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
  generateRunId(): string {
    return `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  // Get directory paths for a run
  getRunPaths(runId: string) {
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
  async createRun(runId: string): Promise<void> {
    const { runDir, imagesDir } = this.getRunPaths(runId);
    await mkdir(imagesDir, { recursive: true });
  }

  // Save uploaded image
  async saveImage(runId: string, filename: string, data: Buffer): Promise<string> {
    const { imagesDir } = this.getRunPaths(runId);
    const filepath = join(imagesDir, filename);
    await writeFile(filepath, data);
    return filepath;
  }

  // Save run metadata
  async saveMetadata(runId: string, metadata: VGGTRun): Promise<void> {
    const { metadataPath } = this.getRunPaths(runId);
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  }

  // Load run metadata
  async loadMetadata(runId: string): Promise<VGGTRun | null> {
    const { metadataPath } = this.getRunPaths(runId);
    if (!existsSync(metadataPath)) return null;
    const data = await readFile(metadataPath, 'utf-8');
    return JSON.parse(data);
  }

  // List all runs
  async listRuns(): Promise<VGGTRun[]> {
    const dirs = await readdir(RUNS_DIR);
    const runs: VGGTRun[] = [];

    for (const dir of dirs) {
      if (!dir.startsWith('run_')) continue;
      const metadata = await this.loadMetadata(dir);
      if (metadata) runs.push(metadata);
    }

    // Sort by requestedAt descending
    return runs.sort((a, b) =>
      new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
    );
  }

  // Save artifact (GLB or NPZ)
  async saveArtifact(runId: string, type: 'glb' | 'predictions', data: Buffer): Promise<string> {
    const paths = this.getRunPaths(runId);
    const filepath = type === 'glb' ? paths.glbPath : paths.predictionsPath;
    await writeFile(filepath, data);
    return filepath;
  }

  // Check if artifact exists
  artifactExists(runId: string, type: 'glb' | 'predictions'): boolean {
    const paths = this.getRunPaths(runId);
    const filepath = type === 'glb' ? paths.glbPath : paths.predictionsPath;
    return existsSync(filepath);
  }

  // Copy images from one run to another
  async copyRunImages(sourceRunId: string, targetRunId: string): Promise<string[]> {
    const sourcePaths = this.getRunPaths(sourceRunId);
    const targetPaths = this.getRunPaths(targetRunId);

    await mkdir(targetPaths.imagesDir, { recursive: true });

    const files = await readdir(sourcePaths.imagesDir);
    const imageFiles = files
      .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
      .sort();

    for (const filename of imageFiles) {
      await copyFile(
        join(sourcePaths.imagesDir, filename),
        join(targetPaths.imagesDir, filename)
      );
    }

    return imageFiles;
  }
}

export const storage = new StorageService();
