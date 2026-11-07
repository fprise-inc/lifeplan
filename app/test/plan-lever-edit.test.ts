// プランで、結果のタブの対策で動かした欄を入力の画面で直すと、打った値がそのプランの中身になる（0162）。
// 前は対策が欄の差分の後に当たって打った値を上書きし、打った値が黙って前の値に戻っていた
import { describe, expect, it } from "vitest";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStages } from "../src/workspace/input/stages/index.ts";
import { buildCatalog, type Catalog } from "../src/workspace/plans/items.ts";
import { fieldMark, householdChanges, planView, recordPlanEdit } from "../src/workspace/plans/planEdit.ts";
import { effectiveValues, savePlan } from "../src/workspace/plans/plans.ts";
import { isLever } from "../src/workspace/plans/diffs.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold } from "./helpers.ts";

const NOW = "2026-11-07T00:00:00Z";

function setup(model: string, values: (cat: Catalog, wh: WorkingHousehold) => Record<string, number>): { wh: WorkingHousehold; cat: Catalog; pid: string } {
  const req = modelHousehold(model);
  const self = roles(req).find((r) => r.key === "self")!.member;
  const wh0 = fromRequest(req, {});
  const cat = buildCatalog(wh0, self.id, null);
  const s = savePlan(wh0, cat, { name: "プランB", base: null, values: values(cat, wh0), now: NOW });
  return { wh: s.wh, cat, pid: s.id };
}
const read = (cat: Catalog, wh: WorkingHousehold, k: string) => cat.byKey.get(k)!.read(wh) as number;
/** 対策で動かした欄（欄の印が「結果のタブの対策で変わっています」） */
const leverFields = (wh: WorkingHousehold, cat: Catalog, pid: string): FieldDef[] => {
  const view = planView(wh, cat, pid);
  return buildStages(view)
    .flatMap((s) => allFields(s))
    .filter((f) => f.readOnly === undefined && fieldMark(wh, cat, pid, f, view)?.kind === "lever");
};
const leverDiffs = (wh: WorkingHousehold, pid: string) => wh.proposals.find((p) => p.id === pid)!.diffs.filter((d) => isLever(d.target));
/** 打った後のプランの中身が、打った世帯と同じか（違いが残らない） */
const rest = (w: WorkingHousehold, cat: Catalog, pid: string, edited: WorkingHousehold) => householdChanges(planView(w, cat, pid).request.input as never, edited.request.input as never).length;

describe("対策で動かした欄を入力で直す", () => {
  it("生活費の対策で動かした基本生活費（月額）を打ち直すと、その値になる（対策の値も同じ値になり、同じ変更の欄の差分は作らない）", () => {
    const { wh, cat, pid } = setup("salariedCoupleTwoKids", (c, w) => ({ "lever:livingMonthly": read(c, w, "lever:livingMonthly") - 30_000 }));
    const f = leverFields(wh, cat, pid).find((x) => x.key.endsWith("/monthly"))!;
    expect(f).toBeDefined();
    const view = planView(wh, cat, pid);
    const typed = (f.get(view).value as number) + 10_000;
    const edited = f.set(view, typed);
    const w = recordPlanEdit(wh, cat, pid, view, edited);
    expect(f.get(planView(w, cat, pid)).value).toBe(typed);
    expect(rest(w, cat, pid, edited)).toBe(0);
    expect(effectiveValues(w, pid)["lever:livingMonthly"]).toBe(typed);
    expect(w.proposals.find((p) => p.id === pid)!.diffs).toHaveLength(1);
    // 現状は変えない
    expect(JSON.stringify(w.request)).toBe(JSON.stringify(wh.request));
  });

  it("年金の受け取り開始の対策で動かした受け取り開始を直す: 基礎・厚生ともなら対策の値を直し、片方だけなら対策を外して欄の差分にする", () => {
    const { wh, cat, pid } = setup("reemployment", (c, w) => ({ "lever:pensionAge": read(c, w, "lever:pensionAge") + 2 }));
    const fields = leverFields(wh, cat, pid);
    const both = fields.find((x) => x.key.endsWith("/claim"))!;
    const basic = fields.find((x) => x.key.endsWith("/claim/basic"))!;
    const view = planView(wh, cat, pid);
    const age = (both.get(view).value as number) + 1;

    const e1 = both.set(view, age);
    const w1 = recordPlanEdit(wh, cat, pid, view, e1);
    expect(both.get(planView(w1, cat, pid)).value).toBe(age);
    expect(rest(w1, cat, pid, e1)).toBe(0);
    expect(effectiveValues(w1, pid)["lever:pensionAge"]).toBe(age);

    const e2 = basic.set(view, age);
    const w2 = recordPlanEdit(wh, cat, pid, view, e2);
    expect(basic.get(planView(w2, cat, pid)).value).toBe(age);
    expect(rest(w2, cat, pid, e2)).toBe(0);
    expect(leverDiffs(w2, pid)).toEqual([]);
  });

  it("働く最後の年齢の対策で動いた退職後の生活費の始まりだけを直すと、対策を外して、働き方の期間の終わりなども欄の差分で持つ（プランの中身は打った後のまま）", () => {
    const { wh, cat, pid } = setup("salariedCoupleTwoKids", (c, w) => ({ "lever:retireAge": read(c, w, "lever:retireAge") + 2 }));
    const f = leverFields(wh, cat, pid).find((x) => x.time !== undefined && /\/stage\/\d+\/at$/.test(x.key))!;
    expect(f).toBeDefined();
    const view = planView(wh, cat, pid);
    const [y, m] = (f.get(view).value as string).split("-");
    const moved = `${Number(y) + 1}-${m}`;
    const edited = f.time!.setWhen(view, { at: moved }, "auto");
    const w = recordPlanEdit(wh, cat, pid, view, edited);
    expect(f.get(planView(w, cat, pid)).value).toBe(moved);
    expect(rest(w, cat, pid, edited)).toBe(0);
    expect(leverDiffs(w, pid)).toEqual([]);
    expect(read(cat, planView(w, cat, pid), "lever:retireAge")).toBe(read(cat, view, "lever:retireAge"));
  });

  it("土台のプランの対策で動かした欄は、このプランで同じ対策を上書きする（土台のプランは変えない）", () => {
    const { wh: w0, cat, pid: b } = setup("salariedCoupleTwoKids", (c, w) => ({ "lever:livingMonthly": read(c, w, "lever:livingMonthly") - 30_000 }));
    const s = savePlan(w0, cat, { name: "プランC", base: b, values: effectiveValues(w0, b), now: NOW });
    const wh = s.wh;
    const c = s.id;
    const f = leverFields(wh, cat, c).find((x) => x.key.endsWith("/monthly"))!;
    const view = planView(wh, cat, c);
    const typed = (f.get(view).value as number) + 10_000;
    const edited = f.set(view, typed);
    const w = recordPlanEdit(wh, cat, c, view, edited);
    expect(f.get(planView(w, cat, c)).value).toBe(typed);
    expect(rest(w, cat, c, edited)).toBe(0);
    expect(w.proposals.find((p) => p.id === b)).toEqual(wh.proposals.find((p) => p.id === b));
    expect(effectiveValues(w, b)["lever:livingMonthly"]).toBe(effectiveValues(wh, b)["lever:livingMonthly"]);
  });

  it("対策が触っていない欄を直しても、対策はそのまま", () => {
    const { wh, cat, pid } = setup("salariedCoupleTwoKids", (c, w) => ({ "lever:livingMonthly": read(c, w, "lever:livingMonthly") - 30_000 }));
    const view = planView(wh, cat, pid);
    const f = buildStages(view)
      .flatMap((s) => allFields(s))
      .find((x) => x.kind === "yen" && x.readOnly === undefined && x.key.startsWith("work/") && typeof x.get(view).value === "number")!;
    const edited = f.set(view, (f.get(view).value as number) + 100_000);
    const w = recordPlanEdit(wh, cat, pid, view, edited);
    expect(leverDiffs(w, pid)).toEqual(leverDiffs(wh, pid));
    expect(f.get(planView(w, cat, pid)).value).toBe(f.get(edited).value);
  });
});
