// プランの一覧の説明の保存の文: 控えの一覧と同じく、保存している世帯かで出し分ける（プランは世帯ファイルに入る）
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { PlanList } from "../src/workspace/plans/PlanList.tsx";
import { savePlan } from "../src/workspace/plans/plans.ts";
import { SnapshotTools } from "../src/workspace/snapshots/SnapshotTools.tsx";
import { DEFAULT_BALANCE_SETTINGS, DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { bodyOf, EMPTY_CARRY, fromBody } from "../src/workspace/store/body.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold } from "./helpers.ts";

const NOW = "2026-11-19T10:00:00.000Z";
const noop = () => undefined;
const SAVED = "世帯ファイルに保存しています";
const UNSAVED = "保存していない世帯です。アプリを閉じると消えます";
const OLD = "保存はまだファイルにしません";

function withPlan() {
  const id = "salariedCoupleTwoKids";
  const req = modelHousehold(id);
  const self = roles(req).find((r) => r.key === "self")!.member;
  const wh0 = fromRequest(req);
  const cat = buildCatalog(wh0, self.id, demoHousehold(id) ?? null);
  const { wh } = savePlan(wh0, cat, { name: "プランB 生活費を28万円に", base: null, values: { "lever:livingMonthly": 280000 }, now: NOW });
  return { wh, cat };
}

const list = (wh: ReturnType<typeof withPlan>["wh"], cat: ReturnType<typeof withPlan>["cat"], stored: boolean) =>
  renderToString(h(PlanList, { wh, catalog: cat, letters: new Map(), band: [], onBand: noop, onEdit: noop, onReflect: noop, onClose: noop, stored }));
const snapList = (stored: boolean) => renderToString(h(SnapshotTools, { list: [], stored, onTake: async () => undefined, onRemove: noop, bar: false, mode: "list", onMode: noop }));

describe("プランの一覧の保存の文", () => {
  it("保存していない新しい世帯は「アプリを閉じると消えます」（控えの一覧と同じ文）", () => {
    const { wh, cat } = withPlan();
    const html = list(wh, cat, false);
    expect(html).toContain(UNSAVED);
    expect(html).not.toContain(SAVED);
    expect(html).not.toContain(OLD);
    expect(snapList(false)).toContain(UNSAVED);
  });

  it("保存した世帯は「世帯ファイルに保存しています」（控えの一覧と同じ文）", () => {
    const { wh, cat } = withPlan();
    const html = list(wh, cat, true);
    expect(html).toContain(SAVED);
    expect(html).not.toContain(UNSAVED);
    expect(html).not.toContain(OLD);
    expect(snapList(true)).toContain(SAVED);
  });

  it("保存した後に開き直した世帯: プランは世帯ファイルから戻り、文は「世帯ファイルに保存しています」", () => {
    const { wh, cat } = withPlan();
    const display = { result: DEFAULT_DISPLAY_SETTINGS, balance: DEFAULT_BALANCE_SETTINGS };
    const back = fromBody(bodyOf({ wh, workspace: { template: null, band: [], base: "current", selected: "current", shownItems: [] }, display, carry: EMPTY_CARRY } as never));
    expect(back.wh.proposals.map((p) => p.name)).toEqual(["プランB 生活費を28万円に"]);
    const html = list(back.wh, cat, true);
    expect(html).toContain("生活費を28万円に");
    expect(html).toContain(SAVED);
    expect(html).not.toContain(OLD);
  });
});
