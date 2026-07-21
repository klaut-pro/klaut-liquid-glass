#!/usr/bin/env python3
"""Bake knife-edge studio softbox plate for wet-mirror glyph QA (Blender unavailable).

Iteration 16: higher contrast HDRI plate — near-black ambient + 1–2px hard cores
(no soft shoulders) so chromeSansP wet-mirror bars stay razor vs pastel wash.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "demo" / "env" / "studio-softbox.png"


def knife_v(
    draw: ImageDraw.ImageDraw,
    w: int,
    h: int,
    cx: float,
    core: int,
    rgb: tuple[int, int, int],
) -> None:
    """Absolute hard core only — no shoulder gradient (NEAREST-safe)."""
    x0 = max(0, int(round(cx - core / 2)))
    draw.rectangle([x0, 0, x0 + max(1, core) - 1, h - 1], fill=(*rgb, 255))


def main() -> None:
    w, h = 2048, 2048
    im = Image.new("RGBA", (w, h), (1, 1, 3, 255))
    px = im.load()

    # Minimal colored ambient — midtones without milking knife bars
    for x in range(w):
        t = x / (w - 1)
        for y in range(h):
            r, g, b, _a = px[x, y]
            cool = max(0.0, 1.0 - abs(t - 0.26) / 0.12) * 0.045
            mag = max(0.0, 1.0 - abs(t - 0.84) / 0.14) * 0.04
            key = max(0.0, 1.0 - ((x / w - 0.12) ** 2 + (y / h - 0.06) ** 2) / 0.09) * 0.1
            r = min(255, int(r + cool * 40 + mag * 70 + key * 90))
            g = min(255, int(g + cool * 70 + mag * 18 + key * 110))
            b = min(255, int(b + cool * 110 + mag * 55 + key * 140))
            px[x, y] = (r, g, b, 255)

    draw = ImageDraw.Draw(im, "RGBA")
    # Dense knife-edge vertical softboxes — 1–3px hard cores (wet-mirror 1c6PD/Z53Ve)
    knife_v(draw, w, h, w * 0.18, 1, (255, 255, 255))
    knife_v(draw, w, h, w * 0.22, 2, (255, 255, 255))
    knife_v(draw, w, h, w * 0.26, 1, (240, 250, 255))
    knife_v(draw, w, h, w * 0.30, 3, (255, 252, 248))
    knife_v(draw, w, h, w * 0.34, 1, (255, 255, 255))
    knife_v(draw, w, h, w * 0.38, 2, (255, 255, 255))
    knife_v(draw, w, h, w * 0.42, 1, (200, 240, 255))
    knife_v(draw, w, h, w * 0.46, 1, (140, 255, 255))
    knife_v(draw, w, h, w * 0.50, 1, (255, 255, 255))
    knife_v(draw, w, h, w * 0.54, 2, (255, 255, 230))
    knife_v(draw, w, h, w * 0.58, 1, (255, 220, 255))
    knife_v(draw, w, h, w * 0.62, 1, (255, 200, 255))
    knife_v(draw, w, h, w * 0.66, 1, (255, 255, 255))
    knife_v(draw, w, h, w * 0.71, 3, (220, 235, 255))
    knife_v(draw, w, h, w * 0.76, 1, (255, 255, 255))
    knife_v(draw, w, h, w * 0.80, 2, (255, 255, 255))
    knife_v(draw, w, h, w * 0.16, 1, (255, 120, 220))
    knife_v(draw, w, h, w * 0.86, 1, (180, 220, 255))
    # Horizontal strip — 2px hard core
    cy = int(h * 0.24)
    draw.rectangle([0, cy - 1, w - 1, cy + 1], fill=(255, 255, 255, 255))
    cy2 = int(h * 0.58)
    draw.rectangle([0, cy2, w - 1, cy2], fill=(220, 230, 255, 255))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    im.convert("RGB").save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
