import { app } from "../../scripts/app.js";

const CATEGORY = "Inteliweb/Logic";

app.registerExtension({
  name: "Inteliweb.SetGet.CategoryFix",
  setup() {
    const SetNode = LiteGraph.getNodeType?.("SetInteliweb")
      || LiteGraph.registered_node_types?.SetInteliweb;
    const GetNode = LiteGraph.getNodeType?.("GetInteliweb")
      || LiteGraph.registered_node_types?.GetInteliweb;

    // LiteGraph derives the category from the internal type during registration.
    // Reapply the desired category afterward without changing or duplicating IDs.
    if (SetNode) SetNode.category = CATEGORY;
    if (GetNode) GetNode.category = CATEGORY;
  },
});
