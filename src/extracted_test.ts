import { assert } from "jsr:@std/assert@1";

export const COLUMNS = ["header", "forward", "return", "footer"] as const;
export type Extracted = Record<(typeof COLUMNS)[number], string | null>;

const resultsDir = new URL("../results/", import.meta.url);

for await (const config of Deno.readDir(resultsDir)) {
  if (!config.isDirectory) continue;
  for await (const run of Deno.readDir(new URL(`${config.name}/`, resultsDir))) {
    if (!run.isDirectory) continue;
    const dir = new URL(`${config.name}/${run.name}/`, resultsDir);
    Deno.test(`${config.name}/${run.name}: extracted text is present in response.md`, async () => {
      const response = await Deno.readTextFile(new URL("response.md", dir));
      const extracted: Extracted = JSON.parse(
        await Deno.readTextFile(new URL("extracted.json", dir)),
      );
      for (const column of COLUMNS) {
        const text = extracted[column];
        assert(
          text !== undefined,
          `${column} is not in extracted.json (use null if it is missing)`,
        );
        if (text === null) continue;
        assert(text.trim().length > 0, `${column} is empty (use null if it is missing)`);
        assert(response.includes(text), `${column} is not an exact substring of response.md`);
      }
    });
  }
}
