from collections import deque
from pathlib import Path
from PIL import Image


def components(mask, width, height):
    seen = bytearray(width * height)
    found = []
    for y in range(height):
        for x in range(width):
            idx = y * width + x
            if seen[idx] or not mask[idx]:
                continue
            seen[idx] = 1
            queue = deque([(x, y)])
            xs = []
            ys = []
            while queue:
                cx, cy = queue.popleft()
                xs.append(cx)
                ys.append(cy)
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < width and 0 <= ny < height:
                        ni = ny * width + nx
                        if not seen[ni] and mask[ni]:
                            seen[ni] = 1
                            queue.append((nx, ny))
            found.append((len(xs), (min(xs), min(ys), max(xs) + 1, max(ys) + 1)))
    return sorted(found, reverse=True)


def bright_components(path, threshold=210, alpha_threshold=0, resize=None):
    image = Image.open(path).convert("RGBA")
    if resize:
        image = image.resize(resize)
    width, height = image.size
    px = image.load()
    mask = []
    for y in range(height):
        for x in range(width):
            r, g, b, a = px[x, y]
            mask.append(a > alpha_threshold and r > threshold and g > threshold and b > threshold)
    return image.size, components(mask, width, height)


def report_reference():
    size, comps = bright_components("assets/skalito.jpg", resize=(1000, 1000))
    print("reference", size)
    for area, bbox in comps[:12]:
        if area < 50:
            continue
        x1, y1, x2, y2 = bbox
        print(area, bbox, "center", (round((x1 + x2) / 2, 1), round((y1 + y2) / 2, 1)), "size", (x2 - x1, y2 - y1))


def report_asset(path):
    size, comps = bright_components(path, threshold=200, alpha_threshold=20)
    print(path, size)
    for area, bbox in comps[:8]:
        if area < 50:
            continue
        x1, y1, x2, y2 = bbox
        print(area, bbox, "center", (round((x1 + x2) / 2, 1), round((y1 + y2) / 2, 1)), "size", (x2 - x1, y2 - y1))


if __name__ == "__main__":
    report_reference()
    for asset in (
        "assets/skalito/eye-left.png",
        "assets/skalito/eye-right.png",
        "assets/skalito/arm-left.png",
    ):
        if Path(asset).exists():
            report_asset(asset)
