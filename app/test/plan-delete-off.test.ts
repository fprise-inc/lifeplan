// プランを外したとき、このプランを土台にしていたプランの中身が変わらない（土台の差分を写す。オフにした自分の差分があっても）
import { describe, expect, it } from "vitest";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { CURRENT, removeFromBand } from "../src/workspace/plans/band.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { diffRows, toggleRow } from "../src/workspace/plans/planEdit.ts";
import { deletePlan, effectiveValues, savePlan } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold } from "./helpers.ts";

const NOW = "2026-10-22T10:00:00.000Z";

/** B（現状から: 65歳まで働く）と、B を土台にした C（70歳まで働く。その行をオフにしてある）。現状は60歳まで */
function setup(): { wh: WorkingHousehold; b: string; c: string } {
  const req = modelHousehold("salariedCoupleTwoKids");
  const self = roles(req).find((r) => r.key === "self")!.member;
  let wh = fromRequest(req, {});
  const cat = buildCatalog(wh, self.id, demoHousehold("salariedCoupleTwoKids")!);
  const b = savePlan(wh, cat, { name: "プランB", base: null, values: { "lever:retireAge": 65 }, now: NOW });
  wh = b.wh;
  const c = savePlan(wh, cat, { name: "プランC", base: b.id, values: { "lever:retireAge": 70 }, now: NOW });
  wh = c.wh;
  wh = toggleRow(wh, c.id, diffRows(wh, cat, c.id).find((r) => !r.inherited)!, false);
  return { wh, b: b.id, c: c.id };
}

describe("土台のプランを外す", () => {
  it("子のプランでオフにした差分は、土台の差分の代わりにならない（中身は土台の値のまま）", () => {
    const { wh, b, c } = setup();
    expect(effectiveValues(wh, c)).toEqual({ "lever:retireAge": 65 });
    expect(effectiveValues(deletePlan(wh, b), c)).toEqual({ "lever:retireAge": 65 });
  });
  it("帯の × で外しても同じ", () => {
    const { wh, b, c } = setup();
    const r = removeFromBand(wh, { band: [b, c], base: CURRENT, sel: c }, b)!;
    expect(effectiveValues(r.wh, c)).toEqual({ "lever:retireAge": 65 });
  });
  it("オフにした自分の差分は残す（オンに戻せる）", () => {
    const { wh, b, c } = setup();
    const next = deletePlan(wh, b);
    const own = next.proposals.find((p) => p.id === c)!.diffs;
    expect(own.filter((d) => !d.enabled)).toHaveLength(1);
  });
});
