const segmenter = new Intl.Segmenter("th", { granularity: "grapheme" });

/** Split text into grapheme clusters, so Thai marks stay with their base character. */
export function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

/**
 * Remove Markdown and HTML formatting that a model added around the text, e.g. `**`, `<u>`,
 * `<br>`, `&nbsp;`, and heading markers. The document has no formatting that we score.
 */
export function stripMarkup(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/\*+|__+/g, "");
}

/**
 * Prepare text for scoring:
 * - remove markup;
 * - make all dashes the same, because a typewriter dash can look like "-" or "–";
 * - remove dot leaders (3 or more "." or any "…"), because models write different numbers of dots
 *   for a dotted line;
 * - collapse runs of whitespace into one space and trim the ends.
 *
 * - make Thai digits the same as Arabic digits (๖ = 6), because the document uses Arabic digits
 *   and a Thai digit is an acceptable reading of them.
 */
export function normalize(text: string): string {
  return stripMarkup(text)
    .replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50))
    .replace(/[‐-―−]/g, "-")
    .replace(/\.{3,}|…+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type DiffOp =
  | { type: "equal"; text: string }
  | { type: "delete"; text: string } // in the ground truth, missing from the output
  | { type: "insert"; text: string }; // in the output, not in the ground truth

export interface Alignment {
  distance: number;
  ops: DiffOp[];
}

/** Grapheme-level Levenshtein alignment of `actual` against `expected`. */
export function align(expected: string, actual: string): Alignment {
  const a = graphemes(expected);
  const b = graphemes(actual);
  const n = a.length;
  const m = b.length;
  const d: Uint32Array[] = [];
  for (let i = 0; i <= n; i++) {
    d.push(new Uint32Array(m + 1));
    d[i][0] = i;
  }
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }

  // Walk back to get the edit script. A substitution becomes a delete plus an insert.
  const reversed: DiffOp[] = [];
  const push = (type: DiffOp["type"], text: string) => {
    const last = reversed[reversed.length - 1];
    if (last && last.type === type) last.text = text + last.text;
    else reversed.push({ type, text });
  };
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1] && d[i][j] === d[i - 1][j - 1]) {
      push("equal", a[i - 1]);
      i--;
      j--;
    } else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + 1) {
      push("insert", b[j - 1]);
      push("delete", a[i - 1]);
      i--;
      j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      push("delete", a[i - 1]);
      i--;
    } else {
      push("insert", b[j - 1]);
      j--;
    }
  }
  return { distance: d[n][m], ops: reversed.reverse() };
}

/** Remove all whitespace. Whitespace is ignored when texts are compared. */
export function removeWhitespace(text: string): string {
  return text.replace(/\s+/g, "");
}

/**
 * Align `actual` against `expected`, ignoring whitespace. The returned ops still contain the
 * whitespace of `actual` (as equal text), so that they can be displayed.
 */
export function alignIgnoringWhitespace(expected: string, actual: string): Alignment {
  const { distance, ops } = align(removeWhitespace(expected), removeWhitespace(actual));
  const spaced = graphemes(actual);
  let i = 0;
  const out: DiffOp[] = [];
  const push = (type: DiffOp["type"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };
  const spaces = () => {
    while (i < spaced.length && /^\s+$/.test(spaced[i])) push("equal", spaced[i++]);
  };
  for (const op of ops) {
    if (op.type === "delete") {
      push("delete", op.text);
      continue;
    }
    for (const g of graphemes(op.text)) {
      spaces();
      push(op.type, g);
      i++;
    }
  }
  spaces();
  return { distance, ops: out };
}

/**
 * Make a diff easier to read: an equal part that is shorter than `minEqual` graphemes, between two
 * changes, becomes part of the changes. Then each group of changes is shown as one delete and one
 * insert. This is for display only; it does not change the distance.
 */
export function cleanupOps(ops: DiffOp[], minEqual = 3): DiffOp[] {
  const out: DiffOp[] = [];
  let del = "";
  let ins = "";
  const flush = () => {
    if (del) out.push({ type: "delete", text: del });
    if (ins) out.push({ type: "insert", text: ins });
    del = ins = "";
  };
  ops.forEach((op, i) => {
    if (op.type === "delete") del += op.text;
    else if (op.type === "insert") ins += op.text;
    else {
      const between = (del || ins) && i < ops.length - 1;
      if (between && graphemes(op.text).length < minEqual) {
        del += op.text;
        ins += op.text;
      } else {
        flush();
        out.push(op);
      }
    }
  });
  flush();
  return out;
}

/**
 * Character error rate over several columns: the sum of the per-column edit
 * distances divided by the total ground truth length, in grapheme clusters.
 */
export function cer(pairs: { expected: string; actual: string }[]): number {
  let distance = 0;
  let length = 0;
  for (const { expected, actual } of pairs) {
    const e = removeWhitespace(normalize(expected));
    distance += align(e, removeWhitespace(normalize(actual))).distance;
    length += graphemes(e).length;
  }
  return length === 0 ? 0 : distance / length;
}
