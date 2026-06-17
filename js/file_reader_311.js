/* ═══════════════════════════════════════════════════════════════
   ComfyUI File Reader — Frontend Extension
   Viewer / Editor overlay with markdown rendering, refresh, and
   3-tier content fallback (live → editor → cache).
   ═══════════════════════════════════════════════════════════════ */

import { app } from "../../scripts/app.js";

const NODE_TYPES = ["FileReader311", "FileReaderNode"];
const MAX_VIEWER_CHARS = 500_000; // 500 KB display limit

/* ─── CSS (injected once into <head>) ─────────────────────── */

const CSS = `
/* ── Container ────────────────────────────────────────────── */
.fr-container {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: #1a1a1a;
  border-radius: 0 0 8px 8px;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

/* ── Controls Bar ─────────────────────────────────────────── */
.fr-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: #212121;
  border-bottom: 1px solid #333;
  min-height: 30px;
  flex-shrink: 0;
}
.fr-icon { font-size: 14px; flex-shrink: 0; opacity: 0.7; }
.fr-fname {
  font-size: 11px;
  color: #aaa;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.fr-badge {
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex-shrink: 0;
  line-height: 16px;
}
.fr-badge-live   { background: #1a3a1a; color: #4ade80; border: 1px solid #2a5a2a; }
.fr-badge-cached { background: #3a3a1a; color: #fbbf24; border: 1px solid #5a5a2a; }
.fr-badge-edited { background: #1a2a3a; color: #60a5fa; border: 1px solid #2a4a5a; }
.fr-badge-error  { background: #3a1a1a; color: #f87171; border: 1px solid #5a2a2a; }
.fr-badge-idle   { background: #2a2a2a; color: #777;    border: 1px solid #383838; }

.fr-spacer { flex: 1; }

.fr-btn {
  background: #2e2e2e;
  border: 1px solid #3d3d3d;
  border-radius: 4px;
  color: #aaa;
  cursor: pointer;
  padding: 2px 6px;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  flex-shrink: 0;
  line-height: 1;
  min-width: 24px;
  min-height: 22px;
}
.fr-btn:hover { background: #3a3a3a; color: #eee; border-color: #555; }
.fr-btn.fr-copied { background: #1a3a1a; color: #4ade80; border-color: #2a5a2a; }
.fr-btn.fr-active { background: #1a2a3a; color: #60a5fa; border-color: #2a4a5a; }
.fr-btn svg { pointer-events: none; }

@keyframes fr-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
.fr-btn.fr-refreshing svg { animation: fr-spin 0.6s linear infinite; }

/* ── Viewer ───────────────────────────────────────────────── */
.fr-viewer {
  flex: 1;
  overflow: auto;
  padding: 12px 16px;
  font-size: 14px;
  line-height: 1.65;
  color: #d4d4d4;
  background: #1a1a1a;
  word-wrap: break-word;
  overflow-wrap: break-word;
  min-height: 0;
}
.fr-viewer::-webkit-scrollbar { width: 6px; height: 6px; }
.fr-viewer::-webkit-scrollbar-track { background: transparent; }
.fr-viewer::-webkit-scrollbar-thumb { background: #3a3a3a; border-radius: 3px; }
.fr-viewer::-webkit-scrollbar-thumb:hover { background: #555; }

/* ── Viewer — rendered markdown / content ─────────────────── */
.fr-viewer h1, .fr-viewer h2, .fr-viewer h3,
.fr-viewer h4, .fr-viewer h5, .fr-viewer h6 {
  color: #e8e8e8;
  margin: 20px 0 8px;
  line-height: 1.3;
  font-weight: 600;
}
.fr-viewer h1:first-child, .fr-viewer h2:first-child,
.fr-viewer h3:first-child { margin-top: 0; }
.fr-viewer h1 { font-size: 1.5em; border-bottom: 1px solid #333; padding-bottom: 6px; }
.fr-viewer h2 { font-size: 1.25em; }
.fr-viewer h3 { font-size: 1.1em; }
.fr-viewer h4 { font-size: 1em; }
.fr-viewer p  { margin: 8px 0; }
.fr-viewer a  { color: #7aa2f7; text-decoration: none; }
.fr-viewer a:hover { text-decoration: underline; }
.fr-viewer strong { color: #e8e8e8; }
.fr-viewer em   { color: #ccc; }
.fr-viewer del  { opacity: 0.5; }

.fr-viewer pre.fr-codeblock {
  background: #111;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 12px;
  overflow-x: auto;
  margin: 12px 0;
}
.fr-viewer pre.fr-codeblock code,
.fr-viewer pre.fr-pre {
  font-family: "Fira Code", "Cascadia Code", Consolas, Monaco, monospace;
  font-size: 13px;
  line-height: 1.5;
  color: #ccc;
  white-space: pre-wrap;
  word-wrap: break-word;
}
.fr-viewer pre.fr-pre {
  background: transparent;
  margin: 0;
  padding: 0;
}
.fr-viewer code.fr-ic {
  background: rgba(0,0,0,0.4);
  padding: 1px 5px;
  border-radius: 3px;
  font-family: "Fira Code", Consolas, monospace;
  font-size: 0.88em;
}
.fr-viewer blockquote {
  border-left: 3px solid #555;
  margin: 12px 0;
  padding: 6px 14px;
  background: rgba(255,255,255,0.04);
  border-radius: 0 4px 4px 0;
  color: #aaa;
}
.fr-viewer ul, .fr-viewer ol { padding-left: 22px; margin: 8px 0; }
.fr-viewer li { margin: 3px 0; }
.fr-viewer li.fr-done { color: #9ece6a; }
.fr-viewer hr {
  border: none;
  border-top: 1px solid #333;
  margin: 16px 0;
}
.fr-viewer table {
  border-collapse: collapse;
  width: 100%;
  margin: 12px 0;
  font-size: 13px;
}
.fr-viewer th, .fr-viewer td {
  border: 1px solid #333;
  padding: 6px 10px;
  text-align: left;
}
.fr-viewer th { background: rgba(0,0,0,0.3); color: #ccc; font-weight: 600; }
.fr-viewer img { max-width: 100%; border-radius: 4px; }

.fr-viewer .fr-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 120px;
  gap: 8px;
  opacity: 0.4;
  text-align: center;
  font-size: 13px;
  padding: 24px;
}
.fr-viewer .fr-placeholder .fr-placeholder-icon { font-size: 32px; }

.fr-viewer .fr-error-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 80px;
  gap: 6px;
  color: #f87171;
  text-align: center;
  font-size: 13px;
  padding: 24px;
}
.fr-viewer .fr-error-box .fr-error-icon { font-size: 28px; }
.fr-viewer .fr-error-box .fr-error-msg { opacity: 0.8; max-width: 380px; word-break: break-word; }

.fr-viewer .fr-truncated {
  margin-top: 16px;
  padding: 8px 12px;
  background: #3a3a1a;
  border: 1px solid #5a5a2a;
  border-radius: 4px;
  color: #fbbf24;
  font-size: 12px;
  text-align: center;
}

/* ── Editor ───────────────────────────────────────────────── */
.fr-editor {
  flex: 1;
  border: none;
  background: #161616;
  color: #d4d4d4;
  font-family: "Fira Code", "Cascadia Code", Consolas, Monaco, monospace;
  font-size: 13px;
  line-height: 1.5;
  padding: 12px 16px;
  resize: none;
  outline: none;
  min-height: 0;
  display: none;
  tab-size: 4;
}
.fr-editor:focus { background: #1c1c1c; }
.fr-editor::-webkit-scrollbar { width: 6px; }
.fr-editor::-webkit-scrollbar-track { background: transparent; }
.fr-editor::-webkit-scrollbar-thumb { background: #3a3a3a; border-radius: 3px; }

/* ── Search ───────────────────────────────────────────────── */
.fr-search-container {
  display: flex;
  align-items: center;
  background: #141414;
  border: 1px solid #383838;
  border-radius: 4px;
  overflow: hidden;
  height: 22px;
  max-width: 170px;
}
.fr-search-input {
  background: transparent;
  border: none;
  color: #d0d0d0;
  padding: 0 6px;
  font-size: 11px;
  width: 75px;
  outline: none;
}
.fr-search-input:focus { background: #1e1e1e; }
.fr-search-info {
  font-size: 10px;
  color: #777;
  padding: 0 6px;
  user-select: none;
  min-width: 28px;
  text-align: center;
}
.fr-search-nav {
  display: flex;
  background: #2a2a2a;
}
.fr-search-btn {
  background: transparent;
  border: none;
  border-left: 1px solid #383838;
  color: #aaa;
  cursor: pointer;
  padding: 0 6px;
  font-size: 10px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.fr-search-btn:hover { background: #444; color: #fff; }

mark.fr-highlight {
  background: rgba(255, 220, 0, 0.45);
  color: inherit;
  border-radius: 2px;
}
mark.fr-highlight-active {
  background: rgba(255, 140, 0, 0.85);
  color: #fff;
}
`;

let _cssReady = false;
function ensureCSS() {
  if (_cssReady) return;
  _cssReady = true;
  const s = document.createElement("style");
  s.id = "fr-file-reader-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* ─── HTML Escape ─────────────────────────────────────────── */

function esc(s) {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ─── Widget Value Helper (file_path only) ────────────────── */

function gw(node, name) {
  const w = node.widgets?.find((w) => w.name === name);
  if (w && w.value !== undefined && w.value !== null && w.value !== "") return w.value;
  const idx = node.widgets?.findIndex((w) => w.name === name);
  if (idx >= 0 && node.widgets_values?.[idx] !== undefined && node.widgets_values[idx] !== "")
    return node.widgets_values[idx];
  return "";
}

/* ─── node.properties Cache Helpers ──────────────────────── */
// node.properties is serialized by LiteGraph into the workflow JSON.
// This is the only reliable way to persist data across workflow saves/loads.

function initProps(node) {
  if (!node.properties) node.properties = {};

  // Sync from widgets to properties if properties are empty but widgets have values (e.g. on new machine load)
  const getWVal = (name) => {
    const w = node.widgets?.find((w) => w.name === name);
    if (w && w.value !== undefined && w.value !== null) return w.value;
    const idx = node.widgets?.findIndex((w) => w.name === name);
    if (idx >= 0 && node.widgets_values?.[idx] !== undefined && node.widgets_values[idx] !== null)
      return node.widgets_values[idx];
    return "";
  };

  const widgetCachedContent = getWVal("_cached_content");
  if (!node.properties.fr_cache_content && widgetCachedContent) {
    node.properties.fr_cache_content = widgetCachedContent;
    node.properties.fr_cache_name = getWVal("_cached_file_name") || "cached";
    if (node.properties.fr_cache_name) {
      node.properties.fr_cache_ext = "." + node.properties.fr_cache_name.split(".").pop();
    }
  }

  const widgetEditorContent = getWVal("_editor_content");
  if (!node.properties.fr_editor && widgetEditorContent) {
    node.properties.fr_editor = widgetEditorContent;
  }

  if (!("fr_cache_content" in node.properties)) node.properties.fr_cache_content = "";
  if (!("fr_cache_name"    in node.properties)) node.properties.fr_cache_name    = "";
  if (!("fr_cache_ext"     in node.properties)) node.properties.fr_cache_ext     = "";
  if (!("fr_editor"        in node.properties)) node.properties.fr_editor        = "";
}

function getCache(node) {
  const getW = (name) => {
    const w = node.widgets?.find((w) => w.name === name);
    if (w && w.value !== undefined && w.value !== null) return w.value;
    const idx = node.widgets?.findIndex((w) => w.name === name);
    if (idx >= 0 && node.widgets_values?.[idx] !== undefined && node.widgets_values[idx] !== null)
      return node.widgets_values[idx];
    return "";
  };
  
  const content = node.properties?.fr_cache_content || getW("_cached_content") || "";
  const name = node.properties?.fr_cache_name || getW("_cached_file_name") || "";
  const ext = node.properties?.fr_cache_ext || (name ? "." + name.split(".").pop() : "");

  return { content, name, ext };
}

function setCache(node, content, name, ext) {
  if (!node.properties) node.properties = {};
  node.properties.fr_cache_content = content;
  node.properties.fr_cache_name    = name;
  node.properties.fr_cache_ext     = ext;
  node.properties.fr_editor = ""; // clear user override on fresh load

  const setW = (wname, val) => {
    const w = node.widgets?.find((w) => w.name === wname);
    if (w) w.value = val || "";
  };
  setW("_cached_content", content);
  setW("_cached_file_name", name);
  setW("_editor_content", "");
}

function getEditor(node) {
  const getW = (name) => {
    const w = node.widgets?.find((w) => w.name === name);
    if (w && w.value !== undefined && w.value !== null) return w.value;
    const idx = node.widgets?.findIndex((w) => w.name === name);
    if (idx >= 0 && node.widgets_values?.[idx] !== undefined && node.widgets_values[idx] !== null)
      return node.widgets_values[idx];
    return "";
  };
  return node.properties?.fr_editor || getW("_editor_content") || "";
}

function setEditor(node, v) {
  if (!node.properties) node.properties = {};
  node.properties.fr_editor = v;

  const w = node.widgets?.find((w) => w.name === "_editor_content");
  if (w) w.value = v || "";
}

/* ─── Inline Markdown Formatting ──────────────────────────── */

function inlineFmt(t) {
  t = t.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  t = t.replace(/\*\*(.+?)\*\*/g,     "<strong>$1</strong>");
  t = t.replace(/\*(.+?)\*/g,         "<em>$1</em>");
  t = t.replace(/~~(.+?)~~/g,         "<del>$1</del>");
  t = t.replace(/`([^`]+)`/g, (_, c) => `<code class="fr-ic">${esc(c)}</code>`);
  t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%">');
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g,  '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return t;
}

/* ─── Markdown → HTML Parser ──────────────────────────────── */

function md2html(src) {
  if (!src) return "";
  src = src.replace(/\r\n/g, "\n");
  const lines = src.split("\n");
  let html = "";
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ── Fenced code block ──
    if (line.startsWith("```")) {
      let code = "";
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        code += (code ? "\n" : "") + lines[i];
        i++;
      }
      if (i < lines.length) i++;
      html += `<pre class="fr-codeblock"><code>${esc(code)}</code></pre>\n`;
      continue;
    }

    // ── Header ──
    const hMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (hMatch) {
      const lv = hMatch[1].length;
      html += `<h${lv}>${inlineFmt(hMatch[2])}</h${lv}>\n`;
      i++;
      continue;
    }

    // ── Horizontal rule ──
    if (/^[-*_]{3,}\s*$/.test(line.trim()) && line.trim().length >= 3) {
      html += "<hr>\n";
      i++;
      continue;
    }

    // ── Table ──
    if (line.includes("|") && i + 1 < lines.length && /^[\s|:\-]+$/.test(lines[i + 1])) {
      const headers = line.split("|").map((h) => h.trim()).filter(Boolean);
      i += 2;
      let tbl = "<table><thead><tr>";
      headers.forEach((h) => (tbl += `<th>${inlineFmt(h)}</th>`));
      tbl += "</tr></thead><tbody>";
      while (i < lines.length && lines[i].includes("|")) {
        const cells = lines[i].split("|").map((c) => c.trim()).filter(Boolean);
        tbl += "<tr>";
        cells.forEach((c) => (tbl += `<td>${inlineFmt(c)}</td>`));
        tbl += "</tr>";
        i++;
      }
      tbl += "</tbody></table>";
      html += tbl + "\n";
      continue;
    }

    // ── Blockquote ──
    if (line.startsWith("> ") || line === ">") {
      let q = "";
      while (i < lines.length && (lines[i].startsWith("> ") || lines[i] === ">")) {
        q += (q ? "\n" : "") + lines[i].replace(/^>\s?/, "");
        i++;
      }
      html += `<blockquote>${inlineFmt(q).replace(/\n/g, "<br>")}</blockquote>\n`;
      continue;
    }

    // ── Unordered list ──
    if (/^[\-*+]\s/.test(line)) {
      html += "<ul>\n";
      while (i < lines.length && /^[\-*+]\s/.test(lines[i])) {
        const item = lines[i].replace(/^[\-*+]\s+/, "");
        if (/^\[x\]/i.test(item)) {
          html += `<li class="fr-done">☑ ${inlineFmt(item.slice(3).trim())}</li>\n`;
        } else if (/^\[\s?\]/.test(item)) {
          html += `<li>☐ ${inlineFmt(item.slice(3).trim())}</li>\n`;
        } else {
          html += `<li>${inlineFmt(item)}</li>\n`;
        }
        i++;
      }
      html += "</ul>\n";
      continue;
    }

    // ── Ordered list ──
    if (/^\d+\.\s/.test(line)) {
      html += "<ol>\n";
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        html += `<li>${inlineFmt(lines[i].replace(/^\d+\.\s+/, ""))}</li>\n`;
        i++;
      }
      html += "</ol>\n";
      continue;
    }

    // ── Empty line ──
    if (!line.trim()) { i++; continue; }

    // ── Paragraph ──
    let p = line;
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith("```") &&
      !lines[i].startsWith("> ") &&
      !/^[\-*+]\s/.test(lines[i]) &&
      !/^\d+\.\s/.test(lines[i]) &&
      !/^[-*_]{3,}\s*$/.test(lines[i].trim())
    ) {
      p += "\n" + lines[i];
      i++;
    }
    html += `<p>${inlineFmt(p).replace(/\n/g, "<br>")}</p>\n`;
  }

  return html;
}

/* ─── Content Rendering ───────────────────────────────────── */

function renderContent(text, ext) {
  if (!text) return "";

  let truncated = false;
  let display = text;
  if (display.length > MAX_VIEWER_CHARS) {
    display = display.substring(0, MAX_VIEWER_CHARS);
    truncated = true;
  }

  const mdExts = [".md", ".markdown", ".mdx", ".mdown"];
  let html;

  if (mdExts.includes(ext)) {
    html = md2html(display);
  } else if (ext === ".json") {
    try {
      const obj = JSON.parse(display);
      const pretty = JSON.stringify(obj, null, 2);
      html = `<pre class="fr-codeblock"><code>${esc(pretty)}</code></pre>`;
    } catch {
      html = `<pre class="fr-pre">${esc(display)}</pre>`;
    }
  } else {
    html = `<pre class="fr-pre">${esc(display)}</pre>`;
  }

  if (truncated) {
    const sizeKB = (text.length / 1024).toFixed(0);
    html += `<div class="fr-truncated">⚠️ Display truncated — showing first 500 KB of ${sizeKB} KB total</div>`;
  }

  return html;
}

/* ─── SVG Icons ───────────────────────────────────────────── */

const ICON_REFRESH = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;
const ICON_COPY    = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const ICON_CHECK   = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const ICON_EDIT    = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
const ICON_SAVE    = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;

/* ─── Badge Creator ───────────────────────────────────────── */

function badgeHtml(status) {
  const labels = { live: "LIVE", cached: "CACHED", edited: "EDITED", error: "ERROR", idle: "—" };
  return `<span class="fr-badge fr-badge-${status}">${labels[status] || "—"}</span>`;
}

/* ─── Search Functionality ────────────────────────────────── */

function clearHighlights(node) {
  const fr = node._fr;
  if (!fr || !fr.viewer) return;
  fr.viewer.querySelectorAll("mark.fr-highlight, mark.fr-highlight-active").forEach(mark => {
    const parent = mark.parentNode;
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize();
  });
  if (fr.search) { fr.search.matches = []; fr.search.idx = -1; fr.search.info.textContent = "0/0"; }
}

function performSearch(node, query) {
  const fr = node._fr;
  if (!fr || !fr.search) return;
  fr.search.query = query;
  fr.search.matches = [];
  fr.search.idx = -1;
  const isViewer = fr.editor.style.display === "none";

  if (isViewer) {
    clearHighlights(node);
    if (!query) return;
    const lowerQuery = query.toLowerCase();
    const walker = document.createTreeWalker(fr.viewer, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    let nextNode;
    while ((nextNode = walker.nextNode())) textNodes.push(nextNode);

    textNodes.forEach(textNode => {
      let lowerText = textNode.nodeValue.toLowerCase();
      let idx = lowerText.indexOf(lowerQuery);
      if (idx === -1) return;
      let cur = textNode;
      while (idx !== -1) {
        const matchText = cur.nodeValue.substring(idx, idx + query.length);
        const before = cur.splitText(idx);
        const after  = before.splitText(query.length);
        const mark = document.createElement("mark");
        mark.className = "fr-highlight";
        mark.textContent = matchText;
        cur.parentNode.replaceChild(mark, before);
        fr.search.matches.push(mark);
        cur = after;
        idx = cur.nodeValue.toLowerCase().indexOf(lowerQuery);
      }
    });
  } else {
    if (!query) { fr.search.info.textContent = "0/0"; return; }
    const text = fr.editor.value.toLowerCase();
    let pos = 0;
    while ((pos = text.indexOf(query.toLowerCase(), pos)) !== -1) {
      fr.search.matches.push(pos);
      pos += query.length;
    }
  }

  if (fr.search.matches.length > 0) navigateSearch(node, 1);
  else if (query) fr.search.info.textContent = "0/0";
}

function navigateSearch(node, dir) {
  const fr = node._fr;
  if (!fr || !fr.search) return;
  const search = fr.search;
  if (!search.matches.length) return;

  if (search.idx !== -1 && typeof search.matches[search.idx] === "object")
    search.matches[search.idx].classList.remove("fr-highlight-active");

  search.idx += dir;
  if (search.idx >= search.matches.length) search.idx = 0;
  if (search.idx < 0) search.idx = search.matches.length - 1;
  search.info.textContent = `${search.idx + 1}/${search.matches.length}`;

  const isViewer = fr.editor.style.display === "none";
  if (isViewer) {
    const mark = search.matches[search.idx];
    mark.classList.add("fr-highlight-active");
    mark.scrollIntoView({ behavior: "smooth", block: "center" });
  } else {
    const editor = fr.editor;
    const start = search.matches[search.idx];
    editor.focus();
    editor.setSelectionRange(start, start + search.query.length);
    const lines = editor.value.substr(0, start).split("\n").length;
    const lh = parseFloat(getComputedStyle(editor).lineHeight) || 19;
    editor.scrollTop = Math.max(0, (lines - 3) * lh);
  }
}

/* ─── Show Content in Viewer or Editor ────────────────────── */

function showContent(node, content, ext, status, fname, error) {
  const el = node._fr;
  if (!el) return;

  el.content = content || "";
  el.status = status;
  el.fileName = fname || "";
  el.fileExt = ext || "";

  el.fnameEl.textContent = fname || (status === "error" ? "—" : "untitled");
  el.badgeEl.innerHTML = badgeHtml(status);

  if (status === "error") {
    // Before showing error, check if we have cached content to recover
    const c = getCache(node);
    const edContent = getEditor(node);
    if (edContent && edContent.trim()) {
      // Recover from editor content
      el.mode = "edit";
      showContent(node, edContent, c.ext, "edited", c.name || "recovered", error);
      return;
    }
    if (c.content && c.content.trim()) {
      // Recover from cache
      el.mode = "view";
      showContent(node, c.content, c.ext, "cached", c.name || "recovered", error);
      return;
    }
    el.viewer.style.display = "block";
    el.editor.style.display = "none";
    if (el.editBtn) el.editBtn.classList.remove("fr-active");
    if (el.saveBtn) el.saveBtn.style.display = "none";
    el.viewer.innerHTML = `
      <div class="fr-error-box">
        <span class="fr-error-icon">⚠️</span>
        <span class="fr-error-msg">${esc(error || "Unknown error")}</span>
      </div>`;
    if (el.search) el.search.info.textContent = "0/0";
    return;
  }

  // Update editor value if we receive new live/cached content from backend/API
  if (status !== "edited" && status !== "error") {
    el.editor.value = el.content;
  }

  const isEditMode = el.mode === "edit";
  if (isEditMode) {
    el.viewer.style.display = "none";
    el.editor.style.display = "block";
    if (el.editBtn) el.editBtn.classList.add("fr-active");
    if (el.saveBtn) el.saveBtn.style.display = "flex";
    if (!el.search || document.activeElement !== el.search.input) el.editor.focus();
  } else {
    el.viewer.style.display = "block";
    el.editor.style.display = "none";
    if (el.editBtn) el.editBtn.classList.remove("fr-active");
    if (el.saveBtn) el.saveBtn.style.display = "none";

    let warningBanner = "";
    if (status === "cached" && error) {
      warningBanner = `<div style="background:#3a2a1a;border:1px solid #5a4a2a;border-radius:4px;padding:6px 10px;margin-bottom:10px;font-size:11px;color:#fbbf24;display:flex;align-items:center;gap:6px;">
        <span style="font-size:14px;">⚠️</span>
        <span>File not found — showing cached copy. Update the path to reconnect.</span>
      </div>`;
    }

    const textToRender = status === "edited" ? (getEditor(node) || el.content) : el.content;
    el.viewer.innerHTML = warningBanner + renderContent(textToRender, ext);
    el.viewer.scrollTop = 0;
  }
  if (el.search && el.search.query) setTimeout(() => performSearch(node, el.search.query), 10);

  // Sync hidden widgets with cache whenever content is updated in UI
  syncHiddenWidgets(node);
}

/* ─── Sync hidden widgets with cache (backend fallback) ──── */

function syncHiddenWidgets(node) {
  const c = getCache(node);
  const edContent = getEditor(node);
  const setW = (name, val) => {
    const w = node.widgets?.find((w) => w.name === name);
    if (w) w.value = val || "";
  };
  setW("_cached_content", c.content);
  setW("_cached_file_name", c.name);
  setW("_editor_content", edContent);
}

/* ─── Update from Backend Execution ───────────────────────── */

function onExec(node, data) {
  if (!node._fr || !data) return;
  const text   = data.text?.[0] ?? "";
  const fname  = data.file_name?.[0] ?? "";
  const ext    = data.file_ext?.[0] ?? "";
  const status = data.status?.[0] ?? "error";
  const error  = data.error?.[0] ?? "";

  if (status === "live" && text) setCache(node, text, fname, ext);
  syncHiddenWidgets(node);
  showContent(node, text, ext, status, fname, error);
}

/* ─── Refresh via Server Route ────────────────────────────── */

async function refresh(node) {
  const el = node._fr;
  if (!el) return;

  const path = gw(node, "file_path");
  if (!path) {
    const c = getCache(node);
    if (c.content) showContent(node, c.content, c.ext, "cached", c.name, "No file path specified");
    else showContent(node, "", "", "error", "", "No file path specified");
    return;
  }

  el.refreshBtn.classList.add("fr-refreshing");
  try {
    const resp = await fetch(`/file_reader_311/read?path=${encodeURIComponent(path)}`);
    const data = await resp.json();

    if (data.status === "live") {
      setCache(node, data.content, data.file_name, data.file_ext);
      syncHiddenWidgets(node);
      showContent(node, data.content, data.file_ext, "live", data.file_name, "");
    } else {
      // File not found — fall back to cached content
      const edContent = getEditor(node);
      const c = getCache(node);
      if (edContent && edContent.trim()) {
        showContent(node, edContent, c.ext, "edited", c.name, data.error);
      } else if (c.content && c.content.trim()) {
        console.info(`[FileReader] File not found, showing cached content (${c.content.length} chars)`);
        showContent(node, c.content, c.ext, "cached", c.name, data.error);
      } else {
        showContent(node, "", "", "error", "", data.error || "File not found");
      }
    }
  } catch (err) {
    console.error("[FileReader] Refresh failed:", err);
    const c = getCache(node);
    if (c.content) showContent(node, c.content, c.ext, "cached", c.name, String(err));
  } finally {
    el.refreshBtn.classList.remove("fr-refreshing");
  }
}

/* ─── Copy to Clipboard ────────────────────────────────────── */

function copyContent(node) {
  const el = node._fr;
  if (!el) return;
  const text = el.editor.style.display !== "none" ? el.editor.value : el.content;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    el.copyBtn.innerHTML = ICON_CHECK;
    el.copyBtn.classList.add("fr-copied");
    setTimeout(() => { el.copyBtn.innerHTML = ICON_COPY; el.copyBtn.classList.remove("fr-copied"); }, 1500);
  });
}

/* ─── Toggle Edit/View Mode ────────────────────────────────── */

function toggleEditMode(node) {
  const el = node._fr;
  if (!el) return;

  if (el.mode === "edit") {
    el.mode = "view";
    const currentVal = el.editor.value;
    const c = getCache(node);
    if (currentVal !== c.content) {
      setEditor(node, currentVal);
      el.status = "edited";
    } else {
      setEditor(node, "");
      if (el.status === "edited") {
        el.status = "live";
      }
    }
  } else {
    el.mode = "edit";
    if (!el.editor.value) {
      const edContent = getEditor(node);
      el.editor.value = edContent || el.content || "";
    }
  }

  syncHiddenWidgets(node);
  showContent(node, el.content, el.fileExt, el.status, el.fileName, "");
}

/* ─── Save Content to Disk ─────────────────────────────────── */

async function saveToFile(node) {
  const el = node._fr;
  if (!el) return;

  const path = gw(node, "file_path");
  if (!path) {
    alert("Cannot save: No file path specified.");
    return;
  }

  const content = el.editor.value;
  
  el.saveBtn.classList.add("fr-refreshing");
  try {
    const resp = await fetch("/file_reader_311/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    });
    const data = await resp.json();

    if (data.status === "success") {
      setEditor(node, ""); 
      const fname = el.fileName || path.split(/[/\\]/).pop();
      setCache(node, content, fname, el.fileExt);
      syncHiddenWidgets(node);
      
      el.mode = "view";
      showContent(node, content, el.fileExt, "live", fname, "");
      
      el.saveBtn.innerHTML = ICON_CHECK;
      setTimeout(() => {
        el.saveBtn.innerHTML = ICON_SAVE;
      }, 1500);
    } else {
      alert(`Save failed: ${data.error}`);
    }
  } catch (err) {
    console.error("[FileReader] Save failed:", err);
    alert(`Save failed: ${err}`);
  } finally {
    el.saveBtn.classList.remove("fr-refreshing");
  }
}

/* ─── Restore Cache on Workflow Load ──────────────────────── */

function restoreCache(node) {
  if (!node._fr) return;
  initProps(node);
  const edContent = getEditor(node);
  const c = getCache(node);

  if (edContent && edContent.trim()) {
    showContent(node, edContent, c.ext, "edited", c.name, "");
  } else if (c.content && c.content.trim()) {
    showContent(node, c.content, c.ext, "live", c.name, "");
    node._fr.badgeEl.innerHTML = badgeHtml("cached");
    node._fr.status = "cached";
  }

  // Ensure widgets are populated from cache so backend execution receives them
  syncHiddenWidgets(node);
}

/* ─── Build Node UI ───────────────────────────────────────── */

function setup(node) {
  ensureCSS();

  node.size    = [550, 500];
  node.color   = "#252525";
  node.bgcolor = "#1a1a1a";

  // Hide internal cached/editor content widgets from UI to keep the node compact
  const hiddenWidgetNames = ["_cached_content", "_cached_file_name", "_editor_content"];
  if (node.widgets) {
    for (const w of node.widgets) {
      if (hiddenWidgetNames.includes(w.name)) {
        w.computeSize = () => [0, -4];
        w.draw = () => {};
      }
    }
  }

  node._fr = { content: "", status: "idle", fileName: "", fileExt: "", mode: "view" };

  // ── Container ──
  const container = document.createElement("div");
  container.className = "fr-container";

  // ── Controls ──
  const controls = document.createElement("div");
  controls.className = "fr-controls";

  const icon = document.createElement("span");
  icon.className = "fr-icon";
  icon.textContent = "📄";
  controls.appendChild(icon);

  const fnameEl = document.createElement("span");
  fnameEl.className = "fr-fname";
  fnameEl.textContent = "—";
  controls.appendChild(fnameEl);
  node._fr.fnameEl = fnameEl;

  const badgeEl = document.createElement("span");
  badgeEl.innerHTML = badgeHtml("idle");
  controls.appendChild(badgeEl);
  node._fr.badgeEl = badgeEl;

  const refreshBtn = document.createElement("button");
  refreshBtn.className = "fr-btn";
  refreshBtn.title = "Refresh file content";
  refreshBtn.innerHTML = ICON_REFRESH;
  refreshBtn.addEventListener("click", (e) => { e.stopPropagation(); refresh(node); });
  controls.appendChild(refreshBtn);
  node._fr.refreshBtn = refreshBtn;

  const copyBtn = document.createElement("button");
  copyBtn.className = "fr-btn";
  copyBtn.title = "Copy content to clipboard";
  copyBtn.innerHTML = ICON_COPY;
  copyBtn.addEventListener("click", (e) => { e.stopPropagation(); copyContent(node); });
  controls.appendChild(copyBtn);
  node._fr.copyBtn = copyBtn;

  const editBtn = document.createElement("button");
  editBtn.className = "fr-btn";
  editBtn.title = "Toggle Edit/View mode";
  editBtn.innerHTML = ICON_EDIT;
  editBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleEditMode(node); });
  controls.appendChild(editBtn);
  node._fr.editBtn = editBtn;

  const saveBtn = document.createElement("button");
  saveBtn.className = "fr-btn";
  saveBtn.title = "Save changes to file";
  saveBtn.innerHTML = ICON_SAVE;
  saveBtn.style.display = "none";
  saveBtn.addEventListener("click", (e) => { e.stopPropagation(); saveToFile(node); });
  controls.appendChild(saveBtn);
  node._fr.saveBtn = saveBtn;

  // ── Search UI ──
  const searchContainer = document.createElement("div");
  searchContainer.className = "fr-search-container";

  const searchInput = document.createElement("input");
  searchInput.className = "fr-search-input";
  searchInput.placeholder = "Find...";

  const searchInfo = document.createElement("span");
  searchInfo.className = "fr-search-info";
  searchInfo.textContent = "0/0";

  const searchNav = document.createElement("div");
  searchNav.className = "fr-search-nav";

  const prevBtn = document.createElement("button");
  prevBtn.className = "fr-search-btn";
  prevBtn.innerHTML = "▲";

  const nextBtn = document.createElement("button");
  nextBtn.className = "fr-search-btn";
  nextBtn.innerHTML = "▼";

  searchNav.appendChild(prevBtn);
  searchNav.appendChild(nextBtn);
  searchContainer.appendChild(searchInput);
  searchContainer.appendChild(searchInfo);
  searchContainer.appendChild(searchNav);
  controls.appendChild(searchContainer);

  node._fr.search = { input: searchInput, info: searchInfo, matches: [], idx: -1, query: "" };

  searchInput.addEventListener("input", (e) => {
    clearTimeout(node._fr.search.timer);
    node._fr.search.timer = setTimeout(() => performSearch(node, e.target.value), 250);
  });
  searchInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); navigateSearch(node, e.shiftKey ? -1 : 1); }
  });
  searchInput.addEventListener("keyup",    (e) => e.stopPropagation());
  searchInput.addEventListener("keypress", (e) => e.stopPropagation());
  nextBtn.addEventListener("click", (e) => { e.stopPropagation(); navigateSearch(node,  1); });
  prevBtn.addEventListener("click", (e) => { e.stopPropagation(); navigateSearch(node, -1); });

  container.appendChild(controls);

  // ── Viewer ──
  const viewer = document.createElement("div");
  viewer.className = "fr-viewer";
  viewer.innerHTML = `
    <div class="fr-placeholder">
      <span class="fr-placeholder-icon">📄</span>
      <span>Enter a file path and run the workflow<br>or click ⟳ to load content</span>
    </div>`;
  container.appendChild(viewer);
  node._fr.viewer = viewer;

  // ── Editor ──
  const editor = document.createElement("textarea");
  editor.className = "fr-editor";
  editor.spellcheck = false;
  editor.placeholder = "File content will appear here for editing when the source file is unavailable...";
  container.appendChild(editor);
  node._fr.editor = editor;

  // Debounced editor save — persists to node.properties
  let editTimer = null;
  editor.addEventListener("input", () => {
    clearTimeout(editTimer);
    editTimer = setTimeout(() => {
      setEditor(node, editor.value);
      node._fr.badgeEl.innerHTML = badgeHtml("edited");
      node._fr.status = "edited";
      node._fr.content = editor.value;
      if (node._fr.search && node._fr.search.query) performSearch(node, node._fr.search.query);
      syncHiddenWidgets(node);
    }, 500);
  });

  // Initialise properties so they are always present in the workflow JSON
  initProps(node);

  // ── Auto-refresh when file_path changes ──
  // Hook the widget callback with a debounce so the file loads the moment
  // the user finishes typing or pastes a new path.
  const fpWidget = node.widgets?.find((w) => w.name === "file_path");
  if (fpWidget) {
    const _origCb = fpWidget.callback;
    fpWidget.callback = function (value) {
      _origCb?.apply(this, arguments);
      clearTimeout(node._fr._pathTimer);
      node._fr._pathTimer = setTimeout(() => {
        if (value && value.trim()) refresh(node);
      }, 600); // wait 600 ms after last keystroke
    };
  }

  // ── Add DOM Widget ──
  const widget = node.addDOMWidget("file_viewer", "custom", container, { serialize: false });
  widget.computeSize = function (width) {
    return [width, Math.max(200, (node.size?.[1] || 500) - 76)];
  };
  node._fr.widget = widget;

  // ── Auto-restore on setup ──
  // configure() may have already fired (and set _fr_pending_configure).
  // In that case, execute the deferred restore now that _fr exists.
  setTimeout(() => {
    if (node._fr_pending_configure) {
      delete node._fr_pending_configure;
      const path = gw(node, "file_path");
      if (path && path.trim()) {
        refresh(node).catch(() => restoreCache(node));
      } else {
        restoreCache(node);
      }
      return;
    }
    if (node._fr_configure_done) return;
    const path = gw(node, "file_path");
    if (path && path.trim()) refresh(node).catch(() => restoreCache(node));
    else restoreCache(node);
  }, 150);
}

/* ─── Extension Registration ──────────────────────────────── */

app.registerExtension({
  name: "ComfyUI-311-Tool-Suite.FileReader311",

  async setup() { ensureCSS(); },

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (!NODE_TYPES.includes(nodeData.name)) return;

    const origExec = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (data) {
      origExec?.apply(this, arguments);
      onExec(this, data);
    };

    // Hook configure — node._fr may not exist yet when this fires.
    // If _fr doesn't exist yet, defer the restore to setup().
    const origCfg = nodeType.prototype.configure;
    nodeType.prototype.configure = function (data) {
      origCfg?.apply(this, arguments);
      if (this._fr) {
        const path = gw(this, "file_path");
        if (path && path.trim()) refresh(this).catch(() => restoreCache(this));
        else restoreCache(this);
        this._fr_configure_done = true;
      } else {
        // _fr not ready yet — defer to setup()
        this._fr_pending_configure = true;
      }
    };
  },

  nodeCreated(node) {
    if (!NODE_TYPES.includes(node.comfyClass)) return;
    setup(node);
  },
});
