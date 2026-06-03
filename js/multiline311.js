import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "ComfyUI-311-Tool-Suite.Multiline311",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "Multiline 311") {
            // Helper: parse a hex color and return a slightly lighter version
            const lightenColor = (hex) => {
                if (!hex) return "#555";
                const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
                if (!m) return "#555";
                const r = Math.min(255, parseInt(m[1], 16) + 40);
                const g = Math.min(255, parseInt(m[2], 16) + 40);
                const b = Math.min(255, parseInt(m[3], 16) + 40);
                return `rgb(${r},${g},${b})`;
            };

            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                
                // Initialize properties
                this.properties = this.properties || {};
                this.properties.history = this.properties.history || [];
                
                this._historyIndex = -1;

                const textWidget = this.widgets.find(w => w.name === "text");
                if (!textWidget) return r;

                // Load backup from localStorage if properties history is empty
                try {
                    const backup = localStorage.getItem(`multiline311_history_${this.id}`);
                    if (backup && this.properties.history.length === 0) {
                        this.properties.history = JSON.parse(backup);
                    }
                } catch (e) {
                    console.warn("[Multiline 311] Failed to load history backup", e);
                }

                const saveBackup = () => {
                    try {
                        localStorage.setItem(`multiline311_history_${this.id}`, JSON.stringify(this.properties.history));
                    } catch (e) {}
                };

                // ─── Build DOM navigation bar ───
                const container = document.createElement("div");
                container.style.display = "flex";
                container.style.alignItems = "center";
                container.style.gap = "3px";
                container.style.padding = "0";
                container.style.margin = "-6px 0 46px 0";
                container.style.height = "18px";
                container.style.boxSizing = "border-box";

                const btnStyle = (el) => {
                    el.style.background = "#333";
                    el.style.color = "#777";
                    el.style.border = "1px solid #444";
                    el.style.borderRadius = "4px";
                    el.style.cursor = "pointer";
                    el.style.fontSize = "10px";
                    el.style.fontFamily = "Arial, sans-serif";
                    el.style.padding = "2px 0";
                    el.style.lineHeight = "1";
                    el.style.textAlign = "center";
                    el.onmouseenter = () => { el.style.color = "#fff"; el.style.background = lightenColor(el._nodeColor || "#333"); };
                    el.onmouseleave = () => { el.style.color = "#777"; el.style.background = el._nodeColor || "#333"; };
                };

                // Prev button
                const prevBtn = document.createElement("button");
                prevBtn.textContent = "◀";
                prevBtn.style.flex = "0 0 25%";
                btnStyle(prevBtn);

                // Center label / New button
                const centerBtn = document.createElement("button");
                centerBtn.textContent = "Page 0 / 0";
                centerBtn.style.flex = "1 1 50%";
                btnStyle(centerBtn);

                // Next button
                const nextBtn = document.createElement("button");
                nextBtn.textContent = "▶";
                nextBtn.style.flex = "0 0 25%";
                btnStyle(nextBtn);

                container.appendChild(prevBtn);
                container.appendChild(centerBtn);
                container.appendChild(nextBtn);

                // ─── Navigation logic ───
                const updateLabel = () => {
                    const arr = this.properties.history;
                    const total = arr.length;
                    let current = this._historyIndex + 1;
                    if (this._historyIndex >= total) {
                        current = "New";
                    }
                    centerBtn.textContent = `Page ${current} / ${total}`;
                    app.graph.setDirtyCanvas(true);
                };

                const syncTextarea = (val) => {
                    textWidget.value = val;
                    if (textWidget.inputEl) textWidget.inputEl.value = val;
                };

                prevBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const arr = this.properties.history;
                    if (this._historyIndex > 0) {
                        this._historyIndex--;
                        syncTextarea(arr[this._historyIndex]);
                        updateLabel();
                    }
                });

                centerBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const arr = this.properties.history;
                    const currentText = (textWidget.value || "").trim();
                    if (currentText !== "") {
                        if (arr.length === 0 || arr[arr.length - 1] !== currentText) {
                            arr.push(currentText);
                            saveBackup();
                        }
                    }
                    this._historyIndex = arr.length;
                    syncTextarea("");
                    updateLabel();
                });

                nextBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const arr = this.properties.history;
                    if (this._historyIndex >= 0 && this._historyIndex < arr.length - 1) {
                        this._historyIndex++;
                        syncTextarea(arr[this._historyIndex]);
                    } else if (this._historyIndex === arr.length - 1) {
                        this._historyIndex = arr.length;
                        syncTextarea("");
                    }
                    updateLabel();
                });

                // Add as DOM widget (serialize: false — data lives in properties.history)
                const navWidget = this.addDOMWidget("nav_bar", "div", container, {
                    serialize: false,
                    getMinHeight: () => 20,
                    getMaxHeight: () => 20,
                });

                // Force minimal height for this widget
                navWidget.computeSize = () => [100, 20];

                // Add invisible spacer widget to force real bottom padding in the node
                const spacerEl = document.createElement("div");
                spacerEl.style.height = "0px";
                spacerEl.style.pointerEvents = "none";
                const spacerWidget = this.addDOMWidget("spacer_bottom", "div", spacerEl, {
                    serialize: false,
                    getMinHeight: () => 10,
                    getMaxHeight: () => 10,
                });
                spacerWidget.computeSize = () => [100, 10];

                // Auto-fit node size
                const targetWidth = 210;
                const sz = this.computeSize();
                this.setSize([Math.max(targetWidth, sz[0]), sz[1]]);

                // ─── Auto-save edits to current page ───
                const originalCallback = textWidget.callback;
                textWidget.callback = (value) => {
                    if (originalCallback) originalCallback(value);
                    const arr = this.properties.history;
                    const trimmed = (value || "").trim();
                    
                    if (this._historyIndex >= 0 && this._historyIndex < arr.length) {
                        arr[this._historyIndex] = value;
                        saveBackup();
                    } else if (this._historyIndex === arr.length) {
                        if (trimmed !== "") {
                            arr.push(value);
                            this._historyIndex = arr.length - 1;
                            saveBackup();
                            updateLabel();
                        }
                    }
                };

                // ─── Deferred init (wait for properties from JSON) ───
                setTimeout(() => {
                    const arr = this.properties.history;
                    if (!Array.isArray(arr)) {
                        this.properties.history = [];
                    }
                    
                    const currentText = textWidget.value;
                    const idx = this.properties.history.indexOf(currentText);
                    
                    if (idx !== -1) {
                        this._historyIndex = idx;
                    } else {
                        if ((currentText || "").trim() !== "") {
                            this.properties.history.push(currentText);
                            this._historyIndex = this.properties.history.length - 1;
                            saveBackup();
                        } else {
                            this._historyIndex = this.properties.history.length;
                        }
                    }
                    updateLabel();
                }, 100);

                return r;
            };

            // ─── Sync button colors when node color changes ───
            const onDrawBackground = nodeType.prototype.onDrawBackground;
            nodeType.prototype.onDrawBackground = function(ctx) {
                if (onDrawBackground) onDrawBackground.apply(this, arguments);
                const navWidget = this.widgets && this.widgets.find(w => w.name === "nav_bar");
                if (!navWidget || !navWidget.element) return;
                const btns = navWidget.element.querySelectorAll("button");
                // Use node bgcolor if set, otherwise node color, otherwise default
                const nodeColor = this.bgcolor || this.color || null;
                btns.forEach(btn => {
                    if (btn._nodeColor !== nodeColor) {
                        btn._nodeColor = nodeColor;
                        btn.style.background = nodeColor || "#333";
                        btn.style.border = `1px solid ${nodeColor ? lightenColor(nodeColor) : "#444"}`;
                    }
                });
            };
            
            // Handle configure to ensure loaded properties are picked up cleanly
            const onConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function (info) {
                if (onConfigure) {
                    onConfigure.apply(this, arguments);
                }
                if (this.properties && Array.isArray(this.properties.history)) {
                    const textWidget = this.widgets.find(w => w.name === "text");
                    if (textWidget) {
                        const idx = this.properties.history.indexOf(textWidget.value);
                        if (idx !== -1) {
                            this._historyIndex = idx;
                        } else {
                            this._historyIndex = this.properties.history.length;
                        }
                    }
                }
            };
        }
    }
});
