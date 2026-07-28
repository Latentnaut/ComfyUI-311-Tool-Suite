/**
 * Preview Bridge 311 — Frontend extension.
 *
 * Mirrors the client-side behaviour of comfyui-impact-pack's PreviewBridge
 * (from impact-image-util.js) so that Clipspace / MaskEditor integration
 * works identically.  Reuses the existing /impact/ API endpoints that are
 * already registered by impact-pack's server module.
 */

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// ── Helpers (replicated from impact-image-util.js) ──────────────

function getFileItem(baseType, path) {
	try {
		let pathType = baseType;

		if (path.endsWith("[output]")) {
			pathType = "output";
			path = path.slice(0, -9);
		} else if (path.endsWith("[input]")) {
			pathType = "input";
			path = path.slice(0, -8);
		} else if (path.endsWith("[temp]")) {
			pathType = "temp";
			path = path.slice(0, -7);
		}

		const subfolder = path.substring(0, path.lastIndexOf('/'));
		const filename  = path.substring(path.lastIndexOf('/') + 1);

		return {
			filename: filename,
			subfolder: subfolder,
			type: pathType
		};
	} catch (exception) {
		return null;
	}
}

async function loadImageFromUrl(image, node_id, v, need_to_load) {
	let item = getFileItem('temp', v);

	if (item) {
		let params = `?node_id=${node_id}&filename=${item.filename}&type=${item.type}&subfolder=${item.subfolder}`;

		let res = await api.fetchApi('/impact/set/pb_id_image' + params, { cache: "no-store" });
		if (res.status == 200) {
			let pb_id = await res.text();
			if (need_to_load) {
				image.src = api.apiURL(`/view?filename=${item.filename}&type=${item.type}&subfolder=${item.subfolder}`);
			}
			return pb_id;
		} else {
			return `$${node_id}-0`;
		}
	} else {
		return `$${node_id}-0`;
	}
}

async function loadImageFromId(image, v) {
	let res = await api.fetchApi('/impact/get/pb_id_image?id=' + v, { cache: "no-store" });
	if (res.status == 200) {
		let item = await res.json();
		image.src = api.apiURL(`/view?filename=${item.filename}&type=${item.type}&subfolder=${item.subfolder}`);
		return true;
	}

	return false;
}

// ── Extension Registration ──────────────────────────────────────

app.registerExtension({
	name: "Comfy.ToolSuite311.PreviewBridge311",

	nodeCreated(node, app) {
		if (node.comfyClass == "PreviewBridge311") {
			let w = node.widgets.find(obj => obj.name === 'image');
			node._imgs = [new Image()];
			node.imageIndex = 0;

			Object.defineProperty(w, 'value', {
				async set(v) {
					if (w._lock)
						return;

					const stackTrace = new Error().stack;
					if (stackTrace.includes('presetText.js'))
						return;

					var image = new Image();
					if (v && v.constructor == String && v.startsWith('$')) {
						// from node feedback
						let need_to_load = node._imgs[0].src == '';
						if (await loadImageFromId(image, v, need_to_load)) {
							w._value = v;
							if (node._imgs[0].src == '') {
								node._imgs = [image];
							}
						} else {
							w._value = `$${node.id}-0`;
						}
					} else {
						// from clipspace
						w._lock = true;
						w._value = await loadImageFromUrl(image, node.id, v, false);
						w._lock = false;
					}
				},
				get() {
					if (w._value == undefined) {
						w._value = `$${node.id}-0`;
					}
					return w._value;
				}
			});

			Object.defineProperty(node, 'imgs', {
				set(v) {
					const stackTrace = new Error().stack;
					if (v && v.length == 0)
						return;
					else if (stackTrace.includes('pasteFromClipspace')) {
						let sp = new URLSearchParams(v[0].src.split("?")[1]);
						let str = "";
						if (sp.get('subfolder')) {
							str += sp.get('subfolder') + '/';
						}
						str += `${sp.get("filename")} [${sp.get("type")}]`;

						w.value = str;
					}

					node._imgs = v;
				},
				get() {
					return node._imgs;
				}
			});
		}
	}
});
