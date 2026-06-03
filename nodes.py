"""
Multiline 311 — Multiline text input with comment stripping and optional WAS Suite token parsing.
Part of the 311 Tool Suite (V3 API).
"""

import io as stdio
from comfy_api.latest import io


class Multiline311(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="Multiline 311",
            display_name="Multiline 311",
            category="311 Tool Suite",
            description="Multiline text input with comment stripping (#) and optional WAS Suite token parsing.",
            inputs=[
                io.String.Input(id="text", default="", multiline=True, display_name="Text"),
            ],
            outputs=[
                io.String.Output(id="text_out", display_name="STRING"),
            ],
        )

    @classmethod
    def execute(cls, text=""):
        new_text = []
        for line in stdio.StringIO(text):
            if not line.strip().startswith('#'):
                new_text.append(line.replace("\n", ''))
        new_text = "\n".join(new_text)

        # Attempt to use WAS Suite's TextTokens if available
        try:
            import sys
            was_module = None
            for mod_name, mod in sys.modules.items():
                if "was_node_suite" in mod_name.lower() or "WAS_Node_Suite" in getattr(mod, "__name__", ""):
                    if hasattr(mod, "TextTokens"):
                        was_module = mod
                        break

            if was_module and hasattr(was_module, "TextTokens"):
                tokens = was_module.TextTokens()
                new_text = tokens.parseTokens(new_text)
        except Exception as e:
            print(f"[Multiline 311] Note: WAS Suite TextTokens not applied ({e})")

        return io.NodeOutput(new_text)
