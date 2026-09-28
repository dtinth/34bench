# Results

One directory for each model and parameter combination, named `<provider>~<model>@<effort>`.

| File             | Description                                                                      |
| ---------------- | -------------------------------------------------------------------------------- |
| `response.md`    | The Markdown that the model returned.                                            |
| `raw.json`       | The raw API response.                                                            |
| `meta.json`      | Model, parameters, prompt, date, duration, cost, and token usage.                |
| `extracted.json` | The header, forward trip, return trip, and footer, extracted from `response.md`. |

In `extracted.json`, each value must be an exact substring of `response.md`, or `null` if the model
did not transcribe that part. `deno test` checks this.

## License

The model outputs and the extractions are transcriptions of the
[route 34 document](../data/route34/), so they are derivative works of it. They are released under
the GNU Free Documentation License, Version 1.3 or any later version, with no Invariant Sections, no
Front-Cover Texts, and no Back-Cover Texts. See [../data/COPYING](../data/COPYING).
