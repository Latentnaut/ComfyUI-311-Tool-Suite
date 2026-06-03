"""
Image Batch 311 — Smart image batching with auto-resize.
Supports dynamic inputs via frontend JS (dynamic_inputs_311.js).
Part of the 311 Tool Suite (V3 API).
"""

import torch
import comfy.utils
from comfy_api.latest import io


class ImageBatch311(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ImageBatch311",
            display_name="Image Batch 311",
            category="311 Tool Suite",
            description="Smart image batching: auto-resizes mismatched inputs and concatenates into a single batch.",
            inputs=[
                io.Image.Input(id="image1", optional=True, display_name="Image 1"),
                io.Image.Input(id="image2", optional=True, display_name="Image 2"),
            ],
            outputs=[
                io.Image.Output(id="image_out", display_name="IMAGE"),
            ],
            is_input_list=True,
            # Accept dynamic inputs added by JS frontend (image3, image4, ...)
            accept_all_inputs=True,
        )

    @classmethod
    def execute(cls, **kwargs):
        """
        With is_input_list=True, each kwarg value is a Python list of tensors —
        one tensor per upstream execution. This lets us handle both cases:
          - upstream runs ONCE  → list has one tensor [B, H, W, C]
          - upstream runs N times → list has N tensors, each [1,H,W,C] or [B,H,W,C]
        We flatten everything into a single ordered batch.
        """
        # Build sorted key list (image1 < image2 < image3 …)
        sorted_keys = sorted(
            kwargs.keys(),
            key=lambda k: (
                int(k.replace("image", ""))
                if k.startswith("image") and k.replace("image", "").isdigit()
                else 9999
            )
        )

        # Collect every tensor, in the declared slot order
        all_tensors = []
        for k in sorted_keys:
            if not k.startswith("image"):
                continue
            v_list = kwargs[k]  # list because is_input_list=True
            if v_list is None:
                continue
            if not isinstance(v_list, (list, tuple)):
                v_list = [v_list]  # safety fallback

            for v in v_list:
                if v is None:
                    continue
                if not isinstance(v, torch.Tensor):
                    continue
                # Ensure shape is [B, H, W, C]
                if v.ndim == 3:
                    v = v.unsqueeze(0)
                all_tensors.append(v)

        if not all_tensors:
            raise ValueError("ImageBatch311: At least one valid image is required.")

        # Use the first tensor's spatial dims as the reference
        ref = all_tensors[0]
        H, W, C = ref.shape[1], ref.shape[2], ref.shape[3]

        normalized = [ref]
        for t in all_tensors[1:]:
            # Resize if H/W differ
            if t.shape[1] != H or t.shape[2] != W:
                t = comfy.utils.common_upscale(
                    t.movedim(-1, 1), W, H, "lanczos", "center"
                ).movedim(1, -1)
            # Trim channels if they differ
            if t.shape[3] != C:
                min_C = min(C, t.shape[3])
                normalized = [n[:, :, :, :min_C] for n in normalized]
                t = t[:, :, :, :min_C]
                C = min_C
            normalized.append(t)

        result = torch.cat(normalized, dim=0)
        print(f"ImageBatch311: final batch = {result.shape[0]} images "
              f"({', '.join(str(t.shape[0]) for t in all_tensors)} from each input).")
        return io.NodeOutput(result)
