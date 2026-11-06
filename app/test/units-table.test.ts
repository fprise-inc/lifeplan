// 単位の読み取りの表（同じ種類の誤りを二度と出さないための点検）: 円の欄・万円の欄の両方で、よく打たれる書き方を読み、
// 読めた額（円の整数）か「読めない」（null）かを表で確かめる。末尾の単位（円・万・万円・億）は欄の単位より優先して換算する。
// 今の読み取りで答えが違う行は「直す待ちの一覧」（PENDING）に入れ、「まだ違うこと」を確かめる形（test.fails）で通す。
// 読み取りを直したら、その行を PENDING から消す（消し忘れると「直ったのに一覧に残っている」でここが落ちる）
import { describe, expect, test } from "vitest";
import { parseYen, type YenUnit } from "../src/workspace/input/units.ts";

/** [打った文字, 円の欄で読む額, 万円の欄で読む額]。null は読めない（欄に書かない） */
const TABLE: readonly (readonly [string, number | null, number | null])[] = [
  ["15万", 150_000, 150_000],
  ["15万円", 150_000, 150_000],
  ["30万円", 300_000, 300_000],
  ["2800万", 28_000_000, 28_000_000],
  ["4500円", 4_500, 4_500],
  ["15000円", 15_000, 15_000],
  ["1,200", 1_200, 12_000_000],
  ["1.5億", 150_000_000, 150_000_000],
  ["1億", 100_000_000, 100_000_000],
  ["1億2000万", 120_000_000, 120_000_000],
  ["1億2000万円", 120_000_000, 120_000_000],
  ["478,200円", 478_200, 478_200],
  ["１５万", 150_000, 150_000],
  // 円の欄の1円未満の端数は、四捨五入して1円にせず読めないとする（5,000円のつもりのことが多い。「0.5万」と打てば読む）
  ["０．５", null, 5_000],
  ["0.5", null, 5_000],
  ["15.5万", 155_000, 155_000],
  ["1.5万円", 15_000, 15_000],
  ["-3", -3, -30_000],
  ["0", 0, 0],
  ["万", null, null],
  ["円", null, null],
  ["億", null, null],
  ["abc", null, null],
  ["", null, null],
  ["15万万", null, null],
  ["1.2.3", null, null],
  // 「1億2000」は1億2,000円と1億2,000万円のどちらにも読めるので、読まずに「万まで書いて」と聞き直す
  ["1億2000", null, null],
  ["1万5000", 15_000, 15_000],
  ["5千円", 5_000, 5_000],
];

/**
 * 直す待ちの一覧: 今の読み取りで答えが違う行（打った文字と欄の単位）。
 * 鍵は「打った文字@欄の単位」（yen＝円の欄、man＝万円の欄）
 */
const PENDING: ReadonlySet<string> = new Set<string>([
  // 今は無い（末尾の単位を見て換算する読み取りにした。0130）
]);

const rows = TABLE.flatMap(([text, yen, man]) =>
  (
    [
      ["yen", yen],
      ["man", man],
    ] as const
  ).map(([unit, want]) => ({ text, unit: unit as YenUnit, want, key: `${text}@${unit}` })),
);

describe("単位の読み取りの表（円の欄・万円の欄）", () => {
  for (const r of rows) {
    const name = `「${r.text}」を${r.unit === "yen" ? "円" : "万円"}の欄で読むと ${r.want === null ? "読めない" : `${r.want.toLocaleString("ja-JP")}円`}`;
    if (PENDING.has(r.key)) test.fails(`直す待ち: ${name}`, () => expect(parseYen(r.text, r.unit)).toBe(r.want));
    else test(name, () => expect(parseYen(r.text, r.unit)).toBe(r.want));
  }

  test("直す待ちの一覧の鍵は、どれも表の行を指す（消し忘れ・打ち間違いを見つける）", () => {
    const keys = new Set(rows.map((r) => r.key));
    for (const k of PENDING) expect(keys.has(k), k).toBe(true);
  });
});
