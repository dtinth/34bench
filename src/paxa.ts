// Runner for the Paxa Labs OCR API (https://paxalabs.com/docs/ocr). It is an OCR service, not a
// chat model, so it takes no prompt. It saves the same files as src/run.ts.
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { load } from "jsr:@std/dotenv@0.225";
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { IMAGES, runId, RUNS } from "./run.ts";

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
  const model = args.model ?? "paxa-ocr-lite-v1";
  const imageName = args.image ?? "full";
  if (!(imageName in IMAGES)) throw new Error(`Unknown image: ${imageName}`);
  const runs = Number(args.runs ?? RUNS);

  const env = await load();
  const apiKey = Deno.env.get("PAXA_API_KEY") ?? env.PAXA_API_KEY;
  if (!apiKey) throw new Error("PAXA_API_KEY is not set.");

  const id = runId(`paxa/${model}`, undefined, undefined, imageName);
  const configDir = new URL(`../results/${id}/`, import.meta.url);
  const document = encodeBase64(await Deno.readFile(new URL(IMAGES[imageName], import.meta.url)));

  for (let n = 1; n <= runs; n++) {
    const dir = new URL(`${n}/`, configDir);
    if (await exists(new URL("response.md", dir))) continue;
    console.error(`[${id}] run ${n}/${runs}...`);

    const started = performance.now();
    const res = await fetch("https://api.paxalabs.com/v1/ocr", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({ document, model, output: "markdown" }),
      signal: AbortSignal.timeout(300_000),
    });
    const raw = await res.json();
    const durationMs = Math.round(performance.now() - started);
    if (!res.ok || raw.error) {
      throw new Error(`Request failed (${res.status}): ${JSON.stringify(raw.error ?? raw)}`);
    }

    const content = (raw.pages ?? []).map((p: { markdown: string }) => p.markdown).join("\n\n");
    const meta = {
      model: `paxa/${model}`,
      effort: null,
      requestedProvider: null,
      image: imageName,
      prompt: null,
      date: new Date().toISOString(),
      durationMs,
      // Paxa bills in credits, not USD.
      cost: null,
      credits: raw.usage?.credits ?? null,
      usage: raw.usage ?? null,
      provider: "Paxa Labs",
      finishReason: null,
    };

    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(new URL("response.md", dir), content);
    await Deno.writeTextFile(new URL("raw.json", dir), JSON.stringify(raw, null, 2) + "\n");
    await Deno.writeTextFile(new URL("meta.json", dir), JSON.stringify(meta, null, 2) + "\n");
    console.error(
      `[${id}] run ${n}/${runs} done in ${
        (durationMs / 1000).toFixed(1)
      }s, ${meta.credits} credits`,
    );
  }
}

if (import.meta.main) await main();
