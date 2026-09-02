import { app } from "../../scripts/app.js";

console.log("[311] loading any_switch_311_v30.js");

const NODE_NAME = "AnySwitch311";

let is_loading_graph = true;

// ─── Drawing helpers ───────────────────────────────────────────────
function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function getHighlightColor(bgHex) {
    var r = 34, g = 34, b = 34;
    if (bgHex && bgHex.startsWith("#")) {
        var hex = bgHex.substring(1);
        if (hex.length === 3) {
            r = parseInt(hex[0] + hex[0], 16);
            g = parseInt(hex[1] + hex[1], 16);
            b = parseInt(hex[2] + hex[2], 16);
        } else if (hex.length === 6) {
            r = parseInt(hex.substring(0, 2), 16);
            g = parseInt(hex.substring(2, 4), 16);
            b = parseInt(hex.substring(4, 6), 16);
        }
    }
    var luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    return luminance < 30
        ? "rgba(255, 255, 255, 0.08)"
        : "rgba(0, 0, 0, 0.35)";
}

function isDefaultName(s) {
    if (!s) return true;
    var clean = s.toString().trim();
    if (/^value\d+$/i.test(clean) || /^(values\.)?value\d+$/i.test(clean)) return true;
    if (/^\d+\.\s*(values\.)?value\d+$/i.test(clean)) return true;
    if (/^\d+\.\s*$/i.test(clean)) return true;
    return false;
}

// ─── Widget / input helpers ────────────────────────────────────────
function findIndexWidget(node) {
    if (!node.widgets) return null;
    var w = node.widgets.find(function (x) {
        return x.name && x.name.toLowerCase() === "index";
    });
    if (w) return w;
    w = node.widgets.find(function (x) {
        return x.type === "number" || x.type === "slider" || x.type === "integer";
    });
    if (w) return w;
    return node.widgets[0];
}

function alignInputNames(node) {
    if (!node.inputs) return;
    var valIdx = 0;
    for (var i = 0; i < node.inputs.length; i++) {
        var inp = node.inputs[i];
        if (inp && inp.name && inp.name !== "index") {
            var expectedName = "value" + valIdx;
            if (inp.name !== expectedName) {
                inp.name = expectedName;
            }
            valIdx++;
        }
    }
}

// ─── Custom label persistence ──────────────────────────────────────
function getLabels(node) {
    if (!node.properties) node.properties = {};
    if (!node.properties.customLabels) {
        node.properties.customLabels = {};
    } else if (Array.isArray(node.properties.customLabels)) {
        var oldArr = node.properties.customLabels;
        var newObj = {};
        for (var i = 0; i < oldArr.length; i++) {
            if (oldArr[i]) {
                if (node.inputs && node.inputs[i]) {
                    newObj[node.inputs[i].name] = oldArr[i];
                } else {
                    newObj["value" + i] = oldArr[i];
                }
            }
        }
        node.properties.customLabels = newObj;
    }
    return node.properties.customLabels;
}

/** Real slot title for menus/dialogs. Drawing may temporarily set inp.label to " ". */
function realSlotLabel(node, inp) {
    if (!inp) return "";
    if (!inp.name || inp.name === "index") return inp.label || inp.name || "";
    var labels = getLabels(node);
    var saved = labels[inp.name];
    if (saved && saved !== " " && !isDefaultName(saved)) return saved;
    if (inp._311label && inp._311label !== " " && !isDefaultName(inp._311label)) return inp._311label;
    if (inp.label && inp.label !== " " && !isDefaultName(inp.label)) return inp.label;
    return inp.name;
}

function restoreSlotLabel(node, inp) {
    if (!inp || !inp.name || inp.name === "index") return;
    inp.label = realSlotLabel(node, inp);
}

function restoreAllSlotLabels(node) {
    if (!node.inputs) return;
    for (var i = 0; i < node.inputs.length; i++) {
        restoreSlotLabel(node, node.inputs[i]);
    }
}

/** Called once during onConfigure to capture labels from saved JSON. */
function captureLabelsFromSavedData(node, data) {
    if (!data || !data.inputs) return;
    var labels = getLabels(node);
    for (var i = 0; i < data.inputs.length; i++) {
        var name = data.inputs[i].name;
        var lbl = data.inputs[i].label || "";
        if (name && lbl && !isDefaultName(lbl) && lbl !== " ") {
            if (!labels[name]) {
                labels[name] = lbl;
            }
        }
    }
}

function updateIndexMax(node) {
    alignInputNames(node);
    if (!node.inputs || !node.widgets) return;
    
    var dataSlotsCount = 0;
    for (var i = 0; i < node.inputs.length; i++) {
        if (node.inputs[i] && node.inputs[i].name !== "index") {
            dataSlotsCount++;
        }
    }
    var maxIdx = Math.max(0, dataSlotsCount - 1);
    
    var iw = findIndexWidget(node);
    if (iw) {
        if (!iw.options) iw.options = {};
        iw.options.max = maxIdx;
        if (iw.value > maxIdx) {
            iw.value = maxIdx;
            if (iw.callback) iw.callback(maxIdx);
        }
    }
}

// ─── Autogrow / Dynamic Slot Management ────────────────────────────
function handleGrowOnConnection(node) {
    if (!node.inputs) return;
    
    var dataSlots = [];
    for (var i = 0; i < node.inputs.length; i++) {
        var inp = node.inputs[i];
        if (inp && inp.name !== "index") {
            dataSlots.push(inp);
        }
    }
    
    if (dataSlots.length === 0) return;
    
    var lastSlot = dataSlots[dataSlots.length - 1];
    if (lastSlot && lastSlot.link != null) {
        if (dataSlots.length >= 60) {
            console.warn("[AnySwitch311] Maximum inputs reached (60)");
            return;
        }
        node.addInput("value" + dataSlots.length, "*");
        alignInputNames(node);
    }
}

function cleanupTrailingEmptySlots(node) {
    if (!node.inputs) return;
    
    alignInputNames(node);
    
    var dataSlots = [];
    for (var i = 0; i < node.inputs.length; i++) {
        if (node.inputs[i] && node.inputs[i].name !== "index") {
            dataSlots.push({
                indexInNode: i,
                inp: node.inputs[i]
            });
        }
    }
    
    if (dataSlots.length === 0) {
        node.addInput("value0", "*");
        return;
    }
    
    while (dataSlots.length > 1) {
        var lastSlot = dataSlots[dataSlots.length - 1];
        var prevSlot = dataSlots[dataSlots.length - 2];
        
        // Remove trailing empty slots if the penúltimo slot is also empty
        if (lastSlot.inp.link == null && prevSlot.inp.link == null) {
            node.removeInput(lastSlot.indexInNode);
            dataSlots.pop();
        } else {
            break;
        }
    }
    
    alignInputNames(node);
    
    // Recalculate size to prevent gigantic heights on node creation/F5 cleanup
    var size = node.computeSize();
    if (size) {
        node.size[1] = size[1]; // Only update the height, preserve manual width adjustments (size[0])
    }
}

// ─── Main setup ────────────────────────────────────────────────────
function setup311(node) {
    if (node._sw311) return;
    node._sw311 = true;
    node._dirty_slots = false;
    console.log("[311] setup311 on node", node.id);

    // INMEDIATE Cleanup for UI interactive node creation:
    // If the node is newly created by the user, we clean up empty slots immediately
    // to prevent the node from rendering with Python's default 60 empty inputs on the first frames.
    if (!is_loading_graph && node.inputs && node.inputs.length > 2) {
        cleanupTrailingEmptySlots(node);
        updateIndexMax(node);
    }

    // DEFERRED Cleanup for Workflow/Graph Loading:
    // We defer another cleanup run by 150ms to allow LiteGraph to link graph connections
    // during initial page loading, preventing spontaneous link disconnection.
    setTimeout(function () {
        cleanupTrailingEmptySlots(node);
        updateIndexMax(node);
        node.setDirtyCanvas(true, true);
    }, 150);

    // Override removeInput to clean labels and update maximums
    var origRemoveInput = node.removeInput;
    node.removeInput = function (slot) {
        var labels = getLabels(this);
        var inp = this.inputs[slot];
        if (inp && inp.name) {
            delete labels[inp.name];
        }
        
        var result;
        if (origRemoveInput) {
            result = origRemoveInput.apply(this, arguments);
        }
        
        alignInputNames(this);
        updateIndexMax(this);
        this.setDirtyCanvas(true, true);
        return result;
    };

    // Override onConnectionsChange to handle our custom Autogrow
    var origCC = node.onConnectionsChange;
    node.onConnectionsChange = function (type, slotIndex, connected, link_info, input_info) {
        if (origCC) origCC.apply(this, arguments);
        
        if (type === 1) { // 1 = Input
            var self = this;
            setTimeout(function () {
                if (connected) {
                    handleGrowOnConnection(self);
                } else {
                    var canvas = (typeof app !== "undefined" && app.canvas) || self.graph?.canvas;
                    if (canvas && canvas.connecting_node != null) {
                        self._dirty_slots = true;
                    } else {
                        cleanupTrailingEmptySlots(self);
                    }
                }
                alignInputNames(self);
                updateIndexMax(self);
                self.setDirtyCanvas(true, true);
            }, 50);
        }
    };

    // ComfyUI Rename Slot reads getInputInfo(slot).label (not getContextMenuOptions).
    var origGetInputInfo = node.getInputInfo;
    node.getInputInfo = function (slot) {
        var info = origGetInputInfo
            ? origGetInputInfo.apply(this, arguments)
            : (this.inputs && slot < this.inputs.length ? this.inputs[slot] : null);
        restoreSlotLabel(this, info);
        return info;
    };

    var origGetContextMenuOptions = node.getContextMenuOptions || node.constructor.prototype.getContextMenuOptions;
    node.getContextMenuOptions = function (canvas) {
        restoreAllSlotLabels(this);
        if (origGetContextMenuOptions) {
            return origGetContextMenuOptions.apply(this, arguments);
        }
        return [];
    };

    // ── Pre-draw slots label hide ──
    var origDrawBg = node.onDrawBackground;
    node.onDrawBackground = function (ctx) {
        if (origDrawBg) origDrawBg.apply(this, arguments);
        
        try {
            var iw = findIndexWidget(this);
            if (!iw || !this.inputs) return;
            var selIdx = iw.value;
            var labels = getLabels(this);
            
            for (var i = 0; i < this.inputs.length; i++) {
                var inp = this.inputs[i];
                if (!inp || !inp.name || inp.name === "index") continue;
                
                var match = inp.name.match(/(values\.)?value(\d+)$/);
                if (!match) continue;
                
                var idx = parseInt(match[2], 10);
                
                // ── Step 1: Detect user rename from context menu prompt (run for all slots) ──
                if (inp._311label !== undefined &&
                    inp.label !== undefined &&
                    inp.label !== inp._311label &&
                    inp.label !== " ") {
                    
                    var trimmed = (inp.label || "").trim();
                    if (trimmed === "" || isDefaultName(trimmed)) {
                        delete labels[inp.name];
                    } else {
                        labels[inp.name] = inp.label;
                    }
                }
                
                var displayedName = labels[inp.name] || inp.name;
                
                if (idx === selIdx) {
                    inp.label = " ";
                } else {
                    inp.label = displayedName;
                }
            }
        } catch (e) {
            console.error("[AnySwitch311] drawBackground error:", e);
        }
    };

    // ── Draw (Implicit renaming detection and passive rendering) ──
    var origDraw = node.onDrawForeground;
    node.onDrawForeground = function (ctx) {
        try {
            if (origDraw) origDraw.call(this, ctx);

            var canvas = (typeof app !== "undefined" && app.canvas) || this.graph?.canvas;
            if (this._dirty_slots && (!canvas || !canvas.connecting_node)) {
                this._dirty_slots = false;
                cleanupTrailingEmptySlots(this);
                updateIndexMax(this);
                this.setDirtyCanvas(true, true);
            }

            var iw = findIndexWidget(this);
            if (!iw || !this.inputs) return;

            alignInputNames(this);

            var labels = getLabels(this);
            var selIdx = iw.value;

            for (var i = 0; i < this.inputs.length; i++) {
                var inp = this.inputs[i];
                if (!inp || !inp.name || inp.name === "index") continue;
                
                var match = inp.name.match(/(values\.)?value(\d+)$/);
                if (!match) continue;

                var idx = parseInt(match[2], 10);
                var cleanName = inp.name;

                // ── Step 1: Detect user rename from context menu prompt (fallback if drawBackground was skipped) ──
                if (inp._311label !== undefined &&
                    inp.label !== undefined &&
                    inp.label !== inp._311label &&
                    inp.label !== " ") {
                    
                    var trimmed = (inp.label || "").trim();
                    if (trimmed === "" || isDefaultName(trimmed)) {
                        delete labels[inp.name];
                    } else {
                        labels[inp.name] = inp.label;
                    }
                }

                // ── Step 2: Determine display name ──
                var displayedName = labels[inp.name] || cleanName;

                // ── Step 3: Render ──
                if (idx === selIdx) {
                    inp._311label = displayedName;
                    inp.label = " ";

                    var connPos = this.getConnectionPos(true, i);
                    if (connPos) {
                        var slotY = connPos[1] - this.pos[1];
                        var bg = this.bgcolor ||
                            (typeof LiteGraph !== "undefined" && LiteGraph.NODE_DEFAULT_BGCOLOR) ||
                            "#222222";

                        ctx.save();
                        ctx.fillStyle = getHighlightColor(bg);
                        rrect(ctx, 6, slotY - 9, this.size[0] - 12, 18, 4);
                        ctx.fill();

                        // Soft amber warning border if the selected slot is empty/disconnected
                        if (inp.link === null) {
                            ctx.strokeStyle = "rgba(240, 140, 20, 0.4)";
                            ctx.lineWidth = 1;
                            ctx.stroke();
                        }
                        ctx.restore();

                        ctx.save();
                        ctx.font = "bold 12px Inter, Arial, sans-serif";
                        ctx.fillStyle = inp.link !== null ? "#ffffff" : "#f0aa50";
                        ctx.textAlign = "left";
                        ctx.textBaseline = "middle";
                        ctx.fillText(displayedName, 20, slotY);
                        ctx.restore();
                    }
                } else {
                    inp.label = displayedName;
                    inp._311label = displayedName;
                }
            }
        } catch (e) {
            console.error("[AnySwitch311] draw error:", e);
        }
    };

    // ── Click ──
    node.onMouseDown = function (e, lp) {
        var x = (lp && lp[0] !== undefined) ? lp[0]
            : ((lp && lp.x !== undefined) ? lp.x
                : (e.canvasX !== undefined ? e.canvasX - this.pos[0] : e.offsetX));
        var y = (lp && lp[1] !== undefined) ? lp[1]
            : ((lp && lp.y !== undefined) ? lp.y
                : (e.canvasY !== undefined ? e.canvasY - this.pos[1] : e.offsetY));

        if (this.inputs && x > 12 && x < this.size[0] - 12) {
            alignInputNames(this);
            for (var i = 0; i < this.inputs.length; i++) {
                var inp = this.inputs[i];
                if (!inp || !inp.name || inp.name === "index") continue;
                
                var connPos = this.getConnectionPos(true, i);
                if (!connPos) continue;
                
                var slotY = connPos[1] - this.pos[1];
                if (y >= slotY - 10 && y < slotY + 10) {
                    var match = inp.name.match(/(values\.)?value(\d+)$/);
                    if (match) {
                        var idx = parseInt(match[2], 10);
                        if (!isNaN(idx)) {
                            var iw = findIndexWidget(this);
                            if (iw) {
                                iw.value = idx;
                                if (iw.callback) iw.callback(idx);
                                this.setDirtyCanvas(true, true);
                                if (this.graph) this.graph.change();
                                return true;
                            }
                        }
                    }
                }
            }
        }
        return false;
    };

    // ── Serialize ──
    var origSerialize = node.onSerialize;
    node.onSerialize = function (data) {
        var labels = getLabels(this);
        if (origSerialize) origSerialize.apply(this, arguments);
        if (data && data.inputs && this.inputs) {
            for (var i = 0; i < data.inputs.length; i++) {
                var inp = this.inputs[i];
                if (inp && inp.name) {
                    data.inputs[i].label = labels[inp.name] || inp.name;
                }
            }
        }
    };
}

// ─── Extension registration ───────────────────────────────────────
app.registerExtension({
    name: "ComfyUI-311-Tool-Suite.AnySwitch311.v30",

    setup() {
        // Clear loading flag after app setup phase
        setTimeout(function () {
            is_loading_graph = false;
        }, 500);
    },

    beforeConfigureGraph(graphData, missingNodeTypes) {
        is_loading_graph = true;
    },

    afterConfigureGraph(missingNodeTypes) {
        setTimeout(function () {
            is_loading_graph = false;
        }, 50);
    },

    nodeCreated(node) {
        if (node.type === NODE_NAME || node.comfyClass === NODE_NAME) {
            setup311(node);
        }
    },

    loadedGraphNode(node) {
        if (node.type === NODE_NAME || node.comfyClass === NODE_NAME) {
            setup311(node);
            // Always run cleanup after loading to handle delayed configurations
            setTimeout(function () {
                cleanupTrailingEmptySlots(node);
                updateIndexMax(node);
                node.setDirtyCanvas(true, true);
            }, 100);
        }
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;

        console.log("[311] Registering AnySwitch311 prototype overrides (v30)");

        var origNC = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            if (origNC) origNC.apply(this, arguments);
            setup311(this);
        };

        var origOC = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (d) {
            captureLabelsFromSavedData(this, d);
            if (origOC) origOC.apply(this, arguments);
            setup311(this);
        };
    }
});
