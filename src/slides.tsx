// Render the results as square slides (HTML), for printing to PDF with Chromium.
// Run: scripts/build-slides.sh
import { renderToString } from "npm:preact-render-to-string@6";
import type { ComponentChildren } from "npm:preact@10";
import { alignIgnoringWhitespace, type DiffOp, normalize } from "./cer.ts";
import { type Column, COLUMNS, type ConfigScore, loadScores, type RunScore } from "./score.ts";
import { PROMPT } from "./run.ts";

const SIZE = 1080;
const M = 56; // outer margin
const LABELS: Record<Column, [string, string]> = {
  header: ["Header", ""],
  forward: ["Forward trip", "เที่ยวไป"],
  return: ["Return trip", "เที่ยวกลับ"],
  footer: ["Footer", ""],
};

const root = new URL("../", import.meta.url);
const images: { zoom: number; sizes: Record<string, [number, number]> } = JSON.parse(
  await Deno.readTextFile(new URL("slides/images/sizes.json", root)),
);
const boxes: Record<Column, [number, number, number, number]> = JSON.parse(
  await Deno.readTextFile(new URL("data/route34/crop-boxes.json", root)),
);
const SOURCE_WIDTH = 4961;
const [PREVIEW_W, PREVIEW_H] = images.sizes.preview;
const TOP = 176; // top of the main area; the preview is here on every slide that has it
const CONTENT_X = M + PREVIEW_W + 84; // left edge of the crops and cards
const CONTENT_W = SIZE - M - CONTENT_X;
/** Rays go through this x, between the left column and the content. */
const GUTTER_X = CONTENT_X - 40;

// ---------------------------------------------------------------------------------------------
// Data

const accuracy = (r: RunScore) => Math.max(0, 1 - r.cer);
const partAccuracy = (r: RunScore, c: Column) =>
  Math.max(0, 1 - r.columns[c].distance / r.columns[c].length);

/** Normalize for display, and join the lines with spaces (whitespace is not scored). */
const flat = (t: string) => normalize(t);

/** Normalize each line for display, but keep the line breaks. */
const displayText = (t: string) =>
  t.split("\n").map((l) => normalize(l)).filter((l) => l).join("\n");

function describe(config: string) {
  const m = config.match(/^([^@+_]+)(?:@([^+_]+))?(?:\+([^_]+))?(?:_(.+))?$/)!;
  const [vendor, model] = m[1].split("~");
  return { vendor, model, provider: m[3], image: m[4] };
}

type Kind = "vlm" | "ocr-api" | "ocr-model";
function kind(c: ConfigScore): Kind {
  const v = describe(c.config).vendor;
  if (v === "paxa" || v === "iapp") return "ocr-api";
  if (v === "typhoon") return "ocr-model";
  return "vlm";
}

/** 0 = good, 1 = middle, 2 = bad. */
type Grade = 0 | 1 | 2;
const GRADE_CLASS = ["good", "okay", "poor"];

interface Metric {
  label: string;
  /** For the rank text, for example "3rd cheapest". */
  best: string;
  words: [string, string, string];
  value: (c: ConfigScore) => number | null;
  format: (v: number) => string;
  lowerIsBetter: boolean;
}

const METRICS: Metric[] = [
  {
    label: "Accuracy",
    best: "most accurate",
    words: ["Good", "Okay", "Poor"],
    value: (c) => accuracy(c.median),
    format: (v) => `${(v * 100).toFixed(2)}%`,
    lowerIsBetter: false,
  },
  {
    label: "Cost / page",
    best: "cheapest",
    words: ["Cheap", "Moderate", "Expensive"],
    value: (c) => c.median.costThb,
    format: (v) => v === 0 ? "Free" : `฿${v < 1 ? v.toFixed(3) : v.toFixed(2)}`,
    lowerIsBetter: true,
  },
  {
    label: "Time / page",
    best: "fastest",
    words: ["Fast", "Normal", "Slow"],
    value: (c) => c.median.meta.durationMs / 1000,
    format: (v) => `${v.toFixed(1)} s`,
    lowerIsBetter: true,
  },
];

/**
 * Rank (1 = best) of a model for a metric, among the models that have a value. For accuracy, the
 * rank is the position in the ranking, so that it is the same as the rank in the slide heading.
 */
function rank(metric: Metric, configs: ConfigScore[], c: ConfigScore) {
  const values = configs.map((x) => metric.value(x)).filter((v): v is number => v !== null);
  const v = metric.value(c);
  if (v === null) return null;
  // No ties: with the same value, the model that is higher in the ranking (more accurate, then
  // cheaper, then faster) comes first. For accuracy, this is the order of the ranking itself.
  const order = configs
    .filter((x) => metric.value(x) !== null)
    .sort((a, b) =>
      (metric.lowerIsBetter ? 1 : -1) * (metric.value(a)! - metric.value(b)!) ||
      configs.indexOf(a) - configs.indexOf(b)
    );
  const position = order.indexOf(c);
  return {
    rank: position + 1,
    of: values.length,
    grade: gradeOf(position, values.length),
    value: v,
  };
}

/** The best, middle, and worst third of a ranking. */
const gradeOf = (index: number, of: number) => Math.min(2, Math.floor((3 * index) / of)) as Grade;

/** Chip color of one part: lime at 90% or more, red below 50%, else neutral. */
const partClass = (a: number) => a >= 0.9 ? "good" : a < 0.5 ? "poor" : "neutral";

const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${s}`;
};

// ---------------------------------------------------------------------------------------------
// Thai-friendly diff display

const words = new Intl.Segmenter("th", { granularity: "word" });

/**
 * The text of one side of a diff, split into segments. A word is marked if any part of it is only on
 * this side. Marking whole words is easier to read than marking parts of Thai syllables. (This is
 * for display only. The score is still per character.)
 */
function sideSegments(ops: DiffOp[], side: "insert" | "delete") {
  let text = "";
  const marked: boolean[] = [];
  for (const op of ops) {
    if (op.type !== "equal" && op.type !== side) continue;
    for (const ch of op.text) {
      text += ch;
      marked.push(op.type === side);
    }
  }
  const out: { text: string; mark: boolean }[] = [];
  let i = 0;
  for (const { segment } of words.segment(text)) {
    const n = segment.length;
    const mark = /\S/.test(segment) && marked.slice(i, i + n).some(Boolean);
    const last = out[out.length - 1];
    if (last && last.mark === mark) last.text += segment;
    else out.push({ text: segment, mark });
    i += n;
  }
  // Do not show the spaces between two marked words as unmarked: join them.
  for (let j = 1; j < out.length - 1; j++) {
    if (!out[j].mark && /^[ \t]+$/.test(out[j].text) && out[j - 1].mark && out[j + 1].mark) {
      out[j - 1].text += out[j].text + out[j + 1].text;
      out.splice(j, 2);
      j--;
    }
  }
  return out;
}

function Side({ ops, side, cls }: { ops: DiffOp[]; side: "insert" | "delete"; cls: string }) {
  return (
    <>
      {sideSegments(ops, side).map((s) => s.mark ? <mark class={cls}>{s.text}</mark> : s.text)}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Components

function Slide({ children, cls }: { children: ComponentChildren; cls?: string }) {
  return (
    <section class={`slide ${cls ?? ""}`}>
      <svg class="rays" width={SIZE} height={SIZE} />
      {children}
    </section>
  );
}

function Head({ kicker, title, sub }: { kicker?: string; title: string; sub?: string }) {
  return (
    <header class={kicker ? "head" : "head no-kicker"}>
      {kicker && <div class="kicker">{kicker}</div>}
      <h2>{title}</h2>
      {sub && <p class="sub">{sub}</p>}
    </header>
  );
}

/** The mini preview of the page, with the 4 scored areas marked. */
function Preview({ parts }: { parts?: Record<Column, string> }) {
  const k = PREVIEW_W / SOURCE_WIDTH;
  return (
    <div class="preview" style={{ width: `${PREVIEW_W}px`, height: `${PREVIEW_H}px` }}>
      <img src="images/preview.jpg" width={PREVIEW_W} height={PREVIEW_H} />
      {COLUMNS.map((c) => {
        const [l, t, r, b] = boxes[c];
        const g = parts ? parts[c] : "";
        return (
          <div
            class={`mark ${g}`}
            data-ray={c}
            data-grade={g}
            style={{
              left: `${l * k + 1.5}px`,
              top: `${t * k + (c === "header" ? -2 : 1.5)}px`,
              width: `${(r - l) * k - 3}px`,
              height: `${(b - t) * k - (c === "header" ? -0.5 : 3)}px`,
            }}
          />
        );
      })}
    </div>
  );
}

function PartLabel({ c, chip }: { c: Column; chip?: ComponentChildren }) {
  const [en, th] = LABELS[c];
  return (
    <div class="part-label">
      <span class="en">{en}</span>
      {th && <span class="th">{th}</span>}
      {chip}
    </div>
  );
}

function Tile({ metric, configs, c }: { metric: Metric; configs: ConfigScore[]; c: ConfigScore }) {
  const r = rank(metric, configs, c);
  if (!r) {
    return (
      <div class="tile">
        <div class="tile-label">{metric.label}</div>
        <div class="tile-number">—</div>
      </div>
    );
  }
  return (
    <div class={`tile ${GRADE_CLASS[r.grade]}`}>
      <div class="tile-label">{metric.label}</div>
      <div class="tile-number">{metric.format(r.value)}</div>
      <div class="rank-strip">
        {Array.from({ length: r.of }, (_, j) => {
          // The worst is at the left (red) and the best at the right (green).
          const i = r.of - 1 - j;
          return <i class={`${GRADE_CLASS[gradeOf(i, r.of)]}${i === r.rank - 1 ? " me" : ""}`} />;
        })}
      </div>
      <div class="tile-rank">
        <span>{ordinal(r.rank)} {metric.best}</span>
        <span>of {r.of}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Slides

function TitleSlide() {
  const [w, h] = images.sizes["page-map"];
  return (
    <Slide cls="title">
      <h1>
        <span class="hl">Bus No.34</span> Benchmark
      </h1>
      <img class="page-map" src="images/page-map.jpg" width={w} height={h} />
      <p class="credit">
        Source: Bangkok Metropolitan Administration open data
        <br />
        GFDL 1.3
      </p>
    </Slide>
  );
}

const [PART_W, PART_H] = images.sizes["page-top"];
const PART_TOP = SIZE - PART_H; // the page images end at the bottom edge of the slide
const PART_K = PART_W / SOURCE_WIDTH;

/** Annotation color of each part on the ground truth slides. */
const PART_COLORS: Record<Column, string> = {
  header: "#8cc800",
  forward: "#2f7de1",
  return: "#f08a1c",
  footer: "#a45ad6",
};

/** All configurations, in alphabetical order. */
function ConfigList({ configs, top }: { configs: ConfigScore[]; top: number }) {
  const items = configs
    .map((c) => ({ c, d: describe(c.config) }))
    .sort((a, b) => `${a.d.vendor}/${a.d.model}`.localeCompare(`${b.d.vendor}/${b.d.model}`));
  return (
    <div class="config-list" style={{ top: `${top}px` }}>
      <h3>{configs.length} configurations tested</h3>
      <ol>
        {items.map(({ d }) => (
          <li>
            <span class="vendor">{d.vendor}/</span>
            <b>{d.model}</b>
          </li>
        ))}
      </ol>
      <p class="links">
        Code and results: <a href="https://github.com/dtinth/34bench">github.com/dtinth/34bench</a>
        <br />
        The whole discussion:{" "}
        <a href="https://github.com/dtinth/34bench/issues/1">github.com/dtinth/34bench/issues/1</a>
      </p>
    </div>
  );
}

/**
 * One of the two "Ground Truth" slides: the top or the bottom of the page, with a rectangle on each
 * scored part, and a card with its ground truth. `cards` gives each card's position on the slide.
 */
function GroundTruthSlide({ gt, half, cards, configs }: {
  gt: Record<Column, string>;
  half: "top" | "bottom";
  configs?: ConfigScore[];
  cards: Partial<
    Record<Column, { left: number; top: number; width: number; route?: "left" }>
  >;
}) {
  // The bottom half continues the page of the top half, from the top edge of the slide.
  const [w, h] = images.sizes[`page-${half}`];
  const top = half === "top" ? PART_TOP : 0;
  // The first row of route34.png that is in the image.
  const y0 = half === "top" ? 0 : Math.round(PART_H / PART_K);
  return (
    <Slide cls="gt-slide">
      {half === "top" && <Head title="Ground Truth" />}
      <img
        class={`page-part ${half}`}
        src={`images/page-${half}.jpg`}
        width={w}
        height={h}
        style={{ left: `${M}px`, top: `${top}px` }}
      />
      {configs && <ConfigList configs={configs} top={h + 76} />}
      {(Object.keys(cards) as Column[]).map((c) => {
        const [l, t, r, b] = boxes[c];
        const pos = cards[c]!;
        return (
          <>
            <div
              class="gt-mark"
              data-link={c}
              data-color={PART_COLORS[c]}
              style={{
                borderColor: PART_COLORS[c],
                left: `${M + l * PART_K - 2}px`,
                top: `${top + (t - y0) * PART_K - 2}px`,
                width: `${(r - l) * PART_K + 4}px`,
                height: `${(b - t) * PART_K + 4}px`,
              }}
            />
            <div
              class="card gt-card"
              data-link-target={c}
              data-route={pos.route ?? ""}
              style={{
                left: `${pos.left}px`,
                top: `${pos.top}px`,
                width: `${pos.width}px`,
                borderColor: PART_COLORS[c],
              }}
            >
              <PartLabel c={c} />
              <div class="truth">“{flat(gt[c])}”</div>
            </div>
          </>
        );
      })}
    </Slide>
  );
}

function ModelSlide({ c, configs, gt }: {
  c: ConfigScore;
  configs: ConfigScore[];
  gt: Record<Column, string>;
}) {
  const { vendor, model, provider, image } = describe(c.config);
  const m = c.median;
  const usage =
    (m.meta as { usage?: { completion_tokens_details?: { reasoning_tokens?: number } } })
      .usage;
  const thinking = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  const k = kind(c);
  const parts = Object.fromEntries(
    COLUMNS.map((col) => [col, partClass(partAccuracy(m, col))]),
  ) as Record<Column, string>;
  const how: string[] = k === "vlm"
    ? [
      "Standard prompt",
      "Default effort",
      thinking > 0 ? `${thinking.toLocaleString("en")}\u00a0thinking tokens` : "No thinking tokens",
    ]
    : k === "ocr-api"
    ? ["OCR service", "Image only, no prompt"]
    : ["OCR model", "Its own fixed prompt"];
  return (
    <Slide>
      <header class="head model-head">
        <h2>
          <span class="rank">#{configs.indexOf(c) + 1}</span>
          {model}
        </h2>
      </header>
      <Preview parts={parts} />
      <div class="tiles" style={{ top: `${TOP + PREVIEW_H + 28}px` }}>
        {METRICS.map((metric) => <Tile metric={metric} configs={configs} c={c} />)}
        <div class="how">{how.map((line) => <div>{line}</div>)}</div>
      </div>
      <div class="cards">
        {COLUMNS.map((col) => {
          const truthText = flat(gt[col]);
          const modelText = flat(m.extracted[col]);
          const ops = alignIgnoringWhitespace(truthText, modelText).ops;
          const truthOps = alignIgnoringWhitespace(modelText, truthText).ops;
          const a = partAccuracy(m, col);
          return (
            <div class="card" data-ray-target={col}>
              <PartLabel
                c={col}
                chip={<span class={`chip ${parts[col]}`}>{(a * 100).toFixed(0)}%</span>}
              />
              <div class="row">
                <span class="who truth-who">Ground truth</span>
                <span class="txt">
                  <Side ops={truthOps} side="insert" cls="miss" />
                </span>
              </div>
              <div class="row">
                <span class="who response-who">Response</span>
                <span class="txt">
                  {modelText
                    ? <Side ops={ops} side="insert" cls="wrong" />
                    : <em class="empty">(nothing)</em>}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </Slide>
  );
}

interface Label {
  x: number;
  y: number;
  text: string;
  cls: string;
  size: number;
  prefer: "right" | "above-left";
}

/**
 * Place point labels next to their points, and move them so that they do not overlap each other or
 * the points. A label that had to move gets a leader line to its point.
 */
function placeLabels(labels: Label[], maxX: number, segments: number[][] = []) {
  type Placed = Label & { lx: number; ly: number; anchor: string; leader?: [number, number] };
  const placed: Placed[] = [];
  const width = (l: Label) => l.text.length * l.size * 0.56 + 8;
  const box = (l: Label, lx: number, ly: number, anchor: string) => {
    const x0 = anchor === "start" ? lx : lx - width(l);
    return [x0, ly - l.size, x0 + width(l), ly + 4];
  };
  const hits = (b: number[]) =>
    placed.some((p) => {
      const q = box(p, p.lx, p.ly, p.anchor);
      return b[0] < q[2] && q[0] < b[2] && b[1] < q[3] && q[1] < b[3];
    }) ||
    labels.some((o) => o.x > b[0] - 6 && o.x < b[2] + 6 && o.y > b[1] - 6 && o.y < b[3] + 6) ||
    // A segment [x1, y1, x2, y2] is horizontal or vertical.
    segments.some(([x1, y1, x2, y2]) =>
      Math.min(x1, x2) - 3 < b[2] && b[0] < Math.max(x1, x2) + 3 &&
      Math.min(y1, y2) - 3 < b[3] && b[1] < Math.max(y1, y2) + 3
    );
  const order = [...labels].sort((a, b) =>
    (a.prefer === "above-left" ? 0 : 1) - (b.prefer === "above-left" ? 0 : 1) || a.y - b.y
  );
  for (const l of order) {
    const fitsRight = l.x + 14 + width(l) < maxX;
    const candidates: [number, number, string][] = l.prefer === "above-left"
      ? [
        [l.x - 10, l.y - 12, "end"],
        [l.x - 10, l.y + 20, "end"],
        [l.x + 6, l.y - 14, "start"],
        [l.x - 12, l.y + 5, "end"],
        [l.x + 12, l.y + 20, "start"],
        [l.x - 10, l.y - 32, "end"],
        [l.x - 10, l.y + 40, "end"],
      ]
      : fitsRight
      ? [[l.x + 12, l.y + 5, "start"], [l.x - 12, l.y + 5, "end"], [l.x + 12, l.y - 12, "start"]]
      : [[l.x - 12, l.y + 5, "end"], [l.x - 10, l.y - 12, "end"]];
    let chosen: Placed | undefined;
    const inside = (b: number[]) => b[0] >= 0 && b[2] <= maxX;
    for (const [lx, ly, anchor] of candidates) {
      const b = box(l, lx, ly, anchor);
      if (inside(b) && !hits(b)) {
        chosen = { ...l, lx, ly, anchor };
        // A frontier label is not beside its dot, so connect them.
        if (l.prefer === "above-left") {
          chosen.leader = [anchor === "start" ? lx - 2 : lx + 2, ly - l.size / 3];
        }
        break;
      }
    }
    if (!chosen) {
      // Move down from the first candidate until there is space, and draw a leader line.
      const [lx, y0, anchor] = candidates.find((c) => inside(box(l, ...c))) ?? candidates[0];
      let ly = y0;
      for (let n = 0; n < 60 && hits(box(l, lx, ly, anchor)); n++) ly -= 6;
      chosen = {
        ...l,
        lx,
        ly,
        anchor,
        leader: [anchor === "start" ? lx - 2 : lx + 2, ly - l.size / 3],
      };
    }
    placed.push(chosen);
  }
  return placed;
}

function rankLabel(configs: ConfigScore[], c: ConfigScore) {
  return `#${configs.indexOf(c) + 1}`;
}

function ParetoSlide({ configs }: { configs: ConfigScore[] }) {
  const W = SIZE - 2 * M, H = 780, L = 58, R = 8, T = 16, B = 56;
  const pts = configs
    .map((c, i) => ({ c, i, cost: c.median.costThb, acc: accuracy(c.median) }))
    .filter((p): p is typeof p & { cost: number } => p.cost !== null);
  const positive = pts.filter((p) => p.cost > 0).map((p) => p.cost);
  const lo = Math.log10(Math.min(...positive)) - 0.2;
  const hi = Math.log10(Math.max(...positive)) + 0.2;
  const freeX = L + 16;
  const x0 = L + 76;
  const x = (v: number) => v <= 0 ? freeX : x0 + (W - R - x0) * (Math.log10(v) - lo) / (hi - lo);
  const y = (a: number) => T + (H - T - B) * (1 - a);
  // Frontier: sorted by cost, a point is on it if no cheaper point is as accurate.
  const sorted = [...pts].sort((a, b) => a.cost - b.cost || b.acc - a.acc);
  const frontier: typeof pts = [];
  for (const p of sorted) if (!frontier.length || p.acc > frontier.at(-1)!.acc) frontier.push(p);
  const on = new Set(frontier.map((p) => p.c));
  let line = "";
  const segments: number[][] = [];
  frontier.forEach((p, i) => {
    const q = frontier[Math.max(0, i - 1)];
    const short = Math.abs(x(p.cost) - x(q.cost)) < 20 || Math.abs(y(p.acc) - y(q.acc)) < 20;
    line += i === 0
      ? `M${x(p.cost)} ${y(p.acc)}`
      : short
      ? ` L${x(p.cost)} ${y(p.acc)}`
      : ` H${x(p.cost)} V${y(p.acc)}`;
    if (i > 0) {
      const q = frontier[i - 1];
      segments.push([x(q.cost), y(q.acc), x(p.cost), y(q.acc)]);
      segments.push([x(p.cost), y(q.acc), x(p.cost), y(p.acc)]);
    }
  });
  const best = frontier.at(-1)!;
  const runnerUp = [...pts].sort((a, b) => b.acc - a.acc)[1];
  const prev = frontier.at(-2) ?? best;
  const flx = x(best.cost) + 12, fly = (y(best.acc) + y(prev.acc)) / 2 + 5;
  segments.push([flx, fly - 13, flx + 120, fly + 3]);
  const ticks = [0.01, 0.1, 1, 10].filter((t) => Math.log10(t) >= lo && Math.log10(t) <= hi);
  const labels = placeLabels(
    pts.map((p) => ({
      x: x(p.cost),
      y: y(p.acc),
      text: describe(p.c.config).model + (p.i < 10 ? `  ${rankLabel(configs, p.c)}` : ""),
      cls: on.has(p.c) ? "lab on" : p.i < 10 ? "lab top" : "lab dim",
      size: on.has(p.c) ? 15 : p.i < 10 ? 14 : 12,
      // A frontier line goes right from each frontier point and comes up from below, so the label
      // goes above and to the left.
      prefer: on.has(p.c) ? "above-left" as const : "right" as const,
    })),
    W - R,
    segments,
  );
  const mid = (freeX + x0) / 2;
  return (
    <Slide>
      <Head
        title="The best model is not the most expensive"
        sub={`${describe(best.c.config).model} is the most accurate (${
          METRICS[0].format(best.acc)
        }) at ${METRICS[1].format(best.cost)} per page. The next best, ${
          describe(runnerUp.c.config).model
        }, costs ${Math.round(runnerUp.cost / best.cost)}× more.`}
      />
      <svg class="chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((a) => (
          <g>
            <line class="grid" x1={L} x2={W - R} y1={y(a)} y2={y(a)} />
            <text class="axis" x={L - 12} y={y(a) + 5} text-anchor="end">{a * 100}%</text>
          </g>
        ))}
        {ticks.map((t) => (
          <g>
            <line class="grid" x1={x(t)} x2={x(t)} y1={T} y2={H - B} />
            <text class="axis" x={x(t)} y={H - B + 26} text-anchor="middle">฿{t}</text>
          </g>
        ))}
        <text class="axis" x={freeX} y={H - B + 26} text-anchor="middle">Free</text>
        <g class="break">
          <rect x={mid - 9} y={H - B - 10} width={18} height={20} fill="var(--bg)" />
          <line x1={mid - 9} x2={mid - 1} y1={H - B + 9} y2={H - B - 9} />
          <line x1={mid + 1} x2={mid + 9} y1={H - B + 9} y2={H - B - 9} />
        </g>
        <text class="axis-title" x={(x0 + W - R) / 2} y={H - 6} text-anchor="middle">
          Cost per page (THB, log scale)
        </text>
        <text
          class="axis-title"
          transform={`translate(12 ${(T + H - B) / 2}) rotate(-90)`}
          text-anchor="middle"
        >
          Accuracy
        </text>
        <text class="hint" x={L + 14} y={T + 22}>↖ cheaper and more accurate is better</text>
        {pts.filter((p) => !on.has(p.c)).map((p) => (
          <circle
            class={p.i < 10 ? "pt top" : "pt"}
            cx={x(p.cost)}
            cy={y(p.acc)}
            r={p.i < 10 ? 6 : 4.5}
          />
        ))}
        {labels.map((l) =>
          l.leader && <line class="leader" x1={l.x} y1={l.y} x2={l.leader[0]} y2={l.leader[1]} />
        )}
        {labels.map((l) => (
          <text class={l.cls} x={l.lx} y={l.ly} text-anchor={l.anchor} font-size={l.size}>
            {l.text}
          </text>
        ))}
        <path class="frontier" d={line} />
        <text class="frontier-label" x={flx} y={fly}>← Pareto frontier</text>
        {frontier.map((p) => <circle class="pt on" cx={x(p.cost)} cy={y(p.acc)} r={8} />)}
      </svg>
      <p class="note">
        Line and lime dots: the Pareto frontier. No other model is both cheaper and more accurate.
        Larger dots: the top 10 models. Each dot is the median run of one model.
      </p>
    </Slide>
  );
}

// ---------------------------------------------------------------------------------------------
// Styles and scripts

async function fontFaces() {
  const face = async (family: string, file: string, weight: number, range: string) => {
    const bytes = await Deno.readFile(new URL(`fonts/${file}`, root));
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return `@font-face{font-family:"${family}";font-weight:${weight};` +
      `src:url(data:font/woff2;base64,${btoa(bin)}) format("woff2");unicode-range:${range}}`;
  };
  const latin = "U+0000-00FF,U+0131,U+0152-0153,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122," +
    "U+2190-2199,U+2212,U+2215,U+25CF,U+FEFF,U+FFFD";
  const thai = "U+0E01-0E5B,U+200C-200D,U+25CC,U+0E3F";
  const css: string[] = [];
  for (const w of [400, 500, 600, 700, 800]) {
    css.push(await face("Deck", `tasa-orbiter-latin-${w}-normal.woff2`, w, latin));
  }
  for (const w of [400, 600, 700]) {
    css.push(await face("Deck", `sarabun-thai-${w}-normal.woff2`, w, thai));
    css.push(await face("Deck Thai", `sarabun-thai-${w}-normal.woff2`, w, thai));
    css.push(await face("Deck Thai", `sarabun-latin-${w}-normal.woff2`, w, latin));
  }
  return css.join("\n");
}

const CSS = `
@page { size: ${SIZE}px ${SIZE}px; margin: 0; }
:root {
  --bg: #eef0e8; --panel: #ffffff; --ink: #161b12; --soft: #3f473b; --muted: #6a7364;
  --faint: #9aa294; --line: #dcdfd4;
  --lime: #d7fc70; --lime-deep: #4f7a00;
  --good: #5e9b00; --okay: #c47a00; --poor: #d23c2e;
  --good-fill: #d7fc70; --okay-fill: #ffc766; --poor-fill: #ff8a7e;
  --miss-bg: rgba(94, 190, 90, .26); --miss: #2f8a2a;
  --wrong-bg: rgba(226, 70, 58, .20); --wrong: #c8352a;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #888; }
body { font-family: "Deck", sans-serif; color: var(--ink); -webkit-print-color-adjust: exact;
  print-color-adjust: exact; }
.slide { position: relative; width: ${SIZE}px; height: ${SIZE}px; overflow: hidden;
  background: var(--bg); page-break-after: always; break-after: page; }
.rays { position: absolute; inset: 0; pointer-events: none; z-index: 3; }

.kicker { font-size: 14px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--muted); }
.head { position: absolute; left: ${M}px; top: ${M - 8}px; right: ${M}px; }
.head h2 { font-size: 46px; line-height: 54px; font-weight: 800; margin-top: 8px;
  letter-spacing: -0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.head.no-kicker h2 { margin-top: 30px; }
.head .sub { font-size: 17px; line-height: 1.45; color: var(--soft); margin-top: 8px;
  max-width: 900px; }

.title h1 { position: absolute; left: ${M}px; top: ${M - 6}px; font-size: 56px; line-height: 72px;
  font-weight: 800; letter-spacing: -0.025em; }
.title h1 .hl { background: var(--lime); padding: 0 12px; border-radius: 10px; }
.title .page-map { position: absolute; left: ${M}px; bottom: 0; border-radius: 4px 4px 0 0;
  background: white; box-shadow: 0 20px 50px rgba(40,50,30,.18), 0 0 0 1px rgba(0,0,0,.06); }
.title .credit { position: absolute; right: ${M}px; bottom: ${M}px; width: 190px; text-align: right;
  font-size: 13px; line-height: 1.5; color: var(--muted); }

.gt-slide .page-part { position: absolute; background: white; border-radius: 4px 4px 0 0;
  box-shadow: 0 20px 50px rgba(40,50,30,.18), 0 0 0 1px rgba(0,0,0,.06); }
.gt-slide .page-part.bottom { border-radius: 0 0 4px 4px; }
.gt-mark { position: absolute; z-index: 2; border: 4px solid; border-radius: 5px; }
.gt-slide .rays { z-index: 6; }
.config-list { position: absolute; left: ${M}px; right: ${M}px; z-index: 2; }
.config-list h3 { font-size: 13px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--muted); margin-bottom: 22px; }
.config-list ol { list-style: none; columns: 3; column-gap: 28px; }
.config-list li { font-size: 16.5px; line-height: 24px; padding: 5px 0; break-inside: avoid;
  border-bottom: 1px solid var(--line); }
.config-list .vendor { color: var(--muted); }
.config-list b { font-weight: 700; }
.config-list .links { margin-top: 36px; font-size: 16px; line-height: 1.6; color: var(--soft); }
.config-list .links a { color: var(--ink); font-weight: 700; text-decoration: none;
  border-bottom: 3px solid var(--lime); }
.config-list .tag { display: inline-block; margin-left: 6px; font-size: 11.5px; line-height: 18px;
  padding: 0 7px; border-radius: 999px; background: #e3e6dc; color: var(--soft); }
.gt-card { position: absolute; z-index: 4; padding: 12px 16px; border: 3px solid;
  box-shadow: 0 12px 34px rgba(40,50,30,.20), 0 0 0 1px rgba(0,0,0,.04); }
.gt-card .truth { font-size: 17px; line-height: 26px; margin-top: 2px; }

.model-head h2 { display: flex; align-items: center; gap: 16px; margin-top: 30px; }
.model-head .rank { font-size: 30px; line-height: 50px; padding: 0 14px; border-radius: 12px;
  background: var(--lime); color: var(--ink); letter-spacing: -0.01em; }

.preview { position: absolute; left: ${M}px; top: ${TOP}px; background: white; z-index: 2;
  border-radius: 3px; box-shadow: 0 10px 30px rgba(40,50,30,.16), 0 0 0 1px rgba(0,0,0,.06); }
.preview img { display: block; border-radius: 3px; }
.mark { position: absolute; border: 2px solid var(--good); border-radius: 2px;
  background: rgba(215,252,112,.35); z-index: 4; }
.mark.neutral { border-color: #8a9384; background: rgba(138,147,132,.14); }
.mark.poor { border-color: var(--poor); background: rgba(210,60,46,.12); }

.cards { position: absolute; left: ${CONTENT_X}px; top: ${TOP}px; width: ${CONTENT_W}px;
  bottom: ${M - 16}px; z-index: 2; display: flex; flex-direction: column; gap: 12px; }
.card { background: var(--panel); border-radius: 14px; padding: 12px 18px;
  border: 1px solid var(--line); box-shadow: 0 4px 16px rgba(40,50,30,.06); }
.part-label { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.part-label .en { font-size: 13px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--ink); }
.part-label .th { font-family: "Deck Thai"; font-size: 14px; font-weight: 600; color: var(--muted); }
.chip { margin-left: auto; font-size: 13px; font-weight: 800; padding: 2px 10px; border-radius: 999px;
  color: var(--ink); }
.chip.good { background: var(--good-fill); } .chip.neutral { background: #e4e7df; }
.chip.poor { background: var(--poor-fill); }

.part-card .crop { display: block; border-radius: 2px; box-shadow: 0 0 0 1px var(--line); }
.part-card { padding: 11px 18px; }
.part-card .truth { font-size: 16px; line-height: 23px; margin-top: 6px; }
.part-footer .part-body { display: flex; flex-direction: row; gap: 20px; align-items: flex-start; }
.part-footer .crop { flex: none; }
.part-footer .truth { flex: 1; min-width: 0; margin-top: 0; }
.truth { font-family: "Deck Thai"; font-size: 17px; line-height: 25px; margin-top: 8px;
  color: var(--ink); }


.row { display: grid; grid-template-columns: 92px 1fr; gap: 12px; margin-top: 4px;
  font-family: "Deck Thai"; font-size: 16.5px; line-height: 25px; color: var(--ink); }
.row + .row { padding-top: 6px; margin-top: 6px; border-top: 1px dashed var(--line); }
.who { font-family: "Deck"; font-size: 12px; font-weight: 700; line-height: 25px; white-space: nowrap; }
.truth-who { color: var(--miss); } .response-who { color: var(--wrong); }
mark { border-radius: 3px; padding: 1px 1px; color: var(--ink); }
mark.miss { background: var(--miss-bg); box-shadow: inset 0 -2px 0 var(--miss); }
mark.wrong { background: var(--wrong-bg); box-shadow: inset 0 -2px 0 var(--wrong); }
.empty { color: var(--muted); }

.tiles { position: absolute; left: ${M}px; width: ${PREVIEW_W}px; z-index: 2;
  display: flex; flex-direction: column; gap: 10px; }
.tile { border-radius: 14px; padding: 12px 14px 11px; background: var(--panel);
  border: 1px solid var(--line); box-shadow: 0 4px 16px rgba(40,50,30,.06); }
.tile-label { font-size: 11.5px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--muted); }
.tile-number { font-size: 34px; line-height: 40px; font-weight: 800; letter-spacing: -0.02em;
  margin: 4px 0 8px; }
.good .tile-number { color: var(--good); } .okay .tile-number { color: var(--okay); }
.poor .tile-number { color: var(--poor); }
.rank-strip { display: flex; gap: 2px; height: 12px; align-items: center; }
.rank-strip i { flex: 1; height: 6px; border-radius: 1px; opacity: .35; }
.rank-strip i.good { background: var(--good); } .rank-strip i.okay { background: var(--okay); }
.rank-strip i.poor { background: var(--poor); }
.rank-strip i.me { height: 14px; opacity: 1; box-shadow: 0 0 0 2px var(--panel), 0 0 0 3px var(--ink);
  border-radius: 2px; }
.tile-rank { display: flex; justify-content: space-between; margin-top: 6px; font-size: 12.5px;
  color: var(--soft); }
.tile-rank span:last-child { color: var(--muted); }
.how { margin-top: 4px; font-size: 13px; line-height: 1.5; color: var(--soft); }

.chart { position: absolute; left: ${M}px; top: 212px; z-index: 2; font-family: "Deck"; }
.grid { stroke: var(--line); stroke-width: 1; }
.axis { font-size: 14px; fill: var(--muted); }
.axis-title { font-size: 13px; font-weight: 700; fill: var(--muted); letter-spacing: .14em;
  text-transform: uppercase; }
.break line { stroke: var(--muted); stroke-width: 2.5; }
.break rect { fill: var(--bg); }
.hint { font-size: 14px; fill: var(--lime-deep); font-weight: 700; }
.frontier { fill: none; stroke: var(--ink); stroke-width: 2.5; stroke-linejoin: round;
  stroke-linecap: round; }
.frontier-label { font-size: 13px; font-weight: 700; fill: var(--ink); letter-spacing: .04em; }
.pt { fill: #b9c0b2; } .pt.top { fill: #7d8677; }
.pt.on { fill: var(--lime); stroke: var(--ink); stroke-width: 2.5; }
.lab { paint-order: stroke; stroke: var(--bg); stroke-width: 5px; stroke-linejoin: round; }
.lab.on { fill: var(--ink); font-weight: 700; }
.lab.top { fill: var(--soft); }
.lab.dim { fill: var(--faint); }
.leader { stroke: #9aa294; stroke-width: 1; }
.note { position: absolute; left: ${M}px; bottom: ${
  M - 22
}px; font-size: 13px; color: var(--muted); }
`;

/** Draw a connector from each marked area on the preview to its card on the same slide. */
const SCRIPT = /* js */ `
const COLORS = { good: '#5e9b00', neutral: '#8a9384', poor: '#d23c2e', '': '#5e9b00' };
document.fonts.ready.then(() => {
  for (const slide of document.querySelectorAll('.slide')) {
    const svg = slide.querySelector('svg.rays');
    const base = slide.getBoundingClientRect();
    const ns = 'http://www.w3.org/2000/svg';
    const targets = [...slide.querySelectorAll('[data-ray-target]')];
    for (const [index, target] of targets.entries()) {
      const mark = slide.querySelector('[data-ray="' + target.dataset.rayTarget + '"]');
      if (!mark) continue;
      const a = mark.getBoundingClientRect(), b = target.getBoundingClientRect();
      const x1 = a.right - base.left, y1 = (a.top + a.bottom) / 2 - base.top;
      const x2 = b.left - base.left, y2 = b.top - base.top + 22;
      // Each connector has its own vertical lane in the gutter, so that they do not overlap.
      // A lower target uses a lane further left, so that no two connectors cross.
      const g = ${GUTTER_X} + 18 - index * 12;
      const color = COLORS[mark.dataset.grade || ''];
      const line = document.createElementNS(ns, 'polyline');
      line.setAttribute('points', [x1, y1, g, y1, g, y2, x2, y2].join(' '));
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(line);
      for (const [cx, cy] of [[x1, y1], [x2, y2]]) {
        const dot = document.createElementNS(ns, 'circle');
        dot.setAttribute('cx', cx);
        dot.setAttribute('cy', cy);
        dot.setAttribute('r', '3.5');
        dot.setAttribute('fill', color);
        svg.appendChild(dot);
      }
    }
  }
  // Straight links on the ground truth slides: from a rectangle on the page to its card.
  for (const slide of document.querySelectorAll('.slide')) {
    const svg = slide.querySelector('svg.rays');
    const base = slide.getBoundingClientRect();
    const ns = 'http://www.w3.org/2000/svg';
    for (const card of slide.querySelectorAll('[data-link-target]')) {
      const mark = slide.querySelector('[data-link="' + card.dataset.linkTarget + '"]');
      const a = mark.getBoundingClientRect(), b = card.getBoundingClientRect();
      const ca = [(a.left + a.right) / 2, (a.top + a.bottom) / 2];
      const cb = [(b.left + b.right) / 2, (b.top + b.bottom) / 2];
      // The point where the line from one center to the other leaves the rectangle.
      const exit = (r, c, to) => {
        const dx = to[0] - c[0], dy = to[1] - c[1];
        const t = Math.min(
          dx ? ((dx > 0 ? r.right : r.left) - c[0]) / dx : Infinity,
          dy ? ((dy > 0 ? r.bottom : r.top) - c[1]) / dy : Infinity,
        );
        return [c[0] + dx * t - base.left, c[1] + dy * t - base.top];
      };
      let p = exit(a, ca, cb), q = exit(b, cb, ca), points;
      if (card.dataset.route === 'left') {
        // Go left out of the rectangle, then down to the card, so that the line does not cross
        // another rectangle.
        const x = b.left + 24 - base.left;
        p = [a.left - base.left, ca[1] - base.top];
        q = [x, b.top - base.top];
        points = [p, [x, p[1]], q];
      } else {
        points = [p, q];
      }
      const line = document.createElementNS(ns, 'polyline');
      line.setAttribute('points', points.map((pt) => pt.join(',')).join(' '));
      line.setAttribute('fill', 'none');
      const color = mark.dataset.color;
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', '3');
      line.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(line);
      for (const [cx, cy] of [p, q]) {
        const dot = document.createElementNS(ns, 'circle');
        dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('r', '4.5');
        dot.setAttribute('fill', color);
        svg.appendChild(dot);
      }
    }
  }
  document.body.dataset.ready = '1';
});
`;

async function main() {
  const configs = await loadScores(root);
  const gt: Record<Column, string> = JSON.parse(
    await Deno.readTextFile(new URL("data/route34/ground-truth.json", root)),
  );
  const top = configs.slice(0, 10);
  const slides = [
    <TitleSlide />,
    <GroundTruthSlide
      gt={gt}
      half="top"
      cards={{
        header: { left: 430, top: 76, width: SIZE - M - 430 },
        forward: { left: M + 16, top: 720, width: 460, route: "left" },
        return: { left: SIZE - M - 16 - 460, top: 720, width: 460 },
      }}
    />,
    <GroundTruthSlide
      gt={gt}
      half="bottom"
      cards={{ footer: { left: M + 16, top: 150, width: 460 } }}
      configs={configs}
    />,
    ...top.map((c, i) => ({ c, r: i + 1 })).reverse().map(({ c, r }) => (
      <ModelSlide c={c} configs={configs} gt={gt} />
    )),
    <ParetoSlide configs={configs} />,
  ];
  const only = Deno.args[0]; // for example "1,2,3,4,last"
  const pick = only
    ? only.split(",").map((s) => s === "last" ? slides.length - 1 : Number(s) - 1)
    : slides.map((_, i) => i);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>34bench</title>` +
    `<style>${await fontFaces()}\n${CSS}</style></head><body>` +
    renderToString(<>{pick.map((i) => slides[i])}</>) +
    `<script>${SCRIPT}</script></body></html>`;
  await Deno.writeTextFile(new URL("slides/index.html", root), html);
  console.error(`Wrote slides/index.html (${pick.length} of ${slides.length} slides)`);
}

if (import.meta.main) await main();
