// Render the results table as an SVG. The table is HTML inside a <foreignObject>, so the browser
// wraps the Thai text. SVG cannot measure text, so the height of each row is estimated.
import { renderToString } from "npm:preact-render-to-string@6";
import type { ComponentChildren } from "npm:preact@10";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { cleanupOps, graphemes } from "./cer.ts";
import { type Column, COLUMNS, type ConfigScore, loadScores, type RunScore } from "./score.ts";

const LABELS: Record<Column, string> = {
  header: "Header",
  forward: "Forward trip (เที่ยวไป)",
  return: "Return trip (เที่ยวกลับ)",
  footer: "Footer",
};

/** Column widths in pixels. */
const W = {
  rank: 36,
  model: 210,
  score: 120,
  time: 70,
  cost: 80,
  header: 440,
  forward: 440,
  return: 440,
  footer: 300,
};
const PAD = 8;
const FONT_SIZE = 13;
const LINE_HEIGHT = 20;
/** A safe upper estimate of the average width of one grapheme, in pixels. */
const GRAPHEME_WIDTH = 7.6;

const WIDTH = Object.values(W).reduce((a, b) => a + b, 0);

const CSS = `
* { box-sizing: border-box; }
.t { font-family: "Noto Sans Thai", "Sarabun", "Thonburi", "Leelawadee UI", sans-serif;
  font-size: ${FONT_SIZE}px; line-height: ${LINE_HEIGHT}px; color: #1f2328; background: #fff;
  width: ${WIDTH}px; }
table { border-collapse: collapse; table-layout: fixed; width: ${WIDTH}px; }
th, td { border-bottom: 1px solid #d0d7de; padding: ${PAD}px; vertical-align: top;
  text-align: left; overflow-wrap: anywhere; }
th { background: #f6f8fa; font-weight: 600; }
tr.image td, tr.truth td { background: #f6f8fa; }
tr.truth td { border-bottom: 2px solid #8c959f; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.model { font-weight: 600; }
.tag { display: inline-block; font-size: 11px; line-height: 16px; padding: 0 5px; margin: 2px 2px 0 0;
  border-radius: 8px; background: #eaeef2; color: #57606a; font-weight: 400; }
.cer { font-size: 16px; font-weight: 700; }
.runs { font-size: 11px; color: #57606a; }
.runs b { color: #1f2328; text-decoration: underline; }
.ins { background: #ffd7d5; color: #82071e; }
.del { background: #d1f0da; color: #116329; text-decoration: line-through; }
.empty { color: #8c959f; font-style: italic; }
.legend { padding: ${PAD}px; font-size: 12px; color: #57606a; }
img { display: block; width: 100%; }
`;

function percent(x: number) {
  return `${(x * 100).toFixed(1)}%`;
}

/** Split a config directory name such as `openai~gpt-6-sol_300dpi` into a name and tags. */
function describe(config: string) {
  const m = config.match(/^([^@+_]+)(?:@([^+_]+))?(?:\+([^_]+))?(?:_(.+))?$/)!;
  const tags = [
    m[2] && `effort: ${m[2]}`,
    m[3] && `provider: ${m[3]}`,
    m[4] && `image: ${m[4]}`,
  ].filter(Boolean) as string[];
  return { name: m[1].replace("~", "/"), tags };
}

function Diff({ run, column }: { run: RunScore; column: Column }) {
  const { ops, actual } = run.columns[column];
  if (!actual) return <span class="empty">(empty)</span>;
  return (
    <>
      {cleanupOps(ops).map((op) =>
        op.type === "equal"
          ? op.text
          : <span class={op.type === "insert" ? "ins" : "del"}>{op.text}</span>
      )}
    </>
  );
}

/** Estimate the height of a text cell. */
function textHeight(text: string, width: number) {
  const perLine = Math.floor((width - 2 * PAD) / GRAPHEME_WIDTH);
  const lines = Math.max(1, Math.ceil(graphemes(text).length / perLine));
  return lines * LINE_HEIGHT + 2 * PAD + 1;
}

function Row(
  { cls, height, children }: { cls?: string; height: number; children: ComponentChildren },
) {
  return <tr class={cls} style={{ height: `${height}px` }}>{children}</tr>;
}

async function main() {
  const root = new URL("../", import.meta.url);
  const configs: ConfigScore[] = await loadScores(root);
  const truth = configs[0].median.columns;

  const crops = {} as Record<Column, { src: string; height: number }>;
  for (const column of COLUMNS) {
    const bytes = await Deno.readFile(new URL(`data/route34/crops/${column}.webp`, root));
    // Read the WebP size from the VP8 header: this avoids an image library.
    const view = new DataView(bytes.buffer);
    let w = 0, h = 0;
    const chunk = new TextDecoder().decode(bytes.slice(12, 16));
    if (chunk === "VP8 ") {
      w = view.getUint16(26, true) & 0x3fff;
      h = view.getUint16(28, true) & 0x3fff;
    } else if (chunk === "VP8L") {
      const b = view.getUint32(21, true);
      w = (b & 0x3fff) + 1;
      h = ((b >> 14) & 0x3fff) + 1;
    }
    const cellWidth = W[column] - 2 * PAD;
    const shown = Math.min(cellWidth, w / 2);
    crops[column] = {
      src: `data:image/webp;base64,${encodeBase64(bytes)}`,
      height: Math.ceil((h * shown) / w),
    };
  }

  const rowHeight = (texts: Record<Column, string>) =>
    Math.max(3 * LINE_HEIGHT + 2 * PAD, ...COLUMNS.map((c) => textHeight(texts[c], W[c])));

  const legendHeight = LINE_HEIGHT + 2 * PAD;
  const headHeight = LINE_HEIGHT + 2 * PAD + 1;
  const imageHeight = Math.max(...COLUMNS.map((c) => crops[c].height)) + 2 * PAD + 1;
  const truthHeight = rowHeight(
    Object.fromEntries(COLUMNS.map((c) => [c, truth[c].expected])) as Record<Column, string>,
  );
  const rows = configs.map((c) => {
    // A diff shows both the wrong text and the missing text, so it is longer than either.
    const texts = Object.fromEntries(
      COLUMNS.map((k) => [k, cleanupOps(c.median.columns[k].ops).map((o) => o.text).join("")]),
    ) as Record<Column, string>;
    return { c, height: rowHeight(texts) };
  });
  const height = legendHeight + headHeight + imageHeight + truthHeight +
    rows.reduce((a, r) => a + r.height, 0);

  const table = (
    <div
      {
        // The XHTML namespace is required inside <foreignObject>.
        ...{ xmlns: "http://www.w3.org/1999/xhtml" }
      }
      class="t"
    >
      <style>{CSS}</style>
      <div class="legend" style={{ height: `${legendHeight}px` }}>
        34bench: transcription of the Bangkok bus route 34 document. Ranked by character error rate
        (CER, lower is better) of the median run. <span class="ins">Red</span>: wrong or extra text.
        {" "}
        <span class="del">Green</span>: missing text. Prices in THB (1 USD = 35 THB).
      </div>
      <table>
        <colgroup>
          {Object.values(W).map((w) => <col style={{ width: `${w}px` }} />)}
        </colgroup>
        <thead>
          <Row height={headHeight}>
            <th class="num">#</th>
            <th>Model</th>
            <th>CER (runs)</th>
            <th class="num">Time</th>
            <th class="num">Cost</th>
            {COLUMNS.map((c) => <th>{LABELS[c]}</th>)}
          </Row>
        </thead>
        <tbody>
          <Row cls="image" height={imageHeight}>
            <td></td>
            <td class="model">Image</td>
            <td></td>
            <td></td>
            <td></td>
            {COLUMNS.map((c) => (
              <td>
                <img
                  src={crops[c].src}
                  style={{ width: `${Math.min(W[c] - 2 * PAD, 440)}px` }}
                />
              </td>
            ))}
          </Row>
          <Row cls="truth" height={truthHeight}>
            <td></td>
            <td class="model">Ground truth</td>
            <td></td>
            <td></td>
            <td></td>
            {COLUMNS.map((c) => <td>{truth[c].expected}</td>)}
          </Row>
          {rows.map(({ c, height }, i) => {
            const { name, tags } = describe(c.config);
            const m = c.median;
            return (
              <Row height={height}>
                <td class="num">{i + 1}</td>
                <td>
                  <div class="model">{name}</div>
                  {tags.map((t) => <span class="tag">{t}</span>)}
                </td>
                <td>
                  <div class="cer">{percent(m.cer)}</div>
                  {c.runs.length > 1 && (
                    <div class="runs">
                      {c.runs.map((r, j) => (
                        <>
                          {j > 0 && ", "}
                          {r === m ? <b>{percent(r.cer)}</b> : percent(r.cer)}
                        </>
                      ))}
                    </div>
                  )}
                </td>
                <td class="num">{(m.meta.durationMs / 1000).toFixed(1)} s</td>
                <td class="num">
                  {m.costThb === null ? "—" : `฿${m.costThb.toFixed(m.costThb < 1 ? 3 : 2)}`}
                </td>
                {COLUMNS.map((k) => (
                  <td>
                    <Diff run={m} column={k} />
                  </td>
                ))}
              </Row>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" ` +
    `viewBox="0 0 ${WIDTH} ${height}"><rect width="100%" height="100%" fill="#fff"/>` +
    `<foreignObject x="0" y="0" width="${WIDTH}" height="${height}">` +
    renderToString(table) + `</foreignObject></svg>\n`;
  await Deno.writeTextFile(new URL("results.svg", root), svg);
  console.error(`Wrote results.svg (${WIDTH}×${height}, ${(svg.length / 1024).toFixed(0)} KB)`);
}

if (import.meta.main) await main();
