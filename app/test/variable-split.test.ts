// 変額保険を「続ける」（A）と「解約して、保障と運用に分ける」（B）の比較の試算（0233）: 解約の月・解約返戻金・掛け捨ての保険・浮いた保険料と
// 解約返戻金の NISA への入れ方（枠を超える分）・数表がある形と目安の形・払込の終わった契約・計算基準月が1〜3月・誕生月の前後・年ごとの表・
// プランの作り方。変額保険の無い世帯は何も変えない
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { EngineRequest, InsuranceContract, PreviewResult } from "../src/engine/types.ts";
import { DEMO_HOUSEHOLDS, type DemoHousehold } from "../src/workspace/catalog.ts";
import { baseRequest } from "../src/workspace/contingency/requests.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import {
  defaultSplit,
  lumpLine,
  allocationRate,
  needsSurrenderValue,
  netRateOf,
  rateLines,
  rateOf,
  recordSplit,
  savingLine,
  shownYears,
  splitPlan,
  splitRequest,
  splitRows,
  splitTargets,
  splitUnavailable,
  surrenderYm,
  type SplitIds,
  type SplitOptions,
} from "../src/workspace/input/variableSplit.ts";
import { SplitPanel, VariableSplit } from "../src/workspace/input/VariableSplit.tsx";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { diffRows, planView } from "../src/workspace/plans/planEdit.ts";
import { savePlan } from "../src/workspace/plans/plans.ts";
import { modelHousehold, preview } from "./helpers.ts";

const MODEL = "salariedCoupleTwoKids";
const V = "5d0c2f9e-6a1b-4c3d-9e8f-0a1b2c3d4e5f";
const IDS: SplitIds = {
  cover: "6e1d3a0f-7b2c-4d4e-8f90-1b2c3d4e5f60",
  coverMain: "7f2e4b1a-8c3d-4e5f-9a01-2c3d4e5f6071",
  nisa: "8a3f5c2b-9d4e-4f60-8b12-3d4e5f607182",
  taxable: "9b4a6d3c-ae5f-4071-9c23-4e5f60718293",
};

/** 年数×20万円の解約返戻金の数表（設計書の数字の代わり） */
const rows = (f: (py: number) => number, n = 45) => Array.from({ length: n }, (_, i) => ({ policyYear: i + 1, surrenderValue: f(i + 1) }));

/** 会社員の夫婦と子2人（ご本人 1981年7月生まれ）に、2016年4月から月2万円・65歳まで払う変額保険（基本保険金額1000万円） */
function family(o: Partial<InsuranceContract> = {}, baseMonth?: string): EngineRequest {
  const req = modelHousehold(MODEL);
  if (baseMonth !== undefined) req.input.baseMonth = baseMonth;
  const self = req.input.household.members.find((m) => m.kind === "self")!;
  const spouse = req.input.household.members.find((m) => m.kind === "spouse")!;
  req.input.household.insuranceContracts = [
    {
      id: V,
      template: "insurance.variable",
      subtype: "variable",
      policyholder: self.id,
      insured: self.id,
      contractDate: "2016-04",
      currency: "JPY",
      premium: { amount: 20000, frequency: "monthly", payUntil: { memberAge: { member: self.id, years: 65, months: 0 } } },
      deductionCategory: { type: "general", regime: "new" },
      beneficiaries: [{ member: spouse.id, share: "1" }],
      coverages: [{ id: "0c5b7e4d-bf60-4182-8d34-5f6071829304", role: "main", benefit: "death", amount: 10000000, from: { at: "2016-04" }, to: null }],
      simple: { estimate: true },
      schedule: { rows: rows((py) => py * 200000) },
      ...o,
    },
  ];
  return req;
}
const contractOf = (req: EngineRequest, id = V) => req.input.household.insuranceContracts!.find((c) => c.id === id)!;
const options = (req: EngineRequest, o: Partial<SplitOptions> = {}): SplitOptions => ({ ...defaultSplit(req, contractOf(req)), premium: 5000, rateKind: "custom", custom: "0.03", ...o });
const bOf = (req: EngineRequest, o: SplitOptions) => splitRequest(req, V, o, rateOf(req, contractOf(req), o)!, IDS);
const sum = (r: PreviewResult, f: (c: PreviewResult["table"][number]) => boolean) => r.table.reduce((s, c) => (f(c) ? s + c.amount : s), 0);

describe("解約する月・解約返戻金・浮く保険料", () => {
  it("変額保険だけが対象（解約の予定を入れた契約・ほかの種類は出さない）", () => {
    const req = family();
    expect(splitTargets(req).map((c) => c.id)).toEqual([V]);
    expect(splitTargets(family({ surrender: { at: "2030-01" } }))).toEqual([]);
    expect(splitTargets(family({ template: "insurance.wholeLife", subtype: "wholeLife" }))).toEqual([]);
  });

  it("解約する月は選んだ年の1月（計算基準年は計算基準月）。解約返戻金はその月までに終わった保険年度の数表の額", () => {
    const req = family();
    expect(surrenderYm(req, 2026)).toBe("2026-10");
    expect(surrenderYm(req, 2031)).toBe("2031-01");
    const now = splitPlan(req, contractOf(req), options(req));
    // 2016年4月から2026年10月までに終わった保険年度は10
    expect(now).toMatchObject({ ym: "2026-10", lump: 2000000, aPremium: 20000, saving: 15000 });
    // 2031年1月は14保険年度まで
    expect(splitPlan(req, contractOf(req), options(req, { year: 2031 })).lump).toBe(2800000);
  });

  it("浮いた保険料は、解約の月から A の払込が終わる前の月（65歳の誕生月の前の月）まで", () => {
    const req = family();
    // ご本人は1981年7月生まれ。65歳は2046年7月で、その月から払わない
    expect(splitPlan(req, contractOf(req), options(req)).savingUntil).toBe("2046-06");
    // 1日生まれは、65歳に達するのが前の月（6月）
    const first = family();
    first.input.household.members.find((m) => m.kind === "self")!.birth.bornOnFirst = true;
    expect(splitPlan(first, contractOf(first), options(first)).savingUntil).toBe("2046-05");
  });

  it("掛け捨ての保険料が A の保険料より高いと、浮く額はマイナスで積み立てない（差は家計から払う）", () => {
    const req = family();
    const p = splitPlan(req, contractOf(req), options(req, { premium: 26000 }));
    expect(p).toMatchObject({ saving: -6000, savingUntil: null });
    expect(savingLine(p)).toBe("掛け捨ての保険料が A の保険料より月 6,000円 高く、浮く保険料はありません（差は家計から払います）");
    const b = bOf(req, options(req, { premium: 26000 }));
    const nisa = b.input.household.accounts!.find((a) => a.id === IDS.nisa)!;
    expect(nisa.contributions!.every((c) => c.tranche === "growth")).toBe(true);
  });

  it("払込が終わっている変額保険: A の保険料は0で、B は掛け捨ての保険料を家計から払う", () => {
    const req = family({ premium: { amount: 20000, frequency: "monthly", payUntil: { at: "2025-04" } } });
    const p = splitPlan(req, contractOf(req), options(req));
    expect(p).toMatchObject({ aPremium: 0, saving: -5000, savingUntil: null });
    expect(savingLine(p)).toBe("A の保険料の払込は終わっています（B は掛け捨ての保険料を家計から払います）");
  });
});

describe("解約返戻金の NISA への入れ方", () => {
  it("成長投資枠の年の枠（240万円）までを年ごとに入れ、入れる前の分は預金に置く", () => {
    const req = family({ schedule: { rows: rows((py) => py * 500000) } });
    const p = splitPlan(req, contractOf(req), options(req));
    // 10保険年度×50万円＝500万円 → 2026年10月に240万円、2027年1月に240万円、2028年1月に20万円
    expect(p.lump).toBe(5000000);
    expect(p.chunks).toEqual([
      { ym: "2026-10", amount: 2400000 },
      { ym: "2027-01", amount: 2400000 },
      { ym: "2028-01", amount: 200000 },
    ]);
    expect(p.taxable).toBe(0);
    expect(lumpLine(p)).toBe("解約返戻金 500万円（税を引く前。一時所得の税は預金から払います）・NISA の成長投資枠に 2026〜2028年の3年に分けて 500万円");
  });

  it("NISA の枠を超える返戻金: 成長投資枠の生涯の枠（1200万円）を超える分は、解約の月に課税口座へ", () => {
    const req = family({ schedule: { rows: rows((py) => py * 3000000) } });
    const p = splitPlan(req, contractOf(req), options(req));
    expect(p.lump).toBe(30000000);
    expect(p.chunks.reduce((s, x) => s + x.amount, 0)).toBe(12000000);
    expect(p.chunks.length).toBe(5);
    expect(p.taxable).toBe(18000000);
    const b = bOf(req, options(req));
    const tax = b.input.household.accounts!.find((a) => a.id === IDS.taxable)!;
    expect(tax).toMatchObject({ kind: "taxable", expectedReturn: "0.03", contributions: [{ from: { at: "2026-10" }, to: { at: "2026-10" }, monthly: 18000000 }] });
    // 計算すると、NISA と課税口座の残高に入る（枠を超えたという知らせが出ない）
    const r = preview(baseRequest(b));
    expect(sum(r, (c) => c.year === 2031 && c.object === IDS.taxable && c.row.startsWith("cf.balance.account."))).toBeGreaterThan(18000000);
    expect(sum(r, (c) => c.year === 2031 && c.object === IDS.nisa && c.row.startsWith("cf.balance.account."))).toBeGreaterThan(12000000);
  });
});

describe("B の要求と計算", () => {
  it("解約の月・掛け捨ての保険（契約者・被保険者・受取人は同じ）・NISA の口座を足す。ほかは変えない", () => {
    const req = family();
    const b = bOf(req, options(req));
    expect(contractOf(b).surrender).toEqual({ at: "2026-10" });
    const cover = contractOf(b, IDS.cover);
    const self = req.input.household.members.find((m) => m.kind === "self")!;
    expect(cover).toMatchObject({ template: "insurance.term", subtype: "term", policyholder: self.id, insured: self.id, contractDate: "2026-10", premium: { amount: 5000, frequency: "monthly" }, beneficiaries: contractOf(req).beneficiaries });
    expect(cover.coverages).toEqual([{ id: IDS.coverMain, role: "main", benefit: "death", amount: 10000000, from: { at: "2026-10" }, to: { memberAge: { member: self.id, years: 65, months: 0 } } }]);
    const nisa = b.input.household.accounts!.find((a) => a.id === IDS.nisa)!;
    expect(nisa).toMatchObject({ kind: "nisa", owner: self.id, expectedReturn: "0.03" });
    expect(nisa.contributions).toEqual([
      { from: { at: "2026-10" }, to: { at: "2046-06" }, monthly: 15000 },
      { from: { at: "2026-10" }, to: { at: "2026-10" }, monthly: 2000000, tranche: "growth" },
    ]);
    // 現状は変えない
    expect(contractOf(req).surrender).toBeUndefined();
    const strip = (r: EngineRequest) => {
      const x = structuredClone(r);
      x.input.household.insuranceContracts = x.input.household.insuranceContracts!.filter((c) => c.id !== IDS.cover).map((c) => ({ ...c, surrender: undefined }));
      x.input.household.accounts = x.input.household.accounts!.filter((a) => a.id !== IDS.nisa);
      return JSON.parse(JSON.stringify(x)) as EngineRequest;
    };
    expect(strip(b)).toEqual(JSON.parse(JSON.stringify(req)));
  });

  it("計算: 解約の月から A の保険料が止まり、掛け捨ての保険料を払い、NISA の残高が増える", () => {
    const req = family();
    const b = baseRequest(bOf(req, options(req)));
    const r = preview(b);
    const premium = (id: string, y: number) => sum(r, (c) => c.year === y && c.object === id && c.row.startsWith("cf.expense.insurance"));
    expect(premium(V, 2027)).toBe(0);
    expect(premium(IDS.cover, 2027)).toBe(60000);
    expect(sum(r, (c) => c.row === "cf.income.lumpSum.surrender" && c.year === 2026)).toBe(2000000);
    const bal = (y: number) => sum(r, (c) => c.year === y && c.object === IDS.nisa && c.row.startsWith("cf.balance.account."));
    expect(bal(2026)).toBeGreaterThanOrEqual(2000000 + 45000);
    expect(bal(2030)).toBeGreaterThan(bal(2026));
  });

  it("数表に解約の保険年度の行が無い目安の形は、FP が入れた解約返戻金を B だけの数表の行にする", () => {
    const req = family({ schedule: undefined });
    const c = contractOf(req);
    expect(needsSurrenderValue(c, "2026-10")).toBe(true);
    const o = options(req, { surrenderValue: 2300000 });
    expect(splitPlan(req, c, o).lump).toBe(2300000);
    const b = bOf(req, o);
    expect(contractOf(b).schedule).toEqual({ rows: [{ policyYear: 10, surrenderValue: 2300000 }] });
    expect(contractOf(req).schedule).toBeUndefined();
    expect(sum(preview(baseRequest(b)), (x) => x.row === "cf.income.lumpSum.surrender")).toBe(2300000);
  });

  it("計算基準月が2月の世帯: 計算基準年に解約すると2月に解約し、浮いた保険料も2月から", () => {
    const req = family({}, "2027-02");
    const p = splitPlan(req, contractOf(req), options(req, { year: 2027 }));
    // 2016年4月から2027年2月までに終わった保険年度は10
    expect(p).toMatchObject({ ym: "2027-02", lump: 2000000 });
    const nisa = bOf(req, options(req, { year: 2027 })).input.household.accounts!.find((a) => a.id === IDS.nisa)!;
    expect(nisa.contributions![0]).toEqual({ from: { at: "2027-02" }, to: { at: "2046-06" }, monthly: 15000 });
  });

  it("誕生月の前後: 掛け捨ての保険は65歳の誕生月で終わる（その年の年末の死亡保障は0）", () => {
    const req = family();
    const o = options(req);
    const a = preview(baseRequest(req));
    const b = preview(baseRequest(bOf(req, o)));
    const list = splitRows(req, contractOf(req), o, IDS, a, b);
    const row = (y: number) => list.find((x) => x.year === y)!;
    // 2045年末は保障あり（掛け捨て1000万円＋運用残高）、2046年7月に終わるので2046年末は運用残高だけ
    expect(row(2045).bDeath - row(2045).bInvest).toBe(10000000);
    expect(row(2046).bDeath).toBe(row(2046).bInvest);
    expect(row(2045).age).toBe(64);
    expect(row(2046).age).toBe(65);
  });
});

describe("年ごとの表と利回りの並び", () => {
  it("A は解約返戻金と死亡保険金、B は運用残高と掛け捨ての保険金＋運用残高", () => {
    const req = family();
    const o = options(req);
    const a = preview(baseRequest(req));
    const b = preview(baseRequest(bOf(req, o)));
    const list = splitRows(req, contractOf(req), o, IDS, a, b);
    expect(list[0]!.year).toBe(2026);
    expect(list.at(-1)!.year).toBe(req.input.endYear);
    const y30 = list.find((x) => x.year === 2030)!;
    // 2030年末は14保険年度の終わり
    expect(y30.aSurrender).toBe(2800000);
    expect(y30.aDeath).toBe(10000000);
    expect(y30.bInvest).toBeGreaterThan(0);
    expect(y30.bDeath).toBe(10000000 + y30.bInvest);
    // 表に出す年: 解約の年・5年ごと・掛け捨ての保険と A の払込が終わる年・最後の年
    expect(shownYears(req, contractOf(req), o, list)).toEqual([2026, 2031, 2036, 2041, 2046, 2051, 2056, 2061, 2066, 2071, 2076, 2081]);
  });

  it("数表の無い目安の形は、A の解約返戻金を出さない", () => {
    const req = family({ schedule: undefined });
    const o = options(req, { surrenderValue: 2300000 });
    const list = splitRows(req, contractOf(req), o, IDS, preview(baseRequest(req)), preview(baseRequest(bOf(req, o))));
    expect(list.every((x) => x.aSurrender === null)).toBe(true);
  });

  it("利回り: 数表の利回り・資産クラスの前提・B の利回りを並べ、そろっていなければ知らせる", () => {
    const req = family();
    const c = contractOf(req);
    const lines = rateLines(req, c, options(req, { rateKind: "class", illustrated: "0.06", assetClass: "equity.global" }));
    expect(lines[0]).toBe("A の数表（設計書）: 年6%の運用の例（解約返戻金は保険の費用を引いた後の額）");
    expect(lines[1]).toMatch(/^資産クラスの前提: 外国株式 年.*（前提条件の利回り。費用を引く前）$/);
    expect(lines).toContain("設計書の利回りは運用の例で、約束された値ではありません。高い利回りの例だけで判断しないでください");
    // 数表と同じ利回りにそろえると、そろっていないという行は出ない
    const same = rateLines(req, c, options(req, { rateKind: "illustrated", illustrated: "0.06" }));
    expect(same.some((x) => x.startsWith("A と B の利回りの前提がそろっていません"))).toBe(false);
    // そろえるのは費用を引く前の利回り。B はそこから運用の費用（既定 0.25%）を引く
    expect(same).toContain("B の運用の利回り: 年6%−運用の費用 年0.25%＝費用を引いた後 年5.75%");
    expect(rateLines(req, c, options(req, { rateKind: "custom", custom: "0.03", illustrated: "0.06" })).some((x) => x.startsWith("A と B の利回りの前提がそろっていません"))).toBe(true);
    // 数表の利回りを入れていなければ B の利回りは決まらない
    expect(rateOf(req, c, options(req, { rateKind: "illustrated", illustrated: null }))).toBeNull();
  });

  it("前の入れ方（積立金を伸ばす形）の変額保険は、A と同じ前提の利回りが既定", () => {
    const req = family({ simple: { assetClass: "equity.global", loadRate: "0.1" }, schedule: undefined });
    const c = contractOf(req);
    const o = defaultSplit(req, c);
    expect(o.rateKind).toBe("illustrated");
    expect(rateOf(req, c, o)).toBe(req.input.assumptions?.assetReturns?.["equity.global"]?.default ?? req.input.assumptions?.investmentReturn.default);
  });

  it("合計の入れ方では使えない", () => {
    const req = family();
    expect(splitUnavailable(req)).toBeNull();
    req.input.assumptions = { ...req.input.assumptions!, investment: { method: "total" } };
    expect(splitUnavailable(req)).toMatch(/合計/);
  });
});

describe("プランを作る", () => {
  const req = family();
  const demo = DEMO_HOUSEHOLDS.find((d) => d.id === MODEL) as DemoHousehold;
  const self = req.input.household.members.find((m) => m.kind === "self")!;
  const wh0 = fromRequest(req, { memo: demo.memo });
  const cat = buildCatalog(wh0, self.id, demo);

  it("新しいプランは解約と、足した掛け捨ての保険・NISA の差分を持つ。現状は変えない", () => {
    const s = savePlan(wh0, cat, { name: "テスト", base: null, values: {}, now: "2026-11-19T00:00:00Z" });
    const o = options(req);
    const wh = recordSplit(s.wh, cat, s.id, V, o);
    expect(wh.request).toEqual(wh0.request);
    expect(diffRows(wh, cat, s.id).length).toBeGreaterThan(0);
    const view = planView(wh, cat, s.id).request as EngineRequest;
    expect(contractOf(view).surrender).toEqual({ at: "2026-10" });
    expect(view.input.household.insuranceContracts!.some((c) => c.template === "insurance.term" && c.label === "分けた保障（掛け捨て）")).toBe(true);
    const nisa = view.input.household.accounts!.find((a) => a.label === "分けた運用（NISA）");
    expect(nisa?.expectedReturn).toBe("0.03");
    // 計算できる
    expect(() => preview(view)).not.toThrow();
  });

  it("保険料か利回りが入っていなければ作らない", () => {
    const s = savePlan(wh0, cat, { name: "テスト", base: null, values: {}, now: "2026-11-19T00:00:00Z" });
    expect(recordSplit(s.wh, cat, s.id, V, options(req, { premium: null }))).toBe(s.wh);
    expect(recordSplit(s.wh, cat, s.id, V, options(req, { rateKind: "custom", custom: null }))).toBe(s.wh);
  });

  it("変額保険の無い世帯は対象が無く、何も変えない", () => {
    for (const id of [MODEL, "insuranceMaturityAnnuity", "dualHighTwoKids"]) {
      const r = modelHousehold(id);
      expect(splitTargets(r)).toEqual([]);
      expect(splitRequest(r, V, options(family()), "0.03", IDS)).toEqual(r);
    }
  });
});

describe("保険の入力項目の区画", () => {
  it("変額保険の行に「解約して分けたら」のボタン。変額保険の無い世帯には区画を出さない", () => {
    const html = renderToString(h(VariableSplit, { wh: fromRequest(family()) }));
    expect(html).toContain("解約して分けたら");
    expect(html).toContain('data-variable-split-row="' + V + '"');
    expect(renderToString(h(VariableSplit, { wh: fromRequest(modelHousehold(MODEL)) }))).toBe("");
  });

  it("開くと、入れる欄・利回りの並び・必ず出す注意。保険料が未入力の間は表を出さず、プランも作れない", () => {
    const req = family();
    const html = renderToString(h(SplitPanel, { req, c: contractOf(req), label: "変額保険 1", planLabel: null, onPlan: () => undefined }));
    for (const t of ["健康状態によっては", "解約控除", "保険料は上がります", "説明する決まり", "資産クラスの前提", "掛け捨ての保険の保険料を入れると"]) expect(html).toContain(t);
    expect(html).not.toContain("data-split-table");
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-action="ins\/split\/plan"/);
  });
});

describe("B の運用の費用（費用を引いた後の利回り）", () => {
  it("既定は事務所の既定の運用の費用（0.25%）で、NISA・課税口座の「運用の費用」に入れる（計算のエンジンが利回りから引く）", () => {
    const req = family({ schedule: { rows: rows((py) => py * 3000000) } });
    const o = options(req);
    expect(o.fee).toBe("0.0025");
    expect(netRateOf(req, contractOf(req), o)).toBe("0.0275");
    const b = bOf(req, o);
    for (const id of [IDS.nisa, IDS.taxable]) expect(b.input.household.accounts!.find((a) => a.id === id)).toMatchObject({ expectedReturn: "0.03", fee: "0.0025" });
    // 費用を0にすると欄を書かない
    expect(bOf(req, options(req, { fee: "0" })).input.household.accounts!.find((a) => a.id === IDS.nisa)!.fee).toBeUndefined();
  });

  it("費用を引くと B の運用残高は小さくなる", () => {
    const req = family();
    const at = (o: SplitOptions) => sum(preview(baseRequest(bOf(req, o))), (c) => c.year === 2040 && c.object === IDS.nisa && c.row.startsWith("cf.balance.account."));
    expect(at(options(req))).toBeLessThan(at(options(req, { fee: "0" })));
  });

  it("資産配分の入れ方（配分あり）は、世帯の資産配分の期待リターンと信託報酬で計算し、利回りの選び方は使わない", () => {
    const req = family();
    req.input.assumptions = { ...req.input.assumptions!, investment: { method: "allocation", allocation: { mix: [{ assetClass: "equity.global", share: "1" }], fee: "0.001" } }, assetReturns: { "equity.global": { default: "0.05" } } };
    const c = contractOf(req);
    const o = options(req, { rateKind: "custom", custom: "0.09" });
    expect(allocationRate(req, o)).toEqual({ gross: "0.05", fee: "0.001" });
    expect(rateOf(req, c, o)).toBe("0.05");
    expect(netRateOf(req, c, o)).toBe("0.049");
    expect(defaultSplit(req, c).fee).toBe("0.001");
    const lines = rateLines(req, c, o);
    expect(lines).toContain("B の運用の利回り（世帯の資産配分）: 年5%−運用の費用 年0.1%＝費用を引いた後 年4.9%");
    expect(lines).toContain("資産配分の入れ方のため、B の運用も世帯の資産配分と信託報酬で計算します");
  });
});
