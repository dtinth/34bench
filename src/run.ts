import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { load } from "jsr:@std/dotenv@0.225";
import { parseArgs } from "jsr:@std/cli@1/parse-args";

export const PROMPT =
  "Transcribe this image into a Markdown document. Output only the Markdown, with no commentary. " +
  "For each figure, write an HTML `<figure>` element with a description of the figure inside it.";

/** Number of runs for each model and parameter combination. */
export const RUNS = 5;

/**
 * Output token limit. OpenRouter reserves credit for the full limit before the request, so a
 * very high limit fails on expensive models when the key has a small budget.
 */
export const MAX_TOKENS = 16384;

/** Input images. `full` is the default. `300dpi` is for models that reject the full size. */
export const IMAGES: Record<string, string> = {
  full: "../data/route34/route34.png",
  "300dpi": "../data/route34/route34-300dpi.png",
};

/**
 * Directory name for one model + parameter combination, e.g. `google~gemini-3.8-flash@high`, or
 * `deepseek~deepseek-v4.1-flash+deepseek` when the inference provider is fixed, or
 * `openai~gpt-6-sol_300dpi` when a smaller image is used.
 */
export function runId(model: string, effort?: string, provider?: string, image?: string): string {
  return model.replace("/", "~") + (effort ? `@${effort}` : "") + (provider ? `+${provider}` : "") +
    (image && image !== "full" ? `_${image}` : "");
}

/** Send the image to the model once, and save the result in `dir`. */
async function runOnce(
  apiKey: string,
  model: string,
  effort: string | undefined,
  provider: string | undefined,
  imageName: string,
  maxTokens: number,
  dir: URL,
) {
  const image = encodeBase64(await Deno.readFile(new URL(IMAGES[imageName], import.meta.url)));
  const request = {
    model,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: PROMPT },
        { type: "image_url", image_url: { url: `data:image/png;base64,${image}` } },
      ],
    }],
    max_tokens: maxTokens,
    ...(effort ? { reasoning: { effort } } : {}),
    // Some models are served by many providers, and their outputs can differ. This fixes one.
    ...(provider ? { provider: { only: [provider], allow_fallbacks: false } } : {}),
    usage: { include: true },
  };

  const started = performance.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/dtinth/34bench",
      "X-Title": "34bench",
    },
    body: JSON.stringify(request),
  });
  const raw = await res.json();
  const durationMs = Math.round(performance.now() - started);
  if (!res.ok || raw.error) {
    throw new Error(`Request failed (${res.status}): ${JSON.stringify(raw.error ?? raw)}`);
  }

  const content: string = raw.choices?.[0]?.message?.content ?? "";
  const meta = {
    model,
    effort: effort ?? null,
    requestedProvider: provider ?? null,
    image: imageName,
    maxTokens,
    prompt: PROMPT,
    date: new Date().toISOString(),
    durationMs,
    cost: raw.usage?.cost ?? null,
    usage: raw.usage ?? null,
    provider: raw.provider ?? null,
    finishReason: raw.choices?.[0]?.finish_reason ?? null,
  };

  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(new URL("response.md", dir), content);
  await Deno.writeTextFile(new URL("raw.json", dir), JSON.stringify(raw, null, 2) + "\n");
  await Deno.writeTextFile(new URL("meta.json", dir), JSON.stringify(meta, null, 2) + "\n");
  return meta;
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

async function main() {
  const args = parseArgs(Deno.args, {
    string: ["model", "effort", "provider", "image", "runs", "max-tokens"],
  });
  const model = args.model;
  if (!model) {
    throw new Error(
      "Usage: deno task run --model <id> [--effort <level>] [--provider <slug>] [--image <name>] [--runs <n>] [--max-tokens <n>]",
    );
  }
  const effort = args.effort;
  const provider = args.provider;
  const imageName = args.image ?? "full";
  // Some models reason for longer than MAX_TOKENS. A higher limit reserves more credit.
  const maxTokens = Number(args["max-tokens"] ?? MAX_TOKENS);
  if (!(imageName in IMAGES)) throw new Error(`Unknown image: ${imageName}`);
  const runs = Number(args.runs ?? RUNS);

  const env = await load();
  const apiKey = Deno.env.get("OPENROUTER_API_KEY") ?? env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set.");

  const configDir = new URL(
    `../results/${runId(model, effort, provider, imageName)}/`,
    import.meta.url,
  );
  const label = runId(model, effort, provider, imageName);
  // Runs are numbered 1..n. Only the missing runs are sent, so it is safe to run this again.
  for (let n = 1; n <= runs; n++) {
    const dir = new URL(`${n}/`, configDir);
    if (await exists(new URL("response.md", dir))) continue;
    console.error(`[${label}] run ${n}/${runs}...`);
    const meta = await runOnce(apiKey, model, effort, provider, imageName, maxTokens, dir);
    console.error(
      `[${label}] run ${n}/${runs} done in ${
        (meta.durationMs / 1000).toFixed(1)
      }s, cost $${meta.cost}`,
    );
  }
}

if (import.meta.main) await main();
