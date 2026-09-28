# 34bench

A benchmark: can a model read this scanned document for Bangkok bus route 34, and transcribe it?

![A faded scan of a typewritten Thai document for bus route 34, Rangsit – Phahonyothin Road – Hua Lamphong. It has a text description of the outbound and return trips, a hand-drawn route map, and a faint footer.](data/route34/route34.webp)

Image derived from
[Bangkok Metropolitan Administration open data](https://data.bangkok.go.th/dataset/route1/resource/fe46b39e-d99f-4eb4-b5a9-dc43606f7eb1),
GFDL 1.3. See [data/route34](data/route34/).

## Results

![Results table. For each model: rank, character error rate, time, cost in THB, and the transcribed header, forward trip, return trip, and footer, with wrong text in red and missing text in green.](results.svg)

The results table is a derivative of the document (it contains crops, the ground truth, and model
transcriptions), so it is also under the GFDL 1.3. See [data/COPYING](data/COPYING).

## Method

- Each model gets [`route34.png`](data/route34/route34.png) and this prompt (see
  [`src/run.ts`](src/run.ts)): "Transcribe this image into a Markdown document. Output only the
  Markdown, with no commentary. For each figure, write an HTML `<figure>` element with a description
  of the figure inside it." OCR services (Paxa, iApp) get only the image.
- From each response, the header, forward trip, return trip, and footer are extracted into
  `extracted.json`. The map (section 2) is not scored. See
  [`results/README.md`](results/README.md#extraction-rules).
- The score is the character error rate (CER): the sum of the edit distances of the 4 parts, divided
  by the total length of the [ground truth](data/route34/ground-truth.json). The unit is a grapheme
  cluster (`Intl.Segmenter`), so a Thai mark counts with its base character. Before scoring, markup
  is removed, all dashes are the same, dot leaders are removed, and whitespace is collapsed. Thai
  and Arabic digits are different.
- Each configuration can have up to 5 runs. The table shows the run with the median CER.
- Prices are in THB: 1 USD = 35 THB; Paxa: 329 THB per 10,000 credits; iApp: 1.25 THB per IC (list
  prices).

## Commands

```sh
deno task run --model google/gemini-3.8-flash --effort low --runs 5   # OpenRouter
deno task paxa --runs 1                                              # Paxa Labs OCR
deno task iapp --runs 1                                              # iApp OCR
deno task test                                                       # check extracted.json
deno run --allow-read src/score.ts                                   # print scores
deno task render                                                     # write results.svg
```

API keys are read from `.env`: `OPENROUTER_API_KEY`, `PAXA_API_KEY`, `IAPP_API_KEY`.
