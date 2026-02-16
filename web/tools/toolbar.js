// ------------------------------------------------------------------ //
// Toolbar — generic scene tool host (below viewport)
// ------------------------------------------------------------------ //
// Imports scene tools from the registry. Shows a dropdown to pick
// the tool plus a Launch button. Delegates active controls to the tool.
// ------------------------------------------------------------------ //

import sceneTools from "./scene/registry.js";

let _container = null;
let _panel = null;
let _bar = null;

/** Shared state — needed to read selectedPoints count */
let _S = null;

/** @type {Map<string, object>} name → tool */
const _tools = new Map();

/** Currently selected scene tool (from dropdown) */
let _selectedTool = null;

// ---- Public API ----

/**
 * Initialize the toolbar UI.
 * @param {HTMLElement} container - mount point (#toolbar)
 * @param {object} sharedState - state accessors
 * @param {object} actions - action callbacks
 */
export function init(container, sharedState, actions) {
  _container = container;
  _S = sharedState;

  // Register all scene tools
  for (const tool of sceneTools) {
    _tools.set(tool.name, tool);
    if (tool.init) tool.init(sharedState, actions);
  }

  // Default to first tool
  _selectedTool = sceneTools[0] || null;

  // Build bar
  _bar = document.createElement("div");
  _bar.className = "toolbar-bar";

  const label = document.createElement("label");
  label.className = "toolbar-label";
  label.textContent = "Scene";
  _bar.appendChild(label);

  const select = document.createElement("select");
  select.className = "edit-mode-select";
  for (const tool of sceneTools) {
    const opt = document.createElement("option");
    opt.value = tool.name;
    opt.textContent = tool.label;
    if (tool === _selectedTool) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener("change", () => {
    _selectedTool = _tools.get(select.value) || sceneTools[0];
    renderPanel();
  });
  _bar.appendChild(select);

  _container.appendChild(_bar);

  _panel = document.createElement("div");
  _panel.className = "toolbar-panel";
  _container.appendChild(_panel);

  renderPanel();
}

/** Re-render the toolbar panel (host chrome + tool panel when active). */
export function renderPanel() {
  if (!_panel || !_selectedTool) return;
  _panel.innerHTML = "";

  const count = _S.selectedPoints.size;
  const toolActive = _selectedTool.isActive?.() || false;

  if (toolActive) {
    // Tool is active — render its controls
    _selectedTool.renderPanel(_panel);
    return;
  }

  // Tool not active — show selection status + launch button
  if (count === 0) {
    const hint = document.createElement("div");
    hint.className = "toolbar-hint";
    hint.textContent = "Select points to use scene tools (Shift+click for multi-select)";
    _panel.appendChild(hint);
    return;
  }

  const info = document.createElement("div");
  info.style.cssText = "font-size:0.8rem;color:#888;margin-bottom:6px";
  info.textContent = `${count} point${count !== 1 ? "s" : ""} selected`;
  _panel.appendChild(info);

  const launchBtn = document.createElement("button");
  launchBtn.className = "btn-primary";
  launchBtn.style.cssText = "width:100%;margin-bottom:4px";
  launchBtn.textContent = "Launch";
  launchBtn.addEventListener("click", () => {
    if (_selectedTool.begin) _selectedTool.begin();
    renderPanel();
  });
  _panel.appendChild(launchBtn);
}

/** Notify selected tool that selection changed. */
export function onSelectionChanged() {
  if (_selectedTool?.onSelectionChanged) {
    _selectedTool.onSelectionChanged();
  }
  renderPanel();
}

// ---- Viewport integration proxies ----

/** Is the selected tool in a modal operation? */
export function isToolActive() {
  return _selectedTool?.isActive?.() || false;
}

/** Get control handle positions for overlay drawing. */
export function getControlPoints() {
  return _selectedTool?.getControlPoints?.() || null;
}

/** Get which control handle is active for dragging. */
export function getActiveControl() {
  return _selectedTool?.getActiveControl?.() || null;
}

/** Move a control handle during viewport drag. */
export function moveControl(x, y) {
  if (_selectedTool?.moveControl) _selectedTool.moveControl(x, y);
}

/** Get saved (original) positions for ghost overlay drawing. */
export function getSavedPositions() {
  return _selectedTool?.getSavedPositions?.() || null;
}

/** Get tool-specific state (e.g. transform state for coord updates). */
export function getToolState() {
  return _selectedTool?.getTransformState?.() || null;
}
