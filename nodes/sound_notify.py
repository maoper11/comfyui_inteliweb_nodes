"""Terminal workflow node that plays a notification sound in the browser."""

from __future__ import annotations

import logging
from pathlib import Path

from .purge_vram import ANY

LOGGER = logging.getLogger(__name__)
DEFAULT_SOUND = "Tada.mp3"
SOUNDS_DIR = Path(__file__).resolve().parents[1] / "assets" / "sounds"


def list_sounds() -> list[str]:
    """Return the bundled MP3 filenames without exposing arbitrary paths."""
    try:
        sounds = sorted(
            (
                path.name
                for path in SOUNDS_DIR.iterdir()
                if path.is_file() and path.suffix.lower() == ".mp3"
            ),
            key=str.casefold,
        )
    except OSError as exc:
        LOGGER.debug("Sound directory is unavailable: %s", exc)
        sounds = []
    return sounds or [DEFAULT_SOUND]


def _sound_path(filename: object) -> Path | None:
    """Resolve a selected sound only when it is in the bundled inventory."""
    name = str(filename or "")
    if name not in list_sounds():
        return None

    candidate = (SOUNDS_DIR / name).resolve()
    try:
        candidate.relative_to(SOUNDS_DIR.resolve())
    except ValueError:
        return None
    return candidate if candidate.is_file() else None


class InteliwebSoundNotify:
    """Emit a frontend event when execution reaches this terminal node."""

    DESCRIPTION = (
        "Plays a notification sound in the browser when workflow execution "
        "reaches this node. Connect any final workflow value to the input."
    )
    SEARCH_ALIASES = [
        "Sound Notify",
        "Audio Notification",
        "Workflow Complete Sound",
        "Completion Chime",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        sounds = list_sounds()
        default = DEFAULT_SOUND if DEFAULT_SOUND in sounds else sounds[0]
        return {
            "required": {
                "anything": (
                    ANY,
                    {
                        "tooltip": (
                            "Connect any final workflow value. The value is only "
                            "used to determine when the notification is reached."
                        )
                    },
                ),
                "enabled": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": "Enable or disable this notification sound.",
                    },
                ),
                "sound": (
                    sounds,
                    {
                        "default": default,
                        "tooltip": "Notification sound played by the browser.",
                    },
                ),
            }
        }

    @classmethod
    def IS_CHANGED(cls, **_kwargs):
        """Force execution on every queued run, including cached workflows."""
        return float("nan")

    RETURN_TYPES = ()
    FUNCTION = "notify"
    OUTPUT_NODE = True
    CATEGORY = "Inteliweb/Utils"

    @staticmethod
    def notify(anything, enabled=True, sound=DEFAULT_SOUND):
        del anything
        return {
            "ui": {
                "inteliweb_sound_notify": [
                    {
                        "enabled": bool(enabled),
                        "sound": str(sound),
                    }
                ]
            }
        }


try:
    from aiohttp import web
    from server import PromptServer

    @PromptServer.instance.routes.get("/inteliweb/api/sound")
    async def inteliweb_sound_asset(request):
        """Serve one allow-listed sound from the package assets directory."""
        sound_path = _sound_path(request.query.get("name"))
        if sound_path is None:
            return web.Response(status=404, text="Sound not found")
        return web.FileResponse(
            sound_path,
            headers={"Cache-Control": "public, max-age=3600"},
        )
except Exception as exc:
    LOGGER.debug("Sound notification route was not registered: %s", exc)
