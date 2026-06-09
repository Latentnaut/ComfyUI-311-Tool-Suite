import { app } from "../../scripts/app.js";

// LiteGraph constants
const TYPE_INPUT = 1;

function addDynamicBehavior(nodeType, nodeData, prefix, dataType) {
    const origOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        if (origOnNodeCreated) { origOnNodeCreated.apply(this, arguments); }
        this._dirty_slots = false;
    };

    function performCleanup(node) {
        if (!node.graph) return;

        // Find all inputs matching the prefix
        let dynInputs = [];
        for (let i = 0; i < node.inputs.length; i++) {
            if (node.inputs[i].name && node.inputs[i].name.startsWith(prefix)) {
                dynInputs.push(node.inputs[i]);
            }
        }

        // If the last one is connected, add a new one
        let lastInput = dynInputs[dynInputs.length - 1];
        if (lastInput && lastInput.link != null) {
            // Get the numerical suffix using regex
            let match = lastInput.name.match(/\d+$/);
            let nextNum = match ? parseInt(match[0], 10) + 1 : dynInputs.length + 1;
            let newName = prefix + nextNum;
            
            node.addInput(newName, dataType);
            node.setDirtyCanvas(true, true);
        }

        // Remove unused trailing inputs (keep at least 2)
        // Reverse loop
        let removed = true;
        while (removed) {
            removed = false;
            
            let currentDynInputs = [];
            for (let i = 0; i < node.inputs.length; i++) {
                if (node.inputs[i].name && node.inputs[i].name.startsWith(prefix)) {
                    currentDynInputs.push({ index: i, input: node.inputs[i] });
                }
            }
            
            if (currentDynInputs.length <= 2) break; // keep at least 2
            
            // Inspect the last two
            let last1 = currentDynInputs[currentDynInputs.length - 1];
            let last2 = currentDynInputs[currentDynInputs.length - 2];
            
            if (last1.input.link == null && last2.input.link == null) {
                node.removeInput(last1.index);
                removed = true;
                node.setDirtyCanvas(true, true);
            }
        }
    }

    const origOnConnectionsChange = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (slotType, slotIdx, isConnected, linkInfo, nodeSlot) {
        if (origOnConnectionsChange) {
            origOnConnectionsChange.apply(this, arguments);
        }

        if (slotType !== TYPE_INPUT) return;

        // Schedule check
        setTimeout(() => {
            const canvas = (typeof app !== "undefined" && app.canvas) || this.graph?.canvas;
            if (canvas && canvas.connecting_node != null) {
                this._dirty_slots = true;
                return;
            }
            performCleanup(this);
        }, 50);
    };

    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
        if (origDraw) origDraw.apply(this, arguments);

        const canvas = (typeof app !== "undefined" && app.canvas) || this.graph?.canvas;
        if (this._dirty_slots && (!canvas || !canvas.connecting_node)) {
            this._dirty_slots = false;
            performCleanup(this);
        }
    };
}

app.registerExtension({
    name: "ComfyUI-311-Tool-Suite.DynamicInputs",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "ImageBatch311") {
            addDynamicBehavior(nodeType, nodeData, "image", "IMAGE");
        }
        if (nodeData.name === "JoinString311") {
            addDynamicBehavior(nodeType, nodeData, "string", "STRING");
        }
    }
});
