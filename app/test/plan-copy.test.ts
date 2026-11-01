// 入力の画面の「このプランを複製」: 差分をそのまま写す（オフにした差分・値の箱の状態・出どころ・作った時点の値も落とさない）
import { describe, expect, it } from "vitest";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { diffRows, toggleRow } from "../src/workspace/plans/planEdit.ts";
import { copyPlan, effectiveValues, findPlan, savePlan, setPlanValue } from "../src/workspace/plans/plans.ts";
import type { DiffBox } from "../src/workspace/plans/diffs.ts";
import { resolveKey } from "../src/workspace/store/readings.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold } from "./helpers.ts";

const NOW = "2026-10-22T10:00:00.000Z";

describe("このプランを複製", () => {
  const req = modelHousehold("salariedCoupleTwoKids");
  const self = roles(req).find((r) => r.key === "self")!.member;
  let wh = fromRequest(req, {});
  const cat = buildCatalog(wh, self.id, demoHousehold("salariedCoupleTwoKids")!);
  const b = savePlan(wh, cat, { name: "プランB", base: null, tags: ["面談1"], values: { "lever:retireAge": 65, "lever:livingMonthly": 280000 }, now: NOW });
  wh = b.wh;
  // 退職金の欄を「推定」の値の箱で直し、生活費の行をオフにする
  const key = cat.items.find((i) => i.key.startsWith("field:retirement/"))!.key;
  const r = resolveKey(key, wh.request.input as unknown as Record<string, unknown>);
  if (r === null || r.kind !== "address") throw new Error("当て先が無い");
  const estimated: DiffBox = { value: 20_000_000, state: "estimated", origin: { kind: "manual" } } as DiffBox;
  wh = setPlanValue(wh, cat, b.id, r.address, estimated);
  wh = toggleRow(wh, b.id, diffRows(wh, cat, b.id).find((x) => x.label.includes("生活費"))!, false);
  const src = findPlan(wh.proposals, b.id)!;

  it("差分の数・オンオフ・値の箱・出どころ・作った時点の値が同じ。ID は付け直す", () => {
    const c = copyPlan(wh, src, "プランC プランBの複製", NOW);
    const cp = findPlan(c.wh.proposals, c.id)!;
    const strip = (ds: typeof cp.diffs) => ds.map(({ id: _i, ...rest }) => (void _i, rest));
    expect(strip(cp.diffs)).toEqual(strip(src.diffs));
    expect(cp.diffs.some((d) => src.diffs.some((s) => s.id === d.id))).toBe(false);
    expect(cp.diffs.filter((d) => !d.enabled)).toHaveLength(1);
    expect(cp.diffs.map((d) => (d.value as DiffBox | null)?.state)).toContain("estimated");
  });
  it("土台・印・中身は元のプランと同じ。元のプランは変えない", () => {
    const c = copyPlan(wh, src, "プランC", NOW);
    const cp = findPlan(c.wh.proposals, c.id)!;
    expect(cp.base).toBe(src.base);
    expect(cp.tags).toEqual(["面談1"]);
    expect(effectiveValues(c.wh, c.id)).toEqual(effectiveValues(wh, b.id));
    expect(findPlan(c.wh.proposals, b.id)).toBe(src);
  });
});
