// エンジン全体: モデル世帯の計算・根拠の記録・入出力の検査（製品の制度データ。原本での確認待ちの値を含む）
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OFFICIAL_COMPONENTS } from "../src/components/index.ts";
import { runEngine, runJson, type EngineResult } from "../src/engine/run.ts";
import { defineComponent, type ComponentDefinition } from "../src/registry/define.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { check } from "../src/io/validate.ts";
import { CONVENTIONS } from "../src/money/conventions.ts";
import { divRound, mulInt, type RoundingMode } from "../src/money/integer.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { clone, modelHousehold, nonIntegerPaths, realPacks } from "./helpers.ts";

const MODELS = readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));
const run = (r: EngineRequest, trace: EngineRequest["trace"] = "none") => runEngine({ ...r, trace }, realPacks(), { checkInternal: true });
type Cell = { row: string; year: number; amount: number; member?: string };
const cells = (r: EngineResult) => r.table as unknown as Cell[];
const cell = (r: EngineResult, row: string, year: number) => cells(r).filter((c) => c.row === row && c.year === year).reduce((s, c) => s + c.amount, 0);
const annual = (r: EngineResult, row: string, year: number) => r.annual.find((a) => a.row === row && a.year === year)?.amount as number;

describe("モデル世帯（架空）", () => {
  it("10件以上あり、どれも計算でき、出力は JSON Schema に合い整数だけ", () => {
    expect(MODELS.length).toBeGreaterThanOrEqual(10);
    for (const m of MODELS) {
      const req = modelHousehold(m);
      const r = run(req);
      expect(() => check("engine.output", r, "E_OUTPUT_SCHEMA")).not.toThrow();
      expect(nonIntegerPaths(r)).toEqual([]);
      expect(r.flows.every((f) => f.ym >= req.input.baseMonth && f.ym <= `${req.input.endYear}-12`)).toBe(true);
    }
  });

  it("期首残高＋収支＋運用益＝期末残高が毎年成り立つ（0003 の性質のテスト）", () => {
    for (const m of MODELS) {
      const req = modelHousehold(m);
      const r = run(req);
      let prev = req.input.household.accounts.reduce((s, a) => s + (a.marketValue.value ?? 0), 0);
      for (const y of [2026, 2027]) {
        const end = annual(r, "cf.balance.financial", y);
        expect(prev + annual(r, "cf.net", y) + annual(r, "cf.balance.return", y)).toBe(end);
        prev = end;
      }
    }
  });

  it("年間収支＝収入−税・社会保険料−支出（器の間の移動は入れない）", () => {
    for (const m of MODELS) {
      const r = run(modelHousehold(m));
      const sum = (p: string) => cells(r).filter((c) => c.year === 2027 && c.row.startsWith(p)).reduce((s, c) => s + c.amount, 0);
      expect(annual(r, "cf.net", 2027)).toBe(sum("cf.income.") - sum("cf.taxSi.") - sum("cf.expense."));
    }
  });

  it("同じ入力なら同じ出力（文字列として一致）", () => {
    const req = modelHousehold("singleEarnerTwoKids");
    expect(JSON.stringify(run(req))).toBe(JSON.stringify(run(req)));
  });

  it("未対応の制度は見出しの notices に ID だけで出す", () => {
    const r = run(modelHousehold("jobLeaver"));
    const notices = (r.header as { notices: { code: string; ids: string[] }[] }).notices;
    // 国民健康保険の全国の標準的な料率がまだ無く、世帯の入力も無いので計算せずに知らせる
    expect(notices).toContainEqual({ code: "N_INPUT_REQUIRED", ids: ["socialInsurance.nationalHealth", "socialInsurance.nationalHealth.rates"] });
    // 指定都市の配分・超過課税は扱わない（決定8）
    expect(notices).toContainEqual({ code: "N_NOT_SUPPORTED", ids: ["residentTax.annual", "residentTax.designatedCityAllocation", "residentTax.excessTaxation"] });
  });
});

describe("100年分の表", () => {
  it("計算でき、延ばした値の知らせ（N_PARAM_PROJECTED）は値の ID ごとに1つにまとまる", () => {
    const r = run(modelHousehold("lifetime100"));
    expect(r.table.some((c) => (c as unknown as Cell).year === 2125)).toBe(true);
    const projected = (r.header as { notices: { code: string; ids: string[] }[] }).notices.filter((n) => n.code === "N_PARAM_PROJECTED");
    const keys = projected.map((n) => `${n.ids[0]}|${n.ids[1]}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(projected).toContainEqual({ code: "N_PARAM_PROJECTED", ids: ["pension.supplementaryBenefit", "pension.supplementaryBenefit.incomeLimit", expect.any(String), "2125"] });
  });
});

describe("計算方式の設定と2本の時間軸", () => {
  it("aggregation を切り替えると載る年だけが変わり、合計は変わらない。住民税は所得の年に帰属する", () => {
    const req = modelHousehold("single25");
    const cash = run(req);
    const acc = clone(req);
    (acc.input.calcConventions as { aggregation: string }).aggregation = "accrual";
    const accrual = run(acc);
    const total = (x: EngineResult, row: string) => cells(x).filter((c) => c.row === row).reduce((s, c) => s + c.amount, 0);
    for (const row of ["cf.taxSi.residentTax", "cf.taxSi.health", "cf.income.salary"]) expect(total(accrual, row)).toBe(total(cash, row));
    // 2027年1〜5月に払う住民税（令和8年度分＝2025年の所得）は、表の最初の年（2026）に載る
    expect(cell(accrual, "cf.taxSi.residentTax", 2026)).toBeGreaterThan(cell(cash, "cf.taxSi.residentTax", 2026));
    expect(cash.flows.filter((f) => f.row === "cf.taxSi.residentTax" && f.ym >= "2027-06").every((f) => f.accrualYear === 2026)).toBe(true);
  });

  it("dataSet で令和8年度改正より前のパックの版（知った時点）を使える", () => {
    const req = modelHousehold("single45");
    const latest = run(req);
    const old = clone(req);
    (old.input as { dataSet?: Record<string, string> }).dataSet = { "regulation.tax": "2026.1.0", "regulation.socialInsurance": "2026.1.0" };
    const before = run(old);
    // 改正前の知識では基礎控除・給与所得控除が小さく、2027年の所得税が多い
    expect(cell(before, "cf.taxSi.incomeTax", 2027)).toBeGreaterThan(cell(latest, "cf.taxSi.incomeTax", 2027));
    // 子ども・子育て支援金率は令和8年度の行（版 2026.2.0）で入った
    expect(cell(before, "cf.taxSi.childSupport", 2027)).toBe(0);
    expect(cell(latest, "cf.taxSi.childSupport", 2027)).toBeGreaterThan(0);
    const data = (before.header as { data: { packId: string; asOf: string }[] }).data;
    expect(data.filter((d) => d.packId !== "regulation.pension").map((d) => d.asOf)).toEqual(["2026.1.0", "2026.1.0"]);
    // その版のときにはまだ無かった値ID（後の版で足した値）は最新の版の行を使い、見出しで知らせる
    const notices = (before.header as { notices: { code: string; ids: string[] }[] }).notices;
    expect(notices.some((n) => n.code === "N_PARAM_RECORDED_LATER" && n.ids[0]?.startsWith("socialInsurance.health.lateElderlyAge@"))).toBe(true);
  });

  it("dataSet に知らないパックを書くとエラー", () => {
    const req = clone(modelHousehold("single25"));
    (req.input as { dataSet?: Record<string, string> }).dataSet = { "regulation.nothing": "2026.1.0" };
    expect(() => run(req)).toThrow("E_PACK_UNKNOWN");
  });
});

describe("根拠の記録", () => {
  const base = modelHousehold("singleEarnerTwoKids");
  const none = run(base, "none");
  const summary = run(base, "summary");
  const full = run(base, "full");

  it("none・summary・full で数字が同じ", () => {
    for (const r of [summary, full]) {
      expect(JSON.stringify(r.flows)).toBe(JSON.stringify(none.flows));
      expect(JSON.stringify(r.annual)).toBe(JSON.stringify(none.annual));
      expect(JSON.stringify(r.table)).toBe(JSON.stringify(none.table));
    }
    expect(none.trace).toBeNull();
  });

  it("どの細かさでも見出し（版・部品表・データの版・基準月・計算方式・知らせ）を付ける", () => {
    const h = none.header as Record<string, unknown>;
    expect(Object.keys(h)).toEqual(["engine", "trace", "baseMonth", "endYear", "calcConventions", "components", "data", "notices"]);
    expect((h.data as { fictional: boolean }[]).every((d) => !d.fictional)).toBe(true);
    expect((h.components as { id: string }[]).map((c) => c.id)).toContain("socialInsurance.health");
  });

  it("summary は部品ごとに計算式・制度の値（値ID@改訂）・端数処理の規則を持つ", () => {
    const t = summary.trace as { components: { id: string; formulas: string[]; params: { ref: string }[]; roundings: string[] }[] };
    const health = t.components.find((c) => c.id === "socialInsurance.health");
    expect(health?.formulas).toContain("socialInsurance.health.monthly");
    expect(health?.params.map((p) => p.ref)).toContain("socialInsurance.health.kyokaikenpo.rate@70");
    expect(health?.roundings).toEqual(["socialInsurance.employeeShare.rounding"]);
    for (const c of t.components) for (const p of c.params) expect(p.ref).toMatch(/^[a-zA-Z][a-zA-Z0-9.]*@\d+$/);
  });

  it("full は重複を除いた記録を番号で指し、お金の動きはそれを作った部品の呼び出しを指す（呼び出しごとの細かさ）", () => {
    const t = full.trace as { nodes: { type: string; uses?: number[]; component?: string }[]; flows: number[]; annual: number[] };
    expect(t.flows).toHaveLength(full.flows.length);
    for (const i of [...t.flows, ...t.annual]) expect(t.nodes[i]?.type).toBe("call");
    for (const n of t.nodes) for (const u of n.uses ?? []) expect(u).toBeLessThan(t.nodes.length);
    const keys = t.nodes.map((n) => JSON.stringify(n));
    expect(new Set(keys).size).toBe(keys.length);
    const i = full.flows.findIndex((f) => f.formula === "incomeTax.annual.withholding");
    expect(t.nodes[t.flows[i] as number]?.component).toBe("incomeTax.annual");
  });

  it("full の端数処理の記録だけから計算し直して同じ値になる", () => {
    const t = full.trace as { nodes: Record<string, unknown>[] };
    const params = t.nodes.filter((n) => n.type === "param");
    const ruleOf = (id: string): { mode: RoundingMode; unit: number } =>
      (CONVENTIONS[id] ?? (params.find((p) => p.id === id)?.value as { mode: RoundingMode; unit: number })) as never;
    const roundings = t.nodes.filter((n) => n.type === "rounding" && n.op !== "allocate");
    expect(roundings.length).toBeGreaterThan(30);
    for (const n of roundings) {
      const [num, den] = String(n.input).split("/").map((s) => BigInt(s)) as [bigint, bigint];
      const rule = ruleOf(String(n.rule));
      const q = divRound(num, mulInt(den, rule.unit), rule.mode);
      expect(Number(mulInt(q, rule.unit))).toBe(n.result);
    }
  });

  it("full の出力も JSON Schema に合い、整数でない数がない", () => {
    expect(() => check("engine.output", full, "E_OUTPUT_SCHEMA")).not.toThrow();
    expect(() => check("engine.output", summary, "E_OUTPUT_SCHEMA")).not.toThrow();
    expect(nonIntegerPaths(full)).toEqual([]);
  });
});

describe("入力の検査とエラー", () => {
  type Loose = {
    input: Record<string, unknown> & {
      household: { employmentPeriods: Record<string, unknown>[]; accounts: Record<string, unknown>[]; members: Record<string, unknown>[] };
      assumptions: { investmentReturn: { default: unknown } };
    };
  };
  const req = () => clone(modelHousehold("single25")) as unknown as Loose;

  it("知らない欄（参照値を含む）を拒む（0004 の7）", () => {
    const a = req();
    a.input.referenceValues = [{ row: "cf.income.pension", year: 2035, amount: 1834000 }];
    expect(() => runEngine(a, realPacks())).toThrow("E_INPUT_SCHEMA");
    const b = req();
    (b.input.household.employmentPeriods[0] as Record<string, unknown>).computedTax = 1;
    expect(() => runEngine(b, realPacks())).toThrow("E_INPUT_SCHEMA");
  });

  it("値の箱の決まり（0008 の2）を守らない入力を拒む", () => {
    const salaryOf = (r: Loose) => (r.input.household.employmentPeriods[0] as { salary: { annual: unknown } }).salary;
    const a = req();
    salaryOf(a).annual = 3600000;
    expect(() => runEngine(a, realPacks())).toThrow("E_INPUT_SCHEMA");
    const b = req();
    salaryOf(b).annual = { state: "unknown", origin: { kind: "manual" } };
    expect(() => runEngine(b, realPacks())).toThrow("E_INPUT_SCHEMA");
    const c = req();
    salaryOf(c).annual = { value: 3600000, state: "confirmed", origin: { kind: "ai", connector: "x" } };
    expect(() => runEngine(c, realPacks())).toThrow("E_INPUT_SCHEMA"); // AI の値は FP の承認が要る
    const d = req();
    salaryOf(d).annual = { state: "unknown", origin: { kind: "manual" }, substitute: { value: 3000000, state: "estimated", origin: { kind: "auto" }, estimate: { method: "statistic", basis: "賃金構造基本統計調査" } } };
    expect(() => runEngine(d, realPacks())).not.toThrow();
  });

  it("金額の小数・率の数値・範囲外の金額を拒む", () => {
    const a = req();
    (a.input.household.accounts[0] as { marketValue: { value: number } }).marketValue.value = 0.5;
    expect(() => runEngine(a, realPacks())).toThrow("E_INPUT_SCHEMA");
    const b = req();
    b.input.assumptions.investmentReturn.default = 0.02;
    expect(() => runEngine(b, realPacks())).toThrow("E_INPUT_SCHEMA");
  });

  it("世帯にいない構成員を指す物・ID の重複はエラー", () => {
    const a = req();
    (a.input.household.employmentPeriods[0] as { member: string }).member = "3f2b8c1e-9a4d-4e7b-8c21-5d0f6a9b7e10";
    expect(() => runEngine(a, realPacks())).toThrow("E_ARGUMENT");
    const b = req();
    (b.input.household.accounts[0] as { id: string }).id = (b.input.household.members[0] as { id: string }).id;
    expect(() => runEngine(b, realPacks())).toThrow("E_ARGUMENT");
  });

  it("文字列の入口は、エラーを ID だけの JSON で返す（値を含めない。0005 の8）", () => {
    const a = req();
    (a.input.household.accounts[0] as { marketValue: { value: number } }).marketValue.value = 1234.5;
    const out = runJson(JSON.stringify(a), JSON.stringify(realPacks()));
    expect(JSON.parse(out)).toEqual({ error: { code: "E_INPUT_SCHEMA", ids: ["/input/household/accounts/0/marketValue/value:type"] } });
    expect(out).not.toContain("1234");
    expect(JSON.parse(runJson("{", "[]"))).toEqual({ error: { code: "E_INPUT_SCHEMA", ids: ["json"] } });
    const noData = JSON.parse(runJson(JSON.stringify(modelHousehold("single25")), "[]")) as { error: { code: string } };
    expect(noData.error.code).toBe("E_PARAM_UNKNOWN");
  });
});

describe("部品は純粋な関数", () => {
  it("入力は凍結され、部品から書き換えられない", () => {
    const official = OFFICIAL_COMPONENTS.find((o) => o.def.id === "socialInsurance.employment")!.def;
    const mutating = defineComponent({
      ...official,
      compute: (_input: unknown, ctx) => {
        (ctx.list("employment")[0] as { employer: { industry?: string } }).employer.industry = "construction";
        return { flows: [] };
      },
    }) as ComponentDefinition;
    const replacement = { type: "replace" as const, target: official.id, contract: "1", component: mutating, hash: `sha256:${"0".repeat(64)}` };
    expect(() => runEngine(modelHousehold("single25"), realPacks(), { replacements: [replacement] })).toThrow(TypeError);
  });
});
