// InteliwebAI adaptation of coolzilj/ComfyUI-Photopea
// License: MIT, attribution to original author (@coolzilj).

import { app, ComfyApp } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const MENU_LABEL = "Open in Photopea Editor";
const PHOTOPEA_ORIGIN = "https://www.photopea.com";

function nodeHasImageOutput(node) {
  if (!Array.isArray(node?.outputs)) return false;
  return node.outputs.some((output) => {
    const type = output?.type;
    if (Array.isArray(type)) return type.includes("IMAGE") || type.includes("MASK");
    return type === "IMAGE" || type === "MASK";
  });
}

function getSelectedClipspaceImage() {
  const clipspace = ComfyApp.clipspace;
  if (!clipspace?.imgs?.length) return null;
  const index = Number.isInteger(clipspace.selectedIndex) ? clipspace.selectedIndex : 0;
  return clipspace.imgs[index] ?? clipspace.imgs[0] ?? null;
}

async function fetchImageDataUrl(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load image: HTTP ${response.status}`);
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

async function uploadFile(formData) {
  const response = await api.fetchApi("/upload/image", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) throw new Error(`${response.status} - ${response.statusText}`);
  return await response.json();
}

class InteliwebPhotopeaEditor {
  static instance = null;

  static getInstance() {
    if (!InteliwebPhotopeaEditor.instance) {
      InteliwebPhotopeaEditor.instance = new InteliwebPhotopeaEditor();
    }
    return InteliwebPhotopeaEditor.instance;
  }

  constructor() {
    this.iframe = null;
    this.ready = false;
    this.messageQueue = [];
    this.currentNode = null;
    this.isFullscreen = false;

    this.overlay = document.createElement("div");
    Object.assign(this.overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "100000",
      display: "none",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,.72)",
    });

    this.panel = document.createElement("div");
    Object.assign(this.panel.style, {
      position: "relative",
      width: "90vw",
      height: "90vh",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      background: "#171717",
      border: "1px solid rgba(255,255,255,.16)",
      borderRadius: "10px",
      boxShadow: "0 20px 60px rgba(0,0,0,.55)",
    });

    this.frameHost = document.createElement("div");
    Object.assign(this.frameHost.style, {
      flex: "1",
      minHeight: "0",
      background: "#171717",
    });

    this.footer = document.createElement("div");
    Object.assign(this.footer.style, {
      height: "44px",
      flex: "0 0 44px",
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "0 12px",
      background: "#202020",
      borderTop: "1px solid rgba(255,255,255,.12)",
    });

    this.fullscreenButton = this.makeButton("Fullscreen", () => this.toggleFullscreen());
    this.brand = document.createElement("a");
    this.brand.href = "https://www.youtube.com/@InteliwebAI";
    this.brand.target = "_blank";
    this.brand.rel = "noopener noreferrer";
    this.brand.textContent = "Inteliweb AI";
    Object.assign(this.brand.style, {
      color: "#b8a7ff",
      textDecoration: "none",
      marginRight: "auto",
    });
    this.cancelButton = this.makeButton("Cancel", () => this.close());
    this.saveButton = this.makeButton("Save to node", () => this.save());

    this.footer.append(
      this.fullscreenButton,
      this.brand,
      this.cancelButton,
      this.saveButton,
    );
    this.panel.append(this.frameHost, this.footer);
    this.overlay.appendChild(this.panel);
    document.body.appendChild(this.overlay);

    this.onMessage = this.onMessage.bind(this);
    window.addEventListener("message", this.onMessage);
  }

  makeButton(label, callback) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", callback);
    return button;
  }

  onMessage(event) {
    if (!this.iframe?.contentWindow || event.source !== this.iframe.contentWindow) return;
    if (event.origin && event.origin !== PHOTOPEA_ORIGIN) return;

    if (event.data === "done") {
      if (!this.ready) {
        this.ready = true;
        const queued = this.messageQueue.splice(0);
        for (const item of queued) this.iframe.contentWindow.postMessage(item, PHOTOPEA_ORIGIN);
      }
      return;
    }

    if (this.pendingExport && event.data instanceof ArrayBuffer) {
      this.pendingExport.payload = event.data;
    }
  }

  async open(node) {
    const selectedImage = getSelectedClipspaceImage();
    if (!selectedImage?.src) throw new Error("The selected node has no image to edit");

    this.currentNode = node;
    this.ready = false;
    this.messageQueue = [];
    this.pendingExport = null;
    this.overlay.style.display = "flex";

    const dataUrl = await fetchImageDataUrl(selectedImage.src);
    const config = {
      files: [dataUrl],
      environment: {
        intro: false,
        localsave: false,
      },
    };

    this.iframe?.remove();
    this.iframe = document.createElement("iframe");
    this.iframe.title = "Photopea Editor";
    this.iframe.src = `${PHOTOPEA_ORIGIN}#${encodeURIComponent(JSON.stringify(config))}`;
    this.iframe.allow = "clipboard-read; clipboard-write";
    this.iframe.referrerPolicy = "no-referrer-when-downgrade";
    Object.assign(this.iframe.style, {
      width: "100%",
      height: "100%",
      border: "0",
      display: "block",
      background: "#171717",
    });
    this.frameHost.replaceChildren(this.iframe);
  }

  sendToPhotopea(message) {
    if (!this.iframe?.contentWindow) throw new Error("Photopea is not ready");
    if (!this.ready) {
      this.messageQueue.push(message);
      return;
    }
    this.iframe.contentWindow.postMessage(message, PHOTOPEA_ORIGIN);
  }

  async save() {
    if (!this.iframe?.contentWindow) return;

    try {
      this.saveButton.disabled = true;
      this.saveButton.textContent = "Saving...";

      const payload = await new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          this.pendingExport = null;
          reject(new Error("Photopea did not return the edited image"));
        }, 30000);

        this.pendingExport = {
          payload: null,
          finish: () => {
            window.clearTimeout(timeout);
            const value = this.pendingExport?.payload;
            this.pendingExport = null;
            if (value) resolve(value);
            else reject(new Error("Photopea returned no PNG data"));
          },
        };

        const doneHandler = (event) => {
          if (event.source !== this.iframe.contentWindow) return;
          if (event.origin && event.origin !== PHOTOPEA_ORIGIN) return;
          if (event.data !== "done") return;
          window.removeEventListener("message", doneHandler);
          this.pendingExport?.finish();
        };
        window.addEventListener("message", doneHandler);

        this.sendToPhotopea('app.activeDocument.saveToOE("png");');
      });

      const filename = `clipspace-photopea-${Date.now()}.png`;
      const body = new FormData();
      body.append("image", new Blob([payload], { type: "image/png" }), filename);
      body.append("subfolder", "photopea");
      const uploaded = await uploadFile(body);

      const clipspace = ComfyApp.clipspace;
      if (clipspace?.widgets) {
        const imageWidget = clipspace.widgets.find((item) => item.name === "image");
        if (imageWidget) imageWidget.value = `photopea/${filename} [input]`;
      }
      if (clipspace?.imgs?.length) {
        const index = Number.isInteger(clipspace.selectedIndex) ? clipspace.selectedIndex : 0;
        const image = new Image();
        image.src = api.apiURL(
          `/view?filename=${encodeURIComponent(uploaded.name)}&subfolder=${encodeURIComponent(uploaded.subfolder ?? "")}&type=${encodeURIComponent(uploaded.type ?? "input")}`,
        );
        clipspace.imgs[index] = image;
      }

      if (typeof ComfyApp.onClipspaceEditorSave === "function") {
        ComfyApp.onClipspaceEditorSave();
      }
      this.close();
    } catch (error) {
      console.error("[Inteliweb] Photopea save failed:", error);
      alert(`Unable to save the Photopea image: ${error.message}`);
    } finally {
      this.saveButton.disabled = false;
      this.saveButton.textContent = "Save to node";
    }
  }

  close() {
    this.overlay.style.display = "none";
    this.frameHost.replaceChildren();
    this.iframe = null;
    this.ready = false;
    this.messageQueue = [];
    this.pendingExport = null;
    this.currentNode = null;
  }

  toggleFullscreen() {
    this.isFullscreen = !this.isFullscreen;
    Object.assign(this.panel.style, this.isFullscreen
      ? { width: "100vw", height: "100vh", borderRadius: "0" }
      : { width: "90vw", height: "90vh", borderRadius: "10px" });
    this.fullscreenButton.textContent = this.isFullscreen ? "Exit Fullscreen" : "Fullscreen";
  }
}

function openNodeInPhotopea(node) {
  try {
    if (typeof ComfyApp.copyToClipspace !== "function") {
      throw new Error("The current ComfyUI frontend does not expose Clipspace");
    }
    ComfyApp.copyToClipspace(node);
    ComfyApp.clipspace_return_node = node;
    InteliwebPhotopeaEditor.getInstance().open(node).catch((error) => {
      console.error("[Inteliweb] Photopea open failed:", error);
      alert(`Unable to open Photopea Editor: ${error.message}`);
      InteliwebPhotopeaEditor.getInstance().close();
    });
  } catch (error) {
    console.error("[Inteliweb] Unable to start Photopea Editor:", error);
    alert(`Unable to open Photopea Editor: ${error.message}`);
  }
}

app.registerExtension({
  name: "Inteliweb.PhotopeaEditor",
  getNodeMenuItems(node) {
    if (!nodeHasImageOutput(node)) return [];
    return [
      null,
      {
        content: MENU_LABEL,
        callback: () => openNodeInPhotopea(node),
      },
    ];
  },
});
