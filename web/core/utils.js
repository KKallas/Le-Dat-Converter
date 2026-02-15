// ------------------------------------------------------------------ //
// Pure utilities — zero dependencies, no app state
// ------------------------------------------------------------------ //

// ---- ZIP builder (STORE, no compression) ----

export function buildZip(files) {
  const entries = [];
  let offset = 0;

  // Local file headers + data
  const localParts = [];
  for (const { name, data } of files) {
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(data);

    // Local file header (30 + nameLen bytes)
    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);  // signature
    lv.setUint16(4, 20, true);          // version needed
    lv.setUint16(8, 0, true);           // method: STORE
    lv.setUint32(14, crc, true);        // CRC-32
    lv.setUint32(18, data.length, true); // compressed size
    lv.setUint32(22, data.length, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lh.set(nameBytes, 30);

    entries.push({ nameBytes, crc, size: data.length, offset });
    localParts.push(lh, data);
    offset += lh.length + data.length;
  }

  // Central directory
  const cdParts = [];
  let cdSize = 0;
  for (const e of entries) {
    const cd = new Uint8Array(46 + e.nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);  // signature
    cv.setUint16(4, 20, true);          // version made by
    cv.setUint16(6, 20, true);          // version needed
    cv.setUint16(10, 0, true);          // method: STORE
    cv.setUint32(16, e.crc, true);
    cv.setUint32(20, e.size, true);
    cv.setUint32(24, e.size, true);
    cv.setUint16(28, e.nameBytes.length, true);
    cv.setUint32(42, e.offset, true);   // local header offset
    cd.set(e.nameBytes, 46);
    cdParts.push(cd);
    cdSize += cd.length;
  }

  // End of central directory
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...localParts, ...cdParts, eocd], { type: "application/zip" });
}

export function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Parse a STORE-method zip into { name, data } entries.
 * @param {ArrayBuffer} buffer
 * @returns {{ name: string, data: Uint8Array }[]}
 */
export function parseZip(buffer) {
  const view = new DataView(buffer);
  const files = [];
  let offset = 0;

  while (offset + 30 <= buffer.byteLength) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break;

    const compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);

    const nameBytes = new Uint8Array(buffer, offset + 30, nameLen);
    const name = new TextDecoder().decode(nameBytes);

    const dataStart = offset + 30 + nameLen + extraLen;
    const data = new Uint8Array(buffer.slice(dataStart, dataStart + compSize));

    files.push({ name, data });
    offset = dataStart + compSize;
  }

  return files;
}

// ---- Download / blob helpers ----

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Convert a canvas to a Uint8Array in the given format */
export function canvasToBlob(canvas, type = "image/png", quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)));
    }, type, quality);
  });
}

/** Convert an ImageBitmap or HTMLImageElement to a JPEG Uint8Array */
export function imageToJPEG(img, w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d").drawImage(img, 0, 0);
  return canvasToBlob(c, "image/jpeg", 0.50);
}
