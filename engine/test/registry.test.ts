// 0006: 部品表・差し込み口・2つの版
import { describe, expect, it } from "vitest";
import { OFFICIAL_COMPONENTS } from "../src/components/index.ts";
import { runEngine } from "../src/engine/run.ts";
import type { Flow } from "../src/engine/types.ts";
import { assemble, type Extension, type Replacement } from "../src/registry/assemble.ts";
import { defineComponent, type ComponentDefinition } from "../src/registry/define.ts";
import { satisfiesRange } from "../src/regulation/versions.ts";
import { formatYm, yen } from "../src/sdk/index.ts";
import { clone, modelHousehold, realPacks } from "./helpers.ts";

const HASH = `sha256:${"0".repeat(64)}`;
const official = (id: string) => OFFICIAL_COMPONENTS.find((o) => o.def.id === id)!.def;
const req = () => modelHousehold("single25");
const run = (opts: Parameters<typeof runEngine>[2], r = req()) => runEngine(r, realPacks(), { checkInternal: true, ...opts });

/** 差し替えたことにするテスト用の部品: 生活費（差し替えを許す部品。0119）を、計算基準月に1円だけにする */
const fakeLiving = (contract = "1.0", compute?: ComponentDefinition["compute"]): ComponentDefinition => {
  const { replaceable: _official, ...manifest } = official("expense.living");
  void _official;
  return defineComponent<Record<string, never>, { flows: Flow[] }>({
    ...manifest,
    contract,
    revision: 1,
    compute:
      (compute as never) ??
      ((_input, ctx) => ({
        flows: [{ row: "cf.expense.living", ym: formatYm(ctx.time.base), amount: yen(1), accrualYear: 2026, formula: "test.fake.one" }],
      })),
  }) as ComponentDefinition;
};

/** 仕組みを確かめるテスト用（差し替えを許さない雇用保険料を、テスト専用の probes で置き換える） */
const probeEmployment = (compute: ComponentDefinition["compute"]) => ({
  "socialInsurance.employment": defineComponent({ ...official("socialInsurance.employment"), compute }) as ComponentDefinition,
});

const replace = (component: ComponentDefinition, contract = "1"): Replacement => ({ type: "replace", target: component.id, contract, component, hash: HASH });

/** 差し込み口 slot.expense.flow に足すテスト用の部品 */
const petCare = (row = "cf.expense.other.ext.test.petCare", id = "test.ext.petCare"): Extension => ({
  type: "extend",
  extensionPoint: "slot.expense.flow",
  contract: "1",
  hash: HASH,
  component: defineComponent<{ fromMonth: string; toMonth: string }, { flows: Flow[] }>({
    id,
    contract: "1.0",
    revision: 1,
    requires: {},
    params: [],
    reads: [],
    input: "slot.expense.flow.input",
    output: "flows.output",
    compute() {
      return { flows: [{ row, ym: "2027-01", amount: yen(10000), accrualYear: 2027, formula: "test.ext.petCare.monthly" }] };
    },
  }) as ComponentDefinition,
});

describe("部品表を通した呼び出しと差し替え", () => {
  it("差し替えは、それを呼ぶ公式部品すべて（お金の動きの集計と年間収支）に効き、見出しに残る", () => {
    const household = () => modelHousehold("dualAssetsTwoKids");
    const base = run({}, household());
    const r = run({ replacements: [replace(fakeLiving())] }, household());
    expect(r.flows.filter((f) => f.row.startsWith("cf.expense.living") && f.formula.startsWith("expense.living."))).toHaveLength(0);
    expect(r.flows.filter((f) => f.formula === "test.fake.one")).toHaveLength(1);
    const ref = (r.header as { components: { id: string; origin: string; hash: string }[] }).components.find((c) => c.id === "expense.living");
    expect(ref?.origin).toBe("replacement");
    expect(ref?.hash).toBe(HASH);
    // 生活費が減るので、年間収支（plan.flows → plan.cashflow → expense.living）が増える
    const living = (x: typeof r) =>
      (x.table as unknown as { row: string; year: number; amount: number }[])
        .filter((c) => c.year === 2027 && (c.row === "cf.expense.living" || (c.row.startsWith("cf.expense.living.") && c.row !== "cf.expense.living.car")))
        .reduce((t, c) => t + c.amount, 0);
    expect(living(base)).toBeGreaterThan(0);
    expect(living(r)).toBe(0);
    const net2027 = (x: typeof r) => x.annual.find((a) => a.row === "cf.net" && a.year === 2027)?.amount as number;
    expect(net2027(r)).toBeGreaterThan(net2027(base));
  });

  it("約束の MAJOR が合わない差し替えは、黙って公式に戻さず計算を止める", () => {
    expect(() => run({ replacements: [replace(fakeLiving("2.0"), "2")] })).toThrow("E_CONTRACT_MISMATCH");
    expect(() => run({ replacements: [replace(fakeLiving(), "2")] })).toThrow("E_CONTRACT_MISMATCH");
  });

  it("replaceable でない公式部品（法律で決まる計算・組み立ての部品）は差し替えられない（0119）", () => {
    for (const id of ["plan.cashflow", "socialInsurance.employment"]) {
      const { replaceable: _r, ...manifest } = official(id);
      void _r;
      expect(() => run({ replacements: [replace(defineComponent({ ...manifest }) as ComponentDefinition)] })).toThrow("E_NOT_REPLACEABLE");
    }
  });

  it("部品の依存の循環は組み立ての時点でエラー", () => {
    const a = defineComponent({ id: "test.cycle.a", contract: "1.0", revision: 1, requires: { "test.cycle.b": ">=1 <2" }, params: [], reads: [], input: "x", output: "x", compute: () => ({}) });
    const b = defineComponent({ id: "test.cycle.b", contract: "1.0", revision: 1, requires: { "test.cycle.a": "1" }, params: [], reads: [], input: "x", output: "x", compute: () => ({}) });
    expect(() => assemble([{ def: a as ComponentDefinition, hash: HASH }, { def: b as ComponentDefinition, hash: HASH }])).toThrow("E_COMPONENT_CYCLE");
  });

  it("マニフェストに書いていない呼び出し・制度の値・入力はエラー", () => {
    const sneaky = (compute: ComponentDefinition["compute"]) => replace(fakeLiving("1.0", compute));
    expect(() => run({ replacements: [sneaky((_i, ctx) => ctx.call("income.salary", {}))] })).toThrow("E_CALL_UNDECLARED");
    expect(() => run({ replacements: [sneaky((_i, ctx) => ctx.at(ctx.time.base).param("socialInsurance.pension.rate"))] })).toThrow("E_PARAM_UNDECLARED");
    expect(() => run({ replacements: [sneaky((_i, ctx) => ctx.list("employment"))] })).toThrow("E_READ_UNDECLARED");
    expect(() => run({ replacements: [sneaky((_i, ctx) => ctx.assumption("investmentReturn", 2027))] })).toThrow("E_READ_UNDECLARED");
  });

  it("部品には reads に書いた入力項目だけが渡る（0016 の5）", () => {
    let seen: unknown;
    const spy = probeEmployment((_input, ctx) => {
      seen = ctx.list("employment")[0];
      return { flows: [] };
    });
    run({ probes: spy });
    // reads は employment.employer.industry だけ。給与・標準報酬月額・構成員などは渡らない（入力に無い industry も写さない）
    expect(Object.keys(seen as object)).toEqual(["id"]);
    expect(seen).not.toHaveProperty("salary");
  });

  it("差し替えた部品の出力の形の誤りはエラー（製品でも常に検査する）", () => {
    const bad = replace(fakeLiving("1.0", () => ({ flows: [{ row: "cf.expense.living", ym: "2027-04", amount: 1.5 }] })));
    expect(() => runEngine(req(), realPacks(), { replacements: [bad] })).toThrow("E_COMPONENT_SCHEMA");
  });

  it("制度の端数処理の規則は、計算している月が無いと使えない（conv. の規約だけ使える）", () => {
    const r = replace(fakeLiving("1.0", (_i, ctx) => ctx.money.round(yen(1), "employmentInsurance.employeeShare.rounding")));
    expect(() => run({ replacements: [r] })).toThrow("E_ROUNDING_UNKNOWN");
  });
});

describe("差し込み口", () => {
  it("開いた差し込み口に足した部品の行が、表と残高に入る", () => {
    const base = run({});
    const r = run({ extensions: [petCare()] });
    expect(r.flows.filter((f) => f.row === "cf.expense.other.ext.test.petCare")).toHaveLength(1);
    const net2027 = (x: typeof r) => x.annual.find((a) => a.row === "cf.net" && a.year === 2027)?.amount as number;
    expect(net2027(base) - net2027(r)).toBe(10000);
    expect((r.header as { components: { id: string; origin: string; slot?: string }[] }).components).toContainEqual(
      expect.objectContaining({ id: "test.ext.petCare", origin: "extension", slot: "slot.expense.flow" }),
    );
  });

  it("差し込み口の枝の外の行を出す部品は拒む", () => {
    expect(() => run({ extensions: [petCare("cf.income.other")] })).toThrow("E_SLOT_ROW");
  });

  it("開いていない差し込み口・知らない差し込み口を宣言した部品は読み込みの時点で拒む", () => {
    expect(() => run({ extensions: [{ ...petCare(), extensionPoint: "slot.income.flow" }] })).toThrow("E_SLOT_CLOSED");
    expect(() => run({ extensions: [{ ...petCare(), extensionPoint: "slot.nothing" }] })).toThrow("E_SLOT_UNKNOWN");
    expect(() => run({ extensions: [{ ...petCare(), contract: "2" }] })).toThrow("E_CONTRACT_MISMATCH");
  });

  it("差し込み口に足す部品の ID は ext.（テストでは test.）で始める", () => {
    expect(() => run({ extensions: [petCare(undefined, "pet.care")] })).toThrow("E_COMPONENT_DEFINITION");
  });
});

describe("部品の定義と版", () => {
  it("マニフェストの誤りを拒む", () => {
    const base = fakeLiving();
    expect(() => defineComponent({ ...base, contract: "1" })).toThrow("E_COMPONENT_DEFINITION");
    expect(() => defineComponent({ ...base, revision: 0 })).toThrow("E_COMPONENT_DEFINITION");
    expect(() => defineComponent({ ...base, requires: { "test.x.y": "1.0" } })).toThrow("E_COMPONENT_DEFINITION");
    expect(() => defineComponent({ ...base, requires: { "test.x.y": ">=1 <" } })).toThrow("E_COMPONENT_DEFINITION");
    expect(() => defineComponent({ ...base, id: "cf.income.other" })).toThrow("E_ID_FORMAT");
  });

  it("requires の範囲: \"1\" は \">=1 <2\" の省略形（0006・0007 の追記）", () => {
    for (const m of [0, 1, 2]) expect(satisfiesRange(m, "1")).toBe(satisfiesRange(m, ">=1 <2"));
    expect(satisfiesRange(2, ">=1 <3")).toBe(true);
    expect(satisfiesRange(3, ">=1 <3")).toBe(false);
    expect(satisfiesRange(1, "=1")).toBe(true);
    expect(() => satisfiesRange(1, "1.0")).toThrow("E_ARGUMENT");
  });

  it("パックが必要とする部品の約束の版を確かめる", () => {
    const packs = clone(realPacks());
    (packs[0] as unknown as { pack: { requires: Record<string, string> } }).pack.requires = { "socialInsurance.health": ">=2" };
    expect(() => runEngine(req(), packs, {})).toThrow("E_CONTRACT_MISMATCH");
  });
});

describe("登録簿との照合（0004 の5）", () => {
  it("公式部品が読む入力項目は、データモデル（JSON Schema）の入力項目IDにある", async () => {
    const { ITEMS } = await import("../src/registry/items.ts");
    const { OFFICIAL_DEFINITIONS } = await import("../src/components/index.ts");
    for (const d of OFFICIAL_DEFINITIONS) for (const r of d.reads) expect(ITEMS.items[r], `${d.id}: ${r}`).toBeDefined();
  });
});
