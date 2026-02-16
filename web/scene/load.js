// ------------------------------------------------------------------ //
// Scene load — deserialize zip + restore state
// ------------------------------------------------------------------ //

import { parseZip } from "../core/utils.js";

/**
 * Deserialize a scene JS string and return the parsed scene + restored state.
 * The caller is responsible for applying the state to the app.
 * @param {string} text - the scene.js content
 * @param {Map<string, Uint8Array>|null} fileMap - zip entries keyed by filename
 * @param {function} setStatus - status update callback
 * @returns {Promise<object>} restored state object
 */
export async function deserializeScene(text, fileMap, setStatus) {
  const jsonMatch = text.match(/const\s+scene\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
  if (!jsonMatch) throw new Error("Invalid scene file format");

  const scene = JSON.parse(jsonMatch[1]);

  // Restore settings
  const result = {
    portsPerController: scene.portsPerController,
    maxResolution: scene.maxResolution,
    frameOffset: scene.frameOffset,
    frameLength: scene.frameLength,
    detectedFPS: scene.detectedFPS,
    mediaType: scene.mediaType || "",
    mediaW: scene.mediaW || 0,
    mediaH: scene.mediaH || 0,
    inPoint: scene.inPoint ?? 0,
    outPoint: scene.outPoint ?? 0,
    templateFileName: scene.templateFileName || "",
    templateHeaderBuffer: null,
    loadedImage: null,
    frames: [],
    controllers: [],
  };

  // Restore template header
  if (scene.templateHeader) {
    const binary = atob(scene.templateHeader);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    result.templateHeaderBuffer = bytes.buffer;
  }

  // Restore media content from zip
  if (fileMap) {
    const mediaFile = fileMap.get("media.jpg") || fileMap.get("media.png");
    if (scene.mediaType === "image" && mediaFile) {
      setStatus("Loading image...");
      const blob = new Blob([mediaFile], { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      result.loadedImage = new Image();
      await new Promise((resolve) => { result.loadedImage.onload = resolve; result.loadedImage.src = url; });
      URL.revokeObjectURL(url);
    } else if (scene.mediaType === "video") {
      const frameCount = scene.frameCount || 0;
      for (let i = 0; i < frameCount; i++) {
        const pad = String(i).padStart(5, "0");
        const data = fileMap.get(`frames/${pad}.jpg`) || fileMap.get(`frames/${pad}.png`);
        if (!data) break;
        if (i % 10 === 0) {
          setStatus(`Loading frames (${i}/${frameCount})...`);
          await new Promise((r) => setTimeout(r, 0));
        }
        result.frames.push(new Blob([data], { type: "image/jpeg" }));
      }
    }
  }

  // Clamp in/out points to frame range
  if (result.frames.length > 0) {
    result.inPoint = Math.max(0, Math.min(result.inPoint, result.frames.length - 1));
    result.outPoint = Math.max(result.inPoint, Math.min(result.outPoint, result.frames.length - 1));
  }

  // Restore controllers and ports
  const portDataList = [];
  for (const ctrl of scene.controllers) {
    const controller = { ports: [], collapsed: ctrl.collapsed ?? false };
    for (const portData of ctrl.ports) {
      const port = {
        leds: portData.leds ?? 400,
        trimStart: portData.trimStart ?? 0,
        trimEnd: portData.trimEnd ?? 0,
        points: (portData.points || []).map((p) => ({ x: p.x, y: p.y })),
        collapsed: portData.collapsed ?? false,
        previewCollapsed: portData.previewCollapsed ?? true,
        editMode: portData.editMode ?? "points",
      };
      controller.ports.push(port);
      portDataList.push(portData);
    }
    result.controllers.push(controller);
  }

  // Restore preview canvases from PNGs
  const previewCanvases = new Map();
  const allPorts = result.controllers.flatMap((c) => c.ports);
  if (fileMap) {
    for (let i = 0; i < allPorts.length; i++) {
      const pd = portDataList[i];
      if (!pd || !pd.previewFile || !fileMap.has(pd.previewFile)) continue;

      const pngData = fileMap.get(pd.previewFile);
      const blob = new Blob([pngData], { type: "image/png" });
      const bmp = await createImageBitmap(blob);

      const canvas = document.createElement("canvas");
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      canvas.getContext("2d").drawImage(bmp, 0, 0);
      bmp.close();

      const meta = pd.previewMeta || {};
      canvas._totalFrames = meta.totalFrames || canvas.height;
      canvas._fps = meta.fps || 30;
      canvas._leds = meta.leds || canvas.width;

      previewCanvases.set(allPorts[i], canvas);
    }
  }
  result.previewCanvases = previewCanvases;

  return result;
}

/**
 * Open a file picker and load a scene from zip or JS file.
 * @param {function} applyScene - callback that receives the deserialized result and applies it
 * @param {function} setStatus - status update callback
 */
export function loadScene(applyScene, setStatus) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".zip,.js";
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;

    try {
      let result;
      if (file.name.endsWith(".js") || file.name.endsWith(".json") || file.name.endsWith(".txt")) {
        const text = await file.text();
        result = await deserializeScene(text, null, setStatus);
      } else {
        setStatus("Loading scene...");
        const buffer = await file.arrayBuffer();
        const entries = parseZip(buffer);

        const sceneEntry = entries.find((e) => e.name === "scene.js");
        if (!sceneEntry) throw new Error("No scene.js found in archive");

        const fileMap = new Map();
        for (const e of entries) {
          if (e.name !== "scene.js") fileMap.set(e.name, e.data);
        }

        const text = new TextDecoder().decode(sceneEntry.data);
        result = await deserializeScene(text, fileMap, setStatus);
      }

      applyScene(result);
      setStatus(`Scene loaded from ${file.name}`);
    } catch (e) {
      setStatus(`Failed to load scene: ${e.message}`);
    }
  });
  input.click();
}
