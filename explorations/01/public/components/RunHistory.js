// public/components/RunHistory.ts
class RunHistory {
  container;
  refreshBtn;
  runs = [];
  selectedRunId = null;
  onRunSelect;
  refreshInterval;
  constructor(containerId, refreshBtnId) {
    this.container = document.getElementById(containerId);
    this.refreshBtn = document.getElementById(refreshBtnId);
    this.initializeEventListeners();
  }
  initializeEventListeners() {
    this.refreshBtn.addEventListener("click", () => {
      this.refresh();
    });
  }
  async fetchRuns() {
    try {
      const response = await fetch("/api/runs");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      return data.runs || [];
    } catch (error) {
      console.error("Failed to fetch runs:", error);
      return [];
    }
  }
  renderRuns() {
    if (this.runs.length === 0) {
      this.container.innerHTML = `
        <div class="loading-placeholder">
          No runs yet. Upload images to get started!
        </div>
      `;
      return;
    }
    const sortedRuns = [...this.runs].sort((a, b) => {
      return new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime();
    });
    this.container.innerHTML = sortedRuns.map((run) => this.renderRunItem(run)).join("");
    sortedRuns.forEach((run) => {
      const element = this.container.querySelector(`[data-run-id="${run.runId}"]`);
      element?.addEventListener("click", () => {
        this.selectRun(run.runId);
      });
    });
  }
  renderRunItem(run) {
    const isActive = run.runId === this.selectedRunId;
    const timestamp = this.formatTimestamp(run.requestedAt);
    const statusBadge = this.getStatusBadge(run.status);
    return `
      <div class="run-item ${isActive ? "active" : ""}" data-run-id="${run.runId}">
        <div class="run-header">
          <span class="run-id">${this.truncateId(run.runId)}</span>
          ${statusBadge}
        </div>
        <div class="run-meta">
          <div class="run-timestamp">${timestamp}</div>
          <div class="run-images">${run.images.length} image${run.images.length !== 1 ? "s" : ""}</div>
        </div>
        ${run.error ? `<div class="run-error" style="font-size: 0.7rem; color: var(--error); margin-top: 0.25rem;">${run.error}</div>` : ""}
      </div>
    `;
  }
  getStatusBadge(status) {
    return `<span class="run-badge ${status}">${status}</span>`;
  }
  formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const now = new Date;
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) {
      return "Just now";
    } else if (diffMins < 60) {
      return `${diffMins} min${diffMins !== 1 ? "s" : ""} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
    } else if (diffDays < 7) {
      return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
    } else {
      return date.toLocaleDateString();
    }
  }
  truncateId(id) {
    if (id.length <= 12) {
      return id;
    }
    return `${id.substring(0, 6)}...${id.substring(id.length - 4)}`;
  }
  selectRun(runId) {
    if (this.selectedRunId === runId) {
      this.selectedRunId = null;
      this.onRunSelect?.(null);
      this.renderRuns();
      return;
    }
    this.selectedRunId = runId;
    const run = this.runs.find((r) => r.runId === runId);
    if (run && this.onRunSelect) {
      this.onRunSelect(run);
    }
    this.renderRuns();
  }
  async refresh() {
    this.setLoading(true);
    this.runs = await this.fetchRuns();
    this.renderRuns();
    this.setLoading(false);
  }
  async load() {
    await this.refresh();
  }
  setLoading(loading) {
    if (loading) {
      this.refreshBtn.disabled = true;
      this.refreshBtn.style.opacity = "0.5";
    } else {
      this.refreshBtn.disabled = false;
      this.refreshBtn.style.opacity = "1";
    }
  }
  setOnRunSelect(callback) {
    this.onRunSelect = callback;
  }
  getSelectedRun() {
    if (!this.selectedRunId) {
      return null;
    }
    return this.runs.find((r) => r.runId === this.selectedRunId) || null;
  }
  addRun(run) {
    this.runs.unshift(run);
    this.renderRuns();
  }
  updateRun(runId, updates) {
    const index = this.runs.findIndex((r) => r.runId === runId);
    if (index !== -1) {
      this.runs[index] = { ...this.runs[index], ...updates };
      this.renderRuns();
    }
  }
  startAutoRefresh(intervalMs = 5000) {
    this.stopAutoRefresh();
    this.refreshInterval = window.setInterval(() => {
      this.refresh();
    }, intervalMs);
  }
  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
    }
  }
  destroy() {
    this.stopAutoRefresh();
  }
}
export {
  RunHistory
};
