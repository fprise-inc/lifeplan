// 率の欄の範囲（0098）: 利回り・上昇率・変化率の欄に範囲の外の値を入れると計算が止まっていた（999% で金額が安全に扱える整数を超える、
// 賃金上昇率・物価上昇率 -100% で率を 0 で割る）。範囲の外は欄に書かず欄の下に範囲を出す・範囲の端なら計算が止まらない・
// 古い世帯に入っていた範囲の外の値は値を変えずに知らせて押したときだけ直す・つまみ・AIの候補・事務所の既定値も同じ範囲
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { AiCandidate } from "../src/engine/host.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { candidateRows } from "../src/workspace/ai/model.ts";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { engineErrorText } from "../src/workspace/engineErrors.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { rejectReason } from "../src/workspace/input/FieldViews.tsx";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { FEE_RANGE, GROWTH_RANGE, HEALTH_RATE_RANGE, outOfRangeText, RETURN_RANGE, SLIDE_RANGE, STAGE_RATIO_RANGE, type PctRange } from "../src/workspace/input/rateRanges.ts";
import { buildStage, buildStages } from "../src/workspace/input/stages/index.ts";
import { OfficeSettingsPanel, pctToRate } from "../src/workspace/office/OfficeSettingsPanel.tsx";
import { ASSUMPTION_RANGES, DEFAULT_OFFICE_SETTINGS } from "../src/workspace/office/settings.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold, preview } from "./helpers.ts";

const IDS = readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -5));

/** 欄の名前（例外の年の率は前提の名前の鍵）→ 範囲 */
const BY_LABEL: Readonly<Record<string, PctRange>> = {
  "物価上昇率（年）": GROWTH_RANGE,
  "賃金上昇率（年）": GROWTH_RANGE,
  "教育費の上昇率（年）": GROWTH_RANGE,
  "運用利回り（年）": RETURN_RANGE,
  "年金の調整率（基礎年金・年）": SLIDE_RANGE,
  "年金の調整率（厚生年金・年）": SLIDE_RANGE,
  "利回り（年・費用と税を引く前）": RETURN_RANGE,
  "土地の上昇率（年）": GROWTH_RANGE,
  "利回り（年）": RETURN_RANGE,
  "平均の利回り（年）": RETURN_RANGE,
  "評価額の伸び率（年）": RETURN_RANGE,
  "運用の費用（年）": FEE_RANGE,
  "利回り（年・この段から）": RETURN_RANGE,
  "その年の利回り（年）": RETURN_RANGE,
  // 入力項目をまたぐ言葉の決まりの率の欄の名前（決まった率の伸び方）。前の名前は、まだ当てはめていない入力項目のために残す
  "伸び率（年）": GROWTH_RANGE,
  // 住まいの率の欄（伸び率）。修繕・管理の費用の伸び率は、建て方で名前が変わる（マンション「管理費・修繕積立金の伸び率（年）」・戸建て「修繕の積み立ての伸び率（年）」）。見本の世帯は建て方を選んでいない
  "家賃の伸び率（年）": GROWTH_RANGE,
  "固定資産税の伸び率（年）": GROWTH_RANGE,
  "修繕・管理の費用の伸び率（年）": GROWTH_RANGE,
  "土地の評価額の伸び率（年）": GROWTH_RANGE,
  "年額の伸び率（年）": GROWTH_RANGE,
  "値上げの率（年）": GROWTH_RANGE,
};
const EXCEPTION: Readonly<Record<string, PctRange>> = {
  inflation: GROWTH_RANGE,
  wageGrowth: GROWTH_RANGE,
  investmentReturn: RETURN_RANGE,
  educationInflation: GROWTH_RANGE,
  pensionMacroSlide: SLIDE_RANGE,
  pensionMacroSlideEmployee: SLIDE_RANGE,
  assetReturns: RETURN_RANGE,
  realEstate: GROWTH_RANGE,
};

/** 見本の世帯に、決まった率の伸び方・例外の年・運用の費用を入れて、率の欄が出るようにする */
function widened(id: string): EngineRequest {
  const req = modelHousehold(id);
  const h = req.input.household;
  for (const l of h.livingExpenses ?? []) l.growth = { kind: "rate", rate: "0.01" };
  for (const p of h.periodicExpenses ?? []) p.growth = { kind: "rate", rate: "0.01" };
  for (const c of h.cars ?? []) c.growth = { kind: "rate", rate: "0.01" };
  for (const e of h.employmentPeriods ?? []) if (e.salary !== undefined) e.salary.growth = { rate: "0.01" };
  const a = req.input.assumptions as unknown as Record<string, { default: string; byYear?: Record<string, string> } | Record<string, { default: string; byYear?: Record<string, string> }>>;
  const y = String(Number(req.input.baseMonth.slice(0, 4)) + 2);
  for (const k of ["inflation", "wageGrowth", "investmentReturn", "educationInflation", "pensionMacroSlide", "pensionMacroSlideEmployee"]) a[k] = { default: "0.01", byYear: { [y]: "0.02" } };
  const assumed = req.input.assumptions!;
  assumed.realEstateValuation = { ...assumed.realEstateValuation, landGrowth: { default: "0.01", byYear: { [y]: "0.02" } } };
  // 利回りを入れた口座に、利回りの段と例外の年
  const acc = (h.accounts ?? []).find((x) => x.expectedReturn !== undefined && x.kind !== "deposit");
  if (acc !== undefined) {
    acc.returnStages = [{ id: "00000000-0000-4000-8000-0000000000f1", at: { at: `${y}-01` }, expectedReturn: "0.02" }];
    acc.returnExceptions = [{ id: "00000000-0000-4000-8000-0000000000f2", year: Number(y) + 1, expectedReturn: "-0.05" }];
  }
  return req;
}

describe("範囲の無かった率の欄（健康保険料率・段の割合。0177）", () => {
  it("マイナスと大きすぎる値は打った時点で止め、範囲の端は受け付ける", () => {
    const kinds: [string, RegExp, PctRange][] = [
      ["健康保険料率（本人負担分）", /\/hiRate$/, HEALTH_RATE_RANGE],
      ["生活費の段の割合", /^living\/.*\/stage\/[^/]+\/ratio$/, STAGE_RATIO_RANGE],
      ["住まいの段の割合（家賃・修繕や管理の費用・固定資産税）", /^housing\/.*\/stage\/[^/]+\/ratio$/, STAGE_RATIO_RANGE],
    ];
    const found = new Map<string, number>();
    for (const id of IDS) {
      const wh = fromRequest(widened(id));
      for (const f of buildStages(wh).flatMap((s) => allFields(s))) {
        if (f.kind !== "pct") continue;
        const hit = kinds.find(([, re]) => re.test(f.key));
        if (hit === undefined) continue;
        const [name, , range] = hit;
        found.set(name, (found.get(name) ?? 0) + 1);
        expect([f.min, f.max], `${id} ${f.key}`).toEqual([range.min, range.max]);
        expect(rejectReason(f, "-100"), f.key).toBe("0%より小さい値は設定できません。");
        expect(rejectReason(f, "-5"), f.key).toBe("0%より小さい値は設定できません。");
        expect(rejectReason(f, "999"), f.key).toBe(`${range.max}%より大きい値は設定できません。`);
        expect(rejectReason(f, "0"), f.key).toBeNull();
        expect(rejectReason(f, String(range.max)), f.key).toBeNull();
      }
    }
    expect(kinds.map(([n]) => n).filter((n) => !found.has(n))).toEqual([]);
  });
  it("古い世帯に入っていたマイナスの健康保険料率は、値を変えずに知らせ、押すと0%にする", () => {
    const req = modelHousehold("civilServant");
    const p = req.input.household.employmentPeriods!.find((e) => e.healthInsurance?.employeeRate !== undefined)!;
    (p.healthInsurance as unknown as { employeeRate: { value: string } }).employeeRate.value = "-1";
    const wh = fromRequest(req);
    const f = buildStages(wh).flatMap((s) => allFields(s)).find((x) => x.key.endsWith("/hiRate"))!;
    const st = f.get(wh);
    expect(st.value).toBe("-1");
    expect(st.warn).toContain("範囲（0%〜10%）の外の値（-100%）");
    expect(st.warnFix?.label).toBe("0%にする");
  });
});

describe("率の欄の範囲（0098）", () => {
  it("利回り・上昇率・変化率の欄は、範囲の外の値（999%・-100% など）を入れられず、欄の下に越えた側の端を出す（「15%より大きい値は設定できません。」）", () => {
    const found = new Map<string, number>();
    for (const id of IDS) {
      const wh = fromRequest(widened(id));
      for (const f of buildStages(wh).flatMap((s) => allFields(s))) {
        if (f.kind !== "pct") continue;
        const ex = /^assume\/(\w+)\/(?:[^/]+\/)?ex\/\d+\/rate$/.exec(f.key);
        const range = ex !== null ? EXCEPTION[ex[1] as string] : BY_LABEL[f.label];
        if (range === undefined) continue;
        const name = ex !== null ? `例外の年（${ex[1]}）` : f.label;
        found.set(name, (found.get(name) ?? 0) + 1);
        const over = `${range.max}%より大きい値は設定できません。`;
        const under = `${range.min}%より小さい値は設定できません。`;
        expect([f.min, f.max], `${id} ${f.key}`).toEqual([range.min, range.max]);
        expect(rejectReason(f, "999"), f.key).toBe(over);
        expect(rejectReason(f, "-100"), f.key).toBe(under);
        expect(rejectReason(f, String(range.max + 0.5)), f.key).toBe(over);
        expect(rejectReason(f, String(range.min - 0.5)), f.key).toBe(under);
        expect(rejectReason(f, String(range.max)), f.key).toBeNull();
        expect(rejectReason(f, String(range.min)), f.key).toBeNull();
      }
    }
    // どの欄も、見本のどれかに出ている（欄の名前が変わったら、この表も直す）
    expect([...Object.keys(BY_LABEL), ...Object.keys(EXCEPTION).map((k) => `例外の年（${k}）`)].filter((k) => !found.has(k))).toEqual([]);
  });

  it("範囲の端の値なら、どの見本の世帯も計算が止まらない（表の標準の長さ。利回りの上の端と上昇率の上の端を重ねても）", () => {
    const pct = (v: number) => String(v / 100);
    const combos: [PctRange["min"], number, number][] = [
      [RETURN_RANGE.max, GROWTH_RANGE.max, SLIDE_RANGE.min],
      [RETURN_RANGE.max, GROWTH_RANGE.min, SLIDE_RANGE.max],
      [RETURN_RANGE.min, GROWTH_RANGE.max, SLIDE_RANGE.min],
      [RETURN_RANGE.min, GROWTH_RANGE.min, SLIDE_RANGE.max],
    ];
    const fails: string[] = [];
    for (const [r, g, s] of combos)
      for (const id of IDS) {
        const req = widened(id);
        const a = req.input.assumptions!;
        a.investmentReturn = { default: pct(r) };
        for (const k of Object.keys(a.assetReturns ?? {})) (a.assetReturns as Record<string, { default: string }>)[k] = { default: pct(r) };
        a.inflation = { default: pct(g) };
        a.wageGrowth = { default: pct(g) };
        a.educationInflation = { default: pct(g) };
        a.pensionMacroSlide = { default: pct(s) };
        const h = req.input.household;
        for (const x of h.accounts ?? []) {
          if (x.expectedReturn !== undefined) Object.assign(x, { expectedReturn: pct(r), fee: pct(FEE_RANGE.max) });
          if (x.valueGrowth !== undefined) x.valueGrowth = pct(r);
          const rental = (x as { property?: { rental?: { growth?: string }; expenses?: { growth?: string } } }).property;
          if (rental?.rental?.growth !== undefined) rental.rental.growth = pct(g);
          if (rental?.expenses?.growth !== undefined) rental.expenses.growth = pct(g);
        }
        for (const x of h.residences ?? []) {
          if (x.rent?.growth !== undefined) x.rent.growth = pct(g);
          if (x.propertyTax?.growth !== undefined) x.propertyTax.growth = pct(g);
          if (x.maintenance?.growth !== undefined) x.maintenance.growth = pct(g);
        }
        for (const l of h.livingExpenses ?? []) l.growth = { kind: "rate", rate: pct(g) };
        for (const p of h.periodicExpenses ?? []) p.growth = { kind: "rate", rate: pct(g) };
        for (const e of h.employmentPeriods ?? []) if (e.salary !== undefined) e.salary.growth = { rate: pct(g) };
        try {
          preview(req);
        } catch (e) {
          fails.push(`${id} ${r}/${g}/${s}: ${String(e).slice(0, 120)}`);
        }
      }
    expect(fails).toEqual([]);
  }, 300_000);

  it("古い世帯に入っていた範囲の外の値は、値を変えずに欄と確かめの一覧に知らせ、押したときだけ範囲の端にする", () => {
    const req = modelHousehold("salariedCoupleTwoKids");
    const a = req.input.assumptions!;
    a.investmentReturn = { default: "9.99" };
    a.wageGrowth = { default: "-1" };
    const wh = fromRequest(req);
    // このままでは計算が止まる（止まったときの文で、範囲の外の率を見直すよう案内する）
    expect(() => preview(wh.request)).toThrow();
    const fieldOf = (w: WorkingHousehold, key: string): FieldDef => {
      const f = allFields(buildStage("assumptions", w)).find((x) => x.key === key);
      if (f === undefined) throw new Error(key);
      return f;
    };
    const ir = fieldOf(wh, "assume/investmentReturn").get(wh);
    expect(ir.value).toBe("9.99");
    expect(ir.warn).toContain("範囲（-10%〜15%）の外の値（999%）");
    expect(ir.warnFix?.label).toBe("15%にする");
    const wg = fieldOf(wh, "assume/wageGrowth").get(wh);
    expect(wg.warn).toContain("範囲（-10%〜10%）の外の値（-100%）");
    // 確かめの一覧にも出る（直すボタンつき）
    const rows = checkList(wh).filter((r) => r.id === "field:assume/investmentReturn" || r.id === "field:assume/wageGrowth");
    expect(rows.flatMap((r) => r.actions.map((x) => x.label)).sort()).toEqual(["-10%にする", "15%にする"]);
    // 押すと範囲の端にして、計算できる
    let fixed = ir.warnFix!.run(wh);
    fixed = fieldOf(fixed, "assume/wageGrowth").get(fixed).warnFix!.run(fixed);
    expect(fixed.request.input.assumptions?.investmentReturn.default).toBe("0.15");
    expect(fixed.request.input.assumptions?.wageGrowth?.default).toBe("-0.1");
    // 範囲の知らせは消える（年5%を超える注意の線の知らせは、今までどおり出る）
    expect(fieldOf(fixed, "assume/investmentReturn").get(fixed).warn).not.toContain("範囲");
    expect(() => preview(fixed.request)).not.toThrow();
    // 止まったときの文
    expect(engineErrorText("E_UNSAFE_INTEGER", [], null)).toContain("範囲の外の率と、表の最後の年を見直してください");
    expect(engineErrorText("E_ARGUMENT", ["rateDiv.zero"], null)).toContain("-100% の上昇率など");
  });

  it("結果のタブの運用の利回りのつまみは 15% より右へ動かず、AIの候補の範囲の外の率は取り込まない", () => {
    const req = modelHousehold("salariedCoupleTwoKids");
    // 運用する口座（全世界株式だけの NISA）の利回りが 14%
    (req.input.assumptions!.assetReturns as Record<string, { default: string }>)["equity.global"] = { default: "0.14" };
    const wh = fromRequest(req);
    const self = roles(req).find((r) => r.key === "self")!.member;
    const cat = buildCatalog(wh, self.id, demoHousehold("salariedCoupleTwoKids") ?? null);
    const inv = cat.byKey.get("inv:rate");
    expect(inv?.control).toMatchObject({ kind: "rate", max: "0.15", limit: RETURN_RANGE });
    const c: AiCandidate = {
      id: "c-1",
      source: "ai",
      shareId: "s-1",
      receivedAt: "2026-10-19T01:00:00.000Z",
      title: "利回りを上げる",
      summary: "比べるため",
      diffs: [
        { id: "d1", target: { plan: "assumptions" }, item: "assumptions.inflation", op: "set", value: "9.99", note: null },
        { id: "d2", target: { plan: "assumptions" }, item: "assumptions.inflation", op: "set", value: "0.02", note: null },
      ],
      origin: { kind: "ai", connector: "client 1.0" },
      status: "pending",
      decidedAt: null,
    } as AiCandidate;
    const rows = candidateRows(c, wh, cat);
    expect(rows[0]?.reason).toBe("入れてよい範囲（-10%〜10%）の外の値のため、取り込みません");
    expect(rows[1]?.reason).toBeNull();
  });

  it("事務所の既定値の前提条件の標準値も、入力の画面と同じ範囲", () => {
    const at = (k: keyof typeof ASSUMPTION_RANGES, t: string) => pctToRate(t, ASSUMPTION_RANGES[k].min, ASSUMPTION_RANGES[k].max);
    expect(at("inflation", "10")).toBe("0.1");
    expect(at("inflation", "15")).toBeUndefined();
    expect(at("wageGrowth", "-10")).toBe("-0.1");
    expect(at("wageGrowth", "-11")).toBeUndefined();
    expect(at("investmentReturn", "15")).toBe("0.15");
    expect(at("investmentReturn", "16")).toBeUndefined();
    expect(at("pensionMacroSlide", "-0.1")).toBeUndefined();
    expect(at("pensionMacroSlide", "5")).toBe("0.05");
  });

  it("範囲の外の率の知らせは、越えた側の端を言う（上なら「より大きい」、下なら「より小さい」）", () => {
    expect(outOfRangeText("0.16", RETURN_RANGE)).toBe("15%より大きい値は設定できません。");
    expect(outOfRangeText("9.99", RETURN_RANGE)).toBe("15%より大きい値は設定できません。");
    expect(outOfRangeText("0.105", GROWTH_RANGE)).toBe("10%より大きい値は設定できません。");
    expect(outOfRangeText("-0.11", RETURN_RANGE)).toBe("-10%より小さい値は設定できません。");
    expect(outOfRangeText("-1", GROWTH_RANGE)).toBe("-10%より小さい値は設定できません。");
    expect(outOfRangeText("0.06", SLIDE_RANGE)).toBe("5%より大きい値は設定できません。");
    expect(outOfRangeText("-0.001", FEE_RANGE)).toBe("0%より小さい値は設定できません。");
    // 端の値・範囲の中・読めない率は知らせない
    expect(outOfRangeText("0.15", RETURN_RANGE)).toBeNull();
    expect(outOfRangeText("-0.1", RETURN_RANGE)).toBeNull();
    expect(outOfRangeText("0.03", GROWTH_RANGE)).toBeNull();
    expect(outOfRangeText("abc", RETURN_RANGE)).toBeNull();
  });

  it("事務所の既定値の前提条件の欄も、範囲の外の数なら欄の下に同じ知らせを出す（保存はできない）", () => {
    const html = renderToString(h(OfficeSettingsPanel, { value: { ...DEFAULT_OFFICE_SETTINGS, assumptions: { investmentReturn: "0.2", wageGrowth: "-0.12", inflation: "0.02" } }, onSave: async () => undefined, shared: false, onClose: () => undefined }));
    expect(html).toMatch(/data-office-setting-problem="investmentReturn"[^>]*>15%より大きい値は設定できません。</);
    expect(html).toMatch(/data-office-setting-problem="wageGrowth"[^>]*>-10%より小さい値は設定できません。</);
    expect(html).not.toContain('data-office-setting-problem="inflation"');
    expect(html).toContain("運用利回りは -10〜15%");
  });
});
