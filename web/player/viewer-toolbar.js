// ------------------------------------------------------------------ //
// Viewer Toolbar — viewport mode selector (pan/zoom/points)
// ------------------------------------------------------------------ //
// Floats inside the video-wrap. Triple-click toggles visibility.
// Modes: "points" (default), "pan", "zoom".
// Home / Selected are instant-action buttons, not persistent modes.
// ------------------------------------------------------------------ //

let _wrap = null;
let _el = null;
let _mode = "points";
let _visible = false;

/** @type {{ onHome: Function, onSelected: Function } | null} */
let _actions = null;

export function init(videoWrap, actions) {
  _wrap = videoWrap;
  _actions = actions;
  _build();
}

export function getMode() { return _mode; }
export function isVisible() { return _visible; }

export function toggle() {
  _visible = !_visible;
  if (!_visible) {
    _mode = "points";
    _updateCursor();
    // Reset dropdown to match
    const sel = _el?.querySelector("select");
    if (sel) sel.value = "points";
  }
  if (_el) _el.classList.toggle("hidden", !_visible);
}

function _build() {
  _el = document.createElement("div");
  _el.className = "viewer-toolbar hidden";

  const select = document.createElement("select");
  select.className = "edit-mode-select";
  for (const [val, label] of [["points", "Points"], ["pan", "Pan"], ["zoom", "Zoom"]]) {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = label;
    if (val === _mode) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener("change", () => {
    _mode = select.value;
    _updateCursor();
  });

  const homeBtn = document.createElement("button");
  homeBtn.className = "btn-small";
  homeBtn.textContent = "Home";
  homeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (_actions?.onHome) _actions.onHome();
  });

  const selBtn = document.createElement("button");
  selBtn.className = "btn-small";
  selBtn.textContent = "Selected";
  selBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (_actions?.onSelected) _actions.onSelected();
  });

  // Prevent toolbar clicks from bubbling to videoWrap (would trigger
  // triple-click detection and pointer handlers in app.js)
  _el.addEventListener("mousedown", (e) => e.stopPropagation());
  _el.addEventListener("touchstart", (e) => e.stopPropagation());
  _el.addEventListener("dblclick", (e) => e.stopPropagation());

  _el.append(select, homeBtn, selBtn);
  _wrap.appendChild(_el);
}

function _updateCursor() {
  if (_mode === "pan") _wrap.style.cursor = "grab";
  else if (_mode === "zoom") _wrap.style.cursor = "ns-resize";
  else _wrap.style.cursor = "crosshair";
}
