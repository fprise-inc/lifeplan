// 0006: 部品表・差し込み口・2つの版
import { describe, expect, it } from "vitest";
import { OFFICIAL_COMPONENTS } from "../src/components/index.ts";
import { runEngine } from "../src/engine/run.ts";
import type { Flow } from "../src/engine/types.ts";
import { assemble, type Extension, type Replacement } from "../src/registry/assemble.ts";
import { defineComponent, type ComponentDefinition } from "../src/registry/define.ts";
import { formatYm, yen } from "../src/sdk/index.ts";
import { clone, fixture, samplePack } from "./helpers.ts";

const HASH = `sha256:${"0".repeat(64)}`;
const official = OFFICIAL_COMPONENTS;
const req = () => fixture("basic");
const run = (opts: Parameters<typeof runEngine>[2], r = req()) => runEngine(r, [samplePack()], { checkInternal: true, ...opts });

/** 差し替えたことにするテスト用の部品: 毎月の定額を、毎月1円にする */
const fakeMonthly = (contract = "1.0"): ComponentDefinition =>
  defineComponent<{ object: string }, { flows: Flow[] }>({
    id: "test.sample.monthlyFlow",
    contract,
    revision: 1,
    requires: {},
    params: [],
    reads: ["test.sample.flows"],
    input: "test.sample.monthlyFlow.input",
    output: "flows.output",
    compute(input, ctx) {
      const f = ctx.readObject<{ id: string; row: string }>("test.sample.flows", input.object);
      return { flows: [{ row: f.row, ym: formatYm(ctx.time.base), amount: yen(1), accrualYear: 2027, object: f.id, formula: "test.fake.one" }] };
    },
  }) as ComponentDefinition;

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
    compute(input) {
      return { flows: [{ row, ym: input.fromMonth, amount: yen(10000), accrualYear: 2027, formula: "test.ext.petCare.monthly" }] };
    },
  }) as ComponentDefinition,
});

describe("部品表を通した呼び出しと差し替え", () => {
  it("差し替えは、それを呼ぶ公式部品すべてに効き、見出しに残る", () => {
    const base = run({});
    const r = run({ replacements: [replace(fakeMonthly())] });
    const monthly = r.flows.filter((f) => f.formula === "test.fake.one");
    expect(monthly).toHaveLength(4); // 入力の毎月の収支は4件
    expect(r.flows.some((f) => f.formula === "test.sample.monthlyFlow.fixed")).toBe(false);
    const ref = (r.header as { components: { id: string; origin: string; hash: string }[] }).components.find((c) => c.id === "test.sample.monthlyFlow");
    expect(ref?.origin).toBe("replacement");
    expect(ref?.hash).toBe(HASH);
    // 残高の積み上げ（呼び出し元）が差し替え後の値を使っている
    const closing = (x: typeof r) => x.annual.find((a) => a.row === "cf.balance.financial" && a.year === 2036)?.amount;
    expect(closing(r)).not.toBe(closing(base));
  });

  it("約束の MAJOR が合わない差し替えは、黙って公式に戻さず計算を止める", () => {
    expect(() => run({ replacements: [replace(fakeMonthly("2.0"), "2")] })).toThrow("E_CONTRACT_MISMATCH");
    expect(() => run({ replacements: [replace(fakeMonthly(), "2")] })).toThrow("E_CONTRACT_MISMATCH");
  });

  it("replaceable でない公式部品は差し替えられない", () => {
    const fake = defineComponent({ ...official.find((o) => o.def.id === "test.sample.balance")!.def });
    expect(() => run({ replacements: [replace(fake as ComponentDefinition)] })).toThrow("E_NOT_REPLACEABLE");
  });

  it("部品の依存の循環は組み立ての時点でエラー", () => {
    const a = defineComponent({ id: "test.cycle.a", contract: "1.0", revision: 1, requires: { "test.cycle.b": "1" }, params: [], reads: [], input: "x", output: "x", compute: () => ({}) });
    const b = defineComponent({ id: "test.cycle.b", contract: "1.0", revision: 1, requires: { "test.cycle.a": "1" }, params: [], reads: [], input: "x", output: "x", compute: () => ({}) });
    expect(() => assemble([{ def: a as ComponentDefinition, hash: HASH }, { def: b as ComponentDefinition, hash: HASH }])).toThrow("E_COMPONENT_CYCLE");
  });

  it("マニフェストに書いていない呼び出し・制度の値・入力はエラー", () => {
    const sneaky = (compute: ComponentDefinition["compute"]) =>
      replace(defineComponent({ ...fakeMonthly(), compute }) as ComponentDefinition);
    expect(() => run({ replacements: [sneaky((_i, ctx) => ctx.call("test.sample.lumpSum", {}))] })).toThrow("E_CALL_UNDECLARED");
    expect(() => run({ replacements: [sneaky((_i, ctx) => ctx.at(ctx.time.base).param("test.sample.lumpSum.withholdingRate"))] })).toThrow(
      "E_PARAM_UNDECLARED",
    );
    expect(() => run({ replacements: [sneaky((_i, ctx) => ctx.read("test.sample.openingBalance"))] })).toThrow("E_READ_UNDECLARED");
  });

  it("差し替えた部品の出力の形の誤りはエラー（製品でも常に検査する）", () => {
    const bad = replace(defineComponent({ ...fakeMonthly(), compute: () => ({ flows: [{ row: "cf.income.other", ym: "2027-04", amount: 1.5 }] }) }) as ComponentDefinition);
    expect(() => runEngine(req(), [samplePack()], { replacements: [bad] })).toThrow("E_COMPONENT_SCHEMA");
  });

  it("制度の端数処理の規則は、計算している月が無いと使えない（conv. の規約だけ使える）", () => {
    const r = replace(
      defineComponent({ ...official.find((o) => o.def.id === "test.sample.lumpSum")!.def, compute: (_i, ctx) => ctx.money.round(yen(1), "test.sample.lumpSum.rounding") }) as ComponentDefinition,
    );
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

describe("部品の定義", () => {
  it("マニフェストの誤りを拒む", () => {
    const base = fakeMonthly();
    expect(() => defineComponent({ ...base, contract: "1" })).toThrow("E_COMPONENT_DEFINITION");
    expect(() => defineComponent({ ...base, revision: 0 })).toThrow("E_COMPONENT_DEFINITION");
    expect(() => defineComponent({ ...base, requires: { "test.x.y": "1.0" } })).toThrow("E_COMPONENT_DEFINITION");
    expect(() => defineComponent({ ...base, id: "cf.income.other" })).toThrow("E_ID_FORMAT");
  });

  it("パックが必要とする部品の約束の版を確かめる", () => {
    const p = samplePack();
    const broken = clone(p);
    broken.pack.requires = { "test.sample.lumpSum": ">=2" };
    expect(() => runEngine(req(), [broken], {})).toThrow("E_CONTRACT_MISMATCH");
  });
});
