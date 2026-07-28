"""
Preview Bridge 311 — Exact replica of Preview Bridge (Image) from comfyui-impact-pack.
Allows editing and sending a Mask over an image via Clipspace MaskEditor.

Part of the 311 Tool Suite (V3 API).
"""

import logging

from comfy_api.latest import io

logger = logging.getLogger("ComfyUI.PreviewBridge311")

_BRIDGE = None


def _get_bridge():
    """Lazily create the original PreviewBridge instance."""
    global _BRIDGE
    if _BRIDGE is None:
        try:
            from impact.bridge_nodes import PreviewBridge
            _BRIDGE = PreviewBridge()
        except ImportError:
            logger.error(
                "[PreviewBridge311] comfyui-impact-pack is not installed. "
                "This node requires it to function."
            )
            raise
    return _BRIDGE


class PreviewBridge311(io.ComfyNode):
    """Preview Bridge node — delegates to comfyui-impact-pack's PreviewBridge."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="PreviewBridge311",
            display_name="Preview Bridge 311",
            category="311 Tool Suite",
            description=(
                "This is a feature that allows you to edit and send a Mask over a image.\n"
                "If the block is set to 'is_empty_mask', the execution is stopped when "
                "the mask is empty."
            ),
            search_aliases=[
                "preview bridge", "clipspace", "mask editor", "mask bridge",
                "impact preview", "edit mask",
            ],
            inputs=[
                io.Image.Input(
                    "images",
                    display_name="images",
                    tooltip="The input image to preview and mask.",
                ),
                io.String.Input(
                    "image",
                    default="",
                    display_name="image",
                    tooltip="Internal preview-bridge image reference (managed by the frontend).",
                ),
                io.Boolean.Input(
                    "block",
                    default=False,
                    optional=True,
                    label_on="if_empty_mask",
                    label_off="never",
                    tooltip=(
                        "is_empty_mask: If the mask is empty, the execution is stopped.\n"
                        "never: The execution is never stopped."
                    ),
                ),
                io.Combo.Input(
                    "restore_mask",
                    options=["never", "always", "if_same_size"],
                    default="never",
                    optional=True,
                    tooltip=(
                        "if_same_size: If the changed input image is the same size as the "
                        "previous image, restore using the last saved mask\n"
                        "always: Whenever the input image changes, always restore using "
                        "the last saved mask\n"
                        "never: Do not restore the mask.\n"
                        "`restore_mask` has higher priority than `block`"
                    ),
                ),
            ],
            outputs=[
                io.Image.Output("image", display_name="IMAGE"),
                io.Mask.Output("mask", display_name="MASK"),
            ],
            hidden=[io.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, images, image="", block=False, restore_mask="never"):
        return io.NodeOutput.from_dict(
            _get_bridge().doit(
                images,
                image,
                cls.hidden.unique_id,
                block=block,
                restore_mask=restore_mask,
                prompt=cls.hidden.prompt,
                extra_pnginfo=cls.hidden.extra_pnginfo,
            )
        )
