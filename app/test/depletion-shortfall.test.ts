// 資産が尽きる年は、使えるお金で払えなくなる年（計算エンジンの資金不足の行）。引き出せない器（60歳前の iDeCo など）が残っていて
// 金融資産の合計が正でも、預金が足りなければ尽きたとみる（結論・帯・提案書・バランスシートの「資金の不足」をそろえる。0179。R4-007）
import { describe, expect, it } from "vitest";
import type { EngineRequest, TableCell } from "../src/engine/types.ts";
import { depletionYear, financialOf, SHORTFALL_ROW, sumByYear } from "../src/workspace/present.ts";
import { lastsAge } from "../src/workspace/invest/present.ts";
import { modelHousehold, preview } from "./helpers.ts";

describe("資産が尽きる年", () => {
  it("金融資産の合計が正でも、資金不足の行が出た年に尽きたとみる", () => {
    const t: TableCell[] = [
      ...[5, 3, 2, 1].map((amount, i) => ({ row: "cf.balance.financial", year: 2027 + i, amount })),
      { row: SHORTFALL_ROW, year: 2029, amount: 1 },
    ];
    expect(depletionYear(t, [2027, 2028, 2029, 2030])).toBe(2029);
  });

  it("一人暮らし45歳: 預金100万円・iDeCo 1,500万円で2027年末に仕事をやめると、預金が尽きる年（iDeCo は60歳まで引き出せない）を尽きる年にする", () => {
    const req = modelHousehold("single45") as unknown as { input: { endYear: number; household: { accounts: { kind: string; marketValue: { value: number } }[]; employmentPeriods: { to?: unknown }[] } } };
    const h = req.input.household;
    (h.accounts.find((a) => a.kind === "deposit") as { marketValue: { value: number } }).marketValue.value = 1_000_000;
    (h.accounts.find((a) => a.kind === "ideco") as { marketValue: { value: number } }).marketValue.value = 15_000_000;
    req.input.endYear = 2070;
    (h.employmentPeriods[0] as { to?: unknown }).to = { at: "2027-12" };
    const r = preview(req as unknown as EngineRequest);
    const years = Array.from({ length: 2070 - 2027 + 1 }, (_, i) => 2027 + i);
    const short = sumByYear(r.table, (c) => c.row === SHORTFALL_ROW);
    const first = years.find((y) => (short.get(y) ?? 0) > 0) as number;
    expect(first).toBeDefined();
    expect(financialOf(r.table).get(first) ?? 0).toBeGreaterThan(0); // iDeCo が残っていて合計は正（前はここで「持つ」になった）
    expect(depletionYear(r.table, years)).toBe(first);
    // 「金融資産は○歳まで持ちます」は尽きる年の前の年の年齢（1981年生まれ）
    expect(lastsAge(req as unknown as EngineRequest, r.table, years)).toBe(first - 1 - 1981);
  });
});
