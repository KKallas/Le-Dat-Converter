// ------------------------------------------------------------------ //
// Player — frame decode cache + playback state machine
// ------------------------------------------------------------------ //

/**
 * Shared state interface — the host wires getters/setters
 * that map to whatever state management is in use.
 * @type {{ frames: Blob[], currentFrame: number, isPlaying: boolean,
 *          fps: number, inPoint: number, outPoint: number, looping: boolean }}
 */
let S = null;

let playbackTimerId = null;

// Decoded frame cache — single ImageBitmap
let decodedFrame = null; // { idx: number, bmp: ImageBitmap }

// Callbacks wired during init
let _drawOverlay = null;       // async () => void
let _drawFast = null;          // (bmp) => void — draw decoded frame + port overlays (sync)
let _onFrameChanged = null;    // () => void — update previews, seek bar
let _onPlayStateChanged = null; // () => void — update buttons, output section

// ---- Frame decode cache ----

export async function ensureFrameDecoded(idx) {
  if (decodedFrame && decodedFrame.idx === idx) return decodedFrame.bmp;
  if (decodedFrame) { decodedFrame.bmp.close(); decodedFrame = null; }
  const bmp = await createImageBitmap(S.frames[idx]);
  decodedFrame = { idx, bmp };
  return bmp;
}

export function getDecodedFrame() {
  return decodedFrame ? decodedFrame.bmp : null;
}

export function clearDecodedFrame() {
  if (decodedFrame) { decodedFrame.bmp.close(); decodedFrame = null; }
}

// ---- Init ----

/**
 * @param {object} sharedState — getter/setter object mapping to app state
 * @param {object} callbacks
 */
export function init(sharedState, { drawOverlay, drawFast, onFrameChanged, onPlayStateChanged }) {
  S = sharedState;
  _drawOverlay = drawOverlay;
  _drawFast = drawFast;
  _onFrameChanged = onFrameChanged;
  _onPlayStateChanged = onPlayStateChanged;
}

// ---- Playback controls ----

export async function play() {
  if (S.frames.length === 0 || S.isPlaying) return;
  if (S.currentFrame < S.inPoint || S.currentFrame >= S.outPoint) {
    S.currentFrame = S.inPoint;
    if (_drawOverlay) await _drawOverlay();
  }
  S.isPlaying = true;
  if (_onPlayStateChanged) _onPlayStateChanged();

  const interval = 1000 / S.fps;
  let lastTime = performance.now();
  let decoding = false;

  function step(now) {
    if (!S.isPlaying) return;
    if (decoding) { playbackTimerId = requestAnimationFrame(step); return; }
    if (now - lastTime >= interval) {
      lastTime += interval;
      S.currentFrame++;
      if (S.currentFrame > S.outPoint) {
        if (S.looping) {
          S.currentFrame = S.inPoint;
        } else {
          S.currentFrame = S.outPoint;
          pause();
          return;
        }
      }
      decoding = true;
      ensureFrameDecoded(S.currentFrame).then((bmp) => {
        decoding = false;
        if (!S.isPlaying) return;
        if (_drawFast) _drawFast(bmp);
        updatePlaybackUI();
      });
    }
    playbackTimerId = requestAnimationFrame(step);
  }
  playbackTimerId = requestAnimationFrame(step);
}

export function pause() {
  if (!S.isPlaying && !playbackTimerId) return;
  S.isPlaying = false;
  if (playbackTimerId) {
    cancelAnimationFrame(playbackTimerId);
    playbackTimerId = null;
  }
  if (_onPlayStateChanged) _onPlayStateChanged();
  if (_onFrameChanged) _onFrameChanged();
}

export async function stop() {
  S.isPlaying = false;
  if (playbackTimerId) {
    cancelAnimationFrame(playbackTimerId);
    playbackTimerId = null;
  }
  S.currentFrame = 0;
  if (_drawOverlay) await _drawOverlay();
  updatePlaybackUI();
  if (_onFrameChanged) _onFrameChanged();
  if (_onPlayStateChanged) _onPlayStateChanged();
}

export async function seek(frameIdx) {
  if (S.frames.length === 0) return;
  if (S.isPlaying) pause();
  S.currentFrame = Math.max(0, Math.min(S.frames.length - 1, frameIdx));
  if (_drawOverlay) await _drawOverlay();
  updatePlaybackUI();
  if (_onFrameChanged) _onFrameChanged();
}

export function stepForward() {
  if (S.currentFrame < S.frames.length - 1) seek(S.currentFrame + 1);
}

export function stepBack() {
  if (S.currentFrame > 0) seek(S.currentFrame - 1);
}

/** Update seek bar and frame label. */
export function updatePlaybackUI() {
  const seekBar = document.getElementById("seek-bar");
  const frameLabel = document.getElementById("frame-label");
  if (!seekBar || !frameLabel) return;
  if (document.activeElement !== seekBar) {
    seekBar.value = String(S.currentFrame);
  }
  const t = S.currentFrame / S.fps;
  frameLabel.textContent = `${S.currentFrame} / ${S.frames.length}  (${t.toFixed(2)}s)`;
}
