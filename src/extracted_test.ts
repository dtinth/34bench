import { assert } from "jsr:@std/assert@1";
import { stripMarkup } from "./cer.ts";

export const COLUMNS = ["header", "forward", "return", "footer"] as const;
export type Extracted = Record<(typeof COLUMNS)[number], string>;

/** Collapse whitespace, so that line breaks and indentation do not matter for the check. */
const squash = (text: string) => text.replace(/\s+/g, " ").trim();

const resultsDir = new URL("../results/", import.meta.url);

for await (const config of Deno.readDir(resultsDir)) {
  if (!config.isDirectory) continue;
  for await (const run of Deno.readDir(new URL(`${config.name}/`, resultsDir))) {
    if (!run.isDirectory) continue;
    const dir = new URL(`${config.name}/${run.name}/`, resultsDir);
    Deno.test(`${config.name}/${run.name}: extracted text is present in response.md`, async () => {
      const response = squash(stripMarkup(await Deno.readTextFile(new URL("response.md", dir))));
      const extracted: Extracted = JSON.parse(
        await Deno.readTextFile(new URL("extracted.json", dir)),
      );
      for (const column of COLUMNS) {
        const text = extracted[column];
        assert(
          typeof text === "string",
          `${column} must be a string (use "" if the position is empty)`,
        );
        if (text === "") continue;
        assert(stripMarkup(text) === text, `${column} has Markdown or HTML markup in it`);
        assert(
          response.includes(squash(text)),
          `${column} is not in response.md (after markup is removed and whitespace is collapsed)`,
        );
      }
    });
  }
}
