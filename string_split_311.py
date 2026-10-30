"""
String Split 311 — Split a string once by a delimiter (left or right).
Port of comfyui-various JWStringSplit for the 311 Tool Suite (V3 API).
"""

from comfy_api.latest import io


class StringSplit311(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="StringSplit311",
            display_name="String Split 311",
            category="311 Tool Suite",
            description=(
                "Split a string once by a delimiter. "
                "from_right=true uses rsplit (last occurrence); otherwise split (first)."
            ),
            search_aliases=["string split", "split string", "rsplit", "delimiter"],
            inputs=[
                io.String.Input(
                    id="source",
                    default="a,b",
                    multiline=False,
                    display_name="source",
                ),
                io.String.Input(
                    id="split_by",
                    default=",",
                    multiline=False,
                    display_name="split_by",
                ),
                io.Combo.Input(
                    id="from_right",
                    options=["false", "true"],
                    default="false",
                    display_name="from_right",
                ),
            ],
            outputs=[
                io.String.Output(id="a", display_name="a"),
                io.String.Output(id="b", display_name="b"),
            ],
        )

    @classmethod
    def execute(cls, source="a,b", split_by=",", from_right="false"):
        if source is None:
            source = ""
        if split_by is None:
            split_by = ""
        # str.split("") raises ValueError; an empty delimiter means "no split".
        if split_by == "":
            return io.NodeOutput(source, "")

        if from_right == "true":
            splits = source.rsplit(split_by, 1)
        else:
            splits = source.split(split_by, 1)

        if len(splits) == 2:
            return io.NodeOutput(splits[0], splits[1])
        return io.NodeOutput(splits[0] if splits else "", "")
