// public/components/ImageUploader.ts
class ImageUploader {
  uploadZone;
  fileInput;
  thumbnailGrid;
  uploadPrompt;
  imageCounter;
  images = new Map;
  onImagesChange;
  onThumbnailHover;
  constructor(uploadZoneId, fileInputId, thumbnailGridId, imageCounterId) {
    this.uploadZone = document.getElementById(uploadZoneId);
    this.fileInput = document.getElementById(fileInputId);
    this.thumbnailGrid = document.getElementById(thumbnailGridId);
    this.imageCounter = document.getElementById(imageCounterId);
    this.uploadPrompt = this.uploadZone.querySelector(".upload-prompt");
    this.initializeEventListeners();
  }
  initializeEventListeners() {
    this.uploadPrompt.addEventListener("click", () => {
      this.fileInput.click();
    });
    this.fileInput.addEventListener("change", (e) => {
      const target = e.target;
      if (target.files) {
        this.handleFiles(Array.from(target.files));
      }
      target.value = "";
    });
    this.uploadZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      this.uploadZone.classList.add("drag-over");
    });
    this.uploadZone.addEventListener("dragleave", (e) => {
      e.preventDefault();
      this.uploadZone.classList.remove("drag-over");
    });
    this.uploadZone.addEventListener("drop", (e) => {
      e.preventDefault();
      this.uploadZone.classList.remove("drag-over");
      const files = Array.from(e.dataTransfer?.files || []);
      this.handleFiles(files);
    });
    document.addEventListener("dragover", (e) => e.preventDefault());
    document.addEventListener("drop", (e) => e.preventDefault());
  }
  handleFiles(files) {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      this.showError("Please select image files only");
      return;
    }
    imageFiles.forEach((file) => {
      const id = this.generateId();
      const preview = URL.createObjectURL(file);
      this.images.set(id, { file, id, preview });
      this.addThumbnail(id, file.name, preview);
    });
    this.updateUI();
    this.notifyChange();
  }
  addThumbnail(id, filename, preview) {
    const item = document.createElement("div");
    item.className = "thumbnail-item";
    item.dataset.id = id;
    const img = document.createElement("img");
    img.src = preview;
    img.alt = filename;
    img.loading = "lazy";
    const removeBtn = document.createElement("button");
    removeBtn.className = "thumbnail-remove";
    removeBtn.innerHTML = "&times;";
    removeBtn.title = "Remove image";
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.removeImage(id);
    });
    const nameLabel = document.createElement("div");
    nameLabel.className = "thumbnail-name";
    nameLabel.textContent = filename;
    nameLabel.title = filename;
    item.addEventListener("mouseenter", () => {
      const imageFile = this.images.get(id);
      if (imageFile?.index !== undefined && this.onThumbnailHover) {
        this.onThumbnailHover(imageFile.index, "enter");
      }
    });
    item.addEventListener("mouseleave", () => {
      const imageFile = this.images.get(id);
      if (imageFile?.index !== undefined && this.onThumbnailHover) {
        this.onThumbnailHover(imageFile.index, "leave");
      }
    });
    item.appendChild(img);
    item.appendChild(removeBtn);
    item.appendChild(nameLabel);
    this.thumbnailGrid.appendChild(item);
  }
  removeImage(id) {
    const imageFile = this.images.get(id);
    if (imageFile) {
      URL.revokeObjectURL(imageFile.preview);
      this.images.delete(id);
      const thumbnail = this.thumbnailGrid.querySelector(`[data-id="${id}"]`);
      thumbnail?.remove();
      this.updateUI();
      this.notifyChange();
    }
  }
  updateUI() {
    const count = this.images.size;
    this.imageCounter.textContent = `${count} image${count !== 1 ? "s" : ""}`;
    if (count > 0) {
      this.uploadPrompt.style.display = "none";
      this.thumbnailGrid.style.display = "grid";
    } else {
      this.uploadPrompt.style.display = "block";
      this.thumbnailGrid.style.display = "none";
    }
  }
  notifyChange() {
    if (this.onImagesChange) {
      this.onImagesChange(Array.from(this.images.values()));
    }
  }
  generateId() {
    return `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  showError(message) {
    console.error(message);
    alert(message);
  }
  getImages() {
    return Array.from(this.images.values());
  }
  getImageCount() {
    return this.images.size;
  }
  clear() {
    this.images.forEach((img) => URL.revokeObjectURL(img.preview));
    this.images.clear();
    this.thumbnailGrid.innerHTML = "";
    this.updateUI();
    this.notifyChange();
  }
  setOnImagesChange(callback) {
    this.onImagesChange = callback;
  }
  setOnThumbnailHover(callback) {
    this.onThumbnailHover = callback;
  }
  updateImageIndices(indices) {
    indices.forEach((index, id) => {
      const imageFile = this.images.get(id);
      if (imageFile) {
        imageFile.index = index;
      }
    });
  }
  async getFormData() {
    const formData = new FormData;
    this.images.forEach((imageFile, index) => {
      formData.append(`image${index}`, imageFile.file);
    });
    return formData;
  }
  destroy() {
    this.images.forEach((img) => URL.revokeObjectURL(img.preview));
    this.images.clear();
  }
}
export {
  ImageUploader
};
