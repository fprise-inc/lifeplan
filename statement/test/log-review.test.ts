import { describe, expect, it } from "vitest";
import { addRule, applyDecisions, classify, createImport, DecisionError, emptyLog, forgetEntry, learnFromDecisions, merchantKey, readLog, readStatement, reviewList, sameAsOtherAccount, unknownMerchants, type StatementLog } from "../src/index.ts";
import { BASE_MONTH, buildLog, HOUSEHOLD, read, SELF, SPOUSE } from "./helpers.ts";

const classified = (log: StatementLog) => classify({ log, household: HOUSEHOLD, baseMonth: BASE_MONTH, office: [] });

describe("取り込みの記録（世帯ファイルの本文の区画 statements）", () => {
  it("同じファイルは2回取り込まない（元のファイルの指紋で見分ける）", async () => {
    const out = await read("card-sjis-2026-05.csv", "card");
    const base = { ...emptyLog(), accounts: [{ id: "a", kind: "card" as const, label: "A", owner: SELF }] };
    const imp = createImport(base, out, { id: "i1", account: "a", at: "2026-10-20T10:00:00+09:00" });
    expect(imp).not.toBeNull();
    expect(imp?.period).toEqual({ from: "2026-04-20", to: "2026-05-25" });
    expect(imp?.rows[0]).toMatchObject({ id: "r2", key: merchantKey("ｶｸｳﾃﾞﾝｷ ﾎﾝﾃﾝ") });
    const log = { ...base, imports: [imp as NonNullable<typeof imp>] };
    expect(createImport(log, out, { id: "i2", account: "a", at: "2026-10-20T10:00:00+09:00" })).toBeNull();
  });

  it("明細の期間は FP が直せる", async () => {
    const out = await read("card-sjis-2026-05.csv", "card");
    const imp = createImport(emptyLog(), out, { id: "i1", account: "a", at: "x", period: { from: "2026-05-01", to: "2026-05-31" } });
    expect(imp?.period).toEqual({ from: "2026-05-01", to: "2026-05-31" });
  });

  it("保存の形を読み戻すと同じになる（JSON の往復）", async () => {
    const log = await buildLog([
      { name: "card-year-utf8bom.csv", kind: "card", account: "cardA", owner: SELF },
      { name: "bank-utf8.csv", kind: "bank", account: "bank", owner: null },
    ]);
    const withRules = addRule({ ...log, styles: { [SELF]: ["employee", "selfEmployed"] } }, { id: "r1", match: { category: "communication" }, owner: SPOUSE, bucket: "business", share: "0.6", at: "2026-10-21T00:00:00+09:00" });
    const json = JSON.parse(JSON.stringify(withRules));
    expect(readLog(json)).toEqual(withRules);
  });

  it("長い店の名前・メモ・分類の行も、読み戻したときに消えない（取り込むときに保存の上限で切る）", async () => {
    const long = `架空商店${"あ".repeat(250)}`;
    const csv = `日付,内容,金額,大項目,メモ\n2026/10/01,${long},-1000,${"食".repeat(70)},${"メ".repeat(250)}\n2026/10/02,架空カフェ,-500,食費,x\n`;
    const out = await readStatement(new TextEncoder().encode(csv), { kind: "app" });
    if (!out.ok) throw new Error(JSON.stringify(out.issues));
    const base: StatementLog = { ...emptyLog(), accounts: [{ id: "a", kind: "app", label: "A", owner: null }] };
    const imp = createImport(base, out, { id: "i1", account: "a", at: "2026-10-20T10:00:00+09:00" });
    if (imp === null) throw new Error("同じファイル");
    const log: StatementLog = { ...base, imports: [imp] };
    const row = imp.rows[0];
    expect(row?.merchant.length).toBe(200);
    expect(row?.memo?.length).toBe(200);
    expect(row?.sourceCategory?.length).toBe(60);
    expect(row?.key).toBe(merchantKey(row?.merchant ?? ""));
    expect(readLog(JSON.parse(JSON.stringify(log)))).toEqual(log);
  });

  it("形の合わないものは捨てて読む（返ってきた本文を信用しない）", () => {
    const bad = {
      version: 1,
      accounts: [{ id: "a", kind: "card", label: "A", owner: null }, { id: "b", kind: "weird", label: "B" }, "x"],
      imports: [
        {
          id: "i",
          at: "x",
          account: "a",
          file: { sha256: "sha256:00", bytes: 10 },
          reader: { id: "csv", version: 1 },
          format: { fingerprint: "f", mapping: { headerRow: 0, columns: { date: 0, merchant: 1, amount: 2, bogus: 9 }, sign: "x" }, source: "x" },
          period: { from: "2026-01-01", to: "2026-01-31" },
          rows: [
            { id: "r1", line: 1, date: "2026-01-05", merchant: "架空", amount: 100, category: "nope", bucket: "nope", plan: { kind: "installment", count: 500 } },
            { id: "r2", line: 2, date: "2026/01/05", merchant: "架空", amount: 100 },
            { id: "r3", line: 3, date: "2026-01-06", merchant: "架空", amount: 1.5 },
          ],
        },
        { id: "j" },
      ],
      rules: [{ id: "r", match: { key: "A" }, bucket: "business", at: "x" }, { id: "s", match: {}, bucket: "household", at: "x" }],
      applied: [{ nope: true }],
      styles: { m: ["employee", "boss"] },
    };
    const log = readLog(bad);
    expect(log.accounts.map((a) => a.id)).toEqual(["a"]);
    expect(log.imports).toHaveLength(1);
    expect(log.imports[0]?.rows.map((r) => r.id)).toEqual(["r1"]);
    expect(log.imports[0]?.rows[0]).not.toHaveProperty("category");
    expect(log.imports[0]?.rows[0]).not.toHaveProperty("plan");
    expect(log.imports[0]?.format.mapping).toEqual({ headerRow: 0, columns: { date: 0, merchant: 1, amount: 2 }, sign: "expensePositive" });
    expect(log.imports[0]?.format.source).toBe("guessed");
    expect(log.rules.map((r) => r.id)).toEqual(["r"]);
    expect(log.applied).toEqual([]);
    expect(log.styles).toEqual({ m: ["employee"] });
    expect(readLog(null)).toEqual(emptyLog());
    expect(readLog("x")).toEqual(emptyLog());
  });
});

describe("迷う行の一覧と、FP が決めたこと", () => {
  it("迷う行を重い印から並べ、分からない店は店ごとにまとめる", async () => {
    const log = await buildLog([{ name: "bank-utf8.csv", kind: "bank", account: "bank", owner: SELF }]);
    const rows = classified(log);
    const list = reviewList(rows);
    expect(list[0]?.reasons[0]).toBe("cardPaymentKept");
    expect(list.map((x) => x.merchant)).toContain("振込（相手の名前は残しません）");
    expect(list.every((x) => x.reasonText !== "")).toBe(true);
    const unknown = unknownMerchants(rows);
    expect(unknown).toEqual([{ key: merchantKey("振込（相手の名前は残しません）"), label: "振込（相手の名前は残しません）", count: 1, total: 20000, from: "2026-04-05", to: "2026-04-05", rows: [expect.objectContaining({ importId: log.imports[0]?.id })] }]);
  });

  it("決めたことを行に書き、迷う行から外す。null は取り消し。事業でない区分では割合を持たない", async () => {
    const log = await buildLog([{ name: "card-year-utf8bom.csv", kind: "card", account: "cardA", owner: SPOUSE }]);
    const imp = log.imports[0] as StatementLog["imports"][number];
    const mystery = imp.rows.find((r) => r.merchant === "架空の謎の店") as StatementLog["imports"][number]["rows"][number];
    const at = "2026-10-21T10:00:00+09:00";
    const next = applyDecisions(log, [{ importId: imp.id, rowId: mystery.id, category: "recreation", bucket: "business", share: "0.5" }], at);
    const row = next.imports[0]?.rows.find((r) => r.id === mystery.id);
    expect(row).toMatchObject({ category: "recreation", bucket: "business", share: "0.5", decidedAt: at });
    const c = classified(next).find((r) => r.row.id === mystery.id);
    expect(c).toMatchObject({ review: false, parts: { business: 2250, household: 2250 } });
    const changed = applyDecisions(next, [{ importId: imp.id, rowId: mystery.id, bucket: "household" }], at);
    expect(changed.imports[0]?.rows.find((r) => r.id === mystery.id)).not.toHaveProperty("share");
    const undone = applyDecisions(changed, [{ importId: imp.id, rowId: mystery.id, category: null, bucket: null }], at);
    const u = undone.imports[0]?.rows.find((r) => r.id === mystery.id);
    expect(u).not.toHaveProperty("category");
    expect(u).not.toHaveProperty("decidedAt");
    expect(() => applyDecisions(log, [{ importId: imp.id, rowId: mystery.id, bucket: "business", share: "60%" }], at)).toThrow(DecisionError);
  });

  it("項目を直したら店の鍵で覚える辞書の行を作る（同梱と同じ答えは覚えない・年会費は年1回の印つき）", async () => {
    const log = await buildLog([{ name: "card-year-utf8bom.csv", kind: "card", account: "cardA", owner: SELF }]);
    const imp = log.imports[0] as StatementLog["imports"][number];
    const id = (m: string) => (imp.rows.find((r) => r.merchant.startsWith(m)) as { id: string }).id;
    const entries = learnFromDecisions(
      log,
      [
        { importId: imp.id, rowId: id("架空の謎の店"), category: "recreation" },
        { importId: imp.id, rowId: id("あおば-マート"), category: "food" },
        { importId: imp.id, rowId: id("架空リボショップ"), category: "cardFee" },
        { importId: imp.id, rowId: id("架空ベーカリー"), bucket: "oneOff" },
      ],
      [],
      "2026-10-21T10:00:00Z",
      "m1",
    );
    expect(entries).toEqual([
      { key: merchantKey("架空の謎の店"), category: "recreation", at: "2026-10-21T10:00:00Z", by: "m1" },
      { key: merchantKey("架空リボショップ"), category: "cardFee", annual: true, at: "2026-10-21T10:00:00Z", by: "m1" },
    ]);
    // 覚えた辞書は次の仕分けで使う（別の世帯でも）
    const other = await buildLog([{ name: "card-year-utf8bom.csv", kind: "card", account: "x", owner: null }]);
    const rows = classify({ log: other, household: HOUSEHOLD, baseMonth: BASE_MONTH, office: entries });
    expect(rows.find((r) => r.row.merchant === "架空の謎の店")).toMatchObject({ category: "recreation", categorySource: "office", review: false });
    // 消した行は使わない
    const forgot = classify({ log: other, household: HOUSEHOLD, baseMonth: BASE_MONTH, office: [...entries, forgetEntry(merchantKey("架空の謎の店"), "2026-10-22T00:00:00Z")] });
    expect(forgot.find((r) => r.row.merchant === "架空の謎の店")?.category).toBeNull();
  });

  it("世帯の決まりの割合が読めなければ止める", () => {
    expect(() => addRule(emptyLog(), { id: "r", match: { category: "communication" }, bucket: "business", share: "abc", at: "x" })).toThrow(DecisionError);
  });
});

describe("同じ明細を別の口座に取り込もうとしたときの知らせ（0180 の6）", () => {
  type R = { date: string; merchant: string; amount: number };
  const months = (n: number, day: string, merchant: string, amount: number): R[] => Array.from({ length: n }, (_, i) => ({ date: `2026-${String(i + 1).padStart(2, "0")}-${day}`, merchant, amount }));
  const logWith = (rows: R[], include = true): StatementLog => ({
    ...emptyLog(),
    accounts: [
      { id: "a", kind: "card", label: "ご本人のカード", owner: SELF },
      { id: "b", kind: "card", label: "配偶者のカード", owner: SPOUSE },
    ],
    imports: [
      {
        id: "imp-a",
        kind: "statement",
        at: "2026-10-20T10:00:00+09:00",
        account: "a",
        file: { sha256: "sha256:a", bytes: 1 },
        reader: { id: "csv", version: 1 },
        format: { fingerprint: "sha256:f", mapping: { headerRow: 0, columns: { date: 0, merchant: 1, amount: 2 }, sign: "expensePositive" }, source: "fp" },
        period: { from: "2026-01-01", to: "2026-06-30" },
        rows: rows.map((r, i) => ({ line: i + 1, id: `r${i + 1}`, key: merchantKey(r.merchant), ...r })),
        include,
      },
    ],
  });
  const base = [...months(6, "05", "ひかりスーパー みなみ店", 30000), ...months(6, "20", "XYZ携帯", 8800)];

  it("使った日・金額・店がほとんど（8割以上・3行以上）同じなら、どの口座と何件同じかを返す（店の名前の書き方の揺れは店の鍵でそろえる）", () => {
    const log = logWith(base);
    expect(sameAsOtherAccount(log, base, "b")).toEqual({ account: "a", matched: 12, rows: 12 });
    // 保存し直して店の名前の空白が変わった・1行だけ違う
    const resaved = base.map((r, i) => (i === 0 ? { ...r, amount: 31000 } : { ...r, merchant: r.merchant.replace(" ", "　") }));
    expect(sameAsOtherAccount(log, resaved, "b")).toEqual({ account: "a", matched: 11, rows: 12 });
    // 長い明細の一部（同じカードの1か月分）でも知らせる
    expect(sameAsOtherAccount(log, base.filter((r) => r.date.startsWith("2026-0") && Number(r.date.slice(5, 7)) <= 2), "b")).toEqual({ account: "a", matched: 4, rows: 4 });
  });

  it("同じ口座・家族のカードで同じ店の行が少し重なるだけ・2行以下・外した取り込みは知らせない", () => {
    const log = logWith(base);
    expect(sameAsOtherAccount(log, base, "a")).toBeNull();
    // 配偶者のカード: 同じ日に同じ店で同じ額が2回あるだけ（残りは違う）
    const spouse = [...base.slice(0, 2), ...months(6, "12", "架空ドラッグ", 2000), ...months(4, "25", "架空書店", 1500)];
    expect(sameAsOtherAccount(log, spouse, "b")).toBeNull();
    expect(sameAsOtherAccount(log, base.slice(0, 2), "b")).toBeNull();
    // 同じ行は1回だけ数える（取り込もうとしている明細に同じ行が2つあっても、ある口座の1行とだけ対にする）
    expect(sameAsOtherAccount(log, [base[0]!, base[0]!, base[0]!, base[1]!], "b")).toBeNull();
    expect(sameAsOtherAccount(logWith(base, false), base, "b")).toBeNull();
  });
});
