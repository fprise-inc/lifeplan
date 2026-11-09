// 貸していない不動産・その他の資産の売る予定と毎年の費用（0123）: 中身を選ぶと毎年の費用の目安の行（物の ID でつなぐ）が入り、評価額を
// 直すと入れ直す。FP が入れた額は推定で上書きしない。空にすると目安に戻る。別荘・更地は住宅用地の特例なし（課税標準70%）、空き家は特例あり。
// 山林・農地は目安なし。売る予定の欄、外す・収益不動産へ移すときの後始末、計算に入ること
import { describe, expect, it } from "vitest";
import type { Account } from "../src/engine/types.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { HELD_ESTATE_TAX_BASIS, heldCostRow, heldEstateTax } from "../src/workspace/input/heldEstateTax.ts";
import { modelHousehold, preview } from "./helpers.ts";

const open = (): WorkingHousehold => fromRequest(modelHousehold("investmentCouple"));
const others = (wh: WorkingHousehold) => buildStage("savings", wh).sections.find((s) => s.key === "sav/others")!;
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = allFields(buildStage("savings", wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const add = (wh: WorkingHousehold, kind: "realEstate" | "otherAsset"): { wh: WorkingHousehold; a: Account } => {
  const next = others(wh).actions.find((x) => x.key === `sav/add/${kind}`)!.run(wh);
  return { wh: next, a: (next.request.input.household.accounts ?? []).filter((x) => x.kind === kind).at(-1) as Account };
};
const costOf = (wh: WorkingHousehold, id: string) => heldCostRow(wh.request.input.household, id);
const basisOf = (b: unknown) => (b as { estimate?: { basis?: string } }).estimate?.basis ?? "";

describe("貸していない不動産の毎年の費用（0123）", () => {
  it("中身を選ぶと固定資産税の目安の行が入り、評価額を直すと入れ直す。FP の額は上書きせず、空にすると目安に戻る", () => {
    const added = add(open(), "realEstate");
    const a = added.a;
    let wh = added.wh;
    wh = fieldOf(wh, `sav/${a.id}/value`).set(wh, 20_000_000);
    // 中身を選ぶまでは目安を入れない
    expect(costOf(wh, a.id)).toBeUndefined();
    wh = fieldOf(wh, `sav/${a.id}/subtype`).set(wh, "villa");
    const row = costOf(wh, a.id)!;
    expect(row).toMatchObject({ kind: "assetCost", object: a.id, row: "cf.expense.other.realEstate", everyYears: 1, growth: { kind: "none" } });
    expect(row.amount.state).toBe("estimated");
    expect(basisOf(row.amount).startsWith(HELD_ESTATE_TAX_BASIS)).toBe(true);
    // 別荘: 土地 2,000万×30%×70%×70%×(1.4%＋0.3%)＋建物 2,000万×70%×40%×1.7%（建物の評価額の割合は0181で40%）
    expect(row.amount.value).toBe(Math.round((20_000_000 * 0.3 * 0.7 * 0.7 * 0.017 + 20_000_000 * 0.7 * 0.4 * 0.017) / 100) * 100);
    // 評価額を直すと入れ直す
    wh = fieldOf(wh, `sav/${a.id}/value`).set(wh, 10_000_000);
    expect(costOf(wh, a.id)!.amount.value).toBe(heldEstateTax({ value: 10_000_000, valueYear: Number(wh.request.input.baseMonth.slice(0, 4)), kind: "villa", landShare: 0.3 }).value);
    // FP の額（管理費を足した額）は上書きしない
    wh = fieldOf(wh, `sav/${a.id}/cost`).set(wh, 250_000);
    wh = fieldOf(wh, `sav/${a.id}/value`).set(wh, 30_000_000);
    expect(costOf(wh, a.id)!.amount).toMatchObject({ value: 250_000, state: "confirmed" });
    // 空にすると目安に戻る
    wh = fieldOf(wh, `sav/${a.id}/cost`).set(wh, null);
    expect(costOf(wh, a.id)!.amount.state).toBe("estimated");
    // 山林・農地は目安なし（推定のままの行は外す）
    wh = fieldOf(wh, `sav/${a.id}/subtype`).set(wh, "forestFarm");
    expect(costOf(wh, a.id)).toBeUndefined();
    // 計算に入る（毎年の不動産の経費）
    wh = fieldOf(wh, `sav/${a.id}/cost`).set(wh, 50_000);
    expect(preview(wh.request).table.some((c: { row: string; amount: number }) => c.row === "cf.expense.other.realEstate" && c.amount === 50_000)).toBe(true);
  });

  it("空き家は住宅用地の特例を当て、更地は課税標準70%（建物なし）", () => {
    const y = 2026;
    const house = heldEstateTax({ value: 10_000_000, valueYear: y, kind: "vacantHouse", landShare: 0.3 });
    expect(house.value).toBe(Math.round((3_000_000 * 0.7 * (0.014 / 6 + 0.003 / 3) + 7_000_000 * 0.4 * 0.017) / 100) * 100);
    expect(house.basis).toContain("住宅用地の特例を当て");
    const land = heldEstateTax({ value: 10_000_000, valueYear: y, kind: "vacantLand", landShare: 1 });
    expect(land.value).toBe(Math.round((10_000_000 * 0.7 * 0.7 * 0.017) / 100) * 100);
  });

  it("外すとつながる行も外す。収益不動産へ移すと、売る予定・取得・毎年の費用を中身の欄へ移す", () => {
    const added = add(open(), "realEstate");
    const a = added.a;
    let wh = added.wh;
    wh = fieldOf(wh, `sav/${a.id}/value`).set(wh, 20_000_000);
    wh = fieldOf(wh, `sav/${a.id}/subtype`).set(wh, "vacantHouse");
    wh = fieldOf(wh, `sav/${a.id}/sale/on`).set(wh, true);
    wh = fieldOf(wh, `sav/${a.id}/sale/cost`).set(wh, 15_000_000);
    wh = fieldOf(wh, `sav/${a.id}/sale/acquiredAt`).set(wh, "2010-04");
    const cost = costOf(wh, a.id)!.amount.value;
    const moved = others(wh).groups.flatMap((g) => g.actions).find((x) => x.key === `sav/${a.id}/toRental`)!.run(wh);
    const x = (moved.request.input.household.accounts ?? []).find((y) => y.id === a.id)!;
    expect(x.subtype).toBeUndefined();
    expect(x.sale).toBeUndefined();
    expect(x.property).toMatchObject({ acquisition: { price: 15_000_000, at: "2010-04" }, expenses: { annual: { value: cost } } });
    expect(x.property?.sale?.at).toBeDefined();
    expect(costOf(moved, a.id)).toBeUndefined();
    const removed = others(wh).groups.flatMap((g) => g.actions).find((y) => y.key === `sav/${a.id}/remove`)!.run(wh);
    expect((removed.request.input.household.periodicExpenses ?? []).some((p) => p.object === a.id)).toBe(false);
  });
});

describe("売る予定（0123）", () => {
  it("その他の資産: 売る予定をオンにすると時期・価格・税の扱いの欄。非課税なら取得価額・取得の年月を出さない。売った年から評価額が消える", () => {
    const added = add(open(), "otherAsset");
    const a = added.a;
    let wh = added.wh;
    wh = fieldOf(wh, `sav/${a.id}/value`).set(wh, 3_000_000);
    wh = fieldOf(wh, `sav/${a.id}/subtype`).set(wh, "preciousMetal");
    wh = fieldOf(wh, `sav/${a.id}/sale/on`).set(wh, true);
    expect(fieldOf(wh, `sav/${a.id}/sale/taxation`).get(wh)).toMatchObject({ value: "transfer" });
    expect(() => fieldOf(wh, `sav/${a.id}/sale/cost`)).not.toThrow();
    const year = Number((accOf(wh, a.id).sale!.at as { at: string }).at.slice(0, 4));
    const rows = (w: WorkingHousehold) => preview(w.request).table.filter((c: { row: string; object?: string }) => c.row === "cf.balance.account.otherAsset");
    expect(rows(wh).some((c: { year: number }) => c.year === year)).toBe(false);
    expect(rows(wh).some((c: { year: number }) => c.year === year - 1)).toBe(true);
    wh = fieldOf(wh, `sav/${a.id}/sale/taxation`).set(wh, "nonTaxable");
    expect(() => fieldOf(wh, `sav/${a.id}/sale/cost`)).toThrow();
    // 敷金・保証金の既定は非課税
    wh = fieldOf(wh, `sav/${a.id}/sale/taxation`).set(wh, null);
    wh = fieldOf(wh, `sav/${a.id}/subtype`).set(wh, "securityDeposit");
    expect(fieldOf(wh, `sav/${a.id}/sale/taxation`).get(wh)).toMatchObject({ value: "nonTaxable" });
  });
});

const accOf = (wh: WorkingHousehold, id: string) => (wh.request.input.household.accounts ?? []).find((x) => x.id === id) as Account;
