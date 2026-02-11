/**
 * DAT file writer for H803TC / H801RC / H802RA LED controllers.
 *
 * Generates .dat blobs compatible with LEDBuild software and Huacan LED
 * controller hardware. The binary format uses a 512-byte header followed
 * by frame data in BGR pixel order, each frame padded to a 512-byte boundary.
 *
 * @example
 *   const dat = new DATFile();
 *   dat.addUniverse(400);
 *   dat.addUniverse(400);
 *   dat.setNumFrames(60);
 *   dat.setPixel(0, 0, 0, 255, 0, 0);
 *   const blob = dat.toBlob();        // Blob ready for download
 *   const txt  = dat.toTxt();         // human-readable summary string
 */

const HEADER_SIZE = 512;

const MAGIC = new Uint8Array([0x00, 0x00, 0x48, 0x43]); // "HC"

const CONFIG_BYTES = new Uint8Array([
  0x40, 0x40, 0x0a, 0x60, 0x40, 0x4a, 0x0a, 0x60,
  0x04, 0x08, 0x50, 0x32,
]);

const EXTENDED_CONFIG = new Uint8Array([
  0xb3, 0x2f, 0x76, 0x45, 0x28, 0x02, 0x83, 0xac,
  0xe3, 0x00, 0x04, 0xdf, 0x67, 0x43, 0x11, 0x40,
  0x08, 0xa0, 0xaf, 0xaf, 0xf5, 0xe9, 0xb4, 0xfb,
  0x15, 0x55, 0xb1, 0xaf, 0x7c, 0x45, 0x32, 0x22,
  0x85, 0xec, 0xec, 0x20, 0x0b, 0x9f, 0x7c, 0x03,
  0x17, 0x40, 0x0e, 0xe0, 0xb9, 0x8f, 0x83, 0x31,
  0x52, 0x70, 0x50, 0x55,
]);

export class DATFile {
  constructor() {
    /** @type {number[]} LED count per universe */
    this._universes = [];
    /** @type {number} */
    this._numFrames = 0;
    /**
     * Pixel data per universe.
     * Each entry is a Uint8Array of length (numFrames * numLeds * 3), stored
     * as flat RGB: [frame0_pixel0_r, frame0_pixel0_g, frame0_pixel0_b, ...]
     * @type {Uint8Array[]}
     */
    this._pixelData = [];
    /** @type {Uint8Array|null} */
    this._templateHeader = null;
  }

  // -- properties ------------------------------------------------------- //

  get numUniverses() {
    return this._universes.length;
  }

  get numFrames() {
    return this._numFrames;
  }

  get totalPixels() {
    let sum = 0;
    for (const n of this._universes) sum += n;
    return sum;
  }

  universeLeds(universe) {
    return this._universes[universe];
  }

  // -- template header -------------------------------------------------- //

  /**
   * Load a template header from an existing .dat file's ArrayBuffer.
   * The first 512 bytes are kept and reused when building the output.
   * @param {ArrayBuffer} buffer
   */
  loadTemplateHeader(buffer) {
    this._templateHeader = new Uint8Array(buffer.slice(0, HEADER_SIZE));
  }

  // -- building the animation ------------------------------------------- //

  /**
   * Add a universe with the given number of LEDs.
   * @param {number} numLeds
   * @returns {number} The 0-based universe index.
   */
  addUniverse(numLeds) {
    if (numLeds <= 0) throw new RangeError(`numLeds must be positive, got ${numLeds}`);

    const uid = this._universes.length;
    this._universes.push(numLeds);

    this._pixelData.push(new Uint8Array(this._numFrames * numLeds * 3));

    return uid;
  }

  /**
   * Set the global frame count. New pixels are initialised to black (0).
   * Existing pixel data is preserved up to the new count.
   * @param {number} n
   */
  setNumFrames(n) {
    if (n <= 0) throw new RangeError(`Frame count must be positive, got ${n}`);

    const oldN = this._numFrames;
    this._numFrames = n;

    for (let i = 0; i < this._universes.length; i++) {
      const numLeds = this._universes[i];
      const newData = new Uint8Array(n * numLeds * 3);
      const oldData = this._pixelData[i];
      const copyBytes = Math.min(oldN, n) * numLeds * 3;
      if (copyBytes > 0) {
        newData.set(oldData.subarray(0, copyBytes));
      }
      this._pixelData[i] = newData;
    }
  }

  /**
   * Set a single pixel's RGB colour.
   * @param {number} universe
   * @param {number} frame
   * @param {number} pixel
   * @param {number} r 0-255
   * @param {number} g 0-255
   * @param {number} b 0-255
   */
  setPixel(universe, frame, pixel, r, g, b) {
    this._checkIndices(universe, frame, pixel);
    const numLeds = this._universes[universe];
    const offset = (frame * numLeds + pixel) * 3;
    this._pixelData[universe][offset] = r;
    this._pixelData[universe][offset + 1] = g;
    this._pixelData[universe][offset + 2] = b;
  }

  /**
   * Get a pixel's RGB colour.
   * @param {number} universe
   * @param {number} frame
   * @param {number} pixel
   * @returns {[number, number, number]}
   */
  getPixel(universe, frame, pixel) {
    this._checkIndices(universe, frame, pixel);
    const numLeds = this._universes[universe];
    const offset = (frame * numLeds + pixel) * 3;
    return [
      this._pixelData[universe][offset],
      this._pixelData[universe][offset + 1],
      this._pixelData[universe][offset + 2],
    ];
  }

  /**
   * Clear all frame data (keeps universe configuration).
   */
  clear() {
    this._numFrames = 0;
    this._pixelData = this._universes.map((n) => new Uint8Array(0));
  }

  // -- output ----------------------------------------------------------- //

  /**
   * Build the full .dat file as a Uint8Array.
   * @returns {Uint8Array}
   */
  toUint8Array() {
    const header = this._buildHeader();

    const frameBytes = this.totalPixels * 3;
    const framePad = (512 - (frameBytes % 512)) % 512;
    const paddedFrame = frameBytes + framePad;

    const totalSize = HEADER_SIZE + this._numFrames * paddedFrame;
    const out = new Uint8Array(totalSize);

    out.set(header, 0);

    for (let idx = 0; idx < this._numFrames; idx++) {
      const frameData = this._buildFrame(idx);
      out.set(frameData, HEADER_SIZE + idx * paddedFrame);
      // padding is already zeroed (Uint8Array default)
    }

    return out;
  }

  /**
   * Build the .dat file as a Blob (convenient for browser downloads).
   * @returns {Blob}
   */
  toBlob() {
    return new Blob([this.toUint8Array()], { type: "application/octet-stream" });
  }

  /**
   * Generate a human-readable .txt summary string.
   * @returns {string}
   */
  toTxt() {
    const lines = [`Universes: ${this.numUniverses}`];
    for (let i = 0; i < this._universes.length; i++) {
      lines.push(`Universe ${i}: ${this._universes[i]} LEDs`);
    }
    lines.push(`Frames: ${this._numFrames}`);
    return lines.join("\n") + "\n";
  }

  /**
   * Trigger a browser download of the .dat file.
   * @param {string} [filename="output.dat"]
   */
  download(filename = "output.dat") {
    const blob = this.toBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Trigger a browser download of the .txt summary.
   * @param {string} [filename="output.txt"]
   */
  downloadTxt(filename = "output.txt") {
    const blob = new Blob([this.toTxt()], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // -- internals -------------------------------------------------------- //

  /** @private */
  _checkIndices(universe, frame, pixel) {
    if (universe < 0 || universe >= this._universes.length) {
      throw new RangeError(`Universe ${universe} out of range [0, ${this._universes.length})`);
    }
    if (frame < 0 || frame >= this._numFrames) {
      throw new RangeError(`Frame ${frame} out of range [0, ${this._numFrames})`);
    }
    if (pixel < 0 || pixel >= this._universes[universe]) {
      throw new RangeError(`Pixel ${pixel} out of range [0, ${this._universes[universe]})`);
    }
  }

  /** @private */
  _buildHeader() {
    const hdr = new Uint8Array(HEADER_SIZE);

    if (this._templateHeader) {
      hdr.set(this._templateHeader.subarray(0, HEADER_SIZE));
      hdr[16] = this.numUniverses & 0xff;
      hdr[17] = (this.numUniverses >> 8) & 0xff;
      return hdr;
    }

    hdr.set(MAGIC, 0);
    hdr.set(CONFIG_BYTES, 4);
    hdr[16] = this.numUniverses & 0xff;
    hdr[17] = (this.numUniverses >> 8) & 0xff;
    hdr.set(EXTENDED_CONFIG, 18);

    return hdr;
  }

  /** @private */
  _buildFrame(frameIdx) {
    const buf = new Uint8Array(this.totalPixels * 3);
    let offset = 0;

    for (let uid = 0; uid < this.numUniverses; uid++) {
      const numLeds = this._universes[uid];
      const srcBase = frameIdx * numLeds * 3;

      for (let p = 0; p < numLeds; p++) {
        const src = srcBase + p * 3;
        // RGB -> BGR
        buf[offset] = this._pixelData[uid][src + 2];     // B
        buf[offset + 1] = this._pixelData[uid][src + 1];  // G
        buf[offset + 2] = this._pixelData[uid][src];       // R
        offset += 3;
      }
    }

    return buf;
  }
}
