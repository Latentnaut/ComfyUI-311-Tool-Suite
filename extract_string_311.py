"""
Extract String 311 — Extract text between delimiters; coerce to JSON/int/float/bool.
Port of lf-nodes LF_ExtractString for the 311 Tool Suite (V3 API).
"""

import json

from comfy_api.latest import io


def _extract_nested(text: str, start_delim: str, end_delim: str) -> str:
    start_idx = text.rfind(start_delim)
    if start_idx == -1:
        return ""
    end_idx = text.find(end_delim, start_idx + len(start_delim))
    if end_idx == -1:
        return ""
    return text[start_idx + len(start_delim):end_idx]


def _to_json(text: str):
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return None


def _to_int(text: str):
    try:
        return int(text)
    except (ValueError, TypeError):
        return None


def _to_float(text: str):
    try:
        return float(text)
    except (ValueError, TypeError):
        return None


def _to_boolean(text):
    if isinstance(text, bool):
        return text
    if text is None:
        return False
    text_lower = str(text).strip().lower()
    if text_lower in ("true", "yes"):
        return True
    if text_lower in ("false", "no", ""):
        return False
    return None


class ExtractString311(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ExtractString311",
            display_name="Extract String 311",
            category="311 Tool Suite",
            description=(
                "Extract the substring between the last starting delimiter and the "
                "next ending delimiter. Also coerces the result to JSON, INT, FLOAT, and BOOLEAN."
            ),
            search_aliases=["extract string", "delimiter", "parse string", "substring"],
            inputs=[
                io.String.Input(
                    id="text",
                    default="",
                    multiline=True,
                    display_name="text",
                    tooltip="The string from which the output will be extracted.",
                ),
                io.String.Input(
                    id="starting_delimiter",
                    default="{",
                    multiline=False,
                    display_name="starting_delimiter",
                    tooltip="The delimiter where extraction starts.",
                ),
                io.String.Input(
                    id="ending_delimiter",
                    default="}",
                    multiline=False,
                    display_name="ending_delimiter",
                    tooltip="The delimiter where extraction ends.",
                ),
            ],
            outputs=[
                io.Custom("JSON").Output(
                    id="result_as_json",
                    display_name="result_as_json",
                    tooltip="Final extracted result as JSON.",
                ),
                io.String.Output(
                    id="extracted_text",
                    display_name="extracted_text",
                    tooltip="Final extracted result as text.",
                ),
                io.Int.Output(
                    id="result_as_int",
                    display_name="result_as_int",
                    tooltip="Final extracted result as integer.",
                ),
                io.Float.Output(
                    id="result_as_float",
                    display_name="result_as_float",
                    tooltip="Final extracted result as float.",
                ),
                io.Boolean.Output(
                    id="result_as_boolean",
                    display_name="result_as_boolean",
                    tooltip="Final extracted result as boolean.",
                ),
            ],
        )

    @classmethod
    def execute(cls, text="", starting_delimiter="{", ending_delimiter="}"):
        if text is None:
            text = ""
        if starting_delimiter is None:
            starting_delimiter = ""
        if ending_delimiter is None:
            ending_delimiter = ""

        extracted_text = _extract_nested(str(text), str(starting_delimiter), str(ending_delimiter))
        return io.NodeOutput(
            _to_json(extracted_text),
            extracted_text,
            _to_int(extracted_text),
            _to_float(extracted_text),
            _to_boolean(extracted_text),
        )
