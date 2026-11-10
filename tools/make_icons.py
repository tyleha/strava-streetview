"""Render the SSV extension icons into icons/.

Usage: python3 tools/make_icons.py   (needs Pillow)
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"
FONT = "/usr/share/fonts/truetype/ubuntu/UbuntuSans[wdth,wght].ttf"
ORANGE = (252, 76, 2, 255)  # Strava orange
WHITE = (255, 255, 255, 255)
SIZES = [16, 32, 48, 128]
BASE = 1024  # draw large, then downscale for clean edges


def load_font(px):
    font = ImageFont.truetype(FONT, px)
    # Heaviest weight, narrowest width so three letters fit a square.
    values = []
    for a in font.get_variation_axes():
        name = a["name"].lower() if isinstance(a["name"], str) else a["name"].decode().lower()
        values.append(a["minimum"] if "width" in name else a["maximum"])
    font.set_variation_by_axes(values)
    return font


def draw_master():
    img = Image.new("RGBA", (BASE, BASE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, BASE - 1, BASE - 1], radius=int(BASE * 0.22), fill=ORANGE)

    # Fit "SSV" to ~84% of the width.
    text = "SSV"
    target_w = BASE * 0.84
    px = 600
    font = load_font(px)
    w = d.textlength(text, font=font)
    px = int(px * target_w / w)
    font = load_font(px)
    l, t, r, b = d.textbbox((0, 0), text, font=font)
    x = (BASE - (r - l)) / 2 - l
    y = (BASE - (b - t)) / 2 - t
    d.text((x, y), text, font=font, fill=WHITE)
    return img


def main():
    OUT.mkdir(exist_ok=True)
    master = draw_master()
    for s in SIZES:
        master.resize((s, s), Image.LANCZOS).save(OUT / f"icon{s}.png")
        print("wrote", OUT / f"icon{s}.png")


if __name__ == "__main__":
    main()
