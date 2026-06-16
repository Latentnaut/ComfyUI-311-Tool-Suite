"""
ComfyUI-311-Tool-Suite — Mixed V1/V3 API
=========================================
A collection of utility nodes for ComfyUI.

Nodes:
  - Multiline 311: Multiline text with comment stripping
  - Image Batch 311: Smart image batching with auto-resize
  - Join String 311: Join strings with separator
  - File Reader 311: Read text files with viewer
  - SAM3 Images 311: All-in-one SAM3 segmentation with preview + mask arithmetic
  - Preview 311: Draggable image preview with drag-and-drop support
  - Any Switch 311: Any-type index switch with clickable input button menu
"""

from typing_extensions import override
from comfy_api.latest import ComfyExtension, io

from .nodes import Multiline311
from .image_batch_311 import ImageBatch311
from .join_string_311 import JoinString311
from .file_reader_311 import FileReader311, FileReaderNode
from .sam3_images_311 import SAM3Images311
from .any_switch_311 import AnySwitch311

from .preview_311 import Preview311


class ToolSuite311Extension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [
            Multiline311,
            ImageBatch311,
            JoinString311,
            FileReader311,
            FileReaderNode,
            SAM3Images311,
            AnySwitch311,
            Preview311,
        ]


async def comfy_entrypoint() -> ToolSuite311Extension:
    return ToolSuite311Extension()


# The WEB_DIRECTORY maps to the /js directory for frontend extensions
WEB_DIRECTORY = "./js"
