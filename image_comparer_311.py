"""
Image Comparer 311 — Batch-aware side-by-side image comparison.

Like rgthree Image Comparer (left/right slide), but shows every paired
image_top[i] / image_bottom[i] at once in a Preview-style grid instead of
picking a single pair from the batch.

image_top is the new image overlaid on image_bottom (the base).

Preview files go to temp (normal Comfy preview path). A flat copy is also
written to the standard output/ folder (no special subfolder) so the
frontend can restore the last run after a Comfy reload.

Part of the 311 Tool Suite (V3 API).
"""

import os
import random

import folder_paths
from comfy_api.latest import io, ui


def _save_batch(images, prefix: str, cls: type[io.ComfyNode]):
    """Save to temp (session) and output (reload). Return (temp_refs, output_refs)."""
    if images is None or len(images) == 0:
        return [], []
    rand = "".join(random.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(5))
    name = f"{prefix}_{rand}"

    os.makedirs(folder_paths.get_temp_directory(), exist_ok=True)
    temp_refs = ui.ImageSaveHelper.save_images(
        images,
        filename_prefix=f"{name}_",
        folder_type=io.FolderType.temp,
        cls=cls,
        compress_level=1,
    )

    os.makedirs(folder_paths.get_output_directory(), exist_ok=True)
    output_refs = ui.ImageSaveHelper.save_images(
        images,
        filename_prefix=name,
        folder_type=io.FolderType.output,
        cls=cls,
        compress_level=4,
    )
    return temp_refs, output_refs


class ImageComparer311(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ImageComparer311",
            display_name="Image Comparer 311",
            category="311 Tool Suite",
            description=(
                "Compare two image batches with Slide / Click wipe. "
                "image_top is the overlay on image_bottom (base). "
                "With Overlay on, a 9-dot handle drags image_top to other nodes. "
                "Length-1 inputs broadcast. "
                "Previews use temp; a copy in output/ restores the grid after Comfy reload."
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
        top_temp, top_out = _save_batch(image_top, "Comparer311_top", cls)
        bot_temp, bot_out = _save_batch(image_bottom, "Comparer311_bot", cls)
        return io.NodeOutput(
            ui={
                "top_images": top_temp,
                "bottom_images": bot_temp,
                "top_images_persist": top_out,
                "bottom_images_persist": bot_out,
            }
        )
