// 前もってお客さまに印を付けてもらう確認シート（0034 の9）: 書き出し・読み込み・取り違えの防止・返ってきたファイルを信用しないこと
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addReceipt,
  addRequest,
  applyDecisions,
  classify,
  createMarkSheet,
  emptyLog,
  markSheetWarnings,
  merchantKey,
  percentShare,
  planMarkSheet,
  readLog,
  readMarkSheet,
  reviewList,
  sheetRequestId,
  type MarkSheetResult,
  type ReadMarkSheetResult,
  type StatementAccount,
  type StatementLog,
  type StatementRow,
} from "../src/index.ts";
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
    { name: "card-year-utf8bom.csv", kind: "card", account: "cardA", owner: SELF, label: "ご本人のカード" },
    { name: "app-utf8bom.csv", kind: "app", account: "app", owner: SPOUSE, label: "配偶者の家計簿アプリ" },
  ]);
  const items = reviewList(classified(base));
  const sheet = await createMarkSheet({
    items,
    accounts: new Map(base.accounts.map((a) => [a.id, a.label])),
    owners: new Map([
      [SELF, "ご本人"],
      [SPOUSE, "配偶者"],
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

  it("顧客番号は世帯の保存と同じ決まり（英数字・ハイフン・下線の16字まで）で書く。決まりに合わないもの（氏名など）は書かない", async () => {
    const { log } = await setup();
    const items = reviewList(classified(log));
    const make = (customerNo: string) => createMarkSheet({ items, accounts: new Map(log.accounts.map((a) => [a.id, a.label])), owners: new Map([[SELF, "ご本人"]]), requestId: RID2, customerNo, exportedAt: AT, appVersion: "0.1.0" });
    const files = await unzip((await make("A_0042")).bytes);
    expect(text(files.get(SHEET))).toContain('<t xml:space="preserve">A_0042</t>');
    expect(text(files.get("docProps/custom.xml"))).toContain('name="lifeplan.customerNo"><vt:lpwstr>A_0042</vt:lpwstr>');
    expect(text(files.get("xl/worksheets/sheet3.xml"))).toContain('<t xml:space="preserve">A_0042</t>');
    const other = await unzip((await make("山田")).bytes);
    expect(text(other.get("docProps/custom.xml"))).toContain('name="lifeplan.customerNo"><vt:lpwstr></vt:lpwstr>');
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
    expect(listOf(selfRow)).toEqual(["家計（ふだんの暮らし）", "立替（会社に請求する）", "一時的支出（旅行・冠婚葬祭など）", "除外（家計に数えない）"]);
    expect(listOf(spRow)).toEqual(["家計（ふだんの暮らし）", "事業の経費", "一時的支出（旅行・冠婚葬祭など）", "除外（家計に数えない）"]);
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
    expect(r.candidates.map((c) => [c.merchant, c.mark.category, c.mark.bucket, c.mark.share, c.status])).toEqual([
      ["架空の謎の店", "recreation", "household", undefined, "pending"],
      ["架空ブックス", undefined, "business", "0.6", "pending"],
    ]);
    expect(r.candidates[1]?.memo).toBe("仕事の本です。カード ●●●●");
    expect(r.file.sha256).not.toBe(sheet.request.file.sha256);
    const next = applyDecisions(log, r.candidates.flatMap((c) => c.decisions), "2026-10-22T10:00:00+09:00");
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
    expect(r2.candidates.map((c) => c.mark.category)).toEqual(["food"]);
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
    expect(r.candidates.map((c) => [c.merchant, c.mark.share, c.status])).toEqual([["架空ブックス", "1", "needsReview"]]);
    expect(r.candidates[0]?.notes.join("")).toContain("100%");
  });

  it("働き方で選べない区分は入れない（項目があれば項目だけを要確認で、無ければ読まない）", async () => {
    const { log, sheet } = await setup();
    const filled = await mark(sheet.bytes, [
      { merchant: "架空の謎の店", category: "食費", bucket: "事業の経費", share: "50" },
      { merchant: "架空リボショップ", bucket: "会社の経費" },
    ]);
    const r = ok(await readMarkSheet(filled, { log, rows: classified(log) }));
    expect(r.candidates.map((c) => [c.merchant, c.mark.category, c.mark.bucket, c.status])).toEqual([["架空の謎の店", "food", undefined, "needsReview"]]);
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
    odd.requests.push(
      { id: "R-ABCDEF", at: "x", file: { sha256: "sha256:00", bytes: 1 }, rows: [] },
      { id: RID2, at: "x", file: { sha256: `sha256:${"c".repeat(64)}`, bytes: 1 }, rows: [{ no: 0, import: "i", row: "r" }, { no: 1, import: "i", row: "r" }, { no: 1, import: "i", row: "r2" }, { no: 2, import: "i", row: "r" }, { no: 501, import: "i", row: "r3" }], received: [{ at: "x", file: null, decided: 1 }] },
    );
    const back = readLog(odd);
    expect(back.requests?.map((r) => r.id)).toEqual([RID, RID2]);
    // 同じ番号に複数の行は店ごとにまとめた行（形式 0.16 から）。同じ行の2つ目・番号の上限を超えたものは捨てる
    expect(back.requests?.[1]?.rows).toEqual([
      { no: 1, import: "i", row: "r" },
      { no: 1, import: "i", row: "r2" },
    ]);
    expect(back.requests?.[1]?.received).toEqual([]);
    expect(readLog(emptyLog()).requests).toBeUndefined();
  });

  it("依頼の記録は新しい20件まで", () => {
    let log = emptyLog();
    for (let i = 0; i < 25; i++) log = addRequest(log, { id: sheetRequestId(new Uint8Array([i, i, i, i, i, i])), at: `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00+09:00`, file: { sha256: `sha256:${"d".repeat(64)}`, bytes: 1 }, rows: [], received: [] });
    expect(log.requests).toHaveLength(20);
  });
});

// ---- 店ごとにまとめる（辞書で分からない毎月の店などを1行にして、お客さまが同じ答えを何度も選ばなくてよいように） ----

type RowIn = Partial<StatementRow> & { date: string; merchant: string; amount: number };

/** 架空の行から記録を作る（口座ごとに1つの取り込み） */
function synth(accounts: (StatementAccount & { rows: RowIn[] })[]): StatementLog {
  return {
    ...emptyLog(),
    accounts: accounts.map(({ rows, ...a }) => (void rows, a)),
    imports: accounts.map((a, k) => {
      const rows: StatementRow[] = a.rows.map((r, i) => ({ line: i + 1, id: `r${i + 1}`, key: merchantKey(r.merchant), ...r }));
      return {
        id: `imp-${a.id}`,
        kind: "statement" as const,
        at: `2026-10-20T10:00:0${k}+09:00`,
        account: a.id,
        file: { sha256: `sha256:${a.id}`, bytes: 1 },
        reader: { id: "csv", version: 1 },
        format: { fingerprint: "sha256:f", mapping: { headerRow: 0, columns: { date: 0, merchant: 1, amount: 2 }, sign: "expensePositive" as const }, source: "fp" as const },
        period: { from: "2025-10-01", to: "2026-09-30" },
        rows,
        include: true,
      };
    }),
  };
}

const months = (merchant: string, amount: (i: number) => number, n = 12, day = 10): RowIn[] =>
  Array.from({ length: n }, (_, i) => ({ date: `${2025 + Math.floor((9 + i) / 12)}-${String(((9 + i) % 12) + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`, merchant, amount: amount(i) }));

function shopLog(): StatementLog {
  return synth([
    {
      id: "cardA",
      kind: "card",
      label: "ご本人のカード",
      owner: SELF,
      rows: [
        ...months("架空モバイル通信", () => 3300),
        ...months("架空の謎の工房", (i) => 2000 + i * 100, 2, 15),
        { date: "2026-03-20", merchant: "架空の謎の工房", amount: 150000 },
        { date: "2026-04-01", merchant: "架空の一度きりの店", amount: 4800 },
      ],
    },
    { id: "cardB", kind: "card", label: "配偶者のカード", owner: SPOUSE, rows: [...months("架空モバイル通信", () => 2200, 2), ...months("架空の携帯電話料", () => 6000, 3, 25)] },
  ]);
}

async function shopSheet() {
  const base = shopLog();
  const items = reviewList(classified(base));
  const sheet = await createMarkSheet({
    items,
    accounts: new Map(base.accounts.map((a) => [a.id, a.label])),
    owners: new Map([
      [SELF, "ご本人"],
      [SPOUSE, "配偶者"],
    ]),
    requestId: RID,
    exportedAt: AT,
    appVersion: "0.1.0",
  });
  return { log: addRequest(base, sheet.request), items, sheet };
}

/** シートの行（店の名前の欄が merchant で始まる行）の行番号 */
async function lineOf(bytes: Uint8Array, merchant: string): Promise<number> {
  const s = text((await unzip(bytes)).get(SHEET));
  const m = new RegExp(`<c r="C(\\d+)"[^>]*t="inlineStr"><is><t xml:space="preserve">${merchant}`).exec(s);
  if (m === null) throw new Error(`行が無い: ${merchant}`);
  return Number(m[1]);
}

const cellText = (ws: string, ref: string) => new RegExp(`<c r="${ref}"[^>]*>(?:<is><t xml:space="preserve">([^<]*)</t></is>|<v>([^<]*)</v>)`).exec(ws)?.slice(1).find((x) => x !== undefined);

describe("店ごとにまとめる", () => {
  it("店単位で答えられる同じ店の行（同じ持ち主・同じカード）は1行に、1件ずつ判断が要る行と1回だけの店は1行ずつ", async () => {
    const { items } = await shopSheet();
    const plan = planMarkSheet(items);
    const view = plan.lines.map((l) => [l.items[0]?.merchant, l.items[0]?.account, l.kind, l.items.length, l.total]);
    expect(view).toEqual(
      expect.arrayContaining([
        ["架空モバイル通信", "cardA", "shop", 12, 39600],
        ["架空モバイル通信", "cardB", "shop", 2, 4400],
        ["架空の謎の工房", "cardA", "shop", 2, 4100],
        ["架空の謎の工房", "cardA", "row", 1, 150000],
        ["架空の一度きりの店", "cardA", "row", 1, 4800],
        // 区分だけが迷う行（店は分かるが、個人事業主の通信が事業の分か）も店ごとに
        ["架空の携帯電話料", "cardB", "shop", 3, 18000],
      ]),
    );
    expect(plan.lines).toHaveLength(6);
    expect(plan).toMatchObject({ items: 21, shops: 4, grouped: 19, overflow: 0 });
    // 高額の行は重いので先に載る
    expect(plan.lines[0]?.total).toBe(150000);
    expect(markSheetWarnings(items).map((i) => i.code)).toEqual(["S_SHEET_PLAINTEXT", "S_SHEET_GROUPED"]);
  });

  it("まとめた行は、ご利用日の欄に期間と回数、金額の欄に合計、店の名前の下に1回あたりの目安。依頼の記録は同じ番号に行の数だけ", async () => {
    const { sheet } = await shopSheet();
    expect(sheet.rows).toBe(6);
    expect(sheet.entries).toBe(21);
    const ws = text((await unzip(sheet.bytes)).get(SHEET));
    const r = await lineOf(sheet.bytes, "架空モバイル通信");
    expect(cellText(ws, `B${r}`)).toBe("2025/10/10〜2026/09/10\n12回");
    expect(cellText(ws, `D${r}`)).toBe("39600");
    expect(cellText(ws, `C${r}`)).toBe("架空モバイル通信\n毎回 3,300円");
    const k = await lineOf(sheet.bytes, "架空の謎の工房\n");
    expect(cellText(ws, `C${k}`)).toBe("架空の謎の工房\n1回あたり 約2,050円");
    const no = Number(cellText(ws, `A${r}`));
    expect(sheet.request.rows.filter((x) => x.no === no)).toHaveLength(12);
    expect(sheet.request.rows).toHaveLength(21);
    expect(new Set(sheet.request.rows.map((x) => x.no)).size).toBe(6);
    expect(ws).toContain("同じお店を何度もお使いの分は、1行にまとめています");
    // 並び: カード・口座ごとに、まとめた店 → 1行ずつの行
    const merchants = [...ws.matchAll(/<c r="C(\d+)"[^>]*t="inlineStr"><is><t xml:space="preserve">([^<\n]*)/g)].filter((m) => Number(m[1]) > HEADER_ROW).map((m) => m[2]);
    expect(merchants).toEqual(["架空モバイル通信", "架空の謎の工房", "架空の謎の工房", "架空の一度きりの店", "架空モバイル通信", "架空の携帯電話料"]);
    // 依頼の記録は形を確かめて読み戻せる
    expect(readLog(JSON.parse(JSON.stringify(addRequest(emptyLog(), sheet.request)))).requests?.[0]?.rows).toEqual(sheet.request.rows);
  });

  it("まとめた行の答えは、その店の行すべての候補になり、承認するとまとめて決まる", async () => {
    const { log, sheet, items } = await shopSheet();
    const filled = await mark(sheet.bytes, []);
    const a = await lineOf(filled, "架空モバイル通信\n毎回 3,300円");
    const p = await lineOf(filled, "架空の携帯電話料");
    const edited = await editXlsx(filled, (f) => {
      setCell(f, SHEET, `H${a}`, str("通信"));
      setCell(f, SHEET, `I${a}`, str("家計（ふだんの暮らし）"));
      setCell(f, SHEET, `I${p}`, str("事業の経費"));
      setCell(f, SHEET, `J${p}`, "<c><v>60</v></c>");
    });
    const r = ok(await readMarkSheet(edited, { log, rows: classified(log) }));
    expect(r.candidates.map((c) => [c.merchant, c.kind, c.count, c.amount, c.date, c.to, c.mark.category, c.mark.bucket, c.mark.share, c.status])).toEqual([
      ["架空モバイル通信", "shop", 12, 39600, "2025-10-10", "2026-09-10", "communication", "household", undefined, "pending"],
      ["架空の携帯電話料", "shop", 3, 18000, "2025-10-25", "2025-12-25", undefined, "business", "0.6", "pending"],
    ]);
    expect(r.candidates[0]?.decisions).toHaveLength(12);
    expect(new Set(r.candidates[0]?.decisions.map((d) => d.rowId)).size).toBe(12);
    expect(r.candidates[1]?.decisions.every((d) => d.bucket === "business" && d.share === "0.6")).toBe(true);
    // 印の無い行は明細の行の数で数える（21 − 12 − 3）
    expect(r.unmarked).toBe(6);
    const next = applyDecisions(log, r.candidates.flatMap((c) => c.decisions), "2026-10-22T10:00:00+09:00");
    expect(reviewList(classified(next))).toHaveLength(items.length - 15);
    // 別のカードの同じ店（配偶者のカードの架空モバイル通信）には当てない
    expect(reviewList(classified(next)).filter((x) => x.merchant === "架空モバイル通信").map((x) => x.account)).toEqual(["cardB", "cardB"]);
  });

  it("まとめた行の期間・回数・合計が書き出したものと合わなければ読まない。行の一部が無くなっていれば照らし合わせられないので読まない", async () => {
    const { log, sheet } = await shopSheet();
    const a = await lineOf(sheet.bytes, "架空モバイル通信\n毎回 3,300円");
    const k = await lineOf(sheet.bytes, "架空の謎の工房\n");
    const p = await lineOf(sheet.bytes, "架空の携帯電話料");
    const edited = await editXlsx(sheet.bytes, (f) => {
      setCell(f, SHEET, `H${a}`, str("通信"));
      setCell(f, SHEET, `B${a}`, str("2025/10/10〜2026/09/10 11回"));
      setCell(f, SHEET, `H${k}`, str("教養娯楽"));
      setCell(f, SHEET, `D${k}`, "<c><v>4000</v></c>");
      setCell(f, SHEET, `H${p}`, str("通信"));
    });
    const rows = classified(log);
    const r = ok(await readMarkSheet(edited, { log, rows }));
    expect(codes(r).filter((c) => c === "S_SHEET_ROW_CHANGED")).toHaveLength(2);
    expect(r.candidates.map((c) => c.merchant)).toEqual(["架空の携帯電話料"]);
    // 期間の欄が別の書き方（全角・括弧つき）でも、日付と回数が合えば読む
    const respelled = await editXlsx(sheet.bytes, (f) => {
      setCell(f, SHEET, `H${a}`, str("通信"));
      setCell(f, SHEET, `B${a}`, str("２０２５/１０/１０ ～ ２０２６/９/１０（１２回）"));
    });
    expect(ok(await readMarkSheet(respelled, { log, rows })).candidates.map((c) => c.count)).toEqual([12]);
    // 取り込みを外すなどで、まとめた行の一部が仕分けに無い
    const partial = rows.filter((x) => !(x.row.merchant === "架空の携帯電話料" && x.row.date === "2025-11-25"));
    const g = ok(await readMarkSheet(edited, { log, rows: partial }));
    expect(g.candidates).toEqual([]);
    expect(g.issues.find((i) => i.code === "S_SHEET_ROW_GONE")?.message).toContain("照らし合わせられません");
  });

  it("まとめた行のメモ・書き出した後に FP が決めた行は要確認にする", async () => {
    const { log, sheet } = await shopSheet();
    const a = await lineOf(sheet.bytes, "架空モバイル通信\n毎回 3,300円");
    const edited = await editXlsx(sheet.bytes, (f) => {
      setCell(f, SHEET, `H${a}`, str("通信"));
      setCell(f, SHEET, `K${a}`, str("3月だけ仕事用の端末代が入っています"));
    });
    const one = reviewList(classified(log)).find((x) => x.merchant === "架空モバイル通信" && x.account === "cardA");
    const decided = applyDecisions(log, [{ importId: one?.importId as string, rowId: one?.rowId as string, category: "communication" }], "2026-10-21T12:00:00+09:00");
    const r = ok(await readMarkSheet(edited, { log: decided, rows: classified(decided) }));
    expect(r.candidates[0]?.status).toBe("needsReview");
    expect(r.candidates[0]?.notes.join("")).toContain("メモ");
    expect(r.candidates[0]?.notes.join("")).toContain("書き出した後に FP が決めた行が 1行");
    expect(r.candidates[0]?.decisions).toHaveLength(12);
  });
});
