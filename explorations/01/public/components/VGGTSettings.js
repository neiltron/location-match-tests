// public/components/VGGTSettings.ts
var defaultSettings = {
  confThreshold: 45,
  predictionMode: "pointmap",
  maskBlackBg: false,
  maskWhiteBg: false,
  maskSky: false,
  showCameras: true
};

class VGGTSettings {
  form;
  confThresholdInput;
  confThresholdValue;
  predictionModeInputs;
  maskBlackBgInput;
  maskWhiteBgInput;
  maskSkyInput;
  showCamerasInput;
  submitBtn;
  onSettingsChange;
  onSubmit;
  constructor(formId, submitBtnId) {
    this.form = document.getElementById(formId);
    this.submitBtn = document.getElementById(submitBtnId);
    this.confThresholdInput = document.getElementById("confThreshold");
    this.confThresholdValue = document.getElementById("confThresholdValue");
    this.predictionModeInputs = document.querySelectorAll('input[name="predictionMode"]');
    this.maskBlackBgInput = document.getElementById("maskBlackBg");
    this.maskWhiteBgInput = document.getElementById("maskWhiteBg");
    this.maskSkyInput = document.getElementById("maskSky");
    this.showCamerasInput = document.getElementById("showCameras");
    this.initializeEventListeners();
    this.loadSettings();
  }
  initializeEventListeners() {
    this.confThresholdInput.addEventListener("input", () => {
      const value = this.confThresholdInput.value;
      this.confThresholdValue.textContent = value;
      this.notifyChange();
    });
    this.predictionModeInputs.forEach((input) => {
      input.addEventListener("change", () => {
        this.notifyChange();
      });
    });
    [
      this.maskBlackBgInput,
      this.maskWhiteBgInput,
      this.maskSkyInput,
      this.showCamerasInput
    ].forEach((input) => {
      input.addEventListener("change", () => {
        this.notifyChange();
      });
    });
    this.submitBtn.addEventListener("click", () => {
      this.handleSubmit();
    });
  }
  loadSettings() {
    const saved = localStorage.getItem("vggtSettings");
    if (saved) {
      try {
        const settings = JSON.parse(saved);
        this.setSettings(settings, { silent: true });
      } catch (e) {
        console.error("Failed to load saved settings:", e);
      }
    }
  }
  saveSettings() {
    const settings = this.getSettings();
    localStorage.setItem("vggtSettings", JSON.stringify(settings));
  }
  notifyChange() {
    const settings = this.getSettings();
    this.saveSettings();
    if (this.onSettingsChange) {
      this.onSettingsChange(settings);
    }
  }
  handleSubmit() {
    if (this.submitBtn.disabled) {
      return;
    }
    const settings = this.getSettings();
    if (!this.validateSettings(settings)) {
      return;
    }
    if (this.onSubmit) {
      this.onSubmit(settings);
    }
  }
  validateSettings(settings) {
    if (settings.confThreshold < 0 || settings.confThreshold > 100) {
      this.showError("Confidence threshold must be between 0 and 100");
      return false;
    }
    if (!["pointmap", "depth"].includes(settings.predictionMode)) {
      this.showError("Invalid prediction mode");
      return false;
    }
    return true;
  }
  showError(message) {
    console.error(message);
    alert(message);
  }
  getSettings() {
    let predictionMode = "pointmap";
    this.predictionModeInputs.forEach((input) => {
      if (input.checked) {
        predictionMode = input.value;
      }
    });
    return {
      confThreshold: parseInt(this.confThresholdInput.value, 10),
      predictionMode,
      maskBlackBg: this.maskBlackBgInput.checked,
      maskWhiteBg: this.maskWhiteBgInput.checked,
      maskSky: this.maskSkyInput.checked,
      showCameras: this.showCamerasInput.checked
    };
  }
  setSettings(settings, options = {}) {
    if (settings.confThreshold !== undefined) {
      this.confThresholdInput.value = settings.confThreshold.toString();
      this.confThresholdValue.textContent = settings.confThreshold.toString();
    }
    if (settings.predictionMode !== undefined) {
      this.predictionModeInputs.forEach((input) => {
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
  setSubmitEnabled(enabled) {
    this.submitBtn.disabled = !enabled;
  }
  setSubmitLoading(loading) {
    if (loading) {
      this.submitBtn.disabled = true;
      this.submitBtn.classList.add("loading");
      this.submitBtn.innerHTML = "<span>Processing...</span>";
    } else {
      this.submitBtn.disabled = false;
      this.submitBtn.classList.remove("loading");
      this.submitBtn.innerHTML = "<span>Process Images</span>";
    }
  }
  setOnSettingsChange(callback) {
    this.onSettingsChange = callback;
  }
  setOnSubmit(callback) {
    this.onSubmit = callback;
  }
  reset() {
    this.setSettings(defaultSettings);
    this.notifyChange();
  }
  getFormData() {
    const settings = this.getSettings();
    return {
      confThreshold: settings.confThreshold,
      predictionMode: settings.predictionMode,
      maskBlackBg: settings.maskBlackBg,
      maskWhiteBg: settings.maskWhiteBg,
      maskSky: settings.maskSky,
      showCameras: settings.showCameras
    };
  }
}
export {
  defaultSettings,
  VGGTSettings
};
