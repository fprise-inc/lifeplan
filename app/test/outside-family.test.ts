// 世帯の外の家族（0035 の4・8）: 家族のカードで足した親の印・家計を1つにする期間の欄・生活費の目安の人数・開いたときの知らせ
import { describe, expect, it } from "vitest";
import { barNotices, type BarInputs } from "../src/workspace/header/status.ts";
import { allFields, type GroupDef } from "../src/workspace/input/form.ts";
import { householdSize } from "../src/workspace/input/estimates.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { addMember } from "../src/workspace/input/stages/family.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { modelHousehold, preview } from "./helpers.ts";

const groups = (wh: WorkingHousehold): GroupDef[] => buildStage("family", wh).sections.flatMap((s) => s.groups);

describe("家族のカードの世帯の外の家族", () => {
  it("親を足すと世帯の外の家族の印（本人の家族・家計を1つにする期間なし）が付く", () => {
    const wh = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const self = wh.request.input.household.members.find((m) => m.kind === "self")!;
    const next = addMember(wh, "parent");
    const p = next.request.input.household.members.at(-1)!;
    expect(p.kind).toBe("parent");
    expect(p.outside).toEqual({ of: self.id, periods: [] });
  });

  it("家計を1つにする期間を足し、収入を世帯に入れると、その間の親の年金が世帯の収入に入る", () => {
    const wh = fromRequest(modelHousehold("parentCare"));
    const parent = wh.request.input.household.members.find((m) => m.kind === "parent")!;
    const g = groups(wh).find((x) => x.key === `family/${parent.id}`)!;
    expect(g.note).toContain("世帯の外の家族");
    const add = g.actions.find((a) => a.key === `family/${parent.id}/outside/addPeriod`)!;
    const withPeriod = add.run(wh);
    const fields = allFields(buildStage("family", withPeriod));
    const income = fields.find((f) => f.key === `family/${parent.id}/outside/income`)!;
    const on = income.set(withPeriod, true);
    expect(on.request.input.household.members.find((m) => m.id === parent.id)!.outside!.periods[0]).toMatchObject({ living: true, income: true });
    const pension = (r: ReturnType<typeof preview>) => r.table.filter((c) => c.member === parent.id && c.row.startsWith("cf.income")).reduce((s, c) => s + c.amount, 0);
    expect(pension(preview(wh.request))).toBe(0);
    expect(pension(preview(on.request))).toBeGreaterThan(0);
  });

  it("生活費の目安の人数は、世帯の外の家族を生活費の人数に入れる期間だけ数える", () => {
    const wh = fromRequest(modelHousehold("parentCare"));
    const h = wh.request.input.household;
    const base = wh.request.input.baseMonth;
    const n = householdSize(h, base);
    const parent = h.members.find((m) => m.kind === "parent")!;
    const living = { ...h, members: h.members.map((m) => (m.id === parent.id ? { ...m, outside: { ...m.outside!, periods: [{ from: null, to: null, living: true, income: false }] } } : m)) };
    expect(householdSize(living, base)).toBe(n + 1);
  });
});

describe("開いたときの知らせ（0035 の8）", () => {
  it("親を世帯の外の家族にした知らせを、通知に出す", () => {
    const i: BarInputs = { opened: true, stored: true, save: { kind: "idle" } as never, paused: false, aiSharing: false, storage: [], showing: { recovery: false, office: false, storage: false }, presence: null, message: (c) => c, household: [{ id: "n1", kind: "outsideFamily" }] };
    const ns = barNotices(i);
    expect(ns).toHaveLength(1);
    expect(ns[0]).toMatchObject({ id: "household:n1", target: "family", action: "家族のカード" });
    expect(ns[0]!.text).toContain("世帯の外の家族");
  });
});
