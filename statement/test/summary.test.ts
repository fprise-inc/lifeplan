import { describe, expect, it } from "vitest";
import { applyCandidates, buildCandidates, CATEGORIES, categoryInfo, classify, coveredDays, LIVING_ORDER, emptyLog, merchantKey, monthlyAverage, monthsText, paymentSchedule, summarize, type CandidateHousehold, type StatementAccount, type StatementLog, type StatementRow } from "../src/index.ts";
import { BASE_MONTH, buildLog, HOUSEHOLD, ids, SELF, SPOUSE } from "./helpers.ts";

type RowIn = Partial<StatementRow> & { date: string; merchant: string; amount: number };

function synth(accounts: (StatementAccount & { rows: RowIn[]; period: { from: string; to: string } })[]): StatementLog {
  return {
    ...emptyLog(),
    accounts: accounts.map(({ rows, period, ...a }) => (void rows, void period, a)),
    imports: accounts.map((a, k) => ({
      id: `imp-${a.id}`,
      kind: "statement" as const,
      at: `2026-10-20T10:00:0${k}+09:00`,
      account: a.id,
      file: { sha256: `sha256:${a.id}`, bytes: 1 },
      reader: { id: "csv", version: 1 },
      format: { fingerprint: "sha256:f", mapping: { headerRow: 0, columns: { date: 0, merchant: 1, amount: 2 }, sign: "expensePositive" as const }, source: "fp" as const },
      period: a.period,
      rows: a.rows.map((r, i) => ({ line: i + 1, id: `r${i + 1}`, key: merchantKey(r.merchant), ...r })),
      include: true,
    })),
  };
}

const monthly = (from: number, merchant: string, amount: number, n = 12): RowIn[] =>
  Array.from({ length: n }, (_, i) => {
    const m = ((from - 1 + i) % 12) + 1;
    const y = 2025 + Math.floor((from - 1 + i) / 12);
    return { date: `${y}-${String(m).padStart(2, "0")}-15`, merchant, amount };
  });

const YEAR = { from: "2025-10-01", to: "2026-09-30" };
const summaryOf = (log: StatementLog) => summarize(log, classify({ log, household: HOUSEHOLD, baseMonth: BASE_MONTH, office: [] }));

describe("月平均の出し方", () => {
  it("合計 × 365.25 ÷ 12 ÷ 日数（四捨五入。負も対称）", () => {
    expect(monthlyAverage(360000, 365)).toBe(30021);
    expect(monthlyAverage(-360000, 365)).toBe(-30021);
    expect(monthlyAverage(30000, 91)).toBe(10034);
    expect(monthlyAverage(100, 0)).toBe(0);
    expect(monthsText(365)).toBe("12.0");
    expect(monthsText(91)).toBe("3.0");
    expect(monthsText(357)).toBe("11.7");
  });

  it("期間は重なりを1回だけ数える", () => {
    expect(coveredDays([{ from: "2026-01-01", to: "2026-01-31" }, { from: "2026-01-15", to: "2026-02-28" }, { from: "2026-04-01", to: "2026-04-30" }])).toEqual({ days: 59 + 30, from: "2026-01-01", to: "2026-04-30" });
    expect(coveredDays([{ from: "2026-01-01", to: "2026-01-31" }, { from: "2026-02-01", to: "2026-02-28" }]).days).toBe(59);
    expect(coveredDays([]).days).toBe(0);
  });

  it("口座ごとの期間で割ってから足す（期間の違う明細を混ぜても少なく出ない）", () => {
    const log = synth([
      { id: "a", kind: "card", label: "A", owner: SELF, period: YEAR, rows: monthly(10, "イオン 架空店", 30000) },
      { id: "b", kind: "card", label: "B", owner: SPOUSE, period: { from: "2026-07-01", to: "2026-09-29" }, rows: [{ date: "2026-08-01", merchant: "イオン 架空店", amount: 30000 }] },
    ]);
    const s = summaryOf(log);
    expect(s.coverage.map((c) => c.days)).toEqual([365, 91]);
    expect(s.living).toEqual([{ category: "food", monthly: 30021 + 10034, detail: [{ category: "food", monthly: 30021 + 10034 }] }]);
    expect(s.months).toBe("12.0");
    expect(s.notices.filter((n) => n.code === "S_SHORT_PERIOD" || n.code === "S_VERY_SHORT_PERIOD")).toEqual([]);
  });

  it("基本生活費の内訳にまとめ、住居・教育・保険・車・税は参考の値に、分からない店は「その他」に入れて別にも出す", () => {
    const log = synth([
      {
        id: "a",
        kind: "card",
        label: "A",
        owner: SELF,
        period: YEAR,
        rows: [...monthly(10, "NTTドコモ", 8800), ...monthly(10, "マツモトキヨシ", 2000), ...monthly(10, "架空学習塾", 20000), ...monthly(10, "架空の謎の店", 1000), ...monthly(10, "ENEOS", 6000)],
      },
    ]);
    const s = summaryOf(log);
    const by = Object.fromEntries(s.living.map((l) => [l.category, l.monthly]));
    expect(by).toEqual({ communication: 8806, furniture: monthlyAverage(24000, 365), other: monthlyAverage(12000, 365) });
    expect(s.unknownMonthly).toBe(monthlyAverage(12000, 365));
    expect(s.reference.education).toBe(monthlyAverage(240000, 365));
    expect(s.reference.car).toBe(monthlyAverage(72000, 365));
    expect(s.livingTotal).toBe(8806 + monthlyAverage(24000, 365) + monthlyAverage(12000, 365));
  });

  it("項目から基本生活費の内訳への対応（10費目と仕送り。前の分け方の交通・通信費とその他の消費には入れない）", () => {
    expect(Object.fromEntries(CATEGORIES.filter((c) => c.living !== undefined).map((c) => [c.id, c.living]))).toEqual({
      food: "food",
      dailyGoods: "furniture",
      utilities: "utilities",
      communication: "communication",
      transport: "transit",
      medical: "health",
      clothing: "clothing",
      furniture: "furniture",
      recreation: "recreation",
      allowance: "pocketAndSocial",
      social: "pocketAndSocial",
      otherLiving: "other",
      cash: "other",
    });
    for (const c of CATEGORIES) if (c.living !== undefined) expect(LIVING_ORDER).toContain(c.living);
    expect(LIVING_ORDER).not.toContain("transport");
    expect(LIVING_ORDER).not.toContain("otherConsumption");
    expect(categoryInfo("transport").living).toBe("transit");
  });

  it("家計簿アプリの書き出し（大項目と中項目）から基本生活費の内訳", async () => {
    const log = await buildLog([{ name: "app-subcategory-utf8bom.csv", kind: "app", account: "app", owner: null }]);
    const s = summaryOf(log);
    const by = Object.fromEntries(s.living.map((l) => [l.category, l.detail.map((d) => d.category)]));
    expect(by).toEqual({
      food: ["food"],
      communication: ["communication"],
      transit: ["transport"],
      clothing: ["clothing"],
      health: ["medical"],
      recreation: ["recreation"],
      pocketAndSocial: ["social"],
      // 現金の引き出し・使途不明金と、分からない行（中項目の無い現金・カード）は「その他」
      other: expect.arrayContaining(["cash", "unknown"]),
    });
    expect(s.living.map((l) => l.category)).toEqual(["food", "communication", "transit", "clothing", "health", "recreation", "pocketAndSocial", "other"]);
    // 保険・教育・車は参考の値。カードの引き落とし・電子マネーへのチャージは数えない
    expect(s.reference.insurance).toBeGreaterThan(0);
    expect(s.reference.education).toBeGreaterThan(0);
    expect(s.reference.car).toBeGreaterThan(0);
    const days = s.days;
    expect(s.living.find((l) => l.category === "other")?.monthly).toBe(monthlyAverage(10000 + 2000, days) + monthlyAverage(1000, days));
  });

  it("事業の割合で分けた分は家計から外し、持ち主ごとに別に出す", () => {
    const log = synth([{ id: "w", kind: "card", label: "妻", owner: SPOUSE, period: YEAR, rows: monthly(10, "NTTドコモ", 8800).map((r) => ({ ...r, bucket: "business" as const, share: "0.6", decidedAt: "x" })) }]);
    const s = summaryOf(log);
    expect(s.living[0]).toMatchObject({ category: "communication", monthly: monthlyAverage(12 * 3520, 365) });
    expect(s.outside).toEqual([{ owner: SPOUSE, bucket: "business", monthly: monthlyAverage(12 * 5280, 365) }]);
  });

  it("12か月に満たない期間の注意（3か月未満は強い注意・季節で変わる項目の注意）", () => {
    const short = synth([{ id: "a", kind: "card", label: "A", owner: SELF, period: { from: "2026-08-01", to: "2026-09-29" }, rows: [{ date: "2026-08-12", merchant: "東京電力", amount: 12000 }] }]);
    const s = summaryOf(short);
    expect(s.notices.map((n) => n.code)).toEqual(expect.arrayContaining(["S_VERY_SHORT_PERIOD", "S_SEASONAL"]));
    const half = synth([{ id: "a", kind: "card", label: "A", owner: SELF, period: { from: "2026-04-01", to: "2026-09-30" }, rows: [{ date: "2026-08-12", merchant: "イオン", amount: 12000 }] }]);
    const s2 = summaryOf(half);
    expect(s2.notices.map((n) => n.code)).toContain("S_SHORT_PERIOD");
    expect(s2.notices.map((n) => n.code)).not.toContain("S_SEASONAL");
    expect(summaryOf(emptyLog()).notices[0]?.code).toBe("S_NO_PERIOD");
  });

  it("フィクスチャの1年分: カードの引き落としの除外・二重の行・返品・リボの知らせ", async () => {
    const log = await buildLog([
      { name: "card-year-utf8bom.csv", kind: "card", account: "cardA", owner: SELF },
      { name: "card-sjis-2026-05.csv", kind: "card", account: "cardB", owner: SPOUSE },
      { name: "card-sjis-2026-06.csv", kind: "card", account: "cardB", owner: SPOUSE },
      { name: "bank-utf8.csv", kind: "bank", account: "bank", owner: SELF },
    ]);
    const s = summaryOf(log);
    expect(s.notices.map((n) => n.code)).toEqual(expect.arrayContaining(["S_CARD_PAYMENT_EXCLUDED", "S_DUPLICATE_ROWS", "S_REVOLVING"]));
    expect(s.notices.map((n) => n.code)).not.toContain("S_SHORT_PERIOD");
    // 家賃は住居の参考の値（基本生活費に入れない）
    expect(s.reference.housing).toBe(monthlyAverage(12 * 95000, 353));
    expect(s.living.some((l) => l.category === "food")).toBe(true);
    // カード会社への引き落とし（月60,000円）は基本生活費に入らない
    expect(s.livingTotal).toBeLessThan(200000);
    expect(s.oneOffs.map((o) => o.label)).toEqual(expect.arrayContaining(["自動車税(架空県)", "固定資産税 架空市", "年会費"]));
  });
});

describe("払う月の分け方（使った日と払う月のずれ）", () => {
  it("分割は回数で分け端数は1回目、1回払いは払う月、リボは分からない", () => {
    const log = synth([
      {
        id: "a",
        kind: "card",
        label: "A",
        owner: SELF,
        period: { from: "2026-01-01", to: "2026-03-31" },
        rows: [
          { date: "2026-01-15", merchant: "架空家電", amount: 100000, plan: { kind: "installment", count: 3 }, payMonth: "2026-02" },
          { date: "2026-01-20", merchant: "イオン", amount: 5000, payMonth: "2026-02" },
          { date: "2026-02-20", merchant: "イオン", amount: 3000 },
          { date: "2026-03-01", merchant: "架空リボ", amount: 9000, plan: { kind: "revolving" } },
        ],
      },
    ]);
    const rows = classify({ log, household: HOUSEHOLD, baseMonth: BASE_MONTH, office: [] });
    const { byMonth, unknown } = paymentSchedule(rows);
    expect(Object.fromEntries(byMonth)).toEqual({ "2026-02": 33334 + 5000, "2026-03": 33333 + 3000, "2026-04": 33333 });
    expect(unknown).toBe(1);
  });

  it("何回目かの分かる分割は、前の回の払う月を年をまたいでさかのぼる（月の数が負でも年月の形になる）", () => {
    const log = synth([
      {
        id: "a",
        kind: "card",
        label: "A",
        owner: SELF,
        period: { from: "2025-11-01", to: "2026-01-31" },
        rows: [{ date: "2025-11-10", merchant: "架空家電", amount: 30000, plan: { kind: "installment", count: 3, index: 3 }, payMonth: "2026-02" }],
      },
    ]);
    const rows = classify({ log, household: HOUSEHOLD, baseMonth: BASE_MONTH, office: [] });
    expect(Object.fromEntries(paymentSchedule(rows).byMonth)).toEqual({ "2025-12": 10000, "2026-01": 10000, "2026-02": 10000 });
  });
});

describe("候補", () => {
  const yearLog = () =>
    synth([
      {
        id: "a",
        kind: "card",
        label: "A",
        owner: SELF,
        period: YEAR,
        rows: [
          ...monthly(10, "イオン 架空店", 30000),
          ...monthly(10, "NTTドコモ", 8800),
          { date: "2026-05-08", merchant: "自動車税 架空県", amount: 39500 },
          { date: "2024-03-01", merchant: "架空車検センター", amount: 98000 },
          { date: "2026-03-05", merchant: "架空車検センター", amount: 102000 },
          { date: "2025-11-01", merchant: "架空生命保険 年払", amount: 60000 },
        ],
      },
    ]);

  it("基本生活費が無い世帯には足す候補、年1回の支払いは名前を付けた支出の候補（保険は候補にしない）", () => {
    const s = summaryOf(yearLog());
    const cands = buildCandidates(s, {}, { ref: "stmt-1", baseMonth: BASE_MONTH, newId: ids("c") });
    expect(cands.map((c) => [c.collection, c.op, c.title, c.status])).toEqual([
      ["livingExpenses", "add", "基本生活費（内訳）", "pending"],
      ["periodicExpenses", "add", "車の修理・用品など: 架空車検センター", "pending"],
      ["periodicExpenses", "add", "車の修理・用品など: 自動車税 架空県", "needsReview"],
    ]);
    const living = cands[0]?.value as { mode: string; categories: { category: string; monthly: { value: number; state: string; origin: unknown; estimate: { method: string; basis: string } } }[] };
    expect(living.mode).toBe("byCategory");
    expect(living.categories.map((c) => [c.category, c.monthly.value])).toEqual([
      ["food", 30021],
      ["communication", 8806],
    ]);
    expect(living.categories[0]?.monthly).toMatchObject({ state: "estimated", origin: { kind: "import", ref: "stmt-1" }, estimate: { method: "statementAverage" } });
    expect(living.categories[0]?.monthly.estimate.basis).toContain("2025-10-01〜2026-09-30、12.0か月");
    expect(cands[0]).toMatchObject({ source: "import", sourceRef: "stmt-1", origin: { kind: "import", ref: "stmt-1" }, enabled: true, before: null });
    const shaken = cands[1]?.value as { kind: string; row: string; everyYears: number; from: { at: string }; to: null; amount: { value: number } };
    // 車の候補は車の入力項目の行（種類 car。ライフイベントに出さない）
    expect(shaken).toMatchObject({ kind: "car", row: "cf.expense.lumpSum.car", everyYears: 2, from: { at: "2028-03" }, to: null, amount: { value: 102000 } });
    const carTax = cands[2]?.value as { from: { at: string }; everyYears: number };
    expect(carTax).toMatchObject({ from: { at: "2027-05" }, everyYears: 1 });
    expect(cands[2]?.confidence).toBe("medium");
  });

  it("住まいの修繕の年1回の支払いは、住まいの「修繕・リフォーム」の行の候補（種類 repair。ライフイベントに出さない）", () => {
    const log = synth([
      {
        id: "a",
        kind: "card",
        label: "A",
        owner: SELF,
        period: YEAR,
        rows: [...monthly(10, "イオン 架空店", 30000), { date: "2024-12-10", merchant: "架空管理組合 修繕積立金", amount: 150000 }, { date: "2025-12-10", merchant: "架空管理組合 修繕積立金", amount: 150000 }],
      },
    ]);
    const cands = buildCandidates(summaryOf(log), {}, { ref: "stmt-1", baseMonth: BASE_MONTH, newId: ids("c") });
    const repair = cands.find((c) => c.collection === "periodicExpenses");
    expect(repair?.title).toBe("修繕・リフォーム: 架空管理組合 修繕積立金");
    expect(repair?.value).toMatchObject({ kind: "repair", row: "cf.expense.housing.maintenance", everyYears: 1, to: null });
  });

  it("今の欄の形に合わせる: 内訳なら内訳を置き換え（明細に出ない内訳は残す）、合計なら合計を置き換える", () => {
    const s = summaryOf(yearLog());
    const box = (v: number) => ({ value: v, state: "confirmed" as const, origin: { kind: "manual" } });
    const byCat: CandidateHousehold = { livingExpenses: [{ id: "le1", mode: "byCategory", categories: [{ category: "food", monthly: box(50000) }, { category: "allowance", monthly: box(20000) }] }] };
    const c1 = buildCandidates(s, byCat, { ref: "stmt-1", baseMonth: BASE_MONTH, newId: ids() })[0];
    expect(c1).toMatchObject({ op: "set", item: "livingExpense.categories", target: { object: "le1" } });
    expect((c1?.value as { category: string }[]).map((x) => x.category)).toEqual(["food", "communication", "allowance"]);
    expect(c1?.before).toEqual(byCat.livingExpenses?.[0]?.categories);
    expect(c1?.note).toContain("仕送り");
    const total: CandidateHousehold = { livingExpenses: [{ id: "le1", mode: "total", monthly: box(250000) }] };
    const c2 = buildCandidates(s, total, { ref: "stmt-1", baseMonth: BASE_MONTH, newId: ids() })[0];
    expect(c2).toMatchObject({ op: "set", item: "livingExpense.monthly", value: { value: 30021 + 8806 }, before: { value: 250000 } });
  });

  it("世帯の前の分け方の内訳（交通・通信費、その他の消費）は、それを分けた今の内訳が明細に出てくれば置き換え、出てこなければ残す", () => {
    const box = (v: number) => ({ value: v, state: "confirmed" as const, origin: { kind: "manual" } });
    const old: CandidateHousehold = { livingExpenses: [{ id: "le1", mode: "byCategory", categories: [{ category: "food", monthly: box(50000) }, { category: "transport", monthly: box(20000) }, { category: "otherConsumption", monthly: box(30000) }] }] };
    // 通信（NTTドコモ）が出てくる → 交通・通信費は置き換える。こづかい・その他は出てこない → その他の消費は残す
    const c = buildCandidates(summaryOf(yearLog()), old, { ref: "stmt-1", baseMonth: BASE_MONTH, newId: ids() })[0];
    expect((c?.value as { category: string }[]).map((x) => x.category)).toEqual(["food", "communication", "otherConsumption"]);
    expect(c?.note).toContain("前の分け方の交通・通信費は、明細の通信費で置き換えます");
    expect(c?.note).toContain("明細に出てこない内訳（その他の消費（こづかい・交際費など））は今の値を残します");
    // 交際（居酒屋）が出てくる → その他の消費も置き換える
    const social = synth([{ id: "a", kind: "card", label: "A", owner: SELF, period: YEAR, rows: [...monthly(10, "イオン 架空店", 30000), ...monthly(10, "架空居酒屋", 4000)] }]);
    const c2 = buildCandidates(summaryOf(social), old, { ref: "stmt-1", baseMonth: BASE_MONTH, newId: ids() })[0];
    expect((c2?.value as { category: string }[]).map((x) => x.category)).toEqual(["food", "pocketAndSocial", "transport"]);
    expect(c2?.note).toContain("前の分け方のその他の消費（こづかい・交際費など）は、明細のこづかい・交際費で置き換えます");
  });

  it("家電・家具の店の3万円以上の買い物は月平均の日用品から外し、「家電・家具の買い替え」の1つの候補にまとめる（いつも要確認）", () => {
    const log = synth([
      {
        id: "a",
        kind: "card",
        label: "A",
        owner: SELF,
        period: YEAR,
        rows: [
          ...monthly(10, "イオン 架空店", 30000),
          ...monthly(10, "ニトリ 架空店", 2000),
          { date: "2026-02-11", merchant: "ニトリ 架空店", amount: 59800 },
          { date: "2026-06-20", merchant: "ヤマダデンキ 架空店", amount: 128000 },
        ],
      },
    ]);
    const s = summaryOf(log);
    // 日用品は小さな買い物だけ
    expect(s.living.find((l) => l.category === "furniture")?.monthly).toBe(monthlyAverage(24000, 365));
    expect(s.oneOffs.filter((o) => o.durable === true).map((o) => [o.key, o.amount])).toEqual([
      [merchantKey("ヤマダデンキ"), 128000],
      [merchantKey("ニトリ"), 59800],
    ]);
    expect(s.notices.find((n) => n.code === "S_DURABLE")?.message).toContain("2 件（合計 187,800円）");
    const cands = buildCandidates(s, {}, { ref: "stmt-1", baseMonth: BASE_MONTH, newId: ids("c") });
    // 店ごとの年1回の候補にはしない。1つの候補にまとめる
    expect(cands.map((c) => c.title)).toEqual(["基本生活費（内訳）", "年払いの暮らしの支出: 家電・家具の買い替え"]);
    const d = cands[1];
    expect(d).toMatchObject({ collection: "periodicExpenses", op: "add", status: "needsReview" });
    expect(d?.value).toMatchObject({ label: "家電・家具の買い替え", kind: "livingAnnual", row: "cf.expense.living", everyYears: 8, from: { at: "2034-06" }, to: null, amount: { value: 187800, state: "estimated", origin: { kind: "import", ref: "stmt-1" }, estimate: { method: "statementAnnual" } } });
    expect(d?.note).toContain("2026-02-11 ニトリ");
    expect(d?.note).toContain("3万円未満の買い物は日用品のまま");
    expect(d?.note).not.toContain("すでにあります");
    // 世帯にもう家電・家具の支出があれば、そう書く
    const has = buildCandidates(s, { periodicExpenses: [{ id: "p1", label: "家電の買い替え", row: "cf.expense.living" }] }, { ref: "stmt-1", baseMonth: BASE_MONTH, newId: ids("c") });
    expect(has[1]?.note).toContain("家電・家具の支出がすでにあります");
    // 3万円以上の家電・家具の買い物が無ければ候補は出ない
    expect(buildCandidates(summaryOf(yearLog()), {}, { ref: "stmt-1", baseMonth: BASE_MONTH, newId: ids("c") }).some((c) => c.title.includes("家電・家具"))).toBe(false);
  });

  it("家電・家具の買い替えの一部の返品は、候補の額から差し引き、日用品の月平均は減らさない", () => {
    const log = synth([
      {
        id: "a",
        kind: "card",
        label: "A",
        owner: SELF,
        period: YEAR,
        rows: [...monthly(10, "ニトリ 架空店", 2000), { date: "2026-02-11", merchant: "ニトリ 架空店", amount: 80000 }, { date: "2026-02-25", merchant: "ニトリ 架空店", amount: -20000 }],
      },
    ]);
    const s = summaryOf(log);
    expect(s.living.find((l) => l.category === "furniture")?.monthly).toBe(monthlyAverage(24000, 365));
    const d = s.oneOffs.find((o) => o.durable === true);
    // 1回の額は買い物の額（返品の行ではない）
    expect(d).toMatchObject({ amount: 80000, occurrences: [{ date: "2026-02-11", amount: 80000 }, { date: "2026-02-25", amount: -20000 }] });
    expect(s.notices.find((n) => n.code === "S_DURABLE")?.message).toContain("1 件（返品 1 件を差し引いた合計 60,000円）");
    expect(s.notices.some((n) => n.code === "S_REFUND_UNMATCHED")).toBe(false);
    const c = buildCandidates(s, {}, { ref: "stmt-1", baseMonth: BASE_MONTH, newId: ids("c") }).find((x) => x.title.includes("家電・家具"));
    expect(c?.value).toMatchObject({ from: { at: "2034-02" }, amount: { value: 60000 } });
    expect((c?.value as { amount: { estimate: { basis: string } } }).amount.estimate.basis).toContain("買い物 1件の合計（返品を差し引く）");
  });

  it("今の分け方の内訳（0100）の世帯: 明細に出てくる内訳は明細の値で置き換え、出てこない内訳は残す（二重に数えない）。残す内訳の名前は入力の画面と同じ", () => {
    const s = summaryOf(yearLog());
    const box = (v: number) => ({ value: v, state: "estimated" as const, origin: { kind: "auto" } });
    const cats = [
      { category: "food", monthly: box(79000) },
      { category: "communication", monthly: box(13000) },
      { category: "transit", monthly: box(5000) },
      { category: "furniture", monthly: box(8000) },
      { category: "pocketAndSocial", monthly: box(26000) },
      { category: "other", monthly: box(17000) },
    ] as const;
    const byCat: CandidateHousehold = { livingExpenses: [{ id: "le1", mode: "byCategory", categories: cats }] };
    const c = buildCandidates(s, byCat, { ref: "stmt-1", baseMonth: BASE_MONTH, newId: ids() })[0];
    // 明細の区分は食費・通信費だけ。通信費は明細の値で置き換え、交通費・日用品・こづかいと交際費・その他は残す
    expect((c?.value as { category: string }[]).map((x) => x.category)).toEqual(["food", "communication", "transit", "furniture", "pocketAndSocial", "other"]);
    expect(c?.note).toContain("明細に出てこない内訳（交通費・日用品・こづかい・交際費・その他）は今の値を残します");
  });

  it("期間が短い・迷う行が残るときは要確認", () => {
    const short = synth([{ id: "a", kind: "card", label: "A", owner: SELF, period: { from: "2026-08-01", to: "2026-09-29" }, rows: [{ date: "2026-08-12", merchant: "イオン", amount: 12000 }] }]);
    expect(buildCandidates(summaryOf(short), {}, { ref: "r", baseMonth: BASE_MONTH, newId: ids() })[0]?.status).toBe("needsReview");
    const unknown = synth([{ id: "a", kind: "card", label: "A", owner: SELF, period: YEAR, rows: [...monthly(10, "イオン", 1000), { date: "2026-01-01", merchant: "架空の謎の店", amount: 500 }] }]);
    const c = buildCandidates(summaryOf(unknown), {}, { ref: "r", baseMonth: BASE_MONTH, newId: ids() })[0];
    expect(c?.status).toBe("needsReview");
    expect(c?.note).toContain("迷う行が 1 行");
    expect(buildCandidates(summaryOf(emptyLog()), {}, { ref: "r", baseMonth: BASE_MONTH, newId: ids() })).toEqual([]);
  });

  it("承認した候補だけを世帯に入れ、承認の記録を付ける（元の世帯は変えない）", () => {
    const s = summaryOf(yearLog());
    const box = (v: number) => ({ value: v, state: "confirmed" as const, origin: { kind: "manual" } });
    const h: CandidateHousehold & { members: unknown[] } = { members: [], livingExpenses: [{ id: "le1", mode: "total", monthly: box(250000) }], periodicExpenses: [] };
    const cands = buildCandidates(s, h, { ref: "stmt-1", baseMonth: BASE_MONTH, newId: ids() });
    const at = "2026-10-23T10:00:00+09:00";
    const next = applyCandidates(h, cands, new Set([cands[0]?.id as string, cands[1]?.id as string]), at);
    expect(next.livingExpenses?.[0]?.monthly).toMatchObject({ value: 30021 + 8806, origin: { kind: "import", ref: "stmt-1" }, approval: { by: "fp", at, candidate: cands[0]?.id } });
    expect(next.periodicExpenses).toHaveLength(1);
    expect((next.periodicExpenses?.[0]?.amount as { approval: unknown }).approval).toEqual({ by: "fp", at, candidate: cands[1]?.id });
    expect(h.livingExpenses?.[0]?.monthly?.value).toBe(250000);
    expect(h.periodicExpenses).toEqual([]);
    // 何も選ばなければ何も変えない
    expect(applyCandidates(h, cands, new Set(), at)).toEqual(h);
  });

  // 内訳を置き換える候補は、明細に出てこない今の内訳（前の明細の取り込みで承認した仕送りなど）を残す。
  // 残す内訳の値の箱は今回承認したものではないので、承認の記録（日時・候補）を付け直さない
  it("内訳を置き換えるとき、残した今の内訳の承認の記録は付け直さない（今回の候補の値の箱だけに付ける）", () => {
    const s = summaryOf(yearLog());
    const old = { by: "fp" as const, at: "2026-04-01T10:00:00+09:00", candidate: "c-old" };
    const kept = { value: 20000, state: "estimated" as const, origin: { kind: "import", ref: "stmt-old" }, approval: old, estimate: { method: "statementAverage", basis: "前の明細" } };
    const h: CandidateHousehold = { livingExpenses: [{ id: "le1", mode: "byCategory", categories: [{ category: "food", monthly: { value: 50000, state: "confirmed", origin: { kind: "manual" } } }, { category: "allowance", monthly: kept }] }] };
    const cands = buildCandidates(s, h, { ref: "stmt-1", baseMonth: BASE_MONTH, newId: ids() });
    const c = cands[0];
    expect(c?.item).toBe("livingExpense.categories");
    const at = "2026-10-23T10:00:00+09:00";
    const next = applyCandidates(h, cands, new Set([c?.id as string]), at);
    const cats = next.livingExpenses?.[0]?.categories ?? [];
    expect(cats.find((x) => x.category === "allowance")?.monthly).toEqual(kept);
    expect(cats.find((x) => x.category === "food")?.monthly).toMatchObject({ origin: { kind: "import", ref: "stmt-1" }, approval: { by: "fp", at, candidate: c?.id } });
  });
});
