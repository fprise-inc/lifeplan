// 万一のタブの前提（0071）: 万一の前提の入力項目ID と、プランごとの上書き（向き先 {plan: "contingency"} の差分）、足した場面と前提
// （配偶者の大きな病気・収入が減る・下げる資産と戻り方・重ねる・復帰の後の働き方・逆算方式・子の独立とみなす年齢・働き方を変える時点）、
// 起きる年の範囲と年ごとの帯の順番、残された人の年金の一言
import { describe, expect, it } from "vitest";
import type { EngineRequest } from "../src/engine/types.ts";
import { sweepOrder } from "../src/workspace/contingency/engine.ts";
import { contingencyInputSections } from "../src/workspace/contingency/inputs.ts";
import { emptyPlan, type ContingencyPlan } from "../src/workspace/contingency/planData.ts";
import { overrideCount, premiseChanges, premiseFor, premiseMark, revertPremise, setPremiseValue, writePremise } from "../src/workspace/contingency/planPremise.ts";
import { PREMISE_ITEMS, premiseAddress } from "../src/workspace/contingency/premiseItems.ts";
import { yearOptions } from "../src/workspace/contingency/present.ts";
import { baseRequest, protectionRequest, scenarioRequest, scenarios, survivorWorkPeriod } from "../src/workspace/contingency/requests.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { diffRows } from "../src/workspace/plans/planEdit.ts";
import { applyPlan, reflectPlan, type Proposal } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_DIR } from "../scripts/lib.ts";
import { modelHousehold, preview } from "./helpers.ts";

const PLAN_B = "00000000-0000-4000-8000-00000000c071";
const PLAN_C = "00000000-0000-4000-8000-00000000c072";
const plan = (id: string, base: string | null = null): Proposal => ({ id, name: id === PLAN_B ? "プランB" : "プランC", base, diffs: [], tags: [], createdAt: "2026-10-27T00:00:00Z", updatedAt: "2026-10-27T00:00:00Z", origin: { kind: "manual" } }) as unknown as Proposal;
const open = (id = "survivorEmployeeLoan"): WorkingHousehold => ({ ...fromRequest(modelHousehold(id)), proposals: [plan(PLAN_B), plan(PLAN_C, PLAN_B)] });
const LIVING = ["survivor", "livingRatio", "beforeIndependence"];
const sumRow = (req: EngineRequest, row: string) => preview(req).table.filter((c) => c.row.startsWith(row)).reduce((s, c) => s + c.amount, 0);

describe("万一の前提の入力項目ID（画面の側の区画のスキーマ）", () => {
  it("スキーマの x-item が登録簿に載り、場面・起きる年・重ねる印のほかの前提の欄すべてに ID がある", () => {
    const schema = JSON.parse(readFileSync(join(APP_DIR, "schemas", "household.contingency.json"), "utf8")) as { properties: Record<string, { "x-item"?: string }> };
    const withId = Object.entries(schema.properties).filter(([, v]) => v["x-item"] !== undefined);
    expect(Object.fromEntries(withId.map(([k, v]) => [k, v["x-item"]]))).toEqual(PREMISE_ITEMS);
    expect(Object.keys(schema.properties).filter((k) => PREMISE_ITEMS[k] === undefined).sort()).toEqual(["stackMarket", "year"]);
    expect(premiseAddress(LIVING)).toEqual({ target: { plan: "contingency" }, item: "contingencyPremise.survivor", at: ["livingRatio", "beforeIndependence"] });
    expect(premiseAddress(["year"])).toBeNull();
    // 前提の欄はどれも、ID のある場所か、場面の選び方
    const wh = open("investmentCouple");
    for (const sec of contingencyInputSections({ ...wh, contingency: { ...emptyPlan(), illness: { afterMonths: 6 }, market: { recoveryYears: 2 }, protection: { method: "reverse" } } }))
      for (const g of sec.groups) for (const f of g.fields) if (sec.key !== "cg/creditLife" && f.key !== "cg/market/stack") expect(f.item, f.key).not.toBeNull();
  });
});

describe("プランごとの上書き", () => {
  it("このプランだけ直すと差分。共通・土台と同じ値に戻すと消える。土台の上書きは引き継ぎ、子のプランで共通に戻せる", () => {
    let wh = open();
    wh = setPremiseValue(wh, PLAN_B, LIVING, "0.6");
    expect(wh.contingency.survivor.livingRatio?.beforeIndependence).toBeUndefined();
    expect(wh.proposals[0]!.diffs).toMatchObject([{ op: "set", target: { plan: "contingency" }, item: "contingencyPremise.survivor", at: ["livingRatio", "beforeIndependence"], value: { value: "0.6" } }]);
    expect(premiseFor(wh, PLAN_B).survivor.livingRatio?.beforeIndependence).toBe("0.6");
    expect(premiseFor(wh, PLAN_C).survivor.livingRatio?.beforeIndependence).toBe("0.6");
    expect(premiseFor(wh, null)).toBe(wh.contingency);
    expect(overrideCount(wh, PLAN_C)).toBe(1);
    expect(premiseMark(wh, PLAN_B, LIVING, String)).toMatchObject({ own: true, inherited: false });
    expect(premiseMark(wh, PLAN_C, LIVING, String)).toMatchObject({ own: false, inherited: true });
    // 子のプランで共通に戻す: 共通の値に戻す差分を作る
    const c = revertPremise(wh, PLAN_C, LIVING);
    expect(premiseFor(c, PLAN_C).survivor.livingRatio?.beforeIndependence).toBeUndefined();
    expect(c.proposals[1]!.diffs).toHaveLength(1);
    // 土台と同じ値に戻すと自分の差分を消す
    expect(setPremiseValue(c, PLAN_C, LIVING, "0.6").proposals[1]!.diffs).toHaveLength(0);
    expect(revertPremise(wh, PLAN_B, LIVING).proposals[0]!.diffs).toHaveLength(0);
    // 場面の選び方（起きる年・重ねる印）は共通を直す
    const y = setPremiseValue(wh, PLAN_B, ["year"], 2035);
    expect(y.contingency.year).toBe(2035);
    expect(y.proposals[0]!.diffs).toHaveLength(1);
  });

  it("前提のパネルの直した前提を、直す先（共通・このプランだけ）に書く", () => {
    const wh = open();
    const shown = premiseFor(wh, PLAN_B);
    const next: ContingencyPlan = { ...structuredClone(shown), illness: { months: 18 }, year: 2033 };
    expect(premiseChanges(shown, next).map((c) => c.path.join("/")).sort()).toEqual(["illness/months", "year"]);
    const toPlan = writePremise(wh, PLAN_B, shown, next, "plan");
    expect(toPlan.contingency.illness).toBeUndefined();
    expect(toPlan.contingency.year).toBe(2033);
    expect(premiseFor(toPlan, PLAN_B).illness?.months).toBe(18);
    const toCommon = writePremise(wh, PLAN_B, shown, next, "common");
    expect(toCommon.contingency.illness?.months).toBe(18);
    expect(toCommon.proposals).toBe(wh.proposals);
  });

  it("差分は当てて要確認なし（共通が変わったら要確認）。違いの一覧に「万一の前提」の行。現状に反映すると共通の前提になる。要求は変えない", () => {
    let wh = setPremiseValue(open(), PLAN_B, ["illness", "months"], 24);
    const self = roles(wh.request).find((r) => r.key === "self")!.member;
    const cat = buildCatalog(wh, self.id, null);
    const a = applyPlan(wh, PLAN_B, cat);
    expect(a.contingency.illness?.months).toBe(24);
    expect([...a.reviews.values()].every((r) => r.state === "ok")).toBe(true);
    expect(a.request.input).toEqual(applyPlan({ ...wh, proposals: [plan(PLAN_B)] }, PLAN_B, cat).request.input);
    const rows = diffRows(wh, cat, PLAN_B);
    expect(rows).toMatchObject([{ cardLabel: "万一の前提（万一のタブ）", label: "万一の前提: 大きな病気の働けない期間", from: "共通: 既定", to: "24か月" }]);
    const changed = { ...wh, contingency: { ...wh.contingency, illness: { months: 6 } } };
    expect([...applyPlan(changed, PLAN_B, cat).reviews.values()][0]?.state).toBe("changed");
    wh = reflectPlan(wh, cat, PLAN_B, "2026-10-27T00:00:00Z");
    expect(wh.contingency.illness?.months).toBe(24);
  });
});

describe("足した場面と前提（計算は今のエンジンのまま）", () => {
  it("大きな病気は配偶者にも。収入が減る場面は前提の人・割合・年数で給与を減らす（両方も）", () => {
    const wh = open();
    expect(scenarios(wh).map((s) => s.key)).toEqual(expect.arrayContaining(["illness:self", "illness:spouse", "income"]));
    const sc = scenarios(wh).find((s) => s.key === "income")!;
    const y = Number(wh.request.input.baseMonth.slice(0, 4)) + 1;
    const one = scenarioRequest(wh, sc, y);
    expect(one.input.assumptions?.incomeShocks).toEqual([{ member: sc.member, from: `${y}-01`, to: `${y + 2}-12`, ratio: "0.2" }]);
    const both = scenarioRequest({ ...wh, contingency: { ...wh.contingency, incomeDrop: { member: "both", ratio: "0.5", years: 1 } } }, sc, y);
    expect(both.input.assumptions?.incomeShocks).toHaveLength(2);
    expect(sumRow(both, "cf.income.salary")).toBeLessThan(sumRow(baseRequest(wh.request), "cf.income.salary"));
  });

  it("大きな病気の復帰の後の働き方: 戻った月から○か月、収入を○割に", () => {
    const wh = open();
    const sc = scenarios(wh).find((s) => s.key === "illness:spouse")!;
    const y = Number(wh.request.input.baseMonth.slice(0, 4)) + 1;
    const req = scenarioRequest({ ...wh, contingency: { ...wh.contingency, illness: { months: 6, afterMonths: 12, afterRatio: "0.7" } } }, sc, y);
    expect(req.input.contingencies?.[0]?.member).toBe(sc.member);
    expect(req.input.assumptions?.incomeShocks).toEqual([{ member: sc.member, from: `${y}-07`, to: `${y + 1}-06`, ratio: "0.3" }]);
  });

  it("相場の下落: 既定は今までと同じ結果。下げる資産を選べ（外貨預金は器ごと）、戻り方は利回りの上限。ほかの場面にも重ねられる", () => {
    const wh = open("investmentCouple");
    const sc = scenarios(wh).find((s) => s.key === "market")!;
    const y = Number(wh.request.input.baseMonth.slice(0, 4)) + 3;
    const now = scenarioRequest(wh, sc, y);
    const old = baseRequest(wh.request);
    old.input.stressTest = { template: "marketDropAtRetirement", params: { year: y, drop: "0.3", assetClasses: ["equity.domestic", "equity.global", "reit.domestic", "reit.global"] } };
    expect(preview(now).table).toEqual(preview(old).table);
    const picked = scenarioRequest({ ...wh, contingency: { ...wh.contingency, market: { classes: ["bond.global", "kind:fxDeposit"], recoveryYears: 2, recoveryCap: "0" } } }, sc, y);
    expect(picked.input.assumptions?.marketShocks).toEqual([
      { year: y, drop: "0.3", assetClasses: ["bond.global"], kinds: ["taxable", "nisa", "childNisa", "juniorNisa", "legacyNisa", "ideco", "corporateDc", "pooled"] },
      { year: y, drop: "0.3", kinds: ["fxDeposit"] },
    ]);
    expect(picked.input.assumptions?.returnShifts?.at(-1)).toEqual({ from: y + 1, to: y + 2, cap: "0" });
    const death = scenarios(wh).find((s) => s.kind === "death")!;
    const stacked = scenarioRequest({ ...wh, contingency: { ...wh.contingency, stackMarket: true } }, death, y);
    expect(stacked.input.contingencies).toHaveLength(1);
    expect(stacked.input.assumptions?.marketShocks).toHaveLength(1);
    expect(scenarioRequest(wh, death, y).input.assumptions?.marketShocks).toBeUndefined();
  });

  it("必要保障額の逆算方式・子の独立とみなす年齢・業務上の死亡は要求に入る", () => {
    const wh = open();
    const spouse = wh.request.input.household.members.find((m) => m.kind === "spouse")!;
    const self = wh.request.input.household.members.find((m) => m.kind === "self")!;
    const c: ContingencyPlan = { ...wh.contingency, protection: { method: "reverse", reverseUntilAge: 90 }, survivor: { independenceAge: 20, deathBenefits: { workRelated: true } } };
    const p = protectionRequest({ ...wh, contingency: c }, self.id).input.protection!;
    expect(p).toMatchObject({ method: "reverse", reverseUntilAge: 90, survivor: { independenceAge: 20, deathBenefits: { workRelated: true } } });
    preview(protectionRequest({ ...wh, contingency: c }, self.id));
    void spouse;
  });

  it("残された配偶者の働き方を変える時期を時点で（亡くなった月より前なら亡くなった月）", () => {
    const wh = open();
    const h = wh.request.input.household;
    const spouse = h.members.find((m) => m.kind === "spouse")!;
    const child = h.members.find((m) => m.kind === "child")!;
    const at = Number(child.birth.birthYearMonth.slice(0, 4)) + 30;
    const p = survivorWorkPeriod(h, spouse, { type: "partTime", from: { at: `${at}-04` } }, `${at - 5}-01`);
    expect(p?.from).toEqual({ at: `${at}-04` });
    const early = survivorWorkPeriod(h, spouse, { type: "none", from: { at: "2000-01" } }, "2030-05");
    expect(early?.from).toEqual({ at: "2030-05" });
  });
});

describe("起きる年の範囲と年ごとの帯の順番", () => {
  it("起きる年は表の最後の年まで（75歳で切らない。上限60年）", () => {
    const req = modelHousehold("sampleSeniorCouple");
    const self = req.input.household.members.find((m) => m.kind === "self")!;
    const ys = yearOptions(req, self.id);
    expect(ys.at(-1)?.value).toBe(Math.min(req.input.endYear, Number(req.input.baseMonth.slice(0, 4)) + 60));
  });

  it("選んだ年の前後 → 5年ごと → 残りの年の順に計算する", () => {
    const list = Array.from({ length: 12 }, (_, i) => ({ year: 2026 + i }));
    expect(sweepOrder(list, 2032).map((x) => x.year)).toEqual([2032, 2031, 2033, 2030, 2034, 2036, 2026, 2029, 2035, 2028, 2027, 2037]);
  });
});
