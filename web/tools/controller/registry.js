// ------------------------------------------------------------------ //
// Controller tool registry — per-port tools shown in rack sidebar
// ------------------------------------------------------------------ //
// To add a new controller tool:
//   1. Create tools/controller/<name>/tool.js exporting { name, label, renderPanel }
//   2. Import it here and add to the array
// ------------------------------------------------------------------ //

import points from "./points/tool.js";
import saveload from "./saveload/tool.js";

export default [points, saveload];
