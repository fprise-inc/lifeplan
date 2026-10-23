import { describe, expect, it } from "vitest";
import { forgetEntry, learnEntry, lookup, lookupBuiltin, lookupSourceCategory, merchantKey, mergeEntries, officeIndex, readEntry, type DictionaryEntry } from "../src/index.ts";

describe("店の名前をそろえる", () => {
  it.each([
    ["セブン－イレブン　渋谷一丁目店", "セブンイレブン"],
    ["ｾﾌﾞﾝｲﾚﾌﾞﾝ ｶｸｳｴｷﾏｴﾃﾝ", "セブンイレブン"],
    ["PAYPAY*架空カフェ", "架空カフエ"],
    ["ＰａｙＰａｙ＊架空カフェ", "架空カフエ"],
    ["SQ *架空パン", "架空パン"],
    ["楽天ペイ 架空書店", "架空書店"],
    ["ID ローソン 架空店", "ローソン"],
    ["d払い ファミリーマート", "フアミリーマート"],
    ["ENEOS 2", "ENEOS"],
    ["マツモトキヨシ #1234", "マツモトキヨシ"],
    ["ユニクロ 架空店", "ユニクロ"],
    ["自動車税(架空県)", "自動車税架空県"],
    ["NTTドコモ", "NTTドコモ"],
    ["ちょっとカフェ", "チヨツトカフエ"],
  ])("%s → %s", (raw, want) => expect(merchantKey(raw)).toBe(want));

  it("前置きだけ・空の名前は空にしない／長さの上限", () => {
    expect(merchantKey("PAYPAY")).toBe("PAYPAY");
    expect(merchantKey("")).toBe("");
    expect(merchantKey("あ".repeat(100)).length).toBe(64);
  });
});

describe("同梱の辞書", () => {
  const cat = (raw: string, bank = false) => lookupBuiltin(merchantKey(raw), bank)?.category ?? null;
  it.each([
    ["セブン-イレブン 架空店", "food"],
    ["ｾﾌﾞﾝｲﾚﾌﾞﾝ", "food"],
    ["イオン 架空SC店", "food"],
    ["マツモトキヨシ 架空店", "dailyGoods"],
    ["ニトリ 架空店", "furniture"],
    ["ヤマダデンキ 架空店", "furniture"],
    ["東京電力エナジーパートナー", "utilities"],
    ["水道局 架空市", "utilities"],
    ["NTTドコモ", "communication"],
    ["ソフトバンク", "communication"],
    ["ENEOS 架空SS", "car"],
    ["ｴﾈｵｽ ｶｸｳSS", "car"],
    ["架空クリニック", "medical"],
    ["架空ホテル", "lumpSum"],
    ["年会費", "cardFee"],
    ["家賃 架空不動産", "housing"],
    ["固定資産税 架空市", "housing"],
    ["住民税 架空市", "tax"],
    ["架空学習塾", "education"],
    ["架空生命保険", "insurance"],
    ["ATM 架空駅前", "cash"],
    ["給与 架空商事", "income"],
    ["ライフ", "food"],
  ])("%s → %s", (raw, want) => expect(cat(raw)).toBe(want));

  it("分からない店は null", () => {
    expect(cat("架空の謎の店")).toBeNull();
  });

  it("カード会社への引き落としは銀行の明細だけで見る（カードの明細の「…カード」は振替にしない）", () => {
    expect(lookupBuiltin(merchantKey("ミツイスミトモカード"), true)).toMatchObject({ category: "transfer", flags: ["cardPayment"], issuer: "smbc" });
    expect(lookupBuiltin(merchantKey("ラクテンカード"), true)?.issuer).toBe("rakuten");
    expect(lookupBuiltin(merchantKey("カード 架空"), true)).toMatchObject({ category: "transfer", flags: ["cardPayment"] });
    expect(lookupBuiltin(merchantKey("カード 架空"), true)?.issuer).toBeUndefined();
    expect(lookupBuiltin(merchantKey("ライフカード"), true)?.issuer).toBe("life");
    expect(lookupBuiltin(merchantKey("ライフカード"), false)).toBeNull();
  });

  it("年1回の印・計算で出す税の印", () => {
    expect(lookupBuiltin(merchantKey("自動車税 架空県"), false)?.flags).toEqual(["annual"]);
    expect(lookupBuiltin(merchantKey("国民健康保険料 架空市"), false)?.flags).toEqual(["engineTax"]);
  });

  it("家計簿アプリの分類の言葉", () => {
    expect(lookupSourceCategory("食費")).toBe("food");
    expect(lookupSourceCategory("水道・光熱費")).toBe("utilities");
    expect(lookupSourceCategory("趣味・娯楽")).toBe("recreation");
    expect(lookupSourceCategory("カード引き落とし")).toBe("transfer");
    expect(lookupSourceCategory("未分類")).toBeNull();
    expect(lookupSourceCategory(undefined)).toBeNull();
  });
});

describe("覚えた辞書（事務所データ）", () => {
  const e = (key: string, category: DictionaryEntry["category"], at: string, extra: Partial<DictionaryEntry> = {}): DictionaryEntry => ({ key, category, at, ...extra });

  it("引き当ての順番: 覚えた辞書 → 家計簿アプリの分類 → 同梱の辞書（カードの引き落としは分類より強い）", () => {
    const office = officeIndex([e(merchantKey("架空の謎の店"), "recreation", "2026-10-01T00:00:00Z"), e(merchantKey("セブンイレブン"), "allowance", "2026-10-01T00:00:00Z")]);
    expect(lookup(merchantKey("架空の謎の店"), { office, bank: false })?.source).toBe("office");
    expect(lookup(merchantKey("セブンイレブン 架空店"), { office, bank: false })).toMatchObject({ category: "allowance", source: "office" });
    expect(lookup(merchantKey("イオン"), { office, sourceCategory: "日用品", bank: false })).toMatchObject({ category: "dailyGoods", source: "sourceCategory" });
    expect(lookup(merchantKey("ミツイスミトモカード"), { office, sourceCategory: "食費", bank: true })?.category).toBe("transfer");
  });

  it("共有の PC どうしでまとめる: 新しい日時が勝ち、同じ日時なら消した印、次に名簿の ID の大きいほう", () => {
    const merged = mergeEntries([
      e("A", "food", "2026-10-01T00:00:00Z", { by: "m1" }),
      e("A", "recreation", "2026-10-02T00:00:00Z", { by: "m2" }),
      e("B", "food", "2026-10-01T00:00:00Z", { by: "m2" }),
      e("B", "social", "2026-10-01T00:00:00Z", { by: "m1" }),
      e("C", "food", "2026-10-01T00:00:00Z"),
      forgetEntry("C", "2026-10-01T00:00:00Z"),
    ]);
    expect(merged.map((x) => [x.key, x.category, x.removed === true])).toEqual([
      ["A", "recreation", false],
      ["B", "food", false],
      ["C", "otherLiving", true],
    ]);
    // 並べ替えても同じ結果
    expect(mergeEntries([...merged].reverse())).toEqual(merged);
    expect(officeIndex(merged).has("C")).toBe(false);
  });

  it("覚える行を作る: 同梱の辞書と同じ答えは覚えない・覚えた違う答えは消す・同じなら何もしない", () => {
    const empty = officeIndex([]);
    expect(learnEntry(merchantKey("セブンイレブン"), "food", "2026-10-03T00:00:00Z", { office: empty })).toBeNull();
    expect(learnEntry(merchantKey("架空の謎の店"), "recreation", "2026-10-03T00:00:00Z", { office: empty, by: "m1" })).toEqual({ key: "架空ノ謎ノ店", category: "recreation", at: "2026-10-03T00:00:00Z", by: "m1" });
    const office = officeIndex([e(merchantKey("セブンイレブン"), "allowance", "2026-10-01T00:00:00Z")]);
    expect(learnEntry(merchantKey("セブンイレブン"), "food", "2026-10-03T00:00:00Z", { office })).toMatchObject({ key: "セブンイレブン", removed: true });
    expect(learnEntry(merchantKey("セブンイレブン"), "allowance", "2026-10-03T00:00:00Z", { office })).toBeNull();
    expect(learnEntry("", "food", "2026-10-03T00:00:00Z", { office })).toBeNull();
  });

  it("覚えた辞書の行を信用しない形で読む", () => {
    expect(readEntry({ key: "架空ノ謎ノ店", category: "food", at: "2026-10-01T00:00:00Z", by: "m1", extra: 1 })).toEqual({ key: "架空ノ謎ノ店", category: "food", at: "2026-10-01T00:00:00Z", by: "m1" });
    // そろえた形でない鍵（ひらがな・空白）は読まない
    expect(readEntry({ key: "架空の謎の店", category: "food", at: "2026-10-01T00:00:00Z" })).toBeNull();
    expect(readEntry({ key: "架空 の店", category: "food", at: "2026-10-01T00:00:00Z" })).toBeNull();
    expect(readEntry({ key: "A", category: "unknownCategory", at: "2026-10-01T00:00:00Z" })).toBeNull();
    expect(readEntry({ key: "A", category: "food", at: "yesterday" })).toBeNull();
    expect(readEntry({ key: "A".repeat(65), category: "food", at: "2026-10-01T00:00:00Z" })).toBeNull();
    expect(readEntry(null)).toBeNull();
  });
});
