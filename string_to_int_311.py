"""
String To Int 311 — Convert a string to an integer.
Port of comfyui-various JWStringToInteger for the 311 Tool Suite (V3 API).
"""

from comfy_api.latest import io


class StringToInt311(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="StringToInt311",
            display_name="String To Int 311",
            category="311 Tool Suite",
            description="Convert a string to an integer (Python int()).",
            search_aliases=["string to int", "string to integer", "parse int", "atoi"],
            inputs=[
                io.String.Input(
                    id="text",
                    default="0",
                    multiline=False,
                    display_name="text",
                ),
            ],
            outputs=[
                io.Int.Output(id="int_out", display_name="INT"),
            ],
        )

    @classmethod
    def execute(cls, text="0"):
        s = str(text if text is not None else "").strip()
        try:
            return io.NodeOutput(int(s))
        except ValueError:
            pass
        # Accept "3.0" / "1e3" style numbers by truncating toward zero.
        try:
            return io.NodeOutput(int(float(s)))
        except (ValueError, OverflowError):
            raise ValueError(f"String To Int 311: cannot convert {text!r} to int") from None
