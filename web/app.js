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

const DRAG_INTERVAL = 40; // ~25fps throttle for drag updates

// ------------------------------------------------------------------ //
// State
// ------------------------------------------------------------------ //

/**
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{ leds: number, points: Point[], collapsed: boolean, previewCollapsed: boolean }} Port
 * @typedef {{ ports: Port[], collapsed: boolean }} Controller
 */

/** @type {Controller[]} */
let controllers = [];

/** Flat derived list of all ports (rebuilt via rebuildPortsList) */
let ports = [];

/** Max ports per controller (output setting) */
let portsPerController = 8;

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

/** @type {ImageBitmap[]} All decoded video frames */
let frames = [];
let currentFrameIdx = 0;
let playbackTimerId = null;

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

function doPlay() {
  if (frames.length === 0) return;
  if (isPlaying) return;
  // Jump to inPoint if current position is outside the in/out range
  if (currentFrameIdx < inPoint || currentFrameIdx >= outPoint) {
    currentFrameIdx = inPoint;
    drawOverlay();
  }
  isPlaying = true;
  renderOutputSection();
  const fps = detectedFPS || 30;
  const interval = 1000 / fps;
  let lastTime = performance.now();

  function step(now) {
    if (!isPlaying) return;
    if (now - lastTime >= interval) {
      lastTime += interval;
      currentFrameIdx++;
      if (currentFrameIdx > outPoint) {
        currentFrameIdx = outPoint;
        doPause();
        return;
      }
      drawOverlay();
      updatePlaybackUI();
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

function doStop() {
  isPlaying = false;
  if (playbackTimerId) {
    cancelAnimationFrame(playbackTimerId);
    playbackTimerId = null;
  }
  currentFrameIdx = 0;
  drawOverlay();
  updatePlaybackUI();
  updateLinePreviews();
  renderOutputSection();
}

function doSeek(frameIdx) {
  if (frames.length === 0) return;
  if (isPlaying) doPause();
  currentFrameIdx = Math.max(0, Math.min(frames.length - 1, frameIdx));
  drawOverlay();
  updatePlaybackUI();
  updateLinePreviews();
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
    loadedImage = img;
    detectedFPS = 0;

    video.style.display = "none";
    overlay.classList.add("static");

    initAfterLoad(img.naturalWidth, img.naturalHeight);
    setStatus(`Image loaded: ${img.naturalWidth}x${img.naturalHeight} (1 frame)`);
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
      initAfterLoad(video.videoWidth, video.videoHeight);

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
  for (const bmp of frames) bmp.close();
  frames = [];
  currentFrameIdx = 0;

  const fps = detectedFPS || 30;
  const expectedFrames = Math.floor(video.duration * fps);

  setStatus(`Extracting frames (0/${expectedFrames})...`);
  const pBar = document.getElementById("progress-bar");
  const pFill = document.getElementById("progress-fill");
  if (pBar) pBar.style.display = "block";

  video.currentTime = 0;

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
      createImageBitmap(video).then((bmp) => {
        if (resolved) { bmp.close(); return; }
        frames.push(bmp);
        setStatus(`Extracting frames (${frames.length}/${expectedFrames})...`);
        if (pFill) pFill.style.width = (frames.length / expectedFrames * 100) + "%";

        if (video.ended) {
          done();
        } else {
          video.requestVideoFrameCallback(onFrame);
        }
      }).catch(() => done());
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
  const port = { leds, points, collapsed: false, previewCollapsed: true };
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

  header.append(toggle, label, exportBtn);
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
        inCtx.drawImage(frames[inPoint], 0, 0, thumbW, thumbH);
      }
      if (frames[outPoint]) {
        outCtx.drawImage(frames[outPoint], 0, 0, thumbW, thumbH);
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

      // Points list (collapsible)
      if (!isCollapsed) {
        const pointsDiv = document.createElement("div");
        pointsDiv.className = "points-list";

        port.points.forEach((pt, pti) => {
          const row = document.createElement("div");
          row.className = "point-row";
          if (activeSelection &&
              activeSelection.port === globalIdx &&
              activeSelection.point === pti) {
            row.classList.add("active");
          }

          const ptLabel = document.createElement("span");
          ptLabel.className = "point-label";
          ptLabel.textContent = String.fromCharCode(65 + pti);

          const coords = document.createElement("span");
          coords.className = "coords";
          coords.textContent = `(${pt.x}, ${pt.y})`;

          row.append(ptLabel, coords);

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

function updateLinePreviews() {
  if (!mediaReady || !sampleCtx) return;

  // Draw current frame onto sample canvas
  if (mediaType === "image" && loadedImage) {
    sampleCtx.drawImage(loadedImage, 0, 0);
  } else if (mediaType === "video" && frames.length > 0) {
    sampleCtx.drawImage(frames[currentFrameIdx], 0, 0);
  }

  ports.forEach((port, pi) => {
    const canvas = linePreviewCanvases.get(pi);
    if (!canvas) return;

    // Resize if LED count changed
    if (canvas.width !== port.leds) {
      canvas.width = port.leds;
    }

    const ctx = canvas.getContext("2d");
    const samples = samplePolyline(sampleCtx, port.points, port.leds);
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
        captureCtx.drawImage(frames[rangeStart + f], 0, 0);
      }

      const samples = samplePolyline(captureCtx, port.points, port.leds);
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
        captureCtx.drawImage(frames[rangeStart + f], 0, 0);
      }

      for (const { port, prevCtx } of portData) {
        const samples = samplePolyline(captureCtx, port.points, port.leds);
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
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: Math.round((clientX - rect.left) * (mediaW / rect.width)),
    y: Math.round((clientY - rect.top) * (mediaH / rect.height)),
  };
}

function moveActivePoint(x, y) {
  if (!activeSelection) return;
  const pt = ports[activeSelection.port].points[activeSelection.point];
  pt.x = Math.max(0, Math.min(mediaW - 1, x));
  pt.y = Math.max(0, Math.min(mediaH - 1, y));
}

function onDragStart(e) {
  if (!mediaReady || !activeSelection) return;
  dragging = true;
  const { x, y } = getMediaCoords(e);
  moveActivePoint(x, y);
  renderPorts();
  drawOverlay();
  updateLinePreviews();
  lastDragUpdate = performance.now();
}

function onDragMove(e) {
  if (!dragging) return;
  e.preventDefault();

  const now = performance.now();
  if (now - lastDragUpdate < DRAG_INTERVAL) return;
  lastDragUpdate = now;

  const { x, y } = getMediaCoords(e);
  moveActivePoint(x, y);
  drawOverlay();
  updateLinePreviews();
  // Update just the active point's coords display without full re-render
  updateActiveCoords();
}

function onDragEnd() {
  if (!dragging) return;
  dragging = false;
  if (activeSelection) {
    markPortDirty(ports[activeSelection.port]);
  }
  renderPorts(); // full re-render to sync everything
}

/** Fast update of only the active point's coordinate text */
function updateActiveCoords() {
  if (!activeSelection) return;
  const pt = ports[activeSelection.port].points[activeSelection.point];
  const activeRow = portsList.querySelector(".point-row.active .coords");
  if (activeRow) {
    activeRow.textContent = `(${pt.x}, ${pt.y})`;
  }
}

// Mouse events
videoWrap.addEventListener("mousedown", onDragStart);
window.addEventListener("mousemove", onDragMove);
window.addEventListener("mouseup", onDragEnd);

// Touch events
videoWrap.addEventListener("touchstart", (e) => {
  e.preventDefault();
  onDragStart(e);
}, { passive: false });
window.addEventListener("touchmove", (e) => { onDragMove(e); }, { passive: false });
window.addEventListener("touchend", onDragEnd);

// ------------------------------------------------------------------ //
// Overlay drawing
// ------------------------------------------------------------------ //

function drawOverlay() {
  if (!mediaReady) return;
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

  if (mediaType === "image" && loadedImage) {
    overlayCtx.drawImage(loadedImage, 0, 0);
  } else if (mediaType === "video" && frames.length > 0) {
    overlayCtx.drawImage(frames[currentFrameIdx], 0, 0);
  }

  ports.forEach((port, pi) => {
    const color = PORT_COLORS[pi % PORT_COLORS.length];
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
// Helpers
// ------------------------------------------------------------------ //

function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}
