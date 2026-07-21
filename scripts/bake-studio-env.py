#!/usr/bin/env python3
"""Bake studio softbox plate for wet-mirror glyph QA (Blender unavailable).

Iteration 23: iridescent planar knife softbox — hard chromatic slabs (cyan /
magenta / lime) + white razor cores on charcoal. No warm cream panels.
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
    """Hard rectangular softbox slab — planar knife wet-mirror (1c6PD/Z53Ve)."""
    x0 = max(0, int(round(cx - half_w)))
    x1 = min(w - 1, int(round(cx + half_w)))
    draw.rectangle([x0, 0, x1, h - 1], fill=(*rgb, alpha))


def main() -> None:
    w, h = 2048, 2048
    # Pure charcoal interstitial — wet-mirror voids between softbox slabs
    im = Image.new("RGBA", (w, h), (0, 0, 0, 255))
    draw = ImageDraw.Draw(im, "RGBA")

    # Iridescent planar slabs (oil-slick faces) — cool chroma only, never cream
    panel_v(draw, w, h, w * 0.22, 22, (70, 210, 255))   # cyan
    panel_v(draw, w, h, w * 0.40, 26, (255, 95, 210))    # magenta
    panel_v(draw, w, h, w * 0.58, 30, (255, 255, 255))   # white knife key
    panel_v(draw, w, h, w * 0.74, 22, (160, 255, 90))    # lime
    panel_v(draw, w, h, w * 0.88, 18, (255, 200, 60))    # gold accent

    # Razor knife cores on panel centers
    knife_v(draw, w, h, w * 0.22, 2, (220, 255, 255))
    knife_v(draw, w, h, w * 0.40, 2, (255, 220, 255))
    knife_v(draw, w, h, w * 0.58, 3, (255, 255, 255))
    knife_v(draw, w, h, w * 0.74, 2, (230, 255, 200))
    knife_v(draw, w, h, w * 0.88, 2, (255, 240, 180))

    # Horizontal strip — 2px hard core
    cy = int(h * 0.18)
    draw.rectangle([0, cy - 1, w - 1, cy + 1], fill=(255, 255, 255, 255))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    im.convert("RGB").save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
