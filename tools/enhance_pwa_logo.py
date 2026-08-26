from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "skalee-symbol-source.png"

ICON_SPECS = (
    ("skalee-icon-64.png", 64, 0.76),
    ("skalee-icon-192.png", 192, 0.76),
    ("skalee-icon-512.png", 512, 0.76),
    ("skalee-icon-maskable-192.png", 192, 0.62),
    ("skalee-icon-maskable-512.png", 512, 0.62),
)


def trim_symbol(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    luma = ImageOps.grayscale(rgba)
    visible = ImageChops.lighter(alpha, luma.point(lambda px: 255 if px > 18 else 0))
    bbox = visible.getbbox()
    if not bbox:
        raise ValueError("Could not find visible logo pixels.")
    return rgba.crop(bbox)


def clean_symbol(symbol: Image.Image) -> Image.Image:
    rgba = symbol.convert("RGBA")
    r, g, b, a = rgba.split()
    luma = ImageOps.grayscale(rgba)

    cleaner_alpha = ImageChops.multiply(a, luma.point(lambda px: 0 if px < 26 else min(255, int(px * 1.55))))
    cleaned = Image.merge("RGBA", (r, g, b, cleaner_alpha))

    cleaned = ImageEnhance.Contrast(cleaned).enhance(1.12)
    cleaned = ImageEnhance.Color(cleaned).enhance(1.08)
    cleaned = cleaned.filter(ImageFilter.UnsharpMask(radius=1.35, percent=145, threshold=3))
    return cleaned


def resize_contain(image: Image.Image, max_size: int) -> Image.Image:
    copy = image.copy()
    copy.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
    return copy


def vertical_gradient(size: int) -> Image.Image:
    top = (5, 14, 30, 255)
    bottom = (10, 48, 105, 255)
    gradient = Image.new("RGBA", (size, size))
    pixels = gradient.load()
    for y in range(size):
        amount = y / max(1, size - 1)
        row = tuple(round(top[i] * (1 - amount) + bottom[i] * amount) for i in range(4))
        for x in range(size):
            pixels[x, y] = row
    return gradient


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def draw_icon(symbol: Image.Image, output: Path, size: int, scale: float) -> None:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mask = rounded_mask(size, round(size * 0.22))
    background = vertical_gradient(size)
    canvas.alpha_composite(Image.composite(background, canvas, mask))

    border = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(border)
    inset = round(size * 0.055)
    draw.rounded_rectangle(
        (inset, inset, size - inset - 1, size - inset - 1),
        radius=round(size * 0.18),
        outline=(70, 187, 255, 82),
        width=max(1, round(size * 0.018)),
    )
    canvas.alpha_composite(border)

    prepared = resize_contain(symbol, round(size * scale))
    x = round((size - prepared.width) / 2)
    y = round((size - prepared.height) / 2)

    shadow_alpha = prepared.getchannel("A").filter(ImageFilter.GaussianBlur(max(1, round(size * 0.018))))
    shadow = Image.new("RGBA", prepared.size, (0, 0, 0, 92))
    shadow.putalpha(shadow_alpha)
    offset = max(1, round(size * 0.025))
    canvas.alpha_composite(shadow, (x + offset, y + offset))
    canvas.alpha_composite(prepared, (x, y))

    canvas.save(output, optimize=True)


def main() -> None:
    source = Image.open(SOURCE)
    symbol = clean_symbol(trim_symbol(source))

    enhanced = resize_contain(symbol, 1024)
    enhanced.save(ROOT / "skalee-symbol-enhanced.png", optimize=True)

    for file_name, size, scale in ICON_SPECS:
        draw_icon(symbol, ROOT / file_name, size, scale)


if __name__ == "__main__":
    main()
