#!/usr/bin/env python3
"""Bake studio softbox plate for wet-mirror glyph QA (Blender unavailable).

Iteration 19: planar mirror panels (medium-width softboxes) + knife cores.
True wet-mirror faces need reflected softbox *panels*, not only 1px streaks.
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


def panel_v(
    draw: ImageDraw.ImageDraw,
    w: int,
    h: int,
    cx: float,
    half_w: int,
    rgb: tuple[int, int, int],
    alpha: int = 255,
) -> None:
    """Medium softbox panel — planar chrome mirror faces (1c6PD/Z53Ve)."""
    x0 = max(0, int(round(cx - half_w)))
    x1 = min(w - 1, int(round(cx + half_w)))
    draw.rectangle([x0, 0, x1, h - 1], fill=(*rgb, alpha))


def main() -> None:
    w, h = 2048, 2048
    im = Image.new("RGBA", (w, h), (1, 1, 3, 255))
    px = im.load()

    # Near-black ambient — wet chrome interstitial (not lavender fog)
    for x in range(w):
        t = x / (w - 1)
        for y in range(h):
            r, g, b, _a = px[x, y]
            cool = max(0.0, 1.0 - abs(t - 0.26) / 0.12) * 0.03
            mag = max(0.0, 1.0 - abs(t - 0.84) / 0.14) * 0.028
            key = max(0.0, 1.0 - ((x / w - 0.12) ** 2 + (y / h - 0.06) ** 2) / 0.09) * 0.07
            r = min(255, int(r + cool * 30 + mag * 55 + key * 70))
            g = min(255, int(g + cool * 55 + mag * 12 + key * 85))
            b = min(255, int(b + cool * 90 + mag * 40 + key * 110))
            px[x, y] = (r, g, b, 255)

    draw = ImageDraw.Draw(im, "RGBA")
    # Planar softbox panels — mirrored environment bands (wet-mirror faces)
    panel_v(draw, w, h, w * 0.20, 18, (210, 235, 255))
    panel_v(draw, w, h, w * 0.32, 28, (255, 250, 245))
    panel_v(draw, w, h, w * 0.44, 14, (120, 240, 255))
    panel_v(draw, w, h, w * 0.52, 22, (255, 255, 255))
    panel_v(draw, w, h, w * 0.62, 16, (255, 160, 230))
    panel_v(draw, w, h, w * 0.74, 24, (200, 220, 255))
    panel_v(draw, w, h, w * 0.86, 12, (255, 200, 255))
    # Dense knife-edge cores on top of panels
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
