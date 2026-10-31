// プランの帯から外すとき: 保存していない変更（結果のタブで動かした値）があるプランは、黙って捨てずに選ばせる（0096 の追記）
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { BandDropDialog } from "../src/workspace/plans/BandDropDialog.tsx";
import { CURRENT, hideFromBand, unsavedRemoval } from "../src/workspace/plans/band.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { savePlan } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold } from "./helpers.ts";

const NOW = "2026-10-31T10:00:00.000Z";

function withPlans(): { wh: WorkingHousehold; ids: string[] } {
  const req = modelHousehold("salariedCoupleTwoKids");
  const self = roles(req).find((r) => r.key === "self")!.member;
  let wh = fromRequest(req, {});
  const cat = buildCatalog(wh, self.id, demoHousehold("salariedCoupleTwoKids")!);
  const ids: string[] = [];
  for (const [name, values] of [
    ["プランB 65歳まで働く", { "lever:retireAge": 65 }],
    ["プランC 生活費を見直す", { "lever:livingMonthly": 260000 }],
  ] as const) {
    const r = savePlan(wh, cat, { name, base: null, values, now: NOW });
    wh = r.wh;
    ids.push(r.id);
  }
  const d = savePlan(wh, cat, { name: "プランD Cを元に", base: ids[1]!, values: { "lever:livingMonthly": 260000, "lever:nisaMonthly": 50000 }, now: NOW });
  return { wh: d.wh, ids: [...ids, d.id] };
}

describe("帯から外す前の確かめ", () => {
  const { wh, ids } = withPlans();
  const [b, c] = ids as [string, string, string];
  const w = { band: ids, base: CURRENT, sel: b, drafts: { [b]: { "lever:retireAge": 67 } } };

  it("保存していない変更があるプランを外すときだけ確かめる（一覧で帯から外す・帯の「×」で外す）", () => {
    expect(unsavedRemoval(wh, w, new Set([b]), b, "hide")).toEqual({ id: b, letter: "B", mode: "hide", heirs: [] });
    expect(unsavedRemoval(wh, w, new Set([b]), b, "delete")).toEqual({ id: b, letter: "B", mode: "delete", heirs: [] });
    expect(unsavedRemoval(wh, w, new Set([b]), c, "hide")).toBeNull();
    // このプランを元にしたプランがあれば、引き継ぐプランの名前を添える
    expect(unsavedRemoval(wh, w, new Set([c]), c, "delete")?.heirs).toEqual(["プランD"]);
  });

  it("一覧で帯から外す: 帯から外し、保存していない変更も捨てる。表示していたら帯の先頭へ", () => {
    const r = hideFromBand(w, b);
    expect(r.band).toEqual(ids.slice(1));
    expect(r.drafts).toEqual({});
    expect(r.sel).toBe(c);
  });
});

describe("帯から外す前の確かめの画面", () => {
  const render = (mode: "hide" | "delete", heirs: string[] = []) => renderToString(h(BandDropDialog, { removal: { id: "x", letter: "B", mode, heirs }, onChoose: () => undefined }));
  it("一覧で帯から外す: 上書き保存して外す・変更を捨てて外す・やめる。プランは一覧に残ると書く", () => {
    const html = render("hide");
    expect(html).toContain("プランB に保存していない変更があります");
    expect(html).toContain("一覧に残ります");
    for (const k of ["overwrite", "discard", "cancel"]) expect(html).toContain(`data-choice="${k}"`);
  });
  it("帯の「×」で外す: 変更ごと外す（元に戻すで戻せる）・やめる。引き継ぐプランがあれば、上書き保存してから外すも出す", () => {
    const html = render("delete");
    expect(html).toContain("元に戻す（↶）で戻せます");
    expect(html).not.toContain('data-choice="overwrite"');
    expect(html).toContain('data-choice="discard"');
    expect(render("delete", ["プランD"])).toContain("プランD は上書きした中身を引き継ぎます");
  });
});
