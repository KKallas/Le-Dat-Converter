import { DATFile } from "../js/datfile.js";

// ------------------------------------------------------------------ //
// DOM refs
// ------------------------------------------------------------------ //

const mediaInput = document.getElementById("media-input");
const video = document.getElementById("video");
const videoWrap = document.getElementById("video-wrap");
const overlay = document.getElementById("overlay");
const overlayCtx = overlay.getContext("2d");

const portsList = document.getElementById("ports-list");
const addPortBtn = document.getElementById("add-port-btn");

const processBtn = document.getElementById("process-btn");
const progressBar = document.getElementById("progress-bar");
const progressFill = document.getElementById("progress-fill");
const statusEl = document.getElementById("status");

const previewSection = document.getElementById("preview-section");
const previewContainer = document.getElementById("preview-container");

const downloadDat = document.getElementById("download-dat");
const downloadTxt = document.getElementById("download-txt");

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
 * @typedef {{ leds: number, points: Point[], collapsed: boolean }} Port
 */

/** @type {Port[]} */
let ports = [];

/** Currently selected point: { port, point } indices, or null */
let activeSelection = null;

let mediaReady = false;
let mediaType = ""; // "video" or "image"
let detectedFPS = 0;
/** @type {HTMLImageElement|null} */
let loadedImage = null;
/** @type {DATFile|null} */
let currentDat = null;

let mediaW = 0;
let mediaH = 0;

/** Offscreen canvas for live line sampling */
let sampleCanvas = null;
let sampleCtx = null;

// Drag state
let dragging = false;
let lastDragUpdate = 0;

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
    const pad = Math.round(w * 0.1);
    const cy = Math.round(h / 2);
    addPort(400, [
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
      const totalFrames = Math.floor(video.duration * detectedFPS);
      setStatus(
        `Video loaded: ${video.videoWidth}x${video.videoHeight}, ` +
        `${video.duration.toFixed(1)}s, ~${detectedFPS}fps (${totalFrames} frames)`
      );
    },
    { once: true }
  );
}

// ------------------------------------------------------------------ //
// Port / point data model
// ------------------------------------------------------------------ //

function addPort(leds = 400, points = null) {
  if (!points) {
    const cx = mediaReady ? Math.round(mediaW / 2) : 200;
    const cy = mediaReady ? Math.round(mediaH / 2) : 200;
    points = [
      { x: cx - 100, y: cy },
      { x: cx + 100, y: cy },
    ];
  }
  ports.push({ leds, points, collapsed: false });
  activeSelection = { port: ports.length - 1, point: 0 };
}

function removePort(portIdx) {
  ports.splice(portIdx, 1);
  if (activeSelection && activeSelection.port === portIdx) {
    activeSelection = null;
  } else if (activeSelection && activeSelection.port > portIdx) {
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
// Ports UI rendering
// ------------------------------------------------------------------ //

/** Per-port line preview canvases, keyed by port index */
const linePreviewCanvases = new Map();

function renderPorts() {
  portsList.innerHTML = "";
  linePreviewCanvases.clear();

  ports.forEach((port, pi) => {
    const color = PORT_COLORS[pi % PORT_COLORS.length];
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
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn-danger";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      removePort(pi);
      renderPorts();
      drawOverlay();
    });

    header.append(toggle, dot, label, ledsLabel, ledsInput, removeBtn);
    div.appendChild(header);

    // Line preview strip (always visible)
    const lineCanvas = document.createElement("canvas");
    lineCanvas.className = "line-preview";
    lineCanvas.height = 1;
    lineCanvas.width = port.leds;
    div.appendChild(lineCanvas);
    linePreviewCanvases.set(pi, lineCanvas);

    // Points list (collapsible)
    if (!isCollapsed) {
      const pointsDiv = document.createElement("div");
      pointsDiv.className = "points-list";

      port.points.forEach((pt, pti) => {
        const row = document.createElement("div");
        row.className = "point-row";
        if (activeSelection &&
            activeSelection.port === pi &&
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
            removePointFromPort(pi, pti);
            renderPorts();
            drawOverlay();
          });
          row.appendChild(rmPt);
        }

        row.addEventListener("click", () => {
          activeSelection = { port: pi, point: pti };
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
        addPointToPort(pi);
        renderPorts();
        drawOverlay();
      });
      actions.appendChild(addPtBtn);
      div.appendChild(actions);
    }

    portsList.appendChild(div);
  });

  updateLinePreviews();
}

addPortBtn.addEventListener("click", () => {
  addPort();
  renderPorts();
  drawOverlay();
});

// ------------------------------------------------------------------ //
// Live line preview sampling
// ------------------------------------------------------------------ //

function updateLinePreviews() {
  if (!mediaReady || !sampleCtx) return;

  // Draw current frame onto sample canvas
  if (mediaType === "image" && loadedImage) {
    sampleCtx.drawImage(loadedImage, 0, 0);
  } else if (mediaType === "video") {
    sampleCtx.drawImage(video, 0, 0);
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
    video.play();
  });
}

// ------------------------------------------------------------------ //
// Frame extraction
// ------------------------------------------------------------------ //

function seekTo(time) {
  return new Promise((resolve) => {
    video.currentTime = time;
    video.addEventListener("seeked", () => resolve(), { once: true });
  });
}

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

processBtn.addEventListener("click", async () => {
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
  const totalFrames = isImage ? 1 : Math.floor(video.duration * fps);

  if (totalFrames <= 0) {
    setStatus("Could not determine frame count.");
    return;
  }

  processBtn.disabled = true;
  progressBar.style.display = "block";
  setStatus(isImage
    ? `Processing 1 frame across ${ports.length} port(s)...`
    : `Processing ${totalFrames} frames across ${ports.length} port(s)...`
  );

  const captureCanvas = document.createElement("canvas");
  captureCanvas.width = mediaW;
  captureCanvas.height = mediaH;
  const captureCtx = captureCanvas.getContext("2d", { willReadFrequently: true });

  const dat = new DATFile();
  for (const port of ports) {
    dat.addUniverse(port.leds);
  }
  dat.setNumFrames(totalFrames);

  const previewCtxs = ports.map((port) => {
    const c = document.createElement("canvas");
    c.width = port.leds;
    c.height = totalFrames;
    return c.getContext("2d");
  });

  for (let f = 0; f < totalFrames; f++) {
    if (isImage) {
      captureCtx.drawImage(loadedImage, 0, 0);
    } else {
      await seekTo(f / fps);
      captureCtx.drawImage(video, 0, 0);
    }

    for (let pi = 0; pi < ports.length; pi++) {
      const port = ports[pi];
      const samples = samplePolyline(captureCtx, port.points, port.leds);

      const imgData = previewCtxs[pi].createImageData(port.leds, 1);
      for (let p = 0; p < port.leds; p++) {
        dat.setPixel(pi, f, p, samples[p * 3], samples[p * 3 + 1], samples[p * 3 + 2]);
        imgData.data[p * 4] = samples[p * 3];
        imgData.data[p * 4 + 1] = samples[p * 3 + 1];
        imgData.data[p * 4 + 2] = samples[p * 3 + 2];
        imgData.data[p * 4 + 3] = 255;
      }
      previewCtxs[pi].putImageData(imgData, 0, f);
    }

    const pct = ((f + 1) / totalFrames) * 100;
    progressFill.style.width = pct + "%";
    if (f % 10 === 0) {
      setStatus(`Frame ${f + 1} / ${totalFrames}`);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  currentDat = dat;
  progressFill.style.width = "100%";
  const totalLeds = ports.reduce((s, p) => s + p.leds, 0);
  setStatus(`Done. ${totalFrames} frame(s), ${ports.length} port(s), ${totalLeds} total LEDs.`);

  previewContainer.innerHTML = "";
  for (let pi = 0; pi < ports.length; pi++) {
    const color = PORT_COLORS[pi % PORT_COLORS.length];

    const label = document.createElement("div");
    label.className = "preview-label";
    label.innerHTML =
      `<span class="color-dot" style="background:${color}"></span> ` +
      `Port ${pi} &mdash; ${ports[pi].leds} LEDs`;
    previewContainer.appendChild(label);

    const canvas = previewCtxs[pi].canvas;
    canvas.className = "preview-canvas";
    previewContainer.appendChild(canvas);
  }

  previewSection.style.display = "block";
  downloadDat.disabled = false;
  downloadTxt.disabled = false;
  processBtn.disabled = false;
});

// ------------------------------------------------------------------ //
// Downloads
// ------------------------------------------------------------------ //

downloadDat.addEventListener("click", () => {
  if (currentDat) currentDat.download("output.dat");
});

downloadTxt.addEventListener("click", () => {
  if (currentDat) currentDat.downloadTxt("output.txt");
});

// ------------------------------------------------------------------ //
// Helpers
// ------------------------------------------------------------------ //

function setStatus(msg) {
  statusEl.textContent = msg;
}
