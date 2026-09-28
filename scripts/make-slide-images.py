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
# Slide 1 shows the page down to the end of the map (y on route34.png), at this height.
MAP_BOTTOM, MAP_HEIGHT = 5650, 830
# The ground truth slides show the top or the bottom of the page at this size.
PART_WIDTH, PART_HEIGHT = 968, 912

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
    # Slide 1: the page from the top to the end of the map.
    "page-map": save(image.crop((0, 0, image.width, MAP_BOTTOM)), "page-map.jpg",
                     round(image.width * MAP_HEIGHT / MAP_BOTTOM)),
    # The two ground truth slides: the top and the bottom of the page, in full slide width.
    "page-top": save(
        image.crop((0, 0, image.width, round(image.width * PART_HEIGHT / PART_WIDTH))),
        "page-top.jpg",
        PART_WIDTH,
    ),
    "page-bottom": save(
        image.crop((0, image.height - round(image.width * PART_HEIGHT / PART_WIDTH), image.width,
                    image.height)),
        "page-bottom.jpg",
        PART_WIDTH,
    ),
}
for name, box in BOXES.items():
    crop = image.crop(tuple(box))
    sizes[name] = save(crop, f"{name}.jpg", round(crop.width * ZOOM))

(OUT / "sizes.json").write_text(json.dumps({"zoom": ZOOM, "sizes": sizes}, indent=2) + "\n")
print(sizes)
