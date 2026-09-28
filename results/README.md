# Results

One directory for each model and parameter combination, named `<provider>~<model>@<effort>`. Each
combination is run up to 3 times, in the subdirectories `1` to `3`. Each run has these files:

| File             | Description                                                                      |
| ---------------- | -------------------------------------------------------------------------------- |
| `response.md`    | The Markdown that the model returned.                                            |
| `raw.json`       | The raw API response.                                                            |
| `meta.json`      | Model, parameters, prompt, date, duration, cost, and token usage.                |
| `extracted.json` | The header, forward trip, return trip, and footer, extracted from `response.md`. |

In `extracted.json`, each value is plain text with no markup. When the markup is removed from
`response.md` and all whitespace is collapsed, each value must be a substring of it. If the position
is empty, the value is `""`. `deno test` checks this, so an extraction cannot contain text that the
model did not write.

## Extraction rules

Each column comes from its position in the response. Extract the text at that position, even when
the text is wrong, made up, or about a different document.

- **`header`**: the title text at the top of the response, before section 1 (the first numbered
  section).
- **`forward`**: the text of the first sub-part of section 1. This is normally below a "เที่ยวไป"
  label. The label word can be different, for example "เมื่อไป". If section 1 has no sub-labels, use
  the first paragraph of section 1. The label is not part of the value.
- **`return`**: the text of the second sub-part of section 1. This is normally below a "เที่ยวกลับ"
  label (or "เมื่อกลับ"). The label is not part of the value.
- **`footer`**: the text after the `<figure>` element. If the response has no text after the
  `<figure>`, look for a transcription of the footer elsewhere, outside the `<figure>`. A
  description of the footer (for example, inside the `<figure>`, or an English note such as
  "Signature block area…") is not a transcription, so it is not a footer value.
- A placeholder that the model wrote at a position (for example, "[ข้อความจาง อ่านไม่ชัด]") is the value
  for that position. Extract it as it is.
- Use `""` only when the response has nothing at all at that position. For example, use `""` for
  `forward` and `return` when the response is only a `<figure>`, with no section 1.
- Remove all Markdown and HTML markup (for example `**`, `#`, `<u>`, `<br>`, `&nbsp;`). Keep only
  the text. Line breaks and spaces can be different from `response.md`.
- Do not correct or rewrite the text. Except for the markup and whitespace, copy it exactly as it is
  in `response.md`.

## License

The model outputs and the extractions are transcriptions of the
[route 34 document](../data/route34/), so they are derivative works of it. They are released under
the GNU Free Documentation License, Version 1.3 or any later version, with no Invariant Sections, no
Front-Cover Texts, and no Back-Cover Texts. See [../data/COPYING](../data/COPYING).
