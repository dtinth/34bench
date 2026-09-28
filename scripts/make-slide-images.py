# Make the images for the slides: the whole page, a mini preview, and the 4 crops. All crops use
# the same zoom, so that the text has the same size on the slide.
# Run: uvx --with pillow python scripts/make-slide-images.py
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DIR = ROOT / "data" / "route34"
OUT = ROOT / "slides" / "images"

# Pixels on the slide for each pixel of route34.png. The files are 2× for sharp display.
ZOOM = 0.16
PREVIEW_WIDTH = 190
PAGE_HEIGHT = 900
TOP_WIDTH, TOP_HEIGHT = 968, 912

BOXES = json.loads((DIR / "crop-boxes.json").read_text())
image = Image.open(DIR / "route34.png")
OUT.mkdir(parents=True, exist_ok=True)


def save(img, name, width):
    height = round(img.height * width / img.width)
    img.resize((2 * width, 2 * height), Image.LANCZOS).save(OUT / name, quality=88)
    return [width, height]


sizes = {
    "page": save(image, "page.jpg", round(image.width * PAGE_HEIGHT / image.height)),
    "preview": save(image, "preview.jpg", PREVIEW_WIDTH),
    # The top of the page, for the title slide: full slide width minus margins.
    "page-top": save(
        image.crop((0, 0, image.width, round(image.width * TOP_HEIGHT / TOP_WIDTH))),
        "page-top.jpg",
        TOP_WIDTH,
    ),
}
for name, box in BOXES.items():
    crop = image.crop(tuple(box))
    sizes[name] = save(crop, f"{name}.jpg", round(crop.width * ZOOM))

(OUT / "sizes.json").write_text(json.dumps({"zoom": ZOOM, "sizes": sizes}, indent=2) + "\n")
print(sizes)
