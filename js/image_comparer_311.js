/**
 * Image Comparer 311 — Frontend
 *
 * Batch-aware L/R image comparison grid.
 * Shows every image_top[i] / image_bottom[i] pair at once (Preview-style).
 *
 * Layering: bottom is the base; top is the overlay wipe from the left.
 * Slide default = fully right (top only). Drag left to reveal bottom.
 * Click default = top; hold click = bottom.
 *
 * Spec: docs/UI_DESIGN_SYSTEM.md (n311 tokens + DOM widget shell)
 */

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "ImageComparer311";
const STYLE_ID = "image-comparer-311-n311-style-v2";
const WIDGET_NAME = "ic311_ui";
const MIN_HEIGHT = 180;
const NODE_HEADER_H = 30;
const NODE_SLOT_H = 22;
const NODE_PADDING_V = 12;
const MIN_NODE_W = 360;
const MIN_NODE_H = 320;

/** Default wipe position: fully right = top only. */
const SLIDE_REST = 1;

function imgURL(d) {
  if (!d) return "";
  const p = new URLSearchParams();
  p.set("filename", d.filename);
  if (d.subfolder) p.set("subfolder", d.subfolder);
  p.set("type", d.type || "temp");
  return api.apiURL(`/view?${p}${app.getPreviewFormatParam?.() || ""}${app.getRandParam?.() || ""}`);
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
  const prev = document.getElementById("image-comparer-311-n311-style");
  if (prev) prev.remove();
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
    .ic311-root.ic311-hide-overlays .ic311-view-label {
      display: none;
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
    .ic311-btn--ghost {
      background: transparent;
      border-color: transparent;
      color: var(--n311-text-dim, #888);
      padding: 6px 6px;
      font-size: 10px;
    }
    .ic311-btn--ghost:hover {
      background: transparent;
      border-color: transparent;
      color: var(--n311-text-muted, #aaa);
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
  `;
  document.head.appendChild(style);
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

/** Bind Slide/Click handlers without recreating <img> (avoids black flash). */
function bindCellMode(cell, mode) {
  if (!cell.querySelector(".ic311-top-clip")) {
    cell.style.cursor = "default";
    return;
  }

  cell._ic311Abort?.abort();
  const ac = new AbortController();
  cell._ic311Abort = ac;
  const opts = { signal: ac.signal };
  cell._ic311Down = false;

  const updateRect = () => {
    cell._cachedRect = cell.getBoundingClientRect();
  };

  if (mode === "Click") {
    cell.style.cursor = "pointer";
    // Rest = top; hold = bottom.
    setClip(cell, 1);
    cell.addEventListener(
      "pointerdown",
      (ev) => {
        if (ev.button !== 0) return;
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
    cell.addEventListener("pointerleave", release, opts);
    cell.addEventListener("pointercancel", release, opts);
  } else {
    cell.style.cursor = "ew-resize";
    setClip(cell, SLIDE_REST);

    let ticking = false;
    let lastClientX = 0;

    cell.addEventListener(
      "pointerenter",
      (ev) => {
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
}

function applyMode(node) {
  const ui = node._ic311;
  if (!ui) return;
  const mode = node.properties?.ic311_mode === "Click" ? "Click" : "Slide";
  for (const cell of ui.grid.querySelectorAll(".ic311-cell")) {
    bindCellMode(cell, mode);
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

function whenImageReady(img) {
  return new Promise((resolve) => {
    if (img.complete && img.naturalWidth > 0) {
      resolve();
      return;
    }
    img.addEventListener("load", () => resolve(), { once: true });
    img.addEventListener("error", () => resolve(), { once: true });
  });
}

function buildCell(pair) {
  const cell = document.createElement("div");
  cell.className = "ic311-cell";
  cell.dataset.index = String(pair.index);

  const hasTop = !!pair.top;
  const hasBottom = !!pair.bottom;

  // Base layer = bottom (underneath). Fall back to top when only one side.
  const base = document.createElement("img");
  base.className = "ic311-layer";
  base.draggable = false;
  if (hasBottom) base.src = imgURL(pair.bottom);
  else if (hasTop) base.src = imgURL(pair.top);
  cell.appendChild(base);

  let topImg = null;
  if (hasTop && hasBottom) {
    const clip = document.createElement("div");
    clip.className = "ic311-top-clip";
    topImg = document.createElement("img");
    topImg.className = "ic311-layer";
    topImg.draggable = false;
    topImg.src = imgURL(pair.top);
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

  // Reveal only when images are ready at the final aspect ratio (no black square flash).
  const wait = [whenImageReady(base)];
  if (topImg) wait.push(whenImageReady(topImg));
  cell._ic311Ready = Promise.all(wait).then(() => {
    const ref = topImg && topImg.naturalWidth > 0 ? topImg : base;
    if (ref.naturalWidth > 0 && ref.naturalHeight > 0) {
      cell.style.aspectRatio = `${ref.naturalWidth} / ${ref.naturalHeight}`;
    }
    cell.classList.add("is-ready");
    syncClipWidth(cell);
  });

  return cell;
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
  const mode = node.properties?.ic311_mode === "Click" ? "Click" : "Slide";
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
    return;
  }

  ui.content.replaceChildren(ui.grid);
  const cells = [];
  for (const pair of pairs) {
    const cell = buildCell(pair);
    cells.push(cell);
    ui.grid.appendChild(cell);
    bindCellMode(cell, mode);
  }

  // Show the whole grid together once every cell has its final aspect ratio.
  const renderGen = (ui._renderGen = (ui._renderGen || 0) + 1);
  Promise.all(cells.map((c) => c._ic311Ready)).then(() => {
    if (ui._renderGen !== renderGen) return;
    for (const cell of cells) syncClipWidth(cell);
  });
}

function applyOverlays(node) {
  const ui = node._ic311;
  if (!ui) return;
  const show = node.properties?.ic311_show_overlays !== false;
  ui.root.classList.toggle("ic311-hide-overlays", !show);
  if (ui.overlaysBtn) {
    ui.overlaysBtn.textContent = show ? "Hide" : "Show";
    ui.overlaysBtn.title = show
      ? "Hide index and Top/Bot overlays"
      : "Show index and Top/Bot overlays";
  }
}

function syncToolbar(node) {
  const ui = node._ic311;
  if (!ui) return;
  const mode = node.properties?.ic311_mode === "Click" ? "Click" : "Slide";
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

  const overlaysBtn = document.createElement("button");
  overlaysBtn.className = "ic311-btn ic311-btn--ghost";
  overlaysBtn.type = "button";
  overlaysBtn.textContent = "Hide";
  overlaysBtn.title = "Hide index and Top/Bot overlays";

  const spacer = document.createElement("div");
  spacer.className = "ic311-spacer";

  const modeSlide = document.createElement("button");
  modeSlide.className = "ic311-btn";
  modeSlide.type = "button";
  modeSlide.textContent = "Slide";
  modeSlide.title = "Default: top only. Drag left to reveal bottom.";

  const modeClick = document.createElement("button");
  modeClick.className = "ic311-btn";
  modeClick.type = "button";
  modeClick.textContent = "Click";
  modeClick.title = "Shows top; hold click to reveal bottom.";

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

  overlaysBtn.addEventListener("click", (ev) => {
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

  // Left: overlays + Col · Right: Slide / Click
  bar.append(overlaysBtn, colsWrap, spacer, modeSlide, modeClick);
  root.append(content, bar);

  node._ic311 = {
    root,
    content,
    grid,
    bar,
    modeSlide,
    modeClick,
    colsInput,
    overlaysBtn,
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
      if (this._ic311ResizeObserver) {
        this._ic311ResizeObserver.disconnect();
      }
      for (const cell of this._ic311?.grid?.querySelectorAll?.(".ic311-cell") || []) {
        cell._ic311Abort?.abort();
      }
      if (onDestroy) onDestroy.apply(this, arguments);
    };
  },
});
