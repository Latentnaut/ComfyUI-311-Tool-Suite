"""
Mask Fix 311 — Erode/dilate, fill holes, remove isolated pixels, smooth, blur.
Port of ComfyUI_essentials MaskFix+ for the 311 Tool Suite (V3 API).
"""

import torch
import torchvision.transforms.v2 as T
import scipy.ndimage
from comfy_api.latest import io


class MaskFix311(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MaskFix311",
            display_name="Mask Fix 311",
            category="311 Tool Suite",
            description=(
                "Morphological cleanup for masks: erode/dilate, fill holes, "
                "remove isolated pixels, smooth, and blur."
            ),
            search_aliases=["mask fix", "erode", "dilate", "fill holes", "mask cleanup"],
            inputs=[
                io.Mask.Input(id="mask", display_name="mask"),
                io.Int.Input(
                    id="erode_dilate",
                    default=0,
                    min=-256,
                    max=256,
                    step=1,
                    display_name="erode_dilate",
                ),
                io.Int.Input(
                    id="fill_holes",
                    default=0,
                    min=0,
                    max=128,
                    step=1,
                    display_name="fill_holes",
                ),
                io.Int.Input(
                    id="remove_isolated_pixels",
                    default=0,
                    min=0,
                    max=32,
                    step=1,
                    display_name="remove_isolated_pixels",
                ),
                io.Int.Input(
                    id="smooth",
                    default=0,
                    min=0,
                    max=256,
                    step=1,
                    display_name="smooth",
                ),
                io.Int.Input(
                    id="blur",
                    default=0,
                    min=0,
                    max=256,
                    step=1,
                    display_name="blur",
                ),
            ],
            outputs=[
                io.Mask.Output(id="mask_out", display_name="MASK"),
            ],
        )

    @classmethod
    def execute(
        cls,
        mask,
        erode_dilate=0,
        fill_holes=0,
        remove_isolated_pixels=0,
        smooth=0,
        blur=0,
    ):
        if mask.dim() == 2:
            mask = mask.unsqueeze(0)
        masks = []
        for m in mask:
            if erode_dilate != 0:
                if erode_dilate < 0:
                    m = torch.from_numpy(
                        scipy.ndimage.grey_erosion(
                            m.cpu().numpy(), size=(-erode_dilate, -erode_dilate)
                        )
                    )
                else:
                    m = torch.from_numpy(
                        scipy.ndimage.grey_dilation(
                            m.cpu().numpy(), size=(erode_dilate, erode_dilate)
                        )
                    )

            if fill_holes > 0:
                m = torch.from_numpy(
                    scipy.ndimage.grey_closing(
                        m.cpu().numpy(), size=(fill_holes, fill_holes)
                    )
                )

            if remove_isolated_pixels > 0:
                m = torch.from_numpy(
                    scipy.ndimage.grey_opening(
                        m.cpu().numpy(),
                        size=(remove_isolated_pixels, remove_isolated_pixels),
                    )
                )

            if smooth > 0:
                if smooth % 2 == 0:
                    smooth += 1
                m = T.functional.gaussian_blur((m > 0.5).unsqueeze(0), smooth).squeeze(0)

            if blur > 0:
                if blur % 2 == 0:
                    blur += 1
                m = T.functional.gaussian_blur(m.float().unsqueeze(0), blur).squeeze(0)

            masks.append(m.float().clamp(0.0, 1.0))

        return io.NodeOutput(torch.stack(masks, dim=0).float())
