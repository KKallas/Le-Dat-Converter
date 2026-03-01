/**
 * DAT file writer for LED controllers (DM1812, DMX, QED3110).
 *
 * Generates .dat blobs compatible with LEDBuild software and Huacan LED
 * controller hardware.
 *
 * Format: 512-byte header, then frames padded to 512-byte boundaries.
 * Each frame uses groups of (8 × controllerCount) bytes. Each LED uses
 * 3 consecutive groups for B, G, R channels. Reversed port byte order:
 * port N maps to byte (7 - N) within each controller's 8-byte block.
 *
 * Multi-controller: universes 0–7 → controller 1, 8–15 → controller 2, etc.
 *
 * @example
 *   import dm1812 from "./formats/dm1812.js";
 *   const dat = new DATFile(dm1812);
 *   dat.addUniverse(400);
 *   dat.setNumFrames(60);
 *   dat.setPixel(0, 0, 0, 255, 0, 0);
 *   const blob = dat.toBlob();
 */

const HEADER_SIZE = 512;
const PORTS_PER_CONTROLLER = 8;

export class DATFile {
  /**
   * Build a gamma lookup table for a given exponent.
   * @param {number} gamma
   * @returns {Uint8Array} 256-entry LUT
   */
  static buildGammaLut(gamma) {
    const lut = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      lut[i] = Math.round(Math.pow(i / 255, gamma) * 255);
    }
    return lut;
  }

  /**
   * @param {import("./formats/registry.js").FormatDescriptor|null} [format=null]
   *   Format descriptor. When null, falls back to legacy DM1812 defaults.
   * @param {number} [gamma=2.2] Gamma exponent for output encoding.
   */
  constructor(format = null, gamma = 2.2) {
    /** @type {import("./formats/registry.js").FormatDescriptor|null} */
    this._format = format;
    /** @type {number} */
    this._gamma = gamma;
    /** @type {Uint8Array} */
    this._gammaLut = DATFile.buildGammaLut(gamma);
    /** @type {number[]} LED count per universe (universe = port) */
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

  /** Max LEDs across all universes (determines frame group count). */
  get maxLedsPerPort() {
    let max = 0;
    for (const n of this._universes) if (n > max) max = n;
    return max;
  }

  /** Number of H801RC controllers needed (each has 8 ports). */
  get controllerCount() {
    return Math.ceil(this._universes.length / PORTS_PER_CONTROLLER) || 1;
  }

  /** Group size in bytes: 8 per controller. */
  get groupSize() {
    return PORTS_PER_CONTROLLER * this.controllerCount;
  }

  universeLeds(universe) {
    return this._universes[universe];
  }

  // -- building the animation ------------------------------------------- //

  /**
   * Add a universe (port) with the given number of LEDs.
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
   * Set a single pixel's RGB colour (linear, before gamma).
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
    this._pixelData = this._universes.map(() => new Uint8Array(0));
  }

  // -- output ----------------------------------------------------------- //

  /**
   * Build the full .dat file as a Uint8Array.
   *
   * Frame size = maxLedsPerPort * 3 * groupSize, padded to 512-byte boundary.
   * @returns {Uint8Array}
   */
  toUint8Array() {
    const header = this._buildHeader();

    const maxLeds = this.maxLedsPerPort;
    const grpSize = this.groupSize;
    const frameBytes = maxLeds * 3 * grpSize;
    const framePad = (512 - (frameBytes % 512)) % 512;
    const paddedFrame = frameBytes + framePad;

    const totalSize = HEADER_SIZE + this._numFrames * paddedFrame;
    const out = new Uint8Array(totalSize);

    out.set(header, 0);

    for (let idx = 0; idx < this._numFrames; idx++) {
      const frameData = this._buildFrame(idx);
      out.set(frameData, HEADER_SIZE + idx * paddedFrame);
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

  /**
   * Build the 512-byte header.
   * Uses the format descriptor when available, otherwise falls back to
   * legacy DM1812 defaults.
   * @private
   */
  _buildHeader() {
    const ctrlCount = this.controllerCount;
    const fmt = this._format;

    if (fmt) {
      return fmt.buildHeader(ctrlCount);
    }

    // Legacy fallback (DM1812 hardcoded)
    const hdr = new Uint8Array(HEADER_SIZE);
    hdr.set(new Uint8Array([0x00, 0x00, 0x48, 0x43]), 0);
    hdr.set(new Uint8Array([
      0x40, 0x40, 0x0a, 0x60, 0x40, 0x4a, 0x0a, 0x60,
      0x04, 0x08, 0x50, 0x32,
    ]), 4);
    hdr[16] = ctrlCount & 0xff;
    hdr[17] = (ctrlCount >> 8) & 0xff;
    hdr.set(new Uint8Array([
      0xb3, 0x2f, 0x76, 0x45, 0x28, 0x02, 0x83, 0xac,
      0xe3, 0x00, 0x04, 0xdf, 0x67, 0x43, 0x11, 0x40,
      0x08, 0xa0, 0xaf, 0xaf, 0xf5, 0xe9, 0xb4, 0xfb,
      0x15, 0x55, 0xb1, 0xaf, 0x7c, 0x45, 0x32, 0x22,
      0x85, 0xec, 0xec, 0x20, 0x0b, 0x9f, 0x7c, 0x03,
      0x17, 0x40, 0x0e, 0xe0, 0xb9, 0x8f, 0x83, 0x31,
      0x52, 0x70, 0x50, 0x55,
    ]), 18);
    return hdr;
  }

  /**
   * Build one frame with interleaved groups and BGR channel order.
   *
   * Group size = 8 × controllerCount. Each LED uses 3 consecutive groups
   * (B, G, R). Reversed port byte order: port N → byte (7 - N) within
   * each controller's 8-byte block.
   *
   * Values are gamma-corrected before writing.
   * @private
   */
  _buildFrame(frameIdx) {
    const maxLeds = this.maxLedsPerPort;
    const grpSize = this.groupSize;
    const frameBytes = maxLeds * 3 * grpSize;
    const buf = new Uint8Array(frameBytes);
    const lut = this._gammaLut;

    for (let uid = 0; uid < this.numUniverses; uid++) {
      const numLeds = this._universes[uid];
      const srcBase = frameIdx * numLeds * 3;
      const ctrlIdx = (uid / PORTS_PER_CONTROLLER) | 0;
      const localPort = uid % PORTS_PER_CONTROLLER;
      const bytePos = ctrlIdx * PORTS_PER_CONTROLLER + (7 - localPort);

      for (let led = 0; led < numLeds; led++) {
        const src = srcBase + led * 3;
        const r = this._pixelData[uid][src];
        const g = this._pixelData[uid][src + 1];
        const b = this._pixelData[uid][src + 2];

        // 3 groups per LED: B, G, R (each group is grpSize bytes)
        const groupBase = led * 3 * grpSize;
        buf[groupBase + bytePos] = lut[b];                    // B group
        buf[groupBase + grpSize + bytePos] = lut[g];          // G group
        buf[groupBase + 2 * grpSize + bytePos] = lut[r];      // R group
      }
    }

    return buf;
  }
}
