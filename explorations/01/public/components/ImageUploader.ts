/**
 * ImageUploader Component
 * Handles drag & drop file upload, thumbnail preview, and image management
 */

export interface ImageFile {
  file: File;
  id: string;
  preview: string;
  index?: number; // Index for camera mapping
}

export class ImageUploader {
  private uploadZone: HTMLElement;
  private fileInput: HTMLInputElement;
  private thumbnailGrid: HTMLElement;
  private uploadPrompt: HTMLElement;
  private imageCounter: HTMLElement;
  private images: Map<string, ImageFile> = new Map();
  private onImagesChange?: (images: ImageFile[]) => void;
  private onThumbnailHover?: (index: number, event: 'enter' | 'leave') => void;

  constructor(
    uploadZoneId: string,
    fileInputId: string,
    thumbnailGridId: string,
    imageCounterId: string
  ) {
    this.uploadZone = document.getElementById(uploadZoneId)!;
    this.fileInput = document.getElementById(fileInputId) as HTMLInputElement;
    this.thumbnailGrid = document.getElementById(thumbnailGridId)!;
    this.imageCounter = document.getElementById(imageCounterId)!;
    this.uploadPrompt = this.uploadZone.querySelector('.upload-prompt')!;

    this.initializeEventListeners();
  }

  private initializeEventListeners(): void {
    // Click to browse
    this.uploadPrompt.addEventListener('click', () => {
      this.fileInput.click();
    });

    // File input change
    this.fileInput.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      if (target.files) {
        this.handleFiles(Array.from(target.files));
      }
      // Reset input to allow re-selecting same files
      target.value = '';
    });

    // Drag & drop
    this.uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.uploadZone.classList.add('drag-over');
    });

    this.uploadZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      this.uploadZone.classList.remove('drag-over');
    });

    this.uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.uploadZone.classList.remove('drag-over');

      const files = Array.from(e.dataTransfer?.files || []);
      this.handleFiles(files);
    });

    // Prevent default drag behavior on document
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => e.preventDefault());
  }

  private handleFiles(files: File[]): void {
    // Filter for image files only
    const imageFiles = files.filter(file => file.type.startsWith('image/'));

    if (imageFiles.length === 0) {
      this.showError('Please select image files only');
      return;
    }

    // Add each image
    imageFiles.forEach(file => {
      const id = this.generateId();
      const preview = URL.createObjectURL(file);

      this.images.set(id, { file, id, preview });
      this.addThumbnail(id, file.name, preview);
    });

    this.updateUI();
    this.notifyChange();
  }

  private addThumbnail(id: string, filename: string, preview: string): void {
    const item = document.createElement('div');
    item.className = 'thumbnail-item';
    item.dataset.id = id;

    const img = document.createElement('img');
    img.src = preview;
    img.alt = filename;
    img.loading = 'lazy';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'thumbnail-remove';
    removeBtn.innerHTML = '&times;';
    removeBtn.title = 'Remove image';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.removeImage(id);
    });

    const nameLabel = document.createElement('div');
    nameLabel.className = 'thumbnail-name';
    nameLabel.textContent = filename;
    nameLabel.title = filename;

    // Add hover events for camera animation
    item.addEventListener('mouseenter', () => {
      const imageFile = this.images.get(id);
      if (imageFile?.index !== undefined && this.onThumbnailHover) {
        this.onThumbnailHover(imageFile.index, 'enter');
      }
    });

    item.addEventListener('mouseleave', () => {
      const imageFile = this.images.get(id);
      if (imageFile?.index !== undefined && this.onThumbnailHover) {
        this.onThumbnailHover(imageFile.index, 'leave');
      }
    });

    item.appendChild(img);
    item.appendChild(removeBtn);
    item.appendChild(nameLabel);
    this.thumbnailGrid.appendChild(item);
  }

  private removeImage(id: string): void {
    const imageFile = this.images.get(id);
    if (imageFile) {
      // Revoke object URL to free memory
      URL.revokeObjectURL(imageFile.preview);
      this.images.delete(id);

      // Remove thumbnail from DOM
      const thumbnail = this.thumbnailGrid.querySelector(`[data-id="${id}"]`);
      thumbnail?.remove();

      this.updateUI();
      this.notifyChange();
    }
  }

  private updateUI(): void {
    const count = this.images.size;
    this.imageCounter.textContent = `${count} image${count !== 1 ? 's' : ''}`;

    // Toggle visibility
    if (count > 0) {
      this.uploadPrompt.style.display = 'none';
      this.thumbnailGrid.style.display = 'grid';
    } else {
      this.uploadPrompt.style.display = 'block';
      this.thumbnailGrid.style.display = 'none';
    }
  }

  private notifyChange(): void {
    if (this.onImagesChange) {
      this.onImagesChange(Array.from(this.images.values()));
    }
  }

  private generateId(): string {
    return `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private showError(message: string): void {
    // Simple error display (could be enhanced with toast notifications)
    console.error(message);
    alert(message);
  }

  // Public API
  public getImages(): ImageFile[] {
    return Array.from(this.images.values());
  }

  public getImageCount(): number {
    return this.images.size;
  }

  public clear(): void {
    // Clean up object URLs
    this.images.forEach(img => URL.revokeObjectURL(img.preview));
    this.images.clear();
    this.thumbnailGrid.innerHTML = '';
    this.updateUI();
    this.notifyChange();
  }

  public setOnImagesChange(callback: (images: ImageFile[]) => void): void {
    this.onImagesChange = callback;
  }

  public setOnThumbnailHover(callback: (index: number, event: 'enter' | 'leave') => void): void {
    this.onThumbnailHover = callback;
  }

  public updateImageIndices(indices: Map<string, number>): void {
    // Update the index for each image (used for camera mapping)
    indices.forEach((index, id) => {
      const imageFile = this.images.get(id);
      if (imageFile) {
        imageFile.index = index;
      }
    });
  }

  public async getFormData(): Promise<FormData> {
    const formData = new FormData();

    this.images.forEach((imageFile, index) => {
      formData.append(`image${index}`, imageFile.file);
    });

    return formData;
  }

  public destroy(): void {
    // Clean up object URLs to prevent memory leaks
    this.images.forEach(img => URL.revokeObjectURL(img.preview));
    this.images.clear();
  }
}
