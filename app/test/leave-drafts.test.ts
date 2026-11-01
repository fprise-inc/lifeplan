// 世帯を切り替える・アプリを閉じるとき: プランの保存していない変更（結果のタブで動かした値）があれば、黙って捨てずに選ばせる（0096 の追記）
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { DraftsLeaveDialog } from "../src/workspace/plans/DraftsLeaveDialog.tsx";
import { CURRENT } from "../src/workspace/plans/band.ts";
import { buildCatalog, type Catalog } from "../src/workspace/plans/items.ts";
import { overwriteDrafts, unsavedPlanNames } from "../src/workspace/plans/leaveDrafts.ts";
import { effectiveValues, savePlan, sameValues, type Values } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold } from "./helpers.ts";

const NOW = "2026-10-31T10:00:00.000Z";

function withPlans(): { wh: WorkingHousehold; cat: Catalog; b: string; c: string } {
  const req = modelHousehold("salariedCoupleTwoKids");
  const self = roles(req).find((r) => r.key === "self")!.member;
  let wh = fromRequest(req, {});
  const cat = buildCatalog(wh, self.id, demoHousehold("salariedCoupleTwoKids")!);
  const rb = savePlan(wh, cat, { name: "プランB 65歳まで働く", base: null, values: { "lever:retireAge": 65 }, now: NOW });
  wh = rb.wh;
  const rc = savePlan(wh, cat, { name: "プランC Bを元に", base: rb.id, values: { "lever:retireAge": 65, "lever:livingMonthly": 260000 }, now: NOW });
  return { wh: rc.wh, cat, b: rb.id, c: rc.id };
}

describe("切り替える・閉じる前に、プランの保存していない変更を確かめる", () => {
  const { wh, cat, b, c } = withPlans();

  it("保存していない変更があるプランの名前（一覧の順）。無ければ空（聞かない）", () => {
    expect(unsavedPlanNames(wh, new Set([c, b]))).toEqual(["プランB", "プランC"]);
    expect(unsavedPlanNames(wh, new Set())).toEqual([]);
    expect(unsavedPlanNames(wh, new Set([CURRENT]))).toEqual([]);
  });

  it("上書き保存して切り替える: 全部のプランを動かした値で上書きし、保存していない変更を空にする（元にしたプランから先に）", () => {
    const drafts: Record<string, Values> = { [c]: { "lever:retireAge": 68, "lever:livingMonthly": 250000 }, [b]: { "lever:retireAge": 67 } };
    const r = overwriteDrafts(wh, cat, drafts, [c, b], NOW);
    expect(r.drafts).toEqual({});
    expect(sameValues(effectiveValues(r.wh, b), { "lever:retireAge": 67 }, cat)).toBe(true);
    // C は B の上の差分。B を先に上書きしてから C を上書きするので、C の中身は動かした値どおり
    expect(sameValues(effectiveValues(r.wh, c), { "lever:retireAge": 68, "lever:livingMonthly": 250000 }, cat)).toBe(true);
  });

  it("上書きしないプランの保存していない変更は残す", () => {
    const drafts: Record<string, Values> = { [b]: { "lever:retireAge": 67 }, x: { a: 1 } };
    expect(overwriteDrafts(wh, cat, drafts, [b], NOW).drafts).toEqual({ x: { a: 1 } });
  });
});

describe("切り替える・閉じる前の確かめの画面", () => {
  const render = (action: "switch" | "close", names: string[]) => renderToString(h(DraftsLeaveDialog, { names, action, onChoose: () => undefined }));
  it("上書き保存して切り替える・変更を捨てて切り替える・やめる。どのプランかを書く", () => {
    const html = render("switch", ["プランB", "プランC"]);
    expect(html).toContain("プランB・プランC");
    expect(html).toContain("上書き保存して切り替える");
    expect(html).toContain("変更を捨てて切り替える");
    for (const k of ["overwrite", "discard", "cancel"]) expect(html).toContain(`data-choice="${k}"`);
    expect(render("close", ["プランB"])).toContain("上書き保存して閉じる");
  });
});
