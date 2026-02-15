// ------------------------------------------------------------------ //
// Pure sampling utilities — pixel sampling along polylines
// ------------------------------------------------------------------ //

/**
 * Sample pixel colors along a polyline at evenly-spaced distances.
 * @param {CanvasRenderingContext2D} ctx - context with the frame drawn on it
 * @param {Array<{x:number, y:number}>} points - polyline control points
 * @param {number} numSamples - how many samples to take
 * @param {number} maxW - media width (for clamping)
 * @param {number} maxH - media height (for clamping)
 * @returns {Uint8Array} RGB data (numSamples * 3 bytes)
 */
export function samplePolyline(ctx, points, numSamples, maxW, maxH) {
  const out = new Uint8Array(numSamples * 3);

  const segLengths = [];
  let totalLength = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    segLengths.push(Math.sqrt(dx * dx + dy * dy));
    totalLength += segLengths[segLengths.length - 1];
  }

  if (totalLength === 0) {
    const px = Math.max(0, Math.min(points[0].x, maxW - 1));
    const py = Math.max(0, Math.min(points[0].y, maxH - 1));
    const pixel = ctx.getImageData(px, py, 1, 1).data;
    for (let i = 0; i < numSamples; i++) {
      out[i * 3] = pixel[0];
      out[i * 3 + 1] = pixel[1];
      out[i * 3 + 2] = pixel[2];
    }
    return out;
  }

  for (let i = 0; i < numSamples; i++) {
    const dist = numSamples === 1 ? 0 : (i / (numSamples - 1)) * totalLength;

    let remaining = dist;
    let seg = 0;
    while (seg < segLengths.length - 1 && remaining > segLengths[seg]) {
      remaining -= segLengths[seg];
      seg++;
    }

    const segLen = segLengths[seg] || 1;
    const t = Math.min(remaining / segLen, 1);
    const x = Math.round(points[seg].x + t * (points[seg + 1].x - points[seg].x));
    const y = Math.round(points[seg].y + t * (points[seg + 1].y - points[seg].y));

    const px = Math.max(0, Math.min(x, maxW - 1));
    const py = Math.max(0, Math.min(y, maxH - 1));

    const pixel = ctx.getImageData(px, py, 1, 1).data;
    out[i * 3] = pixel[0];
    out[i * 3 + 1] = pixel[1];
    out[i * 3 + 2] = pixel[2];
  }

  return out;
}

/**
 * Sample a port's polyline, applying trimStart/trimEnd (trimmed LEDs are black).
 * @param {CanvasRenderingContext2D} ctx
 * @param {{leds:number, trimStart:number, trimEnd:number, points:Array}} port
 * @param {number} maxW
 * @param {number} maxH
 * @returns {Uint8Array}
 */
export function samplePortLine(ctx, port, maxW, maxH) {
  const active = port.leds - port.trimStart - port.trimEnd;
  if (active <= 0) return new Uint8Array(port.leds * 3);
  const sampled = samplePolyline(ctx, port.points, active, maxW, maxH);
  const out = new Uint8Array(port.leds * 3); // all black
  out.set(sampled, port.trimStart * 3);
  return out;
}
