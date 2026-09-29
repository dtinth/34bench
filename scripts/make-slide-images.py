# Make the images for the slides: the whole page, a mini preview, and the 4 crops. All crops use
# the same zoom, so that the text has the same size on the slide.
# Run: uvx --with pillow --with segno python scripts/make-slide-images.py
import json
from pathlib import Path

import segno
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DIR = ROOT / "data" / "route34"
OUT = ROOT / "slides" / "images"

# Pixels on the slide for each pixel of route34.png. The files are 2× for sharp display.
ZOOM = 0.16
PREVIEW_WIDTH = 190
PAGE_HEIGHT = 900
# Slide 1 shows the page at this width, from its top edge to the bottom of the slide.
TITLE_WIDTH, TITLE_HEIGHT = 729, 912
# The ground truth slides show the top or the bottom of the page at this size.
PART_WIDTH, PART_HEIGHT = 968, 832

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
    # Slide 1: the top of the page, at a smaller width. It continues past the bottom of the slide.
    "page-map": save(
        image.crop((0, 0, image.width, round(image.width * TITLE_HEIGHT / TITLE_WIDTH))),
        "page-map.jpg",
        TITLE_WIDTH,
    ),
    # Slide 2: the top of the page, in full slide width.
    "page-top": save(
        image.crop((0, 0, image.width, round(image.width * PART_HEIGHT / PART_WIDTH))),
        "page-top.jpg",
        PART_WIDTH,
    ),
    # Slide 3: the rest of the page, from where slide 2 ends.
    "page-bottom": save(
        image.crop((0, round(image.width * PART_HEIGHT / PART_WIDTH), image.width, image.height)),
        "page-bottom.jpg",
        PART_WIDTH,
    ),
}
for name, box in BOXES.items():
    crop = image.crop(tuple(box))
    sizes[name] = save(crop, f"{name}.jpg", round(crop.width * ZOOM))

# A QR code for the last slide. It goes to the repository.
segno.make("https://d4h.cc/34bench", error="m").save(
    OUT / "qr.svg", border=0, dark="#161b12", light=None, xmldecl=False
)

(OUT / "sizes.json").write_text(json.dumps({"zoom": ZOOM, "sizes": sizes}, indent=2) + "\n")
print(sizes)
