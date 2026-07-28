/**
 * Image Comparer 311 — Frontend
 *
 * Batch-aware L/R image comparison grid.
 * Shows every image_a[i] / image_b[i] pair at once (Preview-style),
 * each cell with rgthree-like slide (or click) reveal.
 *
 * Spec: docs/UI_DESIGN_SYSTEM.md (n311 tokens + DOM widget shell)
 */

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "ImageComparer311";
const STYLE_ID = "image-comparer-311-n311-style";
const WIDGET_NAME = "ic311_ui";
const MIN_HEIGHT = 180;
const NODE_HEADER_H = 30;
const NODE_SLOT_H = 22;
const NODE_PADDING_V = 12;
const MIN_NODE_W = 360;
const MIN_NODE_H = 320;

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
      border: 1px solid var(--n311-border-strong, #444);
      background: var(--n311-bg-thumb, #353535);
      cursor: ew-resize;
      user-select: none;
      aspect-ratio: 1 / 1;
    }
    .ic311-cell:hover { border-color: var(--n311-accent-dim, #5a7abf); }

    .ic311-layer {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: #111;
      pointer-events: none;
      display: block;
    }
    .ic311-b-clip {
      position: absolute;
      inset: 0 auto 0 0;
      width: 50%;
      overflow: hidden;
      pointer-events: none;
    }
    .ic311-b-clip .ic311-layer {
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
      left: 50%;
      border-left: 1px solid rgba(255,255,255,0.95);
      mix-blend-mode: difference;
      pointer-events: none;
      z-index: 2;
    }
    .ic311-badge {
      position: absolute; top: 2px; left: 3px;
      background: rgba(0,0,0,0.55); color: #fff;
      font-size: 8px; font-weight: bold;
      padding: 1px 4px; border-radius: 2px;
      pointer-events: none; z-index: 3;
    }
    .ic311-labels {
      position: absolute; top: 2px; right: 3px;
      display: flex; gap: 3px;
      pointer-events: none; z-index: 3;
    }
    .ic311-label {
      background: rgba(0,0,0,0.55); color: #e0e0e0;
      font-size: 8px; font-weight: bold;
      padding: 1px 4px; border-radius: 2px;
    }

    .ic311-actionbar {
      flex-shrink: 0;
      display: flex; align-items: center; gap: 8px;
      padding: 8px;
      background: var(--n311-bg-panel, #1e1e1e);
      border-top: 1px solid var(--n311-border, #333);
    }
    .ic311-status {
      flex: 1;
      font-size: 11px; line-height: 1.25;
      color: var(--n311-text-muted, #aaa);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
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
    .ic311-cols {
      display: flex; gap: 4px; flex-shrink: 0;
    }
  `;
  document.head.appendChild(style);
}

/** Pair a_images[i] with b_images[i]; length-1 side broadcasts. */
function buildPairs(aImages, bImages) {
  const a = aImages || [];
  const b = bImages || [];
  if (!a.length && !b.length) return [];

  if (!a.length) {
    return b.map((img, i) => ({ index: i, a: null, b: img }));
  }
  if (!b.length) {
    return a.map((img, i) => ({ index: i, a: img, b: null }));
  }

  let count;
  if (a.length === 1) count = b.length;
  else if (b.length === 1) count = a.length;
  else count = Math.min(a.length, b.length);

  const pairs = [];
  for (let i = 0; i < count; i++) {
    pairs.push({
      index: i,
      a: a.length === 1 ? a[0] : a[i],
      b: b.length === 1 ? b[0] : b[i],
    });
  }
  return pairs;
}

function setClip(cell, ratio) {
  const r = Math.max(0, Math.min(1, ratio));
  const clip = cell.querySelector(".ic311-b-clip");
  const divider = cell.querySelector(".ic311-divider");
  if (!clip) return;
  const pct = `${(r * 100).toFixed(2)}%`;
  clip.style.width = pct;
  if (divider) {
    divider.style.left = pct;
    // Hide at extremes — a 0%/100% divider reads as a white scratch on black.
    divider.style.display = r <= 0.001 || r >= 0.999 ? "none" : "";
  }
}

function syncClipWidth(cell) {
  const clip = cell.querySelector(".ic311-b-clip");
  if (!clip) return;
  clip.style.setProperty("--ic311-full-w", `${cell.clientWidth}px`);
}

function pointerRatio(cell, clientX) {
  const rect = cell.getBoundingClientRect();
  if (rect.width <= 0) return 0.5;
  return (clientX - rect.left) / rect.width;
}

/** Bind Slide/Click handlers without recreating <img> (avoids black flash). */
function bindCellMode(cell, mode) {
  if (!cell.querySelector(".ic311-b-clip")) {
    cell.style.cursor = "default";
    return;
  }

  cell._ic311Abort?.abort();
  const ac = new AbortController();
  cell._ic311Abort = ac;
  const opts = { signal: ac.signal };
  cell._ic311Down = false;

  if (mode === "Click") {
    cell.style.cursor = "pointer";
    setClip(cell, 0);
    cell.addEventListener(
      "pointerdown",
      (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        ev.stopPropagation();
        cell._ic311Down = true;
        setClip(cell, 1);
      },
      opts
    );
    const release = () => {
      if (!cell._ic311Down) return;
      cell._ic311Down = false;
      setClip(cell, 0);
    };
    cell.addEventListener("pointerup", release, opts);
    cell.addEventListener("pointerleave", release, opts);
    cell.addEventListener("pointercancel", release, opts);
  } else {
    cell.style.cursor = "ew-resize";
    setClip(cell, 0.5);
    cell.addEventListener(
      "pointerenter",
      (ev) => {
        syncClipWidth(cell);
        setClip(cell, pointerRatio(cell, ev.clientX));
      },
      opts
    );
    cell.addEventListener(
      "pointermove",
      (ev) => {
        setClip(cell, pointerRatio(cell, ev.clientX));
      },
      opts
    );
    cell.addEventListener(
      "pointerleave",
      () => {
        setClip(cell, 0.5);
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
  updateStatus(node);
}

function applyColumns(node) {
  const ui = node._ic311;
  if (!ui) return;
  const cols = Math.max(1, Math.min(8, Number(node.properties?.ic311_columns) || 2));
  ui.grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  requestAnimationFrame(() => {
    for (const cell of ui.grid.querySelectorAll(".ic311-cell")) {
      syncClipWidth(cell);
    }
  });
}

function updateStatus(node) {
  const ui = node._ic311;
  if (!ui) return;
  const pairs = buildPairs(node._ic311A, node._ic311B);
  const mode = node.properties?.ic311_mode === "Click" ? "Click" : "Slide";
  if (!pairs.length) {
    ui.status.textContent = "No images";
    return;
  }
  const both = pairs.filter((p) => p.a && p.b).length;
  ui.status.textContent =
    both === pairs.length
      ? `${pairs.length} pair${pairs.length === 1 ? "" : "s"} · ${mode}`
      : `${pairs.length} image${pairs.length === 1 ? "" : "s"} · ${mode}`;
}

function buildCell(pair) {
  const cell = document.createElement("div");
  cell.className = "ic311-cell";
  cell.dataset.index = String(pair.index);

  const hasA = !!pair.a;
  const hasB = !!pair.b;

  // Base layer: prefer A, fall back to B when only one side exists.
  const base = document.createElement("img");
  base.className = "ic311-layer";
  base.draggable = false;
  base.addEventListener("load", () => {
    if (base.naturalWidth > 0 && base.naturalHeight > 0) {
      cell.style.aspectRatio = `${base.naturalWidth} / ${base.naturalHeight}`;
    }
    syncClipWidth(cell);
  });
  if (hasA) base.src = imgURL(pair.a);
  else if (hasB) base.src = imgURL(pair.b);
  cell.appendChild(base);

  if (hasA && hasB) {
    const clip = document.createElement("div");
    clip.className = "ic311-b-clip";
    const top = document.createElement("img");
    top.className = "ic311-layer";
    top.draggable = false;
    top.src = imgURL(pair.b);
    clip.appendChild(top);
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

  const labels = document.createElement("div");
  labels.className = "ic311-labels";
  if (hasA) {
    const la = document.createElement("span");
    la.className = "ic311-label";
    la.textContent = "A";
    labels.appendChild(la);
  }
  if (hasB) {
    const lb = document.createElement("span");
    lb.className = "ic311-label";
    lb.textContent = "B";
    labels.appendChild(lb);
  }
  cell.appendChild(labels);

  requestAnimationFrame(() => syncClipWidth(cell));
  return cell;
}

function pairsSignature(pairs) {
  return pairs
    .map((p) => `${p.a?.filename || ""}|${p.b?.filename || ""}`)
    .join(";");
}

function renderGrid(node) {
  const ui = node._ic311;
  if (!ui) return;

  const pairs = buildPairs(node._ic311A, node._ic311B);
  const mode = node.properties?.ic311_mode === "Click" ? "Click" : "Slide";
  const sig = pairsSignature(pairs);

  applyColumns(node);

  // Same image set → only rebind mode (no <img> reload / black flash).
  if (ui._pairsSig === sig && ui.grid.childElementCount === pairs.length && pairs.length) {
    applyMode(node);
    return;
  }
  ui._pairsSig = sig;

  ui.grid.replaceChildren();

  if (!pairs.length) {
    const empty = document.createElement("div");
    empty.className = "ic311-empty";
    empty.textContent = "Connect image_a and/or image_b, then queue.";
    ui.content.replaceChildren(empty);
    ui.status.textContent = "No images";
    return;
  }

  ui.content.replaceChildren(ui.grid);
  for (const pair of pairs) {
    const cell = buildCell(pair);
    ui.grid.appendChild(cell);
    bindCellMode(cell, mode);
  }

  updateStatus(node);

  requestAnimationFrame(() => {
    for (const cell of ui.grid.querySelectorAll(".ic311-cell")) {
      syncClipWidth(cell);
    }
  });
}

function syncToolbar(node) {
  const ui = node._ic311;
  if (!ui) return;
  const mode = node.properties?.ic311_mode === "Click" ? "Click" : "Slide";
  const cols = Math.max(1, Math.min(8, Number(node.properties?.ic311_columns) || 2));

  ui.modeSlide.classList.toggle("is-active", mode === "Slide");
  ui.modeClick.classList.toggle("is-active", mode === "Click");
  for (const btn of ui.colBtns) {
    btn.classList.toggle("is-active", Number(btn.dataset.cols) === cols);
  }
}

function buildWidget(node) {
  injectStyles();

  if (!node.properties) node.properties = {};
  if (node.properties.ic311_mode == null) node.properties.ic311_mode = "Slide";
  if (node.properties.ic311_columns == null) node.properties.ic311_columns = 2;

  const root = document.createElement("div");
  root.className = "ic311-root";

  const content = document.createElement("div");
  content.className = "ic311-content";

  const grid = document.createElement("div");
  grid.className = "ic311-grid";
  content.appendChild(grid);

  const bar = document.createElement("div");
  bar.className = "ic311-actionbar";

  const status = document.createElement("span");
  status.className = "ic311-status";
  status.textContent = "Ready";

  const modeSlide = document.createElement("button");
  modeSlide.className = "ic311-btn";
  modeSlide.type = "button";
  modeSlide.textContent = "Slide";
  modeSlide.title = "Reveal B by hovering left/right";

  const modeClick = document.createElement("button");
  modeClick.className = "ic311-btn";
  modeClick.type = "button";
  modeClick.textContent = "Click";
  modeClick.title = "Hold click to show B";

  const colsWrap = document.createElement("div");
  colsWrap.className = "ic311-cols";
  const colBtns = [];
  for (const n of [1, 2, 3, 4]) {
    const btn = document.createElement("button");
    btn.className = "ic311-btn";
    btn.type = "button";
    btn.textContent = String(n);
    btn.title = `${n} column${n === 1 ? "" : "s"}`;
    btn.dataset.cols = String(n);
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      node.properties.ic311_columns = n;
      syncToolbar(node);
      applyColumns(node);
      app.graph?.setDirtyCanvas?.(true);
    });
    colsWrap.appendChild(btn);
    colBtns.push(btn);
  }

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

  bar.append(status, colsWrap, modeSlide, modeClick);
  root.append(content, bar);

  node._ic311 = {
    root,
    content,
    grid,
    bar,
    status,
    modeSlide,
    modeClick,
    colBtns,
  };

  // Stop LiteGraph from treating widget pointer events as node drags.
  root.addEventListener("pointerdown", (ev) => ev.stopPropagation());

  // Keep B-clip full-width in sync when the node is resized.
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      for (const cell of grid.querySelectorAll(".ic311-cell")) {
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

      // Pin computeSize to break the LiteGraph widget↔node height loop.
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
      this._ic311A = output?.a_images || [];
      this._ic311B = output?.b_images || [];
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
  },
});
