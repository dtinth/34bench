# Make the crops of the route 34 image that the results table shows in its "image" row.
# Run: uvx --with pillow python scripts/make-crops.py
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DIR = ROOT / "data" / "route34"

# Boxes (left, top, right, bottom) on route34.png (4961×7016). The slides use the same boxes.
BOXES = json.loads((DIR / "crop-boxes.json").read_text())

# Width of each crop in the table, in pixels. The files are 2× for sharp display.
WIDTH = 2 * 440

image = Image.open(DIR / "route34.png")
(DIR / "crops").mkdir(exist_ok=True)
for name, box in BOXES.items():
    crop = image.crop(tuple(box))
    width = WIDTH if name != "footer" else WIDTH * 2 // 3
    crop = crop.resize((width, round(crop.height * width / crop.width)), Image.LANCZOS)
    crop.save(DIR / "crops" / f"{name}.webp", quality=80, method=6)
    print(name, crop.size)
