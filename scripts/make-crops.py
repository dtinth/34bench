# Make the crops of the route 34 image that the results table shows in its "image" row.
# Run: uvx --with pillow python scripts/make-crops.py
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DIR = ROOT / "data" / "route34"

# Boxes (left, top, right, bottom) on route34.png (4961×7016).
BOXES = {
    "header": (900, 350, 4300, 850),
    "forward": (550, 1450, 4600, 1850),
    "return": (550, 1880, 4650, 2600),
    "footer": (2650, 5650, 4300, 6800),
}

# Width of each crop in the table, in pixels. The files are 2× for sharp display.
WIDTH = 2 * 440

image = Image.open(DIR / "route34.png")
(DIR / "crops").mkdir(exist_ok=True)
for name, box in BOXES.items():
    crop = image.crop(box)
    width = WIDTH if name != "footer" else WIDTH * 2 // 3
    crop = crop.resize((width, round(crop.height * width / crop.width)), Image.LANCZOS)
    crop.save(DIR / "crops" / f"{name}.webp", quality=80, method=6)
    print(name, crop.size)
