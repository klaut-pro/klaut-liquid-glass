"""Bake studio softbox plate for wet-mirror glyph QA (Blender unavailable).

Iteration 25+: prefer concept-art HDRI harvest (`bake-concept-env.py`).
This script remains a cool procedural fallback if concept paths are missing.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    concept = ROOT / "scripts" / "bake-concept-env.py"
    concept_art = ROOT.parent / "klaut.pro" / "concept_art" / "1c6PD.jpg"
    if concept.exists() and concept_art.exists():
        import runpy

        runpy.run_path(str(concept), run_name="__main__")
        return

    from PIL import Image, ImageDraw

    OUT = ROOT / "demo" / "env" / "studio-softbox.png"
    w, h = 2048, 2048
    im = Image.new("RGBA", (w, h), (0, 0, 0, 255))
    draw = ImageDraw.Draw(im, "RGBA")

    def panel_v(cx: float, half_w: int, rgb: tuple[int, int, int]) -> None:
        x0 = max(0, int(round(cx - half_w)))
        x1 = min(w - 1, int(round(cx + half_w)))
        draw.rectangle([x0, 0, x1, h - 1], fill=(*rgb, 255))

    def knife_v(cx: float, core: int, rgb: tuple[int, int, int]) -> None:
        x0 = max(0, int(round(cx - core / 2)))
        draw.rectangle([x0, 0, x0 + max(1, core) - 1, h - 1], fill=(*rgb, 255))

    panel_v(w * 0.18, 28, (40, 180, 255))
    panel_v(w * 0.34, 30, (180, 90, 255))
    panel_v(w * 0.50, 34, (240, 250, 255))
    panel_v(w * 0.66, 28, (120, 255, 80))
    panel_v(w * 0.82, 24, (255, 190, 50))
    knife_v(w * 0.18, 3, (200, 255, 255))
    knife_v(w * 0.50, 4, (255, 255, 255))
    knife_v(w * 0.66, 3, (210, 255, 180))
    cy = int(h * 0.18)
    draw.rectangle([0, cy - 1, w - 1, cy + 1], fill=(255, 255, 255, 255))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    im.convert("RGB").save(OUT, "PNG", optimize=True)
    print(f"wrote fallback {OUT}")


if __name__ == "__main__":
    main()
