#!/usr/bin/env python3
"""
Optional Blender bakepath for glyph SDF / heightfields.

Requires Blender on PATH (`blender --version`). When available:

  blender --background --python scripts/bake-glyph-blender.py -- \
    --font "C:/Windows/Fonts/ariblk.ttf" --char p --out demo/glyph-atlases/chromeSansP.png

Current CI/dev path uses scripts/bake-glyph-sdf.py (font EDT) because Blender
was not installable non-interactively on this machine (UAC elevation stall).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def main() -> int:
    try:
        import bpy  # type: ignore
    except ImportError:
        print(
            "Blender Python (bpy) not available.\n"
            "Run via: blender --background --python scripts/bake-glyph-blender.py -- ...\n"
            "Or use: python scripts/bake-glyph-sdf.py",
            file=sys.stderr,
        )
        return 2

    ap = argparse.ArgumentParser()
    ap.add_argument("--font", required=True)
    ap.add_argument("--char", default="p")
    ap.add_argument("--out", required=True)
    ap.add_argument("--extrude", type=float, default=0.08)
    ap.add_argument("--bevel", type=float, default=0.012)
    ap.add_argument("--res", type=int, default=512)
    args = ap.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])

    # Minimal font curve → mesh → orthographic depth bake placeholder.
    # Full remesh/MSDF handoff is intentionally left for when Blender is installed.
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    bpy.ops.object.text_add()
    obj = bpy.context.object
    obj.data.body = args.char
    obj.data.font = bpy.data.fonts.load(args.font)
    obj.data.extrude = args.extrude
    obj.data.bevel_depth = args.bevel
    bpy.ops.object.convert(target="MESH")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    # Depth bake would go here; until then fall back instruction:
    print(f"Mesh prepared for {args.char} from {args.font}.")
    print(f"Export GLB / bake heightfield to {out} manually or extend this script.")
    print("Prefer scripts/bake-glyph-sdf.py for WebGL R8 SDF atlases today.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
