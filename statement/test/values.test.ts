import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/csv/parse.ts";
import { decodeText, parseAmount, parseDate, parsePlan, parseUser, parseYearMonth } from "../src/index.ts";
import { foldKana, looseKey, nfkc } from "../src/text/normalize.ts";

describe("金額の書き方", () => {
  it.each([
    ["1,234", 1234],
    ["1234", 1234],
    ["１，２３４", 1234],
    ["¥1,234", 1234],
    ["￥1,234", 1234],
    ["\\1,234", 1234],
    ["1,234円", 1234],
    ["-1,234", -1234],
    ["−1,234", -1234],
    ["△1,234", -1234],
    ["▲500", -500],
    ["(1,234)", -1234],
    ["（1,234）", -1234],
    ["1,234-", -1234],
    ["1234.00", 1234],
    [" 980 ", 980],
    ["999,999,999", 999999999],
    // 円記号の後ろの符号（表計算ソフトの通貨の書式の負の数）
    ["¥-1,234", -1234],
    ["￥-1,234", -1234],
    ["¥−500", -500],
    ["\\-500", -500],
    ["-¥1,234", -1234],
    ["¥1,234-", -1234],
    // 頭の「+」（入金・返金を「+1,234」と書く明細・家計簿アプリ）
    ["+1,234", 1234],
    ["＋1,234", 1234],
    ["+1234円", 1234],
    ["¥+1,234", 1234],
    ["+¥1,234", 1234],
  ])("%s → %d", (raw, want) => expect(parseAmount(raw)).toBe(want));

  it.each(["", "abc", "12.5", "1,23", "1234567890", "0000111122223333", "1,000,000,000", "--1", "¥--1", "¥-", "+", "++1", "+-1", "-+1"])("読まない: %s", (raw) => expect(parseAmount(raw)).toBeNull());
});

describe("日付の書き方", () => {
  it.each([
    ["2026/10/03", "2026-10-03"],
    ["2026-10-03", "2026-10-03"],
    ["2026.10.3", "2026-10-03"],
    ["20261003", "2026-10-03"],
    ["2026年10月3日", "2026-10-03"],
    ["２０２６／１０／０３", "2026-10-03"],
    ["2026/10/03 12:34", "2026-10-03"],
    ["2026/10/03(土)", "2026-10-03"],
    ["令和8年10月3日", "2026-10-03"],
    ["R8.10.3", "2026-10-03"],
    ["r8/10/03", "2026-10-03"],
    ["平成31年4月30日", "2019-04-30"],
    ["令和元年5月1日", "2019-05-01"],
    ["26/10/03", "2026-10-03"],
    ["10/3/2026", "2026-10-03"],
  ])("%s → %s", (raw, want) => expect(parseDate(raw)?.date).toBe(want));

  // 日が1桁・時が2桁のとき、空白を取ると「1 12:00」が「112:00」になり、日を「11」と読んでいた
  it.each([
    ["2026/10/1 12:00", "2026-10-01"],
    ["2026/10/3 19:05", "2026-10-03"],
    ["2026/10/4 12:00", "2026-10-04"],
    ["2026/10/2 9:05:30", "2026-10-02"],
    ["2026/10/03(土) 12:34", "2026-10-03"],
    ["2026-10-03T12:34:56", "2026-10-03"],
  ])("日付と時刻が1つの欄: %s → %s", (raw, want) => expect(parseDate(raw)?.date).toBe(want));

  it("年の無い月日は手がかりの年で補い、補ったことを返す", () => {
    expect(parseDate("10/03")).toBeNull();
    expect(parseDate("10/03", 2026)).toEqual({ date: "2026-10-03", yearGuessed: true });
    expect(parseDate("10月3日", 2025)).toEqual({ date: "2025-10-03", yearGuessed: true });
  });

  it.each(["2026/02/30", "2026/13/01", "1985/01/01", "2026/10", "abc", "20261340"])("読まない: %s", (raw) => expect(parseDate(raw, 2026)).toBeNull());

  it("支払月", () => {
    expect(parseYearMonth("2026年11月")).toBe("2026-11");
    expect(parseYearMonth("2026/11")).toBe("2026-11");
    expect(parseYearMonth("202611")).toBe("2026-11");
    expect(parseYearMonth("2026/11/10")).toBe("2026-11");
    expect(parseYearMonth("2026年11月支払")).toBe("2026-11");
    expect(parseYearMonth("11月", 2026)).toBe("2026-11");
    expect(parseYearMonth("11月")).toBeNull();
    expect(parseYearMonth("2026年13月")).toBeNull();
  });
});

describe("支払い方法・利用者", () => {
  it.each([
    ["1回払い", { kind: "lump" }],
    ["１回", { kind: "lump" }],
    ["一括", { kind: "lump" }],
    ["分割3回", { kind: "installment", count: 3 }],
    ["3回", { kind: "installment", count: 3 }],
    ["12回払い", { kind: "installment", count: 12 }],
    ["3回中2回目", { kind: "installment", count: 3, index: 2 }],
    ["2/3", { kind: "installment", count: 3, index: 2 }],
    ["リボ", { kind: "revolving" }],
    ["ﾘﾎﾞ払い", { kind: "revolving" }],
    ["ボーナス一括", { kind: "bonus" }],
  ])("%s", (raw, want) => expect(parsePlan(raw)).toEqual(want));

  it("読めない回数は null", () => {
    expect(parsePlan("")).toBeNull();
    expect(parsePlan("その他")).toBeNull();
    expect(parsePlan("999回")).toBeNull();
  });

  it("利用者は本人・家族だけを読み、名前は読まない", () => {
    expect(parseUser("ご本人")).toBe("self");
    expect(parseUser("家族カード")).toBe("family");
    expect(parseUser("ヤマダ ハナコ")).toBeNull();
  });
});

describe("文字のそろえ方・文字コード・CSV", () => {
  it("全角・半角・カナ", () => {
    expect(nfkc("ｾﾌﾞﾝｲﾚﾌﾞﾝ　ＡＢＣ１２３")).toBe("セブンイレブン ABC123");
    expect(foldKana("ちょっと")).toBe("チヨツト");
    expect(looseKey("ご利用 日")).toBe(looseKey("ゴ利用日"));
    expect(looseKey("ご利用・金額（円）")).toBe("ゴ利用金額円");
  });

  it("BOM・UTF-8・Shift_JIS・UTF-16 を見分ける", () => {
    const enc = new TextEncoder();
    expect(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, ...enc.encode("日付")]))).toEqual({ text: "日付", encoding: "utf-8-bom" });
    expect(decodeText(enc.encode("日付"))).toEqual({ text: "日付", encoding: "utf-8" });
    expect(decodeText(Uint8Array.from([0x93, 0xfa, 0x95, 0x74]))).toEqual({ text: "日付", encoding: "shift_jis" });
    expect(decodeText(Uint8Array.from([0xff, 0xfe, 0xe5, 0x65, 0xd8, 0x4e]))).toEqual({ text: "日付", encoding: "utf-16le" });
    expect(decodeText(Uint8Array.from([0xfe, 0xff, 0x65, 0xe5, 0x4e, 0xd8]))).toEqual({ text: "日付", encoding: "utf-16be" });
  });

  it("二重引用符・欄の中の改行とカンマ・空の行", () => {
    const r = parseCsv('a,"b,c","d ""e"""\r\n\r\n"x\ny",2\n');
    expect(r.cells).toEqual([
      ["a", "b,c", 'd "e"'],
      ["x\ny", "2"],
    ]);
    expect(r.lines).toEqual([1, 3]);
  });

  it("タブ区切りも読む", () => {
    expect(parseCsv("a\tb\n1\t2\n").cells).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("行・列の上限を超えたら止める", () => {
    expect(() => parseCsv("a\n".repeat(30), { maxRows: 10, maxCells: 10, maxCellChars: 10 })).toThrow();
    expect(() => parseCsv(`${"a,".repeat(20)}\n`, { maxRows: 10, maxCells: 10, maxCellChars: 10 })).toThrow();
  });
});
