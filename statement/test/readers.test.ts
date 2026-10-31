import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createImport, csvReader, emptyLog, guessMapping, maskCell, maskText, MASK, readLog, readStatement, suggestYear, type StatementReader } from "../src/index.ts";
import { fixture, read } from "./helpers.ts";

const ALL: [string, "card" | "bank" | "app"][] = [
  ["card-year-utf8bom.csv", "card"],
  ["card-sjis-2026-05.csv", "card"],
  ["card-sjis-2026-06.csv", "card"],
  ["bank-utf8.csv", "bank"],
  ["app-utf8bom.csv", "app"],
  ["card-noheader.tsv", "card"],
  ["card-statement.pdf", "card"],
  ["card-lines.pdf", "card"],
];

/** 架空の明細に入れた番号（どれも結果に残ってはいけない） */
const NUMBERS = ["0000-1111-2222-3333", "0000111122223333", "1111", "2222", "3333", "4444", "0009876543", "9876543", "1234567"];

describe("カード番号・口座番号らしき数字を読んだ時点で消す", () => {
  it.each([
    ["カード番号 0000-1111-2222-3333", `カード番号 ${MASK}`],
    ["0000 1111 2222 3333", MASK],
    ["4980-12**-****-7890", MASK],
    ["XXXX-XXXX-XXXX-1234", MASK],
    ["口座番号：1234567", `口座番号 ${MASK}`],
    ["お客様番号 0009876543", `お客様番号 ${MASK}`],
    ["普通 1234567", `普通 ${MASK}`],
    ["電話 03-1234-5678", `電話 ${MASK}`],
    ["ｾﾌﾞﾝｲﾚﾌﾞﾝ 店番号123", "セブンイレブン 店番号123"],
  ])("%s", (raw, want) => expect(maskText(raw).text).toBe(want));

  it("日付・金額として読める欄はそのまま（10桁以上の数は金額として読まない）", () => {
    expect(maskCell("20261003")).toEqual({ text: "20261003", masked: false });
    expect(maskCell("1,234,567")).toEqual({ text: "1,234,567", masked: false });
    expect(maskCell("123456789")).toEqual({ text: "123456789", masked: false });
    expect(maskCell("0000111122223333").text).toBe(MASK);
  });

  it.each(ALL)("%s の読んだ結果・取り込みの記録・保存の形に番号が残らない", async (name, kind) => {
    const out = await read(name, kind, { yearHint: 2026 });
    const imp = createImport(emptyLog(), out, { id: "i", account: "a", at: "2026-10-20T10:00:00+09:00" });
    const log = { ...emptyLog(), accounts: [{ id: "a", kind, label: "テスト", owner: null }], imports: imp === null ? [] : [imp] };
    for (const text of [JSON.stringify(out), JSON.stringify(log), JSON.stringify(readLog(JSON.parse(JSON.stringify(log))))]) {
      for (const n of NUMBERS) expect(text).not.toContain(n);
    }
  });

  it("番号を消したことを知らせる", async () => {
    const out = await read("card-year-utf8bom.csv", "card");
    expect(out.issues.find((i) => i.code === "S_MASKED")?.message).toMatch(/2 か所/u);
  });

  it("見出しが口座番号の列・全部の行が同じ7桁以上の数字の列は、列ごと消す", async () => {
    const csv = "日付,摘要,金額,口座\n2026/09/01,架空商店,100,7654321\n2026/09/02,架空商店,200,7654321\n";
    const out = await readStatement(new TextEncoder().encode(csv), { kind: "bank" });
    expect(JSON.stringify(out)).not.toContain("7654321");
    const csv2 = "2026/09/01\t架空商店\t100\t7654321\n2026/09/02\t架空商店\t200\t7654321\n";
    const out2 = await readStatement(new TextEncoder().encode(csv2), { kind: "card" });
    expect(JSON.stringify(out2)).not.toContain("7654321");
  });

  it("元のファイルは返さず、指紋と大きさだけを返す", async () => {
    const bytes = fixture("bank-utf8.csv");
    const out = await read("bank-utf8.csv", "bank");
    expect(out.file.bytes).toBe(bytes.length);
    expect(out.file.sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(Object.keys(out)).not.toContain("bytes");
  });

  it("振込の相手の名前は残さない", async () => {
    const out = await read("bank-utf8.csv", "bank");
    expect(JSON.stringify(out.rows)).not.toContain("ヤマダ");
    expect(out.rows.some((r) => r.merchant === "振込（相手の名前は残しません）")).toBe(true);
  });
});

describe("文字コードと列の対応付け", () => {
  it("UTF-8（BOM つき）のカードの明細: 案内の行の後の見出しを見つけ、合計の行を飛ばす", async () => {
    const out = await read("card-year-utf8bom.csv", "card");
    expect(out.encoding).toBe("utf-8-bom");
    expect(out.mapping.headerRow).toBe(3);
    expect(out.mapping.columns).toMatchObject({ date: 0, merchant: 1, user: 2, plan: 3, amount: 4, payAmount: 5, payMonth: 6 });
    expect(out.mappingSource).toBe("guessed");
    expect(out.needsMapping).toBe(true);
    expect(out.rows).toHaveLength(81);
    expect(out.skipped).toBe(1);
    const tv = out.rows.find((r) => r.merchant.startsWith("ヤマダデンキ"));
    expect(tv).toMatchObject({ date: "2026-01-15", amount: 90000, payAmount: 30000, payMonth: "2026-02", plan: { kind: "installment", count: 3 } });
    expect(out.rows.find((r) => r.amount < 0)).toMatchObject({ merchant: "ユニクロ 架空店", amount: -5990 });
    expect(out.rows.filter((r) => r.cardUser === "family")).toHaveLength(12);
  });

  // 年の書かれていない日付だけの CSV は、案内が「年を選んで」なのに、年を選ぶ手がかりを返していなかった
  it("年の書かれていない日付だけの明細: 行の数・いちばん新しい月日・推定の年を返し、選んだ年で読む", async () => {
    const csv = new TextEncoder().encode("利用日,利用店名,利用金額\n10/03,架空スーパー,1200\n10/05,架空コンビニ,500\n");
    const none = await readStatement(csv, { kind: "card", fileName: "a.csv", today: "2026-10-31" });
    if (!none.ok) throw new Error("読めない");
    expect(none.rows).toEqual([]);
    expect(none.yearless).toEqual({ rows: 2, end: "10-05", suggested: 2026 });
    expect(none.issues.map((i) => i.code)).toContain("S_ROW_YEAR");
    const picked = await readStatement(csv, { kind: "card", fileName: "a.csv", today: "2026-10-31", yearHint: 2025 });
    if (!picked.ok) throw new Error("読めない");
    expect(picked.rows.map((r) => [r.date, r.yearGuessed])).toEqual([
      ["2025-10-03", true],
      ["2025-10-05", true],
    ]);
    expect(picked.yearless).toEqual({ rows: 2, end: "10-05", suggested: 2026, year: 2025 });
    // 今日より後の月日は前の年と推し量る
    expect((await readStatement(csv, { kind: "card", fileName: "a.csv", today: "2026-10-04" })).ok && suggestYear("10-05", "2026-10-04")).toBe(2025);
  });

  it("年の書かれていない明細が年をまたぐとき（11月〜2月）は、選んだ年をいちばん新しい月日の年にし、それより後の月日を前の年にする", async () => {
    const csv = new TextEncoder().encode("利用日,利用店名,利用金額\n11/05,架空スーパー,1200\n12/20,架空コンビニ,500\n01/03,架空書店,800\n02/10,架空薬局,300\n");
    const out = await readStatement(csv, { kind: "card", fileName: "a.csv", today: "2026-10-31", yearHint: 2026 });
    if (!out.ok) throw new Error("読めない");
    expect(out.yearless).toMatchObject({ end: "02-10", suggested: 2026 });
    expect(out.rows.map((r) => r.date)).toEqual(["2025-11-05", "2025-12-20", "2026-01-03", "2026-02-10"]);
    expect(suggestYear("02-10", "2026-01-31")).toBe(2025);
  });

  it("年つきの日付のある明細・明細の見出しに年のある PDF は、年を選ばない", async () => {
    const out = await read("card-year-utf8bom.csv", "card");
    expect(out.yearless).toBeUndefined();
    const pdf = await read("card-statement.pdf", "card");
    expect(pdf.yearless).toBeUndefined();
  });

  it("Shift_JIS・半角カナ・「円」つきの金額・何回目の列", async () => {
    const out = await read("card-sjis-2026-05.csv", "card");
    expect(out.encoding).toBe("shift_jis");
    expect(out.rows[0]).toMatchObject({ merchant: "カクウデンキ ホンテン", amount: 60000, payAmount: 20000, plan: { kind: "installment", count: 3, index: 2 } });
    expect(out.rows[1]).toMatchObject({ merchant: "セブンイレブン カクウエキマエテン", amount: 540 });
  });

  it("銀行の明細は出金・入金の2列（入金は負）", async () => {
    const out = await read("bank-utf8.csv", "bank");
    expect(out.mapping.columns).toMatchObject({ date: 0, merchant: 1, withdrawal: 2, deposit: 3 });
    expect(out.rows.find((r) => r.merchant.startsWith("給与"))?.amount).toBe(-320000);
    expect(out.rows.find((r) => r.merchant.startsWith("家賃"))?.amount).toBe(95000);
  });

  it("家計簿アプリの明細は支出が負の向きを見分け、分類・振替の印を読む", async () => {
    const out = await read("app-utf8bom.csv", "app");
    expect(out.mapping.sign).toBe("expenseNegative");
    expect(out.rows[0]).toMatchObject({ merchant: "架空マルシェ", amount: 3200, sourceCategory: "食費" });
    expect(out.rows.find((r) => r.transfer === true)?.merchant).toBe("口座振替(架空カード)");
    expect(out.rows.find((r) => r.sourceCategory === "収入")?.amount).toBe(-280000);
  });

  it("見出しの無い表は欄の形から推し量る", async () => {
    const out = await read("card-noheader.tsv", "card");
    expect(out.mapping).toEqual({ headerRow: null, columns: { date: 0, merchant: 1, amount: 2 }, sign: "expensePositive" });
    expect(out.rows.map((r) => r.amount)).toEqual([498, 880, 12900]);
  });

  it("FP が選んだ対応付けを見出しの並びの指紋で覚え、次から使う", async () => {
    const first = await read("card-sjis-2026-05.csv", "card");
    const second = await read("card-sjis-2026-06.csv", "card", { formats: [{ fingerprint: first.fingerprint, kind: "card", mapping: first.mapping, at: "2026-10-20T10:00:00+09:00" }] });
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.mappingSource).toBe("learned");
    expect(second.needsMapping).toBe(false);
    // 別の種類（銀行）として読むときは使わない
    const other = await read("card-sjis-2026-06.csv", "bank", { formats: [{ fingerprint: first.fingerprint, kind: "card", mapping: first.mapping, at: "2026-10-20T10:00:00+09:00" }] });
    expect(other.mappingSource).toBe("guessed");
  });

  it("FP が選び直した対応付けで読み直す（店の名前に備考の列を選ぶ）", async () => {
    const first = await read("card-sjis-2026-05.csv", "card");
    const out = await read("card-sjis-2026-05.csv", "card", { mapping: { ...first.mapping, columns: { ...first.mapping.columns, merchant: 6, memo: 1 } } });
    expect(out.mappingSource).toBe("fp");
    expect(out.rows[0]?.memo).toBe("カクウデンキ ホンテン");
  });

  it("足りない対応付けは読まずに直してもらう", async () => {
    const r = await readStatement(fixture("card-sjis-2026-05.csv"), { kind: "card", mapping: { headerRow: 0, columns: { date: 0, amount: 2 }, sign: "expensePositive" } });
    expect(r.ok && r.needsMapping).toBe(true);
    expect(r.ok && r.rows).toEqual([]);
    expect(r.issues.some((i) => i.code === "S_MAPPING_INVALID")).toBe(true);
    const dup = await readStatement(fixture("card-sjis-2026-05.csv"), { kind: "card", mapping: { headerRow: 0, columns: { date: 0, merchant: 0, amount: 2 }, sign: "expensePositive" } });
    expect(dup.issues.some((i) => /同じ列/u.test(i.message))).toBe(true);
  });

  it("UTF-16（BOM つき）の CSV も読む", async () => {
    const text = "利用日,利用店名,利用金額\n2026/09/01,架空商店,1,200\n";
    const le = new Uint8Array(2 + text.length * 2);
    le.set([0xff, 0xfe]);
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      le[2 + i * 2] = c & 0xff;
      le[3 + i * 2] = c >> 8;
    }
    const r = await readStatement(le, { kind: "card" });
    expect(r.ok && r.encoding).toBe("utf-16le");
    expect(r.ok && r.rows[0]?.merchant).toBe("架空商店");
  });

  it("年の無い日付は、年を決められなければ知らせる", async () => {
    const csv = "利用日,利用店名,利用金額\n10/03,架空商店,100\n";
    const r = await readStatement(new TextEncoder().encode(csv), { kind: "card" });
    expect(r.issues.some((i) => i.code === "S_ROW_YEAR")).toBe(true);
    const ok = await readStatement(new TextEncoder().encode(csv), { kind: "card", yearHint: 2026 });
    expect(ok.ok && ok.rows[0]?.date).toBe("2026-10-03");
  });

  it("ファイルの大きさ・空・形の分からないファイル", async () => {
    expect((await readStatement(new Uint8Array(0), { kind: "card" })).issues[0]?.code).toBe("S_FILE_EMPTY");
    expect((await readStatement(new Uint8Array(10 * 1024 * 1024 + 1), { kind: "card" })).issues[0]?.code).toBe("S_FILE_TOO_LARGE");
    expect((await readStatement(Uint8Array.of(0x50, 0x4b, 3, 4, 0, 1), { kind: "card" })).issues[0]?.code).toBe("S_FORMAT_UNKNOWN");
  });

  it("読み手を差し替えられる（段階2・3の読み手を足す形）", async () => {
    const fake: StatementReader = {
      id: "fakeOcr",
      version: 1,
      label: "架空の読み手",
      accepts: (b) => (b[0] === 0x89 ? 1 : 0),
      table: async () => ({ table: { cells: [["日付", "内容", "金額"], ["2026/09/01", "架空商店 0000111122223333", "100"]], lines: [1, 2], masked: 0 }, issues: [] }),
    };
    const r = await readStatement(Uint8Array.of(0x89, 1, 2), { kind: "card", readers: [fake, csvReader] });
    expect(r.ok && r.reader).toEqual({ id: "fakeOcr", version: 1 });
    expect(r.ok && r.rows[0]?.merchant).toBe("架空商店 0000111122223333".replace("0000111122223333", MASK).trim());
  });

  it("対応付けの推し量りの単体", () => {
    const m = guessMapping({ cells: [["取引日", "お取引内容", "出金金額", "入金金額", "残高"], ["2026/09/01", "架空", "100", "", "900"]], lines: [1, 2], masked: 0 }, "bank");
    expect(m.columns).toEqual({ date: 0, merchant: 1, withdrawal: 2, deposit: 3 });
  });
});

describe("PDF（文字の入ったもの）", () => {
  it("見出しのある明細の PDF（圧縮・オブジェクトストリーム・Type0 フォントと ToUnicode）", async () => {
    const out = await read("card-statement.pdf", "card");
    expect(out.reader.id).toBe("pdfText");
    expect(out.rows.map((r) => [r.date, r.merchant, r.amount])).toEqual([
      ["2026-09-02", "ファミリーマート 架空店", 756],
      ["2026-09-06", "ガスト 架空店", 2849],
      ["2026-09-14", "ソフトバンク", 6578],
      ["2026-09-21", "ENEOS 架空SS", 5400],
      ["2026-09-27", "架空ホテル 湖畔", 48000],
    ]);
    expect(out.skipped).toBe(1);
  });

  it("見出しの無い PDF は「日付…金額」の行を読み、明細の日付で年を補う（1月の明細の12月の利用は前の年）", async () => {
    const out = await read("card-lines.pdf", "card");
    expect(out.mappingSource).toBe("reader");
    expect(out.rows.map((r) => [r.date, r.merchant, r.amount, r.plan?.kind ?? null])).toEqual([
      ["2025-12-03", "ローソン 架空店", 620, "lump"],
      ["2025-12-15", "楽天モバイル", 3278, null],
      ["2025-12-30", "架空スポーツクラブ", 33000, "installment"],
    ]);
  });

  it("パスワードのかかった PDF は読まない", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R /Encrypt 3 0 R >>\n%%EOF\n");
    const r = await readStatement(pdf, { kind: "card" });
    expect(r.ok).toBe(false);
    expect(r.issues[0]?.code).toBe("S_PDF_ENCRYPTED");
  });

  it("文字の入っていない PDF は、写真の読み取りは後の版と知らせる", async () => {
    const content = deflateSync(Buffer.from("q 100 0 0 100 0 0 cm Q\n"));
    const head = "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n";
    const pdf = Buffer.concat([Buffer.from(head), Buffer.from(`4 0 obj\n<< /Filter /FlateDecode /Length ${content.length} >>\nstream\n`), content, Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n")]);
    const r = await readStatement(new Uint8Array(pdf), { kind: "card" });
    expect(r.issues[0]?.code).toBe("S_PDF_NO_TEXT");
  });

  it("壊れた PDF", async () => {
    const r = await readStatement(new TextEncoder().encode("%PDF-1.7\n garbage"), { kind: "card" });
    expect(r.ok).toBe(false);
    expect(["S_PDF_BROKEN", "S_PDF_NO_TEXT"]).toContain(r.issues[0]?.code);
  });
});
