import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";


async function loadFrontendFunctions() {
  const sourceUrl = new URL("../web/GPUProfile_Inteliweb.js", import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const context = vm.createContext({ console, queueMicrotask });
  const module = new vm.SourceTextModule(
    `${source}\nexport { effectiveProfile, profileFromSource, syncRouters };`,
    { context, identifier: sourceUrl.href },
  );
  const appModule = new vm.SyntheticModule(
    ["app"],
    function initializeAppModule() {
      this.setExport("app", { registerExtension() {} });
    },
    { context },
  );

  await module.link(() => appModule);
  await module.evaluate();
  return module.namespace;
}

function makeWidget(name, value) {
  return { name, value, options: {} };
}

function makeRouter(id, profile) {
  return {
    id,
    comfyClass: "InteliwebModelProfileRouter",
    inputs: [],
    mode: 0,
    properties: {},
    size: [300, 200],
    widgets: [
      makeWidget("profile", profile),
      makeWidget("effective_profile", `${profile} • LOCAL`),
      makeWidget("global_channel", "none"),
    ],
    changeMode(mode) {
      this.mode = mode;
    },
    setDirtyCanvas() {},
  };
}

function makeProducer(id) {
  return {
    id,
    mode: 0,
    changeMode(mode) {
      this.mode = mode;
    },
    setDirtyCanvas() {},
  };
}

function makeSelector(id, profile, scope = "GLOBAL", channel = "gpu_profile") {
  return {
    id,
    comfyClass: "InteliwebGPUProfileSelector",
    inputs: [],
    widgets: [
      makeWidget("scope", scope),
      makeWidget("profile", profile),
      makeWidget("global_channel", channel),
    ],
  };
}

function makeVariableNode(id, comfyClass, name) {
  return {
    id,
    comfyClass,
    inputs: [],
    properties: {},
    widgets: [makeWidget("name", name)],
  };
}

function makeGraph(nodes) {
  const graph = {
    _nodes: nodes,
    links: {},
    getNodeById(id) {
      return this._nodes.find((node) => node.id === id) || null;
    },
  };
  for (const node of nodes) node.graph = graph;
  return graph;
}

function connect(graph, source, target, inputName, linkId) {
  target.inputs.push({ name: inputName, link: linkId });
  graph.links[linkId] = { origin_id: source.id };
}

function setWidget(node, name, value) {
  node.widgets.find((item) => item.name === name).value = value;
}

test("a router inherits the effective profile through a multi-router chain", async () => {
  const { effectiveProfile } = await loadFrontendFunctions();
  const first = makeRouter(1, "MEDIUM");
  const second = makeRouter(2, "HIGH");
  const third = makeRouter(3, "ULTRA");
  const graph = makeGraph([first, second, third]);
  connect(graph, first, second, "profile_in", 10);
  connect(graph, second, third, "profile_in", 11);

  assert.deepEqual(
    { ...effectiveProfile(second) },
    { profile: "MEDIUM", source: "INPUT" },
  );
  assert.deepEqual(
    { ...effectiveProfile(third) },
    { profile: "MEDIUM", source: "INPUT" },
  );

  setWidget(first, "profile", "LOW");
  assert.deepEqual(
    { ...effectiveProfile(third) },
    { profile: "LOW", source: "INPUT" },
  );
});

test("router synchronization updates inherited status and branch modes", async () => {
  const { syncRouters } = await loadFrontendFunctions();
  const first = makeRouter(1, "LOW");
  const second = makeRouter(2, "HIGH");
  const lowProducer = makeProducer(3);
  const highProducer = makeProducer(4);
  const graph = makeGraph([first, second, lowProducer, highProducer]);
  connect(graph, first, second, "profile_in", 20);
  connect(graph, lowProducer, second, "low_model", 21);
  connect(graph, highProducer, second, "high_model", 22);

  syncRouters(graph);

  assert.equal(second.properties.inteliwebEffectiveProfile, "LOW");
  assert.equal(second.properties.inteliwebProfileSource, "INPUT");
  assert.equal(
    second.widgets.find((item) => item.name === "effective_profile").value,
    "LOW • INPUT",
  );
  assert.equal(lowProducer.mode, 0);
  assert.equal(highProducer.mode, 2);
});

test("a global profile propagates through chained routers", async () => {
  const { effectiveProfile } = await loadFrontendFunctions();
  const selector = makeSelector(1, "ULTRA");
  const first = makeRouter(2, "GLOBAL");
  const second = makeRouter(3, "LOW");
  setWidget(first, "global_channel", "gpu_profile");
  const graph = makeGraph([selector, first, second]);
  connect(graph, first, second, "profile_in", 40);

  assert.deepEqual(
    { ...effectiveProfile(first) },
    { profile: "ULTRA", source: "GLOBAL" },
  );
  assert.deepEqual(
    { ...effectiveProfile(second) },
    { profile: "ULTRA", source: "INPUT" },
  );
});

test("Set/Get preserves a profile produced by a router", async () => {
  const { effectiveProfile } = await loadFrontendFunctions();
  const first = makeRouter(1, "MEDIUM");
  const setter = makeVariableNode(2, "SetInteliweb", "shared_profile");
  const getter = makeVariableNode(3, "GetInteliweb", "shared_profile");
  const second = makeRouter(4, "HIGH");
  const graph = makeGraph([first, setter, getter, second]);
  connect(graph, first, setter, "value", 50);
  connect(graph, getter, second, "profile_in", 51);

  assert.deepEqual(
    { ...effectiveProfile(second) },
    { profile: "MEDIUM", source: "INPUT" },
  );
});

test("a malformed router cycle resolves safely instead of recursing forever", async () => {
  const { effectiveProfile } = await loadFrontendFunctions();
  const first = makeRouter(1, "LOW");
  const second = makeRouter(2, "HIGH");
  const graph = makeGraph([first, second]);
  connect(graph, first, second, "profile_in", 30);
  connect(graph, second, first, "profile_in", 31);

  assert.deepEqual(
    { ...effectiveProfile(first) },
    { profile: null, source: "INPUT" },
  );
});
