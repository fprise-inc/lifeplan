// 0119: カスタム層で差し替えを許す公式部品の一覧と、差し替えの約束を機械で確かめる
// - 一覧（下の POLICY）は設計記録 0119 の表・SDK の docs/extension-points.md と同じ。部品を足したら、ここと2つの文書に分け方と理由を書く
// - 許すのは推定・目安・FP の考え方で変わる部品だけ。法律で決まる計算、入力を並べる部品、集める・組み立てる・判定する部品は許さない
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OFFICIAL_COMPONENTS, OFFICIAL_DEFINITIONS } from "../src/components/index.ts";
import { runEngine, type EngineResult } from "../src/engine/run.ts";
import type { AnnualRow, Flow } from "../src/engine/types.ts";
import { assemble, type Replacement } from "../src/registry/assemble.ts";
import type { Ctx } from "../src/registry/ctx.ts";
import { defineComponent, type ComponentDefinition } from "../src/registry/define.ts";
import { formatYm, yen } from "../src/sdk/index.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold, realPacks } from "./helpers.ts";

/** 許す: 推定・目安（estimate）、FP の考え方（method）、事務所・勤め先の決まり（rule）。許さない: 法律（law）、入力を並べる（input）、集める・組み立てる・判定（assembly） */
type Allow = "estimate" | "method" | "rule";
type Deny = "law" | "input" | "assembly";

const POLICY: Readonly<Record<string, Allow | Deny>> = {
  // 差し替えを許す
  "expense.living": "method",
  "education.cost": "estimate",
  "housing.valuation": "estimate",
  "asset.car": "estimate",
  "contingency.lumpSum": "estimate",
  "protection.need": "method",
  "retirement.benefit": "rule",
  "expense.advisoryFee": "rule",
  // 法律・制度で決まる計算（税）
  "incomeTax.annual": "law",
  "residentTax.annual": "law",
  "residentTax.exemption": "law",
  "tax.deductions": "law",
  "tax.dependentDeduction": "law",
  "tax.spouseDeduction": "law",
  "tax.employmentIncome": "law",
  "tax.publicPensionIncome": "law",
  "tax.retirementIncome": "law",
  "tax.realEstateSale": "law",
  "tax.lossCarryforward": "law",
  "tax.housingLoanCredit": "law",
  "tax.housingLoanCreditYears": "law",
  "tax.socialInsurancePaid": "law",
  "tax.totalIncome": "law",
  "tax.incomeOrder": "law",
  "tax.incomeWithin": "law",
  "tax.survivorStatus": "law",
  "insurance.income": "law",
  "gift.tax": "law",
  "inheritance.estimate": "law",
  "asset.realEstate": "law",
  "asset.heldSale": "law",
  // 法律・制度で決まる計算（社会保険）
  "socialInsurance.coverage": "law",
  "socialInsurance.employeeStatus": "law",
  "socialInsurance.healthStatus": "law",
  "socialInsurance.health": "law",
  "socialInsurance.pension": "law",
  "socialInsurance.employment": "law",
  "socialInsurance.nationalHealth": "law",
  "socialInsurance.nationalPension": "law",
  "socialInsurance.continuation": "law",
  "socialInsurance.lateElderly": "law",
  "socialInsurance.careFirst": "law",
  // 法律・制度で決まる計算（公的年金）
  "pension.record": "law",
  "pension.category": "law",
  "pension.employeeMonths": "law",
  "pension.revision": "law",
  "pension.oldAgeBase": "law",
  "pension.oldAge": "law",
  "pension.survivorRight": "law",
  "pension.survivor": "law",
  "pension.disability": "law",
  "pension.supplementaryBenefit": "law",
  // 法律・制度で決まる計算（公的な給付・支援・非課税の器）
  "benefit.childAllowance": "law",
  "benefit.employment": "law",
  "benefit.unemployment": "law",
  "benefit.health": "law",
  "medical.highCost": "law",
  "care.expense": "law",
  "education.support": "law",
  "education.nurseryFee": "law",
  "ideco.contribution": "law",
  "account.ideco": "law",
  "account.idecoPayout": "law",
  "account.mutualAid": "law",
  // 契約・FP が入れた値をそのとおりに並べる
  "income.salary": "input",
  "income.business": "input",
  "income.flows": "input",
  "expense.periodic": "input",
  "expense.car": "input",
  "housing.residence": "input",
  "debt.schedule": "input",
  "debt.creditLifeEvents": "input",
  "insurance.policy": "input",
  "insurance.premiumPayment": "input",
  "insurance.term": "input",
  "account.contribution": "input",
  // 集める・組み立てる・判定する
  "plan.cashflow": "assembly",
  "plan.flows": "assembly",
  "plan.memberFlows": "assembly",
  "retirement.receipts": "assembly",
  "gift.received": "assembly",
  "account.dcList": "assembly",
  "contingency.event": "assembly",
  "outside.wallet": "assembly",
  "expense.reconcile": "assembly",
  "asset.realEstateAnalysis": "assembly",
};

const ALLOW = new Set<string>(["estimate", "method", "rule"]);
const allowed = Object.keys(POLICY).filter((id) => ALLOW.has(POLICY[id] as string)).sort();
const official = (id: string) => OFFICIAL_COMPONENTS.find((o) => o.def.id === id)!.def;
const HASH = `sha256:${"0".repeat(64)}`;
const replace = (component: ComponentDefinition, contract = "1"): Replacement => ({ type: "replace", target: component.id, contract, component, hash: HASH });
/** 公式のマニフェストから replaceable を外した写し（差し替えの部品は replaceable を書けない） */
const manifestOf = (id: string): ComponentDefinition => {
  const { replaceable: _r, ...rest } = official(id);
  void _r;
  return rest as ComponentDefinition;
};

describe("差し替えを許す公式部品の一覧（0119 の1）", () => {
  it("公式部品のすべてを、許す・許さないのどちらかに分けている（部品を足したら分ける）", () => {
    expect(Object.keys(POLICY).sort()).toEqual(OFFICIAL_DEFINITIONS.map((d) => d.id).sort());
  });

  it("マニフェストの replaceable は一覧の「許す」と同じ", () => {
    expect(OFFICIAL_DEFINITIONS.filter((d) => d.replaceable === true).map((d) => d.id).sort()).toEqual(allowed);
    for (const d of OFFICIAL_DEFINITIONS) if (d.replaceable !== undefined) expect(d.replaceable, d.id).toBe(true);
  });

  it("許した部品の入出力の約束の版を書き留める（変えたら、ここと SDK の変更点を直す。β公開の後は3か月前に予告する。0119 の3 の2）", () => {
    const contracts = Object.fromEntries(allowed.map((id) => [id, `${official(id).contract} ${official(id).input} ${official(id).output}`]));
    expect(contracts).toEqual({
      "asset.car": "1.0 empty.input asset.car.output",
      "contingency.lumpSum": "1.0 empty.input flows.output",
      "education.cost": "1.1 member.input education.cost.output",
      "expense.advisoryFee": "1.0 empty.input flows.output",
      "expense.living": "1.0 empty.input flows.output",
      "housing.valuation": "1.1 empty.input housing.valuation.output",
      "protection.need": "1.1 protection.need.input protection.need.output",
      "retirement.benefit": "1.0 member.input retirement.benefit.output",
    });
  });

  it("許さない部品の差し替えは、組み立ての時点で拒む", () => {
    for (const id of Object.keys(POLICY).filter((x) => !allowed.includes(x))) {
      expect(() => assemble(OFFICIAL_COMPONENTS, { replacements: [replace(manifestOf(id))] }), id).toThrow("E_NOT_REPLACEABLE");
    }
  });

  it("登録簿（registry/components.yaml）の replaceable は一覧の「許す」と同じ", () => {
    const text = readFileSync(join(REPO_DIR, "registry", "components.yaml"), "utf8");
    const marked: string[] = [];
    let current = "";
    for (const line of text.split("\n")) {
      const m = /^ {2}- id: (\S+)$/.exec(line);
      if (m !== null) current = m[1] as string;
      if (line === "    replaceable: true") marked.push(current);
    }
    expect(marked.sort()).toEqual(allowed);
  });

  // 文書の表の1列目の `部品ID` を、見出しから次の見出しまで集める
  const idsIn = (text: string, from: string, until: RegExp): string[] => {
    const start = text.indexOf(from);
    expect(start, from).toBeGreaterThanOrEqual(0);
    const rest = text.slice(start + from.length);
    const end = rest.search(until);
    const section = end < 0 ? rest : rest.slice(0, end);
    const known = new Set(Object.keys(POLICY));
    return section
      .split("\n")
      .filter((l) => l.startsWith("| "))
      .flatMap((l) => [...(l.split("|")[1] ?? "").matchAll(/`([a-zA-Z.]+)`/g)].map((m) => m[1] as string))
      .filter((id) => known.has(id));
  };

  it("設計記録 0119 と SDK の docs/extension-points.md の表が、一覧と同じ", () => {
    const record = readFileSync(join(REPO_DIR, "docs", "decisions", "0119-replaceable-components.md"), "utf8");
    const sdk = readFileSync(join(REPO_DIR, "sdk", "docs", "extension-points.md"), "utf8");
    const all = Object.keys(POLICY).sort();
    for (const [name, text, allowHead, denyHead, until] of [
      ["0119", record, "### 1. 差し替えを許す部品", "### 2. 差し替えを許さない部品", /\n### /],
      ["extension-points.md", sdk, "## 差し替えてよい公式部品", "## 差し替えられない公式部品", /\n## /],
    ] as const) {
      const yes = idsIn(text, allowHead, until);
      const no = idsIn(text, denyHead, until);
      expect(yes.sort(), `${name}: 許す`).toEqual(allowed);
      expect([...yes, ...no].sort(), `${name}: 全部`).toEqual(all);
      expect(new Set([...yes, ...no]).size, `${name}: 重なり`).toBe(all.length);
    }
  });
});

describe("差し替えの約束（0119 の2）", () => {
  const living = (patch: Partial<ComponentDefinition> = {}, contract = "1.0"): ComponentDefinition =>
    defineComponent({
      ...manifestOf("expense.living"),
      contract,
      revision: 1,
      compute: (_input: unknown, ctx: Ctx): { flows: Flow[] } => ({
        flows: [{ row: "cf.expense.living", ym: formatYm(ctx.time.base), amount: yen(1), accrualYear: 2026, formula: "ext.myOffice.living.flat" }],
      }),
      ...patch,
    }) as ComponentDefinition;
  const req = () => modelHousehold("dualAssetsTwoKids");
  const run = (r: Replacement) => runEngine(req(), realPacks(), { replacements: [r] });

  it("形の合う差し替えは使える（計算式ID は ext.<作成者>. で始める）", () => {
    const r = run(replace(living()));
    expect(r.flows.filter((f) => f.formula === "ext.myOffice.living.flat")).toHaveLength(1);
    expect((r.header as { components: { id: string; origin: string }[] }).components).toContainEqual(expect.objectContaining({ id: "expense.living", origin: "replacement" }));
  });

  it("入力・出力のスキーマのキーは公式と同じ（入出力の形を変えられない）", () => {
    expect(() => run(replace(living({ input: "member.input" })))).toThrow("E_COMPONENT_DEFINITION: expense.living, input");
    expect(() => run(replace(living({ output: "education.cost.output" })))).toThrow("E_COMPONENT_DEFINITION: expense.living, output");
  });

  it("差し替えの部品は replaceable を書けない・公式の部品が呼ばない差し込み口を呼べない", () => {
    expect(() => run(replace(living({ replaceable: true })))).toThrow("E_COMPONENT_DEFINITION: expense.living, replaceable");
    expect(() => run(replace(living({ slots: ["slot.expense.flow"] })))).toThrow("E_COMPONENT_DEFINITION: expense.living, slots");
  });

  it("約束の版は公式と同じ MAJOR で、MINOR は公式以下（公式より新しい約束を名乗れない。MAJOR が違えば止める）", () => {
    expect(() => run(replace(living({}, "1.1")))).toThrow("E_CONTRACT_MISMATCH");
    expect(() => run(replace(living({}, "2.0"), "2"))).toThrow("E_CONTRACT_MISMATCH");
    expect(() => run(replace(living(), "2"))).toThrow("E_CONTRACT_MISMATCH");
    // MINOR が公式より古い差し替えは使える（使う側は欄が無いときの扱いを持つ。0006 の4）
    const minor = official("education.cost").contract;
    expect(minor).toBe("1.1");
    const older = defineComponent({ ...manifestOf("education.cost"), contract: "1.0", revision: 1, compute: () => ({ flows: [], payments: [] }) } as never) as ComponentDefinition;
    expect(() => assemble(OFFICIAL_COMPONENTS, { replacements: [replace(older)] })).not.toThrow();
  });

  it("計算式ID が ext.<作成者>. で始まらないお金の動きは拒む（公式の計算式と取り違えない）", () => {
    const bad = living({
      compute: (_input: unknown, ctx: Ctx) => ({
        flows: [{ row: "cf.expense.living", ym: formatYm(ctx.time.base), amount: yen(1), accrualYear: 2026, formula: "expense.living.monthly" }],
      }),
    });
    expect(() => run(replace(bad))).toThrow("E_FORMULA_ID: expense.living, expense.living.monthly");
  });
});

describe("差し替えを許す部品を、公式と同じ計算の差し替えにしても結果は同じ（差し替えたことにしたテスト。0006 の影響）", () => {
  /** 公式の計算を呼び、お金の動き・年ごとの行の計算式ID にだけ test. を付ける差し替え */
  const same = (id: string, calls: Map<string, number>): Replacement => {
    const def = official(id);
    const rename = <T extends { formula: string }>(xs: readonly T[] | undefined) => xs?.map((x) => ({ ...x, formula: `test.same.${x.formula}` }));
    return replace(
      defineComponent({
        ...manifestOf(id),
        compute(input, ctx) {
          calls.set(id, (calls.get(id) ?? 0) + 1);
          const out = def.compute(input as never, ctx) as { flows?: Flow[]; annual?: AnnualRow[] };
          const flows = rename(out.flows);
          const annual = rename(out.annual);
          return { ...out, ...(flows !== undefined ? { flows } : {}), ...(annual !== undefined ? { annual } : {}) };
        },
      }) as ComponentDefinition,
    );
  };
  const amounts = (r: EngineResult) => JSON.stringify({ table: r.table, annual: r.annual.map((a) => [a.row, a.year, a.amount]), summary: r.summary, protection: r.protection ?? null });

  it("8つを同時に差し替えても、表・年ごとの行・要約・必要保障額は公式と同じで、見出しに差し替えが残る", () => {
    const calls = new Map<string, number>();
    for (const name of ["dualAssetsTwoKids", "advisoryFeeProposal", "protectionNeed", "pairLoanDeath"]) {
      const base = runEngine(modelHousehold(name), realPacks(), { checkInternal: true });
      const r = runEngine(modelHousehold(name), realPacks(), { checkInternal: true, replacements: allowed.map((id) => same(id, calls)) });
      expect(amounts(r), name).toBe(amounts(base));
      const refs = (r.header as { components: { id: string; origin: string }[] }).components;
      for (const id of allowed) expect(refs.find((c) => c.id === id)?.origin, `${name}: ${id}`).toBe("replacement");
    }
    // どの差し替えも、モデル世帯のどれかで実際に呼ばれた
    expect([...calls.keys()].sort()).toEqual(allowed);
  });
});
