// 土台のプランから来た行を「戻す」（現状に戻す）: このプランで同じ項目の差分をオフにしてあっても、現状の値に戻る
import { describe, expect, it } from "vitest";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildCatalog, type Catalog } from "../src/workspace/plans/items.ts";
import { diffRows, revertRow, toggleRow } from "../src/workspace/plans/planEdit.ts";
import { dropChange, effectiveValues, savePlan } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold } from "./helpers.ts";

const NOW = "2026-10-22T10:00:00.000Z";

/** B（現状から: 65歳まで働く）と、B を土台にした C（70歳まで働く。その行をオフにしてある）。現状は60歳まで */
function setup(): { wh: WorkingHousehold; cat: Catalog; c: string } {
  const req = modelHousehold("salariedCoupleTwoKids");
  const self = roles(req).find((r) => r.key === "self")!.member;
  let wh = fromRequest(req, {});
  const cat = buildCatalog(wh, self.id, demoHousehold("salariedCoupleTwoKids")!);
  const b = savePlan(wh, cat, { name: "プランB", base: null, values: { "lever:retireAge": 65 }, now: NOW });
  wh = b.wh;
  const c = savePlan(wh, cat, { name: "プランC", base: b.id, values: { "lever:retireAge": 70 }, now: NOW });
  wh = c.wh;
  wh = toggleRow(wh, c.id, diffRows(wh, cat, c.id).find((r) => !r.inherited)!, false);
  return { wh, cat, c: c.id };
}

describe("土台から来た行を戻す", () => {
  it("違いの一覧の「戻す」（revertRow）で現状の値になる", () => {
    const { wh, cat, c } = setup();
    expect(effectiveValues(wh, c)).toEqual({ "lever:retireAge": 65 });
    const inherited = diffRows(wh, cat, c).find((r) => r.inherited)!;
    expect(effectiveValues(revertRow(wh, cat, c, inherited), c)).toEqual({ "lever:retireAge": 60 });
  });
  it("結果のタブの「変えたこと」から戻しても（dropChange）同じ。戻したあとに同じ項目のオフの差分は残さない", () => {
    const { wh, cat, c } = setup();
    const next = dropChange(wh, cat, c, "lever:retireAge");
    expect(effectiveValues(next, c)).toEqual({ "lever:retireAge": 60 });
    const own = next.proposals.find((p) => p.id === c)!.diffs;
    expect(own).toHaveLength(1);
    expect(own[0]!.enabled).toBe(true);
  });
});
