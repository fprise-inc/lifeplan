import { describe, expect, it } from "vitest";
import { BUILTIN, CARD_ISSUERS, forgetEntry, learnEntry, lookup, lookupBuiltin, lookupSourceCategory, merchantKey, mergeEntries, officeIndex, readEntry, type DictionaryEntry } from "../src/index.ts";

describe("店の名前をそろえる", () => {
  // 店の名前は架空（実在のチェーンの名前は使わない）。決済の前置き（PAYPAY*・SQ*・楽天ペイ・ID・d払い）は、取る決まりを確かめるためそのまま
  it.each([
    ["あおば－マート　みどり一丁目店", "アオバマート"],
    ["ｱｵﾊﾞﾏｰﾄ ﾐﾄﾞﾘｴｷﾏｴﾃﾝ", "アオバマート"],
    ["PAYPAY*架空カフェ", "架空カフエ"],
    ["ＰａｙＰａｙ＊架空カフェ", "架空カフエ"],
    ["SQ *架空パン", "架空パン"],
    ["楽天ペイ 架空書店", "架空書店"],
    ["ID ひかりマート みなみ店", "ヒカリマート"],
    ["d払い フォレストマート", "フオレストマート"],
    ["MIDORI 2", "MIDORI"],
    ["みどりドラッグ #1234", "ミドリドラツグ"],
    ["そよかぜクリーニング 駅前店", "ソヨカゼクリーニング"],
    ["自動車税(架空県)", "自動車税架空県"],
    ["XYZ携帯", "XYZ携帯"],
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
  // 一般の言葉（含む・同じ）で決まる架空の店
  it.each([
    ["あおば－マート みどり店", "food"],
    ["ｱｵﾊﾞﾏｰﾄ", "food"],
    ["ひかりスーパー 駅前店", "food"],
    ["みどりドラッグ みなみ店", "dailyGoods"],
    ["ﾐﾄﾞﾘﾄﾞﾗｯｸﾞ ﾐﾅﾐﾃﾝ", "dailyGoods"],
    ["みどり電力", "utilities"],
    ["水道局 架空市", "utilities"],
    ["XYZ携帯", "communication"],
    ["みどりガソリン みなみSS", "car"],
    ["ﾐﾄﾞﾘｶﾞｿﾘﾝ ﾐﾅﾐSS", "car"],
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
  ])("%s → %s", (raw, want) => expect(cat(raw)).toBe(want));

  // 店の名前で決まる言葉（店の鍵がその言葉で始まる）は、辞書の言葉そのものに架空の支店名を付けて引く（テストに店の名前を書かない）
  it.each(["food", "dailyGoods", "furniture", "clothing", "utilities", "communication", "transport", "car"] as const)("店の名前の言葉＋支店名 → %s", (want) => {
    const names = BUILTIN.filter(([, c, m]) => c === want && m === undefined).map(([p]) => p);
    expect(names.length).toBeGreaterThan(0);
    for (const p of names) {
      expect(cat(p)).toBe(want);
      // 決済の前置きと同じ言葉（「モバイルSUICA」など）は、後ろに区切りがあると前置きとして取るので、支店名を付けて引かない
      const branch = merchantKey(`${p} みなみ店`);
      if (branch !== merchantKey("みなみ店")) expect(cat(`${p} みなみ店`)).toBe(want);
    }
  });

  it("名前と同じときだけの言葉（exact）は、その名前だけ。後ろに続く名前には当てない", () => {
    const exact = BUILTIN.filter(([, , m]) => m === "exact");
    expect(exact.length).toBeGreaterThan(0);
    for (const [p, c] of exact) {
      expect(cat(p)).toBe(c);
      expect(cat(`${p}ミナミ`)).toBeNull();
    }
  });

  it("分からない店は null", () => {
    expect(cat("架空の謎の店")).toBeNull();
  });

  it("カード会社への引き落としは銀行の明細だけで見る（カードの明細の「…カード」は振替にしない）", () => {
    // カード会社の言葉（銀行の明細に出る形）は同梱の辞書のものをそのまま使う
    for (const ci of CARD_ISSUERS) {
      for (const p of ci.patterns) {
        expect(lookupBuiltin(merchantKey(p), true)).toMatchObject({ category: "transfer", flags: ["cardPayment"], issuer: ci.id });
        expect(lookupBuiltin(merchantKey(p), false)?.category).not.toBe("transfer");
      }
    }
    expect(lookupBuiltin(merchantKey("カード 架空"), true)).toMatchObject({ category: "transfer", flags: ["cardPayment"] });
    expect(lookupBuiltin(merchantKey("カード 架空"), true)?.issuer).toBeUndefined();
    expect(lookupBuiltin(merchantKey("アオバカード"), true)).toMatchObject({ category: "transfer", flags: ["cardPayment"] });
    expect(lookupBuiltin(merchantKey("アオバカード"), false)).toBeNull();
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

  it("大項目の言葉の違いを吸収する（エンタメ・クルマ・大型出費・税と社会保険）", () => {
    expect(lookupSourceCategory("エンタメ")).toBe("recreation");
    expect(lookupSourceCategory("クルマ")).toBe("car");
    expect(lookupSourceCategory("大型出費")).toBe("lumpSum");
    expect(lookupSourceCategory("税・社会保険")).toBe("tax");
    expect(lookupSourceCategory("健康・医療")).toBe("medical");
    expect(lookupSourceCategory("保険")).toBe("insurance");
  });

  it.each([
    // 現金・カード: 引き落とし・チャージは除外、引き出し・使途不明金は数える
    ["現金・カード", "カード引き落とし", "transfer"],
    ["現金・カード", "電子マネー", "transfer"],
    ["現金・カード", "チャージ", "transfer"],
    ["現金・カード", "ATM引き出し", "cash"],
    ["現金・カード", "使途不明金", "cash"],
    ["その他", "使途不明金", "cash"],
    // 医療・保険: 病院代・薬代は医療、保険料は保険
    ["医療・保険", "病院代", "medical"],
    ["医療・保険", "薬代", "medical"],
    ["医療・保険", "生命保険", "insurance"],
    ["医療・保険", "医療保険", "insurance"],
    ["健康・医療", "医療費", "medical"],
    ["健康・医療", "フィットネス", "recreation"],
    // 教養・教育: 書籍・新聞雑誌は趣味・娯楽、学費・塾・習いごとは教育
    ["教養・教育", "書籍", "recreation"],
    ["教養・教育", "新聞・雑誌", "recreation"],
    ["教育・教養", "学費", "education"],
    ["教養・教育", "塾", "education"],
    ["教養・教育", "習いごと", "education"],
    ["教養・教育", "習い事", "education"],
    // ほかの大項目の中の組
    ["日用品", "おこづかい", "allowance"],
    ["日用品", "タバコ", "otherLiving"],
    ["住宅", "地震・火災保険", "insurance"],
    ["通信費", "放送視聴料", "recreation"],
    ["交際費", "冠婚葬祭", "lumpSum"],
    // 特別な支出・大型出費の中の家具・家電は家具・家電の店と同じ（3万円以上は家電・家具の買い替えの候補）
    ["特別な支出", "家具・家電", "furniture"],
    ["大型出費", "家電", "furniture"],
    ["大型出費", "家具", "furniture"],
    ["大型出費", "旅行", "lumpSum"],
    ["税・社会保険", "固定資産税", "housing"],
    ["税・社会保険", "健康保険", "tax"],
    // 組に無い中項目は大項目の言葉で
    ["食費", "外食", "food"],
    ["交通費", "電車", "transport"],
    ["通信費", "携帯電話", "communication"],
  ] as const)("（%s, %s）→ %s", (major, sub, want) => expect(lookupSourceCategory(major, sub)).toBe(want));

  it("中項目で決まらない現金・カード、医療・保険、教養・教育は決めない（店の名前の辞書で引き、分からなければ迷う行）", () => {
    expect(lookupSourceCategory("現金・カード")).toBeNull();
    expect(lookupSourceCategory("現金・カード", "その他現金・カード")).toBeNull();
    expect(lookupSourceCategory("医療・保険", "その他")).toBeNull();
    expect(lookupSourceCategory("教養・教育")).toBeNull();
    // 店の名前で決まるときはそちら
    const office = officeIndex([]);
    expect(lookup(merchantKey("ATM 架空駅前"), { office, sourceCategory: "現金・カード", bank: false })).toMatchObject({ category: "cash", source: "builtin" });
    expect(lookup(merchantKey("架空クリニック"), { office, sourceCategory: "医療・保険", bank: false })).toMatchObject({ category: "medical", source: "builtin" });
    expect(lookup(merchantKey("架空の謎の店"), { office, sourceCategory: "現金・カード", bank: false })).toBeNull();
    // 組で決まるときは店の名前の辞書より先（ドラッグストアの薬代は医療）
    expect(lookup(merchantKey("架空ドラッグ"), { office, sourceCategory: "医療・保険", sourceSubCategory: "薬代", bank: false })).toMatchObject({ category: "medical", source: "sourceCategory" });
  });
});

describe("覚えた辞書（事務所データ）", () => {
  const e = (key: string, category: DictionaryEntry["category"], at: string, extra: Partial<DictionaryEntry> = {}): DictionaryEntry => ({ key, category, at, ...extra });

  it("引き当ての順番: 覚えた辞書 → 家計簿アプリの分類 → 同梱の辞書（カードの引き落としは分類より強い）", () => {
    const office = officeIndex([e(merchantKey("架空の謎の店"), "recreation", "2026-10-01T00:00:00Z"), e(merchantKey("ひかりスーパー"), "allowance", "2026-10-01T00:00:00Z")]);
    expect(lookup(merchantKey("架空の謎の店"), { office, bank: false })?.source).toBe("office");
    expect(lookup(merchantKey("ひかりスーパー みなみ店"), { office, bank: false })).toMatchObject({ category: "allowance", source: "office" });
    expect(lookup(merchantKey("あおばマート"), { office, sourceCategory: "日用品", bank: false })).toMatchObject({ category: "dailyGoods", source: "sourceCategory" });
    expect(lookup(merchantKey("アオバカード"), { office, sourceCategory: "食費", bank: true })?.category).toBe("transfer");
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
    expect(learnEntry(merchantKey("ひかりスーパー"), "food", "2026-10-03T00:00:00Z", { office: empty })).toBeNull();
    expect(learnEntry(merchantKey("架空の謎の店"), "recreation", "2026-10-03T00:00:00Z", { office: empty, by: "m1" })).toEqual({ key: "架空ノ謎ノ店", category: "recreation", at: "2026-10-03T00:00:00Z", by: "m1" });
    const office = officeIndex([e(merchantKey("ひかりスーパー"), "allowance", "2026-10-01T00:00:00Z")]);
    expect(learnEntry(merchantKey("ひかりスーパー"), "food", "2026-10-03T00:00:00Z", { office })).toMatchObject({ key: "ヒカリスーパー", removed: true });
    expect(learnEntry(merchantKey("ひかりスーパー"), "allowance", "2026-10-03T00:00:00Z", { office })).toBeNull();
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
