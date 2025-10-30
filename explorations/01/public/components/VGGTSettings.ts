/**
 * VGGTSettings Component
 * Manages VGGT configuration settings form
 */

export interface VGGTSettingsData {
  confThreshold: number;
  predictionMode: 'pointmap' | 'depth';
  maskBlackBg: boolean;
  maskWhiteBg: boolean;
  maskSky: boolean;
  showCameras: boolean;
}

export const defaultSettings: VGGTSettingsData = {
  confThreshold: 45,
  predictionMode: 'pointmap',
  maskBlackBg: false,
  maskWhiteBg: false,
  maskSky: false,
  showCameras: true,
};

export class VGGTSettings {
  private form: HTMLElement;
  private confThresholdInput: HTMLInputElement;
  private confThresholdValue: HTMLElement;
  private predictionModeInputs: NodeListOf<HTMLInputElement>;
  private maskBlackBgInput: HTMLInputElement;
  private maskWhiteBgInput: HTMLInputElement;
  private maskSkyInput: HTMLInputElement;
  private showCamerasInput: HTMLInputElement;
  private submitBtn: HTMLButtonElement;
  private onSettingsChange?: (settings: VGGTSettingsData) => void;
  private onSubmit?: (settings: VGGTSettingsData) => void;

  constructor(formId: string, submitBtnId: string) {
    this.form = document.getElementById(formId)!;
    this.submitBtn = document.getElementById(submitBtnId) as HTMLButtonElement;

    // Get all form inputs
    this.confThresholdInput = document.getElementById('confThreshold') as HTMLInputElement;
    this.confThresholdValue = document.getElementById('confThresholdValue')!;
    this.predictionModeInputs = document.querySelectorAll('input[name="predictionMode"]');
    this.maskBlackBgInput = document.getElementById('maskBlackBg') as HTMLInputElement;
    this.maskWhiteBgInput = document.getElementById('maskWhiteBg') as HTMLInputElement;
    this.maskSkyInput = document.getElementById('maskSky') as HTMLInputElement;
    this.showCamerasInput = document.getElementById('showCameras') as HTMLInputElement;

    this.initializeEventListeners();
    this.loadSettings();
  }

  private initializeEventListeners(): void {
    // Confidence threshold slider
    this.confThresholdInput.addEventListener('input', () => {
      const value = this.confThresholdInput.value;
      this.confThresholdValue.textContent = value;
      this.notifyChange();
    });

    // Prediction mode radio buttons
    this.predictionModeInputs.forEach(input => {
      input.addEventListener('change', () => {
        this.notifyChange();
      });
    });

    // Masking checkboxes
    [
      this.maskBlackBgInput,
      this.maskWhiteBgInput,
      this.maskSkyInput,
      this.showCamerasInput
    ].forEach(input => {
      input.addEventListener('change', () => {
        this.notifyChange();
      });
    });

    // Submit button
    this.submitBtn.addEventListener('click', () => {
      this.handleSubmit();
    });
  }

  private loadSettings(): void {
    // Load from localStorage if available
    const saved = localStorage.getItem('vggtSettings');
    if (saved) {
      try {
        const settings = JSON.parse(saved) as VGGTSettingsData;
        this.setSettings(settings, { silent: true });
      } catch (e) {
        console.error('Failed to load saved settings:', e);
      }
    }
  }

  private saveSettings(): void {
    const settings = this.getSettings();
    localStorage.setItem('vggtSettings', JSON.stringify(settings));
  }

  private notifyChange(): void {
    const settings = this.getSettings();
    this.saveSettings();

    if (this.onSettingsChange) {
      this.onSettingsChange(settings);
    }
  }

  private handleSubmit(): void {
    if (this.submitBtn.disabled) {
      return;
    }

    const settings = this.getSettings();

    // Validate settings
    if (!this.validateSettings(settings)) {
      return;
    }

    if (this.onSubmit) {
      this.onSubmit(settings);
    }
  }

  private validateSettings(settings: VGGTSettingsData): boolean {
    // Basic validation
    if (settings.confThreshold < 0 || settings.confThreshold > 100) {
      this.showError('Confidence threshold must be between 0 and 100');
      return false;
    }

    if (!['pointmap', 'depth'].includes(settings.predictionMode)) {
      this.showError('Invalid prediction mode');
      return false;
    }

    return true;
  }

  private showError(message: string): void {
    console.error(message);
    alert(message);
  }

  // Public API
  public getSettings(): VGGTSettingsData {
    // Get selected prediction mode
    let predictionMode: 'pointmap' | 'depth' = 'pointmap';
    this.predictionModeInputs.forEach(input => {
      if (input.checked) {
        predictionMode = input.value as 'pointmap' | 'depth';
      }
    });

    return {
      confThreshold: parseInt(this.confThresholdInput.value, 10),
      predictionMode,
      maskBlackBg: this.maskBlackBgInput.checked,
      maskWhiteBg: this.maskWhiteBgInput.checked,
      maskSky: this.maskSkyInput.checked,
      showCameras: this.showCamerasInput.checked,
    };
  }

  public setSettings(settings: Partial<VGGTSettingsData>, options: { silent?: boolean } = {}): void {
    if (settings.confThreshold !== undefined) {
      this.confThresholdInput.value = settings.confThreshold.toString();
      this.confThresholdValue.textContent = settings.confThreshold.toString();
    }

    if (settings.predictionMode !== undefined) {
      this.predictionModeInputs.forEach(input => {
        input.checked = input.value === settings.predictionMode;
      });
    }

    if (settings.maskBlackBg !== undefined) {
      this.maskBlackBgInput.checked = settings.maskBlackBg;
    }

    if (settings.maskWhiteBg !== undefined) {
      this.maskWhiteBgInput.checked = settings.maskWhiteBg;
    }

    if (settings.maskSky !== undefined) {
      this.maskSkyInput.checked = settings.maskSky;
    }

    if (settings.showCameras !== undefined) {
      this.showCamerasInput.checked = settings.showCameras;
    }

    if (options.silent) {
      this.saveSettings();
    } else {
      this.notifyChange();
    }
  }

  public setSubmitEnabled(enabled: boolean): void {
    this.submitBtn.disabled = !enabled;
  }

  public setSubmitLoading(loading: boolean): void {
    if (loading) {
      this.submitBtn.disabled = true;
      this.submitBtn.classList.add('loading');
      this.submitBtn.innerHTML = '<span>Processing...</span>';
    } else {
      this.submitBtn.disabled = false;
      this.submitBtn.classList.remove('loading');
      this.submitBtn.innerHTML = '<span>Process Images</span>';
    }
  }

  public setOnSettingsChange(callback: (settings: VGGTSettingsData) => void): void {
    this.onSettingsChange = callback;
  }

  public setOnSubmit(callback: (settings: VGGTSettingsData) => void): void {
    this.onSubmit = callback;
  }

  public reset(): void {
    this.setSettings(defaultSettings);
    this.notifyChange();
  }

  public getFormData(): Record<string, string | boolean | number> {
    const settings = this.getSettings();
    return {
      confThreshold: settings.confThreshold,
      predictionMode: settings.predictionMode,
      maskBlackBg: settings.maskBlackBg,
      maskWhiteBg: settings.maskWhiteBg,
      maskSky: settings.maskSky,
      showCameras: settings.showCameras,
    };
  }
}
