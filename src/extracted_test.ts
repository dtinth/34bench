import { assert } from "jsr:@std/assert@1";

export const COLUMNS = ["header", "forward", "return", "footer"] as const;
export type Extracted = Record<(typeof COLUMNS)[number], string | null>;

const resultsDir = new URL("../results/", import.meta.url);

for await (const entry of Deno.readDir(resultsDir)) {
  if (!entry.isDirectory) continue;
  const dir = new URL(`${entry.name}/`, resultsDir);
  Deno.test(`${entry.name}: extracted text is present in response.md`, async () => {
    const response = await Deno.readTextFile(new URL("response.md", dir));
    const extracted: Extracted = JSON.parse(
      await Deno.readTextFile(new URL("extracted.json", dir)),
    );
    for (const column of COLUMNS) {
      const text = extracted[column];
      assert(text !== undefined, `${column} is not in extracted.json (use null if it is missing)`);
      if (text === null) continue;
      assert(text.trim().length > 0, `${column} is empty (use null if it is missing)`);
      assert(response.includes(text), `${column} is not an exact substring of response.md`);
    }
  });
}
