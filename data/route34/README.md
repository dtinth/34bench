# Route 34 input image

**Title:** 34bench input image — Bangkok bus route 34 (derived from BMA open data)

## Source

- **Document:** หมวด 1 สายที่ 34 รังสิต - ถนนพหลโยธิน - หัวลำโพง
- **Publisher:** Bangkok Metropolitan Administration (กรุงเทพมหานคร), via the BMA open data portal
- **Dataset maintainer:** กองสารสนเทศภูมิศาสตร์
- **Source URL:**
  https://data.bangkok.go.th/dataset/route1/resource/fe46b39e-d99f-4eb4-b5a9-dc43606f7eb1
- **Original license:** GNU Free Documentation License (no version given)

## License

Copyright © Bangkok Metropolitan Administration.\
Modifications copyright © 2026 34bench contributors.

Permission is granted to copy, distribute and/or modify this document under the terms of the GNU
Free Documentation License, Version 1.3 or any later version published by the Free Software
Foundation; with no Invariant Sections, no Front-Cover Texts, and no Back-Cover Texts. A copy of the
license is included in [../COPYING](../COPYING).

The source dataset does not give a GFDL version number. Section 10 of the GFDL lets us choose any
published version, so we use version 1.3.

## History

1. **2023-12-14** — "หมวด 1 สายที่ 34 รังสิต - ถนนพหลโยธิน - หัวลำโพง". Published by the Bangkok
   Metropolitan Administration on the BMA open data portal as a 1-page PDF scan, at the source URL
   above.
2. **2026-09-28** — "34bench input image — Bangkok bus route 34". Modified by 34bench contributors.
   Changes:
   - Extracted the embedded grayscale JPEG image (7016×4961, 600 ppi) from the PDF, without
     rendering the page.
   - Rotated the image 90° counter-clockwise, to match the `/Rotate 270` of the PDF page.
   - Saved the result as `route34.png` (lossless, 4961×7016).
   - Converted `route34.png` to `route34.webp` (lossy, quality 80) for use in the main README.
   - Resized `route34.png` to half size (Lanczos, 2480×3508, 300 ppi) and saved it as
     `route34-300dpi.png`, for models that do not accept the full-size image.
   - Cropped the header, forward trip, return trip, and footer from `route34.png`, and saved them in
     `crops/` (WebP, quality 80). See `scripts/make-crops.py`.
   - Transcribed the header, forward trip, return trip, and footer into `ground-truth.json`. The
     footer was read with help from the same footer block on the route 20 document of the same
     dataset, and from section 31 (๖) of the Land Transport Act B.E. 2522.

## Files

| File                 | Description                                                        |
| -------------------- | ------------------------------------------------------------------ |
| `route34.png`        | Input image for the models.                                        |
| `route34.webp`       | Smaller copy of the same image, for the README.                    |
| `route34-300dpi.png` | Half-size copy, for models that do not accept the full-size image. |
| `crops/*.webp`       | Crops of the 4 scored parts, for the results table.                |
| `ground-truth.json`  | Human transcription of the 4 scored parts.                         |
