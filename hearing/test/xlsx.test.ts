// .xlsx の書き出しと読み込み: 管理の値の3か所・名前の定義と位置の照合・返ってきたファイルを信用しない読み方（0018 の2・4・6）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createHearingSheet, layoutDigest, readSheetXlsx, OFFICIAL_SHEETS, REQUESTED_DOCUMENTS_HEADING, REQUESTED_DOCUMENTS_NOTE, type HearingRequest, type ReadResult } from "../src/index.ts";
import { answerCells } from "../src/definition.ts";
import { full2, bytes, editXlsx, HEARING_DIR, insertRow, modelHousehold, OFFICE, rezip, setCell, text, toSharedStrings, unzip } from "./helpers.ts";

const def = full2();
const ANS = "xl/worksheets/sheet2.xml";
const sample = () => new Uint8Array(readFileSync(join(HEARING_DIR, "samples", "basic-1-sample.xlsx")));

async function blank(): Promise<{ bytes: Uint8Array; request: HearingRequest }> {
  const r = await createHearingSheet({ definition: def, requestId: "R-ABCDEF", customerNo: "B0007", office: OFFICE, appVersion: "0.1.0", exportedOn: "2026-10-17" });
  return { bytes: r.bytes, request: r.request };
}
const read = (b: Uint8Array, requests?: HearingRequest[]) => readSheetXlsx(b, { definitions: OFFICIAL_SHEETS, ...(requests !== undefined ? { requests } : {}) });
const codes = (r: ReadResult) => r.issues.map((i) => i.code);
const answer = (r: ReadResult, key: string, index?: number) => (r.ok ? r.filled.answers.find((a) => a.key === key && a.index === index) : undefined);
/** 回答のセルの行 */
const rowOf = (key: string, index?: number) => answerCells(def).find((c) => c.key === key && c.index === index)?.row as number;

describe("書き出したシート", () => {
  it("管理の値を3か所（隠したシート・文書のプロパティ・1枚目の管理欄）に書き、名前の定義を付ける", async () => {
    const { bytes: b } = await blank();
    const files = await unzip(b);
    const wb = text(files.get("xl/workbook.xml"));
    expect(wb).toContain('name="_lifeplan" sheetId="4" state="veryHidden"');
    expect(wb).toContain(`<definedName name="hs.income.salary_2">&apos;ご記入欄&apos;!$C$${rowOf("hs.income.salary", 2)}</definedName>`.replace(/&apos;/g, "'"));
    expect(text(files.get("docProps/custom.xml"))).toContain('name="lifeplan.requestId"><vt:lpwstr>R-ABCDEF</vt:lpwstr>');
    const intro = text(files.get("xl/worksheets/sheet1.xml"));
    expect(intro).toContain("R-ABCDEF");
    expect(intro).toContain("full-2");
    expect(intro).toContain("お名前は書かないでください");
    // マクロ・外部リンクは無い
    expect([...files.keys()].some((n) => /vba|externalLink|embeddings/.test(n))).toBe(false);
  });

  it("世帯の内部ID・構成員のID を書かない（0012）", async () => {
    const req = modelHousehold("salariedCoupleTwoKids");
    const r = await createHearingSheet({ definition: def, household: { request: req }, requestId: "R-ABCDEF", customerNo: "", office: OFFICE, appVersion: "0.1.0", exportedOn: "2026-10-17" });
    const all = [...(await unzip(r.bytes)).values()].map(text).join("\n");
    const ids = JSON.stringify(req).match(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g) ?? [];
    expect(ids.length).toBeGreaterThan(5);
    for (const id of ids) expect(all.includes(id), id).toBe(false);
  });

  it("回答のセル以外を保護し（パスワードなし）、回答のセルは保護を外す", async () => {
    const files = await unzip((await blank()).bytes);
    const s = text(files.get(ANS));
    expect(s).toContain('<sheetProtection sheet="1"');
    expect(s).not.toContain("password");
    expect(text(files.get("xl/styles.xml"))).toContain('<protection locked="0"/>');
  });

  it("空欄のシートを読むと、すべて未回答になる", async () => {
    const { bytes: b, request } = await blank();
    const r = await read(b, [request]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.issues).toEqual([]);
    expect(r.filled.answers.every((a) => a.status === "blank")).toBe(true);
    expect(r.filled.answers.length).toBe(answerCells(def).length);
  });
});

describe("返ってきたシートの読み方", () => {
  it("見本のシートを、依頼の記録なしでも同梱のシート定義で読める（知らせつき）", async () => {
    const r = await read(sample());
    expect(r.ok).toBe(true);
    expect(codes(r)).toEqual(["H_REQUEST_UNKNOWN"]);
    expect(answer(r, "hs.income.salary", 1)?.raw).toEqual({ kind: "number", text: "580" });
  });

  it("Excel で保存し直した形（共有文字列・ふりがな・deflate）でも読める", async () => {
    const b = await editXlsx(sample(), toSharedStrings);
    const r = await read(b);
    expect(r.ok).toBe(true);
    expect(answer(r, "hs.work.type", 1)?.raw).toEqual({ kind: "text", text: "会社員（正社員）" });
  });

  it("行を挿入しても、名前の定義を追って読み、要確認にする（黙って使わない）", async () => {
    const at = rowOf("hs.work.type", 1);
    const b = await editXlsx(sample(), (f) => insertRow(f, ANS, "ご記入欄", at));
    const r = await read(b);
    expect(r.ok).toBe(true);
    expect(answer(r, "hs.work.type", 1)).toMatchObject({ status: "value", raw: { text: "会社員（正社員）" }, review: [expect.stringContaining("名前の定義の位置")] });
    // 挿入した行より上は動いていない
    expect(answer(r, "hs.family.adult.birthYearMonth", 1)?.review).toBeUndefined();
    expect(codes(r)).toContain("H_NAME_MOVED");
  });

  it("名前の定義を消されても、決まった位置で質問の文を確かめて読む", async () => {
    const b = await editXlsx(sample(), (f) => f.set("xl/workbook.xml", bytes(text(f.get("xl/workbook.xml")).replace(/<definedNames>.*<\/definedNames>/, ""))));
    const r = await read(b);
    expect(r.ok).toBe(true);
    expect(codes(r)).toContain("H_NAME_MISSING");
    expect(answer(r, "hs.income.salary", 1)).toMatchObject({ status: "value", raw: { text: "580" } });
    expect(answer(r, "hs.income.salary", 1)?.review).toBeUndefined();
  });

  it("名前の定義を消したうえで行を挿入されたら、質問の文が合わないので要確認にする", async () => {
    const b = await editXlsx(sample(), (f) => {
      insertRow(f, ANS, "ご記入欄", 5);
      f.set("xl/workbook.xml", bytes(text(f.get("xl/workbook.xml")).replace(/<definedNames>.*<\/definedNames>/, "")));
    });
    const r = await read(b);
    expect(r.ok).toBe(true);
    expect(codes(r)).toContain("H_LABEL_MISMATCH");
    expect(answer(r, "hs.income.salary", 1)?.review).toBeDefined();
  });

  it("隠したシート・文書のプロパティを消されても、残った管理の値で読む（Google スプレッドシートなどで保存し直した場合）", async () => {
    const b = await editXlsx(sample(), (f) => {
      f.delete("docProps/custom.xml");
      f.set("xl/workbook.xml", bytes(text(f.get("xl/workbook.xml")).replace(/<sheet name="_lifeplan"[^>]*\/>/, "")));
    });
    const r = await read(b);
    expect(r.ok).toBe(true);
    expect(codes(r)).toContain("H_MANAGE_PARTLY_LOST");
    expect(r.ok && r.filled.management.requestId).toBe("R-7K3P9Q");
  });

  it("管理の値が食い違えば、取り込みを止める", async () => {
    const b = await editXlsx(sample(), (f) => f.set("docProps/custom.xml", bytes(text(f.get("docProps/custom.xml")).replace("R-7K3P9Q", "R-ZZZZZZ"))));
    const r = await read(b);
    expect(r.ok).toBe(false);
    expect(codes(r)).toEqual(["H_MANAGE_MISMATCH"]);
  });

  it("依頼の記録とシートの種類が食い違えば止める（記録を正にする）", async () => {
    const rec: HearingRequest = { requestId: "R-7K3P9Q", sheetId: "basic", sheetVersion: 1, layoutDigest: "f".repeat(64), customerNo: "A0042", exportedOn: "2026-10-17", prefilled: false };
    const r = await read(sample(), [rec]);
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain("H_LAYOUT_MISMATCH");
  });

  it("配置の指紋が公式と違い、依頼の記録も無ければ止める（FP が作ったシートを黙って読まない）", async () => {
    const b = await editXlsx(sample(), (f) => {
      f.set("docProps/custom.xml", bytes(text(f.get("docProps/custom.xml")).replace(/(lifeplan\.layoutDigest"><vt:lpwstr>)[0-9a-f]+/, `$1${"a".repeat(64)}`)));
      f.set("xl/worksheets/sheet4.xml", bytes(text(f.get("xl/worksheets/sheet4.xml")).replace(/>[0-9a-f]{64}</, `>${"a".repeat(64)}<`)));
    });
    const r = await read(b);
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain("H_LAYOUT_MISMATCH");
  });

  it("数式のセルは評価せず、保存された計算結果を要確認で読む。結果が無ければ読まない", async () => {
    const b = await editXlsx(sample(), (f) => {
      setCell(f, ANS, `C${rowOf("hs.income.salary", 1)}`, "<c><f>500+80</f><v>580</v></c>");
      setCell(f, ANS, `C${rowOf("hs.income.bonus", 1)}`, "<c><f>WEBSERVICE(&quot;http://example.invalid&quot;)</f></c>");
    });
    const r = await read(b);
    expect(r.ok).toBe(true);
    expect(answer(r, "hs.income.salary", 1)).toMatchObject({ status: "value", raw: { kind: "number", text: "580" }, review: [expect.stringContaining("数式")] });
    expect(answer(r, "hs.income.bonus", 1)?.status).toBe("blank");
    expect(codes(r)).toEqual(expect.arrayContaining(["H_FORMULA", "H_FORMULA_NO_VALUE"]));
  });

  it("値と状態の両方が記入されていたら、値を要確認で読む", async () => {
    const b = await editXlsx(sample(), (f) => setCell(f, ANS, `E${rowOf("hs.income.salary", 1)}`, '<c t="inlineStr"><is><t>わからない</t></is></c>'));
    const r = await read(b);
    expect(answer(r, "hs.income.salary", 1)?.review).toEqual([expect.stringContaining("両方")]);
  });

  it("マクロ・外部リンク・埋め込みが入っていても、読まず・実行せずに、決まったセルだけを読む", async () => {
    const b = await editXlsx(sample(), (f) => {
      f.set("xl/vbaProject.bin", bytes("Attribute VB_Name = \"Module1\"\nSub Auto_Open()\nEnd Sub"));
      f.set("xl/externalLinks/externalLink1.xml", bytes('<externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>'));
      f.set("xl/embeddings/oleObject1.bin", bytes("x"));
    });
    const r = await read(b);
    expect(r.ok).toBe(true);
    expect(codes(r)).toEqual(expect.arrayContaining(["H_FILE_MACRO_IGNORED", "H_FILE_EXTERNAL_IGNORED", "H_FILE_EMBEDDED_IGNORED"]));
  });

  it("DOCTYPE（実体の定義）を含む中身は読まずに止める", async () => {
    const b = await editXlsx(sample(), (f) => f.set(ANS, bytes(`<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaaaaaaaa">]>` + text(f.get(ANS)).replace(/^<\?xml[^>]*\?>\n?/, ""))));
    const r = await read(b);
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain("H_FILE_BROKEN");
    expect(r.issues.find((i) => i.code === "H_FILE_BROKEN")?.message).toContain("DOCTYPE");
  });

  it(".xlsx 以外の形は、分かる言葉で止める", async () => {
    expect(codes(await read(bytes("名前,年収\n山田,600")))).toEqual(["H_FILE_NOT_XLSX"]);
    expect(codes(await read(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])))).toEqual(["H_FILE_XLS"]);
    const ods = rezip(new Map([["mimetype", bytes("application/vnd.oasis.opendocument.spreadsheet")], ["content.xml", bytes("<x/>")]]), { stored: true });
    expect(codes(await read(ods))).toEqual(["H_FILE_ODS"]);
    const numbers = rezip(new Map([["Index/Document.iwa", bytes("x")]]));
    expect(codes(await read(numbers))).toEqual(["H_FILE_NUMBERS"]);
    const notSheet = rezip(new Map([["xl/workbook.xml", bytes('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Sheet1" sheetId="1"/></sheets></workbook>')]]));
    expect(codes(await read(notSheet))).toEqual(["H_NOT_HEARING_SHEET"]);
  });

  it("壊れたファイル・展開すると膨らむファイル・大きすぎるファイルで落ちない", async () => {
    const s = sample();
    expect(codes(await read(s.slice(0, Math.floor(s.length / 2))))).toEqual(["H_FILE_BROKEN"]);
    // 展開すると 30MB になる中身（圧縮後は数十KB）
    const bomb = rezip(new Map([["xl/workbook.xml", new Uint8Array(30 * 1024 * 1024)]]));
    expect(bomb.length).toBeLessThan(200 * 1024);
    expect(codes(await readSheetXlsx(bomb, { definitions: OFFICIAL_SHEETS, limits: { maxFileBytes: 1e7, maxEntries: 100, maxEntryBytes: 5 * 1024 * 1024, maxTotalBytes: 1e8 } }))).toEqual(["H_FILE_TOO_LARGE"]);
    expect(codes(await readSheetXlsx(s, { definitions: OFFICIAL_SHEETS, limits: { maxFileBytes: 1000, maxEntries: 100, maxEntryBytes: 1e7, maxTotalBytes: 1e8 } }))).toEqual(["H_FILE_TOO_LARGE"]);
    // 中身の検査の値が合わない
    const files = await unzip(s);
    const broken = rezip(files);
    const i = broken.indexOf(0x3c, 2000);
    broken[i] = 0x00;
    expect((await read(broken)).ok).toBe(false);
  });

  it("新しい形式の版のシートは、アプリの更新を案内して止める", async () => {
    const b = await editXlsx(sample(), (f) => {
      f.set("docProps/custom.xml", bytes(text(f.get("docProps/custom.xml")).replace(/(formatVersion"><vt:lpwstr>)0\.1/, "$19.0")));
      f.set("xl/worksheets/sheet4.xml", bytes(text(f.get("xl/worksheets/sheet4.xml")).replace(/(formatVersion<\/t><\/is><\/c><c r="B2" s="0" t="inlineStr"><is><t xml:space="preserve">)0\.1/, "$19.0")));
    });
    expect(codes(await read(b))).toEqual(["H_FORMAT_NEWER"]);
  });
});

describe("この世帯でお願いしたい書類（1枚目の配置の後ろ。0018 の追記 2026-10-31）", () => {
  const docs = ["ねんきん定期便（ご本人）", "住宅ローンの返済予定表（ご本人）"];
  const make = (requestedDocuments?: readonly string[]) =>
    createHearingSheet({ definition: def, requestId: "R-ABCDEF", customerNo: "B0007", office: OFFICE, appVersion: "0.1.0", exportedOn: "2026-10-17", ...(requestedDocuments !== undefined ? { requestedDocuments } : {}) });

  it("渡すと1枚目の最後の行の下に見出し・書類・番号を隠してよい一文を書く。記入欄のシートと管理の値・指紋は変わらない", async () => {
    const plain = await make();
    const withDocs = await make(docs);
    const a = await unzip(plain.bytes);
    const b = await unzip(withDocs.bytes);
    const intro = text(b.get("xl/worksheets/sheet1.xml"));
    const last = Math.max(...def.layout.rows.filter((r) => r.sheet === def.layout.introSheet).map((r) => r.row));
    expect(intro).toContain(`<row r="${last + 2}"`);
    for (const t of [REQUESTED_DOCUMENTS_HEADING, ...docs.map((d) => `・${d}`), REQUESTED_DOCUMENTS_NOTE]) expect(intro).toContain(t);
    expect(text(a.get("xl/worksheets/sheet1.xml"))).not.toContain(REQUESTED_DOCUMENTS_HEADING);
    // 記入欄のシート・名前の定義・管理の値（隠したシート）は同じ
    for (const name of [ANS, "xl/workbook.xml", "xl/worksheets/sheet4.xml", "docProps/custom.xml"]) expect(text(b.get(name)), name).toBe(text(a.get(name)));
    expect(withDocs.request).toEqual(plain.request);
    expect(withDocs.request.layoutDigest).toBe(await layoutDigest(def));
  });

  it("取り込みは足した行を読まない（同じ回答・同じ知らせ）。空の一覧は何も足さない", async () => {
    const plain = await make();
    const withDocs = await make(docs);
    const r1 = await read(plain.bytes, [plain.request]);
    const r2 = await read(withDocs.bytes, [withDocs.request]);
    expect(r2.ok).toBe(true);
    expect(r2.ok && r1.ok ? r2.filled : null).toEqual(r1.ok ? r1.filled : null);
    expect(codes(r2)).toEqual(codes(r1));
    const empty = await make([]);
    expect(text((await unzip(empty.bytes)).get("xl/worksheets/sheet1.xml"))).toBe(text((await unzip(plain.bytes)).get("xl/worksheets/sheet1.xml")));
  });
});
