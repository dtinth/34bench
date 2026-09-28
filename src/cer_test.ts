import { assertEquals } from "jsr:@std/assert@1";
import { align, cer, cleanupOps, graphemes, normalize } from "./cer.ts";

Deno.test("graphemes keeps Thai marks with the base character", () => {
  assertEquals(graphemes("ที่"), ["ที่"]);
  assertEquals(graphemes("หัวลำโพง"), ["หั", "ว", "ลำ", "โ", "พ", "ง"]);
});

Deno.test("align counts a wrong tone mark as one error", () => {
  assertEquals(align("ที่", "ที้").distance, 1);
});

Deno.test("align produces ops that rebuild both strings", () => {
  const { ops } = align("รังสิต - หัวลำโพง", "รังสิต หัวลำโพงค์");
  const expected = ops.filter((o) => o.type !== "insert").map((o) => o.text).join("");
  const actual = ops.filter((o) => o.type !== "delete").map((o) => o.text).join("");
  assertEquals(expected, "รังสิต - หัวลำโพง");
  assertEquals(actual, "รังสิต หัวลำโพงค์");
});

Deno.test("cer sums distances over the total ground truth length", () => {
  const value = cer([
    { expected: "abcd", actual: "abcd" },
    { expected: "efgh", actual: "" },
  ]);
  assertEquals(value, 4 / 8);
});

Deno.test("cer ignores whitespace differences", () => {
  assertEquals(cer([{ expected: "a  b\nc", actual: " a b c " }]), 0);
});

Deno.test("normalize makes dashes the same and removes dot leaders", () => {
  assertEquals(normalize("รังสิต – ถนนพหลโยธิน — หัวลำโพง"), "รังสิต - ถนนพหลโยธิน - หัวลำโพง");
  assertEquals(normalize("ตามมาตรา 31.........(๖)……"), "ตามมาตรา 31 (๖)");
  assertEquals(normalize("พ.ร.บ.การขนส่งทางบก"), "พ.ร.บ.การขนส่งทางบก");
  assertEquals(normalize("(๖) (6)"), "(๖) (6)");
});

Deno.test("normalize removes Markdown and HTML markup", () => {
  assertEquals(
    normalize("ไปตามถนน**รองเมือง เลี้ยวขวาไป**ตาม\n## หมวด 1<br>\n<u>สาย</u>&nbsp;&nbsp;34"),
    "ไปตามถนนรองเมือง เลี้ยวขวาไปตาม หมวด 1 สาย 34",
  );
});

Deno.test("cleanupOps joins changes that have a short equal part between them", () => {
  const { ops } = align("abcdefgh", "aXcYefgh");
  assertEquals(cleanupOps(ops), [
    { type: "equal", text: "a" },
    { type: "delete", text: "bcd" },
    { type: "insert", text: "XcY" },
    { type: "equal", text: "efgh" },
  ]);
});
