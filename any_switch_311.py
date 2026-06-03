"""
Any Switch 311 — Any-type index switch with clickable input button menu.
Part of the 311 Tool Suite (V3 API).

Uses Autogrow for dynamic inputs and check_lazy_status for lazy evaluation.
"""

from comfy_api.latest import io


MAX_INPUTS = 60


class AnySwitch311(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        inputs = [
            io.Int.Input(id="index", default=0, min=0, max=MAX_INPUTS - 1, step=1,
                         display_name="index", tooltip="Select which connected input to forward"),
        ]
        for i in range(MAX_INPUTS):
            inputs.append(io.AnyType.Input(id=f"value{i}", optional=True, lazy=True))

        return io.Schema(
            node_id="AnySwitch311",
            display_name="Any Switch 311 ⚡",
            category="311 Tool Suite",
            description="Any-type index switch with clickable input labels. Click an input name to select it.",
            inputs=inputs,
            outputs=[
                io.AnyType.Output(id="value", display_name="value"),
            ],
        )

    @classmethod
    def check_lazy_status(cls, index, **kwargs):
        """Only request evaluation of the selected input."""
        key = f"value{index}"
        if kwargs.get(key) is None:
            return [key]
        return []

    @classmethod
    def execute(cls, index, **kwargs):
        key = f"value{index}"
        value = kwargs.get(key)
        if value is None:
            raise ValueError(f"[Any Switch 311] Input '{key}' at index {index} is not connected.")
        return io.NodeOutput(value)

