# Results

One directory for each model and parameter combination, named `<provider>~<model>@<effort>`. Each
combination is run 5 times, in the subdirectories `1` to `5`. Each run has these files:

| File             | Description                                                                      |
| ---------------- | -------------------------------------------------------------------------------- |
| `response.md`    | The Markdown that the model returned.                                            |
| `raw.json`       | The raw API response.                                                            |
| `meta.json`      | Model, parameters, prompt, date, duration, cost, and token usage.                |
| `extracted.json` | The header, forward trip, return trip, and footer, extracted from `response.md`. |

In `extracted.json`, each value must be an exact substring of `response.md`, or `null` if the model
did not transcribe that part. `deno test` checks this.

## Extraction rules

- **`header`**: from the first character of the title to the end of the "สำหรับ…" line, before
  section 1.
- **`forward`** / **`return`**: the text below the "เที่ยวไป" / "เที่ยวกลับ" label, without the label.
- **`footer`**: the transcribed text after the `<figure>`. A description of the footer (for example,
  inside the `<figure>`, or an English note such as "Signature block area…") is not a transcription,
  so it is not included.
- Markdown and HTML markup at the start and end of a value is not included. Markup inside a value
  cannot be removed, because the value must be an exact substring. The scoring removes it.

## License

The model outputs and the extractions are transcriptions of the
[route 34 document](../data/route34/), so they are derivative works of it. They are released under
the GNU Free Documentation License, Version 1.3 or any later version, with no Invariant Sections, no
Front-Cover Texts, and no Back-Cover Texts. See [../data/COPYING](../data/COPYING).
