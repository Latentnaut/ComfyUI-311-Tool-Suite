/**
 * Shared drag-out for 311 image nodes (Preview 311, Image Comparer 311).
 *
 * Drag FROM a source node TO a Load Image / MultiImageLoader / combo target.
 * Never a drop target: Preview311 and ImageComparer311 reject inbound drops.
 *
 * Pointer protocol (CDS):
 *   pointerdown → snapshot visible bitmap + start upload (local, usually fast)
 *   move > 6px  → floating canvas ghost (accent border; never <img> / broken chrome)
 *   pointerup   → apply upload result to node under cursor
 *
 * Document-level move/up only while a session is active (no permanent
 * capture listeners on the graph canvas from DOM widgets).
 *
 * Spec: docs/UI_DESIGN_SYSTEM.md §2.13 · docs/CDS/PERFORMANCE.md §9
 */

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const DRAG_THRESHOLD = 6;
const GHOST_SIZE = 90;

/** CDS §2.13 — shared 9-dot grip size (DOM button and canvas badge). */
export const DRAG_HANDLE_SIZE = 22;
const DRAG_HANDLE_PAD = 3;

/** Nodes that only drag out — never accept drops. */
export const DRAG_OUT_ONLY = new Set(["Preview311", "ImageComparer311"]);

let _session = null;
let _docBound = false;

/**
 * Which preview strip image is active.
 * ComfyUI: `imageIndex` null = grid; focused uses a number. Grid hover = `overIndex`.
 * Never coerce null → 0 with `??` — that always picks the first thumbnail.
 */
export function resolvePreviewImageIndex(node) {
  if (typeof node?.imageIndex === "number" && node.imageIndex >= 0) {
    return node.imageIndex;
  }
  if (typeof node?.overIndex === "number" && node.overIndex >= 0) {
    return node.overIndex;
  }
  return 0;
}

/** Inline SVG for the standard 9-dot drag grip (Comparer DOM + any future DOM hosts). */
export function dragHandleSvgHtml(displaySize = 12) {
  let dots = "";
  for (const y of [4, 8, 12]) {
    for (const x of [4, 8, 12]) {
      dots += `<circle cx="${x}" cy="${y}" r="1.15" fill="currentColor"/>`;
    }
  }
  return `<svg viewBox="0 0 16 16" width="${displaySize}" height="${displaySize}" aria-hidden="true">${dots}</svg>`;
}

/** DOM button matching Comparer / CDS §2.13 drag handle. */
export function makeDragHandleButton({
  title = "Drag image to another node",
  ariaLabel = "Drag image",
} = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ic311-drag-handle";
  btn.title = title;
  btn.setAttribute("aria-label", ariaLabel);
  btn.innerHTML = dragHandleSvgHtml(12);
  return btn;
}

/**
 * Node-local rect for the drag handle on a canvas Preview strip.
 * Grid mode: bottom-right of the cell containing localX, localY.
 * Focused mode: bottom-right of the single _p311FocusRect.
 */
export function getPreviewDragHandleRect(node, localX, localY) {
  const size = DRAG_HANDLE_SIZE;
  const pad = DRAG_HANDLE_PAD;

  // Grid mode (imageIndex is null/undefined)
  if (node.imageIndex == null) {
    if (typeof localX === "number" && typeof localY === "number" && Array.isArray(node.imageRects)) {
      for (let i = 0; i < node.imageRects.length; i++) {
        const r = node.imageRects[i];
        if (r && localX >= r[0] && localX <= r[0] + r[2] && localY >= r[1] && localY <= r[1] + r[3]) {
          return {
            x: r[0] + r[2] - size - pad,
            y: r[1] + r[3] - size - pad,
            w: size,
            h: size,
            index: i,
          };
        }
      }
    }
    // Fallback to overIndex if mouse move hasn't updated local coords yet
    if (typeof node.overIndex === "number" && Array.isArray(node.imageRects?.[node.overIndex])) {
      const [rx, ry, rw, rh] = node.imageRects[node.overIndex];
      return {
        x: rx + rw - size - pad,
        y: ry + rh - size - pad,
        w: size,
        h: size,
        index: node.overIndex,
      };
    }
    return null;
  }

  // Focused mode (imageIndex is a number)
  if (Array.isArray(node._p311FocusRect)) {
    const [rx, ry, rw, rh] = node._p311FocusRect;
    return {
      x: rx + rw - size - pad,
      y: ry + rh - size - pad,
      w: size,
      h: size,
      index: node.imageIndex,
    };
  }

  return null;
}

export function hitPreviewDragHandle(node, localX, localY) {
  const r = getPreviewDragHandleRect(node, localX, localY);
  if (!r) return false;
  return localX >= r.x && localX <= r.x + r.w && localY >= r.y && localY <= r.y + r.h;
}

/** Canvas paint of the CDS 9-dot grip (Preview 311). */
export function drawDragHandle(ctx, x, y, { hot = false, size = DRAG_HANDLE_SIZE } = {}) {
  ctx.save();
  ctx.fillStyle = hot ? "rgba(0,0,0,0.75)" : "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, 4);
  ctx.fill();
  if (hot) {
    ctx.strokeStyle = "rgba(122,176,255,0.55)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = hot ? "var(--n311-accent, #7ab0ff)" : "#aaa";
  // canvas fillStyle does not resolve CSS vars — use literal accent
  if (hot) ctx.fillStyle = "#7ab0ff";
  const glyph = 12;
  const scale = glyph / 16;
  const ox = x + (size - glyph) / 2;
  const oy = y + (size - glyph) / 2;
  for (const py of [4, 8, 12]) {
    for (const px of [4, 8, 12]) {
      ctx.beginPath();
      ctx.arc(ox + px * scale, oy + py * scale, 1.15 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

export function viewURL(d) {
  if (!d?.filename) return "";
  // Match Image Selector / MIL: explicit encode (avoid URLSearchParams '+' for spaces).
  return api.apiURL(
    `/view?filename=${encodeURIComponent(d.filename)}` +
      `&type=${encodeURIComponent(d.type || "temp")}` +
      `&subfolder=${encodeURIComponent(d.subfolder || "")}`
  );
}

export async function uploadToInput(imgData, namePrefix = "img311") {
  const url = viewURL(imgData);
  const blob = await (await fetch(url)).blob();
  const ext = imgData.filename.split(".").pop() || "png";
  const fd = new FormData();
  fd.append("image", blob, `${namePrefix}_${Date.now()}.${ext}`);
  fd.append("type", "input");
  fd.append("overwrite", "true");
  const r = await api.fetchApi("/upload/image", { method: "POST", body: fd });
  if (!r.ok) throw new Error(`Upload failed: ${r.status}`);
  return r.json();
}

/** True when a CanvasImageSource has drawable pixels. */
export function isReadyBitmap(im) {
  if (!im) return false;
  const w = im.naturalWidth || im.videoWidth || im.width || 0;
  const h = im.naturalHeight || im.videoHeight || im.height || 0;
  return w > 0 && h > 0;
}

/** Draw source into size×size with object-fit:contain. Returns false if empty. */
function paintContain(ctx, source, size) {
  const sw = source.naturalWidth || source.videoWidth || source.width || 0;
  const sh = source.naturalHeight || source.videoHeight || source.height || 0;
  if (!sw || !sh) return false;
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, 0, size, size);
  const scale = Math.min(size / sw, size / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(source, (size - dw) / 2, (size - dh) / 2, dw, dh);
  return true;
}

/** CDS §2.9 mini unavailable — never browser broken-image chrome. */
function paintGhostUnavailable(ctx, size) {
  ctx.fillStyle = "#353535";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "#555";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(6, 6, size - 12, size - 12);
  ctx.setLineDash([]);
  ctx.fillStyle = "#666";
  ctx.font = "10px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Unavailable", size / 2, size / 2);
}

/**
 * Floating drag ghost (CDS §2.13). Always a <canvas> — never <img>, so a failed
 * /view never shows native broken-image chrome (§4.8). Prefer a decoded bitmap
 * already on screen ("snapshot the visible image").
 *
 * @param {CanvasImageSource|null} bitmap  HTMLImageElement / canvas already loaded
 * @param {string} [imgUrl]  fallback fetch if bitmap missing / not ready
 */
function createGhost(bitmap, imgUrl) {
  const el = document.createElement("canvas");
  el.width = GHOST_SIZE;
  el.height = GHOST_SIZE;
  el.style.cssText = [
    "position:fixed",
    `width:${GHOST_SIZE}px`,
    `height:${GHOST_SIZE}px`,
    "opacity:0.85",
    "pointer-events:none",
    "z-index:999999",
    "border:2px solid var(--n311-accent, #7ab0ff)",
    "border-radius:6px",
    "background:rgba(0,0,0,0.45)",
    "box-shadow:0 8px 16px rgba(0,0,0,0.45)",
    "transform:translate3d(0,0,0)",
  ].join(";");
  document.body.appendChild(el);

  const ctx = el.getContext("2d");
  if (bitmap && paintContain(ctx, bitmap, GHOST_SIZE)) return el;

  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, 0, GHOST_SIZE, GHOST_SIZE);

  if (!imgUrl) {
    paintGhostUnavailable(ctx, GHOST_SIZE);
    return el;
  }

  const img = new Image();
  img.onload = () => {
    if (!el.isConnected) return;
    paintContain(ctx, img, GHOST_SIZE);
  };
  img.onerror = () => {
    if (!el.isConnected) return;
    paintGhostUnavailable(ctx, GHOST_SIZE);
  };
  img.src = imgUrl;
  return el;
}

/** Repaint an existing ghost canvas (e.g. Click-mode image swap). */
function repaintGhost(el, bitmap, imgUrl) {
  if (!el?.getContext) return;
  const ctx = el.getContext("2d");
  if (bitmap && paintContain(ctx, bitmap, GHOST_SIZE)) return;
  if (!imgUrl) {
    paintGhostUnavailable(ctx, GHOST_SIZE);
    return;
  }
  const img = new Image();
  img.onload = () => {
    if (!el.isConnected) return;
    paintContain(ctx, img, GHOST_SIZE);
  };
  img.onerror = () => {
    if (!el.isConnected) return;
    paintGhostUnavailable(ctx, GHOST_SIZE);
  };
  img.src = imgUrl;
}

function placeGhost(el, clientX, clientY) {
  if (!el) return;
  const half = GHOST_SIZE / 2;
  el.style.left = `${clientX - half}px`;
  el.style.top = `${clientY - half}px`;
}

function hideMilOverlay(overlay) {
  if (overlay) overlay.style.opacity = "0";
}

function milOverlayAt(clientX, clientY) {
  const gc = app.canvas;
  if (!gc?.graph) return null;
  const pos = gc.convertEventToCanvasOffset({ clientX, clientY });
  const target = gc.graph.getNodeOnPos(pos[0], pos[1], app.graph._nodes);
  if (!target) return null;
  if (target.type !== "MultiImageLoader" && target.comfyClass !== "MultiImageLoader") {
    return null;
  }
  return target._milDomWidget?.element?.querySelector(".mil-drop-overlay") || null;
}

const LMP_NODE = "ComfyUI311LayerMaskPainter";

function isLmpNode(node) {
  const t = node?.type || node?.comfyClass;
  return t === LMP_NODE;
}

/** Top/Bottom droppable under the cursor (node slots or editor thumbs). */
function lmpDropElAt(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  if (!el?.closest) return null;
  return el.closest("[data-drop-layer]") || null;
}

function lmpLayerFromEl(el) {
  if (!el) return null;
  const layer = el.getAttribute?.("data-drop-layer") || el.dataset?.dropLayer;
  return layer === "top" || layer === "bottom" ? layer : null;
}

function setLmpDropHot(el, on) {
  if (!el) return;
  el.classList.toggle("lmp311-drop-hot", !!on);
}

function nodeAtEvent(e) {
  const gc = app.canvas;
  if (!gc?.graph) return null;
  const pos = gc.convertEventToCanvasOffset(e);
  return gc.graph.getNodeOnPos(pos[0], pos[1], app.graph._nodes);
}

export function isDropBlocked(target, sourceNode) {
  if (!target) return true;
  if (sourceNode && target === sourceNode) return true;
  const t = target.type || target.comfyClass;
  return DRAG_OUT_ONLY.has(t);
}

async function fileFromImgData(imgData, fallbackName = "drag.png") {
  const resp = await fetch(viewURL(imgData));
  const blob = await resp.blob();
  const name = imgData.filename || fallbackName;
  return new File([blob], name, { type: blob.type || "image/png" });
}

async function applyToLmp(target, sourceImgData, layer) {
  if (!isLmpNode(target) || typeof target._lmp311IngestLayer !== "function") return false;
  if (layer !== "top" && layer !== "bottom") return false;
  if (!sourceImgData?.filename) return false;
  try {
    const file = await fileFromImgData(sourceImgData, `comparer311_${layer}.png`);
    await target._lmp311IngestLayer(layer, file);
    return true;
  } catch {
    return false;
  }
}

/** Apply an uploaded input-folder image to a compatible target node. */
export async function applyUploadedImage(target, result, sourceImgData, dropMeta = null) {
  if (!target) return false;

  if (isLmpNode(target)) {
    const layer =
      dropMeta?.lmpLayer ||
      (target._lmp311PasteTarget === "top" || target._lmp311PasteTarget === "bottom"
        ? target._lmp311PasteTarget
        : null);
    if (layer !== "top" && layer !== "bottom") {
      alert("Drop onto the Top or Bottom slot of Layer Mask Painter.");
      return false;
    }
    return applyToLmp(target, sourceImgData, layer);
  }

  if (!result) return false;

  if (target.type === "MultiImageLoader" || target.comfyClass === "MultiImageLoader") {
    const el = target._milDomWidget?.element;
    if (!el || typeof el._addFiles !== "function" || !sourceImgData) return false;
    try {
      const resp = await fetch(viewURL(sourceImgData));
      const blob = await resp.blob();
      const file = new File([blob], result.name, { type: blob.type || "image/png" });
      await el._addFiles([file]);
      return true;
    } catch {
      return false;
    }
  }

  const w =
    target.widgets?.find((x) => x.name === "image") ||
    target.widgets?.find(
      (x) =>
        x.type === "combo" &&
        x.options?.values?.some?.(
          (v) => typeof v === "string" && /\.(png|jpe?g|webp)$/i.test(v)
        )
    );

  if (!w) {
    const listW = target.widgets?.find((x) => x.name === "image_list" || x.name === "images");
    if (!listW) return false;
    const fname = result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
    listW.value = fname;
    if (listW.element) {
      listW.element.value = fname;
      listW.element.dispatchEvent(new Event("change", { bubbles: true }));
    }
    listW.callback?.(fname);
    app.graph?.setDirtyCanvas?.(true);
    return true;
  }

  const fname = result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
  if (Array.isArray(w.options?.values) && !w.options.values.includes(fname)) {
    w.options.values.push(fname);
  }
  w.value = fname;
  if (w.element) {
    w.element.value = fname;
    w.element.dispatchEvent(new Event("change", { bubbles: true }));
  }
  w.callback?.(fname);
  app.graph?.setDirtyCanvas?.(true);
  return true;
}

function bindDocumentHandlers() {
  if (_docBound) return;
  _docBound = true;
  document.addEventListener("pointermove", onDocPointerMove, true);
  document.addEventListener("pointerup", onDocPointerUp, true);
  document.addEventListener("pointercancel", onDocPointerUp, true);
}

function unbindDocumentHandlers() {
  if (!_docBound) return;
  _docBound = false;
  document.removeEventListener("pointermove", onDocPointerMove, true);
  document.removeEventListener("pointerup", onDocPointerUp, true);
  document.removeEventListener("pointercancel", onDocPointerUp, true);
}

function onDocPointerMove(e) {
  const s = _session;
  if (!s) return;

  if (!s.started) {
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (Math.abs(dx) + Math.abs(dy) <= DRAG_THRESHOLD) return;
    s.started = true;
    s.ghost = createGhost(s.ghostSource, s.imgUrl);
    placeGhost(s.ghost, e.clientX, e.clientY);
    document.body.style.cursor = "grabbing";
    s.onDragStart?.();
  }

  if (!s.started) return;

  placeGhost(s.ghost, e.clientX, e.clientY);

  const overlay = milOverlayAt(e.clientX, e.clientY);
  if (s.hoveredOverlay && s.hoveredOverlay !== overlay) {
    hideMilOverlay(s.hoveredOverlay);
  }
  if (overlay && s.hoveredOverlay !== overlay) {
    overlay.style.opacity = "1";
  }
  s.hoveredOverlay = overlay;

  const lmpEl = lmpDropElAt(e.clientX, e.clientY);
  if (s.hoveredLmp && s.hoveredLmp !== lmpEl) {
    setLmpDropHot(s.hoveredLmp, false);
  }
  if (lmpEl && s.hoveredLmp !== lmpEl) {
    setLmpDropHot(lmpEl, true);
  }
  s.hoveredLmp = lmpEl;
}

async function onDocPointerUp(e) {
  const s = _session;
  _session = null;
  unbindDocumentHandlers();
  document.body.style.cursor = "";

  if (!s) return;

  const lmpLayer = lmpLayerFromEl(s.hoveredLmp) || lmpLayerFromEl(lmpDropElAt(e.clientX, e.clientY));

  s.ghost?.remove();
  hideMilOverlay(s.hoveredOverlay);
  setLmpDropHot(s.hoveredLmp, false);
  s.onDragEnd?.(s.started);

  // Restore pinned Preview nodes if the session pinned one.
  if (s.unpin) s.unpin();

  if (!s.started) return;

  const target = nodeAtEvent(e);
  if (isDropBlocked(target, s.sourceNode)) return;

  // Layer Mask Painter uses its own ingest (no input-folder round-trip required).
  if (isLmpNode(target)) {
    await applyUploadedImage(target, null, s.imgData, { lmpLayer });
    return;
  }

  let result = s.result;
  if (!result) {
    try {
      result = await s.uploadPromise;
    } catch {
      return;
    }
  }

  await applyUploadedImage(target, result, s.imgData);
}

/**
 * Begin a drag-out session. Safe to call from DOM cells or canvas capture.
 *
 * @param {object} opts
 * @param {object} opts.sourceNode
 * @param {object} opts.imgData  { filename, subfolder?, type? }
 * @param {number} opts.clientX
 * @param {number} opts.clientY
 * @param {CanvasImageSource} [opts.ghostSource]  decoded bitmap already on screen
 * @param {string} [opts.namePrefix]
 * @param {function} [opts.onDragStart]
 * @param {function} [opts.onDragEnd]  (started:boolean) => void
 * @param {function} [opts.unpin]     restore Preview pin flags
 * @returns {boolean} false if imgData missing
 */
export function beginDragOut(opts) {
  const { sourceNode, imgData, clientX, clientY } = opts;
  if (!imgData?.filename) return false;

  // Replace any stale session.
  if (_session) {
    _session.ghost?.remove();
    hideMilOverlay(_session.hoveredOverlay);
    setLmpDropHot(_session.hoveredLmp, false);
    _session.unpin?.();
    _session = null;
    unbindDocumentHandlers();
  }

  const uploadPromise = uploadToInput(imgData, opts.namePrefix || "img311");
  _session = {
    sourceNode,
    imgData,
    imgUrl: viewURL(imgData),
    ghostSource: opts.ghostSource || null,
    startX: clientX,
    startY: clientY,
    uploadPromise,
    result: null,
    started: false,
    ghost: null,
    hoveredOverlay: null,
    hoveredLmp: null,
    namePrefix: opts.namePrefix || "img311",
    onDragStart: opts.onDragStart,
    onDragEnd: opts.onDragEnd,
    unpin: opts.unpin,
  };

  uploadPromise
    .then((res) => {
      if (_session && _session.uploadPromise === uploadPromise) _session.result = res;
    })
    .catch(() => {});

  bindDocumentHandlers();
  return true;
}

/**
 * Swap the image mid-gesture (e.g. Click mode revealed bottom before threshold).
 * Restarts the input upload; updates the ghost if already visible.
 *
 * @param {object} imgData
 * @param {CanvasImageSource} [ghostSource]
 */
export function updateDragOutImage(imgData, ghostSource) {
  const s = _session;
  if (!s || !imgData?.filename) return false;
  if (
    s.imgData?.filename === imgData.filename &&
    s.imgData?.type === imgData.type &&
    ghostSource === undefined
  ) {
    return true;
  }
  s.imgData = imgData;
  s.imgUrl = viewURL(imgData);
  if (ghostSource !== undefined) s.ghostSource = ghostSource || null;
  if (s.ghost) repaintGhost(s.ghost, s.ghostSource, s.imgUrl);
  s.result = null;
  const uploadPromise = uploadToInput(imgData, s.namePrefix || "img311");
  s.uploadPromise = uploadPromise;
  uploadPromise
    .then((res) => {
      if (_session && _session.uploadPromise === uploadPromise) _session.result = res;
    })
    .catch(() => {});
  return true;
}

export function hasActiveDragOut() {
  return !!_session;
}

export function dragOutStarted() {
  return !!_session?.started;
}

/** Context-menu helper: upload current image to input and notify. */
export async function sendToInputFolder(imgData, namePrefix = "img311") {
  const result = await uploadToInput(imgData, namePrefix);
  return result;
}
