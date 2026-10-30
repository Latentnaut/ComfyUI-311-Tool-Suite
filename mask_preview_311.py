"""
Mask Preview 311 — Preview a MASK as a grayscale image.
Port of ComfyUI_essentials MaskPreview+ / core Preview Mask for the 311 Tool Suite (V3 API).
"""

import os

import folder_paths
from comfy_api.latest import io, ui


class MaskPreview311(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MaskPreview311",
            display_name="Mask Preview 311",
            category="311 Tool Suite",
            description="Preview a MASK as a grayscale image (temp, output node).",
            search_aliases=[
                "mask preview", "preview mask", "show mask", "view mask", "inspect mask",
            ],
            inputs=[
                io.Mask.Input(id="mask", display_name="mask"),
            ],
            outputs=[],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, mask) -> io.NodeOutput:
        # Multiple ComfyUI instances share the same temp dir; any instance
        # start/stop can rmtree it via cleanup_temp(). Recreate before save.
        os.makedirs(folder_paths.get_temp_directory(), exist_ok=True)
        return io.NodeOutput(ui=ui.PreviewMask(mask))
