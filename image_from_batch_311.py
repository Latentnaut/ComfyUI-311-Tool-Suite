"""
Image From Batch 311 — Extract a slice from an image batch.
Port of ComfyUI_essentials ImageFromBatch+ for the 311 Tool Suite (V3 API).
"""

from comfy_api.latest import io


class ImageFromBatch311(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ImageFromBatch311",
            display_name="Image From Batch 311",
            category="311 Tool Suite",
            description="Extract a contiguous slice from an image batch (start + length).",
            inputs=[
                io.Image.Input(id="image", display_name="image"),
                io.Int.Input(
                    id="start",
                    default=0,
                    min=0,
                    step=1,
                    display_name="start",
                ),
                io.Int.Input(
                    id="length",
                    default=-1,
                    min=-1,
                    step=1,
                    display_name="length",
                ),
            ],
            outputs=[
                io.Image.Output(id="image_out", display_name="IMAGE"),
            ],
        )

    @classmethod
    def execute(cls, image, start=0, length=-1):
        if length < 0:
            length = image.shape[0]
        start = min(start, image.shape[0] - 1)
        length = min(image.shape[0] - start, length)
        return io.NodeOutput(image[start:start + length])
