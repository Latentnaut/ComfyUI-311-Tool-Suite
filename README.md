# ComfyUI-311-Tool-Suite

311 Tool Suite is a collection of V3 API custom nodes for ComfyUI. It features Multiline text inputs with comment stripping, AnySwitch dynamic index switches, FileReader, and a highly interactive, draggable Preview Image node that supports drag-and-drop onto other loader nodes (like Load Image and Load Multiple Images) with visual feedback.

## Nodes Included

### 🖼️ Preview 311
An interactive image preview node built on the V3 API (`ui.PreviewImage`).
*   **Drag-and-Drop:** Drag any previewed image directly onto other loader nodes (like *Load Image* or *Load Multiple Images*).
*   **Visual Hover Highlight:** Lights up target nodes (e.g. the dashed drop zone of *Load Multiple Images*) when dragging an image over them.
*   **Visual Drag Feedback:** Shows a floating image thumbnail following the mouse cursor.
*   **Send to Input Folder:** Right-click context menu option to upload the previewed image directly to ComfyUI's input directory.

### ⚡ Any Switch 311
A dynamic, any-type index switch with clickable input labels.
*   **Clickable Interface:** Simply click any of the connected input names on the node to set the active index.
*   **Lazy Evaluation:** Utilizes V3 lazy inputs to prevent unnecessary computation of unused branches.

### 📝 Multiline 311
A multiline text input widget with smart processing.
*   **Comment Stripping:** Automatically filters out lines starting with `#` for clean inline note-taking.
*   **WAS Suite Token Support:** If WAS Node Suite is installed, it automatically parses custom text tokens.

### 📂 File Reader 311
Reads text files from the local file system or subfolders for batch processing and dynamic prompting.

### 📦 Image Batch 311
Combines individual images or batches of images into a single conformed image batch.

### 🔗 Join String 311
Concatenates multiple string inputs together with custom delimiters.

### 🍌 SAM3 Images 311
Helper utility node for Segment Anything 3 workflows.

### ⚖️ Image Comparer 311
Batch-aware left/right image comparison (rgthree-style slider).
*   **All pairs at once:** Unlike rgthree Image Comparer, every `image_top[i]` / `image_bottom[i]` pair is shown in a Preview-style grid — no batch-index picking.
*   **Top over bottom:** `image_top` is the new overlay; `image_bottom` is the base. Slide starts fully right (top only); drag left to reveal bottom. Click shows top; hold to see bottom.
*   **Slide / Click modes:** Hover wipe, or hold-click to reveal bottom.
*   **Columns:** subtle `Col` number field in the toolbar (default 4, 1–16).
*   **Broadcast:** A length-1 input is paired against every image on the other side.

## Installation

Go to your ComfyUI `custom_nodes` directory and clone this repository:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Latentnaut/ComfyUI-311-Tool-Suite.git
```

Restart ComfyUI, and the nodes will be available under the category **311 Tool Suite**.
