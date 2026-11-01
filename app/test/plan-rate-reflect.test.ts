// 運用の利回りの項目: 書き換えたプランを現状に反映したあとも、今の利回りは書き換えた値に見え、次のプランの書き換えが重ならない
import { describe, expect, it } from "vitest";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { sameRate } from "../src/workspace/input/units.ts";
import { addRate } from "../src/workspace/plans/decimal.ts";
import { applyValues, reflectPlan, savePlan } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold } from "./helpers.ts";

const NOW = "2026-10-22T10:00:00.000Z";

describe("運用の利回りを現状に反映する", () => {
  for (const id of ["salariedCoupleTwoKids", "single25"]) {
    it(`${id}: 反映したあとの今の利回りは反映した値。次のプランは、そこからの差だけを書き換える`, () => {
      const req = modelHousehold(id);
      const self = roles(req).find((r) => r.key === "self")!.member;
      const wh = fromRequest(req, {});
      const cat = buildCatalog(wh, self.id, demoHousehold(id) ?? null);
      const rate = cat.byKey.get("inv:rate")!;
      const raw = rate.read(wh) as string;
      const b = savePlan(wh, cat, { name: "プランB", base: null, values: { "inv:rate": "0.02" }, now: NOW });
      expect(sameRate(rate.read({ ...b.wh, request: applyValues(b.wh, { "inv:rate": "0.02" }, cat) }) as string, "0.02")).toBe(true);
      const now = reflectPlan(b.wh, cat, b.id, NOW);
      const cat2 = buildCatalog(now, self.id, demoHousehold(id) ?? null);
      const rate2 = cat2.byKey.get("inv:rate")!;
      expect(sameRate(rate2.read(now) as string, "0.02")).toBe(true);
      // 次のプランで 3% にすると、書き換えの合計は 3% − 元の利回り（重ならない）
      const next = applyValues(now, { "inv:rate": "0.03" }, cat2);
      const total = (next.input.assumptions?.returnShifts ?? []).reduce((t, s) => addRate(t, s.add ?? "0"), "0");
      expect(sameRate(addRate(raw, total), "0.03")).toBe(true);
      expect(sameRate(rate2.read({ ...now, request: next }) as string, "0.03")).toBe(true);
    });
  }
});
