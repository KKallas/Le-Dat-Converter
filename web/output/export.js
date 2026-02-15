// ------------------------------------------------------------------ //
// Export — build DAT file from rendered port previews
// ------------------------------------------------------------------ //

import { DATFile } from "../../js/datfile.js";
import { buildZip, downloadBlob } from "../core/utils.js";

/**
 * Export port data as a .dat file (or .dat + .txt zipped).
 * @param {object} config
 * @param {object[]} config.ports - flat ports array
 * @param {boolean} config.isImage - true for image, false for video
 * @param {number} config.fps - frames per second
 * @param {number} config.inPoint - start frame index
 * @param {number} config.outPoint - end frame index
 * @param {ArrayBuffer|null} config.templateHeaderBuffer - template .dat header
 * @param {boolean} config.includeTxt - include .txt in zip
 * @param {Map} config.portPreviewCanvases - rendered preview canvases per port
 * @param {Set} config.portDirty - set of ports needing render
 * @param {function} config.processMultiPortPreviews - render dirty ports
 * @param {function} config.setStatus - status callback
 * @param {function} config.setExporting - set exporting flag
 * @param {function} config.renderOutputSection - refresh output UI
 */
export async function doExport(config) {
  const {
    ports, isImage, fps, inPoint, outPoint,
    templateHeaderBuffer, includeTxt,
    portPreviewCanvases, portDirty,
    processMultiPortPreviews,
    setStatus, setExporting, renderOutputSection,
  } = config;

  const totalFrames = isImage ? 1 : (outPoint - inPoint + 1);

  if (totalFrames <= 0) {
    setStatus("Could not determine frame count.");
    return;
  }

  setExporting(true);
  renderOutputSection();
  const pBar = document.getElementById("progress-bar");
  const pFill = document.getElementById("progress-fill");
  if (pBar) pBar.style.display = "block";

  // Render any dirty ports first — single video pass for all dirty ports
  const dirtyPorts = ports.filter((p) => portDirty.has(p));
  if (dirtyPorts.length > 0) {
    setStatus(`Rendering ${dirtyPorts.length} port(s)...`);
    await processMultiPortPreviews(dirtyPorts);
  }

  // Build DAT from rendered preview canvases
  setStatus("Building DAT file...");
  await new Promise((r) => setTimeout(r, 0));

  const dat = new DATFile();
  if (templateHeaderBuffer) {
    dat.loadTemplateHeader(templateHeaderBuffer);
  }
  for (const port of ports) {
    dat.addUniverse(port.leds);
  }
  dat.setNumFrames(totalFrames);

  for (let pi = 0; pi < ports.length; pi++) {
    const port = ports[pi];
    const preview = portPreviewCanvases.get(port);
    if (!preview) continue;

    const ctx = preview.getContext("2d", { willReadFrequently: true });
    for (let f = 0; f < totalFrames; f++) {
      const row = ctx.getImageData(0, f, port.leds, 1).data;
      for (let p = 0; p < port.leds; p++) {
        dat.setPixel(pi, f, p, row[p * 4], row[p * 4 + 1], row[p * 4 + 2]);
      }
    }

    if (pFill) pFill.style.width = ((pi + 1) / ports.length * 100) + "%";
  }

  if (pFill) pFill.style.width = "100%";
  const totalLeds = ports.reduce((s, p) => s + p.leds, 0);

  // Download
  if (includeTxt) {
    setStatus("Packing zip...");
    await new Promise((r) => setTimeout(r, 0));
    const datBytes = dat.toUint8Array();
    const txtBytes = new TextEncoder().encode(dat.toTxt());
    const zip = buildZip([
      { name: "output.dat", data: datBytes },
      { name: "output.txt", data: txtBytes },
    ]);
    downloadBlob(zip, "output.zip");
  } else {
    dat.download("output.dat");
  }

  setStatus(`Done. ${totalFrames} frame(s), ${ports.length} port(s), ${totalLeds} total LEDs.`);
  setExporting(false);
  renderOutputSection();
  const pBar2 = document.getElementById("progress-bar");
  if (pBar2) pBar2.style.display = "none";
}
