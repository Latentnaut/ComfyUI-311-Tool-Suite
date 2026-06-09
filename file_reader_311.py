"""
File Reader 311 — Read text files and display in a viewer with STRING output.
Supports .txt, .md, .json, .yaml, .py, .js, .html, .css, .xml, .log, and more.
Part of the 311 Tool Suite (V3 API).
"""

import os
import logging
from comfy_api.latest import io

logger = logging.getLogger("ComfyUI.FileReader311")


def read_file_safe(file_path):
    """Read a text file with encoding fallback.

    Returns:
        (content: str | None, error: str | None)
    """
    if not file_path or not file_path.strip():
        return None, "No file path specified"

    path = file_path.strip().strip('"').strip("'")

    if not os.path.isfile(path):
        return None, f"File not found: {path}"

    # Safety: limit to 10 MB
    try:
        size = os.path.getsize(path)
        if size > 10 * 1024 * 1024:
            return None, f"File too large: {size / 1024 / 1024:.1f} MB (max 10 MB)"
    except OSError as e:
        return None, f"Cannot access file: {e}"

    # Try multiple encodings
    for encoding in ("utf-8", "utf-8-sig", "latin-1"):
        try:
            with open(path, "r", encoding=encoding) as f:
                content = f.read()
            return content, None
        except UnicodeDecodeError:
            continue
        except Exception as e:
            return None, f"Read error: {e}"

    return None, "Could not decode file with any supported encoding"


class FileReader311(io.ComfyNode):
    """Reads a text file from disk and outputs its content as a string."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="FileReader311",
            display_name="File Reader 311",
            category="311 Tool Suite",
            description="Reads a text file from disk and outputs its content as a string.",
            inputs=[
                io.String.Input(id="file_path", default="", multiline=False, display_name="File Path"),
                # Hidden inputs managed by frontend JS — passed as regular optional inputs
                io.String.Input(id="_cached_content", default="", optional=True),
                io.String.Input(id="_cached_file_name", default="", optional=True),
                io.String.Input(id="_editor_content", default="", optional=True),
            ],
            outputs=[
                io.String.Output(id="content", display_name="content"),
            ],
            is_output_node=True,
        )

    @classmethod
    def fingerprint_inputs(cls, **kwargs):
        """Always re-execute (equivalent to IS_CHANGED returning NaN)."""
        return float("NaN")

    @classmethod
    def execute(cls, file_path="", _cached_content="", _cached_file_name="", _editor_content=""):
        # ── Tier 1: Read the actual file ──────────────────────
        content, error = read_file_safe(file_path)

        if content is not None:
            fname = os.path.basename(file_path.strip())
            _, ext = os.path.splitext(fname)
            logger.info(f"[FileReader311] ✓ Read: {fname} ({len(content):,} chars)")
            return io.NodeOutput(
                content,
                ui={
                    "text": [content],
                    "file_name": [fname],
                    "file_ext": [ext.lower()],
                    "status": ["live"],
                    "error": [""],
                },
            )

        # ── Tier 2: Editor content (user has edited) ──────────
        if _editor_content and _editor_content.strip():
            fname = _cached_file_name or "edited"
            _, ext = os.path.splitext(fname) if fname else ("", "")
            logger.info(f"[FileReader311] ✎ Using editor content ({len(_editor_content):,} chars)")
            return io.NodeOutput(
                _editor_content,
                ui={
                    "text": [_editor_content],
                    "file_name": [fname],
                    "file_ext": [ext.lower()],
                    "status": ["edited"],
                    "error": [error or ""],
                },
            )

        # ── Tier 3: Cached copy ───────────────────────────────
        if _cached_content and _cached_content.strip():
            fname = _cached_file_name or "cached"
            _, ext = os.path.splitext(fname) if fname else ("", "")
            logger.info(f"[FileReader311] ⟳ Using cached content ({len(_cached_content):,} chars)")
            return io.NodeOutput(
                _cached_content,
                ui={
                    "text": [_cached_content],
                    "file_name": [fname],
                    "file_ext": [ext.lower()],
                    "status": ["cached"],
                    "error": [error or ""],
                },
            )

        # ── Nothing available ─────────────────────────────────
        msg = error or "No file path specified"
        logger.warning(f"[FileReader311] ✗ {msg}")
        return io.NodeOutput(
            "",
            ui={
                "text": [""],
                "file_name": [""],
                "file_ext": [""],
                "status": ["error"],
                "error": [msg],
            },
        )


# ─── Server Route (refresh without running workflow) ──────────
try:
    from server import PromptServer
    from aiohttp import web

    @PromptServer.instance.routes.get("/file_reader_311/read")
    async def _file_reader_311_api(request):
        path = request.query.get("path", "").strip()
        if not path:
            return web.json_response({"status": "error", "error": "No path provided"})

        content, error = read_file_safe(path)
        if content is not None:
            fname = os.path.basename(path)
            _, ext = os.path.splitext(fname)
            return web.json_response({
                "status": "live",
                "content": content,
                "file_name": fname,
                "file_ext": ext.lower(),
            })

        return web.json_response({"status": "error", "error": error})

    @PromptServer.instance.routes.post("/file_reader_311/save")
    async def _file_reader_311_save_api(request):
        try:
            data = await request.json()
            path = data.get("path", "").strip()
            content = data.get("content", "")

            if not path:
                return web.json_response({"status": "error", "error": "No path provided"})

            path = path.strip().strip('"').strip("'")

            if os.path.isdir(path):
                return web.json_response({"status": "error", "error": "Target path is a directory, not a file"})

            # Ensure the directory exists
            parent = os.path.dirname(path)
            if parent and not os.path.exists(parent):
                os.makedirs(parent, exist_ok=True)

            with open(path, "w", encoding="utf-8") as f:
                f.write(content)

            logger.info(f"[FileReader311] ✓ Saved: {path} ({len(content):,} chars)")
            return web.json_response({"status": "success"})

        except Exception as e:
            logger.error(f"[FileReader311] Save error: {e}")
            return web.json_response({"status": "error", "error": str(e)})

except Exception:
    logger.warning("[FileReader311] Could not register API route")
