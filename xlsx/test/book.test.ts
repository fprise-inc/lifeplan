// 表計算のファイルの土台: 書き出したブックを読み戻す・管理の値の3か所のうち2か所（隠したシート・ユーザー設定のプロパティ）・返ってきたファイルを信用しない読み込み
import { describe, expect, it } from "vitest";
import { Book, buildStyles, LIST_SHEET, Lists, listValidation, META_SHEET, metaSheetXml, numberValidation, PROPERTY_PREFIX, SheetBuilder, STYLE, STYLE_COUNT, text, writeBook, type OpenResult } from "../src/index.ts";
import { bytes, editXlsx, setCell, setNumberFormat, text as utf8, toSharedStrings, unzip } from "./helpers.ts";

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
    expect(book.cell(sh, "B2")).toEqual({ raw: null, formula: false, noValue: false, percent: false });
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

  it("XML 1.0 で使えない文字（タブ・改行のほかの制御文字、U+FFFE・U+FFFF）は書き出さない（入れると表計算のソフトが開けないファイルになる）", async () => {
    const bad = "架空\u0000の\u0001店\u0008\u000b\u000c\u001f￾￿";
    const b = new SheetBuilder();
    b.set(1, "A", STYLE.text, text(bad));
    b.set(2, "A", STYLE.text, text("改行\nと\tタブ\rは残す"));
    b.validations.push(listValidation("B1", new Lists(), ["はい"], `選んで\u0007ください`));
    const book = writeBook({ sheets: [{ name: `記\u0002入`, xml: b.xml({ widths: [10], protect: false }) }], styles: buildStyles(), title: `題\u0003名`, application: "a", properties: [["k", `値\u0004`]], date: "2026-10-23" });
    const files = await unzip(book);
    // eslint-disable-next-line no-control-regex
    const invalid = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/u;
    for (const [name, data] of files) expect(invalid.test(utf8(data)), name).toBe(false);
    const { book: read } = await open(book);
    const sh = await read.sheet("記入");
    expect(read.text(sh, "A1")).toBe("架空の店");
    expect(read.text(sh, "A2")).toBe("改行\nと\tタブ\rは残す");
    expect(await read.properties(PROPERTY_PREFIX, ["k"])).toEqual({ k: "値" });
  });

  // 表計算のソフトは、セルの文字の中の「_xHHHH_」の形を文字の番号として読む（「_x0041_」は「A」、「_x000D_」は復帰）。
  // そのまま書くと、店の名前・メモに「_x0041_」の形があったとき別の文字に読まれていた。頭の「_」を「_x005F_」にして逃がす
  it("「_xHHHH_」の形の文字は「_x005F_」で逃がして書き、読み戻すと元の文字になる", async () => {
    const odd = ["_x0041_", "架空_x000D_店", "a_x005F_b", "_X00ff_", "_x12G4_", "__x0041__"];
    const b = new SheetBuilder();
    odd.forEach((t, i) => b.set(i + 1, "A", STYLE.text, text(t)));
    b.validations.push(listValidation("B1", new Lists(), ["はい"], "_x0041_を選んでください"));
    const book = writeBook({ sheets: [{ name: "記入", xml: b.xml({ widths: [10], protect: false }) }], styles: buildStyles(), title: "題名", application: "a", properties: [], date: "2026-10-23" });
    const xml = utf8((await unzip(book)).get("xl/worksheets/sheet1.xml"));
    expect(xml).toContain(">_x005F_x0041_<");
    expect(xml).toContain(">架空_x005F_x000D_店<");
    expect(xml).toContain(">a_x005F_x005F_b<");
    expect(xml).toContain(">_x005F_X00ff_<");
    expect(xml).toContain(">_x12G4_<");
    expect(xml).toContain('error="_x005F_x0041_を選んでください"');
    const { book: read } = await open(book);
    const sh = await read.sheet("記入");
    expect(odd.map((_, i) => read.text(sh, `A${i + 1}`))).toEqual(odd);
    // 共有文字列にした形（表計算のソフトで保存し直した形）でも同じ
    const { book: again } = await open(await editXlsx(book, (files) => toSharedStrings(files)));
    const sh2 = await again.sheet("記入");
    expect(odd.map((_, i) => again.text(sh2, `A${i + 1}`))).toEqual(odd);
  });

  it("表計算のソフトが書いた「_xHHHH_」（改行・復帰など）は、その文字として読む", async () => {
    const edited = await editXlsx(sample(), (files) => {
      setCell(files, "xl/worksheets/sheet1.xml", "B2", '<c t="inlineStr"><is><t>1行目_x000D_\n2行目</t></is></c>');
      setCell(files, "xl/worksheets/sheet1.xml", "C2", '<c t="str"><f>A1</f><v>_x005F_x0041_</v></c>');
    });
    const { book } = await open(edited);
    const sh = await book.sheet("記入");
    expect(book.text(sh, "B2")).toBe("1行目\r\n2行目");
    expect(book.text(sh, "C2")).toBe("_x0041_");
    // XML に入れられない制御文字になるものは除く（書き出しで除くのと同じ）
    const ctrl = await editXlsx(sample(), (files) => setCell(files, "xl/worksheets/sheet1.xml", "B2", '<c t="inlineStr"><is><t>架空_x0001_店_x0009_</t></is></c>'));
    const { book: b2 } = await open(ctrl);
    expect(b2.text(await b2.sheet("記入"), "B2")).toBe("架空店\t");
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
    expect(book.cell(sh, "B2")).toEqual({ raw: { kind: "text", text: "2" }, formula: true, noValue: false, percent: false });
    expect(book.cell(sh, "C2")).toEqual({ raw: null, formula: true, noValue: true, percent: false });
  });
});

describe("セルの書式（パーセント）", () => {
  // Excel は、セルに「0.625%」と打つと値を 0.00625 にしてパーセントの書式を付ける。値だけを見ると 100分の1 に読み違える
  const at = async (fmt: number | string | null, v = "0.00625", t = "") => {
    const edited = await editXlsx(sample(), (files) => {
      setCell(files, "xl/worksheets/sheet1.xml", "B2", `<c${t}><v>${v}</v></c>`);
      if (fmt !== null) setNumberFormat(files, "xl/worksheets/sheet1.xml", "B2", fmt);
    });
    const { book } = await open(edited);
    return book.cell(await book.sheet("記入"), "B2");
  };

  it("組み込みのパーセントの書式（9「0%」・10「0.00%」）と、「%」を含む書式の数のセルは percent", async () => {
    for (const f of [9, 10, "0.000%", "#,##0.0%;[Red]-#,##0.0%", "0.0 %"]) {
      const c = await at(f);
      expect(c.raw, String(f)).toEqual({ kind: "number", text: "0.00625" });
      expect(c.percent, String(f)).toBe(true);
    }
  });

  it("引用した「%」・逃がした「%」・ほかの書式・書式なし・文字のセルは percent でない", async () => {
    for (const f of [null, 0, 2, 14, '0.000"%"', "0.0\\%", '"率"0.00', "General"]) expect((await at(f)).percent, String(f)).toBe(false);
    expect((await at(10, "0.625%", ' t="str"')).percent, "文字のセル").toBe(false);
  });

  it("書式の表が無い・壊れたブックも、書式なしとして読む", async () => {
    const edited = await editXlsx(sample(), (files) => {
      setCell(files, "xl/worksheets/sheet1.xml", "B2", "<c><v>0.5</v></c>");
      files.delete("xl/styles.xml");
    });
    const { book } = await open(edited);
    expect(book.cell(await book.sheet("記入"), "B2")).toEqual({ raw: { kind: "number", text: "0.5" }, formula: false, noValue: false, percent: false });
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

describe("見えている数への丸め", () => {
  it("表計算のソフトが 17 桁で保存した数を、見えている有効数字 15 桁の 10進の文字にする。shift で 10 の何乗を掛ける", async () => {
    const { shownNumber } = await import("../src/index.ts");
    expect(shownNumber("6.2500000000000003E-3")).toBe("0.00625");
    expect(shownNumber("6.2500000000000003E-3", 2)).toBe("0.625");
    expect(shownNumber("0.10000000000000001")).toBe("0.1");
    expect(shownNumber("0.6", 2)).toBe("60");
    expect(shownNumber("1.4749999999999999")).toBe("1.475");
    expect(shownNumber("0.99999999999999989")).toBe("1");
    expect(shownNumber("-2.5E-2", 2)).toBe("-2.5");
    expect(shownNumber("1234567")).toBe("1234567");
    expect(shownNumber("0")).toBe("0");
    expect(shownNumber("0.000")).toBe("0");
    expect(shownNumber("12.50")).toBe("12.5");
    expect(shownNumber("abc")).toBeNull();
    expect(shownNumber("")).toBeNull();
  });
});
