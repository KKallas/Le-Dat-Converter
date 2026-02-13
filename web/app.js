import { DATFile } from "../js/datfile.js";

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

// ------------------------------------------------------------------ //
// Constants
// ------------------------------------------------------------------ //

const PORT_COLORS = [
  "#e94560", "#00ff88", "#00aaff", "#ffaa00",
  "#ff66cc", "#88ff00", "#aa66ff", "#ff4400",
];

const DRAG_INTERVAL = 20; // ~50fps throttle for drag updates

// ------------------------------------------------------------------ //
// State
// ------------------------------------------------------------------ //

/**
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{ center: Point, pivot: Point, offset: Point, angle: number, scaleX: number, scaleY: number, baseRadius: number }} TransformState
 * @typedef {{ leds: number, trimStart: number, trimEnd: number, points: Point[], collapsed: boolean, previewCollapsed: boolean, editMode: string, savedPoints: Point[]|null, transformState: TransformState|null }} Port
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

/** Currently selected point: { port, point } where port is flat index, or null */
let activeSelection = null;

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
let playbackTimerId = null;

/** Decoded frame cache — avoids re-decoding the current frame on every draw */
let decodedFrame = null; // { idx: number, bmp: ImageBitmap }

async function ensureFrameDecoded(idx) {
  if (decodedFrame && decodedFrame.idx === idx) return decodedFrame.bmp;
  if (decodedFrame) { decodedFrame.bmp.close(); decodedFrame = null; }
  const bmp = await createImageBitmap(frames[idx]);
  decodedFrame = { idx, bmp };
  return bmp;
}

function getDecodedFrame() {
  return decodedFrame ? decodedFrame.bmp : null;
}

function clearDecodedFrame() {
  if (decodedFrame) { decodedFrame.bmp.close(); decodedFrame = null; }
}

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
// Frame-based playback (no video seeking — uses pre-extracted frames)
// ------------------------------------------------------------------ //

function updatePlaybackUI() {
  const seekBar = document.getElementById("seek-bar");
  const frameLabel = document.getElementById("frame-label");
  if (!seekBar || !frameLabel) return;
  if (document.activeElement !== seekBar) {
    seekBar.value = String(currentFrameIdx);
  }
  const fps = detectedFPS || 30;
  const t = currentFrameIdx / fps;
  frameLabel.textContent = `${currentFrameIdx} / ${frames.length}  (${t.toFixed(2)}s)`;
}

async function doPlay() {
  if (frames.length === 0) return;
  if (isPlaying) return;
  // Jump to inPoint if current position is outside the in/out range
  if (currentFrameIdx < inPoint || currentFrameIdx >= outPoint) {
    currentFrameIdx = inPoint;
    await drawOverlay();
  }
  isPlaying = true;
  renderOutputSection();
  const fps = detectedFPS || 30;
  const interval = 1000 / fps;
  let lastTime = performance.now();
  let decoding = false;

  function step(now) {
    if (!isPlaying) return;
    if (decoding) { playbackTimerId = requestAnimationFrame(step); return; }
    if (now - lastTime >= interval) {
      lastTime += interval;
      currentFrameIdx++;
      if (currentFrameIdx > outPoint) {
        currentFrameIdx = outPoint;
        doPause();
        return;
      }
      decoding = true;
      ensureFrameDecoded(currentFrameIdx).then((bmp) => {
        decoding = false;
        if (!isPlaying) return;
        overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
        overlayCtx.drawImage(bmp, 0, 0);
        // Redraw port overlays on top
        drawOverlayPorts();
        updatePlaybackUI();
      });
    }
    playbackTimerId = requestAnimationFrame(step);
  }
  playbackTimerId = requestAnimationFrame(step);
}

function doPause() {
  if (!isPlaying && !playbackTimerId) return;
  isPlaying = false;
  if (playbackTimerId) {
    cancelAnimationFrame(playbackTimerId);
    playbackTimerId = null;
  }
  renderOutputSection();
  updateLinePreviews();
}

async function doStop() {
  isPlaying = false;
  if (playbackTimerId) {
    cancelAnimationFrame(playbackTimerId);
    playbackTimerId = null;
  }
  currentFrameIdx = 0;
  await drawOverlay();
  updatePlaybackUI();
  await updateLinePreviews();
  renderOutputSection();
}

async function doSeek(frameIdx) {
  if (frames.length === 0) return;
  if (isPlaying) doPause();
  currentFrameIdx = Math.max(0, Math.min(frames.length - 1, frameIdx));
  await drawOverlay();
  updatePlaybackUI();
  await updateLinePreviews();
}

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
// Port / point data model
// ------------------------------------------------------------------ //

/** Rebuild the flat `ports` array from `controllers`. Call after any structural change. */
function rebuildPortsList() {
  ports = controllers.flatMap((c) => c.ports);
}

function addController() {
  controllers.push({ ports: [], collapsed: false });
}

function removeController(ci) {
  const ctrl = controllers[ci];
  // Compute flat index of first port in this controller
  let firstFlat = 0;
  for (let i = 0; i < ci; i++) firstFlat += controllers[i].ports.length;
  const count = ctrl.ports.length;

  // Clean up all ports
  for (const port of ctrl.ports) {
    portDirty.delete(port);
    portPreviewCanvases.delete(port);
    portPreviewProcessing.delete(port);
  }

  controllers.splice(ci, 1);
  rebuildPortsList();

  // Adjust active selection
  if (activeSelection) {
    if (activeSelection.port >= firstFlat && activeSelection.port < firstFlat + count) {
      activeSelection = null;
    } else if (activeSelection.port >= firstFlat + count) {
      activeSelection.port -= count;
    }
  }
}

function addPort(ci, leds = 400, points = null) {
  if (!points) {
    const cx = mediaReady ? Math.round(mediaW / 2) : 200;
    const cy = mediaReady ? Math.round(mediaH / 2) : 200;
    points = [
      { x: cx - 100, y: cy },
      { x: cx + 100, y: cy },
    ];
  }
  const port = { leds, points, collapsed: false, previewCollapsed: true, editMode: "points", savedPoints: null, transformState: null, trimStart: 0, trimEnd: 0 };
  controllers[ci].ports.push(port);
  rebuildPortsList();
  portDirty.add(port);
  activeSelection = { port: ports.indexOf(port), point: 0 };
}

function removePort(ci, pi) {
  const ctrl = controllers[ci];
  const port = ctrl.ports[pi];

  // Compute flat index before removal
  let flatIdx = 0;
  for (let i = 0; i < ci; i++) flatIdx += controllers[i].ports.length;
  flatIdx += pi;

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
}

function addPointToPort(portIdx) {
  const pts = ports[portIdx].points;
  const last = pts[pts.length - 1];
  pts.push({ x: last.x + 30, y: last.y });
  activeSelection = { port: portIdx, point: pts.length - 1 };
}

function removePointFromPort(portIdx, pointIdx) {
  if (ports[portIdx].points.length <= 2) return;
  ports[portIdx].points.splice(pointIdx, 1);
  if (activeSelection &&
      activeSelection.port === portIdx &&
      activeSelection.point === pointIdx) {
    activeSelection = null;
  } else if (activeSelection &&
             activeSelection.port === portIdx &&
             activeSelection.point > pointIdx) {
    activeSelection.point--;
  }
}

// ------------------------------------------------------------------ //
// Transform mode
// ------------------------------------------------------------------ //

function enterTransformMode(port) {
  port.savedPoints = port.points.map((p) => ({ x: p.x, y: p.y }));

  // Compute centroid
  let cx = 0, cy = 0;
  for (const p of port.points) { cx += p.x; cy += p.y; }
  cx /= port.points.length;
  cy /= port.points.length;

  // Compute baseRadius from max distance of points to centroid (min 50)
  // Clamp so scale handles (at half radius) stay within the frame
  let maxDist = 0;
  for (const p of port.points) {
    const d = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
    if (d > maxDist) maxDist = d;
  }
  const maxAllowed = Math.min(cx, cy, mediaW - cx, mediaH - cy) * 2; // *2 because handles use half
  const baseRadius = Math.max(50, Math.min(maxDist, maxAllowed));

  port.transformState = {
    center: { x: Math.round(cx), y: Math.round(cy) },
    offset: { x: 0, y: 0 },
    pivot: { x: 0, y: 0 },
    angle: 0,
    scaleX: 1,
    scaleY: 1,
    baseRadius,
  };
  port.editMode = "transform";
}

function applyTransform(port) {
  if (!port.transformState || !port.savedPoints) return;
  port.points = computeTransformedPoints(port.savedPoints, port.transformState);
  port.editMode = "points";
  port.savedPoints = null;
  port.transformState = null;
  markPortDirty(port);
}

function cancelTransform(port) {
  if (port.savedPoints) {
    port.points = port.savedPoints;
  }
  port.editMode = "points";
  port.savedPoints = null;
  port.transformState = null;
}

/** Apply Scale → Rotate → Translate. Effective pivot = center + pivot. Offset moves everything. */
function computeTransformedPoints(savedPoints, state) {
  const { center, pivot, offset, angle, scaleX, scaleY } = state;
  const epx = center.x + pivot.x; // effective pivot in original space
  const epy = center.y + pivot.y;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return savedPoints.map((p) => {
    const rx = (p.x - epx) * scaleX;
    const ry = (p.y - epy) * scaleY;
    const rotX = rx * cos - ry * sin;
    const rotY = rx * sin + ry * cos;
    return {
      x: Math.round(rotX + epx + offset.x),
      y: Math.round(rotY + epy + offset.y),
    };
  });
}

/** Get all draggable control points (always returns every handle) */
function getTransformControlPoints(port) {
  const s = port.transformState;
  if (!s) return [];
  const sr = s.baseRadius / 2;
  // Widget center (offset handle) in world space
  const wx = s.center.x + s.offset.x;
  const wy = s.center.y + s.offset.y;
  // Effective pivot in world space
  const px = wx + s.pivot.x;
  const py = wy + s.pivot.y;

  return [
    { key: "offset", x: wx, y: wy },
    { key: "pivot",  x: px, y: py },
    { key: "rotate", x: px + s.baseRadius * Math.cos(s.angle), y: py + s.baseRadius * Math.sin(s.angle) },
    { key: "scaleX", x: px + sr * s.scaleX, y: py },
    { key: "scaleY", x: px, y: py + sr * s.scaleY },
  ];
}

/** Parse tab-separated normalized coordinates back to pixel points */
function parseSaveLoadText(text, w, h) {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  const points = [];
  for (const line of lines) {
    const parts = line.split(/\t|,|\s+/).map(Number);
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      points.push({
        x: Math.round(parts[0] * w),
        y: Math.round(parts[1] * h),
      });
    }
  }
  return points;
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

/** Per-port line preview canvases, keyed by port index */
const linePreviewCanvases = new Map();

function renderPorts() {
  portsList.innerHTML = "";
  linePreviewCanvases.clear();

  let flatIdx = 0;

  controllers.forEach((ctrl, ci) => {
    const group = document.createElement("div");
    group.className = "controller-group";

    // Controller header
    const ctrlHeader = document.createElement("div");
    ctrlHeader.className = "controller-header";

    const ctrlToggle = document.createElement("button");
    ctrlToggle.className = "btn-toggle";
    ctrlToggle.textContent = ctrl.collapsed ? "\u25b6" : "\u25bc";
    ctrlToggle.addEventListener("click", () => {
      ctrl.collapsed = !ctrl.collapsed;
      renderPorts();
    });

    const ctrlLabel = document.createElement("span");
    ctrlLabel.className = "port-label";
    ctrlLabel.textContent = `Controller ${ci}`;

    const ctrlPortCount = document.createElement("span");
    ctrlPortCount.style.cssText = "font-size:0.75rem;color:#888";
    ctrlPortCount.textContent = `(${ctrl.ports.length} port${ctrl.ports.length !== 1 ? "s" : ""})`;

    const ctrlRemoveBtn = document.createElement("button");
    ctrlRemoveBtn.className = "btn-danger";
    ctrlRemoveBtn.textContent = "Remove";
    ctrlRemoveBtn.addEventListener("click", () => {
      removeController(ci);
      renderPorts();
      drawOverlay();
    });

    ctrlHeader.append(ctrlToggle, ctrlLabel, ctrlPortCount, ctrlRemoveBtn);
    group.appendChild(ctrlHeader);

    if (ctrl.collapsed) {
      // Skip rendering ports, just count flat indices
      flatIdx += ctrl.ports.length;
      portsList.appendChild(group);
      return; // continue to next controller
    }

    // Ports within this controller
    ctrl.ports.forEach((port, pi) => {
      const globalIdx = flatIdx;
      const color = PORT_COLORS[globalIdx % PORT_COLORS.length];
      const isCollapsed = port.collapsed;

      const div = document.createElement("div");
      div.className = "port";

      // Header row
      const header = document.createElement("div");
      header.className = "port-header";

      const toggle = document.createElement("button");
      toggle.className = "btn-toggle";
      toggle.textContent = isCollapsed ? "\u25b6" : "\u25bc";
      toggle.addEventListener("click", () => {
        port.collapsed = !port.collapsed;
        renderPorts();
      });

      const dot = document.createElement("span");
      dot.className = "color-dot";
      dot.style.background = color;

      const label = document.createElement("span");
      label.className = "port-label";
      label.textContent = `Port ${pi}`;

      const ledsLabel = document.createElement("label");
      ledsLabel.textContent = "LEDs";

      const ledsInput = document.createElement("input");
      ledsInput.type = "number";
      ledsInput.min = "1";
      ledsInput.max = "400";
      ledsInput.value = port.leds;
      ledsInput.addEventListener("change", () => {
        port.leds = Math.max(1, Math.min(400, parseInt(ledsInput.value) || 1));
        ledsInput.value = port.leds;
        updateLinePreviews();
        markPortDirty(port);
      });

      const removeBtn = document.createElement("button");
      removeBtn.className = "btn-danger";
      removeBtn.textContent = "\u00d7";
      removeBtn.addEventListener("click", () => {
        removePort(ci, pi);
        renderPorts();
        drawOverlay();
      });

      const isDirty = portDirty.has(port);
      const isProcessing = portPreviewProcessing.has(port);
      const progress = portPreviewProcessing.get(port);

      const renderBtn = document.createElement("button");
      renderBtn.className = "btn-small";
      renderBtn.textContent = isProcessing ? `Rendering ${progress.frame}/${progress.total}` : "Render";
      renderBtn.disabled = !isDirty || isProcessing;
      renderBtn.addEventListener("click", () => {
        renderBtn.textContent = "Rendering\u2026";
        renderBtn.disabled = true;
        processPortPreview(port);
      });

      header.append(toggle, dot, label, ledsLabel, ledsInput, renderBtn, removeBtn);
      div.appendChild(header);

      // Line preview strip (always visible)
      const lineCanvas = document.createElement("canvas");
      lineCanvas.className = "line-preview";
      lineCanvas.height = 1;
      lineCanvas.width = port.leds;
      div.appendChild(lineCanvas);
      linePreviewCanvases.set(globalIdx, lineCanvas);

      // Per-port bitmap preview (foldable)
      const hasPreview = portPreviewCanvases.has(port);
      if (hasPreview || isProcessing) {
        const prevSection = document.createElement("div");
        prevSection.className = "port-preview-section";

        const prevHeader = document.createElement("div");
        prevHeader.className = "port-preview-header";

        const prevToggle = document.createElement("button");
        prevToggle.className = "btn-toggle";
        prevToggle.textContent = port.previewCollapsed ? "\u25b6" : "\u25bc";
        prevToggle.addEventListener("click", () => {
          port.previewCollapsed = !port.previewCollapsed;
          renderPorts();
        });

        const prevLabel = document.createElement("span");
        prevLabel.className = "preview-label";
        prevLabel.style.margin = "0";
        prevLabel.textContent = "Preview";

        prevHeader.append(prevToggle, prevLabel);

        if (isProcessing) {
          const status = document.createElement("span");
          status.className = "port-preview-status";
          status.textContent = `Rendering ${progress.frame}/${progress.total}`;
          prevHeader.appendChild(status);
        }

        prevSection.appendChild(prevHeader);

        if (!port.previewCollapsed && hasPreview) {
          const canvas = portPreviewCanvases.get(port);
          canvas.className = "preview-canvas";
          const totalFrames = canvas._totalFrames || 1;
          const fps = canvas._fps || 30;
          const leds = canvas._leds || port.leds;
          const totalSeconds = totalFrames / fps;

          const wrapper = document.createElement("div");
          wrapper.className = "preview-axes-wrapper";

          const xAxis = document.createElement("div");
          xAxis.className = "preview-x-axis";
          const xStep = leds <= 100 ? 25 : leds <= 200 ? 50 : 100;
          for (let led = 0; led <= leds; led += xStep) {
            const tick = document.createElement("span");
            tick.textContent = led;
            tick.style.left = (led / leds * 100) + "%";
            xAxis.appendChild(tick);
          }

          const yAxis = document.createElement("div");
          yAxis.className = "preview-y-axis";
          const yStep = totalSeconds <= 5 ? 1 : totalSeconds <= 20 ? 2 : 5;
          for (let s = 0; s <= totalSeconds; s += yStep) {
            const tick = document.createElement("span");
            tick.textContent = s + "s";
            tick.style.top = (s / totalSeconds * 100) + "%";
            yAxis.appendChild(tick);
          }

          wrapper.append(yAxis, xAxis, canvas);
          prevSection.appendChild(wrapper);
        }

        div.appendChild(prevSection);
      }

      // Trim + edit mode section (collapsible)
      if (!isCollapsed) {
        // Trim start/end
        const trimRow = document.createElement("div");
        trimRow.className = "point-actions";
        trimRow.style.display = "flex";
        trimRow.style.gap = "8px";
        trimRow.style.alignItems = "center";

        const tsLabel = document.createElement("label");
        tsLabel.textContent = "Trim start";
        const tsInput = document.createElement("input");
        tsInput.type = "number";
        tsInput.min = "0";
        tsInput.max = String(port.leds - port.trimEnd - 2);
        tsInput.value = String(port.trimStart);
        tsInput.addEventListener("change", () => {
          port.trimStart = Math.max(0, Math.min(port.leds - port.trimEnd - 2, parseInt(tsInput.value) || 0));
          tsInput.value = port.trimStart;
          updateLinePreviews();
          markPortDirty(port);
          renderPorts();
        });

        const teLabel = document.createElement("label");
        teLabel.textContent = "end";
        const teInput = document.createElement("input");
        teInput.type = "number";
        teInput.min = "0";
        teInput.max = String(port.leds - port.trimStart - 2);
        teInput.value = String(port.trimEnd);
        teInput.addEventListener("change", () => {
          port.trimEnd = Math.max(0, Math.min(port.leds - port.trimStart - 2, parseInt(teInput.value) || 0));
          teInput.value = port.trimEnd;
          updateLinePreviews();
          markPortDirty(port);
          renderPorts();
        });

        trimRow.append(tsLabel, tsInput, teLabel, teInput);
        div.appendChild(trimRow);

        // Dropdown: Points / Transform
        const modeRow = document.createElement("div");
        modeRow.className = "point-actions";
        const modeSelect = document.createElement("select");
        modeSelect.className = "edit-mode-select";
        for (const [val, lbl] of [["points", "Points"], ["transform", "Transform"], ["saveload", "Save/Load"]]) {
          const opt = document.createElement("option");
          opt.value = val;
          opt.textContent = lbl;
          if (port.editMode === val) opt.selected = true;
          modeSelect.appendChild(opt);
        }
        modeSelect.addEventListener("change", () => {
          const prev = port.editMode;
          const next = modeSelect.value;
          // Leaving transform without applying = cancel
          if (prev === "transform" && next !== "transform") {
            cancelTransform(port);
            activeSelection = null;
          }
          if (next === "transform" && prev !== "transform") {
            enterTransformMode(port);
            activeSelection = { port: globalIdx, control: "offset" };
          }
          if (next === "saveload") {
            port.editMode = "saveload";
          } else if (next === "points") {
            port.editMode = "points";
          }
          renderPorts();
          drawOverlay();
        });
        modeRow.appendChild(modeSelect);
        div.appendChild(modeRow);

        if (port.editMode === "points") {
          // Points list
          const pointsDiv = document.createElement("div");
          pointsDiv.className = "points-list";

          port.points.forEach((pt, pti) => {
            const row = document.createElement("div");
            row.className = "point-row";
            const isActive = activeSelection &&
                activeSelection.port === globalIdx &&
                activeSelection.point === pti;
            if (isActive) row.classList.add("active");

            const ptLabel = document.createElement("span");
            ptLabel.className = "point-label";
            ptLabel.textContent = String.fromCharCode(65 + pti);

            const xIn = document.createElement("input");
            xIn.type = "number";
            xIn.className = "coord-input";
            xIn.value = pt.x;
            xIn.addEventListener("change", () => {
              pt.x = Math.max(0, Math.min(mediaW - 1, parseInt(xIn.value) || 0));
              xIn.value = pt.x;
              markPortDirty(port);
              drawOverlay();
              updateLinePreviews();
            });
            xIn.addEventListener("click", (e) => e.stopPropagation());

            const yIn = document.createElement("input");
            yIn.type = "number";
            yIn.className = "coord-input";
            yIn.value = pt.y;
            yIn.addEventListener("change", () => {
              pt.y = Math.max(0, Math.min(mediaH - 1, parseInt(yIn.value) || 0));
              yIn.value = pt.y;
              markPortDirty(port);
              drawOverlay();
              updateLinePreviews();
            });
            yIn.addEventListener("click", (e) => e.stopPropagation());

            row.append(ptLabel, xIn, yIn);

            if (port.points.length > 2) {
              const rmPt = document.createElement("button");
              rmPt.className = "btn-danger";
              rmPt.textContent = "\u00d7";
              rmPt.style.marginLeft = "auto";
              rmPt.addEventListener("click", (e) => {
                e.stopPropagation();
                removePointFromPort(globalIdx, pti);
                markPortDirty(port);
                renderPorts();
                drawOverlay();
              });
              row.appendChild(rmPt);
            }

            row.addEventListener("click", () => {
              activeSelection = { port: globalIdx, point: pti };
              renderPorts();
              drawOverlay();
            });

            pointsDiv.appendChild(row);
          });

          div.appendChild(pointsDiv);

          // Add point button
          const actions = document.createElement("div");
          actions.className = "point-actions";
          const addPtBtn = document.createElement("button");
          addPtBtn.className = "btn-small";
          addPtBtn.textContent = "+ Point";
          addPtBtn.addEventListener("click", () => {
            addPointToPort(globalIdx);
            markPortDirty(port);
            renderPorts();
            drawOverlay();
          });
          actions.appendChild(addPtBtn);
          div.appendChild(actions);
        } else if (port.editMode === "transform") {
          // Transform mode UI — list controls like point rows
          const s = port.transformState;
          const controlsList = document.createElement("div");
          controlsList.className = "points-list";

          /** Helper: create a control row with editable input(s) */
          function makeControlRow(key, label, inputs) {
            const row = document.createElement("div");
            row.className = "point-row";
            if (activeSelection &&
                activeSelection.port === globalIdx &&
                "control" in activeSelection &&
                activeSelection.control === key) {
              row.classList.add("active");
            }
            const lbl = document.createElement("span");
            lbl.className = "point-label";
            lbl.textContent = label;
            row.append(lbl, ...inputs);
            row.addEventListener("click", () => {
              activeSelection = { port: globalIdx, control: key };
              renderPorts();
              drawOverlay();
            });
            return row;
          }

          function applyTransformInputs() {
            port.points = computeTransformedPoints(port.savedPoints, s);
            drawOverlay();
            updateLinePreviews();
          }

          if (s) {
            // Offset (x, y) — primary: moves the whole widget
            const ofX = document.createElement("input");
            ofX.type = "number"; ofX.className = "coord-input"; ofX.value = Math.round(s.offset.x);
            ofX.addEventListener("click", (e) => e.stopPropagation());
            ofX.addEventListener("change", () => { s.offset.x = parseInt(ofX.value) || 0; applyTransformInputs(); });
            const ofY = document.createElement("input");
            ofY.type = "number"; ofY.className = "coord-input"; ofY.value = Math.round(s.offset.y);
            ofY.addEventListener("click", (e) => e.stopPropagation());
            ofY.addEventListener("change", () => { s.offset.y = parseInt(ofY.value) || 0; applyTransformInputs(); });
            controlsList.appendChild(makeControlRow("offset", "Offset", [ofX, ofY]));

            // Pivot (x, y) — relative to offset, adjusts rotation/scale center
            const pvX = document.createElement("input");
            pvX.type = "number"; pvX.className = "coord-input"; pvX.value = Math.round(s.pivot.x);
            pvX.addEventListener("click", (e) => e.stopPropagation());
            pvX.addEventListener("change", () => { s.pivot.x = parseInt(pvX.value) || 0; applyTransformInputs(); });
            const pvY = document.createElement("input");
            pvY.type = "number"; pvY.className = "coord-input"; pvY.value = Math.round(s.pivot.y);
            pvY.addEventListener("click", (e) => e.stopPropagation());
            pvY.addEventListener("change", () => { s.pivot.y = parseInt(pvY.value) || 0; applyTransformInputs(); });
            controlsList.appendChild(makeControlRow("pivot", "Pivot", [pvX, pvY]));

            // Rotate (degrees)
            const rotIn = document.createElement("input");
            rotIn.type = "number"; rotIn.className = "coord-input"; rotIn.step = "0.1";
            rotIn.value = (s.angle * 180 / Math.PI).toFixed(1);
            rotIn.addEventListener("click", (e) => e.stopPropagation());
            rotIn.addEventListener("change", () => { s.angle = (parseFloat(rotIn.value) || 0) * Math.PI / 180; applyTransformInputs(); });
            const degLabel = document.createElement("span");
            degLabel.className = "coords";
            degLabel.textContent = "\u00b0";
            controlsList.appendChild(makeControlRow("rotate", "Rotate", [rotIn, degLabel]));

            // ScaleX
            const sxIn = document.createElement("input");
            sxIn.type = "number"; sxIn.className = "coord-input"; sxIn.step = "0.01";
            sxIn.value = s.scaleX.toFixed(2);
            sxIn.addEventListener("click", (e) => e.stopPropagation());
            sxIn.addEventListener("change", () => { s.scaleX = parseFloat(sxIn.value) || 1; applyTransformInputs(); });
            controlsList.appendChild(makeControlRow("scaleX", "ScaleX", [sxIn]));

            // ScaleY
            const syIn = document.createElement("input");
            syIn.type = "number"; syIn.className = "coord-input"; syIn.step = "0.01";
            syIn.value = s.scaleY.toFixed(2);
            syIn.addEventListener("click", (e) => e.stopPropagation());
            syIn.addEventListener("change", () => { s.scaleY = parseFloat(syIn.value) || 1; applyTransformInputs(); });
            controlsList.appendChild(makeControlRow("scaleY", "ScaleY", [syIn]));
          }

          div.appendChild(controlsList);

          // Apply / Cancel
          const actionsRow = document.createElement("div");
          actionsRow.className = "transform-actions";
          const applyBtn = document.createElement("button");
          applyBtn.className = "btn-small btn-primary";
          applyBtn.textContent = "Apply";
          applyBtn.addEventListener("click", () => {
            applyTransform(port);
            activeSelection = null;
            renderPorts();
            drawOverlay();
            updateLinePreviews();
          });
          const cancelBtn = document.createElement("button");
          cancelBtn.className = "btn-small";
          cancelBtn.textContent = "Cancel";
          cancelBtn.addEventListener("click", () => {
            cancelTransform(port);
            activeSelection = null;
            renderPorts();
            drawOverlay();
            updateLinePreviews();
          });
          actionsRow.append(applyBtn, cancelBtn);
          div.appendChild(actionsRow);
        } else if (port.editMode === "saveload") {
          // Save/Load mode — textarea with normalized coordinates
          const w = mediaW || 1;
          const h = mediaH || 1;
          const text = port.points
            .map((p) => `${(p.x / w).toFixed(6)}\t${(p.y / h).toFixed(6)}`)
            .join("\n");

          const ta = document.createElement("textarea");
          ta.className = "saveload-textarea";
          ta.value = text;
          ta.spellcheck = false;
          div.appendChild(ta);

          const slActions = document.createElement("div");
          slActions.className = "transform-actions";

          const copyBtn = document.createElement("button");
          copyBtn.className = "btn-small";
          copyBtn.textContent = "Copy";
          copyBtn.addEventListener("click", () => {
            navigator.clipboard.writeText(ta.value).then(() => {
              copyBtn.textContent = "Copied!";
              setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
            });
          });

          const loadBtn = document.createElement("button");
          loadBtn.className = "btn-small btn-primary";
          loadBtn.textContent = "Load";
          loadBtn.addEventListener("click", () => {
            const parsed = parseSaveLoadText(ta.value, w, h);
            if (parsed && parsed.length >= 2) {
              port.points = parsed;
              markPortDirty(port);
              port.editMode = "points";
              activeSelection = { port: globalIdx, point: 0 };
              renderPorts();
              drawOverlay();
              updateLinePreviews();
            } else {
              loadBtn.textContent = "Need 2+ points";
              setTimeout(() => { loadBtn.textContent = "Load"; }, 2000);
            }
          });

          slActions.append(copyBtn, loadBtn);
          div.appendChild(slActions);
        }
      }

      group.appendChild(div);
      flatIdx++;
    });

    // Add Port button (per controller)
    const addPortDiv = document.createElement("div");
    addPortDiv.className = "controller-actions";
    const addPBtn = document.createElement("button");
    addPBtn.className = "btn-small";
    addPBtn.textContent = "+ Add Port";
    addPBtn.disabled = ctrl.ports.length >= portsPerController;
    addPBtn.addEventListener("click", () => {
      addPort(ci);
      renderPorts();
      drawOverlay();
    });
    addPortDiv.appendChild(addPBtn);
    group.appendChild(addPortDiv);

    portsList.appendChild(group);
  });

  updateLinePreviews();
}

addPortBtn.addEventListener("click", () => {
  addController();
  renderPorts();
});

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
    const canvas = linePreviewCanvases.get(pi);
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
  const rect = videoWrap.getBoundingClientRect();
  const touch = e.touches?.[0] || e.changedTouches?.[0];
  const clientX = touch ? touch.clientX : e.clientX;
  const clientY = touch ? touch.clientY : e.clientY;
  return {
    x: Math.round((clientX - rect.left) * (mediaW / rect.width)),
    y: Math.round((clientY - rect.top) * (mediaH / rect.height)),
  };
}

function moveActivePoint(x, y) {
  if (!activeSelection) return;
  const port = ports[activeSelection.port];

  if ("control" in activeSelection && port.transformState) {
    // Transform mode: move control point
    const s = port.transformState;
    const key = activeSelection.control;

    // Effective pivot in world space
    const px = s.center.x + s.offset.x + s.pivot.x;
    const py = s.center.y + s.offset.y + s.pivot.y;

    if (key === "offset") {
      s.offset.x = x - s.center.x;
      s.offset.y = y - s.center.y;
    } else if (key === "pivot") {
      s.pivot.x = x - s.center.x - s.offset.x;
      s.pivot.y = y - s.center.y - s.offset.y;
    } else if (key === "rotate") {
      s.angle = Math.atan2(y - py, x - px);
    } else if (key === "scaleX") {
      s.scaleX = (x - px) / (s.baseRadius / 2);
    } else if (key === "scaleY") {
      s.scaleY = (y - py) / (s.baseRadius / 2);
    }

    // Update the live polyline for the port
    port.points = computeTransformedPoints(port.savedPoints, s);
  } else if ("point" in activeSelection) {
    // Points mode
    const pt = port.points[activeSelection.point];
    pt.x = Math.max(0, Math.min(mediaW - 1, x));
    pt.y = Math.max(0, Math.min(mediaH - 1, y));
  }
}

/** Find the closest draggable point/control to (mx, my) across all ports */
function findClosestPoint(mx, my) {
  let best = null;
  let bestDist = Infinity;

  ports.forEach((port, pi) => {
    if (port.editMode === "transform" && port.transformState) {
      for (const cp of getTransformControlPoints(port)) {
        const d = (cp.x - mx) ** 2 + (cp.y - my) ** 2;
        if (d < bestDist) { bestDist = d; best = { port: pi, control: cp.key }; }
      }
    } else {
      port.points.forEach((pt, pti) => {
        const d = (pt.x - mx) ** 2 + (pt.y - my) ** 2;
        if (d < bestDist) { bestDist = d; best = { port: pi, point: pti }; }
      });
    }
  });

  return best;
}

// Pointer state: unified click / double-click / drag detection
let pointerDown = false;
let pointerDownPos = null; // media coords at press
const DRAG_THRESHOLD = 5; // px in media coords before drag starts

function onPointerDown(e) {
  if (!mediaReady) return;
  pointerDown = true;
  pointerDownPos = getMediaCoords(e);
}

function onPointerMove(e) {
  if (!pointerDown) return;

  // Start drag only after moving past threshold
  if (!dragging && pointerDownPos && activeSelection) {
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
  pointerDown = false;
  pointerDownPos = null;
  if (!dragging) return;
  dragging = false;
  if (activeSelection) {
    const port = ports[activeSelection.port];
    if ("point" in activeSelection) {
      markPortDirty(port);
    }
  }
  renderPorts();
}

/** Double-click / double-tap: select closest point */
function onDblSelect(e) {
  if (!mediaReady) return;
  e.preventDefault();
  const { x, y } = getMediaCoords(e);
  const closest = findClosestPoint(x, y);
  if (closest) {
    activeSelection = closest;
    renderPorts();
    drawOverlay();
  }
}

/** Fast update of only the active row's input values during drag */
function updateActiveCoords() {
  if (!activeSelection) return;
  const port = ports[activeSelection.port];

  if ("control" in activeSelection && port.transformState) {
    const s = port.transformState;
    const inputMap = {
      "Offset": [Math.round(s.offset.x), Math.round(s.offset.y)],
      "Pivot":  [Math.round(s.pivot.x), Math.round(s.pivot.y)],
      "Rotate": [(s.angle * 180 / Math.PI).toFixed(1)],
      "ScaleX": [s.scaleX.toFixed(2)],
      "ScaleY": [s.scaleY.toFixed(2)],
    };
    const rows = portsList.querySelectorAll(".point-row");
    rows.forEach((row) => {
      const lbl = row.querySelector(".point-label");
      if (!lbl || !inputMap[lbl.textContent]) return;
      const inputs = row.querySelectorAll(".coord-input");
      const vals = inputMap[lbl.textContent];
      inputs.forEach((inp, i) => {
        if (i < vals.length && document.activeElement !== inp) inp.value = vals[i];
      });
    });
  } else if ("point" in activeSelection) {
    const pt = port.points[activeSelection.point];
    const activeRow = portsList.querySelector(".point-row.active");
    if (activeRow) {
      const inputs = activeRow.querySelectorAll(".coord-input");
      if (inputs[0] && document.activeElement !== inputs[0]) inputs[0].value = pt.x;
      if (inputs[1] && document.activeElement !== inputs[1]) inputs[1].value = pt.y;
    }
  }
}

// Mouse events
videoWrap.addEventListener("mousedown", onPointerDown);
window.addEventListener("mousemove", onPointerMove);
window.addEventListener("mouseup", onPointerUp);
videoWrap.addEventListener("dblclick", onDblSelect);

// Touch events
videoWrap.addEventListener("touchstart", (e) => {
  e.preventDefault();
  onPointerDown(e);
}, { passive: false });
window.addEventListener("touchmove", (e) => { onPointerMove(e); }, { passive: false });
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

  if (mediaType === "image" && loadedImage) {
    overlayCtx.drawImage(loadedImage, 0, 0);
  } else if (mediaType === "video" && frames.length > 0) {
    const bmp = await ensureFrameDecoded(currentFrameIdx);
    overlayCtx.drawImage(bmp, 0, 0);
  }

  drawOverlayPorts();
}

/** Draw port polylines and control points on the overlay (no background clear/draw) */
function drawOverlayPorts() {
  ports.forEach((port, pi) => {
    const color = PORT_COLORS[pi % PORT_COLORS.length];

    if (port.editMode === "transform" && port.savedPoints && port.transformState) {
      // Draw saved (original) polyline in faded color
      overlayCtx.globalAlpha = 0.3;
      overlayCtx.strokeStyle = color;
      overlayCtx.lineWidth = 2;
      overlayCtx.beginPath();
      overlayCtx.moveTo(port.savedPoints[0].x, port.savedPoints[0].y);
      for (let i = 1; i < port.savedPoints.length; i++) {
        overlayCtx.lineTo(port.savedPoints[i].x, port.savedPoints[i].y);
      }
      overlayCtx.stroke();
      overlayCtx.globalAlpha = 1;

      // Draw transformed polyline in full color
      const transformed = computeTransformedPoints(port.savedPoints, port.transformState);
      overlayCtx.strokeStyle = color;
      overlayCtx.lineWidth = 2;
      overlayCtx.beginPath();
      overlayCtx.moveTo(transformed[0].x, transformed[0].y);
      for (let i = 1; i < transformed.length; i++) {
        overlayCtx.lineTo(transformed[i].x, transformed[i].y);
      }
      overlayCtx.stroke();

      // Point labels on transformed polyline
      transformed.forEach((pt, pti) => {
        overlayCtx.fillStyle = color;
        overlayCtx.beginPath();
        overlayCtx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
        overlayCtx.fill();
        overlayCtx.fillStyle = "#fff";
        overlayCtx.font = "12px sans-serif";
        overlayCtx.fillText(String.fromCharCode(65 + pti), pt.x + 10, pt.y - 10);
      });

      // Draw transform control points
      const controls = getTransformControlPoints(port);
      for (const cp of controls) {
        const isActive = activeSelection &&
          activeSelection.port === pi &&
          "control" in activeSelection &&
          activeSelection.control === cp.key;

        if (cp.key === "offset") {
          // Offset: square handle (primary move)
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
          // Pivot: crosshair + diamond
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
          // Other handles: larger circles
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
          // Label
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
    } else {
      // Points mode: current behavior
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

        overlayCtx.fillStyle = isActive ? "#fff" : color;
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
    }
  });
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
// Sampling
// ------------------------------------------------------------------ //

function samplePolyline(ctx, points, numSamples) {
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
    const px = Math.max(0, Math.min(points[0].x, mediaW - 1));
    const py = Math.max(0, Math.min(points[0].y, mediaH - 1));
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

    const px = Math.max(0, Math.min(x, mediaW - 1));
    const py = Math.max(0, Math.min(y, mediaH - 1));

    const pixel = ctx.getImageData(px, py, 1, 1).data;
    out[i * 3] = pixel[0];
    out[i * 3 + 1] = pixel[1];
    out[i * 3 + 2] = pixel[2];
  }

  return out;
}

/** Sample a port's polyline, applying trimStart/trimEnd (trimmed LEDs are black). */
function samplePortLine(ctx, port) {
  const active = port.leds - port.trimStart - port.trimEnd;
  if (active <= 0) return new Uint8Array(port.leds * 3);
  const sampled = samplePolyline(ctx, port.points, active);
  const out = new Uint8Array(port.leds * 3); // all black
  out.set(sampled, port.trimStart * 3);
  return out;
}

// ------------------------------------------------------------------ //
// Processing
// ------------------------------------------------------------------ //

async function doExport() {
  if (!mediaReady) {
    setStatus("Load a video or image first.");
    return;
  }

  if (ports.length === 0) {
    setStatus("Add at least one port.");
    return;
  }

  const isImage = mediaType === "image";
  const fps = detectedFPS || 30;
  const totalFrames = isImage ? 1 : (outPoint - inPoint + 1);

  if (totalFrames <= 0) {
    setStatus("Could not determine frame count.");
    return;
  }

  exporting = true;
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
  exporting = false;
  renderOutputSection();
  // Hide progress bar after re-render
  const pBar2 = document.getElementById("progress-bar");
  if (pBar2) pBar2.style.display = "none";
}

// ------------------------------------------------------------------ //
// ZIP builder (STORE, no compression — zero dependencies)
// ------------------------------------------------------------------ //

function buildZip(files) {
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

function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------------ //
// Scene save / load (JS + PNGs in a zip)
// ------------------------------------------------------------------ //

/**
 * Serialize the current scene to a human-readable JS string.
 * @param {Map<Port, string>|null} previewFileMap - maps port → filename in the zip
 */
function serializeScene(previewFileMap) {
  const scene = {
    version: 1,
    portsPerController,
    maxResolution,
    frameOffset,
    frameLength,
    detectedFPS,
    mediaType,
    mediaW,
    mediaH,
    frameCount: frames.length,
    inPoint,
    outPoint,
    templateHeader: templateHeaderBuffer
      ? btoa(String.fromCharCode(...new Uint8Array(templateHeaderBuffer.slice(0, 512))))
      : null,
    templateFileName,
    controllers: controllers.map((ctrl) => ({
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
          const canvas = portPreviewCanvases.get(port);
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

/** Convert a canvas to a Uint8Array in the given format */
function canvasToBlob(canvas, type = "image/png", quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)));
    }, type, quality);
  });
}

/** Convert an ImageBitmap or HTMLImageElement to a JPEG Uint8Array */
function imageToJPEG(img, w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d").drawImage(img, 0, 0);
  return canvasToBlob(c, "image/jpeg", 0.50);
}

async function saveScene() {
  setStatus("Saving scene...");
  const zipFiles = [];
  const previewFileMap = new Map();

  // 1. Collect preview PNGs (pixel-exact, keep lossless)
  let ci = 0;
  for (const ctrl of controllers) {
    let pi = 0;
    for (const port of ctrl.ports) {
      const canvas = portPreviewCanvases.get(port);
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
  if (mediaType === "image" && loadedImage) {
    setStatus("Saving image...");
    const jpgBytes = await imageToJPEG(loadedImage, mediaW, mediaH);
    zipFiles.push({ name: "media.jpg", data: jpgBytes });
  } else if (mediaType === "video" && frames.length > 0) {
    for (let i = 0; i < frames.length; i++) {
      if (i % 10 === 0) {
        setStatus(`Saving frames (${i}/${frames.length})...`);
        await new Promise((r) => setTimeout(r, 0));
      }
      // Frames are already JPEG blobs — just grab the bytes directly
      const buf = await frames[i].arrayBuffer();
      zipFiles.push({ name: `frames/${String(i).padStart(5, "0")}.jpg`, data: new Uint8Array(buf) });
    }
  }

  // 3. Build scene.js (after previews so previewFileMap is complete)
  setStatus("Packing zip...");
  await new Promise((r) => setTimeout(r, 0));
  const sceneText = serializeScene(previewFileMap);
  zipFiles.unshift({ name: "scene.js", data: new TextEncoder().encode(sceneText) });

  // 4. Build and download zip
  const zip = buildZip(zipFiles);
  downloadBlob(zip, "scene.zip");
  setStatus("Scene saved.");
}

/**
 * Parse a STORE-method zip into { name, data } entries.
 * @param {ArrayBuffer} buffer
 * @returns {{ name: string, data: Uint8Array }[]}
 */
function parseZip(buffer) {
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

/**
 * Deserialize a scene JS string and restore all state.
 * @param {string} text - the scene.js content
 * @param {Map<string, Uint8Array>|null} fileMap - zip entries keyed by filename
 */
async function deserializeScene(text, fileMap) {
  const jsonMatch = text.match(/const\s+scene\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
  if (!jsonMatch) throw new Error("Invalid scene file format");

  const scene = JSON.parse(jsonMatch[1]);

  // Clear existing state
  for (const port of ports) {
    portDirty.delete(port);
    portPreviewCanvases.delete(port);
    portPreviewProcessing.delete(port);
  }
  clearDecodedFrame();
  frames = [];
  loadedImage = null;
  controllers = [];
  ports = [];
  activeSelection = null;
  currentFrameIdx = 0;

  // Restore settings
  if (scene.portsPerController != null) portsPerController = scene.portsPerController;
  if (scene.maxResolution != null) maxResolution = scene.maxResolution;
  if (scene.frameOffset != null) frameOffset = scene.frameOffset;
  if (scene.frameLength != null) frameLength = scene.frameLength;
  if (scene.detectedFPS != null) detectedFPS = scene.detectedFPS;
  if (scene.inPoint != null) inPoint = scene.inPoint;
  if (scene.outPoint != null) outPoint = scene.outPoint;

  // Restore template header
  if (scene.templateHeader) {
    const binary = atob(scene.templateHeader);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    templateHeaderBuffer = bytes.buffer;
    templateFileName = scene.templateFileName || "restored.dat";
  }

  // Restore media infrastructure
  const w = scene.mediaW || 0;
  const h = scene.mediaH || 0;
  if (w > 0 && h > 0) {
    mediaW = w;
    mediaH = h;
    mediaType = scene.mediaType || "";
    mediaReady = true;

    overlay.width = w;
    overlay.height = h;
    video.style.display = "none";
    overlay.classList.add("static");

    sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = w;
    sampleCanvas.height = h;
    sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });
  }

  // Restore media content from zip
  if (fileMap) {
    const mediaFile = fileMap.get("media.jpg") || fileMap.get("media.png");
    if (scene.mediaType === "image" && mediaFile) {
      setStatus("Loading image...");
      const blob = new Blob([mediaFile], { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      loadedImage = new Image();
      await new Promise((resolve) => { loadedImage.onload = resolve; loadedImage.src = url; });
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
        // Store as JPEG blobs directly — no need to decode to ImageBitmap
        frames.push(new Blob([data], { type: "image/jpeg" }));
      }
    }
  }

  // Clamp in/out points to frame range
  if (frames.length > 0) {
    inPoint = Math.max(0, Math.min(inPoint, frames.length - 1));
    outPoint = Math.max(inPoint, Math.min(outPoint, frames.length - 1));
  }

  // Restore controllers and ports
  const portDataList = [];
  for (const ctrl of scene.controllers) {
    const ci = controllers.length;
    controllers.push({ ports: [], collapsed: ctrl.collapsed ?? false });

    for (const portData of ctrl.ports) {
      const port = {
        leds: portData.leds ?? 400,
        trimStart: portData.trimStart ?? 0,
        trimEnd: portData.trimEnd ?? 0,
        points: (portData.points || []).map((p) => ({ x: p.x, y: p.y })),
        collapsed: portData.collapsed ?? false,
        previewCollapsed: portData.previewCollapsed ?? true,
        editMode: portData.editMode ?? "points",
        savedPoints: null,
        transformState: null,
      };
      controllers[ci].ports.push(port);
      portDirty.add(port);
      portDataList.push(portData);
    }
  }

  rebuildPortsList();

  // Restore preview canvases from PNGs
  if (fileMap) {
    for (let i = 0; i < ports.length; i++) {
      const pd = portDataList[i];
      if (!pd.previewFile || !fileMap.has(pd.previewFile)) continue;

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

      portPreviewCanvases.set(ports[i], canvas);
      portDirty.delete(ports[i]);
    }
  }

  renderPorts();
  drawOverlay();
  updateLinePreviews();
  renderOutputSection();
}

function loadScene() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".zip,.js";
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;

    try {
      if (file.name.endsWith(".js") || file.name.endsWith(".json") || file.name.endsWith(".txt")) {
        const text = await file.text();
        await deserializeScene(text, null);
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
        await deserializeScene(text, fileMap);
      }
      setStatus(`Scene loaded from ${file.name}`);
    } catch (e) {
      setStatus(`Failed to load scene: ${e.message}`);
    }
  });
  input.click();
}

// ------------------------------------------------------------------ //
// Helpers
// ------------------------------------------------------------------ //

function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}
