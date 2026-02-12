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

// ------------------------------------------------------------------ //
// State
// ------------------------------------------------------------------ //

/**
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{ leds: number, points: Point[] }} Port
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

/** Width/height of the loaded media in pixels. */
let mediaW = 0;
let mediaH = 0;

// ------------------------------------------------------------------ //
// Media loading (video or image)
// ------------------------------------------------------------------ //

mediaInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  const isImage = file.type.startsWith("image/");

  if (isImage) {
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
  ports.push({ leds, points });
  // Auto-select first point of new port
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
  // Offset new point slightly from the last one
  pts.push({ x: last.x + 30, y: last.y });
  activeSelection = { port: portIdx, point: pts.length - 1 };
}

function removePointFromPort(portIdx, pointIdx) {
  if (ports[portIdx].points.length <= 2) return; // minimum 2
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

function renderPorts() {
  portsList.innerHTML = "";

  ports.forEach((port, pi) => {
    const color = PORT_COLORS[pi % PORT_COLORS.length];

    const div = document.createElement("div");
    div.className = "port";

    // Header
    const header = document.createElement("div");
    header.className = "port-header";

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
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn-danger";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      removePort(pi);
      renderPorts();
      drawOverlay();
    });

    header.append(dot, label, ledsLabel, ledsInput, removeBtn);
    div.appendChild(header);

    // Points list
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
      ptLabel.textContent = String.fromCharCode(65 + pti); // A, B, C...

      const coords = document.createElement("span");
      coords.className = "coords";
      coords.textContent = `(${pt.x}, ${pt.y})`;

      row.append(ptLabel, coords);

      // Remove point button (only if > 2 points)
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

      // Click to select this point
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

    portsList.appendChild(div);
  });
}

addPortBtn.addEventListener("click", () => {
  addPort();
  renderPorts();
  drawOverlay();
});

// ------------------------------------------------------------------ //
// Video click → place active point
// ------------------------------------------------------------------ //

videoWrap.addEventListener("click", (e) => {
  if (!mediaReady || !activeSelection) return;

  const rect = videoWrap.getBoundingClientRect();
  const scaleX = mediaW / rect.width;
  const scaleY = mediaH / rect.height;

  const x = Math.round((e.clientX - rect.left) * scaleX);
  const y = Math.round((e.clientY - rect.top) * scaleY);

  const pt = ports[activeSelection.port].points[activeSelection.point];
  pt.x = Math.max(0, Math.min(mediaW - 1, x));
  pt.y = Math.max(0, Math.min(mediaH - 1, y));

  renderPorts();
  drawOverlay();
});

// ------------------------------------------------------------------ //
// Overlay drawing
// ------------------------------------------------------------------ //

function drawOverlay() {
  if (!mediaReady) return;
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

  // For images, draw the image as the background
  if (mediaType === "image" && loadedImage) {
    overlayCtx.drawImage(loadedImage, 0, 0);
  }

  ports.forEach((port, pi) => {
    const color = PORT_COLORS[pi % PORT_COLORS.length];
    const pts = port.points;

    // Draw polyline
    overlayCtx.strokeStyle = color;
    overlayCtx.lineWidth = 2;
    overlayCtx.beginPath();
    overlayCtx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      overlayCtx.lineTo(pts[i].x, pts[i].y);
    }
    overlayCtx.stroke();

    // Draw points
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

      // Label
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

/**
 * Sample pixels along a polyline defined by points.
 * LEDs are distributed evenly along the total path length.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Point[]} points
 * @param {number} numSamples
 * @returns {Uint8Array} flat RGB array
 */
function samplePolyline(ctx, points, numSamples) {
  const out = new Uint8Array(numSamples * 3);

  // Calculate cumulative segment lengths
  const segLengths = [];
  let totalLength = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const len = Math.sqrt(dx * dx + dy * dy);
    segLengths.push(len);
    totalLength += len;
  }

  if (totalLength === 0) {
    // All points same position — sample the single point
    const pixel = ctx.getImageData(points[0].x, points[0].y, 1, 1).data;
    for (let i = 0; i < numSamples; i++) {
      out[i * 3] = pixel[0];
      out[i * 3 + 1] = pixel[1];
      out[i * 3 + 2] = pixel[2];
    }
    return out;
  }

  for (let i = 0; i < numSamples; i++) {
    const dist = numSamples === 1 ? 0 : (i / (numSamples - 1)) * totalLength;

    // Find which segment this distance falls on
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

    const px = Math.max(0, Math.min(x, overlay.width - 1));
    const py = Math.max(0, Math.min(y, overlay.height - 1));

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

  // Offscreen canvas for pixel sampling
  const captureCanvas = document.createElement("canvas");
  captureCanvas.width = mediaW;
  captureCanvas.height = mediaH;
  const captureCtx = captureCanvas.getContext("2d");

  // Build DAT file — one universe per port
  const dat = new DATFile();
  for (const port of ports) {
    dat.addUniverse(port.leds);
  }
  dat.setNumFrames(totalFrames);

  // Per-port preview canvases
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

    // Progress
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

  // Build preview section with labels + canvases
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
