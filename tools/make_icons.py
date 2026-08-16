"""Render the app icon to PNG at the sizes phones actually ask for.

iOS ignores the web manifest's icons entirely and reads <link rel="apple-touch-icon">,
which must be a PNG; Android wants a maskable variant whose content survives being
cropped to a circle. One SVG cannot answer either, so the shapes are drawn here and
the PNGs are committed - the app itself still ships zero build steps.

Usage:  py -3 tools/make_icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"

INK = (28, 51, 39)        # --ink
CREAM = (244, 241, 230)   # door outline
ACCENT = (217, 96, 59)    # --accent, the handles

SUPER = 4  # draw big, downscale once: the only antialiasing PIL will give us


def draw_icon(size, inset):
    """A fridge: rounded body, a shelf line, two handles.

    `inset` is the share of the canvas left empty around the drawing. Android crops
    maskable icons to a circle, so that variant needs the fridge pulled well inside.
    """
    px = size * SUPER
    img = Image.new("RGB", (px, px), INK)
    d = ImageDraw.Draw(img)

    # Rounded corners only matter when the launcher does not mask them itself.
    if inset < 0.1:
        corner = Image.new("L", (px, px), 0)
        ImageDraw.Draw(corner).rounded_rectangle([0, 0, px - 1, px - 1], radius=int(px * 0.22), fill=255)
        flat = Image.new("RGB", (px, px), (0, 0, 0))
        img = Image.composite(img, flat, corner)
        img.putalpha(corner)
        d = ImageDraw.Draw(img)

    pad = px * inset
    span = px - 2 * pad

    # Proportions taken straight from icons/icon.svg so both stay one icon.
    body_w = span * 0.414
    body_h = span * 0.594
    x0 = (px - body_w) / 2
    y0 = (px - body_h) / 2
    stroke = max(2, int(span * 0.051))

    d.rounded_rectangle([x0, y0, x0 + body_w, y0 + body_h], radius=int(span * 0.086), outline=CREAM, width=stroke)

    shelf_y = y0 + body_h * 0.421
    d.line([x0, shelf_y, x0 + body_w, shelf_y], fill=CREAM, width=stroke)

    # Round caps, like the SVG: butt-ended handles read as two stray squares.
    handle_x = x0 + body_w * 0.255
    half = stroke / 2
    for top, height in ((y0 + body_h * 0.184, body_h * 0.112), (y0 + body_h * 0.572, body_h * 0.112)):
        d.rounded_rectangle(
            [handle_x - half, top - half, handle_x + half, top + height + half],
            radius=half,
            fill=ACCENT,
        )

    return img.resize((size, size), Image.LANCZOS)


TARGETS = [
    ("icon-180.png", 180, 0.0),   # apple-touch-icon
    ("icon-192.png", 192, 0.0),   # android launcher
    ("icon-512.png", 512, 0.0),   # install prompt, splash
    ("icon-maskable-512.png", 512, 0.18),  # cropped to a circle by the launcher
]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size, inset in TARGETS:
        icon = draw_icon(size, inset)
        path = OUT / name
        icon.save(path, "PNG", optimize=True)
        print(f"{name}  {size}x{size}  {path.stat().st_size} B")


if __name__ == "__main__":
    main()
