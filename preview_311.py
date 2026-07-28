"""
Preview 311 — Draggable Preview Image node.
Like ComfyUI's core Preview Image, but the preview images can be dragged
and dropped onto other nodes (e.g. Load Image) to reuse the output.

Part of the 311 Tool Suite (V3 API).
"""

import os

import folder_paths
from comfy_api.latest import io, ui


class Preview311(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="Preview311",
            display_name="Preview 311",
            category="311 Tool Suite",
            description=(
                "Draggable image preview. Works like Preview Image but allows "
                "drag-and-drop of the previewed image onto other nodes (e.g. Load Image)."
            ),
            search_aliases=[
                "preview", "preview image", "draggable preview",
                "show image", "view image", "display image",
            ],
            inputs=[
                io.Image.Input(
                    "images",
                    display_name="images",
                    tooltip="The images to preview.",
                ),
            ],
            outputs=[],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, images) -> io.NodeOutput:
        # Multiple ComfyUI instances share the same temp dir; any instance
        # start/stop can rmtree it via cleanup_temp(). Recreate before save.
        os.makedirs(folder_paths.get_temp_directory(), exist_ok=True)
        return io.NodeOutput(ui=ui.PreviewImage(images))
