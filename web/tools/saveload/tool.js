// ------------------------------------------------------------------ //
// Save/Load tool — copy/paste normalized coordinates
// ------------------------------------------------------------------ //

import { parseSaveLoadText } from "../../rack/port-model.js";

export default {
  name: "saveload",
  label: "Save/Load",

  /**
   * Render this tool's panel inside a port's sidebar section.
   */
  renderPanel(container, port, portIdx, api) {
    const { mediaW, mediaH } = api.state;
    const { setSelection, markPortDirty, drawOverlay, updateLinePreviews, renderRack } = api.actions;

    const w = mediaW || 1;
    const h = mediaH || 1;
    const text = port.points
      .map((p) => `${(p.x / w).toFixed(6)}\t${(p.y / h).toFixed(6)}`)
      .join("\n");

    const ta = document.createElement("textarea");
    ta.className = "saveload-textarea";
    ta.value = text;
    ta.spellcheck = false;
    container.appendChild(ta);

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
        setSelection({ port: portIdx, point: 0 });
        renderRack();
        drawOverlay();
        updateLinePreviews();
      } else {
        loadBtn.textContent = "Need 2+ points";
        setTimeout(() => { loadBtn.textContent = "Load"; }, 2000);
      }
    });

    slActions.append(copyBtn, loadBtn);
    container.appendChild(slActions);
  },
};
