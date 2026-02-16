// ------------------------------------------------------------------ //
// Rack — controller/port sidebar UI
// ------------------------------------------------------------------ //

import controllerTools from "../tools/controller/registry.js";

const TOOLS = Object.fromEntries(controllerTools.map(t => [t.name, t]));

const PORT_COLORS = [
  "#e94560", "#00ff88", "#00aaff", "#ffaa00",
  "#ff66cc", "#88ff00", "#aa66ff", "#ff4400",
];

/**
 * Shared state interface — the host wires getters/setters.
 * @type {{ controllers, ports, activeSelection, selectedPoints,
 *          isPointSelected, portDirty, portPreviewCanvases,
 *          portPreviewProcessing, mediaW, mediaH, mediaReady, portsPerController }}
 */
let S = null;

/**
 * Actions — callbacks into the host for mutations and side effects.
 * @type {{ addController, removeController, addPort, removePort,
 *          addPointToPort, removePointFromPort,
 *          selectPoint, togglePoint, selectAllInPort, selectAllInController,
 *          processPortPreview, markPortDirty,
 *          drawOverlay, updateLinePreviews }}
 */
let A = null;

let _container = null;        // #ports-list
let _addControllerBtn = null; // #add-port-btn

/** Per-port line preview canvases, keyed by flat port index */
const linePreviewCanvases = new Map();

// ---- Init ----

export function init(container, addControllerBtn, sharedState, actions) {
  _container = container;
  _addControllerBtn = addControllerBtn;
  S = sharedState;
  A = actions;

  _addControllerBtn.addEventListener("click", () => {
    A.addController();
    render();
  });
}

/** Expose line preview canvases so the host can update them. */
export function getLinePreviewCanvases() {
  return linePreviewCanvases;
}

/** Export PORT_COLORS so the host can use them for overlay drawing. */
export { PORT_COLORS };

// ---- Render ----

export function render() {
  _container.innerHTML = "";
  linePreviewCanvases.clear();

  let flatIdx = 0;

  S.controllers.forEach((ctrl, ci) => {
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
      render();
    });

    const ctrlLabel = document.createElement("span");
    ctrlLabel.className = "port-label";
    ctrlLabel.textContent = `Controller ${ci}`;

    const ctrlPortCount = document.createElement("span");
    ctrlPortCount.style.cssText = "font-size:0.75rem;color:#888";
    ctrlPortCount.textContent = `(${ctrl.ports.length} port${ctrl.ports.length !== 1 ? "s" : ""})`;

    const ctrlSelectAll = document.createElement("button");
    ctrlSelectAll.className = "btn-small";
    ctrlSelectAll.textContent = "Select All";
    ctrlSelectAll.addEventListener("click", () => {
      A.selectAllInController(ci);
      render();
      A.drawOverlay();
    });

    const ctrlRemoveBtn = document.createElement("button");
    ctrlRemoveBtn.className = "btn-danger";
    ctrlRemoveBtn.textContent = "Remove";
    ctrlRemoveBtn.addEventListener("click", () => {
      A.removeController(ci);
      render();
      A.drawOverlay();
    });

    ctrlHeader.append(ctrlToggle, ctrlLabel, ctrlPortCount, ctrlSelectAll, ctrlRemoveBtn);
    group.appendChild(ctrlHeader);

    if (ctrl.collapsed) {
      flatIdx += ctrl.ports.length;
      _container.appendChild(group);
      return;
    }

    // Ports within this controller
    ctrl.ports.forEach((port, pi) => {
      const globalIdx = flatIdx;
      const color = PORT_COLORS[globalIdx % PORT_COLORS.length];
      const isCollapsed = port.collapsed;

      // Check if any point in this port is selected
      const hasSelectedPoint = port.points.some((_, pti) => S.isPointSelected(globalIdx, pti));

      const div = document.createElement("div");
      div.className = "port" + (hasSelectedPoint ? " port-selected" : "");

      // Header row
      const header = document.createElement("div");
      header.className = "port-header";

      const toggle = document.createElement("button");
      toggle.className = "btn-toggle";
      toggle.textContent = isCollapsed ? "\u25b6" : "\u25bc";
      toggle.addEventListener("click", () => {
        port.collapsed = !port.collapsed;
        render();
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
        A.updateLinePreviews();
        A.markPortDirty(port);
      });

      const selectAllBtn = document.createElement("button");
      selectAllBtn.className = "btn-small";
      selectAllBtn.textContent = "Select All";
      selectAllBtn.addEventListener("click", () => {
        A.selectAllInPort(globalIdx);
        render();
        A.drawOverlay();
      });

      const removeBtn = document.createElement("button");
      removeBtn.className = "btn-danger";
      removeBtn.textContent = "\u00d7";
      removeBtn.addEventListener("click", () => {
        A.removePort(ci, pi);
        render();
        A.drawOverlay();
      });

      const isDirty = S.portDirty.has(port);
      const isProcessing = S.portPreviewProcessing.has(port);
      const progress = S.portPreviewProcessing.get(port);

      const renderBtn = document.createElement("button");
      renderBtn.className = "btn-small";
      renderBtn.textContent = isProcessing ? `Rendering ${progress.frame}/${progress.total}` : "Render";
      renderBtn.disabled = !isDirty || isProcessing;
      renderBtn.addEventListener("click", () => {
        renderBtn.textContent = "Rendering\u2026";
        renderBtn.disabled = true;
        A.processPortPreview(port);
      });

      header.append(toggle, dot, label, ledsLabel, ledsInput, selectAllBtn, renderBtn, removeBtn);
      div.appendChild(header);

      // Line preview strip (always visible)
      const lineCanvas = document.createElement("canvas");
      lineCanvas.className = "line-preview";
      lineCanvas.height = 1;
      lineCanvas.width = port.leds;
      div.appendChild(lineCanvas);
      linePreviewCanvases.set(globalIdx, lineCanvas);

      // Per-port bitmap preview (foldable)
      const hasPreview = S.portPreviewCanvases.has(port);
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
          render();
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
          const canvas = S.portPreviewCanvases.get(port);
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

      // Collapsible body: trim + points/save-load
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
          A.updateLinePreviews();
          A.markPortDirty(port);
          render();
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
          A.updateLinePreviews();
          A.markPortDirty(port);
          render();
        });

        trimRow.append(tsLabel, tsInput, teLabel, teInput);
        div.appendChild(trimRow);

        // Dropdown: Points / Save-Load
        const modeRow = document.createElement("div");
        modeRow.className = "point-actions";
        const modeSelect = document.createElement("select");
        modeSelect.className = "edit-mode-select";
        for (const t of controllerTools) {
          const opt = document.createElement("option");
          opt.value = t.name;
          opt.textContent = t.label;
          if (port.editMode === t.name) opt.selected = true;
          modeSelect.appendChild(opt);
        }
        modeSelect.addEventListener("change", () => {
          port.editMode = modeSelect.value;
          render();
        });
        modeRow.appendChild(modeSelect);
        div.appendChild(modeRow);

        // Render tool panel
        const tool = TOOLS[port.editMode] || controllerTools[0];
        if (tool && tool.renderPanel) {
          tool.renderPanel(div, port, globalIdx, _buildToolAPI(port, globalIdx));
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
    addPBtn.disabled = ctrl.ports.length >= S.portsPerController;
    addPBtn.addEventListener("click", () => {
      A.addPort(ci);
      render();
      A.drawOverlay();
    });
    addPortDiv.appendChild(addPBtn);
    group.appendChild(addPortDiv);

    _container.appendChild(group);
  });

  A.updateLinePreviews();
}

// ---- Tool API builder ----

/** Build the API object that tool renderPanel() receives. */
function _buildToolAPI(port, globalIdx) {
  return {
    state: {
      get activeSelection() { return S.activeSelection; },
      get mediaW() { return S.mediaW; },
      get mediaH() { return S.mediaH; },
      isPointSelected: S.isPointSelected,
    },
    actions: {
      setSelection(sel) {
        A.selectPoint(sel.port, sel.point);
      },
      toggleSelection(portIdx, pointIdx) {
        A.togglePoint(portIdx, pointIdx);
      },
      markPortDirty: A.markPortDirty,
      drawOverlay: A.drawOverlay,
      updateLinePreviews: A.updateLinePreviews,
      renderRack: render,
      addPointToPort: A.addPointToPort,
      removePointFromPort: A.removePointFromPort,
    },
  };
}
