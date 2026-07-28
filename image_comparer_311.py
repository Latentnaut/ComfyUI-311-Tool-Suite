"""
Image Comparer 311 — Batch-aware side-by-side image comparison.

Like rgthree Image Comparer (left/right slide), but shows every paired
image_top[i] / image_bottom[i] at once in a Preview-style grid instead of
picking a single pair from the batch.

image_top is the new image overlaid on image_bottom (the base).

Part of the 311 Tool Suite (V3 API).
"""

import os
import random

import folder_paths
from comfy_api.latest import io, ui


def _save_batch(images, prefix: str, cls: type[io.ComfyNode]):
    """Save a batch to temp and return the SavedResult list."""
    if images is None or len(images) == 0:
        return []
    os.makedirs(folder_paths.get_temp_directory(), exist_ok=True)
    rand = "".join(random.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(5))
    return ui.ImageSaveHelper.save_images(
        images,
        filename_prefix=f"{prefix}_{rand}_",
        folder_type=io.FolderType.temp,
        cls=cls,
        compress_level=1,
    )


class ImageComparer311(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ImageComparer311",
            display_name="Image Comparer 311",
            category="311 Tool Suite",
            description=(
                "Compare two image batches with a left/right slider on every pair at once. "
                "image_top is the new image overlaid on image_bottom (base). "
                "Slide starts fully right (top only); drag left to reveal bottom. "
                "Click shows top, hold to reveal bottom. Length-1 inputs broadcast."
            ),
            search_aliases=[
                "image comparer", "compare", "slider", "before after",
                "diff", "side by side", "batch compare", "rgthree comparer",
                "top", "bottom",
            ],
            inputs=[
                io.Image.Input(
                    "image_top",
                    optional=True,
                    display_name="image_top",
                    tooltip="New / overlay image batch. Shown by default (slide fully right).",
                ),
                io.Image.Input(
                    "image_bottom",
                    optional=True,
                    display_name="image_bottom",
                    tooltip="Base image batch underneath. Revealed by sliding left or holding click.",
                ),
            ],
            outputs=[],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image_top=None, image_bottom=None) -> io.NodeOutput:
        top_images = _save_batch(image_top, "comparer311_top", cls)
        bottom_images = _save_batch(image_bottom, "comparer311_bot", cls)
        return io.NodeOutput(ui={"top_images": top_images, "bottom_images": bottom_images})
