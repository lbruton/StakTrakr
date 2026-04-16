// IMAGE PROCESSOR — Canvas resize, compress, and format pipeline
// =============================================================================

/**
 * ImageProcessor provides client-side image processing using the Canvas API.
 * Handles resize, format selection (WebP with JPEG fallback), quality management,
 * and byte-budget enforcement via iterative quality reduction.
 *
 * Used by ImageCache for Numista CDN images and by the upload flow for user photos.
 *
 * @class
 */
class ImageProcessor {
  /**
   * @param {Object} [options]
   * @param {number} [options.maxDim=600]      - Max width/height in px
   * @param {number} [options.quality=0.75]     - Initial compression quality (0-1)
   * @param {number} [options.maxBytes=512000]  - Max output size in bytes
   * @param {number} [options.qualityStep=0.05] - Quality reduction step when over budget
   * @param {number} [options.minQuality=0.30]  - Floor quality to avoid excessive degradation
   */
  constructor(options = {}) {
    this.maxDim = options.maxDim ?? IMAGE_MAX_DIM ?? 600;
    this.quality = options.quality ?? IMAGE_QUALITY ?? 0.75;
    this.maxBytes = options.maxBytes ?? IMAGE_MAX_BYTES ?? 512000;
    this.qualityStep = options.qualityStep ?? 0.05;
    this.minQuality = options.minQuality ?? 0.3;

    /** @type {boolean|null} Cached WebP support detection result */
    this._webpSupported = null;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Process a File or Blob into a compressed, resized image.
   * @param {File|Blob} file - Input image file
   * @param {Object} [opts] - Override options for this call
   * @param {number} [opts.maxDim]   - Override max dimension
   * @param {number} [opts.quality]  - Override quality
   * @param {number} [opts.maxBytes] - Override max bytes
   * @returns {Promise<{blob: Blob, width: number, height: number, originalSize: number, compressedSize: number, format: string}|null>}
   */
  async processFile(file, opts = {}) {
    if (!file || !(file instanceof Blob)) return null;

    const originalSize = file.size;

    try {
      const bitmap = await createImageBitmap(file);
      const result = await this._processSource(bitmap, { ...opts, originalSize });
      bitmap.close();
      return result;
    } catch (err) {
      console.warn("ImageProcessor: processFile failed", err);
      return null;
    }
  }

  /**
   * Process an image from a URL into a compressed, resized blob.
   * @param {string} url - Image URL to fetch and process
   * @param {Object} [opts] - Override options
   * @returns {Promise<{blob: Blob, width: number, height: number, originalSize: number, compressedSize: number, format: string}|null>}
   */
  async processFromUrl(url, opts = {}) {
    if (!url || typeof url !== "string") return null;

    try {
      const resp = await fetch(url, { mode: "cors" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      return this.processFile(blob, opts);
    } catch (err) {
      console.warn("ImageProcessor: processFromUrl failed", err);
      return null;
    }
  }

  /**
   * Create an object URL preview from a Blob. Caller must revoke.
   * @param {Blob} blob
   * @returns {string|null} Object URL or null
   */
  createPreview(blob) {
    if (!blob || !(blob instanceof Blob)) return null;
    return URL.createObjectURL(blob);
  }

  /**
   * Estimate storage bytes for a blob (actual blob.size).
   * @param {Blob} blob
   * @returns {number}
   */
  estimateStorage(blob) {
    return blob?.size || 0;
  }

  /**
   * Detect whether the browser supports WebP encoding via Canvas.
   * Result is cached after first call.
   * @returns {Promise<boolean>}
   */
  async supportsWebP() {
    if (this._webpSupported !== null) return this._webpSupported;

    try {
      const c = document.createElement("canvas");
      c.width = 1;
      c.height = 1;
      const blob = await new Promise((resolve) => {
        c.toBlob((b) => resolve(b), "image/webp", 0.5);
      });
      this._webpSupported = !!(blob && blob.type === "image/webp");
    } catch {
      this._webpSupported = false;
    }

    return this._webpSupported;
  }

  // ---------------------------------------------------------------------------
  // Private pipeline
  // ---------------------------------------------------------------------------

  /**
   * Core processing pipeline: resize → compress → enforce byte budget.
   * @param {ImageBitmap|HTMLImageElement} source
   * @param {Object} opts
   * @returns {Promise<{blob: Blob, width: number, height: number, originalSize: number, compressedSize: number, format: string}|null>}
   */
  async _processSource(source, opts = {}) {
    const maxDim = opts.maxDim ?? this.maxDim;
    const maxBytes = opts.maxBytes ?? this.maxBytes;
    let quality = opts.quality ?? this.quality;

    // Calculate scaled dimensions maintaining aspect ratio
    let { width, height } = source;
    const scale = Math.min(maxDim / width, maxDim / height, 1);
    width = Math.round(width * scale);
    height = Math.round(height * scale);

    // Draw to canvas
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(source, 0, 0, width, height);

    // Determine output format
    const useWebP = await this.supportsWebP();
    const format = useWebP ? "image/webp" : "image/jpeg";

    // Compress with iterative quality reduction to meet byte budget
    let blob = await this._canvasToBlob(canvas, format, quality);
    if (!blob) return null;

    while (blob.size > maxBytes && quality > this.minQuality) {
      quality = Math.max(quality - this.qualityStep, this.minQuality);
      blob = await this._canvasToBlob(canvas, format, quality);
      if (!blob) return null;
    }

    return {
      blob,
      width,
      height,
      originalSize: opts.originalSize || 0,
      compressedSize: blob.size,
      format,
    };
  }

  /**
   * Convert a canvas to a Blob with the given format and quality.
   * @param {HTMLCanvasElement} canvas
   * @param {string} format - MIME type
   * @param {number} quality - 0-1
   * @returns {Promise<Blob|null>}
   */
  _canvasToBlob(canvas, format, quality) {
    return new Promise((resolve) => {
      try {
        canvas.toBlob((blob) => resolve(blob || null), format, quality);
      } catch {
        resolve(null);
      }
    });
  }
}

// Singleton instance exposed globally
const imageProcessor = new ImageProcessor();
if (typeof window !== "undefined") {
  window.imageProcessor = imageProcessor;
  window.ImageProcessor = ImageProcessor;
}
