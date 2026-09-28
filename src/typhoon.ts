// Runner for Typhoon OCR (https://opentyphoon.ai/model/typhoon-ocr). The model works only with its
// own prompt, so this runner sends the request in the same way as the official client
// (github.com/scb-10x/typhoon-ocr, typhoon_ocr.ocr_utils, task_type "v1.5", figure_language "Thai"):
// the same prompt, the same image preparation (scripts/make-typhoon-image.py), and the same
// sampling parameters. It saves the same files as src/run.ts.
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { load } from "jsr:@std/dotenv@0.225";
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { RUNS } from "./run.ts";

/** The v1.5 prompt of the official client, with figure_language "Thai". */
export const TYPHOON_PROMPT = `Extract all text from the image.


Instructions:
- Only return the clean Markdown.
- Do not include any explanation or extra text.
- You must include all information on the page.


Formatting Rules:
- Tables: Render tables using <table>...</table> in clean HTML format.
- Equations: Render equations using LaTeX syntax with inline ($...$) and block ($$...$$).
- Images/Charts/Diagrams: Wrap any clearly defined visual areas (e.g. charts, diagrams, pictures) in:


<figure>
Describe the image's main elements (people, objects, text), note any contextual clues (place, event, culture), mention visible text and its meaning, provide deeper analysis when relevant (especially for financial charts, graphs, or documents), comment on style or architecture if relevant, then give a concise overall summary. Describe in Thai.
</figure>


- Page Numbers: Wrap page numbers in <page_number>...</page_number> (e.g., <page_number>14</page_number>).
- Checkboxes: Use ☐ for unchecked and ☑ for checked boxes.
    `;

async function exists(url: URL) {
  try {
    await Deno.stat(url);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}

async function main() {
  const args = parseArgs(Deno.args, { string: ["model", "runs"] });
  const model = args.model ?? "typhoon-ocr";
  const runs = Number(args.runs ?? RUNS);

  const env = await load();
  const apiKey = Deno.env.get("TYPHOON_API_KEY") ?? env.TYPHOON_API_KEY;
  if (!apiKey) throw new Error("TYPHOON_API_KEY is not set.");

  const id = `typhoon~${model}`;
  const configDir = new URL(`../results/${id}/`, import.meta.url);
  const image = encodeBase64(
    await Deno.readFile(new URL("../data/route34/route34-typhoon.jpg", import.meta.url)),
  );

  for (let n = 1; n <= runs; n++) {
    const dir = new URL(`${n}/`, configDir);
    if (await exists(new URL("response.md", dir))) continue;
    console.error(`[${id}] run ${n}/${runs}...`);

    const started = performance.now();
    const res = await fetch("https://api.opentyphoon.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: TYPHOON_PROMPT },
            // The official client labels its JPEG data as PNG. We do the same.
            { type: "image_url", image_url: { url: `data:image/png;base64,${image}` } },
          ],
        }],
        max_tokens: 16384,
        temperature: 0.1,
        top_p: 0.6,
        repetition_penalty: 1.1,
      }),
      signal: AbortSignal.timeout(600_000),
    });
    const raw = await res.json();
    const durationMs = Math.round(performance.now() - started);
    if (!res.ok || raw.error) {
      throw new Error(`Request failed (${res.status}): ${JSON.stringify(raw.error ?? raw)}`);
    }

    const content: string = raw.choices?.[0]?.message?.content ?? "";
    const meta = {
      model: `typhoon/${model}`,
      effort: null,
      requestedProvider: null,
      image: "typhoon",
      prompt: TYPHOON_PROMPT,
      date: new Date().toISOString(),
      durationMs,
      // The Typhoon API is free (rate limited), so the cost is 0.
      cost: 0,
      usage: raw.usage ?? null,
      provider: "Typhoon",
      finishReason: raw.choices?.[0]?.finish_reason ?? null,
    };

    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(new URL("response.md", dir), content);
    await Deno.writeTextFile(new URL("raw.json", dir), JSON.stringify(raw, null, 2) + "\n");
    await Deno.writeTextFile(new URL("meta.json", dir), JSON.stringify(meta, null, 2) + "\n");
    console.error(`[${id}] run ${n}/${runs} done in ${(durationMs / 1000).toFixed(1)}s`);
  }
}

if (import.meta.main) await main();
