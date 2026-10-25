// 0004: ID体系と科目の木
import { describe, expect, it } from "vitest";
import { canonicalRow, checkRow, rowDepth, rowEntries } from "../src/ids/cfTree.ts";
import { checkId, isDottedId, isUuidV4 } from "../src/ids/ids.ts";

describe("IDの書式", () => {
  it("点区切りの lowerCamelCase", () => {
    for (const ok of ["income.salary.annual", "pension.oldAge.basic", "a.b", "cf.expense.housing.loan"]) expect(isDottedId(ok), ok).toBe(true);
    for (const bad of ["income", "Income.salary", "income..salary", "income.salary.", "income.1salary", "income_salary.x", "収入.給与"]) {
      expect(isDottedId(bad), bad).toBe(false);
    }
  });

  it("予約の接頭辞はその種類だけが使う", () => {
    expect(checkId("row", "cf.income.salary")).toBe("cf.income.salary");
    expect(() => checkId("row", "income.salary")).toThrow("E_ID_FORMAT");
    expect(() => checkId("param", "cf.income.salary")).toThrow("E_ID_FORMAT");
    expect(() => checkId("component", "slot.expense.flow")).toThrow("E_ID_FORMAT");
    expect(() => checkId("param", "conv.investment.return")).toThrow("E_ID_FORMAT");
    expect(checkId("hsKey", "hs.income.salary")).toBe("hs.income.salary");
    expect(checkId("slot", "slot.expense.flow")).toBe("slot.expense.flow");
  });

  it("乱数IDは UUID 第4版の小文字", () => {
    expect(isUuidV4("3f2b8c1e-9a4d-4e7b-8c21-5d0f6a9b7e10")).toBe(true);
    expect(isUuidV4("3F2B8C1E-9A4D-4E7B-8C21-5D0F6A9B7E10")).toBe(false);
    expect(isUuidV4("3f2b8c1e-9a4d-1e7b-8c21-5d0f6a9b7e10")).toBe(false); // 第1版
    expect(isUuidV4("3f2b8c1e-9a4d-4e7b-cc21-5d0f6a9b7e10")).toBe(false); // 変種が違う
    expect(() => checkId("object", "obj.1")).toThrow("E_ID_FORMAT");
  });
});

describe("科目の木", () => {
  it("0004 の表の上2段がそろっている", () => {
    const ids = rowEntries().map((e) => e.id);
    const top = ids.filter((i) => rowDepth(i) === 1);
    expect(top).toEqual(["cf.income", "cf.taxSi", "cf.expense", "cf.transfer", "cf.net", "cf.balance"]);
    // 中分類は 0004 の表と、その追記（2026-10-08 の科目の木の確定）で固定した（β公開の固定ファイルの段）
    const second = (top: string) => ids.filter((i) => i.startsWith(`${top}.`) && rowDepth(i) === 2).map((i) => i.slice(top.length + 1));
    expect(second("cf.income")).toEqual(["salary", "business", "pension", "corporatePension", "lumpSum", "benefit", "other"]);
    expect(second("cf.taxSi")).toEqual(["incomeTax", "residentTax", "businessTax", "health", "care", "pension", "employment", "childSupport", "giftTax", "inheritanceTax"]);
    expect(second("cf.expense")).toEqual(["living", "housing", "education", "insurance", "debt", "lumpSum", "care", "advisoryFee", "other"]);
    expect(second("cf.transfer")).toEqual(["nisa", "ideco", "savings", "withdrawal", "investment", "mutualAid", "rollover"]);
    expect(second("cf.balance")).toEqual(["financial", "account", "return", "debt", "nisaFrame", "shortfall"]);
    expect(ids).toContain("cf.expense.housing.loan");
    // FP顧問料は生活費・その他に混ぜない（独立した中分類）
    expect(ids.filter((i) => i.startsWith("cf.expense.living.") || i.startsWith("cf.expense.other.")).some((i) => i.includes("advisory"))).toBe(false);
  });

  it("登録簿にない行は拒み、枝の下の拡張の行は受ける", () => {
    expect(checkRow("cf.income.salary")).toBe("cf.income.salary");
    expect(() => checkRow("cf.income.unknown")).toThrow("E_ROW_UNKNOWN");
    expect(checkRow("cf.expense.other.ext.example.petCare")).toBe("cf.expense.other.ext.example.petCare");
    expect(() => checkRow("cf.nothing.ext.example.petCare")).toThrow("E_ROW_UNKNOWN");
    expect(() => checkRow("income.salary")).toThrow("E_ID_FORMAT");
    expect(canonicalRow("cf.income.salary")).toBe("cf.income.salary");
  });

  it("雇用保険の給付の行（育児休業・介護休業などの給付）の名前は、計算しない基本手当（失業の給付）と読めない", () => {
    const label = rowEntries().find((e) => e.id === "cf.income.benefit.employment")?.label ?? "";
    expect(label).not.toContain("基本手当");
    expect(label).toContain("育児休業");
    expect(label).toContain("介護休業");
  });
});
