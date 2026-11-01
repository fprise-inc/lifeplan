// 結果のタブの「運用の利回り」「変動金利の上昇」で動かしたプランを、現状に何度も反映しても、前提の書き換えの並びが積み重ならない
// （計算に使う利回りは同じまま、書き換えは1件にまとまる。今の利回りに戻せば書き換えは無くなる）
import { describe, expect, it } from "vitest";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import type { WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { sameRate } from "../src/workspace/input/units.ts";
import { applyValues, reflectPlan, savePlan } from "../src/workspace/plans/plans.ts";
import type { Values } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { modelHousehold, preview } from "./helpers.ts";

const NOW = "2026-10-22T10:00:00.000Z";

function setup(id: string) {
  const req = modelHousehold(id);
  const self = roles(req).find((r) => r.key === "self")!.member;
  const cat = (w: WorkingHousehold) => buildCatalog(w, self.id, demoHousehold(id) ?? null);
  /** values のプランを作って現状に反映する */
  const reflect = (w: WorkingHousehold, values: Values): WorkingHousehold => {
    const c = cat(w);
    const b = savePlan(w, c, { name: "プラン", base: null, values, now: NOW });
    return reflectPlan(b.wh, c, b.id, NOW);
  };
  return { wh: fromRequest(req, {}), cat, reflect };
}

const balances = (r: EngineRequest) => preview(r).table.map((y) => JSON.stringify(y));

describe("運用の利回りを何度も現状に反映する", () => {
  for (const id of ["salariedCoupleTwoKids", "single25"]) {
    it(`${id}: 3回反映しても書き換えは1件で、1回で同じ利回りにしたときと計算が同じ`, () => {
      const { wh, cat, reflect } = setup(id);
      let now = wh;
      for (const r of ["0.02", "0.03", "0.025"]) now = reflect(now, { "inv:rate": r });
      expect(now.request.input.assumptions?.returnShifts ?? []).toHaveLength(1);
      expect(sameRate(cat(now).byKey.get("inv:rate")!.read(now) as string, "0.025")).toBe(true);
      const once = reflect(wh, { "inv:rate": "0.025" });
      expect(balances(now.request)).toEqual(balances(once.request));
    });

    it(`${id}: 元の利回りに戻して反映すると、書き換えは無くなる`, () => {
      const { wh, cat, reflect } = setup(id);
      const raw = cat(wh).byKey.get("inv:rate")!.read(wh) as string;
      const moved = reflect(wh, { "inv:rate": "0.02" });
      const back = reflect(moved, { "inv:rate": raw });
      expect(back.request.input.assumptions?.returnShifts ?? []).toHaveLength(0);
      expect(balances(back.request)).toEqual(balances(wh.request));
    });

    it(`${id}: 反映したあとのプランの値も、書き換え1件の上で当たる`, () => {
      const { wh, cat, reflect } = setup(id);
      const now = reflect(reflect(wh, { "inv:rate": "0.02" }), { "inv:rate": "0.03" });
      const next = applyValues(now, { "inv:rate": "0.015" }, cat(now));
      expect(next.input.assumptions?.returnShifts ?? []).toHaveLength(1);
      expect(sameRate(cat(now).byKey.get("inv:rate")!.read({ ...now, request: next }) as string, "0.015")).toBe(true);
    });
  }

  it("上限（cap）のある書き換えが前にあるときは、順に当てる意味が変わらないよう後ろに足す", () => {
    const { wh, cat, reflect } = setup("salariedCoupleTwoKids");
    const by = Number(wh.request.input.baseMonth.slice(0, 4));
    const request = structuredClone(wh.request);
    request.input.assumptions!.returnShifts = [{ from: by, add: "-0.01" }, { from: by + 1, to: by + 3, cap: "0.01" }];
    const w0 = { ...wh, request };
    const before = cat(w0).byKey.get("inv:rate")!.read(w0) as string;
    const w1 = reflect(w0, { "inv:rate": "0.02" });
    const list = w1.request.input.assumptions?.returnShifts ?? [];
    expect(list).toHaveLength(3);
    expect(list.slice(0, 2).map((s) => ({ from: s.from, to: s.to, add: s.add, cap: s.cap }))).toEqual([
      { from: by, to: undefined, add: "-0.01", cap: undefined },
      { from: by + 1, to: by + 3, add: undefined, cap: "0.01" },
    ]);
    expect(sameRate(cat(w1).byKey.get("inv:rate")!.read(w1) as string, "0.02")).toBe(true);
    expect(before).not.toBe("0.02");
  });
});

describe("変動金利の上昇を何度も現状に反映する", () => {
  it("上乗せは1件のまま（置き換える）", () => {
    const id = "salariedCoupleTwoKids";
    expect(setup(id).cat(setup(id).wh).byKey.has("rates:shift")).toBe(true);
    const { wh, reflect } = setup(id);
    const by = Number(wh.request.input.baseMonth.slice(0, 4));
    let now = wh;
    for (const add of ["0.01", "0.02", "0.005"]) now = reflect(now, { "rates:shift": { add, from: `${by + 2}-01` } });
    expect((now.request.input.assumptions?.loanRateShifts as unknown[] | undefined) ?? []).toHaveLength(1);
  });
});
