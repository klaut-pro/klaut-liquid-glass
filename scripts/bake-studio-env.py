#!/usr/bin/env python3
"""Bake knife-edge studio softbox plate for wet-mirror glyph QA (Blender unavailable)."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "demo" / "env" / "studio-softbox.png"


def knife_v(draw: ImageDraw.ImageDraw, w: int, h: int, cx: float, core: int, rgb: tuple[int, int, int], a: int) -> None:
    x0 = max(0, int(cx - core / 2))
    draw.rectangle([x0, 0, x0 + max(1, core) - 1, h - 1], fill=(*rgb, a))


def main() -> None:
    w, h = 1024, 1024
    im = Image.new("RGBA", (w, h), (2, 2, 6, 255))
    px = im.load()

    # Soft colored ambient (no white) — midtones without milking bars
    for x in range(w):
        t = x / (w - 1)
        for y in range(h):
            r, g, b, a = px[x, y]
            # left cool shoulder
            cool = max(0.0, 1.0 - abs(t - 0.28) / 0.18) * 0.12
            # right magenta
            mag = max(0.0, 1.0 - abs(t - 0.82) / 0.2) * 0.1
            # top key
            key = max(0.0, 1.0 - ((x / w - 0.14) ** 2 + (y / h - 0.08) ** 2) / 0.12) * 0.22
            r = min(255, int(r + cool * 90 + mag * 160 + key * 180))
            g = min(255, int(g + cool * 140 + mag * 40 + key * 210))
            b = min(255, int(b + cool * 200 + mag * 120 + key * 255))
            px[x, y] = (r, g, b, 255)

    draw = ImageDraw.Draw(im, "RGBA")
    # Knife-edge vertical softboxes — 2–4px hard cores
    knife_v(draw, w, h, w * 0.30, 4, (255, 252, 248), 255)
    knife_v(draw, w, h, w * 0.71, 3, (200, 230, 255), 235)
    knife_v(draw, w, h, w * 0.18, 2, (255, 180, 240), 160)
    knife_v(draw, w, h, w * 0.48, 2, (120, 255, 250), 150)
    knife_v(draw, w, h, w * 0.58, 2, (255, 255, 220), 120)
    # Horizontal strip
    cy = int(h * 0.25)
    draw.rectangle([0, cy - 2, w - 1, cy + 1], fill=(255, 255, 255, 240))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    im.convert("RGB").save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
