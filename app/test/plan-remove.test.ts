// 帯のカードの「×」でプランを外す: A（現状）と基準のプランには出さない・押すと外れて知らせが出る・元に戻すで戻る
import { describe, expect, it } from "vitest";
import { h, type VNode } from "preact";
import { renderToString } from "preact-render-to-string";
import { PlanBand, type PlanBandProps } from "../src/presentation/PlanBand.tsx";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { bandModel, CURRENT, planLetters, removeFromBand } from "../src/workspace/plans/band.ts";
import { buildCatalog, type Catalog } from "../src/workspace/plans/items.ts";
import { diffKey, savePlan } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { DEFAULT_BALANCE_SETTINGS, DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { sameSnap, type AppSnap } from "../src/workspace/undo/appHistory.ts";
import { historyScope, UndoController, type UndoEnv } from "../src/workspace/undo/controller.ts";
import { UndoHistory } from "../src/workspace/undo/history.ts";
import { modelHousehold } from "./helpers.ts";

const NOW = "2026-10-22T10:00:00.000Z";

/** 見本の世帯にプランを3つ足す（B・C は現状から、D は C を元に） */
function withPlans(): { wh: WorkingHousehold; cat: Catalog; ids: string[] } {
  const req = modelHousehold("salariedCoupleTwoKids");
  const self = roles(req).find((r) => r.key === "self")!.member;
  const demo = demoHousehold("salariedCoupleTwoKids")!;
  let wh = fromRequest(req, {});
  const cat = buildCatalog(wh, self.id, demo);
  const ids: string[] = [];
  const add = (name: string, base: string | null, values: Record<string, number>) => {
    const r = savePlan(wh, cat, { name, base, values, now: NOW });
    wh = r.wh;
    ids.push(r.id);
  };
  add("プランB 65歳まで働く", null, { "lever:retireAge": 65 });
  add("プランC 生活費を見直す", null, { "lever:livingMonthly": 260000 });
  add("プランD Cを元に", ids[1]!, { "lever:livingMonthly": 260000, "lever:nisaMonthly": 50000 });
  return { wh, cat, ids };
}

const bandOf = (wh: WorkingHousehold, band: string[], base: string, sel: string) => {
  const slots = [CURRENT, ...band];
  return bandModel({ req: wh.request, slots, letters: planLetters(wh.proposals), results: new Map(slots.map((id) => [id, null])), modified: new Set(), base, selected: sel, settings: DEFAULT_DISPLAY_SETTINGS, colors: new Map() });
};

/** 部品の木から、条件に合う要素を探す（フックを使わない部品なので、そのまま呼んで木を見る） */
function findAll(n: unknown, pred: (v: VNode<Record<string, unknown>>) => boolean, out: VNode<Record<string, unknown>>[] = []): VNode<Record<string, unknown>>[] {
  if (Array.isArray(n)) {
    for (const c of n) findAll(c, pred, out);
    return out;
  }
  if (n === null || typeof n !== "object" || !("props" in n)) return out;
  const v = n as VNode<Record<string, unknown>>;
  if (pred(v)) out.push(v);
  findAll(v.props.children, pred, out);
  return out;
}

const noop = () => undefined;

describe("帯のカードの「×」", () => {
  const { wh, ids } = withPlans();
  const band = ids;

  it("A（現状）には付けない。外せるプランにだけ付ける。aria-label・title は「このプランを外す」", () => {
    const html = renderToString(h(PlanBand, { model: bandOf(wh, band, CURRENT, ids[0]!), onSelect: noop, onBase: noop, onAdd: noop, onRemove: noop }));
    expect(html).not.toContain('data-plan-remove="A"');
    for (const l of ["B", "C", "D"]) expect(html).toContain(`data-plan-remove="${l}"`);
    expect(html.match(/aria-label="このプランを外す"/g)).toHaveLength(3);
    expect(html.match(/title="このプランを外す"/g)).toHaveLength(3);
    // カードはボタンなので、× はカードの中に入れない（カードの兄弟）
    expect(html).not.toMatch(/<button[^>]*data-plan-card[^>]*>(?:(?!<\/button>).)*data-plan-remove/s);
  });

  it("基準を別のプランにしているときは、その基準のカードにも付けない", () => {
    const html = renderToString(h(PlanBand, { model: bandOf(wh, band, ids[1]!, ids[0]!), onSelect: noop, onBase: noop, onAdd: noop, onRemove: noop }));
    expect(html).not.toContain('data-plan-remove="A"');
    expect(html).not.toContain('data-plan-remove="C"');
    expect(html).toContain('data-plan-remove="B"');
    expect(html).toContain('data-plan-remove="D"');
  });

  it("onRemove を渡さない（提示用など）ときは、どのカードにも付けない", () => {
    const html = renderToString(h(PlanBand, { model: bandOf(wh, band, CURRENT, ids[0]!), onSelect: noop, onBase: noop, onAdd: noop }));
    expect(html).not.toContain("data-plan-remove");
    expect(html).not.toContain("このプランを外す");
  });

  it("× を押すと、カードの押下（表示の切り替え）には伝えず、そのカードの鍵で外す", () => {
    const removed: string[] = [];
    const selected: string[] = [];
    const props: PlanBandProps = { model: bandOf(wh, band, CURRENT, ids[0]!), onSelect: (k) => selected.push(k), onBase: noop, onAdd: noop, onRemove: (k) => removed.push(k) };
    const tree = PlanBand(props);
    const x = findAll(tree, (v) => v.props["data-plan-remove"] === "C")[0]!;
    let stopped = false;
    (x.props.onClick as (e: { stopPropagation: () => void }) => void)({ stopPropagation: () => (stopped = true) });
    expect(removed).toEqual(["C"]);
    expect(selected).toEqual([]);
    expect(stopped).toBe(true);
  });
});

describe("帯のカードからプランを外す", () => {
  it("一覧と帯から外し、知らせの文を返す。表示していたプランなら基準に戻す", () => {
    const { wh, ids } = withPlans();
    const r = removeFromBand(wh, { band: ids, base: CURRENT, sel: ids[0]! }, ids[0]!)!;
    expect(r.wh.proposals.map((p) => p.id)).toEqual([ids[1], ids[2]]);
    expect(r.band).toEqual([ids[1], ids[2]]);
    expect(r.sel).toBe(CURRENT);
    expect(r.message).toBe("プランB を外しました");
    // 基準を別のプランにしていれば、その基準に戻す
    const r2 = removeFromBand(wh, { band: ids, base: ids[2]!, sel: ids[0]! }, ids[0]!)!;
    expect(r2.sel).toBe(ids[2]);
    // 表示していないプランを外したときは、表示はそのまま
    const r3 = removeFromBand(wh, { band: ids, base: CURRENT, sel: ids[2]! }, ids[0]!)!;
    expect(r3.sel).toBe(ids[2]);
  });

  it("このプランを元にしたプランがあれば、知らせに「中身を引き継ぎます」を添え、中身を写す", () => {
    const { wh, ids } = withPlans();
    const r = removeFromBand(wh, { band: ids, base: CURRENT, sel: ids[0]! }, ids[1]!)!;
    expect(r.message).toBe("プランC を外しました。プランD は中身を引き継ぎます");
    const d = r.wh.proposals.find((p) => p.id === ids[2])!;
    expect(d.base).toBeNull();
    expect(d.diffs.map((x) => diffKey(x, r.wh)).sort()).toEqual(["lever:livingMonthly", "lever:nisaMonthly"]);
  });

  it("現状と基準のプランは外せない", () => {
    const { wh, ids } = withPlans();
    expect(removeFromBand(wh, { band: ids, base: CURRENT, sel: ids[0]! }, CURRENT)).toBeNull();
    expect(removeFromBand(wh, { band: ids, base: ids[0]!, sel: ids[0]! }, ids[0]!)).toBeNull();
    expect(removeFromBand(wh, { band: ids, base: CURRENT, sel: ids[0]! }, "gone")).toBeNull();
  });

  it("元に戻す（⌘Z と同じ仕組み）で、プラン・帯・表示が外す前に戻る", () => {
    const { wh, ids } = withPlans();
    const env: UndoEnv = { activeText: () => null, native: noop, release: () => noop, hint: () => ({ control: "このプランを外す", dialog: null }), now: () => 0 };
    const c = new UndoController(env);
    const msgs: string[] = [];
    c.notify = (m) => msgs.push(m);
    const hi = new UndoHistory<AppSnap>({ same: sameSnap });
    const snap = (w: WorkingHousehold, band: string[], sel: string): AppSnap => ({ wh: w, work: { band, base: CURRENT, sel, drafts: {} }, settings: DEFAULT_DISPLAY_SETTINGS, bs: DEFAULT_BALANCE_SETTINGS });
    let state = snap(wh, ids, ids[0]!);
    c.push(historyScope(0, () => hi, (s) => (state = s)));
    const before = state;
    const r = removeFromBand(state.wh, state.work, ids[0]!)!;
    state = snap(r.wh, r.band, r.sel);
    c.record(hi, before, state, () => "プラン");
    expect(state.wh.proposals).toHaveLength(2);
    expect(c.run("undo")).toBe("app");
    expect(state.wh.proposals.map((p) => p.id)).toEqual(ids);
    expect(state.work.band).toEqual(ids);
    expect(state.work.sel).toBe(ids[0]);
    expect(msgs.at(-1)).toContain("元に戻しました");
  });
});
