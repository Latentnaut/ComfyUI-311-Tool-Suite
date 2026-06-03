"""
SAM3 Images 311 — All-in-one SAM3 segmentation node with per-frame detection,
visual preview, and arithmetic mask operations (e.g. "1+2-3").

Uses the SAM3 Detect engine (per-frame open-vocabulary detection + SAM decoder
refinement) for maximum precision on every frame independently.

Part of the 311 Tool Suite (V3 API).
"""

import os
import re
import uuid

import random

import numpy as np
import torch
import torch.nn.functional as F
import av
from fractions import Fraction
from PIL import Image as PILImage

import comfy.model_management
import comfy.utils
import folder_paths
from comfy_api.latest import io, ui


# ─── Mask Expression Parser ───────────────────────────────────

def parse_mask_expression(expression, n_objects):
    """Parse an object_indices expression into sequential mask operations.

    Supports:
        ""          → all objects (add all)
        "1"         → only object 1
        "1+2"       → add mask[1] OR mask[2]
        "1+2-3"     → (mask[1] OR mask[2]) AND NOT mask[3]
        "0 + 3 - 2" → with spaces

    Returns:
        list of (op, index) tuples where op is "add" or "sub"
    """
    expr = expression.strip()
    if not expr:
        return [("add", i) for i in range(n_objects)]

    # Tokenize: find signed integers (e.g. +2, -3, or leading 1)
    tokens = re.findall(r'[+-]?\s*\d+', expr.replace(" ", ""))
    ops = []
    for token in tokens:
        token = token.strip()
        if token.startswith('-'):
            ops.append(("sub", int(token[1:])))
        elif token.startswith('+'):
            ops.append(("add", int(token[1:])))
        else:
            ops.append(("add", int(token)))
    return ops


# ─── Helper: extract text prompts from conditioning ───────────

def _extract_text_prompts(conditioning, device, dtype):
    """Extract list of (text_embeddings, text_mask, max_detections) from conditioning."""
    cond_meta = conditioning[0][1]
    multi = cond_meta.get("sam3_multi_cond")
    prompts = []
    if multi is not None:
        for entry in multi:
            emb = entry["cond"].to(device=device, dtype=dtype)
            mask = entry["attention_mask"].to(device) if entry["attention_mask"] is not None else None
            if mask is None:
                mask = torch.ones(emb.shape[0], emb.shape[1], dtype=torch.int64, device=device)
            prompts.append((emb, mask, entry.get("max_detections", 1)))
    else:
        emb = conditioning[0][0].to(device=device, dtype=dtype)
        mask = cond_meta.get("attention_mask")
        if mask is not None:
            mask = mask.to(device)
        else:
            mask = torch.ones(emb.shape[0], emb.shape[1], dtype=torch.int64, device=device)
        prompts.append((emb, mask, 1))
    return prompts


# ─── Preview Colors & Font ────────────────────────────────────

PREVIEW_COLORS = [
    (0.12, 0.47, 0.71), (1.0, 0.5, 0.05), (0.17, 0.63, 0.17), (0.84, 0.15, 0.16),
    (0.58, 0.4, 0.74), (0.55, 0.34, 0.29), (0.89, 0.47, 0.76), (0.5, 0.5, 0.5),
    (0.74, 0.74, 0.13), (0.09, 0.75, 0.81), (0.94, 0.76, 0.06), (0.42, 0.68, 0.84),
]

_glyph_cache = {}


def _get_glyphs(device, scale=3):
    key = (device, scale)
    if key in _glyph_cache:
        return _glyph_cache[key]
    atlas = torch.tensor([
        [[1,1,1],[1,0,1],[1,0,1],[1,0,1],[1,1,1]],
        [[0,1,0],[1,1,0],[0,1,0],[0,1,0],[1,1,1]],
        [[1,1,1],[0,0,1],[1,1,1],[1,0,0],[1,1,1]],
        [[1,1,1],[0,0,1],[1,1,1],[0,0,1],[1,1,1]],
        [[1,0,1],[1,0,1],[1,1,1],[0,0,1],[0,0,1]],
        [[1,1,1],[1,0,0],[1,1,1],[0,0,1],[1,1,1]],
        [[1,1,1],[1,0,0],[1,1,1],[1,0,1],[1,1,1]],
        [[1,1,1],[0,0,1],[0,0,1],[0,0,1],[0,0,1]],
        [[1,1,1],[1,0,1],[1,1,1],[1,0,1],[1,1,1]],
        [[1,1,1],[1,0,1],[1,1,1],[0,0,1],[1,1,1]],
    ], dtype=torch.bool)
    glyphs, outlines = [], []
    for d in range(10):
        g = atlas[d].repeat_interleave(scale, 0).repeat_interleave(scale, 1)
        padded = F.pad(g.float().unsqueeze(0).unsqueeze(0), (1, 1, 1, 1))
        o = (F.max_pool2d(padded, 3, stride=1, padding=1)[0, 0] > 0)
        glyphs.append(g.to(device))
        outlines.append(o.to(device))
    gh, gw = glyphs[0].shape
    oh, ow = outlines[0].shape
    _glyph_cache[key] = (glyphs, outlines, gh, gw, oh, ow)
    return _glyph_cache[key]


def _draw_number_gpu(frame, number, cx, cy, color, scale=3):
    """Draw a number on a GPU tensor [H, W, 3] float 0-1 at (cx, cy) with outline."""
    H, W = frame.shape[:2]
    device = frame.device
    glyphs, outlines, gh, gw, oh, ow = _get_glyphs(device, scale)
    color_t = torch.tensor(color, device=device, dtype=frame.dtype)
    digs = [int(d) for d in str(number)]
    total_w = len(digs) * (gw + scale) - scale
    x0 = cx - total_w // 2
    y0 = cy - gh // 2
    for i, d in enumerate(digs):
        dx = x0 + i * (gw + scale)
        # Black outline
        oy0, ox0 = y0 - 1, dx - 1
        osy1, osx1 = max(0, -oy0), max(0, -ox0)
        osy2, osx2 = min(oh, H - oy0), min(ow, W - ox0)
        if osy2 > osy1 and osx2 > osx1:
            fy1, fx1 = oy0 + osy1, ox0 + osx1
            frame[fy1:fy1+(osy2-osy1), fx1:fx1+(osx2-osx1)][outlines[d][osy1:osy2, osx1:osx2]] = 0
        # Colored fill
        sy1, sx1 = max(0, -y0), max(0, -dx)
        sy2, sx2 = min(gh, H - y0), min(gw, W - dx)
        if sy2 > sy1 and sx2 > sx1:
            fy1, fx1 = y0 + sy1, dx + sx1
            frame[fy1:fy1+(sy2-sy1), fx1:fx1+(sx2-sx1)][glyphs[d][sy1:sy2, sx1:sx2]] = color_t


# Node Class

class SAM3Images311(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="SAM3Images311",
            display_name="SAM3 Images 311",
            category="311 Tool Suite",
            description=(
                "All-in-one SAM3 segmentation using the Detect engine for maximum "
                "precision. Detects objects per-frame via text prompts, refines masks "
                "with the SAM decoder, shows a color-coded preview, and outputs masks "
                "with arithmetic operations (e.g. '1+2-3')."
            ),
            search_aliases=["sam3", "segment anything", "detect", "mask", "segmentation"],
            inputs=[
                io.Image.Input("images", display_name="images",
                               tooltip="Image(s) to segment. Single image or batch."),
                io.Model.Input("model", display_name="model",
                               tooltip="SAM3 model loaded via SAM3 Load."),
                io.Conditioning.Input("conditioning", display_name="conditioning",
                                      tooltip="Text conditioning from CLIPTextEncode for detecting objects."),
                io.Float.Input("detection_threshold", display_name="detection_threshold",
                               default=0.5, min=0.0, max=1.0, step=0.01,
                               tooltip="Score threshold for text-prompted detection."),
                io.Int.Input("refine_iterations", display_name="refine_iterations", default=2, min=0, max=5,
                             tooltip="SAM decoder refinement passes (0 = use raw detector masks)."),
                io.Int.Input("max_objects", display_name="max_objects",
                             default=4, min=1, max=64,
                             tooltip="Maximum number of detected objects to keep per frame (highest confidence first)."),
                io.Float.Input("opacity", display_name="opacity",
                               default=0.5, min=0.0, max=1.0, step=0.05,
                               tooltip="Overlay opacity for the preview."),
                io.String.Input("object_indices", display_name="object_indices", default="",
                                tooltip=(
                                    "Mask arithmetic: '1' = object 1, '1+2' = add masks, "
                                    "'1+2-3' = add 1&2 then subtract 3. Empty = all objects."
                                )),
            ],
            outputs=[
                io.Mask.Output("masks", display_name="masks"),
            ],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, images, model, conditioning,
                detection_threshold=0.5, refine_iterations=2, max_objects=4,
                opacity=0.5, object_indices="") -> io.NodeOutput:

        from comfy_extras.nodes_sam3 import _refine_mask

        B, H, W, C = images.shape
        image_in = comfy.utils.common_upscale(
            images[..., :3].movedim(-1, 1), 1008, 1008, "bilinear", crop="disabled")

        # ── Load model ──
        comfy.model_management.load_model_gpu(model)
        device = comfy.model_management.get_torch_device()
        dtype = model.model.get_dtype()
        sam3_model = model.model.diffusion_model

        # ── Extract text prompts ──
        cond_list = _extract_text_prompts(conditioning, device, dtype)

        # ── Per-frame detection (SAM3 Detect engine) ──
        pbar = comfy.utils.ProgressBar(B)
        all_masks = []      # list of [N_obj_b, H, W] per frame
        all_scores = []     # list of score lists per frame

        for b in range(B):
            frame = image_in[b:b+1].to(device=device, dtype=dtype)

            frame_masks = []
            frame_scores = []

            # Text prompts → detector per prompt category
            for text_embeddings, text_mask, max_det in cond_list:
                results = sam3_model(
                    frame, text_embeddings=text_embeddings, text_mask=text_mask,
                    boxes=None, threshold=detection_threshold, orig_size=(H, W))

                pred_boxes = results["boxes"][0]
                scores = results["scores"][0]
                masks = results["masks"][0]

                probs = scores.sigmoid()
                keep = probs > detection_threshold
                kept_boxes = pred_boxes[keep].cpu()
                kept_scores = probs[keep].cpu()
                kept_masks = masks[keep]

                order = kept_scores.argsort(descending=True)[:min(max_det, max_objects)]
                kept_boxes = kept_boxes[order]
                kept_scores = kept_scores[order]
                kept_masks = kept_masks[order]

                for m, box, score in zip(kept_masks, kept_boxes, kept_scores):
                    refined = _refine_mask(
                        sam3_model, images[b], m, box, H, W, device, dtype, refine_iterations)
                    frame_masks.append(refined[0])  # [1, H, W] → [H, W] after [0]
                    frame_scores.append(float(score))

            if len(frame_masks) > 0:
                all_masks.append(torch.stack(frame_masks, dim=0))  # [N_obj_b, H, W]
            else:
                all_masks.append(torch.zeros(0, H, W, device=device))
            all_scores.append(frame_scores)
            pbar.update(1)

        # ── Pad to uniform N_obj across frames ──
        max_n_obj = max(m.shape[0] for m in all_masks) if all_masks else 0

        if max_n_obj > 0:
            padded_masks = []
            for m in all_masks:
                if m.shape[0] < max_n_obj:
                    pad = torch.zeros(max_n_obj - m.shape[0], H, W, device=m.device, dtype=m.dtype)
                    padded_masks.append(torch.cat([m, pad], dim=0))
                else:
                    padded_masks.append(m)
            # [B, N_obj, H, W] boolean
            packed = torch.stack(padded_masks, dim=0) > 0.5
            track_data = {
                "packed_masks": packed,
                "orig_size": (H, W),
                "scores": all_scores[0] if all_scores else []
            }
        else:
            packed = None
            track_data = {"packed_masks": None, "orig_size": (H, W), "scores": []}

        # ── Preview ──
        N_obj = packed.shape[1] if packed is not None else 0
        gpu = comfy.model_management.get_torch_device()

        if B == 1:
            preview_ui = cls._build_image_preview(images, packed, N_obj, gpu, opacity, track_data)
        else:
            preview_ui = cls._build_video_preview(
                images, packed, B, N_obj, H, W, gpu, opacity, 24.0, track_data)

        # ── Mask Arithmetic ──
        if packed is None:
            mask_out = torch.zeros(B, H, W, device=comfy.model_management.intermediate_device())
            return io.NodeOutput(mask_out, ui=preview_ui)

        operations = parse_mask_expression(object_indices, N_obj)

        if not operations:
            mask_out = torch.zeros(B, H, W, device=comfy.model_management.intermediate_device())
            return io.NodeOutput(mask_out, ui=preview_ui)

        add_indices = [idx for op, idx in operations if op == "add" and 0 <= idx < N_obj]
        sub_indices = [idx for op, idx in operations if op == "sub" and 0 <= idx < N_obj]

        if not add_indices:
            mask_out = torch.zeros(B, H, W, device=comfy.model_management.intermediate_device())
            return io.NodeOutput(mask_out, ui=preview_ui)

        # Build additive union
        union = packed[:, add_indices[0]].clone()
        for i in add_indices[1:]:
            union |= packed[:, i]

        # Subtract
        for i in sub_indices:
            union &= ~packed[:, i]

        # The masks are already at (H, W) from the detect engine
        mask_out = union.float()

        return io.NodeOutput(mask_out, ui=preview_ui)

    # ── Preview Helpers ─────────────────────────────────────

    @staticmethod
    def _render_overlay_frame(frame_gpu, masks_slice, N_obj, gpu, opacity, track_data):
        """Render color overlay + object labels on a single GPU frame.

        masks_slice: [1, N_obj, H, W] boolean tensor (already at full res).
        Returns modified frame_gpu.
        """
        H, W = frame_gpu.shape[:2]

        if N_obj <= 0:
            return frame_gpu

        colors_t = torch.tensor([PREVIEW_COLORS[i % len(PREVIEW_COLORS)] for i in range(N_obj)],
                                device=gpu, dtype=torch.float32)

        # masks_slice is [1, N_obj, H, W] bool — already at full resolution
        bool_masks = masks_slice[0].to(gpu)  # [N_obj, H, W]
        any_mask = bool_masks.any(dim=0)

        if any_mask.any():
            obj_idx_map = bool_masks.to(torch.uint8).argmax(dim=0)
            color_overlay = colors_t[obj_idx_map]
            mask_3d = any_mask.unsqueeze(-1)
            frame_gpu = torch.where(mask_3d, frame_gpu * (1 - opacity) + color_overlay * opacity, frame_gpu)

        # Draw object ID labels
        area = bool_masks.sum(dim=(-1, -2)).clamp_(min=1)
        grid_y = torch.arange(H, device=gpu).view(1, H, 1)
        grid_x = torch.arange(W, device=gpu).view(1, 1, W)
        cy = (bool_masks * grid_y).sum(dim=(-1, -2)) // area
        cx = (bool_masks * grid_x).sum(dim=(-1, -2)) // area
        has = area > 1
        scores = track_data.get("scores", [])
        label_scale = max(3, H // 240)
        size_caps = (area.float().sqrt() / 15).clamp_(min=1).long().tolist()

        for obj_idx in range(N_obj):
            if has[obj_idx]:
                _cx, _cy = int(cx[obj_idx]), int(cy[obj_idx])
                color = PREVIEW_COLORS[obj_idx % len(PREVIEW_COLORS)]
                obj_scale = min(label_scale, size_caps[obj_idx])
                score_scale = max(1, obj_scale * 2 // 3)
                _draw_number_gpu(frame_gpu, obj_idx, _cx, _cy, color, scale=obj_scale)
                if obj_idx < len(scores) and scores[obj_idx] < 1.0:
                    _draw_number_gpu(frame_gpu, int(scores[obj_idx] * 100),
                                     _cx, _cy + 5 * obj_scale + 3, color, scale=score_scale)
        return frame_gpu

    @classmethod
    def _build_image_preview(cls, images, packed, N_obj, gpu, opacity, track_data):
        """Single-image preview: render overlay → return PreviewImage with overlaid tensor."""
        frame_gpu = images[0].clone().to(gpu)

        if packed is not None and N_obj > 0:
            frame_gpu = cls._render_overlay_frame(frame_gpu, packed[0:1], N_obj, gpu, opacity, track_data)

        overlaid = frame_gpu.clamp_(0, 1).cpu().unsqueeze(0)
        return ui.PreviewImage(overlaid)

    @classmethod
    def _build_video_preview(cls, images, packed, N, N_obj, H, W, gpu, opacity, fps, track_data):
        """Multi-frame preview: render overlay per frame → encode MP4 → return PreviewVideo."""
        temp_dir = folder_paths.get_temp_directory()
        filename = f"sam3_311_preview_{uuid.uuid4().hex[:8]}.mp4"
        filepath = os.path.join(temp_dir, filename)

        with av.open(filepath, mode='w') as output:
            stream = output.add_stream('h264', rate=Fraction(round(fps * 1000), 1000))
            stream.width = W
            stream.height = H
            stream.pix_fmt = 'yuv420p'

            frame_cpu = torch.empty(H, W, 3, dtype=torch.uint8)
            frame_np = frame_cpu.numpy()

            for t in range(N):
                frame = images[t].clone() if t < images.shape[0] else torch.zeros(H, W, 3)

                if N_obj > 0:
                    frame_gpu = cls._render_overlay_frame(
                        frame.to(gpu), packed[t:t+1], N_obj, gpu, opacity, track_data)
                    frame_cpu.copy_(frame_gpu.clamp_(0, 1).mul_(255).byte())
                else:
                    frame_cpu.copy_(frame.clamp_(0, 1).mul_(255).byte())

                vframe = av.VideoFrame.from_ndarray(frame_np, format='rgb24')
                output.mux(stream.encode(vframe.reformat(format='yuv420p')))
            output.mux(stream.encode(None))

        return ui.PreviewVideo([ui.SavedResult(filename, "", io.FolderType.temp)])
