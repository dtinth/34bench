#!/bin/bash
# Build slides/34bench.pdf from src/slides.tsx. Optional argument: slides to include, e.g. "1,2,3,4,last".
set -e
cd "$(dirname "$0")/.."
deno run --allow-read --allow-write=slides --allow-env src/slides.tsx "$@"
chromium --headless=new --no-sandbox --disable-gpu --allow-file-access-from-files \
  --no-pdf-header-footer --virtual-time-budget=10000 --run-all-compositor-stages-before-draw \
  --print-to-pdf="$PWD/slides/34bench.pdf" "file://$PWD/slides/index.html" 2>/dev/null
rm -rf slides/png && mkdir -p slides/png
pdftoppm -r 72 -png slides/34bench.pdf slides/png/slide
ls slides/png
