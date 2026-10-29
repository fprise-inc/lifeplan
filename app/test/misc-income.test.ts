// 雑所得の区分（0086）の画面: 表の行「雑所得」・副業の所得の区分（雑所得〔業務〕か事業所得か）を簡易で選ぶ・課税の扱いの効き方の文
import { describe, expect, it } from "vitest";
import type { IncomeFlow } from "../src/engine/types.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { addIncome, incomeRowChoices, IN_ROWS, LEGACY_ROW_SUFFIX, TAX_TREATMENTS } from "../src/workspace/input/moneyRows.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { modelHousehold, preview } from "./helpers.ts";

const wh0 = (): WorkingHousehold => fromRequest(modelHousehold("dualNoKids"), {});
const lastIncome = (w: WorkingHousehold): IncomeFlow => (w.request.input.household.incomeFlows ?? []).at(-1)!;
const groupsOf = (w: WorkingHousehold, card: "work" | "housing") => buildStage(card, w).sections.flatMap((s) => s.groups);
const fieldOf = (w: WorkingHousehold, card: "work" | "housing", key: string): FieldDef | undefined => allFields(buildStage(card, w)).find((f) => f.key === key);
const optionsOf = (f: FieldDef | undefined): string[] => (f !== undefined && f.kind === "select" ? f.options.map((o) => o.value) : []);
/** 副業の行を足して、額と必要経費を入れる（毎月） */
function sideJob(amount: number, cost: number): WorkingHousehold {
  return mutate(addIncome(wh0(), "sideJob"), (h) => {
    const f = (h.incomeFlows ?? []).at(-1)!;
    f.monthly = true;
    f.from = { at: "2027-01" };
    f.to = { at: "2027-12" };
    f.amount = { value: amount, state: "confirmed", origin: { kind: "manual" } };
    f.cost = { value: cost, state: "confirmed", origin: { kind: "manual" } };
  });
}
const incomeTax = (w: WorkingHousehold, year: number) =>
  (preview(w.request).table as unknown as { row: string; year: number; amount: number }[]).filter((c) => c.row.startsWith("cf.taxSi.incomeTax") && c.year === year).reduce((s, c) => s + c.amount, 0);

describe("表の行「雑所得」", () => {
  it("入るお金の表の行の一覧にあり、副業・売電・外国の年金で選べる", () => {
    expect(IN_ROWS.find((o) => o.value === "cf.income.other.miscellaneous")?.label).toBe("雑所得");
    for (const kind of ["sideJob", "powerSale", "foreignPension"] as const) expect(incomeRowChoices({ kind }).map((o) => o.value), kind).toContain("cf.income.other.miscellaneous");
    expect(incomeRowChoices({ kind: "otherWork" }).map((o) => o.value)).not.toContain("cf.income.other.miscellaneous");
  });
  it("雑所得の行に載せても計算できる（エンジンの表の行の一覧にある）", () => {
    const w = mutate(sideJob(100000, 0), (h) => void ((h.incomeFlows ?? []).at(-1)!.row = "cf.income.other.miscellaneous"));
    const cells = (preview(w.request).table as unknown as { row: string; year: number; amount: number }[]).filter((c) => c.row === "cf.income.other.miscellaneous" && c.year === 2027);
    expect(cells.reduce((s, c) => s + c.amount, 0)).toBe(1200000);
  });
});

describe("副業の所得の区分（雑所得〔業務〕か事業所得か）", () => {
  it("簡易の欄「所得の区分」で選ぶ。既定は雑所得（業務）で、選択肢は雑所得（業務）と事業所得。詳細の課税の扱いの欄は出さず、必要経費は詳細に残す", () => {
    const w = sideJob(100000, 20000);
    const f = lastIncome(w);
    const tax = fieldOf(w, "work", `in/${f.id}/tax`);
    expect(tax?.label).toBe("所得の区分");
    expect(tax?.level).toBe("simple");
    expect(optionsOf(tax)).toEqual(["miscBusiness", "business"]);
    expect(tax?.get(w).value).toBe("miscBusiness");
    expect(tax?.help).toContain("副業の多くは雑所得");
    const main = groupsOf(w, "work").find((g) => g.key === `in/${f.id}`);
    expect(main?.fields.some((x) => x.key === `in/${f.id}/tax`)).toBe(true);
    const detail = groupsOf(w, "work").find((g) => g.key === `in/${f.id}/tax`);
    expect(detail?.title).toBe("必要経費");
    expect(detail?.fields.map((x) => x.key)).toEqual([`in/${f.id}/cost`]);
  });

  it("事業所得を選ぶと taxTreatment に business を書き、赤字は給与所得から引くので所得税が下がる（雑所得のままなら変わらない）", () => {
    const w = sideJob(100000, 200000);
    const f = lastIncome(w);
    const none = mutate(w, (h) => void (h.incomeFlows = (h.incomeFlows ?? []).filter((x) => x.id !== f.id)));
    const biz = fieldOf(w, "work", `in/${f.id}/tax`)!.set(w, "business");
    expect(lastIncome(biz).taxTreatment).toBe("business");
    expect(fieldOf(biz, "work", `in/${f.id}/tax`)?.help).toContain("赤字は給与などほかの所得から引きます");
    const sum = (x: WorkingHousehold) => incomeTax(x, 2027) + incomeTax(x, 2028);
    expect(sum(w)).toBe(sum(none));
    expect(sum(biz)).toBeLessThan(sum(none));
  });

  it("前にほかの課税の扱いを入れた副業の行は、その扱いも選択肢に残す（世帯の値は書き換えない）", () => {
    const w = mutate(sideJob(100000, 0), (h) => void ((h.incomeFlows ?? []).at(-1)!.taxTreatment = "salary"));
    const f = lastIncome(w);
    const tax = fieldOf(w, "work", `in/${f.id}/tax`);
    expect(optionsOf(tax)).toEqual(["miscBusiness", "business", "salary"]);
    expect(tax?.get(w).value).toBe("salary");
    expect(lastIncome(w).taxTreatment).toBe("salary");
    // 給与には必要経費が無いので、詳細のまとまりは出さない
    expect(groupsOf(w, "work").some((g) => g.key === `in/${f.id}/tax`)).toBe(false);
    expect(LEGACY_ROW_SUFFIX).toBe("（前に選んだ行）");
  });

  it("副業以外の種類は、今までどおり詳細の「課税の扱い」で9通りから選ぶ", () => {
    const w = addIncome(wh0(), "powerSale");
    const f = lastIncome(w);
    const tax = fieldOf(w, "housing", `in/${f.id}/tax`);
    expect(tax?.label).toBe("課税の扱い");
    expect(tax?.level).toBe("detail");
    expect(optionsOf(tax)).toHaveLength(9);
    expect(tax?.help).toContain("赤字はほかの雑所得と公的年金からだけ引き");
  });

  it("課税の扱いの効き方の文: 雑所得は赤字を給与などから引かず、事業所得は引く", () => {
    const effect = (v: string) => TAX_TREATMENTS.find((t) => t.value === v)?.effect ?? "";
    expect(effect("miscBusiness")).toContain("給与などほかの所得からは引きません");
    expect(effect("miscOther")).toBe(effect("miscBusiness"));
    expect(effect("business")).toContain("給与などほかの所得から引きます");
  });
});
