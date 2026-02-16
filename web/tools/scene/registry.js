// ------------------------------------------------------------------ //
// Scene tool registry — global tools shown in toolbar below viewport
// ------------------------------------------------------------------ //
// To add a new scene tool:
//   1. Create tools/scene/<name>/tool.js exporting the scene tool contract
//   2. Import it here and add to the array
//
// Scene tool contract:
//   { name, label, init, begin, renderPanel, onSelectionChanged,
//     isActive, getControlPoints, getActiveControl, moveControl, getSavedPositions }
// ------------------------------------------------------------------ //

import transform from "./transform/tool.js";

export default [transform];
