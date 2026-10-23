// 表計算のファイルの土台: 書き出したブックを読み戻す・管理の値の3か所のうち2か所（隠したシート・ユーザー設定のプロパティ）・返ってきたファイルを信用しない読み込み
import { describe, expect, it } from "vitest";
import { Book, buildStyles, LIST_SHEET, Lists, listValidation, META_SHEET, metaSheetXml, numberValidation, PROPERTY_PREFIX, SheetBuilder, STYLE, STYLE_COUNT, text, writeBook, type OpenResult } from "../src/index.ts";
import { bytes, editXlsx, setCell, text as utf8, toSharedStrings, unzip } from "./helpers.ts";

const KEYS = ["format", "requestId"] as const;

function sample(): Uint8Array {
  const lists = new Lists();
  const b = new SheetBuilder();
  b.set(1, "A", STYLE.title, text("題名"));
  b.set(2, "A", STYLE.no, { kind: "number", text: "1" });
  b.set(2, "B", STYLE.input);
  b.set(2, "C", STYLE.locked, { kind: "bool", value: true });
  b.validations.push(listValidation("B2", lists, ["はい", "いいえ"], "選んでください"), numberValidation("D2", "whole", 1, 100, "1〜100"));
  expect(lists.ref(["はい", "いいえ"])).toBe(`'${LIST_SHEET}'!$A$1:$A$2`);
  expect(lists.ref(["x"])).toBe(`'${LIST_SHEET}'!$B$1:$B$1`);
  const entries = [["format", "test-format"], ["requestId", "R-ABCDEF"]] as const;
  return writeBook({
    sheets: [
      { name: "記入", xml: b.xml({ widths: [10, 20, 20, 10], protect: true, freezeRows: 1 }) },
      { name: LIST_SHEET, xml: lists.sheetXml(), state: "hidden" },
      { name: META_SHEET, xml: metaSheetXml(entries), state: "veryHidden" },
    ],
    definedNames: [["b.name", "'記入'!$B$2"]],
    styles: buildStyles(['<xf numFmtId="3" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1"/>']),
    title: "見本",
    application: "test-format",
    properties: entries,
    date: "2026-10-23",
  });
}

const open = async (b: Uint8Array): Promise<Extract<OpenResult, { ok: true }>> => {
  const r = await Book.open(b);
  if (!r.ok) throw new Error(r.problem.message);
  return r;
};

describe("書き出したブックを読み戻す", () => {
  it("シートの並びと状態・名前の定義・管理の値・セルの値", async () => {
    const bytes1 = sample();
    expect(Buffer.compare(Buffer.from(bytes1), Buffer.from(sample()))).toBe(0);
    const { book, notes } = await open(bytes1);
    expect(notes).toEqual([]);
    expect(book.sheets.map((s) => [s.name, s.state])).toEqual([
      ["記入", "visible"],
      [LIST_SHEET, "hidden"],
      [META_SHEET, "veryHidden"],
    ]);
    expect(book.firstVisible()).toBe("記入");
    expect(book.definedNames.get("b.name")).toBe("'記入'!$B$2");
    expect(await book.keyValues(META_SHEET, KEYS)).toEqual({ format: "test-format", requestId: "R-ABCDEF" });
    expect(await book.keyValues("無いシート", KEYS)).toBeNull();
    expect(await book.properties(PROPERTY_PREFIX, KEYS)).toEqual({ format: "test-format", requestId: "R-ABCDEF" });
    const sh = await book.sheet("記入");
    expect(book.text(sh, "A1")).toBe("題名");
    expect(book.cell(sh, "A2").raw).toEqual({ kind: "number", text: "1" });
    expect(book.cell(sh, "B2")).toEqual({ raw: null, formula: false, noValue: false });
    expect(book.text(sh, "C2")).toBe("true");
    const files = await unzip(bytes1);
    const styles = utf8(files.get("xl/styles.xml"));
    expect(styles).toContain(`<cellXfs count="${STYLE_COUNT + 1}">`);
    const ws = utf8(files.get("xl/worksheets/sheet1.xml"));
    expect(ws).toContain('<sheetProtection sheet="1"');
    expect(ws).toContain('<pane ySplit="1"');
    expect(ws).toContain("<dataValidations count=\"2\">");
    expect(utf8(files.get("xl/workbook.xml"))).toContain('state="veryHidden"');
  });

  it("名前の定義が無いブックには definedNames を書かない", async () => {
    const b = writeBook({ sheets: [{ name: "A", xml: new SheetBuilder().xml({ widths: [10], protect: false }) }], styles: buildStyles(), title: "t", application: "a", properties: [], date: "2026-10-23" });
    const files = await unzip(b);
    expect(utf8(files.get("xl/workbook.xml"))).not.toContain("definedNames");
    expect((await open(b)).book.definedNames.size).toBe(0);
  });

  it("別のソフトで保存し直した形（共有文字列）も読む。数式は評価せず、結果が無いものは noValue", async () => {
    const edited = await editXlsx(sample(), (files) => {
      toSharedStrings(files);
      setCell(files, "xl/worksheets/sheet1.xml", "B2", '<c t="str"><f>1+1</f><v>2</v></c>');
      setCell(files, "xl/worksheets/sheet1.xml", "C2", "<c><f>A9</f></c>");
    });
    const { book } = await open(edited);
    const sh = await book.sheet("記入");
    expect(book.text(sh, "A1")).toBe("題名");
    expect(book.cell(sh, "B2")).toEqual({ raw: { kind: "text", text: "2" }, formula: true, noValue: false });
    expect(book.cell(sh, "C2")).toEqual({ raw: null, formula: true, noValue: true });
  });
});

describe("返ってきたファイルを信用しない", () => {
  const problem = async (b: Uint8Array) => {
    const r = await Book.open(b);
    return r.ok ? null : r.problem.code;
  };
  it(".xlsx でない形は保存し直すよう案内する", async () => {
    expect(await problem(bytes("a,b,c\n"))).toBe("notXlsx");
    expect(await problem(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]))).toBe("xls");
    const ods = await editXlsx(sample(), (f) => f.set("mimetype", bytes("application/vnd.oasis.opendocument.spreadsheet")));
    expect(await problem(ods)).toBe("ods");
    const numbers = await editXlsx(sample(), (f) => f.set("Index/Document.iwa", bytes("x")));
    expect(await problem(numbers)).toBe("numbers");
    const noBook = await editXlsx(sample(), (f) => f.delete("xl/workbook.xml"));
    expect(await problem(noBook)).toBe("notXlsx");
  });

  it("マクロ・外部リンク・埋め込みは読まずに知らせる", async () => {
    const b = await editXlsx(sample(), (f) => {
      f.set("xl/vbaProject.bin", bytes("x"));
      f.set("xl/externalLinks/externalLink1.xml", bytes("<x/>"));
      f.set("xl/embeddings/oleObject1.bin", bytes("x"));
    });
    const r = await open(b);
    expect(r.notes.map((n) => n.code)).toEqual(["macro", "external", "embedded"]);
  });

  it("DOCTYPE を含む XML・壊れた zip・大きすぎるファイルは読まない", async () => {
    const dtd = await editXlsx(sample(), (f) => f.set("xl/workbook.xml", bytes('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><workbook/>')));
    const r = await Book.open(dtd);
    expect(r.ok ? null : r.problem).toMatchObject({ code: "broken" });
    expect(r.ok ? "" : r.problem.message).toContain("DOCTYPE");
    const cut = sample().slice(0, 200);
    expect(await problem(cut)).toBe("broken");
    const big = await Book.open(sample(), { maxFileBytes: 100, maxEntries: 1000, maxEntryBytes: 1e7, maxTotalBytes: 1e8 });
    expect(big.ok ? null : big.problem.code).toBe("tooLarge");
    const many = await Book.open(sample(), { maxFileBytes: 1e7, maxEntries: 3, maxEntryBytes: 1e7, maxTotalBytes: 1e8 });
    expect(many.ok ? null : many.problem.code).toBe("tooLarge");
  });
});
