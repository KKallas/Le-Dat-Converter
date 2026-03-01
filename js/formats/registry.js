/**
 * Format registry — imports all format descriptors and provides lookup.
 *
 * @typedef {Object} FormatDescriptor
 * @property {string} name - Unique identifier (e.g. "DM1812")
 * @property {string} label - Display label for UI
 * @property {number} controllerCountOffset - Header byte offset for controller count
 * @property {number} controllerCountWidth - 1 (uint8) or 2 (uint16 LE)
 * @property {(controllerCount: number) => Uint8Array} buildHeader - Build 512-byte header
 */

import dm1812 from "./dm1812.js";
import dmx from "./dmx.js";
import qed3110 from "./qed3110.js";

/** @type {FormatDescriptor[]} */
export const formats = [dm1812, dmx, qed3110];

/** @type {FormatDescriptor} */
export const defaultFormat = dm1812;

/**
 * Look up a format by name (case-insensitive).
 * Returns the default format if not found.
 * @param {string} name
 * @returns {FormatDescriptor}
 */
export function getFormat(name) {
  if (!name) return defaultFormat;
  const upper = name.toUpperCase();
  return formats.find((f) => f.name.toUpperCase() === upper) || defaultFormat;
}
