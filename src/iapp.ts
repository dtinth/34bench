// Runner for the iApp Thai Document OCR API (https://iapp.co.th/docs/ocr/document). It is an OCR
// service with no Markdown output, so we use the plain text endpoint. It takes no prompt. It saves
// the same files as src/run.ts.
//
// The endpoint has no model parameter. On 2026-10-05, iApp replaced the model behind it with v3, and
// the price went from 1 IC to 0.049 IC per page. The runs before that date are in
// `results/iapp~document-ocr/` (v2). New runs go to `results/iapp~document-ocr-v3/`.
import { load } from "jsr:@std/dotenv@0.225";
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { IMAGES, runId, RUNS } from "./run.ts";

/** IC per page for the plain text endpoint (v3). */
const IC_PER_PAGE = 0.049;

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
  const args = parseArgs(Deno.args, { string: ["image", "runs"] });
  const imageName = args.image ?? "full";
  if (!(imageName in IMAGES)) throw new Error(`Unknown image: ${imageName}`);
  const runs = Number(args.runs ?? RUNS);

  const env = await load();
  const apiKey = Deno.env.get("IAPP_API_KEY") ?? env.IAPP_API_KEY;
  if (!apiKey) throw new Error("IAPP_API_KEY is not set.");

  const model = "iapp/document-ocr-v3";
  const id = runId(model, undefined, undefined, imageName);
  const configDir = new URL(`../results/${id}/`, import.meta.url);
  const image = await Deno.readFile(new URL(IMAGES[imageName], import.meta.url));

  for (let n = 1; n <= runs; n++) {
    const dir = new URL(`${n}/`, configDir);
    if (await exists(new URL("response.md", dir))) continue;
    console.error(`[${id}] run ${n}/${runs}...`);

    const form = new FormData();
    form.append("file", new Blob([image], { type: "image/png" }), "route34.png");
    const started = performance.now();
    const res = await fetch("https://api.iapp.co.th/v3/store/ocr/document/ocr", {
      method: "POST",
      headers: { apikey: apiKey },
      body: form,
      signal: AbortSignal.timeout(300_000),
    });
    const raw = await res.json();
    const durationMs = Math.round(performance.now() - started);
    if (!res.ok || !Array.isArray(raw.text)) {
      throw new Error(`Request failed (${res.status}): ${JSON.stringify(raw)}`);
    }

    const content = raw.text.join("\n\n");
    const pages = Number(res.headers.get("iapp-input-pages") ?? raw.iapp?.page ?? NaN) || null;
    const meta = {
      model,
      effort: null,
      requestedProvider: null,
      image: imageName,
      prompt: null,
      date: new Date().toISOString(),
      durationMs,
      // iApp bills in IC, not USD.
      cost: null,
      credits: pages ? pages * IC_PER_PAGE : null,
      usage: raw.iapp ?? null,
      provider: "iApp",
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
