"""Regenerates the NSIS installer bitmaps (sidebar.bmp 164x314, header.bmp 150x57) in the app's retro-terminal look.

    python crates/desktop/installer/make_images.py      (needs Pillow; Consolas from C:/Windows/Fonts)
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
LOGO = HERE.parents[2] / "frontend" / "public" / "logo-wordmark.png"
BG = (11, 11, 10)
AMBER = (245, 166, 35)
DIM = (140, 96, 22)
FONT = "C:/Windows/Fonts/consolab.ttf"


def canvas(w: int, h: int) -> Image.Image:
    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)
    for y in range(2, h, 3):  # scanlines, as behind the app's panes
        d.line([(0, y), (w, y)], fill=(17, 17, 15))
    return img


def paste_logo(img: Image.Image, width: int, top: int) -> int:
    logo = Image.open(LOGO).convert("RGBA")
    logo = logo.resize((width, round(logo.height * width / logo.width)), Image.LANCZOS)
    img.paste(logo, ((img.width - width) // 2, top), logo)
    return top + logo.height


def sidebar() -> None:
    img = canvas(164, 314)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 163, 313], outline=DIM)
    d.rectangle([0, 0, 163, 18], fill=(18, 17, 16))
    d.text((8, 3), "- SETUP", font=ImageFont.truetype(FONT, 11), fill=AMBER)
    bottom = paste_logo(img, 140, 70)
    small = ImageFont.truetype(FONT, 11)
    for i, line in enumerate(["// local-first", "// AI job search"]):
        d.text((12, bottom + 22 + i * 16), line, font=small, fill=DIM)
    d.text((12, 280), "> install", font=small, fill=AMBER)
    d.rectangle([74, 281, 80, 292], fill=AMBER)  # block cursor
    img.save(HERE / "sidebar.bmp")


def header() -> None:
    img = canvas(150, 57)
    paste_logo(img, 112, 6)
    img.save(HERE / "header.bmp")


if __name__ == "__main__":
    sidebar()
    header()
