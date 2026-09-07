"""Convert workflow JSON node types SetNode/GetNode -> SetNode 311 / GetNode 311."""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

EXACT = {
    "SetNode": "SetNode 311",
    "GetNode": "GetNode 311",
}
TYPE_KEYS = {"type", "class_type"}
SKIP_DIR_NAMES = {
    ".git",
    ".agent",
    "node_modules",
    "__pycache__",
    "SystemPrompts",
    "ComfyUI-Manager",
    ".cds",
}


def convert_type(value: object) -> tuple[object, str | None]:
    if isinstance(value, str) and value in EXACT:
        new = EXACT[value]
        return new, f"{value} -> {new}"
    return value, None


def walk(obj: object, changed: Counter) -> object:
    if isinstance(obj, dict):
        out = {}
        for key, val in obj.items():
            if key in TYPE_KEYS:
                new_val, label = convert_type(val)
                if label:
                    changed[label] += 1
                out[key] = new_val
            else:
                out[key] = walk(val, changed)
        return out
    if isinstance(obj, list):
        return [walk(item, changed) for item in obj]
    return obj


def should_skip(path: Path) -> bool:
    parts = set(path.parts)
    if parts & SKIP_DIR_NAMES:
        return True
    if "LF_Nodes" in parts and "Backups" in parts:
        return True
    return False


def convert_file(path: Path, dry_run: bool) -> Counter:
    data = json.loads(path.read_text(encoding="utf-8"))
    changed: Counter = Counter()
    new_data = walk(data, changed)
    if changed and not dry_run:
        path.write_text(
            json.dumps(new_data, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
    return changed


def iter_json_files(root: Path):
    if root.is_file() and root.suffix.lower() == ".json":
        yield root
        return
    for path in root.rglob("*.json"):
        if should_skip(path):
            continue
        yield path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("roots", nargs="+")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    sys.stdout.reconfigure(encoding="utf-8")
    totals: Counter = Counter()
    files_touched = 0
    files_scanned = 0

    for root_arg in args.roots:
        root = Path(root_arg)
        if not root.exists():
            print("missing", root)
            continue
        for path in iter_json_files(root):
            files_scanned += 1
            try:
                changed = convert_file(path, args.dry_run)
            except (json.JSONDecodeError, UnicodeDecodeError, OSError) as exc:
                print(f"skip  {path} ({exc})")
                continue
            if changed:
                files_touched += 1
                totals.update(changed)
                print(f"{sum(changed.values()):4d}  {path}")

    print("--- summary ---")
    print("scanned", files_scanned)
    print("touched", files_touched)
    print("dry_run", args.dry_run)
    for label, count in totals.most_common():
        print(f"{count:4d}  {label}")
    print("total_replacements", sum(totals.values()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
