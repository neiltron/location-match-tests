// VGGT Settings
export interface VGGTSettings {
  confThreshold: number;        // 0-100 percentile
  predictionMode: 'pointmap' | 'depth';
  maskBlackBg: boolean;
  maskWhiteBg: boolean;
  maskSky: boolean;
  showCameras: boolean;
}

export const defaultSettings: VGGTSettings = {
  confThreshold: 45,
  predictionMode: 'pointmap',
  maskBlackBg: false,
  maskWhiteBg: false,
  maskSky: false,
  showCameras: true,
};

// Run Status
export type RunStatus = 'queued' | 'uploading' | 'processing' | 'fetching' | 'completed' | 'failed';

export interface VGGTRun {
  runId: string;
  status: RunStatus;
  settings: VGGTSettings;
  images: string[];           // Original filenames
  requestedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  parentRunId?: string;
  artifacts?: {
    glb?: string;             // Local path
    predictions?: string;      // Local path
  };
}

// API Request/Response types
export interface CreateRunRequest {
  settings: VGGTSettings;
}

export interface CreateRunResponse {
  runId: string;
  status: RunStatus;
}

export interface RunStatusResponse extends VGGTRun {}
