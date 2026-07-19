// InteliwebAI adaptation of coolzilj/ComfyUI-Photopea
// License: MIT, attribution to original author (@coolzilj).

import { app, ComfyApp } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const MENU_LABEL = "Open in Photopea Editor";
const PHOTOPEA_URL = "https://www.photopea.com/";
const PHOTOPEA_ORIGINS = new Set([
  "https://www.photopea.com",
  "https://photopea.com",
]);

function nodeHasImageOutput(node) {
  if (!Array.isArray(node?.outputs)) return false;
  return node.outputs.some((output) => {
    const type = output?.type;
    if (Array.isArray(type)) {
      return type.includes("IMAGE") || type.includes("MASK");
    }
    return type === "IMAGE" || type === "MASK";
  });
}

function getSelectedClipspaceImage() {
  const clipspace = ComfyApp.clipspace;
  if (!clipspace?.imgs?.length) return null;
  const index = Number.isInteger(clipspace.selectedIndex)
    ? clipspace.selectedIndex
    : 0;
  return clipspace.imgs[index] ?? clipspace.imgs[0] ?? null;
}

async function fetchImageBuffer(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to load image: HTTP ${response.status}`);
  }
  return await response.arrayBuffer();
}

async function uploadFile(formData) {
  const response = await api.fetchApi("/upload/image", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw new Error(`${response.status} - ${response.statusText}`);
  }
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
    this.currentNode = null;
    this.imageBuffer = null;
    this.phase = "closed";
    this.isFullscreen = false;
    this.bootTimeout = null;
    this.pendingExport = null;

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
      position: "relative",
      flex: "1",
      minHeight: "0",
      background: "#171717",
    });

    this.status = document.createElement("div");
    Object.assign(this.status.style, {
      position: "absolute",
      inset: "0",
      zIndex: "2",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "10px",
      padding: "30px",
      color: "#e5e7eb",
      background: "#171717",
      textAlign: "center",
      font: "14px ui-sans-serif, system-ui, sans-serif",
    });

    this.statusTitle = document.createElement("strong");
    this.statusTitle.style.fontSize = "16px";
    this.statusDetail = document.createElement("span");
    this.statusDetail.style.opacity = "0.72";
    this.status.append(this.statusTitle, this.statusDetail);
    this.frameHost.appendChild(this.status);

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

    this.fullscreenButton = this.makeButton("Fullscreen", () =>
      this.toggleFullscreen(),
    );
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
    this.saveButton.disabled = true;

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

  setStatus(title, detail = "", visible = true) {
    this.statusTitle.textContent = title;
    this.statusDetail.textContent = detail;
    this.status.style.display = visible ? "flex" : "none";
  }

  isPhotopeaMessage(event) {
    if (!this.iframe?.contentWindow || event.source !== this.iframe.contentWindow) {
      return false;
    }
    return !event.origin || event.origin === "null" || PHOTOPEA_ORIGINS.has(event.origin);
  }

  onMessage(event) {
    if (!this.isPhotopeaMessage(event)) return;

    if (event.data instanceof ArrayBuffer && this.pendingExport) {
      this.pendingExport.payload = event.data;
      return;
    }

    if (event.data !== "done") return;

    if (this.phase === "booting") {
      window.clearTimeout(this.bootTimeout);
      this.phase = "loading-image";
      this.setStatus("Opening image in Photopea…", "Transferring the image to the editor.");

      const buffer = this.imageBuffer;
      this.imageBuffer = null;
      if (!buffer) {
        this.failOpen(new Error("The image buffer is unavailable"));
        return;
      }

      this.iframe.contentWindow.postMessage(buffer, "*", [buffer]);
      return;
    }

    if (this.phase === "loading-image") {
      this.phase = "ready";
      this.setStatus("", "", false);
      this.saveButton.disabled = false;
      return;
    }

    if (this.phase === "exporting" && this.pendingExport) {
      const pending = this.pendingExport;
      this.pendingExport = null;
      this.phase = "ready";
      window.clearTimeout(pending.timeout);
      if (pending.payload) pending.resolve(pending.payload);
      else pending.reject(new Error("Photopea returned no PNG data"));
    }
  }

  async open(node) {
    const selectedImage = getSelectedClipspaceImage();
    if (!selectedImage?.src) {
      throw new Error("The selected node has no image to edit");
    }

    this.closeFrameOnly();
    this.currentNode = node;
    this.phase = "preparing";
    this.overlay.style.display = "flex";
    this.saveButton.disabled = true;
    this.setStatus("Preparing Photopea…", "Reading the image from ComfyUI.");

    try {
      this.imageBuffer = await fetchImageBuffer(selectedImage.src);

      const config = {
        environment: {
          intro: false,
          localsave: false,
        },
      };

      this.iframe = document.createElement("iframe");
      this.iframe.title = "Photopea Editor";
      this.iframe.src = `${PHOTOPEA_URL}#${encodeURIComponent(JSON.stringify(config))}`;
      this.iframe.allow = "clipboard-read; clipboard-write";
      this.iframe.referrerPolicy = "strict-origin-when-cross-origin";
      Object.assign(this.iframe.style, {
        position: "absolute",
        inset: "0",
        zIndex: "1",
        width: "100%",
        height: "100%",
        border: "0",
        display: "block",
        background: "#171717",
      });

      this.iframe.addEventListener("load", () => {
        if (this.phase === "booting") {
          this.setStatus(
            "Loading Photopea…",
            "Waiting for the editor to finish initializing.",
          );
        }
      });
      this.iframe.addEventListener("error", () => {
        this.failOpen(new Error("The Photopea iframe failed to load"));
      });

      this.frameHost.insertBefore(this.iframe, this.status);
      this.phase = "booting";
      this.setStatus("Loading Photopea…", "Connecting to photopea.com.");

      this.bootTimeout = window.setTimeout(() => {
        if (this.phase === "booting") {
          this.failOpen(
            new Error(
              "Photopea did not initialize. The embedded browser may be blocking third-party frames.",
            ),
          );
        }
      }, 30000);
    } catch (error) {
      this.failOpen(error);
      throw error;
    }
  }

  failOpen(error) {
    window.clearTimeout(this.bootTimeout);
    this.phase = "failed";
    this.saveButton.disabled = true;
    this.setStatus(
      "Photopea could not be loaded",
      error?.message ?? String(error),
    );
    console.error("[Inteliweb] Photopea open failed:", error);
  }

  async save() {
    if (!this.iframe?.contentWindow || this.phase !== "ready") return;

    try {
      this.saveButton.disabled = true;
      this.saveButton.textContent = "Saving...";
      this.phase = "exporting";

      const payload = await new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          this.pendingExport = null;
          this.phase = "ready";
          reject(new Error("Photopea did not return the edited image"));
        }, 30000);

        this.pendingExport = {
          payload: null,
          timeout,
          resolve,
          reject,
        };

        this.iframe.contentWindow.postMessage(
          'app.activeDocument.saveToOE("png");',
          "*",
        );
      });

      const filename = `clipspace-photopea-${Date.now()}.png`;
      const body = new FormData();
      body.append("image", new Blob([payload], { type: "image/png" }), filename);
      body.append("subfolder", "photopea");
      const uploaded = await uploadFile(body);

      const clipspace = ComfyApp.clipspace;
      if (clipspace?.widgets) {
        const imageWidget = clipspace.widgets.find(
          (item) => item.name === "image",
        );
        if (imageWidget) {
          imageWidget.value = `photopea/${filename} [input]`;
        }
      }
      if (clipspace?.imgs?.length) {
        const index = Number.isInteger(clipspace.selectedIndex)
          ? clipspace.selectedIndex
          : 0;
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
      if (this.phase === "exporting") this.phase = "ready";
    } finally {
      this.saveButton.disabled = this.phase !== "ready";
      this.saveButton.textContent = "Save to node";
    }
  }

  closeFrameOnly() {
    window.clearTimeout(this.bootTimeout);
    if (this.pendingExport) {
      window.clearTimeout(this.pendingExport.timeout);
      this.pendingExport.reject(new Error("Photopea editor was closed"));
      this.pendingExport = null;
    }
    this.iframe?.remove();
    this.iframe = null;
    this.imageBuffer = null;
    this.phase = "closed";
  }

  close() {
    this.closeFrameOnly();
    this.overlay.style.display = "none";
    this.currentNode = null;
    this.saveButton.disabled = true;
    this.saveButton.textContent = "Save to node";
  }

  toggleFullscreen() {
    this.isFullscreen = !this.isFullscreen;
    Object.assign(
      this.panel.style,
      this.isFullscreen
        ? { width: "100vw", height: "100vh", borderRadius: "0" }
        : { width: "90vw", height: "90vh", borderRadius: "10px" },
    );
    this.fullscreenButton.textContent = this.isFullscreen
      ? "Exit Fullscreen"
      : "Fullscreen";
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
