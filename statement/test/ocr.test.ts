// 写真・スクショ・画像だけの PDF の読み手（0034 の段階3。0221）と、文字の入った PDF と同じ組み立て（layout.ts）の境目の確かめ。
// 文字認識の結果は、OS を呼ばずに作った架空の結果（位置つきの文字の塊）で確かめる
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assemble,
  classify,
  createEditedReader,
  createImageReader,
  createImport,
  createMarkSheet,
  createPdfScanReader,
  csvReader,
  emptyLog,
  findTotals,
  fixDigits,
  maskCellLoose,
  MASK,
  mergeDigits,
  OcrFailure,
  pdfTextReader,
  planMarkSheet,
  readLog,
  readStatement,
  reviewList,
  sheetRequestId,
  totalCheck,
  type LayoutItem,
  type OcrBox,
  type OcrFn,
  type OcrPage,
  type ReadOutcome,
  type SourceKind,
  type StatementAccount,
  type StatementLog,
} from "../src/index.ts";
import { fixDigits as fix, fixSymbols, separateTransfer } from "../src/ocr.ts";
import { UNCERTAIN_MARK } from "../src/sheet/write.ts";
import { text, unzip } from "../../xlsx/test/helpers.ts";
import { BASE_MONTH, HOUSEHOLD } from "./helpers.ts";

const W = 1000;
const H = 1400;
/** 架空の PNG（先頭の印だけ。中身は読まない） */
const PNG = (n = 0) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n, 1, 2, 3]);
const JPEG = (n = 0) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, n, 1, 2, 3]);

interface Cell {
  readonly t: string;
  readonly x: number;
  readonly w?: number;
  readonly conf?: number;
}

/** 画素の位置（左上が原点）で並べた行から、文字認識の結果を作る。angle（度）で座標を回す（写真の傾き） */
function page(lines: readonly { y: number; cells: readonly Cell[]; h?: number }[], o: { angle?: number; engine?: string; digits?: readonly OcrBox[]; width?: number; height?: number } = {}): OcrPage {
  const width = o.width ?? W;
  const height = o.height ?? H;
  const t = ((o.angle ?? 0) * Math.PI) / 180;
  const boxes: OcrBox[] = lines.flatMap((l) =>
    l.cells.map((c) => {
      const h = l.h ?? 24;
      const w = c.w ?? [...c.t].reduce((n, ch) => n + (ch.charCodeAt(0) < 0x100 ? 0.55 : 1), 0) * h;
      // 中心を回す（画像の下向きが正の座標で、時計回りに angle）
      const cx = c.x + w / 2;
      const cy = l.y + h / 2;
      const rx = cx * Math.cos(t) - cy * Math.sin(t);
      const ry = cx * Math.sin(t) + cy * Math.cos(t);
      return { text: c.t, x: (rx - w / 2) / width, y: (ry - h / 2) / height, w: w / width, h: h / height, ...(c.conf !== undefined ? { conf: c.conf } : { conf: 1 }) };
    }),
  );
  return { width, height, engine: o.engine ?? "vision", boxes, ...(o.digits !== undefined ? { digits: o.digits } : {}) };
}

const ocrOf =
  (...pages: OcrPage[]): OcrFn =>
  async () =>
    pages.shift() as OcrPage;

async function readImage(p: OcrPage, kind: SourceKind, bytes = PNG()): Promise<Extract<ReadOutcome, { ok: true }>> {
  const out = await readStatement(bytes, { kind, readers: [createImageReader(async () => p), csvReader], yearHint: 2026, today: "2026-11-17" });
  if (!out.ok) throw new Error(JSON.stringify(out.issues));
  return out;
}

/** カードの明細（見出しのある表） */
const CARD_ROWS: readonly [string, string, string][] = [
  ["10/01", "あおばマート みどり一丁目店", "3,280"],
  ["10/02", "ひかりスーパー", "5,412"],
  ["10/04", "みどりドラッグ", "1,078"],
  ["10/06", "みどりガソリン", "6,200"],
  ["10/09", "みどり食堂", "1,350"],
];
function cardPage(o: { angle?: number; headerGap?: number } = {}): OcrPage {
  const g = o.headerGap ?? 0;
  return page(
    [
      { y: 40, cells: [{ t: "ご利用明細" }] },
      { y: 80, cells: [{ t: "2026年11月10日お支払い分" }] },
      { y: 140, cells: [{ t: "ご利用日", x: 40 }, { t: "ご利用店名", x: 140 + g }, { t: "ご利用金額", x: 760 }] },
      ...CARD_ROWS.map(([d, m, a], i) => ({ y: 190 + i * 44, cells: [{ t: d, x: 40 }, { t: m, x: 140 }, { t: a, x: 800 }] })),
    ].map((l) => ({ ...l, cells: l.cells.map((c) => ({ x: 40, ...c })) })),
    o,
  );
}

describe("見出しの位置で欄に入れる（空の欄で列が詰まらない・近い見出し・傾き）", () => {
  it("銀行の明細の出金・入金のどちらかが空でも、列がずれない", async () => {
    const p = page([
      { y: 100, cells: [{ t: "日付", x: 40 }, { t: "摘要", x: 200 }, { t: "お引出し", x: 520 }, { t: "お預入れ", x: 680 }, { t: "残高", x: 860 }] },
      { y: 150, cells: [{ t: "2026.10.05", x: 40 }, { t: "カード アオバカード", x: 200 }, { t: "59,000", x: 540 }, { t: "441,000", x: 860 }] },
      { y: 194, cells: [{ t: "2026.10.25", x: 40 }, { t: "給与 ホシゾラシヨウジ", x: 200 }, { t: "312,000", x: 690 }, { t: "753,000", x: 860 }] },
      { y: 238, cells: [{ t: "2026.10.27", x: 40 }, { t: "スイドウ ミドリシ", x: 200 }, { t: "4,180", x: 550 }, { t: "748,820", x: 860 }] },
    ]);
    const out = await readImage(p, "bank");
    expect(out.rows.map((r) => [r.date, r.merchant, r.amount])).toEqual([
      ["2026-10-05", "カード アオバカード", 59000],
      ["2026-10-25", "給与 ホシゾラシヨウジ", -312000],
      ["2026-10-27", "スイドウ ミドリシ", 4180],
    ]);
    expect(out.ocr?.layout).toBe("table");
  });

  it("0.5度ほどの傾きでも、右の欄が次の行に落ちない", async () => {
    for (const angle of [0.5, -0.5, 3]) {
      const out = await readImage(cardPage({ angle }), "card", JPEG());
      expect(out.rows.map((r) => [r.date, r.merchant, r.amount]), `${angle}度`).toEqual(CARD_ROWS.map(([d, m, a]) => [`2026-${d.replace("/", "-")}`, m, Number(a.replace(",", ""))]));
      expect(Math.abs(Math.abs(out.ocr?.angles[0] ?? 0) - Math.abs(angle))).toBeLessThanOrEqual(0.6);
    }
  });

  it("近い見出し（字の高さより狭い隙間）がつながらない", async () => {
    // 「ご利用日」と「ご利用店名」の隙間を字の高さの半分ほどにする（前の組み立ては1つの欄にしていた）
    const p = page([
      { y: 140, cells: [{ t: "ご利用日", x: 40, w: 96 }, { t: "ご利用店名", x: 150, w: 120 }, { t: "ご利用金額", x: 760 }] },
      ...CARD_ROWS.map(([d, m, a], i) => ({ y: 190 + i * 44, cells: [{ t: d, x: 40, w: 60 }, { t: m, x: 150 }, { t: a, x: 800 }] })),
    ]);
    const out = await readImage(p, "card");
    expect(out.table.cells[out.mapping.headerRow ?? -1]).toEqual(["ご利用日", "ご利用店名", "ご利用金額"]);
    expect(out.rows).toHaveLength(CARD_ROWS.length);
  });

  it("文字の入った PDF と同じ組み立て: 1字ずつの塊・空の欄（PDF の座標）", () => {
    // PDF は1字ずつの塊のことがある。見出しの語は字の間が詰まっているので1つの欄、欄の間は離れている
    const chars = (text: string, x: number, y: number, size = 10): LayoutItem[] => [...text].map((ch, i) => ({ text: ch, x: x + i * size, y, width: size, size }));
    const items = [...chars("日付", 20, 700), ...chars("摘要", 120, 700), ...chars("出金", 300, 700), ...chars("入金", 380, 700), ...chars("10/03", 20, 680), ...chars("デンキ", 120, 680), ...chars("8,432", 300, 680), ...chars("10/25", 20, 660), ...chars("キュウヨ", 120, 660), ...chars("312,000", 380, 660)];
    const l = assemble(items, "bank");
    expect(l.lines).toEqual([
      ["日付", "摘要", "出金", "入金"],
      ["10/03", "デンキ", "8,432", ""],
      ["10/25", "キュウヨ", "", "312,000"],
    ]);
  });

  it("見出しの無いページは、前のページの見出しの位置で欄に入れる（複数のページ）", async () => {
    const p1 = page([
      { y: 100, cells: [{ t: "日付", x: 40 }, { t: "摘要", x: 200 }, { t: "お引出し", x: 520 }, { t: "お預入れ", x: 680 }] },
      { y: 150, cells: [{ t: "2026.10.05", x: 40 }, { t: "デンキ", x: 200 }, { t: "8,432", x: 540 }] },
    ]);
    const p2 = page([
      { y: 100, cells: [{ t: "2026.10.25", x: 40 }, { t: "キュウヨ", x: 200 }, { t: "312,000", x: 690 }] },
      { y: 150, cells: [{ t: "2026.10.27", x: 40 }, { t: "スイドウ", x: 200 }, { t: "4,180", x: 540 }] },
    ]);
    const reader = createPdfScanReader(ocrOf(p1, p2), async () => ({ pages: [PNG(1), PNG(2)], total: 2 }));
    const pdf = new TextEncoder().encode("%PDF-1.7 画像だけ");
    const out = await readStatement(pdf, { kind: "bank", readers: [reader] });
    if (!out.ok) throw new Error(JSON.stringify(out.issues));
    expect(out.reader).toEqual({ id: "pdfScan", version: 1 });
    expect(out.rows.map((r) => r.amount)).toEqual([8432, -312000, 4180]);
  });
});

describe("スマホのスクショ（1件が2行）", () => {
  const PHONE: readonly [string, string, string, string][] = [
    ["あおばマート みどり一丁目店", "3,280円", "2026/10/01", "1回払い"],
    ["ほしぞらホームセンター", "38,400円", "2026/10/11", "分割3回"],
    ["ひかりスーパー", "4,987円", "2026/10/14", "1回払い"],
    ["ひかりスーパー", "4,987円", "2026/10/14", "1回払い"],
  ];
  const phonePage = (rows = PHONE, total = "51,654円") =>
    page(
      [
        { y: 60, cells: [{ t: "9:41", x: 60 }] },
        { y: 160, cells: [{ t: "ご利用明細", x: 40 }] },
        { y: 230, cells: [{ t: "2026年11月10日お支払い分", x: 40 }] },
        { y: 330, cells: [{ t: "お支払金額", x: 60 }] },
        { y: 380, cells: [{ t: total, x: 740 }], h: 50 },
        ...rows.flatMap(([m, a, d, plan], i) => [
          { y: 500 + i * 150, cells: [{ t: m, x: 40 }, { t: a, x: 860 }] },
          { y: 555 + i * 150, cells: [{ t: d, x: 40 }, { t: plan, x: 870 }], h: 22 },
        ]),
      ],
      { width: 1170, height: 2532 },
    );

  it("店と金額の行の下の日付の行を、1件にする（支払い方法も読む）。同じ日・同じ店・同じ額の2件は2件のまま", async () => {
    const out = await readImage(phonePage(), "card");
    expect(out.ocr?.layout).toBe("twoLine");
    expect(out.rows.map((r) => [r.date, r.merchant, r.amount, r.plan?.kind])).toEqual([
      ["2026-10-01", "あおばマート みどり一丁目店", 3280, "lump"],
      ["2026-10-11", "ほしぞらホームセンター", 38400, "installment"],
      ["2026-10-14", "ひかりスーパー", 4987, "lump"],
      ["2026-10-14", "ひかりスーパー", 4987, "lump"],
    ]);
    // 合計の行（お支払金額）は明細の行にしない。合計として読む
    expect(out.ocr?.totals).toEqual([51654]);
    expect(totalCheck([{ rows: out.rows, totals: out.ocr?.totals ?? [] }], "card")).toEqual({ totals: [51654], sum: 51654, ok: true });
  });

  it("日付ごとにまとめた画面（日付だけの行の下に、その日の店と金額）", async () => {
    const p = page([
      { y: 100, cells: [{ t: "10月1日(水)", x: 40 }] },
      { y: 150, cells: [{ t: "あおばマート", x: 40 }, { t: "3,280円", x: 860 }] },
      { y: 200, cells: [{ t: "ひかりスーパー", x: 40 }, { t: "5,412円", x: 860 }] },
      { y: 270, cells: [{ t: "10月2日(木)", x: 40 }] },
      { y: 320, cells: [{ t: "みどりドラッグ", x: 40 }, { t: "1,078円", x: 860 }] },
    ]);
    const out = await readImage(p, "card");
    expect(out.rows.map((r) => [r.date, r.merchant, r.amount])).toEqual([
      ["2026-10-01", "あおばマート", 3280],
      ["2026-10-01", "ひかりスーパー", 5412],
      ["2026-10-02", "みどりドラッグ", 1078],
    ]);
  });

  it("スクショの重なり: 何枚かは1枚を1つの取り込みにし、同じ口座の別の取り込みの同じ行は数えない。合計は重なりを2回足さない", async () => {
    const first = await readImage(phonePage(PHONE.slice(0, 3)), "card", PNG(1));
    const second = await readImage(phonePage(PHONE.slice(2), "51,654円"), "card", PNG(2));
    expect(first.file.sha256).not.toBe(second.file.sha256);
    const acc: StatementAccount = { id: "a1", kind: "card", label: "カード", owner: null };
    let log: StatementLog = { ...emptyLog(), accounts: [acc] };
    for (const [i, o] of [first, second].entries()) {
      const imp = createImport(log, o, { id: `i${i}`, account: "a1", at: "2026-11-17T00:00:00+09:00", period: { from: "2026-10-01", to: "2026-10-31" } });
      if (imp === null) throw new Error("取り込めない");
      log = { ...log, imports: [...log.imports, imp] };
    }
    const rows = classify({ log, household: HOUSEHOLD, baseMonth: BASE_MONTH, office: [] });
    const counted = rows.filter((r) => r.counted).map((r) => [r.row.date, r.row.amount]);
    // 1枚目の 10/14 の1件と、2枚目の 10/14 の2件 → 同じ行は数の多い方（2件）だけ数える
    expect(counted).toEqual([
      ["2026-10-01", 3280],
      ["2026-10-11", 38400],
      ["2026-10-14", 4987],
      ["2026-10-14", 4987],
    ]);
    expect(totalCheck([first, second].map((o) => ({ rows: o.rows, totals: o.ocr?.totals ?? [] })), "card")?.ok).toBe(true);
  });

  it("合計が合わないときは照らし合わせで分かる（読めていない行がある）", async () => {
    const out = await readImage(phonePage(PHONE, "60,000円"), "card");
    expect(totalCheck([{ rows: out.rows, totals: out.ocr?.totals ?? [] }], "card")).toEqual({ totals: [60000], sum: 51654, ok: false });
    // 銀行の明細の合計（残高）は照らし合わせない
    expect(totalCheck([{ rows: out.rows, totals: [1] }], "bank")).toBeNull();
    expect(findTotals([["ご利用合計", "1,234"], ["残高", "9,999"], ["お支払金額"], ["5,678円"]])).toEqual([1234, 5678]);
  });
});

describe("数字の読み違いを直す・番号を消す（英字の O・I・l も数字とみなす）", () => {
  it("O と 0・l と 1・「数字.3桁」を直し、読み取りが不確かの印を付ける", async () => {
    expect(fixDigits("2O26/1O/O1")).toEqual({ text: "2026/10/01", fixed: true });
    expect(fix("5.412")).toEqual({ text: "5,412", fixed: true });
    expect(fix("l回払い")).toEqual({ text: "1回払い", fixed: true });
    expect(fix("10.05")).toEqual({ text: "10.05", fixed: false });
    expect(fix("OISHII 食堂")).toEqual({ text: "OISHII 食堂", fixed: false });
    expect(fixSymbols("PAYPAY”そらまめカフェ")).toBe("PAYPAY*そらまめカフェ");
    expect(fixSymbols("“ひかり”スーパー")).toBe("“ひかり”スーパー");
    const p = page([
      { y: 140, cells: [{ t: "ご利用日", x: 40 }, { t: "ご利用店名", x: 140 }, { t: "ご利用金額", x: 760 }] },
      { y: 190, cells: [{ t: "1O/O1", x: 40 }, { t: "あおばマート", x: 140 }, { t: "3.28O", x: 800 }] },
      { y: 234, cells: [{ t: "10/02", x: 40 }, { t: "ひかりスーパー", x: 140 }, { t: "5,412", x: 800 }] },
    ]);
    const out = await readImage(p, "card");
    expect(out.rows.map((r) => [r.date, r.amount, r.readUncertain === true])).toEqual([
      ["2026-10-01", 3280, true],
      ["2026-10-02", 5412, false],
    ]);
    expect(out.issues.map((i) => i.code)).toContain("S_OCR_UNCERTAIN");
  });

  it("カード番号の 0 を O と読んでも消す（消し過ぎの側に倒す）", async () => {
    expect(maskCellLoose("OOOO-XXXX-XXXX-OOOO").text).toBe(MASK);
    expect(maskCellLoose("カード番号 OOOO 1lI1 2222 3333").text).toBe(`カード番号 ${MASK}`);
    expect(maskCellLoose("口座 l234567").text).toBe(`口座 ${MASK}`);
    expect(maskCellLoose("OISHII 食堂").text).toBe("OISHII 食堂");
    const p = page([
      { y: 40, cells: [{ t: "カード番号 OOOO-XXXX-XXXX-OOOO", x: 40 }] },
      { y: 140, cells: [{ t: "ご利用日", x: 40 }, { t: "ご利用店名", x: 140 }, { t: "ご利用金額", x: 760 }] },
      { y: 190, cells: [{ t: "10/01", x: 40 }, { t: "あおばマート 会員 l234 5678 9O12 3456", x: 140 }, { t: "3,280", x: 800 }] },
    ]);
    const out = await readImage(p, "card");
    const all = JSON.stringify(out);
    for (const s of ["OOOO-XXXX", "l234 5678", "9O12"]) expect(all).not.toContain(s);
    expect(out.rows[0]?.merchant).toBe(`あおばマート 会員 ${MASK}`);
  });

  it("振込の言葉と相手の名前の間の空白を落としても、相手の名前を残さない（銀行の明細）", async () => {
    expect(separateTransfer("振込ミドリ タロウ")).toBe("振込 ミドリ タロウ");
    expect(separateTransfer("振込手数料")).toBe("振込手数料");
    const p = page([
      { y: 100, cells: [{ t: "日付", x: 40 }, { t: "摘要", x: 200 }, { t: "お引出し", x: 520 }, { t: "お預入れ", x: 680 }] },
      { y: 150, cells: [{ t: "2026.10.15", x: 40 }, { t: "振込ミドリ タロウ", x: 200 }, { t: "30,000", x: 540 }] },
      { y: 194, cells: [{ t: "2026.10.16", x: 40 }, { t: "振込手数料", x: 200 }, { t: "330", x: 560 }] },
    ]);
    const out = await readImage(p, "bank");
    expect(out.rows.map((r) => r.merchant)).toEqual(["振込（相手の名前は残しません）", "振込手数料"]);
    expect(JSON.stringify(out.rows)).not.toContain("タロウ");
    const edited = await readStatement(PNG(), { kind: "bank", readers: [createEditedReader(out.reader, [{ line: 1, date: "2026-10-15", merchant: "振込ミドリ タロウ", amount: 30000 }])] });
    expect(edited.ok && edited.rows[0]?.merchant).toBe("振込（相手の名前は残しません）");
  });

  it("小さい字は知らせる", async () => {
    const p = page([
      { y: 40, cells: [{ t: "ご利用日", x: 40 }, { t: "ご利用店名", x: 100 }, { t: "ご利用金額", x: 300 }], h: 9 },
      ...CARD_ROWS.map(([d, m, a], i) => ({ y: 60 + i * 14, cells: [{ t: d, x: 40 }, { t: m, x: 100 }, { t: a, x: 320 }], h: 9 })),
    ]);
    const out = await readImage(p, "card");
    expect(out.issues.map((i) => i.code)).toContain("S_OCR_SMALL_TEXT");
  });

  it("確からしさの低い文字のある行は、読み取りが不確か", async () => {
    const p = page([
      { y: 140, cells: [{ t: "ご利用日", x: 40 }, { t: "ご利用店名", x: 140 }, { t: "ご利用金額", x: 760 }] },
      { y: 190, cells: [{ t: "10/01", x: 40 }, { t: "こもれび審店", x: 140, conf: 0.3 }, { t: "1,980", x: 800 }] },
      { y: 234, cells: [{ t: "10/02", x: 40 }, { t: "ひかりスーパー", x: 140, conf: 0.5 }, { t: "5,412", x: 800 }] },
    ]);
    const out = await readImage(p, "card");
    expect(out.rows.map((r) => r.readUncertain === true)).toEqual([true, false]);
  });
});

describe("Windows: 日本語で読んだ後、数字だけ英語で読み直す", () => {
  // 日本語の読み: 数字を日本語の字と取り違える。英語の読み: 数字は正しい
  const ja = [
    { y: 140, cells: [{ t: "日付", x: 40 }, { t: "摘要", x: 200 }, { t: "お引出し", x: 520 }, { t: "お預入れ", x: 680 }] },
    { y: 190, cells: [{ t: "2田26.1田.田5", x: 40, w: 130 }, { t: "デンキ", x: 200 }, { t: "8.432", x: 540, w: 70 }] },
    { y: 234, cells: [{ t: "2026.10.25", x: 40, w: 130 }, { t: "キュウヨ", x: 200 }, { t: "312,000", x: 690, w: 90 }] },
  ];
  const en: readonly OcrBox[] = page([
    { y: 190, cells: [{ t: "2026.10.05", x: 40, w: 130 }, { t: "8,432", x: 540, w: 70 }] },
    { y: 234, cells: [{ t: "2026.10.25", x: 40, w: 130 }, { t: "312,000", x: 690, w: 90 }] },
  ]).boxes;

  it("数字の塊は英語の読みを使い、食い違った数字の行は読み取りが不確か", async () => {
    const p = page(ja, { engine: "windows-media-ocr", digits: en });
    const merged = mergeDigits(p);
    expect(merged.map((b) => b.text)).toContain("2026.10.05");
    const out = await readImage(p, "bank");
    expect(out.rows.map((r) => [r.date, r.amount, r.readUncertain === true])).toEqual([
      ["2026-10-05", 8432, true],
      ["2026-10-25", -312000, false],
    ]);
  });

  it("写真（JPEG）は、2回の読みで同じにならなかった数字のある行すべてに印を付ける（確かめを強める）", async () => {
    // 英語で読めなかった（確かめられなかった）数字の行も印
    const p = page(ja, { engine: "windows-media-ocr", digits: en.filter((b) => b.text !== "312,000") });
    const photo = await readImage(p, "bank", JPEG());
    expect(photo.rows.map((r) => r.readUncertain === true)).toEqual([true, true]);
    expect(photo.ocr?.source).toBe("photo");
    // スクショ（PNG）は、食い違ったときだけ
    const shot = await readImage(page(ja, { engine: "windows-media-ocr", digits: en.filter((b) => b.text !== "312,000") }), "bank");
    expect(shot.rows.map((r) => r.readUncertain === true)).toEqual([true, false]);
  });

  it("日本語の文字認識が無い Windows・古い Mac・Linux は、それぞれ案内する", async () => {
    const fail = (code: string) => readStatement(PNG(), { kind: "card", readers: [createImageReader(async () => Promise.reject(new OcrFailure(code)))] });
    const noJa = await fail("E_OCR_NO_LANGUAGE");
    expect(noJa.ok).toBe(false);
    expect(noJa.issues[0]?.code).toBe("S_OCR_NO_LANGUAGE");
    expect(noJa.issues[0]?.message).toContain("光学式文字認識");
    expect((await fail("E_OCR_OLD_MAC")).issues[0]?.code).toBe("S_OCR_OLD_MAC");
    const linux = await fail("E_OCR_UNSUPPORTED");
    expect(linux.issues[0]?.code).toBe("S_OCR_UNSUPPORTED");
    expect(linux.issues[0]?.message).toContain("Mac と Windows");
    // 文字が1つも無い画像
    const blank = await readStatement(PNG(), { kind: "card", readers: [createImageReader(async () => ({ width: W, height: H, engine: "vision", boxes: [] }))] });
    expect(blank.issues[0]?.code).toBe("S_OCR_NO_TEXT");
  });
});

describe("画像だけの PDF・直した行・記録・確認シート", () => {
  it("文字の入った PDF の読み手が「文字が無い」と返したら、画像だけの PDF の読み手で読む（読み手が無ければ今までどおり知らせる）", async () => {
    const content = Buffer.from("q 100 0 0 100 0 0 cm Q");
    const head = "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n";
    const pdf = new Uint8Array(Buffer.concat([Buffer.from(head), Buffer.from(`4 0 obj\n<< /Length ${content.length} >>\nstream\n`), content, Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n")]));
    const without = await readStatement(pdf, { kind: "card" });
    expect(without.issues[0]?.code).toBe("S_PDF_NO_TEXT");
    let drawn = 0;
    const scan = createPdfScanReader(
      ocrOf(cardPage()),
      async (_b, max) => {
        drawn = max;
        return { pages: [PNG()], total: 31 };
      },
    );
    const out = await readStatement(pdf, { kind: "card", readers: [pdfTextReader, scan, csvReader], yearHint: 2026 });
    if (!out.ok) throw new Error(JSON.stringify(out.issues));
    expect(out.reader.id).toBe("pdfScan");
    expect(drawn).toBe(30);
    expect(out.rows).toHaveLength(CARD_ROWS.length);
    expect(out.ocr?.source).toBe("scan");
    expect(out.issues.map((i) => i.code)).toContain("S_OCR_PAGES");
  });

  it("画像の横で直した行は、今の取り込みの流れにもう一度通す（番号を消す・指紋は元の画像・確かめていない印は残す）", async () => {
    const img = PNG(7);
    const first = await readImage(cardPage(), "card", img);
    const edited = createEditedReader(first.reader, [
      { line: 4, date: "2026-10-01", merchant: "あおばマート 0000-1111-2222-3333", amount: 3280, plan: "1回払い" },
      { line: 100000, date: "2026-10-03", merchant: "足した店", amount: 500, uncertain: true },
    ]);
    const out = await readStatement(img, { kind: "card", readers: [edited] });
    if (!out.ok) throw new Error(JSON.stringify(out.issues));
    expect(out.file.sha256).toBe(first.file.sha256);
    expect(out.reader).toEqual({ id: "image", version: 1 });
    expect(out.rows.map((r) => [r.merchant, r.amount, r.readUncertain === true, r.plan?.kind])).toEqual([
      [`あおばマート ${MASK}`, 3280, false, "lump"],
      ["足した店", 500, true, undefined],
    ]);
  });

  it("読み取りが不確かの印は、世帯ファイルに残り、迷う行と確認シートに載る", async () => {
    const out = await readImage(
      page([
        { y: 140, cells: [{ t: "ご利用日", x: 40 }, { t: "ご利用店名", x: 140 }, { t: "ご利用金額", x: 760 }] },
        { y: 190, cells: [{ t: "10/01", x: 40 }, { t: "ひかりスーパー", x: 140 }, { t: "3,28O", x: 800 }] },
        { y: 234, cells: [{ t: "10/02", x: 40 }, { t: "ひかりスーパー", x: 140 }, { t: "5,412", x: 800 }] },
      ]),
      "card",
    );
    const acc: StatementAccount = { id: "a1", kind: "card", label: "カード", owner: null };
    const imp = createImport({ ...emptyLog(), accounts: [acc] }, out, { id: "i1", account: "a1", at: "2026-11-17T00:00:00+09:00" });
    if (imp === null) throw new Error("取り込めない");
    const log = readLog(JSON.parse(JSON.stringify({ ...emptyLog(), accounts: [acc], imports: [imp] })));
    expect(log.imports[0]?.rows.map((r) => r.readUncertain === true)).toEqual([true, false]);
    const review = reviewList(classify({ log, household: HOUSEHOLD, baseMonth: BASE_MONTH, office: [] }));
    const unsure = review.find((r) => r.reasons.includes("readUncertain"));
    expect(unsure?.reasonText).toContain("読み取りが不確か");
    // 店ごとにまとめず、1行ずつ載せる
    expect(planMarkSheet(review).lines.filter((l) => l.items.some((x) => x.reasons.includes("readUncertain"))).every((l) => l.kind === "row")).toBe(true);
    const sheet = await createMarkSheet({ items: review, accounts: new Map([["a1", "カード"]]), owners: new Map(), requestId: sheetRequestId(new Uint8Array([1, 2, 3, 4, 5, 6])), exportedAt: "2026-11-17T09:00:00+09:00", appVersion: "0.1.0" });
    const ws = text((await unzip(sheet.bytes)).get("xl/worksheets/sheet1.xml"));
    expect(ws).toContain(UNCERTAIN_MARK);
    expect(ws).toContain("メモの欄に正しい値を書いてください");
  });
});

// 架空の画像（statement/test/fixtures/ocr）の正解の文字の塊を、文字認識の結果として読み手に通す（文字が完全に読めたときの組み立て）
describe("架空の明細の画像の正解の文字の塊を、そのまま読む（組み立てだけの確かめ）", () => {
  const truth = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "ocr", "truth.json"), "utf8")) as {
    docs: Record<string, { kind: string; rows: { date: string; merchant: string; amount: number }[]; items: LayoutItem[] }>;
  };
  it.each(["card-web", "card-phone", "bank-scan", "card-photo", "card-small"])("%s", async (doc) => {
    const d = truth.docs[doc] as (typeof truth.docs)[string];
    const width = Math.max(...d.items.map((i) => i.x + i.width)) + 20;
    const height = Math.max(...d.items.map((i) => i.y + i.size)) + 20;
    const p: OcrPage = { width, height, engine: "vision", boxes: d.items.map((i) => ({ text: i.text, x: i.x / width, y: 1 - (i.y + i.size) / height, w: i.width / width, h: i.size / height, conf: 1 })) };
    const out = await readImage(p, d.kind === "bank" ? "bank" : "card");
    expect(out.rows.map((r) => [r.date, r.amount])).toEqual(d.rows.map((r) => [r.date, r.amount]));
  });
});
