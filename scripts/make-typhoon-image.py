# Make the input image for Typhoon OCR, the same way as the official client does it
# (typhoon_ocr.ocr_utils, task_type "v1.5"): resize so that the longest side is 1800 px (Lanczos),
# convert to RGB, and save as JPEG with the Pillow default quality.
# Run: uvx --with pillow python scripts/make-typhoon-image.py
from pathlib import Path

from PIL import Image

DIR = Path(__file__).resolve().parent.parent / "data" / "route34"
MAX_SIZE = 1800

img = Image.open(DIR / "route34.png")
width, height = img.size
if width >= height:
    size = (MAX_SIZE, int(height * MAX_SIZE / float(width)))
else:
    size = (int(width * MAX_SIZE / float(height)), MAX_SIZE)
img = img.resize(size, Image.Resampling.LANCZOS).convert("RGB")
img.save(DIR / "route34-typhoon.jpg", format="JPEG")
print(size)
