"""Browser-safe Photopea bridge for ComfyUI.

The Pinokio embedded browser can redirect or block third-party iframes. This
bridge avoids embedding Photopea: the editor opens in the user's normal browser,
loads the source image from a short-lived local session, and sends the edited PNG
back to ComfyUI through Photopea's documented server API.
"""

from __future__ import annotations

import json
import logging
import mimetypes
import time
import uuid
from pathlib import Path
from typing import Any

LOGGER = logging.getLogger(__name__)
SESSION_TTL_SECONDS = 2 * 60 * 60
MAX_SOURCE_BYTES = 100 * 1024 * 1024
MAX_SAVE_BYTES = 250 * 1024 * 1024
_SESSIONS: dict[str, dict[str, Any]] = {}


def _cors_headers() -> dict[str, str]:
    return {
        "Access-Control-Allow-Origin": "https://www.photopea.com",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Private-Network": "true",
        "Access-Control-Max-Age": "86400",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Cache-Control": "no-store",
    }


def _cleanup_sessions() -> None:
    cutoff = time.time() - SESSION_TTL_SECONDS
    stale = [token for token, session in _SESSIONS.items() if session["created_at"] < cutoff]
    for token in stale:
        _SESSIONS.pop(token, None)


def _safe_filename(value: str, fallback: str = "image.png") -> str:
    candidate = Path(value or fallback).name
    clean = "".join(ch for ch in candidate if ch.isalnum() or ch in "._- ").strip()
    return clean or fallback


def _extract_photopea_file(body: bytes) -> tuple[dict[str, Any], bytes, str]:
    if len(body) < 2000:
        raise ValueError("Photopea response is shorter than its 2000-byte metadata header")

    header_text = body[:2000].decode("utf-8", errors="replace").rstrip("\x00 \t\r\n")
    metadata = json.loads(header_text)
    versions = metadata.get("versions") or []
    if not versions:
        raise ValueError("Photopea response does not contain an exported version")

    version = next(
        (item for item in versions if str(item.get("format", "")).lower() == "png"),
        versions[0],
    )
    offset = 2000 + int(version.get("start", 0))
    size = int(version.get("size", 0))
    if size <= 0 or offset < 2000 or offset + size > len(body):
        raise ValueError("Photopea returned invalid file offsets")

    file_format = str(version.get("format") or "png").lower().split(":", 1)[0]
    return metadata, body[offset : offset + size], file_format


try:
    from aiohttp import web
    import folder_paths
    from server import PromptServer

    routes = PromptServer.instance.routes

    @routes.post("/inteliweb/photopea/session")
    async def create_photopea_session(request):
        _cleanup_sessions()

        reader = await request.multipart()
        field = await reader.next()
        if field is None or field.name != "image":
            return web.json_response({"error": "Missing image field"}, status=400)

        filename = _safe_filename(field.filename or "image.png")
        content_type = field.headers.get("Content-Type") or mimetypes.guess_type(filename)[0]
        content_type = content_type or "image/png"
        source = await field.read(decode=False)
        if not source:
            return web.json_response({"error": "The source image is empty"}, status=400)
        if len(source) > MAX_SOURCE_BYTES:
            return web.json_response({"error": "The source image is too large"}, status=413)

        token = uuid.uuid4().hex
        _SESSIONS[token] = {
            "created_at": time.time(),
            "source": source,
            "source_type": content_type,
            "source_filename": filename,
            "status": "waiting",
            "result_filename": "",
            "result_subfolder": "photopea",
            "error": "",
        }

        return web.json_response(
            {
                "token": token,
                "source_url": f"/inteliweb/photopea/source/{token}",
                "save_url": f"/inteliweb/photopea/save/{token}",
                "status_url": f"/inteliweb/photopea/status/{token}",
            }
        )

    @routes.options("/inteliweb/photopea/source/{token}")
    async def photopea_source_options(request):
        return web.Response(status=204, headers=_cors_headers())

    @routes.get("/inteliweb/photopea/source/{token}")
    async def get_photopea_source(request):
        _cleanup_sessions()
        session = _SESSIONS.get(request.match_info["token"])
        if not session:
            return web.Response(status=404, text="Photopea session expired", headers=_cors_headers())

        headers = _cors_headers()
        headers["Content-Disposition"] = (
            f'inline; filename="{_safe_filename(session["source_filename"])}"'
        )
        return web.Response(
            body=session["source"],
            content_type=session["source_type"],
            headers=headers,
        )

    @routes.options("/inteliweb/photopea/save/{token}")
    async def photopea_save_options(request):
        return web.Response(status=204, headers=_cors_headers())

    @routes.post("/inteliweb/photopea/save/{token}")
    async def save_photopea_result(request):
        _cleanup_sessions()
        token = request.match_info["token"]
        session = _SESSIONS.get(token)
        if not session:
            return web.json_response(
                {"message": "Photopea session expired"},
                status=404,
                headers=_cors_headers(),
            )

        try:
            body = await request.read()
            if len(body) > MAX_SAVE_BYTES:
                raise ValueError("The edited image is too large")

            metadata, exported, file_format = _extract_photopea_file(body)
            extension = "png" if file_format == "png" else file_format
            filename = _safe_filename(f"photopea-{int(time.time() * 1000)}.{extension}")
            output_directory = Path(folder_paths.get_input_directory()) / "photopea"
            output_directory.mkdir(parents=True, exist_ok=True)
            output_path = output_directory / filename
            output_path.write_bytes(exported)

            session.update(
                {
                    "status": "saved",
                    "result_filename": filename,
                    "result_subfolder": "photopea",
                    "source_metadata": metadata,
                    "error": "",
                }
            )
            LOGGER.info("[Inteliweb] Photopea image saved to %s", output_path)

            return web.json_response(
                {
                    "message": "Saved to ComfyUI",
                    "newSource": f"photopea/{filename}",
                },
                headers=_cors_headers(),
            )
        except Exception as exc:
            session.update({"status": "error", "error": str(exc)})
            LOGGER.exception("[Inteliweb] Photopea save failed")
            return web.json_response(
                {"message": f"Unable to save to ComfyUI: {exc}"},
                status=400,
                headers=_cors_headers(),
            )

    @routes.get("/inteliweb/photopea/status/{token}")
    async def get_photopea_status(request):
        _cleanup_sessions()
        session = _SESSIONS.get(request.match_info["token"])
        if not session:
            return web.json_response({"status": "expired"}, status=404)

        return web.json_response(
            {
                "status": session["status"],
                "filename": session["result_filename"],
                "subfolder": session["result_subfolder"],
                "error": session["error"],
            }
        )

except Exception as exc:
    LOGGER.debug("Photopea bridge routes were not registered: %s", exc)
