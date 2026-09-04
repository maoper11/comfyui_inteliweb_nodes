import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const UI_EVENT_KEY = "inteliweb_sound_notify";
const LISTENER_GUARD = "__inteliwebSoundNotifyListenerInstalled";
const activeAudio = new Set();

function soundUrl(filename) {
  const route = `/inteliweb/api/sound?name=${encodeURIComponent(filename)}`;
  try {
    if (typeof api?.apiURL === "function") return api.apiURL(route);
  } catch (_) {
    // Fall back to the local route when an older frontend has no URL helper.
  }
  return route;
}

async function playSound(filename) {
  if (typeof filename !== "string" || !filename) return;

  const audio = new Audio(soundUrl(filename));
  audio.preload = "auto";
  activeAudio.add(audio);

  const cleanup = () => activeAudio.delete(audio);
  audio.addEventListener("ended", cleanup, { once: true });
  audio.addEventListener("error", cleanup, { once: true });
  audio.addEventListener("abort", cleanup, { once: true });

  try {
    await audio.play();
  } catch (error) {
    cleanup();
    console.warn(
      "[Inteliweb] Sound Notify playback was blocked or failed:",
      error?.message || error,
    );
  }
}

app.registerExtension({
  name: "inteliweb.sound.notify",

  setup() {
    if (globalThis[LISTENER_GUARD]) return;
    globalThis[LISTENER_GUARD] = true;

    api.addEventListener("executed", (event) => {
      const notifications = event?.detail?.output?.[UI_EVENT_KEY];
      if (!Array.isArray(notifications)) return;

      for (const notification of notifications) {
        if (notification?.enabled === false) continue;
        void playSound(notification?.sound);
      }
    });
  },
});
