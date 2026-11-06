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
  ["０．５", 1, 5_000],
  ["0.5", 1, 5_000],
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
];

/**
 * 直す待ちの一覧: 今の読み取りで答えが違う行（打った文字と欄の単位）。末尾の単位を消すだけで換算しない・億を読まないため。
 * 鍵は「打った文字@欄の単位」（yen＝円の欄、man＝万円の欄）
 */
const PENDING: ReadonlySet<string> = new Set([
  // 円の欄の「万」「万円」が換算されず、15円のように読まれる
  "15万@yen",
  "15万円@yen",
  "30万円@yen",
  "2800万@yen",
  "１５万@yen",
  "15.5万@yen",
  "1.5万円@yen",
  // 万円の欄の「円」が換算されず、4,500万円のように読まれる
  "4500円@man",
  "15000円@man",
  "478,200円@man",
  // 億を読まない
  "1.5億@yen",
  "1.5億@man",
  "1億@yen",
  "1億@man",
  "1億2000万@yen",
  "1億2000万@man",
  "1億2000万円@yen",
  "1億2000万円@man",
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
