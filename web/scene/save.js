// ------------------------------------------------------------------ //
// Scene save — serialize state + pack into zip
// ------------------------------------------------------------------ //

import { buildZip, canvasToBlob, imageToJPEG } from "../core/utils.js";

/**
 * Serialize the current scene to a human-readable JS string.
 * @param {object} state - all app state needed for serialization
 * @param {Map|null} previewFileMap - maps port → filename in the zip
 */
export function serializeScene(state, previewFileMap) {
  const scene = {
    version: 1,
    portsPerController: state.portsPerController,
    maxResolution: state.maxResolution,
    frameOffset: state.frameOffset,
    frameLength: state.frameLength,
    detectedFPS: state.detectedFPS,
    mediaType: state.mediaType,
    mediaW: state.mediaW,
    mediaH: state.mediaH,
    frameCount: state.frames.length,
    inPoint: state.inPoint,
    outPoint: state.outPoint,
    templateHeader: state.templateHeaderBuffer
      ? btoa(String.fromCharCode(...new Uint8Array(state.templateHeaderBuffer.slice(0, 512))))
      : null,
    templateFileName: state.templateFileName,
    controllers: state.controllers.map((ctrl) => ({
      collapsed: ctrl.collapsed,
      ports: ctrl.ports.map((port) => {
        const p = {
          leds: port.leds,
          trimStart: port.trimStart,
          trimEnd: port.trimEnd,
          points: port.points.map((pt) => ({ x: pt.x, y: pt.y })),
          collapsed: port.collapsed,
          previewCollapsed: port.previewCollapsed,
          editMode: "points",
        };
        if (previewFileMap && previewFileMap.has(port)) {
          const canvas = state.portPreviewCanvases.get(port);
          p.previewFile = previewFileMap.get(port);
          p.previewMeta = {
            totalFrames: canvas._totalFrames || 1,
            fps: canvas._fps || 30,
            leds: canvas._leds || port.leds,
          };
        }
        return p;
      }),
    })),
  };

  return "// Le-Dat Converter Scene\n"
    + "// Load this file in the app to restore the scene.\n"
    + "const scene = " + JSON.stringify(scene, null, 2) + ";\n";
}

/**
 * Save the entire scene (state + media + previews) to a zip file.
 * @param {object} state - all app state
 * @param {function} setStatus - status update callback
 */
export async function saveScene(state, setStatus) {
  setStatus("Saving scene...");
  const zipFiles = [];
  const previewFileMap = new Map();

  // 1. Collect preview PNGs (pixel-exact, keep lossless)
  let ci = 0;
  for (const ctrl of state.controllers) {
    let pi = 0;
    for (const port of ctrl.ports) {
      const canvas = state.portPreviewCanvases.get(port);
      if (canvas) {
        const filename = `preview_${ci}_${pi}.png`;
        previewFileMap.set(port, filename);
        const pngBytes = await canvasToBlob(canvas);
        zipFiles.push({ name: filename, data: pngBytes });
      }
      pi++;
    }
    ci++;
  }

  // 2. Save media as JPEG (image or video frames)
  if (state.mediaType === "image" && state.loadedImage) {
    setStatus("Saving image...");
    const jpgBytes = await imageToJPEG(state.loadedImage, state.mediaW, state.mediaH);
    zipFiles.push({ name: "media.jpg", data: jpgBytes });
  } else if (state.mediaType === "video" && state.frames.length > 0) {
    for (let i = 0; i < state.frames.length; i++) {
      if (i % 10 === 0) {
        setStatus(`Saving frames (${i}/${state.frames.length})...`);
        await new Promise((r) => setTimeout(r, 0));
      }
      const buf = await state.frames[i].arrayBuffer();
      zipFiles.push({ name: `frames/${String(i).padStart(5, "0")}.jpg`, data: new Uint8Array(buf) });
    }
  }

  // 3. Build scene.js (after previews so previewFileMap is complete)
  setStatus("Packing zip...");
  await new Promise((r) => setTimeout(r, 0));
  const sceneText = serializeScene(state, previewFileMap);
  zipFiles.unshift({ name: "scene.js", data: new TextEncoder().encode(sceneText) });

  // 4. Build and download zip
  const zip = buildZip(zipFiles);
  const blob = new Blob([zip], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "scene.zip";
  a.click();
  URL.revokeObjectURL(url);

  setStatus("Scene saved.");
}
