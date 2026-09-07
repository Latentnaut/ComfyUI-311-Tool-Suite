import { app } from "../../scripts/app.js";

// Port of KJNodes SetNode / GetNode.
// Canonical types: "SetNode 311" / "GetNode 311". Legacy "SetNode" / "GetNode" still load.
// Based on diffus3's SetGet: https://github.com/diffus3/ComfyUI-extensions

const TYPE_SET = "SetNode 311";
const TYPE_GET = "GetNode 311";
const TYPE_SET_LEGACY = "SetNode";
const TYPE_GET_LEGACY = "GetNode";

function isSetType(type) {
	return type === TYPE_SET || type === TYPE_SET_LEGACY;
}

function isGetType(type) {
	return type === TYPE_GET || type === TYPE_GET_LEGACY;
}

function isSetOrGetType(type) {
	return isSetType(type) || isGetType(type);
}

const TITLE_MARK = "⚡";
const AUTO_TITLE_PROP = "n311AutoTitle";

function constantValue(node) {
	return String(node.widgets?.[0]?.value ?? "").trim();
}

function autoTitleFor(node) {
	const name = constantValue(node);
	return name ? `${TITLE_MARK} ${name}` : TITLE_MARK;
}

function isAutoTitleEnabled(node) {
	return node.properties?.[AUTO_TITLE_PROP] === true;
}

function applyAutoTitle(node) {
	if (!isAutoTitleEnabled(node)) return;
	node._n311ApplyingAutoTitle = true;
	node.title = autoTitleFor(node);
	node._n311ApplyingAutoTitle = false;
	node.setDirtyCanvas?.(true, true);
}

function wrapConfigure(node) {
	if (node._n311ConfigureWrapped) return;
	node._n311ConfigureWrapped = true;
	const original = node.configure;
	node.configure = function (info) {
		this._n311Configuring = true;
		const result = original ? original.apply(this, arguments) : undefined;
		this._n311Configuring = false;
		const saved = info?.properties;
		if (saved && Object.prototype.hasOwnProperty.call(saved, AUTO_TITLE_PROP)) {
			this.properties[AUTO_TITLE_PROP] = saved[AUTO_TITLE_PROP] === true;
		} else if (saved) {
			this.properties[AUTO_TITLE_PROP] = false;
		}
		installTitleWatch(this);
		hookWidgetTyping(this);
		if (isAutoTitleEnabled(this)) {
			applyAutoTitle(this);
		}
		return result;
	};
}

function installTitleWatch(node) {
	if (node._n311TitleWatch) return;
	node._n311TitleWatch = true;
	wrapConfigure(node);
	let current = node.title;
	try {
		Object.defineProperty(node, "title", {
			configurable: true,
			enumerable: true,
			get() {
				return current;
			},
			set(v) {
				const next = v == null ? "" : String(v);
				if (
					!node._n311ApplyingAutoTitle &&
					!node._n311Configuring &&
					isAutoTitleEnabled(node) &&
					next !== autoTitleFor(node)
				) {
					node.properties[AUTO_TITLE_PROP] = false;
				}
				current = next;
			},
		});
	} catch (_err) {
		/* keep native title if the instance already locked it */
	}
}

function initAutoTitle(node, fromSavedGraph) {
	if (!node.properties) node.properties = {};
	if (fromSavedGraph) {
		if (node.properties[AUTO_TITLE_PROP] !== true) {
			node.properties[AUTO_TITLE_PROP] = false;
		}
	} else if (node.properties[AUTO_TITLE_PROP] === undefined) {
		node.properties[AUTO_TITLE_PROP] = true;
	}
	installTitleWatch(node);
	if (isAutoTitleEnabled(node)) {
		applyAutoTitle(node);
	}
}

function hookWidgetTyping(node) {
	const widget = node.widgets?.[0];
	if (!widget || widget._n311AutoTitleHooked) return;
	widget._n311AutoTitleHooked = true;
	const original = widget.callback;
	widget.callback = function (...args) {
		const result = original ? original.apply(this, args) : undefined;
		applyAutoTitle(node);
		return result;
	};
	const bindInput = () => {
		const el = widget.inputEl || widget.element;
		if (!el || el._n311AutoTitle) return;
		el._n311AutoTitle = true;
		el.addEventListener("input", () => {
			widget.value = el.value;
			applyAutoTitle(node);
			node.setDirtyCanvas?.(true, true);
		});
	};
	bindInput();
	setTimeout(bindInput, 0);
	setTimeout(bindInput, 150);
}

function copySetGetConnections(src, dest) {
	if (src.inputs) {
		for (const input of src.inputs) {
			if (!input?.link) continue;
			const link = app.graph.links[input.link];
			if (!link) continue;
			const origin = app.graph.getNodeById(link.origin_id);
			origin?.connect(link.origin_slot, dest.id, input.name);
		}
	}
	if (src.outputs) {
		for (let i = 0; i < src.outputs.length; i++) {
			const output = src.outputs[i];
			if (!output?.links?.length) continue;
			for (const linkId of [...output.links]) {
				const link = app.graph.links[linkId];
				if (!link) continue;
				const target = app.graph.getNodeById(link.target_id);
				if (target) {
					dest.connect(i, target, link.target_slot);
				}
			}
		}
	}
}

function recreateSetGetWithAutoTitle(oldNode) {
	const type = oldNode.type;
	const pos = [oldNode.pos[0], oldNode.pos[1]];
	const constant = oldNode.widgets?.[0]?.value ?? "";
	const previousName = oldNode.properties?.previousName ?? "";
	const color = oldNode.color;
	const bgcolor = oldNode.bgcolor;

	const newNode = LiteGraph.createNode(type);
	if (!newNode) return;
	newNode.pos = pos;
	app.graph.add(newNode, false);
	copySetGetConnections(oldNode, newNode);
	app.graph.remove(oldNode);

	if (!newNode.properties) newNode.properties = {};
	newNode.properties[AUTO_TITLE_PROP] = true;
	newNode.properties.previousName = previousName;
	if (newNode.widgets?.[0]) {
		newNode.widgets[0].value = constant;
	}
	if (color) newNode.color = color;
	if (bgcolor) newNode.bgcolor = bgcolor;
	if (typeof newNode.onRename === "function") newNode.onRename();
	if (typeof newNode.update === "function") newNode.update();
	applyAutoTitle(newNode);
	app.graph.afterChange?.();
	requestAnimationFrame(() => app.canvas.setDirty(true, true));
}

function addFixNodeMenu(options, node) {
	const callback = () => recreateSetGetWithAutoTitle(node);
	const existing = options.find((item) => item?.content === "Fix node (recreate)");
	if (existing) {
		existing.callback = callback;
		return;
	}
	options.push({
		content: "Fix node (recreate)",
		callback,
	});
}

function registerTypeAndAlias(canonical, legacy, clazz, title) {
	LiteGraph.registerNodeType(canonical, Object.assign(clazz, { title }));
	if (LiteGraph.registered_node_types[canonical]) {
		LiteGraph.registered_node_types[legacy] = LiteGraph.registered_node_types[canonical];
	}
	clazz.category = "311 Tool Suite";
}

function setColorAndBgColor(type) {
	const colorMap = {
		"MODEL": LGraphCanvas.node_colors.blue,
		"LATENT": LGraphCanvas.node_colors.purple,
		"VAE": LGraphCanvas.node_colors.red,
		"CONDITIONING": LGraphCanvas.node_colors.brown,
		"IMAGE": LGraphCanvas.node_colors.pale_blue,
		"CLIP": LGraphCanvas.node_colors.yellow,
		"FLOAT": LGraphCanvas.node_colors.green,
		"MASK": { color: "#1c5715", bgcolor: "#1f401b"},
		"INT": { color: "#1b4669", bgcolor: "#29699c"},
		"CONTROL_NET": { color: "#156653", bgcolor: "#1c453b"},
		"NOISE": { color: "#2e2e2e", bgcolor: "#242121"},
		"GUIDER": { color: "#3c7878", bgcolor: "#1c453b"},
		"SAMPLER": { color: "#614a4a", bgcolor: "#3b2c2c"},
		"SIGMAS": { color: "#485248", bgcolor: "#272e27"},
	};

	const colors = colorMap[type];
	if (colors) {
		this.color = colors.color;
		this.bgcolor = colors.bgcolor;
	}
}

function isPrefixDisabled() {
	const ours = app.ui.settings.getSettingValue("311ToolSuite.disablePrefix");
	if (ours !== undefined) return ours;
	return app.ui.settings.getSettingValue("KJNodes.disablePrefix");
}

function isAutoColorEnabled() {
	const ours = app.ui.settings.getSettingValue("311ToolSuite.nodeAutoColor");
	if (ours !== undefined) return ours;
	return app.ui.settings.getSettingValue("KJNodes.nodeAutoColor");
}

const LGraphNode = LiteGraph.LGraphNode;

function showAlert(message) {
	app.extensionManager.toast.add({
		severity: "warn",
		summary: "Set/Get 311",
		detail: `${message}. Most likely you're missing custom nodes`,
		life: 5000,
	});
}

function showRenameToast(detail) {
	app.extensionManager.toast.add({
		severity: "warn",
		summary: "Set/Get 311",
		detail,
		life: 4000,
	});
}

function forEachGraphNode(graph, visit) {
	if (!graph?._nodes) return;
	for (const node of graph._nodes) {
		visit(node, graph);
		if (node.subgraph && node.subgraph !== graph) {
			forEachGraphNode(node.subgraph, visit);
		}
	}
}

function constantTakenByOtherSet(graph, newName, oldName) {
	let taken = false;
	forEachGraphNode(graph, (node) => {
		if (taken) return;
		if (isSetType(node.type) && constantValue(node) === newName && constantValue(node) !== oldName) {
			taken = true;
		}
	});
	return taken;
}

function applyRenamedTitle(node) {
	if (!node.properties) node.properties = {};
	node.properties[AUTO_TITLE_PROP] = true;
	applyAutoTitle(node);
}

function applyConstantRename(oldName, rawNew, sourceGet) {
	const newName = String(rawNew ?? "").trim();
	if (!newName || newName === oldName) return;

	const root = sourceGet?.graph || app.graph;
	if (!oldName) {
		sourceGet.widgets[0].value = newName;
		sourceGet.onRename?.();
		applyRenamedTitle(sourceGet);
		sourceGet.setDirtyCanvas?.(true, true);
		app.graph.afterChange?.();
		return;
	}

	if (constantTakenByOtherSet(root, newName, oldName)) {
		showRenameToast(`Constant "${newName}" already exists`);
		return;
	}

	app.graph.beforeChange?.();

	const sets = [];
	const gets = [];
	forEachGraphNode(root, (node) => {
		if (isSetType(node.type) && constantValue(node) === oldName) sets.push(node);
		if (isGetType(node.type) && constantValue(node) === oldName) gets.push(node);
	});

	for (const set of sets) {
		if (!set.properties) set.properties = {};
		set.properties.previousName = oldName;
		set.properties[AUTO_TITLE_PROP] = true;
		set.widgets[0].value = newName;
		set.update?.();
		set.properties.previousName = newName;
	}

	for (const get of gets) {
		if (!get.properties) get.properties = {};
		get.properties[AUTO_TITLE_PROP] = true;
		if (constantValue(get) !== newName) {
			get.widgets[0].value = newName;
		}
		get.onRename?.();
	}

	for (const node of [...sets, ...gets]) {
		applyRenamedTitle(node);
	}

	app.graph.afterChange?.();
	app.canvas.setDirty(true, true);
}

function graphToClient(x, y) {
	const lcanvas = app.canvas;
	const el = lcanvas?.canvas;
	if (!el) return { clientX: 40, clientY: 40 };
	const rect = el.getBoundingClientRect();
	let cx;
	let cy;
	if (typeof lcanvas.convertOffsetToCanvas === "function") {
		const p = lcanvas.convertOffsetToCanvas([x, y]);
		cx = p[0];
		cy = p[1];
	} else {
		const ds = lcanvas.ds || { offset: [0, 0], scale: 1 };
		cx = (x + ds.offset[0]) * ds.scale;
		cy = (y + ds.offset[1]) * ds.scale;
	}
	const sx = rect.width / (el.clientWidth || rect.width || 1);
	const sy = rect.height / (el.clientHeight || rect.height || 1);
	return {
		clientX: rect.left + cx * sx,
		clientY: rect.top + cy * sy,
	};
}

function renameButtonClientRect(node) {
	const widget = node.widgets?.find((w) => w.type === "button" && w.name === "Rename");
	const h = LiteGraph.NODE_WIDGET_HEIGHT || 20;
	const localY = widget?.last_y ?? Math.max(0, (node.size?.[1] ?? h) - h - 2);
	const topLeft = graphToClient(node.pos[0] + 10, node.pos[1] + localY);
	const bottomRight = graphToClient(
		node.pos[0] + (node.size?.[0] ?? 180) - 10,
		node.pos[1] + localY + h,
	);
	return {
		left: topLeft.clientX,
		top: topLeft.clientY,
		right: bottomRight.clientX,
		bottom: bottomRight.clientY,
		width: Math.max(80, bottomRight.clientX - topLeft.clientX),
		height: Math.max(h, bottomRight.clientY - topLeft.clientY),
	};
}

function eventFromArgs(args) {
	return args.find((item) => item && typeof item.clientX === "number" && typeof item.clientY === "number");
}

function eventOnRenameButton(node, event) {
	if (event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
		return event;
	}
	const rect = renameButtonClientRect(node);
	return {
		clientX: rect.left + 8,
		clientY: rect.top + 4,
	};
}

function placePromptAboveRename(dialog, node) {
	if (!dialog?.style) return;
	const button = renameButtonClientRect(node);
	const gap = 8;
	const width = dialog.offsetWidth || 240;
	const height = dialog.offsetHeight || 40;
	let left = button.left;
	let top = button.top - height - gap;
	if (top < 8) top = button.bottom + gap;
	left = Math.min(Math.max(8, left), window.innerWidth - width - 8);
	top = Math.min(Math.max(8, top), window.innerHeight - height - 8);
	dialog.style.position = "fixed";
	dialog.style.left = `${left}px`;
	dialog.style.top = `${top}px`;
	dialog.style.transform = "none";
	dialog.style.zIndex = "2000";
}

function promptRenameConstant(getNode, event) {
	const oldName = constantValue(getNode);
	const canvas = app.canvas;
	const onDone = (next) => applyConstantRename(oldName, next, getNode);
	if (typeof canvas?.prompt === "function") {
		const dialog = canvas.prompt("Rename", oldName, onDone, eventOnRenameButton(getNode, event));
		requestAnimationFrame(() => placePromptAboveRename(dialog, getNode));
		return;
	}
	const next = window.prompt("Rename", oldName);
	if (next == null) return;
	onDone(next);
}

function ensureRenameButton(node) {
	if (!isGetType(node.type)) return;
	if (node.widgets?.some((w) => w.type === "button" && w.name === "Rename")) return;
	node.addWidget(
		"button",
		"Rename",
		"Rename",
		(...args) => promptRenameConstant(node, eventFromArgs(args)),
		{ serialize: false }
	);
	const min = node.computeSize?.();
	if (min && node.size?.[1] < min[1]) {
		node.size[1] = min[1];
	}
}

function registerSetGetTypes() {
	class SetNode extends LGraphNode {
		defaultVisibility = true;
		serialize_widgets = true;
		drawConnection = false;
		currentGetters = null;
		slotColor = "#FFF";
		canvas = app.canvas;
		menuEntry = "Show connections";

		constructor(title) {
			super(title);
			if (!this.properties) {
				this.properties = {
					"previousName": ""
				};
			}
			this.properties.showOutputText = SetNode.defaultVisibility;
			initAutoTitle(this, false);

			const node = this;

			this.addWidget(
				"text",
				"Constant",
				"",
				(s, t, u, v, x) => {
					node.validateName(node.graph);
					if (isAutoTitleEnabled(node)) {
						applyAutoTitle(node);
					} else if (this.widgets[0].value !== "") {
						this.title = (!isPrefixDisabled() ? "Set_" : "") + this.widgets[0].value;
					}
					this.update();
					this.properties.previousName = this.widgets[0].value;
				},
				{}
			);
			hookWidgetTyping(this);

			this.addInput("*", "*");
			this.addOutput("*", "*");

			this.onConnectionsChange = function(
				slotType,	//1 = input, 2 = output
				slot,
				isChangeConnect,
				link_info,
				output
			) {
				//On Disconnect
				if (slotType == 1 && !isChangeConnect) {
					if (this.inputs[slot].name === "") {
						this.inputs[slot].type = "*";
						this.inputs[slot].name = "*";
						if (isAutoTitleEnabled(this)) {
							applyAutoTitle(this);
						} else {
							this.title = "Set";
						}
					}
				}
				if (slotType == 2 && !isChangeConnect) {
					if (this.outputs && this.outputs[slot]) {
						this.outputs[slot].type = "*";
						this.outputs[slot].name = "*";
					}
				}
				//On Connect
				if (link_info && node.graph && slotType == 1 && isChangeConnect) {
					const resolve = link_info.resolve(node.graph);
					const type = (resolve?.subgraphInput ?? resolve?.output)?.type;
					if (type) {
						if (isAutoTitleEnabled(this)) {
							applyAutoTitle(this);
						} else if (this.title === "Set") {
							this.title = (!isPrefixDisabled() ? "Set_" : "") + type;
						}
						if (this.widgets[0].value === "*") {
							this.widgets[0].value = type;
						}

						this.validateName(node.graph);
						this.inputs[0].type = type;
						this.inputs[0].name = type;

						if (isAutoColorEnabled()) {
							setColorAndBgColor.call(this, type);
						}
					} else {
						showAlert("node input undefined.");
					}
				}
				if (link_info && node.graph && slotType == 2 && isChangeConnect) {
					const fromNode = node.graph._nodes.find((otherNode) => otherNode.id == link_info.origin_id);

					if (fromNode && fromNode.inputs && fromNode.inputs[link_info.origin_slot]) {
						const type = fromNode.inputs[link_info.origin_slot].type;

						this.outputs[0].type = type;
						this.outputs[0].name = type;
					} else {
						showAlert("node output undefined");
					}
				}

				//Update either way
				this.update();
			};

			this.validateName = function(graph) {
				let widgetValue = node.widgets[0].value;

				if (widgetValue !== "") {
					let tries = 0;
					const existingValues = new Set();

					graph._nodes.forEach(otherNode => {
						if (otherNode !== this && isSetType(otherNode.type)) {
							existingValues.add(otherNode.widgets[0].value);
						}
					});

					while (existingValues.has(widgetValue)) {
						widgetValue = node.widgets[0].value + "_" + tries;
						tries++;
					}

					node.widgets[0].value = widgetValue;
					this.update();
				}
			};

			this.clone = function () {
				const cloned = SetNode.prototype.clone.apply(this);
				cloned.inputs[0].name = "*";
				cloned.inputs[0].type = "*";
				cloned.value = "";
				cloned.properties.previousName = "";
				cloned.properties[AUTO_TITLE_PROP] = this.properties[AUTO_TITLE_PROP];
				cloned.size = cloned.computeSize();
				if (isAutoTitleEnabled(cloned)) {
					applyAutoTitle(cloned);
				}
				return cloned;
			};

			this.onAdded = function(graph) {
				this.validateName(graph);
				hookWidgetTyping(this);
				if (isAutoTitleEnabled(this)) {
					applyAutoTitle(this);
				}
			};

			this.update = function() {
				if (!node.graph) {
					return;
				}

				const getters = this.findGetters(node.graph);
				getters.forEach(getter => {
					getter.setType(this.inputs[0].type);
				});

				if (this.widgets[0].value) {
					const gettersWithPreviousName = this.findGetters(node.graph, true);
					gettersWithPreviousName.forEach(getter => {
						getter.setName(this.widgets[0].value);
					});
				}

				const allGetters = node.graph._nodes.filter(otherNode => isGetType(otherNode.type));
				allGetters.forEach(otherNode => {
					if (otherNode.setComboValues) {
						otherNode.setComboValues();
					}
				});
			};

			this.findGetters = function(graph, checkForPreviousName) {
				const name = checkForPreviousName ? this.properties.previousName : this.widgets[0].value;
				return graph._nodes.filter(otherNode => isGetType(otherNode.type) && otherNode.widgets[0].value === name && name !== "");
			};

			// This node is purely frontend and does not impact the resulting prompt so should not be serialized
			this.isVirtualNode = true;
		}

		onRemoved() {
			const allGetters = this.graph._nodes.filter((otherNode) => isGetType(otherNode.type));
			allGetters.forEach((otherNode) => {
				if (otherNode.setComboValues) {
					otherNode.setComboValues([this]);
				}
			});
		}
		onConfigure(info) {
			const saved = info?.properties;
			if (saved && Object.prototype.hasOwnProperty.call(saved, AUTO_TITLE_PROP)) {
				this.properties[AUTO_TITLE_PROP] = saved[AUTO_TITLE_PROP] === true;
			} else if (saved) {
				this.properties[AUTO_TITLE_PROP] = false;
			}
			installTitleWatch(this);
			hookWidgetTyping(this);
		}
		getExtraMenuOptions(_, options) {
			this.menuEntry = this.drawConnection ? "Hide connections" : "Show connections";
			options.unshift(
				{
					content: this.menuEntry,
					callback: () => {
						this.currentGetters = this.findGetters(this.graph);
						if (this.currentGetters.length == 0) return;
						let linkType = (this.currentGetters[0].outputs[0].type);
						this.slotColor = this.canvas.default_connection_color_byType[linkType];
						this.menuEntry = this.drawConnection ? "Hide connections" : "Show connections";
						this.drawConnection = !this.drawConnection;
						this.canvas.setDirty(true, true);
					},
					has_submenu: true,
					submenu: {
						title: "Color",
						options: [
							{
								content: "Highlight",
								callback: () => {
									this.slotColor = "orange";
									this.canvas.setDirty(true, true);
								}
							}
						],
					},
				},
				{
					content: "Hide all connections",
					callback: () => {
						const allGetters = this.graph._nodes.filter(otherNode => isSetOrGetType(otherNode.type));
						allGetters.forEach(otherNode => {
							otherNode.drawConnection = false;
						});

						this.menuEntry = "Show connections";
						this.drawConnection = false;
						this.canvas.setDirty(true, true);
					},
				},
			);
			// Dynamically add a submenu for all getters
			this.currentGetters = this.findGetters(this.graph);
			if (this.currentGetters) {
				let gettersSubmenu = this.currentGetters.map(getter => ({
					content: `${getter.title} id: ${getter.id}`,
					callback: () => {
						this.canvas.centerOnNode(getter);
						this.canvas.selectNode(getter, false);
						this.canvas.setDirty(true, true);
					},
				}));

				options.unshift({
					content: "Getters",
					has_submenu: true,
					submenu: {
						title: "GetNodes",
						options: gettersSubmenu,
					}
				});
			}
			addFixNodeMenu(options, this);
		}

		onDrawForeground(ctx, lGraphCanvas) {
			if (this.drawConnection) {
				this._drawVirtualLinks(lGraphCanvas, ctx);
			}
		}
		_drawVirtualLinks(lGraphCanvas, ctx) {
			if (!this.currentGetters?.length) return;
			var title = this.getTitle ? this.getTitle() : this.title;
			var title_width = ctx.measureText(title).width;
			if (!this.flags.collapsed) {
				var start_node_slotpos = [
					this.size[0],
					LiteGraph.NODE_TITLE_HEIGHT * 0.5,
				];
			}
			else {
				var start_node_slotpos = [
					title_width + 55,
					-15,
				];
			}
			// Provide a default link object with necessary properties, to avoid errors as link can't be null anymore
			const defaultLink = { type: "default", color: this.slotColor };

			for (const getter of this.currentGetters) {
				if (!this.flags.collapsed) {
					var end_node_slotpos = this.getConnectionPos(false, 0);
					end_node_slotpos = [
						getter.pos[0] - end_node_slotpos[0] + this.size[0],
						getter.pos[1] - end_node_slotpos[1]
					];
				}
				else {
					var end_node_slotpos = this.getConnectionPos(false, 0);
					end_node_slotpos = [
						getter.pos[0] - end_node_slotpos[0] + title_width + 50,
						getter.pos[1] - end_node_slotpos[1] - 30
					];
				}
				lGraphCanvas.renderLink(
					ctx,
					start_node_slotpos,
					end_node_slotpos,
					defaultLink,
					false,
					null,
					this.slotColor,
					LiteGraph.RIGHT,
					LiteGraph.LEFT
				);
			}
		}
	}

	class GetNode extends LGraphNode {
		defaultVisibility = true;
		serialize_widgets = true;
		drawConnection = false;
		slotColor = "#FFF";
		currentSetter = null;
		canvas = app.canvas;

		constructor(title) {
			super(title);
			if (!this.properties) {
				this.properties = {};
			}
			this.properties.showOutputText = GetNode.defaultVisibility;
			initAutoTitle(this, false);
			const node = this;
			this.addWidget(
				"combo",
				"Constant",
				"",
				(e) => {
					this.onRename();
				},
				{
					values: () => {
						const setterNodes = node.graph._nodes.filter((otherNode) => isSetType(otherNode.type));
						return setterNodes.map((otherNode) => otherNode.widgets[0].value).sort();
					}
				}
			);
			this.addWidget(
				"button",
				"Rename",
				"Rename",
				(...args) => promptRenameConstant(node, eventFromArgs(args)),
				{ serialize: false }
			);

			this.addOutput("*", "*");
			this.onConnectionsChange = function(
				slotType,	//0 = output, 1 = input
				slot,	//self-explanatory
				isChangeConnect,
				link_info,
				output
			) {
				this.validateLinks();
			};

			this.setName = function(name) {
				node.widgets[0].value = name;
				node.onRename();
				node.serialize();
			};

			this.onRename = function() {
				const setter = this.findSetter(node.graph);
				if (setter) {
					let linkType = (setter.inputs[0].type);

					this.setType(linkType);
					if (isAutoTitleEnabled(this)) {
						applyAutoTitle(this);
					} else {
						this.title = (!isPrefixDisabled() ? "Get_" : "") + setter.widgets[0].value;
					}

					if (isAutoColorEnabled()) {
						setColorAndBgColor.call(this, linkType);
					}
				} else {
					this.setType("*");
					if (isAutoTitleEnabled(this)) {
						applyAutoTitle(this);
					}
				}
			};

			this.clone = function () {
				const cloned = GetNode.prototype.clone.apply(this);
				cloned.properties[AUTO_TITLE_PROP] = this.properties[AUTO_TITLE_PROP];
				cloned.size = cloned.computeSize();
				if (isAutoTitleEnabled(cloned)) {
					applyAutoTitle(cloned);
				}
				return cloned;
			};

			this.validateLinks = function() {
				if (this.outputs[0].type !== "*" && this.outputs[0].links) {
					this.outputs[0].links.filter(linkId => {
						const link = node.graph.links[linkId];
						return link && (!link.type.split(",").includes(this.outputs[0].type) && link.type !== "*");
					}).forEach(linkId => {
						node.graph.removeLink(linkId);
					});
				}
			};

			this.setType = function(type) {
				this.outputs[0].name = type;
				this.outputs[0].type = type;
				this.validateLinks();
			};

			this.findSetter = function(graph) {
				const name = this.widgets[0].value;
				const foundNode = graph._nodes.find(otherNode => isSetType(otherNode.type) && otherNode.widgets[0].value === name && name !== "");
				return foundNode;
			};

			this.goToSetter = function() {
				this.canvas.centerOnNode(this.currentSetter);
				this.canvas.selectNode(this.currentSetter, false);
			};

			// This node is purely frontend and does not impact the resulting prompt so should not be serialized
			this.isVirtualNode = true;
		}

		getInputLink(slot) {
			const setter = this.findSetter(this.graph);

			if (setter) {
				const slotInfo = setter.inputs[slot];
				const link = this.graph.links[slotInfo.link];
				return link;
			} else {
				const errorMessage = "No SetNode found for " + this.widgets[0].value + "(" + this.type + ")";
				showAlert(errorMessage);
			}
		}
		onConfigure(info) {
			const saved = info?.properties;
			if (saved && Object.prototype.hasOwnProperty.call(saved, AUTO_TITLE_PROP)) {
				this.properties[AUTO_TITLE_PROP] = saved[AUTO_TITLE_PROP] === true;
			} else if (saved) {
				this.properties[AUTO_TITLE_PROP] = false;
			}
			installTitleWatch(this);
			hookWidgetTyping(this);
			ensureRenameButton(this);
		}
		onAdded(graph) {
			hookWidgetTyping(this);
			ensureRenameButton(this);
			if (isAutoTitleEnabled(this)) {
				applyAutoTitle(this);
			}
		}
		getExtraMenuOptions(_, options) {
			addFixNodeMenu(options, this);
			let menuEntry = this.drawConnection ? "Hide connections" : "Show connections";
			this.currentSetter = this.findSetter(this.graph);
			if (!this.currentSetter) return;
			options.unshift(
				{
					content: "Go to setter",
					callback: () => {
						this.goToSetter();
					},
				},
				{
					content: menuEntry,
					callback: () => {
						let linkType = (this.currentSetter.inputs[0].type);
						this.drawConnection = !this.drawConnection;
						this.slotColor = this.canvas.default_connection_color_byType[linkType];
						this.canvas.setDirty(true, true);
					},
				},
			);
		}

		onDrawForeground(ctx, lGraphCanvas) {
			if (this.drawConnection) {
				this._drawVirtualLink(lGraphCanvas, ctx);
			}
		}
		_drawVirtualLink(lGraphCanvas, ctx) {
			if (!this.currentSetter) return;

			// Provide a default link object with necessary properties, to avoid errors as link can't be null anymore
			const defaultLink = { type: "default", color: this.slotColor };

			let start_node_slotpos = this.currentSetter.getConnectionPos(false, 0);
			start_node_slotpos = [
				start_node_slotpos[0] - this.pos[0],
				start_node_slotpos[1] - this.pos[1],
			];
			let end_node_slotpos = [0, -LiteGraph.NODE_TITLE_HEIGHT * 0.5];
			lGraphCanvas.renderLink(
				ctx,
				start_node_slotpos,
				end_node_slotpos,
				defaultLink,
				false,
				null,
				this.slotColor
			);
		}
	}

	registerTypeAndAlias(TYPE_SET, TYPE_SET_LEGACY, SetNode, "SetNode 311");
	registerTypeAndAlias(TYPE_GET, TYPE_GET_LEGACY, GetNode, "GetNode 311");
}

function addMenuHandler(nodeType, cb) {
	const getOpts = nodeType.prototype.getExtraMenuOptions;
	nodeType.prototype.getExtraMenuOptions = function () {
		const r = getOpts.apply(this, arguments);
		cb.apply(this, arguments);
		return r;
	};
}

function addNode(name, nextTo, options) {
	options = { side: "left", select: true, shiftY: 0, shiftX: 0, ...(options || {}) };
	const node = LiteGraph.createNode(name);
	app.graph.add(node);

	node.pos = [
		options.side === "left" ? nextTo.pos[0] - (node.size[0] + options.offset) : nextTo.pos[0] + nextTo.size[0] + options.offset,
		nextTo.pos[1] + options.shiftY,
	];
	if (options.select) {
		app.canvas.selectNode(node, false);
	}
	return node;
}

function updateSlots(value) {
	const valuesToAddToIn = [TYPE_GET];
	const valuesToAddToOut = [TYPE_SET];
	for (const arr of Object.values(LiteGraph.slot_types_default_in)) {
		for (const valueToAdd of valuesToAddToIn) {
			const idx = arr.indexOf(valueToAdd);
			if (idx !== -1) {
				arr.splice(idx, 1);
			}
		}
	}

	for (const arr of Object.values(LiteGraph.slot_types_default_out)) {
		for (const valueToAdd of valuesToAddToOut) {
			const idx = arr.indexOf(valueToAdd);
			if (idx !== -1) {
				arr.splice(idx, 1);
			}
		}
	}
	if (value != "disabled") {
		for (const arr of Object.values(LiteGraph.slot_types_default_in)) {
			for (const valueToAdd of valuesToAddToIn) {
				const idx = arr.indexOf(valueToAdd);
				if (idx !== -1) {
					arr.splice(idx, 1);
				}
				if (value === "top") {
					arr.unshift(valueToAdd);
				} else {
					arr.push(valueToAdd);
				}
			}
		}

		for (const arr of Object.values(LiteGraph.slot_types_default_out)) {
			for (const valueToAdd of valuesToAddToOut) {
				const idx = arr.indexOf(valueToAdd);
				if (idx !== -1) {
					arr.splice(idx, 1);
				}
				if (value === "top") {
					arr.unshift(valueToAdd);
				} else {
					arr.push(valueToAdd);
				}
			}
		}
	}
}

app.registerExtension({
	name: "ComfyUI-311-Tool-Suite.SetGet",
	registerCustomNodes() {
		registerSetGetTypes();
	},
	async nodeCreated(node) {
		if (!isSetOrGetType(node.type)) return;
		hookWidgetTyping(node);
		if (isAutoTitleEnabled(node)) {
			applyAutoTitle(node);
		}
	},
	async loadedGraphNode(node) {
		if (!isSetOrGetType(node.type)) return;
		if (node.properties?.[AUTO_TITLE_PROP] !== true) {
			node.properties[AUTO_TITLE_PROP] = false;
		}
		installTitleWatch(node);
		hookWidgetTyping(node);
		ensureRenameButton(node);
	},
	async beforeRegisterNodeDef(nodeType, nodeData, app) {
		if (nodeData.input && nodeData.input.required) {
			addMenuHandler(nodeType, function (_, options) {
				if (options.some((o) => o?.content === "Add GetNode 311" || o?.content === "Add GetNode")) return;
				options.unshift(
					{
						content: "Add GetNode 311",
						callback: () => { addNode(TYPE_GET, this, { side: "left", offset: 30 }); }
					},
					{
						content: "Add SetNode 311",
						callback: () => { addNode(TYPE_SET, this, { side: "right", offset: 30 }); }
					},
				);
			});
		}
	},
	async setup(app) {
		// KJNodes loads after this pack alphabetically and would overwrite SetNode/GetNode.
		registerSetGetTypes();
		setTimeout(registerSetGetTypes, 0);

		if (!document._n311SetGetInputHook) {
			document._n311SetGetInputHook = true;
			document.addEventListener("input", (event) => {
				const pair = app.canvas?.node_widget;
				if (!pair) return;
				const [editNode, editWidget] = pair;
				if (!isSetOrGetType(editNode?.type)) return;
				if (editWidget !== editNode.widgets?.[0]) return;
				const target = event.target;
				if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return;
				editWidget.value = target.value;
				applyAutoTitle(editNode);
				editNode.setDirtyCanvas?.(true, true);
			}, true);
		}

		const originalComputeVisibleNodes = LGraphCanvas.prototype.computeVisibleNodes;
		if (!LGraphCanvas.prototype._311setgetVisiblePatched) {
			LGraphCanvas.prototype._311setgetVisiblePatched = true;
			LGraphCanvas.prototype.computeVisibleNodes = function () {
				const visibleNodesSet = new Set(originalComputeVisibleNodes.apply(this, arguments));
				for (const node of this.graph._nodes) {
					if (isSetOrGetType(node.type) && node.drawConnection) {
						visibleNodesSet.add(node);
					}
				}
				return Array.from(visibleNodesSet);
			};
		}

		app.ui.settings.addSetting({
			id: "311ToolSuite.SetGetMenu",
			name: "311 Tool Suite: Make Set/Get nodes defaults",
			tooltip: "Adds Set/Get nodes to the top or bottom of the list of available node suggestions.",
			options: ["disabled", "top", "bottom"],
			defaultValue: "disabled",
			type: "combo",
			onChange: updateSlots,
		});
		app.ui.settings.addSetting({
			id: "311ToolSuite.MiddleClickDefault",
			name: "311 Tool Suite: Middle click default node adding",
			defaultValue: false,
			type: "boolean",
			onChange: (value) => {
				LiteGraph.middle_click_slot_add_default_node = value;
			},
		});
		app.ui.settings.addSetting({
			id: "311ToolSuite.nodeAutoColor",
			name: "311 Tool Suite: Automatically set node colors",
			type: "boolean",
			defaultValue: true,
		});
		app.ui.settings.addSetting({
			id: "311ToolSuite.disablePrefix",
			name: "311 Tool Suite: Disable automatic Set_ and Get_ prefix",
			defaultValue: true,
			type: "boolean",
		});
	},
});
