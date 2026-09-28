import {
  alignIgnoringWhitespace,
  type DiffOp,
  graphemes,
  normalize,
  removeWhitespace,
} from "./cer.ts";

export const COLUMNS = ["header", "forward", "return", "footer"] as const;
export type Column = (typeof COLUMNS)[number];
export type Columns = Record<Column, string>;

/** All prices are in THB. */
export const THB_PER_USD = 35;
/** Paxa Labs: 329 THB per 10,000 credits (list price, no VAT). */
export const THB_PER_PAXA_CREDIT = 329 / 10_000;
/** iApp: 1.25 THB per IC (list price for the smallest package, VAT excluded). */
export const THB_PER_IAPP_IC = 1.25;

export interface Meta {
  model: string;
  effort: string | null;
  requestedProvider?: string | null;
  image?: string;
  durationMs: number;
  cost: number | null;
  credits?: number | null;
  provider: string | null;
}

export interface ColumnScore {
  expected: string;
  actual: string;
  distance: number;
  length: number;
  ops: DiffOp[];
}

export interface RunScore {
  config: string;
  run: string;
  meta: Meta;
  cer: number;
  /** CER of the header, forward trip, and return trip only. */
  cerNoFooter: number;
  costThb: number | null;
  columns: Record<Column, ColumnScore>;
  /** The extracted text, before normalization. */
  extracted: Columns;
}

export interface ConfigScore {
  config: string;
  /** All runs, sorted by CER (best first). */
  runs: RunScore[];
  /** The run with the median CER. With an even number of runs, the better of the two middle runs. */
  median: RunScore;
}

export function costThb(meta: Meta): number | null {
  if (meta.cost !== null) return meta.cost * THB_PER_USD;
  if (meta.credits == null) return null;
  if (meta.model.startsWith("paxa/")) return meta.credits * THB_PER_PAXA_CREDIT;
  if (meta.model.startsWith("iapp/")) return meta.credits * THB_PER_IAPP_IC;
  return null;
}

export function scoreRun(
  groundTruth: Columns,
  extracted: Columns,
): { cer: number; cerNoFooter: number; columns: Record<Column, ColumnScore> } {
  let distance = 0;
  let length = 0;
  const columns = {} as Record<Column, ColumnScore>;
  for (const column of COLUMNS) {
    const expected = normalize(groundTruth[column]);
    const actual = normalize(extracted[column]);
    const { distance: d, ops } = alignIgnoringWhitespace(expected, actual);
    const l = graphemes(removeWhitespace(expected)).length;
    columns[column] = { expected, actual, distance: d, length: l, ops };
    distance += d;
    length += l;
  }
  const f = columns.footer;
  return {
    cer: distance / length,
    cerNoFooter: (distance - f.distance) / (length - f.length),
    columns,
  };
}

export async function loadScores(root = new URL("../", import.meta.url)): Promise<ConfigScore[]> {
  const groundTruth: Columns = JSON.parse(
    await Deno.readTextFile(new URL("data/route34/ground-truth.json", root)),
  );
  const resultsDir = new URL("results/", root);
  const configs: ConfigScore[] = [];
  for await (const config of Deno.readDir(resultsDir)) {
    if (!config.isDirectory) continue;
    const runs: RunScore[] = [];
    for await (const run of Deno.readDir(new URL(`${config.name}/`, resultsDir))) {
      if (!run.isDirectory) continue;
      const dir = new URL(`${config.name}/${run.name}/`, resultsDir);
      const meta: Meta = JSON.parse(await Deno.readTextFile(new URL("meta.json", dir)));
      let extracted: Columns;
      try {
        extracted = JSON.parse(await Deno.readTextFile(new URL("extracted.json", dir)));
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
        console.error(`Skipped ${config.name}/${run.name}: no extracted.json yet.`);
        continue;
      }
      runs.push({
        config: config.name,
        run: run.name,
        meta,
        costThb: costThb(meta),
        extracted,
        ...scoreRun(groundTruth, extracted),
      });
    }
    if (runs.length === 0) continue;
    runs.sort((a, b) => a.cer - b.cer);
    configs.push({ config: config.name, runs, median: runs[Math.floor((runs.length - 1) / 2)] });
  }
  // No ties: with the same CER, the cheaper model is first, then the faster one.
  const cost = (c: ConfigScore) => c.median.costThb ?? Infinity;
  configs.sort((a, b) =>
    a.median.cer - b.median.cer || cost(a) - cost(b) ||
    a.median.meta.durationMs - b.median.meta.durationMs || a.config.localeCompare(b.config)
  );
  return configs;
}

if (import.meta.main) {
  for (const c of await loadScores()) {
    const cols = COLUMNS.map((k) => `${k}=${c.median.columns[k].distance}`).join(" ") +
      ` noFooter=${(c.median.cerNoFooter * 100).toFixed(1)}%`;
    console.log(
      `${(c.median.cer * 100).toFixed(1).padStart(6)}%  ${c.config.padEnd(45)} runs=${
        c.runs.map((r) => (r.cer * 100).toFixed(1)).join(",")
      }  ${cols}`,
    );
  }
}
