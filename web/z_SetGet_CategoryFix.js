import { app } from "../../scripts/app.js";

const LEGACY_SET_TYPE = "SetInteliweb";
const LEGACY_GET_TYPE = "GetInteliweb";
const SET_TYPE = "Inteliweb/Logic/SetInteliweb";
const GET_TYPE = "Inteliweb/Logic/GetInteliweb";

function moveNodeTypeToCategory(legacyType, categorizedType, title) {
  const NodeClass = LiteGraph.getNodeType?.(legacyType) || LiteGraph.registered_node_types?.[legacyType];
  if (!NodeClass) return;

  try {
    LiteGraph.unregisterNodeType?.(legacyType);
  } catch {
    delete LiteGraph.registered_node_types?.[legacyType];
  }

  NodeClass.title = title;
  LiteGraph.registerNodeType(categorizedType, NodeClass);

  // Preserve workflows created during development with the unscoped internal ID,
  // but keep this compatibility alias out of Add Node menus and search results.
  class LegacyAlias extends NodeClass {}
  LegacyAlias.title = title;
  LegacyAlias.skip_list = true;
  LiteGraph.registerNodeType(legacyType, LegacyAlias);
}

app.registerExtension({
  name: "Inteliweb.SetGet.CategoryFix",
  setup() {
    moveNodeTypeToCategory(LEGACY_SET_TYPE, SET_TYPE, "Set (Inteliweb)");
    moveNodeTypeToCategory(LEGACY_GET_TYPE, GET_TYPE, "Get (Inteliweb)");
  },
});
