// ------------------------------------------------------------------ //
// Transform tool — offset/pivot/rotate/scale a port's polyline
// ------------------------------------------------------------------ //

import { computeTransformedPoints } from "../../rack/port-model.js";

export default {
  name: "transform",
  label: "Transform",

  /**
   * Render this tool's panel inside a port's sidebar section.
   */
  renderPanel(container, port, portIdx, api) {
    const { activeSelection } = api.state;
    const { setSelection, applyTransform, cancelTransform, drawOverlay, updateLinePreviews, renderRack } = api.actions;

    const s = port.transformState;
    const controlsList = document.createElement("div");
    controlsList.className = "points-list";

    function makeControlRow(key, label, inputs) {
      const row = document.createElement("div");
      row.className = "point-row";
      if (activeSelection &&
          activeSelection.port === portIdx &&
          "control" in activeSelection &&
          activeSelection.control === key) {
        row.classList.add("active");
      }
      const lbl = document.createElement("span");
      lbl.className = "point-label";
      lbl.textContent = label;
      row.append(lbl, ...inputs);
      row.addEventListener("click", () => {
        setSelection({ port: portIdx, control: key });
        renderRack();
        drawOverlay();
      });
      return row;
    }

    function applyInputs() {
      port.points = computeTransformedPoints(port.savedPoints, s);
      drawOverlay();
      updateLinePreviews();
    }

    if (s) {
      // Offset
      const ofX = document.createElement("input");
      ofX.type = "number"; ofX.className = "coord-input"; ofX.value = Math.round(s.offset.x);
      ofX.addEventListener("click", (e) => e.stopPropagation());
      ofX.addEventListener("change", () => { s.offset.x = parseInt(ofX.value) || 0; applyInputs(); });
      const ofY = document.createElement("input");
      ofY.type = "number"; ofY.className = "coord-input"; ofY.value = Math.round(s.offset.y);
      ofY.addEventListener("click", (e) => e.stopPropagation());
      ofY.addEventListener("change", () => { s.offset.y = parseInt(ofY.value) || 0; applyInputs(); });
      controlsList.appendChild(makeControlRow("offset", "Offset", [ofX, ofY]));

      // Pivot
      const pvX = document.createElement("input");
      pvX.type = "number"; pvX.className = "coord-input"; pvX.value = Math.round(s.pivot.x);
      pvX.addEventListener("click", (e) => e.stopPropagation());
      pvX.addEventListener("change", () => { s.pivot.x = parseInt(pvX.value) || 0; applyInputs(); });
      const pvY = document.createElement("input");
      pvY.type = "number"; pvY.className = "coord-input"; pvY.value = Math.round(s.pivot.y);
      pvY.addEventListener("click", (e) => e.stopPropagation());
      pvY.addEventListener("change", () => { s.pivot.y = parseInt(pvY.value) || 0; applyInputs(); });
      controlsList.appendChild(makeControlRow("pivot", "Pivot", [pvX, pvY]));

      // Rotate
      const rotIn = document.createElement("input");
      rotIn.type = "number"; rotIn.className = "coord-input"; rotIn.step = "0.1";
      rotIn.value = (s.angle * 180 / Math.PI).toFixed(1);
      rotIn.addEventListener("click", (e) => e.stopPropagation());
      rotIn.addEventListener("change", () => { s.angle = (parseFloat(rotIn.value) || 0) * Math.PI / 180; applyInputs(); });
      const degLabel = document.createElement("span");
      degLabel.className = "coords";
      degLabel.textContent = "\u00b0";
      controlsList.appendChild(makeControlRow("rotate", "Rotate", [rotIn, degLabel]));

      // ScaleX
      const sxIn = document.createElement("input");
      sxIn.type = "number"; sxIn.className = "coord-input"; sxIn.step = "0.01";
      sxIn.value = s.scaleX.toFixed(2);
      sxIn.addEventListener("click", (e) => e.stopPropagation());
      sxIn.addEventListener("change", () => { s.scaleX = parseFloat(sxIn.value) || 1; applyInputs(); });
      controlsList.appendChild(makeControlRow("scaleX", "ScaleX", [sxIn]));

      // ScaleY
      const syIn = document.createElement("input");
      syIn.type = "number"; syIn.className = "coord-input"; syIn.step = "0.01";
      syIn.value = s.scaleY.toFixed(2);
      syIn.addEventListener("click", (e) => e.stopPropagation());
      syIn.addEventListener("change", () => { s.scaleY = parseFloat(syIn.value) || 1; applyInputs(); });
      controlsList.appendChild(makeControlRow("scaleY", "ScaleY", [syIn]));
    }

    container.appendChild(controlsList);

    // Apply / Cancel
    const actionsRow = document.createElement("div");
    actionsRow.className = "transform-actions";
    const applyBtn = document.createElement("button");
    applyBtn.className = "btn-small btn-primary";
    applyBtn.textContent = "Apply";
    applyBtn.addEventListener("click", () => {
      applyTransform(port);
      setSelection(null);
      renderRack();
      drawOverlay();
      updateLinePreviews();
    });
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn-small";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => {
      cancelTransform(port);
      setSelection(null);
      renderRack();
      drawOverlay();
      updateLinePreviews();
    });
    actionsRow.append(applyBtn, cancelBtn);
    container.appendChild(actionsRow);
  },
};
