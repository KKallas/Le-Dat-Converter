// ------------------------------------------------------------------ //
// Points tool — default point editing: add/remove/drag points
// ------------------------------------------------------------------ //

export default {
  name: "points",
  label: "Points",

  /**
   * Render this tool's panel inside a port's sidebar section.
   * Supports multi-select via Shift+click.
   */
  renderPanel(container, port, portIdx, api) {
    const { activeSelection, mediaW, mediaH, isPointSelected } = api.state;
    const { setSelection, toggleSelection, markPortDirty, drawOverlay, updateLinePreviews, renderRack, addPointToPort, removePointFromPort } = api.actions;

    const pointsDiv = document.createElement("div");
    pointsDiv.className = "points-list";

    port.points.forEach((pt, pti) => {
      const row = document.createElement("div");
      row.className = "point-row";

      const isActive = activeSelection &&
          activeSelection.port === portIdx &&
          activeSelection.point === pti;
      const selected = isPointSelected && isPointSelected(portIdx, pti);

      if (isActive) row.classList.add("active");
      if (selected) row.style.borderColor = "#00aaff";

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
          removePointFromPort(portIdx, pti);
          markPortDirty(port);
          renderRack();
          drawOverlay();
        });
        row.appendChild(rmPt);
      }

      row.addEventListener("click", (e) => {
        if (e.shiftKey && toggleSelection) {
          toggleSelection(portIdx, pti);
        } else {
          setSelection({ port: portIdx, point: pti });
        }
        renderRack();
        drawOverlay();
      });

      pointsDiv.appendChild(row);
    });

    container.appendChild(pointsDiv);

    // Add point button
    const actions = document.createElement("div");
    actions.className = "point-actions";
    const addPtBtn = document.createElement("button");
    addPtBtn.className = "btn-small";
    addPtBtn.textContent = "+ Point";
    addPtBtn.addEventListener("click", () => {
      addPointToPort(portIdx);
      markPortDirty(port);
      renderRack();
      drawOverlay();
    });
    actions.appendChild(addPtBtn);
    container.appendChild(actions);
  },
};
