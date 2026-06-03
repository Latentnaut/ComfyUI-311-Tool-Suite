import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

/**
 * Preview 311 — Drag-and-drop extension.
 *
 * The node uses V3 API (ui.PreviewImage) and renders via native LiteGraph
 * canvas. This JS adds:
 *   1. Drag-and-drop: drag a previewed image onto a Load Image node.
 *   2. Right-click menu option "Send to input folder".
 *
 * DRAG MECHANISM (pure pointer events, no HTML5 drag API):
 *   pointerdown  → pin node (prevent LiteGraph move) + start upload
 *   pointermove  → detect drag threshold + show cursor feedback
 *   pointerup    → find target Load Image node under cursor → apply image
 */

// ── Active drag state (module-level singleton) ──
let _drag = null; // { sourceNode, uploadPromise, result, started }

function imgURL(d) {
  const p = new URLSearchParams();
  p.set("filename", d.filename);
  if (d.subfolder) p.set("subfolder", d.subfolder);
  p.set("type", d.type || "temp");
  return api.apiURL(`/view?${p}`);
}

async function uploadToInput(imgData) {
  const url = imgURL(imgData);
  const blob = await (await fetch(url)).blob();
  const ext = imgData.filename.split(".").pop() || "png";
  const fd = new FormData();
  fd.append("image", blob, `preview311_${Date.now()}.${ext}`);
  fd.append("type", "input");
  fd.append("overwrite", "true");
  const r = await api.fetchApi("/upload/image", { method: "POST", body: fd });
  if (!r.ok) throw new Error(`Upload failed: ${r.status}`);
  return r.json();
}

/** Check if a local Y coordinate is inside the image area (below widgets). */
function isInImageArea(node, localY) {
  if (!node._p311Images?.length) return false;
  const widgetBottom = node.widgets?.length
    ? (node.widgets[node.widgets.length - 1].last_y ?? 30) + 20
    : 30;
  return localY > widgetBottom;
}

/** Try to apply an uploaded image result to a target node's image widget. */
async function applyToTarget(target, result, dragSourceNode) {
  console.log("[Preview 311] Target node widgets:", target.widgets);

  // ── Special handling for MultiImageLoader custom node ──
  if (target.type === "MultiImageLoader" || target.comfyClass === "MultiImageLoader") {
    const el = target._milDomWidget?.element;
    if (el && typeof el._addFiles === "function") {
      console.log("[Preview 311] Found MultiImageLoader custom DOM element. Preparing file drop.");
      try {
        const fname = result.name;
        // Fetch the image from temp url to convert it back to a file object
        const url = imgURL(dragSourceNode._p311Images[dragSourceNode.imageIndex ?? 0]);
        console.log(`[Preview 311] Fetching dragged image from URL for MIL node: ${url}`);
        const resp = await fetch(url);
        const blob = await resp.blob();
        const file = new File([blob], fname, { type: blob.type || "image/png" });

        console.log("[Preview 311] File object constructed for MIL. Invoking _addFiles.");
        await el._addFiles([file]);
        return true;
      } catch (err) {
        console.error("[Preview 311] Error adding file to MultiImageLoader:", err);
        return false;
      }
    }
  }

  // ── Standard image or combo widget lookup ──
  const w =
    target.widgets?.find((w) => w.name === "image") ||
    target.widgets?.find(
      (w) =>
        w.type === "combo" &&
        w.options?.values?.some?.(
          (v) => typeof v === "string" && /\.(png|jpe?g|webp)$/i.test(v)
        )
    );

  if (!w) {
    // General fallback for any other widget containing image_list or images
    const listW = target.widgets?.find((w) => w.name === "image_list" || w.name === "images");
    if (listW) {
      console.log("[Preview 311] Found general image_list/images widget. Setting filename.");
      const fname = result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
      listW.value = fname;
      if (listW.element) {
        listW.element.value = fname;
        listW.element.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (listW.callback) listW.callback(fname);
      app.graph.setDirtyCanvas(true);
      return true;
    }

    console.warn("[Preview 311] No compatible image or combo widget found on target node:", target.type);
    return false;
  }

  const fname = result.subfolder
    ? `${result.subfolder}/${result.name}`
    : result.name;
  console.log(`[Preview 311] Found widget: name="${w.name}", type="${w.type}". Setting value to: "${fname}"`);

  if (Array.isArray(w.options?.values) && !w.options.values.includes(fname)) {
    console.log(`[Preview 311] Adding "${fname}" to combo values list.`);
    w.options.values.push(fname);
  }

  w.value = fname;

  if (w.element) {
    console.log("[Preview 311] Updating DOM widget element value.");
    w.element.value = fname;
    w.element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  if (w.callback) {
    console.log("[Preview 311] Invoking widget callback.");
    w.callback(fname);
  }
  
  app.graph.setDirtyCanvas(true);
  return true;
}

app.registerExtension({
  name: "ComfyUI-311-Tool-Suite.Preview311",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "Preview311") return;

    // ── After execution: store image metadata ──
    const origExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (output) {
      if (origExecuted) origExecuted.apply(this, arguments);
      if (output?.images?.length) {
        this._p311Images = output.images;
      }
    };

    // ── Prevent node move when clicking image area ──
    const origMouseDown = nodeType.prototype.onMouseDown;
    nodeType.prototype.onMouseDown = function (e, localPos) {
      const y =
        localPos?.[1] ??
        localPos?.y ??
        (e.canvasY !== undefined ? e.canvasY - this.pos[1] : e.offsetY);
      if (isInImageArea(this, y)) return true;
      if (origMouseDown) return origMouseDown.apply(this, arguments);
    };

    // ── Add "Send to input folder" to right-click menu ──
    const origGetExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
    nodeType.prototype.getExtraMenuOptions = function (_, options) {
      if (origGetExtraMenuOptions)
        origGetExtraMenuOptions.apply(this, arguments);

      if (this._p311Images?.length) {
        const node = this;
        options.unshift({
          content: "📋 Send to input folder",
          callback: async () => {
            try {
              const idx = node.imageIndex ?? 0;
              const imgData = node._p311Images[idx];
              const result = await uploadToInput(imgData);
              console.log(`[Preview 311] Uploaded: ${result.name}`);
              alert(`Image sent to input folder:\n${result.name}`);
            } catch (err) {
              console.error("[Preview 311]", err);
              alert("Failed to send image to input folder.");
            }
          },
        });
      }
    };

    // ── Draw drag-handle icon when hovering over image area ──
    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (origDraw) origDraw.apply(this, arguments);
      if (!this._p311Images?.length || !this.imgs?.length) return;
      if (!this._p311Hovering) return;

      const x = this.size[0] - 28;
      const imgH = this.imgs[0]?.height
        ? Math.min(this.imgs[0].height, this.size[1] - 40)
        : this.size[1] - 50;
      const y = this.size[1] - imgH + 8;

      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.beginPath();
      ctx.roundRect(x - 2, Math.max(y, 36), 24, 20, 4);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.font = "12px Inter, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("⇱", x + 10, Math.max(y, 36) + 10);
      ctx.restore();
    };

    // ── Track mouse hover ──
    const origMouseEnter = nodeType.prototype.onMouseEnter;
    nodeType.prototype.onMouseEnter = function () {
      this._p311Hovering = true;
      if (origMouseEnter) return origMouseEnter.apply(this, arguments);
    };
    const origMouseLeave = nodeType.prototype.onMouseLeave;
    nodeType.prototype.onMouseLeave = function () {
      this._p311Hovering = false;
      if (origMouseLeave) return origMouseLeave.apply(this, arguments);
    };
  },

  async setup() {
    const canvasEl = document.getElementById("graph-canvas");
    if (!canvasEl) return;

    // ================================================================
    // POINTER-DOWN (capture phase — fires BEFORE LiteGraph)
    // Pin the node + start the upload immediately.
    // ================================================================
    canvasEl.addEventListener(
      "pointerdown",
      (e) => {
        if (e.button !== 0) return; // left-click only
        const gc = app.canvas;
        if (!gc) return;

        const pos = gc.convertEventToCanvasOffset(e);
        const node = gc.graph.getNodeOnPos(
          pos[0],
          pos[1],
          app.graph._nodes
        );
        if (!node || node.type !== "Preview311") return;
        if (!node._p311Images?.length) return;

        const localY = pos[1] - node.pos[1];
        if (!isInImageArea(node, localY)) return;

        console.log("[Preview 311] Pointerdown in image area. Initializing drag.");

        // ── Pin the node so LiteGraph won't drag it ──
        if (!node.flags) node.flags = {};
        node._p311WasPinned = !!node.flags.pinned;
        node.flags.pinned = true;

        // ── Start the upload right away (it's local, usually <100ms) ──
        const imgData = node._p311Images[node.imageIndex ?? 0];
        if (!imgData) return;

        const imgUrl = imgURL(imgData);
        console.log(`[Preview 311] Drag image URL: ${imgUrl}`);
        const uploadPromise = uploadToInput(imgData);

        _drag = {
          sourceNode: node,
          startX: e.clientX,
          startY: e.clientY,
          imgUrl: imgUrl,
          uploadPromise,
          result: null, // filled when upload finishes
          started: false, // true once drag threshold exceeded
          dragEl: null // visual floating drag element
        };

        uploadPromise
          .then((res) => {
            console.log("[Preview 311] Upload to input finished successfully:", res.name);
            if (_drag) _drag.result = res;
          })
          .catch((err) => {
            console.error("[Preview 311] upload failed:", err);
          });

        // Prevent LiteGraph from processing this pointerdown
        e.stopPropagation();
      },
      true
    ); // capture phase

    // ================================================================
    // POINTER-MOVE — detect drag threshold + visual cursor feedback
    // ================================================================
    canvasEl.addEventListener(
      "pointermove",
      (e) => {
        if (!_drag) return;

        if (!_drag.started) {
          const dx = e.clientX - _drag.startX;
          const dy = e.clientY - _drag.startY;
          if (Math.abs(dx) + Math.abs(dy) > 6) {
            _drag.started = true;
            canvasEl.style.cursor = "grabbing";

            // Create a floating image for visual drag feedback
            const dragEl = document.createElement("img");
            dragEl.src = _drag.imgUrl;
            dragEl.style.position = "fixed";
            dragEl.style.width = "90px";
            dragEl.style.height = "90px";
            dragEl.style.objectFit = "contain";
            dragEl.style.opacity = "0.75";
            dragEl.style.pointerEvents = "none";
            dragEl.style.zIndex = "999999";
            dragEl.style.border = "2px dashed #00bfff";
            dragEl.style.borderRadius = "6px";
            dragEl.style.backgroundColor = "rgba(0, 0, 0, 0.4)";
            dragEl.style.boxShadow = "0 8px 16px rgba(0,0,0,0.5)";
            dragEl.style.transform = "scale(1)";
            document.body.appendChild(dragEl);
            _drag.dragEl = dragEl;

            console.log("[Preview 311] Visual drag thumbnail created.");
          }
        }

        if (_drag.started) {
          if (_drag.dragEl) {
            // Center the floating image under the mouse cursor
            _drag.dragEl.style.left = `${e.clientX - 45}px`;
            _drag.dragEl.style.top = `${e.clientY - 45}px`;
          }

          // Check if there is a MultiImageLoader node under the cursor
          const gc = app.canvas;
          if (gc) {
            const pos = gc.convertEventToCanvasOffset(e);
            const target = gc.graph.getNodeOnPos(
              pos[0],
              pos[1],
              app.graph._nodes
            );

            let newOverlay = null;
            if (target && (target.type === "MultiImageLoader" || target.comfyClass === "MultiImageLoader")) {
              newOverlay = target._milDomWidget?.element?.querySelector(".mil-drop-overlay");
            }

            // If we moved to a different overlay (or no overlay), hide the previous one
            if (_drag.hoveredOverlay && _drag.hoveredOverlay !== newOverlay) {
              _drag.hoveredOverlay.style.opacity = "0";
            }

            // If we are over a new overlay, show it
            if (newOverlay && _drag.hoveredOverlay !== newOverlay) {
              newOverlay.style.opacity = "1";
            }

            _drag.hoveredOverlay = newOverlay;
          }
        }
      },
      true
    );

    // ================================================================
    // POINTER-UP (capture phase) — find target node → apply image
    // ================================================================
    canvasEl.addEventListener(
      "pointerup",
      async (e) => {
        // Restore pinned state for ALL Preview311 nodes (safety)
        for (const node of app.graph._nodes) {
          if (node.type !== "Preview311") continue;
          if (node._p311WasPinned !== undefined) {
            node.flags.pinned = node._p311WasPinned;
            delete node._p311WasPinned;
          }
        }

        const drag = _drag;
        _drag = null;
        canvasEl.style.cursor = "";

        if (!drag) return;

        console.log("[Preview 311] Pointerup detected. Cleaning up drag.");

        // Remove the visual preview image element
        if (drag.dragEl) {
          drag.dragEl.remove();
          console.log("[Preview 311] Visual drag thumbnail removed.");
        }

        // Hide any highlighted drop overlay
        if (drag.hoveredOverlay) {
          drag.hoveredOverlay.style.opacity = "0";
          console.log("[Preview 311] Target drop overlay reset on drop.");
        }

        if (!drag.started) return;

        // Wait for the upload if it hasn't finished yet
        let result = drag.result;
        if (!result) {
          console.log("[Preview 311] Upload still in progress, waiting...");
          try {
            result = await drag.uploadPromise;
            console.log("[Preview 311] Awaited upload completed:", result.name);
          } catch (err) {
            console.error("[Preview 311] Drag ended but upload failed:", err);
            return;
          }
        }

        // Find the node under the cursor
        const gc = app.canvas;
        if (!gc) {
          console.error("[Preview 311] app.canvas is not defined");
          return;
        }
        const pos = gc.convertEventToCanvasOffset(e);
        console.log(`[Preview 311] Drop event canvas coordinates: [${pos[0]}, ${pos[1]}]`);

        const target = gc.graph.getNodeOnPos(
          pos[0],
          pos[1],
          app.graph._nodes
        );
        if (!target) {
          console.log("[Preview 311] No target node found under drop cursor.");
          return;
        }

        console.log(`[Preview 311] Target node under cursor: ID=${target.id}, Type="${target.type}"`);

        if (target === drag.sourceNode) {
          console.log("[Preview 311] Dropped back onto source node. Ignoring.");
          return;
        }

        if (await applyToTarget(target, result, drag.sourceNode)) {
          console.log(
            `[Preview 311] Successfully applied "${result.name}" → ${target.type} #${target.id}`
          );
        }
      },
      true
    );
  },
});
