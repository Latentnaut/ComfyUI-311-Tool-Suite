"""
Image Comparer 311 — Batch-aware side-by-side image comparison.

Like rgthree Image Comparer (left/right slide), but shows every paired
image_a[i] / image_b[i] at once in a Preview-style grid instead of
picking a single pair from the batch.

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
                "image_a[i] is overlaid on image_b[i] (length-1 inputs broadcast). "
                "Unlike rgthree Image Comparer, you do not pick a single batch index."
            ),
            search_aliases=[
                "image comparer", "compare", "slider", "before after",
                "diff", "side by side", "batch compare", "rgthree comparer",
            ],
            inputs=[
                io.Image.Input(
                    "image_a",
                    optional=True,
                    display_name="image_a",
                    tooltip="First image / batch (shown on the left of each pair).",
                ),
                io.Image.Input(
                    "image_b",
                    optional=True,
                    display_name="image_b",
                    tooltip="Second image / batch (revealed on the right of each pair).",
                ),
            ],
            outputs=[],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image_a=None, image_b=None) -> io.NodeOutput:
        a_images = _save_batch(image_a, "comparer311_a", cls)
        b_images = _save_batch(image_b, "comparer311_b", cls)
        return io.NodeOutput(ui={"a_images": a_images, "b_images": b_images})
