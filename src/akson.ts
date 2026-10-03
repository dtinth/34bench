// Runner for AksonOCR (https://aksonocr.com/docs/models). It takes no prompt and saves the same
// files as src/run.ts.
//
// - `AksonOCR-preview`, `AksonOCR-1.0` and `AksonOCR-handwriting` use the sync OCR v2 API
//   (`/api/v2/upload`). They are billed in credits.
// - `aksonocr1.5` is only available through the Document Parse API (`/api/v1/document-parse`),
//   which is async: submit the file, then poll until the job is done. It is free (0 credits per
//   page), with a rate limit of 20 requests per minute.
import { load } from "jsr:@std/dotenv@0.225";
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { IMAGES, runId, RUNS } from "./run.ts";

const BASE_URL = "https://backend.aksonocr.com";
/** Credits per page (https://aksonocr.com/docs/credits). OCR v2 does not return the credits used. */
const CREDITS_PER_PAGE: Record<string, number> = {
  "aksonocr1.5": 0,
  "AksonOCR-preview": 0.5,
  "AksonOCR-1.0": 1,
  "AksonOCR-handwriting": 2,
};

interface Result {
  raw: unknown;
  content: string;
  usage: { pages_processed?: number; credits_used?: number } | null;
}

async function exists(url: URL) {
  try {
    await Deno.stat(url);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}

/**
 * The response has the figure crops as base64 data URIs (hundreds of KB). Replace them with a
 * short marker, so that response.md and raw.json stay small.
 */
function omitImages(text: string): string {
  return text.replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, "data:image/omitted");
}

/** OCR v2: one sync request. */
async function ocrV2(
  apiKey: string,
  model: string,
  image: Uint8Array<ArrayBuffer>,
): Promise<Result> {
  const form = new FormData();
  form.append("file", new Blob([image], { type: "image/png" }), "route34.png");
  form.append("model", model);
  const res = await fetch(`${BASE_URL}/api/v2/upload`, {
    method: "POST",
    headers: { "X-API-Key": apiKey },
    body: form,
    signal: AbortSignal.timeout(300_000),
  });
  const raw = JSON.parse(omitImages(await res.text()));
  if (!res.ok || !Array.isArray(raw.pages)) {
    throw new Error(`Request failed (${res.status}): ${JSON.stringify(raw)}`);
  }
  const content = raw.pages.map((p: { markdown: string }) => p.markdown).join("\n\n");
  return { raw, content, usage: raw.usage ?? null };
}

/** Document Parse: submit a job, then poll until it is done. */
async function documentParse(apiKey: string, image: Uint8Array<ArrayBuffer>): Promise<Result> {
  const url = `${BASE_URL}/api/v1/document-parse`;
  const form = new FormData();
  form.append("document", new Blob([image], { type: "image/png" }), "route34.png");
  const started = performance.now();
  const submitRes = await fetch(url, {
    method: "POST",
    // A second job with no idempotency key fails (500, duplicate key), so send a new key each time.
    headers: { "X-API-Key": apiKey, "Idempotency-Key": crypto.randomUUID() },
    body: form,
    signal: AbortSignal.timeout(300_000),
  });
  const job = await submitRes.json();
  if (!submitRes.ok || !job.request_id) {
    throw new Error(`Submit failed (${submitRes.status}): ${JSON.stringify(job)}`);
  }

  let raw;
  while (true) {
    if (performance.now() - started > 600_000) throw new Error(`Timeout: ${job.request_id}`);
    await new Promise((r) => setTimeout(r, 1000));
    const res = await fetch(`${url}/${job.request_id}`, {
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(60_000),
    });
    raw = JSON.parse(omitImages(await res.text()));
    if (!res.ok) throw new Error(`Poll failed (${res.status}): ${JSON.stringify(raw)}`);
    if (raw.status !== "pending" && raw.status !== "processing") break;
  }
  if (raw.status !== "completed" || typeof raw.result?.content?.markdown !== "string") {
    throw new Error(
      `Job ${job.request_id} ended with status ${raw.status}: ${JSON.stringify(raw.error)}`,
    );
  }
  return { raw, content: raw.result.content.markdown, usage: raw.result.usage ?? null };
}

async function main() {
  const args = parseArgs(Deno.args, { string: ["model", "image", "runs"] });
  const model = args.model ?? "aksonocr1.5";
  if (!(model in CREDITS_PER_PAGE)) throw new Error(`Unknown AksonOCR model: ${model}`);
  const imageName = args.image ?? "full";
  if (!(imageName in IMAGES)) throw new Error(`Unknown image: ${imageName}`);
  const runs = Number(args.runs ?? RUNS);

  const env = await load();
  const apiKey = Deno.env.get("AKSONOCR_API_KEY") ?? env.AKSONOCR_API_KEY;
  if (!apiKey) throw new Error("AKSONOCR_API_KEY is not set.");

  const id = runId(`aksonocr/${model}`, undefined, undefined, imageName);
  const configDir = new URL(`../results/${id}/`, import.meta.url);
  const image = await Deno.readFile(new URL(IMAGES[imageName], import.meta.url));

  for (let n = 1; n <= runs; n++) {
    const dir = new URL(`${n}/`, configDir);
    if (await exists(new URL("response.md", dir))) continue;
    console.error(`[${id}] run ${n}/${runs}...`);

    const started = performance.now();
    const { raw, content, usage } = model === "aksonocr1.5"
      ? await documentParse(apiKey, image)
      : await ocrV2(apiKey, model, image);
    const durationMs = Math.round(performance.now() - started);

    const meta = {
      model: `aksonocr/${model}`,
      effort: null,
      requestedProvider: null,
      image: imageName,
      prompt: null,
      date: new Date().toISOString(),
      durationMs,
      // AksonOCR bills in credits, not USD. aksonocr1.5 is free (0 credits per page).
      cost: null,
      credits: usage?.pages_processed == null
        ? null
        : usage.pages_processed * CREDITS_PER_PAGE[model],
      usage,
      provider: "AksonOCR",
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
