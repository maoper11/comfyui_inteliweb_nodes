// custom_nodes/comfyui_inteliweb_nodes/web/PhotopeaEditor_Inteliweb.js
// MIT-licensed integration of a Photopea editor dialog for ComfyUI.
// Based on the idea and flow from coolzilj/ComfyUI-Photopea (credit: @coolzilj).
// Adapted & namespaced for InteliwebAI to avoid collisions with other packs.
//
// What it does:
// - Adds a "Photopea Editor" button to Clipspace.
// - Adds "Open in Photopea Editor" to the right-click menu for nodes with IMAGE/MASK outputs.
// - Opens Photopea in an iframe dialog; lets you edit and "Save to node" back into ComfyUI.
// - No Python deps. Drop this file under your package `web/` folder.
//
// Notes:
// - Requires internet access (Photopea runs in the browser at https://www.photopea.com/).
// - For large images, Photopea will handle them but may take a moment to open/save.
// - Save uploads the edited image to Comfy's /upload/image API, updates Clipspace, and
//   updates the node widget image value when possible.
//
// Tested with ComfyUI >= 0.3.5x front-end.
//
// License: MIT (include credit if you redistribute).

import { app, ComfyApp } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { ComfyDialog, $el } from "../../scripts/ui.js";
import { ClipspaceDialog } from "../../extensions/core/clipspace.js";

// -----------------------------
// Helpers
// -----------------------------
function nodeHasImageOutput(node) {
  if (!Array.isArray(node.outputs)) return false;
  return node.outputs.some((o) => {
    const t = String(o.type || "").toUpperCase();
    return t.includes("IMAGE") || t.includes("MASK");
  });
}

function addMenuHandler(nodeType, handler) {
  const orig = nodeType.prototype.getExtraMenuOptions;
  nodeType.prototype.getExtraMenuOptions = function (_, options) {
    handler.call(this, _, options);
    if (orig) orig.apply(this, arguments);
  };
}

// Tries to grab the current image from Clipspace (PNG data URL).
// Returns {blob, name} or null if not found.
async function getActiveClipspaceImage() {
  try {
    // ClipspaceDialog keeps images in a grid. We can try to read the selected one.
    const dlg = ClipspaceDialog.getInstance?.() || null;
    if (!dlg) return null;

    // Heuristic: use the first selected image, else last opened.
    const { imgs = [] } = dlg;
    if (!imgs || !imgs.length) return null;

    const selected = imgs.find((im) => im.selected) || imgs[0];
    if (!selected || !selected.canvas) return null;

    const name = (selected.name || "clipspace_image") + ".png";
    const blob = await new Promise((resolve) =>
      selected.canvas.toBlob(resolve, "image/png")
    );
    if (!blob) return null;
    return { blob, name };
  } catch (e) {
    console.warn("getActiveClipspaceImage failed:", e);
    return null;
  }
}

// Uploads a Blob to Comfy /upload/image and returns {filename, subfolder, type}
async function uploadImageBlob(blob, name = "photopea.png") {
  const body = new FormData();
  body.append("image", blob, name);
  body.append("type", "input");

  const resp = await api.fetchApi("/upload/image", {
    method: "POST",
    body,
  });
  if (!resp?.ok) throw new Error("Upload failed");
  const data = await resp.json();
  // data: { name, subfolder, type }
  return data;
}

// Inserts an image into Clipspace grid (front-end only, no disk write here).
function pushToClipspaceFromURL(url, displayName = "photopea_output.png") {
  const dlg = ClipspaceDialog.getInstance?.() || null;
  if (!dlg) return;

  dlg.pushImage({
    url,
    name: displayName.replace(/\s+/g, "_"),
  });
}

// Update node widget "image" if we have ComfyApp.clipspace_return_node set
function updateReturnNodeWidgetFromUpload(uploadInfo) {
  const returnNode = ComfyApp.clipspace_return_node;
  if (!returnNode) return;

  // Find an "image" widget and set its value like: `${name} [input]`
  const widget = returnNode.widgets?.find?.((w) => w.name === "image");
  if (widget) {
    widget.value = `${uploadInfo.name} [input]`;
    returnNode.setDirtyCanvas(true, true);
  }
}

// Sends a file to Photopea via postMessage "open" (binary Uint8Array)
async function sendBlobToPhotopea(iframe, blob, name = "image.png") {
  const arrBuf = await blob.arrayBuffer();
  const uint8 = new Uint8Array(arrBuf);
  iframe.contentWindow.postMessage({ type: "open", data: uint8, name }, "*");
}

// -----------------------------
// Dialog
// -----------------------------
class InteliwebPhotopeaDialog extends ComfyDialog {
  static instance = null;
  static getInstance() {
    if (!InteliwebPhotopeaDialog.instance) {
      InteliwebPhotopeaDialog.instance = new InteliwebPhotopeaDialog();
    }
    return InteliwebPhotopeaDialog.instance;
  }

  constructor() {
    super();
    this.iframe = null;
    this.onMessage = this.onMessage.bind(this);
  }

  createButtons() {
    const sendBtn = $el("button", {
      textContent: "Send from Clipspace",
      onclick: async () => {
        try {
          if (!this.iframe) return;
          const picked = await getActiveClipspaceImage();
          if (!picked) {
            alert(
              "No image in Clipspace. Right‑click a node → Copy to Clipspace o pega una imagen allí."
            );
            return;
          }
          await sendBlobToPhotopea(this.iframe, picked.blob, picked.name);
        } catch (e) {
          console.warn(e);
          alert("Failed to send to Photopea.");
        }
      },
      style: { marginRight: "auto" },
    });

    const saveBtn = $el("button", {
      textContent: "Save to node",
      onclick: () => {
        // Photopea will reply with {type:'save', data: Uint8Array}
        if (this.iframe) {
          this.iframe.contentWindow.postMessage({ type: "save" }, "*");
        }
      },
    });

    const openNewBtn = $el("button", {
      textContent: "Open Photopea (tab)",
      onclick: () => window.open("https://www.photopea.com/", "_blank"),
    });

    const closeBtn = $el("button", {
      textContent: "Close",
      onclick: () => this.close(),
    });

    return [sendBtn, saveBtn, openNewBtn, closeBtn];
  }

  show() {
    // Build UI
    this.element = $el("div.comfy-modal-content", {
      style: {
        width: "900px",
        height: "640px",
        display: "flex",
        flexDirection: "column",
      },
    });

    const header = $el(
      "div",
      {
        style: {
          padding: "8px 10px",
          display: "flex",
          gap: "8px",
          alignItems: "center",
          borderBottom: "1px solid var(--border-color)",
        },
      },
      [
        $el("span", {
          textContent: "Photopea (Inteliweb)",
          style: { fontWeight: "600" },
        }),
        ...this.createButtons(),
      ]
    );

    const iframe = $el("iframe", {
      src: "https://www.photopea.com/",
      style: {
        border: "none",
        width: "100%",
        height: "100%",
        flex: "1 1 auto",
      },
      allow: "clipboard-read; clipboard-write;",
    });

    this.iframe = iframe;

    const body = $el(
      "div",
      {
        style: {
          position: "relative",
          flex: "1 1 auto",
        },
      },
      [iframe]
    );

    this.element.append(header, body);

    super.show();
    window.addEventListener("message", this.onMessage);

    // Auto-send selected Clipspace image (quality of life)
    setTimeout(async () => {
      try {
        const picked = await getActiveClipspaceImage();
        if (picked)
          await sendBlobToPhotopea(this.iframe, picked.blob, picked.name);
      } catch {}
    }, 600);
  }

  close() {
    window.removeEventListener("message", this.onMessage);
    this.iframe = null;
    super.close();
  }

  async onMessage(ev) {
    const msg = ev?.data;
    if (!msg || typeof msg !== "object") return;

    // Photopea returns {type: "save", data: Uint8Array}
    if (msg.type === "save" && msg.data) {
      try {
        const uint8 = msg.data;
        // Some browsers give plain arrays; ensure Uint8Array
        const bytes =
          uint8 instanceof Uint8Array ? uint8 : new Uint8Array(uint8);
        const blob = new Blob([bytes], { type: "image/png" });

        // 1) Upload to Comfy
        const uploadInfo = await uploadImageBlob(blob, "photopea_output.png");

        // 2) Push to clipspace (visual)
        // Use /view endpoint to generate a proper URL for the just-uploaded file
        const viewURL = api.apiURL(
          "/view?filename=" +
            encodeURIComponent(uploadInfo.name) +
            "&type=" +
            encodeURIComponent(uploadInfo.type || "input") +
            "&subfolder=" +
            encodeURIComponent(uploadInfo.subfolder || "")
        );
        pushToClipspaceFromURL(viewURL, uploadInfo.name);

        // 3) Update return node widget (if any)
        updateReturnNodeWidgetFromUpload(uploadInfo);

        // Done
        app.ui?.showToast?.("Image saved from Photopea.", "success");
      } catch (e) {
        console.error("Save handling failed:", e);
        alert("Failed to save image back into Comfy.");
      }
    }
  }
}

// -----------------------------
// Extension registration
// -----------------------------
app.registerExtension({
  name: "Inteliweb.PhotopeaEditor",
  init() {
    // Add Clipspace button
    const context_predicate = () => {
      // Always allow opening Photopea; sending image depends on Clipspace content
      return true;
    };
    const callback = () => {
      const dlg = InteliwebPhotopeaDialog.getInstance();
      dlg.show();
    };
    ClipspaceDialog.registerButton(
      "Photopea Editor",
      context_predicate,
      callback
    );
  },

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (
      Array.isArray(nodeData.output) &&
      (nodeData.output.includes("MASK") || nodeData.output.includes("IMAGE"))
    ) {
      addMenuHandler(nodeType, function (_, options) {
        options.unshift({
          content: "Open in Photopea Editor",
          callback: () => {
            // Prepare Clipspace with this node's preview (Comfy native helper)
            try {
              ComfyApp.copyToClipspace(this);
            } catch {}
            // Mark where to return after save
            ComfyApp.clipspace_return_node = this;

            const dlg = InteliwebPhotopeaDialog.getInstance();
            dlg.show();
          },
        });
      });
    }
  },
});
