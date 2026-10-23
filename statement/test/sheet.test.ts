// 前もってお客さまに印を付けてもらう確認シート（0034 の9）: 書き出し・読み込み・取り違えの防止・返ってきたファイルを信用しないこと
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addReceipt, addRequest, applyDecisions, classify, createMarkSheet, emptyLog, percentShare, readLog, readMarkSheet, reviewList, sheetRequestId, type MarkSheetResult, type ReadMarkSheetResult, type StatementLog } from "../src/index.ts";
import { HEADER_ROW } from "../src/sheet/layout.ts";
import { editXlsx, setCell, text, toSharedStrings, unzip } from "../../xlsx/test/helpers.ts";
import { BASE_MONTH, buildLog, HOUSEHOLD, SELF, SPOUSE } from "./helpers.ts";

const SHEET = "xl/worksheets/sheet1.xml";
const AT = "2026-10-21T09:00:00+09:00";
const RID = sheetRequestId(new Uint8Array([1, 2, 3, 4, 5, 6]));
const RID2 = sheetRequestId(new Uint8Array([9, 9, 9, 9, 9, 9]));

const classified = (log: StatementLog) => classify({ log, household: HOUSEHOLD, baseMonth: BASE_MONTH, office: [] });

async function setup(): Promise<{ log: StatementLog; sheet: MarkSheetResult }> {
  const base = await buildLog([
    { name: "card-year-utf8bom.csv", kind: "card", account: "cardA", owner: SELF, label: "ご主人のカード" },
    { name: "app-utf8bom.csv", kind: "app", account: "app", owner: SPOUSE, label: "奥様の家計簿アプリ" },
  ]);
  const items = reviewList(classified(base));
  const sheet = await createMarkSheet({
    items,
    accounts: new Map(base.accounts.map((a) => [a.id, a.label])),
    owners: new Map([
      [SELF, "ご主人"],
      [SPOUSE, "奥様"],
    ]),
    requestId: RID,
    customerNo: "A0042",
    exportedAt: AT,
    appVersion: "0.1.0",
  });
  return { log: addRequest(base, sheet.request), sheet };
}

/** シートの行（番号 no）の行番号を探す */
async function rowOf(bytes: Uint8Array, merchant: string): Promise<number> {
  const s = text((await unzip(bytes)).get(SHEET));
  const m = new RegExp(`<c r="C(\\d+)"[^>]*t="inlineStr"><is><t xml:space="preserve">${merchant}</t>`).exec(s);
  if (m === null) throw new Error(`行が無い: ${merchant}`);
  return Number(m[1]);
}

const str = (t: string) => `<c t="inlineStr"><is><t>${t}</t></is></c>`;

async function mark(bytes: Uint8Array, marks: { merchant: string; category?: string; bucket?: string; share?: string; memo?: string; amount?: string }[]): Promise<Uint8Array> {
  const rows = await Promise.all(marks.map((m) => rowOf(bytes, m.merchant)));
  return editXlsx(bytes, (files) => {
    marks.forEach((m, i) => {
      const r = rows[i] as number;
      if (m.category !== undefined) setCell(files, SHEET, `H${r}`, str(m.category));
      if (m.bucket !== undefined) setCell(files, SHEET, `I${r}`, str(m.bucket));
      if (m.share !== undefined) setCell(files, SHEET, `J${r}`, `<c><v>${m.share}</v></c>`);
      if (m.memo !== undefined) setCell(files, SHEET, `K${r}`, str(m.memo));
      if (m.amount !== undefined) setCell(files, SHEET, `D${r}`, `<c><v>${m.amount}</v></c>`);
    });
  });
}

const ok = (r: ReadMarkSheetResult) => {
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r;
};
const codes = (r: ReadMarkSheetResult) => r.issues.map((i) => i.code);

describe("書き出し", () => {
  it("迷う行だけを番号で載せ、世帯の内部ID・取り込みの ID・行の ID・カード番号を書かない", async () => {
    const { log, sheet } = await setup();
    expect(sheet.rows).toBe(4);
    expect(sheet.issues.map((i) => i.code)).toEqual(["S_SHEET_PLAINTEXT"]);
    expect(sheet.request).toMatchObject({ id: RID, at: AT, received: [] });
    expect(sheet.request.file.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(sheet.request.file.bytes).toBe(sheet.bytes.length);
    expect(sheet.request.rows.map((r) => r.no)).toEqual([1, 2, 3, 4]);
    const files = await unzip(sheet.bytes);
    const all = [...files.values()].map(text).join("\n");
    for (const needle of [SELF, SPOUSE, "imp-1", "imp-2", "cardA", "r79", "0000-1111", "1111-2222", "3333"]) expect(all, needle).not.toContain(needle);
    for (const imp of log.imports) for (const r of imp.rows) expect(all).not.toContain(`"${r.id}"`);
    // 管理の値を3か所に書く（隠したシート・文書のプロパティ・見える管理欄）
    expect(text(files.get("xl/workbook.xml"))).toContain('<sheet name="_lifeplan" sheetId="3" state="veryHidden"');
    expect(text(files.get("docProps/custom.xml"))).toContain(`name="lifeplan.requestId"><vt:lpwstr>${RID}</vt:lpwstr>`);
    const ws = text(files.get(SHEET));
    expect(ws).toContain(`<t xml:space="preserve">${RID}</t>`);
    expect(ws).toContain("<t xml:space=\"preserve\">A0042</t>");
    expect(ws).toContain(`<pane ySplit="${HEADER_ROW}"`);
    expect(ws).toContain("<sheetProtection");
  });

  it("区分の選択肢は、お使いになった方の働き方で選べるものだけ（会社員の行に事業の経費は出さない）", async () => {
    const { sheet } = await setup();
    const files = await unzip(sheet.bytes);
    const ws = text(files.get(SHEET));
    const lists = text(files.get("xl/worksheets/sheet2.xml"));
    const selfRow = await rowOf(sheet.bytes, "架空の謎の店");
    const spRow = await rowOf(sheet.bytes, "架空ブックス");
    const listOf = (r: number) => {
      const m = new RegExp(`sqref="I${r}"><formula1>'_lists'!\\$([A-Z]+)\\$1:`).exec(ws);
      if (m === null) throw new Error(`入力規則が無い: I${r}`);
      const col = m[1] as string;
      return [...lists.matchAll(new RegExp(`<c r="${col}\\d+" s="0" t="inlineStr"><is><t xml:space="preserve">([^<]+)</t>`, "g"))].map((x) => x[1]);
    };
    expect(listOf(selfRow)).toEqual(["家計（ふだんの暮らし）", "立替（会社に請求する）", "一時的な支出（旅行・冠婚葬祭など）", "除外（家計に数えない）"]);
    expect(listOf(spRow)).toEqual(["家計（ふだんの暮らし）", "事業の経費", "一時的な支出（旅行・冠婚葬祭など）", "除外（家計に数えない）"]);
    // 事業の割合の欄は、事業の経費を選べる行だけ記入できる
    expect(ws).toContain(`sqref="J${spRow}"`);
    expect(ws).not.toContain(`sqref="J${selfRow}"`);
  });

  it("同じ入力からは同じバイト列になり、迷う行が無ければ書き出さない", async () => {
    const a = await setup();
    const b = await setup();
    expect(Buffer.compare(Buffer.from(a.sheet.bytes), Buffer.from(b.sheet.bytes))).toBe(0);
    await expect(createMarkSheet({ items: [], accounts: new Map(), owners: new Map(), requestId: RID, exportedAt: AT, appVersion: "0.1.0" })).rejects.toThrow("E_STATEMENT_SHEET_EMPTY");
    await expect(createMarkSheet({ items: reviewList(classified(a.log)), accounts: new Map(), owners: new Map(), requestId: "R-ABCDEF", exportedAt: AT, appVersion: "0.1.0" })).rejects.toThrow("E_STATEMENT_SHEET_REQUEST_ID");
  });
});

describe("読み込み", () => {
  it("印はそのまま決めたことの候補になり、印の無い行は迷う行のまま残る。承認すると仕分けに入る", async () => {
    const { log, sheet } = await setup();
    const filled = await mark(sheet.bytes, [
      { merchant: "架空の謎の店", category: "教養娯楽", bucket: "家計（ふだんの暮らし）" },
      { merchant: "架空ブックス", bucket: "事業の経費", share: "60", memo: "仕事の本です。カード 4980-1234-5678-9012" },
    ]);
    const r = ok(await readMarkSheet(filled, { log, rows: classified(log) }));
    expect(r.request.id).toBe(RID);
    expect(r.unmarked).toBe(2);
    expect(r.candidates.map((c) => [c.merchant, c.decision.category, c.decision.bucket, c.decision.share, c.status])).toEqual([
      ["架空の謎の店", "recreation", "household", undefined, "pending"],
      ["架空ブックス", undefined, "business", "0.6", "pending"],
    ]);
    expect(r.candidates[1]?.memo).toBe("仕事の本です。カード ●●●●");
    expect(r.file.sha256).not.toBe(sheet.request.file.sha256);
    const next = applyDecisions(log, r.candidates.map((c) => c.decision), "2026-10-22T10:00:00+09:00");
    const left = reviewList(classified(next)).map((x) => x.merchant);
    expect(left).not.toContain("架空の謎の店");
    expect(left).not.toContain("架空ブックス");
    expect(left).toContain("架空リボショップ");
    // 取り込んだ記録を残すと、同じファイルは2回取り込まない
    const done = addReceipt(next, RID, { at: "2026-10-22T10:00:00+09:00", file: r.file, decided: 2 });
    const again = await readMarkSheet(filled, { log: done, rows: classified(done) });
    expect(again.ok).toBe(false);
    expect(codes(again)).toContain("S_SHEET_ALREADY");
  });

  it("別の世帯・記録の無い依頼のファイルは止める。古い依頼のファイルは知らせる", async () => {
    const { log, sheet } = await setup();
    const other = await readMarkSheet(sheet.bytes, { log: { ...log, requests: [] }, rows: classified(log) });
    expect(other.ok).toBe(false);
    expect(codes(other)).toEqual(["S_SHEET_OTHER_HOUSEHOLD"]);
    const newer = addRequest(log, { id: RID2, at: "2026-10-22T09:00:00+09:00", file: { sha256: `sha256:${"a".repeat(64)}`, bytes: 1 }, rows: [], received: [] });
    const old = ok(await readMarkSheet(sheet.bytes, { log: newer, rows: classified(newer) }));
    expect(codes(old)).toContain("S_SHEET_OLD_REQUEST");
    expect(codes(old)).toContain("S_SHEET_UNCHANGED");
    expect(codes(old)).toContain("S_SHEET_NO_MARKS");
  });

  it("管理の値が食い違えば止め、一部が無くなっても残りで読む（別のソフトで保存し直した形も読む）", async () => {
    const { log, sheet } = await setup();
    const changed = await editXlsx(sheet.bytes, (f) => setCell(f, SHEET, "C3", str(RID2)));
    const r = await readMarkSheet(changed, { log, rows: classified(log) });
    expect(r.ok).toBe(false);
    expect(codes(r)).toEqual(["S_SHEET_MANAGE_MISMATCH"]);
    const filled = await mark(sheet.bytes, [{ merchant: "架空の謎の店", category: "食費" }]);
    const resaved = await editXlsx(filled, (f) => {
      toSharedStrings(f);
      f.delete("docProps/custom.xml");
    });
    const r2 = ok(await readMarkSheet(resaved, { log, rows: classified(log) }));
    expect(codes(r2)).toContain("S_SHEET_PARTLY_LOST");
    expect(r2.candidates.map((c) => c.decision.category)).toEqual(["food"]);
  });

  it("使った日・金額が書き出した行と合わない行・選択肢に無い言葉の行は読まず、迷う行のまま残す", async () => {
    const { log, sheet } = await setup();
    const filled = await mark(sheet.bytes, [
      { merchant: "架空の謎の店", category: "食費", amount: "999" },
      { merchant: "架空リボショップ", category: "なにか" },
      { merchant: "架空ブックス", bucket: "事業の経費" },
    ]);
    const r = ok(await readMarkSheet(filled, { log, rows: classified(log) }));
    expect(codes(r)).toContain("S_SHEET_ROW_CHANGED");
    expect(codes(r)).toContain("S_SHEET_VALUE");
    // 事業の経費で割合が無ければ 100% にして要確認
    expect(r.candidates.map((c) => [c.merchant, c.decision.share, c.status])).toEqual([["架空ブックス", "1", "needsReview"]]);
    expect(r.candidates[0]?.notes.join("")).toContain("100%");
  });

  it("働き方で選べない区分は入れない（項目があれば項目だけを要確認で、無ければ読まない）", async () => {
    const { log, sheet } = await setup();
    const filled = await mark(sheet.bytes, [
      { merchant: "架空の謎の店", category: "食費", bucket: "事業の経費", share: "50" },
      { merchant: "架空リボショップ", bucket: "会社の経費" },
    ]);
    const r = ok(await readMarkSheet(filled, { log, rows: classified(log) }));
    expect(r.candidates.map((c) => [c.merchant, c.decision.category, c.decision.bucket, c.status])).toEqual([["架空の謎の店", "food", undefined, "needsReview"]]);
    expect(codes(r).filter((c) => c === "S_SHEET_VALUE")).toHaveLength(1);
  });

  it("書き出した後に FP が決めた行は要確認にする", async () => {
    const { log, sheet } = await setup();
    const row = reviewList(classified(log)).find((x) => x.merchant === "架空の謎の店");
    const decided = applyDecisions(log, [{ importId: row?.importId as string, rowId: row?.rowId as string, category: "food" }], "2026-10-21T12:00:00+09:00");
    const filled = await mark(sheet.bytes, [{ merchant: "架空の謎の店", category: "教養娯楽" }]);
    const r = ok(await readMarkSheet(filled, { log: decided, rows: classified(decided) }));
    expect(r.candidates[0]?.status).toBe("needsReview");
  });

  it("ヒアリングシート・表計算のファイルでないものは読まない", async () => {
    const { log } = await setup();
    const hearing = new Uint8Array(readFileSync(join(import.meta.dirname, "..", "..", "hearing", "samples", "basic-1-sample.xlsx")));
    expect(codes(await readMarkSheet(hearing, { log, rows: [] }))).toEqual(["S_SHEET_HEARING"]);
    expect(codes(await readMarkSheet(new TextEncoder().encode("a,b\n"), { log, rows: [] }))).toEqual(["S_SHEET_FILE"]);
  });

  it("割合の読み方", () => {
    expect(percentShare("60")).toBe("0.6");
    expect(percentShare("６０％")).toBe("0.6");
    expect(percentShare("100")).toBe("1");
    expect(percentShare("12.5")).toBe("0.125");
    expect(percentShare("0")).toBeNull();
    expect(percentShare("120")).toBeNull();
    expect(percentShare("半分")).toBeNull();
  });
});

describe("依頼の記録（区画 statements の requests）", () => {
  it("読み戻すと同じになり、形の合わないものは捨てる", async () => {
    const { log } = await setup();
    const withReceipt = addReceipt(log, RID, { at: "2026-10-22T10:00:00+09:00", file: { sha256: `sha256:${"b".repeat(64)}`, bytes: 10 }, decided: 1 });
    expect(readLog(JSON.parse(JSON.stringify(withReceipt)))).toEqual(withReceipt);
    const odd = JSON.parse(JSON.stringify(withReceipt)) as { requests: unknown[] };
    odd.requests.push({ id: "R-ABCDEF", at: "x", file: { sha256: "sha256:00", bytes: 1 }, rows: [] }, { id: RID2, at: "x", file: { sha256: `sha256:${"c".repeat(64)}`, bytes: 1 }, rows: [{ no: 0, import: "i", row: "r" }, { no: 1, import: "i", row: "r" }, { no: 1, import: "i", row: "r2" }], received: [{ at: "x", file: null, decided: 1 }] });
    const back = readLog(odd);
    expect(back.requests?.map((r) => r.id)).toEqual([RID, RID2]);
    expect(back.requests?.[1]?.rows).toEqual([{ no: 1, import: "i", row: "r" }]);
    expect(back.requests?.[1]?.received).toEqual([]);
    expect(readLog(emptyLog()).requests).toBeUndefined();
  });

  it("依頼の記録は新しい20件まで", () => {
    let log = emptyLog();
    for (let i = 0; i < 25; i++) log = addRequest(log, { id: sheetRequestId(new Uint8Array([i, i, i, i, i, i])), at: `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00+09:00`, file: { sha256: `sha256:${"d".repeat(64)}`, bytes: 1 }, rows: [], received: [] });
    expect(log.requests).toHaveLength(20);
  });
});
