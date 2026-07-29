/**
 * Preview 311 — Drag-out + context menu.
 *
 * Native LiteGraph image strip (ui.PreviewImage). This extension adds:
 *   1. Drag-out onto Load Image / MultiImageLoader / image combo widgets
 *   2. Right-click "Send to input folder"
 *
 * Shared protocol: js/image_drag_out_311.js (CDS §2.13).
 * Preview311 is drag-out only — never a drop target.
 *
 * Drag affordance: CDS 9-dot grip (bottom-right of hovered / focused image).
 * Press on the grip only — the rest of the strip keeps native select / pan.
 */

import { app } from "../../scripts/app.js";
import {
  beginDragOut,
  sendToInputFolder,
  viewURL,
  isReadyBitmap,
  resolvePreviewImageIndex,
  getPreviewDragHandleRect,
  hitPreviewDragHandle,
  drawDragHandle,
} from "./image_drag_out_311.js";

function imageAreaTop(node) {
  return node.widgets?.length
    ? (node.widgets[node.widgets.length - 1].last_y ?? 30) + 20
    : 30;
}

function isInImageArea(node, localY) {
  if (!node._p311Images?.length) return false;
  return localY > imageAreaTop(node);
}

/** Update focused-image rect so the handle sits on the visible bitmap. */
function updateFocusRect(node) {
  node._p311FocusRect = null;
  if (typeof node.imageIndex !== "number" || node.imageIndex < 0) return;
  const img = node.imgs?.[node.imageIndex];
  if (!isReadyBitmap(img)) return;

  const top = imageAreaTop(node);
  const availW = node.size[0];
  const availH = Math.max(0, node.size[1] - top);
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  if (!nw || !nh || availW <= 0 || availH <= 0) return;

  const scale = Math.min(availW / nw, availH / nh, 1);
  const w = nw * scale;
  const h = nh * scale;
  node._p311FocusRect = [(availW - w) / 2, top + (availH - h) / 2, w, h];
}

function unpinPreviewNodes() {
  for (const node of app.graph?._nodes || []) {
    if (node.type !== "Preview311") continue;
    if (node._p311WasPinned !== undefined) {
      if (!node.flags) node.flags = {};
      node.flags.pinned = node._p311WasPinned;
      delete node._p311WasPinned;
    }
  }
}

app.registerExtension({
  name: "ComfyUI-311-Tool-Suite.Preview311",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "Preview311") return;

    const origExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (output) {
      if (origExecuted) origExecuted.apply(this, arguments);
      if (output?.images?.length) {
        this._p311Images = output.images;
      }
    };

    // Only block node-move when pressing the drag grip.
    const origMouseDown = nodeType.prototype.onMouseDown;
    nodeType.prototype.onMouseDown = function (e, localPos) {
      const x =
        localPos?.[0] ??
        localPos?.x ??
        (e.canvasX !== undefined ? e.canvasX - this.pos[0] : e.offsetX);
      const y =
        localPos?.[1] ??
        localPos?.y ??
        (e.canvasY !== undefined ? e.canvasY - this.pos[1] : e.offsetY);
      updateFocusRect(this);
      if (hitPreviewDragHandle(this, x, y)) return true;
      if (origMouseDown) return origMouseDown.apply(this, arguments);
    };

    const origMouseMove = nodeType.prototype.onMouseMove;
    nodeType.prototype.onMouseMove = function (e, localPos) {
      const x =
        localPos?.[0] ??
        localPos?.x ??
        (e.canvasX !== undefined ? e.canvasX - this.pos[0] : e.offsetX);
      const y =
        localPos?.[1] ??
        localPos?.y ??
        (e.canvasY !== undefined ? e.canvasY - this.pos[1] : e.offsetY);
      updateFocusRect(this);
      const hot = hitPreviewDragHandle(this, x, y);
      if (this._p311HandleHot !== hot) {
        this._p311HandleHot = hot;
        app.graph?.setDirtyCanvas?.(true);
      }
      if (origMouseMove) return origMouseMove.apply(this, arguments);
    };

    const origGetExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
    nodeType.prototype.getExtraMenuOptions = function (_, options) {
      if (origGetExtraMenuOptions) origGetExtraMenuOptions.apply(this, arguments);

      if (this._p311Images?.length) {
        const node = this;
        options.unshift({
          content: "Send to input folder",
          callback: async () => {
            try {
              const idx = resolvePreviewImageIndex(node);
              const imgData = node._p311Images[idx];
              const result = await sendToInputFolder(imgData, "preview311");
              alert(`Image sent to input folder:\n${result.name}`);
            } catch (err) {
              console.error("[Preview 311]", err);
              alert("Failed to send image to input folder.");
            }
          },
        });
      }
    };

    // CDS §2.13 9-dot grip on hovered grid cell / focused image.
    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (origDraw) origDraw.apply(this, arguments);
      if (!this._p311Images?.length || !this.imgs?.length) return;

      updateFocusRect(this);

      // Grid: only while a cell is hovered. Focused: while pointer is over the node.
      const show =
        (this.imageIndex == null && typeof this.overIndex === "number") ||
        (typeof this.imageIndex === "number" && this._p311Hovering);
      if (!show) return;

      const rect = getPreviewDragHandleRect(this);
      if (!rect) return;
      drawDragHandle(ctx, rect.x, rect.y, { hot: !!this._p311HandleHot });
    };

    const origMouseEnter = nodeType.prototype.onMouseEnter;
    nodeType.prototype.onMouseEnter = function () {
      this._p311Hovering = true;
      if (origMouseEnter) return origMouseEnter.apply(this, arguments);
    };
    const origMouseLeave = nodeType.prototype.onMouseLeave;
    nodeType.prototype.onMouseLeave = function () {
      this._p311Hovering = false;
      this._p311HandleHot = false;
      if (origMouseLeave) return origMouseLeave.apply(this, arguments);
    };
  },

  async setup() {
    const canvasEl = document.getElementById("graph-canvas");
    if (!canvasEl) return;

    // Capture pointerdown only on the grip — pin + begin session before LiteGraph moves.
    canvasEl.addEventListener(
      "pointerdown",
      (e) => {
        if (e.button !== 0) return;
        const gc = app.canvas;
        if (!gc?.graph) return;

        const pos = gc.convertEventToCanvasOffset(e);
        const node = gc.graph.getNodeOnPos(pos[0], pos[1], app.graph._nodes);
        if (!node || node.type !== "Preview311") return;
        if (!node._p311Images?.length) return;

        const localX = pos[0] - node.pos[0];
        const localY = pos[1] - node.pos[1];
        if (!isInImageArea(node, localY)) return;

        updateFocusRect(node);
        if (!hitPreviewDragHandle(node, localX, localY)) return;

        const idx = resolvePreviewImageIndex(node);
        const imgData = node._p311Images[idx];
        if (!imgData) return;

        if (!node.flags) node.flags = {};
        node._p311WasPinned = !!node.flags.pinned;
        node.flags.pinned = true;

        // Snapshot the selected / hovered bitmap only — never fall back to imgs[0].
        const ghostSource = isReadyBitmap(node.imgs?.[idx]) ? node.imgs[idx] : null;

        beginDragOut({
          sourceNode: node,
          imgData,
          clientX: e.clientX,
          clientY: e.clientY,
          ghostSource,
          namePrefix: "preview311",
          unpin: unpinPreviewNodes,
        });

        e.stopPropagation();
      },
      true
    );
  },
});

// Re-export viewURL for any legacy callers in this package.
export { viewURL };
