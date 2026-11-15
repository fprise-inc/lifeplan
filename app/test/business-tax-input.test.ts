// 個人事業税の業種（働き方と収入の自営の期間の詳細の欄。employment.business.businessTaxClass。0155 の追記 2026-11-15）
import { describe, expect, it } from "vitest";
import type { EmploymentPeriod } from "../src/engine/types.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import type { PlanDiff } from "../src/workspace/plans/diffs.ts";
import { applyPlan, type Proposal } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { bodyObject, EMPTY_CARRY, fromBody, type BodyState } from "../src/workspace/store/body.ts";
import { modelHousehold, preview } from "./helpers.ts";

const ITEM = "employment.business.businessTaxClass";
const open = (id = "sampleSelfEmployedFamily"): WorkingHousehold => fromRequest(modelHousehold(id));
const bizPeriod = (wh: WorkingHousehold): EmploymentPeriod => (wh.request.input.household.employmentPeriods ?? []).find((p) => p.type === "selfEmployed")!;
const fieldOf = (wh: WorkingHousehold): FieldDef | undefined => allFields(buildStage("work", wh)).find((f) => f.item === ITEM);
const businessTax = (req: WorkingHousehold["request"], year: number) =>
  preview(req)
    .table.filter((c) => c.row === "cf.taxSi.businessTax" && c.year === year)
    .reduce((s, c) => s + c.amount, 0);

describe("働き方と収入の「個人事業税の業種」", () => {
  it("自営の期間にだけ詳細の欄で出る。空欄は第1種（5%）と見せる", () => {
    const wh = open();
    const f = fieldOf(wh);
    expect(f).toBeDefined();
    expect(f!.level).toBe("detail");
    expect(f!.label).toBe("個人事業税の業種");
    expect(f!.get(wh)).toMatchObject({ value: "class1", implicit: true });
    expect(fieldOf(open("salariedCoupleTwoKids"))).toBeUndefined();
  });

  it("3%の業種にすると税が5分の3、法定業種でない仕事にすると0円。第1種を選ぶのと空欄は同じ（世帯に書かない）", () => {
    let wh = open();
    const f = fieldOf(wh)!;
    const base = businessTax(wh.request, 2028);
    expect(base).toBeGreaterThan(0);
    wh = f.set(wh, "class3Reduced");
    expect(bizPeriod(wh).business?.businessTaxClass).toBe("class3Reduced");
    expect(businessTax(wh.request, 2028)).toBeLessThan(base);
    expect(Math.abs(businessTax(wh.request, 2028) - (base * 3) / 5)).toBeLessThanOrEqual(200);
    wh = fieldOf(wh)!.set(wh, "none");
    expect(businessTax(wh.request, 2028)).toBe(0);
    wh = fieldOf(wh)!.set(wh, "class1");
    expect(bizPeriod(wh).business?.businessTaxClass).toBeUndefined();
    expect(businessTax(wh.request, 2028)).toBe(base);
  });

  it("世帯ファイルに保存して読み戻しても同じ", () => {
    const wh = fieldOf(open())!.set(open(), "class2");
    const s: BodyState = { wh, workspace: { template: null, band: [], base: "current", selected: "current", shownItems: [] }, display: { result: {}, balance: {} } as unknown as BodyState["display"], carry: EMPTY_CARRY };
    const back = fromBody(JSON.stringify(bodyObject(s)));
    expect(bizPeriod(back.wh).business?.businessTaxClass).toBe("class2");
  });

  it("プランで変えられ、土台のプランの値を上のプランが引き継ぐ（重ねたプラン）", () => {
    const wh0 = open();
    const self = roles(wh0.request).find((r) => r.key === "self")!.member.id;
    const p = bizPeriod(wh0);
    const diff = { id: "00000000-0000-4000-8000-0000000b7a01", op: "set", target: { object: p.id }, item: ITEM, at: [], value: { value: "none", state: "confirmed", origin: { kind: "manual" } }, before: null, enabled: true, origin: { kind: "manual" }, note: null } as unknown as PlanDiff;
    const now = "2026-11-15T00:00:00.000Z";
    const plan = (id: string, base: string | null, diffs: PlanDiff[]): Proposal => ({ id, name: id, createdAt: now, updatedAt: now, base, tags: [], diffs }) as unknown as Proposal;
    const wh = { ...wh0, proposals: [plan("B", null, [diff]), plan("C", "B", [])] };
    const cat = buildCatalog(wh, self, null);
    const c = applyPlan(wh, "C", cat).request;
    const period = (c.input.household.employmentPeriods ?? []).find((x) => x.id === p.id)!;
    expect(period.business?.businessTaxClass).toBe("none");
    expect(businessTax(c, 2028)).toBe(0);
    // 現状は変わらない
    expect(businessTax(wh.request, 2028)).toBeGreaterThan(0);
  });
});
