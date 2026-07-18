// InteliwebAI adaptation of coolzilj/ComfyUI-Photopea
// Renamed classes and extension namespace to avoid collisions.
// License: MIT, attribution to original author (@coolzilj).

import { app, ComfyApp } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { ComfyDialog, $el } from "../../scripts/ui.js";

const MENU_LABEL = "Open in Photopea Editor";

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

async function imageToBase64(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to load image for Photopea: HTTP ${response.status}`);
  }

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

  if (!response.ok) {
    throw new Error(`${response.status} - ${response.statusText}`);
  }

  const data = await response.json();
  const clipspace = ComfyApp.clipspace;
  if (clipspace?.imgs?.length) {
    const index = Number.isInteger(clipspace.selectedIndex)
      ? clipspace.selectedIndex
      : 0;
    clipspace.imgs[index] = new Image();
    clipspace.imgs[index].src = api.apiURL(
      `/view?filename=${encodeURIComponent(data.name)}&subfolder=${encodeURIComponent(data.subfolder ?? "")}&type=${encodeURIComponent(data.type ?? "input")}`,
    );
  }

  return data;
}

class InteliwebPhotopeaEditorDialog extends ComfyDialog {
  static instance = null;

  static getInstance() {
    if (!InteliwebPhotopeaEditorDialog.instance) {
      InteliwebPhotopeaEditorDialog.instance =
        new InteliwebPhotopeaEditorDialog();
    }
    return InteliwebPhotopeaEditorDialog.instance;
  }

  constructor() {
    super();
    this.element = $el("div.comfy-modal", { parent: document.body }, [
      $el("div.comfy-modal-content", [...this.createButtons()]),
    ]);
    this.iframe = null;
    this.iframe_container = null;
    this.is_layout_created = false;
    this.is_fullscreen = false;
    this.default_vw = "90vw";
    this.default_vh = "90vh";
  }

  createButtons() {
    return [];
  }

  createButton(name, callback) {
    const button = document.createElement("button");
    button.innerText = name;
    button.addEventListener("click", callback);
    return button;
  }

  createLeftButton(name, callback) {
    const button = this.createButton(name, callback);
    button.style.cssFloat = "left";
    button.style.marginRight = "4px";
    return button;
  }

  createRightButton(name, callback) {
    const button = this.createButton(name, callback);
    button.style.cssFloat = "right";
    button.style.marginLeft = "4px";
    return button;
  }

  setWindowedLayout() {
    this.element.style.width = this.default_vw;
    this.element.style.height = this.default_vh;
    this.is_fullscreen = false;
    if (this.fullscreenButton) this.fullscreenButton.innerText = "Fullscreen";
  }

  setFullscreenLayout() {
    this.element.style.width = "100vw";
    this.element.style.height = "100vh";
    this.is_fullscreen = true;
    if (this.fullscreenButton) {
      this.fullscreenButton.innerText = "Exit Fullscreen";
    }
  }

  setlayout() {
    const bottomPanel = document.createElement("div");
    bottomPanel.style.position = "absolute";
    bottomPanel.style.bottom = "0px";
    bottomPanel.style.left = "20px";
    bottomPanel.style.right = "20px";
    bottomPanel.style.height = "36px";
    this.element.appendChild(bottomPanel);

    this.fullscreenButton = this.createLeftButton("Fullscreen", () => {
      this.toggleFullscreen();
    });

    const brand = document.createElement("a");
    brand.href = "https://www.youtube.com/@InteliwebAI";
    brand.target = "_blank";
    brand.rel = "noopener noreferrer";
    brand.textContent = "Inteliweb AI";
    brand.style.cssFloat = "left";
    brand.style.marginLeft = "8px";
    brand.style.marginTop = "6px";
    brand.style.fontSize = "20px";
    brand.style.opacity = "0.6";
    brand.style.textDecoration = "none";
    brand.addEventListener("mouseenter", () => (brand.style.opacity = "0.85"));
    brand.addEventListener("mouseleave", () => (brand.style.opacity = "0.6"));

    const cancelButton = this.createRightButton("Cancel", () => this.close());
    this.saveButton = this.createRightButton("Save", () => this.save());

    bottomPanel.appendChild(this.fullscreenButton);
    bottomPanel.appendChild(brand);
    bottomPanel.appendChild(this.saveButton);
    bottomPanel.appendChild(cancelButton);
  }

  async show() {
    const selectedImage = getSelectedClipspaceImage();
    if (!selectedImage?.src) {
      console.warn("[Inteliweb] Photopea: no image is available in Clipspace.");
      alert("No image is available to open in Photopea.");
      return;
    }

    if (!this.is_layout_created) {
      this.setlayout();
      this.is_layout_created = true;
    }

    this.setWindowedLayout();
    this.saveButton.innerText = ComfyApp.clipspace_return_node
      ? "Save to node"
      : "Save";

    this.iframe = $el("iframe", {
      src: "https://www.photopea.com/",
      title: "Photopea Editor",
      style: {
        width: "100%",
        height: "100%",
        border: "none",
        position: "relative",
      },
    });

    this.iframe_container = document.createElement("div");
    this.iframe_container.style.flex = "1";
    this.iframe_container.style.paddingBottom = "40px";
    this.element.appendChild(this.iframe_container);
    this.element.style.display = "flex";
    this.element.style.flexDirection = "column";
    this.element.style.width = this.default_vw;
    this.element.style.height = this.default_vh;
    this.element.style.maxWidth = "100vw";
    this.element.style.maxHeight = "100vh";
    this.element.style.padding = "0";
    this.element.style.zIndex = "8888";
    this.iframe_container.appendChild(this.iframe);

    this.iframe.onload = async () => {
      try {
        const currentImage = getSelectedClipspaceImage();
        if (!currentImage?.src) throw new Error("Clipspace image is unavailable");
        const dataURL = await imageToBase64(currentImage.src);
        this.postMessageToPhotopea(`app.open(${JSON.stringify(dataURL)}, null, false);`);
      } catch (error) {
        console.error("[Inteliweb] Unable to open image in Photopea:", error);
        alert(`Unable to open the image in Photopea: ${error.message}`);
      }
    };
  }

  close() {
    this.setWindowedLayout();
    if (
      this.iframe_container &&
      this.iframe_container.parentNode === this.element
    ) {
      this.element.removeChild(this.iframe_container);
    }
    this.iframe_container = null;
    this.iframe = null;
    super.close();
  }

  async save() {
    try {
      const responses = await this.postMessageToPhotopea(
        'app.activeDocument.saveToOE("png");',
      );
      const payload = responses.find((item) => item instanceof ArrayBuffer);
      if (!payload) throw new Error("Photopea did not return PNG data");

      const file = new Blob([payload], { type: "image/png" });
      const body = new FormData();
      const filename = `clipspace-photopea-${performance.now()}.png`;

      const clipspace = ComfyApp.clipspace;
      if (clipspace?.widgets) {
        const index = clipspace.widgets.findIndex((obj) => obj.name === "image");
        if (index >= 0) {
          clipspace.widgets[index].value = `photopea/${filename} [input]`;
        }
      }

      body.append("image", file, filename);
      body.append("subfolder", "photopea");
      await uploadFile(body);

      if (typeof ComfyApp.onClipspaceEditorSave === "function") {
        ComfyApp.onClipspaceEditorSave();
      }
      this.close();
    } catch (error) {
      console.error("[Inteliweb] Unable to save Photopea image:", error);
      alert(`Unable to save the Photopea image: ${error.message}`);
    }
  }

  toggleFullscreen() {
    if (this.is_fullscreen) this.setWindowedLayout();
    else this.setFullscreenLayout();
  }

  async postMessageToPhotopea(message) {
    if (!this.iframe?.contentWindow) {
      throw new Error("Photopea iframe is not ready");
    }

    const targetWindow = this.iframe.contentWindow;
    const request = new Promise((resolve, reject) => {
      const responses = [];
      const timeout = window.setTimeout(() => {
        window.removeEventListener("message", handleMessage);
        reject(new Error("Photopea did not respond in time"));
      }, 30000);

      const handleMessage = (event) => {
        if (event.source !== targetWindow) return;
        responses.push(event.data);
        if (event.data === "done") {
          window.clearTimeout(timeout);
          window.removeEventListener("message", handleMessage);
          resolve(responses);
        }
      };

      window.addEventListener("message", handleMessage);
    });

    targetWindow.postMessage(message, "*");
    return await request;
  }
}

function openNodeInPhotopea(node) {
  try {
    if (typeof ComfyApp.copyToClipspace !== "function") {
      throw new Error("The current ComfyUI frontend does not expose Clipspace");
    }

    ComfyApp.copyToClipspace(node);
    ComfyApp.clipspace_return_node = node;

    if (!getSelectedClipspaceImage()) {
      throw new Error("The selected node does not currently contain an image");
    }

    InteliwebPhotopeaEditorDialog.getInstance().show();
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
