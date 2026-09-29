# Slides

The slides show the results as square slides, in `slides/34bench.pdf`. The PDF and the images are
not in the repository. Build them with:

```sh
uvx --with pillow --with segno python scripts/make-slide-images.py   # images/ (crops, preview, page)
scripts/build-slides.sh                                 # 34bench.pdf (needs Chromium and Poppler)
```

The generator is [`src/slides.tsx`](../src/slides.tsx). The slides use the scores in `results/`.

The slides contain crops and transcriptions of the route 34 document, so they are under the GNU Free
Documentation License 1.3 (see [../data/COPYING](../data/COPYING)). The fonts are under the SIL Open
Font License 1.1 (see [../fonts](../fonts/)).
