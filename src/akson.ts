// Runner for AksonOCR 1.5 (https://aksonocr.com/docs/models). The `aksonocr1.5` model is only
// available through the Document Parse API (`/api/v1/document-parse`), which is async: submit the
// file, then poll until the job is done. It is free (0 credits per page), with a rate limit of 20
// requests per minute. It takes no prompt and saves the same files as src/run.ts.
import { load } from "jsr:@std/dotenv@0.225";
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { IMAGES, runId, RUNS } from "./run.ts";

const BASE_URL = "https://backend.aksonocr.com/api/v1/document-parse";
const MODEL = "aksonocr/aksonocr1.5";

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

async function main() {
  const args = parseArgs(Deno.args, { string: ["image", "runs"] });
  const imageName = args.image ?? "full";
  if (!(imageName in IMAGES)) throw new Error(`Unknown image: ${imageName}`);
  const runs = Number(args.runs ?? RUNS);

  const env = await load();
  const apiKey = Deno.env.get("AKSONOCR_API_KEY") ?? env.AKSONOCR_API_KEY;
  if (!apiKey) throw new Error("AKSONOCR_API_KEY is not set.");

  const id = runId(MODEL, undefined, undefined, imageName);
  const configDir = new URL(`../results/${id}/`, import.meta.url);
  const image = await Deno.readFile(new URL(IMAGES[imageName], import.meta.url));

  for (let n = 1; n <= runs; n++) {
    const dir = new URL(`${n}/`, configDir);
    if (await exists(new URL("response.md", dir))) continue;
    console.error(`[${id}] run ${n}/${runs}...`);

    const form = new FormData();
    form.append("document", new Blob([image], { type: "image/png" }), "route34.png");
    const started = performance.now();
    const submitRes = await fetch(BASE_URL, {
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
      const res = await fetch(`${BASE_URL}/${job.request_id}`, {
        headers: { "X-API-Key": apiKey },
        signal: AbortSignal.timeout(60_000),
      });
      raw = JSON.parse(omitImages(await res.text()));
      if (!res.ok) throw new Error(`Poll failed (${res.status}): ${JSON.stringify(raw)}`);
      if (raw.status !== "pending" && raw.status !== "processing") break;
    }
    const durationMs = Math.round(performance.now() - started);
    if (raw.status !== "completed" || typeof raw.result?.content?.markdown !== "string") {
      throw new Error(
        `Job ${job.request_id} ended with status ${raw.status}: ${JSON.stringify(raw.error)}`,
      );
    }

    const content = raw.result.content.markdown;
    const meta = {
      model: MODEL,
      effort: null,
      requestedProvider: null,
      image: imageName,
      prompt: null,
      date: new Date().toISOString(),
      durationMs,
      // aksonocr1.5 is free (0 credits per page), so the cost is 0.
      cost: 0,
      usage: raw.result.usage ?? null,
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
