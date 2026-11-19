// 写真・スクショから読んだ明細の、画像の横の確かめ（workspace/statement/model.ts。0221）:
// 明細の合計と読んだ行の和が合わないとき、その画像（まとめて読んだ何枚かは全部）から読んだ全部の行に「読み取りが不確か」の印を付ける。
// 銀行の明細の残高と合わない行は、理由の短い文を印の下に出す。文字認識の結果は、OS を呼ばずに作った架空の結果で確かめる
import { describe, expect, it } from "vitest";
import type { OcrBox, OcrPage, SourceKind } from "../../statement/src/index.ts";
import { editedRows, editRowsOf, markTotalMismatch, readEdited, readFileWithYear, statementReaders, TOTAL_MISMATCH_WHY, type EditRow, type ReadOk } from "../src/workspace/statement/model.ts";

const W = 1170;
const H = 2532;
const PNG = (n: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n, 1, 2, 3]);

/** 画素の位置で並べた行から、文字認識の結果を作る */
function page(lines: readonly { y: number; cells: readonly { t: string; x: number }[]; h?: number }[]): OcrPage {
  const boxes: OcrBox[] = lines.flatMap((l) =>
    l.cells.map((c) => {
      const h = l.h ?? 24;
      const w = [...c.t].reduce((n, ch) => n + (ch.charCodeAt(0) < 0x100 ? 0.55 : 1), 0) * h;
      return { text: c.t, x: c.x / W, y: l.y / H, w: w / W, h: h / H, conf: 1 };
    }),
  );
  return { width: W, height: H, engine: "vision", boxes };
}

/** スマホのスクショ（1件が2行。店と金額の行の下に日付の行）。total が null なら合計の行が無い */
const PHONE: readonly [string, string, string][] = [
  ["あおばマート", "3,280円", "2026/10/01"],
  ["ほしぞらホームセンター", "38,400円", "2026/10/11"],
  ["ひかりスーパー", "4,987円", "2026/10/14"],
  ["みどりドラッグ", "1,078円", "2026/10/16"],
];
const phone = (rows: readonly [string, string, string][], total: string | null) =>
  page([
    { y: 160, cells: [{ t: "ご利用明細", x: 40 }] },
    { y: 230, cells: [{ t: "2026年11月10日お支払い分", x: 40 }] },
    ...(total !== null
      ? [
          { y: 330, cells: [{ t: "お支払金額", x: 60 }] },
          { y: 380, cells: [{ t: total, x: 740 }], h: 50 },
        ]
      : []),
    ...rows.flatMap(([m, a, d], i) => [
      { y: 500 + i * 150, cells: [{ t: m, x: 40 }, { t: a, x: 860 }] },
      { y: 555 + i * 150, cells: [{ t: d, x: 40 }, { t: "1回払い", x: 870 }], h: 22 },
    ]),
  ]);

interface Item {
  readonly bytes: Uint8Array;
  readonly out: ReadOk;
  readonly rows: EditRow[] | null;
}

/** 何枚かの画像を読んで、画像の横で直す行にする（画面の「選ぶ」と同じ） */
async function readAll(pages: readonly OcrPage[], kind: SourceKind): Promise<Item[]> {
  const byte = new Map(pages.map((p, i) => [i + 1, p]));
  const readers = statementReaders(async (b) => byte.get(b[8] as number) as OcrPage, async () => ({ pages: [], total: 0 }));
  const items: Item[] = [];
  for (const [i] of pages.entries()) {
    const bytes = PNG(i + 1);
    const out = await readFileWithYear(bytes, kind, [], undefined, 2026, readers);
    if (!out.ok) throw new Error(JSON.stringify(out.issues));
    items.push({ bytes, out, rows: editRowsOf(out) });
  }
  return items;
}

const unsure = (items: readonly Item[]) => items.map((it) => (it.rows ?? []).map((r) => r.uncertain));

describe("明細の合計と読んだ行の和が合わないとき、読んだ全部の行に「読み取りが不確か」の印", () => {
  it("ちょうど合う・合計の行が無いときは今のまま。1円ずれると全部の行に印（理由の短い文つき）", async () => {
    const exact = await readAll([phone(PHONE, "47,745円")], "card");
    expect(markTotalMismatch(exact, "card")).toEqual({ items: exact, marked: false });
    const none = await readAll([phone(PHONE, null)], "card");
    expect(markTotalMismatch(none, "card").marked).toBe(false);
    const off = await readAll([phone(PHONE, "47,746円")], "card");
    expect(unsure(off)).toEqual([[false, false, false, false]]);
    const m = markTotalMismatch(off, "card");
    expect(m.marked).toBe(true);
    expect(unsure(m.items)).toEqual([[true, true, true, true]]);
    expect(m.items[0]?.rows?.every((r) => r.why === TOTAL_MISMATCH_WHY)).toBe(true);
  });

  it("何枚かのスクショ: 重なりは2回足さず、合えば印を付けない。合わなければ全部の画像の全部の行に印", async () => {
    const ok = await readAll([phone(PHONE.slice(0, 3), null), phone(PHONE.slice(2), "47,745円")], "card");
    expect(markTotalMismatch(ok, "card").marked).toBe(false);
    const ng = await readAll([phone(PHONE.slice(0, 3), null), phone(PHONE.slice(2), "47,700円")], "card");
    const m = markTotalMismatch(ng, "card");
    expect(unsure(m.items)).toEqual([
      [true, true, true],
      [true, true],
    ]);
    // 1枚を読み直したときは、その画像の行だけに付ける（ほかの画像の確かめた行はそのまま）
    expect(unsure(markTotalMismatch(ng, "card", 1).items)).toEqual([
      [false, false, false],
      [true, true],
    ]);
  });

  it("銀行の明細は合計を照らし合わせない（合計は残高なので）", async () => {
    const bank = await readAll([phone(PHONE, "1円")], "bank");
    expect(markTotalMismatch(bank, "bank").marked).toBe(false);
  });

  it("印の外し方は今の不確かな行と同じ: 「確かめた」行は外れ、確かめていない行は取り込んだ記録に残る", async () => {
    const m = markTotalMismatch(await readAll([phone(PHONE, "47,746円")], "card"), "card");
    const it0 = m.items[0] as Item;
    const rows = (it0.rows ?? []).map((r, i) => (i === 0 ? { ...r, uncertain: false } : r));
    const edited = editedRows(rows);
    if (edited === null) throw new Error("直した行が読めない");
    const out = await readEdited(it0.bytes, it0.out, edited, "card");
    if (!out.ok) throw new Error(JSON.stringify(out.issues));
    expect(out.rows.map((r) => r.readUncertain === true)).toEqual([false, true, true, true]);
    // 理由の文は世帯ファイルに残さない（行に持たない）
    expect(JSON.stringify(out.rows)).not.toContain("合いません");
  });
});

describe("銀行の明細の残高と合わない行の理由", () => {
  it("合わない行だけに印と理由の短い文を出す", async () => {
    const p = page([
      { y: 100, cells: [{ t: "日付", x: 40 }, { t: "摘要", x: 200 }, { t: "お引出し", x: 520 }, { t: "お預入れ", x: 680 }, { t: "残高", x: 860 }] },
      { y: 150, cells: [{ t: "2026.10.01", x: 40 }, { t: "前月繰越", x: 200 }, { t: "182,450", x: 860 }] },
      { y: 194, cells: [{ t: "2026.10.05", x: 40 }, { t: "カード", x: 200 }, { t: "59,000", x: 540 }, { t: "123,450", x: 860 }] },
      { y: 238, cells: [{ t: "2026.10.10", x: 40 }, { t: "デンキ", x: 200 }, { t: "8,482", x: 540 }, { t: "115,018", x: 860 }] },
      { y: 282, cells: [{ t: "2026.10.15", x: 40 }, { t: "スイドウ", x: 200 }, { t: "4,180", x: 540 }, { t: "110,838", x: 860 }] },
    ]);
    const [it0] = await readAll([p], "bank");
    expect(it0?.rows?.map((r) => [r.uncertain, r.why ?? null])).toEqual([
      [false, null],
      [true, "残高と合いません（前の残高 123,450円 から計算すると 114,968円、明細の残高は 115,018円）"],
      [false, null],
    ]);
  });
});
