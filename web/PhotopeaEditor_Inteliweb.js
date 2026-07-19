// InteliwebAI adaptation of coolzilj/ComfyUI-Photopea
// License: MIT, attribution to original author (@coolzilj).

import { app, ComfyApp } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const MENU_LABEL = "Open in Photopea Editor";
const PHOTOPEA_URL = "https://www.photopea.com";

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

function absoluteUrl(path) {
  return new URL(path, window.location.origin).href;
}

function createStatusDialog() {
  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "100000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,.72)",
  });

  const panel = document.createElement("div");
  Object.assign(panel.style, {
    width: "min(520px, 90vw)",
    padding: "24px",
    borderRadius: "12px",
    border: "1px solid rgba(255,255,255,.15)",
    background: "#181818",
    color: "#f5f5f5",
    boxShadow: "0 20px 60px rgba(0,0,0,.55)",
    fontFamily: "system-ui, sans-serif",
  });

  const title = document.createElement("h3");
  title.textContent = "Photopea Editor";
  title.style.margin = "0 0 12px";

  const message = document.createElement("div");
  message.textContent = "Preparing the image…";
  message.style.lineHeight = "1.5";
  message.style.opacity = "0.9";

  const detail = document.createElement("div");
  detail.style.marginTop = "10px";
  detail.style.fontSize = "12px";
  detail.style.opacity = "0.65";

  const buttons = document.createElement("div");
  Object.assign(buttons.style, {
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
    marginTop: "20px",
  });

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", () => overlay.remove());
  buttons.appendChild(closeButton);

  panel.append(title, message, detail, buttons);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  return {
    setMessage(text, extra = "") {
      message.textContent = text;
      detail.textContent = extra;
    },
    close() {
      overlay.remove();
    },
  };
}

async function createSessionFromImage(imageUrl) {
  const sourceResponse = await fetch(imageUrl, { cache: "no-store" });
  if (!sourceResponse.ok) {
    throw new Error(`Unable to read the selected image: HTTP ${sourceResponse.status}`);
  }

  const blob = await sourceResponse.blob();
  const form = new FormData();
  form.append("image", blob, "photopea-source.png");

  const response = await api.fetchApi("/inteliweb/photopea/session", {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Unable to create Photopea session: HTTP ${response.status}`);
  }
  return await response.json();
}

function updateClipspaceAfterSave(status) {
  const clipspace = ComfyApp.clipspace;
  if (!clipspace) return;

  const relativeValue = `${status.subfolder}/${status.filename} [input]`;
  if (clipspace.widgets) {
    const imageWidget = clipspace.widgets.find((item) => item.name === "image");
    if (imageWidget) imageWidget.value = relativeValue;
  }

  if (clipspace.imgs?.length) {
    const index = Number.isInteger(clipspace.selectedIndex) ? clipspace.selectedIndex : 0;
    const image = new Image();
    image.src = api.apiURL(
      `/view?filename=${encodeURIComponent(status.filename)}&subfolder=${encodeURIComponent(status.subfolder)}&type=input&t=${Date.now()}`,
    );
    clipspace.imgs[index] = image;
  }

  if (typeof ComfyApp.onClipspaceEditorSave === "function") {
    ComfyApp.onClipspaceEditorSave();
  }
}

function startStatusPolling(statusUrl, dialog) {
  let stopped = false;
  let attempts = 0;

  const stop = () => {
    stopped = true;
  };

  const poll = async () => {
    if (stopped) return;
    attempts += 1;

    try {
      const response = await fetch(statusUrl, { cache: "no-store" });
      const status = await response.json();

      if (status.status === "saved") {
        updateClipspaceAfterSave(status);
        dialog.setMessage(
          "The edited image was saved back to ComfyUI.",
          "You can close the Photopea browser tab and this dialog.",
        );
        stop();
        return;
      }

      if (status.status === "error") {
        dialog.setMessage("Photopea could not save the image.", status.error || "Unknown error");
        stop();
        return;
      }

      if (status.status === "expired") {
        dialog.setMessage("The Photopea session expired.", "Open the image again from the node menu.");
        stop();
        return;
      }
    } catch (error) {
      if (attempts > 5) {
        dialog.setMessage("Unable to check the Photopea session.", error.message);
      }
    }

    if (!stopped) window.setTimeout(poll, 1000);
  };

  poll();
  return stop;
}

async function openNodeInPhotopea(node) {
  const dialog = createStatusDialog();

  try {
    if (typeof ComfyApp.copyToClipspace !== "function") {
      throw new Error("The current ComfyUI frontend does not expose Clipspace");
    }

    ComfyApp.copyToClipspace(node);
    ComfyApp.clipspace_return_node = node;

    const selectedImage = getSelectedClipspaceImage();
    if (!selectedImage?.src) {
      throw new Error("The selected node does not currently contain an image");
    }

    dialog.setMessage("Preparing the image for Photopea…");
    const session = await createSessionFromImage(selectedImage.src);

    const sourceUrl = absoluteUrl(session.source_url);
    const saveUrl = absoluteUrl(session.save_url);
    const statusUrl = absoluteUrl(session.status_url);

    const config = {
      files: [sourceUrl],
      server: {
        version: 1,
        url: saveUrl,
        formats: ["png"],
      },
      environment: {
        intro: false,
        localsave: false,
      },
    };

    const editorUrl = `${PHOTOPEA_URL}#${encodeURIComponent(JSON.stringify(config))}`;
    const opened = window.open(editorUrl, "_blank");
    if (!opened) {
      throw new Error("The browser blocked the Photopea window. Allow pop-ups for ComfyUI and try again.");
    }

    dialog.setMessage(
      "Photopea opened in your browser.",
      "Edit the image, then use File → Save or press Ctrl+S. The result will return automatically to the Load Image node.",
    );
    startStatusPolling(statusUrl, dialog);
  } catch (error) {
    console.error("[Inteliweb] Photopea open failed:", error);
    dialog.setMessage("Unable to open Photopea Editor.", error.message);
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
