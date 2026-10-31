import { describe, expect, it } from "vitest";
import { applyCandidates, buildCandidates, classify, coveredDays, emptyLog, merchantKey, monthlyAverage, monthsText, paymentSchedule, summarize, type CandidateHousehold, type StatementAccount, type StatementLog, type StatementRow } from "../src/index.ts";
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

  it("基本生活費の内訳にまとめ、住居・教育・保険・車・税は参考の値に、分からない店は「その他の消費」に入れて別にも出す", () => {
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
    expect(by).toEqual({ transport: 8806, furniture: monthlyAverage(24000, 365), otherConsumption: monthlyAverage(12000, 365) });
    expect(s.unknownMonthly).toBe(monthlyAverage(12000, 365));
    expect(s.reference.education).toBe(monthlyAverage(240000, 365));
    expect(s.reference.car).toBe(monthlyAverage(72000, 365));
    expect(s.livingTotal).toBe(8806 + monthlyAverage(24000, 365) + monthlyAverage(12000, 365));
  });

  it("事業の割合で分けた分は家計から外し、持ち主ごとに別に出す", () => {
    const log = synth([{ id: "w", kind: "card", label: "妻", owner: SPOUSE, period: YEAR, rows: monthly(10, "NTTドコモ", 8800).map((r) => ({ ...r, bucket: "business" as const, share: "0.6", decidedAt: "x" })) }]);
    const s = summaryOf(log);
    expect(s.living[0]).toMatchObject({ category: "transport", monthly: monthlyAverage(12 * 3520, 365) });
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
      ["periodicExpenses", "add", "一時的支出: 架空車検センター", "pending"],
      ["periodicExpenses", "add", "一時的支出: 自動車税 架空県", "needsReview"],
    ]);
    const living = cands[0]?.value as { mode: string; categories: { category: string; monthly: { value: number; state: string; origin: unknown; estimate: { method: string; basis: string } } }[] };
    expect(living.mode).toBe("byCategory");
    expect(living.categories.map((c) => [c.category, c.monthly.value])).toEqual([
      ["food", 30021],
      ["transport", 8806],
    ]);
    expect(living.categories[0]?.monthly).toMatchObject({ state: "estimated", origin: { kind: "import", ref: "stmt-1" }, estimate: { method: "statementAverage" } });
    expect(living.categories[0]?.monthly.estimate.basis).toContain("2025-10-01〜2026-09-30、12.0か月");
    expect(cands[0]).toMatchObject({ source: "import", sourceRef: "stmt-1", origin: { kind: "import", ref: "stmt-1" }, enabled: true, before: null });
    const shaken = cands[1]?.value as { row: string; everyYears: number; from: { at: string }; to: null; amount: { value: number } };
    expect(shaken).toMatchObject({ row: "cf.expense.lumpSum.car", everyYears: 2, from: { at: "2028-03" }, to: null, amount: { value: 102000 } });
    const carTax = cands[2]?.value as { from: { at: string }; everyYears: number };
    expect(carTax).toMatchObject({ from: { at: "2027-05" }, everyYears: 1 });
    expect(cands[2]?.confidence).toBe("medium");
  });

  it("今の欄の形に合わせる: 内訳なら内訳を置き換え（明細に出ない内訳は残す）、合計なら合計を置き換える", () => {
    const s = summaryOf(yearLog());
    const box = (v: number) => ({ value: v, state: "confirmed" as const, origin: { kind: "manual" } });
    const byCat: CandidateHousehold = { livingExpenses: [{ id: "le1", mode: "byCategory", categories: [{ category: "food", monthly: box(50000) }, { category: "allowance", monthly: box(20000) }] }] };
    const c1 = buildCandidates(s, byCat, { ref: "stmt-1", baseMonth: BASE_MONTH, newId: ids() })[0];
    expect(c1).toMatchObject({ op: "set", item: "livingExpense.categories", target: { object: "le1" } });
    expect((c1?.value as { category: string }[]).map((x) => x.category)).toEqual(["food", "transport", "allowance"]);
    expect(c1?.before).toEqual(byCat.livingExpenses?.[0]?.categories);
    expect(c1?.note).toContain("仕送り");
    const total: CandidateHousehold = { livingExpenses: [{ id: "le1", mode: "total", monthly: box(250000) }] };
    const c2 = buildCandidates(s, total, { ref: "stmt-1", baseMonth: BASE_MONTH, newId: ids() })[0];
    expect(c2).toMatchObject({ op: "set", item: "livingExpense.monthly", value: { value: 30021 + 8806 }, before: { value: 250000 } });
  });

  it("今の分け方の内訳（0100）の世帯: 明細の交通・通信が含む交通費・通信費は残さない（二重に数えない）。残す内訳の名前は入力の画面と同じ", () => {
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
    // 明細の区分は食費・交通・通信だけ。交通費・通信費は交通・通信に含まれるので外し、日用品・こづかいと交際費・その他は残す
    expect((c?.value as { category: string }[]).map((x) => x.category)).toEqual(["food", "transport", "furniture", "pocketAndSocial", "other"]);
    expect(c?.note).toContain("明細に出てこない内訳（日用品・こづかい・交際費・その他）は今の値を残します");
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
});
