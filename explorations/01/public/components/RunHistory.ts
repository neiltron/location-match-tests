/**
 * RunHistory Component
 * Displays list of past runs and allows loading them
 */

export interface VGGTRun {
  runId: string;
  status: 'queued' | 'uploading' | 'processing' | 'fetching' | 'completed' | 'failed';
  settings: {
    confThreshold: number;
    predictionMode: 'pointmap' | 'depth';
    maskBlackBg: boolean;
    maskWhiteBg: boolean;
    maskSky: boolean;
    showCameras: boolean;
  };
  images: string[];
  requestedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  parentRunId?: string;
  artifacts?: {
    glb?: string;
    predictions?: string;
  };
}

export class RunHistory {
  private container: HTMLElement;
  private refreshBtn: HTMLButtonElement;
  private runs: VGGTRun[] = [];
  private selectedRunId: string | null = null;
  private onRunSelect?: (run: VGGTRun | null) => void;
  private refreshInterval?: number;

  constructor(containerId: string, refreshBtnId: string) {
    this.container = document.getElementById(containerId)!;
    this.refreshBtn = document.getElementById(refreshBtnId) as HTMLButtonElement;

    this.initializeEventListeners();
  }

  private initializeEventListeners(): void {
    this.refreshBtn.addEventListener('click', () => {
      this.refresh();
    });
  }

  private async fetchRuns(): Promise<VGGTRun[]> {
    try {
      const response = await fetch('/api/runs');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return data.runs || [];
    } catch (error) {
      console.error('Failed to fetch runs:', error);
      return [];
    }
  }

  private renderRuns(): void {
    if (this.runs.length === 0) {
      this.container.innerHTML = `
        <div class="loading-placeholder">
          No runs yet. Upload images to get started!
        </div>
      `;
      return;
    }

    // Sort runs by most recent first
    const sortedRuns = [...this.runs].sort((a, b) => {
      return new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime();
    });

    this.container.innerHTML = sortedRuns.map(run => this.renderRunItem(run)).join('');

    // Attach click handlers
    sortedRuns.forEach(run => {
      const element = this.container.querySelector(`[data-run-id="${run.runId}"]`);
      element?.addEventListener('click', () => {
        this.selectRun(run.runId);
      });
    });
  }

  private renderRunItem(run: VGGTRun): string {
    const isActive = run.runId === this.selectedRunId;
    const timestamp = this.formatTimestamp(run.requestedAt);
    const statusBadge = this.getStatusBadge(run.status);

    return `
      <div class="run-item ${isActive ? 'active' : ''}" data-run-id="${run.runId}">
        <div class="run-header">
          <span class="run-id">${this.truncateId(run.runId)}</span>
          ${statusBadge}
        </div>
        <div class="run-meta">
          <div class="run-timestamp">${timestamp}</div>
          <div class="run-images">${run.images.length} image${run.images.length !== 1 ? 's' : ''}</div>
        </div>
        ${run.error ? `<div class="run-error" style="font-size: 0.7rem; color: var(--error); margin-top: 0.25rem;">${run.error}</div>` : ''}
      </div>
    `;
  }

  private getStatusBadge(status: VGGTRun['status']): string {
    return `<span class="run-badge ${status}">${status}</span>`;
  }

  private formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
      return 'Just now';
    } else if (diffMins < 60) {
      return `${diffMins} min${diffMins !== 1 ? 's' : ''} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    } else if (diffDays < 7) {
      return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    } else {
      return date.toLocaleDateString();
    }
  }

  private truncateId(id: string): string {
    if (id.length <= 12) {
      return id;
    }
    return `${id.substring(0, 6)}...${id.substring(id.length - 4)}`;
  }

  private selectRun(runId: string): void {
    if (this.selectedRunId === runId) {
      // Deselect if clicking same run
      this.selectedRunId = null;
      this.onRunSelect?.(null);
      this.renderRuns();
      return;
    }

    this.selectedRunId = runId;
    const run = this.runs.find(r => r.runId === runId);

    if (run && this.onRunSelect) {
      this.onRunSelect(run);
    }

    this.renderRuns();
  }

  // Public API
  public async refresh(): Promise<void> {
    this.setLoading(true);
    this.runs = await this.fetchRuns();
    this.renderRuns();
    this.setLoading(false);
  }

  public async load(): Promise<void> {
    await this.refresh();
  }

  public setLoading(loading: boolean): void {
    if (loading) {
      this.refreshBtn.disabled = true;
      this.refreshBtn.style.opacity = '0.5';
    } else {
      this.refreshBtn.disabled = false;
      this.refreshBtn.style.opacity = '1';
    }
  }

  public setOnRunSelect(callback: (run: VGGTRun | null) => void): void {
    this.onRunSelect = callback;
  }

  public getSelectedRun(): VGGTRun | null {
    if (!this.selectedRunId) {
      return null;
    }
    return this.runs.find(r => r.runId === this.selectedRunId) || null;
  }

  public addRun(run: VGGTRun): void {
    // Add to beginning of list
    this.runs.unshift(run);
    this.renderRuns();
  }

  public updateRun(runId: string, updates: Partial<VGGTRun>): void {
    const index = this.runs.findIndex(r => r.runId === runId);
    if (index !== -1) {
      this.runs[index] = { ...this.runs[index], ...updates };
      this.renderRuns();
    }
  }

  public startAutoRefresh(intervalMs: number = 5000): void {
    this.stopAutoRefresh();
    this.refreshInterval = window.setInterval(() => {
      this.refresh();
    }, intervalMs);
  }

  public stopAutoRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
    }
  }

  public destroy(): void {
    this.stopAutoRefresh();
  }
}
