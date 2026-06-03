"""
Join String 311 — Join multiple string inputs with a separator.
Supports dynamic inputs via frontend JS (dynamic_inputs_311.js).
Part of the 311 Tool Suite (V3 API).
"""

from comfy_api.latest import io


class JoinString311(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="JoinString311",
            display_name="Join String 311",
            category="311 Tool Suite",
            description="Join multiple string inputs with a configurable separator.",
            inputs=[
                io.String.Input(id="separator", default=", ", multiline=False, display_name="Separator"),
                io.String.Input(id="string1", optional=True, force_input=True, display_name="String 1"),
                io.String.Input(id="string2", optional=True, force_input=True, display_name="String 2"),
            ],
            outputs=[
                io.String.Output(id="string_out", display_name="STRING"),
            ],
            # Accept dynamic inputs added by JS frontend (string3, string4, ...)
            accept_all_inputs=True,
        )

    @classmethod
    def execute(cls, separator=", ", **kwargs):
        parts = []
        sorted_keys = sorted(
            kwargs.keys(),
            key=lambda k: int(k.replace("string", "")) if k.startswith("string") and k.replace("string", "").isdigit() else 999
        )

        for k in sorted_keys:
            if k.startswith("string"):
                v = kwargs[k]
                if v is not None and isinstance(v, str):
                    parts.append(v)

        if len(parts) == 0:
            raise ValueError("JoinString311: At least one valid string input is required.")

        print(f"JoinString311: Joining {len(parts)} string(s) with separator '{separator}'.")
        return io.NodeOutput(separator.join(parts))
