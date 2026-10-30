"""
Smoke test for String Split / String To Int / Extract String / Image From Batch /
Mask Fix / Mask Preview 311. Runs without a server; previews go to a throwaway
temp dir so a live ComfyUI temp folder is never touched.

Run:
  python_embeded\\python.exe ComfyUI\\custom_nodes\\ComfyUI-311-Tool-Suite\\test_new_nodes_311.py
"""

import importlib.util
import os
import sys
import tempfile

PACK = os.path.dirname(os.path.abspath(__file__))
COMFY_ROOT = os.path.abspath(os.path.join(PACK, "..", ".."))
sys.path.insert(0, COMFY_ROOT)

import torch  # noqa: E402
import folder_paths  # noqa: E402

_tmp = tempfile.mkdtemp(prefix="ts311_test_")
folder_paths.set_temp_directory(_tmp)


def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(PACK, f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def check_schema(node_cls):
    schema = node_cls.define_schema()
    assert schema.display_name.endswith(" 311"), schema.display_name
    assert schema.category == "311 Tool Suite", schema.category
    return schema


def out(res):
    return tuple(res.result) if res.result is not None else ()


def test_string_split():
    cls = load("string_split_311").StringSplit311
    check_schema(cls)
    assert out(cls.execute("a,b,c", ",", "false")) == ("a", "b,c")
    assert out(cls.execute("a,b,c", ",", "true")) == ("a,b", "c")
    assert out(cls.execute("abc", ",", "false")) == ("abc", "")
    assert out(cls.execute("abc", "", "false")) == ("abc", "")
    assert out(cls.execute(None, ",", "false")) == ("", "")


def test_string_to_int():
    cls = load("string_to_int_311").StringToInt311
    check_schema(cls)
    assert out(cls.execute("42")) == (42,)
    assert out(cls.execute(" -7 ")) == (-7,)
    assert out(cls.execute("3.9")) == (3,)
    try:
        cls.execute("abc")
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError")


def test_extract_string():
    cls = load("extract_string_311").ExtractString311
    check_schema(cls)
    j, t, i, f, b = out(cls.execute('pre {"a": 1} mid {12} end', "{", "}"))
    assert t == "12" and j == 12 and i == 12 and f == 12.0 and b is None
    j, t, i, f, b = out(cls.execute("x <true> y", "<", ">"))
    assert t == "true" and j is True and i is None and b is True
    assert out(cls.execute("no delims", "{", "}"))[1] == ""


def test_image_from_batch():
    cls = load("image_from_batch_311").ImageFromBatch311
    check_schema(cls)
    img = torch.arange(5).float().view(5, 1, 1, 1).expand(5, 8, 8, 3).clone()
    (r,) = out(cls.execute(img, 1, 2))
    assert r.shape == (2, 8, 8, 3) and r[0, 0, 0, 0] == 1
    (r,) = out(cls.execute(img, 0, -1))
    assert r.shape[0] == 5
    (r,) = out(cls.execute(img, 99, 3))
    assert r.shape[0] == 1 and r[0, 0, 0, 0] == 4


def test_mask_fix():
    cls = load("mask_fix_311").MaskFix311
    check_schema(cls)
    m = torch.zeros(2, 32, 32)
    m[:, 8:24, 8:24] = 1.0
    m[:, 15, 15] = 0.0  # hole
    m[:, 2, 2] = 1.0  # isolated pixel
    (r,) = out(cls.execute(m))
    assert r.shape == (2, 32, 32) and r.dtype == torch.float32
    (r,) = out(cls.execute(m, erode_dilate=-3))
    assert r.sum() < m.sum()
    (r,) = out(cls.execute(m, erode_dilate=3))
    assert r.sum() > m.sum()
    (r,) = out(cls.execute(m, fill_holes=3))
    assert r[0, 15, 15] == 1.0
    (r,) = out(cls.execute(m, remove_isolated_pixels=3))
    assert r[0, 2, 2] == 0.0
    (r,) = out(cls.execute(m, smooth=4, blur=3))
    assert r.shape == (2, 32, 32) and 0.0 <= r.min() and r.max() <= 1.0
    (r,) = out(cls.execute(m[0]))  # unbatched [H, W]
    assert r.shape == (1, 32, 32)


def test_mask_preview():
    cls = load("mask_preview_311").MaskPreview311
    schema = check_schema(cls)
    assert schema.is_output_node
    res = cls.execute(torch.rand(2, 16, 16))
    ui_out = res.ui.as_dict() if hasattr(res.ui, "as_dict") else res.ui
    images = ui_out["images"]
    assert len(images) == 2 and images[0]["type"] == "temp"
    for im in images:
        assert os.path.isfile(os.path.join(_tmp, im.get("subfolder", ""), im["filename"]))


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"FAIL {t.__name__}: {type(e).__name__}: {e}")
    print(f"{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
