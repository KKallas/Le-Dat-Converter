import { samplePolyline as _samplePolyline, samplePortLine as _samplePortLine } from "./renderer/sampling.js";
import * as player from "./player/player.js";
import * as viewport from "./player/viewport.js";
import * as viewerToolbar from "./player/viewer-toolbar.js";
import * as rack from "./rack/rack.js";
import * as toolbar from "./tools/toolbar.js";
import { saveScene as _saveScene } from "./scene/save.js";
import { loadScene as _loadScene } from "./scene/load.js";
import { doExport as _doExport } from "./output/export.js";
import {
  rebuildPortsList as _rebuildPorts, createController, createPort,
  firstFlatIndex, addPointToPort as _addPoint, removePointFromPort as _removePoint,
} from "./rack/port-model.js";

// ------------------------------------------------------------------ //
// DOM refs
// ------------------------------------------------------------------ //

const mediaInput = document.createElement("input");
mediaInput.type = "file";
mediaInput.accept = "video/*,image/*";
mediaInput.style.cssText = "font-size:0.85rem";
const video = document.getElementById("video");
const videoWrap = document.getElementById("video-wrap");
const overlay = document.getElementById("overlay");
const overlayCtx = overlay.getContext("2d");

const portsList = document.getElementById("ports-list");
const addPortBtn = document.getElementById("add-port-btn");
const outputSection = document.getElementById("output-section");
const toolbarEl = document.getElementById("toolbar");

// ------------------------------------------------------------------ //
// Constants
// ------------------------------------------------------------------ //

// PORT_COLORS now lives in rack/rack.js

const DRAG_INTERVAL = 20; // ~50fps throttle for drag updates

// ------------------------------------------------------------------ //
// State
// ------------------------------------------------------------------ //

/**
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{ leds: number, trimStart: number, trimEnd: number, points: Point[], collapsed: boolean, previewCollapsed: boolean, editMode: string }} Port
 * @typedef {{ ports: Port[], collapsed: boolean }} Controller
 */

/** @type {Controller[]} */
let controllers = [];

/** Flat derived list of all ports (rebuilt via rebuildPortsList) */
let ports = [];

/** Max ports per controller (output setting) */
let portsPerController = 8;

/** Max resolution (longer side) for imported media frames */
let maxResolution = 1280;

/** Frame offset — skip this many frames from the start during extraction */
let frameOffset = 0;

/** Max frame length — extract at most this many frames (0 = entire file) */
let frameLength = 2000;

/** Currently focused point: { port, point } where port is flat index, or null */
let activeSelection = null;

/** Multi-point selection — Set of "portIdx:pointIdx" keys */
const selectedPoints = new Set();

// Selection helpers
function isPointSelected(pi, pti) { return selectedPoints.has(`${pi}:${pti}`); }

function selectPoint(pi, pti) {
  selectedPoints.clear();
  selectedPoints.add(`${pi}:${pti}`);
  activeSelection = { port: pi, point: pti };
  toolbar.onSelectionChanged();
}

function togglePoint(pi, pti) {
  const key = `${pi}:${pti}`;
  if (selectedPoints.has(key)) selectedPoints.delete(key);
  else selectedPoints.add(key);
  activeSelection = { port: pi, point: pti };
  toolbar.onSelectionChanged();
}

function selectAllInPort(pi) {
  const port = ports[pi];
  if (!port) return;
  for (let i = 0; i < port.points.length; i++) selectedPoints.add(`${pi}:${i}`);
  if (port.points.length > 0) activeSelection = { port: pi, point: 0 };
  toolbar.onSelectionChanged();
}

function selectAllInController(ci) {
  const ctrl = controllers[ci];
  if (!ctrl) return;
  let flatIdx = firstFlatIndex(controllers, ci);
  for (const port of ctrl.ports) {
    for (let i = 0; i < port.points.length; i++) selectedPoints.add(`${flatIdx}:${i}`);
    flatIdx++;
  }
  toolbar.onSelectionChanged();
}

function clearSelection() {
  selectedPoints.clear();
  activeSelection = null;
  toolbar.onSelectionChanged();
}

/** Get all selected points as objects */
function getSelectedPointObjects() {
  const result = [];
  for (const key of selectedPoints) {
    const [pi, pti] = key.split(":").map(Number);
    if (ports[pi] && ports[pi].points[pti]) {
      result.push({ portIdx: pi, pointIdx: pti, point: ports[pi].points[pti] });
    }
  }
  return result;
}

let mediaReady = false;
let mediaType = ""; // "video" or "image"
let detectedFPS = 0;
/** @type {HTMLImageElement|null} */
let loadedImage = null;
let mediaW = 0;
let mediaH = 0;
/** Offscreen canvas for live line sampling */
let sampleCanvas = null;
let sampleCtx = null;

// Drag state
let dragging = false;
let lastDragUpdate = 0;

// Template header from a LEDBuild .dat file
/** @type {ArrayBuffer|null} */
let templateHeaderBuffer = null;
let templateFileName = "";

// Output section state
let outputCollapsed = false;
let includeTxt = false;
let exporting = false;
let isPlaying = false;

/** @type {Blob[]} All video frames stored as JPEG blobs */
let frames = [];
let currentFrameIdx = 0;

// Frame decode cache delegated to player module
const ensureFrameDecoded = player.ensureFrameDecoded;
const clearDecodedFrame = player.clearDecodedFrame;

// In/out points (frame indices, inclusive)
let inPoint = 0;
let outPoint = 0;

// Per-port preview (keyed by port object for stable identity across index shifts)
const portPreviewCanvases = new Map();
/** @type {Map<Port, {frame: number, total: number}>} */
const portPreviewProcessing = new Map();
const portDirty = new Set();

// ------------------------------------------------------------------ //
// Media loading
// ------------------------------------------------------------------ //

mediaInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  if (file.type.startsWith("image/")) {
    loadImage(url);
  } else {
    loadVideo(url);
  }
});

// Auto-load bundled prototype header
fetch("prototype.dat")
  .then((r) => r.ok ? r.arrayBuffer() : null)
  .then((buf) => {
    if (buf) {
      templateHeaderBuffer = buf;
      templateFileName = "prototype.dat";
      renderOutputSection();
    }
  })
  .catch(() => {});

// ------------------------------------------------------------------ //
// Frame-based playback (delegates to player/player.js)
// ------------------------------------------------------------------ //

// Shared state object — player reads/writes through these accessors
const playerState = {
  get frames() { return frames; },
  get currentFrame() { return currentFrameIdx; },
  set currentFrame(v) { currentFrameIdx = v; },
  get isPlaying() { return isPlaying; },
  set isPlaying(v) { isPlaying = v; },
  get fps() { return detectedFPS || 30; },
  get inPoint() { return inPoint; },
  get outPoint() { return outPoint; },
};

viewport.init(overlay, videoWrap);
viewport.setOnChange(() => drawOverlay());
viewport.setKeyboardCallbacks({
  stepForward: () => player.stepForward(),
  stepBack: () => player.stepBack(),
});

// Scroll-wheel zoom only in zoom mode, middle-click pan only in pan mode
viewport.setModeCheck((type) => {
  const mode = viewerToolbar.getMode();
  if (type === "wheel") return mode === "zoom";
  if (type === "middle") return mode === "pan";
  return true;
});

viewerToolbar.init(videoWrap, {
  onHome() {
    viewport.resetView();
    drawOverlay();
  },
  onSelected() {
    // If points are selected, zoom to fit them; otherwise zoom to fit all points
    let pts = getSelectedPointObjects();
    if (pts.length === 0) {
      // Gather all points from all ports
      pts = [];
      ports.forEach((port, pi) => {
        port.points.forEach((pt, pti) => {
          pts.push({ portIdx: pi, pointIdx: pti, point: pt });
        });
      });
    }
    if (pts.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.point.x < minX) minX = p.point.x;
      if (p.point.y < minY) minY = p.point.y;
      if (p.point.x > maxX) maxX = p.point.x;
      if (p.point.y > maxY) maxY = p.point.y;
    }
    viewport.zoomToFit({ minX, minY, maxX, maxY }, overlay.width, overlay.height);
    drawOverlay();
  },
});

player.init(playerState, {
  drawOverlay: () => drawOverlay(),
  drawFast: (bmp) => {
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
    viewport.applyTransform(overlayCtx);
    overlayCtx.drawImage(bmp, 0, 0);
    drawOverlayPorts();
    viewport.restoreTransform(overlayCtx);
  },
  onFrameChanged: () => updateLinePreviews(),
  onPlayStateChanged: () => renderOutputSection(),
});

rack.init(portsList, addPortBtn, {
  get controllers() { return controllers; },
  get ports() { return ports; },
  get activeSelection() { return activeSelection; },
  get selectedPoints() { return selectedPoints; },
  isPointSelected,
  get portDirty() { return portDirty; },
  get portPreviewCanvases() { return portPreviewCanvases; },
  get portPreviewProcessing() { return portPreviewProcessing; },
  get mediaW() { return mediaW; },
  get mediaH() { return mediaH; },
  get mediaReady() { return mediaReady; },
  get portsPerController() { return portsPerController; },
}, {
  addController,
  removeController,
  addPort,
  removePort,
  addPointToPort,
  removePointFromPort,
  selectPoint,
  togglePoint,
  selectAllInPort,
  selectAllInController,
  processPortPreview,
  markPortDirty,
  drawOverlay: () => drawOverlay(),
  updateLinePreviews: () => updateLinePreviews(),
});

toolbar.init(toolbarEl, {
  get activeSelection() { return activeSelection; },
  get selectedPoints() { return selectedPoints; },
  get ports() { return ports; },
  get mediaW() { return mediaW; },
  get mediaH() { return mediaH; },
  isPointSelected,
  getSelectedPointObjects,
}, {
  markPortDirty,
  markAllPortsDirty,
  drawOverlay: () => drawOverlay(),
  updateLinePreviews: () => updateLinePreviews(),
  renderRack: () => renderPorts(),
});

function doPlay() { return player.play(); }
function doPause() { player.pause(); }
function doStop() { return player.stop(); }
function doSeek(frameIdx) { return player.seek(frameIdx); }

/** Compute downscaled dimensions so the longer side fits maxResolution */
function clampResolution(w, h) {
  const longer = Math.max(w, h);
  if (longer <= maxResolution) return { w, h };
  const scale = maxResolution / longer;
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

function initAfterLoad(w, h) {
  mediaW = w;
  mediaH = h;
  mediaReady = true;

  overlay.width = w;
  overlay.height = h;

  viewport.setMediaSize(w, h);
  viewport.resetView();

  // Prepare offscreen canvas for live sampling
  sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = w;
  sampleCanvas.height = h;
  sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });

  if (ports.length === 0) {
    if (controllers.length === 0) addController();
    const pad = Math.round(w * 0.1);
    const cy = Math.round(h / 2);
    addPort(0, 400, [
      { x: pad, y: cy },
      { x: w - pad, y: cy },
    ]);
  }

  renderPorts();
  drawOverlay();
  updateLinePreviews();
}

function loadImage(url) {
  const img = new Image();
  img.onload = () => {
    mediaType = "image";
    detectedFPS = 0;

    const { w, h } = clampResolution(img.naturalWidth, img.naturalHeight);
    // Downscale if needed
    if (w !== img.naturalWidth || h !== img.naturalHeight) {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      const scaled = new Image();
      scaled.onload = () => {
        loadedImage = scaled;
        video.style.display = "none";
        overlay.classList.add("static");
        initAfterLoad(w, h);
        setStatus(`Image loaded: ${img.naturalWidth}x${img.naturalHeight} → ${w}x${h}`);
      };
      scaled.src = c.toDataURL();
    } else {
      loadedImage = img;
      video.style.display = "none";
      overlay.classList.add("static");
      initAfterLoad(w, h);
      setStatus(`Image loaded: ${w}x${h} (1 frame)`);
    }
  };
  img.src = url;
}

function loadVideo(url) {
  video.style.display = "block";
  overlay.classList.remove("static");
  loadedImage = null;
  video.src = url;
  video.load();

  video.addEventListener(
    "loadedmetadata",
    async () => {
      mediaType = "video";
      const { w, h } = clampResolution(video.videoWidth, video.videoHeight);
      initAfterLoad(w, h);

      setStatus("Detecting frame rate...");
      detectedFPS = await detectFPS();
      setStatus("Extracting frames...");
      await extractFrames();
    },
    { once: true }
  );
}

async function extractFrames() {
  // Free old frames
  clearDecodedFrame();
  frames = [];
  currentFrameIdx = 0;

  const fps = detectedFPS || 30;
  const totalVideoFrames = Math.floor(video.duration * fps);
  const maxFrames = frameLength > 0 ? Math.min(frameLength, totalVideoFrames - frameOffset) : totalVideoFrames - frameOffset;
  const expectedFrames = Math.max(0, maxFrames);

  setStatus(`Extracting frames (0/${expectedFrames})...`);
  const pBar = document.getElementById("progress-bar");
  const pFill = document.getElementById("progress-fill");
  if (pBar) pBar.style.display = "block";

  // Capture canvas for converting video frames to JPEG blobs
  const captureCanvas = document.createElement("canvas");
  captureCanvas.width = mediaW;
  captureCanvas.height = mediaH;
  const captureContext = captureCanvas.getContext("2d");

  video.currentTime = 0;
  let rawFrameIdx = 0; // counts all frames from the video

  await new Promise((resolve) => {
    let resolved = false;

    function done() {
      if (resolved) return;
      resolved = true;
      video.pause();
      resolve();
    }

    function onFrame() {
      if (resolved) return;

      if (rawFrameIdx < frameOffset) {
        // Skip frames before offset
        rawFrameIdx++;
        if (video.ended) { done(); } else { video.requestVideoFrameCallback(onFrame); }
        return;
      }

      if (frames.length >= expectedFrames) {
        done();
        return;
      }

      // Draw the current video frame scaled to media dimensions and encode as JPEG blob
      captureContext.drawImage(video, 0, 0, mediaW, mediaH);
      captureCanvas.toBlob((blob) => {
        if (resolved) return;
        frames.push(blob);
        setStatus(`Extracting frames (${frames.length}/${expectedFrames})...`);
        if (pFill) pFill.style.width = (frames.length / expectedFrames * 100) + "%";

        rawFrameIdx++;

        if (video.ended || frames.length >= expectedFrames) {
          done();
        } else {
          video.requestVideoFrameCallback(onFrame);
        }
      }, "image/jpeg", 0.90);
    }

    video.addEventListener("ended", () => setTimeout(done, 200), { once: true });

    video.requestVideoFrameCallback(onFrame);
    const p = video.play();
    if (p) p.catch(() => done());
  });

  if (pBar) pBar.style.display = "none";

  // Hide video element, switch to frame-based display on overlay canvas
  video.pause();
  video.style.display = "none";
  overlay.classList.add("static");

  inPoint = 0;
  outPoint = frames.length - 1;

  drawOverlay();
  updateLinePreviews();
  renderOutputSection();
  setStatus(`Extracted ${frames.length} frames (${video.duration.toFixed(1)}s, ~${detectedFPS}fps)`);
}

// ------------------------------------------------------------------ //
// Port / point data model (delegates to rack/port-model.js)
// ------------------------------------------------------------------ //

function rebuildPortsList() {
  ports = _rebuildPorts(controllers);
}

function addController() {
  controllers.push(createController());
}

function removeController(ci) {
  const ctrl = controllers[ci];
  const firstFlat = firstFlatIndex(controllers, ci);
  const count = ctrl.ports.length;

  for (const port of ctrl.ports) {
    portDirty.delete(port);
    portPreviewCanvases.delete(port);
    portPreviewProcessing.delete(port);
  }

  controllers.splice(ci, 1);
  rebuildPortsList();

  if (activeSelection) {
    if (activeSelection.port >= firstFlat && activeSelection.port < firstFlat + count) {
      activeSelection = null;
    } else if (activeSelection.port >= firstFlat + count) {
      activeSelection.port -= count;
    }
  }
  toolbar.onSelectionChanged();
}

function addPort(ci, leds = 400, points = null) {
  const mw = mediaReady ? mediaW : 400;
  const mh = mediaReady ? mediaH : 400;
  const port = createPort(leds, points, mw, mh);
  controllers[ci].ports.push(port);
  rebuildPortsList();
  portDirty.add(port);
  activeSelection = { port: ports.indexOf(port), point: 0 };
  toolbar.onSelectionChanged();
}

function removePort(ci, pi) {
  const ctrl = controllers[ci];
  const port = ctrl.ports[pi];
  const flatIdx = firstFlatIndex(controllers, ci) + pi;

  portDirty.delete(port);
  portPreviewCanvases.delete(port);
  portPreviewProcessing.delete(port);

  ctrl.ports.splice(pi, 1);
  rebuildPortsList();

  if (activeSelection && activeSelection.port === flatIdx) {
    activeSelection = null;
  } else if (activeSelection && activeSelection.port > flatIdx) {
    activeSelection.port--;
  }
  toolbar.onSelectionChanged();
}

function addPointToPort(portIdx) {
  const newIdx = _addPoint(ports[portIdx]);
  activeSelection = { port: portIdx, point: newIdx };
  toolbar.renderPanel();
}

function removePointFromPort(portIdx, pointIdx) {
  if (!_removePoint(ports[portIdx], pointIdx)) return;
  if (activeSelection &&
      activeSelection.port === portIdx &&
      activeSelection.point === pointIdx) {
    activeSelection = null;
  } else if (activeSelection &&
             activeSelection.port === portIdx &&
             activeSelection.point > pointIdx) {
    activeSelection.point--;
  }
  toolbar.renderPanel();
}

// ------------------------------------------------------------------ //
// Output section UI (foldable card)
// ------------------------------------------------------------------ //

function renderOutputSection() {
  outputSection.innerHTML = "";

  const card = document.createElement("div");
  card.className = "port"; // reuse port card styling

  // Header row
  const header = document.createElement("div");
  header.className = "port-header";

  const toggle = document.createElement("button");
  toggle.className = "btn-toggle";
  toggle.textContent = outputCollapsed ? "\u25b6" : "\u25bc";
  toggle.addEventListener("click", () => {
    outputCollapsed = !outputCollapsed;
    renderOutputSection();
  });

  const label = document.createElement("span");
  label.className = "port-label";
  label.textContent = "Output";

  const exportBtn = document.createElement("button");
  exportBtn.className = "btn-primary";
  exportBtn.textContent = exporting ? "Exporting\u2026" : "Export DAT";
  exportBtn.disabled = exporting;
  exportBtn.addEventListener("click", doExport);

  const saveBtn = document.createElement("button");
  saveBtn.className = "btn-small";
  saveBtn.textContent = "Save Scene";
  saveBtn.addEventListener("click", saveScene);

  const loadBtn = document.createElement("button");
  loadBtn.className = "btn-small";
  loadBtn.textContent = "Load Scene";
  loadBtn.addEventListener("click", loadScene);

  header.append(toggle, label, exportBtn, saveBtn, loadBtn);
  card.appendChild(header);

  if (!outputCollapsed) {
    const body = document.createElement("div");
    body.className = "points-list"; // reuse indented list styling

    // Media file input row
    const mediaRow = document.createElement("div");
    mediaRow.className = "point-row";
    mediaRow.style.cursor = "default";
    mediaRow.appendChild(mediaInput);
    body.appendChild(mediaRow);

    // Template file row
    const tplRow = document.createElement("div");
    tplRow.className = "point-row";
    tplRow.style.cursor = "default";

    const tplLabel = document.createElement("label");
    tplLabel.style.cssText = "font-size:0.8rem;color:#aaa;white-space:nowrap";
    tplLabel.textContent = "Template ";

    const tplInput = document.createElement("input");
    tplInput.type = "file";
    tplInput.accept = ".dat";
    tplInput.style.cssText = "font-size:0.75rem;max-width:140px";
    tplInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        templateHeaderBuffer = reader.result;
        templateFileName = file.name;
        renderOutputSection();
      };
      reader.readAsArrayBuffer(file);
    });

    const tplStatus = document.createElement("span");
    tplStatus.style.cssText = "font-size:0.75rem;color:#00ff88";
    tplStatus.textContent = templateFileName;

    tplRow.append(tplLabel, tplInput, tplStatus);
    body.appendChild(tplRow);

    // Include .txt row
    const txtRow = document.createElement("div");
    txtRow.className = "point-row";
    txtRow.style.cursor = "default";

    const txtCheck = document.createElement("input");
    txtCheck.type = "checkbox";
    txtCheck.checked = includeTxt;
    txtCheck.addEventListener("change", () => {
      includeTxt = txtCheck.checked;
    });

    const txtLabel = document.createElement("label");
    txtLabel.className = "checkbox-label";
    txtLabel.style.margin = "0";
    txtLabel.append(txtCheck, " Include .txt (zipped)");

    txtRow.appendChild(txtLabel);
    body.appendChild(txtRow);

    // Ports per controller row
    const ppcRow = document.createElement("div");
    ppcRow.className = "point-row";
    ppcRow.style.cursor = "default";

    const ppcLabel = document.createElement("label");
    ppcLabel.style.cssText = "font-size:0.8rem;color:#aaa;white-space:nowrap";
    ppcLabel.textContent = "Ports per controller";

    const ppcInput = document.createElement("input");
    ppcInput.type = "number";
    ppcInput.min = "1";
    ppcInput.max = "32";
    ppcInput.value = String(portsPerController);
    ppcInput.style.width = "56px";
    ppcInput.addEventListener("change", () => {
      portsPerController = Math.max(1, Math.min(32, parseInt(ppcInput.value) || 8));
      ppcInput.value = portsPerController;
      renderPorts(); // re-render to update Add Port button disabled state
    });

    ppcRow.append(ppcLabel, ppcInput);
    body.appendChild(ppcRow);

    // Max resolution row
    const resRow = document.createElement("div");
    resRow.className = "point-row";
    resRow.style.cursor = "default";

    const resLabel = document.createElement("label");
    resLabel.style.cssText = "font-size:0.8rem;color:#aaa;white-space:nowrap";
    resLabel.textContent = "Max resolution";

    const resInput = document.createElement("input");
    resInput.type = "number";
    resInput.min = "64";
    resInput.max = "3840";
    resInput.value = String(maxResolution);
    resInput.style.width = "56px";
    resInput.addEventListener("change", () => {
      maxResolution = Math.max(64, Math.min(3840, parseInt(resInput.value) || 1280));
      resInput.value = maxResolution;
    });

    const resHint = document.createElement("span");
    resHint.style.cssText = "font-size:0.7rem;color:#666";
    resHint.textContent = mediaReady ? `(${mediaW}\u00d7${mediaH})` : "";

    resRow.append(resLabel, resInput, resHint);
    body.appendChild(resRow);

    // Frame offset row
    const offRow = document.createElement("div");
    offRow.className = "point-row";
    offRow.style.cursor = "default";

    const offLabel = document.createElement("label");
    offLabel.style.cssText = "font-size:0.8rem;color:#aaa;white-space:nowrap";
    offLabel.textContent = "Frame offset";

    const offInput = document.createElement("input");
    offInput.type = "number";
    offInput.min = "0";
    offInput.value = String(frameOffset);
    offInput.style.width = "56px";
    offInput.addEventListener("change", () => {
      frameOffset = Math.max(0, parseInt(offInput.value) || 0);
      offInput.value = frameOffset;
    });

    offRow.append(offLabel, offInput);
    body.appendChild(offRow);

    // Frame length row
    const lenRow = document.createElement("div");
    lenRow.className = "point-row";
    lenRow.style.cursor = "default";

    const lenLabel = document.createElement("label");
    lenLabel.style.cssText = "font-size:0.8rem;color:#aaa;white-space:nowrap";
    lenLabel.textContent = "Frame length";

    const lenInput = document.createElement("input");
    lenInput.type = "number";
    lenInput.min = "0";
    lenInput.value = String(frameLength);
    lenInput.style.width = "56px";
    lenInput.addEventListener("change", () => {
      frameLength = Math.max(0, parseInt(lenInput.value) || 0);
      lenInput.value = frameLength;
    });

    lenRow.append(lenLabel, lenInput);
    body.appendChild(lenRow);

    // Memory estimate (JPEG blobs ~150KB/frame at 1280×720 @ 90% quality)
    const estW = mediaReady ? mediaW : maxResolution;
    const estH = mediaReady ? mediaH : Math.round(maxResolution * 9 / 16);
    const estFrames = frames.length > 0 ? frames.length : (frameLength > 0 ? frameLength : 5000);
    const bytesPerFrame = Math.round(estW * estH * 0.16); // JPEG ~0.16 bytes/pixel at 90%
    const estMB = Math.round(bytesPerFrame * estFrames / 1024 / 1024);
    const memRow = document.createElement("div");
    memRow.className = "point-row";
    memRow.style.cursor = "default";
    const memHint = document.createElement("span");
    const warn = estMB > 2000;
    memHint.style.cssText = "font-size:0.7rem;color:" + (warn ? "#e94560" : "#666");
    memHint.textContent = `~${estMB} MB for ${estFrames}f at ${estW}\u00d7${estH} (JPEG)` + (warn ? " (may crash)" : "");
    memRow.appendChild(memHint);
    body.appendChild(memRow);

    // In/out point controls (only when frames are extracted)
    if (frames.length > 0) {
      const ioRow = document.createElement("div");
      ioRow.className = "point-row io-row";
      ioRow.style.cursor = "default";

      const inLabel = document.createElement("label");
      inLabel.style.cssText = "font-size:0.75rem;color:#aaa";
      inLabel.textContent = "In";
      const inInput = document.createElement("input");
      inInput.type = "number";
      inInput.min = "0";
      inInput.max = String(frames.length - 1);
      inInput.value = String(inPoint);
      inInput.style.width = "56px";
      inInput.addEventListener("change", () => {
        inPoint = Math.max(0, Math.min(outPoint, parseInt(inInput.value) || 0));
        inInput.value = inPoint;
        renderOutputSection();
        markAllPortsDirty();
      });
      const inSetBtn = document.createElement("button");
      inSetBtn.className = "btn-small";
      inSetBtn.textContent = "Set";
      inSetBtn.title = "Set in-point to current frame";
      inSetBtn.addEventListener("click", () => {
        inPoint = Math.min(currentFrameIdx, outPoint);
        renderOutputSection();
        markAllPortsDirty();
      });

      const outLabel = document.createElement("label");
      outLabel.style.cssText = "font-size:0.75rem;color:#aaa;margin-left:8px";
      outLabel.textContent = "Out";
      const outInput = document.createElement("input");
      outInput.type = "number";
      outInput.min = "0";
      outInput.max = String(frames.length - 1);
      outInput.value = String(outPoint);
      outInput.style.width = "56px";
      outInput.addEventListener("change", () => {
        outPoint = Math.max(inPoint, Math.min(frames.length - 1, parseInt(outInput.value) || 0));
        outInput.value = outPoint;
        renderOutputSection();
        markAllPortsDirty();
      });
      const outSetBtn = document.createElement("button");
      outSetBtn.className = "btn-small";
      outSetBtn.textContent = "Set";
      outSetBtn.title = "Set out-point to current frame";
      outSetBtn.addEventListener("click", () => {
        outPoint = Math.max(currentFrameIdx, inPoint);
        renderOutputSection();
        markAllPortsDirty();
      });

      const rangeFrames = outPoint - inPoint + 1;
      const rangeSecs = rangeFrames / (detectedFPS || 30);
      const rangeLabel = document.createElement("span");
      rangeLabel.className = "frame-label";
      rangeLabel.textContent = `${rangeFrames}f (${rangeSecs.toFixed(1)}s)`;

      ioRow.append(inLabel, inInput, inSetBtn, outLabel, outInput, outSetBtn, rangeLabel);
      body.appendChild(ioRow);

      // In/out frame thumbnails
      const thumbRow = document.createElement("div");
      thumbRow.className = "io-thumbs";

      const inThumb = document.createElement("canvas");
      inThumb.className = "io-thumb";
      const outThumb = document.createElement("canvas");
      outThumb.className = "io-thumb";

      // Draw thumbnail for in-point
      const thumbH = 60;
      const thumbW = Math.round(thumbH * (mediaW / mediaH));
      inThumb.width = thumbW;
      inThumb.height = thumbH;
      outThumb.width = thumbW;
      outThumb.height = thumbH;

      const inCtx = inThumb.getContext("2d");
      const outCtx = outThumb.getContext("2d");

      if (frames[inPoint]) {
        createImageBitmap(frames[inPoint]).then((bmp) => {
          inCtx.drawImage(bmp, 0, 0, thumbW, thumbH);
          bmp.close();
        });
      }
      if (frames[outPoint]) {
        createImageBitmap(frames[outPoint]).then((bmp) => {
          outCtx.drawImage(bmp, 0, 0, thumbW, thumbH);
          bmp.close();
        });
      }

      const inThumbLabel = document.createElement("span");
      inThumbLabel.className = "io-thumb-label";
      inThumbLabel.textContent = `In: ${inPoint}`;

      const outThumbLabel = document.createElement("span");
      outThumbLabel.className = "io-thumb-label";
      outThumbLabel.textContent = `Out: ${outPoint}`;

      const inThumbWrap = document.createElement("div");
      inThumbWrap.className = "io-thumb-wrap";
      inThumbWrap.append(inThumb, inThumbLabel);

      const outThumbWrap = document.createElement("div");
      outThumbWrap.className = "io-thumb-wrap";
      outThumbWrap.append(outThumb, outThumbLabel);

      thumbRow.append(inThumbWrap, outThumbWrap);
      body.appendChild(thumbRow);
    }

    card.appendChild(body);
  }

  // Playback controls (video with extracted frames)
  if (frames.length > 0) {
    const wrap = document.createElement("div");
    wrap.className = "playback-wrap";

    const playRow = document.createElement("div");
    playRow.className = "playback-controls";

    const playBtn = document.createElement("button");
    playBtn.className = "btn-small";
    playBtn.textContent = isPlaying ? "\u23f8 Pause" : "\u25b6 Play";
    playBtn.addEventListener("click", () => isPlaying ? doPause() : doPlay());

    const stopBtn = document.createElement("button");
    stopBtn.className = "btn-small";
    stopBtn.textContent = "\u23f9 Stop";
    stopBtn.addEventListener("click", doStop);

    const frameLabel = document.createElement("span");
    frameLabel.id = "frame-label";
    frameLabel.className = "frame-label";
    const fps = detectedFPS || 30;
    const t = currentFrameIdx / fps;
    frameLabel.textContent = `${currentFrameIdx} / ${frames.length}  (${t.toFixed(2)}s)`;

    playRow.append(playBtn, stopBtn, frameLabel);
    wrap.appendChild(playRow);

    const seekBar = document.createElement("input");
    seekBar.type = "range";
    seekBar.id = "seek-bar";
    seekBar.className = "seek-bar";
    seekBar.min = "0";
    seekBar.max = String(frames.length - 1);
    seekBar.step = "1";
    seekBar.value = String(currentFrameIdx);
    seekBar.addEventListener("input", () => {
      doSeek(parseInt(seekBar.value));
    });
    wrap.appendChild(seekBar);

    card.appendChild(wrap);
  }

  // Export progress bar
  const progressBar = document.createElement("div");
  progressBar.className = "progress-bar";
  progressBar.id = "progress-bar";
  const progressFill = document.createElement("div");
  progressFill.className = "fill";
  progressFill.id = "progress-fill";
  progressBar.appendChild(progressFill);
  card.appendChild(progressBar);

  // Status
  const statusEl = document.createElement("div");
  statusEl.id = "status";
  card.appendChild(statusEl);

  outputSection.appendChild(card);
}

// Initial render
renderOutputSection();

// ------------------------------------------------------------------ //
// Ports UI rendering
// ------------------------------------------------------------------ //

function renderPorts() { rack.render(); toolbar.renderPanel(); }

// ------------------------------------------------------------------ //
// Live line preview sampling
// ------------------------------------------------------------------ //

async function updateLinePreviews() {
  if (!mediaReady || !sampleCtx) return;

  // Draw current frame onto sample canvas
  if (mediaType === "image" && loadedImage) {
    sampleCtx.drawImage(loadedImage, 0, 0);
  } else if (mediaType === "video" && frames.length > 0) {
    const bmp = await ensureFrameDecoded(currentFrameIdx);
    sampleCtx.drawImage(bmp, 0, 0);
  }

  ports.forEach((port, pi) => {
    const canvas = rack.getLinePreviewCanvases().get(pi);
    if (!canvas) return;

    // Resize if LED count changed
    if (canvas.width !== port.leds) {
      canvas.width = port.leds;
    }

    const ctx = canvas.getContext("2d");
    const samples = samplePortLine(sampleCtx, port);
    const imgData = ctx.createImageData(port.leds, 1);
    for (let p = 0; p < port.leds; p++) {
      imgData.data[p * 4] = samples[p * 3];
      imgData.data[p * 4 + 1] = samples[p * 3 + 1];
      imgData.data[p * 4 + 2] = samples[p * 3 + 2];
      imgData.data[p * 4 + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  });
}

// ------------------------------------------------------------------ //
// Per-port preview rendering
// ------------------------------------------------------------------ //

function markPortDirty(port) {
  portDirty.add(port);
  portPreviewCanvases.delete(port);
}

function markAllPortsDirty() {
  for (const port of ports) markPortDirty(port);
}

/** Lightweight progress update — patches text in-place without rebuilding the DOM */
function updateRenderProgress() {
  const portCards = portsList.querySelectorAll(".port");
  portCards.forEach((card, pi) => {
    const port = ports[pi];
    if (!port) return;
    const progress = portPreviewProcessing.get(port);
    if (!progress) return;
    const text = `Rendering ${progress.frame}/${progress.total}`;
    const statusEl = card.querySelector(".port-preview-status");
    if (statusEl) statusEl.textContent = text;
    const btn = card.querySelector(".port-header .btn-small");
    if (btn) btn.textContent = text;
  });
}

async function processPortPreview(port) {
  if (!mediaReady || !ports.includes(port)) {
    renderPorts();
    return;
  }

  const isImage = mediaType === "image";
  const rangeStart = isImage ? 0 : inPoint;
  const rangeEnd = isImage ? 0 : outPoint;
  const totalFrames = rangeEnd - rangeStart + 1;
  if (totalFrames <= 0) { renderPorts(); return; }

  portPreviewProcessing.set(port, { frame: 0, total: totalFrames });
  renderPorts();

  try {
    const captureCanvas = document.createElement("canvas");
    captureCanvas.width = mediaW;
    captureCanvas.height = mediaH;
    const captureCtx = captureCanvas.getContext("2d", { willReadFrequently: true });

    const prevCanvas = document.createElement("canvas");
    prevCanvas.width = port.leds;
    prevCanvas.height = totalFrames;
    const prevCtx = prevCanvas.getContext("2d");

    for (let f = 0; f < totalFrames; f++) {
      if (!ports.includes(port)) break;

      if (isImage) {
        captureCtx.drawImage(loadedImage, 0, 0);
      } else {
        const bmp = await createImageBitmap(frames[rangeStart + f]);
        captureCtx.drawImage(bmp, 0, 0);
        bmp.close();
      }

      const samples = samplePortLine(captureCtx, port);
      const imgData = prevCtx.createImageData(port.leds, 1);
      for (let p = 0; p < port.leds; p++) {
        imgData.data[p * 4] = samples[p * 3];
        imgData.data[p * 4 + 1] = samples[p * 3 + 1];
        imgData.data[p * 4 + 2] = samples[p * 3 + 2];
        imgData.data[p * 4 + 3] = 255;
      }
      prevCtx.putImageData(imgData, 0, f);

      if (f % 10 === 0) {
        portPreviewProcessing.set(port, { frame: f + 1, total: totalFrames });
        updateRenderProgress();
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    if (ports.includes(port)) {
      prevCanvas._totalFrames = totalFrames;
      prevCanvas._fps = detectedFPS || 30;
      prevCanvas._leds = port.leds;
      portPreviewCanvases.set(port, prevCanvas);
      portDirty.delete(port);
    }
  } finally {
    portPreviewProcessing.delete(port);
    renderPorts();
  }
}

/**
 * Render multiple ports in a single video pass.
 * Seeks through frames once and samples all ports at each frame.
 * Avoids the video readyState degradation that happens when resetting between ports.
 */
async function processMultiPortPreviews(portsToRender) {
  if (portsToRender.length === 0) return;

  const isImage = mediaType === "image";
  const fps = detectedFPS || 30;
  const rangeStart = isImage ? 0 : inPoint;
  const rangeEnd = isImage ? 0 : outPoint;
  const totalFrames = rangeEnd - rangeStart + 1;
  if (totalFrames <= 0) return;

  for (const port of portsToRender) portPreviewProcessing.set(port, { frame: 0, total: totalFrames });
  renderPorts();

  try {
    const captureCanvas = document.createElement("canvas");
    captureCanvas.width = mediaW;
    captureCanvas.height = mediaH;
    const captureCtx = captureCanvas.getContext("2d", { willReadFrequently: true });

    const portData = portsToRender.map((port) => {
      const prevCanvas = document.createElement("canvas");
      prevCanvas.width = port.leds;
      prevCanvas.height = totalFrames;
      return { port, prevCanvas, prevCtx: prevCanvas.getContext("2d") };
    });

    for (let f = 0; f < totalFrames; f++) {
      if (isImage) {
        captureCtx.drawImage(loadedImage, 0, 0);
      } else {
        const bmp = await createImageBitmap(frames[rangeStart + f]);
        captureCtx.drawImage(bmp, 0, 0);
        bmp.close();
      }

      for (const { port, prevCtx } of portData) {
        const samples = samplePortLine(captureCtx, port);
        const imgData = prevCtx.createImageData(port.leds, 1);
        for (let p = 0; p < port.leds; p++) {
          imgData.data[p * 4] = samples[p * 3];
          imgData.data[p * 4 + 1] = samples[p * 3 + 1];
          imgData.data[p * 4 + 2] = samples[p * 3 + 2];
          imgData.data[p * 4 + 3] = 255;
        }
        prevCtx.putImageData(imgData, 0, f);
      }

      if (f % 10 === 0) {
        for (const port of portsToRender) portPreviewProcessing.set(port, { frame: f + 1, total: totalFrames });
        updateRenderProgress();
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    for (const { port, prevCanvas } of portData) {
      if (ports.includes(port)) {
        prevCanvas._totalFrames = totalFrames;
        prevCanvas._fps = fps;
        prevCanvas._leds = port.leds;
        portPreviewCanvases.set(port, prevCanvas);
        portDirty.delete(port);
      }
    }
  } finally {
    for (const port of portsToRender) portPreviewProcessing.delete(port);
    renderPorts();
  }
}

// ------------------------------------------------------------------ //
// Drag to move active point
// ------------------------------------------------------------------ //

function getMediaCoords(e) {
  return viewport.getMediaCoords(e);
}

function moveActivePoint(x, y) {
  // When toolbar transform is active, delegate dragging to toolbar
  if (toolbar.isToolActive() && _draggingTransformControl) {
    toolbar.moveControl(x, y);
    return;
  }

  if (!activeSelection || !("point" in activeSelection)) return;
  const port = ports[activeSelection.port];
  const pt = port.points[activeSelection.point];
  pt.x = Math.max(0, Math.min(mediaW - 1, x));
  pt.y = Math.max(0, Math.min(mediaH - 1, y));
}

/** Find the closest draggable point/control to (mx, my) */
function findClosestPoint(mx, my) {
  let best = null;
  let bestDist = Infinity;

  // When toolbar transform is active, check transform control handles first
  if (toolbar.isToolActive()) {
    const controls = toolbar.getControlPoints();
    if (controls) {
      for (const cp of controls) {
        const d = (cp.x - mx) ** 2 + (cp.y - my) ** 2;
        if (d < bestDist) { bestDist = d; best = { transformControl: cp.key }; }
      }
    }
  }

  // Check all port points
  ports.forEach((port, pi) => {
    port.points.forEach((pt, pti) => {
      const d = (pt.x - mx) ** 2 + (pt.y - my) ** 2;
      if (d < bestDist) { bestDist = d; best = { port: pi, point: pti }; }
    });
  });

  return best;
}

// Pointer state: unified click / double-click / drag detection
let pointerDown = false;
let pointerDownPos = null; // media coords at press
const DRAG_THRESHOLD = 5; // px in media coords before drag starts
let _draggingTransformControl = false; // true when dragging a toolbar transform handle

// Viewer toolbar: pan/zoom mode drag state
let _viewerPanning = false;
let _viewerPanStart = null; // { clientX, clientY, panX, panY }
let _viewerZooming = false;
let _viewerZoomStart = null; // { clientY, zoom }

// Triple-click detection
const _clickTimes = [];
const TRIPLE_CLICK_WINDOW = 500; // ms

function _checkTripleClick() {
  const now = Date.now();
  _clickTimes.push(now);
  // Keep only last 3
  while (_clickTimes.length > 3) _clickTimes.shift();
  if (_clickTimes.length === 3 && now - _clickTimes[0] < TRIPLE_CLICK_WINDOW) {
    _clickTimes.length = 0;
    viewerToolbar.toggle();
    return true;
  }
  return false;
}

function onPointerDown(e) {
  if (!mediaReady || viewport.isPanning()) return;

  // Triple-click detection
  if (_checkTripleClick()) return;

  const mode = viewerToolbar.getMode();

  // Pan mode: start left-click pan
  if (mode === "pan") {
    const touch = e.touches?.[0];
    const clientX = touch ? touch.clientX : e.clientX;
    const clientY = touch ? touch.clientY : e.clientY;
    const pan = viewport.getPan();
    _viewerPanning = true;
    _viewerPanStart = { clientX, clientY, panX: pan.x, panY: pan.y };
    return;
  }

  // Zoom mode: start left-click zoom drag
  if (mode === "zoom") {
    const touch = e.touches?.[0];
    const clientY = touch ? touch.clientY : e.clientY;
    _viewerZooming = true;
    _viewerZoomStart = { clientY, zoom: viewport.getZoom() };
    return;
  }

  // Points mode: existing behavior
  pointerDown = true;
  _draggingTransformControl = false;
  pointerDownPos = getMediaCoords(e);

  // If toolbar transform is active, check if clicking a control handle
  if (toolbar.isToolActive()) {
    const { x, y } = pointerDownPos;
    const controls = toolbar.getControlPoints();
    if (controls) {
      let bestDist = Infinity;
      let bestKey = null;
      for (const cp of controls) {
        const d = (cp.x - x) ** 2 + (cp.y - y) ** 2;
        if (d < bestDist) { bestDist = d; bestKey = cp.key; }
      }
      // If close enough to a control handle, start dragging it
      if (bestKey && bestDist < 400) { // ~20px radius
        _draggingTransformControl = true;
        return;
      }
    }
  }
}

function onPointerMove(e) {
  // Viewer pan mode
  if (_viewerPanning && _viewerPanStart) {
    const touch = e.touches?.[0];
    const clientX = touch ? touch.clientX : e.clientX;
    const clientY = touch ? touch.clientY : e.clientY;
    const cssScaleX = overlay.width / videoWrap.getBoundingClientRect().width;
    const cssScaleY = overlay.height / videoWrap.getBoundingClientRect().height;
    viewport.setPan(
      _viewerPanStart.panX + (clientX - _viewerPanStart.clientX) * cssScaleX,
      _viewerPanStart.panY + (clientY - _viewerPanStart.clientY) * cssScaleY,
    );
    drawOverlay();
    return;
  }

  // Viewer zoom mode
  if (_viewerZooming && _viewerZoomStart) {
    const touch = e.touches?.[0];
    const clientY = touch ? touch.clientY : e.clientY;
    const dy = _viewerZoomStart.clientY - clientY; // up = positive = zoom in
    viewport.setZoom(_viewerZoomStart.zoom * (1 + dy * 0.005));
    drawOverlay();
    return;
  }

  if (!pointerDown || viewport.isPanning()) return;

  // Start drag only after moving past threshold
  const canDrag = activeSelection || _draggingTransformControl;
  if (!dragging && pointerDownPos && canDrag) {
    const { x, y } = getMediaCoords(e);
    const dx = x - pointerDownPos.x;
    const dy = y - pointerDownPos.y;
    if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
    dragging = true;
    lastDragUpdate = performance.now();
  }

  if (!dragging) return;
  e.preventDefault();

  const now = performance.now();
  if (now - lastDragUpdate < DRAG_INTERVAL) return;
  lastDragUpdate = now;

  const { x, y } = getMediaCoords(e);
  moveActivePoint(x, y);
  drawOverlay();
  updateLinePreviews();
  updateActiveCoords();
}

function onPointerUp() {
  // Viewer pan/zoom cleanup
  if (_viewerPanning) { _viewerPanning = false; _viewerPanStart = null; return; }
  if (_viewerZooming) { _viewerZooming = false; _viewerZoomStart = null; return; }

  pointerDown = false;
  pointerDownPos = null;
  if (!dragging) return;
  dragging = false;
  _draggingTransformControl = false;
  if (activeSelection && "point" in activeSelection) {
    const port = ports[activeSelection.port];
    markPortDirty(port);
  }
  renderPorts();
}

/** Double-click / double-tap: select closest point (only in points mode) */
function onDblSelect(e) {
  if (!mediaReady) return;
  if (viewerToolbar.getMode() !== "points") return;
  e.preventDefault();
  const { x, y } = getMediaCoords(e);
  const closest = findClosestPoint(x, y);
  if (closest && "point" in closest) {
    if (e.shiftKey) {
      togglePoint(closest.port, closest.point);
    } else {
      selectPoint(closest.port, closest.point);
    }
    renderPorts();
    drawOverlay();
  }
}

/** Fast update of only the active row's input values during drag */
function updateActiveCoords() {
  if (_draggingTransformControl && toolbar.isToolActive()) {
    const s = toolbar.getToolState();
    if (!s) return;
    const inputMap = {
      "Offset": [Math.round(s.offset.x), Math.round(s.offset.y)],
      "Pivot":  [Math.round(s.pivot.x), Math.round(s.pivot.y)],
      "Rotate": [(s.angle * 180 / Math.PI).toFixed(1)],
      "Scale":  [s.scaleX.toFixed(2), s.scaleY.toFixed(2)],
    };
    const rows = toolbarEl.querySelectorAll(".point-row");
    rows.forEach((row) => {
      const lbl = row.querySelector(".point-label");
      if (!lbl || !inputMap[lbl.textContent]) return;
      const inputs = row.querySelectorAll(".coord-input");
      const vals = inputMap[lbl.textContent];
      inputs.forEach((inp, i) => {
        if (i < vals.length && document.activeElement !== inp) inp.value = vals[i];
      });
    });
  }
}

// Mouse events (left-click only — middle-click handled by viewport for panning)
videoWrap.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return; // only left-click
  onPointerDown(e);
});
window.addEventListener("mousemove", onPointerMove);
window.addEventListener("mouseup", onPointerUp);
videoWrap.addEventListener("dblclick", onDblSelect);

// Touch events (single-touch only — two-finger gestures handled by viewport)
videoWrap.addEventListener("touchstart", (e) => {
  if (e.touches.length >= 2) return; // let viewport handle pinch-zoom
  e.preventDefault();
  onPointerDown(e);
}, { passive: false });
window.addEventListener("touchmove", (e) => {
  if (e.touches.length >= 2) return;
  onPointerMove(e);
}, { passive: false });
window.addEventListener("touchend", onPointerUp);

// Double-tap detection for touch
let lastTapTime = 0;
videoWrap.addEventListener("touchend", (e) => {
  const now = Date.now();
  if (now - lastTapTime < 300) {
    onDblSelect(e);
    lastTapTime = 0;
  } else {
    lastTapTime = now;
  }
});

// ------------------------------------------------------------------ //
// Overlay drawing
// ------------------------------------------------------------------ //

async function drawOverlay() {
  if (!mediaReady) return;
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

  viewport.applyTransform(overlayCtx);

  if (mediaType === "image" && loadedImage) {
    overlayCtx.drawImage(loadedImage, 0, 0);
  } else if (mediaType === "video" && frames.length > 0) {
    const bmp = await ensureFrameDecoded(currentFrameIdx);
    overlayCtx.drawImage(bmp, 0, 0);
  }

  drawOverlayPorts();

  viewport.restoreTransform(overlayCtx);
}

/** Draw port polylines and control points on the overlay (no background clear/draw) */
function drawOverlayPorts() {
  const transformActive = toolbar.isToolActive();
  const savedPositions = transformActive ? toolbar.getSavedPositions() : null;

  // When transform is active, draw ghost (original) positions for affected ports
  if (transformActive && savedPositions && savedPositions.size > 0) {
    // Group saved positions by port for ghost polyline drawing
    const portGhosts = new Map(); // portIdx → [{pointIdx, x, y}]
    for (const [key, saved] of savedPositions) {
      const [pi, pti] = key.split(":").map(Number);
      if (!portGhosts.has(pi)) portGhosts.set(pi, []);
      portGhosts.get(pi).push({ pointIdx: pti, x: saved.x, y: saved.y });
    }

    for (const [pi, ghostPts] of portGhosts) {
      const port = ports[pi];
      if (!port) continue;
      const color = rack.PORT_COLORS[pi % rack.PORT_COLORS.length];

      // Build full original polyline (mix ghost + current positions)
      const origPts = port.points.map((pt, pti) => {
        const ghost = ghostPts.find(g => g.pointIdx === pti);
        return ghost ? { x: ghost.x, y: ghost.y } : { x: pt.x, y: pt.y };
      });

      overlayCtx.globalAlpha = 0.25;
      overlayCtx.strokeStyle = color;
      overlayCtx.lineWidth = 2;
      overlayCtx.setLineDash([6, 4]);
      overlayCtx.beginPath();
      overlayCtx.moveTo(origPts[0].x, origPts[0].y);
      for (let i = 1; i < origPts.length; i++) {
        overlayCtx.lineTo(origPts[i].x, origPts[i].y);
      }
      overlayCtx.stroke();
      overlayCtx.setLineDash([]);
      overlayCtx.globalAlpha = 1;
    }
  }

  // Draw all port polylines and points
  ports.forEach((port, pi) => {
    const color = rack.PORT_COLORS[pi % rack.PORT_COLORS.length];
    const pts = port.points;

    overlayCtx.strokeStyle = color;
    overlayCtx.lineWidth = 2;
    overlayCtx.beginPath();
    overlayCtx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      overlayCtx.lineTo(pts[i].x, pts[i].y);
    }
    overlayCtx.stroke();

    pts.forEach((pt, pti) => {
      const isActive = activeSelection &&
        activeSelection.port === pi &&
        "point" in activeSelection &&
        activeSelection.point === pti;
      const isSelected = isPointSelected(pi, pti);

      // Selected points get a cyan highlight ring
      if (isSelected) {
        overlayCtx.strokeStyle = "#00aaff";
        overlayCtx.lineWidth = 2;
        overlayCtx.beginPath();
        overlayCtx.arc(pt.x, pt.y, 9, 0, Math.PI * 2);
        overlayCtx.stroke();
      }

      overlayCtx.fillStyle = isActive ? "#fff" : isSelected ? "#00aaff" : color;
      overlayCtx.beginPath();
      overlayCtx.arc(pt.x, pt.y, isActive ? 7 : 5, 0, Math.PI * 2);
      overlayCtx.fill();

      if (isActive) {
        overlayCtx.strokeStyle = "#fff";
        overlayCtx.lineWidth = 2;
        overlayCtx.beginPath();
        overlayCtx.arc(pt.x, pt.y, 10, 0, Math.PI * 2);
        overlayCtx.stroke();
      }

      overlayCtx.fillStyle = "#fff";
      overlayCtx.font = "12px sans-serif";
      overlayCtx.fillText(
        String.fromCharCode(65 + pti),
        pt.x + 10,
        pt.y - 10
      );
    });
  });

  // Draw transform control handles when toolbar transform is active
  if (transformActive) {
    const controls = toolbar.getControlPoints();
    if (!controls) return;
    const activeCtrl = toolbar.getActiveControl();

    for (const cp of controls) {
      const isActive = activeCtrl === cp.key;

      if (cp.key === "offset") {
        const sz = isActive ? 8 : 6;
        overlayCtx.fillStyle = isActive ? "#fff" : "#00ff88";
        overlayCtx.fillRect(cp.x - sz, cp.y - sz, sz * 2, sz * 2);
        if (isActive) {
          overlayCtx.strokeStyle = "#fff";
          overlayCtx.lineWidth = 2;
          overlayCtx.strokeRect(cp.x - sz - 3, cp.y - sz - 3, (sz + 3) * 2, (sz + 3) * 2);
        }
        overlayCtx.fillStyle = "#fff";
        overlayCtx.font = "11px sans-serif";
        overlayCtx.fillText(cp.key, cp.x + 10, cp.y - 8);
      } else if (cp.key === "pivot") {
        const sz = 8;
        overlayCtx.strokeStyle = isActive ? "#fff" : "#ffaa00";
        overlayCtx.lineWidth = 2;
        overlayCtx.beginPath();
        overlayCtx.moveTo(cp.x - sz, cp.y); overlayCtx.lineTo(cp.x + sz, cp.y);
        overlayCtx.moveTo(cp.x, cp.y - sz); overlayCtx.lineTo(cp.x, cp.y + sz);
        overlayCtx.stroke();
        overlayCtx.beginPath();
        overlayCtx.moveTo(cp.x, cp.y - sz);
        overlayCtx.lineTo(cp.x + sz, cp.y);
        overlayCtx.lineTo(cp.x, cp.y + sz);
        overlayCtx.lineTo(cp.x - sz, cp.y);
        overlayCtx.closePath();
        overlayCtx.stroke();
      } else {
        overlayCtx.fillStyle = isActive ? "#fff" : "#00aaff";
        overlayCtx.beginPath();
        overlayCtx.arc(cp.x, cp.y, isActive ? 8 : 6, 0, Math.PI * 2);
        overlayCtx.fill();
        if (isActive) {
          overlayCtx.strokeStyle = "#fff";
          overlayCtx.lineWidth = 2;
          overlayCtx.beginPath();
          overlayCtx.arc(cp.x, cp.y, 11, 0, Math.PI * 2);
          overlayCtx.stroke();
        }
        overlayCtx.fillStyle = "#fff";
        overlayCtx.font = "11px sans-serif";
        overlayCtx.fillText(cp.key, cp.x + 10, cp.y - 8);
      }

      // Draw dashed lines: offset→pivot, pivot→rotate/scale handles
      if (cp.key === "pivot") {
        const off = controls.find((c) => c.key === "offset");
        if (off) {
          overlayCtx.strokeStyle = "rgba(255,255,255,0.3)";
          overlayCtx.lineWidth = 1;
          overlayCtx.setLineDash([4, 4]);
          overlayCtx.beginPath();
          overlayCtx.moveTo(off.x, off.y);
          overlayCtx.lineTo(cp.x, cp.y);
          overlayCtx.stroke();
          overlayCtx.setLineDash([]);
        }
      } else if (cp.key !== "offset") {
        const pivot = controls.find((c) => c.key === "pivot");
        if (pivot) {
          overlayCtx.strokeStyle = "rgba(255,255,255,0.3)";
          overlayCtx.lineWidth = 1;
          overlayCtx.setLineDash([4, 4]);
          overlayCtx.beginPath();
          overlayCtx.moveTo(pivot.x, pivot.y);
          overlayCtx.lineTo(cp.x, cp.y);
          overlayCtx.stroke();
          overlayCtx.setLineDash([]);
        }
      }
    }
  }
}

// ------------------------------------------------------------------ //
// FPS detection
// ------------------------------------------------------------------ //

function detectFPS() {
  return new Promise((resolve) => {
    if (!("requestVideoFrameCallback" in video)) {
      resolve(30);
      return;
    }

    const times = [];
    video.currentTime = 0;
    video.muted = true;

    function onFrame(_now, metadata) {
      times.push(metadata.mediaTime);
      if (times.length >= 6) {
        video.pause();
        video.currentTime = 0;
        let total = 0;
        for (let i = 1; i < times.length; i++) {
          total += times[i] - times[i - 1];
        }
        const avg = total / (times.length - 1);
        const fps = Math.round(1 / avg);
        resolve(fps > 0 ? fps : 30);
      } else {
        video.requestVideoFrameCallback(onFrame);
      }
    }

    video.requestVideoFrameCallback(onFrame);
    const p = video.play();
    if (p) p.catch(() => {});
  });
}

// ------------------------------------------------------------------ //
// Sampling (delegates to renderer/sampling.js)
// ------------------------------------------------------------------ //

function samplePortLine(ctx, port) {
  return _samplePortLine(ctx, port, mediaW, mediaH);
}

// ------------------------------------------------------------------ //
// Processing
// ------------------------------------------------------------------ //

// Export, save, and load delegated to modules (output/export.js, scene/save.js, scene/load.js)

async function doExport() {
  if (!mediaReady) { setStatus("Load a video or image first."); return; }
  if (ports.length === 0) { setStatus("Add at least one port."); return; }
  return _doExport({
    ports,
    isImage: mediaType === "image",
    fps: detectedFPS || 30,
    inPoint,
    outPoint,
    templateHeaderBuffer,
    includeTxt,
    portPreviewCanvases,
    portDirty,
    processMultiPortPreviews,
    setStatus,
    setExporting(v) { exporting = v; },
    renderOutputSection,
  });
}

function saveScene() {
  return _saveScene({
    controllers, ports, portPreviewCanvases,
    portsPerController, maxResolution, frameOffset, frameLength,
    detectedFPS, mediaType, mediaW, mediaH,
    frames, inPoint, outPoint,
    templateHeaderBuffer, templateFileName,
    loadedImage,
  }, setStatus);
}

function loadScene() {
  _loadScene((result) => {
    // Clear existing state
    for (const port of ports) {
      portDirty.delete(port);
      portPreviewCanvases.delete(port);
      portPreviewProcessing.delete(port);
    }
    clearDecodedFrame();

    // Apply restored state
    if (result.portsPerController != null) portsPerController = result.portsPerController;
    if (result.maxResolution != null) maxResolution = result.maxResolution;
    if (result.frameOffset != null) frameOffset = result.frameOffset;
    if (result.frameLength != null) frameLength = result.frameLength;
    if (result.detectedFPS != null) detectedFPS = result.detectedFPS;

    frames = result.frames;
    loadedImage = result.loadedImage;
    controllers = result.controllers;
    activeSelection = null;
    toolbar.onSelectionChanged();
    currentFrameIdx = 0;
    mediaType = result.mediaType;
    inPoint = result.inPoint;
    outPoint = result.outPoint;

    if (result.templateHeaderBuffer) {
      templateHeaderBuffer = result.templateHeaderBuffer;
      templateFileName = result.templateFileName || "restored.dat";
    }

    const w = result.mediaW;
    const h = result.mediaH;
    if (w > 0 && h > 0) {
      mediaW = w;
      mediaH = h;
      mediaReady = true;
      overlay.width = w;
      overlay.height = h;
      video.style.display = "none";
      overlay.classList.add("static");
      sampleCanvas = document.createElement("canvas");
      sampleCanvas.width = w;
      sampleCanvas.height = h;
      sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });
      viewport.setMediaSize(w, h);
      viewport.resetView();
    }

    rebuildPortsList();

    // Restore preview canvases
    if (result.previewCanvases) {
      for (const [port, canvas] of result.previewCanvases) {
        portPreviewCanvases.set(port, canvas);
        portDirty.delete(port);
      }
    }
    // Mark remaining ports dirty
    for (const port of ports) {
      if (!portPreviewCanvases.has(port)) portDirty.add(port);
    }

    renderPorts();
    drawOverlay();
    updateLinePreviews();
    renderOutputSection();
  }, setStatus);
}

// ------------------------------------------------------------------ //
// Helpers
// ------------------------------------------------------------------ //

function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}
