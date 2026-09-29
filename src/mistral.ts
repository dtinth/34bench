// Runner for Mistral OCR (https://docs.mistral.ai/studio/document-processing/basic_ocr).
// It takes no prompt and saves the same files as src/run.ts.
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { load } from "jsr:@std/dotenv@0.225";
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { IMAGES, runId, RUNS } from "./run.ts";

const PRICE_PER_PAGE: Record<string, number> = {
  "mistral-ocr-2512": 0.002, // Mistral OCR 3
  "mistral-ocr-4-0": 0.004, // Mistral OCR 4
  "mistral-ocr-4-1": 0.004, // Mistral OCR 4.1
};

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
  const args = parseArgs(Deno.args, { string: ["model", "image", "runs"] });
  const model = args.model ?? "mistral-ocr-4-1";
  if (!(model in PRICE_PER_PAGE)) throw new Error(`Unknown Mistral OCR model: ${model}`);
  const imageName = args.image ?? "full";
  if (!(imageName in IMAGES)) throw new Error(`Unknown image: ${imageName}`);
  const runs = Number(args.runs ?? RUNS);

  const env = await load();
  const apiKey = Deno.env.get("MISTRAL_API_KEY") ?? env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error("MISTRAL_API_KEY is not set.");

  const id = runId(`mistral/${model}`, undefined, undefined, imageName);
  const configDir = new URL(`../results/${id}/`, import.meta.url);
  const image = encodeBase64(await Deno.readFile(new URL(IMAGES[imageName], import.meta.url)));

  for (let n = 1; n <= runs; n++) {
    const dir = new URL(`${n}/`, configDir);
    if (await exists(new URL("response.md", dir))) continue;
    console.error(`[${id}] run ${n}/${runs}...`);

    const started = performance.now();
    const res = await fetch("https://api.mistral.ai/v1/ocr", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        document: { type: "image_url", image_url: `data:image/png;base64,${image}` },
      }),
      signal: AbortSignal.timeout(300_000),
    });
    const raw = await res.json();
    const durationMs = Math.round(performance.now() - started);
    if (!res.ok || !Array.isArray(raw.pages)) {
      throw new Error(`Request failed (${res.status}): ${JSON.stringify(raw.error ?? raw)}`);
    }

    const content = raw.pages.map((p: { markdown: string }) => p.markdown).join("\n\n");
    const meta = {
      model: `mistral/${model}`,
      effort: null,
      requestedProvider: null,
      image: imageName,
      prompt: null,
      date: new Date().toISOString(),
      durationMs,
      cost: raw.usage_info?.pages_processed == null
        ? null
        : raw.usage_info.pages_processed * PRICE_PER_PAGE[model],
      usage: raw.usage_info ?? null,
      provider: "Mistral",
      finishReason: null,
    };

    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(new URL("response.md", dir), content);
    await Deno.writeTextFile(new URL("raw.json", dir), JSON.stringify(raw, null, 2) + "\n");
    await Deno.writeTextFile(new URL("meta.json", dir), JSON.stringify(meta, null, 2) + "\n");
    console.error(`[${id}] run ${n}/${runs} done in ${(durationMs / 1000).toFixed(1)}s`);
  }
}

if (import.meta.main) await main();
