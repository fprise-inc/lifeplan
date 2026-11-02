// 0111: 事務所の推定の値（事務所の既定値の画面で変えるマスタデータの値）と、推定で埋めない入力欄
import { afterEach, describe, expect, it } from "vitest";
import { DualEngine } from "../src/engine/dual.ts";
import type { HostApi } from "../src/engine/host.ts";
import { forEngine } from "../src/engine/moneyRows.ts";
import { officeEstimateValues } from "../src/engine/officeValues.ts";
import type { EngineRequest, PreviewResult } from "../src/engine/types.ts";
import { officialMasterValue, type BracketStep } from "../../hearing/src/statistics.ts";
import { estimateEntries, estimateEntry, isLegalValue, parseNumber, searchEstimates, sourceText, stepLabel } from "../src/workspace/office/estimateCatalog.ts";
import {
  basisOf,
  EMPTY_ESTIMATES,
  engineValuesOf,
  keepOfficeValue,
  officialUpdates,
  publishOfficeEstimates,
  readOfficeEstimates,
  withNoFill,
  withOfficeValue,
  withoutOfficeValue,
  type OfficeEstimates,
} from "../src/workspace/office/estimates.ts";
import { estimateCenterNotice } from "../src/workspace/office/customNotice.ts";
import { previewOfficeChange } from "../src/workspace/office/estimatePreview.ts";
import { applyOfficeDefaults, DEFAULT_OFFICE_SETTINGS, isDefaultSettings, readOfficeSettings, withEstimates } from "../src/workspace/office/settings.ts";
import { blankHousehold, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { livingEstimate, salaryEstimate, withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { convertPeriod } from "../src/workspace/input/stages/work.ts";
import { addChildWithEducation } from "../src/workspace/input/stages/family.ts";
import { ensureRetirement, gapsOf } from "../src/workspace/input/fill.ts";
import { modelHousehold, realEngine } from "./helpers.ts";

afterEach(() => publishOfficeEstimates(undefined));

const LIVING = "living.statistics.basicMonthly";
const CARE_MONTHS = "care.statistics.months";
const ON = "2026-11-02";
const living = (): readonly BracketStep[] => officialMasterValue(LIVING)?.value as readonly BracketStep[];
/** 2人の世帯の段だけを変えた基本生活費の表 */
const livingWith2 = (amount: number) => living().map((s) => (s.upTo === 2 ? { upTo: 2, amount } : s));
const wh = (req: EngineRequest): WorkingHousehold => ({ ...blankHousehold("2026-10"), request: req });
const NO_FILES = {} as Pick<HostApi, "report" | "sheets" | "takeaway" | "store" | "ai" | "office" | "statements" | "notices">;

function run(req: EngineRequest): PreviewResult {
  const { engine, packs } = realEngine();
  const out = JSON.parse(engine.runBatch(JSON.stringify([req]), packs, '{"preview":true}')) as (PreviewResult & { error?: unknown })[];
  const r = out[0] as PreviewResult & { error?: { code: string } };
  if (r.error !== undefined) throw new Error(JSON.stringify(r.error));
  return r;
}
const careTotal = (r: PreviewResult) => r.table.filter((c) => c.row.startsWith("cf.expense.care")).reduce((s, c) => s + c.amount, 0);

describe("一覧と値の読み方", () => {
  it("マスタデータの値は全部載り、法令で決まる値（国立大学・大学院の標準額）は載らない", () => {
    const ids = estimateEntries().map((e) => e.id);
    expect(ids).toContain(LIVING);
    expect(ids).toContain("lifeTable.lifeExpectancy.male");
    expect(ids).toContain("housing.statistics.mortgageRate.fixed");
    expect(ids.some((id) => id.startsWith("education.statistics.university.national."))).toBe(false);
    expect(isLegalValue("education.statistics.graduate.national.tuition")).toBe(true);
    // 制度データ（税・社会保険・年金）の値は一覧に無い
    expect(ids.some((id) => id.startsWith("incomeTax.") || id.startsWith("socialInsurance.") || id.startsWith("pension."))).toBe(false);
  });

  it("どの値にも画面の名前があり、出典の文にデータの読み方の注記が残らない", () => {
    for (const e of estimateEntries()) {
      expect(e.group).not.toBe("そのほか");
      expect(sourceText(e.official.title)).not.toMatch(/upTo|（）/);
    }
  });

  it("値の名前・値ID で探せる", () => {
    expect(searchEstimates("基本生活費").map((e) => e.id)).toContain(LIVING);
    expect(searchEstimates("care.statistics.months").map((e) => e.id)).toEqual([CARE_MONTHS]);
    expect(searchEstimates("介護 期間").map((e) => e.id)).toEqual([CARE_MONTHS]);
    expect(estimateEntry(CARE_MONTHS)?.name).toBe("介護の期間");
  });

  it("段の名前と数の読み方", () => {
    const e = estimateEntry(LIVING)!;
    const t = e.official.value as readonly BracketStep[];
    expect(stepLabel(e.axis, t, 1)).toBe("2人");
    expect(stepLabel(e.axis, t, t.length - 1)).toBe("6人以上");
    expect(parseNumber("yen", "250,000")).toBe(250000);
    expect(parseNumber("pct", "1.25")).toBe("0.0125");
    expect(parseNumber("yen", "abc")).toBeUndefined();
    expect(parseNumber("yen", "")).toBeNull();
  });
});

describe("根拠の文", () => {
  it("事務所の文の後ろに、変えた年月がいつも付く", () => {
    expect(basisOf({ text: "当事務所のお客さまの平均（2026年調べ）", changedOn: ON })).toBe("当事務所のお客さまの平均（2026年調べ）（2026年11月）");
  });
  it("書かなかったときは自動の文", () => {
    expect(basisOf({ changedOn: ON })).toBe("事務所の目安（2026年11月）");
  });
  it("空にはできない（空白・改行だけの文は自動の文になり、保存しても文を持たない）", () => {
    expect(basisOf({ text: "  \n ", changedOn: ON })).toBe("事務所の目安（2026年11月）");
    const e = withOfficeValue(EMPTY_ESTIMATES, CARE_MONTHS, 60, "   ", ON);
    expect(e.values[CARE_MONTHS]?.text).toBeUndefined();
    expect(basisOf(e.values[CARE_MONTHS]!)).toBe("事務所の目安（2026年11月）");
    // 読み込んだ文も同じ
    expect(readOfficeEstimates({ values: { [CARE_MONTHS]: { ...e.values[CARE_MONTHS], text: "" } } }).values[CARE_MONTHS]?.text).toBeUndefined();
  });
});

describe("値を変える・戻す・読む", () => {
  it("公式と同じ値にすると事務所の値を外す。形の違う値・法令の値は変えない", () => {
    expect(withOfficeValue(EMPTY_ESTIMATES, CARE_MONTHS, 55, null, ON).values).toEqual({});
    expect(withOfficeValue(EMPTY_ESTIMATES, CARE_MONTHS, "60", null, ON).values).toEqual({});
    expect(withOfficeValue(EMPTY_ESTIMATES, "education.statistics.university.national.tuition", 1, null, ON).values).toEqual({});
    expect(withOfficeValue(EMPTY_ESTIMATES, "incomeTax.basicDeduction", 1, null, ON).values).toEqual({});
    const e = withOfficeValue(EMPTY_ESTIMATES, LIVING, livingWith2(250000), "当事務所の平均", ON);
    expect(e.values[LIVING]).toMatchObject({ changedOn: ON, officialRev: officialMasterValue(LIVING)?.rev, text: "当事務所の平均" });
    expect(withoutOfficeValue(e, LIVING).values).toEqual({});
  });

  it("事務所データから読むとき、知らない値ID・法令の値・知らない入力欄は捨てる", () => {
    const good = withOfficeValue(EMPTY_ESTIMATES, CARE_MONTHS, 60, null, ON).values[CARE_MONTHS];
    const r = readOfficeEstimates({
      values: { [CARE_MONTHS]: good, "education.statistics.university.national.tuition": good, "nothing.at.all": good, "incomeTax.basicDeduction": good },
      noFill: ["livingExpense.monthly", "unknown.field"],
    });
    expect(Object.keys(r.values)).toEqual([CARE_MONTHS]);
    expect(r.noFill).toEqual(["livingExpense.monthly"]);
    // 事務所の既定値の欄として読み書きできる（空なら持たない）
    const s = withEstimates(DEFAULT_OFFICE_SETTINGS, r);
    expect(readOfficeSettings(JSON.parse(JSON.stringify(s))).estimates).toEqual(r);
    expect(isDefaultSettings(withEstimates(s, EMPTY_ESTIMATES))).toBe(true);
  });
});

describe("事務所の値が推定に効く（画面の推定・計算の要求の両方）", () => {
  it("画面の推定の目安が事務所の値と根拠の文になり、推定のままの値は入れ直しで新しい値になる", () => {
    const blank = blankHousehold("2026-10");
    const before = blank.request.input.household.livingExpenses?.[0]?.monthly?.value;
    // 空の世帯は本人1人（1人の段は統計の表に無いので仮の値）。1人の段を事務所の値にする
    const table = living().map((s) => (s.upTo === 1 ? { upTo: 1, amount: 150000 } : s));
    publishOfficeEstimates(withOfficeValue(EMPTY_ESTIMATES, LIVING, table, "当事務所の単身のお客さまの平均", ON));
    const e = livingEstimate(blank.request.input.household, "2026-10");
    expect(e).toEqual({ value: 150000, basis: "当事務所の単身のお客さまの平均（2026年11月）・1人の世帯" });
    const refreshed = withRefreshedEstimates(blank);
    expect(before).not.toBe(150000);
    expect(refreshed.request.input.household.livingExpenses?.[0]?.monthly).toMatchObject({ value: 150000, state: "estimated", estimate: { basis: e.basis } });
  });

  it("世帯ごとに入れた値（確定）は、事務所の値に変えても変わらず、計算もその値を使う（世帯の上書きが優先）", () => {
    const req = modelHousehold("salariedCoupleTwoKids");
    const confirmed = structuredClone(req);
    const l = confirmed.input.household.livingExpenses?.[0];
    if (l !== undefined) l.monthly = { value: 333000, state: "confirmed", origin: { kind: "manual" } };
    publishOfficeEstimates(withOfficeValue(EMPTY_ESTIMATES, LIVING, living().map((s) => (s.amount !== undefined ? { upTo: s.upTo, amount: s.amount + 50000 } : s)), null, ON));
    const after = withRefreshedEstimates(wh(confirmed));
    expect(after.request.input.household.livingExpenses?.[0]?.monthly).toEqual({ value: 333000, state: "confirmed", origin: { kind: "manual" } });
    // 計算エンジンは基本生活費を世帯の値で計算する（事務所の値は推定の元。世帯の値のほうが優先）
    const a = run(forEngine(after.request));
    publishOfficeEstimates(undefined);
    const b = run(forEngine(after.request));
    expect(a.table.filter((c) => c.row.startsWith("cf.expense.living"))).toEqual(b.table.filter((c) => c.row.startsWith("cf.expense.living")));
  });

  it("計算のときに引く目安（介護の期間）は、計算の要求の estimateValues で渡り、結果が変わる", () => {
    const req = modelHousehold("parentCare");
    const base = run(forEngine(req));
    publishOfficeEstimates(withOfficeValue(EMPTY_ESTIMATES, CARE_MONTHS, 120, null, ON));
    const sent = forEngine(req);
    expect(sent.input.estimateValues).toEqual({ [CARE_MONTHS]: 120 });
    // 世帯の要求（世帯ファイルに入る物）には足さない
    expect(req.input.estimateValues).toBeUndefined();
    expect(careTotal(run(sent))).toBeGreaterThan(careTotal(base));
  });

  it("画面の速い計算（セッション）と本体の計算（1件ずつ）が、事務所の値で同じ結果になる（0005）", async () => {
    const { engine, packs } = realEngine();
    publishOfficeEstimates(withOfficeValue(withOfficeValue(EMPTY_ESTIMATES, CARE_MONTHS, 120, null, ON), "care.statistics.monthlyHome", 80000, null, ON));
    const seen: string[] = [];
    const host: HostApi = {
      ...NO_FILES,
      kind: "browser-dev",
      packs: async () => packs,
      listHouseholds: async () => [],
      openHousehold: async () => modelHousehold("parentCare"),
      compute: async (slots) => {
        seen.push(...slots.map((s) => s.request));
        return { ms: 0, slots: Object.fromEntries(slots.map((x) => [x.id, { rev: x.rev, ms: 0, result: (JSON.parse(engine.runBatch(`[${x.request}]`, packs, '{"preview":true}')) as PreviewResult[])[0]! }])) };
      },
      evidence: async () => ({ error: { code: "E", ids: [] } }),
    };
    const d = new DualEngine({ session: engine.createSession(packs), host, onChange: () => undefined, setTimer: () => 0, clearTimer: () => undefined });
    await d.set({ current: modelHousehold("parentCare") });
    expect(d.mismatches).toBe(0);
    expect(d.view("current").source).toBe("canonical");
    expect(seen.every((t) => (JSON.parse(t) as EngineRequest).input.estimateValues?.[CARE_MONTHS] === 120)).toBe(true);
    expect(careTotal(d.view("current").result!)).toBeGreaterThan(careTotal(run(modelHousehold("parentCare"))));
  });

  it("法令の値は計算の要求でも変えられない（エンジンが断る）", () => {
    const req = modelHousehold("parentCare");
    expect(() => run({ ...req, input: { ...req.input, estimateValues: { "incomeTax.basicDeduction": 0 } } })).toThrow("E_ARGUMENT");
  });
});

describe("公式の値が新しくなったとき", () => {
  /** 前の版の公式の値で変えた事務所の値（写しの rev より1つ前の版で、値も違った） */
  const older = (): OfficeEstimates => {
    const e = withOfficeValue(EMPTY_ESTIMATES, CARE_MONTHS, 60, null, "2026-01-10");
    const v = e.values[CARE_MONTHS]!;
    return { ...e, values: { [CARE_MONTHS]: { ...v, officialRev: v.officialRev - 1, officialValue: 50 } } };
  };

  it("事務所の値を使い続け、知らせを出す（前の公式の値 → 新しい公式の値）", () => {
    const e = older();
    publishOfficeEstimates(e);
    expect(officeEstimateValues()).toEqual({ [CARE_MONTHS]: 60 });
    const u = officialUpdates(e);
    expect(u).toEqual([{ id: CARE_MONTHS, name: "介護の期間", change: "50か月 → 55か月", broken: false, rev: officialMasterValue(CARE_MONTHS)?.rev }]);
    const n = estimateCenterNotice(e);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ category: "office", title: "公式の統計の値が新しくなりました（介護の期間）" });
    expect(n[0]?.body).toContain("前 50か月 → 55か月");
  });

  it("「このまま」は事務所の値・根拠の文・変えた年月を変えずに知らせを消す。「公式に戻す」は事務所の値を外す", () => {
    const e = older();
    const kept = keepOfficeValue(e, CARE_MONTHS);
    expect(officialUpdates(kept)).toEqual([]);
    expect(kept.values[CARE_MONTHS]).toMatchObject({ value: 60, changedOn: "2026-01-10", officialValue: 55 });
    expect(estimateCenterNotice(kept)).toEqual([]);
    const reverted = withoutOfficeValue(e, CARE_MONTHS);
    expect(reverted.values).toEqual({});
    expect(officialUpdates(reverted)).toEqual([]);
  });

  it("公式の表の段の分け方が変わって合わなくなった値は、使わずに知らせる（計算が止まらない）", () => {
    const e = withOfficeValue(EMPTY_ESTIMATES, LIVING, livingWith2(250000), null, ON);
    const v = e.values[LIVING]!;
    const broken: OfficeEstimates = { ...e, values: { [LIVING]: { ...v, value: (v.value as BracketStep[]).slice(1), officialRev: v.officialRev - 1 } } };
    expect(engineValuesOf(broken)).toEqual({});
    expect(officialUpdates(broken)[0]).toMatchObject({ id: LIVING, broken: true });
    publishOfficeEstimates(broken);
    expect(officeEstimateValues()).toBeNull();
  });
});

describe("代表の世帯で差を見る", () => {
  it("変える前に、見本の世帯で主な結果がどう変わるかを出す（同じ値なら変わらない）", async () => {
    const { engine, packs } = realEngine();
    const deps = {
      open: async (id: string) => modelHousehold(id),
      compute: async (reqs: readonly EngineRequest[]) => (JSON.parse(engine.runBatch(JSON.stringify(reqs), packs, '{"preview":true}')) as PreviewResult[]).map((r) => ((r as { error?: unknown }).error === undefined ? r : null)),
    };
    // 4人の世帯の基本生活費を月5万円多くする
    const more = withOfficeValue(EMPTY_ESTIMATES, LIVING, living().map((s) => (s.upTo === 4 ? { upTo: 4, amount: (s.amount ?? 0) + 50000 } : s)), null, ON);
    const rows = await previewOfficeChange(deps, EMPTY_ESTIMATES, more);
    const family = rows.find((r) => r.id === "salariedCoupleTwoKids")!;
    expect(family.changed).toBe(true);
    expect(family.after.target).toBeLessThan(family.before.target);
    expect(family.after.expense).toBeGreaterThan(family.before.expense);
    // 同じ値どうしなら変わらない
    const same = await previewOfficeChange(deps, more, more);
    expect(same.every((r) => !r.changed)).toBe(true);
    // 差を見ても、今の事務所の値（推定の目安・計算の要求）は変わらない
    expect(officeEstimateValues()).toBeNull();
    expect(livingEstimate(blankHousehold("2026-10").request.input.household, "2026-10").basis).not.toContain("事務所");
  });
});

describe("推定で埋めない入力欄", () => {
  it("基本生活費: 新しい世帯に推定の基本生活費を入れず、確かめの一覧の未入力に出る（推定で埋めるはできる）", () => {
    const s = withEstimates(DEFAULT_OFFICE_SETTINGS, withNoFill(EMPTY_ESTIMATES, "livingExpense.monthly", true));
    publishOfficeEstimates(s.estimates);
    const w = applyOfficeDefaults(blankHousehold("2026-10"), s);
    expect(w.request.input.household.livingExpenses ?? []).toEqual([]);
    const gap = gapsOf(w).find((g) => g.id === "living");
    expect(gap).toBeDefined();
    expect(gap?.fill?.(w).request.input.household.livingExpenses?.length).toBe(1);
    // 選んでいなければ今までどおり
    expect(applyOfficeDefaults(blankHousehold("2026-10"), DEFAULT_OFFICE_SETTINGS).request.input.household.livingExpenses?.length).toBe(1);
  });

  it("給与: 働き方を足しても未入力の0円（推定に戻すの目安も出さない）", () => {
    const m = blankHousehold("2026-10").request.input.household.members[0]!;
    const p = { id: "p1", member: m.id, from: { at: "2026-10" }, to: null, type: "unemployed" } as unknown as Parameters<typeof convertPeriod>[0];
    expect(convertPeriod(p, "regular", m, "2026-10").salary?.annual).toMatchObject({ state: "estimated", estimate: { method: "statistic" } });
    publishOfficeEstimates(withNoFill(EMPTY_ESTIMATES, "employment.salary.annual", true));
    expect(salaryEstimate("regular", "male", { age: 40 })).toBeNull();
    const out = convertPeriod(p, "regular", m, "2026-10");
    expect(out.salary?.annual).toMatchObject({ value: 0, state: "estimated" });
    expect((out.salary?.annual as { estimate?: { basis?: string } }).estimate?.basis).toMatch(/^未入力/);
  });

  it("子の進路・退職金: 自動で入れない", () => {
    publishOfficeEstimates(withNoFill(withNoFill(EMPTY_ESTIMATES, "goal.education", true), "retirementBenefit.amount", true));
    const w = addChildWithEducation(blankHousehold("2026-10"));
    expect(w.request.input.household.goals ?? []).toEqual([]);
    const req = modelHousehold("salariedCoupleTwoKids");
    const noBenefit = structuredClone(req);
    noBenefit.input.household.retirementBenefits = [];
    const self = noBenefit.input.household.members.find((x) => x.kind === "self")!;
    expect(ensureRetirement(wh(noBenefit), self.id).request.input.household.retirementBenefits).toEqual([]);
  });
});
