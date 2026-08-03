/**
 * Image Comparer 311 — Frontend
 *
 * Batch-aware L/R image comparison grid.
 * Shows every image_top[i] / image_bottom[i] pair at once (Preview-style).
 *
 * Layering: bottom is the base; top is the overlay wipe from the left.
 * Slide: hover wipe. Click: hold for bottom.
 * Overlay on: 9-dot handle (bottom-right) arms drag-out of image_top.
 * Double-click a cell: fullscreen pair viewer (Slide/Click, arrows, Ctrl+C, Esc).
 *
 * Spec: docs/UI_DESIGN_SYSTEM.md (n311 tokens + DOM widget shell)
 */

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { beginDragOut, makeDragHandleButton } from "./image_drag_out_311.js";

const NODE_NAME = "ImageComparer311";
const STYLE_ID = "image-comparer-311-n311-style-v11";
const WIDGET_NAME = "ic311_ui";
const MIN_HEIGHT = 180;
const NODE_HEADER_H = 30;
const NODE_SLOT_H = 22;
const NODE_PADDING_V = 12;
const MIN_NODE_W = 360;
const MIN_NODE_H = 320;

/** Default wipe position: fully right = top only. */
const SLIDE_REST = 1;

/** Cap parallel /view fetches — bursts of 16+ hit browser/server races on fresh temp PNGs. */
const LOAD_CONCURRENCY = 4;
/**
 * Retry backoff. The first requests land while the server is still finishing the
 * workflow, so they can stall for seconds; short retries all fail inside that window.
 */
const LOAD_RETRY_DELAYS_MS = [0, 400, 1200, 3000, 8000];
const LOAD_TIMEOUT_MS = 30000;

let _loadActive = 0;
const _loadQueue = [];

function _pumpLoadQueue() {
  while (_loadActive < LOAD_CONCURRENCY && _loadQueue.length) {
    const job = _loadQueue.shift();
    _loadActive++;
    Promise.resolve()
      .then(job.fn)
      .then(job.resolve, job.reject)
      .finally(() => {
        _loadActive--;
        _pumpLoadQueue();
      });
  }
}

function enqueueLoad(fn) {
  return new Promise((resolve, reject) => {
    _loadQueue.push({ fn, resolve, reject });
    _pumpLoadQueue();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Plain PNG, no `preview=webp`: that makes the server re-encode through PIL on the
 * request thread, which is what stalls the first batch while a workflow is running.
 */
function imgURL(d) {
  if (!d?.filename) return "";
  const p = new URLSearchParams();
  p.set("filename", d.filename);
  if (d.subfolder) p.set("subfolder", d.subfolder);
  p.set("type", d.type || "temp");
  p.set("rand", String(Math.random()));
  return api.apiURL(`/view?${p}`);
}

function waitLoadOrError(img, timeoutMs = LOAD_TIMEOUT_MS) {
  return new Promise((resolve) => {
    if (img.complete && img.naturalWidth > 0) {
      resolve(true);
      return;
    }
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onError);
      resolve(ok);
    };
    const onLoad = () => finish(img.naturalWidth > 0);
    const onError = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);
    img.addEventListener("load", onLoad);
    img.addEventListener("error", onError);
  });
}

/** Load a temp image with backoff retries. Never leave browser broken-image chrome. */
async function assignImageSrc(img, data) {
  if (!img || !data?.filename) return false;
  img.alt = "";
  img.decoding = "async";

  for (const delayMs of LOAD_RETRY_DELAYS_MS) {
    if (delayMs) await sleep(delayMs);
    const ok = await enqueueLoad(async () => {
      img.src = imgURL(data);
      return waitLoadOrError(img);
    });
    if (ok) return true;
  }

  img.removeAttribute("src");
  console.warn("[Image Comparer 311] could not load", data.filename);
  return false;
}

function clearNodeImagePreview(node) {
  if (!node) return;
  node.imgs = null;
  node.images = null;
  node.imageIndex = null;
  node.overIndex = null;
  node.animatedImages = undefined;
}

function injectStyles() {
  document.getElementById("image-comparer-311-n311-style")?.remove();
  document.getElementById("image-comparer-311-n311-style-v2")?.remove();
  document.getElementById("image-comparer-311-n311-style-v3")?.remove();
  document.getElementById("image-comparer-311-n311-style-v4")?.remove();
  document.getElementById("image-comparer-311-n311-style-v5")?.remove();
  document.getElementById("image-comparer-311-n311-style-v6")?.remove();
  document.getElementById("image-comparer-311-n311-style-v7")?.remove();
  document.getElementById("image-comparer-311-n311-style-v8")?.remove();
  document.getElementById("image-comparer-311-n311-style-v9")?.remove();
  document.getElementById("image-comparer-311-n311-style-v10")?.remove();
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .ic311-root {
      width: 100%; height: 100%;
      display: flex; flex-direction: column;
      background: var(--n311-bg-node, #141414);
      border: 1px solid var(--n311-border-subtle, #2a2a2a);
      border-radius: 6px;
      overflow: hidden;
      position: relative;
      font-family: var(--n311-font, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      box-sizing: border-box;
    }
    .ic311-content {
      flex: 1; min-height: 0;
      overflow-y: auto;
      padding: 6px;
      scrollbar-width: thin;
      scrollbar-color: #606060 #252525;
    }
    .ic311-content::-webkit-scrollbar { width: 7px; }
    .ic311-content::-webkit-scrollbar-track { background: #252525; border-radius: 4px; }
    .ic311-content::-webkit-scrollbar-thumb {
      background: #606060; border-radius: 4px; border: 1px solid #252525;
    }
    .ic311-content::-webkit-scrollbar-thumb:hover { background: #888; }

    .ic311-grid {
      display: grid;
      gap: 6px;
      width: 100%;
    }
    .ic311-empty {
      color: var(--n311-text-dim, #888);
      font-size: 11px;
      padding: 16px 8px;
      text-align: center;
    }

    .ic311-cell {
      position: relative;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid transparent;
      background: transparent;
      cursor: ew-resize;
      user-select: none;
      opacity: 0;
      pointer-events: none;
      transform: translate3d(0, 0, 0);
      backface-visibility: hidden;
    }
    .ic311-cell.is-ready {
      opacity: 1;
      pointer-events: auto;
      border-color: var(--n311-border-strong, #444);
      background: var(--n311-bg-thumb, #353535);
    }
    .ic311-cell.is-ready:hover { border-color: var(--n311-accent-dim, #5a7abf); }
    .ic311-cell.is-unavailable {
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      min-height: 64px;
      aspect-ratio: 1;
    }
    .ic311-cell.is-unavailable:hover { border-color: var(--n311-accent-dim, #5a7abf); }
    .ic311-cell.is-unavailable .ic311-layer,
    .ic311-cell.is-unavailable .ic311-top-clip,
    .ic311-cell.is-unavailable .ic311-divider,
    .ic311-cell.is-top-missing .ic311-top-clip,
    .ic311-cell.is-top-missing .ic311-divider {
      display: none;
    }
    .ic311-unavailable-msg {
      color: var(--n311-text-dim, #888);
      font-size: 10px;
      text-align: center;
      line-height: 1.5;
      pointer-events: none;
    }
    .ic311-cell.is-loading .ic311-unavailable-msg { opacity: 0.6; }

    .ic311-layer {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: transparent;
      pointer-events: none;
      display: block;
      transform: translate3d(0, 0, 0);
      backface-visibility: hidden;
    }
    .ic311-top-clip {
      position: absolute;
      inset: 0 auto 0 0;
      width: 100%;
      overflow: hidden;
      pointer-events: none;
      will-change: width;
      transform: translate3d(0, 0, 0);
      backface-visibility: hidden;
    }
    .ic311-top-clip .ic311-layer {
      position: absolute;
      left: 0; top: 0;
      width: var(--ic311-full-w, 100%);
      height: 100%;
      max-width: none;
    }
    .ic311-divider {
      position: absolute;
      top: 0; bottom: 0;
      width: 0;
      left: 100%;
      border-left: 1px solid rgba(255,255,255,0.95);
      mix-blend-mode: difference;
      pointer-events: none;
      z-index: 2;
      will-change: left;
      transform: translate3d(0, 0, 0);
      backface-visibility: hidden;
    }
    .ic311-badge {
      position: absolute; top: 2px; left: 3px;
      background: rgba(0,0,0,0.55); color: #fff;
      font-size: 8px; font-weight: bold;
      padding: 1px 4px; border-radius: 2px;
      pointer-events: none; z-index: 3;
    }
    .ic311-view-label {
      position: absolute; top: 2px; right: 3px;
      background: rgba(0,0,0,0.55); color: #e0e0e0;
      font-size: 8px; font-weight: bold;
      padding: 1px 4px; border-radius: 2px;
      pointer-events: none; z-index: 3;
    }
    .ic311-root.ic311-hide-overlays .ic311-badge,
    .ic311-root.ic311-hide-overlays .ic311-view-label,
    .ic311-root.ic311-hide-overlays .ic311-drag-handle {
      display: none !important;
    }
    .ic311-drag-handle {
      appearance: none;
      position: absolute; right: 3px; bottom: 3px;
      width: 22px; height: 22px;
      display: none;
      align-items: center; justify-content: center;
      padding: 0; margin: 0;
      background: rgba(0,0,0,0.55);
      color: #aaa;
      border: 1px solid transparent;
      border-radius: 4px;
      cursor: pointer;
      z-index: 4;
      transition: color .15s, border-color .15s, background .15s;
    }
    .ic311-drag-handle svg { display: block; pointer-events: none; }
    .ic311-root:not(.ic311-hide-overlays) .ic311-cell.is-ready.has-top .ic311-drag-handle {
      display: flex;
    }
    .ic311-drag-handle:hover,
    .ic311-cell.is-drag-hot .ic311-drag-handle {
      color: var(--n311-accent, #7ab0ff);
      border-color: rgba(122,176,255,0.55);
      background: rgba(0,0,0,0.75);
      cursor: pointer;
    }
    .ic311-cell.is-ready.is-drag-hot {
      border-color: var(--n311-accent, #7ab0ff) !important;
      box-shadow: inset 0 0 0 1px rgba(122,176,255,0.35);
    }
    .ic311-cell.is-dragging {
      border-color: var(--n311-accent, #7ab0ff) !important;
      opacity: 0.92;
    }

    .ic311-actionbar {
      flex-shrink: 0;
      display: flex; align-items: center; gap: 8px;
      padding: 8px;
      background: var(--n311-bg-panel, #1e1e1e);
      border-top: 1px solid var(--n311-border, #333);
    }
    .ic311-spacer { flex: 1; min-width: 0; }
    .ic311-btn {
      appearance: none;
      background: var(--n311-bg-btn, #2a2a2a);
      color: var(--n311-text-muted, #aaa);
      border: 1px solid var(--n311-border-strong, #444);
      border-radius: 4px;
      padding: 6px 10px;
      font-family: inherit; font-size: 11px;
      cursor: pointer; flex-shrink: 0;
      transition: background .15s, border-color .15s;
    }
    .ic311-btn:hover { background: var(--n311-bg-btn-hover, #333); border-color: #666; }
    .ic311-btn.is-active {
      background: rgba(122,176,255,0.10);
      color: var(--n311-accent, #7ab0ff);
      border-color: var(--n311-accent-dim, #5a7abf);
    }
    .ic311-overlay-ctrl {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      flex-shrink: 0;
      user-select: none;
    }
    .ic311-overlay-label {
      font-size: 10px;
      color: var(--n311-text-dim, #888);
      letter-spacing: 0.02em;
    }
    .ic311-toggle {
      appearance: none;
      position: relative;
      width: 22px;
      height: 12px;
      padding: 0;
      border: none;
      border-radius: 999px;
      background: #333;
      cursor: pointer;
      flex-shrink: 0;
      transition: background .15s ease;
    }
    .ic311-toggle::after {
      content: "";
      position: absolute;
      top: 1px;
      left: 1px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #666;
      transition: transform .15s ease, background .15s ease;
    }
    .ic311-toggle.is-on {
      background: #3f3f3f;
    }
    .ic311-toggle.is-on::after {
      transform: translateX(10px);
      background: #999;
    }
    .ic311-toggle:hover {
      background: #3a3a3a;
    }
    .ic311-toggle.is-on:hover {
      background: #484848;
    }
    .ic311-cols {
      display: flex; align-items: center; gap: 4px; flex-shrink: 0;
    }
    .ic311-cols-label {
      font-size: 10px;
      color: var(--n311-text-dim, #888);
      letter-spacing: 0.02em;
      user-select: none;
    }
    .ic311-cols-spin {
      display: flex; align-items: stretch;
      height: 24px;
      border: 1px solid var(--n311-border-strong, #444);
      border-radius: 4px;
      overflow: hidden;
      background: var(--n311-bg-elev, #252525);
    }
    .ic311-cols-spin:hover { border-color: #666; }
    .ic311-cols-spin:focus-within {
      border-color: var(--n311-accent-dim, #5a7abf);
    }
    .ic311-cols-input {
      width: 28px;
      height: 100%;
      box-sizing: border-box;
      background: transparent;
      color: var(--n311-text-muted, #aaa);
      border: none;
      padding: 0 2px 0 6px;
      font-family: inherit;
      font-size: 11px;
      text-align: center;
      outline: none;
      -moz-appearance: textfield;
    }
    .ic311-cols-input:focus { color: var(--n311-text, #e0e0e0); }
    .ic311-cols-input::-webkit-inner-spin-button,
    .ic311-cols-input::-webkit-outer-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    .ic311-cols-arrows {
      display: flex; flex-direction: column;
      width: 14px;
      border-left: 1px solid var(--n311-border-subtle, #2a2a2a);
    }
    .ic311-cols-arrow {
      appearance: none;
      flex: 1;
      margin: 0; padding: 0;
      border: none;
      background: transparent;
      color: #444;
      font-size: 7px;
      line-height: 1;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
    }
    .ic311-cols-arrow:hover { color: #666; background: rgba(255,255,255,0.03); }

    .ic311-fs-backdrop {
      position: fixed; inset: 0;
      background: var(--n311-scrim, rgba(0,0,0,0.8));
      z-index: 99999;
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
      box-sizing: border-box;
      font-family: var(--n311-font, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
    }
    .ic311-fs-panel {
      width: clamp(700px, 90vw, 1920px);
      height: clamp(480px, 88vh, 1200px);
      max-width: 100%;
      max-height: 100%;
      background: var(--n311-bg-modal, #181818);
      border: 1px solid var(--n311-border, #333);
      border-radius: 12px;
      box-shadow: var(--n311-shadow-modal, 0 24px 80px rgba(0,0,0,0.8));
      display: flex; flex-direction: column;
      overflow: hidden;
      position: relative;
      box-sizing: border-box;
    }
    .ic311-fs-meta {
      position: absolute; top: 10px; left: 12px; z-index: 5;
      background: rgba(0,0,0,0.55); color: #e0e0e0;
      font-size: 12px; font-weight: bold;
      padding: 4px 8px; border-radius: 4px;
      border: 1px solid transparent;
      pointer-events: none;
      user-select: none;
    }
    @keyframes ic311-action-ok-flash {
      0%   { color: #44cc88; border-color: #44cc88; background: #1a3a28; }
      100% { color: #e0e0e0; border-color: transparent; background: rgba(0,0,0,0.55); }
    }
    .ic311-fs-meta.ic311-action-ok {
      animation: ic311-action-ok-flash 0.6s ease-out forwards;
    }
    .ic311-fs-stage {
      flex: 1; min-height: 0;
      position: relative;
      width: 100%;
      border: none;
      border-radius: 0;
      background: var(--n311-bg-deep, #111);
      opacity: 1;
      pointer-events: auto;
      cursor: ew-resize;
      user-select: none;
      overflow: hidden;
      transform: translate3d(0, 0, 0);
      backface-visibility: hidden;
    }
    .ic311-fs-stage .ic311-layer {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: transparent;
      pointer-events: none;
      display: block;
    }
    .ic311-fs-stage .ic311-top-clip {
      position: absolute;
      inset: 0 auto 0 0;
      width: 100%;
      overflow: hidden;
      pointer-events: none;
      will-change: width;
    }
    .ic311-fs-stage .ic311-top-clip .ic311-layer {
      position: absolute;
      left: 0; top: 0;
      width: var(--ic311-full-w, 100%);
      height: 100%;
      max-width: none;
    }
    .ic311-fs-stage .ic311-divider {
      position: absolute;
      top: 0; bottom: 0;
      width: 0;
      left: 100%;
      border-left: 1px solid rgba(255,255,255,0.95);
      mix-blend-mode: difference;
      pointer-events: none;
      z-index: 2;
      will-change: left;
    }
    .ic311-fs-stage .ic311-view-label {
      position: absolute; top: 10px; right: 12px;
      background: rgba(0,0,0,0.55); color: #e0e0e0;
      font-size: 12px; font-weight: bold;
      padding: 4px 8px; border-radius: 4px;
      pointer-events: none; z-index: 3;
    }
    .ic311-fs-stage.is-unavailable {
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: default;
    }
    .ic311-fs-stage.is-unavailable .ic311-layer,
    .ic311-fs-stage.is-unavailable .ic311-top-clip,
    .ic311-fs-stage.is-unavailable .ic311-divider,
    .ic311-fs-stage.is-top-missing .ic311-top-clip,
    .ic311-fs-stage.is-top-missing .ic311-divider {
      display: none;
    }
  `;
  document.head.appendChild(style);
}

/** Singleton fullscreen overlay state. */
let _fs = null;

function flashActionOk(el) {
  if (!el) return;
  el.classList.remove("ic311-action-ok");
  void el.offsetWidth;
  el.classList.add("ic311-action-ok");
  clearTimeout(el._okFlashTimer);
  el._okFlashTimer = setTimeout(() => el.classList.remove("ic311-action-ok"), 650);
}

function closeFullscreen() {
  if (!_fs) return;
  _fs.abort?.abort();
  _fs.stage?._ic311Abort?.abort();
  _fs.backdrop?.remove();
  _fs = null;
}

function visibleFsImage(stage) {
  if (!stage) return null;
  const ratio = stage._ic311Ratio ?? 1;
  const topImg = stage._ic311TopImg;
  const base = stage._ic311Base;
  if (ratio >= 0.5) {
    if (topImg?.naturalWidth > 0) return topImg;
    if (base?.naturalWidth > 0) return base;
  } else if (base?.naturalWidth > 0) {
    return base;
  } else if (topImg?.naturalWidth > 0) {
    return topImg;
  }
  return null;
}

async function copyImgToClipboard(img) {
  if (!img?.naturalWidth || !img.naturalHeight) return false;
  if (!navigator.clipboard?.write || !window.ClipboardItem) return false;
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d").drawImage(img, 0, 0);
  const png = await new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))), "image/png");
  });
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": Promise.resolve(png) }),
    ]);
    return true;
  } catch {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return true;
  }
}

async function copyFsVisible() {
  if (!_fs?.stage) return;
  const img = visibleFsImage(_fs.stage);
  if (!img) return;
  try {
    const ok = await copyImgToClipboard(img);
    if (ok) flashActionOk(_fs.meta);
  } catch (err) {
    console.warn("[Image Comparer 311] clipboard copy failed", err);
  }
}

function tryHydrateFromGrid(node, pair, base, topImg) {
  const cell = node?._ic311?.grid?.querySelector?.(`.ic311-cell[data-index="${pair.index}"]`);
  if (!cell?.classList?.contains("is-ready") || cell.classList.contains("is-unavailable")) {
    return false;
  }
  const gBase = cell._ic311Base;
  const gTop = cell._ic311TopImg;
  let ok = false;
  if (gBase?.src && gBase.naturalWidth > 0) {
    base.src = gBase.currentSrc || gBase.src;
    ok = true;
  }
  if (topImg && gTop?.src && gTop.naturalWidth > 0) {
    topImg.src = gTop.currentSrc || gTop.src;
    ok = true;
  }
  return ok && base.complete && base.naturalWidth > 0 && (!topImg || (topImg.complete && topImg.naturalWidth > 0));
}

function buildFsStage(pair) {
  const stage = document.createElement("div");
  stage.className = "ic311-fs-stage";
  stage._ic311Pair = pair;
  stage._ic311Ratio = 1;

  const hasTop = !!pair.top;
  const hasBottom = !!pair.bottom;

  const base = document.createElement("img");
  base.className = "ic311-layer";
  base.draggable = false;
  base.alt = "";
  stage.appendChild(base);

  let topImg = null;
  if (hasTop && hasBottom) {
    const clip = document.createElement("div");
    clip.className = "ic311-top-clip";
    topImg = document.createElement("img");
    topImg.className = "ic311-layer";
    topImg.draggable = false;
    topImg.alt = "";
    clip.appendChild(topImg);
    stage.appendChild(clip);

    const divider = document.createElement("div");
    divider.className = "ic311-divider";
    stage.appendChild(divider);
  } else {
    stage.style.cursor = "default";
  }

  const viewLabel = document.createElement("span");
  viewLabel.className = "ic311-view-label";
  viewLabel.textContent = hasTop ? "Top" : "Bot";
  stage.appendChild(viewLabel);

  stage._ic311Base = base;
  stage._ic311TopImg = topImg;
  return stage;
}

async function loadFsStage(stage, node) {
  const pair = stage._ic311Pair;
  const base = stage._ic311Base;
  const topImg = stage._ic311TopImg;
  stage.querySelector(".ic311-unavailable-msg")?.remove();
  stage.classList.remove("is-unavailable", "is-top-missing");

  let hydrated = tryHydrateFromGrid(node, pair, base, topImg);
  if (!hydrated) {
    const baseOk = await assignImageSrc(base, pair.bottom || pair.top);
    let topOk = false;
    if (topImg) topOk = await assignImageSrc(topImg, pair.top);
    stage.classList.toggle("is-top-missing", !!topImg && !topOk);
    if (!(baseOk || topOk)) {
      const msg = document.createElement("span");
      msg.className = "ic311-unavailable-msg";
      msg.textContent = "Unavailable";
      stage.appendChild(msg);
      stage.classList.add("is-unavailable");
      stage.style.cursor = "default";
      return;
    }
  } else if (topImg && !(topImg.naturalWidth > 0)) {
    stage.classList.add("is-top-missing");
  }

  bindCellMode(stage, normalizeMode(node?.properties?.ic311_mode));
  requestAnimationFrame(() => {
    if (_fs?.stage !== stage) return;
    stage._cachedRect = stage.getBoundingClientRect();
    syncClipWidth(stage);
  });
}

function showFsPair(index) {
  if (!_fs) return;
  const pairs = _fs.pairs;
  if (!pairs.length) {
    closeFullscreen();
    return;
  }
  const idx = ((index % pairs.length) + pairs.length) % pairs.length;
  _fs.index = idx;
  _fs.meta.textContent = `${idx + 1} / ${pairs.length}`;

  _fs.stage?._ic311Abort?.abort();
  const stage = buildFsStage(pairs[idx]);
  _fs.panel.replaceChildren(_fs.meta, stage);
  _fs.stage = stage;
  loadFsStage(stage, _fs.node);
}

function openFullscreen(node, index) {
  const pairs = buildPairs(node._ic311Top, node._ic311Bottom);
  if (!pairs.length) return;

  closeFullscreen();
  injectStyles();

  const backdrop = document.createElement("div");
  backdrop.className = "ic311-fs-backdrop";

  const panel = document.createElement("div");
  panel.className = "ic311-fs-panel";

  const meta = document.createElement("div");
  meta.className = "ic311-fs-meta";

  panel.appendChild(meta);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  const abort = new AbortController();
  const opts = { signal: abort.signal, capture: true };

  backdrop.addEventListener(
    "pointerdown",
    (ev) => {
      if (ev.target === backdrop) {
        ev.preventDefault();
        ev.stopPropagation();
        closeFullscreen();
      }
    },
    { signal: abort.signal }
  );
  panel.addEventListener(
    "pointerdown",
    (ev) => {
      ev.stopPropagation();
    },
    { signal: abort.signal }
  );

  document.addEventListener(
    "keydown",
    (ev) => {
      if (!_fs) return;
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        closeFullscreen();
        return;
      }
      if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        ev.stopPropagation();
        showFsPair(_fs.index - 1);
        return;
      }
      if (ev.key === "ArrowRight") {
        ev.preventDefault();
        ev.stopPropagation();
        showFsPair(_fs.index + 1);
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && (ev.key === "c" || ev.key === "C") && !ev.altKey && !ev.shiftKey) {
        ev.preventDefault();
        ev.stopPropagation();
        copyFsVisible();
      }
    },
    opts
  );

  _fs = { backdrop, panel, meta, stage: null, node, index: 0, pairs, abort };
  showFsPair(index);
}

function syncFullscreenForNode(node) {
  if (!_fs || _fs.node !== node) return;
  const pairs = buildPairs(node._ic311Top, node._ic311Bottom);
  if (!pairs.length) {
    closeFullscreen();
    return;
  }
  _fs.pairs = pairs;
  showFsPair(Math.min(_fs.index, pairs.length - 1));
}

/** Pair top[i] with bottom[i]; length-1 side broadcasts. */
function buildPairs(topImages, bottomImages) {
  const top = topImages || [];
  const bottom = bottomImages || [];
  if (!top.length && !bottom.length) return [];

  if (!top.length) {
    return bottom.map((img, i) => ({ index: i, top: null, bottom: img }));
  }
  if (!bottom.length) {
    return top.map((img, i) => ({ index: i, top: img, bottom: null }));
  }

  let count;
  if (top.length === 1) count = bottom.length;
  else if (bottom.length === 1) count = top.length;
  else count = Math.min(top.length, bottom.length);

  const pairs = [];
  for (let i = 0; i < count; i++) {
    pairs.push({
      index: i,
      top: top.length === 1 ? top[0] : top[i],
      bottom: bottom.length === 1 ? bottom[0] : bottom[i],
    });
  }
  return pairs;
}

/** ratio 1 = fully right (top only); ratio 0 = fully left (bottom only). */
function setClip(cell, ratio) {
  const r = Math.max(0, Math.min(1, ratio));
  cell._ic311Ratio = r;
  const clip = cell.querySelector(".ic311-top-clip");
  const divider = cell.querySelector(".ic311-divider");
  if (!clip) return;
  const pct = `${(r * 100).toFixed(2)}%`;
  clip.style.width = pct;
  if (divider) {
    divider.style.left = pct;
    divider.style.display = r <= 0.001 || r >= 0.999 ? "none" : "";
  }
  updateViewLabel(cell, r);
}

/** Drag/copy always use image_top (null if missing). */
function dragImageData(cell) {
  return cell._ic311Pair?.top || null;
}

function updateViewLabel(cell, ratio) {
  const label = cell.querySelector(".ic311-view-label");
  if (!label) return;
  // Dominating side: top when wipe covers >= half, else bottom.
  label.textContent = ratio >= 0.5 ? "Top" : "Bot";
}

function syncClipWidth(cell) {
  const clip = cell.querySelector(".ic311-top-clip");
  if (!clip) return;
  clip.style.setProperty("--ic311-full-w", `${cell.clientWidth}px`);
}

function pointerRatio(cell, clientX) {
  const rect = cell._cachedRect || (cell._cachedRect = cell.getBoundingClientRect());
  if (rect.width <= 0) return SLIDE_REST;
  return (clientX - rect.left) / rect.width;
}

function clampColumns(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 4;
  return Math.max(1, Math.min(16, v));
}

function normalizeMode(m) {
  return m === "Click" ? "Click" : "Slide";
}

function makeDragHandle() {
  return makeDragHandleButton({
    title: "Drag top image to another node",
    ariaLabel: "Drag top image",
  });
}

/** Bind Slide / Click without recreating <img> (avoids black flash). */
function bindCellMode(cell, mode) {
  cell._ic311Abort?.abort();
  const ac = new AbortController();
  cell._ic311Abort = ac;
  const opts = { signal: ac.signal };
  cell._ic311Down = false;
  cell._ic311Mode = mode;

  const hasWipe = !!cell.querySelector(".ic311-top-clip") && !cell.classList.contains("is-top-missing");
  if (!hasWipe) {
    cell.style.cursor = "default";
    return;
  }

  const updateRect = () => {
    cell._cachedRect = cell.getBoundingClientRect();
  };

  if (mode === "Click") {
    cell.style.cursor = "pointer";
    setClip(cell, 1);
    cell.addEventListener(
      "pointerdown",
      (ev) => {
        if (ev.button !== 0) return;
        if (ev.target?.closest?.(".ic311-drag-handle")) return;
        ev.preventDefault();
        ev.stopPropagation();
        cell._ic311Down = true;
        setClip(cell, 0);
      },
      opts
    );
    const release = () => {
      if (!cell._ic311Down) return;
      cell._ic311Down = false;
      setClip(cell, 1);
    };
    cell.addEventListener("pointerup", release, opts);
    cell.addEventListener("pointercancel", release, opts);
    cell.addEventListener("pointerleave", release, opts);
    return;
  }

  // Slide — hover wipe (no button required).
  cell.style.cursor = "ew-resize";
  setClip(cell, SLIDE_REST);

  let ticking = false;
  let lastClientX = 0;

  cell.addEventListener(
    "pointerenter",
    (ev) => {
      if (ev.target?.closest?.(".ic311-drag-handle")) return;
      updateRect();
      syncClipWidth(cell);
      lastClientX = ev.clientX;
      setClip(cell, pointerRatio(cell, lastClientX));
    },
    opts
  );
  cell.addEventListener(
    "pointermove",
    (ev) => {
      if (ev.target?.closest?.(".ic311-drag-handle")) return;
      lastClientX = ev.clientX;
      if (!ticking) {
        requestAnimationFrame(() => {
          if (cell._ic311Abort && !cell._ic311Abort.signal.aborted) {
            setClip(cell, pointerRatio(cell, lastClientX));
          }
          ticking = false;
        });
        ticking = true;
      }
    },
    opts
  );
  cell.addEventListener(
    "pointerleave",
    () => {
      setClip(cell, SLIDE_REST);
    },
    opts
  );
}

/** 9-dot handle: hover arms blue frame; press starts drag-out of image_top. */
function bindDragHandle(cell, node) {
  cell._ic311DragAbort?.abort();
  const handle = cell.querySelector(".ic311-drag-handle");
  if (!handle) return;

  const ac = new AbortController();
  cell._ic311DragAbort = ac;
  const opts = { signal: ac.signal };

  const setHot = (on) => {
    cell.classList.toggle("is-drag-hot", !!on);
  };

  handle.addEventListener(
    "pointerenter",
    () => {
      if (!dragImageData(cell)) return;
      setHot(true);
    },
    opts
  );
  handle.addEventListener(
    "pointerleave",
    () => {
      if (!cell.classList.contains("is-dragging")) setHot(false);
    },
    opts
  );
  handle.addEventListener(
    "pointerdown",
    (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (!cell.classList.contains("is-ready")) return;
      if (cell.classList.contains("is-unavailable")) return;

      const imgData = dragImageData(cell);
      if (!imgData) return;

      const topImg = cell.querySelector(".ic311-top-clip .ic311-layer");
      const baseImg = cell.querySelector(".ic311-layer");
      const ghostSource =
        (topImg?.naturalWidth > 0 && topImg) ||
        (baseImg?.naturalWidth > 0 && baseImg) ||
        null;

      setHot(true);
      beginDragOut({
        sourceNode: node,
        imgData,
        clientX: ev.clientX,
        clientY: ev.clientY,
        ghostSource,
        namePrefix: "comparer311",
        onDragStart: () => {
          cell.classList.add("is-dragging");
          setHot(true);
        },
        onDragEnd: () => {
          cell.classList.remove("is-dragging");
          setHot(false);
        },
      });
    },
    opts
  );
}

function applyMode(node) {
  const ui = node._ic311;
  if (!ui) return;
  const mode = normalizeMode(node.properties?.ic311_mode);
  node.properties.ic311_mode = mode;
  for (const cell of ui.grid.querySelectorAll(".ic311-cell")) {
    bindCellMode(cell, mode);
    bindDragHandle(cell, node);
  }
  if (_fs?.node === node && _fs.stage) {
    bindCellMode(_fs.stage, mode);
    syncClipWidth(_fs.stage);
  }
}

function applyColumns(node) {
  const ui = node._ic311;
  if (!ui) return;
  const cols = clampColumns(node.properties?.ic311_columns ?? 4);
  node.properties.ic311_columns = cols;
  if (ui.colsInput && String(ui.colsInput.value) !== String(cols)) {
    ui.colsInput.value = String(cols);
  }
  ui.grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  requestAnimationFrame(() => {
    for (const cell of ui.grid.querySelectorAll(".ic311-cell")) {
      syncClipWidth(cell);
    }
  });
}

function buildCell(pair, node) {
  const cell = document.createElement("div");
  cell.className = "ic311-cell";
  cell.dataset.index = String(pair.index);
  cell._ic311Pair = pair;
  cell._ic311Ratio = 1;

  const hasTop = !!pair.top;
  const hasBottom = !!pair.bottom;

  // Base layer = bottom (underneath). Fall back to top when only one side.
  const base = document.createElement("img");
  base.className = "ic311-layer";
  base.draggable = false;
  base.alt = "";
  cell.appendChild(base);

  let topImg = null;
  if (hasTop && hasBottom) {
    const clip = document.createElement("div");
    clip.className = "ic311-top-clip";
    topImg = document.createElement("img");
    topImg.className = "ic311-layer";
    topImg.draggable = false;
    topImg.alt = "";
    clip.appendChild(topImg);
    cell.appendChild(clip);

    const divider = document.createElement("div");
    divider.className = "ic311-divider";
    cell.appendChild(divider);
  } else {
    cell.style.cursor = "default";
  }

  const badge = document.createElement("span");
  badge.className = "ic311-badge";
  badge.textContent = String(pair.index + 1);
  cell.appendChild(badge);

  if (hasTop || hasBottom) {
    const viewLabel = document.createElement("span");
    viewLabel.className = "ic311-view-label";
    viewLabel.textContent = hasTop ? "Top" : "Bot";
    cell.appendChild(viewLabel);
  }

  cell.appendChild(makeDragHandle());

  cell._ic311Base = base;
  cell._ic311TopImg = topImg;

  cell.addEventListener("dblclick", (ev) => {
    if (ev.target?.closest?.(".ic311-drag-handle")) return;
    if (!cell.classList.contains("is-ready")) return;
    if (cell.classList.contains("is-unavailable")) return;
    ev.preventDefault();
    ev.stopPropagation();
    openFullscreen(node, pair.index);
  });

  // Reveal only when images are ready at the final aspect ratio (no black square flash).
  // Retry + concurrency limit avoids intermittent broken /view loads on fresh temp PNGs.
  cell._ic311Ready = loadCellImages(cell, node);

  return cell;
}

/** Load both layers, then either reveal the cell or offer a manual retry. */
async function loadCellImages(cell, node) {
  if (cell._ic311Loading) return;
  cell._ic311Loading = true;

  const pair = cell._ic311Pair;
  const base = cell._ic311Base;
  const topImg = cell._ic311TopImg;
  cell.querySelector(".ic311-unavailable-msg")?.remove();
  cell.classList.remove("is-unavailable");

  const baseOk = await assignImageSrc(base, pair.bottom || pair.top);
  let topOk = false;
  if (topImg) topOk = await assignImageSrc(topImg, pair.top);

  cell._ic311Loading = false;

  // Keep the bottom usable on its own when only the top layer failed.
  cell.classList.toggle("is-top-missing", !!topImg && !topOk);
  cell.classList.toggle("has-top", topImg ? topOk : baseOk && !pair.bottom);

  const ref = topOk ? topImg : base;
  if (ref.naturalWidth > 0 && ref.naturalHeight > 0) {
    cell.style.aspectRatio = `${ref.naturalWidth} / ${ref.naturalHeight}`;
    cell.classList.add("is-ready");
    bindCellMode(cell, normalizeMode(node?.properties?.ic311_mode));
    bindDragHandle(cell, node);
    syncClipWidth(cell);
    return;
  }

  const msg = document.createElement("span");
  msg.className = "ic311-unavailable-msg";
  msg.textContent = "Unavailable\nclick to retry";
  msg.style.whiteSpace = "pre-line";
  cell.appendChild(msg);
  cell.classList.add("is-ready", "is-unavailable");
  cell.addEventListener(
    "click",
    () => {
      cell.classList.add("is-loading");
      loadCellImages(cell, node).finally(() => cell.classList.remove("is-loading"));
    },
    { once: true }
  );
}

function pairsSignature(pairs) {
  return pairs
    .map((p) => `${p.top?.filename || ""}|${p.bottom?.filename || ""}`)
    .join(";");
}

function renderGrid(node) {
  const ui = node._ic311;
  if (!ui) return;

  const pairs = buildPairs(node._ic311Top, node._ic311Bottom);
  const mode = normalizeMode(node.properties?.ic311_mode);
  node.properties.ic311_mode = mode;
  const sig = pairsSignature(pairs);

  applyColumns(node);
  applyOverlays(node);

  if (ui._pairsSig === sig && ui.grid.childElementCount === pairs.length && pairs.length) {
    applyMode(node);
    return;
  }
  ui._pairsSig = sig;

  ui.grid.replaceChildren();

  if (!pairs.length) {
    const empty = document.createElement("div");
    empty.className = "ic311-empty";
    empty.textContent = "Connect image_top and/or image_bottom, then queue.";
    ui.content.replaceChildren(empty);
    syncFullscreenForNode(node);
    return;
  }

  ui.content.replaceChildren(ui.grid);
  const cells = [];
  for (const pair of pairs) {
    const cell = buildCell(pair, node);
    cells.push(cell);
    ui.grid.appendChild(cell);
    bindCellMode(cell, mode);
    bindDragHandle(cell, node);
  }

  // Show the whole grid together once every cell has its final aspect ratio.
  const renderGen = (ui._renderGen = (ui._renderGen || 0) + 1);
  Promise.all(cells.map((c) => c._ic311Ready)).then(() => {
    if (ui._renderGen !== renderGen) return;
    for (const cell of cells) syncClipWidth(cell);
  });

  syncFullscreenForNode(node);
}

function applyOverlays(node) {
  const ui = node._ic311;
  if (!ui) return;
  const show = node.properties?.ic311_show_overlays !== false;
  ui.root.classList.toggle("ic311-hide-overlays", !show);
  if (ui.overlaysToggle) {
    ui.overlaysToggle.classList.toggle("is-on", show);
    ui.overlaysToggle.setAttribute("aria-checked", show ? "true" : "false");
    ui.overlaysToggle.title = show
      ? "Overlays on (index + Top/Bot + drag handle)"
      : "Overlays off";
  }
}

function syncToolbar(node) {
  const ui = node._ic311;
  if (!ui) return;
  const mode = normalizeMode(node.properties?.ic311_mode);
  node.properties.ic311_mode = mode;
  const cols = clampColumns(node.properties?.ic311_columns ?? 4);

  ui.modeSlide.classList.toggle("is-active", mode === "Slide");
  ui.modeClick.classList.toggle("is-active", mode === "Click");
  if (ui.colsInput) ui.colsInput.value = String(cols);
  applyOverlays(node);
}

function buildWidget(node) {
  injectStyles();

  if (!node.properties) node.properties = {};
  if (node.properties.ic311_mode == null) node.properties.ic311_mode = "Slide";
  node.properties.ic311_mode = normalizeMode(node.properties.ic311_mode);
  if (node.properties.ic311_columns == null) node.properties.ic311_columns = 4;
  if (node.properties.ic311_show_overlays == null) node.properties.ic311_show_overlays = true;
  node.properties.ic311_columns = clampColumns(node.properties.ic311_columns);

  const root = document.createElement("div");
  root.className = "ic311-root";

  const content = document.createElement("div");
  content.className = "ic311-content";

  const grid = document.createElement("div");
  grid.className = "ic311-grid";
  content.appendChild(grid);

  const bar = document.createElement("div");
  bar.className = "ic311-actionbar";

  const overlaysCtrl = document.createElement("div");
  overlaysCtrl.className = "ic311-overlay-ctrl";
  const overlaysLabel = document.createElement("span");
  overlaysLabel.className = "ic311-overlay-label";
  overlaysLabel.textContent = "Overlay";
  const overlaysToggle = document.createElement("button");
  overlaysToggle.className = "ic311-toggle";
  overlaysToggle.type = "button";
  overlaysToggle.setAttribute("role", "switch");
  overlaysToggle.setAttribute("aria-label", "Toggle overlays");
  overlaysCtrl.append(overlaysLabel, overlaysToggle);

  const spacer = document.createElement("div");
  spacer.className = "ic311-spacer";

  const modeSlide = document.createElement("button");
  modeSlide.className = "ic311-btn";
  modeSlide.type = "button";
  modeSlide.textContent = "Slide";
  modeSlide.title = "Hover to wipe between top and bottom.";

  const modeClick = document.createElement("button");
  modeClick.className = "ic311-btn";
  modeClick.type = "button";
  modeClick.textContent = "Click";
  modeClick.title = "Shows top; hold to reveal bottom.";

  const colsWrap = document.createElement("div");
  colsWrap.className = "ic311-cols";
  const colsLabel = document.createElement("span");
  colsLabel.className = "ic311-cols-label";
  colsLabel.textContent = "Col";

  const colsSpin = document.createElement("div");
  colsSpin.className = "ic311-cols-spin";
  const colsInput = document.createElement("input");
  colsInput.className = "ic311-cols-input";
  colsInput.type = "text";
  colsInput.inputMode = "numeric";
  colsInput.pattern = "[0-9]*";
  colsInput.value = String(clampColumns(node.properties.ic311_columns));
  colsInput.title = "Grid columns";

  const arrows = document.createElement("div");
  arrows.className = "ic311-cols-arrows";
  const upBtn = document.createElement("button");
  upBtn.className = "ic311-cols-arrow";
  upBtn.type = "button";
  upBtn.textContent = "▲";
  upBtn.title = "Increase columns";
  const downBtn = document.createElement("button");
  downBtn.className = "ic311-cols-arrow";
  downBtn.type = "button";
  downBtn.textContent = "▼";
  downBtn.title = "Decrease columns";
  arrows.append(upBtn, downBtn);
  colsSpin.append(colsInput, arrows);
  colsWrap.append(colsLabel, colsSpin);

  const commitCols = () => {
    const cols = clampColumns(colsInput.value);
    colsInput.value = String(cols);
    node.properties.ic311_columns = cols;
    applyColumns(node);
    app.graph?.setDirtyCanvas?.(true);
  };
  const nudgeCols = (delta) => {
    const cols = clampColumns((Number(colsInput.value) || 4) + delta);
    colsInput.value = String(cols);
    node.properties.ic311_columns = cols;
    applyColumns(node);
    app.graph?.setDirtyCanvas?.(true);
  };
  colsInput.addEventListener("change", commitCols);
  colsInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      commitCols();
      colsInput.blur();
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      nudgeCols(1);
    } else if (ev.key === "ArrowDown") {
      ev.preventDefault();
      nudgeCols(-1);
    }
    ev.stopPropagation();
  });
  colsInput.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  upBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    nudgeCols(1);
  });
  downBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    nudgeCols(-1);
  });

  overlaysToggle.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    node.properties.ic311_show_overlays = !(node.properties.ic311_show_overlays !== false);
    applyOverlays(node);
    app.graph?.setDirtyCanvas?.(true);
  });

  modeSlide.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    node.properties.ic311_mode = "Slide";
    syncToolbar(node);
    applyMode(node);
  });
  modeClick.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    node.properties.ic311_mode = "Click";
    syncToolbar(node);
    applyMode(node);
  });

  // Left: Overlay toggle + Col · Right: Slide / Click
  bar.append(overlaysCtrl, colsWrap, spacer, modeSlide, modeClick);
  root.append(content, bar);

  node._ic311 = {
    root,
    content,
    grid,
    bar,
    modeSlide,
    modeClick,
    colsInput,
    overlaysToggle,
  };

  root.addEventListener("pointerdown", (ev) => ev.stopPropagation());

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      for (const cell of grid.querySelectorAll(".ic311-cell")) {
        cell._cachedRect = cell.getBoundingClientRect();
        syncClipWidth(cell);
      }
    });
    ro.observe(root);
    node._ic311ResizeObserver = ro;
  }

  syncToolbar(node);
  renderGrid(node);
  return root;
}

app.registerExtension({
  name: "ComfyUI-311-Tool-Suite.ImageComparer311",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated?.apply(this, arguments);

      if (!this.size || this.size[0] < MIN_NODE_W) {
        this.setSize([420, 480]);
      }

      this.computeSize = function () {
        return [MIN_NODE_W, MIN_NODE_H];
      };

      const node = this;
      const el = buildWidget(this);
      this.addDOMWidget(WIDGET_NAME, "ImageComparer311UI", el, {
        serialize: false,
        hideOnZoom: false,
        getValue() {
          return "";
        },
        setValue() {},
        computeSize() {
          const trueWidth = node.size[0];
          let widgetH = 0;
          for (const w of node.widgets ?? []) {
            if (w.name === WIDGET_NAME) continue;
            widgetH += (w.computeSize ? w.computeSize(trueWidth)[1] : 20) + 4;
          }
          const slotsH =
            Math.max(node.inputs?.length ?? 0, node.outputs?.length ?? 0) * NODE_SLOT_H;
          const chromeH = NODE_HEADER_H + slotsH + widgetH + NODE_PADDING_V;
          const h = Math.max(MIN_HEIGHT, node.size[1] - chromeH);
          el.style.height = `${h}px`;
          return [trueWidth, h];
        },
      });

      clearNodeImagePreview(this);
      return r;
    };

    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (output) {
      if (onExecuted) onExecuted.apply(this, arguments);
      this._ic311Top = output?.top_images || [];
      this._ic311Bottom = output?.bottom_images || [];
      clearNodeImagePreview(this);
      renderGrid(this);
      syncToolbar(this);
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure?.apply(this, arguments);
      clearNodeImagePreview(this);
      if (this._ic311) {
        syncToolbar(this);
        renderGrid(this);
      }
      return r;
    };

    const onDestroy = nodeType.prototype.onDestroy;
    nodeType.prototype.onDestroy = function () {
      if (_fs?.node === this) closeFullscreen();
      if (this._ic311ResizeObserver) {
        this._ic311ResizeObserver.disconnect();
      }
      for (const cell of this._ic311?.grid?.querySelectorAll?.(".ic311-cell") || []) {
        cell._ic311Abort?.abort();
        cell._ic311DragAbort?.abort();
      }
      if (onDestroy) onDestroy.apply(this, arguments);
    };
  },
});
